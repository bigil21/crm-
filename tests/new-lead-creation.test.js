const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'workflow-checklists-v65.js'), 'utf8');
function source(text, name, indent = '') {
  const match = text.match(new RegExp(`^${indent}function ${name}\\([^]*?^${indent}}`, 'm'));
  assert.ok(match, name);
  return match[0];
}
function harness(configured = []) {
  const context = vm.createContext({ state: { pipelineStages: configured }, number: Number,
    escapeHtml: String, activeDivisions: () => [], activeServices: () => [],
    FormData: class { constructor(form) { this.form = form; } get(key) { return this.form.elements[key]?.value || ''; } },
    getContact: () => null, getSelectedContact: () => null,
    canManageTeamData: () => false, jobHasFullPayment: () => true,
  });
  vm.runInContext(app.match(/const defaultPipelineStages = \{[^]*?^};/m)[0].replace('statuses.filter((status) => status !== "Lost")', '["New", "Contacted"]') +
    app.match(/const pipelineStagesFor = [^]*?^};/m)[0] +
    app.match(/const leadStatusLabel = [^\n]+/)[0] +
    source(app, 'populateDivisionFields') + source(app, 'refreshDivisionForm') +
    source(workflow, 'formIdOf', '  ') + source(workflow, 'formTransitionContext', '  ') +
    source(workflow, 'transitionCheck', '  '), context);
  return context;
}
function form(division, status = 'New') {
  return { getAttribute: () => 'contactForm', elements: { id: { value: '' },
    division: { value: division }, status: { value: status, innerHTML: '' } } };
}
for (const division of ['roofing', 'construction', 'services']) {
  test(`new ${division} lead defaults to New Lead and passes the creation guard`, () => {
    const h = harness(); const f = form(division);
    h.populateDivisionFields(f, { division, status: 'New' });
    assert.match(f.elements.status.innerHTML, /^<option value="New">New Lead<\/option>/);
    assert.equal(f.elements.status.value, 'New');
    assert.equal(h.formTransitionContext(f), null);
    h.refreshDivisionForm(f);
    assert.equal(f.elements.status.value, 'New');
    assert.equal(h.formTransitionContext(f), null);
  });
}
test('custom division pipelines retain a single New starting stage', () => {
  const h = harness([{ divisionId: 'services', name: 'Request', displayOrder: 10 },
    { divisionId: 'services', name: 'New', displayOrder: 30 }]);
  const f = form('services'); h.populateDivisionFields(f, { division: 'services' });
  assert.equal((f.elements.status.innerHTML.match(/value="New"/g) || []).length, 1);
  assert.equal(f.elements.status.value, 'New');
});
test('existing service status survives editing and division transitions keep their guards', () => {
  const h = harness(); const f = form('services', 'Request');
  h.populateDivisionFields(f, { division: 'services', status: 'Request' });
  assert.equal(f.elements.status.value, 'Request');
  const job = { division: 'services', status: 'New' };
  assert.equal(h.transitionCheck({}, job, 'Request').allowed, true);
  assert.equal(h.transitionCheck({}, job, 'Completed').allowed, false);
  assert.equal(h.transitionCheck({}, { ...job, status: 'Scheduled' }, 'Request').allowed, false);
});
test('a new lead cannot skip directly into a later workflow stage', () => {
  const h = harness(); const result = h.formTransitionContext(form('services', 'Scheduled'));
  assert.equal(result.blockedNew, true);
  assert.match(result.reason, /Choose New Lead/);
});
test('database stage configuration supports New in every division and is replay safe', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create schema if not exists public;
      create table public.crm_divisions(company_state_id text,id text);
      create table public.crm_pipeline_stages(company_state_id text,division_id text,id text,name text,
        display_order int,active boolean,updated_at timestamptz,
        primary key(company_state_id,division_id,id), unique(company_state_id,division_id,name),
        unique(company_state_id,division_id,display_order));
      insert into public.crm_divisions values ('demo','roofing'),('demo','construction'),('demo','services');
      insert into public.crm_pipeline_stages values
        ('demo','roofing','new','New',10,true,now()),
        ('demo','roofing','contacted','Contacted',20,true,now()),
        ('demo','construction','consultation','Consultation',10,true,now()),
        ('demo','services','request','Request',10,true,now());`);
    const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261106060214_universal_new_lead_stage.sql'), 'utf8');
    await db.exec(sql); await db.exec(sql);
    const result = await db.query(`select division_id,(array_agg(name order by display_order))[1] as first_stage,
      count(*) filter(where name='New' and active)::int as new_count
      from public.crm_pipeline_stages group by division_id order by division_id`);
    assert.deepEqual(result.rows.map(r => [r.division_id, r.first_stage, r.new_count]),
      [['construction', 'New', 1], ['roofing', 'New', 1], ['services', 'New', 1]]);
    assert.equal((await db.query("select count(*)::int n from public.crm_pipeline_stages where name in ('Request','Consultation','Contacted')")).rows[0].n, 3);
  } finally { await db.close(); }
});
