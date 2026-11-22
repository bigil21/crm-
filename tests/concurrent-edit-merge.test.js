const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { create: createWriter, mergeRecordData } = require('../record-writes.js');
const root = path.resolve(__dirname, '..');
const db = new PGlite();
const adminId = '00000000-0000-4000-8000-000000000001';
let request = 0;

before(async () => {
  // In-memory PostgreSQL only. Auth claims are fixtures, never real credentials.
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}'::jsonb);
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
    create table storage.objects(id uuid, bucket_id text, name text, owner_id text);
    create function storage.foldername(text) returns text[] language sql immutable as
      $$ select string_to_array(trim(both '/' from $1), '/') $$;
    grant usage on schema public, auth, storage to authenticated, anon;
    insert into auth.users(id,email,raw_app_meta_data) values ('${adminId}','admin@coastalcrestroofing.com','{"role":"admin"}');
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  await db.exec('grant all on all tables in schema public to authenticated;');
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20260914_conflict_safe_record_writes.sql'), 'utf8'));
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: adminId, email: 'admin@coastalcrestroofing.com', app_metadata: { role: 'admin' } })]);
  await db.exec('set role authenticated');
});
after(async () => db.close());

const job = (id, data) => ({ company_state_id: 'coastal-crest', record_type: 'job', id, lead_id: 'fixture-lead', data });
const keyOf = (row) => `${row.record_type}:${row.id}`;

// One browser tab: its own writer, its own "last loaded" copies.
function editor() {
  const loaded = new Map();
  const merges = [];
  const blocked = [];
  const writer = createWriter({
    requestId: () => `merge-test-${++request}`,
    rpc: async (name, payload) => {
      try {
        const result = await db.query(`select public.${name}($1,$2::jsonb,$3::jsonb) as result`,
          [payload.p_request_id, JSON.stringify(payload.p_changes), JSON.stringify(payload.p_events)]);
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
    baseFor: (row) => loaded.get(keyOf(row)),
    fetchCurrent: async (changes) => (await db.query('select * from public.crm_records where id = any($1)', [changes.map(c => c.id)])).rows,
    onAcknowledged: (changes) => changes.forEach(row => loaded.set(keyOf(row), row.data)),
    onMerged: (entries) => merges.push(...entries),
    onBlocked: (value) => blocked.push(value),
  });
  return {
    writer, merges, blocked,
    async load(id) {
      const row = (await db.query('select * from public.crm_records where id=$1', [id])).rows[0];
      writer.remember([row]);
      loaded.set(keyOf(row), row.data);
      return structuredClone(row.data);
    },
  };
}
const saved = async (id) => (await db.query('select * from public.crm_records where id=$1', [id])).rows[0];

test('two people editing different fields of the same job both keep their changes', async () => {
  const setup = editor();
  await setup.writer.commit([job('merge-1', { name: 'Smith roof', status: 'New', notes: '', updatedAt: '2026-11-19T10:00:00Z',
    items: [{ id: 'a', qty: 1 }] })]);
  const gil = editor(); const devon = editor();
  const gilCopy = await gil.load('merge-1'); const devonCopy = await devon.load('merge-1');

  devonCopy.status = 'Scheduled'; devonCopy.items[0].qty = 2; devonCopy.updatedAt = '2026-11-19T10:01:00Z';
  assert.equal((await devon.writer.commit([job('merge-1', devonCopy)])).error, null);

  gilCopy.notes = 'Call before arriving'; gilCopy.items.push({ id: 'b', qty: 5 }); gilCopy.updatedAt = '2026-11-19T10:02:00Z';
  const result = await gil.writer.commit([job('merge-1', gilCopy)]);
  assert.equal(result.error, null, 'Gil\'s save must not be blocked by Devon\'s earlier save');
  assert.equal(gil.blocked.length, 0);

  const row = await saved('merge-1');
  assert.equal(row.version, 3);
  assert.deepEqual(row.data, { name: 'Smith roof', status: 'Scheduled', notes: 'Call before arriving', updatedAt: '2026-11-19T10:02:00Z',
    items: [{ id: 'a', qty: 2 }, { id: 'b', qty: 5 }] });
  assert.equal(gil.merges.length, 1);
  assert.deepEqual(gil.merges[0].conflicts, []);
  assert.equal(gil.merges[0].row.version, 3);
});

test('when both change the same field, the person saving last wins and is told', async () => {
  const setup = editor();
  await setup.writer.commit([job('merge-2', { name: 'Original', phone: '1' })]);
  const levi = editor(); const gil = editor();
  const leviCopy = await levi.load('merge-2'); const gilCopy = await gil.load('merge-2');
  leviCopy.name = 'Levi name'; leviCopy.phone = '2';
  await levi.writer.commit([job('merge-2', leviCopy)]);
  gilCopy.name = 'Gil name';
  assert.equal((await gil.writer.commit([job('merge-2', gilCopy)])).error, null);
  assert.deepEqual((await saved('merge-2')).data, { name: 'Gil name', phone: '2' });
  assert.deepEqual(gil.merges[0].conflicts, ['name']);
});

test('a record someone else deleted is not silently resurrected; the edit is kept for recovery', async () => {
  const setup = editor();
  await setup.writer.commit([job('merge-3', { name: 'To delete' })]);
  const remover = editor(); const editorTab = editor();
  await remover.load('merge-3'); const copy = await editorTab.load('merge-3');
  await remover.writer.commit([], [], [job('merge-3', undefined)]);
  copy.name = 'Edited after delete';
  const result = await editorTab.writer.commit([job('merge-3', copy)]);
  assert.equal(result.error.code, 'PT409');
  assert.equal(editorTab.blocked.length, 1);
  assert.equal(editorTab.blocked[0].payload.p_changes[0].data.name, 'Edited after delete');
  assert.ok((await saved('merge-3')).deleted_at);
});

test('merge rules', () => {
  const conflicts = [];
  assert.deepEqual(mergeRecordData({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 }, [], conflicts), { a: 2, b: 3 });
  assert.deepEqual(mergeRecordData({ list: [{ id: 'x', v: 1 }, { id: 'y' }] }, { list: [{ id: 'x', v: 1 }] }, { list: [{ id: 'x', v: 2 }, { id: 'y' }] }, [], conflicts),
    { list: [{ id: 'x', v: 2 }] }, 'a removal on one side and an unrelated edit on the other both apply');
  assert.deepEqual(mergeRecordData({ list: [{ id: 'x', v: 1 }] }, { list: [] }, { list: [{ id: 'x', v: 2 }] }, [], conflicts),
    { list: [{ id: 'x', v: 2 }] }, 'an edit beats a deletion');
  assert.deepEqual(conflicts, ['list.x']);
  assert.deepEqual(mergeRecordData({ tags: ['a'] }, { tags: ['a', 'b'] }, { tags: ['c'] }, [], []), { tags: ['a', 'b'] });
});

// Reproductions from the 2026-11-21 three-account live test. In each case the
// tab used to pause ALL saving ("Shared saving is paused") until a reload.
function bareEditor(options = {}) {
  // A tab whose app-level merge baseline is missing for this record (the
  // writer still knows the version, e.g. after a realtime update).
  const blocked = []; const merges = [];
  const writer = createWriter({
    requestId: () => `merge-test-${++request}`,
    rpc: async (name, payload) => {
      if (options.beforeRpc) await options.beforeRpc(payload);
      try {
        const result = await db.query(`select public.${name}($1,$2::jsonb,$3::jsonb) as result`,
          [payload.p_request_id, JSON.stringify(payload.p_changes), JSON.stringify(payload.p_events)]);
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
    },
    baseFor: () => undefined,
    fetchCurrent: async (changes) => (await db.query('select * from public.crm_records where id = any($1)', [changes.map(c => c.id)])).rows,
    onMerged: (entries) => merges.push(...entries),
    onBlocked: (value) => blocked.push(value),
    conflictRetries: options.conflictRetries,
  });
  return { writer, blocked, merges };
}

test('a conflict on a record with no app baseline merges instead of pausing the tab', async () => {
  const setup = editor();
  await setup.writer.commit([job('live-1', { name: 'QA Devon', status: 'New', docs: [{ id: 'd1' }] })]);
  const devon = bareEditor();
  devon.writer.remember([await saved('live-1')]);
  const other = editor(); const otherCopy = await other.load('live-1');
  otherCopy.status = 'Contacted';
  await other.writer.commit([job('live-1', otherCopy)]);
  // Devon (stale version, writer saw the data when it loaded) adds a document.
  const result = await devon.writer.commit([job('live-1', { name: 'QA Devon', status: 'New', docs: [{ id: 'd1' }, { id: 'd2' }] })]);
  assert.equal(result.error, null);
  assert.equal(devon.blocked.length, 0);
  const row = await saved('live-1');
  assert.deepEqual(row.data.docs, [{ id: 'd1' }, { id: 'd2' }], 'the new document is saved');
  assert.equal(row.data.status, 'Contacted', 'the teammate\'s untouched-here change is not reverted');
});

test('a stale-version save whose data already matches the server never pauses saving', async () => {
  const setup = editor();
  await setup.writer.commit([job('live-2', { name: 'QA Gil', status: 'New' })]);
  const gil = bareEditor();
  gil.writer.remember([await saved('live-2')]);
  await setup.writer.commit([job('live-2', { name: 'QA Gil', status: 'Contacted' })]);
  const result = await gil.writer.commit([job('live-2', { name: 'QA Gil', status: 'Contacted' })]);
  assert.equal(result.error, null);
  assert.equal(gil.blocked.length, 0);
});

test('six tabs saving the same shared record at once all succeed', async () => {
  const setup = editor();
  await setup.writer.commit([job('live-3', { threads: [] })]);
  const tabs = Array.from({ length: 6 }, () => editor());
  const copies = await Promise.all(tabs.map(tab => tab.load('live-3')));
  const results = await Promise.all(tabs.map((tab, i) => tab.writer.commit([job('live-3', { threads: [...copies[i].threads, { id: `t${i}` }] })])));
  results.forEach(result => assert.equal(result.error, null));
  tabs.forEach(tab => assert.equal(tab.blocked.length, 0));
  assert.deepEqual((await saved('live-3')).data.threads.map(t => t.id).sort(), ['t0', 't1', 't2', 't3', 't4', 't5']);
});

test('a realtime echo of this tab\'s own save does not make the next save collide with itself', async () => {
  const setup = editor();
  await setup.writer.commit([job('live-4', { name: 'Echo', step: 0 })]);
  let echo = null;
  const tab = bareEditor({ beforeRpc: async () => { if (echo) { const fn = echo; echo = null; await fn(); } } });
  tab.writer.remember([await saved('live-4')]);
  const first = tab.writer.commit([job('live-4', { name: 'Echo', step: 1 })]);
  await first;
  // The realtime copy of save #1 arrives and the next save is queued from it.
  tab.writer.remember([await saved('live-4')]);
  const second = await tab.writer.commit([job('live-4', { name: 'Echo', step: 2 })]);
  assert.equal(second.error, null);
  assert.equal(tab.blocked.length, 0);
  assert.equal((await saved('live-4')).data.step, 2);
});
