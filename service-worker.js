const cacheName = 'graditor-v20';
const appShell = ['./', './index.html', './graditor.css', './graditor.js', './manifest.webmanifest', './graditor-icon.svg', './graditor-icon-180.png'];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(appShell)));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== cacheName).map(key => caches.delete(key)))));
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET') return;
    event.respondWith(fetch(event.request).then(response => {
        const copy = response.clone();
        caches.open(cacheName).then(cache => cache.put(event.request, copy));
        return response;
    }).catch(() => caches.match(event.request)));
});

self.addEventListener('message', event => {
    if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});