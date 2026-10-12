// Fine Print toolbar button: lists the terms on this page and opens the check right on the page.
const main = document.getElementById('main');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function tell(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); } catch {}
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); // tabs opened before install
  return chrome.tabs.sendMessage(tabId, message);
}

async function start() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const settings = await chrome.storage.local.get(['autoOffer', 'quietSites', 'server']);
  const auto = document.getElementById('auto');
  auto.checked = settings.autoOffer !== false;
  auto.addEventListener('change', () => chrome.storage.local.set({ autoOffer: auto.checked }));
  const server = document.getElementById('server');
  server.value = settings.server || '';
  document.getElementById('save').addEventListener('click', async () => {
    const v = server.value.trim().replace(/\/+$/, '');
    if (v && !/^https?:\/\/[^\s]+$/i.test(v)) { server.setCustomValidity('Start with https://'); server.reportValidity(); return; }
    await chrome.storage.local.set({ server: v });
    document.getElementById('save').textContent = 'Saved';
  });

  if (!tab?.id || !/^https?:/.test(tab.url || '')) {
    main.innerHTML = '<p class="note">Open a web page with terms to check, then click Fine Print again.</p>';
    return;
  }
  const host = new URL(tab.url).hostname;
  const quiet = document.getElementById('quiet');
  document.getElementById('quiet-host').textContent = host.replace(/^www\./, '');
  document.getElementById('quiet-row').hidden = false;
  const quietSites = settings.quietSites || [];
  quiet.checked = quietSites.includes(host);
  quiet.addEventListener('change', async () => {
    const list = ((await chrome.storage.local.get('quietSites')).quietSites || []).filter((h) => h !== host);
    if (quiet.checked) list.push(host);
    chrome.storage.local.set({ quietSites: list });
  });

  let scan;
  try { scan = await tell(tab.id, { type: 'scan' }); }
  catch { main.innerHTML = '<p class="note">Fine Print can’t run on this page. Try another tab.</p>'; return; }

  const items = [];
  if (scan.looksLikeTerms) items.push({ page: true, label: 'This page', hint: 'Read it', primary: true });
  for (const l of scan.links) items.push({ url: l.href, label: l.label, hint: l.agreement ? 'You’re asked to agree' : 'Check', primary: !items.length && l.agreement });
  if (!scan.looksLikeTerms) items.push({ page: true, label: 'Everything on this page', hint: 'Read it' });

  main.innerHTML = `
    <h1>${scan.links.length ? 'Terms on this page' : 'No terms links found here'}</h1>
    ${scan.links.length ? '' : '<p class="note">You can still have SubQ read whatever is on this page.</p>'}
    <div class="list">${items.map((it, i) => `<button class="doc${it.primary ? ' primary' : ''}" type="button" data-i="${i}"><span>${esc(it.label)}</span><em>${esc(it.hint)}</em></button>`).join('')}</div>`;
  main.querySelectorAll('.doc').forEach((b) => b.addEventListener('click', async () => {
    const it = items[Number(b.dataset.i)];
    await tell(tab.id, it.page ? { type: 'check', page: true } : { type: 'check', url: it.url });
    window.close();
  }));
}
start();
