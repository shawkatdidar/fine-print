// Fine Print extension, background worker.
// It talks to the Fine Print server (the only place the SubQ key lives) and, when a site
// refuses to be read by a server, opens the page in a quiet background tab and reads it there.

const DEFAULT_SERVER = 'https://fineprint.buildtube.app';

async function server() {
  const { server: saved } = await chrome.storage.local.get('server');
  return String(saved || DEFAULT_SERVER).replace(/\/+$/, '');
}

async function post(path, body) {
  const base = await server();
  let res;
  try {
    res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    return { ok: false, status: 0, data: { error: 'Couldn’t reach Fine Print. Check your connection and try again.' } };
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForLoad(tabId, timeout) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(listen); clearTimeout(timer); resolve(); };
    const listen = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    const timer = setTimeout(done, timeout);
    chrome.tabs.onUpdated.addListener(listen);
    chrome.tabs.get(tabId).then((t) => { if (t.status === 'complete') done(); }).catch(done);
  });
}

// Some sites block servers or build their text with JavaScript. A real tab sees what you'd see.
async function readInBackgroundTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForLoad(tab.id, 20000);
    let page = null;
    for (let i = 0; i < 6; i++) { // give script-built pages a few seconds to fill in
      await sleep(i === 0 ? 800 : 1000);
      const [hit] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => ({ title: document.title, text: (document.body?.innerText || '').slice(0, 1_500_000) }),
      });
      page = hit?.result;
      if (page?.text?.length > 3000) break;
    }
    return page?.text?.length > 1500 ? page : null;
  } catch {
    return null;
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

async function readLink(url, notify) {
  let r = await post('/api/link/read', { url });
  if (!r.ok && r.data.kind === 'browser') {
    notify?.('This site doesn’t let servers read it, so Fine Print is opening it in a background tab…');
    const page = await readInBackgroundTab(url);
    if (!page) throw new Error('Fine Print couldn’t read this one on its own. Open the link, then click the Fine Print button in your toolbar and choose “This page”.');
    r = await post('/api/link/read', { url, title: page.title, text: page.text });
  }
  if (!r.ok) throw new Error(r.data.error || 'Something went wrong. Try again.');
  return { ...r.data, server: await server() };
}

async function readText({ url, title, text }) {
  const r = await post('/api/link/read', { url, title, text });
  if (!r.ok) throw new Error(r.data.error || 'Something went wrong. Try again.');
  return { ...r.data, server: await server() };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type === 'read') {
    const tabId = sender.tab?.id;
    const notify = (text) => tabId && chrome.tabs.sendMessage(tabId, { type: 'progress', job: msg.job, text }).catch(() => {});
    readLink(msg.url, notify).then((data) => reply({ data }), (error) => reply({ error: error.message }));
    return true;
  }
  if (msg?.type === 'readText') {
    readText(msg).then((data) => reply({ data }), (error) => reply({ error: error.message }));
    return true;
  }
  if (msg?.type === 'openReport') {
    chrome.tabs.create({ url: msg.url, index: sender.tab ? sender.tab.index + 1 : undefined });
    return false;
  }
  return false;
});

// ---------- right-click menu ----------
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'fp-link', title: 'Check these terms with Fine Print', contexts: ['link'] });
    chrome.contextMenus.create({ id: 'fp-page', title: 'Check this page with Fine Print', contexts: ['page'] });
  });
});

// Tabs opened before the extension was installed don't have the helper yet; add it on demand.
async function tellTab(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); } catch {}
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  return chrome.tabs.sendMessage(tabId, message);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab?.id) return;
  if (info.menuItemId === 'fp-link') tellTab(tab.id, { type: 'check', url: info.linkUrl }).catch(() => {});
  if (info.menuItemId === 'fp-page') tellTab(tab.id, { type: 'check', page: true }).catch(() => {});
});
