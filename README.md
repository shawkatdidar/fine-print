# Fine Print

Nobody reads the fine print, but SubQ Snap reads every word. This is a small local demo that shows off what a long-context decision model can do with a long agreement.

## How to run it

1. Make sure `.env` in this folder contains `SUBQ_API_KEY=...`. The key stays on the server and is never sent to the browser. `.env.example` lists every setting.
2. In this folder, run `npm run dev`.
3. Open http://127.0.0.1:4174.

There's nothing to install. It uses plain Node (version 20 or newer) and no packages. Reading PDFs and Word files uses two libraries loaded in the browser from cdnjs, at pinned versions: pdf.js 3.11.174 and mammoth 1.8.0.

## What it shows

**Read the whole thing.** Pick one of three fictional agreements (a 164-page supply contract, a 120-page shop lease or a 132-page app terms of service), or bring your own. One tap and SubQ reads the entire document in a single call. It answers 13 to 16 plain-English yes/no questions and points to the page behind each answer. While it works, a reading head sweeps the page map with a running page and token count. When it finishes, the time is stamped and the flagged pages lift out of the map one by one. Tap a flagged page to read it.

**Bring your own agreement.** Drop in a PDF, a Word file (.docx) or a text file, or paste the text. Older .doc files aren't supported. The page adds page markers automatically, so the report card and the hide-a-clause game both work on it. PDFs keep their real page numbers. Pasted text is split into pages of about 400 words, and very long documents are regrouped into at most 250 sections, because a SubQ choice question allows up to 255 options. The limit is about 300,000 tokens, estimated as characters ÷ 4. Your text is sent to SubQ for the read and is never written to disk or to the logs. Reloading the page forgets it, and share links aren't offered for your own documents for the same reason.

**Paste a link.** On the "Your own" screen, visitors can paste a link to a terms of service or privacy policy page instead of a file. The server fetches the page (a browser isn't allowed to read another site's page directly), strips menus and scripts, and drops the text into the paste box so it can be trimmed before reading. The code is in `lib/webpage.mjs`, shared by `server.mjs` and the Worker. It refuses local and private network addresses, follows at most five redirects, stops at 5 MB, and has its own per-visitor limit so fetching links never uses up someone's reads. Pages that only show their text after JavaScript runs, and PDF links, get a plain message asking the visitor to paste the text or drop the file instead. Fetched text is never stored or logged.

**Hide a clause.** Write a sneaky clause, or tap one of the realistic examples, which are written in the document's own legal tone: a personal guarantee, a fee that starts after a year, a quiet auto-renewal with a 12-month notice window, a class-action waiver, sharing data with "affiliates and marketing partners", a change-the-terms-anytime clause, a short deadline for bringing claims, or account deletion after inactivity. None of them repeats a clause already planted in that document. The clause is slipped onto a random page deep in the document, and SubQ has to find it without being told what it says. The map lights up where SubQ looked. For the samples, a clean copy is used so the only odd clause is yours.

**Same job on a frontier model.** After every run, two columns race side by side: SubQ Snap and Claude Opus 5.5 doing the same job. Each shows elapsed time, tokens and cost ticking live on a shared clock. SubQ replays its real measured run and stamps "Done". Opus keeps going, fast-forwarded once SubQ finishes, to its estimated finish, and then the "× faster · × cheaper" line appears. Opus is never called. Its numbers carry a small "est." marker and come from one fair equivalent call with the whole document plus all the questions. The constants sit in one block at the top of `public/app.js`:

- Price: $4.00 per million input tokens and $20.00 per million output tokens.
- Output: about 1,500 thinking tokens plus 60 tokens per answer.
- Speed: reading at 10,000 tokens per second and writing at 80 tokens per second. Anthropic doesn't publish exact speeds, so these are deliberately generous to Opus. No network time is added.
- Input: the same token count SubQ reported. Different models count tokens slightly differently.

For the 164-page sample read, that comes out at about 54 seconds and 51¢ for Opus, against 4.2 seconds and 0.5¢ measured for SubQ: roughly 13 times faster and 90 times cheaper. For a hide-a-clause run (1.5 seconds and 0.4¢), Opus would take about 30 seconds and 39¢.

**Share.** Every result gets a share card image with the two-column race on it. Sample results also get a link that reopens the same agreement, page and clause.

**The gift meter.** The header shows how much of the 100M gifted tokens is left. SubQ has no balance or usage endpoint (checked on docs.subq.ai: only `/v1/models` and the decision call exist, and an empty account returns HTTP 402). So the server adds `usage.input_tokens` from every real call to `data/usage.json`, which holds numbers only and survives restarts. Saved results don't move the meter. Settings in `.env`:

- `GIFT_BUDGET`: the gift, 100,000,000.
- `GIFT_USED_BEFORE`: tokens spent before the counter existed. It's set to 3,485,000: about 1.5M from earlier experiments plus about 1.99M spent building and testing this demo.
- `GIFT_RESERVE`: live calls stop when this much is left (1,000,000). Saved results keep working, and visitors see a kind message.
- `RATE_LIMIT_PER_HOUR` and `RATE_LIMIT_PER_MINUTE`: live calls per visitor, by IP address (30 and 6).

## Use it anywhere

The moment people need Fine Print is when a sign-up or checkout asks them to tap "I agree", usually on a phone, inside another app. Four pieces meet them there. The page at `#/anywhere` explains each one in plain steps, with the visitor's own device listed first.

**A link that reads itself.** `/?url=<terms address>` opens straight into a reading. So do `?text=` and `?title=`, which is how phones share, since Android often puts the link inside the shared text. The server fetches the page, SubQ reads it, and the address changes to `#/r/<id>`, a link to that report anyone can open. Public terms pages aren't private, so these results are saved by a fingerprint of the page text (`link-<id>.json` in `cache/` locally, the Durable Object on Cloudflare). The same terms come back instantly and use no tokens. Files, pasted text and text sent by the extension are still never saved.

**Android Share menu.** `public/manifest.webmanifest` makes Fine Print installable as an app, and its `share_target` adds it to the Share menu. The how-to page shows an Install button when Chrome offers one. `public/sw.js` only exists because installing needs one: it never caches anything, and it shows a short note when the phone is offline.

**iPhone Share menu.** iPhones don't let websites join the Share menu, so `public/get/fine-print.shortcut` is a signed Shortcut that opens `/?url=` with the shared link. Rebuild it with `python3 scripts/build-shortcut.py` (it needs a Mac signed in to an Apple ID; pass another address to point it at your own copy). For apps with no Share button, the link box on the "Your own" screen pastes from the clipboard with one tap.

**Browser extension** (`extension/`, for Chrome, Edge, Brave and Arc). When a page asks you to agree to terms, a small "Check it first" button appears in the corner. One click and the answers appear in a panel on the page, with tabs when there's both a Terms and a Privacy link. It counts a page as asking you to agree when a terms link sits inside a short sentence like "you agree to our Terms" and next to a form, dialog, checkbox or button. Footers and long article text don't count. In testing, it fired on Vercel, Linear and Notion sign-ups and on test pages, including a dialog that appears late. It stayed quiet on Wikipedia, BBC News and a footer-only page. Sites that block servers or build their text with JavaScript (Instagram's terms, for example) are opened in a background tab, read there and closed, which took 3.3 seconds in testing. The toolbar button lists every terms link on a page and can read the page itself. The right-click menu adds "Check these terms with Fine Print". Nothing is read until you click. Settings let you turn the button off, quiet it on one site, or point it at your own server. Run `npm run pack-extension` to rebuild `public/get/fine-print-extension.zip`; the Cloudflare build does this too. People install it with "Load unpacked" in `chrome://extensions`, since it isn't in the Chrome Web Store.

## Measured results (12 October 2026)

**Reading.** Every one of the 44 yes/no answers was correct across the three samples, and all 21 planted clauses were located on their exact page. A full read took 1.6 to 4.2 seconds, varying from run to run. On an uploaded 19-page PDF excerpt, SubQ flagged its one nasty clause on the right page in 3.9 seconds.

**Hide a clause.** With the early joke examples (a live goose and so on), SubQ found the clause on the exact page in 9 of 10 placements. With the new realistic examples, it found 6 of 7 on the exact page, usually in 0.9 to 1.5 seconds, though often with lower confidence (14% to 83%), since realistic clauses blend in. The one miss was the 90-day claim deadline in the supply contract, which reads like ordinary boilerplate; SubQ's guess had only 3% confidence, and the app says so. On the uploaded PDF, it found a hidden fee clause on page 7 of 19 in 0.7 seconds, 91% sure.

Marking both the start and the end of every page (`[[P058]]` … `[[end of P058]]`) fixed an early off-by-one miss.

## Cost

At $0.05 per million input tokens:

| Action | Tokens | Cost |
| --- | --- | --- |
| Read the supply contract | about 110,000 | 0.5¢ |
| Read the lease | about 84,000 | 0.4¢ |
| Read the terms of service | about 70,000 | 0.4¢ |
| Hide a clause in a sample | 57,000 to 89,000 | 0.3 to 0.4¢ |
| Read your own document | about 1 token per 4 characters, plus a little for the questions | up to about 1.5¢ at the 300K limit |

Sample reads and hide results are saved in `cache/`, so replays and share links cost nothing. "Read it live again" makes a fresh call.

## Files

- `server.mjs` serves the app and is the only thing that talks to SubQ.
- `lib/` holds the questions, the planted clauses, the SubQ client, the gift counter (`budget.mjs`) and the page helpers.
- `documents/` holds the generated sample agreements. Run `npm run generate` to rebuild them, then delete `cache/` because the pages will have moved.
- `public/` holds the web page, the install manifest, the service worker and the downloads in `public/get/`.
- `extension/` holds the browser extension. `lib/webpage.mjs` fetches and cleans terms pages for both servers.
- `scripts/probe.mjs` and `scripts/probe-read.mjs` are developer tests. They call SubQ directly, and their usage is counted too.
