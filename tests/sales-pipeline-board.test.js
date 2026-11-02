const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261102043000_sales_pipeline_board_and_history.sql'), 'utf8');

test('sales pipeline has separate division-specific sales stages', () => {
  assert.match(app, /roofing:\s*\["New", "Contacted", "Inspection Scheduled", "Inspection Complete", "Estimate Sent", "Follow-Up\/Decision", "Contract & Deposit", "Production Handoff"\]/);
  assert.match(app, /construction:\s*\["New", "Contacted", "Consultation Scheduled", "Site Visit & Measurements", "Design & Selections", "Proposal Sent", "Revisions\/Decision", "Contract & Deposit", "Production Handoff"\]/);
  assert.match(app, /services:\s*\["New Request", "Contacted", "Scheduled\/Quoted", "Approved", "Operations Handoff"\]/);
  assert.match(app, /commercialApprovalStages = \["Bid Preparation", "Bid Submitted", "Management Review", "Board Approval"\]/);
});

test('pipeline command center includes required filters, metrics, and attention rules', () => {
  for (const text of [
    'Account type', 'Sales rep', 'Service', 'Source', 'Urgency', 'Created',
    'Active opportunities', 'Total pipeline value', 'Weighted forecast', 'Average sales cycle',
    'Unassigned website requests', 'New leads not contacted', 'Overdue follow-ups',
    'Estimates without decision date', 'Stuck beyond stage target',
  ]) assert.ok(app.includes(text), `missing pipeline control: ${text}`);
});

test('pipeline cards and drawer expose operational details', () => {
  for (const token of [
    'data-pipeline-card', 'data-pipeline-drop-stage', 'data-pipeline-open', 'data-pipeline-move',
    'Stage checklist', 'Notes and conversations', 'Recent activity', 'Open full lead',
    'No next follow-up scheduled', 'requirement${checklist.missing.length === 1 ? "" : "s"} missing',
  ]) assert.ok(app.includes(token), `missing pipeline behavior: ${token}`);
  assert.match(styles, /\.pipeline-detail-drawer/);
  assert.match(styles, /\.sales-pipeline-column\.is-drag-over/);
});

test('stage movement is one-step, checklist-aware, verified, and rolled back on failed save', () => {
  const start = app.indexOf('async function movePipelineOpportunity');
  const end = app.indexOf('function renderLeadCard', start);
  const mover = app.slice(start, end);
  assert.match(mover, /targetIndex > currentIndex \+ 1/);
  assert.match(mover, /RooflineWorkflowChecklist\?\.transitionCheck/);
  assert.match(mover, /persistLeadJobRecord\(jobId, updateId\)/);
  assert.match(mover, /state\.contacts = state\.contacts\.map/);
  assert.match(mover, /has been restored/);
});

test('database migration backfills history and guards stage skipping', () => {
  assert.match(migration, /salesStageHistory/);
  assert.match(migration, /salesStageEnteredAt/);
  assert.match(migration, /crm_guard_sales_pipeline_transition/);
  assert.match(migration, /invalid_sales_pipeline_transition/);
  assert.match(migration, /sales_stage_history_required/);
  assert.match(migration, /security invoker/);
});

test('sales pipeline migration executes, is replay-safe, and rejects a skipped stage', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create table public.crm_records(
        company_state_id text not null,
        record_type text not null,
        id text not null,
        data jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default clock_timestamp(),
        primary key(company_state_id,record_type,id)
      );
      create function public.can_manage_team_crm() returns boolean language sql stable set search_path='' as $$select false$$;
      insert into public.crm_records(company_state_id,record_type,id,data) values
        ('coastal-crest','job','job_pipeline','{"division":"roofing","status":"Estimate Sent","createdAt":"2026-10-01T12:00:00Z","salesRep":"Rep One"}');
    `);
    await db.exec(migration);
    await db.exec(migration);
    const backfill = await db.query("select data->>'salesStage' stage,jsonb_array_length(data->'salesStageHistory') history from public.crm_records where id='job_pipeline'");
    assert.equal(backfill.rows[0].stage, 'Estimate Sent');
    assert.equal(backfill.rows[0].history, 1);

    await db.exec(`update public.crm_records set data=jsonb_set(jsonb_set(jsonb_set(data,'{salesStage}','"Follow-Up/Decision"'),'{salesStageEnteredAt}','"2026-11-01T12:00:00Z"'),'{salesStageHistory}',(data->'salesStageHistory') || '[{"stage":"Follow-Up/Decision","enteredAt":"2026-11-01T12:00:00Z","exitedAt":"","actor":"Rep One"}]'::jsonb) where id='job_pipeline'`);
    await assert.rejects(
      db.exec(`update public.crm_records set data=jsonb_set(jsonb_set(jsonb_set(data,'{salesStage}','"Production Handoff"'),'{salesStageEnteredAt}','"2026-11-01T13:00:00Z"'),'{salesStageHistory}',(data->'salesStageHistory') || '[{"stage":"Production Handoff","enteredAt":"2026-11-01T13:00:00Z","exitedAt":"","actor":"Rep One"}]'::jsonb) where id='job_pipeline'`),
      /invalid_sales_pipeline_transition/,
    );
  } finally {
    await db.close();
  }
});
