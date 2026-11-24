// Recovering unsaved estimate lines (to-do item 8).
// If a rep's save is refused because someone else saved the estimate first,
// the lines the rep typed are offered back, one at a time, on top of the
// current estimate. Nothing here touches a network or a real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const draftRecovery = require('../draft-recovery.js');
const recoveryCache = require('../recovery-cache.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const number = (value) => { const parsed = Number(String(value ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(parsed) ? parsed : 0; };
const line = (title, quantity, rate, extra = {}) => ({ title, description: '', quantity, unit: 'sq', rate, ...extra });
const FOUR = [line('Tear off existing shingles', 24, 85), line('Install architectural shingles', 24, 310.5), line('Replace damaged decking', 6, 95.25, { unit: 'sheet' }), line('Permit and disposal', 1, 650, { unit: 'ea' })];

function load(names, globals = {}) {
  const context = vm.createContext({ console: { warn() {} }, number, JSON, Map, Set, ...globals });
  vm.runInContext('var ESTIMATE_RECOVERY_DISMISSED_KEY = "jobcrest-estimate-recovery-dismissed"; var estimateRecoveryCopies = new Map(); var estimateRecoverySources = []; var estimateRecoveryPanelFor = "";', context);
  for (const name of names) {
    const match = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    assert.ok(match, `Function ${name} exists`);
    vm.runInContext(match[0], context);
  }
  return context;
}
const core = (globals = {}) => load(['estimateLineSignature', 'normalizeLineItem', 'estimateRecoveryTargets', 'estimateLinesToRecover'], { isPlaceholderEstimateItem: (item) => item.placeholder === true, ...globals });
const titles = (lines) => Array.from(lines, (entry) => entry.item.title);

test('the rep\'s fourth line, lost when someone else saved first, is the one line offered back', () => {
  const c = core();
  // What is in the shared CRM now: the rep's first three lines, and a line the admin added.
  const current = { id: 'est-1', items: [...FOUR.slice(0, 3).map((item) => ({ ...item })), line('Drip edge', 180, 2.75, { unit: 'ft' })] };
  const lines = c.estimateLinesToRecover(current, { items: FOUR });
  assert.deepEqual(titles(lines), ['Permit and disposal']);
  assert.equal(lines[0].replacesIndex, -1, 'it is not a different version of a line that is there');
  assert.equal(lines[0].item.quantity, 1);
  assert.equal(lines[0].item.rate, 650);
});

test('a line the estimate already has is never offered, however it was typed', () => {
  const c = core();
  const copy = { items: [line('  tear off EXISTING shingles ', '24', '85.00'), line('Install architectural shingles', 24, 310.5)] };
  assert.deepEqual(titles(c.estimateLinesToRecover({ items: FOUR }, copy)), []);
  // Two identical lines in the copy and one in the estimate: one is missing.
  const twice = { items: [line('Ridge vent', 40, 9), line('Ridge vent', 40, 9)] };
  assert.equal(c.estimateLinesToRecover({ items: [line('Ridge vent', 40, 9)] }, twice).length, 1);
  assert.equal(c.estimateLinesToRecover({ items: [line('Ridge vent', 40, 9), line('Ridge vent', 40, 9)] }, twice).length, 0);
});

test('empty lines and the starter line of a new estimate are not lost work', () => {
  const c = core();
  const copy = { items: [line('', 1, 0), line('Line item', 1, 0), { title: 'Describe the work', quantity: 1, rate: 0, placeholder: true }, line('Real work', 2, 100)] };
  assert.deepEqual(titles(c.estimateLinesToRecover({ items: [] }, copy)), ['Real work']);
  assert.deepEqual(Array.from(c.estimateLinesToRecover(null, copy)), []);
  assert.deepEqual(Array.from(c.estimateLinesToRecover({ items: [] }, null)), []);
  assert.deepEqual(Array.from(c.estimateLinesToRecover({ items: [] }, { items: 'not a list' })), []);
});

test('a line that is in the estimate with other numbers says which line it would update', () => {
  const c = core();
  const current = { items: [line('Tear off existing shingles', 24, 85), line('Replace damaged decking', 4, 95.25, { unit: 'sheet' })] };
  const lines = c.estimateLinesToRecover(current, { items: [line('replace damaged decking', 6, 95.25, { unit: 'sheet' })] });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].replacesIndex, 1);
});

function indexing({ estimates, dismissed = [], view = 'estimates' } = {}) {
  const toasts = [];
  let rendered = 0;
  const c = load(['estimateLineSignature', 'normalizeLineItem', 'estimateRecoveryTargets', 'estimateLinesToRecover', 'estimateRecoveryDismissed', 'indexEstimateRecoveryCopies'], {
    isPlaceholderEstimateItem: () => false, authSession: { user: { id: 'rep-1' } },
    localStorage: { getItem: (key) => (key === 'jobcrest-estimate-recovery-dismissed:rep-1' ? JSON.stringify(dismissed) : null) },
    window: { setTimeout: (callback) => callback() }, Promise,
    visibleEstimates: () => estimates, state: { view }, getSelectedEstimate: () => estimates[0],
    renderEstimateRecovery: () => { rendered += 1; }, showToast: (message) => toasts.push(message),
  });
  return { c, toasts, rendered: () => rendered, copies: () => vm.runInContext('estimateRecoveryCopies', c) };
}
const snapshot = (updatedAt, pending, estimates) => ({ key: `k-${updatedAt}`, raw: JSON.stringify({ format: 2, updatedAt, pending, state: { estimates } }) });

test('only an estimate that was unsaved when the copy was taken is treated as lost work', async () => {
  const current = [{ id: 'est-1', estimateNumber: 'E-1001', items: FOUR.slice(0, 3) }, { id: 'est-2', estimateNumber: 'E-1002', items: [line('Gutters', 1, 900)] }];
  const h = indexing({ estimates: current });
  const found = await h.c.indexEstimateRecoveryCopies([
    // est-1 was being edited; est-2 was only part of the same copy, and has
    // since had a line removed on purpose. That must not come back as "unsaved".
    snapshot('2026-11-22T15:00:00.000Z', ['estimate:est-1', 'contact:lead-1'], [{ id: 'est-1', items: FOUR }, { id: 'est-2', items: [line('Gutters', 1, 900), line('Removed on purpose', 1, 50)] }]),
  ]);
  assert.equal(found, 1);
  assert.deepEqual([...h.copies().keys()], ['est-1']);
  assert.deepEqual(h.toasts, ['Estimate E-1001 has lines you typed that were not saved. Open it and choose "Recover unsaved lines".']);
  assert.equal(h.rendered(), 1);
});

test('the newest copy wins; discarded, older-format and unreadable copies are skipped', async () => {
  const current = [{ id: 'est-1', estimateNumber: 'E-1001', items: [] }];
  const h = indexing({ estimates: current, dismissed: ['est-1:2026-11-22T17:00:00.000Z'] });
  await h.c.indexEstimateRecoveryCopies([
    snapshot('2026-11-22T14:00:00.000Z', ['estimate:est-1'], [{ id: 'est-1', items: [line('Older', 1, 1)] }]),
    snapshot('2026-11-22T16:00:00.000Z', ['estimate:est-1'], [{ id: 'est-1', items: [line('Newer', 1, 1)] }]),
    snapshot('2026-11-22T17:00:00.000Z', ['estimate:est-1'], [{ id: 'est-1', items: [line('Discarded by the rep', 1, 1)] }]),
    { key: 'old', raw: JSON.stringify({ format: 2, updatedAt: '2026-11-22T18:00:00.000Z', state: { estimates: [{ id: 'est-1', items: [line('No list of what was unsaved', 1, 1)] }] } }) },
    { key: 'bad', raw: '{not json' },
  ]);
  assert.equal(h.copies().get('est-1').items[0].title, 'Newer');
  assert.equal(h.copies().get('est-1').stamp, 'est-1:2026-11-22T16:00:00.000Z');
  // Nothing to recover: nothing is said.
  const quiet = indexing({ estimates: [{ id: 'est-1', items: FOUR }] });
  assert.equal(await quiet.c.indexEstimateRecoveryCopies([snapshot('2026-11-22T16:00:00.000Z', ['estimate:est-1'], [{ id: 'est-1', items: FOUR }])]), 0);
  assert.deepEqual(quiet.toasts, []);
});

function recovering({ current, copy, allowed = true } = {}) {
  const calls = { saves: [], toasts: [], rendered: 0, stored: null };
  const estimate = { id: 'est-1', estimateNumber: 'E-1001', items: current };
  const c = load(['estimateLineSignature', 'normalizeLineItem', 'estimateRecoveryTargets', 'estimateLinesToRecover', 'estimateRecoveryDismissed', 'recoverEstimateLines', 'dismissEstimateRecovery'], {
    isPlaceholderEstimateItem: () => false, authSession: { user: { id: 'rep-1' } },
    uid: (prefix) => `${prefix}-new-${(calls.ids = (calls.ids || 0) + 1)}`,
    requireAction: () => allowed, getSelectedEstimate: () => estimate,
    queueLocalStateSave() {}, renderEstimateLineItems() {}, scheduleEstimateVisualRefresh() {},
    queueEstimateVerifiedSave: (id) => calls.saves.push(id), renderEstimateRecovery: () => { calls.rendered += 1; },
    showToast: (message) => calls.toasts.push(message),
    localStorage: { getItem: () => calls.stored, setItem: (_key, value) => { calls.stored = value; } },
  });
  vm.runInContext('estimateRecoveryCopies', c).set('est-1', { items: copy, capturedAt: '2026-11-22T15:00:00.000Z', stamp: 'est-1:2026-11-22T15:00:00.000Z' });
  return { c, calls, estimate };
}

test('putting a line back adds that line and leaves everything else as it is', () => {
  const adminsLine = line('Drip edge', 180, 2.75, { unit: 'ft', addedBy: 'admin' });
  const h = recovering({ current: [...FOUR.slice(0, 3).map((item) => ({ ...item })), adminsLine], copy: FOUR });
  assert.equal(h.c.recoverEstimateLines([0]), 1);
  assert.deepEqual(Array.from(h.estimate.items, (item) => item.title), ['Tear off existing shingles', 'Install architectural shingles', 'Replace damaged decking', 'Drip edge', 'Permit and disposal']);
  assert.equal(h.estimate.items[3], adminsLine, 'the line someone else saved is untouched');
  // It comes back as a line of its own, with an id no other line has.
  assert.deepEqual({ ...h.estimate.items[4] }, { id: 'line-new-1', title: 'Permit and disposal', description: '', quantity: 1, unit: 'ea', rate: 650 });
  assert.deepEqual(h.calls.saves, ['est-1'], 'and it is saved the way any edit is');
  assert.deepEqual(h.calls.toasts, ['"Permit and disposal" is back in the estimate']);
  assert.equal(h.c.estimateLinesToRecover(h.estimate, { items: FOUR }).length, 0, 'nothing is left to recover');
  assert.equal(h.c.recoverEstimateLines([0]), 0, 'asking again does nothing');
});

test('"use these numbers" updates the line that is there; "add" makes a second line', () => {
  const existing = line('Replace damaged decking', 4, 95.25, { unit: 'sheet', taxable: true });
  const replace = recovering({ current: [existing], copy: [line('Replace damaged decking', 6, 95.25, { unit: 'sheet' })] });
  replace.c.recoverEstimateLines([0], 'replace');
  assert.equal(replace.estimate.items.length, 1);
  assert.equal(replace.estimate.items[0].quantity, 6);
  assert.equal(replace.estimate.items[0].taxable, true, 'what else the line carried is kept');
  const add = recovering({ current: [{ ...existing }], copy: [line('Replace damaged decking', 6, 95.25, { unit: 'sheet' })] });
  add.c.recoverEstimateLines([0], 'add');
  assert.deepEqual(Array.from(add.estimate.items, (item) => item.quantity), [4, 6]);
});

// ---- Which line an unsaved line belongs to ---------------------------------
// Found by Codex before release: an estimate had two lines named "Labor", one
// for the tear-off and one for the installation. The rep's unsaved edit was to
// the installation line, and the CRM offered to put it over the tear-off line,
// because it went by the name and took the first line it found.
const labor = (id, description, rate) => ({ id, title: 'Labor', description, quantity: 1, unit: 'ea', rate });
const TWO_LABOR = () => [labor('line_a', 'Tear-off', 1800), labor('line_b', 'Installation', 2400), { id: 'line_c', ...line('Permit and disposal', 1, 650, { unit: 'ea' }) }];

test('two lines with the same name: an unsaved edit goes to the line it was made on', () => {
  const h = recovering({ current: TWO_LABOR(), copy: [labor('line_a', 'Tear-off', 1800), labor('line_b', 'Installation', 2950), TWO_LABOR()[2]] });
  const lines = h.c.estimateLinesToRecover(h.estimate, { items: [labor('line_a', 'Tear-off', 1800), labor('line_b', 'Installation', 2950), TWO_LABOR()[2]] });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].replacesIndex, 1, 'the installation line, by its id');
  assert.deepEqual(Array.from(lines[0].choices), []);
  assert.equal(h.c.recoverEstimateLines([0], 'replace', 'line_b'), 1);
  assert.deepEqual(Array.from(h.estimate.items, (item) => [item.id, item.description, item.rate]),
    [['line_a', 'Tear-off', 1800], ['line_b', 'Installation', 2950], ['line_c', '', 650]], 'the tear-off line is exactly as it was');
});

test('a line is found by its id even after it was renamed, and a new line with a familiar name replaces nothing', () => {
  const c = core();
  const current = { items: TWO_LABOR() };
  const renamed = c.estimateLinesToRecover(current, { items: [{ ...labor('line_b', 'Installation', 2400), title: 'Labor: install crew' }] });
  assert.equal(renamed[0].replacesIndex, 1);
  // Typed as a third "Labor" line and never saved: it has an id the estimate has never seen.
  const added = c.estimateLinesToRecover(current, { items: [labor('line_new', 'Clean-up', 300)] });
  assert.equal(added[0].replacesIndex, -1);
  assert.deepEqual(Array.from(added[0].choices), [], 'it can only be put back as a line of its own');
});

test('an older estimate with two possible lines asks the rep which one, and never guesses', () => {
  // Lines saved before lines had ids are numbered by position, and someone may
  // have saved a different list since: "line-2" is not proof of which line.
  const older = () => [labor('line-1', 'Tear-off', 1800), labor('line-2', 'Installation', 2400), { id: 'line-3', ...line('Permit and disposal', 1, 650, { unit: 'ea' }) }];
  const copy = [labor('line-1', 'Tear-off', 1800), labor('line-2', 'Installation', 2950), older()[2]];
  const h = recovering({ current: older(), copy });
  const [unsaved] = h.c.estimateLinesToRecover(h.estimate, { items: copy });
  assert.equal(unsaved.replacesIndex, -1, 'no line is picked for the rep');
  assert.deepEqual(Array.from(unsaved.choices), [0, 1], 'both lines named Labor are offered');
  const untouched = () => Array.from(h.estimate.items, (item) => item.rate);
  assert.equal(h.c.recoverEstimateLines([0], 'replace'), 0, 'without a choice nothing is replaced');
  assert.equal(h.c.recoverEstimateLines([0], 'replace', 'line-3'), 0, 'nor is a line that was not offered');
  assert.deepEqual(untouched(), [1800, 2400, 650]);
  assert.equal(h.c.recoverEstimateLines([0], 'replace', 'line-2'), 1, 'the line the rep pointed at');
  assert.deepEqual(untouched(), [1800, 2950, 650]);
});

test('a position that now holds a different line is not trusted', () => {
  const c = core();
  // The copy's "line-2" was Flashing. Someone has since saved a list without the first line.
  const current = { items: [{ id: 'line-1', ...line('Flashing', 40, 12) }, { id: 'line-2', ...line('Ridge vent', 40, 9) }] };
  const [flashing] = c.estimateLinesToRecover(current, { items: [{ id: 'line-2', ...line('Flashing', 55, 12) }] });
  assert.equal(flashing.replacesIndex, 0, 'the one line named Flashing, not whatever is second now');
  const [gone] = c.estimateLinesToRecover(current, { items: [{ id: 'line-2', ...line('Starter strip', 10, 4) }] });
  assert.equal(gone.replacesIndex, -1);
  assert.deepEqual(Array.from(gone.choices), []);
});

test('the panel names each line it could replace, and "put all back" waits for the choice', () => {
  const c = load(['estimateRecoveryPanelMarkup'], {
    escapeHtml: (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    money: { format: (amount) => `$${Number(amount).toFixed(2)}` }, formatDateTime: () => 'Nov 22',
  });
  const estimate = { items: [labor('line-1', 'Tear-off', 1800), labor('line-2', 'Installation', 2400)] };
  const markup = c.estimateRecoveryPanelMarkup(estimate, { capturedAt: '2026-11-22T15:00:00Z' }, [
    { item: labor('line-2', 'Installation', 2950), replacesIndex: -1, choices: [0, 1] },
    { item: { id: 'line_x', ...line('Drip edge', 180, 2.75) }, replacesIndex: -1, choices: [] },
  ]);
  assert.match(markup, /2 lines in the estimate are named "Labor"\. Choose the one this belongs to, or add it as another line\./);
  assert.match(markup, /data-recover-mode="replace" data-recover-target="line-1">Replace line 1: Tear-off · 1 ea × \$1800\.00 = \$1800\.00</);
  assert.match(markup, /data-recover-mode="replace" data-recover-target="line-2">Replace line 2: Installation · 1 ea × \$2400\.00 = \$2400\.00</);
  assert.doesNotMatch(markup, /data-recover-all/, 'not while a line still needs the rep to choose');
  assert.doesNotMatch(markup, /Use these numbers/);
  // One certain line: the old single button, now saying which line it means.
  const certain = c.estimateRecoveryPanelMarkup(estimate, {}, [{ item: labor('line_b', 'Installation', 2950), replacesIndex: 1, choices: [] }]);
  assert.match(certain, /In the estimate now: Installation · 1 ea × \$2400\.00 = \$2400\.00/);
  assert.match(certain, /data-recover-target="line-2">Use these numbers</);
});

test('all the lines can go back at once, and someone who may not edit estimates recovers nothing', () => {
  const all = recovering({ current: [], copy: FOUR });
  assert.equal(all.c.recoverEstimateLines([0, 1, 2, 3]), 4);
  assert.equal(all.estimate.items.length, 4);
  assert.deepEqual(all.calls.toasts, ['4 lines are back in the estimate']);
  const viewer = recovering({ current: [], copy: FOUR, allowed: false });
  assert.equal(viewer.c.recoverEstimateLines([0]), 0);
  assert.equal(viewer.estimate.items.length, 0);
  assert.deepEqual(viewer.calls.saves, []);
});

test('lines the rep says they do not need are not offered again on this device', () => {
  const h = recovering({ current: [], copy: FOUR });
  h.c.dismissEstimateRecovery();
  assert.deepEqual(JSON.parse(h.calls.stored), ['est-1:2026-11-22T15:00:00.000Z']);
  assert.equal(vm.runInContext('estimateRecoveryCopies', h.c).has('est-1'), false);
  assert.equal(h.estimate.items.length, 0, 'the estimate itself is not changed');
  assert.equal(h.calls.rendered, 1);
});

test('the copy kept on the device records which records were unsaved', async () => {
  // The small store (browser storage).
  const values = new Map();
  const storage = { get length() { return values.size; }, key: (index) => [...values.keys()][index], getItem: (key) => (values.has(key) ? values.get(key) : null), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const small = draftRecovery.create({ storage, companyId: 'coastal-crest', userId: 'rep-1', sessionId: 's1', now: () => '2026-11-22T15:00:00.000Z' });
  assert.equal(small.captureSerialized(JSON.stringify({ estimates: [{ id: 'est-1', items: FOUR }] }), { pending: ['estimate:est-1'] }), true);
  const stored = JSON.parse(small.list().entries[0].raw);
  assert.deepEqual(stored.pending, ['estimate:est-1']);
  assert.equal(stored.state.estimates[0].items.length, 4);
  assert.equal(small.capture({ a: 1 }), true, 'callers that give no details still work');
  assert.equal(Object.hasOwn(JSON.parse(small.list().entries[0].raw), 'pending'), false);

  // The large store (the browser's database), with a stand-in for it.
  const rows = new Map();
  const request = (result) => { const r = { result }; queueMicrotask(() => r.onsuccess?.()); return r; };
  const objectStore = { get: (key) => request(rows.get(key)), put: (value, key) => { rows.set(key, value); return request(undefined); }, delete: (key) => { rows.delete(key); return request(undefined); },
    openCursor: () => { const entries = [...rows.entries()]; let index = 0; const r = {}; const step = () => { r.result = index < entries.length ? { key: entries[index][0], value: entries[index][1], continue: () => { index += 1; queueMicrotask(step); } } : null; r.onsuccess?.(); }; queueMicrotask(step); return r; } };
  const database = { objectStoreNames: { contains: () => true }, transaction: () => ({ objectStore: () => objectStore }) };
  const cache = recoveryCache.create({ indexedDB: { open: () => request(database) } });
  const large = cache.createDraftStore({ companyId: 'coastal-crest', userId: 'rep-1', sessionId: 's2', now: () => '2026-11-22T15:00:00.000Z' });
  assert.equal(await large.captureSerialized(JSON.stringify({ estimates: [] }), { pending: ['estimate:est-9', 'job:job-1'] }), true);
  assert.deepEqual(JSON.parse((await large.list()).entries[0].raw).pending, ['estimate:est-9', 'job:job-1']);
});

test('taking the copy passes along what is unsaved, and a refused estimate says how to get the lines back', () => {
  const captured = [];
  const c = load(['pendingDurableRecordKeys', 'checkpointPendingDraft'], {
    draftRecoveryStore: { capture: (_state, details) => { captured.push(details); return true; }, captureSerialized: (_json, details) => { captured.push(details); return true; }, settle: () => true },
    durableRecordsReady: true, applyingCloudState: false, durableWriteBlocked: false, durableSaveInFlight: false, cloudSaveInFlight: false,
    hasPendingDurableChanges: () => true, hasPendingCompanyChanges: () => false, showDraftStorageWarning() {}, state: {},
    durableRecordKey: (row) => `${row.record_type}:${row.id}`,
    durableRecordFingerprints: new Map([['estimate:est-1', 'old'], ['contact:lead-1', 'same']]),
    durableStateProjection: () => ({ rows: [{ record_type: 'estimate', id: 'est-1' }, { record_type: 'contact', id: 'lead-1' }, { record_type: 'task', id: 'task-new' }],
      fingerprints: new Map([['estimate:est-1', 'new'], ['contact:lead-1', 'same'], ['task:task-new', 'fresh']]) }),
  });
  c.checkpointPendingDraft();
  c.checkpointPendingDraft('{"estimates":[]}');
  assert.deepEqual(captured.map((details) => Array.from(details.pending)), [['estimate:est-1', 'task:task-new'], ['estimate:est-1', 'task:task-new']]);

  const body = source.match(/^function preserveBlockedDurableWrite\([^]*?^}/m)[0];
  assert.match(body, /record_type === "estimate"/);
  assert.match(body, /Someone else saved this estimate first[^\n]*Recover unsaved lines/);
});

test('the recover button is offered only when there is something to recover', () => {
  const body = source.match(/^function renderEstimateRecovery\([^]*?^}/m)[0];
  assert.match(body, /if \(!lines\.length\) \{\s*button\?\.remove\(\);\s*panel\?\.remove\(\);/);
  assert.match(body, /Recover unsaved lines \(\$\{lines\.length\}\)/);
  // It sits behind the button: the panel is drawn only once the button is pressed.
  assert.match(body, /if \(!open\) \{\s*panel\?\.remove\(\);\s*return;/);
});
