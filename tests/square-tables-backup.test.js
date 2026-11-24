// The five Square tables are in the daily backup.
//
// They are closed to every role, the server's own key included, so the backup
// the server makes could not read them and they were in no backup. One of them
// holds the date Square invoicing was switched on. A database rebuilt from a
// backup stamped a new date there, and every estimate older than the rebuild
// then needed a written review before it could be invoiced.
//
// A database function now hands the five tables to the server, a page at a
// time. These tests hold it to that and nothing more: only the server, only
// this company, only those five tables, only reading. The last test shows what
// the restored date is for, with the database's own invoice function.
// Everything here is made-up data in an in-memory database on this computer.
const test = require('node:test');
const assert = require('node:assert/strict');
const backup = require('../recovery-backup.js');
const restore = require('../scripts/restore-backup.js');
const { createEmptyDatabase } = require('../scripts/local-cloud.js');

const COMPANY = 'coastal-crest';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const SQUARE_TABLES = ['crm_square_invoice_policy', 'crm_square_invoice_reviews', 'crm_square_invoice_intents', 'crm_square_invoice_watermarks', 'crm_square_webhook_events'];
const SERVER = { role: 'service_role', claims: { role: 'service_role' } };

test('manager-readable snapshots and server-only Square snapshots are atomic, isolated, and expire together', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  const rep = '22222222-2222-4222-8222-222222222222';
  const asRole = (role, sub, action) => db.transaction(async tx => {
    await tx.exec('set local role ' + role);
    await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role,sub})]);
    return action(tx);
  });
  const server = fn => asRole('service_role', undefined, fn);
  const square = Object.fromEntries(SQUARE_TABLES.map(k => [k,[{ sample: 'RAW-'+k }]]));
  const record = {company_state_id:COMPANY,backup_date:'2026-11-24',record_count:1,payload:{
    schemaVersion:6, source:'server', skippedTables:[],records:[{id:'ordinary-job'}],tables:{...square,quote_requests:[]}}};
  const save = (tx,row) => tx.query('select public.crm_store_split_backup($1::jsonb,true) as ok',[JSON.stringify(row)]);
  const read = (tx,token) => tx.query('select public.crm_private_square_snapshot($1,$2,$3) as result',[COMPANY,record.backup_date,token]);
  try {
    assert.equal((await server(tx=>save(tx,record))).rows[0].ok,true);
    assert.equal((await server(tx=>save(tx,record))).rows[0].ok,false);
    const managerRow = async tx => (await tx.query('select payload from public.crm_backups where backup_date=$1',[record.backup_date])).rows[0];
    const visible = await asRole('authenticated',ADMIN,managerRow);
    assert.deepEqual(visible.payload.records,[{id:'ordinary-job'}]);
    assert.deepEqual(visible.payload.tables,{quote_requests:[]});
    assert.ok(!JSON.stringify(visible).includes('RAW-'));
    const token = visible.payload.privateSquareSnapshot;
    assert.deepEqual((await server(tx=>read(tx,token))).rows[0].result,square);
    assert.equal(await asRole('authenticated',rep,managerRow),undefined);
    await db.query("update public.crm_user_access set role='office_manager' where user_id=$1",[rep]);
    assert.deepEqual(await asRole('authenticated',rep,managerRow),visible);
    for (const [role,id] of [['authenticated',rep],['authenticated',ADMIN],['anon',undefined]]) {
      for (const fn of [tx=>read(tx,token),tx=>save(tx,record),tx=>tx.query('select tables from jobcrest_backup_private.square_snapshots')]) {
        await assert.rejects(asRole(role,id,fn),e=>e.code==='42501');
      }
    }
    await assert.rejects(server(tx=>read(tx,'00000000-0000-4000-8000-000000000000')),e=>e.code==='P0002');
    await assert.rejects(db.query("insert into public.crm_backups(company_state_id,backup_date,payload) values($1,'2026-11-25',$2)",[COMPANY,JSON.stringify(record.payload)]),e=>e.code==='23514');
    // A fault on the private write must not leave a manager row that looks complete.
    await db.exec("alter table jobcrest_backup_private.square_snapshots add constraint drill_failure check (false) not valid");
    await assert.rejects(server(tx=>save(tx,{...record,backup_date:'2026-11-26'})),e=>e.code==='23514');
    assert.equal((await db.query("select count(*)::int as n from public.crm_backups where backup_date='2026-11-26'")).rows[0].n,0);
    await db.query('delete from public.crm_backups where backup_date=$1',[record.backup_date]);
    assert.equal((await db.query('select count(*)::int as n from jobcrest_backup_private.square_snapshots')).rows[0].n,0);
  } finally { await db.close(); }
});

// Runs one piece of work as a role, with the sign-in the API would give it, and undoes it afterwards.
async function as(db, { role, claims }, work) {
  await db.exec(`begin; ${role ? `set local role ${role};` : ''} select set_config('request.jwt.claims', '${JSON.stringify(claims || {})}', true);`);
  try { return await work(); } finally { await db.exec('rollback'); }
}
const page = async (db, who, company, table, offset, limit) => as(db, who, async () =>
  (await db.query(`select public.${backup.SQUARE_BACKUP_FUNCTION}($1, $2, $3, $4) as page`, [company, table, offset, limit])).rows[0].page);

// The server's own backup code, run against a database directly: tables are
// read as the API would return them (in the order and the page asked for, with
// the table's row count), and the Square function is called as the server.
async function backupOf(db, { pageSize } = {}) {
  let stored = null;
  const answer = (body, status = 200, range = null) => ({ ok: status < 300, status, json: async () => body, headers: { get: (name) => (name.toLowerCase() === 'content-range' ? range : null) } });
  const fetcher = async (input, options = {}) => {
    const url = new URL(input);
    const table = url.pathname.split('/').pop();
    if (url.pathname.endsWith('/rpc/crm_store_split_backup')) { stored = JSON.parse(options.body).p_backup; return answer(true); }
    if (table === 'crm_backups') return answer([]);
    if (url.pathname.endsWith(`/rpc/${backup.SQUARE_BACKUP_FUNCTION}`)) {
      const args = JSON.parse(options.body);
      return answer(await page(db, SERVER, args.p_company, args.p_table, args.p_offset, args.p_limit));
    }
    const scoped = url.searchParams.get('company_state_id');
    const like = url.searchParams.get('id')?.startsWith('like.') ? url.searchParams.get('id').slice(5).replace('*', '%') : '';
    const order = (url.searchParams.get('order') || '').split(',').filter(Boolean).map((part) => `"${part.split('.')[0].replace(/[^a-z0-9_]/g, '')}"`).join(', ');
    const all = (await db.query(`select * from public."${table}"${scoped ? ' where company_state_id = $1' : like ? ' where id like $1' : ''}${order ? ` order by ${order}` : ''}`, scoped ? [scoped.slice(3)] : like ? [like] : [])).rows;
    const [from, to] = String(options.headers?.Range || `0-${all.length}`).split('-').map(Number);
    const rows = all.slice(from, to + 1);
    return answer(JSON.parse(JSON.stringify(rows)), 200, `${rows.length ? `${from}-${from + rows.length - 1}` : '*'}/${all.length}`);
  };
  const result = await backup.createDailyBackup({ origin: 'https://example.supabase.co', companyId: COMPANY, key: 'sb_secret_test', fetch: fetcher, ...(pageSize ? { pageSize } : {}) });
  return { result, payload: stored.payload };
}

async function addWebhookEvents(db, count, company = COMPANY) {
  await db.query(`insert into public.crm_square_webhook_events(company_state_id, environment, merchant_id, event_id, invoice_id, event_type, event_created_at, payload)
    select $1, case when n % 3 = 0 then 'sandbox' else 'production' end, 'TESTMERCHANT', 'event-' || lpad(n::text, 3, '0'), 'inv-' || n, 'invoice.payment_made',
      clock_timestamp(), jsonb_build_object('n', n, 'note', 'TEST event') from generate_series(1, $2::int) n`, [company, count]);
}

test('only the server may call it; a signed-in person, a visitor and the bare server role are all refused', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    const call = (who, company = COMPANY, table = 'crm_square_invoice_policy', offset = 0, limit = 100) => page(db, who, company, table, offset, limit);
    const ok = await call(SERVER);
    assert.equal(ok.total, 2);
    assert.deepEqual(ok.rows.map((row) => row.environment), ['production', 'sandbox']);
    // No permission to run it at all.
    await assert.rejects(call({ role: 'anon', claims: { role: 'anon' } }), /permission denied for function crm_square_backup_page/);
    await assert.rejects(call({ role: 'authenticated', claims: { role: 'authenticated', sub: ADMIN, app_metadata: { role: 'admin' } } }), /permission denied for function crm_square_backup_page/);
    // A visitor cannot get it by claiming to be the server.
    await assert.rejects(call({ role: 'anon', claims: { role: 'service_role' } }), /permission denied for function crm_square_backup_page/);
    // Permission to run it is not enough without the server's sign-in: the database's own Square check still applies.
    await assert.rejects(call({ role: 'service_role', claims: {} }), /server_worker_required/);
    await assert.rejects(call({ role: 'service_role', claims: { role: 'authenticated', sub: ADMIN } }), /server_worker_required/);
    await assert.rejects(call({ role: '', claims: {} }), /server_worker_required/, 'the database owner without the server sign-in');
    // This company only.
    await assert.rejects(call(SERVER, 'another-company'), /company_required/);
    await assert.rejects(call(SERVER, null), /company_required/);
    await assert.rejects(call(SERVER, ''), /company_required/);
    // The five tables only: it is no way into any other table, closed or not.
    for (const table of ['crm_records', 'crm_oauth_connections', 'crm_backups', 'crm_square_invoice_policy; drop table crm_records', 'CRM_SQUARE_INVOICE_POLICY', '', null]) {
      await assert.rejects(call(SERVER, COMPANY, table), /not_a_square_table/, String(table));
    }
    // A page is 1 to 1,000 rows from a start that is not negative.
    for (const [offset, limit] of [[-1, 10], [0, 0], [0, 1001], [null, 10], [0, null]]) {
      await assert.rejects(call(SERVER, COMPANY, 'crm_square_invoice_policy', offset, limit), /invalid_backup_page/, `${offset}, ${limit}`);
    }
  } finally { await db.close(); }
});

test('the tables stay closed, and the function only reads', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    await restore.seedEveryTable(db, { companyId: COMPANY, userId: ADMIN });
    const may = (await db.query(`select c.relname as name, r as role, p as privilege, has_table_privilege(r, c.oid, p) as allowed
      from pg_class c, unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
      where c.relnamespace = 'public'::regnamespace and c.relname = any($1)`, [SQUARE_TABLES])).rows;
    assert.equal(may.length, 75);
    assert.deepEqual(may.filter((item) => item.allowed), [], 'no role may read or write any of the five tables directly');
    for (const table of SQUARE_TABLES) {
      await assert.rejects(as(db, SERVER, () => db.query(`select count(*) from public."${table}"`)), /permission denied for table/, table);
    }
    const shape = (await db.query(`select p.provolatile as volatility, p.prosecdef as definer, p.proconfig as settings, pg_get_function_result(p.oid) as returns
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [backup.SQUARE_BACKUP_FUNCTION])).rows;
    // "s" is stable: the database itself refuses any write made from inside such a function.
    assert.deepEqual(shape, [{ volatility: 's', definer: true, settings: ['search_path=""'], returns: 'jsonb' }]);
    const fingerprint = async () => (await db.query(SQUARE_TABLES.map((table) => `select '${table}' as name, count(*)::int as n, md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text), '')) as hash from public."${table}" t`).join(' union all '))).rows;
    const before = await fingerprint();
    assert.ok(before.every((item) => item.n >= 1), 'each table has a row to read');
    for (const table of SQUARE_TABLES) await page(db, SERVER, COMPANY, table, 0, 1000);
    assert.deepEqual(await fingerprint(), before);
  } finally { await db.close(); }
});

test('it hands over every row of this company exactly once, in the order of the table\'s key, with the count', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    await addWebhookEvents(db, 7);
    await addWebhookEvents(db, 4, 'another-company');
    const expected = (await db.query(`select to_jsonb(t) as row from public.crm_square_webhook_events t where company_state_id = $1 order by environment, merchant_id, event_id`, [COMPANY])).rows.map((item) => item.row);
    assert.equal(expected.length, 7);
    const collected = [];
    for (const offset of [0, 3, 6, 9]) {
      const answer = await page(db, SERVER, COMPANY, 'crm_square_webhook_events', offset, 3);
      assert.equal(answer.total, 7, 'every page gives the whole count');
      assert.equal(answer.rows.length, Math.max(0, Math.min(3, 7 - offset)));
      collected.push(...answer.rows);
    }
    assert.deepEqual(collected, expected, 'the same rows, whole, in key order');
    assert.ok(collected.every((row) => row.company_state_id === COMPANY), 'no other company\'s rows');
    // An empty table is an empty list and a count of zero, not an error.
    assert.deepEqual(await page(db, SERVER, COMPANY, 'crm_square_invoice_reviews', 0, 100), { total: 0, rows: [] });

    // The backup's own code reads it the same way, however small the pages.
    const { result, payload } = await backupOf(db, { pageSize: 2 });
    assert.equal(result.incomplete, undefined);
    assert.deepEqual(payload.tables.crm_square_webhook_events, JSON.parse(JSON.stringify(expected)));
    assert.equal(payload.tables.crm_square_invoice_policy.length, 2);
    assert.deepEqual(payload.skippedTables, []);
    assert.equal(payload.schemaVersion, 6);
  } finally { await db.close(); }
});

test('a Square table that changes between two pages, or comes back wrong, is not stored as if it were whole', async () => {
  const event = (n) => ({ company_state_id: COMPANY, environment: 'production', merchant_id: 'TESTMERCHANT', event_id: `event-${n}` });
  const run = async (pages) => {
    let stored = null;
    const asked = [];
    const answer = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
    const fetcher = async (input, options = {}) => {
      const url = new URL(input);
      if (url.pathname.endsWith('/rpc/crm_store_split_backup')) { stored = JSON.parse(options.body).p_backup; return answer(true); }
      if (url.pathname.endsWith('/crm_backups')) return answer([]);
      if (!url.pathname.endsWith(`/rpc/${backup.SQUARE_BACKUP_FUNCTION}`)) return answer([]);
      const args = JSON.parse(options.body);
      if (args.p_table !== 'crm_square_webhook_events') return answer({ total: 0, rows: [] });
      asked.push(args);
      // The last answer is given again for as long as it is asked for, as a database that keeps answering wrongly would.
      if (asked.length > 20) throw new Error('asked without end');
      const next = pages[Math.min(asked.length, pages.length) - 1];
      return next?.status ? answer(next.body, next.status) : answer(next);
    };
    const result = await backup.createDailyBackup({ origin: 'https://example.supabase.co', companyId: COMPANY, key: 'sb_secret_test', fetch: fetcher, pageSize: 2 });
    return { result, payload: stored.payload, asked };
  };
  // Read whole: three rows over two pages, each asked for from where the last ended.
  const whole = await run([{ total: 3, rows: [event(1), event(2)] }, { total: 3, rows: [event(3)] }]);
  assert.equal(whole.result.incomplete, undefined);
  assert.deepEqual(whole.payload.tables.crm_square_webhook_events, [event(1), event(2), event(3)]);
  assert.deepEqual(whole.asked, [{ p_company: COMPANY, p_table: 'crm_square_webhook_events', p_offset: 0, p_limit: 2 }, { p_company: COMPANY, p_table: 'crm_square_webhook_events', p_offset: 2, p_limit: 2 }]);
  // Each of these is a table that could not be read: named as skipped, the backup marked incomplete, and no rows kept for it.
  const faults = {
    'a row arrived between two pages': [{ total: 3, rows: [event(1), event(2)] }, { total: 4, rows: [event(3), event(4)] }],
    // The pages add up to the first count and no row is doubled; only the count says the table changed.
    'a row arrived at the end between two pages': [{ total: 4, rows: [event(1), event(2)] }, { total: 5, rows: [event(3), event(4)] }],
    // Without a count there is no telling when to stop: it must be refused, not asked for again and again.
    'a count that is missing': [{ total: null, rows: [] }],
    'a count below zero': [{ total: -1, rows: [] }],
    'a count that is not whole': [{ total: 1.5, rows: [event(1)] }],
    'the same row on two pages': [{ total: 3, rows: [event(1), event(2)] }, { total: 3, rows: [event(2)] }],
    'more rows than the count': [{ total: 1, rows: [event(1), event(2)] }],
    'an empty page before the end': [{ total: 3, rows: [event(1), event(2)] }, { total: 3, rows: [] }],
    'the database refused': [{ status: 403, body: { code: '42501', message: 'server_worker_required' } }],
    'the function is not there yet': [{ status: 404, body: { code: 'PGRST202' } }],
    'an answer that is not a page': [[event(1)]],
    'a count that is not a number': [{ total: '3', rows: [event(1)] }],
    'rows that are not rows': [{ total: 2, rows: [event(1), 'event-2'] }],
    'no answer': [null],
  };
  for (const [name, pages] of Object.entries(faults)) {
    const outcome = await run(pages);
    assert.deepEqual(outcome.result.incomplete, ['crm_square_webhook_events'], name);
    assert.ok(outcome.asked.length <= pages.length, `${name}: it stops at the first wrong answer (asked ${outcome.asked.length} times)`);
    assert.deepEqual(outcome.payload.skippedTables, ['crm_square_webhook_events'], name);
    assert.equal(Object.hasOwn(outcome.payload.tables, 'crm_square_webhook_events'), false, name);
    assert.ok(backup.missingTables(outcome.payload).includes('crm_square_webhook_events'), name);
  }
});

test('a backup made before the Square tables were in it is said to be missing them', () => {
  const tables = Object.fromEntries(backup.EXTRA_TABLES.filter((item) => !item.via).map((item) => [item.table, []]));
  const older = { schemaVersion: 5, records: [], auditEvents: [], conversationMessages: [], stateRows: [], tables, skippedTables: [], absentTables: [] };
  assert.deepEqual(backup.missingTables(older).sort(), [...SQUARE_TABLES].sort());
  assert.deepEqual(restore.backupGaps(older).sort(), SQUARE_TABLES.map((table) => `${table}: not in the backup`).sort());
  assert.deepEqual(backup.missingTables({ ...older, tables: { ...tables, ...Object.fromEntries(SQUARE_TABLES.map((table) => [table, []])) } }), []);
});

// What the date is for. Square invoicing asks, for every estimate, whether it
// was made after invoicing was switched on; an older one needs a written review
// first. A rebuilt database stamps "switched on" with the time of the rebuild.
test('after a rebuild, an estimate that could be invoiced before can still be invoiced, because the switch-on date came back', async () => {
  const source = await createEmptyDatabase({ quiet: true });
  let withoutSquare; let rebuilt;
  try {
    const switchedOn = (await source.query(`select installed_at from public.crm_square_invoice_policy where company_state_id = $1 and environment = 'production'`, [COMPANY])).rows[0].installed_at;
    // A won estimate made just after invoicing was switched on, with its customer and job.
    const made = new Date(new Date(switchedOn).getTime() + 5).toISOString();
    const row = (type, id, leadId, jobId, data) => [COMPANY, type, id, leadId, jobId, ADMIN, JSON.stringify({ id, ...data }), made];
    await source.exec('set session_replication_role = replica');
    for (const values of [
      row('contact', 'lead-sq', 'lead-sq', null, { name: 'TEST Customer', email: 'customer@example.com', leadNumber: 'TEST-9001' }),
      row('job', 'job-sq', 'lead-sq', 'job-sq', { projectNumber: 'TEST-9001-01', address: '1 Example Street' }),
      row('estimate', 'est-sq', 'lead-sq', 'job-sq', { contactId: 'lead-sq', jobId: 'job-sq', status: 'Won', estimateNumber: 'TEST-E-1', items: [{ id: 'line-a', title: 'TEST roof repair', quantity: 2, rate: 150.25 }] }),
    ]) {
      await source.query(`insert into public.crm_records(company_state_id, record_type, id, lead_id, job_id, owner_id, data, version, created_at, updated_at, updated_by)
        values($1, $2, $3, $4, $5, $6::uuid, $7::jsonb, 1, $8::timestamptz, $8::timestamptz, $6::uuid)`, values);
    }
    await source.exec('set session_replication_role = origin');
    const begin = (db) => as(db, SERVER, async () => (await db.query(`select public.crm_square_begin_invoice($1, $2::uuid, 'est-sq', 1, 'production') as intent`, [COMPANY, ADMIN])).rows[0].intent);
    // Before anything goes wrong: it can be invoiced.
    assert.equal((await begin(source)).status, 'pending');

    const { result, payload } = await backupOf(source);
    assert.equal(result.incomplete, undefined);
    // A moment passes, so the rebuilt databases are certainly stamped later than the estimate.
    await new Promise((resolve) => setTimeout(resolve, 25));

    // As it was until now: everything restored except the Square tables.
    withoutSquare = await createEmptyDatabase({ quiet: true });
    const older = structuredClone(payload);
    for (const table of SQUARE_TABLES) delete older.tables[table];
    await restore.restoreAll(withoutSquare, older, { companyId: COMPANY });
    await assert.rejects(begin(withoutSquare), /legacy_invoice_review_required/, 'the estimate is treated as older than Square invoicing');

    // With them: the date is the original, and the estimate can be invoiced as before.
    rebuilt = await createEmptyDatabase({ quiet: true });
    const stampedByRebuild = (await rebuilt.query(`select installed_at from public.crm_square_invoice_policy where company_state_id = $1 and environment = 'production'`, [COMPANY])).rows[0].installed_at;
    assert.ok(new Date(stampedByRebuild) > new Date(made), 'a new database stamps its own, later date');
    await restore.restoreAll(rebuilt, payload, { companyId: COMPANY });
    const after = (await rebuilt.query(`select environment, installed_at from public.crm_square_invoice_policy where company_state_id = $1 order by environment`, [COMPANY])).rows;
    const original = (await source.query(`select environment, installed_at from public.crm_square_invoice_policy where company_state_id = $1 order by environment`, [COMPANY])).rows;
    assert.deepEqual(JSON.parse(JSON.stringify(after)), JSON.parse(JSON.stringify(original)), 'both environments have their original date, to the microsecond');
    const intent = await begin(rebuilt);
    assert.equal(intent.status, 'pending');
    assert.equal(intent.payload.estimateNumber, 'TEST-E-1');
    assert.deepEqual(restore.restoreVerdict(await restore.compareWithBackup(rebuilt, payload, { companyId: COMPANY }), { payload }), []);
  } finally { await source.close(); await withoutSquare?.close(); await rebuilt?.close(); }
});
