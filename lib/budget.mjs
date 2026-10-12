// Keeps track of the gifted SubQ tokens. SubQ has no balance endpoint (checked docs.subq.ai,
// October 2026), so we count usage.input_tokens from every real call in a small JSON file.
// Only numbers are stored here, never document text.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, 'data');
const FILE = path.join(DIR, 'usage.json');

const num = (v, d) => (Number.isFinite(Number(v)) && String(v).trim() !== '' ? Number(v) : d);
export const config = () => ({
  budget: num(process.env.GIFT_BUDGET, 100_000_000),
  usedBefore: num(process.env.GIFT_USED_BEFORE, 0), // tokens spent before this counter existed
  reserve: num(process.env.GIFT_RESERVE, 1_000_000), // stop live calls when this little is left
  perHour: num(process.env.RATE_LIMIT_PER_HOUR, 30),
  perMinute: num(process.env.RATE_LIMIT_PER_MINUTE, 6),
});

function load() {
  try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch { return { tracked: 0, calls: 0, since: new Date().toISOString() }; }
}

// Read fresh from disk each time so separate processes (server, test scripts) share one total.
export function recordUsage(tokens) {
  if (!tokens) return;
  const u = load();
  u.tracked += tokens; u.calls += 1; u.updated = new Date().toISOString();
  mkdirSync(DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(u, null, 2));
  renameSync(tmp, FILE);
}

export function gift() {
  const c = config();
  const u = load();
  const used = c.usedBefore + u.tracked;
  const remaining = Math.max(0, c.budget - used);
  return { budget: c.budget, used, remaining, paused: remaining <= c.reserve };
}

export function canAfford(estimatedTokens) {
  const c = config();
  return gift().remaining - estimatedTokens > c.reserve;
}

// Per-visitor limit on live calls (saved results never count).
const hits = new Map();
export function allowLive(ip) {
  const c = config();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 3600_000);
  const lastMinute = list.filter((t) => now - t < 60_000).length;
  if (list.length >= c.perHour || lastMinute >= c.perMinute) { hits.set(ip, list); return false; }
  list.push(now);
  hits.set(ip, list);
  return true;
}
