import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordUsage } from './budget.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SUBQ_API = 'https://api.subq.ai/v1/systemone';
export const PRICE_PER_MILLION = 0.05; // US dollars per million input tokens

// Tiny .env loader so there are no dependencies. Never logs values.
export function loadEnv() {
  try {
    for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* no .env file: fine */ }
}

export class SubQError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

export async function askSubQ(state, questions, { timeout = 30000 } = {}) {
  const key = process.env.SUBQ_API_KEY;
  if (!key) throw new SubQError('nokey', 'This demo needs a SubQ key in the .env file.');
  const started = performance.now();
  let response;
  try {
    response = await fetch(SUBQ_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'subq-snap-preview', state, questions }),
      signal: AbortSignal.timeout(timeout),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new SubQError('timeout', 'SubQ took too long to answer.');
    throw new SubQError('network', 'Could not reach SubQ.');
  }
  const seconds = (performance.now() - started) / 1000;
  if (response.status === 429) throw new SubQError('rate', 'SubQ is busy right now.');
  if (response.status === 402) throw new SubQError('credits', 'The SubQ account is out of credits.');
  if (response.status === 401 || response.status === 403) throw new SubQError('auth', 'The SubQ key was not accepted.');
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.text()).slice(0, 300); } catch {}
    throw new SubQError('server', `SubQ returned ${response.status}. ${detail}`);
  }
  const data = await response.json();
  const tokens = Number(data?.usage?.input_tokens) || 0;
  recordUsage(tokens); // every real call counts against the gift
  return { answers: data.answers || {}, usage: data.usage || {}, tokens, seconds, cost: tokens / 1e6 * PRICE_PER_MILLION, raw: data };
}
