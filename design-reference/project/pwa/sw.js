/* Réelgram — minimal service worker (offline shell cache).
   Works only over http(s). For real production, generate this with your
   build tool (Vite PWA / Workbox) and add runtime caching for the API. */
const CACHE = "reelgram-shell-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./pwa-app.jsx",
  "./manifest.webmanifest",
  "../styles.css",
  "../data.jsx",
  "../components.jsx",
  "../screens-login.jsx",
  "../screens-main.jsx",
  "../screens-import.jsx",
  "../screens-player.jsx",
  "../screens-direction.jsx",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  // network-first for navigations, cache-first for assets
  if (request.mode === "navigate") {
    e.respondWith(fetch(request).catch(() => caches.match("./index.html")));
    return;
  }
  e.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
      return res;
    }).catch(() => hit))
  );
});
