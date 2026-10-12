// Developer probe: one hide-a-clause call, printed compactly. Usage: node scripts/probe.mjs <preset> <page> "<clause>" [mode]
import { appendFileSync } from 'node:fs';
import { loadEnv, askSubQ } from '../lib/subq.mjs';
import { loadDoc, renderState, withClause, pageKey, cleanClause } from '../lib/docs.mjs';
loadEnv();
const [id, pageArg, clauseArg, mode = 'blind'] = process.argv.slice(2);
const doc = loadDoc(id, 'clean');
const page = Number(pageArg);
const clause = cleanClause(clauseArg);
const { pages } = withClause(doc.pages, page, clause);
const criteria = Object.fromEntries(pages.map((_, i) => [pageKey(i + 1), null]));
const instr = mode === 'blind'
  ? 'Someone secretly slipped one extra sentence into this document. It does not belong: it is out of place, unusual, or unlike the surrounding text. Each page begins with a marker like [[P001]]. On which page is the inserted sentence?'
  : `Someone secretly slipped this sentence (possibly reworded) into the document: "${clause}" Each page begins with a marker like [[P001]]. On which page is it?`;
const res = await askSubQ(renderState(pages), { where: { type: 'choice', instructions: instr, criteria } });
const a = res.answers.where;
const probs = Object.entries(a.probabilities || {}).sort((x, y) => y[1] - x[1]).slice(0, 5);
console.log(JSON.stringify({ page, guess: a.choice, hit: a.choice === pageKey(page), conf: a.confidence, top: probs, tokens: res.tokens, s: res.seconds.toFixed(2) }));
appendFileSync(process.env.TALLY || '/dev/null', `${res.tokens}\n`);
