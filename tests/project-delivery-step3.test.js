const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const phaseOne = fs.readFileSync(path.join(root, 'supabase/migrations/20261027111541_perfex_foundation_phase1.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261027114732_project_delivery_step3.sql'), 'utf8');

test('project delivery migration is replay-safe and applies a template once requested', async () => {
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
    await db.exec(phaseOne);
    await db.exec(migration);
    await db.exec(migration);
    const tables = await db.query("select count(*)::int count from pg_tables where schemaname='public' and tablename=any($1)", [[
      'crm_project_members','crm_project_discussions','crm_project_notes','crm_job_time_entries','crm_project_templates',
    ]]);
    assert.equal(tables.rows[0].count, 5);
    await db.exec(`insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,owner_id,data) values
      ('coastal-crest','contact','lead_qa','lead_qa','','00000000-0000-4000-8000-000000000001','{}'),
      ('coastal-crest','job','job_qa','lead_qa','job_qa','00000000-0000-4000-8000-000000000001','{}')`);
    const result = await db.query("select public.crm_apply_project_template('roof-replacement-standard','lead_qa','job_qa') count");
    assert.equal(result.rows[0].count, 7);
    const milestones = await db.query("select count(*)::int count from public.crm_job_milestones where job_id='job_qa'");
    assert.equal(milestones.rows[0].count, 7);
  } finally { await db.close(); }
});

test('project delivery UI includes members, notes, discussions, templates, and job time', () => {
  for (const id of ['projectMemberForm','projectNoteForm','projectDiscussionForm','projectTemplateSelect','toggleJobTimerButton']) {
    assert.match(page, new RegExp(`id="${id}"`));
  }
  assert.match(app, /function renderProjectDelivery/);
  assert.match(app, /function toggleJobDeliveryTimer/);
  assert.match(app, /crm_apply_project_template/);
  assert.match(migration, /crm_project_row_access/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table/);
});
