const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'workflow-checklists-v65.js'), 'utf8');
const productionFlow = fs.readFileSync(path.join(root, 'production-flow-v64.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function source(text, name, indent = '') {
  const match = text.match(new RegExp(`^${indent}(?:async )?function ${name}\\([^]*?^${indent}}`, 'm'));
  assert.ok(match, `${name} exists`);
  return match[0];
}

function workflowContext(manager) {
  const stages = workflow.match(/const progressionStages = \[[^]*?\];/)[0];
  const context = {
    canManageTeamData: () => manager,
    jobHasFullPayment: () => true,
    stageChecklist: () => ({ ready: true, missing: [] }),
  };
  vm.runInNewContext(`${stages}
    ${source(workflow, 'stageIndex', '  ')}
    ${source(workflow, 'nextStage', '  ')}
    ${source(workflow, 'transitionCheck', '  ')}
    this.check = transitionCheck;`, context);
  return (from, to) => context.check({ status: from }, { status: from }, to);
}

test('stage rules match the database: reps go forward only, managers can correct', () => {
  const rep = workflowContext(false);
  const manager = workflowContext(true);
  assert.equal(rep('Contacted', 'Inspection').allowed, true);
  assert.equal(rep('Contacted', 'Won').allowed, false);
  assert.match(rep('Inspection', 'Contacted').reason, /Ask a manager to move this job back/);
  assert.match(rep('Lost', 'New').reason, /Ask a manager to reopen/);
  assert.equal(rep('Inspection', 'Lost').allowed, true);
  assert.equal(rep('New', 'Someday').allowed, false);
  assert.equal(manager('Inspection', 'Contacted').allowed, true);
  assert.equal(manager('Lost', 'New').allowed, true);
  assert.match(manager('Lost', 'Won').reason, /Reopen this job at New/);
});

test('a Won estimate satisfies the Estimate Sent checklist', () => {
  assert.match(workflow, /"Estimate marked Sent or Won"[^]*?\["Sent", "Won", "Approved"\]\.includes\(estimate\.status\)/);
});

test('paused saving explains database rule violations in plain language', () => {
  const context = {};
  vm.runInNewContext(`${app.match(/const durableRejectionReasons = \{[^]*?\n\};/)[0]}
    ${source(app, 'durableRejectionReason')}
    this.reason = durableRejectionReason;`, context);
  assert.match(context.reason({ message: 'record_access_denied' }), /belongs to another rep/);
  assert.match(context.reason({ message: 'x', details: 'invalid_stage_transition' }), /one stage at a time/);
  assert.match(context.reason({ message: 'commit_too_large' }), /fewer records/);
  assert.equal(context.reason({ message: 'network down' }), '');
  assert.match(app, /const rejection = durableRejectionReason\(error\);/);
});

test('choosing a team member as Sales Rep moves the lead, its jobs, estimates and their tasks to that rep', () => {
  const context = {
    state: {
      estimates: [{ id: 'e1', contactId: 'lead' }, { id: 'e2', contactId: 'other' }],
      calendarTasks: [
        { id: 't1', contactId: 'lead', ownerUserId: 'old' },
        { id: 't2', contactId: 'lead', ownerUserId: 'crew' },
      ],
    },
    role: 'sales_manager',
    normalizeCalendarTask: (task) => task,
    normalizePersonName: (value) => String(value || '').trim().replace(/\s+/g, ' '),
  };
  vm.runInNewContext(`
    let assignableTeam = [{ userId: 'jane', email: 'jane@coastalcrestroofing.com', name: 'Jane Smith', role: 'sales' }];
    function currentRole() { return role; }
    ${source(app, 'canAssignLeadOwners')}
    ${source(app, 'assignableTeamMember')}
    ${source(app, 'applySalesRepAssignment')}
    this.assign = applySalesRepAssignment;`, context);
  const lead = { id: 'lead', salesRep: 'jane smith', ownerUserId: 'old', jobs: [{ id: 'j1', ownerUserId: 'old' }] };
  const assigned = context.assign(lead);
  assert.equal(assigned.ownerUserId, 'jane');
  assert.equal(assigned.salesRep, 'Jane Smith');
  assert.equal(assigned.jobs[0].ownerUserId, 'jane');
  assert.equal(context.state.estimates.find((e) => e.id === 'e1').ownerUserId, 'jane');
  assert.equal(context.state.estimates.find((e) => e.id === 'e2').ownerUserId, undefined);
  assert.equal(context.state.calendarTasks.find((t) => t.id === 't1').ownerUserId, 'jane');
  assert.equal(context.state.calendarTasks.find((t) => t.id === 't2').ownerUserId, 'crew');
  assert.equal(context.assign({ id: 'x', salesRep: 'Not On Team', ownerUserId: 'old', jobs: [] }).ownerUserId, 'old');
  context.role = 'sales';
  assert.equal(context.assign({ id: 'y', salesRep: 'Jane Smith', ownerUserId: 'me', jobs: [] }).ownerUserId, 'me');
});

test('both contact form savers apply the Sales Rep assignment and reps cannot retype it', () => {
  assert.match(source(app, 'saveContactFromForm'), /Object\.assign\(contact, applySalesRepAssignment\(contact\)\)/);
  assert.match(productionFlow, /Object\.assign\(contact, applySalesRepAssignment\(contact\)\)/);
  assert.match(source(app, 'openContactDialog'), /repField\.readOnly = !canAssignLeadOwners\(\)/);
  assert.match(app, /loadAssignableTeam\(\);/);
});

test('large saves are split below the database commit limit', () => {
  const flush = source(app, 'flushDurableRecordsSave');
  assert.match(flush, /const maxRows = 400;/);
  assert.match(flush, /commitDurableChanges\(batchRows, batchAuditRows, batchRemovals\)/);
});

test('imported Zoho leads start at New with their Zoho status kept in notes', () => {
  const lead = source(app, 'newImportedLead');
  assert.match(lead, /status: "New"/);
  assert.match(lead, /Zoho status: \$\{lead\.status\}/);
  assert.match(lead, /return applySalesRepAssignment\(started\)/);
  assert.match(source(app, 'importZohoCsv'), /state\.contacts\.unshift\(newImportedLead\(contact\)\)/);
});

test('reps are not offered Settings, and can connect Google Calendar from the Calendar page', () => {
  assert.match(source(app, 'applyPermissionsToDom'), /\.nav-item\[data-view\][^]*?!canView\(item\.dataset\.view\)/);
  assert.match(index, /id="calendarGoogleConnectButton"/);
  assert.match(app, /calendarGoogleConnectButton\?\.addEventListener\("click", connectGoogleWorkspace\)/);
});

test('company file change controls follow upload ownership', () => {
  const row = source(app, 'renderCompanyDocumentRow');
  assert.match(row, /const changeable = canChangeCompanyDocument\(document\);/);
  for (const name of ['moveCompanyDocumentToFolder', 'removeCompanyDocument', 'renameCompanyDocument']) {
    assert.match(source(app, name), /!canChangeCompanyDocument\(document\)/, name);
  }
});

test('every icon referenced by the UI is defined', () => {
  const block = app.slice(app.indexOf('const icons = {'), app.indexOf('\n};', app.indexOf('const icons = {')));
  const defined = new Set([...block.matchAll(/^\s{2}"?([a-zA-Z-]+)"?:/gm)].map((m) => m[1]));
  const files = ['app.js', 'index.html', 'production-flow-v64.js', 'workflow-checklists-v65.js', 'project-conversations-v67.js'];
  const used = new Set(files.flatMap((file) => [...fs.readFileSync(path.join(root, file), 'utf8').matchAll(/data-icon="([a-z-]+)"/g)].map((m) => m[1])));
  assert.deepEqual([...used].filter((name) => !defined.has(name)), []);
});

test('rep production report credits sold jobs, not only fully paid ones', () => {
  const report = source(app, 'renderReportsView');
  assert.match(report, /soldJobStatuses\.includes\(job\.status\)/);
  assert.match(report, /Sold Contract Value/);
});

test('the stage guard reads the form id attribute, since the contact form has an input named "id"', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /<input type="hidden" name="id" \/>/);
  const guard = source(workflow, 'guardStatusSubmit', '  ');
  assert.match(guard, /includes\(formIdOf\(form\)\)/);
  assert.doesNotMatch(workflow, /form\??\.id\s*(===|!==|\))/);
  const context = {};
  vm.runInNewContext(`${source(workflow, 'formIdOf', '  ')}; this.formIdOf = formIdOf;`, context);
  const shadowed = { id: { name: 'id' }, getAttribute: (name) => (name === 'id' ? 'contactForm' : null) };
  assert.equal(context.formIdOf(shadowed), 'contactForm');
});
