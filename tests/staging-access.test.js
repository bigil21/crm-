const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const origin = 'https://ixksmfiektzsunmmwejz.supabase.co';
const id = '00000000-0000-4000-8000-000000000009';
const email = 'staging-sales@example.invalid';
const user = { id, email, app_metadata: { role: 'sales' } };
function loadFunctions(file, names, globals) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const context = vm.createContext({ URL, ...globals });
  for (const name of names) {
    const body = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'))?.[0];
    assert.ok(body, name);
    vm.runInContext(body, context);
  }
  return context;
}
const env = { CRM_STAGING_ACCESS: 'true', NODE_ENV: 'development', CRM_SKIP_ENV_FILES: 'true',
  AUTH_REQUIRED: 'true', SUPABASE_SYNC_ENABLED: 'true', SUPABASE_URL: origin,
  CRM_STAGING_TEST_EMAIL: email, CRM_STAGING_TEST_USER_ID: id };
function server(overrides = {}) {
  return loadFunctions('server.js', ['supabaseConfig', 'authenticationRequired', 'stagingTestIdentity', 'isAllowedApiUser'], {
    process: { env: { ...env, ...overrides } }, allowedEmailDomain: 'coastalcrestroofing.com',
  });
}
test('server staging exception requires every safety guard and never admits the entire Gmail domain', () => {
  const c = server();
  assert.equal(c.isAllowedApiUser(user), true);
  for (const override of [
    { NODE_ENV: 'production' }, { CRM_STAGING_ACCESS: undefined }, { CRM_SKIP_ENV_FILES: 'false' },
    { SUPABASE_URL: 'https://production.example' }, { SUPABASE_SYNC_ENABLED: 'false' },
    { CRM_STAGING_TEST_USER_ID: '' }, { SQUARE_ACCESS_TOKEN: 'synthetic-provider-token' },
    { ALLOW_LOCAL_DEMO: 'true', AUTH_REQUIRED: 'false' },
  ]) {
    assert.equal(server(override).stagingTestIdentity(), null);
    assert.equal(server(override).isAllowedApiUser(user), false);
  }
  for (const change of [{ id: 'other-user' }, { email: 'other@gmail.com' }, { app_metadata: { role: 'admin' } }, { app_metadata: {}, user_metadata: { role: 'sales' } }]) {
    assert.equal(c.isAllowedApiUser({ ...user, ...change }), false);
  }
  assert.equal(server({ NODE_ENV: 'production' }).isAllowedApiUser({ email: 'gil@coastalcrestroofing.com' }), true);
});
function client(overrides = {}, hostname = '127.0.0.1') {
  return loadFunctions('auth.js', ['emailDomain', 'stagingTestIdentity', 'isAllowedEmail', 'isAllowedUser'], {
    config: { allowedEmailDomain: 'coastalcrestroofing.com', supabaseUrl: origin,
      stagingTestIdentity: { projectOrigin: origin, userId: id, email }, ...overrides },
    window: { location: { hostname } },
  });
}
test('browser Gmail allowance is loopback-only, exact-project and exact-identity', () => {
  const c = client();
  assert.equal(c.isAllowedEmail(email), true);
  assert.equal(c.isAllowedUser(user), true);
  assert.equal(c.isAllowedEmail('other@gmail.com'), false);
  assert.equal(c.isAllowedUser({ ...user, id: 'another-user' }), false);
  assert.equal(c.isAllowedUser({ ...user, app_metadata: { role: 'admin' } }), false);
  for (const other of [client({}, 'jobcrestcrm.com'), client({ supabaseUrl: 'https://different.example' }), client({ stagingTestIdentity: null })]) {
    assert.equal(other.isAllowedEmail(email), false);
    assert.equal(other.isAllowedUser(user), false);
    assert.equal(other.isAllowedEmail('gil@coastalcrestroofing.com'), true);
  }
});

async function database() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid,bucket_id text);
    grant usage on schema public,auth,storage to authenticated,anon;`);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  await db.exec('grant all on all tables in schema public to authenticated;');
  for (const file of ['20260914_conflict_safe_record_writes.sql', '20260914_company_settings_permissions.sql']) {
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations', file), 'utf8'));
  }
  return db;
}
const fixtureSql = file => fs.readFileSync(path.join(root, 'supabase/staging', file), 'utf8')
  .replaceAll('__STAGING_TEST_USER_ID__', id).replaceAll('__STAGING_TEST_EMAIL__', email);
const stagingSql = fixtureSql('approved-sales-tester.sql');
test('staging SQL refuses a missing exact test identity without changing production domain rules', async () => {
  const db = await database();
  try {
    await assert.rejects(db.exec(stagingSql), /identity missing/);
    await db.exec('rollback');
    const body = (await db.query("select pg_get_functiondef('public.is_coastal_crest_user()'::regprocedure) as body")).rows[0].body;
    assert.equal(body.includes(email), false);
  } finally { await db.close(); }
});
test('staging SQL admits only the approved sales JWT and still denies payments and company settings', async () => {
  const db = await database();
  const claims = { sub: id, email, iss: `${origin}/auth/v1`, app_metadata: { role: 'sales' } };
  async function as(overrides = {}) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ ...claims, ...overrides })]);
    await db.exec('set role authenticated');
  }
  try {
    await db.query('insert into auth.users values ($1,$2,now(),$3)', [id, email, { provider: 'email' }]);
    await db.exec(stagingSql);
    assert.equal((await db.query('select raw_app_meta_data from auth.users')).rows[0].raw_app_meta_data.provider, 'email');
    assert.equal((await db.query('select raw_app_meta_data from auth.users')).rows[0].raw_app_meta_data.role, 'sales');
    for (const variant of [{ iss: 'https://other.supabase.co/auth/v1' }, { iss: null }, { email: 'different@gmail.com' },
      { sub: '00000000-0000-4000-8000-000000000002' }, { app_metadata: { role: 'admin' } }]) {
      await as(variant);
      assert.notEqual((await db.query('select public.is_coastal_crest_user() as allowed')).rows[0].allowed, true);
    }
    await as();
    const permissions = (await db.query('select public.is_coastal_crest_user() as allowed,public.is_crm_admin() as admin')).rows[0];
    assert.deepEqual(permissions, { allowed: true, admin: false });
    const row = { company_state_id: 'coastal-crest', record_type: 'job', id: 'stage-job', lead_id: 'synthetic-lead', expected_version: 0, data: { contractValue: 35250.75 } };
    await db.query('select public.crm_commit_records($1,$2::jsonb,$3::jsonb)', ['stage-normal', JSON.stringify([row]), '[]']);
    const paid = { ...row, expected_version: 1, data: { ...row.data, paidAmount: 100 } };
    await assert.rejects(db.query('select public.crm_commit_records($1,$2::jsonb,$3::jsonb)', ['stage-payment', JSON.stringify([paid]), '[]']), e => e.code === '42501');
    await assert.rejects(db.exec("insert into public.crm_state(id,data,updated_by) values('coastal-crest:company','{}',auth.uid())"), e => e.code === '42501');
    assert.equal((await db.query("select data from public.crm_records where id='stage-job'")).rows[0].data.contractValue, 35250.75);
    await db.exec('reset role');
    const results = await db.exec(fixtureSql('approved-sales-smoke.sql'));
    assert.match(results.find(r => r.rows?.[0]?.approved_sales_checks).rows[0].approved_sales_checks, /^PASS:/);
    assert.equal((await db.query("select count(*)::int as count from public.crm_records where id='approved-sales-smoke-job'")).rows[0].count, 0);
    assert.equal((await db.query("select count(*)::int as count from public.crm_write_receipts where request_id like 'approved-sales-smoke-%'")).rows[0].count, 0);
  } finally { await db.close(); }
});
