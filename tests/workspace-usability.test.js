const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

function load(names, globals = {}) {
  const context = vm.createContext(globals);
  for (const name of names) {
    const match = source.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'));
    assert.ok(match, name);
    vm.runInContext(match[0], context);
  }
  return context;
}

const lead = {
  id: 'lead-1', name: 'José Rivera', phone: '(239) 555-0123', email: 'jose@example.com',
  leadNumber: 'LD-20261001-123456', address: '10 Oak Street',
  jobs: [{ id: 'job-1', name: 'Roof replacement', address: '10 Oak Street', projectNumber: 'PR-100' },
    { id: 'job-2', name: 'Window repair', address: '42 Pine Avenue, Naples', projectNumber: 'PR-200' }],
};

function searchContext() {
  return load(['normalizeLeadSearch', 'contactSearchFields', 'contactMatchesSearch',
    'searchResultJob', 'liveLeadSearchMatches', 'filteredContacts'], {
    state: { search: '', contacts: [lead, { id: 'private', name: 'Hidden customer', jobs: [] }] },
    visibleContacts: () => [lead], contactJobs: contact => contact.jobs || [],
    money: { format: value => `$${value}` }, number: value => Number(value) || 0,
  });
}

test('pasted phones match regardless of punctuation, spacing or partial digits', () => {
  const c = searchContext();
  for (const query of ['2395550123', '239-555-0123', '(239) 555 0123', '5550123']) {
    assert.equal(c.liveLeadSearchMatches(query).matches[0]?.id, 'lead-1', query);
  }
  assert.equal(c.liveLeadSearchMatches('2395559999').total, 0);
});

test('names, accents and multiple search words use the same rules in results and lists', () => {
  const c = searchContext();
  for (const query of ['Jose', 'Rivera Jose', 'Jose Naples', 'Pine Window', 'PR200', 'LD20261001123456']) {
    c.state.search = query;
    assert.equal(c.liveLeadSearchMatches().matches[0]?.id, 'lead-1', query);
    assert.equal(c.filteredContacts()[0]?.id, 'lead-1', query);
  }
  assert.equal(c.liveLeadSearchMatches('  ').total, 0);
});

test('search selects the matching secondary job and never searches hidden contacts', () => {
  const c = searchContext();
  assert.equal(c.searchResultJob(lead, 'Naples').id, 'job-2');
  assert.equal(c.searchResultJob(lead, 'Jose Pine').id, 'job-2');
  assert.equal(c.liveLeadSearchMatches('Hidden').total, 0);
});

test('search limits results while retaining the real total and prioritizing exact names', () => {
  const c = searchContext();
  c.visibleContacts = () => [{ ...lead, id: 'prefix', name: 'Jose Rivera Construction' }, lead];
  const result = c.liveLeadSearchMatches('Jose Rivera', 1);
  assert.equal(result.total, 2);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].id, 'lead-1');
});

function reminderContext(tasks = [], estimates = [], canSeeEstimates = true) {
  return load(['localTimestamp', 'followUpSummary'], {
    visibleCalendarTasks: () => tasks,
    visibleEstimates: () => estimates,
    canView: () => canSeeEstimates,
    getEstimateJob: estimate => estimate.job,
  });
}

test('reminders separate overdue, today, upcoming, undated and completed tasks', () => {
  const due = hour => new Date(2026, 9, 27, hour).toISOString();
  const tasks = [
    { id: 'late', dueAt: due(9) }, { id: 'now', dueAt: due(10) },
    { id: 'today', dueAt: due(18) }, { id: 'tomorrow', dueAt: new Date(2026, 9, 28).toISOString() },
    { id: 'complete', dueAt: due(8), completed: true }, { id: 'undated', dueAt: 'invalid' },
  ];
  const before = JSON.stringify(tasks);
  const result = reminderContext(tasks).followUpSummary(new Date(2026, 9, 27, 10));
  assert.deepEqual(Array.from(result.overdue, t => t.id), ['late']);
  assert.deepEqual(Array.from(result.today, t => t.id), ['now', 'today']);
  assert.deepEqual(Array.from(result.upcoming, t => t.id), ['tomorrow']);
  assert.deepEqual(Array.from(result.completed, t => t.id), ['complete']);
  assert.deepEqual(Array.from(result.undated, t => t.id), ['undated']);
  assert.equal(JSON.stringify(tasks), before, 'displaying reminders must not modify task data');
});

test('estimate follow-ups include only sent estimates at least three local calendar days old', () => {
  const estimates = [
    { id: 'old', status: 'Sent', issueDate: '2026-10-24' },
    { id: 'recent', status: 'Sent', issueDate: '2026-10-25' },
    { id: 'future', status: 'Sent', issueDate: '2026-10-28' },
    { id: 'draft', status: 'Draft', issueDate: '2026-10-01' },
    { id: 'invalid', status: 'Sent', issueDate: 'invalid' },
    { id: 'already-sold', status: 'Sent', issueDate: '2026-10-01', job: { status: 'Won' } },
  ];
  const before = JSON.stringify(estimates);
  const c = reminderContext([], estimates);
  assert.deepEqual(Array.from(c.followUpSummary(new Date(2026, 9, 27, 10)).estimates, e => e.id), ['old']);
  assert.equal(JSON.stringify(estimates), before);
});

test('estimate follow-ups use the actual sent date when present and handle daylight saving boundaries', () => {
  const c = reminderContext([], [
    { id: 'resent', status: 'Sent', issueDate: '2026-10-01', sentAt: new Date(2026, 10, 1, 10).toISOString() },
    { id: 'three-days', status: 'Sent', issueDate: '2026-10-30' },
  ]);
  assert.deepEqual(Array.from(c.followUpSummary(new Date(2026, 10, 2, 10)).estimates, e => e.id), ['three-days']);
});

test('roles without estimate access never get estimate reminders', () => {
  const c = reminderContext([], [{ id: 'hidden', status: 'Sent', issueDate: '2026-10-01' }], false);
  c.visibleEstimates = () => { throw Error('must not inspect estimate data'); };
  assert.equal(c.followUpSummary(new Date(2026, 9, 27)).estimates.length, 0);
});

test('marking an estimate Sent starts a fresh reminder clock without resetting it on other edits', () => {
  const estimate = { id: 'estimate-1', status: 'Draft', sentAt: '2026-01-01' };
  const c = load(['updateSelectedEstimateFromField'], {
    canAction: () => true, canUseCloudSync: () => false, getSelectedEstimate: () => estimate,
    syncEstimatePipelineStage() {}, queueLocalStateSave() {}, queueEstimateVerifiedSave() {}, scheduleEstimateVisualRefresh() {},
  });
  const before = Date.now();
  c.updateSelectedEstimateFromField('status', 'Sent');
  assert.ok(Date.parse(estimate.sentAt) >= before);
  const sentAt = estimate.sentAt;
  c.updateSelectedEstimateFromField('projectTitle', 'Updated scope');
  c.updateSelectedEstimateFromField('status', 'Sent');
  assert.equal(estimate.sentAt, sentAt);
});

test('sidebar toggles update accessibility and save only a local UI preference', () => {
  let width = 1280;
  let saves = 0;
  const shell = { dataset: {} };
  const button = { attributes: {}, focus() {}, setAttribute(name, value) { this.attributes[name] = value; } };
  const backdrop = {};
  const workspace = { inert: false };
  const c = load(['renderSidebar', 'setSidebarMode'], {
    state: { sidebarMode: 'auto' }, saveUiState: () => { saves++; },
    document: { querySelector: selector => selector === '.app-shell' ? shell : selector === '.workspace' ? workspace : button, getElementById: id => id === 'sidebarBackdrop' ? backdrop : button },
    window: { matchMedia: query => ({ matches: query.includes('min-width') ? width >= 1441 : width <= 820 }) },
  });
  c.renderSidebar();
  assert.equal(button.attributes['aria-expanded'], 'false');
  c.setSidebarMode('expanded');
  assert.equal(button.attributes['aria-expanded'], 'true');
  assert.equal(button.attributes['aria-label'], 'Collapse navigation');
  assert.equal(backdrop.hidden, true);
  width = 390;
  c.renderSidebar();
  assert.equal(backdrop.hidden, false);
  assert.equal(workspace.inert, true);
  c.setSidebarMode('compact');
  assert.equal(backdrop.hidden, true);
  assert.equal(workspace.inert, false);
  assert.equal(saves, 2);
});
