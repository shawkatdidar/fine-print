// Developer probe: full read of one preset, compared with ground truth. Usage: node scripts/probe-read.mjs <preset> [nowhere]
import { appendFileSync } from 'node:fs';
import { loadEnv, askSubQ } from '../lib/subq.mjs';
import { loadDoc, renderState, pageKey } from '../lib/docs.mjs';
import { presets } from '../lib/presets.mjs';
import { readQuestions } from '../lib/questions.mjs';
loadEnv();
const [id, flag] = process.argv.slice(2);
const p = presets[id];
const doc = loadDoc(id, 'full');
const res = await askSubQ(renderState(doc.pages), readQuestions(p, doc.pages.length, flag !== 'nowhere'));
let ok = 0;
for (const q of p.questions) {
  const a = res.answers[q.key]; const w = res.answers[`where_${q.key}`];
  const yes = a.noul >= 0.5; if (yes === q.expect) ok++;
  const truth = q.trap ? doc.index.trapPages[q.trap] : '-';
  console.log(`${yes === q.expect ? 'ok ' : 'BAD'} ${q.key.padEnd(14)} p(yes)=${a.noul.toFixed(2)} expect=${q.expect} where=${w?.choice} (${w?.confidence?.toFixed(2)}) truth=${truth}`);
}
console.log(`${ok}/${p.questions.length} correct, tokens=${res.tokens}, ${res.seconds.toFixed(2)}s`);
appendFileSync(process.env.TALLY || '/dev/null', `${res.tokens}\n`);
