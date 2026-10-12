// Zips extension/ into public/get/fine-print-extension.zip, the file the "Use it anywhere" page offers.
// Inside the zip it's one folder, fine-print-extension/, ready for Chrome's "Load unpacked".
import { cpSync, rmSync, mkdtempSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'public', 'get', 'fine-print-extension.zip');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'fine-print-'));
cpSync(path.join(ROOT, 'extension'), path.join(tmp, 'fine-print-extension'), { recursive: true, filter: (src) => !path.basename(src).startsWith('.') });
mkdirSync(path.dirname(OUT), { recursive: true });
rmSync(OUT, { force: true });
execFileSync('zip', ['-rqX', OUT, 'fine-print-extension'], { cwd: tmp });
rmSync(tmp, { recursive: true, force: true });
console.log('Packed public/get/fine-print-extension.zip');
