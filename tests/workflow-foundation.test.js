const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'supabase/migrations/20261027111541_perfex_foundation_phase1.sql'),
  'utf8',
);

test('phase-one workflow schema is relational, indexed, and RLS protected', () => {
  for (const table of [
    'crm_task_workflows',
    'crm_task_participants',
    'crm_task_checklist_items',
    'crm_task_comments',
    'crm_task_time_entries',
    'crm_job_milestones',
    'crm_activity_events',
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.%I enable row level security`));
  }
  assert.match(migration, /crm_task_time_entries_one_active_per_user_idx/);
  assert.match(migration, /revoke all on table public\.%I from public, anon/);
  assert.match(migration, /grant select, insert, update, delete on table public\.%I to authenticated/);
  assert.match(migration, /crm_workflow_row_access/);
});
test('phase-one workflow migration executes and can be reapplied', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
      create table public.crm_records (
        company_state_id text not null,
        record_type text not null,
        id text not null,
        owner_id uuid,
        deleted_at timestamptz
      );
      create function public.crm_base_state_id() returns text language sql stable set search_path='' as
        $$ select 'coastal-crest' $$;
      create function public.is_coastal_crest_user() returns boolean language sql stable set search_path='' as
        $$ select true $$;
      create function public.can_manage_team_crm() returns boolean language sql stable set search_path='' as
        $$ select true $$;
    `);
    await db.exec(migration);
    await db.exec(migration);
    const tables = await db.query(`
      select count(*)::int as count
      from pg_tables
      where schemaname='public' and tablename = any($1)
    `, [[
      'crm_task_workflows', 'crm_task_participants', 'crm_task_checklist_items',
      'crm_task_comments', 'crm_task_time_entries', 'crm_job_milestones', 'crm_activity_events',
    ]]);
    assert.equal(tables.rows[0].count, 7);
    const rls = await db.query(`
      select count(*)::int as count from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relrowsecurity and c.relname like 'crm_%'
    `);
    assert.equal(rls.rows[0].count, 7);
  } finally {
    await db.close();
  }
});

test('enhanced task form supports job context, priority, recurrence, followers, and checklists', () => {
  assert.match(page, /id="calendarTaskJob"/);
  assert.match(page, /name="priority"/);
  assert.match(page, /name="workflowStatus"/);
  assert.match(page, /name="recurrence"/);
  assert.match(page, /name="followers"/);
  assert.match(page, /name="checklistText"/);
  assert.match(app, /function toggleTaskChecklist/);
  assert.match(app, /function addTaskComment/);
  assert.match(app, /function toggleTaskTimer/);
  assert.match(app, /next recurring task was created/);
  assert.match(styles, /\.task-progress/);
});

test('job milestones and the unified activity timeline are present', () => {
  assert.match(page, /id="jobMilestoneForm"/);
  assert.match(page, /data-lead-tab="activity"/);
  assert.match(page, /id="leadActivityTimeline"/);
  assert.match(app, /function saveJobMilestone/);
  assert.match(app, /function renderLeadActivity/);
  assert.match(app, /Payment recorded/);
  assert.match(app, /Document.*uploaded/);
  assert.match(styles, /\.activity-timeline/);
});

