// A save that fails because the connection dropped is sent again when the
// connection is back, instead of pausing saving until the page is reloaded.
// Found by the two-person release workflow test (to-do item 2).
// Nothing here touches a network or a real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create } = require('../record-writes.js');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const row = (id = 'estimate-1', version = 1, data = { items: [{ title: 'Line' }] }) => ({ id, record_type: 'estimate', company_state_id: 'coastal-crest', version, data });
const reply = (payload) => ({ data: { rows: payload.p_changes.map((change) => ({ ...change, version: change.expected_version + 1, deleted_at: null })), audit_ids: payload.p_events.map((event) => event.id) }, error: null });
const offline = () => ({ data: null, error: { message: 'TypeError: Failed to fetch' } });
let sequence = 0;
const writer = (options) => create({ requestId: () => `request-${++sequence}`, ...options });

test('a save that fails in transit is sent again, identically, until it gets through', async () => {
  const sent = [];
  const waits = [];
  let acknowledged = 0;
  let blocked = 0;
  const w = writer({
    transientRetries: 8,
    transientRetryWait: async (attempt) => { waits.push(attempt); },
    onAcknowledged: () => { acknowledged += 1; },
    onBlocked: () => { blocked += 1; },
    rpc: async (_name, payload) => {
      sent.push(structuredClone(payload));
      return sent.length <= 3 ? offline() : reply(payload);
    },
  });
  w.remember([row()]);
  const result = await w.commit([row('estimate-1', 1, { items: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }, { title: 'Four' }] })]);
  assert.ok(result.data, 'the save went through');
  assert.equal(sent.length, 4);
  assert.deepEqual(waits, [1, 2, 3], 'it waited before each further try');
  // The same request each time, with the same id: the database answers a repeated request once.
  for (const attempt of sent.slice(1)) assert.deepEqual(attempt, sent[0]);
  assert.equal(acknowledged, 1);
  assert.equal(blocked, 0, 'saving was never paused');
  assert.equal(w.blocked, null);
});

test('edits made while a save is waiting to be re-sent are saved after it, in order', async () => {
  const sent = [];
  let online = false;
  const w = writer({
    transientRetries: 8,
    transientRetryWait: async () => { online = true; },
    rpc: async (_name, payload) => { sent.push(structuredClone(payload)); return online ? reply(payload) : offline(); },
  });
  w.remember([row()]);
  const first = w.commit([row('estimate-1', 1, { items: [{ title: 'One' }, { title: 'Two' }] })]);
  const second = w.commit([row('estimate-1', 1, { items: [{ title: 'One' }, { title: 'Two' }, { title: 'Three' }, { title: 'Four' }] })]);
  assert.ok((await first).data);
  assert.ok((await second).data);
  const delivered = sent.filter((payload, index) => index > 0);
  assert.deepEqual(delivered.map((payload) => payload.p_changes[0].data.items.length), [2, 4]);
  assert.deepEqual(delivered.map((payload) => payload.p_changes[0].expected_version), [1, 2], 'the later edit builds on the earlier one');
});

test('a connection that never comes back still pauses saving, after every retry is used', async () => {
  const waits = [];
  let blocked = null;
  const w = writer({
    transientRetries: 3,
    transientRetryWait: async (attempt) => { waits.push(attempt); },
    onBlocked: (value) => { blocked = value; },
    rpc: async () => offline(),
  });
  const result = await w.commit([row()]);
  assert.equal(result.data, null);
  assert.deepEqual(waits, [1, 2, 3]);
  assert.ok(blocked?.payload?.p_request_id, 'the request is kept for recovery');
});

test('a refusal from the database is never retried', async () => {
  const waits = [];
  let calls = 0;
  const w = writer({
    transientRetries: 8,
    transientRetryWait: async (attempt) => { waits.push(attempt); },
    isExpectedRejection: (error) => /workflow_checklist_incomplete/.test(error.message),
    rpc: async () => { calls += 1; return { data: null, error: { code: '23514', message: 'workflow_checklist_incomplete' } }; },
  });
  await w.commit([row()]);
  assert.equal(calls, 1);
  assert.deepEqual(waits, []);
});

test('the CRM waits for the connection to return before re-sending, and for no longer than it must', async () => {
  const source = app.match(/^const SAVE_RETRY_ATTEMPTS = [^\n]*;$/m)[0].replace(/^const /, 'var ') + app.match(/^function waitBeforeSaveRetry\([^]*?^}/m)[0];
  const run = async ({ onLine }) => {
    const timers = [];
    const handlers = new Map();
    const context = vm.createContext({
      navigator: { onLine },
      window: {
        setTimeout: (callback, ms) => { timers.push({ callback, ms }); return timers.length; }, clearTimeout() {},
        addEventListener: (name, handler) => handlers.set(name, handler), removeEventListener: (name) => handlers.delete(name),
      },
    });
    vm.runInContext(source, context);
    return { context, timers, handlers };
  };
  // Online but the request failed: a short, growing wait.
  const online = await run({ onLine: true });
  const waits = [1, 2, 3, 4, 5, 6].map((attempt) => { online.context.waitBeforeSaveRetry(attempt); return online.timers.at(-1).ms; });
  assert.deepEqual(waits, [1000, 2000, 4000, 8000, 15000, 15000]);
  // Offline: wait for the browser to say the connection is back, however soon that is.
  const away = await run({ onLine: false });
  let resumed = false;
  const waiting = away.context.waitBeforeSaveRetry(1).then(() => { resumed = true; });
  assert.equal(away.timers[0].ms, 60000);
  assert.equal(resumed, false);
  away.handlers.get('online')();
  await waiting;
  assert.equal(resumed, true);
  assert.equal(away.handlers.size, 0, 'the listener is removed once it has fired');
  assert.ok(away.context.SAVE_RETRY_ATTEMPTS >= 6);
  assert.match(app, /transientRetries: SAVE_RETRY_ATTEMPTS,\s*transientRetryWait: waitBeforeSaveRetry,/);
});
