const test = require('node:test');
const assert = require('node:assert/strict');
const { capture, collect, reconcile, STALE_MESSAGE } = require('../payment-refresh.js');

const estimate = (suffix = '1') => ({ id: `estimate-${suffix}`, contactId: 'lead', jobId: 'job', squareInvoiceId: `invoice-${suffix}`,
  contractValue: 32000, paidAmount: 0, paymentPercent: 0, squareStatus: 'UNPAID', paymentRequests: [],
  paymentUpdatedAt: '2026-09-01T00:00:00Z', paidAt: '', items: [{ title: 'Roof', quantity: 1, rate: 32000 }] });
const record = (invoiceId = 'invoice-1', overrides = {}) => ({ invoiceId, status: 'PARTIALLY_PAID', paidAmount: 16000,
  contractAmount: 16000, updatedAt: '2026-09-14T00:00:00Z', paymentRequests: [{ paidAmount: 16000, requestedAmount: 16000 }], ...overrides });
const refresh = async (estimates, overrides = {}, options) => {
  const snapshot = capture(estimates);
  const replies = await collect(snapshot, async ids => ({ payments: Object.fromEntries(ids.map(id => [id, record(id, overrides)])) }));
  return reconcile(snapshot, replies, estimates, options);
};

test('snapshot is detached, deeply frozen, and deduplicates invoice IDs', () => {
  const original = estimate();
  const snapshot = capture([original, { ...original, id: 'copy' }]);
  original.items[0].title = 'Changed';
  assert.equal(snapshot.entries[0].data.items[0].title, 'Roof');
  assert.equal(Object.isFrozen(snapshot.entries[0].data.items[0]), true);
  assert.deepEqual(snapshot.invoiceIds, ['invoice-1']);
});

test('refresh batches at 20 unique IDs with a single request in flight', async () => {
  const estimates = Array.from({ length: 45 }, (_, i) => estimate(String(i)));
  estimates.push({ ...estimates[0], id: 'copy' });
  const batches = []; let active = 0, peak = 0;
  const collected = await collect(capture(estimates), async ids => {
    batches.push([...ids]); peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 1)); active--;
    return { payments: Object.fromEntries(ids.map(id => [id, record(id)])) };
  });
  assert.deepEqual(batches.map(ids => ids.length), [20, 20, 5]);
  assert.equal(peak, 1); assert.equal(Object.keys(collected.payments).length, 45);
});

test('refresh returns payment-only patches and keeps the agreed contract', async () => {
  const original = estimate(); const before = structuredClone(original);
  const result = await refresh([original]);
  assert.equal(result.stale, false); assert.equal(result.changed, true);
  assert.equal(result.patches[0].fields.paymentPercent, 50);
  assert.equal(result.patches[0].fields.paidAmount, 16000);
  assert.equal(Object.hasOwn(result.patches[0].fields, 'contractValue'), false);
  assert.equal(Object.hasOwn(result, 'saved'), false);
  assert.deepEqual(result.touchedJobs, [{ contactId: 'lead', jobId: 'job' }]);
  assert.deepEqual(original, before);
});

test('custom contract resolver handles estimates without a stored contract', async () => {
  const original = estimate(); delete original.contractValue;
  const snapshot = capture([original], { contractValue: value => value.items.reduce((sum, item) => sum + item.quantity * item.rate, 0) });
  const collected = await collect(snapshot, async () => ({ payments: { 'invoice-1': record() } }));
  assert.equal(reconcile(snapshot, collected, [original]).patches[0].fields.paymentPercent, 50);
});

test('typing while a request is in flight is retained and payment refresh is deferred', async () => {
  const original = estimate(); let resolve;
  const snapshot = capture([original]);
  const pending = collect(snapshot, async () => await new Promise(done => { resolve = done; }));
  await Promise.resolve();
  original.items[0].title = 'Still typing';
  resolve({ payments: { 'invoice-1': record() } });
  const result = reconcile(snapshot, await pending, [original]);
  assert.equal(result.patches.length, 0); assert.equal(result.stale, true);
  assert.equal(original.items[0].title, 'Still typing'); assert.equal(original.paidAmount, 0);
  assert.equal(result.message, STALE_MESSAGE);
});

for (const changed of ['lead', 'job', 'invoice', 'removed', 'new duplicate', 'duplicate ID']) {
  test(`in-flight association change is rejected: ${changed}`, async () => {
    const original = estimate(); const snapshot = capture([original]);
    const collected = await collect(snapshot, async () => ({ payments: { 'invoice-1': record() } }));
    let current = [structuredClone(original)];
    if (changed === 'lead') current[0].contactId = 'other';
    if (changed === 'job') current[0].jobId = 'other';
    if (changed === 'invoice') current[0].squareInvoiceId = 'other';
    if (changed === 'removed') current = [];
    if (changed === 'new duplicate') current.push({ ...original, id: 'new' });
    if (changed === 'duplicate ID') current.push(structuredClone(original));
    const result = reconcile(snapshot, collected, current);
    assert.equal(result.patches.length, 0); assert.equal(result.stale, true);
  });
}

test('deleted job prevents otherwise valid invoice reconciliation', async () => {
  const result = await refresh([estimate()], {}, { isJobCurrent: () => false });
  assert.equal(result.patches.length, 0); assert.equal(result.stale, true);
});

test('duplicate invoice on another job cannot transfer money; same-job copies are allowed', async () => {
  const original = estimate();
  const invalid = await refresh([original, { ...original, id: 'copy', jobId: 'other' }]);
  assert.equal(invalid.patches.length, 0); assert.equal(invalid.stale, true);
  const valid = await refresh([original, { ...original, id: 'copy' }]);
  assert.equal(valid.patches.length, 2); assert.equal(valid.touchedJobs.length, 1);
});

test('a duplicate estimate ID across different invoices cannot patch the wrong estimate', async () => {
  const first = estimate(); const other = { ...estimate('2'), id: first.id };
  const result = await refresh([first, other]);
  assert.equal(result.patches.length, 0); assert.equal(result.stale, true);
});

for (const changes of [
  { invoiceId: 'wrong' }, { leadId: 'wrong' }, { jobId: 'wrong' }, { estimateId: 'wrong' },
  { paidAmount: -1 }, { paidAmount: NaN }, { paidAmount: Infinity }, { paidAmount: '16000' }, { paidAmount: 1.001 },
  { paidAmount: Number.MAX_SAFE_INTEGER }, { contractAmount: -1 }, { status: '' }, { updatedAt: 'bad' },
  { paymentRequests: [{ paidAmount: -1, requestedAmount: 1 }] }, { paymentRequests: {} },
]) {
  test(`invalid provider reply retains last known balance: ${JSON.stringify(changes)}`, async () => {
    const original = estimate(); const result = await refresh([original], changes);
    assert.equal(result.patches.length, 0); assert.equal(result.stale, true); assert.equal(original.paidAmount, 0);
  });
}

test('older provider timestamps cannot replace newer known balances', async () => {
  const result = await refresh([estimate()], { updatedAt: '2026-08-01T00:00:00Z', paidAmount: 0 });
  assert.equal(result.patches.length, 0); assert.equal(result.failures[0].reason, 'older_response');
});

test('missing and per-invoice errors preserve balances and produce a quiet stale message', async () => {
  const estimates = [estimate(), estimate('2'), estimate('3')];
  const snapshot = capture(estimates);
  const collected = await collect(snapshot, async () => ({ payments: { 'invoice-1': record(), 'invoice-2': { error: 'unavailable' } } }));
  const result = reconcile(snapshot, collected, estimates);
  assert.equal(result.patches.length, 1); assert.equal(result.failures.length, 2);
  assert.equal(result.message, STALE_MESSAGE); assert.equal(estimates[1].paidAmount, 0);
});

test('a failed later batch retains successful replies without clearing other balances', async () => {
  const estimates = Array.from({ length: 21 }, (_, i) => estimate(String(i)));
  const snapshot = capture(estimates); let calls = 0;
  const collected = await collect(snapshot, async ids => {
    if (calls++) throw new Error('offline');
    return { payments: Object.fromEntries(ids.map(id => [id, record(id)])) };
  });
  const result = reconcile(snapshot, collected, estimates);
  assert.equal(result.patches.length, 20); assert.equal(result.failures.length, 1);
  assert.equal(result.stale, true); assert.equal(estimates[20].paidAmount, 0);
});

test('request timeout releases refresh even when the adapter ignores cancellation', async () => {
  const snapshot = capture([estimate()]); let signal;
  const collected = await collect(snapshot, async (_ids, options) => { signal = options.signal; return new Promise(() => {}); }, { timeoutMs: 5 });
  assert.equal(signal.aborted, true); assert.equal(collected.failures.length, 1);
  assert.equal(reconcile(snapshot, collected, [estimate()]).patches.length, 0);
});

test('cancellation does not start more requests or mark unfinished work saved', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  const snapshot = capture([estimate()]);
  const collected = await collect(snapshot, async () => { calls++; }, { signal: controller.signal });
  assert.equal(calls, 0); assert.equal(collected.failures.length, 1);
  assert.equal(Object.hasOwn(collected, 'saved'), false);
});

test('empty snapshot does not request anything', async () => {
  const snapshot = capture([]);
  const collected = await collect(snapshot, () => { throw Error('must not call'); });
  const result = reconcile(snapshot, collected, []);
  assert.equal(result.changed, false); assert.equal(result.stale, false); assert.equal(result.message, '');
});

test('unchanged refresh produces no patch, while changed payment request details do', async () => {
  const original = estimate();
  const first = await refresh([original]); Object.assign(original, structuredClone(first.patches[0].fields));
  assert.equal((await refresh([original])).changed, false);
  const changed = await refresh([original], { paymentRequests: [{ paidAmount: 16000, requestedAmount: 32000 }] });
  assert.equal(changed.changed, true);
});

test('reply objects are detached before later adapter mutation', async () => {
  const snapshot = capture([estimate()]); const reply = record();
  const collected = await collect(snapshot, async () => ({ payments: { 'invoice-1': reply, unexpected: record('unexpected') } }));
  reply.paymentRequests[0].paidAmount = 999;
  assert.equal(collected.payments['invoice-1'].paymentRequests[0].paidAmount, 16000);
  assert.equal(Object.hasOwn(collected.payments, 'unexpected'), false);
});

test('paid date is retained when paid and cleared when a newer refund lowers paid progress', async () => {
  const original = estimate(); original.paidAt = '2026-09-05T00:00:00Z';
  const paid = await refresh([original], { paidAmount: 32000, status: 'PAID' });
  assert.equal(paid.patches[0].fields.paidAt, original.paidAt);
  const refund = await refresh([original], { paidAmount: 8000, status: 'PARTIALLY_REFUNDED' });
  assert.equal(refund.patches[0].fields.paidAt, ''); assert.equal(refund.patches[0].fields.paymentPercent, 25);
});
