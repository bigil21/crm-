const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const company = 'test-company';
const publicKey = 'sb_publishable_synthetic';
const bearer = 'Bearer synthetic-user-session';
const user = { id: 'user-1', email: 'sales@coastalcrestroofing.com', app_metadata: { role: 'sales' } };
const row = (type, id, leadId, jobId, data = {}) => ({ id, record_type: type, company_state_id: company,
  lead_id: leadId, job_id: jobId, deleted_at: null, version: 1, data: { id, ...data } });
const dataset = (count = 1) => [
  row('contact', 'lead-1', 'lead-1', null),
  row('job', 'job-1', 'lead-1', 'job-1'),
  ...Array.from({ length: count }, (_, i) => row('estimate', `estimate-${String(i).padStart(3, '0')}`, 'lead-1', 'job-1', {
    contactId: 'lead-1', jobId: 'job-1', squareInvoiceId: `inv:${i}`, squareOrderId: `order-${i}`,
  })),
];
const json = (status, value, range) => ({ ok: status >= 200 && status < 300, status, json: async () => structuredClone(value),
  headers: { get: key => key.toLowerCase() === 'content-range' ? range : null } });
const invoice = id => ({ id, order_id: `order-${id.split(':').at(-1)}`, status: 'PARTIALLY_PAID', updated_at: '2026-09-14T12:00:00Z',
  payment_requests: [{ total_completed_amount_money: { amount: 1600000 }, computed_amount_money: { amount: 3200000 } }] });

function backend({ records = dataset(), env = {}, pageSize = 100, rest, provider, authUser = user } = {}) {
  const restCalls = [], squareCalls = [], authCalls = [];
  let route;
  const context = vm.createContext({
    console, URL, Buffer, setTimeout, clearTimeout, AbortSignal, __dirname: root, module: { exports: {} },
    process: { env: { CRM_SKIP_ENV_FILES: 'true', AUTH_REQUIRED: 'true', SUPABASE_URL: 'https://unit.supabase.co',
      SUPABASE_ANON_KEY: publicKey, SUPABASE_STATE_ID: company, SQUARE_ACCESS_TOKEN: 'synthetic-square-token', ...env } },
    require(name) {
      if (name === 'fs') return { existsSync: () => false, readFile: () => { throw Error('Unexpected file read'); }, writeFileSync: () => { throw Error('Read-only endpoint must not write files'); } };
      if (name === 'http') return { createServer: handler => { route = handler; return {}; } };
      if (name === 'https') throw Error('External network must not be used in these tests');
      return require(name);
    },
    async fetch(input, options) {
      const url = new URL(String(input));
      if (url.origin === 'https://unit.supabase.co' && url.pathname === '/auth/v1/user') {
        authCalls.push({ url, options }); return authUser ? json(200, authUser) : json(401, {});
      }
      if (url.origin === 'https://unit.supabase.co' && url.pathname === '/rest/v1/crm_records') {
        const call = { url, options }; restCalls.push(call);
        if (rest) return rest(call, restCalls.length);
        const type = url.searchParams.get('record_type').slice(3);
        const filter = url.searchParams.get('id') || url.searchParams.get('data->>squareInvoiceId');
        const ids = JSON.parse(`[${filter.slice(4, -1)}]`);
        const matches = records.filter(record => record.record_type === type && record.company_state_id === company && record.deleted_at === null &&
          ids.includes(url.searchParams.has('id') ? record.id : record.data.squareInvoiceId))
          .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        const offset = Number(url.searchParams.get('offset'));
        const chunk = matches.slice(offset, offset + Math.min(pageSize, Number(url.searchParams.get('limit'))));
        return json(200, chunk, chunk.length ? `${offset}-${offset + chunk.length - 1}/${matches.length}` : `*/${matches.length}`);
      }
      if (url.origin === 'https://connect.squareup.com' && url.pathname.startsWith('/v2/invoices/')) {
        const call = { url, options, invoiceId: decodeURIComponent(url.pathname.slice('/v2/invoices/'.length)) };
        squareCalls.push(call);
        if (provider) return provider(call, squareCalls.length);
        return json(200, { invoice: invoice(call.invoiceId) });
      }
      throw Error(`Unmocked outbound URL: ${url.origin}${url.pathname}`);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), context);
  context.readRequestBody = async req => req.rawBody;
  const request = (body = { invoiceIds: ['inv:0'] }, { authorization = bearer, directUser, direct = false, url = '/api/square/payment-status', method = 'POST' } = {}) => new Promise((resolve, reject) => {
    const req = { url, method, headers: { host: 'localhost', authorization },
      rawBody: typeof body === 'string' ? body : JSON.stringify(body), socket: { remoteAddress: '127.0.0.1' } };
    const res = { setHeader() {}, writeHead(status) { this.status = status; }, end(raw) {
      let body; try { body = JSON.parse(raw); } catch { body = raw; }
      resolve({ status: this.status, body });
    } };
    Promise.resolve(direct ? context.handleSquarePaymentStatus(req, res, directUser) : route(req, res)).catch(reject);
  });
  return { context, request, restCalls, squareCalls, authCalls };
}

test('aborted refresh budget stops both database and provider lookups before network access', async () => {
  const b = backend(); const signal = AbortSignal.abort(new Error('Synthetic deadline'));
  await assert.rejects(() => b.context.squareStatusReadRecords({ origin: 'https://unit.supabase.co', anonKey: publicKey, companyId: company }, bearer, 'estimate', 'id', ['estimate-000'], signal), /Synthetic deadline/);
  await assert.rejects(() => b.context.squareStatusReadInvoice('inv:0', { orderId: 'order-0' }, signal), /Synthetic deadline/);
  assert.equal(b.restCalls.length, 0); assert.equal(b.squareCalls.length, 0);
});

test('sales caller may read only trusted shared invoice associations with their own bearer', async () => {
  const b = backend(); const result = await b.request();
  assert.equal(result.status, 200); assert.equal(result.body.payments['inv:0'].paidAmount, 16000);
  assert.equal(result.body.payments['inv:0'].leadId, 'lead-1'); assert.equal(result.body.payments['inv:0'].jobId, 'job-1');
  assert.equal(b.authCalls.length, 1); assert.equal(b.restCalls.length, 3); assert.equal(b.squareCalls.length, 1);
  for (const { url, options } of b.restCalls) {
    assert.equal(options.method, 'GET'); assert.equal(options.headers.Authorization, bearer);
    assert.equal(options.headers.apikey, publicKey); assert.equal(options.headers.Prefer, 'count=exact');
    assert.equal(url.searchParams.get('company_state_id'), `eq.${company}`);
    assert.equal(url.searchParams.get('deleted_at'), 'is.null'); assert.equal(url.searchParams.get('order'), 'id.asc');
    assert.ok(options.signal);
  }
  assert.equal(b.squareCalls[0].options.method, 'GET'); assert.ok(b.squareCalls[0].options.signal);
});

for (const body of [{}, [], null, 'bad JSON', { invoiceIds: [] }, { invoiceIds: 'inv:0' }, { invoiceIds: ['inv:0', 'inv:0'] },
  { invoiceIds: Array.from({ length: 21 }, (_, i) => `inv:${i}`) }, ...['', ' inv:0', 'inv:0 ', '../other', 'a/b', 'a?b', 'a"b', 'a,b', {}, 1, null, 'a'.repeat(201)].map(id => ({ invoiceIds: [id] }))]) {
  test(`invalid request is rejected without reference/provider calls: ${JSON.stringify(body)}`, async () => {
    const b = backend(); const result = await b.request(body);
    assert.equal(result.status, 400); assert.equal(b.restCalls.length, 0); assert.equal(b.squareCalls.length, 0);
  });
}

test('anonymous and invalid real sessions are rejected without provider lookup', async () => {
  for (const options of [{ authorization: '' }, {}]) {
    const b = backend({ authUser: null }); const result = await b.request(undefined, options);
    assert.equal(result.status, 401); assert.equal(b.restCalls.length, 0); assert.equal(b.squareCalls.length, 0);
  }
});

test('local demo cannot query business provider data even when Square is configured', async () => {
  const b = backend({ env: { NODE_ENV: 'development', ALLOW_LOCAL_DEMO: 'true', AUTH_REQUIRED: 'false' } });
  const result = await b.request(); assert.equal(result.status, 401);
  assert.equal(b.authCalls.length, 0); assert.equal(b.restCalls.length, 0); assert.equal(b.squareCalls.length, 0);
});

test('handler does not accept an unverified/missing caller', async () => {
  const b = backend(); assert.equal((await b.request(undefined, { direct: true })).status, 401);
  assert.equal(b.restCalls.length, 0); assert.equal(b.squareCalls.length, 0);
});

const legacyKey = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
for (const key of ['sb_secret_never_use_this', legacyKey('service_role'), 'invalid-key']) {
  test(`misconfigured private/unknown database key cannot reach reference/provider reads: ${key.split('.')[0]}`, async () => {
    const b = backend({ env: { SUPABASE_ANON_KEY: key } });
    const result = await b.request(undefined, { direct: true, directUser: user });
    assert.equal(result.status, 503); assert.equal(b.restCalls.length, 0); assert.equal(b.squareCalls.length, 0);
  });
  test(`misconfigured private/unknown keys are also stopped before the shared auth lookup: ${key.split('.')[0]}`, async () => {
    const b = backend({ env: { SUPABASE_ANON_KEY: key } });
    assert.equal((await b.request()).status, 401);
    assert.equal(b.authCalls.length, 0); assert.equal(b.restCalls.length, 0); assert.equal(b.squareCalls.length, 0);
  });
}

for (const url of ['http://unit.supabase.co', 'https://user:password@unit.supabase.co', 'https://unit.supabase.co/path', 'https://unit.supabase.co?query=1']) {
  test(`unsafe auth origins are rejected before any credential leaves the server: ${url}`, async () => {
    const b = backend({ env: { SUPABASE_URL: url } });
    assert.equal((await b.request()).status, 401);
    assert.equal(b.authCalls.length, 0); assert.equal(b.restCalls.length, 0); assert.equal(b.squareCalls.length, 0);
  });
}

test('legacy anon keys remain supported while service-role environment variables are ignored', async () => {
  const key = legacyKey('anon'); const b = backend({ env: { SUPABASE_ANON_KEY: key, SUPABASE_SERVICE_ROLE_KEY: 'never-use-this' } });
  assert.equal((await b.request()).status, 200);
  assert.ok(b.restCalls.every(call => call.options.headers.apikey === key && call.options.headers.Authorization === bearer));
});

for (const key of ['sb_secret_must_not_escape', legacyKey('service_role'), legacyKey('authenticated'), 'unknown-key', publicKey, legacyKey('anon')]) {
  test(`public auth configuration exposes only validated public keys: ${key.split('.')[0]}`, async () => {
    const b = backend({ env: { SUPABASE_ANON_KEY: key } });
    const response = await b.request(undefined, { url: '/auth-config.js', method: 'GET', authorization: '' });
    assert.equal(response.status, 200);
    const config = JSON.parse(response.body.match(/^window\.ROOFLINE_SUPABASE_CONFIG = ([\s\S]+);$/)[1]);
    const allowed = key === publicKey || key === legacyKey('anon');
    assert.equal(config.supabaseAnonKey, allowed ? key : '');
    assert.equal(config.supabaseUrl, allowed ? 'https://unit.supabase.co' : '');
    if (!allowed) assert.equal(response.body.includes(key), false);
    assert.equal(b.authCalls.length, 0); assert.equal(b.restCalls.length, 0); assert.equal(b.squareCalls.length, 0);
  });
}

for (const mutation of ['missing estimate', 'missing contact', 'missing job', 'deleted estimate', 'deleted contact', 'deleted job',
  'estimate other company', 'contact other company', 'job other company', 'job different lead', 'estimate JSON lead disagreement',
  'estimate JSON job disagreement', 'contact JSON ID disagreement', 'job JSON ID disagreement']) {
  test(`invalid association is rejected before any Square lookup: ${mutation}`, async () => {
    let records = dataset();
    const estimate = records.find(r => r.record_type === 'estimate'), contact = records[0], job = records[1];
    if (mutation.startsWith('missing')) records = records.filter(r => r.record_type !== mutation.split(' ')[1]);
    if (mutation.startsWith('deleted')) records.find(r => r.record_type === mutation.split(' ')[1]).deleted_at = '2026-09-14';
    if (mutation.includes('other company')) records.find(r => r.record_type === mutation.split(' ')[0]).company_state_id = 'other-company';
    if (mutation === 'job different lead') job.lead_id = 'other-lead';
    if (mutation === 'estimate JSON lead disagreement') estimate.data.contactId = 'other-lead';
    if (mutation === 'estimate JSON job disagreement') estimate.data.jobId = 'other-job';
    if (mutation === 'contact JSON ID disagreement') contact.data.id = 'other-id';
    if (mutation === 'job JSON ID disagreement') job.data.id = 'other-id';
    const b = backend({ records }); assert.equal((await b.request()).status, 409); assert.equal(b.squareCalls.length, 0);
  });
}

test('unknown ID makes the whole request fail closed before any known invoice is queried', async () => {
  const b = backend(); assert.equal((await b.request({ invoiceIds: ['inv:0', 'unknown'] })).status, 409);
  assert.equal(b.squareCalls.length, 0);
});

test('same invoice across jobs is rejected; same-job estimate copies are queried once', async () => {
  for (const sameJob of [false, true]) {
    const records = dataset(), original = records.at(-1);
    records.push({ ...structuredClone(original), id: 'estimate-copy', job_id: sameJob ? 'job-1' : 'job-2',
      data: { ...original.data, id: 'estimate-copy', jobId: sameJob ? 'job-1' : 'job-2' } });
    const b = backend({ records }); const result = await b.request();
    assert.equal(result.status, sameJob ? 200 : 409); assert.equal(b.squareCalls.length, sameJob ? 1 : 0);
  }
});

test('provider IDs/order associations must match saved references', async () => {
  for (const patch of [{ id: 'different' }, { order_id: 'different' }]) {
    const b = backend({ provider: async ({ invoiceId }) => json(200, { invoice: { ...invoice(invoiceId), ...patch } }) });
    const result = await b.request(); assert.equal(result.status, 200);
    assert.ok(result.body.payments['inv:0'].error); assert.equal(result.body.payments['inv:0'].paidAmount, undefined);
  }
});

test('reference reads traverse lower provider page caps without dropping matches', async () => {
  const b = backend({ records: dataset(5), pageSize: 1 });
  const result = await b.request({ invoiceIds: Array.from({ length: 5 }, (_, i) => `inv:${i}`) });
  assert.equal(result.status, 200); assert.equal(b.restCalls.length, 7); assert.equal(b.squareCalls.length, 5);
});

test('reference reads verify more than 1000 matches instead of accepting the first provider page', async () => {
  const records = dataset(); const original = records.pop();
  for (let i = 0; i < 1001; i++) {
    const id = `estimate-${String(i).padStart(4, '0')}`;
    records.push({ ...structuredClone(original), id, data: { ...original.data, id } });
  }
  const b = backend({ records }); assert.equal((await b.request()).status, 200);
  assert.equal(b.restCalls.length, 13); assert.equal(b.squareCalls.length, 1);
});

test('reference page budget exhaustion is explicit and never returns a partial resolution', async () => {
  const original = dataset().at(-1);
  const b = backend({ rest: async ({ url }) => {
    const offset = Number(url.searchParams.get('offset')), id = `estimate-${String(offset).padStart(3, '0')}`;
    return json(200, [{ ...original, id, data: { ...original.data, id } }], `${offset}-${offset}/21`);
  } });
  assert.equal((await b.request()).status, 409); assert.equal(b.restCalls.length, 20); assert.equal(b.squareCalls.length, 0);
});

test('same-job copies with contradictory Square order IDs are rejected before provider calls', async () => {
  const records = dataset(), original = records.at(-1);
  records.push({ ...structuredClone(original), id: 'estimate-copy', data: { ...original.data, id: 'estimate-copy', squareOrderId: 'other-order' } });
  const b = backend({ records }); assert.equal((await b.request()).status, 409); assert.equal(b.squareCalls.length, 0);
});

for (const patch of [{ payment_requests: null }, { updated_at: '' }, { status: '' },
  { payment_requests: [{ computed_amount_money: { amount: -1 } }] },
  { payment_requests: [{ total_completed_amount_money: { amount: 1.5 } }] },
  { payment_requests: [{ computed_amount_money: { amount: 1, currency: 'EUR' } }] },
  { payment_requests: [1, 2].map(() => ({ computed_amount_money: { amount: Number.MAX_SAFE_INTEGER } })) },
]) {
  test(`malformed provider money/status remains a per-invoice error: ${JSON.stringify(patch)}`, async () => {
    const b = backend({ provider: async ({ invoiceId }) => json(200, { invoice: { ...invoice(invoiceId), ...patch } }) });
    const result = await b.request(); assert.equal(result.status, 200); assert.ok(result.body.payments['inv:0'].error);
    assert.equal(result.body.payments['inv:0'].paidAmount, undefined);
  });
}

for (const failure of ['missing count', 'changing count', 'empty page', 'duplicate page', 'wrong range', 'other company', 'deleted row', 'oversized count', 'provider failure']) {
  test(`incomplete or invalid reference snapshots never fall back to Square: ${failure}`, async () => {
    const records = dataset(2).filter(row => row.record_type === 'estimate');
    const b = backend({ rest: async (_call, index) => {
      if (failure === 'missing count') return json(200, records);
      if (failure === 'oversized count') return json(200, records, '0-1/2001');
      if (failure === 'provider failure') return json(500, {});
      if (failure === 'other company') return json(200, [{ ...records[0], company_state_id: 'other' }], '0-0/1');
      if (failure === 'deleted row') return json(200, [{ ...records[0], deleted_at: '2026-09-14' }], '0-0/1');
      if (index === 1) return json(200, [records[0]], '0-0/2');
      if (failure === 'changing count') return json(200, [records[1]], '1-1/3');
      if (failure === 'empty page') return json(200, [], '*/2');
      if (failure === 'duplicate page') return json(200, [records[0]], '1-1/2');
      if (failure === 'wrong range') return json(200, [records[1]], '0-0/2');
      throw Error('Unexpected case');
    } });
    assert.equal((await b.request({ invoiceIds: ['inv:0', 'inv:1'] })).status, 409);
    assert.equal(b.squareCalls.length, 0);
  });
}

test('provider concurrency is bounded at four and per-invoice failures do not drop successful results', async () => {
  let active = 0, peak = 0;
  const b = backend({ records: dataset(20), provider: async ({ invoiceId }) => {
    peak = Math.max(peak, ++active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
    if (invoiceId === 'inv:3') throw Error('network unavailable');
    if (invoiceId === 'inv:7') return json(503, {});
    return json(200, { invoice: invoice(invoiceId) });
  } });
  const result = await b.request({ invoiceIds: Array.from({ length: 20 }, (_, i) => `inv:${i}`) });
  assert.equal(result.status, 200); assert.equal(peak, 4); assert.equal(b.squareCalls.length, 20);
  assert.equal(Object.keys(result.body.payments).length, 20);
  assert.equal(Object.values(result.body.payments).filter(record => record.error).length, 2);
  assert.equal(result.body.payments['inv:0'].paidAmount, 16000);
});

test('all reference validation completes before provider work begins', async () => {
  const b = backend({ provider: async ({ invoiceId }) => {
    assert.equal(b.restCalls.length, 3); return json(200, { invoice: invoice(invoiceId) });
  } });
  assert.equal((await b.request()).status, 200);
});
