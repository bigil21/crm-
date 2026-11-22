const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.js');
const page = read('index.html');
const styles = read('styles.css');
const phaseOne = read('supabase/migrations/20261027111541_perfex_foundation_phase1.sql');
const stepThree = read('supabase/migrations/20261027114732_project_delivery_step3.sql');
const migration = read('supabase/migrations/20261101123000_job_operations_suite.sql');

test('job operations migration is replay-safe, relational, explicitly granted, and RLS protected', async () => {
  const db = new PGlite();
  const tables = [
    'crm_permits', 'crm_inspections', 'crm_job_selections', 'crm_change_orders',
    'crm_progress_billings', 'crm_maintenance_plans', 'crm_maintenance_visits',
    'crm_organization_accounts', 'crm_account_properties', 'crm_account_contacts',
    'crm_account_record_links',
  ];
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
      create table public.crm_records(company_state_id text not null,record_type text not null,id text not null,lead_id text not null default '',job_id text not null default '',owner_id uuid,data jsonb not null default '{}'::jsonb,deleted_at timestamptz);
      create function public.crm_base_state_id() returns text language sql stable set search_path='' as $$select 'coastal-crest'$$;
      create function public.is_coastal_crest_user() returns boolean language sql stable set search_path='' as $$select true$$;
      create function public.can_manage_team_crm() returns boolean language sql stable set search_path='' as $$select true$$;
      create function public.is_crm_admin() returns boolean language sql stable set search_path='' as $$select true$$;
    `);
    await db.exec(phaseOne);
    await db.exec(stepThree);
    await db.exec(migration);
    await db.exec(migration);
    const created = await db.query("select count(*)::int count from pg_tables where schemaname='public' and tablename=any($1)", [tables]);
    assert.equal(created.rows[0].count, tables.length);
    const rls = await db.query("select count(*)::int count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relrowsecurity and c.relname=any($1)", [tables]);
    assert.equal(rls.rows[0].count, tables.length);
    const grants = await db.query("select count(distinct table_name)::int count from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and privilege_type='SELECT' and table_name=any($1)", [tables]);
    assert.equal(grants.rows[0].count, tables.length);
  } finally {
    await db.close();
  }
});

test('operations UI covers every requested module and stays job scoped', () => {
  for (const id of ['leadOperationsPanel','permitForm','inspectionForm','selectionForm','changeOrderForm','progressBillingForm','maintenancePlanForm','customerAccountForm','accountPropertyLinkForm']) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  assert.match(page, /data-lead-tab="operations"/);
  assert.match(app, /function renderLeadOperations\(contact\)/);
  assert.match(app, /operationsForJob\("permits", contact\.id, job\.id\)/);
  assert.match(app, /operationsForJob\("progressBillings", contact\.id, job\.id\)/);
  assert.match(app, /Only an administrator can create billing draws/);
  assert.match(app, /crm_invoice_schedules/);
  assert.match(app, /data-operation-update/);
  assert.match(app, /function createProgressDrawInvoice\(drawId\)/);
  assert.match(app, /crm_create_maintenance_plan/);
  assert.match(app, /crm_link_account_property/);
  assert.match(styles, /\.operations-grid/);
  assert.match(styles, /@media \(max-width: 700px\)/);
});

// Regression: both RPCs declared variables named lead_id and job_id, which are
// also crm_records columns, so every call failed with
// `column reference "job_id" is ambiguous` and nothing could be saved.
for (const [label, files] of [
  ['the job operations migration', []],
  ['the repair migration applied over the original definitions', ['supabase/migrations/20261122071500_unambiguous_job_operation_rpc_variables.sql']],
]) {
  test(`maintenance plans and property links save through their RPCs (${label})`, async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create role anon; create role authenticated; create schema auth;
        create function auth.uid() returns uuid language sql stable as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
        create table public.crm_records(company_state_id text not null,record_type text not null,id text not null,lead_id text not null default '',job_id text not null default '',owner_id uuid,data jsonb not null default '{}'::jsonb,deleted_at timestamptz);
        create function public.crm_base_state_id() returns text language sql stable set search_path='' as $$select 'coastal-crest'$$;
        create function public.is_coastal_crest_user() returns boolean language sql stable set search_path='' as $$select true$$;
        create function public.can_manage_team_crm() returns boolean language sql stable set search_path='' as $$select true$$;
        create function public.is_crm_admin() returns boolean language sql stable set search_path='' as $$select true$$;
      `);
      await db.exec(phaseOne); await db.exec(stepThree);
      // The second case rebuilds what production ran before the repair.
      await db.exec(files.length ? migration.replaceAll('v_company_id', 'company_id').replaceAll('v_account_id', 'account_id').replaceAll('v_lead_id', 'lead_id').replaceAll('v_job_id', 'job_id') : migration);
      for (const file of files) { await db.exec(read(file)); await db.exec(read(file)); }
      await db.exec(`
        insert into public.crm_records(company_state_id,record_type,id,lead_id,owner_id) values('coastal-crest','contact','lead_qa','lead_qa','00000000-0000-4000-8000-000000000001');
        insert into public.crm_records(company_state_id,record_type,id,lead_id,owner_id) values('coastal-crest','job','job_qa','lead_qa','00000000-0000-4000-8000-000000000001');
        insert into public.crm_organization_accounts(id,name,account_type,owner_user_id) values('account_qa','Bayview HOA','hoa','00000000-0000-4000-8000-000000000001');
      `);
      const plan = { id: 'plan_qa', lead_id: 'lead_qa', job_id: 'job_qa', plan_name: 'Annual roof care', service_name: 'Roof tune-up', frequency: 'annual', interval_months: 12, start_on: '2026-12-01', next_service_on: '2027-12-01', amount: 350, auto_invoice: false };
      const visit = { id: 'visit_qa', scheduled_for: '2027-12-01T09:00:00', task_id: 'maintenance_task_plan_qa', notes: 'Roof tune-up' };
      const saved = await db.query('select public.crm_create_maintenance_plan($1::jsonb,$2::jsonb) result', [JSON.stringify(plan), JSON.stringify(visit)]);
      assert.deepEqual(saved.rows[0].result, { plan_id: 'plan_qa', visit_id: 'visit_qa', status: 'scheduled' });
      const stored = await db.query("select p.job_id,v.plan_id from public.crm_maintenance_plans p join public.crm_maintenance_visits v on v.plan_id=p.id where p.id='plan_qa'");
      assert.deepEqual(stored.rows, [{ job_id: 'job_qa', plan_id: 'plan_qa' }]);
      await assert.rejects(() => db.query('select public.crm_create_maintenance_plan($1::jsonb,$2::jsonb)', [JSON.stringify({ ...plan, id: 'plan_other', job_id: 'job_missing' }), JSON.stringify({ ...visit, id: 'visit_other' })]), /job_not_found/);

      const property = { id: 'property_qa', account_id: 'account_qa', name: 'Clubhouse', address: '1 Bayview Dr' };
      const contact = { id: 'accountcontact_qa', name: 'Pat Manager', email: 'pat@example.com' };
      const link = { id: 'link_qa', lead_id: 'lead_qa', job_id: 'job_qa' };
      const linked = await db.query('select public.crm_link_account_property($1::jsonb,$2::jsonb,$3::jsonb) result', [JSON.stringify(property), JSON.stringify(contact), JSON.stringify(link)]);
      assert.deepEqual(linked.rows[0].result, { account_id: 'account_qa', property_id: 'property_qa', job_id: 'job_qa', status: 'linked' });
      const links = await db.query("select account_id,property_id,lead_id,job_id from public.crm_account_record_links where id='link_qa'");
      assert.deepEqual(links.rows, [{ account_id: 'account_qa', property_id: 'property_qa', lead_id: 'lead_qa', job_id: 'job_qa' }]);
      await assert.rejects(() => db.query('select public.crm_link_account_property($1::jsonb,$2::jsonb,$3::jsonb)', [JSON.stringify({ ...property, id: 'property_other' }), JSON.stringify({}), JSON.stringify({ ...link, id: 'link_other', job_id: 'job_missing' })]), /job_not_found/);
    } finally {
      await db.close();
    }
  });
}

test('permits, inspections and selections can be deleted by their creator or a manager; money records cannot', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
      create table public.crm_records(company_state_id text not null,record_type text not null,id text not null,lead_id text not null default '',job_id text not null default '',owner_id uuid,data jsonb not null default '{}'::jsonb,deleted_at timestamptz);
      create function public.crm_base_state_id() returns text language sql stable set search_path='' as $$select 'coastal-crest'$$;
      create function public.is_coastal_crest_user() returns boolean language sql stable set search_path='' as $$select true$$;
      create function public.can_manage_team_crm() returns boolean language sql stable set search_path='' as $$select false$$;
      create function public.is_crm_admin() returns boolean language sql stable set search_path='' as $$select true$$;
      grant usage on schema public, auth to authenticated;
    `);
    await db.exec(phaseOne); await db.exec(stepThree); await db.exec(migration);
    const deleteMigration = read('supabase/migrations/20261122090000_delete_job_operation_rows.sql');
    await db.exec(deleteMigration); await db.exec(deleteMigration);
    const policies = await db.query("select tablename from pg_policies where schemaname='public' and policyname='CRM operations rows delete' and cmd='DELETE' order by tablename");
    assert.deepEqual(policies.rows.map((row) => row.tablename), ['crm_inspections', 'crm_job_selections', 'crm_permits']);
    const granted = await db.query("select table_name from information_schema.role_table_grants where table_schema='public' and grantee='authenticated' and privilege_type='DELETE' order by table_name");
    assert.deepEqual(granted.rows.map((row) => row.table_name).filter((name) => /permits|inspections|job_selections|change_orders|progress_billings/.test(name)),
      ['crm_inspections', 'crm_job_selections', 'crm_permits'], 'change orders and billing draws are voided, never deleted');
    // A lead the signed-in user owns, with one permit they created and one a colleague created.
    await db.exec(`
      insert into public.crm_records(company_state_id,record_type,id,lead_id,owner_id) values('coastal-crest','contact','lead_qa','lead_qa','00000000-0000-4000-8000-000000000001');
      insert into public.crm_permits(id,lead_id,job_id,permit_type,created_by) values('mine','lead_qa','job_qa','Roofing','00000000-0000-4000-8000-000000000001');
      -- The stamp trigger records whoever is signed in as the creator, so it is
      -- switched off to set up a row that a colleague created.
      alter table public.crm_permits disable trigger crm_stamp_operations_row;
      insert into public.crm_permits(id,lead_id,job_id,permit_type,created_by) values('theirs','lead_qa','job_qa','Electrical','00000000-0000-4000-8000-000000000002');
      alter table public.crm_permits enable trigger crm_stamp_operations_row;
    `);
    assert.equal((await db.query("select created_by from public.crm_permits where id='theirs'")).rows[0].created_by, '00000000-0000-4000-8000-000000000002');
    await db.exec('set role authenticated');
    const removed = await db.query("delete from public.crm_permits where id in ('mine','theirs') returning id");
    assert.deepEqual(removed.rows.map((row) => row.id), ['mine'], 'a rep removes only the row they created');
    await db.exec('reset role');
    assert.equal((await db.query("select count(*)::int n from public.crm_permits")).rows[0].n, 1);
  } finally {
    await db.close();
  }
});

test('operations schema enforces valid money, status, and portfolio relationships', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
      create table public.crm_records(company_state_id text not null,record_type text not null,id text not null,lead_id text not null default '',job_id text not null default '',owner_id uuid,data jsonb not null default '{}'::jsonb,deleted_at timestamptz);
      create function public.crm_base_state_id() returns text language sql stable set search_path='' as $$select 'coastal-crest'$$;
      create function public.is_coastal_crest_user() returns boolean language sql stable set search_path='' as $$select true$$;
      create function public.can_manage_team_crm() returns boolean language sql stable set search_path='' as $$select true$$;
      create function public.is_crm_admin() returns boolean language sql stable set search_path='' as $$select true$$;
    `);
    await db.exec(phaseOne); await db.exec(stepThree); await db.exec(migration);
    await db.exec("insert into public.crm_organization_accounts(id,name,account_type) values('account_qa','Bayview HOA','hoa')");
    await db.exec("insert into public.crm_account_properties(id,account_id,name,address) values('property_qa','account_qa','Clubhouse','1 Bayview Dr')");
    await db.exec("insert into public.crm_account_record_links(id,account_id,property_id,lead_id,job_id) values('link_qa','account_qa','property_qa','lead_qa','job_qa')");
    const linked = await db.query("select a.name,p.name property from public.crm_account_record_links l join public.crm_organization_accounts a using(company_state_id) join public.crm_account_properties p on p.company_state_id=l.company_state_id and p.id=l.property_id where l.id='link_qa'");
    assert.equal(linked.rows[0].name, 'Bayview HOA');
    assert.equal(linked.rows[0].property, 'Clubhouse');
    await assert.rejects(() => db.exec("insert into public.crm_job_selections(id,lead_id,job_id,item_name,allowance_amount) values('bad','lead_qa','job_qa','Tile',-1)"));
    await assert.rejects(() => db.exec("insert into public.crm_progress_billings(id,lead_id,job_id,draw_number,name,scheduled_percent,amount) values('bad','lead_qa','job_qa',1,'Deposit',101,100)"));
  } finally {
    await db.close();
  }
});
