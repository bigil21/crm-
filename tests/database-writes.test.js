const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { create: createWriter } = require('../record-writes.js');
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260914_conflict_safe_record_writes.sql'), 'utf8');
const db = new PGlite();
const ids = { admin: '00000000-0000-4000-8000-000000000001', sales: '00000000-0000-4000-8000-000000000002', outsider: '00000000-0000-4000-8000-000000000003' };
let request = 0;
before(async () => {
  // In-memory PostgreSQL only. Auth claims are fixtures, never real credentials.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
    create table storage.objects(id uuid, bucket_id text);
    grant usage on schema public, auth, storage to authenticated, anon;
    insert into auth.users values ('${ids.admin}'), ('${ids.sales}'), ('${ids.outsider}');
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  await db.exec('grant all on all tables in schema public to authenticated;');
  await db.exec(migration);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20260914_company_settings_permissions.sql'), 'utf8'));
});
after(async () => db.close());
async function as(role = 'sales') {
  await db.exec('reset role');
  const claims = role === 'anon' ? {} : { sub: ids[role], email: `${role}@${role === 'outsider' ? 'example.com' : 'coastalcrestroofing.com'}`, app_metadata: { role: role === 'admin' ? 'admin' : 'sales_rep' } };
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(claims)]);
  await db.exec(`set role ${role === 'anon' ? 'anon' : 'authenticated'}`);
}
const row = (id, expected_version = 0, data = {}, extra = {}) => ({ company_state_id: 'coastal-crest', record_type: 'job', id, lead_id: 'fixture-lead', expected_version, data, ...extra });
async function commit(changes, events = [], requestId = `test-${++request}`) {
  const response = await db.query('select public.crm_commit_records($1,$2::jsonb,$3::jsonb) as result', [requestId, JSON.stringify(changes), JSON.stringify(events)]);
  return response.rows[0].result;
}
async function get(id) { return (await db.query('select * from public.crm_records where id=$1', [id])).rows[0]; }
const rejectsCode = (fn, code) => assert.rejects(fn, error => error.code === code);

test('only admins may create company settings; everyone in the company may read them', async () => {
  const sql = "insert into public.crm_state(id,data,updated_by) values('coastal-crest:company', '{\"company\":{\"name\":\"Original\"}}',auth.uid())";
  await as();
  await rejectsCode(() => db.exec(sql), '42501');
  await as('admin');
  await db.exec(sql);
  await as();
  assert.equal((await db.query("select data from public.crm_state where id='coastal-crest:company'")).rows[0].data.company.name, 'Original');
});

test('sales cannot alter settings through direct update or an upsert', async () => {
  await as();
  const updated = await db.query("update public.crm_state set data='{}',updated_by=auth.uid() where id='coastal-crest:company' returning id");
  assert.equal(updated.rows.length, 0);
  await rejectsCode(() => db.exec("insert into public.crm_state(id,data,updated_by) values('coastal-crest:company','{}',auth.uid()) on conflict(id) do update set data=excluded.data,updated_by=auth.uid()"), '42501');
  assert.equal((await db.query("select data from public.crm_state where id='coastal-crest:company'")).rows[0].data.company.name, 'Original');
});

test('company settings remain admin-only even for broad manager roles', async () => {
  await as();
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: ids.sales, email: 'manager@coastalcrestroofing.com', app_metadata: { role: 'sales_manager' } })]);
  assert.equal((await db.query("select public.can_manage_team_crm() as allowed")).rows[0].allowed, true);
  assert.equal((await db.query("update public.crm_state set data='{}',updated_by=auth.uid() where id='coastal-crest:company' returning id")).rows.length, 0);
  await rejectsCode(() => db.exec("truncate public.crm_state"), '42501');
  await as('admin');
  await db.exec("update public.crm_state set data='{\"company\":{\"name\":\"Admin change\"}}',updated_by=auth.uid() where id='coastal-crest:company'");
  assert.equal((await db.query("select data from public.crm_state where id='coastal-crest:company'")).rows[0].data.company.name, 'Admin change');
});

test('sales still save their own legacy private state without changing company settings', async () => {
  await as();
  await db.exec("insert into public.crm_state(id,data,owner_id,updated_by) values('coastal-crest:user:' || auth.uid()::text,'{}',auth.uid(),auth.uid())");
  assert.equal((await db.query("update public.crm_state set data='{\"view\":\"jobs\"}',updated_by=auth.uid() where owner_id=auth.uid() returning id")).rows.length, 1);
  await as('outsider');
  assert.equal((await db.query("select * from public.crm_state")).rows.length, 0);
});

test('sales reps can save checklists, costs, and decimal contract values', async () => {
  await as();
  const result = await commit([row('ordinary', 0, { status: 'Inspection', contractValue: 35250.75, costItems: [{ id: 'cost', amount: 50.38 }], workflowChecklists: { inspected: true } })]);
  assert.equal(result.rows[0].version, 1);
  assert.equal(result.rows[0].owner_id, ids.sales);
  assert.equal((await get('ordinary')).data.contractValue, 35250.75);
});
test('stale saves are rejected without erasing the newer record', async () => {
  await as();
  await commit([row('stale')]);
  await commit([row('stale', 1, { status: 'Estimate sent' })]);
  await rejectsCode(() => commit([row('stale', 1, { status: 'New' })]), '40001');
  assert.equal((await get('stale')).data.status, 'Estimate sent');
  assert.equal((await get('stale')).version, 2);
});
test('admin payments persist and sales reps cannot add or remove them', async () => {
  await as('admin');
  const data = { paidAmount: 100.25, manualPayments: [{ id: 'check-1', amount: 100.25, date: '2026-09-14' }] };
  await commit([row('payment', 0, data)]);
  await as();
  await rejectsCode(() => commit([row('payment', 1, {})]), '42501');
  await rejectsCode(() => commit([row('sales-payment', 0, data)]), '42501');
  // Normal editing of a paid job remains available to sales.
  await commit([row('payment', 1, { ...data, status: 'In progress', contractValue: 300, paymentPercent: 100.25 / 3 })]);
  assert.equal((await get('payment')).data.paidAmount, 100.25);
});
test('non-admin direct writes cannot bypass the payment check', async () => {
  await as();
  for (const sql of ["update public.crm_records set data='{}'", 'delete from public.crm_records', "insert into public.crm_records(company_state_id,record_type,id) values('coastal-crest','job','bypass')", 'truncate public.crm_records']) {
    await rejectsCode(() => db.exec(sql), '42501');
  }
});

test('sales cannot fabricate a paid percentage without changing the paid amount', async () => {
  await as();
  await rejectsCode(() => commit([row('fake-percent', 0, { contractValue: 32000, paidAmount: 0, paymentPercent: 50 })]), '23514');
});

test('legacy manual and paid-date records remain editable by sales without backfilling payments', async () => {
  await as('admin');
  await commit([row('legacy-manual', 0, { manualPayments: [{ id: 'legacy-check', amount: 50, date: '2026-09-14' }], contractValue: 100 })]);
  await commit([row('legacy-paid-date', 0, { paidAt: '2026-09-14', contractValue: 100 }, { record_type: 'estimate' })]);
  await as();
  const manual = await get('legacy-manual');
  await commit([row('legacy-manual', 1, { ...manual.data, paymentPercent: 50, status: 'Scheduled' })]);
  const dated = await get('legacy-paid-date');
  await commit([row('legacy-paid-date', 1, { ...dated.data, paymentPercent: 100, title: 'Updated title' }, { record_type: 'estimate' })]);
  assert.equal((await get('legacy-manual')).data.paidAmount, undefined);
  assert.equal((await get('legacy-paid-date')).data.paidAmount, undefined);
});
test('a conflict rolls back every record and audit event in the batch', async () => {
  await as();
  await commit([row('batch-b')]);
  await rejectsCode(() => commit([row('batch-a'), row('batch-b', 0)], [{ id: 'batch-event', company_state_id: 'coastal-crest', lead_id: 'fixture-lead' }]), '40001');
  assert.equal(await get('batch-a'), undefined);
  assert.equal((await db.query("select id from public.crm_audit_events where id='batch-event' or metadata->>'record_id'='batch-a'")).rows.length, 0);
});
test('identical retries return the original receipt without double-saving', async () => {
  await as();
  const changes = [row('retry')];
  const first = await commit(changes, [], 'stable-retry');
  assert.deepEqual(await commit(changes, [], 'stable-retry'), first);
  assert.equal((await get('retry')).version, 1);
  await rejectsCode(() => commit([row('different')], [], 'stable-retry'), '22023');
});
test('archived records cannot be silently recreated by a stale client', async () => {
  await as();
  await commit([row('archived')]);
  await commit([row('archived', 1, {}, { operation: 'delete' })]);
  assert.ok((await get('archived')).deleted_at);
  await rejectsCode(() => commit([row('archived', 0)]), '40001');
  await rejectsCode(() => commit([row('archived', 2)]), '40001');
});
test('financial history cannot be deleted even by an admin', async () => {
  await as('admin');
  await rejectsCode(() => commit([row('payment', 2, {}, { operation: 'delete' })]), '23514');
  assert.equal((await get('payment')).deleted_at, null);
});
test('payment validation rejects negative, sub-cent, duplicate, and impossible-date entries', async () => {
  await as('admin');
  for (const payments of [
    [{ id: 'a', amount: -1, date: '2026-09-14' }],
    [{ id: 'a', amount: 1.001, date: '2026-09-14' }],
    [{ id: 'a', amount: 1, date: '2026-02-30' }],
    [{ id: 'a', amount: 1, date: '2026-09-14' }, { id: 'a', amount: 2, date: '2026-09-14' }],
  ]) await assert.rejects(() => commit([row('invalid-payment', 0, { manualPayments: payments })]));
  assert.equal(await get('invalid-payment'), undefined);
});
test('company scoping, anonymous access, and ownership spoofing are enforced', async () => {
  await as('outsider');
  await rejectsCode(() => commit([row('outside')]), '42501');
  await as('anon');
  await rejectsCode(() => commit([row('anonymous')]), '42501');
  await as();
  await rejectsCode(() => commit([row('wrong-company', 0, {}, { company_state_id: 'other' })]), '22023');
  const saved = await commit([row('spoof-owner', 0, {}, { owner_id: ids.admin, updated_by: ids.admin })]);
  assert.equal(saved.rows[0].owner_id, ids.sales);
  assert.equal(saved.rows[0].updated_by, ids.sales);
});
test('migration reapplication preserves existing business rows', async () => {
  await db.exec('reset role');
  const previous = (await db.query('select * from public.crm_records order by id')).rows;
  await db.exec(migration);
  assert.deepEqual((await db.query('select * from public.crm_records order by id')).rows, previous);
});

test('browser writer against PostgreSQL: rapid saves, stale second client, and payment protection', async () => {
  await as('admin');
  await commit([row('browser-integration')]);
  const baseline = await get('browser-integration');
  const rpc = async (_name, p) => {
    try { return { data: await commit(p.p_changes, p.p_events, p.p_request_id), error: null }; }
    catch (error) { return { error }; }
  };
  const first = createWriter({ rpc, requestId: () => `browser-${++request}` });
  const stale = createWriter({ rpc, requestId: () => `browser-${++request}` });
  first.remember([baseline]); stale.remember([baseline]);
  const payment = { id: 'bank-transfer', amount: 3525.75, date: '2026-09-14' };
  const a = first.commit([{ ...baseline, data: { manualPayments: [payment], paidAmount: 3525.75 } }]);
  const b = first.commit([{ ...baseline, data: { manualPayments: [payment], paidAmount: 3525.75, status: 'In progress' } }]);
  assert.equal((await a).error, null);
  assert.equal((await b).error, null);
  await as();
  assert.equal((await stale.commit([{ ...baseline, data: { status: 'Inspection' } }])).error.code, '40001');
  const saved = await get('browser-integration');
  assert.equal(saved.version, 3);
  assert.equal(saved.data.manualPayments[0].amount, 3525.75);
  assert.equal(saved.data.status, 'In progress');
  const rep = createWriter({ rpc, requestId: () => `browser-${++request}` });
  rep.remember([saved]);
  assert.equal((await rep.commit([{ ...saved, data: { ...saved.data, paidAmount: 0 } }])).error.code, '42501');
});

test('an audit ID collision cannot silently attach the wrong history', async () => {
  await as();
  const event = { id: 'collision-test', company_state_id: 'coastal-crest', lead_id: 'fixture-lead', message: 'Original' };
  await commit([], [event]);
  await rejectsCode(() => commit([row('event-collision')], [{ ...event, message: 'Replaced' }]), '40001');
  assert.equal(await get('event-collision'), undefined);
});

test('read-only rollout preflight runs without changing records', async () => {
  await db.exec('reset role');
  const before = (await db.query('select * from public.crm_records order by id')).rows;
  const reports = await db.exec(fs.readFileSync(path.join(root, 'supabase/record-write-preflight.sql'), 'utf8'));
  const permissions = reports.find(result => result.rows?.[0]?.safe_commit_installed !== undefined).rows[0];
  assert.equal(permissions.safe_commit_installed, true);
  assert.equal(permissions.direct_update_allowed, false);
  assert.deepEqual((await db.query('select * from public.crm_records order by id')).rows, before);
});
