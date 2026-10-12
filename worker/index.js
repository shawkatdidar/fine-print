// Fine Print on Cloudflare. Same API as server.mjs, but:
// - static files and the fictional documents are served from Workers static assets,
// - the gift counter, saved results and per-visitor limits live in one Durable Object ("Ledger"),
// - the SubQ key is a Worker secret and never reaches the browser.
import { DurableObject } from 'cloudflare:workers';
import { presets, presetOrder } from '../lib/presets.mjs';
import { readQuestions, hideQuestions, ownQuestions, OWN_QUESTIONS } from '../lib/questions.mjs';
import { fetchLink, LinkError, checkLink, cleanTitle } from '../lib/webpage.mjs';
import { renderState, withClause, pageKey, cleanClause, presetExists, paginateText, normalizePages, estimateTokens, MAX_TOKENS } from '../lib/pages.mjs';

const SUBQ_API = 'https://api.subq.ai/v1/systemone';
const PRICE_PER_MILLION = 0.05;

class SubQError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

const num = (v, d) => (Number.isFinite(Number(v)) && String(v ?? '').trim() !== '' ? Number(v) : d);
const config = (env) => ({
  budget: num(env.GIFT_BUDGET, 100_000_000),
  usedBefore: num(env.GIFT_USED_BEFORE, 0),
  reserve: num(env.GIFT_RESERVE, 1_000_000),
  perHour: num(env.RATE_LIMIT_PER_HOUR, 30),
  perMinute: num(env.RATE_LIMIT_PER_MINUTE, 6),
});

// ---------- One global ledger: gift counter, saved results, per-visitor limits ----------
export class Ledger extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY, tracked INTEGER NOT NULL, calls INTEGER NOT NULL)');
    this.sql.exec('INSERT OR IGNORE INTO usage (id, tracked, calls) VALUES (1, 0, 0)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS saved (name TEXT PRIMARY KEY, data TEXT NOT NULL)');
    this.hits = new Map();
  }

  gift() {
    const c = config(this.env);
    const { tracked } = this.sql.exec('SELECT tracked FROM usage WHERE id = 1').one();
    const used = c.usedBefore + tracked;
    const remaining = Math.max(0, c.budget - used);
    return { budget: c.budget, used, remaining, paused: remaining <= c.reserve };
  }

  // Before any live call: protect the gift and keep one visitor from using it all.
  admit(ip, estimate) {
    const c = config(this.env);
    if (this.gift().remaining - estimate <= c.reserve) return 'spent';
    const now = Date.now();
    const list = (this.hits.get(ip) || []).filter((t) => now - t < 3600_000);
    const lastMinute = list.filter((t) => now - t < 60_000).length;
    if (list.length >= c.perHour || lastMinute >= c.perMinute) { this.hits.set(ip, list); return 'limit'; }
    list.push(now);
    this.hits.set(ip, list);
    return 'ok';
  }

  record(tokens) {
    if (tokens > 0) this.sql.exec('UPDATE usage SET tracked = tracked + ?, calls = calls + 1 WHERE id = 1', tokens);
    return this.gift();
  }

  getSaved(name) {
    const row = this.sql.exec('SELECT data FROM saved WHERE name = ?', name).toArray()[0];
    return row ? JSON.parse(row.data) : null;
  }

  putSaved(name, data) {
    this.sql.exec('INSERT OR REPLACE INTO saved (name, data) VALUES (?, ?)', name, JSON.stringify(data));
  }
}

const ledger = (env) => env.LEDGER.get(env.LEDGER.idFromName('gift'));

// ---------- Helpers ----------
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

async function readBody(request, limit = 4000) {
  const raw = await request.text();
  if (raw.length > limit) throw new SubQError('input', 'That request was too large.');
  try { return JSON.parse(raw || '{}'); } catch { throw new SubQError('input', 'That request could not be read.'); }
}

function randomInt(min, max) { // max exclusive, like node:crypto randomInt
  const [x] = crypto.getRandomValues(new Uint32Array(1));
  return min + (x % (max - min));
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const asset = (env, path) => env.ASSETS.fetch(new Request(`https://assets.local${path}`));

const docCache = new Map();
async function loadDoc(env, id, variant = 'full') {
  const k = `${id}:${variant}`;
  if (docCache.has(k)) return docCache.get(k);
  const [textRes, indexRes] = await Promise.all([
    asset(env, `/_docs/${id}${variant === 'clean' ? '.clean' : ''}.txt`),
    asset(env, '/_docs/index.json'),
  ]);
  if (!textRes.ok || !indexRes.ok) throw new SubQError('server', 'A sample document is missing.');
  const pages = (await textRes.text()).split(/\[\[P\d{3}\]\]\n/).slice(1).map((p) => p.trim());
  const index = (await indexRes.json())[id];
  const doc = { pages, index };
  docCache.set(k, doc);
  return doc;
}

// Saved results: anything saved since launch, else the results bundled from local testing.
async function readSaved(env, name) {
  const hit = await ledger(env).getSaved(name);
  if (hit) return hit;
  const res = await asset(env, `/_cache/${name}`);
  return res.ok ? res.json() : null;
}

async function askSubQ(env, state, questions) {
  if (!env.SUBQ_API_KEY) throw new SubQError('nokey', 'Missing SubQ key.');
  const call = async () => {
    const started = Date.now();
    let response;
    try {
      response = await fetch(SUBQ_API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.SUBQ_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'subq-snap-preview', state, questions }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new SubQError('timeout', 'SubQ took too long to answer.');
      throw new SubQError('network', 'Could not reach SubQ.');
    }
    const seconds = (Date.now() - started) / 1000;
    if (response.status === 429) throw new SubQError('rate', 'SubQ is busy right now.');
    if (response.status === 402) throw new SubQError('credits', 'Out of credits.');
    if (response.status === 401 || response.status === 403) throw new SubQError('auth', 'Key not accepted.');
    if (!response.ok) throw new SubQError('server', `SubQ returned ${response.status}.`);
    const data = await response.json();
    const tokens = Number(data?.usage?.input_tokens) || 0;
    const gift = await ledger(env).record(tokens); // every real call counts against the gift
    return { answers: data.answers || {}, tokens, seconds, cost: tokens / 1e6 * PRICE_PER_MILLION, gift };
  };
  try { return await call(); } catch (error) {
    if (error.kind !== 'rate') throw error;
    await new Promise((r) => setTimeout(r, 2000));
    return call();
  }
}

async function guard(env, request, estimate) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const verdict = await ledger(env).admit(ip, estimate);
  if (verdict !== 'ok') throw new SubQError(verdict, '');
}

const calm = {
  rate: 'SubQ is handling a lot of requests right now. Give it a few seconds and try again.',
  timeout: 'That took longer than it should. Try once more.',
  network: 'Couldn’t reach SubQ just now. Try again in a moment.',
  auth: 'Live reading is unavailable right now. The saved examples still work.',
  nokey: 'Live reading is unavailable right now. The saved examples still work.',
  server: 'SubQ had a problem answering. Try again in a moment.',
  credits: 'The SubQ account behind this demo is out of credits, so live reading is paused. The saved examples still work.',
  spent: 'The gifted tokens are nearly used up, so live reading is paused to protect what’s left. The saved examples still work.',
  limit: 'You’ve run a lot of live reads in a short time. Give it a few minutes. The saved examples still work in the meantime.',
  input: null,
  browser: null,
};
async function fail(env, error) {
  const kind = error instanceof SubQError ? error.kind : 'server';
  if (kind !== 'input' && kind !== 'browser') console.error(`[fine-print] ${kind}: ${String(error.message).slice(0, 200)}`);
  const status = kind === 'input' ? 400 : kind === 'browser' ? 422 : kind === 'rate' || kind === 'limit' ? 429 : kind === 'spent' || kind === 'credits' ? 403 : 502;
  let gift = null;
  try { gift = await ledger(env).gift(); } catch {}
  return json(status, { error: calm[kind] || error.message, kind, gift });
}

// ---------- Routes ----------
async function presetsRoute(env) {
  const index = await (await asset(env, '/_docs/index.json')).json();
  const list = presetOrder.map((id) => {
    const p = presets[id];
    return {
      id, title: p.title, short: p.short, blurb: p.blurb, drafter: p.drafter, pages: index[id].pages,
      words: index[id].words, questions: p.questions.map(({ key, q }) => ({ key, q })), examples: p.examples,
    };
  });
  return json(200, { presets: list, connected: Boolean(env.SUBQ_API_KEY), gift: await ledger(env).gift(), maxTokens: MAX_TOKENS });
}

async function read(env, request) {
  const { id, fresh } = await readBody(request);
  if (!presetExists(id)) throw new SubQError('input', 'Pick one of the agreements.');
  const name = `read-${id}.json`;
  if (!fresh) {
    const hit = await readSaved(env, name);
    if (hit) return json(200, { ...hit, cached: true, gift: await ledger(env).gift() });
  }
  const p = presets[id];
  const doc = await loadDoc(env, id, 'full');
  await guard(env, request, doc.index.words * 2);
  const r = await askSubQ(env, renderState(doc.pages), readQuestions(p, doc.pages.length));
  const results = p.questions.map((q) => {
    const a = r.answers[q.key] || {}, w = r.answers[`where_${q.key}`] || {};
    const page = Number(String(w.choice || '').slice(1)) || null;
    return { key: q.key, q: q.q, yes: Number(a.noul), page, pageConfidence: Number(w.confidence) || 0, expect: q.expect };
  });
  const out = { id, pages: doc.pages.length, seconds: r.seconds, tokens: r.tokens, cost: r.cost, at: new Date().toISOString(), results };
  await ledger(env).putSaved(name, out);
  return json(200, { ...out, cached: false, gift: r.gift });
}

async function hide(env, request) {
  const body = await readBody(request);
  const { id } = body;
  if (!presetExists(id)) throw new SubQError('input', 'Pick one of the agreements.');
  const clause = cleanClause(body.clause);
  if (clause.length < 12) throw new SubQError('input', 'Write a slightly longer clause, at least a short sentence.');
  const doc = await loadDoc(env, id, 'clean');
  const n = doc.pages.length;
  let page = Number(body.page);
  if (!Number.isInteger(page) || page < 2 || page > n) page = randomInt(Math.ceil(n * 0.2), n); // deep in the document
  const hash = (await sha256(`${id}|${page}|${clause}`)).slice(0, 20);
  const { pages, paragraphs, inserted } = withClause(doc.pages, page, clause);
  const name = `hide-${hash}.json`;
  const hit = await readSaved(env, name);
  if (hit) return json(200, { ...hit, paragraphs, inserted, cached: true, gift: await ledger(env).gift() });

  await guard(env, request, doc.index.words * 2);
  const r = await askSubQ(env, renderState(pages), hideQuestions(n));
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
  await ledger(env).putSaved(name, out);
  return json(200, { ...out, paragraphs, inserted, cached: false, gift: r.gift });
}

// Visitor documents: held in memory for one request, never stored or logged.
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
async function ownLink(env, request) {
  const { url } = await readBody(request);
  // Its own per-visitor counter, so fetching links never eats into the reading allowance.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (await ledger(env).admit(`link:${ip}`, 0) === 'limit') throw new SubQError('input', 'That’s a lot of links in a short time. Give it a minute and try again.');
  const page = await fetchLink(url).catch((error) => {
    throw new SubQError('input', error instanceof LinkError ? error.message : 'Couldn’t read that page. Copy the text and paste it instead.');
  });
  return json(200, page);
}

// ---------- Public links: read a terms page from its address ----------
// Public pages aren't private, so results are saved by the page text's fingerprint:
// the same terms come back instantly and for free, and the result gets a share link.
// Text captured by the browser extension (body.text) may come from a signed-in page, so it's never saved.
const ownResults = (answers) => OWN_QUESTIONS.map((q) => {
  const a = answers[q.key] || {}, w = answers[`where_${q.key}`] || {};
  return { key: q.key, q: q.q, yes: Number(a.noul), page: Number(String(w.choice || '').slice(1)) || null, pageConfidence: Number(w.confidence) || 0 };
});
const wordCount = (s) => (s.match(/\S+/g) || []).length;

async function linkRead(env, request) {
  const body = await readBody(request, 2_500_000);
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
  const id = (await sha256(pages.join('\n\n'))).slice(0, 20);
  if (!fromBrowser) {
    const hit = await readSaved(env, `link-${id}.json`);
    if (hit) return json(200, { ...hit, cached: true, gift: await ledger(env).gift() });
  }
  await guard(env, request, estimateTokens(chars) * 1.3);
  const r = await askSubQ(env, renderState(pages), ownQuestions(pages.length));
  const out = {
    id: fromBrowser ? null : id, title: page.title, url: page.url, pages: pages.length, words: wordCount(pages.join(' ')), pageTexts: pages,
    seconds: r.seconds, tokens: r.tokens, cost: r.cost, at: new Date().toISOString(), results: ownResults(r.answers),
  };
  // A Durable Object value tops out at 2 MB; very long pages just aren't saved.
  if (!fromBrowser && JSON.stringify(out).length < 1_800_000) await ledger(env).putSaved(`link-${id}.json`, out);
  return json(200, { ...out, cached: false, gift: r.gift });
}

async function linkResult(env, url) {
  const id = url.searchParams.get('id') || '';
  const hit = /^[0-9a-f]{20}$/.test(id) ? await readSaved(env, `link-${id}.json`) : null;
  if (!hit) return json(404, { error: 'That result isn’t saved here anymore. Paste the link again to read it fresh.' });
  return json(200, { ...hit, cached: true, gift: await ledger(env).gift() });
}

async function ownRead(env, request) {
  const body = await readBody(request, 2_500_000);
  const { pages, chars } = ownPages(body);
  await guard(env, request, estimateTokens(chars) * 1.3);
  const r = await askSubQ(env, renderState(pages), ownQuestions(pages.length));
  const results = OWN_QUESTIONS.map((q) => {
    const a = r.answers[q.key] || {}, w = r.answers[`where_${q.key}`] || {};
    return { key: q.key, q: q.q, yes: Number(a.noul), page: Number(String(w.choice || '').slice(1)) || null, pageConfidence: Number(w.confidence) || 0 };
  });
  return json(200, { pages: pages.length, pageTexts: pages, seconds: r.seconds, tokens: r.tokens, cost: r.cost, at: new Date().toISOString(), results, cached: false, gift: r.gift });
}

async function ownHide(env, request) {
  const body = await readBody(request, 2_500_000);
  const { pages: base, chars } = ownPages({ pages: body.pages });
  const clause = cleanClause(body.clause);
  if (clause.length < 12) throw new SubQError('input', 'Write a slightly longer clause, at least a short sentence.');
  const n = base.length;
  if (n < 3) throw new SubQError('input', 'This document is too short to hide something in. Try one with a few pages.');
  const page = randomInt(Math.max(2, Math.ceil(n * 0.2)), n + 1);
  const { pages, paragraphs, inserted } = withClause(base, page, clause);
  await guard(env, request, estimateTokens(chars) * 1.2);
  const r = await askSubQ(env, renderState(pages), hideQuestions(n));
  const where = r.answers.where || {};
  const guess = Number(String(where.choice || '').slice(1)) || null;
  return json(200, {
    page, pages: n, clause, guess, found: guess === page, confidence: Number(where.confidence) || 0,
    probabilities: Array.from({ length: n }, (_, i) => Math.round((Number(where.probabilities?.[pageKey(i + 1)]) || 0) * 10000) / 10000),
    kind: r.answers.kind?.choice || null, unfair: Number(r.answers.unfair?.noul),
    seconds: r.seconds, tokens: r.tokens, cost: r.cost, paragraphs, inserted, cached: false, gift: r.gift,
  });
}

async function pageRoute(env, url) {
  const id = url.searchParams.get('id');
  const n = Number(url.searchParams.get('n'));
  if (!presetExists(id)) return json(400, { error: 'Unknown agreement.' });
  const doc = await loadDoc(env, id, 'full');
  if (!Number.isInteger(n) || n < 1 || n > doc.pages.length) return json(400, { error: 'Unknown page.' });
  const paragraphs = doc.pages[n - 1].split('\n\n');
  const planted = presets[id].traps.map((t) => paragraphs.indexOf(t.nasty)).filter((i) => i >= 0);
  return json(200, { id, n, pages: doc.pages.length, paragraphs, planted });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    try {
      switch (route) {
        case 'GET /api/presets': return await presetsRoute(env);
        case 'GET /api/gift': return json(200, await ledger(env).gift());
        case 'GET /api/page': return await pageRoute(env, url);
        case 'POST /api/read': return await read(env, request);
        case 'POST /api/hide': return await hide(env, request);
        case 'POST /api/own/link': return await ownLink(env, request);
        case 'POST /api/link/read': return await linkRead(env, request);
        case 'GET /api/link/result': return await linkResult(env, url);
        case 'POST /api/own/read': return await ownRead(env, request);
        case 'POST /api/own/hide': return await ownHide(env, request);
      }
      if (url.pathname.startsWith('/api/')) return json(404, { error: 'Not found.' });
      return env.ASSETS.fetch(request);
    } catch (error) {
      return fail(env, error);
    }
  },
};
