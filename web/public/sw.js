// Offline play. Pages and scripts come from the network when there is one, so a new deploy
// shows up on the next load; art, fonts and sound effects come from the cache first because
// they never change under the same name without a new build. Music is left to the browser:
// it streams with range requests, which a cached copy answers badly on some phones.
const CACHE = "actual-gameplay-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const put = async (request, response) => {
  if (response.ok && response.status === 200) (await caches.open(CACHE)).put(request, response.clone());
  return response;
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.endsWith(".mp3")) return;
  const fixed = /\/(art|fonts|audio\/sfx)\//.test(url.pathname) || /\/assets\//.test(url.pathname);
  if (fixed) {
    event.respondWith(caches.match(request).then((hit) => hit ?? fetch(request).then((r) => put(request, r))));
  } else {
    event.respondWith(fetch(request).then((r) => put(request, r)).catch(() => caches.match(request, { ignoreSearch: true })));
  }
});
