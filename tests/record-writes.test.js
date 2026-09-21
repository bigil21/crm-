const test = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../record-writes.js');
const row = (id = 'job-1', version = 1, data = { status: 'New' }) => ({ id, record_type: 'job', company_state_id: 'coastal-crest', version, data });
const reply = payload => ({ data: { rows: payload.p_changes.map(c => ({ ...c, version: c.expected_version + 1, deleted_at: c.operation === 'delete' ? '2026-09-14' : null })), audit_ids: payload.p_events.map(e => e.id) }, error: null });
let sequence = 0;
const writer = options => create({ requestId: () => `request-${++sequence}`, ...options });

test('queued local edits use own acknowledgements without overlapping network writes', async () => {
  const calls = []; let active = 0; let maxActive = 0;
  const w = writer({ rpc: async (_name, payload) => {
    maxActive = Math.max(maxActive, ++active);
    await new Promise(resolve => setTimeout(resolve, 5));
    calls.push(structuredClone(payload)); active--; return reply(payload);
  } });
  w.remember([row()]);
  const first = w.commit([row('job-1', 1, { status: 'Contacted' })]);
  const second = w.commit([row('job-1', 1, { status: 'Inspection' })]);
  assert.ok((await first).data);
  assert.ok((await second).data);
  assert.deepEqual(calls.map(p => p.p_changes[0].expected_version), [1, 2]);
  assert.equal(maxActive, 1);
});
test('queued edits cannot silently adopt a newer fetched server revision', async () => {
  const calls = [];
  const w = writer({ rpc: async (_name, payload) => { calls.push(payload); return reply(payload); } });
  w.remember([row()]);
  const pending = w.commit([row()]);
  w.remember([row('job-1', 7, { status: 'Won' })]);
  await pending;
  assert.equal(calls[0].p_changes[0].expected_version, 1);
});
test('request snapshot is immutable while users continue typing', async () => {
  let sent;
  const w = writer({ rpc: async (_name, payload) => { sent = payload; return reply(payload); } });
  const record = row();
  const pending = w.commit([record]);
  record.data.status = 'Changed after click';
  await pending;
  assert.equal(sent.p_changes[0].data.status, 'New');
});
test('conflict preserves the exact request and pauses subsequent network writes', async () => {
  let recovery; let calls = 0;
  const error = { code: '40001', message: 'record_conflict' };
  const w = writer({ rpc: async () => { calls++; return { error }; }, onBlocked: value => { recovery = value; } });
  const first = w.commit([row()]);
  const second = w.commit([row('job-2')]);
  assert.equal((await first).error, error);
  assert.equal((await second).error, error);
  assert.equal(calls, 1);
  assert.equal(recovery.payload.p_changes[0].id, 'job-1');
  assert.ok(recovery.payload.p_request_id);
});
test('lost responses and missing migrations never fall back to unsafe upserts', async () => {
  for (const failure of [Error('Network response lost'), { code: 'PGRST202', message: 'Function not found' }]) {
    let ack = 0;
    const w = writer({ rpc: async () => { throw failure; }, onAcknowledged: () => ack++ });
    assert.ok((await w.commit([row()])).error);
    assert.equal(ack, 0);
    assert.ok(w.blocked.payload);
  }
});

test('a stalled save releases the queue and preserves its uncertain request', async () => {
  let acknowledge = 0;
  const w = writer({ rpc: () => new Promise(() => {}), timeoutMs: 5, onAcknowledged: () => acknowledge++ });
  const result = await w.commit([row()]);
  assert.match(result.error.message, /timed out/);
  assert.equal(acknowledge, 0);
  assert.ok(w.blocked.payload.p_request_id);
});
test('incomplete or mismatched confirmations are never treated as saved', async () => {
  for (const corrupt of [
    r => { r.data.rows = []; },
    r => { r.data.rows[0].version = 99; },
    r => { r.data.rows[0].data = { status: 'Wrong' }; },
    r => { r.data.rows[0].company_state_id = 'other-company'; },
    r => { r.data.audit_ids = []; },
  ]) {
    let ack = 0;
    const w = writer({ rpc: async (_name, payload) => { const r = reply(payload); corrupt(r); return r; }, onAcknowledged: () => ack++ });
    assert.ok((await w.commit([row()], [{ id: 'audit-1' }])).error);
    assert.equal(ack, 0);
  }
});
test('tombstones retain their revision and deletion is sent as a versioned operation', async () => {
  let sent;
  const w = writer({ rpc: async (_name, payload) => { sent = payload; return reply(payload); } });
  w.remember([{ ...row(), version: 4, deleted_at: '2026-09-14' }]);
  await w.commit([], [], [row()]);
  assert.equal(sent.p_changes[0].expected_version, 4);
  assert.equal(sent.p_changes[0].operation, 'delete');
});
