// Synthetic signatures and local PostgreSQL only. No provider, server or filesystem writes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260915_square_webhook_inbox.sql'), 'utf8');
const webhookUrl = 'https://crm.example.invalid/webhooks/square';
const signingKey = 'synthetic-signature-key-not-a-credential';
const company = 'coastal-crest';
let eventSequence = 0;
const event = overrides => ({ event_id: `event-${++eventSequence}`, merchant_id: 'merchant-synthetic',
  type: 'invoice.payment_made', created_at: '2026-09-15T10:00:00Z',
  data: { object: { invoice: { id: 'inv:synthetic', status: 'PARTIALLY_PAID', payment_requests: [
    { computed_amount_money: { amount: 3200000, currency: 'USD' }, total_completed_amount_money: { amount: 1600000, currency: 'USD' } },
  ] } } }, ...overrides });

function handler(options = {}) {
  const calls = []; let response;
  const env = { SQUARE_WEBHOOK_URL: webhookUrl, SQUARE_MERCHANT_ID: 'merchant-synthetic', SQUARE_ENVIRONMENT: 'sandbox', ...options.env };
  const c = vm.createContext({ console, Buffer, process: { env },
    require(name) { assert.equal(name, 'crypto', 'Webhook handler must not load or write filesystem/provider modules'); return crypto; },
    fs: new Proxy({}, { get() { throw Error('No filesystem access is allowed'); } }),
    squareWebhookKey: () => options.key === undefined ? signingKey : options.key,
    squareWorkerConfig: () => options.config === undefined ? { companyId: company, key: 'synthetic-worker', origin: 'https://test.invalid' } : options.config,
    readRequestBody: async req => req.body,
    squareWorkerRpc: async (config, name, payload) => {
      calls.push({ config, name, payload });
      if (options.enqueue) return options.enqueue(payload);
      return { durable: true, eventId: payload.p_event.event_id, duplicate: false };
    },
    sendJson: (_res, status, body) => { response = { status, body }; },
  });
  for (const name of ['squareStatusSafeId', 'handleSquareWebhook']) {
    const match = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    assert.ok(match, `Function ${name} exists`); vm.runInContext(match[0], c);
  }
  return {
    calls,
    async request(payload = event(), { raw, signature, headers = {}, signedUrl = webhookUrl } = {}) {
      const body = raw === undefined ? JSON.stringify(payload) : raw;
      const digest = crypto.createHmac('sha256', signingKey).update(signedUrl + body).digest('base64');
      await c.handleSquareWebhook({ body, headers: { 'x-square-hmacsha256-signature': signature === undefined ? digest : signature,
        'square-environment': 'sandbox', ...headers } }, {});
      return response;
    },
  };
}

for (const [name, options] of [
  ['missing signing key', { key: '' }],
  ['missing fixed URL', { env: { SQUARE_WEBHOOK_URL: '' } }],
  ['missing durable worker', { config: null }],
  ['missing merchant', { env: { SQUARE_MERCHANT_ID: '' } }],
  ['malformed merchant', { env: { SQUARE_MERCHANT_ID: '../merchant' } }],
]) test(`webhook fails closed before enqueue: ${name}`, async () => {
  const h = handler(options); assert.equal((await h.request()).status, 503); assert.equal(h.calls.length, 0);
});

for (const [name, request] of [
  ['missing signature', { signature: '' }],
  ['wrong signature', { signature: 'invalid' }],
  ['same-length wrong signature', { signature: 'A'.repeat(44) }],
  ['signature for another URL', { signedUrl: 'https://other.invalid/webhooks/square' }],
]) test(`webhook rejects ${name}`, async () => {
  const h = handler(); assert.equal((await h.request(event(), request)).status, 401); assert.equal(h.calls.length, 0);
});

test('signature verification covers exact raw bytes, not reserialized JSON', async () => {
  const h = handler(); const payload = event();
  const signature = crypto.createHmac('sha256', signingKey).update(webhookUrl + JSON.stringify(payload)).digest('base64');
  assert.equal((await h.request(payload, { raw: JSON.stringify(payload, null, 2), signature })).status, 401);
  assert.equal(h.calls.length, 0);
});

test('configured URL wins over untrusted request host or forwarded headers', async () => {
  const h = handler(); const result = await h.request(event(), { headers: { host: 'wrong.invalid', 'x-forwarded-host': 'wrong.invalid' } });
  assert.equal(result.status, 200); assert.equal(result.body.queued, true); assert.equal(h.calls.length, 1);
});

test('matching signature does not bypass exact merchant and environment checks', async () => {
  const wrongMerchant = handler(); assert.equal((await wrongMerchant.request(event({ merchant_id: 'other-merchant' }))).status, 403);
  assert.equal(wrongMerchant.calls.length, 0);
  const wrongEnvironment = handler();
  assert.equal((await wrongEnvironment.request(event(), { headers: { 'square-environment': 'production' } })).status, 403);
  assert.equal(wrongEnvironment.calls.length, 0);
});

test('valid signature on malformed JSON does not enqueue an event', async () => {
  const h = handler(); assert.equal((await h.request(null, { raw: '{invalid-json' })).status, 400); assert.equal(h.calls.length, 0);
});

for (const [name, overrides] of [
  ['missing event ID', { event_id: '' }],
  ['malformed event ID', { event_id: '../escape' }],
  ['missing invoice', { data: {} }],
  ['malformed invoice ID', { data: { object: { invoice: { id: 'bad/id' } } } }],
  ['missing time', { created_at: '' }],
  ['malformed time', { created_at: 'not-a-date' }],
]) test(`supported malformed webhook is rejected: ${name}`, async () => {
  const h = handler(); assert.equal((await h.request(event(overrides))).status, 400); assert.equal(h.calls.length, 0);
});

test('unrelated signed event is explicitly ignored and never changes the invoice inbox', async () => {
  const h = handler(); const result = await h.request(event({ type: 'customer.updated' }));
  assert.deepEqual(JSON.parse(JSON.stringify(result.body)), { received: true, ignored: true });
  assert.equal(result.status, 200); assert.equal(h.calls.length, 0);
});

test('acknowledgement waits for a confirmed durable receipt', async () => {
  let resolve, started;
  const ready = new Promise(done => { started = done; });
  const h = handler({ enqueue: payload => { started(); return new Promise(done => { resolve = () => done({ durable: true, eventId: payload.p_event.event_id }); }); } });
  let finished = false;
  const pending = h.request().then(result => { finished = true; return result; });
  await ready; assert.equal(finished, false);
  resolve(); const result = await pending;
  assert.equal(result.status, 200); assert.equal(result.body.queued, true);
  assert.equal(h.calls[0].name, 'crm_square_enqueue_webhook');
  assert.equal(h.calls[0].payload.p_company, company); assert.equal(h.calls[0].payload.p_environment, 'sandbox');
});

for (const [name, enqueue] of [
  ['database unavailable', async () => { throw Error('synthetic database failure'); }],
  ['non-durable receipt', async payload => ({ durable: false, eventId: payload.p_event.event_id })],
  ['missing receipt', async () => null],
  ['wrong event receipt', async () => ({ durable: true, eventId: 'wrong-event' })],
]) test(`unconfirmed enqueue returns retryable failure: ${name}`, async () => {
  const h = handler({ enqueue }); const result = await h.request();
  assert.equal(result.status, 503); assert.equal(result.body.queued, undefined); assert.match(result.body.error, /retry delivery/);
});

test('a duplicate durable receipt succeeds without pretending reconciliation completed', async () => {
  const h = handler({ enqueue: async payload => ({ durable: true, duplicate: true, eventId: payload.p_event.event_id }) });
  const result = await h.request();
  assert.equal(result.status, 200); assert.equal(result.body.queued, true);
  assert.equal(result.body.paidAmount, undefined); assert.equal(result.body.reconciled, undefined);
  assert.doesNotMatch(source, /square-payments\.json|function handleSquarePollPayments/);
});

const db = new PGlite();
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid,bucket_id text);
    grant usage on schema public,auth,storage to authenticated,anon,service_role;`);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20260914_conflict_safe_record_writes.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20260915_durable_square_invoice_sends.sql'), 'utf8'));
  await db.exec(migration);
  await db.query(`insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,data)
    values($1,'job','inbox-job','inbox-lead','inbox-job',$2::jsonb)`,
  [company, JSON.stringify({ id: 'inbox-job', contractValue: 32000, paidAmount: 16000, notes: 'Do not mutate during intake' })]);
});
after(async () => db.close());
async function as(role = 'service_role', jwtRole = role) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: jwtRole })]);
  if (role !== 'owner') await db.exec(`set role ${role}`);
}
async function enqueue(payload, environment = 'sandbox', scope = company) {
  return (await db.query('select public.crm_square_enqueue_webhook($1,$2,$3::jsonb) as result',
    [scope, environment, JSON.stringify(payload)])).rows[0].result;
}
async function stored(payload, environment = 'sandbox') {
  await as('owner');
  return (await db.query('select * from public.crm_square_webhook_events where company_state_id=$1 and environment=$2 and merchant_id=$3 and event_id=$4',
    [company, environment, payload.merchant_id, payload.event_id])).rows[0];
}

test('inbox enqueue is service-only and no client or worker has direct table access', async () => {
  const payload = event();
  for (const role of ['anon', 'authenticated']) {
    await as(role); await assert.rejects(enqueue(payload), error => error.code === '42501');
    await assert.rejects(db.exec('select * from public.crm_square_webhook_events'), error => error.code === '42501');
  }
  await as('service_role', 'authenticated');
  await assert.rejects(enqueue(payload), /server_worker_required/);
  await as('service_role');
  assert.equal((await enqueue(payload)).durable, true);
  await assert.rejects(db.exec('select * from public.crm_square_webhook_events'), error => error.code === '42501');
  await assert.rejects(db.exec("update public.crm_square_webhook_events set status='complete'"), error => error.code === '42501');
});

test('exact duplicate event is acknowledged once without resetting processing state', async () => {
  const payload = event(); await as();
  assert.deepEqual(await enqueue(payload), { durable: true, duplicate: false, eventId: payload.event_id });
  const original = await stored(payload);
  await db.query("update public.crm_square_webhook_events set status='review',attempts=2,last_error='synthetic retry' where event_id=$1", [payload.event_id]);
  await as(); assert.deepEqual(await enqueue(payload), { durable: true, duplicate: true, eventId: payload.event_id });
  const saved = await stored(payload);
  assert.equal(saved.received_at.getTime(), original.received_at.getTime());
  assert.equal(saved.status, 'review'); assert.equal(saved.attempts, 2); assert.equal(saved.last_error, 'synthetic retry');
});

test('reusing an event ID with changed data is rejected and original payload is retained', async () => {
  const payload = event(); await as(); await enqueue(payload);
  const changed = JSON.parse(JSON.stringify(payload)); changed.data.object.invoice.status = 'PAID';
  await assert.rejects(enqueue(changed), error => error.code === '40001' && /webhook_event_id_reused/.test(error.message));
  assert.deepEqual((await stored(payload)).payload, payload);
});

test('out-of-order invoice events remain separate pending work without changing business balances', async () => {
  await as('owner'); const beforeRecords = (await db.query('select * from public.crm_records order by record_type,id')).rows;
  const beforeAudit = (await db.query('select * from public.crm_audit_events order by id')).rows;
  const newer = event({ created_at: '2026-09-15T12:00:00Z' });
  const older = event({ created_at: '2026-09-14T12:00:00Z' });
  older.data.object.invoice.payment_requests[0].total_completed_amount_money.amount = 100000;
  await as(); await enqueue(newer); await enqueue(older);
  const first = await stored(newer), second = await stored(older);
  assert.equal(first.status, 'pending'); assert.equal(second.status, 'pending');
  assert.ok(second.event_created_at < first.event_created_at);
  assert.equal(first.payload.data.object.invoice.payment_requests[0].total_completed_amount_money.amount, 1600000);
  assert.equal(second.payload.data.object.invoice.payment_requests[0].total_completed_amount_money.amount, 100000);
  assert.deepEqual((await db.query('select * from public.crm_records order by record_type,id')).rows, beforeRecords);
  assert.deepEqual((await db.query('select * from public.crm_audit_events order by id')).rows, beforeAudit);
});

test('event identity is scoped by merchant and environment', async () => {
  const payload = event(); await as();
  assert.equal((await enqueue(payload, 'sandbox')).duplicate, false);
  assert.equal((await enqueue(payload, 'production')).duplicate, false);
  assert.equal((await enqueue({ ...payload, merchant_id: 'merchant-two' }, 'sandbox')).duplicate, false);
  await assert.rejects(enqueue(payload, 'sandbox', 'other-company'), /invalid_invoice_webhook/);
});

for (const [name, mutate] of [
  ['merchant', value => { value.merchant_id = ''; }],
  ['event ID', value => { value.event_id = '../invalid'; }],
  ['invoice ID', value => { value.data.object.invoice.id = ''; }],
  ['event type', value => { value.type = 'unknown'; }],
  ['timestamp', value => { value.created_at = 'not-a-time'; }],
]) test(`database rejects malformed ${name} without inserting the event`, async () => {
  const payload = event(); mutate(payload); await as();
  await assert.rejects(enqueue(payload));
  assert.equal(await stored(payload), undefined);
});

test('reapplying inbox migration preserves queued receipts and retry metadata', async () => {
  const payload = event(); await as(); await enqueue(payload);
  const original = await stored(payload);
  await db.exec(migration);
  assert.deepEqual(await stored(payload), original);
});
