const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

test('Vercel handler serves original paths and PDF assets while protecting private files and APIs', async () => {
  process.env.CRM_SKIP_ENV_FILES = 'true';
  process.env.AUTH_REQUIRED = 'true';
  const handler = require('../api/index');
  assert.equal(typeof handler, 'function');
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const pathname of ['/login', '/app.js?v=148', '/vendor/pdf.min.mjs?v=1', '/vendor/pdf.worker.min.mjs?v=1']) {
      const response = await fetch(origin + pathname);
      assert.equal(response.status, 200, pathname);
      assert.ok((await response.text()).length, pathname);
    }
    assert.equal((await fetch(origin + '/server.js')).status, 404);
    assert.equal((await fetch(origin + '/.env')).status, 404);
    assert.equal((await fetch(origin + '/api/smart-documents/save', { method: 'POST' })).status, 401);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
