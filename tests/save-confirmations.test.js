const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { create } = require('../record-writes.js');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness(rows, names) {
  const sent = deferred(), response = deferred();
  let calls = 0, savedPayload;
  const context = vm.createContext({
    console, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout,
    window: { CrmRecordWrites: { create }, setTimeout, clearTimeout },
    durableRecordsReady: true, durableSaveInFlight: false, durableWriteBlocked: false,
    durableCommitWriter: null, durableSaveTimer: null,
    durableRecordFingerprints: new Map(), durableAuditIds: new Set(), durableFinancialBaseline: new Map(),
    durableRecordKey: row => `${row.record_type}:${row.id}`, authSession: { user: { id: 'tester' } },
    cloudClient: { rpc: async (_name, payload) => { calls++; savedPayload = clone(payload); sent.resolve(); return response.promise; } },
    waitForDurableSaveSlot: async () => true, canUseCloudSync: () => true,
    checkpointPendingDraft() {}, preserveBlockedDurableWrite() {}, queueCloudSave() {}, queueDurableRecordsSave() {},
    markRecentLocalDurableWrite() {}, clearRecentLocalDurableWrite() {},
    durableAuditRowsFromState: () => [], COMPANY_DOCUMENT_LEAD_ID: 'company',
  });
  for (const name of ['durableRecordData', 'durableFingerprint', 'canonicalRecordValue', 'durableRecordDataMatches', 'getDurableCommitWriter', 'commitDurableChanges', ...names]) {
    const match = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    assert.ok(match, name); vm.runInContext(match[0], context);
  }
  context.durableRowsFromState = () => rows.map(row => ({ ...row, data: context.durableRecordData(row.data) }));
  context.getDurableCommitWriter().remember(rows);
  return { context, sent: sent.promise, acknowledge() {
    response.resolve({ data: { rows: savedPayload.p_changes.map(row => ({ ...clone(row), version: row.expected_version + 1, deleted_at: null })), audit_ids: [] }, error: null });
  }, get calls() { return calls; }, get payload() { return savedPayload; } };
}

const cases = [
  { label: 'checkbox', type: 'contact', names: ['persistDurableRecordNow'], data: { workflowChecklists: { first: true, second: false } },
    run: c => c.persistDurableRecordNow('contact', 'target', d => d.workflowChecklists.first), mutate: d => { d.workflowChecklists.second = true; } },
  { label: 'estimate line item', type: 'estimate', names: ['persistDurableRecordNow', 'persistEstimateRecord'], data: { items: [{ quantity: 1, rate: 100 }] },
    run: c => c.persistEstimateRecord('target'), mutate: d => { d.items[0].rate = 200; } },
  { label: 'profit/cost', type: 'job', names: ['persistProfitCostRecord'], data: { costItems: [{ id: 'cost', amount: 50.38 }] },
    run: c => c.persistProfitCostRecord('target', 'cost'), mutate: d => { d.costItems[0].amount = 80.99; } },
  { label: 'manual payment', type: 'job', names: ['persistManualPaymentRecord'], data: { manualPayments: [{ id: 'payment', amount: 100 }], costItems: [{ amount: 5 }] },
    run: c => c.persistManualPaymentRecord('target', 'payment', true), mutate: d => { d.costItems[0].amount = 10; } },
  { label: 'lead/job', type: 'job', names: ['persistLeadJobRecord'], data: { status: 'Inspection', costItems: [{ amount: 5 }] },
    run: c => c.persistLeadJobRecord('target'), mutate: d => { d.costItems[0].amount = 10; } },
  { label: 'lead document', type: 'document', names: ['persistLeadDocumentRecords'], data: { previousVersions: [{ fileName: 'old.pdf' }] },
    run: c => c.persistLeadDocumentRecords(['target']), mutate: d => { d.previousVersions[0].fileName = 'edited.pdf'; } },
  { label: 'company document', type: 'document', lead: 'company', names: ['persistCompanyDocumentRecords'], data: { previousVersions: [{ fileName: 'old.pdf' }] },
    run: c => c.persistCompanyDocumentRecords(['target']), mutate: d => { d.previousVersions[0].fileName = 'edited.pdf'; } },
];
for (const scenario of cases) test(`${scenario.label}: edits during a save remain dirty after the first confirmation`, async () => {
  const row = { company_state_id: 'coastal-crest', record_type: scenario.type, id: 'target', lead_id: scenario.lead || 'lead', job_id: null, owner_id: 'tester', version: 1, data: clone(scenario.data), deleted_at: null };
  const h = harness([row], scenario.names);
  const pending = scenario.run(h.context);
  await h.sent;
  const transmitted = clone(h.payload.p_changes[0]);
  scenario.mutate(row.data);
  h.acknowledge();
  assert.equal(await pending, true, 'the captured version was confirmed');
  const acknowledged = h.context.durableRecordFingerprints.get(`${scenario.type}:target`);
  assert.equal(acknowledged, h.context.durableFingerprint(transmitted), 'only transmitted data may be confirmed');
  assert.notEqual(acknowledged, h.context.durableFingerprint(h.context.durableRowsFromState()[0]), 'later input still needs another save');
  assert.equal(h.calls, 1);
});

test('deletion made during an unrelated save is queued after confirmation', async () => {
  const rows = ['first', 'delete-later'].map(id => ({ company_state_id: 'coastal-crest', record_type: 'estimate', id,
    lead_id: 'lead', job_id: null, owner_id: 'tester', version: 1, data: { title: id }, deleted_at: null }));
  const h = harness(rows, ['hasPendingDurableChanges', 'flushDurableRecordsSave']);
  const c = h.context;
  c.supabaseStateId = () => 'coastal-crest';
  c.durableRecordFingerprints = new Map(rows.map(row => [c.durableRecordKey(row), c.durableFingerprint(row)]));
  let queued = 0;
  c.queueDurableRecordsSave = () => { queued++; };
  rows[0].data.title = 'Changed';
  const first = c.flushDurableRecordsSave();
  await h.sent;
  rows.pop();
  assert.equal(await c.flushDurableRecordsSave(), false, 'timer fires while first save is in flight');
  h.acknowledge();
  assert.equal(await first, true);
  assert.equal(c.hasPendingDurableChanges(), true, 'removal remains pending');
  assert.equal(queued, 1, 'completion schedules pending removal');
});
