const CACHE_NAME = "roofline-crm-v48";
const APP_SHELL = [
  "./",
  "./index.html",
  "./login.html",
  "./logout.html",
  "./reset-session.html",
  "./diagnostics.html",
  "./role-diagnostics.html",
  "./auth-config.js",
  "./auth-config.js?v=43",
  "./auth-config.js?v=46",
  "./styles.css?v=32",
  "./styles.css?v=34",
  "./app.js?v=37",
  "./app.js?v=40",
  "./auth.js?v=24",
  "./auth.js?v=25",
  "./auth.js?v=43",
  "./login.js",
  "./login.js?v=44",
  "./login.js?v=46",
  "./logout.js",
  "./logout.js?v=44",
  "./logout.js?v=46",
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

async function freshHtmlResponse(request) {
  const response = await fetch(request);
  const url = new URL(request.url);
  if (!(url.pathname === "/" || url.pathname.endsWith("/index.html"))) return response;

  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");

  const html = await response.text();
  return new Response(
    html
      .replaceAll('auth-config.js?v=24', 'auth-config.js?v=46')
      .replaceAll('auth.js?v=24', 'auth.js?v=43'),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (
    url.pathname === "/auth-config.js" ||
    url.pathname === "/login" ||
    url.pathname === "/logout" ||
    url.pathname === "/reset-session.html"
  ) {
    event.respondWith(fetch(event.request));
    return;
  }
  // Always fetch HTML fresh so new deploys and diagnostics are not blocked by stale cache.
  if (url.pathname === "/" || url.pathname.endsWith(".html")) {
    event.respondWith(freshHtmlResponse(event.request));
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
