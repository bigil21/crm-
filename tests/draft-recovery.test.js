const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { create } = require('../draft-recovery');
function memory() {
  const data = new Map();
  return { get length() { return data.size; }, key: i => [...data.keys()][i], getItem: k => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) };
}
const options = { companyId: 'company-a', userId: 'sales', sessionId: 'page-a' };
test('an interrupted draft survives reloading without replaying shared writes', () => {
  const storage = memory();
  const draft = { contacts: [{ id: 'one', notes: 'new, not yet saved' }] };
  assert.equal(create({ ...options, storage }).capture(draft), true);
  const reopened = create({ ...options, storage, sessionId: 'page-b' });
  const entries = reopened.list().entries;
  assert.equal(entries.length, 1);
  assert.deepEqual(JSON.parse(entries[0].raw).state, draft);
  reopened.settle();
  assert.equal(reopened.list().entries.length, 1);
});
test('recovery is scoped to company and signed-in user', () => {
  const storage = memory();
  create({ ...options, storage }).capture({ notes: 'private' });
  for (const identity of [{ userId: 'another-user' }, { companyId: 'company-b' }]) {
    const other = create({ ...options, storage, ...identity });
    assert.equal(other.list().entries.length, 0);
    other.acknowledge(create({ ...options, storage }).list().entries);
  }
  assert.equal(storage.length, 1);
});
test('settling one tab never deletes a different tab draft', () => {
  const storage = memory();
  const first = create({ ...options, storage });
  const second = create({ ...options, storage, sessionId: 'page-b' });
  first.capture({ value: 1 }); second.capture({ value: 2 }); first.settle();
  assert.equal(second.list().entries.length, 1);
  assert.equal(JSON.parse(second.list().entries[0].raw).state.value, 2);
});
test('acknowledging an exported copy does not erase later typing in another tab', () => {
  const storage = memory();
  const first = create({ ...options, storage });
  first.capture({ notes: 'first draft' });
  const exported = first.list().entries;
  first.capture({ notes: 'more typing' });
  first.acknowledge(exported);
  assert.equal(first.list().entries.length, 1);
  first.acknowledge(first.list().entries);
  assert.equal(storage.length, 0);
});
test('malformed recovery copies remain exportable', () => {
  const storage = memory();
  storage.setItem('jobcrest-pending:v1:company-a:sales:old', '{broken json');
  assert.equal(create({ ...options, storage }).list().entries[0].raw, '{broken json');
});
test('quota failure retains the previous copy and reports failure', () => {
  const storage = memory();
  const recovery = create({ ...options, storage });
  recovery.capture({ notes: 'previous' });
  storage.setItem = () => { throw Error('quota'); };
  assert.equal(recovery.capture({ notes: 'new' }), false);
  assert.equal(JSON.parse(recovery.list().entries[0].raw).state.notes, 'previous');
});
test('denied storage does not crash the app or pretend a recovery copy exists', () => {
  const recovery = create(options);
  assert.equal(recovery.capture({}), false);
  assert.equal(recovery.list().available, false);
  assert.equal(recovery.settle(), false);
});
test('typing checkpoints reuse an already serialized cache snapshot', () => {
  const recovery = create({ ...options, storage: memory() });
  const original = { contacts: [{ id: 'lead', notes: 'quotes " and newlines\nremain exact' }] };
  assert.equal(recovery.captureSerialized(JSON.stringify(original)), true);
  assert.deepEqual(JSON.parse(recovery.list().entries[0].raw).state, original);
});
test('app only retires its draft after all current changes are acknowledged', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const fn = source.match(/^function checkpointPendingDraft\([^]*?^}/m)[0];
  let captured = 0, settled = 0, pending = true;
  const context = vm.createContext({ draftRecoveryStore: { capture() { captured++; return true; }, settle() { settled++; } },
    durableRecordsReady: true, applyingCloudState: false, durableWriteBlocked: false,
    durableSaveInFlight: true, cloudSaveInFlight: false, hasPendingCompanyChanges: () => false, hasPendingDurableChanges: () => pending, state: {}, showDraftStorageWarning() {} });
  vm.runInContext(fn, context);
  context.checkpointPendingDraft();
  assert.equal(captured, 1);
  pending = false;
  context.checkpointPendingDraft();
  assert.equal(settled, 0);
  context.durableSaveInFlight = false;
  context.checkpointPendingDraft();
  assert.equal(settled, 1);
  context.durableWriteBlocked = true;
  context.checkpointPendingDraft();
  assert.equal(captured, 2);
});
