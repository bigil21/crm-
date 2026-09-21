const test = require('node:test');
const assert = require('node:assert/strict');
const { create, idempotencyKey } = require('../square-invoice-workflow.js');
const initial = () => ({ id: 'intent-1', companyId: 'company-1', environment: 'sandbox', status: 'pending', receipts: {},
  payload: { estimateId: 'estimate-1', leadId: 'lead-1', jobId: 'job-1', leadNumber: 'L-1', projectNumber: 'P-1', estimateNumber: 'E-1',
    projectTitle: 'Roof', jobAddress: 'Synthetic address', contactName: 'Synthetic Tester', contactEmail: 'tester@example.invalid',
    lineItems: [{ title: 'Roof', description: 'Synthetic work', quantity: 1.5, rate: 100.50 }],
    taxRate: 0, deposit: 50.25, total: 150.75, dueDate: '2026-10-15', depositDueDate: '2026-09-16' } });
const customer = { id: 'customer-1', email_address: 'tester@example.invalid' };
const location = { id: 'location-1', currency: 'USD', status: 'ACTIVE' };
const order = { id: 'order-1', location_id: location.id, customer_id: customer.id, total_money: { currency: 'USD', amount: 15075 } };
const draft = { id: 'inv:1', version: 0, location_id: location.id, order_id: order.id,
  primary_recipient: { customer_id: customer.id }, delivery_method: 'EMAIL', status: 'DRAFT' };
const published = { ...draft, version: 1, status: 'UNPAID', invoice_number: 'I-1', public_url: 'https://example.invalid/pay', updated_at: '2026-09-15T12:00:00Z' };
const ok = body => ({ status: 200, body });

function harness({ intent = initial(), override = {}, checkpointFailure, completeFailure = false, acknowledgement, completeAcknowledgement, newCustomer = false } = {}) {
  let saved = structuredClone(intent), failStage = checkpointFailure, failComplete = completeFailure;
  const calls = [], storeCalls = [], providerBodies = new Map();
  const store = {
    async begin(id, version) { storeCalls.push({ action: 'begin', id, version }); return structuredClone(saved); },
    async checkpoint(current, stage, receipt) {
      storeCalls.push({ action: 'checkpoint', stage });
      if (failStage === stage) { failStage = null; throw Error('Database unavailable'); }
      saved = { ...saved, receipts: { ...saved.receipts, [stage]: structuredClone(receipt) } };
      return acknowledgement ? acknowledgement(structuredClone(saved), stage) : structuredClone(saved);
    },
    async complete(current, result) {
      storeCalls.push({ action: 'complete' });
      if (failComplete) { failComplete = false; throw Error('Database unavailable'); }
      saved = { ...saved, status: 'complete', result: { ...structuredClone(result), durable: true, rows: [{ id: 'estimate-1', version: 8, data: {} }] } };
      return completeAcknowledgement ? completeAcknowledgement(structuredClone(saved)) : structuredClone(saved);
    },
  };
  const responses = { '/customers/search': ok({ customers: newCustomer ? [] : [customer] }), '/customers': ok({ customer }),
    '/locations': ok({ locations: [location] }), '/orders': ok({ order }), '/invoices': ok({ invoice: draft }),
    '/invoices/inv%3A1/publish': ok({ invoice: published }), ...override };
  const request = async (method, path, body) => {
    calls.push({ method, path, body: structuredClone(body) });
    if (body?.idempotency_key) {
      const previous = providerBodies.get(body.idempotency_key);
      if (previous) assert.deepEqual(body, previous, 'Idempotent replay body must be identical');
      providerBodies.set(body.idempotency_key, structuredClone(body));
    }
    assert.ok(Object.hasOwn(responses, path), `Unmocked provider call ${path}`);
    const response = responses[path];
    if (response instanceof Error) throw response;
    return typeof response === 'function' ? response(body) : structuredClone(response);
  };
  return { calls, storeCalls, store, request, get saved() { return structuredClone(saved); },
    run: () => create({ store, request }).send('estimate-1', 7) };
}

test('workflow persists each stage and completes shared attachment before returning published success', async () => {
  const h = harness(); const result = await h.run();
  assert.equal(result.squareInvoiceId, draft.id); assert.equal(result.contractValue, 150.75); assert.equal(result.durable, true);
  assert.equal(result.rows[0].version, 8); assert.equal(Object.isFrozen(result.rows[0]), true);
  assert.deepEqual(h.storeCalls.map(call => call.stage || call.action), ['begin', 'customer', 'location', 'order', 'invoice', 'published', 'complete']);
  assert.equal(h.saved.status, 'complete');
  const invoiceBody = h.calls.find(call => call.path === '/invoices').body.invoice;
  assert.equal(invoiceBody.delivery_method, 'EMAIL');
  assert.deepEqual(invoiceBody.payment_requests.map(request => request.due_date), ['2026-09-16', '2026-10-15']);
  assert.equal(h.calls.find(call => call.path === '/orders').body.order.line_items[0].quantity, '1.5');
});

test('completed intent is returned without contacting Square or saving it again', async () => {
  const first = harness(); const result = await first.run();
  const resumed = harness({ intent: first.saved }); assert.deepEqual(await resumed.run(), result);
  assert.equal(resumed.calls.length, 0); assert.deepEqual(resumed.storeCalls.map(call => call.action), ['begin']);
});

for (const stage of ['customer', 'location', 'order', 'invoice', 'published']) {
  test(`checkpoint failure stops the next provider side effect and resumes exactly: ${stage}`, async () => {
    const h = harness({ checkpointFailure: stage, newCustomer: true });
    await assert.rejects(h.run(), error => error.code === 'store_unconfirmed' && error.stage === stage);
    const callsAtFailure = h.calls.map(call => call.path);
    const forbidden = { customer: '/orders', location: '/orders', order: '/invoices', invoice: '/invoices/inv%3A1/publish', published: null }[stage];
    if (forbidden) assert.equal(callsAtFailure.includes(forbidden), false);
    assert.equal(h.storeCalls.some(call => call.action === 'complete'), false);
    const result = await h.run(); assert.equal(result.durable, true);
    const creates = h.calls.filter(call => call.body?.idempotency_key);
    const byPath = new Map();
    for (const call of creates) {
      if (byPath.has(call.path)) assert.deepEqual(call.body, byPath.get(call.path));
      else byPath.set(call.path, call.body);
    }
  });
}

test('a failed final shared completion is never reported as sent and resumes without republishing', async () => {
  const h = harness({ completeFailure: true });
  await assert.rejects(h.run(), error => error.code === 'store_unconfirmed' && error.stage === 'complete');
  const before = h.calls.length; const result = await h.run();
  assert.equal(result.durable, true); assert.equal(h.calls.length, before);
  assert.equal(h.calls.filter(call => call.path.includes('/publish')).length, 1);
});

test('begin failure performs no provider operations', async () => {
  const h = harness(); h.store.begin = async () => { throw Error('offline'); };
  await assert.rejects(h.run(), error => error.code === 'store_unconfirmed' && error.stage === 'begin');
  assert.equal(h.calls.length, 0);
});

test('begin preserves only safe business codes, never database messages or response bodies', async () => {
  const h = harness();
  h.store.begin = async () => { throw Object.assign(Error('Sensitive database details'), { code: 'legacy_invoice_review_required', body: 'private' }); };
  await assert.rejects(h.run(), error => error.code === 'store_unconfirmed' && error.storeCode === 'legacy_invoice_review_required' &&
    !error.message.includes('Sensitive') && error.body === undefined && error.cause === undefined);
  h.store.begin = async () => { throw Object.assign(Error('Sensitive database details'), { code: 'private database string' }); };
  await assert.rejects(h.run(), error => error.storeCode === undefined && !error.message.includes('Sensitive'));
});

for (const mutate of [
  value => { value.payload.contactEmail = 'invalid'; }, value => { value.payload.dueDate = ''; },
  value => { value.payload.depositDueDate = '2026-02-30'; }, value => { value.payload.total = 150.76; },
  value => { value.payload.deposit = 150.76; }, value => { value.payload.lineItems[0].rate = 100.501; },
  value => { value.payload.lineItems[0].quantity = -1; }, value => { value.environment = 'unknown'; },
  value => { value.payload.estimateId = 'other'; }, value => { value.payload.taxRate = -1; },
]) {
  test(`invalid frozen intent cannot start provider work: ${mutate.toString()}`, async () => {
    const intent = initial(); mutate(intent); const h = harness({ intent });
    await assert.rejects(h.run(), error => error.code === 'invalid_intent'); assert.equal(h.calls.length, 0);
  });
}

for (const [path, response, forbidden] of [
  ['/customers/search', { status: 500, body: {} }, '/customers'],
  ['/customers/search', ok({ customers: [customer], cursor: 'more' }), '/orders'],
  ['/customers/search', ok({ customers: [customer, { ...customer, id: 'another' }] }), '/orders'],
  ['/customers/search', ok({ customers: [{ ...customer, email_address: 'wrong@example.invalid' }] }), '/orders'],
  ['/locations', ok({ locations: [{ ...location, status: 'INACTIVE' }] }), '/orders'],
  ['/locations', ok({ locations: [{ ...location, currency: 'EUR' }] }), '/orders'],
  ['/orders', ok({ order: { ...order, total_money: { amount: 1, currency: 'USD' } } }), '/invoices'],
  ['/orders', ok({ order: { ...order, customer_id: 'wrong' } }), '/invoices'],
  ['/invoices', ok({ invoice: { ...draft, version: -1 } }), '/invoices/inv%3A1/publish'],
  ['/invoices', ok({ invoice: { ...draft, order_id: 'wrong' } }), '/invoices/inv%3A1/publish'],
  ['/invoices', ok({ invoice: { ...draft, delivery_method: 'SHARE_MANUALLY' } }), '/invoices/inv%3A1/publish'],
  ['/invoices', ok({ invoice: { ...draft, primary_recipient: { customer_id: 'wrong' } } }), '/invoices/inv%3A1/publish'],
  ['/invoices/inv%3A1/publish', ok({ invoice: { ...published, id: 'wrong' } }), null],
  ['/invoices/inv%3A1/publish', ok({ invoice: { ...published, status: 'DRAFT' } }), null],
  ['/invoices/inv%3A1/publish', ok({ invoice: { ...published, updated_at: '' } }), null],
]) {
  test(`invalid provider receipt stops safely: ${path} ${JSON.stringify(response)}`, async () => {
    const h = harness({ override: { [path]: response } }); await assert.rejects(h.run());
    if (forbidden) assert.equal(h.calls.some(call => call.path === forbidden), false);
    assert.equal(h.storeCalls.some(call => call.action === 'complete'), false);
  });
}

test('new customer creation is idempotent, validates email, and does not fall back to manual delivery', async () => {
  const h = harness({ newCustomer: true }); await h.run();
  const body = h.calls.find(call => call.path === '/customers').body;
  assert.equal(body.email_address, customer.email_address); assert.equal(body.idempotency_key.length, 45);
  const invalid = harness({ newCustomer: true, override: { '/customers': ok({ customer: { ...customer, email_address: 'wrong@example.invalid' } }) } });
  await assert.rejects(invalid.run()); assert.equal(invalid.calls.some(call => call.path === '/orders'), false);
});

for (const stage of ['customer', 'location', 'order', 'invoice', 'published']) {
  test(`incomplete/mutated DB checkpoint acknowledgement halts the workflow: ${stage}`, async () => {
    const h = harness({ acknowledgement: (intent, current) => {
      if (stage === current) intent.payload.contactEmail = 'changed@example.invalid'; return intent;
    } });
    await assert.rejects(h.run(), error => error.code === 'store_unconfirmed' && error.stage === stage);
    assert.equal(h.storeCalls.some(call => call.action === 'complete'), false);
  });
}

test('missing receipt in DB acknowledgement stops before order creation', async () => {
  const h = harness({ acknowledgement: intent => { intent.receipts = {}; return intent; } });
  await assert.rejects(h.run(), error => error.code === 'store_unconfirmed');
  assert.equal(h.calls.some(call => call.path === '/orders'), false);
});

for (const mutate of [value => { value.status = 'pending'; }, value => { value.result.squareInvoiceId = 'wrong'; },
  value => { value.result.durable = false; }, value => { value.result.leadId = 'other'; }, value => { delete value.result; }]) {
  test(`false/incomplete completion acknowledgement never reports success: ${mutate.toString()}`, async () => {
    const h = harness({ completeAcknowledgement: value => { mutate(value); return value; } });
    await assert.rejects(h.run(), error => error.code === 'store_unconfirmed' && error.stage === 'complete');
  });
}

test('persisted receipts skip already acknowledged provider stages', async () => {
  const intent = initial(); intent.receipts = { customer, location, order, invoice: draft };
  const h = harness({ intent }); await h.run();
  assert.deepEqual(h.calls.map(call => call.path), ['/invoices/inv%3A1/publish']);
  assert.equal(h.calls[0].body.version, 0);
});

test('persisted draft without earlier valid associations is rejected', async () => {
  const intent = initial(); intent.receipts = { invoice: draft };
  const h = harness({ intent }); await assert.rejects(h.run(), error => error.code === 'invalid_intent');
  assert.equal(h.calls.length, 0);
});

test('scope/operation changes produce separate keys without truncation collisions', () => {
  const intent = initial(); const key = idempotencyKey(intent, 'order');
  assert.equal(key.length, 45); assert.equal(key, idempotencyKey(structuredClone(intent), 'order'));
  for (const change of [{ id: 'intent-2' }, { companyId: 'other' }, { environment: 'production' }]) {
    assert.notEqual(key, idempotencyKey({ ...intent, ...change }, 'order'));
  }
  assert.notEqual(key, idempotencyKey(intent, 'invoice'));
  const prefix = 'x'.repeat(150);
  assert.notEqual(idempotencyKey({ ...intent, id: prefix + 'a' }, 'order'), idempotencyKey({ ...intent, id: prefix + 'b' }, 'order'));
});

test('failed provider response preserves the same intent and resumes exact request body', async () => {
  let fail = true;
  const h = harness({ override: { '/invoices': () => { if (fail) { fail = false; throw Error('Lost response'); } return ok({ invoice: draft }); } } });
  await assert.rejects(h.run(), error => error.code === 'provider_unconfirmed' && error.stage === 'invoice');
  assert.equal(h.saved.receipts.order.id, order.id); assert.equal(h.saved.receipts.invoice, undefined);
  await h.run();
  const retries = h.calls.filter(call => call.path === '/invoices'); assert.equal(retries.length, 2);
  assert.deepEqual(retries[0].body, retries[1].body);
});

test('in-memory edits after begin cannot alter frozen provider request bodies', async () => {
  const h = harness(); const mutable = initial();
  h.store.begin = async () => mutable;
  const originalRequest = h.request;
  const workflow = create({ store: h.store, request: async (method, path, body) => {
    mutable.payload.contactEmail = 'changed@example.invalid'; mutable.payload.lineItems[0].rate = 999;
    return originalRequest(method, path, body);
  } });
  await workflow.send('estimate-1', 7);
  assert.equal(h.calls.find(call => call.path === '/customers/search').body.query.filter.email_address.exact, customer.email_address);
  assert.equal(h.calls.find(call => call.path === '/orders').body.order.line_items[0].base_price_money.amount, 10050);
});

test('server completion metadata is preserved without allowing financial field substitutions', async () => {
  const h = harness({ completeAcknowledgement: value => {
    delete value.result.intentId;
    value.result.association = { company: 'company-1', attached: true };
    return value;
  } });
  const result = await h.run();
  assert.equal(result.association.attached, true); assert.equal(result.squareInvoiceId, draft.id);
});

test('non-HTTPS or credential-bearing payment links cannot be presented as completed success', async () => {
  for (const public_url of ['http://example.invalid/pay', 'javascript:alert(1)', 'https://user:password@example.invalid/pay']) {
    const h = harness({ override: { '/invoices/inv%3A1/publish': ok({ invoice: { ...published, public_url } }) } });
    await assert.rejects(h.run(), error => error.code === 'invalid_receipt');
    assert.equal(h.storeCalls.some(call => call.action === 'complete'), false);
  }
});
