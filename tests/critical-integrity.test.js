const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const workflow = fs.readFileSync(path.join(__dirname, '../workflow-checklists-v65.js'), 'utf8');
const productionFlow = fs.readFileSync(path.join(__dirname, '../production-flow-v64.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261022145711_critical_integrity_and_rep_scope.sql'), 'utf8');

function functionSource(name) {
  const match = app.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'));
  assert.ok(match, `${name} exists`);
  return match[0];
}

test('Paid requires a positive contract and confirmed full payment in UI and database', () => {
  const context = { number: Number };
  vm.runInNewContext(`${functionSource('jobPaymentMetrics')}\n${functionSource('jobHasFullPayment')}\nthis.check=jobHasFullPayment`, context);
  assert.equal(context.check({ contractValue: 32000, paidAmount: 16000 }), false);
  assert.equal(context.check({ contractValue: 32000, paidAmount: 32000 }), true);
  assert.equal(context.check({ contractValue: 0, paidAmount: 0 }), false);
  assert.match(workflow, /autoItem\("final-payment"[^]*?jobHasFullPayment\(job\)/);
  assert.match(workflow, /targetStatus === "Paid" && !jobHasFullPayment\(job\)/);
  assert.match(migration, /old_row\.data->>'paidAmount'/);
  assert.match(migration, /raise exception 'full_payment_required'/);
  assert.match(app, /status === "Paid" && !\(contractValue > 0 && paidAmount \+ 0\.005 >= contractValue\)[^]*?\? "Completed"/);
  assert.match(app, /repairsInvalidPaidStatus[^]*?durableFingerprint\(row\)/);
  assert.match(app, /durableRecordsReady = true;[^]*?hasPendingDurableChanges\(\)[^]*?queueDurableRecordsSave\(\)/);
  assert.match(workflow, /\$\{automatic \|\| !editable \? "disabled" : ""\}/);
  assert.doesNotMatch(workflow, /Can confirm manually/);
});

test('dashboard total is every visible lead while open opportunities remain a separate caption', () => {
  assert.match(app, /const leads = contacts\.length/);
  assert.match(app, /const openLeads = contacts\.filter/);
  assert.match(app, /\["Total Leads", metrics\.leads, `\$\{metrics\.openLeads\} open sales opportunities`/);
  assert.match(productionFlow, /const leads = contacts\.length/);
  assert.match(productionFlow, /`\$\{metrics\.openLeads\} open sales opportunities`/);
});

test('adding another job preserves primary lead fields and totals every project', () => {
  const context = {
    number: Number,
    soldJobStatuses: ['Won', 'Scheduled', 'Materials Ordered', 'In Progress', 'Completed', 'Paid'],
    contactJobs: contact => contact.jobs,
    normalizeJob: (_job, contact) => contact.jobs[0],
  };
  vm.runInNewContext(`${functionSource('summarizeContactJobs')}\nthis.summarize=summarizeContactJobs`, context);
  const contact = { type: 'Customer', status: 'Paid', value: 35250.75, closedDate: '2026-10-01', jobs: [] };
  const first = { id: 'p1', status: 'Paid', contractValue: 35250.75 };
  const second = { id: 'p2', status: 'New', contractValue: 1250.25 };
  contact.jobs = [first, second];
  const result = context.summarize(contact, contact.jobs);
  assert.equal(result.status, 'Paid');
  assert.equal(result.type, 'Customer');
  assert.equal(result.value, 36501);
  const saveLeadJob = app.slice(app.indexOf('async function saveLeadJob'), app.indexOf('\nfunction editLeadJob'));
  assert.match(saveLeadJob, /existing \? jobs\.map[\s\S]*?: \[\.\.\.jobs, job\]/);
  assert.doesNotMatch(saveLeadJob, /status: primary\.status,[\s\S]{0,180}salesRep: primary\.salesRep/);
});

test('individual contributors see only owned customer, estimate, task and job data', () => {
  const state = {
    contacts: [{ id: 'mine', ownerUserId: 'me', jobs: [] }, { id: 'other', ownerUserId: 'them', jobs: [] }],
    estimates: [{ id: 'e1', ownerUserId: 'me' }, { id: 'e2', ownerUserId: 'them' }],
    calendarTasks: [{ id: 't1', ownerUserId: 'me' }, { id: 't2', ownerUserId: 'them' }],
  };
  const context = {
    state,
    authSession: { user: { id: 'me', email: 'me@example.com' } },
    canManageTeamData: () => false,
  };
  vm.runInNewContext([
    functionSource('recordOwnedByCurrentUser'), functionSource('visibleContacts'),
    functionSource('visibleEstimates'), functionSource('visibleCalendarTasks'),
  ].join('\n'), context);
  assert.deepEqual(Array.from(context.visibleContacts(), item => item.id), ['mine']);
  assert.deepEqual(Array.from(context.visibleEstimates(), item => item.id), ['e1']);
  assert.deepEqual(Array.from(context.visibleCalendarTasks(), item => item.id), ['t1']);
  assert.match(migration, /owner_id=\(select auth\.uid\(\)\)/);
  assert.match(migration, /revoke insert,update,delete on public\.crm_records/);
});

test('high-frequency stage and navigation actions avoid full-state cloud saves', () => {
  assert.match(app, /function setView\([^]*?saveUiState\(\)/);
  assert.match(app, /data-leaderboard-range[^]*?saveUiState\(\)/);
  assert.match(app, /action === "advance-contact"[^]*?saveState\(\{ localOnly: true \}\)[^]*?persistLeadJobRecord/);
  assert.match(app, /function renderCalendarFormOptions\([^]*?currentOwner\(\)\.name/);
});

test('job buttons carry and select the exact project identity', () => {
  assert.match(app, /data-action="open-job" data-contact-id="\$\{job\.contactId}" data-job-id="\$\{job\.id}"/);
  assert.match(productionFlow, /data-action="open-contact-tab" data-contact-id="\$\{job\.contactId}" data-job-id="\$\{job\.id}"/);
  assert.match(app, /function openLeadDetail\([^]*?state\.selectedLeadJobId = jobId/);
  assert.match(app, /function openLeadJob\([^]*?find\(\(item\) => item\.id === jobId\)/);
});

test('legacy production UI cannot bypass payment and ownership protections', () => {
  assert.doesNotMatch(productionFlow, /assignGlobal\("applyStatusUpdate"/);
  assert.match(productionFlow, /const closedJobs = jobs\.filter\(jobHasFullPayment\)/);
  assert.match(productionFlow, /\(job\) => jobHasFullPayment\(job\) && isInLeaderboardRange/);
  assert.match(productionFlow, /visibleContacts\(\)\.filter/);
  assert.match(productionFlow, /visibleEstimates\(\)\.filter/);
  assert.match(productionFlow, /Collected revenue - last 6 months/);
});
