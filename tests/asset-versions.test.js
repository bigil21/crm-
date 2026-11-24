// Asset versions are worked out by the server from each file's content
// (to-do item 14). Nobody bumps "?v=" numbers by hand any more: a missed bump
// used to keep old code in every browser for up to a year.
// Nothing here touches a network or a real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const fingerprint = (body) => crypto.createHash('sha256').update(body).digest('hex').slice(0, 12);
const LONG_LIVED = /max-age=31536000, immutable/;

// The real server, with file reads that a test can count and replace.
function server({ env = {}, files = {}, unreadable = [] } = {}) {
  let route;
  const reads = [];
  const replaced = new Map(Object.entries(files).map(([name, text]) => [path.join(root, name), text]));
  const missing = new Set(unreadable.map((name) => path.join(root, name)));
  const context = vm.createContext({ console, URL, Buffer, AbortSignal, __dirname: root, module: { exports: {} },
    process: { env },
    require(name) {
      if (name === 'http') return { createServer: (handler) => { route = handler; return {}; } };
      if (name === 'fs') return { existsSync: () => false, readFile(file, callback) {
        reads.push(path.relative(root, file).replace(/\\/g, '/'));
        if (missing.has(file)) callback(Object.assign(Error('gone'), { code: 'ENOENT' }));
        else if (replaced.has(file)) callback(null, Buffer.from(replaced.get(file)));
        else fs.readFile(file, callback);
      } };
      return require(name);
    },
    fetch: async () => { throw Error('An asset test must not use the network'); },
  });
  vm.runInContext(serverSource, context);
  const request = (url, method = 'GET') => new Promise((resolve, reject) => {
    const headers = {};
    const response = { setHeader(key, value) { headers[key] = value; },
      writeHead(status, values) { this.status = status; Object.assign(headers, values); },
      end(body) { resolve({ status: this.status, headers, raw: body ? Buffer.from(body) : Buffer.alloc(0), body: body?.toString() || '' }); } };
    const incoming = { url, method, headers: { host: 'localhost' }, on() { return incoming; }, destroy() {} };
    try { route(incoming, response); } catch (error) { reject(error); }
  });
  const set = (name, text) => replaced.set(path.join(root, name), text);
  return { request, reads, set };
}

const references = (text) => [...text.matchAll(/["'`(]((?:\.\/|\/)?[\w\-./]+\.(?:js|mjs|css|svg|png|webmanifest))\?v=([\w.-]+)/g)]
  .map((match) => ({ path: `/${match[1].replace(/^\.?\//, '')}`, version: match[2] }));
const versionIn = (text, name) => references(text).find((reference) => reference.path === name)?.version;

for (const page of ['/', '/login', '/logout', '/portal']) {
  test(`every file ${page} loads is addressed by the fingerprint of what the server sends for it`, async () => {
    const h = server();
    const html = await h.request(page);
    assert.equal(html.status, 200);
    assert.match(html.headers['Cache-Control'], /no-store/, 'the page itself is never kept');
    const found = references(html.body).filter((reference) => reference.path !== '/auth-config.js');
    assert.ok(found.length >= 2, 'the page refers to versioned files');
    for (const reference of found) {
      const file = await h.request(`${reference.path}?v=${reference.version}`);
      assert.equal(file.status, 200, reference.path);
      assert.equal(reference.version, fingerprint(file.raw), `${reference.path} is addressed by its own content`);
      assert.match(file.headers['Cache-Control'], LONG_LIVED, `${reference.path} can be kept by the browser`);
    }
  });
}

test('the numbers written in the source files are ignored, so a missed bump cannot serve old code', async () => {
  const written = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const before = server();
  const first = versionIn((await before.request('/')).body, '/app.js');
  assert.notEqual(first, versionIn(written, '/app.js'), 'the hand-written number is not what browsers are given');

  // The same release with one line of app.js changed and no number touched.
  const changed = fs.readFileSync(path.join(root, 'app.js'), 'utf8') + '\n// changed\n';
  const after = server({ files: { 'app.js': changed } });
  const page = (await after.request('/')).body;
  const second = versionIn(page, '/app.js');
  assert.notEqual(second, first, 'a changed file gets a new address');
  assert.equal(versionIn(page, '/styles.css'), versionIn((await before.request('/')).body, '/styles.css'), 'an unchanged file keeps its address');
  const sent = await after.request(`/app.js?v=${second}`);
  assert.match(sent.body, /\n\/\/ changed\n$/, 'and that address serves the changed file');
  assert.equal(fingerprint(sent.raw), second);
});

test('an address with an old or missing version is re-checked every time, never kept for a year', async () => {
  const h = server();
  const current = versionIn((await h.request('/')).body, '/app.js');
  assert.match((await h.request(`/app.js?v=${current}`)).headers['Cache-Control'], LONG_LIVED);
  for (const url of ['/app.js', '/app.js?v=184', '/app.js?v=', `/app.js?v=${current}0`, '/styles.css?v=91', '/sw.js']) {
    const response = await h.request(url);
    assert.equal(response.status, 200, url);
    assert.equal(response.headers['Cache-Control'], 'no-cache', url);
  }
});

test('a script that loads another file changes its own address when that file changes', async () => {
  const worker = fs.readFileSync(path.join(root, 'image-worker.js'), 'utf8');
  const before = server();
  const after = server({ files: { 'image-worker.js': `${worker}\n// changed\n` } });
  const appBefore = (await before.request('/app.js')).body;
  const appAfter = (await after.request('/app.js')).body;
  assert.equal(versionIn(appBefore, '/image-worker.js'), fingerprint(Buffer.from(worker)));
  assert.notEqual(versionIn(appAfter, '/image-worker.js'), versionIn(appBefore, '/image-worker.js'), 'app.js points at the new worker');
  assert.notEqual(versionIn((await after.request('/')).body, '/app.js'), versionIn((await before.request('/')).body, '/app.js'),
    'so the page points at a new app.js, and no browser keeps the one that loads the old worker');
  for (const name of ['/vendor/jspdf.umd.min.js', '/vendor/pdf.min.mjs', '/vendor/pdf.worker.min.mjs']) {
    assert.equal(versionIn(appBefore, name), fingerprint((await before.request(name)).raw), name);
  }
});

test('files with no references are sent exactly as they are on disk', async () => {
  const h = server();
  for (const name of ['styles.css', 'record-writes.js', 'icon-192.png', 'vendor/jspdf.umd.min.js']) {
    const sent = await h.request(`/${name}`);
    assert.ok(sent.raw.equals(fs.readFileSync(path.join(root, name))), name);
  }
});

test('only real public files are restamped: sign-in addresses and the generated configuration are left alone', async () => {
  const h = server();
  const page = (await h.request('/')).body;
  const written = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.equal(versionIn(page, '/auth-config.js'), versionIn(written, '/auth-config.js'));
  assert.equal((await h.request('/login.js')).body, fs.readFileSync(path.join(root, 'login.js'), 'utf8'), 'the entry address in login.js is untouched');
  assert.equal((await h.request('/logout.js')).body, fs.readFileSync(path.join(root, 'logout.js'), 'utf8'));
  // A reference to a file the server does not publish is left as written.
  const odd = server({ files: { 'login.html': '<script src="server.js?v=1"></script><script src="login.js?v=1"></script>' } });
  const body = (await odd.request('/login')).body;
  assert.match(body, /"server\.js\?v=1"/);
  assert.doesNotMatch(body, /"login\.js\?v=1"/);
  assert.equal((await odd.request('/server.js?v=1')).status, 404);
});

test('the offline cache is renamed whenever any file it can hold changes', async () => {
  const name = (text) => text.match(/const CACHE_NAME = "(jobcrest-crm-[^"]+)";/)[1];
  const before = name((await server().request('/sw.js')).body);
  assert.match(before, /^jobcrest-crm-[0-9a-f]{12}$/);
  assert.equal(name((await server().request('/sw.js')).body), before, 'the same files give the same name');
  const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  assert.notEqual(name((await server({ files: { 'styles.css': `${styles}\n/* changed */\n` } }).request('/sw.js')).body), before);
  // The worker still clears every older cache of ours, whatever it was called.
  assert.match(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), /\/\^\(jobcrest-crm-\|roofline-crm-\)\/\.test\(key\) && key !== CACHE_NAME/);
});

test('a deployed release reads each file once; a developer copy picks up edits without a restart', async () => {
  const deployed = server({ env: { RENDER_GIT_COMMIT: 'abc1234' } });
  const first = (await deployed.request('/')).body;
  const readsAfterFirstPage = deployed.reads.length;
  assert.equal(new Set(deployed.reads).size, deployed.reads.length, 'no file was read twice');
  await deployed.request('/');
  await deployed.request(`/app.js?v=${versionIn(first, '/app.js')}`);
  await deployed.request('/styles.css');
  assert.equal(deployed.reads.length, readsAfterFirstPage, 'later requests read nothing');

  const local = server();
  const before = versionIn((await local.request('/')).body, '/styles.css');
  local.set('styles.css', 'body { color: red; }');
  assert.notEqual(versionIn((await local.request('/')).body, '/styles.css'), before);
});

test('two files that refer to each other cannot hang the server', async () => {
  const h = server({ env: { RENDER_GIT_COMMIT: 'abc1234' }, files: {
    'login.js': 'import("/logout.js?v=1");',
    'logout.js': 'import("/login.js?v=1");',
  } });
  const [login, logout] = await Promise.all([h.request('/login.js'), h.request('/logout.js')]);
  assert.equal(login.status, 200);
  assert.equal(logout.status, 200);
  assert.match(login.body, /\/logout\.js\?v=[0-9a-f]{12}/);
  assert.match(logout.body, /\/login\.js\?v=[0-9a-f]{12}/);
});

test('a file that cannot be read is a 404, and a page that refers to it still loads', async () => {
  const h = server({
    files: { 'login.html': '<link rel="stylesheet" href="styles.css?v=1"><script src="portal.js?v=7"></script>' },
    unreadable: ['portal.js'],
  });
  const page = await h.request('/login');
  assert.equal(page.status, 200);
  assert.match(page.body, /"portal\.js\?v=7"/, 'the unreadable file keeps its reference as written');
  assert.match(page.body, /"styles\.css\?v=[0-9a-f]{12}"/);
  assert.equal((await h.request('/portal.js')).status, 404);
});
