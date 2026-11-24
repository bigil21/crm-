// The database holds Construction and Home Services jobs to the same stage
// checklists the browser shows (to-do item 4). The function is run for real in
// an in-memory PostgreSQL; nothing here touches a network or a real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const migration = read('supabase/migrations/20261122200000_division_checklists_enforced_in_database.sql');

const PIPELINES = {
  roofing: ['New', 'Contacted', 'Inspection', 'Estimate Sent', 'Won', 'Scheduled', 'Materials Ordered', 'In Progress', 'Completed', 'Paid'],
  construction: ['New', 'Consultation', 'Design & Selections', 'Estimate', 'Contract', 'Permits', 'Demo', 'Rough-In', 'Inspections', 'Finishes', 'Punch List', 'Final Walkthrough', 'Paid'],
  services: ['New', 'Request', 'Scheduled', 'Completed', 'Invoiced', 'Paid'],
};

// The browser's own checklist definitions, loaded from the real file.
function browserDefinitions() {
  const window = { JobCrestApp: { ready: true, replaceFunction: () => true }, RooflineProductionFlow: {}, addEventListener() {}, clearTimeout() {}, setTimeout() {} };
  const context = vm.createContext({
    console, window, state: { view: 'dashboard', estimates: [] }, els: {}, rolePolicies: {},
    document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}), head: { appendChild() {} }, addEventListener() {} },
    render() {}, renderLeadDetail() {}, renderSummary() {}, updateContact() {}, applyStatusUpdate() {}, hydrateIcons() {}, applyPermissionsToDom() {},
    pipelineStagesFor: (division) => PIPELINES[division] || PIPELINES.roofing,
    canManageTeamData: () => false, primaryJob: (contact) => contact.jobs?.[0], jobHasFullPayment: () => false,
  });
  vm.runInContext(read('workflow-checklists-v65.js'), context);
  return window.RooflineWorkflowChecklist.definitionsByDivision;
}

// The item ids the database requires, read out of the migration text.
function databaseKeys(division) {
  const block = migration.match(new RegExp(`when v_division='${division}' then case old_status([^]*?)else array\\[\\]::text\\[\\] end`))[1];
  return Object.fromEntries([...block.matchAll(/when '([^']+)' then array\[([^\]]*)\]/g)]
    .map(([, stage, keys]) => [stage, keys.split(',').map((key) => key.trim().replace(/'/g, ''))]));
}

test('to-do 4: the database requires exactly the items the browser asks the user to tick', () => {
  const definitions = browserDefinitions();
  for (const division of ['construction', 'services']) {
    const required = databaseKeys(division);
    for (const stage of PIPELINES[division]) {
      // Array.from: the definitions were created inside the vm, in another realm.
      const manual = Array.from(definitions[division][stage] || []).filter((item) => item.mode === 'manual').map((item) => item.id);
      // The last stage has nothing after it, so its items never gate a move.
      if (stage === 'Paid') continue;
      assert.deepEqual(required[stage] || [], manual, `${division} · ${stage}`);
    }
    assert.deepEqual(Object.keys(required).filter((stage) => !PIPELINES[division].includes(stage)), [], `${division}: no stage the pipeline does not have`);
  }
});

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create table public.crm_records(company_state_id text not null, record_type text not null, id text not null, lead_id text, job_id text,
      data jsonb not null default '{}'::jsonb, deleted_at timestamptz, primary key(company_state_id, record_type, id));
    create table public.crm_pipeline_stages(company_state_id text, division_id text, name text, display_order integer, active boolean default true);
    create function public.crm_base_state_id() returns text language sql stable as $$ select 'co' $$;
    create function public.can_manage_team_crm() returns boolean language sql stable as $$ select coalesce(current_setting('test.manager', true), '') = 'yes' $$;
  `);
  for (const [division, stages] of Object.entries(PIPELINES)) {
    for (const [index, name] of stages.entries()) {
      await db.query('insert into public.crm_pipeline_stages values($1,$2,$3,$4,true)', ['co', division, name, index]);
    }
  }
  await db.exec(migration);
  return db;
}

const lead = { name: 'TEST Lead', phone: '(555) 010-0000', email: 'lead@example.com', source: 'Referral', address: '1 Example St', salesRep: 'Alex Carter', notes: 'Made-up lead' };
const ticks = (jobId, stage, keys) => ({ workflowChecklists: { [jobId]: { [stage]: Object.fromEntries(keys.map((key) => [key, true])) } } });

async function seed(db, { division, status, contact = lead, job = {}, estimates = [], hasLead = true }) {
  await db.exec('delete from public.crm_records');
  if (hasLead) await db.query("insert into public.crm_records(company_state_id,record_type,id,lead_id,data) values('co','contact','lead1','lead1',$1)", [JSON.stringify(contact)]);
  await db.query("insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,data) values('co','job','job1','lead1','job1',$1)",
    [JSON.stringify({ division, status, value: 5000, contractValue: 5000, paidAmount: 0, ...job })]);
  for (const [index, estimate] of estimates.entries()) {
    await db.query("insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,data) values('co','estimate',$1,'lead1',$2,$3)",
      [`est${index}`, estimate.jobId ?? 'job1', JSON.stringify({ status: estimate.status })]);
  }
}

// Returns '' when the move is allowed, or the database's refusal.
async function move(db, { division, to, manager = false, batch = [], job = {} }) {
  await db.query("select set_config('test.manager', $1, false)", [manager ? 'yes' : 'no']);
  const change = { record_type: 'job', id: 'job1', lead_id: 'lead1', data: { division, status: to, value: 5000, contractValue: 5000, ...job } };
  try {
    await db.query('select public.crm_assert_job_stage_transition($1::jsonb, $2::jsonb)', [JSON.stringify(change), JSON.stringify([change, ...batch])]);
    return '';
  } catch (error) {
    return error.message;
  }
}

test('to-do 4: a Home Services job cannot move forward in the database until its checklist is ticked', async () => {
  const db = await database();
  try {
    const keys = databaseKeys('services').Request;
    await seed(db, { division: 'services', status: 'Request' });
    assert.equal(await move(db, { division: 'services', to: 'Scheduled' }), 'workflow_checklist_incomplete');
    // All but one ticked is still not enough.
    await seed(db, { division: 'services', status: 'Request', contact: { ...lead, ...ticks('job1', 'Request', keys.slice(1)) } });
    assert.equal(await move(db, { division: 'services', to: 'Scheduled' }), 'workflow_checklist_incomplete');
    await seed(db, { division: 'services', status: 'Request', contact: { ...lead, ...ticks('job1', 'Request', keys) } });
    assert.equal(await move(db, { division: 'services', to: 'Scheduled' }), '');
    // The ticks may arrive in the same save as the stage change.
    await seed(db, { division: 'services', status: 'Request' });
    const savedTogether = { record_type: 'contact', id: 'lead1', data: { ...lead, ...ticks('job1', 'Request', keys) } };
    assert.equal(await move(db, { division: 'services', to: 'Scheduled', batch: [savedTogether] }), '');
    // Ticks for a different job do not count.
    await seed(db, { division: 'services', status: 'Request', contact: { ...lead, ...ticks('another-job', 'Request', keys) } });
    assert.equal(await move(db, { division: 'services', to: 'Scheduled' }), 'workflow_checklist_incomplete');
  } finally { await db.close(); }
});

test('to-do 4: the first stage is checked from the record, by division', async () => {
  const db = await database();
  try {
    const noEmail = { ...lead, email: '', source: '', salesRep: '' };
    // Home Services needs a name, phone, address and what was asked for.
    await seed(db, { division: 'services', status: 'New', contact: noEmail });
    assert.equal(await move(db, { division: 'services', to: 'Request' }), '');
    await seed(db, { division: 'services', status: 'New', contact: { ...noEmail, phone: '' } });
    assert.equal(await move(db, { division: 'services', to: 'Request' }), 'workflow_checklist_incomplete');
    // Construction needs the same details as roofing, including email, source and a sales rep.
    await seed(db, { division: 'construction', status: 'New', contact: noEmail });
    assert.equal(await move(db, { division: 'construction', to: 'Consultation' }), 'workflow_checklist_incomplete');
    await seed(db, { division: 'construction', status: 'New', contact: { ...lead, salesRep: 'Unassigned' } });
    assert.equal(await move(db, { division: 'construction', to: 'Consultation' }), 'workflow_checklist_incomplete');
    await seed(db, { division: 'construction', status: 'New' });
    assert.equal(await move(db, { division: 'construction', to: 'Consultation' }), '');
  } finally { await db.close(); }
});

test('to-do 4: Construction cannot leave Estimate without an estimate that was sent', async () => {
  const db = await database();
  try {
    const done = { ...lead, ...ticks('job1', 'Estimate', databaseKeys('construction').Estimate) };
    await seed(db, { division: 'construction', status: 'Estimate', contact: done });
    assert.equal(await move(db, { division: 'construction', to: 'Contract' }), 'workflow_checklist_incomplete', 'no estimate at all');
    await seed(db, { division: 'construction', status: 'Estimate', contact: done, estimates: [{ status: 'Draft' }] });
    assert.equal(await move(db, { division: 'construction', to: 'Contract' }), 'workflow_checklist_incomplete', 'a draft is not enough');
    for (const status of ['Sent', 'Won', 'Approved']) {
      await seed(db, { division: 'construction', status: 'Estimate', contact: done, estimates: [{ status }] });
      assert.equal(await move(db, { division: 'construction', to: 'Contract' }), '', status);
    }
    // An older estimate saved without a job id counts for its lead, as in the browser.
    await seed(db, { division: 'construction', status: 'Estimate', contact: done, estimates: [{ status: 'Sent', jobId: '' }] });
    assert.equal(await move(db, { division: 'construction', to: 'Contract' }), '');
    // An estimate for a different job does not.
    await seed(db, { division: 'construction', status: 'Estimate', contact: done, estimates: [{ status: 'Sent', jobId: 'another-job' }] });
    assert.equal(await move(db, { division: 'construction', to: 'Contract' }), 'workflow_checklist_incomplete');
    // The sent estimate may be part of the same save.
    await seed(db, { division: 'construction', status: 'Estimate', contact: done });
    const estimateInSave = { record_type: 'estimate', id: 'est-new', lead_id: 'lead1', job_id: 'job1', data: { status: 'Sent' } };
    assert.equal(await move(db, { division: 'construction', to: 'Contract', batch: [estimateInSave] }), '');
    // The ticks are still required when the estimate is there.
    await seed(db, { division: 'construction', status: 'Estimate', estimates: [{ status: 'Sent' }] });
    assert.equal(await move(db, { division: 'construction', to: 'Contract' }), 'workflow_checklist_incomplete');
  } finally { await db.close(); }
});

test('to-do 4: what the database deliberately does not hold a job to', async () => {
  const db = await database();
  try {
    // A manager moving a job back a stage.
    await seed(db, { division: 'construction', status: 'Permits' });
    assert.equal(await move(db, { division: 'construction', to: 'Contract', manager: true }), '');
    assert.equal(await move(db, { division: 'construction', to: 'Contract', manager: false }), 'invalid_stage_transition');
    // A move to Lost.
    assert.equal(await move(db, { division: 'construction', to: 'Lost' }), '');
    // Skipping a stage is still refused, ticked or not.
    assert.equal(await move(db, { division: 'construction', to: 'Rough-In' }), 'invalid_stage_transition');
    // A stage the company added itself has nothing to complete.
    await db.query("update public.crm_pipeline_stages set display_order = display_order + 1 where division_id='services' and display_order >= 3");
    await db.query("insert into public.crm_pipeline_stages values('co','services','Quality Review',3,true)");
    await seed(db, { division: 'services', status: 'Quality Review' });
    assert.equal(await move(db, { division: 'services', to: 'Completed' }), '');
    // A job with no lead record: order and payment are still checked, the checklist is not.
    await seed(db, { division: 'services', status: 'Request', hasLead: false });
    assert.equal(await move(db, { division: 'services', to: 'Scheduled' }), '');
  } finally { await db.close(); }
});

test('to-do 4: payment still gates Paid, and roofing is unchanged', async () => {
  const db = await database();
  try {
    await seed(db, { division: 'services', status: 'Invoiced' });
    assert.equal(await move(db, { division: 'services', to: 'Paid' }), 'full_payment_required');
    await seed(db, { division: 'services', status: 'Invoiced', job: { paidAmount: 5000 } });
    assert.equal(await move(db, { division: 'services', to: 'Paid' }), '');
    const roofingKeys = ['customer-reached', 'decision-maker', 'needs-documented', 'inspection-scheduled', 'project-path'];
    await seed(db, { division: 'roofing', status: 'Contacted' });
    assert.equal(await move(db, { division: 'roofing', to: 'Inspection' }), 'workflow_checklist_incomplete');
    await seed(db, { division: 'roofing', status: 'Contacted', contact: { ...lead, ...ticks('job1', 'Contacted', roofingKeys) } });
    assert.equal(await move(db, { division: 'roofing', to: 'Inspection' }), '');
    // Roofing still refuses a job whose lead record is missing.
    await seed(db, { division: 'roofing', status: 'Contacted', hasLead: false });
    assert.equal(await move(db, { division: 'roofing', to: 'Inspection' }), 'stage_contact_required');
    // Applying the migration twice is harmless.
    await db.exec(migration);
  } finally { await db.close(); }
});
