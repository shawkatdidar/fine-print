import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export * from './pages.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DOCS = path.join(ROOT, 'documents');
const cache = new Map();

// Returns { pages: [string], index } where pages[0] is page 1 (text without marker).
export function loadDoc(id, variant = 'full') {
  const k = `${id}:${variant}`;
  if (cache.has(k)) return cache.get(k);
  const text = readFileSync(path.join(DOCS, `${id}${variant === 'clean' ? '.clean' : ''}.txt`), 'utf8');
  const pages = text.split(/\[\[P\d{3}\]\]\n/).slice(1).map((p) => p.trim());
  const index = JSON.parse(readFileSync(path.join(DOCS, 'index.json'), 'utf8'))[id];
  const doc = { pages, index };
  cache.set(k, doc);
  return doc;
}
