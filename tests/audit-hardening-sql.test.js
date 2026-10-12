const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const migrations = [
  '20260914_conflict_safe_record_writes.sql',
  '20260914_company_settings_permissions.sql',
  '20260914_versioned_company_settings.sql',
  '20260915_durable_square_invoice_sends.sql',
  '20260915_square_webhook_inbox.sql',
  '20260915_square_payment_reconciliation.sql',
  '20260916_atomic_sales_numbers.sql',
  '20261012030945_audit_security_performance_hardening.sql',
];
const db = new PGlite();
const adminId = '00000000-0000-4000-8000-000000000001';

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create role supabase_auth_admin;
    create schema auth;
    create schema storage;
    create table auth.users(
      id uuid primary key,
      email text,
      raw_app_meta_data jsonb default '{}'::jsonb
    );
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
    create table storage.objects(id uuid, bucket_id text);
    grant usage on schema public, auth, storage to anon, authenticated, service_role, supabase_auth_admin;
    insert into auth.users(id,email,raw_app_meta_data)
      values ('${adminId}','admin@coastalcrestroofing.com','{"role":"admin"}');
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  // Production has this Auth trigger helper from the original hosted setup;
  // schema.sql intentionally does not recreate auth.users triggers in tests.
  await db.exec(`
    create or replace function public.apply_crm_admin_metadata()
    returns trigger language plpgsql security definer set search_path=public as $$
    begin return new; end;
    $$;
  `);
  await db.exec('grant all on all tables in schema public to authenticated, service_role;');
  for (const name of migrations) {
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8'));
  }
});

after(async () => db.close());

async function as(role, claims = {}) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
  await db.exec(`set role ${role}`);
}

test('audit hardening fixes mutable search paths and anonymous privileged execution', async () => {
  await db.exec('reset role');
  const functions = await db.query(`
    select p.proname, p.proconfig,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'crm_base_state_id','is_coastal_crest_user','crm_app_role','can_manage_team_crm',
      'set_updated_at','is_crm_admin','apply_crm_admin_metadata'
    ) order by p.proname
  `);
  assert.equal(functions.rows.length, 7);
  for (const fn of functions.rows) {
    assert.deepEqual(fn.proconfig, ['search_path=""'], `${fn.proname} must use an empty search path`);
    assert.equal(fn.anon_execute, false, `${fn.proname} must not be anonymous-executable`);
  }
});

test('authenticated authorization helpers and record policies still work', async () => {
  await as('authenticated', {
    sub: adminId,
    email: 'admin@coastalcrestroofing.com',
    app_metadata: { role: 'admin' },
  });
  assert.equal((await db.query('select public.is_crm_admin() as allowed')).rows[0].allowed, true);
  await db.query(`select public.crm_commit_records($1,$2::jsonb,$3::jsonb)`, [
    'audit-hardening-save',
    JSON.stringify([{
      company_state_id: 'coastal-crest',
      record_type: 'job',
      id: 'audit-hardening-job',
      lead_id: 'audit-hardening-lead',
      expected_version: 0,
      data: {},
    }]),
    '[]',
  ]);
  assert.equal((await db.query("select count(*)::int as count from public.crm_records where id='audit-hardening-job'")).rows[0].count, 1);
});

test('all foreign keys named by the production advisor have covering indexes', async () => {
  await db.exec('reset role');
  const expected = [
    'crm_audit_events_actor_user_id_idx',
    'crm_backups_created_by_idx',
    'crm_company_settings_receipts_actor_user_id_idx',
    'crm_records_owner_id_idx',
    'crm_records_updated_by_idx',
    'crm_sales_numbers_created_by_idx',
    'crm_square_invoice_intents_created_by_idx',
    'crm_square_invoice_reviews_reviewed_by_idx',
    'crm_state_owner_id_idx',
    'crm_state_updated_by_idx',
    'crm_write_receipts_actor_user_id_idx',
  ];
  const result = await db.query(`select indexname from pg_indexes where schemaname='public' and indexname = any($1)`, [expected]);
  assert.deepEqual(result.rows.map(row => row.indexname).sort(), expected.sort());
});

test('RLS actor lookups use statement init plans', async () => {
  await db.exec('reset role');
  const result = await db.query(`
    select policyname, coalesce(qual,'') || ' ' || coalesce(with_check,'') as expression
    from pg_policies
    where schemaname='public' and policyname in (
      'Company users create CRM audit events','CRM managers create backups',
      'CRM users read allowed scoped state','CRM users create allowed scoped state',
      'CRM users update allowed scoped state','Company users create conversation messages',
      'Message authors update conversation messages','Company users create durable CRM records',
      'Company users update durable CRM records'
    )
  `);
  assert.equal(result.rows.length, 9);
  for (const policy of result.rows) {
    assert.match(policy.expression, /SELECT auth\.uid\(\)/i, `${policy.policyname} should cache auth.uid()`);
  }
});

test('hardening migration is safe to reapply', async () => {
  await db.exec('reset role');
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261012030945_audit_security_performance_hardening.sql'), 'utf8'));
});
