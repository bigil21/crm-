const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

function server(env = {}, user = null) {
  let route; const reads = [], outbound = [];
  const context = vm.createContext({ console, URL, Buffer, AbortSignal, __dirname: root, module: { exports: {} },
    process: { env },
    require(name) {
      if (name === 'http') return { createServer: handler => { route = handler; return {}; } };
      if (name === 'fs') return { existsSync: () => false, readFile(file, callback) { reads.push(file); fs.readFile(file, callback); } };
      if (name === 'https') throw Error('A release test must not contact Square');
      return require(name);
    },
    fetch: async (url, options) => { outbound.push({ url, options }); return { ok: Boolean(user), json: async () => user }; },
  });
  vm.runInContext(serverSource, context);
  const request = (url, method = 'GET', authorization = '') => new Promise((resolve, reject) => {
    const headers = {};
    const response = { setHeader(key, value) { headers[key] = value; },
      writeHead(status, values) { this.status = status; Object.assign(headers, values); },
      end(body) { resolve({ status: this.status, headers, body: body?.toString() || '' }); } };
    try { route({ url, method, headers: { host: 'localhost', authorization } }, response); } catch (error) { reject(error); }
  });
  return { request, reads, outbound, context };
}

for (const url of ['/server.js', '/.env', '/.env.local', '/.git/config', '/square-payments.json', '/package.json',
  '/supabase/schema.sql', '/tests/server-release.test.js', '/diagnostics.html', '/role-direct-check-v56.js',
  '/role-direct-launch.html', '/hard-reset-v60.html', '/unknown', '/%2eenv', '/%2e%2e/server.js', '/%2fserver.js', '/%5cserver.js']) {
  test(`private or diagnostic route is denied without file reads: ${url}`, async () => {
    const h = server(); const r = await h.request(url); assert.equal(r.status, 404); assert.equal(h.reads.length, 0);
    assert.equal((await h.request(url, 'HEAD')).status, 404);
  });
}

const publicRoutes = ['/', '/login', '/logout', '/reset-session.html', '/index.html', '/login.html', '/logout.html',
  '/app.js?v=124', '/auth.js', '/login.js', '/logout.js', '/sw.js', '/styles.css', '/manifest.webmanifest',
  '/icon.svg', '/icon-192.png', '/icon-512.png', '/vendor/jspdf.umd.min.js', '/production-flow-v64.js',
  '/workflow-checklists-v65.js', '/project-conversations-v67.js'];
for (const url of publicRoutes) test(`current application asset remains available: ${url}`, async () => {
  const h = server(); const r = await h.request(url); assert.equal(r.status, 200); assert.ok(r.body.length);
  assert.equal(r.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(r.headers['X-Frame-Options'], 'DENY');
  assert.equal((await h.request(url, 'HEAD')).body, '');
});

test('every local script, stylesheet and manifest used by the current login/app remains available', async () => {
  const h = server();
  for (const name of ['index.html', 'login.html', 'logout.html', 'reset-session.html']) {
    const html = fs.readFileSync(path.join(root, name), 'utf8');
    for (const match of html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
      const value = match[1]; if (/^(?:https?:|#|data:)/.test(value)) continue;
      assert.equal((await h.request('/' + value.replace(/^\.\//, '').replace(/^\//, ''))).status, 200, `${name}: ${value}`);
    }
  }
});

test('malformed URLs return controlled errors and static writes are rejected', async () => {
  const h = server(); assert.equal((await h.request('/%E0%A4%A')).status, 400);
  assert.equal((await h.request('/app.js', 'POST')).status, 405); assert.equal(h.reads.length, 0);
});

test('login redirects, fresh HTML and health/config work without database migrations', async () => {
  const h = server({ AUTH_REQUIRED: 'true', SUPABASE_SYNC_ENABLED: 'true', SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'sb_publishable_synthetic' });
  assert.equal((await h.request('/login/')).headers.Location, '/login');
  assert.equal((await h.request('/logout/')).headers.Location, '/logout');
  const html = await h.request('/'); assert.match(html.headers['Cache-Control'], /no-store/);
  const health = JSON.parse((await h.request('/api/health')).body);
  assert.equal(health.authRequired, true); assert.equal(health.cloudSyncConfigured, true);
  assert.equal(health.release, 'full-audit-repairs-20260921');
  const config = (await h.request('/auth-config.js')).body; assert.match(config, /"authRequired":true/);
  assert.equal(h.outbound.length, 0);
});

for (const env of [{}, { AUTH_REQUIRED: 'false' }, { NODE_ENV: 'production', ALLOW_LOCAL_DEMO: 'true', AUTH_REQUIRED: 'false' }]) {
  test(`authentication defaults closed: ${JSON.stringify(env)}`, async () => {
    const h = server(env);
    for (const url of ['/api/square/create-invoice', '/api/square/payment-status']) assert.equal((await h.request(url, 'POST')).status, 401);
    assert.equal(h.outbound.length, 0);
  });
}
test('only an explicit development demo may bypass authentication', async () => {
  const h = server({ NODE_ENV: 'development', ALLOW_LOCAL_DEMO: 'true', AUTH_REQUIRED: 'false' });
  assert.equal(JSON.parse((await h.request('/api/health')).body).authRequired, false);
});
test('valid company admin and sales authorization stays compatible', async () => {
  const env = { AUTH_REQUIRED: 'true', SUPABASE_URL: 'https://example.invalid', SUPABASE_ANON_KEY: 'sb_publishable_synthetic' };
  const admin = server(env, { id: 'admin-user', email: 'admin@coastalcrestroofing.com', app_metadata: { role: 'admin' } });
  assert.equal((await admin.request('/api/square/create-invoice', 'POST', 'Bearer synthetic')).status, 400, 'admin reaches trusted request validation');
  const sales = server(env, { id: 'sales-user', email: 'sales@coastalcrestroofing.com', app_metadata: { role: 'sales' } });
  assert.equal((await sales.request('/api/square/create-invoice', 'POST', 'Bearer synthetic')).status, 403);
  assert.equal((await sales.request('/api/square/payment-status', 'POST', 'Bearer synthetic')).status, 400);
  const outsider = server(env, { id: 'outsider-user', email: 'outsider@example.invalid', app_metadata: { role: 'admin' } });
  assert.equal((await outsider.request('/api/square/create-invoice', 'POST', 'Bearer synthetic')).status, 401);
});

function worker(options = {}) {
  const listeners = {}, deleted = [], cached = [];
  const response = { ok: true, type: 'basic', clone() { return this; }, marker: 'network' };
  const context = vm.createContext({ URL,
    self: { location: { origin: 'https://example.invalid' }, addEventListener: (name, fn) => { listeners[name] = fn; },
      skipWaiting: async () => {}, clients: { claim: async () => {} } },
    fetch: async () => response,
    caches: { keys: async () => ['jobcrest-crm-v131', 'roofline-crm-v1', 'unrelated-cache'],
      delete: async key => { deleted.push(key); },
      open: async () => ({ put: async key => { cached.push(key); } }), match: async () => null,
    }, ...options,
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), context);
  return { listeners, deleted, cached, response, context };
}
test('worker does not intercept HTML, APIs, auth configuration, diagnostics, private paths or cross-origin files', () => {
  const h = worker();
  for (const url of ['/', '/index.html', '/login', '/auth-config.js', '/api/health', '/server.js', '/diagnostics.html', 'https://other.invalid/app.js']) {
    let intercepted = false;
    h.listeners.fetch({ request: { url: new URL(url, 'https://example.invalid').href, method: 'GET' }, respondWith() { intercepted = true; } });
    assert.equal(intercepted, false, url);
  }
});
test('worker install has no diagnostic prefetch; activation removes only owned old caches', async () => {
  const h = worker(); let pending;
  h.listeners.install({ waitUntil: value => { pending = value; } }); await pending;
  h.listeners.activate({ waitUntil: value => { pending = value; } }); await pending;
  assert.deepEqual(h.deleted, ['jobcrest-crm-v131', 'roofline-crm-v1']);
});
test('worker returns fresh public asset even when browser cache writes fail', async () => {
  const h = worker(); h.context.caches.open = async () => { throw Error('quota'); }; let pending;
  h.listeners.fetch({ request: { url: 'https://example.invalid/app.js?v=124', method: 'GET' }, respondWith: value => { pending = value; } });
  assert.equal(await pending, h.response);
});
