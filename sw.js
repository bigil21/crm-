const CACHE_NAME = "roofline-crm-v69";
const APP_SHELL = [
  "./",
  "./index.html",
  "./login.html",
  "./logout.html",
  "./reset-session.html",
  "./hard-reset-v60.html",
  "./diagnostics.html",
  "./role-diagnostics.html",
  "./role-security-check.html",
  "./role-direct-launch.html",
  "./role-direct-check.js",
  "./role-direct-check-v56.js",
  "./role-direct-check-v57.js",
  "./sales-workflow-launch.html",
  "./sales-workflow-check-v61.js",
  "./system-check-launch.html",
  "./system-check-v62.js",
  "./production-flow-launch.html",
  "./production-flow-v64.js",
  "./workflow-checklists-v65.js",
  "./project-conversations-v67.js",
  "./production-flow-check-v64.js",
  "./profit-role-test.html",
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
  "./login.js?v=58",
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

function isCrmIndexPath(url) {
  return url.pathname === "/" || url.pathname.endsWith("/index.html");
}

function isHtmlShellPath(url) {
  return url.pathname === "/" || url.pathname === "/login" || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/login.html");
}

function patchIndexHtml(html, url) {
  let patched = html
    .replaceAll('auth-config.js?v=24', 'auth-config.js?v=46')
    .replaceAll('auth.js?v=24', 'auth.js?v=43')
    .replaceAll('login.js?v=44', 'login.js?v=58')
    .replaceAll('login.js?v=46', 'login.js?v=58');

  if (isCrmIndexPath(url) && !patched.includes("production-flow-v64.js")) {
    patched = patched.replace(
      "</body>",
      '    <script src="production-flow-v64.js?v=64" defer></script>\n  </body>',
    );
  }

  if (isCrmIndexPath(url) && !patched.includes("workflow-checklists-v65.js")) {
    patched = patched.replace(
      "</body>",
      '    <script src="workflow-checklists-v65.js?v=66" defer></script>\n  </body>',
    );
  }

  if (isCrmIndexPath(url) && !patched.includes("project-conversations-v67.js")) {
    patched = patched.replace(
      "</body>",
      '    <script src="project-conversations-v67.js?v=69" defer></script>\n  </body>',
    );
  }

  if (url.searchParams.has("role-direct-check") && !patched.includes("role-direct-check-v57.js")) {
    patched = patched.replace(
      "</body>",
      '    <script>window.__ROOFLINE_DIRECT_ROLE_CHECK = true;</script>\n    <script src="role-direct-check-v57.js?v=57" defer></script>\n  </body>',
    );
  }

  if (url.searchParams.has("sales-workflow-check") && !patched.includes("sales-workflow-check-v61.js")) {
    patched = patched.replace(
      "</body>",
      '    <script>window.__ROOFLINE_SALES_WORKFLOW_CHECK = true;</script>\n    <script src="sales-workflow-check-v61.js?v=61" defer></script>\n  </body>',
    );
  }

  if (url.searchParams.has("system-check") && !patched.includes("system-check-v62.js")) {
    patched = patched.replace(
      "</body>",
      '    <script>window.__ROOFLINE_SYSTEM_CHECK = true;</script>\n    <script src="system-check-v62.js?v=62" defer></script>\n  </body>',
    );
  }

  if (url.searchParams.has("production-flow-check") && !patched.includes("production-flow-check-v64.js")) {
    patched = patched.replace(
      "</body>",
      '    <script>window.__ROOFLINE_PRODUCTION_FLOW_CHECK = true;</script>\n    <script src="production-flow-check-v64.js?v=64" defer></script>\n  </body>',
    );
  }

  return patched;
}

async function freshHtmlResponse(request) {
  const response = await fetch(request);
  const url = new URL(request.url);
  if (!isHtmlShellPath(url)) return response;

  const headers = new Headers(response.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");

  const html = await response.text();
  return new Response(patchIndexHtml(html, url), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (
    url.pathname === "/auth-config.js" ||
    url.pathname === "/logout" ||
    url.pathname === "/reset-session.html"
  ) {
    event.respondWith(fetch(event.request));
    return;
  }
  // Always fetch HTML fresh so new deploys and diagnostics are not blocked by stale cache.
  if (isHtmlShellPath(url) || url.pathname.endsWith(".html")) {
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