// Fine Print extension, page helper.
// Watches for the moment a page asks you to agree to terms ("By signing up you agree to our Terms"),
// offers a one-click check, and shows SubQ's answers in a small panel without leaving the page.
// Nothing is read or sent until you click.
(() => {
  if (window.__finePrint) return;
  window.__finePrint = true;

  // ---------- spotting an agreement ----------
  const DOC_WORDS = /\b(terms|conditions|t&cs?|tos|eula|user agreement|subscriber agreement|service agreement|privacy|policy|policies|legal)\b/i;
  // The words a sign-up or checkout uses: "I agree to", "you accept our", "by continuing, you consent".
  const AGREE = /\b(i|you)\b[^.]{0,60}\b(agree|accept|consent|acknowledge|confirm)|\bagree(s|ing)? (to|with)\b|\baccept(ing)? (the|our|these|all)\b|\bconsent to\b|\bbound by\b|\bhave read\b|^\s*(i )?(agree|accept)\b/i;
  const CONTROLS = 'input[type=checkbox], input[type=email], input[type=password], input[type=tel], input[type=submit], button, [role=button], [role=checkbox]';

  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const cleanHref = (a) => { try { const u = new URL(a.href, location.href); u.hash = ''; return u.href; } catch { return null; } };
  const labelOf = (a) => (a.innerText || a.textContent || '').replace(/\s+/g, ' ').trim();
  const isPrivacy = (label) => /privacy|cookie|data/i.test(label) && !/terms|conditions|agreement|eula/i.test(label);

  function termsLinks() {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      if (out.length > 40) break;
      const label = labelOf(a);
      if (!label || label.length > 60 || !DOC_WORDS.test(label)) continue;
      const href = cleanHref(a);
      if (!href || !/^https?:/.test(href) || seen.has(href)) continue;
      seen.add(href);
      out.push({ a, href, label, privacy: isPrivacy(label) });
    }
    return out;
  }

  // An agreement is a terms link inside a short sentence that says "agree" (or similar),
  // sitting next to something you'd click or fill in: a form, a dialog, a checkbox, a button.
  function findAgreement() {
    const found = [];
    for (const link of termsLinks()) {
      if (!visible(link.a)) continue;
      let el = link.a.parentElement, sentence = null;
      for (let i = 0; i < 4 && el && el !== document.body; i++, el = el.parentElement) {
        const t = (el.innerText || '').replace(/\s+/g, ' ');
        if (t.length > 320) break; // a consent line is a sentence or two, not an article paragraph
        if (AGREE.test(t)) { sentence = el; break; }
      }
      if (!sentence) continue;
      let action = sentence.closest('form, dialog, [role=dialog], [aria-modal=true]');
      if (!action) {
        let up = sentence;
        for (let i = 0; i < 3 && up && up !== document.body; i++, up = up.parentElement) {
          if (up.querySelector(CONTROLS)) { action = up; break; }
        }
      }
      if (!action) continue;
      if (sentence.closest('footer, article, nav, [role=article], [role=navigation]') && !sentence.closest('form, dialog, [role=dialog]')) continue;
      found.push(link);
    }
    // Terms first, then privacy policies.
    return found.sort((x, y) => Number(x.privacy) - Number(y.privacy));
  }

  // ---------- the panel ----------
  let host, root, state = { docs: [], active: 0, open: false, results: new Map(), dismissed: false };

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const secs = (s) => (s < 10 ? s.toFixed(1) : Math.round(s));
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const ICON = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="14" y="6" width="36" height="52" rx="5" fill="#fff" stroke="#1d1d1f" stroke-width="4"/><rect x="20" y="17" width="24" height="3" rx="1.5" fill="#c7c7cc"/><rect x="18" y="26" width="28" height="8" rx="2" fill="#ffe04b"/><rect x="20" y="29" width="24" height="3" rx="1.5" fill="#1d1d1f"/><rect x="20" y="40" width="24" height="3" rx="1.5" fill="#c7c7cc"/><rect x="20" y="47" width="16" height="3" rx="1.5" fill="#c7c7cc"/></svg>';

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .wrap {
      --bg: #ffffff; --surface: #f5f5f7; --ink: #1d1d1f; --muted: #55555a; --faint: #8e8e93; --hair: #e0e0e5; --mark: #ffe04b; --mark-ink: #1d1d1f;
      --shadow: 0 2px 6px rgba(0,0,0,.08), 0 18px 48px rgba(0,0,0,.18);
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; max-width: calc(100vw - 32px);
      font: 15px/1.45 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Segoe UI", system-ui, sans-serif;
      letter-spacing: -0.01em; color: var(--ink); -webkit-font-smoothing: antialiased;
    }
    @media (prefers-color-scheme: dark) {
      .wrap { --bg: #1c1c1e; --surface: #2c2c2e; --ink: #f5f5f7; --muted: #aeaeb2; --faint: #8e8e93; --hair: #3a3a3c; --shadow: 0 2px 6px rgba(0,0,0,.4), 0 18px 48px rgba(0,0,0,.6); }
    }
    button { font: inherit; color: inherit; cursor: pointer; }
    button:focus-visible, a:focus-visible { outline: 3px solid #0a66ff; outline-offset: 2px; border-radius: 8px; }
    svg { width: 22px; height: 22px; flex: none; display: block; }

    .pill {
      display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px; background: var(--bg); border: 1px solid var(--hair);
      border-radius: 999px; box-shadow: var(--shadow); animation: rise 420ms cubic-bezier(.22,1,.36,1) both;
    }
    .pill p { margin: 0; font-size: 14px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px; }
    .pill p b { color: var(--ink); font-weight: 600; }
    .go { appearance: none; border: 0; background: var(--ink); color: var(--bg); border-radius: 999px; padding: 8px 16px; font-weight: 600; font-size: 14px; white-space: nowrap; }
    .go:hover { opacity: .88; }
    .x { appearance: none; border: 0; background: none; color: var(--faint); width: 30px; height: 30px; border-radius: 999px; font-size: 18px; line-height: 1; }
    .x:hover { background: var(--surface); color: var(--ink); }

    .panel {
      width: 380px; max-width: calc(100vw - 32px); max-height: min(78vh, 720px); display: flex; flex-direction: column; background: var(--bg);
      border: 1px solid var(--hair); border-radius: 18px; box-shadow: var(--shadow); overflow: hidden;
    }
    .panel.enter { animation: rise 420ms cubic-bezier(.22,1,.36,1) both; }
    .head { display: flex; align-items: center; gap: 10px; padding: 14px 12px 12px 16px; border-bottom: 1px solid var(--hair); }
    .head strong { font-size: 15px; font-weight: 600; flex: 1; }
    .tabs { display: flex; gap: 6px; padding: 12px 16px 0; flex-wrap: wrap; }
    .tab { appearance: none; border: 1px solid var(--hair); background: var(--bg); border-radius: 999px; padding: 5px 12px; font-size: 13px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tab[aria-pressed="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
    .body { padding: 16px; overflow: auto; }
    h2 { margin: 0; font-size: 19px; line-height: 1.2; font-weight: 600; letter-spacing: -0.025em; }
    .meta { margin: 6px 0 0; color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
    .meta b { color: var(--ink); font-weight: 600; }
    .loading { padding: 6px 0 4px; }
    .loading p { margin: 10px 0 0; color: var(--muted); font-size: 14px; }
    .bar { height: 4px; border-radius: 2px; background: var(--hair); overflow: hidden; margin-top: 16px; }
    .bar b { display: block; height: 100%; width: 40%; background: var(--mark); border-radius: 2px; animation: sweep 1.3s ease-in-out infinite; }
    h3 { margin: 18px 0 8px; font-size: 13px; font-weight: 600; color: var(--muted); letter-spacing: 0; }
    ul { list-style: none; margin: 0; padding: 0; }
    li { display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; align-items: center; padding: 10px 0; border-top: 1px solid var(--hair); }
    li:first-child { border-top: 0; }
    .q { font-size: 14px; line-height: 1.35; }
    .word { font-size: 13px; font-weight: 600; padding: 1px 8px; border-radius: 4px 7px 4px 6px; }
    .yes .word { background: var(--mark); color: var(--mark-ink); }
    .no .word { color: var(--muted); }
    .sure { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; color: var(--faint); font-size: 12px; }
    .meter { width: 64px; height: 3px; border-radius: 2px; background: var(--hair); overflow: hidden; }
    .meter b { display: block; height: 100%; background: var(--ink); }
    details { margin-top: 14px; }
    summary { cursor: pointer; color: var(--muted); font-size: 13px; font-weight: 600; padding: 4px 0; }
    .none { margin: 0; color: var(--muted); font-size: 14px; }
    .foot { display: flex; flex-direction: column; gap: 8px; padding: 12px 16px 14px; border-top: 1px solid var(--hair); background: var(--surface); }
    .foot .row { display: flex; gap: 8px; align-items: center; justify-content: space-between; }
    .link { appearance: none; border: 0; background: none; padding: 0; color: var(--ink); font-weight: 600; font-size: 14px; text-decoration: underline; text-decoration-color: var(--hair); text-underline-offset: 3px; }
    .link:hover { text-decoration-color: currentColor; }
    .small { margin: 0; color: var(--faint); font-size: 12px; }
    .error { margin: 0; padding: 12px 14px; border-radius: 12px; background: var(--surface); font-size: 14px; }
    .retry { margin-top: 12px; }
    @keyframes rise { from { opacity: 0; transform: translateY(10px) scale(.98); } }
    @keyframes sweep { 0% { transform: translateX(-100%); } 100% { transform: translateX(260%); } }
    @media (prefers-reduced-motion: reduce) { .pill, .panel.enter { animation: none; } .bar b { animation: none; width: 100%; } }
    @media (max-width: 480px) { .wrap { right: 12px; bottom: 12px; left: 12px; } .pill p { max-width: none; flex: 1; } .panel { width: auto; } }
  `;

  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('fine-print-helper');
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style><div class="wrap" role="region" aria-label="Fine Print"></div>`;
    document.documentElement.appendChild(host);
    root.addEventListener('click', onClick);
    root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  }
  const wrap = () => root.querySelector('.wrap');

  function close() {
    state.open = false;
    state.dismissed = true;
    host?.remove();
  }

  function showPill() {
    if (state.dismissed || state.open || !state.docs.length) return;
    mount();
    const d = state.docs[0];
    wrap().innerHTML = `
      <div class="pill">
        ${ICON}
        <p>Agreeing to <b>${esc(d.label)}</b>?</p>
        <button class="go" type="button" data-act="open">Check it first</button>
        <button class="x" type="button" data-act="close" aria-label="Dismiss" title="Dismiss">×</button>
      </div>`;
  }

  function openPanel(index = 0) {
    mount();
    state.open = true;
    state.active = index;
    render();
    const doc = state.docs[index];
    if (!state.results.has(doc.key)) run(doc);
    root.querySelector('h2, .head strong')?.setAttribute('tabindex', '-1');
    root.querySelector('h2, .head strong')?.focus({ preventScroll: true });
  }

  function render() {
    const doc = state.docs[state.active];
    const r = state.results.get(doc.key);
    const tabs = state.docs.length > 1 ? `<div class="tabs" role="group" aria-label="Documents on this page">${state.docs.map((d, i) => `<button class="tab" type="button" data-act="tab" data-i="${i}" aria-pressed="${i === state.active}">${esc(d.label)}</button>`).join('')}</div>` : '';
    let body, foot = '';
    if (!r || r.status === 'loading') {
      body = `<div class="loading" aria-live="polite"><h2>${esc(doc.label)}</h2><div class="bar"><b></b></div><p>${esc(r?.note || 'SubQ is reading every word. This usually takes a few seconds.')}</p></div>`;
    } else if (r.status === 'error') {
      body = `<h2>${esc(doc.label)}</h2><p class="error" style="margin-top:12px">${esc(r.error)}</p><button class="go retry" type="button" data-act="retry">Try again</button>`;
    } else {
      const d = r.data;
      const yes = d.results.filter((x) => x.yes >= 0.5).sort((a, b) => b.yes - a.yes);
      const no = d.results.filter((x) => x.yes < 0.5).sort((a, b) => a.yes - b.yes);
      const row = (x, isYes) => {
        const sure = Math.round((isYes ? x.yes : 1 - x.yes) * 100);
        return `<li class="${isYes ? 'yes' : 'no'}"><span class="q">${esc(x.q)}</span><span class="word">${isYes ? 'Yes' : 'No'}</span><span class="sure"><span class="meter"><b style="width:${sure}%"></b></span>${sure}% sure</span></li>`;
      };
      body = `
        <h2>${esc(d.title.split(' · ')[0])}</h2>
        <p class="meta">${esc(hostOf(d.url))} · <b>${d.pages} page${d.pages === 1 ? '' : 's'}</b> read in <b>${secs(d.seconds)} s</b>${d.cached ? ' · saved, no tokens used' : ''}</p>
        <h3>${yes.length ? `Worth knowing before you agree (${yes.length})` : 'Worth knowing before you agree'}</h3>
        ${yes.length ? `<ul>${yes.map((x) => row(x, true)).join('')}</ul>` : '<p class="none">Nothing alarming turned up.</p>'}
        <details><summary>What it didn’t find (${no.length})</summary><ul>${no.map((x) => row(x, false)).join('')}</ul></details>`;
      foot = `
        <div class="foot">
          <div class="row">
            ${d.id ? '<button class="link" type="button" data-act="report">Open the full report ↗</button>' : '<p class="small">Read from this tab, so it isn’t saved anywhere.</p>'}
          </div>
          <p class="small">A fast first read by SubQ, not legal advice.</p>
        </div>`;
    }
    const first = !wrap().querySelector('.panel'); // animate in once, not on every update
    const scroll = wrap().querySelector('.body')?.scrollTop || 0;
    wrap().innerHTML = `
      <div class="panel${first ? ' enter' : ''}" role="dialog" aria-label="Fine Print">
        <div class="head">${ICON}<strong>Fine Print</strong><button class="x" type="button" data-act="close" aria-label="Close">×</button></div>
        ${tabs}
        <div class="body">${body}</div>
        ${foot}
      </div>`;
    if (!first) wrap().querySelector('.body').scrollTop = scroll;
  }

  let jobs = 0;
  function run(doc) {
    const job = ++jobs;
    doc.job = job;
    state.results.set(doc.key, { status: 'loading' });
    if (state.open) render();
    const message = doc.page
      ? { type: 'readText', url: location.href, title: document.title, text: (document.body?.innerText || '').slice(0, 1_500_000) }
      : { type: 'read', url: doc.href, job };
    chrome.runtime.sendMessage(message).then((res) => {
      state.results.set(doc.key, res?.data ? { status: 'done', data: res.data } : { status: 'error', error: res?.error || 'Something went wrong. Try again.' });
      if (state.open && state.docs[state.active] === doc) render();
    }, () => {
      state.results.set(doc.key, { status: 'error', error: 'Fine Print was updated. Reload this page and try again.' });
      if (state.open && state.docs[state.active] === doc) render();
    });
  }

  function onClick(e) {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'open') openPanel(0);
    if (act === 'close') close();
    if (act === 'tab') { state.active = Number(t.dataset.i); render(); const d = state.docs[state.active]; if (!state.results.has(d.key)) run(d); }
    if (act === 'retry') run(state.docs[state.active]);
    if (act === 'report') {
      const d = state.results.get(state.docs[state.active].key)?.data;
      if (d?.id) chrome.runtime.sendMessage({ type: 'openReport', url: `${d.server}/#/r/${d.id}` });
    }
  }

  const docFromLink = (l) => ({ key: l.href, href: l.href, label: l.label.length > 40 ? `${l.label.slice(0, 38)}…` : l.label });

  // ---------- messages from the toolbar button and the right-click menu ----------
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (msg?.type === 'scan') {
      const agreement = findAgreement().map((l) => l.href);
      const links = termsLinks().map((l) => ({ href: l.href, label: l.label, privacy: l.privacy, agreement: agreement.includes(l.href) }));
      links.sort((a, b) => Number(b.agreement) - Number(a.agreement) || Number(a.privacy) - Number(b.privacy));
      const text = document.body?.innerText || '';
      const looksLikeTerms = text.length > 4000 && /terms|conditions|privacy|policy|agreement|eula|legal/i.test(`${document.title} ${location.pathname}`);
      reply({ links: links.slice(0, 8), looksLikeTerms, title: document.title });
      return false;
    }
    if (msg?.type === 'check') {
      state.dismissed = false;
      let doc;
      if (msg.page) doc = { key: `page:${location.href}`, page: true, label: (document.title || 'This page').slice(0, 40) };
      else {
        const known = termsLinks().find((l) => l.href === msg.url);
        doc = docFromLink(known || { href: msg.url, label: (() => { try { const u = new URL(msg.url); return `${u.hostname.replace(/^www\./, '')}${u.pathname.length > 1 ? u.pathname : ''}`; } catch { return 'This link'; } })() });
      }
      const i = state.docs.findIndex((d) => d.key === doc.key);
      if (i >= 0) openPanel(i);
      else { state.docs.unshift(doc); openPanel(0); }
      reply({ ok: true });
      return false;
    }
    if (msg?.type === 'progress') {
      const doc = state.docs.find((d) => d.job === msg.job);
      const r = doc && state.results.get(doc.key);
      if (r?.status === 'loading') { r.note = msg.text; if (state.open && state.docs[state.active] === doc) render(); }
      return false;
    }
    return false;
  });

  // ---------- watching the page ----------
  let scans = 0, timer = null;
  const started = Date.now();
  async function scan() {
    timer = null;
    scans++;
    if (state.open || state.dismissed) return;
    const { autoOffer = true, quietSites = [] } = await chrome.storage.local.get(['autoOffer', 'quietSites']).catch(() => ({}));
    if (!autoOffer || quietSites.includes(location.hostname)) return;
    const found = findAgreement();
    if (!found.length) return;
    const fresh = found.map(docFromLink).filter((d) => !state.docs.some((x) => x.key === d.key));
    if (!fresh.length) return;
    state.docs.push(...fresh);
    state.docs.sort((a, b) => Number(isPrivacy(a.label)) - Number(isPrivacy(b.label)));
    showPill();
  }
  // Sign-up forms often appear late (a modal, a second step), so keep an eye out for a few minutes.
  const observer = new MutationObserver(() => {
    if (timer || Date.now() - started > 5 * 60_000 || scans > 120) return;
    timer = setTimeout(scan, 1200);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
