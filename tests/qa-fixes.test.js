// Regression tests for the issues found in the 2026-11-21/22 QA pass
// (numbers refer to JobCrest_QA_Notes.md). Functions are lifted out of app.js
// and run against small fixtures; nothing here touches a network or a real
// database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.js');
const page = read('index.html');
const styles = read('styles.css');

function functions(names, globals = {}) {
  const context = vm.createContext({ console, URL, setTimeout, clearTimeout, Intl, ...globals });
  for (const name of names) {
    const declared = app.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    // A top-level const: one line, or a block that closes at column 0.
    const constant = declared ? null : (app.match(new RegExp(`^const ${name} = [^\\n]*;$`, 'm')) ||
      app.match(new RegExp(`^const ${name} = [^]*?^[}\\]]\\)?;$`, 'm')));
    assert.ok(declared || constant, `${name} exists in app.js`);
    // `var` so the value is reachable as a property of the returned context.
    vm.runInContext(declared ? declared[0] : constant[0].replace(/^const /, 'var '), context);
  }
  return context;
}

const fakeButton = () => ({ disabled: false });
function fakeForm(buttons = [fakeButton()]) {
  return {
    dataset: {},
    resets: 0,
    reset() { this.resets += 1; },
    querySelectorAll: () => buttons,
    buttons,
  };
}

test('#52 the reports page no longer calls a function that does not exist', () => {
  assert.doesNotMatch(app, /invoiceBalance\(/);
  assert.match(app, /const due=Math\.max\(0,invoiceOutstanding\(invoice\)\)/);
});

test('#52 a screen that throws shows a message instead of blanking the page', () => {
  const banner = { textContent: '' };
  const host = { children: [], querySelector: () => host.children[0] || null, prepend(node) { host.children.unshift(node); } };
  const context = functions(['showViewRenderError', 'clearViewRenderError'], {
    els: { views: { reports: host } },
    document: { createElement: () => Object.assign(banner, { setAttribute() {}, remove() { host.children.length = 0; } }) },
  });
  context.showViewRenderError('reports', new Error('boom'));
  assert.equal(host.children.length, 1);
  assert.match(banner.textContent, /could not be fully displayed \(boom\)/);
  context.clearViewRenderError('reports');
  assert.equal(host.children.length, 0);
  assert.match(app, /try \{\s*activeRenderer\[state\.view\]\?\.\(\);\s*clearViewRenderError\(state\.view\);\s*renderPartialDataNotice\(state\.view\);\s*\} catch \(error\) \{/);
});

test('#25 an async form handler keeps its form after awaiting and cannot be double-submitted', async () => {
  const { guardedSubmit } = functions(['guardedSubmit']);
  const form = fakeForm();
  let calls = 0;
  let release;
  const handler = guardedSubmit(async (event) => {
    calls += 1;
    const captured = event.currentTarget;
    await new Promise((resolve) => { release = resolve; });
    captured.reset();
  });
  // The browser clears currentTarget once dispatch ends; model that here.
  const event = () => { const e = { currentTarget: form, prevented: 0, preventDefault() { this.prevented += 1; } }; return e; };
  const first = event();
  const running = handler(first);
  first.currentTarget = null;
  assert.equal(form.buttons[0].disabled, true, 'submit button is held while saving');
  const second = event();
  await handler(second);
  assert.equal(calls, 1, 'a second submit during the save is ignored');
  assert.equal(second.prevented, 1);
  release();
  await running;
  assert.equal(form.resets, 1);
  assert.equal(form.buttons[0].disabled, false);
  assert.equal(form.dataset.submitting, undefined);
});

test('#25 no handler reads event.currentTarget after an await', () => {
  assert.doesNotMatch(app, /event\.currentTarget\.reset\(\)/);
  for (const name of ['savePermit', 'saveInspection', 'saveSelection', 'saveChangeOrder', 'saveProgressBilling', 'saveMaintenancePlan', 'saveCustomerAccount', 'saveAccountPropertyLink', 'saveProjectMember', 'saveProjectNote', 'saveProjectDiscussion', 'saveAdminTax', 'saveAdminAnnouncement', 'inviteCustomerPortal']) {
    assert.match(app, new RegExp(`addEventListener\\("submit", guardedSubmit\\(${name}\\)\\)`), `${name} is guarded`);
  }
});

test('#25 a failed save releases the form so the user can retry', async () => {
  const { guardedSubmit } = functions(['guardedSubmit']);
  const form = fakeForm();
  const handler = guardedSubmit(async () => { throw new Error('offline'); });
  await assert.rejects(() => handler({ currentTarget: form, preventDefault() {} }), /offline/);
  assert.equal(form.buttons[0].disabled, false);
  assert.equal(form.dataset.submitting, undefined);
});

test('#58 a company library file keeps its folder when the live-sync echo arrives', () => {
  const { normalizeDocument } = functions(['normalizeDocument'], {
    COMPANY_DOCUMENT_LEAD_ID: 'company',
    JOB_PHOTO_CATEGORY_ID: 'job-photos',
    defaultDocumentCategories: [{ id: 'other', name: 'Other' }],
    categoryForLegacyName: (_name, categories) => categories.find((item) => item.id === 'other'),
    number: (value) => Number(value) || 0,
    uid: (prefix) => `${prefix}_fixture`,
  });
  const uploaded = { id: 'doc_1', name: 'W-9.pdf', folderId: 'companyfolder_custom', category: 'Subcontractor paperwork' };
  // applyDurableRealtimeRecord passes the row's lead_id, which is "company".
  const echoed = normalizeDocument(uploaded, { leadId: 'company', categoryId: '', categories: [{ id: 'other', name: 'Other' }] });
  assert.equal(echoed.folderId, 'companyfolder_custom');
  assert.equal(echoed.category, 'Subcontractor paperwork');
  assert.equal(echoed.leadId, '');
  // Rows saved while the bug was live carry leadId "company" in their data.
  assert.equal(normalizeDocument({ ...uploaded, leadId: 'company' }).folderId, 'companyfolder_custom');
  // A real lead document still follows the lead's categories.
  const leadDocument = normalizeDocument({ id: 'doc_2', name: 'Permit.pdf', category: 'Unknown', folderId: 'x' }, { leadId: 'lead_1', categories: [{ id: 'other', name: 'Other' }] });
  assert.equal(leadDocument.folderId, '');
  assert.equal(leadDocument.category, 'Other');
});

test('#58 company folders can be renamed and deleted, and removing a file asks first', () => {
  assert.match(app, /async function renameCompanyDocumentFolder\(folderId\)/);
  assert.match(app, /async function deleteCompanyDocumentFolder\(folderId\)/);
  assert.match(app, /data-action="rename-company-document-folder"/);
  assert.match(app, /data-action="delete-company-document-folder"/);
  const remove = app.match(/async function removeCompanyDocument\([^]*?^}/m)[0];
  assert.ok(remove.indexOf('appConfirm(') > 0 && remove.indexOf('appConfirm(') < remove.indexOf('archiveDocumentRecord('), 'confirmation comes before the delete');
});

test('#10 the job form is filled when a lead opens, not only after Clear', () => {
  const renderLeadJobs = app.match(/^function renderLeadJobs\(contact\) \{[^]*?^}/m)[0];
  assert.match(renderLeadJobs, /els\.leadJobForm\.dataset\.contactId !== contact\.id \|\| !els\.leadJobForm\.elements\.division\?\.options\?\.length/);
  assert.match(renderLeadJobs, /fillJobForm\(\);/);
  assert.match(app.match(/^function fillJobForm\([^]*?^}/m)[0], /els\.leadJobForm\.dataset\.contactId = contact\?\.id \|\| "";/);
});

test('#21 confirmations and prompts use the in-app dialog', async () => {
  const { openAppDialog, appConfirm, appPrompt } = functions(['openAppDialog', 'appConfirm', 'appPrompt'], {
    // No <dialog> support in this fixture: the helpers fall back to the native calls.
    document: { createElement: () => ({}) },
    window: { confirm: (text) => /Delete/.test(text), prompt: (_title, value) => `${value}!` },
  });
  assert.equal(typeof openAppDialog, 'function');
  assert.equal(await appConfirm('Delete this?', { title: 'Delete' }), true);
  assert.equal(await appConfirm('Keep this?', { title: 'Keep' }), false);
  assert.equal(await appPrompt('Rename', 'Roof'), 'Roof!');
  assert.match(styles, /\.app-dialog \{/);
});

// ---- Pipelines: checklists, stage rules, the sales board -------------------

const PIPELINES = {
  roofing: ['New', 'Contacted', 'Inspection', 'Estimate Sent', 'Won', 'Scheduled', 'Materials Ordered', 'In Progress', 'Completed', 'Paid'],
  construction: ['New', 'Consultation', 'Design & Selections', 'Estimate', 'Contract', 'Permits', 'Demo', 'Rough-In', 'Inspections', 'Finishes', 'Punch List', 'Final Walkthrough', 'Paid'],
  services: ['New', 'Request', 'Scheduled', 'Completed', 'Invoiced', 'Paid'],
};

// Loads the real workflow module with just enough of the app around it.
function workflowModule({ manager = false, estimates = [] } = {}) {
  const window = { JobCrestApp: { ready: true, replaceFunction: () => true }, RooflineProductionFlow: {}, addEventListener() {}, clearTimeout() {}, setTimeout() {} };
  const context = vm.createContext({
    console, window,
    state: { view: 'dashboard', estimates },
    els: {},
    rolePolicies: {},
    document: { querySelector: () => null, querySelectorAll: () => [], createElement: () => ({}), head: { appendChild() {} }, addEventListener() {} },
    render() {}, renderLeadDetail() {}, renderSummary() {}, updateContact() {}, applyStatusUpdate() {}, hydrateIcons() {}, applyPermissionsToDom() {},
    pipelineStagesFor: (division) => PIPELINES[division] || PIPELINES.roofing,
    canManageTeamData: () => manager,
    primaryJob: (contact) => contact.jobs?.[0],
    jobHasFullPayment: (job) => Number(job.contractValue) > 0 && Number(job.paidAmount) + 0.005 >= Number(job.contractValue),
  });
  vm.runInContext(read('workflow-checklists-v65.js'), context);
  assert.ok(window.RooflineWorkflowChecklist, 'workflow module installed');
  return window.RooflineWorkflowChecklist;
}

const ticked = (workflow, division, jobId, stages) => ({
  [jobId]: Object.fromEntries(stages.map((stage) => [stage, Object.fromEntries(
    (workflow.definitionsByDivision[division][stage] || []).filter((item) => item.mode === 'manual').map((item) => [item.id, true]),
  )])),
});

test('#29 every Construction and Home Services stage has a checklist', () => {
  const workflow = workflowModule();
  for (const division of ['construction', 'services']) {
    for (const stage of [...PIPELINES[division], 'Lost']) {
      const checklist = workflow.stageChecklist({ id: 'lead' }, { id: 'job', division, status: stage }, stage);
      assert.ok(checklist.total > 0, `${division} ${stage} has required items`);
      assert.equal(new Set(checklist.items.map((item) => item.id)).size, checklist.total, `${division} ${stage} item ids are unique`);
    }
  }
});

test('#29 a Construction job cannot advance until its stage checklist is complete', () => {
  const workflow = workflowModule();
  const job = { id: 'job', division: 'construction', status: 'Consultation' };
  const blocked = workflow.transitionCheck({ id: 'lead' }, job, 'Design & Selections');
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /Complete before moving to Design & Selections: Consultation completed/);
  const contact = { id: 'lead', workflowChecklists: ticked(workflow, 'construction', 'job', ['Consultation']) };
  assert.equal(workflow.transitionCheck(contact, job, 'Design & Selections').allowed, true);
  // Skipping a stage is still refused, with the real next stage named.
  assert.match(workflow.transitionCheck(contact, job, 'Estimate').reason, /one stage at a time\. The next stage is Design & Selections/);
});

test('#29 a Home Services job follows its own checklist from New Lead to Paid', () => {
  const workflow = workflowModule();
  const contact = { id: 'lead', name: 'Pat Example', phone: '555-0100', notes: 'Pressure wash driveway' };
  const job = { id: 'job', division: 'services', status: 'New', address: '1 Example St', contractValue: 650, paidAmount: 0 };
  assert.equal(workflow.transitionCheck({ id: 'lead', name: 'Pat Example' }, job, 'Request').allowed, false, 'phone, address and request are required first');
  assert.equal(workflow.transitionCheck(contact, job, 'Request').allowed, true);
  contact.workflowChecklists = ticked(workflow, 'services', 'job', ['Request', 'Scheduled', 'Completed']);
  for (const [from, to] of [['Request', 'Scheduled'], ['Scheduled', 'Completed'], ['Completed', 'Invoiced']]) {
    assert.equal(workflow.transitionCheck(contact, { ...job, status: from }, to).allowed, true, `${from} to ${to}`);
  }
});

test('#30 #31 the stage before Paid shows the payment requirement and enforces it', () => {
  const workflow = workflowModule();
  for (const [division, stage] of [['construction', 'Final Walkthrough'], ['services', 'Invoiced'], ['roofing', 'Completed']]) {
    const contact = { id: 'lead', workflowChecklists: ticked(workflow, division, 'job', [stage]) };
    const unpaid = { id: 'job', division, status: stage, contractValue: 1000, paidAmount: 400 };
    const item = workflow.stageChecklist(contact, unpaid, stage).items.find((entry) => entry.id === 'final-payment');
    assert.ok(item, `${division} ${stage} lists the payment requirement`);
    assert.equal(item.complete, false);
    assert.equal(workflow.transitionCheck(contact, unpaid, 'Paid').allowed, false);
    assert.equal(workflow.transitionCheck(contact, { ...unpaid, paidAmount: 1000 }, 'Paid').allowed, true);
  }
  assert.match(app, /services: \["Request", "Scheduled", "Completed", "Invoiced", "Paid"\]/);
  assert.match(read('supabase/migrations/20261122073000_home_services_paid_stage.sql'), /'paid', 'Paid'/);
});

test('#64 a manager can step a Construction job back a stage; a rep cannot', () => {
  const job = { id: 'job', division: 'construction', status: 'Paid', contractValue: 1000, paidAmount: 0 };
  assert.equal(workflowModule({ manager: true }).transitionCheck({ id: 'lead' }, job, 'Final Walkthrough').allowed, true);
  const refused = workflowModule({ manager: false }).transitionCheck({ id: 'lead' }, job, 'Final Walkthrough');
  assert.equal(refused.allowed, false);
  assert.match(refused.reason, /Ask a manager/);
  // The job form now uses the same rules instead of its own forward-only rule.
  const saveLeadJob = app.match(/^async function saveLeadJob\([^]*?^}/m)[0];
  assert.match(saveLeadJob, /RooflineWorkflowChecklist\.transitionCheck\(contact, existing, job\.status\)/);
  assert.doesNotMatch(saveLeadJob, /job\.division === "roofing"\s*\?/);
});

test('#64 removing the payment from a Paid job drops it to the stage before Paid in its own division', () => {
  const context = functions(['number', 'stageBeforePaid', 'normalizeManualPayment', 'normalizeCostItem', 'normalizeJobEmail', 'normalizeJob'], {
    pipelineStagesFor: (division) => PIPELINES[division] || PIPELINES.roofing,
    soldJobStatuses: ['Won', 'Scheduled', 'Materials Ordered', 'In Progress', 'Completed', 'Paid'],
    todayISO: () => '2026-11-22', uid: (prefix) => `${prefix}_fixture`, normalizePersonName: (value) => value || '',
  });
  const paid = (division) => context.normalizeJob({ id: 'job', division, status: 'Paid', contractValue: 1000, manualPayments: [] }, {}).status;
  assert.equal(paid('construction'), 'Final Walkthrough');
  assert.equal(paid('services'), 'Invoiced');
  assert.equal(paid('roofing'), 'Completed');
  const stillPaid = context.normalizeJob({ id: 'job', division: 'construction', status: 'Paid', contractValue: 1000, manualPayments: [{ id: 'p', amount: 1000, date: '2026-11-01' }] }, {});
  assert.equal(stillPaid.status, 'Paid');
});

const boardFunctions = () => functions(['defaultSalesPipelineStages', 'commercialApprovalStages', 'salesPipelineStagesFor', 'legacySalesStageFor', 'normalizeSalesStage', 'pipelineLifecycleStatusFor', 'pipelineBoardStages']);

test('#45 a Construction card stays in the column it was moved to', () => {
  const board = boardFunctions();
  const stage = (salesStage, status) => board.normalizeSalesStage({ salesStage, status }, {}, 'construction', 'residential');
  // Each board move sets the production stage with pipelineLifecycleStatusFor.
  for (const column of board.salesPipelineStagesFor('construction', 'residential').slice(1)) {
    const status = board.pipelineLifecycleStatusFor('construction', column, 'New');
    assert.equal(stage(column, status), column, `${column} keeps its card (production stage ${status})`);
  }
  assert.equal(stage('Contacted', 'Consultation'), 'Contacted');
  assert.equal(stage('Site Visit & Measurements', 'Design & Selections'), 'Site Visit & Measurements');
  // A job advanced from its own page still pulls the board forward.
  assert.equal(stage('Contacted', 'Estimate'), 'Proposal Sent');
  assert.equal(stage('', 'New'), 'New');
});

test('#45 roofing and services columns keep their cards too', () => {
  const board = boardFunctions();
  for (const [division, start] of [['roofing', 'New'], ['services', 'New']]) {
    for (const column of board.salesPipelineStagesFor(division, 'residential')) {
      const status = board.pipelineLifecycleStatusFor(division, column, start);
      assert.equal(board.normalizeSalesStage({ salesStage: column, status }, {}, division, 'residential'), column, `${division} ${column}`);
    }
  }
  // Handing a service job to operations no longer marks the work complete.
  assert.equal(board.pipelineLifecycleStatusFor('services', 'Operations Handoff', 'Scheduled'), 'Scheduled');
  assert.equal(board.pipelineLifecycleStatusFor('services', 'Operations Handoff', 'Invoiced'), 'Invoiced');
});

test('#46 HOA and commercial bid stages get columns whenever such an opportunity is on the board', () => {
  const board = boardFunctions();
  const residential = [{ contact: {}, job: { propertyType: 'residential' } }];
  const withHoa = [...residential, { contact: {}, job: { propertyType: 'hoa' } }];
  assert.equal(board.pipelineBoardStages('construction', 'all', residential).includes('Bid Preparation'), false);
  const columns = board.pipelineBoardStages('construction', 'all', withHoa);
  for (const stage of ['Bid Preparation', 'Bid Submitted', 'Management Review', 'Board Approval']) {
    assert.ok(columns.includes(stage), `${stage} has a column`);
    assert.equal(board.normalizeSalesStage({ salesStage: stage, status: 'Estimate', propertyType: 'hoa' }, {}, 'construction', 'hoa'), stage);
  }
  assert.ok(columns.indexOf('Board Approval') < columns.indexOf('Contract & Deposit'));
  assert.equal(board.pipelineBoardStages('services', 'all', withHoa).includes('Bid Preparation'), false);
});

test('#47 the board explains a refused drop, counts follow the filters, and Esc closes the drawer', () => {
  const mover = app.slice(app.indexOf('async function movePipelineOpportunity'), app.indexOf('function renderLeadCard'));
  assert.match(mover, /applies to commercial and HOA accounts only/);
  assert.match(mover, /salesStageExitRequirements\[division\]\?\.\[currentStage\]/);
  assert.match(app, /const attentionBaseRows = pipelineFilteredRows\(\{ ignoreAttention: true \}\);/);
  assert.match(app, /event\.key === "Escape" && state\.view === "pipeline" && state\.pipelineSelectedOpportunity/);
  // The top bar's own z-index is an inline style, so the rule needs !important.
  assert.match(page, /<header class="topbar" style="z-index: 40;/);
  assert.match(styles, /body\.pipeline-drawer-open \.topbar \{ z-index: 0 !important; \}/);
  // Marking an inspection complete must not require an estimate first.
  const { salesStageExitRequirements } = functions(['salesStageExitRequirements']);
  assert.equal(salesStageExitRequirements.roofing['Inspection Scheduled'].includes('estimate-created'), false);
});

test('#48 a refused stage change no longer discards the rest of the edit', () => {
  const guard = read('workflow-checklists-v65.js').match(/^  function guardStatusSubmit\([^]*?^  }/m)[0];
  assert.match(guard, /Your other changes were saved\./);
  // The save is only stopped after the "keep the other edits" branch has returned.
  assert.ok(guard.indexOf('Your other changes were saved.') < guard.indexOf('event.preventDefault()'));
});

test('#17 the menu highlight stays put while a lead is open', () => {
  const workflow = read('workflow-checklists-v65.js');
  assert.doesNotMatch(workflow, /routeForStatus/);
  assert.match(workflow, /let leadDetailOriginView = "leads";/);
});

// ---- One source for every company-wide number -------------------------------

test('#54 totals are never computed from a partial set of records', () => {
  const calls = [];
  const context = functions(['coreRecordsArePartial', 'dashboardDataSource', 'ledgerTotals', 'dashboardMetrics'], {
    canUseCloudSync: () => true,
    completeCoreRecordsLoaded: false,
    completeCoreRecordsAttempts: 0,
    dashboardAggregateTotals: { leads: 999 },
    financialLedgerEntries: () => { calls.push('ledger'); return []; },
    visibleContacts: () => { calls.push('contacts'); return [{ id: 'only-the-first-page' }]; },
    visibleEstimates: () => [], allJobs: () => [], contactJobs: () => [], jobHasFullPayment: () => false,
    number: (value) => Number(value) || 0,
  });
  const pending = context.dashboardMetrics();
  assert.equal(pending.pending, true);
  assert.equal(pending.source, 'pending');
  assert.equal(pending.leads, 0, 'neither the partial count nor the server total is shown as a real number');
  assert.deepEqual(calls, [], 'the partial records are not even read');
  // The summary cards show a placeholder for a pending figure.
  assert.match(app, /const shown = \(value\) => \(metrics\.pending \? "…" : value\);/);
});

test('#54 the full record set is loaded in the background on every start, and retried', () => {
  const start = app.slice(app.indexOf('async function startApp()'));
  assert.match(start, /render\(\);[^]*?if \(canUseCloudSync\(\)\) void ensureCompleteCoreRecordsLoaded\(\);/);
  const loader = app.slice(app.indexOf('async function ensureCompleteCoreRecordsLoaded()'), app.indexOf('function coreRecordsArePartial()'));
  assert.match(loader, /if \(!loaded\) scheduleCompleteCoreRecordsRetry\(\);/);
  assert.match(loader, /renderDurableUpdateWhenIdle\(\);/);
  // Billing and the dashboard are among the screens that need everything.
  assert.match(app, /function viewNeedsCompleteCoreRecords[\s\S]*?"dashboard", "invoices"/);
  // Refreshing server totals no longer blanks them first.
  const invalidate = app.match(/^function invalidateServerRecordPages\(\) \{[^]*?^}/m)[0];
  assert.doesNotMatch(invalidate, /dashboardAggregateTotals = null/);
});

test('#1 #70 the dashboard, Billing and Reports read money from one ledger', () => {
  const entries = [
    { kind: 'Payment', amount: 42000, at: '2026-10-05' }, // recorded on a job
    { kind: 'Payment', amount: 1000, at: '2026-11-02T12:00:00' }, // recorded on an invoice
    { kind: 'Refund', amount: 250, at: '2026-11-10' },
    { kind: 'Expense', amount: 9000, at: '2026-10-20' },
    { kind: 'Credit', amount: 100, at: '2026-11-01' },
    { kind: 'Invoice', amount: 5000, at: '2026-11-01' },
  ];
  const context = functions(['ledgerTotals', 'collectedByMonth'], {
    number: (value) => Number(value) || 0,
    financialLedgerEntries: () => entries,
    activityTimestamp: (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`).getTime() : Date.parse(value)),
  });
  assert.deepEqual({ ...context.ledgerTotals() }, { payments: 43000, refunds: 250, collected: 42750, expenses: 9000, credits: 100 });
  const months = context.collectedByMonth([{ year: 2026, month: 9, value: 0 }, { year: 2026, month: 10, value: 0 }]);
  assert.deepEqual(months.map((month) => month.value), [42000, 750], 'each payment counts in the month it was received');
  // All three screens use it.
  assert.match(app.match(/^function dashboardMetrics\(\) \{[^]*?^}/m)[0], /closedValue: ledgerTotals\(\)\.collected/);
  assert.match(app.match(/^function renderInvoicesView\(\) \{[^]*?^}/m)[0], /const ledger = ledgerTotals\(ledgerEntries\);/);
  const reports = app.match(/^function renderReportsView\(\) \{[^]*?^}/m)[0];
  assert.match(reports, /const ledger = ledgerTotals\(ledgerEntries\);/);
  assert.doesNotMatch(reports, /state\.financialPayments\.reduce/);
});

test('#1 the legacy script no longer replaces the dashboard with its own copy', () => {
  const legacy = read('production-flow-v64.js');
  for (const name of ['dashboardMetrics', 'renderSummary', 'renderDashboard', 'renderRevenueOverview', 'renderDashboardDonuts', 'renderProjectsView', 'renderReviewsView']) {
    assert.doesNotMatch(legacy, new RegExp(`assignGlobal\\("${name}"`), name);
  }
  // Dead code that would have reset every Construction stage to New Lead is gone.
  assert.doesNotMatch(legacy, /normalizeProductionState/);
  // The Pipeline Value card and the pipeline widget's total are the same figure.
  assert.match(app.match(/^function renderPipelineOverview\(\) \{[^]*?^}/m)[0], /const totalValue = dashboardMetrics\(\)\.pipelineValue;/);
});

test('#55 a job\'s type is its service, in every division', () => {
  const { jobType, topGroupsWithOther } = functions(['jobType', 'topGroupsWithOther'], {
    state: { services: [] },
    number: (value) => Number(value) || 0,
    activeDivisions: () => [{ id: 'roofing', name: 'Roofing' }, { id: 'construction', name: 'Construction' }, { id: 'services', name: 'Home Services' }],
    defaultServices: [
      { id: 'roof-replacement', divisionId: 'roofing', name: 'Roof Replacement' },
      { id: 'remodel-addition', divisionId: 'construction', name: 'Remodel / Addition' },
      { id: 'pressure-washing', divisionId: 'services', name: 'Pressure Washing' },
    ],
  });
  assert.equal(jobType({ division: 'construction', service: 'remodel-addition', name: 'Kitchen' }), 'Remodel / Addition');
  assert.equal(jobType({ division: 'services', service: 'pressure-washing', name: 'Driveway' }), 'Pressure Washing');
  assert.equal(jobType({ division: 'roofing', service: 'roof-replacement', name: 'Storm repair' }), 'Roof Replacement');
  assert.equal(jobType({ division: 'construction', service: '' }), 'Construction (no service chosen)');
  const groups = topGroupsWithOther([1, 2, 3, 4, 5, 6, 7].map((count) => ({ label: `g${count}`, count, value: 0 })), 5);
  assert.equal(groups.length, 5);
  assert.deepEqual({ ...groups.at(-1) }, { label: 'Other', count: 5 + 6 + 7, value: 0 });
});

const phaseFunctions = () => functions(['soldStageStartByDivision', 'jobLifecyclePhase', 'jobIsInProduction', 'jobIsSold', 'jobIsOpen', 'deliveredStageByDivision', 'jobIsDelivered'], {
  pipelineStagesFor: (division) => PIPELINES[division] || PIPELINES.roofing,
  soldJobStatuses: ['Won', 'Scheduled', 'Materials Ordered', 'In Progress', 'Completed', 'Paid'],
});

test('#32 #41 sold, in production, closed and open mean the same thing in every division', () => {
  const phases = phaseFunctions();
  const phase = (division, status) => phases.jobLifecyclePhase({ division, status });
  assert.equal(phase('roofing', 'Estimate Sent'), 'sales');
  assert.equal(phase('roofing', 'Won'), 'production');
  assert.equal(phase('roofing', 'Completed'), 'production');
  assert.equal(phase('construction', 'Estimate'), 'sales');
  assert.equal(phase('construction', 'Contract'), 'production');
  assert.equal(phase('construction', 'Final Walkthrough'), 'production');
  assert.equal(phase('services', 'Request'), 'sales');
  assert.equal(phase('services', 'Invoiced'), 'production', 'an invoiced service job is still owed money');
  for (const division of ['roofing', 'construction', 'services']) {
    assert.equal(phase(division, 'Paid'), 'closed');
    assert.equal(phase(division, 'Lost'), 'lost');
  }
  // The lead header: one job at Won is open; Paid, Paid, Invoiced is one open job.
  assert.equal([{ division: 'roofing', status: 'Won' }].filter(phases.jobIsOpen).length, 1);
  assert.equal([{ division: 'roofing', status: 'Paid' }, { division: 'construction', status: 'Paid' }, { division: 'services', status: 'Invoiced' }].filter(phases.jobIsOpen).length, 1);
  // The Sold Jobs screen lists the invoiced service job and keeps paid jobs apart.
  const projects = app.match(/^function renderProjectsView\(\) \{[^]*?^}/m)[0];
  assert.match(projects, /const soldJobs = allJobs\(\)\.filter\(jobIsSold\);/);
  assert.match(projects, /const production = inDivision\.filter\(jobIsInProduction\);/);
});

test('#44 review requests are only offered once the work is delivered, and are remembered', () => {
  const phases = phaseFunctions();
  const delivered = (division, status) => phases.jobIsDelivered({ division, status });
  assert.equal(delivered('roofing', 'In Progress'), false);
  assert.equal(delivered('roofing', 'Completed'), true);
  assert.equal(delivered('construction', 'Punch List'), false);
  assert.equal(delivered('construction', 'Final Walkthrough'), true);
  assert.equal(delivered('services', 'Scheduled'), false);
  assert.equal(delivered('services', 'Invoiced'), true);
  assert.equal(delivered('roofing', 'Lost'), false);
  const reviews = app.match(/^function renderReviewsView\(\) \{[^]*?^}/m)[0];
  assert.match(reviews, /contactJobs\(contact\)\.filter\(jobIsDelivered\)/);
  assert.match(reviews, /reviewRequestedAt/);
  assert.match(app, /function markReviewRequested\(contactId, jobId\)/);
});

test('#43 #42 a job\'s own payments count against its invoices, and "owed" is what invoices show', () => {
  const job = { id: 'job', paidAmount: 42000 };
  const context = functions(['invoiceCreditTotal', 'jobPaymentsAppliedToInvoice', 'invoiceOutstanding'], {
    number: (value) => Number(value) || 0,
    activityTimestamp: (value) => Date.parse(value),
    contactJobs: (contact) => contact.jobs,
    state: {
      contacts: [{ id: 'lead', jobs: [job] }],
      creditNotes: [],
      invoices: [],
    },
  });
  const invoice = (id, totalAmount, issueDate, extra = {}) => ({ id, contactId: 'lead', jobId: 'job', totalAmount, amountPaid: 0, issueDate, status: 'draft', ...extra });
  // The QA case: job paid in full, its draw invoice still showed $12,600 owed.
  const draw = invoice('draw', 12600, '2026-11-01');
  context.state.invoices = [draw];
  assert.equal(context.invoiceOutstanding(draw), 0);
  // Payments cover the oldest invoices first; the rest is still owed.
  job.paidAmount = 15000;
  const first = invoice('first', 12600, '2026-11-01');
  const second = invoice('second', 10000, '2026-11-10');
  context.state.invoices = [second, first];
  assert.equal(context.invoiceOutstanding(first), 0);
  assert.equal(context.invoiceOutstanding(second), 7600);
  // A payment recorded on the invoice itself still counts, and a void invoice owes nothing.
  assert.equal(context.invoiceOutstanding({ ...second, amountPaid: 600 }), 7000);
  assert.equal(context.invoiceOutstanding({ ...second, status: 'void' }), 0);
  const billing = app.match(/^function renderInvoicesView\(\) \{[^]*?^}/m)[0];
  assert.match(billing, /reduce\(\(sum, invoice\) => sum \+ invoiceOutstanding\(invoice\), 0\)/);
  assert.match(billing, /estimate\.status === "Won" \|\| estimate\.squareInvoiceId \|\| internalInvoiceForEstimate\(estimate\.id\)/);
});

test('#53 an invoice can be voided, names its job, and opens that job', () => {
  assert.match(app, /async function voidInvoice\(invoiceId\)/);
  const billing = app.match(/^function renderInvoicesView\(\) \{[^]*?^}/m)[0];
  assert.match(billing, /data-void-invoice=/);
  assert.match(billing, /data-action="open-job" data-contact-id="\$\{escapeHtml\(invoice\.contactId\)\}" data-job-id="\$\{escapeHtml\(invoice\.jobId \|\| ""\)\}"/);
  assert.match(billing, /escapeHtml\(invoiceJob\.name\)/);
});

test('#39 hand-typed lead sources are grouped', () => {
  const { leadSourceLabel } = functions(['leadSourceLabel']);
  for (const typed of ['REFERRAL', 'Referral', 'Refferal', 'Refferral', 'referral', ' referral ']) assert.equal(leadSourceLabel(typed), 'Referral', typed);
  assert.equal(leadSourceLabel('google ads'), 'Google Ads');
  assert.equal(leadSourceLabel('HOA'), 'HOA');
  assert.equal(leadSourceLabel(''), 'No source');
});

// ---- Dates, authors, estimates, contacts, tasks, storage, sign-in -----------

const localTimestamp = (value) => {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`).getTime() : Date.parse(text);
};

test('#8 #36 a date with no time is shown as that day, never the evening before', () => {
  const { formatDateTime, activityTimestamp } = functions(['formatDate', 'formatDateTime', 'activityTimestamp'], { localTimestamp });
  // new Date("2026-11-21") is midnight UTC, which is 7 PM on Nov 20 in Florida.
  assert.equal(formatDateTime('2026-11-21'), 'Nov 21, 2026');
  assert.match(formatDateTime('2026-11-21T21:28:00'), /^Nov 21, 2026, 9:28\sPM$/);
  assert.equal(new Date(activityTimestamp('2026-11-21')).getDate(), 21);
  // New leads and jobs keep the exact moment for the timeline.
  assert.match(app, /createdAt: todayISO\(\), createdTimestamp: new Date\(\)\.toISOString\(\)/);
  assert.match(app, /at: createdMoment\(contact\),/);
});

test('#9 lead numbers use the company calendar day, not the UTC day', async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create function public.crm_reserve_sales_numbers(p_company text,p_lead_id text,p_job_id text default null,p_estimate_id text default null) returns jsonb
      language plpgsql as $$
      declare day_scope text:=to_char(clock_timestamp() at time zone 'UTC','YYYYMMDD');
      begin return jsonb_build_object('leadNumber','LD-'||day_scope||'-000001'); end; $$;`);
    const migration = read('supabase/migrations/20261122074500_sales_numbers_use_company_time_zone.sql');
    await db.exec(migration);
    await db.exec(migration);
    const definition = (await db.query("select pg_get_functiondef('public.crm_reserve_sales_numbers(text,text,text,text)'::regprocedure) def")).rows[0].def;
    assert.match(definition, /at time zone public\.crm_company_time_zone\(\)/);
    assert.doesNotMatch(definition, /at time zone 'UTC'/);
    // 9:28 PM on Nov 21 in Florida is already Nov 22 in UTC.
    const day = await db.query("select to_char(timestamptz '2026-11-22 02:28:00+00' at time zone public.crm_company_time_zone(),'YYYYMMDD') local_day");
    assert.equal(day.rows[0].local_day, '20261121');
    assert.match((await db.query("select public.crm_reserve_sales_numbers('c','l') result")).rows[0].result.leadNumber, /^LD-\d{8}-000001$/);
  } finally {
    await db.close();
  }
});

test('#22 #28 #36 one person appears under one name', () => {
  const owners = new Map([['u1', { userId: 'u1', email: 'gil@example.com', name: 'Gilberto Arellano' }]]);
  const context = functions(['normalizePersonName', 'actorDisplayName', 'currentActorName'], {
    cloudKnownOwners: owners,
    currentOwner: () => ({ userId: 'u2', email: 'pat.lee@example.com', name: 'pat.lee@example.com' }),
    state: { currentUser: { name: '', email: 'gil@example.com' } },
  });
  assert.equal(context.actorDisplayName('gil@example.com'), 'Gilberto Arellano');
  assert.equal(context.actorDisplayName('GIL@example.com'), 'Gilberto Arellano');
  assert.equal(context.actorDisplayName('pat.lee@example.com'), 'Pat Lee', 'no saved name: a readable name, never the raw address');
  assert.equal(context.actorDisplayName('Priya Shah'), 'Priya Shah');
  assert.equal(context.currentActorName(), 'Gilberto Arellano');
  // Changes are credited to the person making them, and never to "Local user".
  assert.doesNotMatch(app, /author: job\.salesRep \|\| "Local user"/);
  assert.doesNotMatch(app, /uploadedBy: state\.currentUser\.name \|\| state\.currentUser\.email \|\| "Local user"/);
});

test('#11 #12 #13 estimates: no stray blank drafts, no instruction text, wording by division', () => {
  const context = functions(['ESTIMATE_PLACEHOLDER_DESCRIPTION', 'isPlaceholderEstimateItem', 'printableEstimateItems', 'estimateDivisionWording', 'estimateWordingFor', 'estimateIsUntouchedDraft', 'estimateTemplates'], {
    number: (value) => Number(value) || 0,
    totalsFor: (estimate) => ({ total: (estimate.items || []).reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.rate || 0), 0) }),
  });
  const starter = { title: 'Roofing scope', description: context.ESTIMATE_PLACEHOLDER_DESCRIPTION, quantity: 1, rate: 0 };
  const real = { title: 'Shingles', description: 'Architectural', quantity: 20, rate: 420 };
  assert.equal(context.isPlaceholderEstimateItem(starter), true);
  assert.equal(context.isPlaceholderEstimateItem({ ...starter, rate: 100 }), false, 'a priced line is real work');
  assert.deepEqual(context.printableEstimateItems({ items: [starter, real] }).map((item) => item.title), ['Shingles']);
  assert.equal(context.estimateIsUntouchedDraft({ status: 'Draft', items: [starter] }), true);
  assert.equal(context.estimateIsUntouchedDraft({ status: 'Draft', items: [starter, real] }), false);
  assert.equal(context.estimateIsUntouchedDraft({ status: 'Sent', items: [starter] }), false);
  assert.equal(context.estimateWordingFor('roofing').label, 'ROOFING ESTIMATE');
  assert.equal(context.estimateWordingFor('construction').label, 'CONSTRUCTION ESTIMATE');
  assert.equal(context.estimateWordingFor('services').label, 'SERVICE ESTIMATE');
  for (const division of ['construction', 'services']) {
    assert.ok(context.estimateTemplates.some((template) => template.division === division), `${division} has templates`);
  }
  const create = app.match(/^async function createEstimate\([^]*?^}/m)[0];
  assert.match(create, /const untouched = existing\.find\(estimateIsUntouchedDraft\);/);
  assert.match(create, /extraLabel: "Create a new estimate"/);
  // Applying a template replaces the starter line, and the printed copy never shows it.
  assert.match(app, /estimate\.items\.filter\(\(item\) => !isPlaceholderEstimateItem\(item\)\), \.\.\.tpl\.items/);
  assert.match(app, /printableEstimateItems\(estimate\)\.forEach\(\(item\) => \{/);
});

test('#14 #62 #23 the estimate PDF is compressed, lists the deposit after the total, and names the job', () => {
  assert.match(app, /new JsPdf\(\{ unit: "pt", format: "letter", compress: true \}\)/);
  assert.match(app, /await downscaleImageDataUrl\(await companyLogoDataUrlForPdf\(company\)\)/);
  const rows = app.slice(app.indexOf('const totalRows = ['), app.indexOf('totalRows.forEach'));
  assert.ok(rows.indexOf('"Total"') < rows.indexOf('"Deposit due at signing"'));
  const { estimateFileName } = functions(['estimateFileName'], {
    getSelectedEstimate: () => null,
    getEstimateContact: () => ({ name: 'Jordan Blake' }),
    getEstimateJob: () => ({ name: 'Pool cage rescreen' }),
  });
  assert.equal(estimateFileName({ estimateNumber: 'EST-1093' }), 'est-1093-jordan-blake-pool-cage-rescreen.pdf');
});

test('#15 #16 Estimate Sent needs a sent estimate, and a sold job is reconciled with it', () => {
  const draft = [{ contactId: 'lead', jobId: 'job', status: 'Draft' }];
  const workflow = workflowModule({ estimates: draft });
  const contact = { id: 'lead', jobs: [{ id: 'job' }] };
  const job = { id: 'job', division: 'roofing', status: 'Inspection' };
  contact.workflowChecklists = ticked(workflow, 'roofing', 'job', ['Inspection']);
  const blocked = workflow.transitionCheck(contact, job, 'Estimate Sent');
  assert.equal(blocked.allowed, false);
  assert.match(blocked.reason, /still a draft/);
  draft[0].status = 'Sent';
  assert.equal(workflow.transitionCheck(contact, job, 'Estimate Sent').allowed, true);
  assert.match(app, /async function reconcileSoldJobWithEstimate\(contactId, jobId\)/);
  assert.match(app, /Which is the agreed contract value\?/);
});

test('#19 #51 #67 estimates list newest first; estimate numbers are searchable; exact matches rank first', () => {
  const { estimateSequence } = functions(['estimateSequence']);
  const sorted = [{ estimateNumber: 'EST-1053' }, { estimateNumber: 'EST-1093' }, { estimateNumber: 'EST-1067' }].sort((a, b) => estimateSequence(b) - estimateSequence(a));
  assert.deepEqual(sorted.map((item) => item.estimateNumber), ['EST-1093', 'EST-1067', 'EST-1053']);
  const contacts = [
    { id: 'partial', name: 'Annapat Leery', email: 'other@example.com', phone: '' },
    { id: 'exact', name: 'Zed Other', email: 'pat.lee@example.com', phone: '' },
    { id: 'estimate', name: 'Quinn Roof', email: '', phone: '' },
  ];
  const context = functions(['normalizeLeadSearch', 'contactSearchFields', 'contactMatchesSearch', 'liveLeadSearchMatches'], {
    state: { search: '', estimates: [{ contactId: 'estimate', estimateNumber: 'EST-1093' }] },
    visibleContacts: () => contacts, contactJobs: () => [], number: (value) => Number(value) || 0,
    money: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
  });
  assert.equal(context.liveLeadSearchMatches('pat.lee@example.com').matches[0].id, 'exact');
  assert.deepEqual(context.liveLeadSearchMatches('EST-1093').matches.map((item) => item.id), ['estimate']);
});

test('#39 #38 duplicates are detected by phone, email, or name and address', () => {
  const context = functions(['formatPhoneNumber', 'displayPhone', 'normalizeLeadSearch', 'contactIdentityKeys', 'findDuplicateContacts', 'duplicateContactIds'], { state: { contacts: [] } });
  const existing = [
    { id: 'a', name: 'Linda Mykitiak', phone: '(239) 351-6922', email: 'linda@example.com', address: '12 Bay St\nNaples' },
    { id: 'b', name: 'John Pileski', phone: '', email: '', address: '9 Gulf Rd' },
    { id: 'c', name: 'Someone Else', phone: '5550100', email: '', address: '' },
  ];
  assert.deepEqual(context.findDuplicateContacts({ id: 'new', phone: '239-351-6922' }, existing).map((item) => item.id), ['a']);
  assert.deepEqual(context.findDuplicateContacts({ id: 'new', email: 'LINDA@example.com' }, existing).map((item) => item.id), ['a']);
  assert.deepEqual(context.findDuplicateContacts({ id: 'new', name: 'john pileski', address: '9 Gulf Rd.' }, existing).map((item) => item.id), ['b']);
  assert.equal(context.findDuplicateContacts({ id: 'new', name: 'John Pileski' }, existing).length, 0, 'a shared name alone is not a duplicate');
  assert.deepEqual([...context.duplicateContactIds([...existing, { id: 'd', name: 'L. M.', phone: '2393516922' }])].sort(), ['a', 'd']);
  // #4 a number stored without punctuation is shown like the others.
  assert.equal(context.displayPhone('2393516922'), '(239) 351-6922');
  assert.equal(context.displayPhone('ext 14'), 'ext 14');
  assert.match(app.match(/^async function saveContactFromForm\([^]*?^}/m)[0], /title: "This may be a duplicate"/);
});

test('#49 #65 deleting a lead returns to the list; a lead with payments is archived, not deleted', () => {
  const remove = app.match(/^async function deleteContact\([^]*?^}/m)[0];
  assert.match(remove, /state\.selectedContactId = null;/);
  assert.doesNotMatch(remove, /state\.selectedContactId = state\.contacts\[0\]/);
  assert.match(remove, /if \(state\.view === "leadDetail"\) state\.view = canView\("leads"\) \? "leads" : firstAllowedView\(\);/);
  assert.match(remove, /await setContactArchived\(contactId, true\);/);
  const { visibleContacts, archivedContacts } = functions(['visibleContacts', 'archivedContacts'], {
    state: { contacts: [{ id: 'kept' }, { id: 'put-away', archived: true }] },
    recordOwnedByCurrentUser: () => true,
  });
  assert.deepEqual(visibleContacts().map((item) => item.id), ['kept']);
  assert.deepEqual(archivedContacts().map((item) => item.id), ['put-away']);
});

test('#57 repeating tasks roll forward to a future date; tasks can be reopened; delete asks first', () => {
  const { nextRecurrenceDate } = functions(['nextRecurrenceDate']);
  const now = new Date('2026-11-22T15:00:00');
  // A daily task overdue since Oct 27 lands on tomorrow, not Oct 28.
  assert.equal(nextRecurrenceDate('2026-10-27T09:00:00', 'daily', now).toISOString().slice(0, 10), new Date('2026-11-23T09:00:00').toISOString().slice(0, 10));
  assert.ok(nextRecurrenceDate('2026-10-27T09:00:00', 'weekly', now) > now);
  assert.ok(nextRecurrenceDate('2026-11-25T09:00:00', 'monthly', now) > new Date('2026-12-20'));
  assert.match(app, /data-action="reopen-calendar-task"/);
  const remove = app.match(/^async function deleteCalendarTask\([^]*?^}/m)[0];
  assert.ok(remove.indexOf('appConfirm(') > 0 && remove.indexOf('appConfirm(') < remove.indexOf('removeCalendarTaskFromGoogle('));
});

test('#21 #33 #66 nothing uses the browser\'s native confirm or prompt any more', () => {
  const withoutFallback = app.replace(/^function openAppDialog\([^]*?^}/m, '').replace(/^\/\/ In-app replacements[^\n]*\n/m, '');
  assert.doesNotMatch(withoutFallback, /window\.(confirm|prompt)\(/);
  assert.match(app.match(/^async function saveManualPayment\([^]*?^}/m)[0], /title: "Payment is more than the balance"/);
  assert.match(app.match(/^async function deleteCostItem\([^]*?^}/m)[0], /title: "Delete cost"/);
});

test('#37 a customer email cannot be sent with template placeholder text in it', () => {
  const { EMAIL_PLACEHOLDER_PATTERN } = functions(['EMAIL_PLACEHOLDER_PATTERN']);
  assert.match('Here is an update.\n\n[Add the current production status here.]', EMAIL_PLACEHOLDER_PATTERN);
  assert.match('Review: [Add review link]', EMAIL_PLACEHOLDER_PATTERN);
  assert.doesNotMatch('The crew arrives Monday [weather permitting].', EMAIL_PLACEHOLDER_PATTERN);
  assert.match(app.match(/^async function submitLeadEmail\([^]*?^}/m)[0], /EMAIL_PLACEHOLDER_PATTERN/);
  // The subject uses the job's name, not the internal job number.
  assert.match(app, /const projectLabel = job\?\.name \|\| "your project";/);
});

test('#56 inspections, permit expirations and billing draws appear with the calendar', () => {
  const contact = { id: 'lead', name: 'Jordan Blake' };
  const { calendarJobDates } = functions(['operationValue', 'calendarJobDates'], {
    localTimestamp, getContact: () => contact, contactJobs: () => [{ id: 'job', name: 'Reroof' }],
    number: (value) => Number(value) || 0, money: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
    state: {
      inspections: [{ lead_id: 'lead', job_id: 'job', inspection_type: 'Final', scheduled_at: '2026-11-25T10:00:00', result: 'scheduled' },
        { lead_id: 'lead', job_id: 'job', inspection_type: 'Dry-in', scheduled_at: '2026-11-24T10:00:00', result: 'passed' }],
      permits: [{ lead_id: 'lead', job_id: 'job', permit_type: 'Roofing', permit_number: 'B-1', expires_on: '2026-12-15', status: 'approved' }],
      progressBillings: [{ lead_id: 'lead', job_id: 'job', name: 'Deposit', amount: 5000, due_on: '2026-11-20', status: 'planned' },
        { lead_id: 'lead', job_id: 'job', name: 'Far away', amount: 1, due_on: '2027-06-01', status: 'planned' }],
    },
  });
  const items = Array.from(calendarJobDates(new Date('2026-11-22T12:00:00')));
  assert.deepEqual(items.map((item) => item.kind), ['Billing draw due', 'Inspection', 'Permit expires']);
  assert.equal(items[0].overdue, true);
  assert.equal(items[1].title, 'Final');
});

test('#60 #40 #34 header badges, page titles and the menu', () => {
  assert.match(app, /document\.querySelectorAll\("\.notification-button \.notification-dot"\)/);
  assert.match(app, /projects: "Sold Jobs & Production",/);
  assert.match(app, /invoices: "Billing & Payments",/);
  const workflow = read('workflow-checklists-v65.js');
  assert.doesNotMatch(workflow, /Inspections & Jobs|Reviews & Referrals/);
  assert.match(styles, /\.nav-list:not\(\[data-workflow-navigation\]\) \{\s*visibility: hidden;/);
});

test('#2 #3 #63 recovery copies are bounded and the daily backup is complete and not re-sent', () => {
  const { pruneBlockedSaveRecoveries } = functions(['pruneBlockedSaveRecoveries']);
  const now = Date.parse('2026-11-22T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  const items = new Map();
  for (let index = 0; index < 8; index += 1) items.set(`jobcrest-unsaved-recovery:user:${index}`, JSON.stringify({ createdAt: new Date(now - index * day).toISOString() }));
  items.set('jobcrest-unsaved-recovery:user:old', JSON.stringify({ createdAt: new Date(now - 45 * day).toISOString() }));
  items.set('roofline-crm-v1:user', '{}');
  const storage = { get length() { return items.size; }, key: (index) => [...items.keys()][index], getItem: (key) => items.get(key), removeItem: (key) => items.delete(key) };
  assert.equal(pruneBlockedSaveRecoveries(storage, now), 4);
  assert.equal([...items.keys()].filter((key) => key.startsWith('jobcrest-unsaved-recovery:')).length, 5);
  assert.ok(items.has('roofline-crm-v1:user'), 'nothing else is touched');
  const backup = app.match(/^async function createDailyRecoveryBackup\(\) \{[^]*?^}/m)[0];
  // The backup reads every record type itself: the paged loader holds only the
  // first 100 leads and jobs, and the workspace snapshot leaves out documents.
  const readsEverything = 'fetchAllCompanyRows(SUPABASE_RECORDS_TABLE, ["record_type", "id"])';
  assert.ok(backup.includes(readsEverything), 'every record type is read, with no record_type filter');
  assert.doesNotMatch(backup, /await fetchDurableRows\(\)/);
  assert.doesNotMatch(backup, /fetchCompleteDurableSnapshot\(\)/);
  assert.ok(backup.indexOf('.eq("backup_date", todayISO())') < backup.indexOf(readsEverything));
});

test('#68 #69 a failed approval check is reported as an outage, never as "not approved"', () => {
  const auth = read('auth.js');
  const login = read('login.js');
  assert.match(auth, /accessCheckFailed: true/);
  assert.match(auth, /if \(auth\.accessCheckFailed\) \{[^]*?loginUrl\("unavailable"\)/);
  const check = login.match(/async function verifySignedInEmail\([^]*?^  }/m)[0];
  // The outage branch comes first and does not sign the user out.
  assert.ok(check.indexOf('trusted.accessCheckFailed') < check.indexOf('trusted.accessDenied'));
  assert.doesNotMatch(check.slice(check.indexOf('trusted.accessCheckFailed'), check.indexOf('trusted.error || trusted.accessDenied')), /signOutCurrentSession/);
  assert.match(login, /could not confirm your access because the service is not responding/);
});

// ---- The last open items: thumbnails, save indicator, numbering, operations --

test('#24 a photo thumbnail loads eagerly, because a hidden lazy image never loads', async () => {
  // The <img> is hidden until it has loaded. With loading="lazy" a hidden image
  // is never requested, so the placeholder stayed forever.
  assert.doesNotMatch(app.match(/^function renderLeadPhotos\(contact\) \{[^]*?^}/m)[0], /loading="lazy"/);
  const listeners = {};
  const placeholder = { classList: { add(name) { placeholder.hidden = name === 'hidden'; }, remove() { placeholder.hidden = false; } } };
  const image = {
    dataset: {}, isConnected: true, loading: 'lazy', src: '', hidden: true,
    classList: { add() { image.hidden = true; }, remove() { image.hidden = false; } },
    addEventListener: (type, handler) => { listeners[type] = handler; },
    closest: () => ({ querySelector: () => placeholder }),
  };
  const { showLeadPhotoPreview } = functions(['showLeadPhotoPreview'], { managedPhotoPreviewUrl: async (photo) => `signed:${photo.id}` });
  assert.equal(await showLeadPhotoPreview(image, { id: 'photo-1' }), true);
  assert.equal(image.loading, 'eager');
  assert.equal(image.src, 'signed:photo-1');
  assert.equal(image.hidden, true, 'still hidden until the browser reports it loaded');
  listeners.load();
  assert.equal(image.hidden, false);
  assert.equal(placeholder.hidden, true);
  // A second request for the same card is ignored.
  assert.equal(await showLeadPhotoPreview(image, { id: 'photo-1' }), false);
});

test('#35 the top bar says whether work is saved', () => {
  const globals = {
    canUseCloudSync: () => true, durableWriteBlocked: false, localStateWriteBlocked: false, durableRecordsReady: true,
    durableSaveInFlight: false, cloudSaveInFlight: false, hasPendingDurableChanges: () => false, hasPendingCompanyChanges: () => false,
    navigator: { onLine: true }, state: { companyFormDraft: null }, saveIndicatorPendingSince: 0,
  };
  const context = functions(['saveIndicatorStatus'], globals);
  const label = (changes = {}, now = 1000) => { Object.assign(context, changes); return context.saveIndicatorStatus(now).label; };
  assert.equal(label(), 'All changes saved');
  assert.equal(label({ durableSaveInFlight: true }, 1000), 'Saving…');
  assert.equal(label({}, 30000), 'Still saving…', 'a save that has not finished after 20 seconds says so');
  assert.equal(label({ navigator: { onLine: false } }, 30000), 'Offline · not saved yet');
  assert.equal(label({ durableSaveInFlight: false, navigator: { onLine: true } }), 'All changes saved');
  assert.equal(label({ hasPendingDurableChanges: () => true }, 5000), 'Saving…', 'a queued change counts as not yet saved');
  assert.equal(label({ hasPendingDurableChanges: () => false, durableWriteBlocked: true }), 'Saving paused');
  assert.equal(label({ durableWriteBlocked: false, canUseCloudSync: () => false }), 'Saved on this device');
  assert.match(page, /id="saveIndicator" role="status"/);
  assert.match(app, /startSaveIndicator\(\);/);
});

test('#5 a job sold without an estimate is numbered when it is sold', async () => {
  const calls = [];
  const contact = { id: 'lead', leadNumber: '', jobs: [{ id: 'job', projectNumber: '', division: 'services', status: 'Scheduled' }] };
  const context = functions(['soldStageStartByDivision', 'ensureSoldJobNumbered', 'afterJobStageChange'], {
    getContact: () => contact, contactJobs: (value) => value.jobs || [],
    canUseCloudSync: () => true,
    reserveSharedSalesNumbers: async (leadId, jobId) => { calls.push(`reserve:${leadId}:${jobId}`); contact.leadNumber = 'LD-20261122-000001'; contact.jobs[0].projectNumber = 'LD-20261122-000001-P01'; },
    ensureLeadProjectNumbers: () => { throw new Error('cloud numbering must be used when signed in'); },
    saveState: () => calls.push('saved'), queueDurableRecordsSave: () => calls.push('queued'), renderLeadDetail() {},
    state: { view: 'pipeline' }, reconcileSoldJobWithEstimate: async () => calls.push('reconcile'), recordLostReason: async () => calls.push('lost'),
  });
  await context.afterJobStageChange('lead', 'job', 'Request', 'Scheduled');
  assert.deepEqual(calls, ['reserve:lead:job', 'saved', 'queued', 'reconcile']);
  // Already numbered: nothing is reserved again.
  calls.length = 0;
  await context.afterJobStageChange('lead', 'job', 'Request', 'Scheduled');
  assert.deepEqual(calls, ['reconcile']);
  // A stage that is not the sale does nothing; Lost asks for the reason.
  calls.length = 0;
  await context.afterJobStageChange('lead', 'job', 'Scheduled', 'Completed');
  await context.afterJobStageChange('lead', 'job', 'Scheduled', 'Lost');
  assert.deepEqual(calls, ['lost']);
});

test('#27 mistaken permits, inspections and selections can be deleted; money records cannot', async () => {
  const deleted = [];
  const state = { permits: [{ id: 'p1' }, { id: 'p2' }], changeOrders: [{ id: 'c1' }] };
  const table = (rows) => ({ delete: () => ({ eq: () => ({ eq: (_column, id) => ({ select: async () => { deleted.push(id); return { data: rows, error: null }; } }) }) }) });
  const context = functions(['deletableOperationTables', 'deleteJobOperation'], {
    operationsTableStateMap: { crm_permits: 'permits', crm_change_orders: 'changeOrders' },
    canUseCloudSync: () => false, state, saveState() {}, supabaseStateId: () => 'coastal-crest',
    cloudClient: { from: () => table([]) }, initializeJobOperations: async () => true,
  });
  await context.deleteJobOperation('crm_permits', 'p1');
  assert.deepEqual(state.permits.map((item) => item.id), ['p2']);
  await assert.rejects(() => context.deleteJobOperation('crm_change_orders', 'c1'), /cannot be deleted/);
  // Signed in: a delete the database refuses comes back as zero rows, and is reported.
  context.canUseCloudSync = () => true;
  await assert.rejects(() => context.deleteJobOperation('crm_permits', 'p2'), /was not deleted/);
  assert.deepEqual(deleted, ['p2']);
  context.cloudClient = { from: () => table([{ id: 'p2' }]) };
  await context.deleteJobOperation('crm_permits', 'p2');
  const render = app.match(/^function renderLeadOperations\(contact\) \{[^]*?^}/m)[0];
  for (const name of ['crm_permits', 'crm_inspections', 'crm_job_selections']) assert.match(render, new RegExp(`operationDeleteButton\\("${name}"`));
  assert.doesNotMatch(render, /operationDeleteButton\("crm_(change_orders|progress_billings)"/);
});

test('#27 an approved change order can be added to the contract value, once', async () => {
  const job = { id: 'job', name: 'Kitchen remodel', value: 30000, contractValue: 30000 };
  let contact = { id: 'lead', jobs: [job], updates: [] };
  const questions = [];
  let answer = true;
  const context = functions(['operationValue', 'changeOrderCountsTowardContract', 'reconcileChangeOrderWithContract'], {
    state: { changeOrders: [{ id: 'co1', lead_id: 'lead', job_id: 'job', change_order_number: 'CO-1', amount: 850 }] },
    getContact: () => contact, contactJobs: (value) => value.jobs,
    canAction: () => true, number: (value) => Number(value) || 0,
    money: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
    appConfirm: async (message) => { questions.push(message); return answer; },
    uid: (prefix) => `${prefix}_1`, currentActorName: () => 'Local Admin',
    updateContact: (_id, updater) => { contact = updater({ ...contact }); return contact; },
    summarizeContactJobs: (_current, jobs) => ({ jobs }),
    saveState() {}, canUseCloudSync: () => false, persistLeadJobRecord: async () => true, queueDurableRecordsSave() {}, showToast() {},
  });
  assert.equal(await context.reconcileChangeOrderWithContract('co1', 'pending', 'approved'), true);
  assert.match(questions[0], /from \$30,000\.00 to \$30,850\.00/);
  assert.equal(contact.jobs[0].contractValue, 30850);
  assert.deepEqual(JSON.parse(JSON.stringify(contact.jobs[0].appliedChangeOrders)), [{ id: 'co1', amount: 850 }]);
  // Approved to signed: already in the contract, so no question and no change.
  assert.equal(await context.reconcileChangeOrderWithContract('co1', 'approved', 'signed'), false);
  assert.equal(questions.length, 1);
  // Rejected afterwards: offer to take it back off.
  assert.equal(await context.reconcileChangeOrderWithContract('co1', 'signed', 'rejected'), true);
  assert.equal(contact.jobs[0].contractValue, 30000);
  assert.equal(contact.jobs[0].appliedChangeOrders.length, 0);
  // Declining leaves the contract alone.
  answer = false;
  assert.equal(await context.reconcileChangeOrderWithContract('co1', 'rejected', 'approved'), false);
  assert.equal(contact.jobs[0].contractValue, 30000);
});

test('#39 stray keystrokes cannot be saved as a sales representative', () => {
  const context = functions(['normalizePersonName', 'isPlausiblePersonName', 'salesRepNameProblem']);
  assert.equal(context.isPlausiblePersonName('6y'), false);
  assert.equal(context.isPlausiblePersonName('x'), false);
  assert.equal(context.isPlausiblePersonName('Jo'), true);
  assert.equal(context.isPlausiblePersonName("Priya O'Shah-Lee"), true);
  assert.match(context.salesRepNameProblem('6y'), /does not look like a sales representative/);
  assert.equal(context.salesRepNameProblem(''), '');
  assert.equal(context.salesRepNameProblem('Unassigned'), '');
  assert.equal(context.salesRepNameProblem('Alex Carter'), '');
  assert.match(app.match(/^async function saveContactFromForm\([^]*?^}/m)[0], /salesRepNameProblem\(formData\.get\("salesRep"\)\)/);
  assert.match(app.match(/^async function saveLeadJob\([^]*?^}/m)[0], /salesRepNameProblem\(formData\.get\("salesRep"\)\)/);
});

test('#61 the invite form lays out its Google Groups choices as normal checkboxes on their own row', () => {
  assert.match(styles, /\.team-invite-form fieldset \{\s*order: 1;\s*grid-column: 1 \/ -1;/);
  assert.match(styles, /\.team-invite-form fieldset input\[type="checkbox"\] \{[^}]*width: 16px;[^}]*min-height: 0;/);
});

// ---- Found by the signed-in run against a local copy of the cloud database ----

test('signed-in run: a job first saved without a number can receive one, and an assigned number never changes', () => {
  const baseline = new Map([
    ['job:blank', { projectNumber: '' }],
    ['job:numbered', { projectNumber: 'LD-20261122-000001-P01' }],
    ['contact:lead', { name: 'No number yet' }],
  ]);
  const context = functions(['immutableSalesNumberFields', 'durableRecordKey', 'preserveImmutableSalesNumbers'], { durableFinancialBaseline: baseline });
  const rows = [
    { record_type: 'job', id: 'blank', data: { projectNumber: 'LD-20261122-000002-P01' } },
    { record_type: 'job', id: 'numbered', data: { projectNumber: 'LD-99999999-000009-P09' } },
    { record_type: 'job', id: 'numbered', data: { projectNumber: '' } },
    { record_type: 'contact', id: 'lead', data: { leadNumber: 'LD-20261122-000002' } },
  ];
  context.preserveImmutableSalesNumbers(rows);
  assert.equal(rows[0].data.projectNumber, 'LD-20261122-000002-P01', 'the first number reaches the job record');
  assert.equal(rows[1].data.projectNumber, 'LD-20261122-000001-P01', 'a renumbering is undone');
  assert.equal(rows[2].data.projectNumber, 'LD-20261122-000001-P01', 'an assigned number is never blanked');
  assert.equal(rows[3].data.leadNumber, 'LD-20261122-000002');
});

test('signed-in run: a voided invoice leaves every total and frees its estimate', () => {
  const context = functions(['internalInvoiceForEstimate'], { state: { invoices: [
    { id: 'a', estimateId: 'est1', provider: 'internal', status: 'void' },
    { id: 'b', estimateId: 'est2', provider: 'internal', status: 'draft' },
  ] } });
  assert.equal(context.internalInvoiceForEstimate('est1'), undefined, 'a voided invoice no longer blocks a new one');
  assert.equal(context.internalInvoiceForEstimate('est2').id, 'b');
  const billing = app.match(/^function renderInvoicesView\(\) \{[^]*?^}/m)[0];
  assert.match(billing, /const liveInvoices = internalInvoices\.filter\(\(invoice\) => invoice\.status !== "void"\);/);
  assert.match(billing, /const totalInvoiced = liveInvoices\.reduce/);
  assert.match(billing, /new Set\(liveInvoices\.map\(\(invoice\) => invoice\.estimateId\)/);
  // The cloud save asks for the changed row back, so a refused update is reported.
  const voiding = app.match(/^async function voidInvoice\(invoiceId\) \{[^]*?^}/m)[0];
  assert.match(voiding, /rpc\("crm_void_internal_invoice"/);
  assert.match(voiding, /voided !== invoice\.id/);
  assert.doesNotMatch(voiding, /cloudClient\.from\(/);
  // A draw invoiced a second time needs a new invoice id.
  const drawInvoice = app.match(/^async function createProgressDrawInvoice\(drawId\) \{[^]*?^}/m)[0];
  assert.match(drawInvoice, /rpc\("crm_invoice_progress_draw"/);
  assert.match(drawInvoice, /\(state\.invoices \|\| \[\]\)\.some\(\(item\) => item\.id === baseInvoiceId\)/);
});

test('signed-in run: voiding an invoice reopens the billing draw it came from', async () => {
  const state = {
    invoices: [{ id: 'inv1', invoiceNumber: 'DRAW-1', status: 'draft', totalAmount: 500, amountPaid: 0 }],
    invoiceSchedules: [],
    progressBillings: [{ id: 'd1', status: 'invoiced', invoice_id: 'inv1' }, { id: 'd2', status: 'invoiced', invoiceId: 'other' }],
  };
  const toasts = [];
  const context = functions(['operationValue', 'voidInvoice'], {
    state, canManageManualPayments: () => true, number: (value) => Number(value) || 0, invoiceCreditTotal: () => 0,
    appConfirm: async () => true, money: { format: (value) => `$${value}` }, canUseCloudSync: () => false,
    saveState() {}, renderInvoicesView() {}, showToast: (text) => toasts.push(text),
  });
  await context.voidInvoice('inv1');
  assert.equal(state.invoices[0].status, 'void');
  assert.equal(state.progressBillings[0].status, 'planned');
  assert.equal(state.progressBillings[0].invoice_id, '');
  assert.equal(state.progressBillings[1].status, 'invoiced', 'other draws are untouched');
  assert.equal(toasts.at(-1), 'DRAW-1 voided');
});

test('number repair: only a session the database would let save a record tries to correct it', () => {
  const allowed = (role, type, owner, userId = 'me') => functions(['canSaveExistingRecord'], {
    currentRole: () => role, authSession: { user: { id: userId } },
  }).canSaveExistingRecord(type, owner);
  for (const type of ['contact', 'job', 'estimate']) {
    assert.equal(allowed('admin', type, 'someone'), true);
    assert.equal(allowed('office_manager', type, 'someone'), true);
    assert.equal(allowed('sales_manager', type, 'someone'), true);
    assert.equal(allowed('sales', type, 'me'), true, 'a rep saves their own records');
    assert.equal(allowed('sales', type, 'someone'), false, 'a rep never saves another rep\'s record');
    assert.equal(allowed('sales', type, ''), false);
    assert.equal(allowed('viewer', type, 'me'), false, 'a view-only session saves nothing');
  }
  assert.equal(allowed('operations_manager', 'job', 'someone'), true);
  assert.equal(allowed('operations_manager', 'estimate', 'someone'), false);
  assert.equal(allowed('production', 'job', 'me'), true);
  assert.equal(allowed('production', 'contact', 'me'), false);
});

test('number repair: a reserved job number that never reached the job record is restored and saved once', async () => {
  const number = 'LD-20261121-000001-P01';
  const run = async (role, userId, jobNumber = '') => {
    const state = {
      estimates: [{ id: 'est1', contactId: 'lead1', jobId: 'job1', ownerUserId: 'rep', estimateNumber: 'EST-1001', leadNumber: 'LD-20261121-000001', projectNumber: number }],
      contacts: [{ id: 'lead1', ownerUserId: 'rep', leadNumber: 'LD-20261121-000001', jobs: [{ id: 'job1', ownerUserId: 'rep', projectNumber: jobNumber }] }],
    };
    const tally = { reserved: 0, queued: 0 };
    const context = functions(['canSaveExistingRecord', 'getEstimateContact', 'getEstimateJob', 'ensureExistingSharedSalesNumbers', 'repairSalesNumbersAfterCompleteLoad'], {
      state, authSession: { user: { id: userId } }, currentRole: () => role,
      getContact: (id) => state.contacts.find((contact) => contact.id === id), contactJobs: (contact) => contact.jobs,
      jobIsSold: (job) => job.sold === true,
      // The real reservation is idempotent: it hands back the number already reserved.
      reserveSharedSalesNumbers: async () => { tally.reserved += 1; state.contacts[0].jobs[0].projectNumber = number; },
      canUseCloudSync: () => true, queueDurableRecordsSave: () => { tally.queued += 1; }, renderDurableUpdateWhenIdle: () => true,
    });
    const repaired = await context.repairSalesNumbersAfterCompleteLoad();
    return { repaired, ...tally, jobNumber: state.contacts[0].jobs[0].projectNumber };
  };
  assert.deepEqual(await run('admin', 'boss'), { repaired: 1, reserved: 1, queued: 1, jobNumber: number });
  assert.deepEqual(await run('sales', 'rep'), { repaired: 1, reserved: 1, queued: 1, jobNumber: number }, 'the owning rep repairs it');
  assert.deepEqual(await run('sales', 'another-rep'), { repaired: 0, reserved: 0, queued: 0, jobNumber: '' });
  assert.deepEqual(await run('viewer', 'rep'), { repaired: 0, reserved: 0, queued: 0, jobNumber: '' }, 'a view-only session never tries');
  assert.deepEqual(await run('admin', 'boss', number), { repaired: 0, reserved: 0, queued: 0, jobNumber: number }, 'nothing to do once the job holds its number');
  // Leads beyond the first page are only in memory after the complete load.
  assert.match(app.match(/^async function ensureCompleteCoreRecordsLoaded\(\) \{[^]*?^}/m)[0], /void repairSalesNumbersAfterCompleteLoad\(\);/);
});

test('number repair: every sold job gets a number, with or without an estimate', async () => {
  const number = 'LD-20261120-000001-P01';
  const run = async (role, userId, { sold = true, leadNumber = 'LD-20261120-000001', jobNumber = '', withEstimate = false } = {}) => {
    const state = {
      estimates: withEstimate ? [{ id: 'est1', contactId: 'lead1', jobId: 'job1', ownerUserId: 'rep', estimateNumber: 'EST-1001', leadNumber, projectNumber: number }] : [],
      contacts: [{ id: 'lead1', ownerUserId: 'rep', leadNumber, jobs: [{ id: 'job1', ownerUserId: 'rep', projectNumber: jobNumber, sold }] }],
    };
    const reservedFor = [];
    let queued = 0;
    const context = functions(['canSaveExistingRecord', 'getEstimateContact', 'getEstimateJob', 'ensureExistingSharedSalesNumbers', 'repairSalesNumbersAfterCompleteLoad'], {
      state, authSession: { user: { id: userId } }, currentRole: () => role,
      getContact: (id) => state.contacts.find((contact) => contact.id === id), contactJobs: (contact) => contact.jobs,
      jobIsSold: (job) => job.sold === true,
      // The real reservation numbers the lead as well when it has no number.
      reserveSharedSalesNumbers: async (leadId, jobId, estimateId) => {
        reservedFor.push(estimateId || 'job only');
        state.contacts[0].leadNumber = 'LD-20261120-000001';
        state.contacts[0].jobs[0].projectNumber = number;
      },
      canUseCloudSync: () => true, queueDurableRecordsSave: () => { queued += 1; }, renderDurableUpdateWhenIdle: () => true,
    });
    const repaired = await context.repairSalesNumbersAfterCompleteLoad();
    return { repaired, reservedFor: reservedFor.join(','), queued, leadNumber: state.contacts[0].leadNumber, jobNumber: state.contacts[0].jobs[0].projectNumber };
  };
  const done = { repaired: 1, reservedFor: 'job only', queued: 1, leadNumber: 'LD-20261120-000001', jobNumber: number };
  const untouched = { repaired: 0, reservedFor: '', queued: 0, leadNumber: 'LD-20261120-000001', jobNumber: '' };
  const neverNumbered = { ...untouched, leadNumber: '' };
  // The lead already has its number: only the job's record changes.
  assert.deepEqual(await run('admin', 'boss'), done);
  assert.deepEqual(await run('sales', 'rep'), done, 'the rep who owns the job');
  assert.deepEqual(await run('production', 'rep'), done, 'the job\'s owner may save the job');
  assert.deepEqual(await run('sales', 'another-rep'), untouched);
  assert.deepEqual(await run('viewer', 'rep'), untouched);
  // The lead has no number yet: the lead is numbered with the job, so the session must be able to save both.
  assert.deepEqual(await run('admin', 'boss', { leadNumber: '' }), done);
  assert.deepEqual(await run('sales', 'rep', { leadNumber: '' }), done, 'a rep who owns the lead and the job');
  assert.deepEqual(await run('production', 'rep', { leadNumber: '' }), neverNumbered, 'a production user cannot save the lead');
  assert.deepEqual(await run('sales', 'another-rep', { leadNumber: '' }), neverNumbered);
  assert.deepEqual(await run('viewer', 'rep', { leadNumber: '' }), neverNumbered);
  // Only sold jobs, and only once.
  assert.deepEqual(await run('admin', 'boss', { sold: false }), untouched, 'a job that is not sold is not numbered');
  assert.deepEqual(await run('admin', 'boss', { sold: false, leadNumber: '' }), neverNumbered);
  assert.deepEqual(await run('admin', 'boss', { jobNumber: number }), { ...untouched, jobNumber: number }, 'nothing to do once the job holds its number');
  // A job already found through its estimate is reserved once, not twice.
  assert.deepEqual(await run('admin', 'boss', { withEstimate: true }), { ...done, reservedFor: 'est1' });
});

// ---- #71 an automatic correction the database refuses must not be retried for ever ----

test('#71 a lead keeps the same first job, and so the same stage, however its jobs were loaded', () => {
  const { inStableJobOrder } = functions(['inStableJobOrder']);
  const newestFirst = [{ id: 'job_mw9b_bbb', status: 'Request' }, { id: 'job_mw1a_aaa', status: 'Paid' }];
  assert.deepEqual(Array.from(inStableJobOrder(newestFirst), (job) => job.id), ['job_mw1a_aaa', 'job_mw9b_bbb']);
  assert.equal(newestFirst[0].id, 'job_mw9b_bbb', 'the list handed in is not reordered');
  const load = (jobRows) => {
    const state = { company: {}, contacts: [] };
    const context = functions(['inStableJobOrder', 'applyDurableRows'], {
      state, durableUnmappedRows: [], COMPANY_DOCUMENT_LEAD_ID: '__company__', showUnmappedRecordNotice() {},
      applySharedState: (data) => Object.assign(state, data),
      // The real rule: a lead's summary stage is its first job's stage.
      normalizeContact: (contact) => ({ ...contact, status: contact.jobs[0]?.status || contact.status }),
      normalizeDocument: (value) => value,
    });
    context.applyDurableRows([{ record_type: 'contact', id: 'lead1', data: { status: 'Paid' } }, ...jobRows], []);
    return state.contacts[0];
  };
  const paid = { record_type: 'job', id: 'job_mw1a_aaa', lead_id: 'lead1', data: { status: 'Paid' } };
  const request = { record_type: 'job', id: 'job_mw9b_bbb', lead_id: 'lead1', data: { status: 'Request' } };
  // The complete load returns jobs in id order, the first page most recently updated first.
  assert.equal(load([paid, request]).status, 'Paid');
  assert.equal(load([request, paid]).status, 'Paid');
  assert.match(app.match(/^function normalizeServerLeadItem\([^]*?^}/m)[0], /jobs: inStableJobOrder\(jobs\.map\(/);
});

test('#71 only a session the database will let make a Paid-status correction marks it for saving', () => {
  const remember = (role, userId, rows, normalizedStatus, refused = []) => {
    const context = functions(['canSaveExistingRecord', 'canManageTeamData', 'canCarryPaidStatusRepair', 'rememberDurableRows'], {
      currentRole: () => role, authSession: { user: { id: userId } },
      durableFinancialBaseline: new Map(), durableRecordFingerprints: new Map(), durableAuditIds: new Set(),
      durableAutomaticRepairKeys: new Set(), durableRefusedRepairKeys: new Set(refused),
      durableRecordKey: (row) => `${row.record_type}:${row.id}`,
      durableFingerprint: (row) => row.data.status,
      durableRowsFromState: () => rows.map((row) => ({ ...row, data: { ...row.data, status: normalizedStatus } })),
      getDurableCommitWriter: () => ({ remember() {} }),
    });
    context.rememberDurableRows(rows, []);
    const marked = [...context.durableAutomaticRepairKeys].map((key) => key.split(':')[0]).sort();
    // A marked record keeps the saved value as its fingerprint, so it differs
    // from what is on screen and the next save sends it. Any other record is
    // fingerprinted as shown, so nothing is waiting to be saved for it.
    for (const row of rows) {
      const fingerprint = context.durableRecordFingerprints.get(`${row.record_type}:${row.id}`);
      assert.equal(fingerprint, marked.includes(row.record_type) ? 'Paid' : normalizedStatus);
    }
    return marked;
  };
  const lead = { record_type: 'contact', id: 'lead1', owner_id: 'rep', data: { status: 'Paid' } };
  const job = { record_type: 'job', id: 'job1', lead_id: 'lead1', owner_id: 'rep', data: { status: 'Paid' } };
  // Only the lead's summary is wrong: its owner may save that.
  assert.deepEqual(remember('sales', 'rep', [lead], 'Scheduled'), ['contact']);
  assert.deepEqual(remember('viewer', 'rep', [lead], 'Scheduled'), [], 'a view-only session marks nothing');
  assert.deepEqual(remember('sales', 'another-rep', [lead], 'Scheduled'), []);
  // The job itself has to move back a stage: only a manager may do that, and the lead goes with it.
  assert.deepEqual(remember('sales', 'rep', [lead, job], 'Completed'), []);
  assert.deepEqual(remember('admin', 'boss', [lead, job], 'Completed'), ['contact', 'job']);
  assert.deepEqual(remember('sales_manager', 'boss', [lead, job], 'Completed'), ['contact', 'job']);
  // Refused once in this session: not offered again.
  assert.deepEqual(remember('admin', 'boss', [lead, job], 'Completed', ['job:job1']), ['contact']);
  // Nothing wrong: nothing marked.
  assert.deepEqual(remember('admin', 'boss', [lead, job], 'Paid'), []);
});

test('#71 a refused automatic correction is remembered, and a late one gets its save started', () => {
  const refused = new Set();
  const toasts = [];
  const context = functions(['handleRejectedDurableWrite'], {
    durableRejectionReloadPending: false, durableSaveTimer: 0,
    window: { clearTimeout() {}, setTimeout() {} },
    durableRecordKey: (row) => `${row.record_type}:${row.id}`,
    durableAutomaticRepairKeys: new Set(['job:auto']), durableRefusedRepairKeys: refused,
    durableRejectionReason: () => 'A job can only move forward one stage at a time.', showToast: (text) => toasts.push(text),
  });
  context.handleRejectedDurableWrite({ error: { message: 'invalid_stage_transition' }, payload: { p_changes: [
    { record_type: 'job', id: 'auto' }, { record_type: 'contact', id: 'edited-by-user' },
  ] } });
  assert.deepEqual([...refused], ['job:auto'], 'only the automatic correction is set aside; the user is still told');
  assert.equal(toasts.length, 1);
  context.handleRejectedDurableWrite({ error: { message: 'record_access_denied' } });
  assert.equal(refused.size, 1);
  const completeLoad = app.match(/^async function ensureCompleteCoreRecordsLoaded\(\) \{[^]*?^}/m)[0];
  assert.match(completeLoad, /if \(hasPendingDurableChanges\(\)\) queueDurableRecordsSave\(\);\s*\/\/[^]*?void repairSalesNumbersAfterCompleteLoad\(\);/);
  assert.match(app.match(/^function handleRejectedDurableWrite\([^]*?^}/m)[0], /if \(hasPendingDurableChanges\(\)\) queueDurableRecordsSave\(\);/);
});

// ---- Dashboard, Billing and Reports always agree ----------------------------

test('totals: there is no fallback figure, so the three screens can never show different things', () => {
  const calls = [];
  const globals = (loaded, attempts) => ({
    canUseCloudSync: () => true, completeCoreRecordsLoaded: loaded, completeCoreRecordsAttempts: attempts,
    // The database's own totals are present, and must not be used: its "collected"
    // is only the money on jobs marked Paid.
    dashboardAggregateTotals: { leads: 999, closedValue: 111, pipelineValue: 222 },
    financialLedgerEntries: () => { calls.push('ledger'); return [{ kind: 'Payment', amount: 133640.97 }]; },
    visibleContacts: () => [], visibleEstimates: () => [], allJobs: () => [], contactJobs: () => [], jobHasFullPayment: () => false,
    number: (value) => Number(value) || 0,
  });
  const names = ['COMPLETE_LOAD_QUICK_ATTEMPTS', 'coreRecordsArePartial', 'companyTotalsState', 'companyTotalsCaption', 'dashboardDataSource', 'ledgerTotals', 'dashboardMetrics'];
  // Still loading, and after the quick tries have all failed: nothing is shown, on any screen.
  for (const [attempts, expectedState, caption] of [[0, 'loading', 'Loading all records'], [8, 'stalled', 'Not loaded yet · still trying'], [40, 'stalled', 'Not loaded yet · still trying']]) {
    const context = functions(names, globals(false, attempts));
    assert.equal(context.companyTotalsState(), expectedState);
    assert.equal(context.companyTotalsCaption(), caption);
    assert.equal(context.dashboardDataSource(), 'pending');
    const metrics = context.dashboardMetrics();
    assert.equal(metrics.pending, true, 'Dashboard and Reports show a placeholder');
    assert.equal(metrics.closedValue, 0, 'the database total is never passed off as revenue collected');
    assert.equal(context.coreRecordsArePartial(), true, 'Billing shows a placeholder by the same test');
  }
  assert.deepEqual(calls, [], 'no total is computed from a partial set');
  // Everything loaded: one ledger, one figure.
  const ready = functions(names, globals(true, 0));
  assert.equal(ready.companyTotalsState(), 'ready');
  assert.equal(ready.dashboardMetrics().closedValue, 133640.97);
  assert.equal(ready.coreRecordsArePartial(), false);
  // All three screens read the same ledger and the same "is it all loaded" answer.
  assert.doesNotMatch(app, /source === "server"/);
  assert.doesNotMatch(app.match(/^function dashboardDataSource\(\) \{[^]*?^}/m)[0], /dashboardAggregateTotals|"server"/);
  const billing = app.match(/^function renderInvoicesView\(\) \{[^]*?^}/m)[0];
  assert.match(billing, /const ledger = ledgerTotals\(ledgerEntries\);/);
  assert.match(billing, /const pendingTotals = coreRecordsArePartial\(\);/);
  const reports = app.match(/^function renderReportsView\(\) \{[^]*?^}/m)[0];
  assert.match(reports, /const ledger = ledgerTotals\(ledgerEntries\);/);
  assert.match(reports, /const shown = \(value\) => \(metrics\.pending \? "…" : value\);/);
  // The tables on Reports are totals too: rep production, lead sources, payment methods, invoice aging.
  assert.equal((reports.match(/\$\{tableRows\(3, /g) || []).length, 3);
  assert.equal((reports.match(/shown\(money\.format\(aging\./g) || []).length, 4);
  // Billing: an invoice whose job has not loaded has an unknown balance, so no figure and no Payment button.
  assert.match(billing, /const balancePending = pendingTotals && Boolean\(invoice\.jobId\) && !invoiceJob && invoice\.status !== "void";/);
  assert.match(billing, /outstanding > 0 && !balancePending && canManageManualPayments\(\)/);
  assert.match(billing, /\$\{pendingTotals \? "…" : overdueInvoices\.length\}/);
});

test('totals: the full load is retried for as long as the session lasts, and says so once', () => {
  const delays = [];
  const toasts = [];
  let redraws = 0;
  const context = functions(['COMPLETE_LOAD_QUICK_ATTEMPTS', 'scheduleCompleteCoreRecordsRetry'], {
    completeCoreRecordsLoaded: false, completeCoreRecordsRetryTimer: null, completeCoreRecordsAttempts: 0,
    window: { setTimeout: (run, ms) => { delays.push(ms); return 1; } },
    showToast: (text) => toasts.push(text), renderDurableUpdateWhenIdle: () => { redraws += 1; },
    ensureCompleteCoreRecordsLoaded: async () => false,
  });
  for (let attempt = 0; attempt < 12; attempt += 1) {
    assert.equal(context.scheduleCompleteCoreRecordsRetry(), true, 'it never gives up');
    assert.equal(context.scheduleCompleteCoreRecordsRetry(), true);
    context.completeCoreRecordsRetryTimer = null; // the timer fired and the attempt failed again
  }
  assert.deepEqual(delays, [2000, 4000, 6000, 8000, 10000, 10000, 10000, 30000, 30000, 30000, 30000, 30000], 'one timer per failed attempt, slower after the quick tries');
  assert.equal(toasts.length, 1, 'the user is told once, not on every retry');
  assert.match(toasts[0], /has not loaded yet/);
  assert.equal(redraws, 1, 'the open screen switches its notice once');
  // Nothing more to do once everything is loaded.
  context.completeCoreRecordsLoaded = true;
  context.scheduleCompleteCoreRecordsRetry();
  assert.equal(delays.length, 12);
  assert.match(app.slice(app.indexOf('async function startApp()')), /if \(canUseCloudSync\(\)\) watchForCompleteLoadRetry\(\);/);
  assert.match(app.match(/^function renderPartialDataNotice\([^]*?^}/m)[0], /Try again now/);
});

module.exports = { functions, app, page, styles };
