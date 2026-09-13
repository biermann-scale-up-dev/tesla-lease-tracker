// Never persist private API responses in the service worker cache.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => new Response('<!doctype html><html lang="de"><meta name="viewport" content="width=device-width"><title>Offline</title><body><h1>Du bist offline</h1><p>Deine Fahrten werden auf dem Server erfasst. Verbinde dich mit dem Internet und lade die App erneut.</p></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
  }
});
