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
