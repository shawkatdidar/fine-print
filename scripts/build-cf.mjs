// Collects everything Cloudflare serves as static files into .cf-assets/:
// the public site, the fictional sample documents (/_docs) and results saved during local testing (/_cache).
import { cpSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'pack-extension.mjs')], { stdio: 'inherit' }); // keep the download current
const OUT = path.join(ROOT, '.cf-assets');
rmSync(OUT, { recursive: true, force: true });
cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
mkdirSync(path.join(OUT, '_docs'));
for (const f of readdirSync(path.join(ROOT, 'documents'))) {
  if (f.endsWith('.txt') || f === 'index.json') cpSync(path.join(ROOT, 'documents', f), path.join(OUT, '_docs', f));
}
cpSync(path.join(ROOT, 'cache'), path.join(OUT, '_cache'), { recursive: true });
console.log('Built .cf-assets');
