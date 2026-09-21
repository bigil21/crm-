// Pure synthetic payment-worker tests: every provider read and store write is mocked.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readSnapshot, create } = require('../square-payment-worker.js');
const scope = { companyId: 'company-1', environment: 'sandbox', merchantId: 'merchant-1' };
const invoiceId = 'inv:1';
const orderId = 'order:1';
const locationId = 'location-1';
const updatedAt = '2026-09-15T12:30:00Z';
const money = amount => ({ amount, currency: 'USD' });
const invoice = (status = 'PARTIALLY_PAID') => ({ id: invoiceId, order_id: orderId, location_id: locationId,
  version: 4, updated_at: updatedAt, status, payment_requests: [
    { uid: 'request-1', request_type: 'DEPOSIT', due_date: '2026-09-15', computed_amount_money: money(5025), total_completed_amount_money: money(5025) },
    { uid: 'request-2', request_type: 'BALANCE', due_date: '2026-10-15', computed_amount_money: money(10050), total_completed_amount_money: money(5025) },
  ] });
const paidInvoice = status => {
  const value = invoice(status); value.payment_requests[1].total_completed_amount_money = money(10050); return value;
};
const order = () => ({ id: orderId, location_id: locationId, tenders: [
  { id: 'payment:1', payment_id: 'payment:1', type: 'CARD', amount_money: money(5025) },
  { id: 'payment:2', payment_id: 'payment:2', type: 'CARD', amount_money: money(10050) },
] });
const payments = () => ({
  'payment:1': { id: 'payment:1', order_id: orderId, location_id: locationId, status: 'COMPLETED', amount_money: money(5025), total_money: money(5025), refunded_money: money(5025) },
  'payment:2': { id: 'payment:2', order_id: orderId, location_id: locationId, status: 'COMPLETED', amount_money: money(10050), total_money: money(10050), refunded_money: money(0) },
});

function provider({ value = invoice(), orderValue = order(), paymentValues = payments(), secondInvoice, fail } = {}) {
  const calls = [];
  let invoiceReads = 0;
  const get = async path => {
    calls.push(path);
    if (fail === path) throw Error('synthetic_private_provider_detail');
    if (path === `/invoices/${encodeURIComponent(invoiceId)}`) {
      invoiceReads++;
      return { invoice: structuredClone(invoiceReads > 1 && secondInvoice !== undefined ? secondInvoice : value) };
    }
    if (path === `/orders/${encodeURIComponent(orderId)}`) return { order: structuredClone(orderValue) };
    if (path.startsWith('/payments/')) {
      const id = decodeURIComponent(path.slice('/payments/'.length));
      assert.ok(Object.hasOwn(paymentValues, id), `Unmocked payment ${id}`);
      return { payment: structuredClone(paymentValues[id]) };
    }
    throw Error(`Unmocked provider read ${path}`);
  };
  return { calls, get, run: options => readSnapshot({ get, invoiceId, expectedOrderId: orderId, ...options }) };
}

function safeFailure(error, retryable) {
  assert.match(error.code, /^[a-z0-9_]{1,80}$/, 'Failures expose a bounded safe machine code');
  assert.equal(typeof error.retryable, 'boolean');
  if (retryable !== undefined) assert.equal(error.retryable, retryable);
  assert.equal(error.message.includes('synthetic_private_provider_detail'), false);
  return true;
}

test('readSnapshot verifies a stable invoice twice and returns exact shared balance without provider writes', async () => {
  const p = provider(); const result = await p.run();
  assert.equal(result.invoiceId, invoiceId); assert.equal(result.orderId, orderId);
  assert.equal(result.version, 4); assert.equal(result.updatedAt, updatedAt); assert.equal(result.status, 'PARTIALLY_PAID');
  assert.equal(result.contractAmount, 150.75); assert.equal(result.paidAmount, 100.50);
  assert.equal(result.paymentPercent, 100.50 / 150.75 * 100);
  assert.equal(result.paymentRequests.length, 2);
  assert.deepEqual(p.calls, ['/invoices/inv%3A1', '/invoices/inv%3A1']);
});

for (const [label, mutate] of [
  ['different invoice ID', value => { value.id = 'inv:other'; }],
  ['unsafe invoice ID', value => { value.id = '../other'; }],
  ['different order ID', value => { value.order_id = 'order:other'; }],
  ['missing order ID', value => { delete value.order_id; }],
  ['unsafe order ID', value => { value.order_id = 'order/other'; }],
  ['missing location', value => { delete value.location_id; }],
  ['unsafe location', value => { value.location_id = '../other'; }],
  ['missing version', value => { delete value.version; }],
  ['negative version', value => { value.version = -1; }],
  ['fractional version', value => { value.version = 1.5; }],
  ['missing provider timestamp', value => { delete value.updated_at; }],
  ['invalid provider timestamp', value => { value.updated_at = 'not-a-date'; }],
  ['unknown status', value => { value.status = 'UNKNOWN'; }],
  ['missing payment requests', value => { delete value.payment_requests; }],
  ['non-array payment requests', value => { value.payment_requests = {}; }],
  ['empty payment requests', value => { value.payment_requests = []; }],
  ['too many payment requests', value => { value.payment_requests = Array.from({ length: 101 }, () => structuredClone(value.payment_requests[0])); }],
  ['missing computed amount', value => { delete value.payment_requests[0].computed_amount_money; }],
  ['negative computed cents', value => { value.payment_requests[0].computed_amount_money.amount = -1; }],
  ['fractional computed cents', value => { value.payment_requests[0].computed_amount_money.amount = 1.5; }],
  ['string computed cents', value => { value.payment_requests[0].computed_amount_money.amount = '5025'; }],
  ['unsafe computed cents', value => { value.payment_requests[0].computed_amount_money.amount = Number.MAX_SAFE_INTEGER + 1; }],
  ['wrong computed currency', value => { value.payment_requests[0].computed_amount_money.currency = 'EUR'; }],
  ['missing computed currency', value => { delete value.payment_requests[0].computed_amount_money.currency; }],
  ['negative paid cents', value => { value.payment_requests[0].total_completed_amount_money.amount = -1; }],
  ['fractional paid cents', value => { value.payment_requests[0].total_completed_amount_money.amount = 1.5; }],
  ['string paid cents', value => { value.payment_requests[0].total_completed_amount_money.amount = '5025'; }],
  ['unsafe paid cents', value => { value.payment_requests[0].total_completed_amount_money.amount = Number.MAX_SAFE_INTEGER + 1; }],
  ['wrong paid currency', value => { value.payment_requests[0].total_completed_amount_money.currency = 'EUR'; }],
  ['missing paid currency', value => { delete value.payment_requests[0].total_completed_amount_money.currency; }],
  ['zero contract total', value => { value.payment_requests.forEach(request => { request.computed_amount_money = money(0); request.total_completed_amount_money = money(0); }); }],
  ['gross paid exceeds contract', value => { value.payment_requests[1].total_completed_amount_money.amount = 20000; }],
  ['sum exceeds safe integer', value => { value.payment_requests.forEach(request => { request.computed_amount_money.amount = Number.MAX_SAFE_INTEGER; }); }],
]) test(`malformed invoice never yields a usable snapshot: ${label}`, async () => {
  const value = invoice(); mutate(value); const p = provider({ value });
  await assert.rejects(p.run(), error => safeFailure(error));
  assert.equal(p.calls.some(path => path.startsWith('/payments/')), false);
});

for (const invalid of [null, [], {}, 'invalid']) test(`invalid provider invoice shape is rejected: ${JSON.stringify(invalid)}`, async () => {
  await assert.rejects(provider({ value: invalid }).run(), error => safeFailure(error));
});

for (const invoiceId of ['', '../other', 'a/b', 'a?b', 'x'.repeat(201), null, 1]) test(`unsafe input invoice ID never reaches provider: ${String(invoiceId)}`, async () => {
  const p = provider(); await assert.rejects(p.run({ invoiceId }), error => safeFailure(error)); assert.equal(p.calls.length, 0);
});

test('provider lookup failures return a safe retryable error, not provider details', async () => {
  await assert.rejects(provider({ fail: '/invoices/inv%3A1' }).run(), error => safeFailure(error, true));
});

test('a snapshot older than the invoice timestamp in its webhook is retryable', async () => {
  const p = provider(); await assert.rejects(p.run({ notBefore: '2026-09-15T12:31:00Z' }), error => safeFailure(error, true));
});

test('a snapshot at the invoice timestamp in its webhook is current enough', async () => {
  const p = provider(); const result = await p.run({ notBefore: updatedAt }); assert.equal(result.paidAmount, 100.50);
});

for (const [label, mutate] of [
  ['version changed', value => { value.version++; }],
  ['timestamp changed', value => { value.updated_at = '2026-09-15T12:31:00Z'; }],
  ['status changed', value => { value.status = 'PAID'; }],
  ['gross paid changed', value => { value.payment_requests[1].total_completed_amount_money.amount++; }],
  ['contract changed', value => { value.payment_requests[1].computed_amount_money.amount++; }],
  ['order association changed', value => { value.order_id = 'order:other'; }],
]) test(`torn provider reads are not accepted: ${label}`, async () => {
  const secondInvoice = invoice(); mutate(secondInvoice);
  const p = provider({ secondInvoice }); await assert.rejects(p.run(), error => safeFailure(error));
  assert.equal(p.calls.filter(path => path.startsWith('/invoices/')).length, 2);
});

test('partial refund subtracts verified payment refunds but leaves request allocations gross', async () => {
  const value = paidInvoice('PARTIALLY_REFUNDED'); const p = provider({ value }); const result = await p.run();
  assert.equal(result.contractAmount, 150.75); assert.equal(result.paidAmount, 100.50);
  assert.equal(result.status, 'PARTIALLY_REFUNDED');
  assert.equal(result.paymentPercent, 100.50 / 150.75 * 100);
  assert.deepEqual(result.paymentRequests, [
    { type: 'DEPOSIT', requestedAmount: 50.25, paidAmount: 50.25, dueDate: '2026-09-15' },
    { type: 'BALANCE', requestedAmount: 100.50, paidAmount: 100.50, dueDate: '2026-10-15' },
  ], 'Square request allocations remain gross; refund allocation must not be invented');
  assert.deepEqual(p.calls, ['/invoices/inv%3A1', '/orders/order%3A1', '/payments/payment%3A1', '/payments/payment%3A2', '/invoices/inv%3A1']);
});

test('full refund reports zero net payment after confirming all completed tenders', async () => {
  const paymentValues = payments(); paymentValues['payment:2'].refunded_money = money(10050);
  const p = provider({ value: paidInvoice('REFUNDED'), paymentValues }); const result = await p.run();
  assert.equal(result.contractAmount, 150.75); assert.equal(result.paidAmount, 0); assert.equal(result.paymentPercent, 0);
  assert.equal(result.status, 'REFUNDED');
});

test('legacy Square tender IDs can identify payments when payment_id is absent', async () => {
  const orderValue = order(); orderValue.tenders = orderValue.tenders.map(tender => ({ ...tender, id: tender.payment_id, payment_id: undefined }));
  const p = provider({ value: paidInvoice('PARTIALLY_REFUNDED'), orderValue }); assert.equal((await p.run()).paidAmount, 100.50);
});

for (const [label, mutate] of [
  ['wrong order ID', value => { value.id = 'order:other'; }],
  ['wrong order location', value => { value.location_id = 'location-other'; }],
  ['missing tender list', value => { delete value.tenders; }],
  ['malformed tender list', value => { value.tenders = {}; }],
  ['empty tender list', value => { value.tenders = []; }],
  ['duplicate payment tender', value => { value.tenders[1] = structuredClone(value.tenders[0]); }],
  ['contradictory tender identifiers', value => { value.tenders[0].id = 'payment:other'; }],
  ['unsafe payment ID', value => { value.tenders[0].payment_id = '../other'; }],
]) test(`refund lookup rejects an invalid order without accepting any balance: ${label}`, async () => {
  const orderValue = order(); mutate(orderValue);
  await assert.rejects(provider({ value: paidInvoice('PARTIALLY_REFUNDED'), orderValue }).run(), error => safeFailure(error));
});

for (const [label, mutate] of [
  ['wrong payment ID', value => { value.id = 'payment:other'; }],
  ['wrong payment order', value => { value.order_id = 'order:other'; }],
  ['wrong payment location', value => { value.location_id = 'location-other'; }],
  ['not completed payment', value => { value.status = 'PENDING'; }],
  ['missing original total', value => { delete value.total_money; }],
  ['negative original total', value => { value.total_money.amount = -1; }],
  ['fractional original total', value => { value.total_money.amount = 1.5; }],
  ['unsafe original total', value => { value.total_money.amount = Number.MAX_SAFE_INTEGER + 1; }],
  ['wrong original total currency', value => { value.total_money.currency = 'EUR'; }],
  ['original payment totals do not match invoice gross', value => { value.total_money.amount++; }],
  ['unsupported tip allocation', value => { value.tip_money = money(1); }],
  ['invalid tip currency', value => { value.tip_money = { amount: 0, currency: 'EUR' }; }],
  ['negative refund', value => { value.refunded_money.amount = -1; }],
  ['fractional refund', value => { value.refunded_money.amount = 1.5; }],
  ['unsafe refund', value => { value.refunded_money.amount = Number.MAX_SAFE_INTEGER + 1; }],
  ['string refund', value => { value.refunded_money.amount = '5025'; }],
  ['wrong refund currency', value => { value.refunded_money.currency = 'EUR'; }],
  ['missing refund currency', value => { delete value.refunded_money.currency; }],
  ['refund exceeds payment', value => { value.refunded_money.amount = 5026; }],
]) test(`refund lookup rejects an invalid payment receipt: ${label}`, async () => {
  const paymentValues = payments(); mutate(paymentValues['payment:1']);
  await assert.rejects(provider({ value: paidInvoice('PARTIALLY_REFUNDED'), paymentValues }).run(), error => safeFailure(error));
});

test('REFUNDED cannot claim success with a positive net balance', async () => {
  await assert.rejects(provider({ value: paidInvoice('REFUNDED') }).run(), error => safeFailure(error));
});

test('PARTIALLY_REFUNDED cannot claim success when the net balance is zero', async () => {
  const paymentValues = payments(); paymentValues['payment:2'].refunded_money = money(10050);
  await assert.rejects(provider({ value: paidInvoice('PARTIALLY_REFUNDED'), paymentValues }).run(), error => safeFailure(error));
});

test('refund reconciliation uses original total_money even if amount_money reflects a different balance', async () => {
  const paymentValues = payments(); paymentValues['payment:1'].amount_money = money(0);
  paymentValues['payment:1'].tip_money = money(0);
  const result = await provider({ value: paidInvoice('PARTIALLY_REFUNDED'), paymentValues }).run();
  assert.equal(result.paidAmount, 100.50);
});

test('refund provider failure is retryable and does not return a gross paid balance', async () => {
  await assert.rejects(provider({ value: paidInvoice('PARTIALLY_REFUNDED'), fail: '/payments/payment%3A2' }).run(), error => safeFailure(error, true));
});

test('refund reconciliation still rejects an invoice that changed during payment reads', async () => {
  const secondInvoice = paidInvoice('PARTIALLY_REFUNDED'); secondInvoice.version++;
  await assert.rejects(provider({ value: paidInvoice('PARTIALLY_REFUNDED'), secondInvoice }).run(), error => safeFailure(error, true));
});

test('provider version must reach the invoice version carried by the webhook', async () => {
  await assert.rejects(provider().run({ minimumVersion: 5 }), error => safeFailure(error, true));
  assert.equal((await provider().run({ minimumVersion: 4 })).version, 4);
});

test('missing optional completed amounts are zero for a genuinely unpaid invoice', async () => {
  const value = invoice('UNPAID'); value.payment_requests.forEach(request => { delete request.total_completed_amount_money; });
  const result = await provider({ value }).run(); assert.equal(result.paidAmount, 0); assert.equal(result.paymentPercent, 0);
  assert.ok(result.paymentRequests.every(request => request.paidAmount === 0));
});

test('pending payment status retains only the provider-confirmed completed money', async () => {
  const result = await provider({ value: invoice('PAYMENT_PENDING') }).run();
  assert.equal(result.status, 'PAYMENT_PENDING'); assert.equal(result.paidAmount, 100.50);
});

const validClaim = () => ({ ...scope, eventId: 'event-1', invoiceId, orderId,
  eventCreatedAt: '2026-09-15T12:31:00Z', invoiceUpdatedAt: updatedAt, invoiceVersion: 4,
  leaseId: '12345678-1234-1234-1234-123456789abc', attempts: 1 });
const validSnapshot = () => ({ invoiceId, orderId, version: 4, updatedAt, status: 'PARTIALLY_PAID',
  contractAmount: 150.75, paidAmount: 100.50, paymentPercent: 100.50 / 150.75 * 100,
  paymentRequests: [{ type: 'DEPOSIT', requestedAmount: 50.25, paidAmount: 50.25, dueDate: '2026-09-15' },
    { type: 'BALANCE', requestedAmount: 100.50, paidAmount: 50.25, dueDate: '2026-10-15' }] });

function workerHarness({ claim, read, apply, fail, workerScope = scope, onError } = {}) {
  const calls = [], errors = [];
  const state = { status: 'pending', snapshot: null, writes: 0, attempts: 0 };
  const store = {
    async claim(fixedScope) {
      calls.push({ action: 'claim', value: structuredClone(fixedScope), frozen: Object.isFrozen(fixedScope) });
      if (claim) return claim(fixedScope, state);
      if (state.status !== 'pending') return null;
      state.attempts++;
      return { ...validClaim(), attempts: state.attempts };
    },
    async apply(current, snapshot) {
      calls.push({ action: 'apply', claim: structuredClone(current), snapshot: structuredClone(snapshot) });
      if (apply) return apply(current, snapshot, state);
      state.snapshot = structuredClone(snapshot); state.writes++; state.status = 'complete';
      return { durable: true, eventId: current.eventId, applied: true };
    },
    async fail(current, code, retryable) {
      calls.push({ action: 'fail', claim: structuredClone(current), code, retryable });
      if (fail) return fail(current, code, retryable, state);
      state.status = retryable ? 'pending' : 'review';
      return { durable: true, eventId: current.eventId, status: state.status };
    },
  };
  const worker = create({ store, scope: workerScope, read: async current => {
    calls.push({ action: 'read', claim: structuredClone(current), frozen: Object.isFrozen(current) });
    return read ? read(current, state) : validSnapshot();
  }, onError: code => { errors.push(code); if (onError) onError(code); } });
  return { worker, store, calls, errors, state };
}

test('worker completes only after the exact event and financial snapshot are durably applied', async () => {
  const h = workerHarness(); const result = await h.worker.tick();
  assert.deepEqual(result, { eventId: 'event-1', status: 'complete' });
  assert.deepEqual(h.calls.map(call => call.action), ['claim', 'read', 'apply']);
  assert.deepEqual(h.calls[0].value, scope); assert.equal(h.calls[0].frozen, true); assert.equal(h.calls[1].frozen, true);
  assert.deepEqual(h.calls[2].claim, validClaim()); assert.deepEqual(h.calls[2].snapshot, validSnapshot());
  assert.deepEqual(h.state.snapshot, validSnapshot()); assert.equal(h.state.writes, 1);
  assert.deepEqual(await h.worker.tick(), { idle: true }); assert.equal(h.state.writes, 1);
});

test('no pending claim is idle and performs no provider read or write', async () => {
  const h = workerHarness({ claim: () => null }); assert.deepEqual(await h.worker.tick(), { idle: true });
  assert.deepEqual(h.calls.map(call => call.action), ['claim']);
});

test('two simultaneous ticks share one in-flight claim and never duplicate processing', async () => {
  let release, signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const h = workerHarness({ read: async () => { signalStarted(); await gate; return validSnapshot(); } });
  const first = h.worker.tick(); await started;
  assert.deepEqual(await h.worker.tick(), { busy: true });
  assert.deepEqual(h.calls.map(call => call.action), ['claim', 'read']);
  release(); assert.deepEqual(await first, { eventId: 'event-1', status: 'complete' });
  assert.equal(h.state.writes, 1);
});

test('worker scope cannot change after construction', async () => {
  const workerScope = { ...scope }; const h = workerHarness({ workerScope });
  workerScope.companyId = 'other-company'; workerScope.environment = 'production'; workerScope.merchantId = 'other-merchant';
  await h.worker.tick(); assert.deepEqual(h.calls[0].value, scope);
});

for (const [label, mutate] of [
  ['company', value => { value.companyId = 'other-company'; }],
  ['environment', value => { value.environment = 'production'; }],
  ['merchant', value => { value.merchantId = 'other-merchant'; }],
  ['event ID', value => { value.eventId = '../other'; }],
  ['invoice ID', value => { value.invoiceId = 'inv/other'; }],
  ['lease ID', value => { value.leaseId = 'not-a-uuid'; }],
  ['missing attempt', value => { delete value.attempts; }],
  ['zero attempts', value => { value.attempts = 0; }],
  ['too many attempts', value => { value.attempts = 11; }],
  ['event timestamp', value => { value.eventCreatedAt = 'not-a-date'; }],
]) test(`unverified claim ${label} stops before reading or updating any invoice`, async () => {
  const current = validClaim(); mutate(current); const h = workerHarness({ claim: () => current });
  await assert.rejects(h.worker.tick(), error => safeFailure(error));
  assert.deepEqual(h.calls.map(call => call.action), ['claim']); assert.equal(h.state.writes, 0);
});

test('provider snapshot for another invoice never reaches apply', async () => {
  const h = workerHarness({ read: () => ({ ...validSnapshot(), invoiceId: 'inv:other' }) });
  assert.deepEqual(await h.worker.tick(), { eventId: 'event-1', status: 'review' });
  assert.equal(h.calls.some(call => call.action === 'apply'), false); assert.equal(h.state.writes, 0);
  assert.equal(h.calls.at(-1).code, 'payment_snapshot_invalid');
});

test('malformed provider money does not overwrite the saved invoice balance', async () => {
  const value = invoice(); value.payment_requests[0].total_completed_amount_money.amount = -1;
  const p = provider({ value }); const h = workerHarness({ read: () => p.run() });
  const original = { ...validSnapshot(), version: 3, paidAmount: 50.25 }; h.state.snapshot = structuredClone(original);
  assert.deepEqual(await h.worker.tick(), { eventId: 'event-1', status: 'review' });
  assert.deepEqual(h.state.snapshot, original); assert.equal(h.state.writes, 0);
  assert.equal(h.calls.some(call => call.action === 'apply'), false);
});

test('provider not yet at the event invoice version stays pending without overwriting the prior balance', async () => {
  const p = provider(); const h = workerHarness({ read: () => p.run({ minimumVersion: 5 }) });
  const original = { ...validSnapshot(), version: 3, paidAmount: 50.25 }; h.state.snapshot = structuredClone(original);
  assert.deepEqual(await h.worker.tick(), { eventId: 'event-1', status: 'pending' });
  assert.deepEqual(h.state.snapshot, original); assert.equal(h.state.writes, 0);
  assert.equal(h.calls.at(-1).retryable, true);
});

test('stale-event database acknowledgement completes its receipt without overwriting a newer invoice', async () => {
  const current = { ...validSnapshot(), version: 5, paidAmount: 150.75, status: 'PAID', paymentPercent: 100 };
  const h = workerHarness({ apply: (claim, _snapshot, state) => {
    state.status = 'complete'; return { durable: true, eventId: claim.eventId, applied: false };
  } });
  h.state.snapshot = structuredClone(current);
  assert.deepEqual(await h.worker.tick(), { eventId: 'event-1', status: 'complete' });
  assert.deepEqual(h.state.snapshot, current); assert.equal(h.state.writes, 0);
});

test('interrupted provider read is safely retried without a partially written balance', async () => {
  let first = true;
  const h = workerHarness({ read: () => { if (first) { first = false; throw Error('synthetic_private_provider_detail'); } return validSnapshot(); } });
  assert.deepEqual(await h.worker.tick(), { eventId: 'event-1', status: 'pending' }); assert.equal(h.state.writes, 0);
  assert.equal(h.calls.at(-1).code, 'payment_processing_unavailable'); assert.equal(h.calls.at(-1).retryable, true);
  assert.deepEqual(await h.worker.tick(), { eventId: 'event-1', status: 'complete' });
  assert.equal(h.state.writes, 1); assert.equal(h.state.attempts, 2);
  assert.deepEqual(h.errors, ['payment_processing_unavailable']);
});

test('failed shared apply retries the same event after a fresh provider read', async () => {
  let first = true;
  const h = workerHarness({ apply: (claim, snapshot, state) => {
    if (first) { first = false; throw Error('synthetic_private_provider_detail'); }
    state.snapshot = structuredClone(snapshot); state.writes++; state.status = 'complete';
    return { durable: true, eventId: claim.eventId, applied: true };
  } });
  assert.deepEqual(await h.worker.tick(), { eventId: 'event-1', status: 'pending' }); assert.equal(h.state.writes, 0);
  assert.deepEqual(await h.worker.tick(), { eventId: 'event-1', status: 'complete' }); assert.equal(h.state.writes, 1);
  assert.equal(h.calls.filter(call => call.action === 'read').length, 2);
  assert.deepEqual(h.calls.filter(call => call.action === 'apply').map(call => call.claim.eventId), ['event-1', 'event-1']);
});

for (const [label, receipt] of [
  ['missing acknowledgement', undefined], ['null acknowledgement', null],
  ['missing durable flag', { eventId: 'event-1', applied: true }],
  ['false durable flag', { durable: false, eventId: 'event-1', applied: true }],
  ['string durable flag', { durable: 'true', eventId: 'event-1', applied: true }],
  ['wrong event receipt', { durable: true, eventId: 'event-other', applied: true }],
  ['missing applied flag', { durable: true, eventId: 'event-1' }],
  ['nonboolean applied flag', { durable: true, eventId: 'event-1', applied: 'true' }],
]) test(`apply ${label} is never reported as complete`, async () => {
  const h = workerHarness({ apply: () => receipt });
  assert.deepEqual(await h.worker.tick(), { eventId: 'event-1', status: 'pending' });
  assert.equal(h.calls.at(-1).code, 'payment_commit_unconfirmed'); assert.equal(h.calls.at(-1).retryable, true);
});

for (const [code, retryable, status] of [
  ['payment_mapping_unavailable', false, 'pending'], ['payment_mapping_ambiguous', false, 'review'],
  ['payment_version_conflict', false, 'review'], ['payment_refund_unconfirmed', true, 'pending'],
  ['payment_lease_lost', false, 'pending'], ['payment_contract_missing', false, 'review'],
  ['manual_payment_invalid', false, 'review'], ['synthetic_private_provider_detail', false, 'pending'],
]) test(`processing failure ${code} uses the safe retry/review path`, async () => {
  const h = workerHarness({ read: () => { throw Object.assign(Error('synthetic_private_provider_detail'), { code, retryable }); } });
  assert.deepEqual(await h.worker.tick(), { eventId: 'event-1', status });
  assert.equal(h.state.writes, 0);
  assert.equal(h.calls.at(-1).code, code === 'synthetic_private_provider_detail' ? 'payment_processing_unavailable' : code);
  assert.ok(h.errors.every(value => !value.includes('synthetic_private_provider_detail')));
});

for (const [label, receipt] of [
  ['missing acknowledgement', undefined], ['null acknowledgement', null],
  ['missing durable flag', { eventId: 'event-1', status: 'pending' }],
  ['false durable flag', { durable: false, eventId: 'event-1', status: 'pending' }],
  ['wrong event receipt', { durable: true, eventId: 'event-other', status: 'pending' }],
  ['invalid status', { durable: true, eventId: 'event-1', status: 'complete' }],
]) test(`failure ${label} must reject instead of claiming safe persistence`, async () => {
  const h = workerHarness({ read: () => { throw Error('synthetic_private_provider_detail'); }, fail: () => receipt });
  await assert.rejects(h.worker.tick(), error => safeFailure(error, true)); assert.equal(h.state.writes, 0);
});

test('failed claim is sanitized and releases the in-flight guard for a subsequent tick', async () => {
  let first = true;
  const h = workerHarness({ claim: () => { if (first) { first = false; throw Error('synthetic_private_provider_detail'); } return null; } });
  await assert.rejects(h.worker.tick(), error => safeFailure(error, true));
  assert.deepEqual(await h.worker.tick(), { idle: true });
  assert.deepEqual(h.calls.map(call => call.action), ['claim', 'claim']);
});

test('failure-store outage cannot appear as a saved retry and releases the in-flight guard', async () => {
  let first = true;
  const h = workerHarness({ read: () => { throw Error('synthetic_private_provider_detail'); }, fail: (claim, _code, _retryable) => {
    if (first) { first = false; throw Error('synthetic_private_provider_detail'); }
    return { durable: true, eventId: claim.eventId, status: 'pending' };
  } });
  await assert.rejects(h.worker.tick(), error => safeFailure(error, true));
  assert.deepEqual(await h.worker.tick(), { eventId: 'event-1', status: 'pending' });
});

test('an optional error logger cannot prevent the durable failure acknowledgement', async () => {
  const h = workerHarness({ read: () => { throw Error('synthetic_private_provider_detail'); },
    onError: () => { throw Error('synthetic_private_provider_detail'); } });
  assert.deepEqual(await h.worker.tick(), { eventId: 'event-1', status: 'pending' });
  assert.equal(h.calls.at(-1).action, 'fail'); assert.equal(h.state.writes, 0);
});

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const jsonResponse = (status, value) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(value) });
const admin = { id: 'admin-1', email: 'admin@coastalcrestroofing.com', app_metadata: { role: 'admin' } };
const syncStatus = () => ({ pending: 2, review: 1, lastProcessedAt: updatedAt, oldestPendingAt: '2026-09-15T12:00:00Z' });

function schedulerHarness({ env = {}, claim = validClaim(), providerStatus = 200, providerInvoice = invoice(), rpcResponse, authUser = admin } = {}) {
  const rpcCalls = [], providerCalls = [], authCalls = [], timers = [], warnings = [];
  let pending = claim !== null, route;
  const context = vm.createContext({
    URL, Buffer, AbortSignal, __dirname: root, module: { exports: {} },
    console: { log() {}, warn: message => warnings.push(message) },
    process: { env: { CRM_SKIP_ENV_FILES: 'true', AUTH_REQUIRED: 'true', SUPABASE_URL: 'https://unit.supabase.co',
      SUPABASE_ANON_KEY: 'sb_publishable_synthetic', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_synthetic_worker',
      SUPABASE_STATE_ID: scope.companyId, SQUARE_ENVIRONMENT: scope.environment,
      SQUARE_MERCHANT_ID: scope.merchantId, SQUARE_ACCESS_TOKEN: 'synthetic-square-token', ...env } },
    setInterval(callback, delay) {
      const timer = { callback, delay, unreferenced: false, cleared: false, unref() { this.unreferenced = true; } };
      timers.push(timer); return timer;
    },
    clearInterval(timer) { timer.cleared = true; },
    require(name) {
      if (name === 'fs') return { existsSync: () => false, writeFileSync: () => { throw Error('No local balance-file fallback is allowed'); } };
      if (name === 'http') return { createServer: handler => { route = handler; return {}; } };
      if (name === 'https') throw Error('No real provider network is allowed');
      return require(name);
    },
    async fetch(input, options) {
      const url = new URL(String(input));
      if (url.origin === 'https://unit.supabase.co' && url.pathname === '/auth/v1/user') {
        authCalls.push({ url, options }); return jsonResponse(authUser ? 200 : 401, authUser || {});
      }
      if (url.origin === 'https://unit.supabase.co' && url.pathname.startsWith('/rest/v1/rpc/')) {
        const call = { name: url.pathname.split('/').at(-1), url, options, body: JSON.parse(options.body) }; rpcCalls.push(call);
        if (rpcResponse) {
          const custom = await rpcResponse(call);
          if (custom !== undefined) return custom;
        }
        if (call.name === 'crm_square_claim_webhook') return jsonResponse(200, pending ? claim : null);
        if (call.name === 'crm_square_apply_payment') {
          pending = false; return jsonResponse(200, { durable: true, eventId: claim.eventId, applied: true });
        }
        if (call.name === 'crm_square_fail_webhook') return jsonResponse(200, { durable: true, eventId: claim.eventId, status: call.body.p_retryable ? 'pending' : 'review' });
        if (call.name === 'crm_square_sync_status') return jsonResponse(200, syncStatus());
      }
      if (url.origin === 'https://connect.squareupsandbox.com' && url.pathname === '/v2/invoices/inv%3A1') {
        providerCalls.push({ url, options }); return jsonResponse(providerStatus, { invoice: providerInvoice });
      }
      throw Error(`Unmocked worker request ${url.origin}${url.pathname}`);
    },
  });
  vm.runInContext(serverSource, context);
  const request = ({ url = '/api/square/sync-status', method = 'GET', authorization = 'Bearer synthetic-admin-session', direct = false, directUser } = {}) =>
    new Promise((resolve, reject) => {
      const req = { url, method, headers: { host: 'localhost', authorization }, socket: { remoteAddress: '127.0.0.1' } };
      const res = { setHeader() {}, writeHead(status) { this.status = status; }, end(raw) {
        let body; try { body = JSON.parse(raw); } catch { body = raw; }
        resolve({ status: this.status, body });
      } };
      Promise.resolve(direct ? context.handleSquareSyncStatus(req, res, directUser) : route(req, res)).catch(reject);
    });
  return { context, rpcCalls, providerCalls, authCalls, timers, warnings, request,
    start: () => context.startSquarePaymentWorker(), drain: () => new Promise(resolve => setImmediate(resolve)) };
}

test('server scheduler is opt-in and disabled by default without provider or queue calls', () => {
  for (const enabled of [undefined, '', 'false', 'TRUE']) {
    const h = schedulerHarness({ env: { SQUARE_PAYMENT_WORKER_ENABLED: enabled } });
    assert.equal(h.start(), null); assert.equal(h.timers.length, 0);
    assert.equal(h.rpcCalls.length, 0); assert.equal(h.providerCalls.length, 0);
  }
});

for (const env of [{ SUPABASE_SERVICE_ROLE_KEY: '' }, { SUPABASE_ANON_KEY: '' }, { SUPABASE_URL: '' },
  { SQUARE_ACCESS_TOKEN: '' }, { SQUARE_MERCHANT_ID: '' }, { SQUARE_MERCHANT_ID: '../other' }]) {
  test(`enabled scheduler requires complete server-only configuration: ${JSON.stringify(env)}`, () => {
    const h = schedulerHarness({ env: { SQUARE_PAYMENT_WORKER_ENABLED: 'true', ...env } });
    assert.throws(() => h.start(), /requires/);
    assert.equal(h.timers.length, 0); assert.equal(h.rpcCalls.length, 0); assert.equal(h.providerCalls.length, 0);
  });
}

test('server scheduler processes a durable queue without a browser and uses only scoped worker writes/provider GETs', async () => {
  const h = schedulerHarness({ env: { SQUARE_PAYMENT_WORKER_ENABLED: 'true' } }); const stop = h.start();
  assert.equal(typeof stop, 'function'); await h.drain();
  assert.equal(h.timers.length, 1); assert.equal(h.timers[0].delay, 5000); assert.equal(h.timers[0].unreferenced, true);
  assert.deepEqual(h.rpcCalls.map(call => call.name), ['crm_square_claim_webhook', 'crm_square_apply_payment']);
  assert.equal(h.providerCalls.length, 2); assert.equal(h.warnings.length, 0);
  for (const call of h.rpcCalls) {
    assert.equal(call.body.p_company, scope.companyId); assert.equal(call.body.p_environment, scope.environment);
    assert.equal(call.body.p_merchant, scope.merchantId); assert.equal(call.options.method, 'POST');
    assert.equal(call.options.headers.apikey, 'sb_secret_synthetic_worker');
    assert.equal(call.options.headers.Authorization, undefined); assert.ok(call.options.signal);
  }
  const apply = h.rpcCalls[1].body;
  assert.equal(apply.p_event_id, 'event-1'); assert.equal(apply.p_lease_id, validClaim().leaseId);
  assert.deepEqual(apply.p_snapshot, validSnapshot());
  for (const call of h.providerCalls) {
    assert.equal(call.options.method || 'GET', 'GET'); assert.equal(call.options.body, undefined);
    assert.equal(call.options.headers.Authorization, 'Bearer synthetic-square-token'); assert.ok(call.options.signal);
    assert.equal(JSON.stringify(call.options).includes('sb_secret_synthetic_worker'), false);
  }
  await h.timers[0].callback(); assert.equal(h.rpcCalls.at(-1).name, 'crm_square_claim_webhook');
  assert.equal(h.providerCalls.length, 2, 'Completed events do not trigger repeated provider reads');
  stop(); assert.equal(h.timers[0].cleared, true);
});

test('scheduler waits for the payload invoice version, not the later webhook emitter timestamp', async () => {
  const current = validClaim(); current.invoiceVersion = 5;
  const h = schedulerHarness({ env: { SQUARE_PAYMENT_WORKER_ENABLED: 'true' }, claim: current });
  const stop = h.start(); await h.drain();
  assert.deepEqual(h.rpcCalls.map(call => call.name), ['crm_square_claim_webhook', 'crm_square_fail_webhook']);
  assert.equal(h.rpcCalls.at(-1).body.p_code, 'payment_provider_not_current');
  assert.equal(h.rpcCalls.at(-1).body.p_retryable, true); stop();
});

test('scheduler provider failure persists a retry and never applies a guessed balance', async () => {
  const h = schedulerHarness({ env: { SQUARE_PAYMENT_WORKER_ENABLED: 'true' }, providerStatus: 503 });
  const stop = h.start(); await h.drain();
  assert.deepEqual(h.rpcCalls.map(call => call.name), ['crm_square_claim_webhook', 'crm_square_fail_webhook']);
  assert.equal(h.rpcCalls.at(-1).body.p_retryable, true);
  assert.equal(h.warnings.length, 1); assert.equal(h.warnings[0].includes('synthetic'), false); stop();
});

test('scheduler failed durable apply is deferred instead of silently completing the event', async () => {
  const h = schedulerHarness({ env: { SQUARE_PAYMENT_WORKER_ENABLED: 'true' }, rpcResponse: call =>
    call.name === 'crm_square_apply_payment' ? jsonResponse(200, { durable: false, eventId: 'event-1', applied: true }) : undefined });
  const stop = h.start(); await h.drain();
  assert.deepEqual(h.rpcCalls.map(call => call.name), ['crm_square_claim_webhook', 'crm_square_apply_payment', 'crm_square_fail_webhook']);
  assert.equal(h.rpcCalls.at(-1).body.p_code, 'payment_commit_unconfirmed'); stop();
});

test('scheduler intervals preserve the worker single-flight guard while a queue claim is in flight', async () => {
  let release, signalStarted;
  const started = new Promise(resolve => { signalStarted = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const h = schedulerHarness({ env: { SQUARE_PAYMENT_WORKER_ENABLED: 'true' }, rpcResponse: async call => {
    if (call.name === 'crm_square_claim_webhook') { signalStarted(); await gate; }
  } });
  const stop = h.start(); await started;
  await h.timers[0].callback(); assert.equal(h.rpcCalls.length, 1); assert.equal(h.providerCalls.length, 0);
  release(); await h.drain();
  assert.deepEqual(h.rpcCalls.map(call => call.name), ['crm_square_claim_webhook', 'crm_square_apply_payment']); stop();
});

test('sync-status GET is reachable by verified admins and returns only safe aggregate fields', async () => {
  const h = schedulerHarness({ env: { SQUARE_PAYMENT_WORKER_ENABLED: 'true' }, rpcResponse: call => call.name === 'crm_square_sync_status'
    ? jsonResponse(200, { ...syncStatus(), internal: 'synthetic_private_provider_detail', key: 'sb_secret_synthetic_worker', customerEmail: 'private@example.invalid' }) : undefined });
  const result = await h.request(); assert.equal(result.status, 200);
  assert.deepEqual(result.body, { enabled: true, ...syncStatus() });
  assert.equal(h.authCalls.length, 1); assert.equal(h.authCalls[0].options.headers.apikey, 'sb_publishable_synthetic');
  assert.equal(h.authCalls[0].options.headers.Authorization, 'Bearer synthetic-admin-session');
  assert.equal(h.rpcCalls.length, 1); assert.equal(h.rpcCalls[0].name, 'crm_square_sync_status');
  assert.deepEqual(h.rpcCalls[0].body, { p_company: scope.companyId, p_environment: scope.environment, p_merchant: scope.merchantId });
  assert.equal(h.providerCalls.length, 0); assert.equal(h.timers.length, 0);
  for (const value of ['synthetic_private_provider_detail', 'sb_secret_synthetic_worker', 'private@example.invalid']) assert.equal(JSON.stringify(result).includes(value), false);
});

for (const [label, options, requestOptions, expected] of [
  ['anonymous caller', {}, { authorization: '' }, 401],
  ['invalid session', { authUser: null }, {}, 401],
  ['sales caller', { authUser: { ...admin, app_metadata: { role: 'sales' } } }, {}, 403],
  ['outside company caller', { authUser: { ...admin, email: 'admin@outside.invalid' } }, {}, 401],
  ['local demo caller', { env: { NODE_ENV: 'development', ALLOW_LOCAL_DEMO: 'true', AUTH_REQUIRED: 'false' } }, {}, 403],
  ['unverified direct caller', {}, { direct: true }, 403],
]) test(`sync-status rejects ${label} before inspecting the payment queue`, async () => {
  const h = schedulerHarness(options); assert.equal((await h.request(requestOptions)).status, expected);
  assert.equal(h.rpcCalls.length, 0); assert.equal(h.providerCalls.length, 0);
});

test('sync-status never accepts caller-supplied company or merchant scope from query parameters', async () => {
  const h = schedulerHarness(); const result = await h.request({ url: '/api/square/sync-status?companyId=other&merchantId=other&environment=production' });
  assert.equal(result.status, 200);
  assert.deepEqual(h.rpcCalls[0].body, { p_company: scope.companyId, p_environment: scope.environment, p_merchant: scope.merchantId });
});

test('sync-status is a read-only GET route, not a writable POST endpoint', async () => {
  const h = schedulerHarness(); assert.equal((await h.request({ method: 'POST' })).status, 404);
  assert.equal(h.rpcCalls.length, 0); assert.equal(h.providerCalls.length, 0);
});

for (const env of [{ SUPABASE_SERVICE_ROLE_KEY: '' }, { SQUARE_MERCHANT_ID: '' }, { SQUARE_MERCHANT_ID: '../other' }]) {
  test(`sync-status missing or unsafe server configuration fails closed: ${JSON.stringify(env)}`, async () => {
    const h = schedulerHarness({ env }); assert.equal((await h.request()).status, 503);
    assert.equal(h.rpcCalls.length, 0); assert.equal(h.providerCalls.length, 0);
  });
}

for (const env of [{}, { SQUARE_PAYMENT_WORKER_ENABLED: 'false' }, { SQUARE_PAYMENT_WORKER_ENABLED: 'true', SQUARE_ACCESS_TOKEN: '' }]) {
  test(`sync-status accurately reports a disabled worker: ${JSON.stringify(env)}`, async () => {
    const h = schedulerHarness({ env }); const result = await h.request();
    assert.equal(result.status, 200); assert.equal(result.body.enabled, false); assert.equal(h.providerCalls.length, 0);
  });
}

for (const [label, status] of [
  ['missing status', null], ['missing counts', {}],
  ['negative pending count', { ...syncStatus(), pending: -1 }],
  ['string review count', { ...syncStatus(), review: '1' }],
  ['unsafe pending count', { ...syncStatus(), pending: Number.MAX_SAFE_INTEGER + 1 }],
  ['invalid processed timestamp', { ...syncStatus(), lastProcessedAt: 'not-a-date' }],
  ['missing pending timestamp', { ...syncStatus(), oldestPendingAt: undefined }],
]) test(`sync-status rejects ${label} without exposing an unreliable result`, async () => {
  const h = schedulerHarness({ rpcResponse: call => call.name === 'crm_square_sync_status' ? jsonResponse(200, status) : undefined });
  const result = await h.request(); assert.equal(result.status, 503); assert.equal(result.body.pending, undefined);
  assert.equal(h.providerCalls.length, 0);
});

test('sync-status allows an empty queue with explicit null timestamps', async () => {
  const status = { pending: 0, review: 0, lastProcessedAt: null, oldestPendingAt: null };
  const h = schedulerHarness({ rpcResponse: call => call.name === 'crm_square_sync_status' ? jsonResponse(200, status) : undefined });
  const result = await h.request(); assert.equal(result.status, 200); assert.deepEqual(result.body, { enabled: false, ...status });
});

test('sync-status database failures return only a safe generic error', async () => {
  const h = schedulerHarness({ rpcResponse: () => jsonResponse(503, { message: 'synthetic_private_provider_detail', details: 'sb_secret_synthetic_worker' }) });
  const result = await h.request(); assert.equal(result.status, 503);
  assert.equal(JSON.stringify(result).includes('synthetic_private_provider_detail'), false);
  assert.equal(JSON.stringify(result).includes('sb_secret_synthetic_worker'), false);
});

test('public health and browser configuration never expose private worker credentials or payment queue details', async () => {
  const h = schedulerHarness({ env: { SQUARE_PAYMENT_WORKER_ENABLED: 'true', SUPABASE_SECRET_KEY: 'sb_secret_preferred_worker' } });
  for (const url of ['/api/health', '/auth-config.js']) {
    const result = await h.request({ url, authorization: '' }); assert.equal(result.status, 200);
    const body = JSON.stringify(result.body);
    for (const secret of ['sb_secret_preferred_worker', 'sb_secret_synthetic_worker', 'synthetic-square-token', 'oldestPendingAt', 'lastProcessedAt']) {
      assert.equal(body.includes(secret), false);
    }
  }
  assert.equal(h.authCalls.length, 0); assert.equal(h.rpcCalls.length, 0); assert.equal(h.providerCalls.length, 0);
});
