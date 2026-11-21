const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

// In-memory PostgreSQL with the production helper functions and the records
// read policy as they were before the speed-up. Fixture identities only.
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261121_rls_initplan_performance.sql'), 'utf8');
const db = new PGlite();
const ids = { admin: '00000000-0000-4000-8000-0000000000a1', sales: '00000000-0000-4000-8000-0000000000b2', stranger: '00000000-0000-4000-8000-0000000000c3' };

before(async () => {
  await db.exec(`
    create role authenticated;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth to authenticated;
    create table public.crm_user_access(user_id uuid primary key, email text, role text, approved boolean);
    insert into public.crm_user_access values
      ('${ids.admin}','admin@coastalcrestroofing.com','admin',true),
      ('${ids.sales}','sales@coastalcrestroofing.com','sales',true);
    create function public.crm_base_state_id() returns text language sql stable set search_path to '' as $f$ select 'coastal-crest'; $f$;
    create function public.is_coastal_crest_user() returns boolean language sql stable security definer set search_path to '' as
      $f$ select exists(select 1 from public.crm_user_access where user_id=auth.uid() and approved and lower(email)=lower(coalesce(auth.jwt()->>'email',''))) $f$;
    create function public.crm_app_role() returns text language sql stable security definer set search_path to '' as
      $f$ select coalesce((select role from public.crm_user_access where user_id=auth.uid() and approved), 'viewer') $f$;
    create function public.is_crm_admin() returns boolean language sql stable security definer set search_path to '' as $f$ select public.crm_app_role() = 'admin' $f$;
    create function public.can_manage_team_crm() returns boolean language sql stable set search_path to '' as
      $f$ select public.is_crm_admin() or public.crm_app_role() in ('office_manager','sales_manager','operations_manager'); $f$;
    create table public.crm_records(company_state_id text, record_type text, id text, lead_id text, owner_id uuid, data jsonb,
      primary key (company_state_id, record_type, id));
    alter table public.crm_records enable row level security;
    create policy "Approved users read assigned CRM records" on public.crm_records for select to authenticated
      using (is_coastal_crest_user() and company_state_id = crm_base_state_id() and (can_manage_team_crm()
        or owner_id = (select auth.uid()) or (record_type = 'document' and lead_id = 'company')));
    create policy "Company users update durable CRM records" on public.crm_records for update to authenticated
      using (is_coastal_crest_user() and company_state_id = crm_base_state_id())
      with check (is_coastal_crest_user() and company_state_id = crm_base_state_id());
    grant select, update on public.crm_records to authenticated;
    insert into public.crm_records values
      ('coastal-crest','contact','admin-lead',null,'${ids.admin}','{}'),
      ('coastal-crest','contact','sales-lead',null,'${ids.sales}','{}'),
      ('coastal-crest','document','shared-doc','company','${ids.admin}','{}');
  `);
});
after(() => db.close());

async function visibleAs(who) {
  await db.exec('reset role');
  const claims = who === 'stranger' ? { sub: ids.stranger, email: 'x@example.com' } : { sub: ids[who], email: `${who}@coastalcrestroofing.com` };
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
  await db.exec('set role authenticated');
  const rows = (await db.query('select id from public.crm_records order by id')).rows.map(row => row.id);
  await db.exec('reset role');
  return rows;
}
const policies = async () => (await db.query(
  "select polname, pg_get_expr(polqual, polrelid) q, pg_get_expr(polwithcheck, polrelid) c from pg_policy order by polname")).rows;

test('wrapping helper calls keeps exactly the same access and runs each helper once per query', async () => {
  const before = { admin: await visibleAs('admin'), sales: await visibleAs('sales'), stranger: await visibleAs('stranger') };
  assert.deepEqual(before.admin, ['admin-lead', 'sales-lead', 'shared-doc']);
  assert.deepEqual(before.sales, ['sales-lead', 'shared-doc']);
  assert.deepEqual(before.stranger, []);

  await db.exec(migration);
  for (const policy of await policies()) {
    for (const expr of [policy.q, policy.c].filter(Boolean)) {
      assert.doesNotMatch(expr.replace(/SELECT (public\.)?\w+\(\)/g, ''), /(is_coastal_crest_user|can_manage_team_crm|crm_base_state_id)\(\)/,
        `${policy.polname}: every helper call is wrapped`);
    }
  }
  assert.deepEqual({ admin: await visibleAs('admin'), sales: await visibleAs('sales'), stranger: await visibleAs('stranger') }, before);

  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: ids.admin, email: 'admin@coastalcrestroofing.com' })]);
  const plan = (await db.query('explain select * from public.crm_records')).rows.map(row => row['QUERY PLAN']).join('\n');
  await db.exec('reset role');
  assert.match(plan, /InitPlan/, 'helpers become one-time InitPlans instead of per-row calls');
});

test('running the speed-up again changes nothing', async () => {
  const first = await policies();
  await db.exec(migration);
  assert.deepEqual(await policies(), first);
});
