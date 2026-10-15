// Caches only this shell's own same-origin files (so the empty frame +
// loading screen can open instantly / offline once installed). RUDMS
// itself loads cross-origin inside the iframe and is never intercepted
// here, so the actual app content always loads live and stays fully
// functional - this service worker's only job is making the SHELL
// installable, which Apps Script's own sandboxed iframe can't reliably
// do on its own (see the note in the main Index.html's <head>).
var CACHE_NAME = 'rudms-shell-v1';
var SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(SHELL_FILES); })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // never touch RUDMS's own cross-origin requests

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      return cached || fetch(event.request);
    })
  );
});
