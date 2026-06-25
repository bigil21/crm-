const CACHE_NAME = "roofline-crm-v37";
const APP_SHELL = [
  "./",
  "./index.html",
  "./login.html",
  "./logout.html",
  "./styles.css?v=32",
  "./app.js?v=37",
  "./auth.js?v=24",
  "./login.js",
  "./logout.js",
  "./vendor/jspdf.umd.min.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname === "/auth-config.js" || url.pathname === "/login" || url.pathname === "/logout") {
    event.respondWith(fetch(event.request));
    return;
  }
  // Always fetch HTML fresh — never serve from cache
  if (url.pathname === "/" || url.pathname.endsWith(".html")) {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      });
    }),
  );
});
