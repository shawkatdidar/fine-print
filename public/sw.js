// Fine Print's service worker. It exists so phones can install Fine Print as an app,
// which is what puts it in the Android share menu. It never caches results or documents:
// pages always come from the network, and only when the network is down does it show a short note.
const OFFLINE = new Response(
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fine Print</title>' +
  '<body style="font:17px -apple-system,system-ui,sans-serif;padding:40px 24px;text-align:center;color:#1d1d1f">' +
  '<h1 style="font-size:28px">You’re offline.</h1><p style="color:#55555a">Fine Print needs a connection to read the terms. Try again when you’re back online.</p>',
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => OFFLINE.clone()));
});
