// Local PostgreSQL only. These fixtures never send invoices or access a provider.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { create: createWorkflow } = require('../square-invoice-workflow.js');
const root = path.resolve(__dirname, '..');
const migrationPath = path.join(root, 'supabase/migrations/20260915_durable_square_invoice_sends.sql');
const db = new PGlite();
const company = 'coastal-crest';
const users = { admin: '00000000-0000-4000-8000-000000000011', sales: '00000000-0000-4000-8000-000000000012', outsider: '00000000-0000-4000-8000-000000000013' };
let sequence = 0;
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid,bucket_id text);
    grant usage on schema public,auth,storage to authenticated,anon,service_role;`);
  for (const [name, id] of Object.entries(users)) {
    await db.query('insert into auth.users values($1,$2,$3::jsonb)', [id, `${name}@${name === 'outsider' ? 'example.invalid' : 'coastalcrestroofing.com'}`, JSON.stringify({ role: name === 'sales' ? 'sales' : 'admin' })]);
  }
  await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  await db.exec('grant all on all tables in schema public to authenticated;');
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20260914_conflict_safe_record_writes.sql'), 'utf8'));
  await db.exec(fs.readFileSync(migrationPath, 'utf8'));
});
after(async () => db.close());
async function as(role = 'service') {
  await db.exec('reset role');
  const claims = role === 'service' ? { role: 'service_role' } : role === 'owner' || role === 'anon' ? {} : {
    sub: users[role], role: 'authenticated', email: `${role}@${role === 'outsider' ? 'example.invalid' : 'coastalcrestroofing.com'}`,
    app_metadata: { role: role === 'sales' ? 'sales' : 'admin' },
  };
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
  if (role !== 'owner') await db.exec(`set role ${role === 'service' ? 'service_role' : role === 'anon' ? 'anon' : 'authenticated'}`);
}
async function fixture(mutate = () => {}, { legacy = false } = {}) {
  await as('owner');
  const suffix = ++sequence, ids = { contact: `sq-lead-${suffix}`, job: `sq-job-${suffix}`, estimate: `sq-estimate-${suffix}` };
  const records = [
    { record_type: 'contact', id: ids.contact, lead_id: ids.contact, job_id: null, data: { id: ids.contact, name: 'Synthetic Customer', email: 'customer@example.invalid', leadNumber: `L-${suffix}`, address: 'Synthetic address' } },
    { record_type: 'job', id: ids.job, lead_id: ids.contact, job_id: ids.job, data: { id: ids.job, projectNumber: `P-${suffix}`, address: 'Synthetic address', contractValue: 150.75 } },
    { record_type: 'estimate', id: ids.estimate, lead_id: ids.contact, job_id: ids.job, data: { id: ids.estimate, contactId: ids.contact, jobId: ids.job,
      status: 'Won', estimateNumber: `E-${suffix}`, projectTitle: 'Roof', items: [{ title: 'Roof', description: 'Synthetic work', quantity: 1.5, rate: 100.50 }],
      taxRate: 0, deposit: 50.25, notes: 'Original note' } },
  ];
  mutate(records, ids);
  for (const record of records) {
    await db.query(`insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,data,owner_id,updated_by,created_at,deleted_at)
      values($1,$2,$3,$4,$5,$6::jsonb,$7,$7,clock_timestamp()-($8::integer*interval '1 day'),$9)`,
    [record.company_state_id || company, record.record_type, record.id, record.lead_id, record.job_id, JSON.stringify(record.data), users.admin, legacy ? 1 : 0, record.deleted_at || null]);
  }
  return { ...ids, records };
}
async function begin(f, { actor = users.admin, scope = company, version = 1, environment = 'sandbox' } = {}) {
  return (await db.query('select public.crm_square_begin_invoice($1,$2,$3,$4,$5) as result', [scope, actor, f.estimate, version, environment])).rows[0].result;
}
async function checkpoint(intent, stage, receipt, scope = company) {
  return (await db.query('select public.crm_square_checkpoint_invoice($1,$2,$3,$4::jsonb) as result', [scope, intent.id, stage, JSON.stringify(receipt)])).rows[0].result;
}
async function complete(intent, result = { squareInvoiceId: 'inv:fixture', squareOrderId: 'order-fixture' }) {
  return (await db.query('select public.crm_square_complete_invoice($1,$2,$3::jsonb) as result', [company, intent.id, JSON.stringify(result)])).rows[0].result;
}
const receipt = {
  customer: { id: 'customer-fixture', email_address: 'customer@example.invalid' },
  location: { id: 'location-fixture', status: 'ACTIVE', currency: 'USD' },
  order: { id: 'order-fixture', location_id: 'location-fixture', customer_id: 'customer-fixture', total_money: { amount: 15075, currency: 'USD' } },
  invoice: { id: 'inv:fixture', version: 0, location_id: 'location-fixture', order_id: 'order-fixture', delivery_method: 'EMAIL', primary_recipient: { customer_id: 'customer-fixture' }, status: 'DRAFT' },
};
receipt.published = { ...receipt.invoice, version: 1, status: 'UNPAID', public_url: 'https://example.invalid/pay', updated_at: '2026-09-15T00:00:00Z', invoice_number: 'S-1' };
async function checkpointAll(intent) { for (const [stage, value] of Object.entries(receipt)) intent = await checkpoint(intent, stage, value); return intent; }
async function getRecord(type, id) { return (await db.query('select * from public.crm_records where company_state_id=$1 and record_type=$2 and id=$3', [company, type, id])).rows[0]; }
async function edit(record, data, extra = {}) {
  const change = { company_state_id: company, record_type: record.record_type, id: record.id, lead_id: record.lead_id, job_id: record.job_id,
    expected_version: record.version, data, ...extra };
  return (await db.query('select public.crm_commit_records($1,$2::jsonb,$3::jsonb) as result', [`sq-edit-${++sequence}`, JSON.stringify([change]), '[]'])).rows[0].result;
}

test('invoice intents are server-only and require a real company admin actor', async () => {
  const f = await fixture();
  for (const role of ['anon', 'sales', 'admin']) {
    await as(role); await assert.rejects(begin(f), error => error.code === '42501');
    await assert.rejects(db.exec('select * from public.crm_square_invoice_intents'), error => error.code === '42501');
  }
  await as('service');
  for (const actor of [users.sales, users.outsider, '00000000-0000-4000-8000-000000000099']) {
    await assert.rejects(begin(f, { actor }), /company_admin_required/);
  }
  await assert.rejects(begin(f, { scope: 'other-company' }), /company_admin_required/);
  assert.equal((await begin(f)).status, 'pending');
  await assert.rejects(db.exec('select * from public.crm_square_invoice_intents'), error => error.code === '42501');
});

test('begin checks current saved version and Won status before persisting an intent', async () => {
  const current = await fixture(); await as('service');
  await assert.rejects(begin(current, { version: 2 }), /estimate_changed_before_invoice/);
  const other = await fixture(records => { records[2].data.status = 'Draft'; }); await as('service');
  await assert.rejects(begin(other), /won_estimate_required/);
  const bound = await fixture(records => { records[2].data.squareInvoiceId = 'inv:already'; }); await as('service');
  await assert.rejects(begin(bound), /invoice_already_linked/);
});

for (const [name, mutate] of [
  ['deleted lead', records => { records[0].deleted_at = '2026-09-15'; }],
  ['deleted job', records => { records[1].deleted_at = '2026-09-15'; }],
  ['deleted estimate', records => { records[2].deleted_at = '2026-09-15'; }],
  ['job under another lead', records => { records[1].lead_id = 'other-lead'; }],
  ['JSON/column mismatch', records => { records[2].data.jobId = 'other-job'; }],
  ['missing job', records => { records.splice(1, 1); }],
  ['other-company job', records => { records[1].company_state_id = 'other-company'; }],
]) test(`invalid saved relationships fail closed: ${name}`, async () => {
  const f = await fixture(mutate); await as('service'); await assert.rejects(begin(f), /invalid_invoice_relationship/);
});

for (const [name, mutate] of [
  ['bad email', records => { records[0].data.email = 'invalid'; }],
  ['missing lead number', records => { delete records[0].data.leadNumber; }],
  ['missing project number', records => { delete records[1].data.projectNumber; }],
  ['missing estimate number', records => { delete records[2].data.estimateNumber; }],
]) test(`saved email and numbers are required: ${name}`, async () => {
  const f = await fixture(mutate); await as('service'); await assert.rejects(begin(f), /saved_customer_email_and_numbers_required/);
});

test('begin freezes cents, fractional line items, due dates and stable identity for repeated requests', async () => {
  const f = await fixture(); await as('service'); const first = await begin(f);
  assert.equal(first.payload.total, 150.75); assert.equal(first.payload.deposit, 50.25);
  assert.equal(first.payload.lineItems[0].quantity, 1.5);
  assert.match(first.payload.dueDate, /^\d{4}-\d{2}-\d{2}$/); assert.match(first.payload.depositDueDate, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(first.payload.dueDate >= first.payload.depositDueDate);
  assert.deepEqual(await begin(f, { version: 999 }), first);
  const otherEnvironment = await begin(f, { environment: 'production' }); assert.notEqual(otherEnvironment.id, first.id);
});

test('legacy estimates require documented provider review before beginning, not blind resending', async () => {
  const f = await fixture(() => {}, { legacy: true }); await as('service');
  await assert.rejects(begin(f), /legacy_invoice_review_required/);
  await assert.rejects(db.query('select public.crm_square_clear_legacy_attempt($1,$2,$3,$4,$5)', [company, users.admin, 'sandbox', f.estimate, 'short']), /document_provider_review_before_clearing/);
  await db.query('select public.crm_square_clear_legacy_attempt($1,$2,$3,$4,$5)', [company, users.admin, 'sandbox', f.estimate, 'Synthetic provider review confirmed no prior invoice exists.']);
  assert.equal((await begin(f)).status, 'pending');
  await assert.rejects(begin(f, { environment: 'production' }), /legacy_invoice_review_required/);
});

for (const [name, mutate] of [
  ['sub-cent rate', records => { records[2].data.items[0].rate = 100.501; }],
  ['negative quantity', records => { records[2].data.items[0].quantity = -1; }],
  ['too precise quantity', records => { records[2].data.items[0].quantity = 1.000001; }],
  ['sub-cent deposit', records => { records[2].data.deposit = 10.001; }],
  ['deposit exceeds contract', records => { records[2].data.deposit = 150.76; }],
  ['tax exceeds bound', records => { records[2].data.taxRate = 101; }],
]) test(`invalid amounts are rejected before intent creation: ${name}`, async () => {
  const f = await fixture(mutate); await as('service'); await assert.rejects(begin(f), /invalid_invoice/);
});

test('checkpoint order, exact retry and changed-receipt conflicts are enforced', async () => {
  const f = await fixture(); await as('service'); let intent = await begin(f);
  await assert.rejects(checkpoint(intent, 'order', receipt.order), /out_of_sequence/);
  await assert.rejects(checkpoint(intent, 'customer', {}), /invalid_invoice_receipt/);
  await assert.rejects(checkpoint(intent, 'customer', receipt.customer, 'other-company'), /invoice_intent_not_found/);
  intent = await checkpoint(intent, 'customer', receipt.customer);
  assert.deepEqual(await checkpoint(intent, 'customer', receipt.customer), intent);
  await assert.rejects(checkpoint(intent, 'customer', { ...receipt.customer, id: 'other' }), /invoice_receipt_conflict/);
});

test('atomic completion attaches invoice once, records one audit event and retains unrelated edits', async () => {
  const f = await fixture(); await as('service'); let intent = await checkpointAll(await begin(f));
  await as('admin'); const original = await getRecord('estimate', f.estimate);
  await edit(original, { ...original.data, notes: 'Edited while sending' });
  await as('service'); const result = await complete(intent);
  assert.equal(result.status, 'complete'); assert.equal(result.result.durable, true);
  assert.equal(result.result.rows[0].data.notes, 'Edited while sending'); assert.equal(result.result.rows[0].version, 3);
  assert.equal(result.result.rows[0].data.squareInvoiceId, 'inv:fixture'); assert.equal(result.result.contractValue, 150.75);
  assert.deepEqual(await complete(intent), result);
  await as('owner');
  assert.equal((await db.query("select count(*)::int n from public.crm_audit_events where id=$1", [`square-invoice:${intent.id}`])).rows[0].n, 1);
  assert.equal((await getRecord('estimate', f.estimate)).version, 3);
});

test('complete requires matching published provider receipt and never partially edits the estimate', async () => {
  const f = await fixture(); await as('service'); let intent = await begin(f);
  await assert.rejects(complete(intent), /published_invoice_receipt_required/);
  intent = await checkpointAll(intent);
  await assert.rejects(complete(intent, { squareInvoiceId: 'wrong', squareOrderId: 'order-fixture' }), /published_invoice_receipt_required/);
  await as('owner'); assert.equal((await getRecord('estimate', f.estimate)).version, 1);
  assert.equal((await getRecord('estimate', f.estimate)).data.squareInvoiceId, undefined);
});

test('a mandatory audit failure rolls invoice attachment and intent completion back together', async () => {
  const f = await fixture(); await as('service'); const intent = await checkpointAll(await begin(f));
  await as('owner');
  await db.query('insert into public.crm_audit_events(id,company_state_id,lead_id,event_type) values($1,$2,$3,$4)',
    [`square-invoice:${intent.id}`, company, f.contact, 'synthetic-audit-collision']);
  await as('service'); await assert.rejects(complete(intent), error => error.code === '23505');
  await as('owner'); const saved = await getRecord('estimate', f.estimate);
  assert.equal(saved.version, 1); assert.equal(saved.data.squareInvoiceId, undefined);
  const stored = (await db.query('select status,receipts from public.crm_square_invoice_intents where id=$1', [intent.id])).rows[0];
  assert.equal(stored.status, 'pending'); assert.equal(stored.receipts.published.id, receipt.published.id);
});

test('checkpoint and complete cannot be invoked by signed-in admins or sales directly', async () => {
  const f = await fixture(); await as('service'); const intent = await begin(f);
  for (const role of ['anon', 'sales', 'admin']) {
    await as(role);
    await assert.rejects(checkpoint(intent, 'customer', receipt.customer), error => error.code === '42501');
    await assert.rejects(complete(intent), error => error.code === '42501');
  }
});

test('bound targets and invoice content cannot be deleted, moved or changed through normal record saves', async () => {
  const f = await fixture(); await as('service'); await begin(f); await as('admin');
  const estimate = await getRecord('estimate', f.estimate);
  await assert.rejects(edit(estimate, { ...estimate.data, items: [{ title: 'Changed', quantity: 1, rate: 20 }] }), /invoice_content_is_locked/);
  await assert.rejects(edit(estimate, estimate.data, { lead_id: 'other-lead' }), /invoice_history_target_is_locked/);
  await assert.rejects(edit(estimate, { ...estimate.data, squareInvoiceId: 'forged' }), /invoice_binding_is_server_owned/);
  for (const [type, id] of [['contact', f.contact], ['job', f.job], ['estimate', f.estimate]]) {
    const record = await getRecord(type, id); await assert.rejects(edit(record, record.data, { operation: 'delete' }), /invoice_history_target_is_locked/);
  }
});

test('normal notes, checklists and costs remain editable for sales after invoice intent begins', async () => {
  const f = await fixture(); await as('service'); await begin(f); await as('sales');
  const estimate = await getRecord('estimate', f.estimate); const result = await edit(estimate, { ...estimate.data, notes: 'Sales note' });
  assert.equal(result.rows[0].data.notes, 'Sales note');
  const job = await getRecord('job', f.job);
  const changed = await edit(job, { ...job.data, workflowChecklists: { inspected: true }, costItems: [{ id: 'cost-1', amount: 50.38 }] });
  assert.equal(changed.rows[0].data.costItems[0].amount, 50.38); assert.equal(changed.rows[0].data.workflowChecklists.inspected, true);
});

test('ordinary unbound records remain deletable through the normal versioned path', async () => {
  const f = await fixture(); await as('admin'); const record = await getRecord('estimate', f.estimate);
  const result = await edit(record, record.data, { operation: 'delete' }); assert.ok(result.rows[0].deleted_at);
});

test('unbound physical deletion is not accidentally canceled by the target trigger', async () => {
  const f = await fixture(); await as('owner');
  const removed = await db.query("delete from public.crm_records where record_type='estimate' and id=$1 returning id", [f.estimate]);
  assert.equal(removed.rows[0].id, f.estimate); assert.equal(await getRecord('estimate', f.estimate), undefined);
});

test('migration reapplication preserves policy cutoff, review, receipt and completed record data', async () => {
  const f = await fixture(); await as('service'); const intent = await checkpointAll(await begin(f)); const completed = await complete(intent);
  await as('owner'); const beforePolicy = (await db.query('select * from public.crm_square_invoice_policy order by environment')).rows;
  const beforeReviews = (await db.query('select * from public.crm_square_invoice_reviews order by estimate_id,environment')).rows;
  const beforeRecord = await getRecord('estimate', f.estimate);
  await db.exec(fs.readFileSync(migrationPath, 'utf8'));
  assert.deepEqual((await db.query('select * from public.crm_square_invoice_policy order by environment')).rows, beforePolicy);
  assert.deepEqual((await db.query('select * from public.crm_square_invoice_reviews order by estimate_id,environment')).rows, beforeReviews);
  assert.deepEqual(await getRecord('estimate', f.estimate), beforeRecord);
  await as('service'); assert.deepEqual(await begin(f), completed);
});

test('real coordinator and SQL adapters agree on receipts and authoritative completion metadata', async () => {
  const f = await fixture(); await as('service'); const paths = [];
  const workflow = createWorkflow({
    store: { begin: (_id, version) => begin(f, { version }), checkpoint: (intent, stage, value) => checkpoint(intent, stage, value), complete },
    request: async (_method, path) => {
      paths.push(path);
      const responses = { '/customers/search': { customers: [receipt.customer] }, '/locations': { locations: [receipt.location] },
        '/orders': { order: receipt.order }, '/invoices': { invoice: receipt.invoice }, '/invoices/inv%3Afixture/publish': { invoice: receipt.published } };
      assert.ok(Object.hasOwn(responses, path)); return { status: 200, body: structuredClone(responses[path]) };
    },
  });
  const result = await workflow.send(f.estimate, 1); assert.equal(result.durable, true); assert.equal(result.rows[0].id, f.estimate);
  const count = paths.length; assert.deepEqual(await workflow.send(f.estimate, 1), result); assert.equal(paths.length, count);
});

for (const [name, mutate] of [
  ['missing title', records => { delete records[2].data.items[0].title; }],
  ['non-text description', records => { records[2].data.items[0].description = {}; }],
  ['blank lead number', records => { records[0].data.leadNumber = ' '; }],
]) test(`payload invalid for coordinator is rejected before it can permanently lock an intent: ${name}`, async () => {
  const f = await fixture(mutate); await as('service'); await assert.rejects(begin(f));
});
