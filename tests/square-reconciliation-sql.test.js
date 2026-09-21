// Synthetic PostgreSQL fixtures only. No Square or hosted database calls.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const db = new PGlite();
const company = 'coastal-crest', environment = 'sandbox', merchant = 'merchant-fixture';
const userId = '00000000-0000-4000-8000-000000000031';
const migration = path.join(root, 'supabase/migrations/20260915_square_payment_reconciliation.sql');
let sequence = 0;
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid,bucket_id text);
    grant usage on schema public,auth,storage to anon,authenticated,service_role;`);
  await db.query('insert into auth.users values($1,$2,$3)', [userId, 'admin@coastalcrestroofing.com', { role: 'admin' }]);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  await db.exec('grant all on all tables in schema public to authenticated;');
  for (const file of ['20260914_conflict_safe_record_writes.sql', '20260915_durable_square_invoice_sends.sql', '20260915_square_webhook_inbox.sql']) {
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'));
  }
  await db.exec(fs.readFileSync(migration, 'utf8'));
});
after(async () => db.close());
async function as(role = 'service') {
  await db.exec('reset role');
  const claims = role === 'service' ? { role: 'service_role' } : role === 'admin' ? { role: 'authenticated', sub: userId,
    email: 'admin@coastalcrestroofing.com', app_metadata: { role: 'admin' } } : {};
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
  if (role !== 'owner') await db.exec(`set role ${role === 'service' ? 'service_role' : role === 'admin' ? 'authenticated' : 'anon'}`);
}
async function fixture({ copies = 1, paid = 0, manual = [{ id: 'check-fixture', amount: 1000.25, date: '2026-09-14' }] } = {}) {
  await as('owner');
  // Prevent an earlier isolated test's retained review/pending fixture from
  // affecting which item the next claim deliberately exercises.
  await db.exec("update public.crm_square_webhook_events set status='review' where status in ('pending','processing')");
  const n = ++sequence, f = { lead: `pay-lead-${n}`, job: `pay-job-${n}`, invoice: `inv:pay-${n}`, order: `order-pay-${n}`, estimates: [] };
  const rows = [
    { type: 'contact', id: f.lead, lead: f.lead, job: null, data: { id: f.lead, name: 'Synthetic lead', notes: 'Keep lead note' } },
    { type: 'job', id: f.job, lead: f.lead, job: f.job, data: { id: f.job, contractValue: 32000, value: 32000, manualPayments: manual,
      notes: 'Keep job note', costItems: [{ id: 'cost', amount: 25.75 }], workflowChecklists: { inspected: true } } },
  ];
  for (let index = 0; index < copies; index++) {
    const id = `pay-estimate-${n}-${index}`; f.estimates.push(id);
    rows.push({ type: 'estimate', id, lead: f.lead, job: f.job, data: { id, contactId: f.lead, jobId: f.job,
      squareInvoiceId: f.invoice, squareOrderId: f.order, contractValue: 32000, paidAmount: paid, notes: `Keep estimate note ${index}`, status: 'Won' } });
  }
  for (const row of rows) await insert(row);
  return f;
}
async function insert(row) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: 'service_role' })]);
  await db.query('insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,data,owner_id,updated_by) values($1,$2,$3,$4,$5,$6,$7,$7)',
    [row.company || company, row.type, row.id, row.lead, row.job, row.data, userId]);
  await db.query("select set_config('request.jwt.claims','{}',false)");
}
function snapshot(f, changes = {}) {
  return { invoiceId: f.invoice, orderId: f.order, version: 2, updatedAt: '2026-09-15T00:00:00Z', status: 'PARTIALLY_PAID',
    contractAmount: 32000, paidAmount: 16000, paymentRequests: [{ type: 'DEPOSIT', requestedAmount: 32000, paidAmount: 16000 }], ...changes };
}
async function enqueue(f, overrides = {}) {
  await as('service');
  const event = { merchant_id: merchant, event_id: `event-${++sequence}`, type: 'invoice.payment_made', created_at: '2026-09-15T00:01:00Z',
    data: { object: { invoice: { id: f.invoice, version: 2, updated_at: '2026-09-15T00:00:00Z' } } }, ...overrides };
  await db.query('select public.crm_square_enqueue_webhook($1,$2,$3)', [company, environment, event]);
  return event.event_id;
}
async function claim(scope = company, env = environment, merchantId = merchant) {
  return (await db.query('select public.crm_square_claim_webhook($1,$2,$3) result', [scope, env, merchantId])).rows[0].result;
}
async function apply(claimed, value) {
  return (await db.query('select public.crm_square_apply_payment($1,$2,$3,$4,$5,$6) result',
    [claimed.companyId, claimed.environment, claimed.merchantId, claimed.eventId, claimed.leaseId, value])).rows[0].result;
}
async function fail(claimed, code = 'provider_unavailable', retryable = true) {
  return (await db.query('select public.crm_square_fail_webhook($1,$2,$3,$4,$5,$6,$7) result',
    [claimed.companyId, claimed.environment, claimed.merchantId, claimed.eventId, claimed.leaseId, code, retryable])).rows[0].result;
}
async function get(type, id) { return (await db.query('select * from public.crm_records where company_state_id=$1 and record_type=$2 and id=$3', [company, type, id])).rows[0]; }
async function eventRow(id) { return (await db.query('select * from public.crm_square_webhook_events where event_id=$1', [id])).rows[0]; }
async function updateData(type, id, update) {
  const old = await get(type, id);
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: 'service_role' })]);
  await db.query('update public.crm_records set data=$1,version=version+1 where company_state_id=$2 and record_type=$3 and id=$4', [update(old.data), company, type, id]);
  await db.query("select set_config('request.jwt.claims','{}',false)");
}
async function adminCommit(change) {
  return db.query('select public.crm_commit_records($1,$2::jsonb,$3::jsonb) result',
    [`payment-admin-${++sequence}`, [change], []]);
}

test('claim/apply/fail and watermark tables are unavailable to browser roles', async () => {
  const f = await fixture(); await enqueue(f); const c = await claim();
  for (const role of ['anon', 'admin']) {
    await as(role); await assert.rejects(claim(), error => error.code === '42501');
    await assert.rejects(apply(c, snapshot(f)), error => error.code === '42501');
    await assert.rejects(fail(c), error => error.code === '42501');
    await assert.rejects(db.exec('select * from public.crm_square_invoice_watermarks'), error => error.code === '42501');
  }
  await as('service'); await assert.rejects(claim('other-company'), /payment_scope_invalid/);
  await assert.rejects(claim(company, 'unknown'), /payment_scope_invalid/);
  assert.equal(await claim(company, environment, 'other-merchant'), null);
});

test('claim leases one invoice, returns true invoice hints and does not compare event emission time to invoice update time', async () => {
  const f = await fixture(); const event = await enqueue(f); const c = await claim();
  assert.equal(c.eventId, event); assert.equal(c.invoiceId, f.invoice); assert.equal(c.attempts, 1);
  assert.equal(c.invoiceVersion, 2); assert.equal(c.invoiceUpdatedAt, '2026-09-15T00:00:00Z');
  assert.equal((await apply(c, snapshot(f))).applied, true);
  await as('owner'); const stored = await eventRow(event);
  assert.equal(stored.status, 'complete'); assert.ok(new Date(stored.lease_until) > new Date(stored.received_at));
});

test('active events for the same invoice are not claimed concurrently, while another invoice can progress', async () => {
  const f = await fixture(); const first = await enqueue(f), second = await enqueue(f);
  const other = { ...f, invoice: 'inv:independent' }; const third = await enqueue(other);
  const a = await claim(), b = await claim();
  assert.equal(a.eventId, first); assert.equal(b.eventId, third); assert.equal(await claim(), null);
  await fail(a, 'needs_review', false);
  assert.equal((await claim()).eventId, second);
});

test('an expired lease is recoverable and fences the previous worker', async () => {
  const f = await fixture(); await enqueue(f); const old = await claim();
  await as('owner'); await db.query("update public.crm_square_webhook_events set lease_until=clock_timestamp()-interval '1 second' where event_id=$1", [old.eventId]);
  await as('service'); const current = await claim();
  assert.notEqual(current.leaseId, old.leaseId); assert.equal(current.attempts, 2);
  await assert.rejects(apply(old, snapshot(f)), /payment_lease_lost/); await assert.rejects(fail(old), /payment_lease_lost/);
  assert.equal((await apply(current, snapshot(f))).applied, true);
});

test('retry failures back off and are idempotent; permanent failures are retained for review', async () => {
  const f = await fixture(); await enqueue(f); const c = await claim();
  const first = await fail(c); assert.equal(first.status, 'pending'); assert.deepEqual(await fail(c), first); assert.equal(await claim(), null);
  await as('owner'); const stored = await eventRow(c.eventId); assert.equal(stored.last_error, 'provider_unavailable');
  assert.ok(new Date(stored.lease_until).getTime() > Date.now());
  await db.query("update public.crm_square_webhook_events set lease_until=clock_timestamp()-interval '1 second' where event_id=$1", [c.eventId]);
  await as('service'); const retry = await claim(); assert.equal((await fail(retry, 'payment_mapping_ambiguous', false)).status, 'review');
  assert.equal(await claim(), null);
});

test('attempt limit converts abandoned work to review instead of infinite retries', async () => {
  const f = await fixture(); const event = await enqueue(f);
  await as('owner'); await db.query('update public.crm_square_webhook_events set attempts=10 where event_id=$1', [event]);
  await as('service'); assert.equal(await claim(), null);
  await as('owner'); assert.equal((await eventRow(event)).status, 'review');
});

test('payment application preserves contract/manual payments/notes/costs and aggregates duplicate invoice copies once', async () => {
  const f = await fixture({ copies: 2 }); await enqueue(f); const c = await claim();
  const result = await apply(c, snapshot(f)); assert.deepEqual(result, { durable: true, eventId: c.eventId, applied: true });
  await as('owner'); const job = await get('job', f.job);
  assert.equal(job.data.squarePaidAmount, 16000); assert.equal(job.data.paidAmount, 17000.25);
  assert.equal(job.data.paymentPercent, 17000.25 / 32000 * 100);
  assert.equal(job.data.contractValue, 32000); assert.equal(job.data.value, 32000);
  assert.deepEqual(job.data.manualPayments, [{ id: 'check-fixture', amount: 1000.25, date: '2026-09-14' }]);
  assert.equal(job.data.notes, 'Keep job note'); assert.equal(job.data.costItems[0].amount, 25.75);
  assert.equal(job.data.workflowChecklists.inspected, true);
  for (const [index, id] of f.estimates.entries()) {
    const estimate = await get('estimate', id); assert.equal(estimate.data.paidAmount, 16000); assert.equal(estimate.data.paymentPercent, 50);
    assert.equal(estimate.data.contractValue, 32000); assert.equal(estimate.data.notes, `Keep estimate note ${index}`);
    assert.equal(estimate.version, 2);
  }
});

test('exact event replay is idempotent and different replay payload cannot claim success', async () => {
  const f = await fixture(); await enqueue(f); const c = await claim(); const first = await apply(c, snapshot(f));
  assert.deepEqual(await apply(c, snapshot(f)), first);
  await assert.rejects(apply(c, snapshot(f, { paidAmount: 10 })), /payment_version_conflict/);
  await as('owner'); assert.equal((await get('estimate', f.estimates[0])).version, 2); assert.equal((await get('job', f.job)).version, 2);
});

test('older versions and exact duplicate versions complete without overwriting current money', async () => {
  const f = await fixture(); await enqueue(f); await apply(await claim(), snapshot(f));
  for (const changes of [{ version: 1, paidAmount: 1, updatedAt: '2026-09-14T00:00:00Z' }, {}]) {
    await enqueue(f); const c = await claim(); assert.equal((await apply(c, snapshot(f, changes))).applied, false);
  }
  await as('owner'); assert.equal((await get('estimate', f.estimates[0])).data.paidAmount, 16000);
  assert.equal((await get('job', f.job)).version, 2);
});

test('same version with conflicting snapshot and newer version with older provider timestamp need review', async () => {
  const f = await fixture(); await enqueue(f); await apply(await claim(), snapshot(f));
  for (const changes of [{ paidAmount: 15000 }, { version: 3, updatedAt: '2026-09-14T00:00:00Z' }]) {
    await enqueue(f); const c = await claim(); await assert.rejects(apply(c, snapshot(f, changes)), /payment_version_conflict/);
    await fail(c, 'payment_version_conflict', false);
  }
});

test('safe net refund amounts need not equal unchanged gross Square request completions', async () => {
  const f = await fixture(); await enqueue(f); await apply(await claim(), snapshot(f));
  await enqueue(f); await apply(await claim(), snapshot(f, { version: 3, updatedAt: '2026-09-15T00:02:00Z', status: 'PARTIALLY_REFUNDED', paidAmount: 12000 }));
  await as('owner'); assert.equal((await get('estimate', f.estimates[0])).data.paidAmount, 12000);
  assert.equal((await get('job', f.job)).data.paidAmount, 13000.25);
});

test('unlinked invoice is retryable and can reconcile after an exact durable binding appears', async () => {
  const f = await fixture(); await as('owner'); await updateData('estimate', f.estimates[0], data => ({ ...data, squareInvoiceId: '' }));
  await enqueue(f); let c = await claim(); await assert.rejects(apply(c, snapshot(f)), /payment_mapping_unavailable/); await fail(c, 'payment_mapping_unavailable', true);
  await as('owner'); await updateData('estimate', f.estimates[0], data => ({ ...data, squareInvoiceId: f.invoice }));
  await db.query("update public.crm_square_webhook_events set lease_until=clock_timestamp()-interval '1 second' where event_id=$1", [c.eventId]);
  await as('service'); c = await claim(); assert.equal((await apply(c, snapshot(f))).applied, true);
});

test('duplicate invoice copies with divergent last-known balances need review', async () => {
  const f = await fixture({ copies: 2 }); await as('owner'); await updateData('estimate', f.estimates[1], data => ({ ...data, paidAmount: 10 }));
  await enqueue(f); const c = await claim(); await assert.rejects(apply(c, snapshot(f)), /payment_history_ambiguous/);
  await as('owner'); assert.equal((await get('estimate', f.estimates[0])).data.paidAmount, 0);
  assert.equal((await eventRow(c.eventId)).status, 'processing');
});

test('cross-job invoice association and wrong order IDs cannot move money', async () => {
  for (const kind of ['job', 'order']) {
    const f = await fixture({ copies: 2 }); await as('owner');
    if (kind === 'job') {
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role: 'service_role' })]);
      await assert.rejects(db.query("update public.crm_records set job_id='different' where record_type='estimate' and id=$1", [f.estimates[1]]), /square_payment_history_is_locked/);
      await db.query("select set_config('request.jwt.claims','{}',false)");
      continue;
    } else await updateData('estimate', f.estimates[1], data => ({ ...data, squareOrderId: 'different' }));
    await enqueue(f); await assert.rejects(apply(await claim(), snapshot(f)), /payment_mapping_ambiguous/);
  }
});

test('multiple invoices on one job sum uniquely while manual payments stay intact', async () => {
  const f = await fixture(); await as('owner');
  await insert({ type: 'estimate', id: `other-${f.estimates[0]}`, lead: f.lead, job: f.job, data: { id: `other-${f.estimates[0]}`, contactId: f.lead,
    jobId: f.job, squareInvoiceId: 'inv:other', squareOrderId: 'order-other', paidAmount: 500.50, contractValue: 32000 } });
  await enqueue(f); await apply(await claim(), snapshot(f));
  await as('owner'); assert.equal((await get('job', f.job)).data.squarePaidAmount, 16500.50);
  assert.equal((await get('job', f.job)).data.paidAmount, 17500.75);
});

test('invalid manual payments or duplicate manual IDs cannot fabricate job totals', async () => {
  for (const manual of [[{ id: 'bad', amount: -1 }], [{ id: 'bad', amount: 1.001 }],
    [{ id: 'duplicate', amount: 5 }, { id: 'duplicate', amount: 5 }], [{ amount: 5 }]]) {
    const f = await fixture({ manual }); await enqueue(f); const c = await claim();
    await assert.rejects(apply(c, snapshot(f)), /manual_payment_invalid/);
    await as('owner'); assert.equal((await get('estimate', f.estimates[0])).data.paidAmount, 0);
  }
});

test('null legacy job contract falls back to its existing value without rewriting either field', async () => {
  const f = await fixture(); await as('owner'); await updateData('job', f.job, data => ({ ...data, contractValue: null }));
  await enqueue(f); await apply(await claim(), snapshot(f));
  await as('owner'); const record = await get('job', f.job);
  assert.equal(record.data.contractValue, null); assert.equal(record.data.value, 32000);
  assert.equal(record.data.paymentPercent, 17000.25 / 32000 * 100);
});

test('missing positive contract denominator preserves balances for review', async () => {
  const f = await fixture(); await as('owner'); await updateData('estimate', f.estimates[0], data => ({ ...data, contractValue: 0 }));
  await enqueue(f); await assert.rejects(apply(await claim(), snapshot(f)), /payment_contract_missing/);
});

test('unrepresented legacy job receipts are retained for review instead of being reduced', async () => {
  const f = await fixture({ paid: 10000 });
  await as('owner'); await updateData('job', f.job, data => ({ ...data, squarePaidAmount: 20000, paidAmount: 21000.25,
    paymentPercent: 21000.25 / 32000 * 100 }));
  await enqueue(f); const c = await claim();
  await assert.rejects(apply(c, snapshot(f, { paidAmount: 11000 })), /payment_history_ambiguous/);
  await as('owner'); const job = await get('job', f.job), estimate = await get('estimate', f.estimates[0]);
  assert.equal(job.data.squarePaidAmount, 20000); assert.equal(job.data.paidAmount, 21000.25);
  assert.equal(estimate.data.paidAmount, 10000); assert.equal((await eventRow(c.eventId)).status, 'processing');
});

test('browser roles cannot overwrite server payment fields or move linked financial history', async () => {
  const f = await fixture(); await enqueue(f); await apply(await claim(), snapshot(f)); await as('admin');
  const estimate = await get('estimate', f.estimates[0]), job = await get('job', f.job);
  const change = (record, data, extra = {}) => ({ company_state_id: company, record_type: record.record_type, id: record.id,
    lead_id: record.lead_id, job_id: record.job_id, expected_version: record.version, operation: 'upsert', data, ...extra });
  await assert.rejects(adminCommit(change(estimate, { ...estimate.data, paidAmount: 1 })), /square_payment_fields_are_server_owned/);
  await assert.rejects(adminCommit(change(estimate, estimate.data, { job_id: 'other-job' })), /square_payment_history_is_locked/);
  await assert.rejects(adminCommit(change(job, { ...job.data, squarePaidAmount: 1 })), /square_payment_fields_are_server_owned/);
  await assert.rejects(adminCommit({ company_state_id: company, record_type: 'estimate', id: 'forged-copy', lead_id: f.lead, job_id: f.job,
    expected_version: 0, operation: 'upsert', data: { ...estimate.data, id: 'forged-copy' } }), /square_payment_binding_is_server_owned/);
});

test('admin manual payments and job value changes remain allowed when derived totals stay exact', async () => {
  const f = await fixture(); await enqueue(f); await apply(await claim(), snapshot(f)); await as('admin');
  const job = await get('job', f.job), manualPayments = [...job.data.manualPayments, { id: 'cash-extra', amount: 100, date: '2026-09-16' }];
  const contractValue = 35000, paidAmount = job.data.squarePaidAmount + 1100.25;
  const data = { ...job.data, contractValue, value: contractValue, manualPayments, paidAmount,
    paymentPercent: paidAmount / contractValue * 100, lastPaymentAt: '2026-09-16' };
  const result = await adminCommit({ company_state_id: company, record_type: 'job', id: job.id, lead_id: f.lead, job_id: job.id,
    expected_version: job.version, operation: 'upsert', data });
  const saved = result.rows[0].result.rows[0].data;
  assert.equal(saved.paidAmount, 17100.25); assert.equal(saved.contractValue, 35000);
  assert.equal(saved.squarePaidAmount, 16000); assert.equal(saved.manualPayments.length, 2);
});

test('sync status reports aggregate queue health without exposing event/customer payloads', async () => {
  const f = await fixture(); await enqueue(f); const first = await claim(); await apply(first, snapshot(f));
  await enqueue(f); const second = await claim(); await fail(second, 'needs_review', false);
  await enqueue(f); await claim(); await enqueue({ ...f, invoice: 'inv:queue-pending' });
  const getStatus = () => db.query('select public.crm_square_sync_status($1,$2,$3) result', [company, environment, merchant]);
  const status = (await getStatus()).rows[0].result;
  assert.equal(status.pending, 2); assert.ok(status.review >= 1); assert.ok(status.lastProcessedAt); assert.ok(status.oldestPendingAt);
  assert.deepEqual(Object.keys(status).sort(), ['lastProcessedAt', 'oldestPendingAt', 'pending', 'review']);
  await as('admin'); await assert.rejects(getStatus(), error => error.code === '42501');
  await as('service'); const empty = (await db.query('select public.crm_square_sync_status($1,$2,$3) result', [company, environment, 'empty-merchant'])).rows[0].result;
  assert.deepEqual(empty, { pending: 0, review: 0, lastProcessedAt: null, oldestPendingAt: null });
});

test('simultaneously requested claims never hand the same invoice to two workers', async () => {
  const f = await fixture(); await enqueue(f); await enqueue(f);
  const results = await Promise.all([claim(), claim()]);
  assert.equal(results.filter(Boolean).length, 1);
});

for (const change of [{ paidAmount: -1 }, { paidAmount: 1.001 }, { version: 1.5 }, { contractAmount: -1 }, { currency: 'EUR' },
  { updatedAt: 'invalid' }, { status: 'unknown' }, { paymentRequests: [] }, { paymentRequests: [{ paidAmount: -1, requestedAmount: 1 }] }]) {
  test(`malformed snapshot never changes money: ${JSON.stringify(change)}`, async () => {
    const f = await fixture(); await enqueue(f); await assert.rejects(apply(await claim(), snapshot(f, change)), /payment_snapshot_invalid/);
  });
}

test('an audit failure rolls records, watermark, and inbox acknowledgement back atomically', async () => {
  const f = await fixture(); await enqueue(f); const c = await claim();
  await as('owner');
  await db.query("insert into public.crm_audit_events(id,company_state_id,lead_id) values('square-payment:'||md5(jsonb_build_array($1::text,$2::text,$3::text,$4::text)::text),$1,$5)",
    [company, environment, merchant, c.eventId, f.lead]);
  await as('service'); await assert.rejects(apply(c, snapshot(f)), error => error.code === '23505');
  await as('owner'); assert.equal((await get('estimate', f.estimates[0])).data.paidAmount, 0);
  assert.equal((await get('job', f.job)).version, 1); assert.equal((await eventRow(c.eventId)).status, 'processing');
  assert.equal((await db.query('select count(*)::integer n from public.crm_square_invoice_watermarks where invoice_id=$1', [f.invoice])).rows[0].n, 0);
});

test('migration reapplication preserves payment watermark and processed receipt', async () => {
  const f = await fixture(); await enqueue(f); const c = await claim(); await apply(c, snapshot(f));
  await as('owner'); const old = await eventRow(c.eventId), record = await get('job', f.job);
  await db.exec(fs.readFileSync(migration, 'utf8'));
  assert.deepEqual(await eventRow(c.eventId), old); assert.deepEqual(await get('job', f.job), record);
  await as('service'); assert.equal((await apply(c, snapshot(f))).applied, true);
});

test('claim SQL uses skip-locked rows plus an invoice-scoped advisory fence', () => {
  const source = fs.readFileSync(migration, 'utf8');
  assert.match(source, /for update skip locked/i); assert.match(source, /pg_try_advisory_xact_lock/);
  assert.match(source, /order by r\.record_type,r\.id for update/);
});
