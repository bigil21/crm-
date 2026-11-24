// Today's worklist on the Sales Pipeline (to-do item 10): who to call, why,
// and a call that always ends with a dated next step.
// Nothing here touches a network or a real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const DAY = 86400000;
const NOW = new Date('2026-11-20T15:00:00').getTime(); // a Friday afternoon
const STAGES = ['New Lead', 'Contacted', 'Inspection', 'Estimate Sent', 'Follow-Up/Decision', 'Won'];
const constants = ['PIPELINE_ATTENTION_ORDER', 'PIPELINE_ATTENTION_LABELS', 'PIPELINE_CALL_OUTCOMES', 'PIPELINE_DECISION_STAGES', 'PIPELINE_WAITING_REASONS']
  .map((name) => source.match(new RegExp(`^const ${name} = [^]*?;$`, 'm'))[0].replace(/^const /, 'var ')).join('\n');

function load(names, globals = {}) {
  const context = vm.createContext({ console, Date, Intl, ...globals });
  vm.runInContext(`${constants}\nvar pipelineWorklistFormKey = "";`, context);
  for (const name of names) {
    const match = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    assert.ok(match, `Function ${name} exists`);
    vm.runInContext(match[0], context);
  }
  return context;
}

const lead = (id, extra = {}) => ({ id, name: `TEST ${id}`, phone: '(239) 555-0100', source: 'Referral', lastContact: '2026-11-01', updatedAt: '2026-11-19T12:00:00Z', updates: [], jobs: [], ...extra });
const job = (id, stage, extra = {}) => ({ id, name: `Job ${id}`, division: 'roofing', propertyType: 'residential', salesStage: stage, salesRep: 'Rep One', ...extra });

function pipeline({ rows, tasks = {}, staleDays = 7, attention = 'all', stageDays = {}, activity = {} }) {
  const state = { pipelineStaleDays: staleDays, pipelineAttention: attention, pipelineWorklist: true };
  const c = load(['pipelineRowAttention', 'pipelineWorklistRows'], {
    state,
    normalizeSalesStage: (item) => item.salesStage,
    salesPipelineStagesFor: () => STAGES,
    pipelineFilteredRows: () => rows,
    pipelineNextTask: (contact, item) => tasks[item.id] || null,
    leadActivityTimestamp: (contact) => activity[contact.id] ?? NOW - DAY,
    pipelineDaysInStage: (contact, item) => stageDays[item.id] ?? 0,
    pipelineStageTargetDays: () => 4,
    localTimestamp: (value) => Date.parse(value),
  });
  return { c, state };
}
const row = (contact, item) => ({ contact, job: item, key: `${contact.id}:${item.id}` });

test('the list is the open opportunities that need something, most pressing first', () => {
  const rows = [
    row(lead('quiet'), job('j-quiet', 'Inspection')),
    row(lead('decision'), job('j-decision', 'Estimate Sent')),
    row(lead('late-2d'), job('j-late-2d', 'Contacted')),
    row(lead('fine'), job('j-fine', 'Inspection')),
    row(lead('late-9d'), job('j-late-9d', 'Inspection')),
    row(lead('new'), job('j-new', 'New Lead')),
    row(lead('web', { source: 'Website' }), job('j-web', 'Contacted', { salesRep: 'Unassigned' })),
    row(lead('lost'), job('j-lost', 'Lost')),
    row(lead('sold'), job('j-sold', 'Won')),
    row(lead('stuck'), job('j-stuck', 'Inspection')),
  ];
  const overdue = (days) => ({ id: `t${days}`, title: 'Call back', completed: false, dueAt: new Date(NOW - days * DAY).toISOString() });
  const { c } = pipeline({
    rows,
    tasks: { 'j-late-2d': overdue(2), 'j-late-9d': overdue(9), 'j-lost': overdue(30), 'j-sold': overdue(30), 'j-fine': { id: 'later', title: 'Call', completed: false, dueAt: new Date(NOW + DAY).toISOString() } },
    activity: { quiet: NOW - 20 * DAY },
    stageDays: { 'j-stuck': 9, 'j-lost': 40, 'j-sold': 40 },
  });
  const list = c.pipelineWorklistRows(NOW);
  assert.deepEqual(Array.from(list, (item) => item.contact.id), ['late-9d', 'late-2d', 'web', 'new', 'decision', 'stuck', 'quiet']);
  assert.deepEqual(Array.from(list[0].reasons), ['overdue']);
  assert.deepEqual(Array.from(list[3].reasons), ['uncontacted']);
  assert.deepEqual(Array.from(list[4].reasons), ['noDecision']);
  assert.deepEqual(Array.from(list[6].reasons), ['inactive']);
  assert.equal(list[0].task.title, 'Call back');
  // Lost and sold work is not on a sales list, however old; nor is an opportunity that needs nothing.
  for (const absent of ['lost', 'sold', 'fine']) assert.equal(list.some((item) => item.contact.id === absent), false, absent);
});

test('an opportunity with its next step already dated is off today\'s list', () => {
  const later = { id: 'later', title: 'Follow up', completed: false, dueAt: new Date(NOW + 2 * DAY).toISOString() };
  const rows = [
    row(lead('decision'), job('j-decision', 'Estimate Sent')),
    row(lead('stuck'), job('j-stuck', 'Inspection')),
    row(lead('quiet'), job('j-quiet', 'Inspection')),
    row(lead('new'), job('j-new', 'New Lead')),
    row(lead('web', { source: 'Website' }), job('j-web', 'Contacted', { salesRep: 'Unassigned' })),
  ];
  const settings = { rows, activity: { quiet: NOW - 20 * DAY }, stageDays: { 'j-stuck': 9 } };
  assert.equal(pipeline(settings).c.pipelineWorklistRows(NOW).length, 5, 'with nothing scheduled all five are listed');
  const scheduled = pipeline({ ...settings, tasks: Object.fromEntries(rows.map((item) => [item.job.id, later])) }).c.pipelineWorklistRows(NOW);
  // Slow, quiet and undecided are waiting on a date that is set. A lead nobody
  // has called and a request nobody owns are not excused by a date.
  assert.deepEqual(Array.from(scheduled, (item) => item.contact.id), ['web', 'new']);
  // When that date passes without the call being made, it is back, at the top.
  const missed = pipeline({ ...settings, tasks: { 'j-decision': { ...later, dueAt: new Date(NOW - DAY).toISOString() } } }).c.pipelineWorklistRows(NOW);
  assert.equal(missed[0].contact.id, 'decision');
  assert.deepEqual(Array.from(missed[0].reasons), ['overdue', 'noDecision']);
});

test('choosing a count above the board narrows the list to that reason', () => {
  const rows = [row(lead('decision'), job('j-decision', 'Estimate Sent')), row(lead('new'), job('j-new', 'New Lead'))];
  const all = pipeline({ rows }).c.pipelineWorklistRows(NOW);
  assert.equal(all.length, 2);
  const only = pipeline({ rows, attention: 'noDecision' }).c.pipelineWorklistRows(NOW);
  assert.deepEqual(Array.from(only, (item) => item.contact.id), ['decision']);
});

test('a logged call takes a new lead off "not contacted", even though its notes are not loaded', () => {
  const { c } = pipeline({ rows: [] });
  const fresh = row(lead('new'), job('j-new', 'New Lead'));
  assert.equal(c.pipelineRowAttention(fresh, NOW).uncontacted, true);
  assert.equal(c.pipelineRowAttention(row(lead('new'), job('j-new', 'New Lead', { lastTouchAt: '2026-11-20T14:00:00Z' })), NOW).uncontacted, false);
  assert.equal(c.pipelineRowAttention(row(lead('new', { lastTouchAt: '2026-11-20T14:00:00Z' }), job('j-new', 'New Lead')), NOW).uncontacted, false);
  // A decision date clears "no decision date".
  assert.equal(c.pipelineRowAttention(row(lead('d'), job('j', 'Estimate Sent')), NOW).noDecision, true);
  assert.equal(c.pipelineRowAttention(row(lead('d'), job('j', 'Estimate Sent', { decisionDate: '2026-11-27' })), NOW).noDecision, false);
});

test('the suggested next follow-up is nine in the morning on the next working day', () => {
  const c = load(['pipelineDefaultFollowUp'], { dateTimeLocalValue: (value) => { const d = new Date(value); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; } });
  assert.equal(c.pipelineDefaultFollowUp(new Date('2026-11-18T16:30:00')), '2026-11-19T09:00'); // Wednesday -> Thursday
  assert.equal(c.pipelineDefaultFollowUp(new Date('2026-11-20T16:30:00')), '2026-11-23T09:00'); // Friday -> Monday
  assert.equal(c.pipelineDefaultFollowUp(new Date('2026-11-21T10:00:00')), '2026-11-23T09:00'); // Saturday -> Monday
});

function calling({ role = 'sales', contact, tasks = [], ownJob = true } = {}) {
  const calls = { toasts: [], saves: 0, renders: 0, completed: [], synced: [], updates: [] };
  const theJob = job('job-1', 'Estimate Sent', { ownerUserId: 'rep-1', ownerEmail: 'rep@example.com', ownerName: 'Rep One' });
  const theLead = contact || lead('lead-1', { jobs: ownJob ? [theJob] : [] });
  const state = { calendarTasks: [...tasks], contacts: [theLead], pipelineAttention: 'all' };
  const c = load(['logPipelineCall'], {
    state,
    requireAction: (action) => role !== 'viewer' || (calls.toasts.push(`refused ${action}`), false),
    getContact: (id) => state.contacts.find((item) => item.id === id),
    contactJobs: (item) => (item.jobs?.length ? item.jobs : [theJob]),
    showToast: (message) => calls.toasts.push(message),
    localTimestamp: (value) => Date.parse(value),
    todayISO: () => '2026-11-20', uid: (prefix) => `${prefix}-new`,
    formatDate: (value) => `date(${value})`, formatDateTime: (value) => `time(${value})`,
    currentOwner: () => ({ userId: 'me', email: 'me@example.com', name: 'Me' }),
    normalizeCalendarTask: (task) => ({ completed: false, ...task }),
    pipelineNextTask: () => state.calendarTasks.find((task) => !task.completed) || null,
    updateContact: (id, updater) => { const index = state.contacts.findIndex((item) => item.id === id); state.contacts[index] = { ...updater(state.contacts[index]), updatedAt: 'stamped' }; return state.contacts[index]; },
    addContactUpdate: (id, update) => { calls.updates.push(update); return state.contacts[0]; },
    saveState() {}, queueDurableRecordsSave: () => { calls.saves += 1; }, queueCloudSave() {},
    renderPipeline: () => { calls.renders += 1; },
    completeCalendarTask: async (id) => { calls.completed.push(id); },
    syncCalendarTaskToGoogle: async (task) => { calls.synced.push(task.id); },
  });
  vm.runInContext('pipelineWorklistFormKey = "lead-1:job-1";', c);
  return { c, state, calls };
}
const future = new Date(Date.now() + 3 * DAY).toISOString().slice(0, 16);

test('a call is saved with what happened, when, and a dated next step', async () => {
  const open = { id: 'task-old', title: 'Call back', completed: false, dueAt: '2026-11-18T09:00' };
  const h = calling({ tasks: [open] });
  const saved = await h.c.logPipelineCall('lead-1', 'job-1', { outcome: 'voicemail', note: '  Asked for a call after 5  ', nextAt: future, decisionDate: '2026-11-27', completeTask: true });
  assert.equal(saved, true);
  const contact = h.state.contacts[0];
  assert.equal(contact.lastContact, '2026-11-20');
  assert.equal(contact.lastTouchOutcome, 'voicemail');
  assert.match(contact.lastTouchAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(contact.jobs[0].lastTouchOutcome, 'voicemail');
  assert.equal(contact.jobs[0].decisionDate, '2026-11-27');
  // The note in the lead's history says all of it in one line.
  assert.deepEqual(h.calls.updates.map((update) => ({ ...update })), [{ jobId: 'job-1', message: `Call: left a voicemail. Asked for a call after 5. Next follow-up time(${future}). Decision expected by date(2026-11-27).` }]);
  // The next follow-up is a real task, for the rep who owns the job.
  const next = h.state.calendarTasks[0];
  assert.equal(next.id, 'task-new');
  assert.equal(next.title, 'Follow up with TEST lead-1');
  assert.equal(next.dueAt, future);
  assert.equal(next.contactId, 'lead-1');
  assert.equal(next.jobId, 'job-1');
  assert.equal(next.ownerUserId, 'rep-1');
  assert.equal(next.rep, 'Rep One');
  assert.match(next.notes, /^Left a voicemail on date\(2026-11-20\)\. Asked for a call after 5\.$/);
  // One save, the old task finished, the new one sent to the calendar, the form closed.
  assert.equal(h.calls.saves, 1);
  assert.deepEqual(h.calls.completed, ['task-old']);
  assert.deepEqual(h.calls.synced, ['task-new']);
  assert.equal(vm.runInContext('pipelineWorklistFormKey', h.c), '');
  assert.match(h.calls.toasts.at(-1), /^Call logged\. Next follow-up/);
});

test('a call can end with no further follow-up, but only when the rep says so', async () => {
  const none = calling({ tasks: [{ id: 'task-old', title: 'Call back', completed: false, dueAt: '2026-11-18T09:00' }] });
  assert.equal(await none.c.logPipelineCall('lead-1', 'job-1', { outcome: 'not-interested', noFollowUp: true, nextAt: '' }), true);
  assert.equal(none.state.calendarTasks.length, 1, 'no new task');
  assert.deepEqual(none.calls.completed, [], 'the open task is only finished when ticked');
  assert.deepEqual(none.calls.synced, []);
  assert.match(none.calls.updates[0].message, /^Call: not interested\. No further follow-up\.$/);

  for (const nextAt of ['', 'not a date', new Date(Date.now() - DAY).toISOString().slice(0, 16)]) {
    const h = calling();
    assert.equal(await h.c.logPipelineCall('lead-1', 'job-1', { outcome: 'spoke', nextAt }), false, `next follow-up "${nextAt}"`);
    assert.match(h.calls.toasts.at(-1), /Choose a time in the future/);
    assert.equal(h.calls.saves, 0);
    assert.equal(h.calls.updates.length, 0);
    assert.equal(h.state.contacts[0].lastTouchAt, undefined, 'nothing was recorded');
    assert.equal(vm.runInContext('pipelineWorklistFormKey', h.c), 'lead-1:job-1', 'the form stays open');
  }
});

test('nothing is saved without an outcome, a real opportunity, or the right to save', async () => {
  const noOutcome = calling();
  assert.equal(await noOutcome.c.logPipelineCall('lead-1', 'job-1', { outcome: 'made-up', nextAt: future }), false);
  assert.match(noOutcome.calls.toasts.at(-1), /Choose what happened/);
  const missing = calling();
  assert.equal(await missing.c.logPipelineCall('lead-9', 'job-1', { outcome: 'spoke', nextAt: future }), false);
  const viewer = calling({ role: 'viewer' });
  assert.equal(await viewer.c.logPipelineCall('lead-1', 'job-1', { outcome: 'spoke', nextAt: future }), false);
  for (const h of [noOutcome, missing, viewer]) {
    assert.equal(h.calls.saves, 0);
    assert.equal(h.state.calendarTasks.length, 0);
  }
  // A decision date that is not a date is ignored rather than stored.
  const odd = calling();
  await odd.c.logPipelineCall('lead-1', 'job-1', { outcome: 'spoke', nextAt: future, decisionDate: 'soon' });
  assert.equal(odd.state.contacts[0].jobs[0].decisionDate, undefined);
});

test('an old lead with no job of its own is recorded on the lead, and no job is invented for it', async () => {
  const h = calling({ ownJob: false });
  assert.equal(await h.c.logPipelineCall('lead-1', 'job-1', { outcome: 'spoke', nextAt: future }), true);
  assert.equal(h.state.contacts[0].jobs.length, 0);
  assert.equal(h.state.contacts[0].lastTouchOutcome, 'spoke');
  assert.equal(h.state.calendarTasks[0].jobId, '');
  assert.equal(h.calls.updates[0].jobId, '');
});

function markup({ canLog = true, formKey = '', contact = lead('lead-1'), task = null, stage = 'Estimate Sent', attention = { overdue: Boolean(task) } } = {}) {
  const c = load(['pipelineWorklistRowMarkup', 'pipelineDefaultFollowUp'], {
    escapeHtml: (value = '') => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    formatDateTime: (value) => `time(${value})`, dateTimeLocalValue: () => '2026-11-23T09:00',
  });
  vm.runInContext(`pipelineWorklistFormKey = ${JSON.stringify(formKey)};`, c);
  return c.pipelineWorklistRowMarkup({ contact, job: job('job-1', stage, { lastTouchAt: '2026-11-19T10:00:00Z', lastTouchOutcome: 'voicemail', decisionDate: '' }), key: 'lead-1:job-1', task, reasons: ['overdue', 'noDecision'], stage, attention }, canLog);
}

test('each row says who, why and when, with the number to call', () => {
  const html = markup({ task: { title: 'Call back', dueAt: '2026-11-18T09:00' } });
  assert.match(html, /<strong>TEST lead-1<\/strong>/);
  assert.match(html, /href="tel:2395550100"/);
  assert.match(html, /Follow-up overdue/);
  assert.match(html, /No decision date/);
  assert.match(html, /Next: Call back · time\(2026-11-18T09:00\)/);
  assert.match(html, /Last call: time\(2026-11-19T10:00:00Z\) · Left a voicemail/);
  assert.match(html, /data-pipeline-log-call="lead-1:job-1"/);
  assert.doesNotMatch(html, /data-pipeline-call-form/, 'the form is closed until asked for');
  assert.match(markup({ contact: lead('lead-1', { phone: '' }) }), /No phone number/);
  // Whatever a customer is called, it is shown as text.
  assert.doesNotMatch(markup({ contact: lead('lead-1', { name: '<img src=x onerror=alert(1)>' }) }), /<img/);
});

test('the call form opens in its own row only, and only for someone who may save', () => {
  const open = markup({ formKey: 'lead-1:job-1', task: { title: 'Call back', dueAt: '2026-11-18T09:00' } });
  assert.match(open, /data-pipeline-call-form data-contact-id="lead-1" data-job-id="job-1"/);
  for (const [id] of [['spoke'], ['voicemail'], ['no-answer'], ['message'], ['not-interested']]) assert.match(open, new RegExp(`<option value="${id}">`));
  assert.match(open, /name="nextAt" value="2026-11-23T09:00"/);
  assert.match(open, /name="decisionDate"/, 'an estimate that is out asks when the customer will decide');
  assert.match(open, /name="completeTask" checked/, 'an overdue task is offered as done');
  assert.match(open, /name="noFollowUp"/);
  assert.doesNotMatch(markup({ formKey: 'lead-1:job-1', stage: 'Inspection' }), /name="decisionDate"/);
  assert.doesNotMatch(markup({ formKey: 'lead-1:job-1' }), /name="completeTask"/, 'nothing to finish when no task is open');
  assert.doesNotMatch(markup({ formKey: 'another:row' }), /data-pipeline-call-form/);
  const viewer = markup({ canLog: false, formKey: 'lead-1:job-1' });
  assert.doesNotMatch(viewer, /data-pipeline-call-form|data-pipeline-log-call/);
});
