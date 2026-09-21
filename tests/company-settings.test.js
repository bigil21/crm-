const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { create } = require('../company-settings-writes.js');
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260914_versioned_company_settings.sql'), 'utf8');
const db = new PGlite();
const ids = { admin: '00000000-0000-4000-8000-000000000001', sales: '00000000-0000-4000-8000-000000000002', second: '00000000-0000-4000-8000-000000000003', outsider: '00000000-0000-4000-8000-000000000004' };
let sequence = 0;
before(async () => {
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
    insert into auth.users values ${Object.values(ids).map(id => `('${id}')`).join(',')};
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  await db.exec('grant all on all tables in schema public to authenticated;');
  await db.exec(`insert into public.crm_state(id,data,owner_id) values('coastal-crest:company',
    '{"company":{"name":"Original"},"companyDocuments":[{"id":"retained-legacy-metadata"}]}','${ids.admin}')`);
  for (const name of ['20260914_conflict_safe_record_writes.sql', '20260914_company_settings_permissions.sql']) {
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8'));
  }
  await db.exec(migration);
});
after(() => db.close());
async function as(role = 'admin') {
  await db.exec('reset role');
  const claims = role === 'anon' ? {} : { sub: ids[role], email: `${role}@${role === 'outsider' ? 'example.com' : 'coastalcrestroofing.com'}`, app_metadata: { role: role === 'sales' ? 'sales' : 'admin' } };
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
  await db.exec(`set role ${role === 'anon' ? 'anon' : 'authenticated'}`);
}
const settings = async () => (await db.query("select * from public.crm_state where id='coastal-crest:company'")).rows[0];
const payload = name => ({ company: { name, categories: [{ id: 'custom', name: 'Insurance' }] } });
async function commit(version, data, request = `settings-${++sequence}`) {
  return (await db.query('select public.crm_commit_company_settings($1,$2,$3::jsonb) as result', [request, version, JSON.stringify(data)])).rows[0].result;
}
const rejectsCode = (fn, code) => assert.rejects(fn, error => error.code === code);

test('settings migration preserves existing data and initializes a version without reapplying business rows', async () => {
  await as();
  const original = await settings();
  assert.equal(original.version, 1);
  assert.equal(original.data.companyDocuments[0].id, 'retained-legacy-metadata');
  await db.exec('reset role');
  await db.exec(migration);
  assert.deepEqual(await settings(), original);
});

test('admin saves compare versions, retain legacy metadata, and record the previous value', async () => {
  await as();
  const old = await settings();
  const response = await commit(old.version, payload('First change'), 'audited-settings');
  assert.equal(response.rows[0].version, old.version + 1);
  assert.deepEqual(response.rows[0].data, payload('First change'));
  assert.equal((await settings()).data.companyDocuments[0].id, 'retained-legacy-metadata');
  assert.equal((await settings()).owner_id, null);
  await rejectsCode(() => db.query('select * from public.crm_company_settings_receipts'), '42501');
  await db.exec('reset role');
  const receipt = (await db.query("select * from public.crm_company_settings_receipts where request_id='audited-settings'")).rows[0];
  assert.deepEqual(receipt.previous_data, old.data);
  assert.equal(receipt.actor_user_id, ids.admin);
});

test('an outdated second admin cannot overwrite company settings', async () => {
  await as();
  const stale = await settings();
  await commit(stale.version, payload('Newer admin edit'));
  await as('second');
  await rejectsCode(() => commit(stale.version, payload('Stale edit')), '40001');
  assert.equal((await settings()).data.company.name, 'Newer admin edit');
});

test('identical retries return the original settings receipt; changed payload reuse fails', async () => {
  await as();
  const old = await settings();
  const first = await commit(old.version, payload('Idempotent'), 'retry-settings');
  assert.deepEqual(await commit(old.version, payload('Idempotent'), 'retry-settings'), first);
  assert.equal((await settings()).version, old.version + 1);
  await rejectsCode(() => commit(old.version, payload('Changed retry'), 'retry-settings'), '22023');
});

test('sales and outside-company admins cannot save settings, while sales still read them', async () => {
  for (const role of ['sales', 'outsider', 'anon']) {
    await as(role);
    await rejectsCode(() => commit(1, payload('Not allowed')), '42501');
    if (role === 'anon') await rejectsCode(settings, '42501');
    else assert.equal(Boolean(await settings()), role === 'sales');
  }
});

test('even admins cannot bypass company version checks with direct update or upsert', async () => {
  await as();
  assert.equal((await db.query("update public.crm_state set data='{}' where id='coastal-crest:company' returning id")).rows.length, 0);
  await rejectsCode(() => db.exec("insert into public.crm_state(id,data) values('coastal-crest:company','{}') on conflict(id) do update set data=excluded.data"), '42501');
  await rejectsCode(() => db.exec("delete from public.crm_state"), '42501');
});

test('company RPC rejects business snapshots and invalid data without any mutation', async () => {
  await as();
  const original = await settings();
  for (const data of [null, [], {}, { company: [] }, { company: {}, contacts: [] }]) {
    await rejectsCode(() => commit(original.version, data), '22023');
  }
  await rejectsCode(() => commit(-1, payload('Negative')), '22023');
  assert.deepEqual(await settings(), original);
});

test('missing settings are created at version one, and stale creation conflicts', async () => {
  await db.exec('reset role; begin');
  try {
    await db.exec("delete from public.crm_state where id='coastal-crest:company'");
    await as();
    assert.equal((await commit(0, payload('New'))).rows[0].version, 1);
    await rejectsCode(() => commit(0, payload('Stale creation')), '40001');
  } finally { await db.exec('rollback; reset role'); }
});

test('settings browser writer preserves rapid edits and refuses a stale second editor', async () => {
  await as();
  const baseline = await settings();
  const rpc = async (name, p) => {
    assert.equal(name, 'crm_commit_company_settings');
    try { return { data: await commit(p.p_expected_version, p.p_data, p.p_request_id), error: null }; }
    catch (error) { return { error }; }
  };
  const options = { companyId: 'coastal-crest', rpc, requestId: () => `browser-settings-${++sequence}` };
  let blocked;
  const first = create(options), second = create({ ...options, onBlocked: value => { blocked = value; } });
  first.remember(baseline); second.remember(baseline);
  const initial = payload('First typed');
  const a = first.commit(initial);
  initial.company.name = 'Mutation after capture';
  const b = first.commit(payload('Second typed'));
  assert.equal((await a).data.rows[0].data.company.name, 'First typed');
  assert.equal((await b).error, null);
  await as('second');
  assert.equal((await second.commit(payload('Stale edit'))).error.code, '40001');
  assert.equal(blocked.payload.rpc, 'crm_commit_company_settings');
  assert.equal(blocked.payload.p_changes[0].data.company.name, 'Stale edit');
  assert.equal((await settings()).data.company.name, 'Second typed');
});

test('settings writer times out safely without resubmission or accepting late confirmation', async () => {
  let calls = 0, resolve;
  const writer = create({ companyId: 'coastal-crest', requestId: () => 'timeout-settings', timeoutMs: 5,
    rpc: () => { calls++; return new Promise(done => { resolve = done; }); } });
  const data = payload('Pending');
  const first = writer.commit(data);
  data.company.name = 'Later typing';
  assert.match((await first).error.message, /timed out/);
  assert.equal(writer.blocked.payload.p_changes[0].data.company.name, 'Pending');
  resolve({ data: { rows: [] }, error: null });
  assert.ok((await writer.commit(payload('Another edit'))).error);
  assert.equal(calls, 1);
});

test('aggregate production preflight is read-only and reports installed settings protection', async () => {
  await db.exec('reset role');
  const original = await settings();
  const result = await db.exec(fs.readFileSync(path.join(root, 'supabase/production-release-preflight.sql'), 'utf8'));
  const report = result.find(value => value.rows?.[0]?.release_preflight).rows[0].release_preflight;
  assert.equal(report.settings_commit_installed, true);
  assert.equal(report.record_commit_installed, true);
  assert.equal(report.direct_record_update, false);
  assert.deepEqual(await settings(), original);
});

test('settings writer refuses a baseline without the migration version', () => {
  const writer = create({ companyId: 'coastal-crest', requestId: () => 'unused', rpc: () => {} });
  assert.throws(() => writer.remember({ id: 'coastal-crest:company' }), /versioned database/);
  assert.throws(() => writer.remember({ id: 'other-company:company', version: 1 }), /versioned database/);
});
