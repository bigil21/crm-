const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// PostgREST retries any transaction that fails with SQLSTATE 40001, with no
// limit. A version conflict raised with that code therefore never reaches the
// browser: it loops inside the API layer and holds a pool connection for good.
// On 2026-11-22 that exhausted the pool and locked everyone out. Conflicts
// must be raised with PT409 (HTTP 409, never retried).
const root = path.resolve(__dirname, '..');
const migrations = path.join(root, 'supabase/migrations');
const read = name => fs.readFileSync(path.join(migrations, name), 'utf8');
const RETRIED_CONFLICT = /errcode\s*=\s*'40001'/i;
const FIX = '20261122061845_conflict_errors_use_pt409_not_40001.sql';
const REMAINING_FIX = '20261122064020_replace_remaining_retryable_conflict_codes.sql';
const fix = read(FIX);
const remainingFix = read(REMAINING_FIX);

test('no migration raises a save conflict with the code PostgREST retries forever', () => {
  // Repair migrations have to name the old code in order to replace it.
  const repairMigrations = new Set([FIX, REMAINING_FIX]);
  const offenders = fs.readdirSync(migrations).filter(name => name.endsWith('.sql') && !repairMigrations.has(name) && RETRIED_CONFLICT.test(read(name)));
  assert.deepEqual(offenders, []);
});

test('the browser leaves database retry and conflict merging to JobCrest', () => {
  const auth = fs.readFileSync(path.join(root, 'auth.js'), 'utf8');
  assert.match(auth, /createClient\([^]*?db:\s*\{\s*retry:\s*false/);
});

// Rebuild the definitions production ran before the fix, so the migration is
// exercised against what it was written for.
const beforeFix = sql => sql
  .replaceAll(", detail = 'record_conflict: company settings changed since they were loaded'", '')
  .replace(/(_conflict' using errcode\s*=\s*)'PT409'/g, "$1'40001'");
const db = new PGlite();
const admin = '00000000-0000-4000-8000-000000000001';
let sequence = 0;
before(async () => {
  // In-memory PostgreSQL only. Auth claims are fixtures, never real credentials.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}'::jsonb);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
    create table storage.objects(id uuid, bucket_id text, name text, owner_id text);
    create function storage.foldername(text) returns text[] language sql immutable as
      $$ select string_to_array(trim(both '/' from $1), '/') $$;
    grant usage on schema public, auth, storage to authenticated, anon, service_role;
    insert into auth.users(id,email,raw_app_meta_data) values ('${admin}','admin@coastalcrestroofing.com','{"role":"admin"}');
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  await db.exec('grant all on all tables in schema public to authenticated;');
  await db.exec(`insert into public.crm_state(id,data,owner_id) values('coastal-crest:company','{"company":{"name":"Original"}}','${admin}')`);
  const records = beforeFix(read('20260914_conflict_safe_record_writes.sql'));
  const settings = beforeFix(read('20260914_versioned_company_settings.sql'));
  const compactSettings = beforeFix(read('20261121224042_compact_company_settings_receipts.sql'));
  for (const sql of [records, settings, compactSettings]) assert.match(sql, RETRIED_CONFLICT);
  await db.exec(records);
  await db.exec(read('20260914_company_settings_permissions.sql'));
  await db.exec(settings);
  await db.exec(compactSettings);
});
after(() => db.close());

async function asAdmin() {
  await db.exec('reset role');
  const claims = { sub: admin, email: 'admin@coastalcrestroofing.com', app_metadata: { role: 'admin' } };
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
  await db.exec('set role authenticated');
}
const row = (id, expected_version = 0, data = {}) => ({ company_state_id: 'coastal-crest', record_type: 'job', id, lead_id: 'fixture-lead', expected_version, data });
const commitRecords = (changes, events = []) => db.query('select public.crm_commit_records($1,$2::jsonb,$3::jsonb) as result',
  [`conflict-codes-${++sequence}`, JSON.stringify(changes), JSON.stringify(events)]);
const commitSettings = (version, name) => db.query('select public.crm_commit_company_settings($1,$2,$3::jsonb) as result',
  [`conflict-codes-${++sequence}`, version, JSON.stringify({ company: { name } })]);
const settingsVersion = async () => (await db.query("select version from public.crm_state where id='coastal-crest:company'")).rows[0].version;
const rejects = (fn, code, detail) => assert.rejects(fn, error => error.code === code && (!detail || detail.test(error.detail || '')));

test('before the fix, stale saves raised the code PostgREST retries', async () => {
  await asAdmin();
  await commitRecords([row('stale')]);
  await rejects(() => commitRecords([row('stale', 0)]), '40001');
  await rejects(async () => commitSettings((await settingsVersion()) + 5, 'Stale'), '40001');
});

test('the migration moves record, audit and settings conflicts to PT409', async () => {
  await db.exec('reset role');
  await db.exec(fix);
  await asAdmin();
  await rejects(() => commitRecords([row('stale', 0)]), 'PT409');
  const event = { id: 'conflict-codes-event', company_state_id: 'coastal-crest', lead_id: 'fixture-lead', message: 'Original' };
  await commitRecords([], [event]);
  await rejects(() => commitRecords([], [{ ...event, message: 'Replaced' }]), 'PT409');
  // The detail lets clients released before PT409 was recognised still merge.
  await rejects(async () => commitSettings((await settingsVersion()) + 5, 'Stale'), 'PT409', /record_conflict/);
});

test('the migration can be re-run and valid saves still work afterwards', async () => {
  await db.exec('reset role');
  await db.exec(fix);
  await asAdmin();
  await rejects(() => commitRecords([row('stale', 0)]), 'PT409');
  assert.equal((await commitRecords([row('stale', 1, { status: 'Contacted' })])).rows[0].result.rows[0].version, 2);
  const version = await settingsVersion();
  assert.equal((await commitSettings(version, 'Saved after fix')).rows[0].result.rows[0].version, version + 1);
});

test('the remaining-conflict migration covers every Square and website RPC and is replay-safe', async () => {
  await db.exec('reset role');
  const signatures = [
    ['crm_square_begin_invoice', 'p_company text,p_actor uuid,p_estimate_id text,p_expected_version integer,p_environment text'],
    ['crm_square_checkpoint_invoice', 'p_company text,p_intent uuid,p_stage text,p_receipt jsonb'],
    ['crm_square_complete_invoice', 'p_company text,p_intent uuid,p_result jsonb'],
    ['crm_square_fail_webhook', 'p_company text,p_environment text,p_merchant text,p_event_id text,p_lease_id uuid,p_code text,p_retryable boolean'],
    ['crm_square_apply_payment', 'p_company text,p_environment text,p_merchant text,p_event_id text,p_lease_id uuid,p_snapshot jsonb'],
    ['crm_square_enqueue_webhook', 'p_company text,p_environment text,p_event jsonb'],
    ['crm_ingest_website_request', 'p_company text,p_request_id text,p_payload_hash text,p_lead_id text,p_job_id text,p_owner_id uuid,p_request jsonb'],
  ];
  for (const [name, args] of signatures) {
    await db.exec(`create or replace function public.${name}(${args}) returns jsonb language plpgsql as $$ begin raise exception 'synthetic_conflict' using errcode='40001'; end $$`);
  }
  await db.exec(remainingFix);
  await db.exec(remainingFix);
  const rows = (await db.query(`select proname,pg_get_functiondef(oid) def from pg_proc where pronamespace='public'::regnamespace and proname = any($1::text[]) order by proname`, [signatures.map(([name]) => name)])).rows;
  assert.equal(rows.length, signatures.length);
  for (const row of rows) {
    assert.doesNotMatch(row.def, RETRIED_CONFLICT, row.proname);
    assert.match(row.def, /errcode='PT409'/i, row.proname);
  }
});
