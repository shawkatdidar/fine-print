import http from 'node:http';
import { readFile, writeFile, stat, mkdir } from 'node:fs/promises';
import { createHash, randomInt } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, askSubQ, SubQError } from './lib/subq.mjs';
import { loadDoc, renderState, withClause, pageKey, cleanClause, presetExists, paginateText, normalizePages, estimateTokens, MAX_TOKENS } from './lib/docs.mjs';
import { gift, canAfford, allowLive } from './lib/budget.mjs';
import { presets, presetOrder } from './lib/presets.mjs';
import { readQuestions, hideQuestions, ownQuestions, OWN_QUESTIONS } from './lib/questions.mjs';
import { fetchLink, LinkError, checkLink, cleanTitle } from './lib/webpage.mjs';

loadEnv();
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const CACHE = path.join(ROOT, 'cache');
const PORT = Number(process.env.PORT || 4174);
await mkdir(CACHE, { recursive: true });
const wordCount = (s) => (s.match(/\S+/g) || []).length;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 4000) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > limit) throw new SubQError('input', 'That request was too large.');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new SubQError('input', 'That request could not be read.'); }
}

async function readCache(name) {
  try { return JSON.parse(await readFile(path.join(CACHE, name), 'utf8')); } catch { return null; }
}
const writeCache = (name, data) => writeFile(path.join(CACHE, name), JSON.stringify(data));

// One live call at a time keeps the demo polite to the API and to the token budget.
let busy = Promise.resolve();
function serial(fn) {
  const run = busy.then(fn, fn);
  busy = run.catch(() => {});
  return run;
}
async function ask(state, questions) {
  try { return await askSubQ(state, questions); }
  catch (error) {
    if (error.kind !== 'rate') throw error;
    await new Promise((r) => setTimeout(r, 2000));
    return askSubQ(state, questions);
  }
}

// Before any live call: protect the gift and keep one visitor from using it all.
function guard(req, estimate) {
  if (!canAfford(estimate)) throw new SubQError('spent', '');
  if (!allowLive(req.socket.remoteAddress || 'local')) throw new SubQError('limit', '');
}

const calm = {
  rate: 'SubQ is handling a lot of requests right now. Give it a few seconds and try again.',
  timeout: 'That took longer than it should. Try once more.',
  network: 'Couldn’t reach SubQ. Check your internet connection and try again.',
  auth: 'The SubQ key wasn’t accepted. Check the key in the .env file.',
  nokey: 'This demo needs a SubQ key. Add SUBQ_API_KEY to the .env file and restart.',
  server: 'SubQ had a problem answering. Try again in a moment.',
  credits: 'The SubQ account behind this demo is out of credits, so live reading is paused. The saved examples still work.',
  spent: 'The gifted tokens are nearly used up, so live reading is paused to protect what’s left. The saved examples still work.',
  limit: 'You’ve run a lot of live reads in a short time. Give it a few minutes. The saved examples still work in the meantime.',
  input: null,
  browser: null,
};
function fail(res, error) {
  const kind = error instanceof SubQError ? error.kind : 'server';
  if (kind !== 'input' && kind !== 'browser') console.error(`[fine-print] ${kind}: ${String(error.message).slice(0, 200)}`);
  json(res, kind === 'input' ? 400 : kind === 'browser' ? 422 : kind === 'rate' || kind === 'limit' ? 429 : kind === 'spent' || kind === 'credits' ? 403 : 502, { error: calm[kind] || error.message, kind, gift: gift() });
}

function presetSummary(id) {
  const p = presets[id];
  const { index } = loadDoc(id);
  return {
    id, title: p.title, short: p.short, blurb: p.blurb, drafter: p.drafter, pages: index.pages,
    words: index.words, questions: p.questions.map(({ key, q }) => ({ key, q })), examples: p.examples,
  };
}

async function read(req, res) {
  try {
    const { id, fresh } = await readBody(req);
    if (!presetExists(id)) throw new SubQError('input', 'Pick one of the agreements.');
    const cacheName = `read-${id}.json`;
    if (!fresh) {
      const hit = await readCache(cacheName);
      if (hit) return json(res, 200, { ...hit, cached: true, gift: gift() });
    }
    const p = presets[id];
    const doc = loadDoc(id, 'full');
    guard(req, doc.index.words * 2);
    const r = await serial(() => ask(renderState(doc.pages), readQuestions(p, doc.pages.length)));
    const results = p.questions.map((q) => {
      const a = r.answers[q.key] || {}, w = r.answers[`where_${q.key}`] || {};
      const page = Number(String(w.choice || '').slice(1)) || null;
      return { key: q.key, q: q.q, yes: Number(a.noul), page, pageConfidence: Number(w.confidence) || 0, expect: q.expect };
    });
    const out = { id, pages: doc.pages.length, seconds: r.seconds, tokens: r.tokens, cost: r.cost, at: new Date().toISOString(), results };
    await writeCache(cacheName, out);
    console.log(`[fine-print] read ${id}: ${r.tokens} tokens, ${r.seconds.toFixed(2)} s`);
    json(res, 200, { ...out, cached: false, gift: gift() });
  } catch (error) { fail(res, error); }
}

async function hide(req, res) {
  try {
    const body = await readBody(req);
    const { id } = body;
    if (!presetExists(id)) throw new SubQError('input', 'Pick one of the agreements.');
    const clause = cleanClause(body.clause);
    if (clause.length < 12) throw new SubQError('input', 'Write a slightly longer clause, at least a short sentence.');
    const doc = loadDoc(id, 'clean');
    const n = doc.pages.length;
    let page = Number(body.page);
    if (!Number.isInteger(page) || page < 2 || page > n) page = randomInt(Math.ceil(n * 0.2), n); // deep in the document
    const hash = createHash('sha256').update(`${id}|${page}|${clause}`).digest('hex').slice(0, 20);
    const { pages, paragraphs, inserted } = withClause(doc.pages, page, clause);
    const cacheName = `hide-${hash}.json`;
    const hit = await readCache(cacheName);
    if (hit) return json(res, 200, { ...hit, paragraphs, inserted, cached: true, gift: gift() });

    guard(req, doc.index.words * 2);
    const r = await serial(() => ask(renderState(pages), hideQuestions(n)));
    const where = r.answers.where || {};
    const probabilities = Array.from({ length: n }, (_, i) => Number(where.probabilities?.[pageKey(i + 1)]) || 0);
    const guess = Number(String(where.choice || '').slice(1)) || null;
    const out = {
      id, page, pages: n, clause, guess, found: guess === page, confidence: Number(where.confidence) || 0,
      probabilities: probabilities.map((x) => Math.round(x * 10000) / 10000),
      kind: r.answers.kind?.choice || null, kindConfidence: Number(r.answers.kind?.confidence) || 0,
      unfair: Number(r.answers.unfair?.noul),
      seconds: r.seconds, tokens: r.tokens, cost: r.cost, at: new Date().toISOString(),
    };
    await writeCache(cacheName, out);
    console.log(`[fine-print] hide ${id} p${page}: guess p${guess} ${out.found ? 'HIT' : 'miss'}, ${r.tokens} tokens, ${r.seconds.toFixed(2)} s`);
    json(res, 200, { ...out, paragraphs, inserted, cached: false, gift: gift() });
  } catch (error) { fail(res, error); }
}

// ---------- Visitor documents: held in memory for one request, never stored or logged ----------
function ownPages(body) {
  let pages;
  if (Array.isArray(body.pages) && body.pages.length) pages = normalizePages(body.pages.slice(0, 3000)).pages;
  else if (typeof body.text === 'string') pages = paginateText(body.text);
  else throw new SubQError('input', 'Paste some text or choose a file first.');
  const chars = pages.reduce((a, p) => a + p.length, 0);
  if (chars < 300) throw new SubQError('input', 'That’s too short to be an agreement. Paste the whole document.');
  if (estimateTokens(chars) > MAX_TOKENS) throw new SubQError('input', `That document is about ${Math.round(estimateTokens(chars) / 1000)}K tokens, and the limit here is ${MAX_TOKENS / 1000}K. Try a shorter document or just the main agreement.`);
  return { pages, chars };
}

// A visitor's link: fetch the page and hand back its text. Nothing is stored or logged.
async function ownLink(req, res) {
  try {
    const { url } = await readBody(req);
    // Its own per-visitor counter, so fetching links never eats into the reading allowance.
    if (!allowLive(`link:${req.socket.remoteAddress || 'local'}`)) throw new SubQError('input', 'That’s a lot of links in a short time. Give it a minute and try again.');
    const page = await fetchLink(url).catch((error) => {
      throw new SubQError('input', error instanceof LinkError ? error.message : 'Couldn’t read that page. Copy the text and paste it instead.');
    });
    json(res, 200, page);
  } catch (error) { fail(res, error); }
}

// ---------- Public links: read a terms page from its address ----------
// Public pages aren't private, so results are saved by the page text's fingerprint:
// the same terms come back instantly and for free, and the result gets a share link.
// Text captured by the browser extension (body.text) may come from a signed-in page, so it's never saved.
const ownResults = (answers) => OWN_QUESTIONS.map((q) => {
  const a = answers[q.key] || {}, w = answers[`where_${q.key}`] || {};
  return { key: q.key, q: q.q, yes: Number(a.noul), page: Number(String(w.choice || '').slice(1)) || null, pageConfidence: Number(w.confidence) || 0 };
});

async function linkRead(req, res) {
  try {
    const body = await readBody(req, 2_500_000);
    const fromBrowser = typeof body.text === 'string' && body.text.trim().length > 0;
    // Text from the browser needs no fetch, so its address is only a label; a link we fetch must be public.
    let url;
    try { url = fromBrowser ? new URL(String(body.url || '')) : checkLink(body.url); } catch (error) { throw new SubQError('input', error.message); }
    if (!/^https?:$/.test(url.protocol)) throw new SubQError('input', 'Only web pages can be read.');
    let page;
    if (fromBrowser) page = { title: cleanTitle(String(body.title || '').slice(0, 300), url.hostname), text: body.text, url: url.href };
    else {
      page = await fetchLink(url.href).catch((error) => {
        if (error instanceof LinkError) throw new SubQError(error.browser ? 'browser' : 'input', error.message);
        throw new SubQError('input', 'Couldn’t read that page. Copy the text and paste it instead.');
      });
    }
    const { pages, chars } = ownPages({ text: page.text });
    const id = createHash('sha256').update(pages.join('\n\n')).digest('hex').slice(0, 20);
    if (!fromBrowser) {
      const hit = await readCache(`link-${id}.json`);
      if (hit) return json(res, 200, { ...hit, cached: true, gift: gift() });
    }
    guard(req, estimateTokens(chars) * 1.3);
    const r = await serial(() => ask(renderState(pages), ownQuestions(pages.length)));
    const out = {
      id: fromBrowser ? null : id, title: page.title, url: page.url, pages: pages.length, words: wordCount(pages.join(' ')), pageTexts: pages,
      seconds: r.seconds, tokens: r.tokens, cost: r.cost, at: new Date().toISOString(), results: ownResults(r.answers),
    };
    if (!fromBrowser) await writeCache(`link-${id}.json`, out);
    console.log(`[fine-print] read link (${fromBrowser ? 'browser text' : 'fetched'}): ${pages.length} pages, ${r.tokens} tokens, ${r.seconds.toFixed(2)} s`);
    json(res, 200, { ...out, cached: false, gift: gift() });
  } catch (error) { fail(res, error); }
}

async function linkResult(url, res) {
  const id = url.searchParams.get('id') || '';
  const hit = /^[0-9a-f]{20}$/.test(id) ? await readCache(`link-${id}.json`) : null;
  if (!hit) return json(res, 404, { error: 'That result isn’t saved here anymore. Paste the link again to read it fresh.' });
  json(res, 200, { ...hit, cached: true, gift: gift() });
}

async function ownRead(req, res) {
  try {
    const body = await readBody(req, 2_500_000);
    const { pages, chars } = ownPages(body);
    guard(req, estimateTokens(chars) * 1.3);
    const r = await serial(() => ask(renderState(pages), ownQuestions(pages.length)));
    const results = OWN_QUESTIONS.map((q) => {
      const a = r.answers[q.key] || {}, w = r.answers[`where_${q.key}`] || {};
      return { key: q.key, q: q.q, yes: Number(a.noul), page: Number(String(w.choice || '').slice(1)) || null, pageConfidence: Number(w.confidence) || 0 };
    });
    console.log(`[fine-print] read own document: ${pages.length} pages, ${r.tokens} tokens, ${r.seconds.toFixed(2)} s`);
    json(res, 200, { pages: pages.length, pageTexts: pages, seconds: r.seconds, tokens: r.tokens, cost: r.cost, at: new Date().toISOString(), results, cached: false, gift: gift() });
  } catch (error) { fail(res, error); }
}

async function ownHide(req, res) {
  try {
    const body = await readBody(req, 2_500_000);
    const { pages: base, chars } = ownPages({ pages: body.pages });
    const clause = cleanClause(body.clause);
    if (clause.length < 12) throw new SubQError('input', 'Write a slightly longer clause, at least a short sentence.');
    const n = base.length;
    if (n < 3) throw new SubQError('input', 'This document is too short to hide something in. Try one with a few pages.');
    const page = randomInt(Math.max(2, Math.ceil(n * 0.2)), n + 1);
    const { pages, paragraphs, inserted } = withClause(base, page, clause);
    guard(req, estimateTokens(chars) * 1.2);
    const r = await serial(() => ask(renderState(pages), hideQuestions(n)));
    const where = r.answers.where || {};
    const guess = Number(String(where.choice || '').slice(1)) || null;
    console.log(`[fine-print] hide in own document: ${n} pages, ${guess === page ? 'HIT' : 'miss'}, ${r.tokens} tokens, ${r.seconds.toFixed(2)} s`);
    json(res, 200, {
      page, pages: n, clause, guess, found: guess === page, confidence: Number(where.confidence) || 0,
      probabilities: Array.from({ length: n }, (_, i) => Math.round((Number(where.probabilities?.[pageKey(i + 1)]) || 0) * 10000) / 10000),
      kind: r.answers.kind?.choice || null, unfair: Number(r.answers.unfair?.noul),
      seconds: r.seconds, tokens: r.tokens, cost: r.cost, paragraphs, inserted, cached: false, gift: gift(),
    });
  } catch (error) { fail(res, error); }
}

function page(url, res) {
  const id = url.searchParams.get('id');
  const n = Number(url.searchParams.get('n'));
  if (!presetExists(id)) return json(res, 400, { error: 'Unknown agreement.' });
  const doc = loadDoc(id, 'full');
  if (!Number.isInteger(n) || n < 1 || n > doc.pages.length) return json(res, 400, { error: 'Unknown page.' });
  const paragraphs = doc.pages[n - 1].split('\n\n');
  // Paragraphs we planted on purpose, so the page view can highlight them.
  const planted = presets[id].traps.map((t) => paragraphs.indexOf(t.nasty)).filter((i) => i >= 0);
  json(res, 200, { id, n, pages: doc.pages.length, paragraphs, planted });
}

const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.zip': 'application/zip', '.shortcut': 'application/octet-stream' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/api/presets') return json(res, 200, { presets: presetOrder.map(presetSummary), connected: Boolean(process.env.SUBQ_API_KEY), gift: gift(), maxTokens: MAX_TOKENS });
  if (req.method === 'GET' && url.pathname === '/api/gift') return json(res, 200, gift());
  if (req.method === 'POST' && url.pathname === '/api/own/link') return ownLink(req, res);
  if (req.method === 'POST' && url.pathname === '/api/link/read') return linkRead(req, res);
  if (req.method === 'GET' && url.pathname === '/api/link/result') return linkResult(url, res);
  if (req.method === 'POST' && url.pathname === '/api/own/read') return ownRead(req, res);
  if (req.method === 'POST' && url.pathname === '/api/own/hide') return ownHide(req, res);
  if (req.method === 'POST' && url.pathname === '/api/read') return read(req, res);
  if (req.method === 'POST' && url.pathname === '/api/hide') return hide(req, res);
  if (req.method === 'GET' && url.pathname === '/api/page') return page(url, res);
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed.' });
  try {
    const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const file = path.resolve(PUBLIC, relative);
    if (!file.startsWith(PUBLIC + path.sep)) return json(res, 403, { error: 'Forbidden.' });
    if (!(await stat(file)).isFile()) throw new Error('not found');
    res.writeHead(200, { 'Content-Type': `${mime[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch { json(res, 404, { error: 'Not found.' }); }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Fine Print running at http://127.0.0.1:${PORT}`));
