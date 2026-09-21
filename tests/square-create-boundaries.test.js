// Synthetic API/store/provider integration only: no database or Square traffic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const company = 'test-company';
const publicKey = 'sb_publishable_synthetic';
const serverKey = 'sb_secret_synthetic_worker';
const bearer = 'Bearer synthetic-admin-session';
const admin = { id: 'admin-1', email: 'admin@coastalcrestroofing.com', app_metadata: { role: 'admin' } };
const requestBody = () => ({ estimateId: 'estimate-1', expectedVersion: 7 });
const initialIntent = () => ({ id: 'intent-1', companyId: company, environment: 'production', status: 'pending', receipts: {},
  payload: { estimateId: 'estimate-1', leadId: 'lead-1', jobId: 'job-1', leadNumber: 'L-1', projectNumber: 'P-1', estimateNumber: 'E-1',
    projectTitle: 'Saved roof project', jobAddress: 'Synthetic saved address', contactName: 'Synthetic Saved Customer', contactEmail: 'saved@example.invalid',
    lineItems: [{ title: 'Saved roof', description: 'Saved work scope', quantity: 1.5, rate: 100.50 }],
    taxRate: 0, deposit: 50.25, total: 150.75, dueDate: '2026-10-15', depositDueDate: '2026-09-16' } });
const customer = { id: 'customer-1', email_address: 'saved@example.invalid' };
const location = { id: 'location-1', status: 'ACTIVE', currency: 'USD' };
const order = { id: 'order-1', location_id: location.id, customer_id: customer.id, total_money: { amount: 15075, currency: 'USD' } };
const draft = { id: 'inv:0-test', version: 0, location_id: location.id, order_id: order.id, delivery_method: 'EMAIL',
  primary_recipient: { customer_id: customer.id }, status: 'DRAFT' };
const published = { ...draft, version: 1, status: 'UNPAID', invoice_number: 'I-1',
  public_url: 'https://example.invalid/pay/test', updated_at: '2026-09-15T12:00:00Z' };
const ok = body => ({ status: 200, body });
const json = (status, value) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(value) });
const rpcName = action => `crm_square_${action}_invoice`;

function harness({ env = {}, authUser = admin, intent = initialIntent(), override = {}, rpc, newCustomer = false,
  checkpointFailure, completeFailure = false, checkpointAcknowledgement, completeAcknowledgement, lostProviderResponse } = {}) {
  const authCalls = [], rpcCalls = [], squareCalls = [], events = [], providerObjects = new Map();
  let saved = structuredClone(intent), failCheckpoint = checkpointFailure, failComplete = completeFailure;
  let loseResponse = lostProviderResponse, route;
  const context = vm.createContext({
    console, URL, Buffer, AbortSignal, setTimeout, clearTimeout, __dirname: root, module: { exports: {} },
    process: { env: { CRM_SKIP_ENV_FILES: 'true', AUTH_REQUIRED: 'true', SUPABASE_URL: 'https://unit.supabase.co',
      SUPABASE_ANON_KEY: publicKey, SUPABASE_SERVICE_ROLE_KEY: serverKey, SUPABASE_STATE_ID: company,
      SQUARE_ACCESS_TOKEN: 'synthetic-square-token', ...env } },
    require(name) {
      if (name === 'fs') return { existsSync: () => false, readFile: () => { throw Error('Unexpected file read'); },
        writeFileSync: () => { throw Error('Invoice endpoint must not fall back to local files'); } };
      if (name === 'http') return { createServer: handler => { route = handler; return {}; } };
      if (name === 'https') throw Error('No real provider network is allowed');
      return require(name); // In particular, load the real square-invoice-workflow.js.
    },
    async fetch(input, options) {
      const url = new URL(String(input));
      if (url.origin === 'https://unit.supabase.co' && url.pathname === '/auth/v1/user') {
        authCalls.push({ url, options }); events.push('auth');
        return authUser ? json(200, authUser) : json(401, {});
      }
      if (url.origin !== 'https://unit.supabase.co' || !url.pathname.startsWith('/rest/v1/rpc/')) {
        throw Error(`Unmocked outbound request: ${url.origin}${url.pathname}`);
      }
      const call = { name: url.pathname.split('/').at(-1), url, options, body: JSON.parse(options.body) };
      rpcCalls.push(call); events.push(`rpc:${call.name}:${call.body.p_stage || ''}`);
      const custom = rpc ? await rpc(call, structuredClone(saved)) : undefined;
      if (custom !== undefined) return custom;
      if (call.name === rpcName('begin')) return json(200, saved);
      if (call.name === rpcName('checkpoint')) {
        if (failCheckpoint === call.body.p_stage) {
          failCheckpoint = null; return json(503, { message: 'synthetic_private_checkpoint_failure' });
        }
        saved = { ...saved, receipts: { ...saved.receipts, [call.body.p_stage]: structuredClone(call.body.p_receipt) } };
        return json(200, checkpointAcknowledgement ? checkpointAcknowledgement(structuredClone(saved), call.body.p_stage) : saved);
      }
      if (call.name === rpcName('complete')) {
        if (failComplete) { failComplete = false; return json(503, { message: 'synthetic_private_completion_failure' }); }
        saved = { ...saved, status: 'complete', result: { ...structuredClone(call.body.p_result), durable: true,
          rows: [{ id: 'estimate-1', record_type: 'estimate', version: 8, data: { id: 'estimate-1', squareInvoiceId: draft.id } }] } };
        return json(200, completeAcknowledgement ? completeAcknowledgement(structuredClone(saved)) : saved);
      }
      throw Error(`Unmocked RPC ${call.name}`);
    },
  });
  vm.runInContext(source, context);
  const responses = { '/customers/search': ok({ customers: newCustomer ? [] : [customer] }), '/customers': ok({ customer }),
    '/locations': ok({ locations: [location] }), '/orders': ok({ order }), '/invoices': ok({ invoice: draft }),
    '/invoices/inv%3A0-test/publish': ok({ invoice: published }), ...override };
  context.squareRequest = async (method, url, body) => {
    const call = { method, url, body: structuredClone(body) };
    squareCalls.push(call); events.push(`square:${url}`);
    assert.ok(Object.hasOwn(responses, url), `Unmocked provider request ${url}`);
    const key = body?.idempotency_key;
    const previous = key && providerObjects.get(key);
    if (previous) {
      assert.equal(previous.url, url, 'Different provider operations must never share an idempotency key');
      assert.deepEqual(call.body, previous.body, 'An idempotent replay must use the identical saved request');
      return structuredClone(previous.response);
    }
    const response = responses[url];
    if (response instanceof Error) throw response;
    const result = typeof response === 'function' ? await response(call) : structuredClone(response);
    if (key && result.status >= 200 && result.status < 300) providerObjects.set(key, { ...call, response: structuredClone(result) });
    // Simulate Square creating the object before its response is lost in transit.
    if (loseResponse === url) { loseResponse = null; throw Error('Synthetic lost provider response'); }
    return result;
  };
  context.readRequestBody = async req => req.rawBody;
  const request = (body = requestBody(), { authorization = bearer, direct = false, directUser,
    url = '/api/square/create-invoice', method = 'POST' } = {}) => new Promise((resolve, reject) => {
    const req = { url, method, headers: { host: 'localhost', authorization },
      rawBody: typeof body === 'string' ? body : JSON.stringify(body), socket: { remoteAddress: '127.0.0.1' } };
    const res = { setHeader() {}, writeHead(status) { this.status = status; }, end(raw) {
      let parsed; try { parsed = JSON.parse(raw); } catch { parsed = raw; }
      resolve({ status: this.status, body: parsed });
    } };
    Promise.resolve(direct ? context.handleSquareCreateInvoice(req, res, directUser) : route(req, res)).catch(reject);
  });
  return { request, context, authCalls, rpcCalls, squareCalls, events, providerObjects,
    get saved() { return structuredClone(saved); } };
}

function assertNoInvoiceWork(h) {
  assert.equal(h.rpcCalls.length, 0, 'Rejected callers/requests must not begin a saved send attempt');
  assert.equal(h.squareCalls.length, 0, 'Rejected callers/requests must not contact Square');
}

test('verified admin sends only the trusted saved estimate and receives durable shared completion', async () => {
  const h = harness(); const result = await h.request();
  assert.equal(result.status, 200); assert.equal(result.body.durable, true);
  assert.equal(result.body.squareInvoiceId, draft.id); assert.equal(result.body.squareOrderId, order.id);
  assert.equal(result.body.squareDeliveryMethod, 'EMAIL'); assert.equal(result.body.contractValue, 150.75);
  assert.equal(result.body.rows[0].version, 8); assert.equal(result.body.rows[0].data.squareInvoiceId, draft.id);
  assert.equal(h.saved.status, 'complete'); assert.equal(h.authCalls.length, 1);
  assert.deepEqual(h.rpcCalls[0].body, { p_company: company, p_actor: admin.id, p_estimate_id: 'estimate-1',
    p_expected_version: 7, p_environment: 'production' });
  assert.deepEqual(h.rpcCalls.map(call => call.body.p_stage || call.name), [rpcName('begin'), 'customer', 'location', 'order', 'invoice', 'published', rpcName('complete')]);
  assert.equal(h.events[1], `rpc:${rpcName('begin')}:`);
  assert.equal(h.events.at(-1), `rpc:${rpcName('complete')}:`);
  assert.equal(h.squareCalls.find(call => call.url === '/customers/search').body.query.filter.email_address.exact, 'saved@example.invalid');
  const sentOrder = h.squareCalls.find(call => call.url === '/orders').body.order;
  assert.deepEqual(sentOrder.line_items, [{ name: 'Saved roof', quantity: '1.5', base_price_money: { amount: 10050, currency: 'USD' }, note: 'Saved work scope' }]);
  const sentInvoice = h.squareCalls.find(call => call.url === '/invoices').body.invoice;
  assert.equal(sentInvoice.primary_recipient.customer_id, customer.id); assert.equal(sentInvoice.delivery_method, 'EMAIL');
  assert.equal(sentInvoice.title, 'P-1 | E-1 — Synthetic Saved Customer');
  assert.deepEqual(sentInvoice.payment_requests, [
    { request_type: 'DEPOSIT', due_date: '2026-09-16', fixed_amount_requested_money: { amount: 5025, currency: 'USD' } },
    { request_type: 'BALANCE', due_date: '2026-10-15' },
  ]);
  assert.equal(h.rpcCalls.at(-1).body.p_result.squareInvoiceId, draft.id);
  for (const call of h.rpcCalls) {
    assert.equal(call.options.method, 'POST'); assert.equal(call.options.headers.apikey, serverKey);
    assert.equal(call.options.headers.Authorization, undefined, 'Modern secret keys are not JWT bearer tokens'); assert.ok(call.options.signal);
    assert.equal(call.body.p_company, company);
    if (call.name !== rpcName('begin')) assert.equal(call.body.p_intent, 'intent-1');
  }
  assert.equal(h.authCalls[0].options.headers.apikey, publicKey);
  assert.equal(h.authCalls[0].options.headers.Authorization, bearer);
  assert.equal(JSON.stringify(result).includes(serverKey), false);
});

test('the private worker key never appears in public browser auth configuration', async () => {
  const h = harness(); const result = await h.request(undefined, { url: '/auth-config.js', method: 'GET', authorization: '' });
  assert.equal(result.status, 200); assert.equal(result.body.includes(serverKey), false);
  const config = JSON.parse(result.body.match(/^window\.ROOFLINE_SUPABASE_CONFIG = ([\s\S]+);$/)[1]);
  assert.equal(config.supabaseAnonKey, publicKey); assert.equal(h.authCalls.length, 0); assertNoInvoiceWork(h);
});

for (const [label, options, requestOptions, status] of [
  ['anonymous', {}, { authorization: '' }, 401],
  ['expired or invalid session', { authUser: null }, {}, 401],
  ['sales session', { authUser: { ...admin, app_metadata: { role: 'sales' } } }, {}, 403],
  ['viewer session', { authUser: { ...admin, app_metadata: { role: 'viewer' } } }, {}, 403],
  ['outside company domain', { authUser: { ...admin, email: 'admin@outside.invalid' } }, {}, 401],
  ['local demo admin', { env: { NODE_ENV: 'development', ALLOW_LOCAL_DEMO: 'true', AUTH_REQUIRED: 'false' } }, {}, 403],
  ['missing direct caller', {}, { direct: true }, 403],
  ['direct caller without verified ID', {}, { direct: true, directUser: { email: admin.email, app_metadata: admin.app_metadata } }, 403],
  ['direct local identity with ID', {}, { direct: true, directUser: { ...admin, local: true } }, 403],
]) test(`${label} cannot start a database intent or provider operation`, async () => {
  const h = harness(options); assert.equal((await h.request(undefined, requestOptions)).status, status); assertNoInvoiceWork(h);
});

const invalidBodies = [{}, [], null, 'bad JSON', 1, { estimateId: 'estimate-1' }, { expectedVersion: 7 },
  ...[0, -1, 1.5, '7', null, Number.MAX_SAFE_INTEGER + 1].map(expectedVersion => ({ ...requestBody(), expectedVersion })),
  ...['', ' estimate-1', 'estimate-1 ', '../other', 'a/b', 'a?b', 'a"b', 'a,b', {}, 1, null, 'x'.repeat(201)].map(estimateId => ({ ...requestBody(), estimateId })),
  ...['contactEmail', 'contactName', 'leadId', 'jobId', 'leadNumber', 'projectNumber', 'total', 'lineItems', 'deposit', 'taxRate', 'dueDate', 'intentId', 'companyId', 'environment', 'durable', 'receipts']
    .map(key => ({ ...requestBody(), [key]: 'browser-supplied-value' })),
  '{"estimateId":"estimate-1","expectedVersion":7,"__proto__":{"role":"admin"}}'];
for (const body of invalidBodies) test(`malformed or browser-supplied invoice fields fail closed: ${JSON.stringify(body)}`, async () => {
  const h = harness(); const result = await h.request(body);
  assert.equal(result.status, 400); assert.equal(result.body.noProviderAction, true); assertNoInvoiceWork(h);
});

const legacyKey = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
for (const key of ['', 'invalid-private-key', publicKey, legacyKey('anon'), legacyKey('authenticated')]) {
  test(`missing/invalid private worker key cannot begin sending: ${key || '(missing)'}`, async () => {
    const h = harness({ env: { SUPABASE_SERVICE_ROLE_KEY: key } }); const result = await h.request();
    assert.equal(result.status, 503); assert.match(result.body.error, /not configured/);
    assert.equal(result.body.noProviderAction, true); assertNoInvoiceWork(h);
  });
}
for (const env of [{ SQUARE_ACCESS_TOKEN: '' }, { SUPABASE_URL: '' }, { SUPABASE_ANON_KEY: '' },
  { SUPABASE_ANON_KEY: serverKey }, { SUPABASE_URL: 'http://unit.supabase.co' }]) {
  test(`missing/unsafe public or provider configuration cannot reach a worker: ${JSON.stringify(env)}`, async () => {
    const h = harness({ env }); const result = await h.request(undefined, { direct: true, directUser: admin });
    assert.equal(result.status, 503); assert.equal(result.body.noProviderAction, true); assertNoInvoiceWork(h);
  });
}

test('legacy service-role credentials remain server-only and sandbox intent requests are scoped correctly', async () => {
  const key = legacyKey('service_role'); const intent = initialIntent(); intent.environment = 'sandbox';
  const h = harness({ intent, env: { SUPABASE_SERVICE_ROLE_KEY: key, SQUARE_ENVIRONMENT: 'sandbox' } });
  assert.equal((await h.request()).status, 200);
  assert.equal(h.rpcCalls[0].body.p_environment, 'sandbox');
  assert.ok(h.rpcCalls.every(call => call.options.headers.apikey === key));
  assert.ok(h.rpcCalls.every(call => call.options.headers.Authorization === `Bearer ${key}`));
  assert.equal(h.authCalls[0].options.headers.apikey, publicKey);
});

test('dedicated modern secret configuration takes precedence over the legacy service-role variable', async () => {
  const key = 'sb_secret_preferred_worker';
  const h = harness({ env: { SUPABASE_SECRET_KEY: key, SUPABASE_SERVICE_ROLE_KEY: legacyKey('service_role') } });
  assert.equal((await h.request()).status, 200);
  for (const call of h.rpcCalls) {
    assert.equal(call.options.headers.apikey, key); assert.equal(call.options.headers.Authorization, undefined);
  }
  const publicResult = await h.request(undefined, { url: '/auth-config.js', method: 'GET', authorization: '' });
  assert.equal(publicResult.body.includes(key), false);
  assert.equal(h.authCalls[0].options.headers.apikey, publicKey);
});

for (const code of ['legacy_invoice_review_required', 'estimate_changed_before_invoice', 'won_estimate_required',
  'invoice_already_linked', 'saved_customer_email_and_numbers_required']) {
  test(`database business refusal remains a conflict and performs no provider operation: ${code}`, async () => {
    const h = harness({ rpc: () => json(400, { message: code, details: 'synthetic-private-database-detail' }) });
    const result = await h.request(); assert.equal(result.status, 409); assert.equal(result.body.reviewRequired, true);
    assert.equal(result.body.code, code); assert.equal(result.body.stage, 'begin'); assert.equal(result.body.noProviderAction, true);
    assert.equal(result.body.error.includes('could not be fully confirmed'), false);
    assert.equal(JSON.stringify(result).includes('synthetic-private-database-detail'), false);
    assert.equal(h.rpcCalls.length, 1); assert.equal(h.squareCalls.length, 0);
  });
}

for (const [label, rpc] of [
  ['missing schema', () => json(404, { message: 'Could not find crm_square_begin_invoice in the schema cache', details: serverKey })],
  ['database unavailable', () => json(503, { message: 'synthetic-private-database-detail' })],
  ['database network failure', () => { throw Error(`synthetic-private-database-detail ${serverKey}`); }],
  ['unreadable database response', () => ({ ok: true, status: 200, json: async () => { throw Error('synthetic-private-database-detail'); } })],
  ['missing intent', () => json(200, null)],
  ['malformed intent', () => json(200, {})],
]) test(`${label} stops before Square and never leaks private database details`, async () => {
  const h = harness({ rpc }); const result = await h.request();
  assert.equal(result.status, 503); assert.equal(result.body.reviewRequired, true);
  assert.equal(h.rpcCalls.length, 1); assert.equal(h.squareCalls.length, 0);
  for (const privateValue of [serverKey, 'synthetic-private-database-detail', 'schema cache']) assert.equal(JSON.stringify(result).includes(privateValue), false);
});

for (const stage of ['customer', 'location', 'order', 'invoice', 'published']) {
  test(`unconfirmed ${stage} receipt stops later side effects and retries the original durable intent`, async () => {
    const h = harness({ checkpointFailure: stage, newCustomer: true }); const first = await h.request();
    assert.equal(first.status, 503); assert.equal(first.body.reviewRequired, true);
    assert.equal(h.saved.receipts[stage], undefined);
    assert.equal(h.rpcCalls.some(call => call.name === rpcName('complete')), false);
    const forbidden = { customer: '/locations', location: '/orders', order: '/invoices', invoice: '/invoices/inv%3A0-test/publish' }[stage];
    if (forbidden) assert.equal(h.squareCalls.some(call => call.url === forbidden), false);
    const second = await h.request(); assert.equal(second.status, 200); assert.equal(second.body.durable, true);
    assert.equal(second.body.squareInvoiceId, draft.id); assert.equal(second.body.squareOrderId, order.id);
    assert.deepEqual(h.rpcCalls.filter(call => call.name === rpcName('begin')).map(call => call.body), [h.rpcCalls[0].body, h.rpcCalls[0].body]);
    const operations = ['/customers', '/orders', '/invoices', '/invoices/inv%3A0-test/publish'];
    assert.equal(h.providerObjects.size, operations.length, 'Retry must not create a second provider object or publish operation');
    for (const url of operations) {
      const attempts = h.squareCalls.filter(call => call.url === url);
      assert.ok(attempts.length >= 1);
      assert.ok(attempts.every(call => call.body.idempotency_key.length === 45));
      assert.equal(new Set(attempts.map(call => call.body.idempotency_key)).size, 1);
      for (const call of attempts) assert.deepEqual(call.body, attempts[0].body);
    }
  });
}

test('incomplete checkpoint acknowledgement cannot advance even when the RPC reports HTTP success', async () => {
  const h = harness({ checkpointAcknowledgement: intent => { intent.receipts = {}; return intent; } });
  assert.equal((await h.request()).status, 503);
  assert.equal(h.squareCalls.some(call => call.url === '/orders'), false);
  assert.equal(h.rpcCalls.some(call => call.name === rpcName('complete')), false);
});

test('lost invoice response retries the same key and object without duplicating earlier provider objects', async () => {
  const h = harness({ lostProviderResponse: '/invoices', newCustomer: true });
  assert.equal((await h.request()).status, 503);
  assert.equal(h.saved.receipts.order.id, order.id); assert.equal(h.saved.receipts.invoice, undefined);
  assert.equal(h.squareCalls.some(call => call.url.endsWith('/publish')), false);
  const result = await h.request(); assert.equal(result.status, 200); assert.equal(result.body.squareInvoiceId, draft.id);
  const attempts = h.squareCalls.filter(call => call.url === '/invoices'); assert.equal(attempts.length, 2);
  assert.deepEqual(attempts[0].body, attempts[1].body); assert.equal(h.providerObjects.size, 4);
  assert.equal(h.squareCalls.filter(call => call.url === '/customers').length, 1);
  assert.equal(h.squareCalls.filter(call => call.url === '/orders').length, 1);
});

test('failed shared completion is never success and resumes without republishing', async () => {
  const h = harness({ completeFailure: true }); const failed = await h.request();
  assert.equal(failed.status, 503); assert.equal(failed.body.reviewRequired, true);
  assert.equal(h.saved.status, 'pending'); assert.equal(h.saved.receipts.published.id, draft.id);
  const before = h.squareCalls.length; const result = await h.request();
  assert.equal(result.status, 200); assert.equal(result.body.durable, true); assert.equal(h.squareCalls.length, before);
  assert.equal(h.squareCalls.filter(call => call.url.endsWith('/publish')).length, 1);
  assert.equal(h.rpcCalls.filter(call => call.name === rpcName('complete')).length, 2);
});

for (const durable of [undefined, false, 'true']) test(`completion requires literal durable:true, not ${String(durable)}`, async () => {
  const h = harness({ completeAcknowledgement: intent => { intent.result.durable = durable; return intent; } });
  const result = await h.request(); assert.equal(result.status, 503); assert.equal(result.body.reviewRequired, true);
});

test('completed same-intent retry returns its durable receipt without further provider writes', async () => {
  const h = harness(); const first = await h.request(); const count = h.squareCalls.length;
  const second = await h.request(); assert.equal(second.status, 200); assert.deepEqual(second.body, first.body);
  assert.equal(h.squareCalls.length, count);
  assert.equal(h.rpcCalls.filter(call => call.name === rpcName('complete')).length, 1);
  assert.equal(h.rpcCalls.at(-1).name, rpcName('begin'));
});

for (const [label, override, forbidden] of [
  ['failed customer lookup', { '/customers/search': { status: 503, body: {} } }, '/customers'],
  ['wrong customer email', { '/customers/search': ok({ customers: [{ ...customer, email_address: 'wrong@example.invalid' }] }) }, '/orders'],
  ['ambiguous customer', { '/customers/search': ok({ customers: [customer, { ...customer, id: 'customer-2' }] }) }, '/orders'],
  ['inactive location', { '/locations': ok({ locations: [{ ...location, status: 'INACTIVE' }] }) }, '/orders'],
  ['different order amount', { '/orders': ok({ order: { ...order, total_money: { amount: 15076, currency: 'USD' } } }) }, '/invoices'],
  ['unsafe order ID', { '/orders': ok({ order: { ...order, id: '../other' } }) }, '/invoices'],
  ['manual invoice delivery', { '/invoices': ok({ invoice: { ...draft, delivery_method: 'SHARE_MANUALLY' } }) }, '/invoices/inv%3A0-test/publish'],
  ['unconfirmed invoice recipient', { '/invoices': ok({ invoice: { ...draft, primary_recipient: { customer_id: 'wrong' } } }) }, '/invoices/inv%3A0-test/publish'],
  ['still draft after publishing', { '/invoices/inv%3A0-test/publish': ok({ invoice: { ...published, status: 'DRAFT' } }) }, null],
  ['different published invoice', { '/invoices/inv%3A0-test/publish': ok({ invoice: { ...published, id: 'inv:other' } }) }, null],
]) test(`${label} never reaches durable API success`, async () => {
  const h = harness({ override }); const result = await h.request();
  assert.equal(result.status, 503); assert.equal(result.body.reviewRequired, true);
  if (forbidden) assert.equal(h.squareCalls.some(call => call.url === forbidden), false);
  assert.equal(h.rpcCalls.some(call => call.name === rpcName('complete')), false);
  assert.equal(h.saved.status, 'pending');
});
