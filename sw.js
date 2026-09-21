const CACHE_NAME = "jobcrest-crm-v140";
const PUBLIC_ASSET_PATHS = new Set([
  "/app.js", "/record-writes.js", "/company-settings-writes.js", "/sales-numbering.js", "/payment-refresh.js", "/draft-recovery.js", "/session-guard.js", "/auth.js", "/login.js", "/logout.js", "/styles.css",
  "/production-flow-v64.js", "/workflow-checklists-v65.js", "/project-conversations-v67.js",
  "/vendor/jspdf.umd.min.js", "/icon.svg", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest",
]);

self.addEventListener("install", (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => /^(jobcrest-crm-|roofline-crm-)/.test(key) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)),
  )).then(() => self.clients.claim()));
});

// Server HTML is authoritative: never rewrite or downgrade its asset versions.
// Only public static assets are eligible for offline fallback, never customer
// data, configuration, API responses, diagnostics or authenticated pages.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !PUBLIC_ASSET_PATHS.has(url.pathname) || event.request.cache === "no-store") return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok && response.type !== "opaque") {
        // A failed cache write must never discard a fresh public asset response.
        try {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        } catch { /* Public assets are optional offline acceleration. */ }
      }
      return response;
    } catch (error) {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      throw error;
    }
  })());
});
