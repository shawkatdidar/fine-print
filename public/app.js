const app = document.getElementById('app');
const sheet = document.getElementById('sheet');
const sheetTitle = document.getElementById('sheet-title');
const sheetBody = document.getElementById('sheet-body');
const toastEl = document.getElementById('toast');

// ---------- "Same job on a frontier model" estimate ----------
// Claude Opus 5.5 is never called. These constants describe one fair equivalent call:
// the whole document plus every question, answered in one go. Speeds are deliberately generous to Opus.
const RACE = {
  subqPerMillion: 0.05,          // SubQ Snap, US dollars per million input tokens (output is free)
  opus: {
    name: 'Claude Opus 5.5',
    inputPerMillion: 4.0,        // official price, US dollars per million input tokens
    outputPerMillion: 20.0,      // official price, US dollars per million output tokens
    thinkingTokens: 1500,        // reasoning before answering
    tokensPerAnswer: 60,         // a short written answer per question
    readTokensPerSecond: 10000,  // how fast it takes in the document (generous)
    writeTokensPerSecond: 80,    // how fast it writes (generous)
  },
};
function estimateOpus(inputTokens, answers) {
  const o = RACE.opus;
  const out = o.thinkingTokens + o.tokensPerAnswer * answers;
  return {
    out,
    seconds: inputTokens / o.readTokensPerSecond + out / o.writeTokensPerSecond,
    cost: (inputTokens * o.inputPerMillion + out * o.outputPerMillion) / 1e6,
  };
}

const NOUN = { supply: 'supply contract', lease: 'shop lease', terms: 'terms of service', own: 'document' };
const KIND = { money: 'Takes your money', rights: 'Takes away a right', data: 'Uses your data', lockin: 'Locks you in', absurd: 'Absurd', harmless: 'Harmless' };
const OWN_EXAMPLES = [
  { label: 'A personal guarantee', text: 'The individual accepting this agreement personally and unconditionally guarantees the payment of all amounts owed under it.' },
  { label: 'A fee that starts later', text: 'Beginning twelve (12) months after the effective date, an administration fee of fifty dollars ($50) per month shall be payable, which fee is non-refundable.' },
  { label: 'No class actions', text: 'The accepting party waives any right to participate in any class, collective or representative proceeding arising out of this agreement.' },
  { label: 'Terms that can change', text: 'This agreement may be amended at any time by the other party, and continued performance after any amendment constitutes acceptance of it, whether or not notice was given.' },
];
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const MAMMOTH = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let presets = null;
let maxTokens = 300000;
let renderToken = 0;   // guards against late responses from a screen the visitor already left
let ownDraft = null;   // the visitor's document before reading: { title, pages?, text? }. Memory only.
let ownDoc = null;     // after reading. Memory only; a reload forgets it.

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (s) => (s < 10 ? s.toFixed(1) : Math.round(s).toString());
const cents = (dollars) => { const c = dollars * 100; return c < 0.01 ? '<0.01¢' : c < 0.1 ? `${c.toFixed(2)}¢` : c < 100 ? `${c < 10 ? c.toFixed(1) : Math.round(c)}¢` : `$${dollars.toFixed(2)}`; };
const thousands = (n) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
const times = (x) => (x >= 10 ? Math.round(x) : x.toFixed(1)).toLocaleString('en-US');
const b64e = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64d = (s) => { try { const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/')); return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); } catch { return ''; } };
const isHeading = (t) => t.length < 90 && t === t.toUpperCase() && /[A-Z]/.test(t);
const wordCount = (s) => (s.match(/\S+/g) || []).length;
const docHash = (p) => (p.own ? '#/own/read' : `#/doc/${p.id}`);
const hideHash = (p) => (p.own ? '#/own/hide' : `#/hide/${p.id}`);

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => toastEl.classList.remove('on'), 2400);
}

async function api(path, body) {
  let res;
  try {
    res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  } catch {
    throw new Error('The demo server isn’t responding. Make sure it’s still running, then try again.');
  }
  const data = await res.json().catch(() => ({}));
  if (data.gift) updateGift(data.gift);
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

function updateGift(g) {
  const box = document.getElementById('gift');
  const left = g.remaining / 1e6, total = g.budget / 1e6;
  document.getElementById('gift-text').innerHTML = g.paused
    ? 'Gifted tokens used up. Live reading is paused.'
    : `<b>${left.toFixed(1)}M</b> of ${Math.round(total)}M gifted tokens left`;
  document.getElementById('gift-fill').style.width = `${Math.max(0, Math.min(100, (g.remaining / g.budget) * 100))}%`;
  box.title = `${Math.round(g.remaining).toLocaleString('en-US')} of ${Math.round(g.budget).toLocaleString('en-US')} gifted SubQ tokens remain. Saved results use none.`;
  box.hidden = false;
}

async function loadPresets() {
  if (!presets) {
    const d = await api('/api/presets');
    presets = d.presets; maxTokens = d.maxTokens || maxTokens;
  }
  return presets;
}
const presetById = (id) => presets.find((p) => p.id === id);

function render(html, { focus = true } = {}) {
  app.innerHTML = html;
  window.scrollTo({ top: 0 });
  if (focus) app.focus({ preventScroll: true });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Couldn’t load the file reader. Check your connection, or paste the text instead.'));
    document.head.appendChild(s);
  });
}

// ---------- page map + sweep ----------
function minimap(n, { label = 'Map of every page' } = {}) {
  let cells = '';
  for (let i = 1; i <= n; i++) cells += `<div class="pg" data-page="${i}"></div>`;
  return `<div class="minimap" role="img" aria-label="${esc(label)}">${cells}</div>`;
}

// Sweeps a reading head across the page map with a live page and token counter.
// The counter is a visualization while SubQ works (it returns all answers at once);
// the final numbers shown afterwards are the measured ones.
function sweep(map, counter, { pages, tokens, duration, questions }) {
  const cells = [...map.querySelectorAll('.pg')];
  const n = cells.length;
  const tail = Math.max(6, Math.round(n / 14));
  let raf, start = performance.now(), done = false, lastHead = 0;
  map.classList.add('sweeping');
  const frame = (now) => {
    if (done) return;
    const t = Math.min(1, (now - start) / duration);
    const head = Math.max(1, Math.ceil(t * n));
    for (let i = lastHead - tail; i <= head; i++) {
      const c = cells[i - 1]; if (!c) continue;
      const d = head - i;
      if (d < 0) continue;
      if (d <= tail) c.style.setProperty('--h', ((1 - d / (tail + 1)) * 0.95).toFixed(2));
      else c.style.removeProperty('--h');
      c.classList.add('read');
    }
    lastHead = head;
    if (counter) {
      counter.innerHTML = t < 1
        ? `Reading page <b>${head}</b> of ${pages} <span class="tok">${Math.round((tokens * head) / n).toLocaleString('en-US')} tokens</span>`
        : `All ${pages} pages read. Answering ${questions} question${questions === 1 ? '' : 's'} at once…`;
    }
    if (t >= 1) {
      cells.slice(-tail - 1).forEach((c) => c.style.removeProperty('--h'));
      map.classList.add('thinking');
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    stop() {
      done = true; cancelAnimationFrame(raf);
      map.classList.remove('sweeping', 'thinking');
      cells.forEach((c) => { c.style.removeProperty('--h'); c.classList.remove('read'); });
    },
  };
}

// ---------- the race ----------
// Two columns tick on one shared clock. SubQ replays its measured run; Opus keeps going on the
// estimate above (fast-forwarded once SubQ is done, so nobody waits a minute).
function opusProgress(v, inputTokens, est) {
  const o = RACE.opus;
  const readT = inputTokens / o.readTokensPerSecond;
  const inTok = Math.min(inputTokens, v * o.readTokensPerSecond);
  const outTok = Math.max(0, Math.min(est.out, (v - readT) * o.writeTokensPerSecond));
  return { tokens: inTok + outTok, cost: (inTok * o.inputPerMillion + outTok * o.outputPerMillion) / 1e6 };
}

function raceBlock(run, answers) {
  const opus = estimateOpus(run.tokens, answers);
  const faster = opus.seconds / run.seconds, cheaper = opus.cost / run.cost;
  const col = (cls, name, est) => `
    <div class="col ${cls}">
      <div class="col-head"><span class="who">${name}</span><span class="badge" data-badge></span></div>
      <p class="clock"><span data-t>0.0</span><small> s${est ? '<i class="est">est.</i>' : ''}</small></p>
      <dl class="figs">
        <div><dt>Tokens</dt><dd data-tok>0</dd></div>
        <div><dt>Cost</dt><dd><span data-cost>0¢</span>${est ? '<i class="est">est.</i>' : ''}</dd></div>
      </dl>
      <div class="track" aria-hidden="true"><b></b></div>
    </div>`;
  return `
    <section class="race" data-subq="${run.seconds}" data-tokens="${run.tokens}" data-cost="${run.cost}" data-answers="${answers}"
      aria-label="SubQ Snap: ${secs(run.seconds)} seconds, ${cents(run.cost)}. ${esc(RACE.opus.name)} estimate: ${secs(opus.seconds)} seconds, ${cents(opus.cost)}.">
      <h2>Same job, two models</h2>
      <div class="cols">${col('subq', 'SubQ Snap', false)}${col('opus', esc(RACE.opus.name), true)}</div>
      <p class="multiples"><span>~${times(faster)}× faster</span><span aria-hidden="true">·</span><span>~${times(cheaper)}× cheaper</span></p>
    </section>`;
}

function runRace(section) {
  const subqT = Number(section.dataset.subq), tokens = Number(section.dataset.tokens), subqC = Number(section.dataset.cost);
  const est = estimateOpus(tokens, Number(section.dataset.answers));
  const [sCol, oCol] = section.querySelectorAll('.col');
  const q = (c, k) => c.querySelector(k);
  const paint = (c, t, tok, cost, pct) => {
    q(c, '[data-t]').textContent = secs(t);
    q(c, '[data-tok]').textContent = Math.round(tok).toLocaleString('en-US');
    q(c, '[data-cost]').textContent = cents(cost);
    q(c, '.track b').style.width = `${Math.min(100, pct * 100)}%`;
  };
  const doneSubq = () => { paint(sCol, subqT, tokens, subqC, 1); sCol.classList.add('done'); q(sCol, '[data-badge]').textContent = 'Done'; };
  const doneOpus = () => { paint(oCol, est.seconds, tokens + est.out, est.cost, 1); oCol.classList.add('done'); q(oCol, '[data-badge]').textContent = 'Done'; section.classList.add('finished'); };
  if (reduceMotion) { doneSubq(); doneOpus(); return; }
  const live = Math.min(subqT, 6);   // replay SubQ's real time (capped for very long runs)
  const ff = 2600;                    // then fast-forward Opus to its estimated finish
  const t0 = performance.now();
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const frame = (now) => {
    const real = (now - t0) / 1000;
    let v;
    if (real < live) v = (real / live) * subqT;
    else {
      const k = Math.min(1, ((real - live) * 1000) / ff);
      v = subqT + (est.seconds - subqT) * ease(k);
      if (k < 1) q(oCol, '[data-badge]').textContent = 'fast-forward';
    }
    if (v < subqT) paint(sCol, v, tokens * (v / subqT), subqC * (v / subqT), v / subqT);
    else if (!sCol.classList.contains('done')) doneSubq();
    if (v < est.seconds) { const o = opusProgress(v, tokens, est); paint(oCol, v, o.tokens, o.cost, v / est.seconds); requestAnimationFrame(frame); }
    else doneOpus();
  };
  requestAnimationFrame(frame);
}

function startRaceWhenVisible(section) {
  if (!section) return;
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { io.disconnect(); runRace(section); }
  }, { threshold: 0.5 });
  io.observe(section);
}

// ---------- screens ----------
function home() {
  document.title = 'Fine Print';
  render(`
    <section class="screen wide hero">
      <h1>Nobody reads<br>the fine print.</h1>
      <span class="fineprint">SubQ reads every word.</span>
      <p class="lede">Pick an agreement. SubQ reads the entire thing in about a second and tells you what’s buried in it.</p>
      <div class="shelf">
        ${presets.map((p) => `
          <button class="doc-choice" type="button" data-go="#/doc/${p.id}">
            <span class="stack" aria-hidden="true"><span></span><span></span>
              <span class="cover"><b>${esc(p.title)}</b>${'<i></i>'.repeat(9)}</span>
            </span>
            <span class="doc-meta"><strong>${esc(p.short)}</strong><span>${p.pages} pages</span></span>
          </button>`).join('')}
        <button class="doc-choice own-choice" type="button" data-go="#/own">
          <span class="stack" aria-hidden="true"><span class="cover blank"><em>+</em></span></span>
          <span class="doc-meta"><strong>Your own</strong><span>A file, a link or pasted text</span></span>
        </button>
      </div>
      <a class="anywhere-band" href="#/anywhere">
        <strong>About to tap “I agree” somewhere?</strong>
        <span>Send the terms here from your phone’s Share menu or a browser extension, and check them before you sign up. <b>Set it up ›</b></span>
      </a>
    </section>`, { focus: false });
}

function docScreen(p, { auto = false } = {}) {
  document.title = `${p.title} · Fine Print`;
  render(`
    <section class="screen">
      <a class="back" href="${p.own ? '#/own' : '#/'}">‹ ${p.own ? 'Choose another document' : 'All agreements'}</a>
      <div class="title-block">
        <h1>${esc(p.title)}</h1>
        <p>${p.link && !p.words ? `Fetching the page and reading every word…` : `${esc(p.blurb)} ${p.pages} pages, ${p.words.toLocaleString('en-US')} words.${p.own ? '' : ' Fictional.'}`}</p>
      </div>
      <div id="map">${minimap(p.pages)}</div>
      <p class="counter" id="counter" aria-live="off"></p>
      <div id="stage">
        ${p.own ? '' : `
        <div class="actions">
          <button class="primary" id="read" type="button">Read all ${p.pages} pages</button>
          <button class="quiet" type="button" data-go="#/hide/${p.id}">or hide a clause in it</button>
        </div>`}
        <p class="status" id="status" aria-live="polite"></p>
      </div>
    </section>`);
  document.getElementById('read')?.addEventListener('click', () => runRead(p, { replay: true }));
  if (auto) runRead(p, { replay: false });
}

async function runRead(p, { replay, fresh = false }) {
  const token = ++renderToken;
  const btn = document.getElementById('read');
  const status = document.getElementById('status');
  let map = document.querySelector('.minimap');
  if (btn) btn.disabled = true;
  status.textContent = '';
  const estTokens = p.own ? Math.round(p.chars / 4) : Math.round(p.words * 1.8);
  const questions = (p.own ? 14 : p.questions.length) * 2;
  const animate = replay && !reduceMotion;
  const sw = animate || p.own || fresh ? sweep(map, document.getElementById('counter'), { pages: p.pages, tokens: estTokens, duration: 1600, questions }) : null;
  const started = performance.now();
  let data;
  try {
    if (p.link) data = await api('/api/link/read', { url: p.link });
    else data = p.own ? await api('/api/own/read', ownDraft.pages ? { pages: ownDraft.pages } : { text: ownDraft.text }) : await api('/api/read', { id: p.id, fresh });
  } catch (error) {
    if (token !== renderToken) return;
    sw?.stop();
    document.getElementById('counter').textContent = '';
    if (btn) btn.disabled = false;
    status.innerHTML = `<span class="error">${esc(error.message)}</span>`;
    if (p.link) {
      document.querySelector('.title-block p').textContent = 'This page couldn’t be read from its link.';
      status.insertAdjacentHTML('afterend', `<div class="actions"><button class="secondary" type="button" data-go="#/own">Paste the text instead</button></div>`);
    }
    return;
  }
  // A saved read replays at the speed it actually ran.
  if (data.cached && animate) await sleep(Math.max(0, data.seconds * 1000 - (performance.now() - started)));
  if (token !== renderToken) return;
  sw?.stop();
  if (p.link) {
    showLinkReport(p, data, { animate: true });
  } else if (p.own) {
    ownDoc = { ...p, pages: data.pages, pageTexts: data.pageTexts, report: data };
    ownDraft = null;
    history.replaceState(null, '', '#/own/read');
    if (map.children.length !== data.pages) {
      document.getElementById('map').innerHTML = minimap(data.pages);
      map = document.querySelector('.minimap');
      document.querySelector('.title-block p').textContent = `${p.blurb} ${data.pages} pages, ${p.words.toLocaleString('en-US')} words.`;
    }
    showReport(ownDoc, data, { animate: true });
  } else {
    history.replaceState(null, '', `#/doc/${p.id}/read`);
    showReport(p, data, { animate: Boolean(sw) });
  }
}

function showReport(p, data, { animate }) {
  const map = document.querySelector('.minimap');
  const counter = document.getElementById('counter');
  counter.innerHTML = `<span class="stamp">All ${data.pages} pages read in <b>${secs(data.seconds)} s</b></span>`;
  const yes = data.results.filter((r) => r.yes >= 0.5).sort((a, b) => b.yes - a.yes);
  const no = data.results.filter((r) => r.yes < 0.5).sort((a, b) => a.yes - b.yes);
  const flagged = new Map();
  yes.forEach((r) => { if (r.page) flagged.set(r.page, (flagged.get(r.page) || []).concat(r.q)); });
  [...flagged.keys()].sort((a, b) => a - b).forEach((page, k) => {
    const cell = map.querySelector(`[data-page="${page}"]`);
    if (!cell) return;
    const b = document.createElement('button');
    b.className = `pg flag${animate && !reduceMotion ? ' lift' : ''}`; b.type = 'button'; b.dataset.page = page;
    b.style.animationDelay = `${k * 140}ms`;
    b.setAttribute('aria-label', `Page ${page}: ${flagged.get(page).join(' ')}`);
    b.title = `Page ${page}`;
    b.addEventListener('click', () => openPage(p, page));
    cell.replaceWith(b);
  });
  map.setAttribute('role', 'group');
  map.insertAdjacentHTML('afterend', `<div class="legend fade-in"><span><i></i>Pages SubQ flagged. Tap one to read it.</span></div>`);

  const row = (r, isYes) => {
    const sure = isYes ? r.yes : 1 - r.yes;
    const inner = `
      <span class="q">${esc(r.q)}</span>
      <span class="a">
        <span class="word">${isYes ? 'Yes' : 'No'}</span>
        <span class="sure"><span class="meter" aria-hidden="true"><b style="width:${Math.round(sure * 100)}%"></b></span>${Math.round(sure * 100)}% sure</span>
      </span>
      ${isYes && r.page ? `<span class="where">Page ${r.page}</span>` : ''}`;
    return `<li class="answer ${isYes ? 'yes' : 'no'}">${isYes && r.page ? `<button type="button" data-page="${r.page}">${inner}</button>` : `<div>${inner}</div>`}</li>`;
  };
  const when = new Date(data.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const answers = data.results.length * 2;
  document.getElementById('stage').innerHTML = `
    <div class="verdict${animate ? ' stamped' : ''}">
      <p class="stat"><b>${data.pages} pages</b> <span>·</span> <b>read in ${secs(data.seconds)} s</b> <span>·</span> <b>cost ${cents(data.cost)}</b></p>
      <p>SubQ answered ${data.results.length} questions, and found the page for each, in one pass over ${thousands(data.tokens)} tokens. ${yes.length} came back yes.</p>
      ${data.cached ? `<p class="replay">Saved from a live read on ${esc(when)}, so ${p.link ? 'opening it again' : 'replaying it'} uses no tokens.${p.link ? '' : ' <button class="quiet" type="button" id="fresh">Read it live again</button>'}</p>` : ''}
    </div>
    ${raceBlock(data, answers)}
    <h2 class="group-title">Worth knowing before you sign</h2>
    <p class="group-sub">SubQ said yes to these. Tap one to see the page it pointed to.</p>
    <ul class="answers">${yes.map((r) => row(r, true)).join('') || '<li class="answer"><div><span class="q">Nothing alarming turned up.</span></div></li>'}</ul>
    <h2 class="group-title">${p.own ? 'What SubQ didn’t find' : 'What looks fair'}</h2>
    <p class="group-sub">SubQ said no to these.</p>
    <ul class="answers">${no.map((r) => row(r, false)).join('')}</ul>
    ${p.own ? '<p class="privacy">SubQ’s answers are a fast first read, not legal advice. Check anything important with a lawyer.</p>' : ''}
    <div class="after">
      <h2>Now try to hide something from it.</h2>
      <p>Write a sneaky clause. We’ll slip it onto a random page and see whether SubQ can find it.</p>
      <div class="actions"><button class="primary" type="button" data-go="${hideHash(p)}">Hide a clause</button></div>
    </div>`;
  document.querySelectorAll('.answer button[data-page]').forEach((b) => b.addEventListener('click', () => openPage(p, Number(b.dataset.page))));
  document.getElementById('fresh')?.addEventListener('click', () => { docScreen(p); runRead(p, { replay: false, fresh: true }); });
  startRaceWhenVisible(document.querySelector('.race'));
}

// ---------- a public link: /?url=… (phone share menu, extension, shortcut) or #/r/<saved id> ----------
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'that page'; } };

function linkDoc(url) {
  return { id: 'own', own: true, link: url, title: hostOf(url), blurb: '', pages: 24, words: 0, chars: 80000, examples: OWN_EXAMPLES };
}

function showLinkReport(p, data, { animate }) {
  const host = hostOf(data.url);
  ownDoc = { ...p, title: data.title, blurb: `From ${host}.`, pages: data.pages, words: data.words, pageTexts: data.pageTexts, report: data };
  ownDraft = null;
  if (data.id) history.replaceState(null, '', `#/r/${data.id}`);
  else history.replaceState(null, '', '#/own/read');
  document.title = `${data.title} · Fine Print`;
  document.querySelector('.title-block h1').textContent = data.title.split(' · ')[0]; // the site name is in the line below
  document.querySelector('.title-block p').innerHTML = `From <a href="${esc(data.url)}" rel="noopener nofollow" target="_blank">${esc(host)}</a>. ${data.pages} pages, ${data.words.toLocaleString('en-US')} words.`;
  if (document.querySelector('.minimap').children.length !== data.pages) document.getElementById('map').innerHTML = minimap(data.pages);
  showReport(ownDoc, data, { animate });
  if (data.id) {
    document.querySelector('.verdict').insertAdjacentHTML('beforeend', `<p class="replay"><button class="quiet" type="button" id="copy-report">Copy a link to this report</button></p>`);
    document.getElementById('copy-report').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); toast('Link copied'); } catch { toast(location.href); }
    });
  }
}

function checkLink(url) {
  const p = linkDoc(url);
  ownDoc = null;
  docScreen(p, { auto: true });
}

async function savedResult(id) {
  const token = ++renderToken;
  render('<section class="screen"><p class="status">Opening the report…</p></section>');
  try {
    const data = await api(`/api/link/result?id=${encodeURIComponent(id)}`);
    if (token !== renderToken) return;
    const p = linkDoc(data.url);
    docScreen({ ...p, title: data.title, words: data.words, pages: data.pages, blurb: `From ${hostOf(data.url)}.` });
    showLinkReport(p, data, { animate: false });
  } catch (error) {
    if (token !== renderToken) return;
    render(`<section class="screen"><a class="back" href="#/own">‹ Read your own agreement</a><p class="error">${esc(error.message)}</p></section>`);
  }
}

// Anything shared to Fine Print arrives as ?url=… or ?text=… (Android puts links in "text").
function sharedLink() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return null;
  const raw = [q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' ');
  history.replaceState(null, '', `/${location.hash || ''}`);
  const m = raw.match(/https?:\/\/[^\s<>"']+/i) || raw.match(/\b[a-z0-9-]+(\.[a-z0-9-]+)+\/[^\s<>"']*/i);
  return m ? m[0].replace(/[).,;]+$/, '').replace(/^(?!https?:)/i, 'https://') : null;
}

async function openPage(p, n) {
  sheetTitle.textContent = `Page ${n} of ${p.pages}`;
  sheetBody.innerHTML = '<p class="sheet-note">Loading the page…</p>';
  if (!sheet.open) sheet.showModal();
  try {
    const data = p.own ? { paragraphs: p.pageTexts[n - 1].split('\n\n'), planted: [] } : await api(`/api/page?id=${encodeURIComponent(p.id)}&n=${n}`);
    const note = data.planted.length
      ? 'SubQ pointed to this page. We planted a clause here when we wrote the document, and it’s highlighted below.'
      : 'SubQ pointed to this page.';
    sheetBody.innerHTML = `<p class="sheet-note">${note}</p><div class="paper">${data.paragraphs.map((t, i) =>
      isHeading(t) ? `<p class="heading">${esc(t)}</p>` : data.planted.includes(i) ? `<p class="planted"><mark>${esc(t)}</mark></p>` : `<p>${esc(t)}</p>`).join('')}</div>`;
    sheetBody.querySelector('.planted')?.scrollIntoView({ block: 'center' });
  } catch (error) {
    sheetBody.innerHTML = `<p class="error">${esc(error.message)}</p>`;
  }
}

// ---------- your own agreement ----------
function ownScreen() {
  document.title = 'Your own agreement · Fine Print';
  render(`
    <section class="screen">
      <a class="back" href="#/">‹ All agreements</a>
      <div class="title-block">
        <h1>Read your own agreement.</h1>
        <p>A lease, a contract, a terms of service. SubQ reads every page and answers the same plain questions.</p>
      </div>
      <label class="drop" id="drop">
        <input type="file" id="file" accept=".pdf,.docx,.txt,.md,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
        <span class="drop-art" aria-hidden="true"><span></span><span></span></span>
        <strong id="drop-title">Drop a file here, or choose one</strong>
        <span id="drop-sub">PDF, Word (.docx) or plain text. Up to about ${Math.round(maxTokens / 1000)}K tokens, roughly ${Math.round(maxTokens / 520).toLocaleString('en-US')} pages.</span>
      </label>
      <div class="or" aria-hidden="true"><span>or paste a link to the terms</span></div>
      <form class="link-row" id="link-form" novalidate>
        <label class="visually-hidden" for="link">Link to the terms or policy page</label>
        <input id="link" class="link-input" type="text" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://example.com/terms">
        <button class="secondary" id="fetch" type="submit">Get the text</button>
      </form>
      <p class="link-note" id="link-note">Works for most terms of service and privacy policy pages. You can also <a href="#/anywhere">send pages here straight from your phone or browser</a>.</p>
      <div class="or" aria-hidden="true"><span>or paste the text</span></div>
      <label class="visually-hidden" for="paste">Agreement text</label>
      <textarea id="paste" class="paste" placeholder="Paste the full agreement here…"></textarea>
      <div class="actions"><button class="primary" id="go" type="button" disabled>Read it</button></div>
      <p class="status" id="status" aria-live="polite"></p>
      <p class="privacy">Your text is sent to SubQ to be read. This site doesn’t save it. Not legal advice.</p>
    </section>`);
  const drop = document.getElementById('drop'), input = document.getElementById('file');
  const paste = document.getElementById('paste'), go = document.getElementById('go'), status = document.getElementById('status');
  const dropTitle = document.getElementById('drop-title'), dropSub = document.getElementById('drop-sub');
  const linkForm = document.getElementById('link-form'), link = document.getElementById('link');
  const fetchBtn = document.getElementById('fetch'), linkNote = document.getElementById('link-note');
  let linkTitle = '';
  // With an empty box, the button pastes from the clipboard (the phone flow: copy link, open Fine Print, tap).
  const canPaste = Boolean(navigator.clipboard?.readText);
  const linkLabel = () => (canPaste && !link.value.trim() ? 'Paste link' : 'Get the text');
  fetchBtn.textContent = linkLabel();
  link.addEventListener('input', () => { fetchBtn.textContent = linkLabel(); });

  const describe = () => {
    const d = ownDraft;
    if (!d) { go.disabled = true; go.textContent = 'Read it'; status.textContent = ''; return; }
    const tokens = Math.round(d.chars / 4);
    const pages = d.pages ? d.pages.length : Math.max(1, Math.round(d.words / 400));
    if (d.chars < 300) { go.disabled = true; go.textContent = 'Read it'; status.textContent = 'That’s too short to be an agreement. Paste the whole document.'; return; }
    if (tokens > maxTokens) {
      go.disabled = true; go.textContent = 'Read it';
      status.innerHTML = `<span class="error">That document is about ${thousands(tokens)} tokens. The limit here is ${thousands(maxTokens)}, to keep each read quick and the gifted tokens going further. Try just the main agreement, without the exhibits.</span>`;
      return;
    }
    go.disabled = false;
    go.textContent = `Read ${d.pages ? 'all ' : 'about '}${pages} page${pages === 1 ? '' : 's'}`;
    status.textContent = `About ${thousands(tokens)} tokens. One read costs about ${cents((tokens * 1.15 * RACE.subqPerMillion) / 1e6)}.`;
  };

  const setText = (title, text, pages) => {
    const all = pages ? pages.join('\n\n') : text;
    ownDraft = { title, text: pages ? null : text, pages: pages || null, chars: all.length, words: wordCount(all) };
    describe();
  };

  async function readFile(file) {
    if (!file) return;
    paste.value = ''; linkTitle = ''; link.value = '';
    dropTitle.textContent = file.name;
    dropSub.textContent = 'Reading the file…';
    drop.classList.add('has-file');
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('That file is larger than 30 MB. Try a smaller one, or paste the text.');
      const name = file.name.toLowerCase();
      const title = file.name.replace(/\.[a-z0-9]+$/i, '');
      if (name.endsWith('.pdf') || file.type === 'application/pdf') {
        await loadScript(PDFJS);
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
        const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        const pages = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const content = await (await pdf.getPage(i)).getTextContent();
          // Rebuild lines from each text piece's position, so words split for kerning stay whole.
          let t = '', last = null;
          for (const it of content.items) {
            if (typeof it.str !== 'string') continue;
            const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
            if (last) {
              const dy = Math.abs(y - last.y);
              if (dy > h * 1.6) t += '\n\n';
              else if (dy > h * 0.5) t += '\n';
              else if (x - last.end > h * 0.12 && !/\s$/.test(t) && !/^\s/.test(it.str)) t += ' ';
            }
            t += it.str;
            last = { y, end: x + (it.width || 0) };
          }
          t = t.replace(/(\w)-\n(?=[a-z])/g, '$1').replace(/([^\n])\n(?!\n)/g, '$1 ');
          pages.push(t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
          if (i % 10 === 0) dropSub.textContent = `Reading page ${i} of ${pdf.numPages}…`;
        }
        if (pages.join('').trim().length < 300) throw new Error('This PDF doesn’t contain readable text. It may be a scan. Try a text-based PDF, or paste the text.');
        setText(title, null, pages);
        dropSub.textContent = `PDF, ${pages.length} pages. Choose a different file anytime.`;
      } else if (name.endsWith('.docx')) {
        await loadScript(MAMMOTH);
        const r = await window.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        setText(title, r.value);
        dropSub.textContent = 'Word document. Choose a different file anytime.';
      } else if (name.endsWith('.doc')) {
        throw new Error('Older .doc files aren’t supported. Save it as .docx or PDF, or paste the text.');
      } else {
        setText(title, await file.text());
        dropSub.textContent = 'Text file. Choose a different file anytime.';
      }
    } catch (error) {
      ownDraft = null; describe();
      drop.classList.remove('has-file');
      dropTitle.textContent = 'Drop a file here, or choose one';
      dropSub.textContent = error.message || 'That file couldn’t be read. Try another, or paste the text.';
    }
  }

  input.addEventListener('change', () => readFile(input.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => readFile(e.dataTransfer.files[0]));
  paste.addEventListener('input', () => {
    if (paste.value.trim()) {
      drop.classList.remove('has-file'); input.value = '';
      dropTitle.textContent = 'Drop a file here, or choose one';
      dropSub.textContent = 'PDF, Word (.docx) or plain text.';
      setText(linkTitle || 'Your agreement', paste.value);
    } else { linkTitle = ''; ownDraft = null; describe(); }
  });
  linkForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!link.value.trim() && canPaste) {
      try { link.value = (await navigator.clipboard.readText()).trim().slice(0, 2000); } catch {}
      if (!link.value) { linkNote.textContent = 'Nothing to paste. Copy the link first, or type it in.'; link.focus(); return; }
    }
    let url = link.value.trim();
    if (!url) { link.focus(); return; }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    fetchBtn.disabled = true; fetchBtn.textContent = 'Getting it…';
    linkNote.textContent = 'Fetching the page…';
    try {
      const page = await api('/api/own/link', { url });
      drop.classList.remove('has-file'); input.value = '';
      dropTitle.textContent = 'Drop a file here, or choose one';
      dropSub.textContent = 'PDF, Word (.docx) or plain text.';
      linkTitle = page.title;
      paste.value = page.text;
      setText(page.title, page.text);
      linkNote.innerHTML = `Got <b>${esc(page.title)}</b>. The text is below, so you can trim anything that isn’t part of the terms.`;
    } catch (error) {
      linkNote.innerHTML = `<span class="link-error">${esc(error.message)}</span>`;
    } finally {
      fetchBtn.disabled = false; fetchBtn.textContent = linkLabel();
    }
  });
  go.addEventListener('click', () => {
    if (!ownDraft) return;
    const d = ownDraft;
    const p = {
      id: 'own', own: true, title: d.title || 'Your agreement', blurb: 'Your document.',
      pages: d.pages ? Math.min(d.pages.length, 250) : Math.max(1, Math.round(d.words / 400)), words: d.words, chars: d.chars,
      examples: OWN_EXAMPLES,
    };
    ownDoc = null;
    history.pushState(null, '', '#/own/read');
    docScreen(p, { auto: true });
  });
}

// ---------- hide a clause ----------
function hideScreen(p) {
  document.title = `Hide a clause · Fine Print`;
  let draft = '';
  try { draft = sessionStorage.getItem(`draft-${p.id}`) || ''; } catch {}
  render(`
    <section class="screen">
      <a class="back" href="${docHash(p)}">‹ ${esc(p.title)}</a>
      <div class="title-block">
        <h1>Hide a clause.</h1>
        <p>Write something sneaky. We’ll slip it onto a random page of ${p.own ? 'your' : 'a clean copy of this'} ${p.pages}-page ${NOUN[p.id]}. SubQ isn’t told what you wrote. It has to find it.</p>
      </div>
      <form class="composer" id="compose">
        <label class="visually-hidden" for="clause">Your clause</label>
        <textarea id="clause" maxlength="280" placeholder="${esc(p.examples[0].text)}">${esc(draft)}</textarea>
        <div class="count" id="count">0 / 280</div>
        <div class="examples"><span>Or try one:</span>
          ${p.examples.map((e, i) => `<button class="chip" type="button" data-ex="${i}" aria-pressed="false">${esc(e.label)}</button>`).join('')}
        </div>
        <div class="actions"><button class="primary" id="hide" type="submit" disabled>Hide it</button></div>
        <p class="status" id="status" aria-live="polite"></p>
      </form>
    </section>`);
  const ta = document.getElementById('clause');
  const btn = document.getElementById('hide');
  const count = document.getElementById('count');
  const sync = () => {
    count.textContent = `${ta.value.length} / 280`;
    btn.disabled = ta.value.trim().length < 12;
    document.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(p.examples[c.dataset.ex].text === ta.value)));
    try { sessionStorage.setItem(`draft-${p.id}`, ta.value); } catch {}
  };
  ta.addEventListener('input', sync);
  document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => { ta.value = p.examples[c.dataset.ex].text; sync(); ta.focus(); }));
  document.getElementById('compose').addEventListener('submit', (e) => {
    e.preventDefault();
    if (btn.disabled) return;
    hunt(p, ta.value.trim(), null, { replay: true });
  });
  sync();
}

async function hunt(p, clause, page, { replay }) {
  const token = ++renderToken;
  document.title = `SubQ is looking · Fine Print`;
  render(`
    <section class="screen">
      <a class="back" href="${docHash(p)}">‹ ${esc(p.title)}</a>
      <div class="reveal pending" id="reveal" aria-live="polite">
        <h1>Hidden on one of ${p.pages} pages.</h1>
        <p class="sub">SubQ is reading the whole ${NOUN[p.id]} to find it.</p>
      </div>
      <div id="map">${minimap(p.pages, { label: `Map of all ${p.pages} pages` })}</div>
      <p class="counter" id="counter" aria-live="off"></p>
      <div id="stage"></div>
    </section>`);
  const map = document.querySelector('.minimap');
  const estTokens = p.own ? Math.round(p.chars / 4) : Math.round(p.words * 1.5);
  const sw = reduceMotion ? null : sweep(map, document.getElementById('counter'), { pages: p.pages, tokens: estTokens, duration: 1400, questions: 3 });
  const started = performance.now();
  let data;
  try {
    data = p.own ? await api('/api/own/hide', { pages: p.pageTexts, clause }) : await api('/api/hide', { id: p.id, clause, page });
  } catch (error) {
    if (token !== renderToken) return;
    sw?.stop();
    document.getElementById('counter').textContent = '';
    document.getElementById('reveal').innerHTML = `<h1>SubQ couldn’t look this time.</h1><p class="sub">${esc(error.message)}</p>`;
    document.getElementById('stage').innerHTML = `<div class="actions"><button class="primary" type="button" id="retry">Try again</button></div>`;
    document.getElementById('retry').addEventListener('click', () => hunt(p, clause, page, { replay }));
    return;
  }
  if (data.cached && replay && !reduceMotion) await sleep(Math.max(0, data.seconds * 1000 - (performance.now() - started)));
  else if (!reduceMotion) await sleep(Math.max(0, 900 - (performance.now() - started)));
  if (token !== renderToken) return;
  sw?.stop();
  history.replaceState(null, '', p.own ? '#/own/found' : `#/found/${p.id}/${data.page}/${b64e(data.clause)}`);
  showFound(p, data);
}

function foundCopy(p, d) {
  const off = Math.abs((d.guess || 0) - d.page);
  if (d.found) return {
    title: `Found on page ${d.page} <span class="soft">of ${d.pages}</span><br>in ${secs(d.seconds)} seconds.`,
    sub: d.confidence >= 0.4
      ? 'SubQ read every page and pointed straight at your clause, without being told what it said.'
      : `SubQ read every page and its top pick was right, though it was only ${Math.round(d.confidence * 100)}% sure. It wasn’t told what you wrote.`,
    share: `I hid a clause on page ${d.page} of a ${d.pages}-page ${NOUN[p.id]}. SubQ found it in ${secs(d.seconds)} seconds.`,
  };
  if (off === 1) return {
    title: `One page off.`,
    sub: `Your clause was on page ${d.page}. SubQ pointed at page ${d.guess}, right next door, after ${secs(d.seconds)} seconds.`,
    share: `I hid a clause on page ${d.page} of a ${d.pages}-page ${NOUN[p.id]}. SubQ landed one page away in ${secs(d.seconds)} seconds.`,
  };
  return {
    title: `You hid it well.`,
    sub: `Your clause was on page ${d.page}. SubQ’s best guess was page ${d.guess}, and it was only ${Math.round(d.confidence * 100)}% sure. Clauses that sound like ordinary boilerplate are the hardest to spot.`,
    share: `I hid a clause on page ${d.page} of a ${d.pages}-page ${NOUN[p.id]}, and SubQ didn’t find it.`,
  };
}

function showFound(p, d) {
  document.title = d.found ? `Found on page ${d.page} · Fine Print` : `Fine Print`;
  const copy = foundCopy(p, d);
  const reveal = document.getElementById('reveal');
  reveal.classList.remove('pending');
  reveal.innerHTML = `<h1 class="fade-in">${copy.title}</h1><p class="sub fade-in">${esc(copy.sub)}</p>`;
  document.getElementById('counter').innerHTML = `<span class="stamp">All ${d.pages} pages read in <b>${secs(d.seconds)} s</b></span>`;

  const map = document.querySelector('.minimap');
  const max = Math.max(...d.probabilities, 0.0001);
  map.querySelectorAll('.pg').forEach((cell) => {
    const i = Number(cell.dataset.page);
    const pr = d.probabilities[i - 1] || 0;
    if (pr > 0.003) cell.style.setProperty('--h', Math.pow(pr / max, 0.55).toFixed(3));
    if (i === d.guess) cell.classList.add('win');
    if (i === d.page) cell.classList.add('yours');
  });
  map.setAttribute('aria-label', `Heat map of where SubQ looked. Brightest on page ${d.guess}. Your clause is on page ${d.page}.`);
  map.insertAdjacentHTML('afterend', `<div class="legend fade-in"><span><i></i>Where SubQ looked. Brighter means more sure.</span><span><i class="dot"></i>Where you hid it</span></div>`);

  const unfairSure = d.unfair >= 0.5 ? d.unfair : 1 - d.unfair;
  const paras = d.paragraphs.map((t, i) => i === d.inserted
    ? `<p class="mine"><mark>${esc(t)}</mark></p>`
    : isHeading(t) ? `<p class="heading">${esc(t)}</p>` : `<p>${esc(t)}</p>`).join('');
  document.getElementById('stage').innerHTML = `
    <dl class="readout fade-in">
      <div><dt>SubQ’s confidence</dt><dd>${Math.round(d.confidence * 100)}% on page ${d.guess}</dd></div>
      ${d.found ? `<div><dt>What your clause does</dt><dd>${esc(KIND[d.kind] || 'Unclear')}</dd></div>
      <div><dt>Unfair to the signer?</dt><dd>${d.unfair >= 0.5 ? 'Yes' : 'No'}, ${Math.round(unfairSure * 100)}% sure</dd></div>` : `<div><dt>Where you hid it</dt><dd>Page ${d.page}</dd></div>`}
    </dl>
    <p class="status">${d.pages} pages · read in ${secs(d.seconds)} s · cost ${cents(d.cost)}${d.cached ? ' · saved result, no tokens used' : ''}</p>
    ${raceBlock(d, 3)}
    <section class="excerpt fade-in">
      <h2>Page ${d.page}, where you hid it</h2>
      <div class="paper">${paras}</div>
    </section>
    <div class="actions">
      <button class="primary" type="button" id="share">Share this result</button>
      <button class="quiet" type="button" data-go="${hideHash(p)}">Hide another clause</button>
    </div>`;
  const paper = document.querySelector('.excerpt .paper');
  const mine = paper.querySelector('.mine');
  if (mine) paper.scrollTop = Math.max(0, mine.offsetTop - paper.offsetTop - 60);
  document.getElementById('share').addEventListener('click', () => openShare(p, d, copy));
  startRaceWhenVisible(document.querySelector('.race'));
}

// ---------- share ----------
function drawCard(p, d) {
  const W = 1200, H = 630, c = document.createElement('canvas');
  c.width = W * 2; c.height = H * 2;
  const g = c.getContext('2d');
  g.scale(2, 2);
  const sans = 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
  const ink = '#1d1d1f', muted = '#55555a';
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
  g.fillStyle = ink; g.font = `600 24px ${sans}`;
  g.fillText('Fine Print', 72, 76);

  const lead = `I hid a clause on page ${d.page} of a ${d.pages}-page ${NOUN[p.id]}.`;
  const punch = d.found ? `SubQ found it in ${secs(d.seconds)} seconds.` : Math.abs(d.guess - d.page) === 1 ? 'SubQ landed one page away.' : 'SubQ didn’t find it.';
  g.font = `600 50px ${sans}`;
  const lines = []; let line = '';
  for (const w of lead.split(' ')) { const t = line ? `${line} ${w}` : w; if (g.measureText(t).width > 1050 && line) { lines.push(line); line = w; } else line = t; }
  lines.push(line);
  let y = 150;
  g.fillStyle = muted;
  for (const l of lines) { g.fillText(l, 72, y); y += 60; }
  const pw = g.measureText(punch).width;
  g.fillStyle = '#ffcc00';
  g.beginPath(); g.roundRect ? g.roundRect(60, y - 46, pw + 24, 62, 8) : g.rect(60, y - 46, pw + 24, 62); g.fill();
  g.fillStyle = ink; g.fillText(punch, 72, y);

  // race, two columns
  const opus = estimateOpus(d.tokens, 3);
  const ry = y + 70, colW = 400;
  const cardCol = (x, name, t, tok, cost, est) => {
    g.fillStyle = muted; g.font = `600 19px ${sans}`; g.fillText(name, x, ry);
    g.fillStyle = ink; g.font = `600 44px ${sans}`;
    const tt = `${est ? '~' : ''}${secs(t)} s`; g.fillText(tt, x, ry + 50);
    g.fillStyle = muted; g.font = `400 18px ${sans}`;
    g.fillText(`${Math.round(tok).toLocaleString('en-US')} tokens · ${est ? '~' : ''}${cents(cost)}${est ? '  est.' : ''}`, x, ry + 80);
  };
  cardCol(72, 'SubQ Snap', d.seconds, d.tokens, d.cost, false);
  cardCol(72 + colW, RACE.opus.name, opus.seconds, d.tokens + opus.out, opus.cost, true);
  g.fillStyle = ink; g.font = `600 26px ${sans}`;
  g.fillText(`~${times(opus.seconds / d.seconds)}× faster`, 72 + colW * 2, ry + 40);
  g.fillText(`~${times(opus.cost / d.cost)}× cheaper`, 72 + colW * 2, ry + 76);

  // page map
  const n = d.pages, rows = n > 100 ? 4 : n > 40 ? 3 : 1, cols = Math.ceil(n / rows), gap = 3;
  const cw = Math.min(n <= 40 ? 34 : 20, (1056 - (cols - 1) * gap) / cols), ch = cw * 1.3;
  const top = H - 58 - rows * (ch + gap);
  const max = Math.max(...d.probabilities, 0.0001);
  for (let i = 0; i < n; i++) {
    const x = 72 + (i % cols) * (cw + gap), yy = top + Math.floor(i / cols) * (ch + gap);
    const pr = d.probabilities[i] / max;
    g.fillStyle = pr > 0.02 ? `rgba(255,204,0,${Math.max(0.2, Math.pow(pr, 0.55)).toFixed(2)})` : '#ececf0';
    g.fillRect(x, yy, cw, ch);
    g.strokeStyle = '#b8b8be'; g.lineWidth = 1; g.strokeRect(x + 0.5, yy + 0.5, cw - 1, ch - 1);
    if (i + 1 === d.page) { g.strokeStyle = ink; g.lineWidth = 2.5; g.strokeRect(x - 1.5, yy - 1.5, cw + 3, ch + 3); }
  }
  g.fillStyle = muted; g.font = `400 17px ${sans}`;
  g.fillText(`Every page of the ${NOUN[p.id]}${p.own ? '' : ' (fictional)'}. Opus figures are estimates. A SubQ Snap demo.`, 72, H - 26);
  return c;
}

function openShare(p, d, copy) {
  const canvas = drawCard(p, d);
  const url = location.href;
  sheetTitle.textContent = 'Share your result';
  sheetBody.innerHTML = `
    <img class="share-preview" alt="${esc(copy.share)}" src="${canvas.toDataURL('image/png')}">
    <p class="sheet-note" style="margin-top:16px">${p.own
      ? 'Links aren’t available for your own documents, because this site doesn’t keep them. The image works anywhere.'
      : 'The link reopens this exact agreement, page and clause.'}</p>
    <div class="share-actions">
      ${p.own ? '' : '<button class="primary" type="button" id="copy">Copy link</button>'}
      <button class="${p.own ? 'primary' : 'secondary'}" type="button" id="dl">Download image</button>
      ${navigator.share ? '<button class="secondary" type="button" id="native">Share…</button>' : ''}
    </div>`;
  if (!sheet.open) sheet.showModal();
  document.getElementById('copy')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copied'); }
    catch { prompt('Copy this link:', url); }
  });
  document.getElementById('dl').addEventListener('click', () => {
    canvas.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `fine-print-page-${d.page}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('Image downloaded');
    }, 'image/png');
  });
  document.getElementById('native')?.addEventListener('click', () => {
    canvas.toBlob(async (blob) => {
      const file = new File([blob], `fine-print-page-${d.page}.png`, { type: 'image/png' });
      const payload = p.own ? { title: 'Fine Print', text: copy.share } : { title: 'Fine Print', text: copy.share, url };
      try { await navigator.share(navigator.canShare?.({ files: [file] }) ? { ...payload, files: [file] } : payload); } catch {}
    }, 'image/png');
  });
}

// ---------- use it anywhere: extension, phone share menu ----------
let installPrompt = null; // Android Chrome hands this over when Fine Print can be installed as an app
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; document.getElementById('install')?.removeAttribute('hidden'); });

function anywhere() {
  document.title = 'Use it anywhere · Fine Print';
  const ua = navigator.userAgent;
  const iphone = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const cards = {
    computer: `
      <article class="how" id="computer">
        <p class="how-kicker">On a computer</p>
        <h2>The Fine Print extension</h2>
        <p>When a page asks you to agree to its terms, a small “Check it first” button appears in the corner. One click and SubQ reads every word of them, with the answers right there on the page.</p>
        <div class="how-actions"><a class="primary" href="/get/fine-print-extension.zip" download>Download the extension</a></div>
        <ol class="steps">
          <li><b>Unzip</b> the download. You’ll get a folder called <code>fine-print-extension</code>.</li>
          <li>In Chrome, go to <code>chrome://extensions</code> and switch on <b>Developer mode</b> in the top right corner.</li>
          <li>Click <b>Load unpacked</b> and choose that folder. Then pin Fine Print to your toolbar.</li>
        </ol>
        <p class="how-note">Works in Chrome, Edge, Brave and Arc. You can also click the toolbar button on any page, or right-click a link and choose “Check these terms with Fine Print.” Nothing is read until you click.</p>
      </article>`,
    iphone: `
      <article class="how" id="iphone">
        <p class="how-kicker">On iPhone</p>
        <h2>Fine Print in your Share menu</h2>
        <p>iPhones don’t let websites join the Share menu, so this uses a tiny Shortcut. It only does one thing: send the page you’re looking at to Fine Print.</p>
        <div class="how-actions"><a class="primary" href="/get/fine-print.shortcut">Get the shortcut</a></div>
        <ol class="steps">
          <li>Tap <b>Get the shortcut</b>, then <b>Add Shortcut</b> in the Shortcuts app.</li>
          <li>On any terms page, tap <b>Share</b> <span class="glyph" aria-hidden="true">⬆︎</span>, then <b>Fine Print</b>.</li>
          <li>The first time, tap <b>Allow</b> so it can open Fine Print.</li>
        </ol>
        <p class="how-note">Inside an app with no Share button? Copy the terms link, open Fine Print and tap <b>Paste link</b>. To keep Fine Print one tap away, open it in Safari, tap Share, then <b>Add to Home Screen</b>.</p>
      </article>`,
    android: `
      <article class="how" id="android">
        <p class="how-kicker">On Android</p>
        <h2>Fine Print in your Share menu</h2>
        <p>Install Fine Print as an app and it joins your Share menu. No app store needed.</p>
        <div class="how-actions"><button class="primary" type="button" id="install" ${installPrompt ? '' : 'hidden'}>Install Fine Print</button></div>
        <ol class="steps">
          <li>Open this page in Chrome, tap <b>⋮</b>, then <b>Add to Home screen</b> or <b>Install app</b>.</li>
          <li>On any terms page, tap <b>Share</b>, then <b>Fine Print</b>.</li>
        </ol>
        <p class="how-note">Inside an app with no Share button? Copy the terms link, open Fine Print and tap <b>Paste link</b>.</p>
      </article>`,
  };
  const order = iphone ? ['iphone', 'android', 'computer'] : android ? ['android', 'iphone', 'computer'] : ['computer', 'iphone', 'android'];
  render(`
    <section class="screen">
      <a class="back" href="#/">‹ All agreements</a>
      <div class="title-block">
        <h1>Check the terms right when you’re asked to agree.</h1>
        <p>Sign-ups, checkouts and app installs all end with “I agree.” Send those terms to Fine Print without leaving what you’re doing.</p>
      </div>
      <div class="hows">${order.map((k) => cards[k]).join('')}</div>
      <p class="privacy">For builders: any link works as <code>${esc(location.origin)}/?url=</code> followed by the terms address. It opens straight into a reading.</p>
    </section>`);
  document.getElementById('install')?.addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    installPrompt = null;
    document.getElementById('install')?.setAttribute('hidden', '');
  });
}

// ---------- routing ----------
function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }

async function route() {
  renderToken++;
  if (sheet.open) sheet.close();
  try { await loadPresets(); }
  catch (error) { render(`<section class="screen"><p class="error">${esc(error.message)}</p></section>`); return; }
  const shared = sharedLink();
  if (shared) return checkLink(shared);
  const [view, id, a, b] = location.hash.replace(/^#\/?/, '').split('/');
  if (view === 'r' && /^[0-9a-f]{20}$/.test(id || '')) {
    if (ownDoc?.report?.id === id) { docScreen(ownDoc); return showLinkReport(ownDoc, ownDoc.report, { animate: false }); }
    return savedResult(id);
  }
  if (view === 'anywhere') return anywhere();
  if (view === 'own') {
    if (!id) return ownScreen();
    if (!ownDoc) { history.replaceState(null, '', '#/own'); return ownScreen(); }
    if (id === 'read') { docScreen(ownDoc); return showReport(ownDoc, ownDoc.report, { animate: false }); }
    if (id === 'hide' || id === 'found') return hideScreen(ownDoc);
  }
  if (view === 'doc' && presetById(id)) return docScreen(presetById(id), { auto: a === 'read' });
  if (view === 'hide' && presetById(id)) return hideScreen(presetById(id));
  if (view === 'found' && presetById(id)) {
    const clause = b64d(b || '');
    if (clause.length >= 12) return hunt(presetById(id), clause, Number(a), { replay: true });
  }
  home();
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-go]');
  if (t) { e.preventDefault(); go(t.dataset.go); }
  if (e.target.closest('[data-close]')) sheet.close();
});
sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
window.addEventListener('hashchange', route);
route();
// Lets phones install Fine Print as an app (and so share pages to it). Never caches anything.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
