// Two people editing the same estimate (to-do item 8, QA 76).
// Found by the two-person release workflow test: a rep and the office each
// added a line; the save that came second replaced the whole list of lines,
// so the other person's line silently disappeared, and the person whose lines
// survived was told "Not saved". Lines now have ids and are combined one by one.
// Nothing here touches a network or a real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create, mergeRecordData } = require('../record-writes.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function load(names, globals = {}) {
  let next = 0;
  const context = vm.createContext({ console: { warn() {} }, uid: (prefix) => `${prefix}-random-${(next += 1)}`, ...globals });
  for (const name of names) {
    const match = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    assert.ok(match, `Function ${name} exists`);
    vm.runInContext(match[0], context);
  }
  return context;
}
const line = (title, quantity = 1, rate = 100, extra = {}) => ({ title, description: '', quantity, unit: 'ea', rate, ...extra });
const plain = (value) => JSON.parse(JSON.stringify(value));
const titles = (items) => Array.from(items, (item) => item.title);
const SAVED = [line('Tear off'), line('Shingles'), line('Decking'), line('Permit')]; // as stored before ids existed

test('lines saved before ids existed get the same ids on every device', () => {
  const ids = load(['ensureEstimateLineIds']);
  const first = plain(ids.ensureEstimateLineIds(SAVED));
  const second = plain(load(['ensureEstimateLineIds']).ensureEstimateLineIds(SAVED));
  assert.deepEqual(first.map((item) => item.id), ['line-1', 'line-2', 'line-3', 'line-4']);
  assert.deepEqual(first, second, 'another device gives the same lines the same ids');
  assert.deepEqual(titles(first), titles(SAVED), 'nothing else about a line changes');
  // Ids that are already there are kept, and the list is returned untouched.
  assert.equal(ids.ensureEstimateLineIds(first), first);
});

test('a line without an id among lines that have them gets one no other line could have', () => {
  const ids = load(['ensureEstimateLineIds']);
  const mixed = plain(ids.ensureEstimateLineIds([{ ...line('A'), id: 'line-1' }, line('New, added by code that gave it no id'), { ...line('C'), id: 'line-3' }]));
  assert.deepEqual(mixed.map((item) => item.id), ['line-1', 'line-random-1', 'line-3']);
  // Two lines that somehow share an id are told apart.
  const twins = plain(ids.ensureEstimateLineIds([{ ...line('A'), id: 'x' }, { ...line('B'), id: 'x' }]));
  assert.equal(new Set(twins.map((item) => item.id)).size, 2);
  assert.equal(twins[0].id, 'x');
  assert.deepEqual(plain(ids.ensureEstimateLineIds(undefined)), []);
});

// What the save does when the database says someone else saved first: it
// combines three copies. All three go through the same id step.
function combine({ loaded, mine, theirs }) {
  const c = load(['ensureEstimateLineIds', 'mergeReadyRecordData']);
  const row = { record_type: 'estimate', id: 'est-1' };
  const ready = (items) => plain(c.mergeReadyRecordData(row, { title: 'Estimate', items }));
  const conflicts = [];
  const merged = mergeRecordData(ready(loaded), ready(mine), ready(theirs), [], conflicts);
  return { items: merged.items, conflicts };
}
const withIds = (items) => plain(load(['ensureEstimateLineIds']).ensureEstimateLineIds(items));

test('a line each person added is kept, on an estimate saved before ids existed', () => {
  // Both opened the same four lines. The office added a line and saved first.
  const mine = [...withIds(SAVED), { ...line('Ridge vent', 40, 9), id: 'line-rep' }];
  const theirs = [...withIds(SAVED), { ...line('Drip edge', 180, 2.75), id: 'line-office' }];
  const { items, conflicts } = combine({ loaded: SAVED, mine, theirs });
  assert.deepEqual(titles(items), ['Tear off', 'Shingles', 'Decking', 'Permit', 'Drip edge', 'Ridge vent']);
  assert.deepEqual(conflicts, [], 'nothing had to be decided in anyone\'s favour');
  assert.equal(items[4].rate, 2.75);
  assert.equal(items[5].quantity, 40);
});

test('before the fix the same save kept only one person\'s line', () => {
  // The three copies exactly as they were merged before lines had ids.
  const conflicts = [];
  const merged = mergeRecordData({ items: SAVED }, { items: [...SAVED, line('Ridge vent', 40, 9)] }, { items: [...SAVED, line('Drip edge', 180, 2.75)] }, [], conflicts);
  assert.deepEqual(titles(merged.items), ['Tear off', 'Shingles', 'Decking', 'Permit', 'Ridge vent'], 'the office\'s line is gone');
  assert.deepEqual(conflicts, ['items']);
});

test('one person changing a line and another removing a different one both stand', () => {
  const loaded = withIds(SAVED);
  const mine = loaded.map((item) => (item.title === 'Decking' ? { ...item, quantity: 6, rate: 95.25 } : item));
  const theirs = loaded.filter((item) => item.title !== 'Permit');
  const { items, conflicts } = combine({ loaded: SAVED, mine, theirs });
  assert.deepEqual(titles(items), ['Tear off', 'Shingles', 'Decking']);
  assert.equal(items[2].quantity, 6);
  assert.deepEqual(conflicts, []);
});

test('only when both change the very same line does one of them win, and it says which line', () => {
  const loaded = withIds(SAVED);
  const mine = loaded.map((item) => (item.title === 'Decking' ? { ...item, quantity: 6 } : item));
  const theirs = [...loaded.map((item) => (item.title === 'Decking' ? { ...item, quantity: 4 } : item)), { ...line('Drip edge'), id: 'line-office' }];
  const { items, conflicts } = combine({ loaded: SAVED, mine, theirs });
  assert.equal(items.find((item) => item.title === 'Decking').quantity, 6, 'the person saving now keeps their number on that line');
  assert.ok(titles(items).includes('Drip edge'), 'and the other person\'s other work is still kept');
  assert.deepEqual(conflicts, ['items.line-3.quantity']);
});

test('the copies a save is combined with are prepared the same way, estimates only', () => {
  const body = source.match(/^function getDurableCommitWriter\([^]*?^}/m)[0];
  assert.match(body, /baseFor: \(row\) => mergeReadyRecordData\(row, durableFinancialBaseline\.get\(durableRecordKey\(row\)\)\)/);
  assert.match(body, /fetchCurrent: async \(changes\) => \(await fetchCurrentDurableRows\(changes\)\)\.map\(\(row\) => \(\{ \.\.\.row, data: mergeReadyRecordData\(row, row\.data\) \}\)\)/);
  const c = load(['ensureEstimateLineIds', 'mergeReadyRecordData']);
  const job = { status: 'New', items: [{ title: 'not an estimate line' }] };
  assert.equal(c.mergeReadyRecordData({ record_type: 'job', id: 'j' }, job), job);
  assert.equal(c.mergeReadyRecordData({ record_type: 'estimate', id: 'e' }, undefined), undefined);
  // Every new line is given an id where it is made.
  assert.match(source, /estimate\.items\.push\(\{ id: uid\("line"\), title: "", description: "", quantity: 1, unit: "ea", rate: 0 \}\)/);
  assert.match(source, /tpl\.items\.map\(\(item\) => \(\{ \.\.\.item, id: uid\("line"\) \}\)\)/);
  assert.match(source.match(/^function normalizeEstimate\([^]*?^}/m)[0], /items: ensureEstimateLineIds\(\(estimate\.items \|\| \[\]\)\.map\(normalizeLineItem\)\)/);
});

test('the whole save: the second saver is turned away once, combined, and saved with both lines', async () => {
  const c = load(['ensureEstimateLineIds', 'mergeReadyRecordData']);
  const database = { version: 4, data: { title: 'Estimate', items: SAVED } };
  const requests = [];
  const merged = [];
  let baseline = { title: 'Estimate', items: SAVED }; // what the rep loaded
  const writer = create({
    requestId: () => `request-${requests.length + 1}`,
    baseFor: (row) => c.mergeReadyRecordData(row, baseline),
    fetchCurrent: async () => [{ record_type: 'estimate', id: 'est-1', company_state_id: 'coastal-crest', version: database.version, deleted_at: null, data: plain(c.mergeReadyRecordData({ record_type: 'estimate' }, database.data)) }],
    onMerged: (entries) => merged.push(...entries),
    rpc: async (_name, payload) => {
      requests.push(plain(payload));
      const change = payload.p_changes[0];
      if (change.expected_version !== database.version) return { data: null, error: { code: 'PT409', message: 'record_conflict' } };
      database.version += 1;
      database.data = change.data;
      return { data: { rows: [{ ...change, version: database.version, deleted_at: null }], audit_ids: [] }, error: null };
    },
  });
  writer.remember([{ record_type: 'estimate', id: 'est-1', version: 4, data: { title: 'Estimate', items: SAVED } }]);
  // The office saves first, from its own browser.
  database.version = 5;
  database.data = { title: 'Estimate', items: [...withIds(SAVED), { ...line('Drip edge', 180, 2.75), id: 'line-office' }] };

  const mine = { title: 'Estimate', items: [...withIds(SAVED), { ...line('Ridge vent', 40, 9), id: 'line-rep' }] };
  const result = await writer.commit([{ record_type: 'estimate', id: 'est-1', company_state_id: 'coastal-crest', data: mine }]);
  assert.equal(result.error, null);
  assert.deepEqual(requests.map((request) => request.p_changes[0].expected_version), [4, 5], 'turned away once, then sent on top of the office\'s copy');
  assert.deepEqual(titles(database.data.items), ['Tear off', 'Shingles', 'Decking', 'Permit', 'Drip edge', 'Ridge vent']);
  assert.equal(database.version, 6);
  assert.equal(writer.blocked, null, 'saving is not paused');
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].conflicts, []);
});

test('a save that was combined with a teammate\'s is reported as saved, not as failed', async () => {
  const sent = { title: 'Estimate', items: [{ id: 'line-1', title: 'Tear off' }, { id: 'line-rep', title: 'Ridge vent' }] };
  const came = { title: 'Estimate', items: [{ id: 'line-1', title: 'Tear off' }, { id: 'line-office', title: 'Drip edge' }, { id: 'line-rep', title: 'Ridge vent' }] };
  const run = async ({ combined }) => {
    const c = load(['persistDurableRecordNow', 'persistEstimateRecord'], {
      canUseCloudSync: () => true, durableRecordsReady: true, cloudClient: {}, authSession: { user: { id: 'rep-1' } },
      window: { clearTimeout() {} }, durableSaveTimer: null, durableSaveInFlight: false,
      waitForDurableSaveSlot: async () => true, invalidateDurableProjection() {},
      durableProjectedRow: () => ({ record_type: 'estimate', id: 'est-1', data: sent }),
      markRecentLocalDurableWrite() {}, clearRecentLocalDurableWrite() {}, queueDurableRecordsSave() {}, queueCloudSave() {},
      durableRecordDataMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
      recentlyMergedDurableKeys: new Set(['estimate:est-1']), // left over from an earlier save: must not count
      commitDurableChanges: async () => {
        if (combined) c.recentlyMergedDurableKeys.add('estimate:est-1'); // the writer reports the merge before it returns
        return { data: { rows: [{ record_type: 'estimate', id: 'est-1', data: combined ? came : { title: 'Estimate', items: [] } }] }, error: null };
      },
    });
    return { saved: await c.persistEstimateRecord('est-1'), left: c.recentlyMergedDurableKeys.size };
  };
  assert.deepEqual(await run({ combined: true }), { saved: true, left: 0 });
  // What comes back differing for any other reason is still a failure.
  assert.deepEqual(await run({ combined: false }), { saved: false, left: 0 });
});

// ---- After a combined save: this editor's own copy.
function afterCombinedSave({ sent, memory, saved }) {
  const calls = { applied: [], remembered: [], queued: 0, redrawn: 0, toasts: [] };
  const record = { data: memory };
  const baseline = new Map();
  const fingerprints = new Map();
  const c = load(['ensureEstimateLineIds', 'mergeReadyRecordData', 'sameDurableData', 'applyMergedDurableRows'], {
    window: { CrmRecordWrites: { mergeRecordData } },
    recentlyMergedDurableKeys: new Set(),
    durableProjectedRow: () => ({ record_type: 'estimate', id: 'est-1', data: record.data }),
    applyDurableRealtimeRecord: (row) => { calls.applied.push(plain(row.data)); record.data = row.data; baseline.set('estimate:est-1', row.data); fingerprints.set('estimate:est-1', JSON.stringify(row.data)); },
    durableRecordKey: (row) => `${row.record_type}:${row.id}`,
    durableFinancialBaseline: baseline, durableRecordFingerprints: fingerprints,
    durableFingerprint: (row) => JSON.stringify(row.data),
    getDurableCommitWriter: () => ({ remember: (rows) => calls.remembered.push(...rows) }),
    invalidateDurableProjection() {}, queueDurableRecordsSave: () => { calls.queued += 1; },
    getSelectedEstimate: () => ({ id: 'est-1' }), state: { view: 'estimates' }, els: { estimateForm: { classList: { contains: () => false } } },
    renderEstimateLineItemsKeepingFocus: () => { calls.redrawn += 1; }, scheduleEstimateVisualRefresh() {},
    showToast: (message) => calls.toasts.push(message),
  });
  const row = { record_type: 'estimate', id: 'est-1', version: 6, data: saved };
  c.applyMergedDurableRows([{ key: 'estimate:est-1', row, localData: sent, conflicts: [] }]);
  return { calls, record, baseline, fingerprints, row, context: c };
}
const office = { ...line('Drip edge', 180, 2.75), id: 'line-office' };
const reps = { ...line('Ridge vent', 40, 9), id: 'line-rep' };

test('after a combined save, the saver\'s own copy takes in the teammate\'s line', () => {
  const sent = { title: 'Estimate', items: [...withIds(SAVED), reps] };
  const saved = { title: 'Estimate', items: [...withIds(SAVED), office, reps] };
  const h = afterCombinedSave({ sent, memory: plain(sent), saved });
  assert.deepEqual(titles(h.record.data.items), ['Tear off', 'Shingles', 'Decking', 'Permit', 'Drip edge', 'Ridge vent']);
  assert.equal(h.calls.queued, 0, 'nothing more to save');
  assert.equal(h.calls.redrawn, 1, 'and the open estimate shows the combined lines at once');
  assert.equal(h.context.recentlyMergedDurableKeys.has('estimate:est-1'), true);
  assert.deepEqual(h.calls.toasts, ['A teammate edited this record at the same time. Both sets of changes were saved.']);
});

test('it takes it in even when the saver has typed more since, and that typing is still saved next', () => {
  // The case that erased the office's line: the rep changed a quantity while
  // the save was on its way. Their copy used to be left without the office's
  // line, and their next save removed it from the estimate.
  const sent = { title: 'Estimate', items: [...withIds(SAVED), reps] };
  const typedMore = { title: 'Estimate', items: [...withIds(SAVED), { ...reps, quantity: 55 }] };
  const saved = { title: 'Estimate', items: [...withIds(SAVED), office, reps] };
  const h = afterCombinedSave({ sent, memory: typedMore, saved });
  assert.deepEqual(titles(h.record.data.items), ['Tear off', 'Shingles', 'Decking', 'Permit', 'Drip edge', 'Ridge vent'], 'the office\'s line is in the rep\'s copy');
  assert.equal(h.record.data.items[5].quantity, 55, 'with what the rep typed since');
  // What is recorded as saved is what the database holds, so the newer typing counts as unsaved.
  assert.deepEqual(plain(h.baseline.get('estimate:est-1')), saved);
  assert.equal(h.fingerprints.get('estimate:est-1'), JSON.stringify(saved));
  assert.notEqual(h.fingerprints.get('estimate:est-1'), JSON.stringify(h.record.data));
  assert.equal(h.calls.queued, 1, 'and a save of it is queued');
  assert.deepEqual(h.calls.remembered.map((row) => row.version), [6]);

  // That next save, from the rep's copy, on top of what is saved: nothing of the office's is lost.
  const next = mergeRecordData(plain(h.baseline.get('estimate:est-1')), plain(h.record.data), saved);
  assert.deepEqual(titles(next.items), ['Tear off', 'Shingles', 'Decking', 'Permit', 'Drip edge', 'Ridge vent']);
  assert.equal(next.items[5].quantity, 55);
});

test('typing lands on the line it was typed in, even if a teammate\'s line arrived above it', () => {
  const c = load(['estimateLineIndex']);
  const estimate = { items: [{ id: 'a', title: 'A' }, { id: 'line-office', title: 'Drip edge' }, { id: 'b', title: 'B' }] };
  // The row on screen was drawn as the second line, before the office's line arrived.
  assert.equal(c.estimateLineIndex(estimate, { dataset: { lineIndex: '1', lineId: 'b' } }), 2);
  assert.equal(c.estimateLineIndex(estimate, { dataset: { lineIndex: '0', lineId: 'a' } }), 0);
  // The line the row showed has been removed by a teammate: nothing is edited.
  assert.equal(c.estimateLineIndex(estimate, { dataset: { lineIndex: '1', lineId: 'gone' } }), -1);
  // Rows drawn without ids fall back to their position.
  assert.equal(c.estimateLineIndex({ items: [{ title: 'A' }, { title: 'B' }] }, { dataset: { lineIndex: '1', lineId: '' } }), 1);
  assert.equal(c.estimateLineIndex(estimate, { dataset: { lineIndex: '2' } }), 2);
  // Each row on screen carries its line's id, and the editor uses it.
  assert.match(source.match(/^function estimateLineItemMarkup\([^]*?^}/m)[0], /data-line-index="\$\{index\}" data-line-id="\$\{escapeHtml\(item\.id \?\? ""\)\}"/);
  assert.match(source.match(/^function updateLineItem\([^]*?^}/m)[0], /const index = estimateLineIndex\(estimate, row\);/);
});
