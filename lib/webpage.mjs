// Fetches a public terms or policy page and turns it into plain text.
// Shared by server.mjs (Node) and worker/index.js (Cloudflare): both have fetch built in.
// The page is held in memory for one request and never stored or logged.

const MAX_BYTES = 5 * 1024 * 1024;

// `browser: true` means a real browser could probably still read it (the browser extension tries that).
export class LinkError extends Error {
  constructor(message, { browser = false } = {}) { super(message); this.browser = browser; }
}

// Local and private network addresses: the server must never be used to peek inside a network.
function isPrivateHost(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (!h.includes('.') && !h.includes(':')) return true;
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (h.includes(':')) return h === '::1' || h === '::' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('::ffff:');
  return false;
}

export function checkLink(raw) {
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { throw new LinkError('That doesn’t look like a web address. It should start with https://'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new LinkError('Only web links (https://…) can be read.');
  if (url.username || url.password || isPrivateHost(url.hostname)) throw new LinkError('That link can’t be read from here. Try a public web page.');
  return url;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', copy: '©', reg: '®', trade: '™', sect: '§', middot: '·', bull: '•' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Keep the main text; drop menus, scripts, cookie banners and the like.
export function htmlToText(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decode(titleMatch[1]).replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  let body = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const main = body.match(/<main[\s>][\s\S]*<\/main>/i) || body.match(/<article[\s>][\s\S]*<\/article>/i);
  if (main && main[0].length > 2000) body = main[0];
  body = body
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|select|button|form)[\s>][\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|header|footer|aside)[\s>][\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[\s>]/gi, '\n\n• <li ')
    .replace(/<\/?(p|div|section|article|main|h[1-6]|li|ul|ol|table|tr|blockquote|pre|dd|dt|dl)[^>]*>/gi, '\n\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<[^>]+>/g, '');
  const text = decode(body)
    .replace(/[ \t ]+/g, ' ')
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter((p) => p && p !== '•')
    .join('\n\n');
  return { title, text };
}

export async function fetchLink(raw) {
  let url = checkLink(raw);
  let response;
  // Follow redirects by hand so every hop gets the same private-address check.
  for (let hop = 0; hop < 5; hop++) {
    try {
      response = await fetch(url, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FinePrint/1.0; +https://fineprint.buildtube.app)', Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5' },
        signal: AbortSignal.timeout(12000),
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') throw new LinkError('That page took too long to load. Try again, or copy the text and paste it instead.', { browser: true });
      throw new LinkError('Couldn’t reach that page. Check the link, or copy the text and paste it instead.', { browser: true });
    }
    if (response.status < 300 || response.status >= 400) break;
    const next = response.headers.get('location');
    if (!next) break;
    url = checkLink(new URL(next, url).href);
    if (hop === 4) throw new LinkError('That link redirects too many times. Open it in your browser and copy the text instead.');
  }
  if ([401, 403, 429, 503].includes(response.status)) throw new LinkError('That site doesn’t let other servers read its pages. Open it in your browser, copy the text and paste it here.', { browser: true });
  if (!response.ok) throw new LinkError(`That page answered with an error (${response.status}). Check the link, or copy the text and paste it instead.`);

  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (type.includes('pdf')) throw new LinkError('That link is a PDF. Download it, then drop the file in above.');
  if (type && !type.includes('html') && !type.includes('text/plain') && !type.includes('xml')) throw new LinkError('That link isn’t a web page. Try the page that shows the terms.');

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BYTES) { reader.cancel(); throw new LinkError('That page is too large to read here. Copy just the terms and paste them instead.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.length; }
  const raw2 = new TextDecoder('utf-8').decode(bytes);

  const { title, text } = type.includes('text/plain') ? { title: '', text: raw2.trim() } : htmlToText(raw2);
  if (text.length < 1500) throw new LinkError('That page shows its text only after it loads in a browser, so it can’t be read from the link. Open it, copy the text and paste it here.', { browser: true });
  return { title: cleanTitle(title, url.hostname), text, url: url.href };
}

// "Terms of Service – Privacy & Terms – Google" reads better as "Terms of Service · Google".
export function cleanTitle(title, host) {
  const parts = String(title || '').split(/\s+[|–—·•-]\s+/).map((t) => t.trim()).filter(Boolean);
  if (!parts.length) return host;
  const site = parts.length > 1 ? parts[parts.length - 1] : '';
  const main = (parts.length > 2 ? parts.slice(0, -1) : parts.slice(0, 1)).reduce((x, y) => (y.length > x.length ? y : x));
  return (site && site.toLowerCase() !== main.toLowerCase() ? `${main} · ${site}` : main).slice(0, 90);
}
