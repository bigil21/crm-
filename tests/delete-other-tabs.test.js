// One person deleting a lead must not pause saving for anyone (QA 78).
// Seen on the live site while clearing test leads, then reproduced with two
// browser sessions: a tab that heard a lead had been deleted dropped the lead
// but kept its job on the list of records it held, sent its own delete for
// that job with an out-of-date version, was refused, and paused saving.
// Nothing here touches a network or a real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create } = require('../record-writes.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function load(names, globals = {}) {
  const context = vm.createContext({ console: { warn() {} }, ...globals });
  for (const name of names) {
    const match = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    assert.ok(match, `Function ${name} exists`);
    vm.runInContext(match[0], context);
  }
  return context;
}
const key = (row) => `${row.record_type}:${row.id}`;

// A tab holding one lead with a job and a loaded file, another lead, and an estimate.
function tab() {
  const calls = { reloads: 0, saves: 0, remembered: [] };
  const state = {
    contacts: [
      { id: 'lead-1', jobs: [{ id: 'job-1' }], documents: [{ id: 'doc-1' }] },
      { id: 'lead-2', jobs: [{ id: 'job-2' }], documents: [] },
    ],
    estimates: [{ id: 'est-1', contactId: 'lead-1' }], calendarTasks: [], companyDocuments: [],
    company: { documentCategories: [] },
  };
  const held = () => [
    ...state.contacts.flatMap((contact) => [`contact:${contact.id}`, ...contact.jobs.map((job) => `job:${job.id}`), ...contact.documents.map((document) => `document:${document.id}`)]),
    ...state.estimates.map((estimate) => `estimate:${estimate.id}`),
  ];
  const fingerprints = new Map(held().map((name) => [name, 'saved']));
  const baseline = new Map(held().map((name) => [name, {}]));
  const c = load(['applyDurableRealtimeRecord', 'handleDurableRecordEvent'], {
    state, durableUnmappedRows: [], durableChangeCounter: 0, durableSaveInFlight: false,
    durableRecordFingerprints: fingerprints, durableFinancialBaseline: baseline,
    COMPANY_DOCUMENT_LEAD_ID: '__company__', durableRecordKey: key,
    normalizeContact: (contact) => contact, normalizeJob: (job) => job, normalizeDocument: (document) => document,
    normalizeEstimate: (estimate) => estimate, normalizeCalendarTask: (task) => task,
    invalidateDurableProjection() {}, durableProjectedRow: () => ({ data: {} }), durableFingerprint: () => 'saved',
    getDurableCommitWriter: () => ({ remember: (rows) => calls.remembered.push(...rows.map((row) => `${key(row)}@${row.version}`)) }),
    saveState() {}, renderDurableUpdateWhenIdle() {},
    consumeRecentLocalDurableEcho: () => false,
    // What the tab thinks it has removed and must delete: held, but no longer on screen.
    hasPendingDurableChanges: () => [...fingerprints.keys()].some((name) => !held().includes(name)),
    queueDurableRecordsSave: () => { calls.saves += 1; }, queueDurableRecordsReload: () => { calls.reloads += 1; },
  });
  const removed = (type, id, leadId) => ({ record_type: type, id, lead_id: leadId, version: 2, deleted_at: '2026-11-22T21:07:23Z', data: {} });
  const hear = (row) => c.handleDurableRecordEvent({ eventType: 'UPDATE', new: row, old: { id: row.id } });
  return { c, calls, state, fingerprints, baseline, removed, hear, wouldDelete: () => [...fingerprints.keys()].filter((name) => !held().includes(name)) };
}

test('hearing that a lead was deleted leaves the tab with nothing of its own to delete', () => {
  const t = tab();
  t.hear(t.removed('contact', 'lead-1', 'lead-1'));
  assert.deepEqual(Array.from(t.state.contacts, (contact) => contact.id), ['lead-2']);
  // Before the fix the job and the file stayed on the list, and this was ['job:job-1', 'document:doc-1'].
  assert.deepEqual(t.wouldDelete(), [], 'the lead\'s job and file are forgotten with it');
  assert.equal(t.baseline.has('job:job-1'), false);
  assert.equal(t.baseline.has('document:doc-1'), false);
  assert.equal(t.fingerprints.has('job:job-2'), true, 'another lead\'s job is untouched');

  // The job's and the file's own notices arrive next. They are taken as read:
  // no save is queued, and the records are not all read again for them.
  t.hear(t.removed('job', 'job-1', 'lead-1'));
  t.hear(t.removed('document', 'doc-1', 'lead-1'));
  assert.equal(t.calls.saves, 0, 'the tab queued a save of its own');
  assert.equal(t.calls.reloads, 0);
  assert.deepEqual(t.calls.remembered, ['contact:lead-1@2', 'job:job-1@2', 'document:doc-1@2'], 'their new versions are noted');
  assert.equal(t.c.durableChangeCounter, 3, 'each one moves the tab on, so an older read is not applied over it');
});

test('a job or file that is not deleted, for a lead the tab does not have, still asks for a fresh read', () => {
  const t = tab();
  assert.equal(t.c.applyDurableRealtimeRecord({ record_type: 'job', id: 'job-9', lead_id: 'lead-unknown', version: 1, deleted_at: null, data: {} }, 'INSERT'), false);
  assert.equal(t.c.applyDurableRealtimeRecord({ record_type: 'document', id: 'doc-9', lead_id: 'lead-unknown', version: 1, deleted_at: null, data: {} }, 'INSERT'), false);
  assert.equal(t.c.durableChangeCounter, 0);
  // And a deleted job of a lead that is on screen is still taken off it.
  assert.equal(t.c.applyDurableRealtimeRecord(t.removed('job', 'job-2', 'lead-2'), 'UPDATE'), true);
  assert.equal(t.state.contacts.find((contact) => contact.id === 'lead-2').jobs.length, 0);
  assert.equal(t.fingerprints.has('job:job-2'), false);
});

// ---- A refresh that started before a save.
function refresh({ force = false } = {}) {
  const calls = { applied: 0, requeued: 0, reads: 0 };
  const holds = [];
  const c = load(['reloadDurableRecords'], {
    durableWriteBlocked: false, localEditRevision: 0, durableChangeCounter: 0, durableSaveInFlight: false, applyingCloudState: false,
    hasPendingDurableChanges: () => false,
    fetchDurableRows: () => new Promise((resolve) => { calls.reads += 1; holds.push(() => resolve({ rows: [{ record_type: 'contact', id: 'lead-1' }], auditRows: [] })); }),
    applyDurableRows: () => { calls.applied += 1; }, rememberDurableRows() {}, saveState() {},
    queueDurableRecordsReload: () => { calls.requeued += 1; },
  });
  return { c, calls, release: () => holds.shift()(), pending: c.reloadDurableRecords({ force }) };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('a refresh that was reading when a save was confirmed is thrown away and read again later', async () => {
  const r = refresh();
  r.c.durableChangeCounter += 1; // a delete of this tab's is confirmed while the read is out
  r.release();
  assert.equal(await r.pending, null);
  assert.equal(r.calls.applied, 0, 'the older picture was not put on screen');
  assert.equal(r.calls.requeued, 1);
});

test('a refresh with nothing happening meanwhile is applied as before', async () => {
  const r = refresh();
  r.release();
  assert.equal((await r.pending).length, 1);
  assert.equal(r.calls.applied, 1);
  assert.equal(r.calls.requeued, 0);
});

test('a refresh that must go through reads again until nothing has moved, and does not give up', async () => {
  const r = refresh({ force: true });
  r.c.durableChangeCounter += 1;
  r.release();
  await tick();
  assert.equal(r.calls.reads, 2, 'it read again');
  assert.equal(r.calls.applied, 0);
  r.release();
  assert.equal((await r.pending).length, 1);
  assert.equal(r.calls.applied, 1);
  // The first full load at start-up is held to the same rule.
  assert.match(source.match(/^async function ensureCompleteCoreRecordsLoaded\([^]*?^}/m)[0], /counter !== durableChangeCounter/);
  assert.match(source.match(/^function getDurableCommitWriter\([^]*?^}/m)[0], /onAcknowledged: \(changes, auditIds\) => \{\s*durableChangeCounter \+= 1;/);
});

// ---- The save itself: deleting what is already gone is done, not a conflict.
function saving({ server }) {
  const requests = [];
  const acknowledged = [];
  let blocked = null;
  const writer = create({
    requestId: () => `request-${requests.length + 1}`,
    fetchCurrent: async (changes) => changes.map((change) => server[key(change)]).filter(Boolean),
    onAcknowledged: (changes) => acknowledged.push(...changes.map((change) => `${change.operation} ${key(change)}`)),
    onBlocked: (value) => { blocked = value; },
    rpc: async (_name, payload) => {
      requests.push(JSON.parse(JSON.stringify(payload)));
      const stale = payload.p_changes.find((change) => change.expected_version !== (server[key(change)]?.version || 0));
      if (stale) return { data: null, error: { code: 'PT409', message: 'record_conflict' } };
      const rows = payload.p_changes.map((change) => {
        const row = { ...change, version: change.expected_version + 1, deleted_at: change.operation === 'delete' ? '2026-11-22T21:07:23Z' : null };
        server[key(change)] = { record_type: change.record_type, id: change.id, company_state_id: change.company_state_id, version: row.version, deleted_at: row.deleted_at, data: change.data || {} };
        return row;
      });
      return { data: { rows, audit_ids: [] }, error: null };
    },
  });
  return { writer, requests, acknowledged, blocked: () => blocked };
}
const row = (type, id, data) => ({ record_type: type, id, company_state_id: 'coastal-crest', ...(data ? { data } : {}) });

test('a delete of a record someone else already deleted is settled quietly', async () => {
  const server = { 'job:job-1': { record_type: 'job', id: 'job-1', company_state_id: 'coastal-crest', version: 2, deleted_at: '2026-11-22T21:07:23Z', data: {} } };
  const s = saving({ server });
  s.writer.remember([{ record_type: 'job', id: 'job-1', version: 1, data: {} }]);
  const result = await s.writer.commit([], [], [row('job', 'job-1')]);
  assert.equal(result.error, null);
  assert.equal(s.blocked(), null, 'saving is not paused');
  assert.equal(s.writer.blocked, null);
  assert.equal(s.requests.length, 1, 'it was turned away once and nothing more needed sending');
  assert.deepEqual(s.acknowledged, ['delete job:job-1'], 'the tab is told the delete is done');
  assert.equal(s.writer.getVersion({ record_type: 'job', id: 'job-1' }), 2);
});

test('the rest of the same save still goes through', async () => {
  const server = {
    'job:job-1': { record_type: 'job', id: 'job-1', company_state_id: 'coastal-crest', version: 2, deleted_at: '2026-11-22T21:07:23Z', data: {} },
    'contact:lead-2': { record_type: 'contact', id: 'lead-2', company_state_id: 'coastal-crest', version: 1, deleted_at: null, data: { name: 'Before' } },
  };
  const s = saving({ server });
  s.writer.remember([{ record_type: 'job', id: 'job-1', version: 1, data: {} }, { record_type: 'contact', id: 'lead-2', version: 1, data: { name: 'Before' } }]);
  const result = await s.writer.commit([row('contact', 'lead-2', { name: 'After' })], [], [row('job', 'job-1')]);
  assert.equal(result.error, null);
  assert.equal(s.requests.length, 2);
  assert.deepEqual(s.requests[1].p_changes.map((change) => `${change.operation} ${key(change)}`), ['upsert contact:lead-2'], 'sent again without the delete that was already done');
  assert.notEqual(s.requests[1].p_request_id, s.requests[0].p_request_id);
  assert.equal(server['contact:lead-2'].data.name, 'After');
  assert.deepEqual(s.acknowledged.sort(), ['delete job:job-1', 'upsert contact:lead-2']);
  assert.equal(s.blocked(), null);
});

test('a delete of a record someone else only changed still deletes it, at its new version', async () => {
  const server = { 'job:job-1': { record_type: 'job', id: 'job-1', company_state_id: 'coastal-crest', version: 3, deleted_at: null, data: { note: 'changed by someone else' } } };
  const s = saving({ server });
  s.writer.remember([{ record_type: 'job', id: 'job-1', version: 1, data: {} }]);
  const result = await s.writer.commit([], [], [row('job', 'job-1')]);
  assert.equal(result.error, null);
  assert.deepEqual(s.requests.map((request) => request.p_changes[0].expected_version), [1, 3]);
  assert.ok(server['job:job-1'].deleted_at);
  assert.deepEqual(s.acknowledged, ['delete job:job-1']);
});
