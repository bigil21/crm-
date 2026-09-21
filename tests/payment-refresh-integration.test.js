const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const helper = require('../payment-refresh.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness(options = {}) {
  const sent = deferred(), reply = deferred();
  const state = { estimates: [{ id: 'estimate', contactId: 'lead', jobId: 'job', squareInvoiceId: 'invoice',
    contractValue: 32000, paidAmount: 0, items: [{ title: 'Roof', rate: 32000 }] }] };
  const messages = [], touched = [], requestDetails = []; let current = true, role = 'admin', saves = 0, renders = 0, requests = 0, reloads = 0, captures = 0, collections = 0;
  const c = vm.createContext({ console, state, squarePollInFlight: false, durableWriteBlocked: false, AbortSignal,
    authSession: { user: { id: 'admin-A', email: 'admin@example.invalid', app_metadata: { role: 'admin' } } },
    window: { ROOFLINE_SUPABASE_CONFIG: { squarePaymentWorkerEnabled: options.worker },
      CrmPaymentRefresh: { ...helper, capture(...args) { captures++; return helper.capture(...args); },
        collect(...args) { collections++; return helper.collect(...args); } },
      RooflineAuth: { isEditorSessionCurrent: () => current } },
    currentRole: () => role, number: value => Number(value) || 0, totalsFor: () => ({ total: 32000 }),
    squareApiHeaders: async () => options.headers ? options.headers(c) : ({ Authorization: 'Bearer synthetic' }),
    fetch: async (url, init) => { requests++; requestDetails.push({ url, init }); sent.resolve(init.body ? JSON.parse(init.body) : null); return reply.promise; },
    getContact: () => ({ id: 'lead' }), contactJobs: () => [{ id: 'job' }],
    saveState: () => saves++, render: () => renders++, document: { activeElement: { tagName: 'INPUT' } },
    reloadDurableRecords: () => { reloads++; throw Error('Payment status must not force hydration'); },
    updateJobPaymentSnapshot: (...args) => touched.push(args), setPaymentRefreshStatus: message => messages.push(message),
  });
  vm.runInContext(source.match(/^async function pollSquarePayments\([^]*?^}/m)[0], c);
  return { c, state, messages, touched, requestDetails, sent: sent.promise, get saves() { return saves; }, get renders() { return renders; }, get requests() { return requests; },
    get reloads() { return reloads; }, get captures() { return captures; }, get collections() { return collections; },
    invalidate() { current = false; }, demote() { role = 'sales'; },
    respondStatus(status, ok = true) { reply.resolve({ ok, json: async () => status }); },
    respond(ok = true) { reply.resolve({ ok, json: async () => ({ payments: { invoice: { invoiceId: 'invoice', leadId: 'lead', jobId: 'job',
      paidAmount: 16000, contractAmount: 16000, status: 'PARTIALLY_PAID', updatedAt: '2026-09-14T00:00:00Z', paymentRequests: [] } } }) }); },
  };
}
test('payment integration preserves contract and active input while scheduling confirmed refresh fields', async () => {
  const h = harness(); const pending = h.c.pollSquarePayments();
  assert.deepEqual(await h.sent, { invoiceIds: ['invoice'] }); h.respond(); await pending;
  assert.equal(h.state.estimates[0].contractValue, 32000); assert.equal(h.state.estimates[0].paidAmount, 16000);
  assert.equal(h.state.estimates[0].paymentPercent, 50); assert.equal(h.saves, 1); assert.equal(h.renders, 0);
  assert.deepEqual(h.touched, [['lead', 'job']]); assert.equal(h.c.squarePollInFlight, false);
});
test('payment integration discards replies after logout, demotion or a blocked write', async () => {
  for (const invalidate of [h => h.invalidate(), h => h.demote(), h => { h.c.durableWriteBlocked = true; }]) {
    const h = harness(); const pending = h.c.pollSquarePayments(); await h.sent; invalidate(h); h.respond(); await pending;
    assert.equal(h.state.estimates[0].paidAmount, 0); assert.equal(h.saves, 0); assert.equal(h.messages.length, 0);
  }
});
test('payment integration does not replace estimate edits made during its request', async () => {
  const h = harness(); const pending = h.c.pollSquarePayments(); await h.sent;
  h.state.estimates[0].items[0].title = 'New typing'; h.respond(); await pending;
  assert.equal(h.state.estimates[0].items[0].title, 'New typing'); assert.equal(h.state.estimates[0].paidAmount, 0);
  assert.equal(h.saves, 0); assert.equal(h.messages.at(-1), helper.STALE_MESSAGE);
});
test('missing jobs and failed refreshes retain balances and expose delayed status', async () => {
  for (const missingJob of [true, false]) {
    const h = harness(); const pending = h.c.pollSquarePayments(); await h.sent;
    if (missingJob) h.c.contactJobs = () => [];
    h.respond(missingJob); await pending;
    assert.equal(h.saves, 0); assert.equal(h.state.estimates[0].paidAmount, 0);
    assert.equal(h.messages.at(-1), helper.STALE_MESSAGE);
  }
});
test('polling remains single-flight', async () => {
  const h = harness(); const first = h.c.pollSquarePayments(); await h.sent;
  await h.c.pollSquarePayments(); assert.equal(h.requests, 1); h.respond(); await first;
});

const syncStatus = overrides => ({ enabled: true, pending: 0, review: 0, lastProcessedAt: null, ...overrides });
const assertWorkerReadOnly = h => {
  assert.equal(h.saves, 0);
  assert.equal(h.renders, 0);
  assert.equal(h.reloads, 0);
  assert.equal(h.captures, 0);
  assert.equal(h.collections, 0);
  assert.deepEqual(h.touched, []);
  assert.equal(h.state.estimates[0].paidAmount, 0);
  assert.equal(h.state.estimates[0].contractValue, 32000);
  assert.equal(h.c.squarePollInFlight, false);
};

test('enabled worker mode reads sync status only and does not disturb active typing', async () => {
  const h = harness({ worker: true }); const pending = h.c.pollSquarePayments();
  assert.equal(await h.sent, null);
  assert.equal(h.requestDetails[0].url, '/api/square/sync-status');
  assert.equal(h.requestDetails[0].init.method, 'GET');
  assert.equal(h.requestDetails[0].init.headers.Authorization, 'Bearer synthetic');
  assert.equal(h.requestDetails[0].init.body, undefined);
  assert.ok(h.requestDetails[0].init.signal instanceof AbortSignal);
  h.state.estimates[0].items[0].title = 'Still typing';
  h.respondStatus(syncStatus({ lastProcessedAt: '2026-09-15T10:00:00Z' })); await pending;
  assertWorkerReadOnly(h);
  assert.equal(h.state.estimates[0].items[0].title, 'Still typing');
  assert.deepEqual(h.messages, ['']);
});

test('worker review count displays persistent guidance ahead of a delayed queue', async () => {
  const h = harness({ worker: true }); const pending = h.c.pollSquarePayments(); await h.sent;
  h.respondStatus(syncStatus({ review: 2, pending: 4, oldestPendingAt: new Date(Date.now() - 600000).toISOString() })); await pending;
  assert.equal(h.messages.at(-1), '2 payment updates need administrator review; last confirmed balances are shown.');
  assertWorkerReadOnly(h);
});

for (const [name, fields, expected] of [
  ['old queue', { pending: 3, oldestPendingAt: new Date(Date.now() - 600000).toISOString() }, '3 payment updates are queued; last confirmed balances are shown.'],
  ['recent queue', { pending: 3, oldestPendingAt: new Date(Date.now() - 60000).toISOString() }, ''],
  ['optional missing queue age', { pending: 3 }, ''],
  ['optional null queue age', { pending: 3, oldestPendingAt: null }, ''],
  ['zero queue', { pending: 0, oldestPendingAt: new Date(Date.now() - 600000).toISOString() }, ''],
  ['future queue timestamp', { pending: 3, oldestPendingAt: new Date(Date.now() + 600000).toISOString() }, ''],
]) {
  test(`worker ${name} does not write or redraw financial state`, async () => {
    const h = harness({ worker: true }); const pending = h.c.pollSquarePayments(); await h.sent;
    h.respondStatus(syncStatus(fields)); await pending;
    assert.equal(h.messages.at(-1), expected); assertWorkerReadOnly(h);
  });
}

for (const [name, status, ok = true] of [
  ['disabled worker', syncStatus({ enabled: false })],
  ['string flag', syncStatus({ enabled: 'true' })],
  ['missing enabled', syncStatus({ enabled: undefined })],
  ['negative pending', syncStatus({ pending: -1 })],
  ['fractional pending', syncStatus({ pending: 0.5 })],
  ['string pending', syncStatus({ pending: '1' })],
  ['unsafe pending', syncStatus({ pending: Number.MAX_SAFE_INTEGER + 1 })],
  ['negative review', syncStatus({ review: -1 })],
  ['missing review', syncStatus({ review: undefined })],
  ['invalid processed timestamp', syncStatus({ lastProcessedAt: 'not-a-date' })],
  ['missing processed timestamp', syncStatus({ lastProcessedAt: undefined })],
  ['invalid pending timestamp', syncStatus({ oldestPendingAt: 'not-a-date' })],
  ['empty pending timestamp', syncStatus({ oldestPendingAt: '' })],
  ['null payload', null],
  ['array payload', []],
  ['HTTP failure', syncStatus(), false],
]) {
  test(`worker ${name} warns of delay without falling back to browser provider writes`, async () => {
    const h = harness({ worker: true }); const pending = h.c.pollSquarePayments(); await h.sent;
    h.respondStatus(status, ok); await pending;
    assert.equal(h.messages.at(-1), helper.STALE_MESSAGE);
    assert.equal(h.requests, 1); assertWorkerReadOnly(h);
  });
}

test('worker network and malformed JSON failures retain confirmed balances', async () => {
  for (const fail of [async () => { throw Error('network unavailable'); },
    async () => ({ ok: true, json: async () => { throw Error('malformed JSON'); } })]) {
    const h = harness({ worker: true }); h.c.fetch = fail;
    await h.c.pollSquarePayments();
    assert.equal(h.messages.at(-1), helper.STALE_MESSAGE); assertWorkerReadOnly(h);
  }
});

test('worker status replies remain silent after logout, demotion, account replacement or a blocked write', async () => {
  for (const invalidate of [h => h.invalidate(), h => h.demote(), h => { h.c.durableWriteBlocked = true; },
    h => { h.c.authSession.user = { id: 'admin-B', email: 'other@example.invalid', app_metadata: { role: 'admin' } }; }]) {
    const h = harness({ worker: true }); const pending = h.c.pollSquarePayments(); await h.sent;
    invalidate(h); h.respondStatus(syncStatus({ review: 3 })); await pending;
    assert.equal(h.messages.length, 0); assertWorkerReadOnly(h);
  }
});

test('worker request is not issued if the session changes during auth refresh', async () => {
  const started = deferred(), headers = deferred();
  const h = harness({ worker: true, headers: () => { started.resolve(); return headers.promise; } });
  const pending = h.c.pollSquarePayments(); await started.promise;
  h.invalidate(); headers.resolve({ Authorization: 'Bearer synthetic' }); await pending;
  assert.equal(h.requests, 0); assert.equal(h.messages.length, 0); assertWorkerReadOnly(h);
});

test('worker sync-status polling remains single-flight even with no local invoice IDs', async () => {
  const h = harness({ worker: true }); h.state.estimates[0].squareInvoiceId = '';
  const first = h.c.pollSquarePayments(); await h.sent;
  await h.c.pollSquarePayments(); assert.equal(h.requests, 1);
  h.respondStatus(syncStatus()); await first; assertWorkerReadOnly(h);
});

test('only explicit true enables worker mode; false retains the staged compatibility path', async () => {
  for (const flag of [false, undefined, 'true']) {
    const h = harness({ worker: flag }); const pending = h.c.pollSquarePayments(); await h.sent;
    assert.equal(h.requestDetails[0].url, '/api/square/payment-status');
    h.respond(); await pending;
    assert.equal(h.collections, 1); assert.equal(h.saves, 1);
  }
});
test('payment helper is shipped before app and included in public asset and syntax lists', () => {
  const read = name => fs.readFileSync(require.resolve(`../${name}`), 'utf8');
  const html = read('index.html'); assert.ok(html.indexOf('payment-refresh.js') < html.indexOf('src="app.js'));
  for (const name of ['server.js', 'sw.js', 'package.json']) assert.ok(read(name).includes('payment-refresh.js'), name);
});
