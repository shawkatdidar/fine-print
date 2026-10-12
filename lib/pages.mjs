// Pure page helpers shared by the local Node server and the Cloudflare Worker (no file access here).
import { presets } from './presets.mjs';
export const pageKey = (n) => `P${String(n).padStart(3, '0')}`;

export function renderState(pages, format = globalThis.process?.env?.FP_FORMAT || 'wrap') {
  if (format === 'start') return pages.map((p, i) => `[[${pageKey(i + 1)}]]\n${p}`).join('\n\n');
  // Mark both the start and the end of each page so a sentence can't be read as belonging to a neighbor.
  return pages.map((p, i) => `[[${pageKey(i + 1)}]]\n${p}\n[[end of ${pageKey(i + 1)}]]`).join('\n\n');
}

// Insert a clause as its own paragraph on a given page (1-based), at a stable spot.
export function withClause(pages, page, clause, slot) {
  const copy = pages.slice();
  const paras = copy[page - 1].split('\n\n');
  const at = Math.max(1, Math.min(paras.length, slot ?? Math.ceil(paras.length / 2)));
  paras.splice(at, 0, clause);
  copy[page - 1] = paras.join('\n\n');
  return { pages: copy, paragraphs: paras, inserted: at };
}

export function cleanClause(text) {
  let t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 280);
  if (t && !/[.!?]$/.test(t)) t += '.';
  return t;
}

export function presetExists(id) { return Object.hasOwn(presets, id); }

// ---------- Visitor documents (kept in memory only, never written anywhere) ----------
export const MAX_TOKENS = 300_000;
export const MAX_PAGES = 250; // a SubQ choice question allows up to 255 options
export const estimateTokens = (chars) => Math.ceil(chars / 4);

const words = (s) => s.split(/\s+/).filter(Boolean).length;

function splitLong(p, limit) {
  if (words(p) <= limit) return [p];
  const sentences = p.match(/[^.!?;]+[.!?;]+["')\]]*\s*|[^.!?;]+$/g) || [p];
  const out = []; let cur = '';
  for (const s of sentences) {
    if (cur && words(cur + s) > limit) { out.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// Turn pasted text into pages of roughly equal length, breaking at paragraphs.
export function paginateText(text) {
  const clean = String(text).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\[\[(end of )?P\d+\]\]/g, '').trim();
  let paras = clean.split(/\n\s*\n/).map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  if (paras.length < 4) paras = clean.split(/\n/).map((p) => p.trim()).filter(Boolean);
  const total = words(clean);
  const perPage = Math.max(380, Math.ceil(total / MAX_PAGES));
  paras = paras.flatMap((p) => splitLong(p, perPage));
  const pages = [[]]; let wc = 0;
  for (const p of paras) {
    const w = words(p);
    if (wc > 0 && wc + w > perPage * 1.1) { pages.push([]); wc = 0; }
    pages[pages.length - 1].push(p); wc += w;
  }
  return pages.map((ps) => ps.join('\n\n'));
}

// PDFs arrive with real pages. Keep them unless there are too many to choose between.
export function normalizePages(pages) {
  const list = pages.map((p) => String(p || '').replace(/\[\[(end of )?P\d+\]\]/g, '').trim() || '(This page has no text.)');
  if (list.length <= MAX_PAGES) return { pages: list, regrouped: false };
  return { pages: paginateText(list.join('\n\n')), regrouped: true };
}
