import { pageKey } from './pages.mjs';

const pageCriteria = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [pageKey(i + 1), null]));

export function readQuestions(p, pageCount, withWhere = true) {
  const who = p.you === 'you'
    ? `the user who accepts these Terms. In the question, "you" and "your" mean the user, and "they" and "them" mean ${p.drafter} ("Mossbook")`
    : `the ${p.you}. In the question, "you" and "your" mean ${p.B}, and "they", "them" and "their" mean ${p.drafter} ("${p.A}")`;
  const qs = {};
  for (const q of p.questions) {
    qs[q.key] = {
      type: 'noul',
      instructions: `Read the entire ${p.title} carefully, including every exhibit. Answer from the point of view of ${who}. Question: ${q.ask || q.q} Answer yes only if some clause in the document actually says so; a later or more specific clause can override general boilerplate.`,
    };
    if (withWhere) qs[`where_${q.key}`] = {
      type: 'choice',
      instructions: `Each page of the document begins with a marker like [[P001]]. Which page contains the clause that best answers this question (\"you\" means ${p.B}; \"they\" means ${p.A}): ${q.ask || q.q}`,
      criteria: pageCriteria(pageCount),
    };
  }
  return qs;
}

export const HIDE_INSTRUCTIONS = 'Someone secretly slipped one extra sentence into this document. It does not belong: it is out of place, unusual, or unlike the surrounding text. Each page begins with a marker like [[P001]] and ends with a marker like [[end of P001]]. On which page is the inserted sentence?';

export function hideQuestions(pageCount) {
  return {
    where: { type: 'choice', instructions: HIDE_INSTRUCTIONS, criteria: pageCriteria(pageCount) },
    kind: {
      type: 'choice',
      instructions: 'Someone secretly slipped one extra sentence into this document that does not belong there. Find it. What does that inserted sentence mainly do to the person signing?',
      criteria: {
        money: 'Takes money from them (a fee, charge or payment)',
        rights: 'Takes away a right or freedom (to sue, complain, leave or speak)',
        data: 'Uses or exposes their data or privacy',
        lockin: 'Locks them in or makes leaving hard',
        absurd: 'Something absurd or comic that no real contract would say',
        harmless: 'Nothing harmful',
      },
    },
    unfair: {
      type: 'noul',
      instructions: 'Someone secretly slipped one extra sentence into this document that does not belong there. Find it. Is that inserted sentence unfair to the person signing?',
    },
  };
}

// General questions for a visitor's own agreement. "Yes" is bad news for the signer.
export const OWN_QUESTIONS = [
  { key: 'renew', q: 'Does it renew automatically unless you cancel?' },
  { key: 'price', q: 'Can they raise the price or add fees on their own?' },
  { key: 'change', q: 'Can they change the terms without your agreement?' },
  { key: 'exit', q: 'Is it hard or costly for you to cancel or leave?' },
  { key: 'end', q: 'Can they end it whenever they want?' },
  { key: 'unlimited', q: 'Could you owe unlimited damages or costs?' },
  { key: 'capped', q: 'Is what they owe you capped or excluded?' },
  { key: 'data', q: 'Can they share or sell your data?' },
  { key: 'content', q: 'Do they get rights to your content, work or ideas?' },
  { key: 'sue', q: 'Have you given up your right to sue or join a class action?' },
  { key: 'penalty', q: 'Are there penalties, late fees or surprise charges?' },
  { key: 'restrict', q: 'Are you restricted from working with others or competing?' },
  { key: 'guarantee', q: 'Are you personally guaranteeing anything?' },
  { key: 'assign', q: 'Can they hand the agreement to someone else without asking?' },
];

export function ownQuestions(pageCount) {
  const who = 'In each question, "you" and "your" mean the party who would sign or accept this agreement but did not write it (for example the customer, user, tenant, buyer, client or employee). "They", "them" and "their" mean the other party, usually the one who drafted it.';
  const qs = {};
  for (const q of OWN_QUESTIONS) {
    qs[q.key] = { type: 'noul', instructions: `Read the entire agreement carefully. ${who} Question: ${q.q} Answer yes only if some clause in the document actually says so.` };
    qs[`where_${q.key}`] = { type: 'choice', instructions: `Each page begins with a marker like [[P001]] and ends with [[end of P001]]. ${who} Which page contains the clause that best answers this question: ${q.q}`, criteria: pageCriteria(pageCount) };
  }
  return qs;
}
