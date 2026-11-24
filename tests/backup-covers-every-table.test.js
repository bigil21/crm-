// The daily backup holds every table of the CRM, or says why not.
//
// Found by Codex before release: a job permit was created, the CRM's backup
// was run and restored into an empty database, and the permit was gone. The
// backup had never asked for the permits table. Its list had been written from
// the tables its author thought of, and 47 of the database's 79 were not on it.
//
// These tests hold the backup's lists against the real schema, built from the
// repo's own schema.sql and migrations in an in-memory PostgreSQL. A table
// added to the CRM later makes them fail until it is put in the backup or left
// out on purpose, with a reason. Nothing here touches a network.
const test = require('node:test');
const assert = require('node:assert/strict');
const backup = require('../recovery-backup.js');
const restore = require('../scripts/restore-backup.js');
const { createEmptyDatabase } = require('../scripts/local-cloud.js');

const COMPANY = 'coastal-crest';
const ADMIN = '11111111-1111-4111-8111-111111111111';
const extra = backup.EXTRA_TABLES.map((item) => item.table);
const excluded = Object.keys(backup.EXCLUDED_TABLES);

test('a server-imposed short page cannot silently truncate the job backup', async () => {
  const permits = Array.from({ length: 7 }, (_, id) => ({ id }));
  const starts = [];
  const fetch = async (_url, { headers }) => {
    const start = Number(headers.Range.split('-')[0]); starts.push(start);
    const rows = permits.slice(start, start + 2);
    return Response.json(rows, { headers: { 'content-range': `${start}-${start + rows.length - 1}/${start ? '*' : 7}` } });
  };
  assert.deepEqual(await backup.fetchRows({ origin: 'http://localhost', key: 'fixture', fetch, pageSize: 5 }, 'crm_permits'), permits);
  assert.deepEqual(starts, [0, 2, 4, 6]);
});

// The database's Square function, called the way the server calls it: as the
// server's role, with the server's sign-in.
async function squarePage(db, args) {
  await db.exec(`begin; set local role service_role; select set_config('request.jwt.claims', '{"role":"service_role"}', true);`);
  try {
    return (await db.query(`select public.${backup.SQUARE_BACKUP_FUNCTION}($1, $2, $3, $4) as page`, [args.p_company, args.p_table, args.p_offset, args.p_limit])).rows[0].page;
  } finally { await db.exec('rollback'); }
}
// The same function's answer for a table with nothing in it.
const emptySquarePage = (url) => (new URL(url).pathname.endsWith(`/rpc/${backup.SQUARE_BACKUP_FUNCTION}`) ? { total: 0, rows: [] } : null);

async function schema(db) {
  const tables = (await db.query(`select c.relname as name, has_table_privilege('service_role', c.oid, 'SELECT') as server_can_read
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1`)).rows;
  const columns = (await db.query(`select table_name, column_name from information_schema.columns where table_schema = 'public'`)).rows;
  const columnsOf = (table) => columns.filter((row) => row.table_name === table).map((row) => row.column_name);
  return { tables, names: tables.map((row) => row.name), columnsOf };
}

test('every table in the database is in the backup, or left out on purpose with a reason', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    const { names } = await schema(db);
    assert.ok(names.length >= 79, `the schema has ${names.length} tables`);
    const lists = [...backup.CORE_TABLES, ...extra, ...excluded];
    assert.deepEqual(names.filter((name) => !lists.includes(name)), [], 'tables that are in neither list: add each to EXTRA_TABLES, or to EXCLUDED_TABLES with its reason');
    assert.deepEqual(lists.filter((name, index) => lists.indexOf(name) !== index), [], 'no table is in two lists');
    // A name on a list that the database does not have is a typing mistake.
    assert.deepEqual(lists.filter((name) => !names.includes(name)), []);
    // No table is optional any more. The one that was, quote_requests, existed
    // only on the live project; the repo's migrations make it now.
    assert.deepEqual(backup.EXTRA_TABLES.filter((item) => item.optional).map((item) => item.table), []);
    assert.ok(names.includes('quote_requests') && extra.includes('quote_requests'), 'the website\'s quote requests are in the schema and in the backup');
    for (const [table, reason] of Object.entries(backup.EXCLUDED_TABLES)) assert.ok(String(reason).trim().length > 20, `${table} says why it is left out`);
    // The tables named in the finding, and the others of their kind.
    for (const table of ['crm_permits', 'crm_inspections', 'crm_job_selections', 'crm_maintenance_plans', 'crm_maintenance_visits', 'crm_account_properties',
      'crm_account_contacts', 'crm_organization_accounts', 'crm_job_milestones', 'crm_project_notes', 'crm_task_comments', 'crm_document_versions',
      'crm_website_intake_requests', 'crm_customer_messages', 'crm_role_capabilities', 'crm_operational_settings']) {
      assert.ok(extra.includes(table), `${table} is backed up`);
    }
  } finally { await db.close(); }
});

test('the backup can actually read every table on its list, the way it asks for them', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    const { tables, names, columnsOf } = await schema(db);
    const canRead = new Map(tables.map((row) => [row.name, row.server_can_read]));
    const closed = backup.EXTRA_TABLES.filter((item) => item.via).map((item) => item.table);
    assert.deepEqual(closed.sort(), ['crm_square_invoice_intents', 'crm_square_invoice_policy', 'crm_square_invoice_reviews', 'crm_square_invoice_watermarks', 'crm_square_webhook_events']);
    for (const { table, order, everyCompany, optional, via } of backup.EXTRA_TABLES) {
      if (optional && !names.includes(table)) continue;
      const columns = columnsOf(table);
      // Read directly where the server's key may; through the database's own function where it may not.
      if (via) {
        assert.equal(via, backup.SQUARE_BACKUP_FUNCTION);
        assert.equal(canRead.get(table), false, `${table}: still closed to the server's key`);
      } else {
        assert.equal(canRead.get(table), true, `${table}: the server's key may read it`);
      }
      assert.equal(columns.includes('company_state_id'), !everyCompany, `${table}: ${everyCompany ? 'has no' : 'has a'} company column, as the list says`);
      for (const part of order.split(',')) {
        const [column, direction] = part.split('.');
        assert.ok(columns.includes(column), `${table}: is ordered by ${column}, which it has`);
        assert.equal(direction, 'asc');
      }
      // Ordered by its whole key, so pages of rows can neither overlap nor skip one.
      const key = (await db.query(`select a.attname as name from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
        where i.indrelid = to_regclass($1) and i.indisprimary`, [`public.${table}`])).rows.map((row) => row.name).filter((name) => name !== 'company_state_id');
      assert.deepEqual(order.split(',').map((part) => part.split('.')[0]).sort(), key.sort(), `${table}: ordered by its key`);
    }
    // Every Square table is one of the five read through the function, and none is left out any more.
    assert.deepEqual(names.filter((name) => name.startsWith('crm_square_')).sort(), closed);
    assert.deepEqual(excluded.filter((name) => name.startsWith('crm_square_')), []);
    // The function exists, and only the server's key may call it.
    const callers = (await db.query(`select has_function_privilege('service_role', p.oid, 'EXECUTE') as server, has_function_privilege('authenticated', p.oid, 'EXECUTE') as signed_in,
        has_function_privilege('anon', p.oid, 'EXECUTE') as visitor from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = $1`, [backup.SQUARE_BACKUP_FUNCTION])).rows;
    assert.deepEqual(callers, [{ server: true, signed_in: false, visitor: false }]);
    // Nothing that looks like a secret is in a backed-up table, apart from one hash of a public form's token.
    const secrets = (await db.query(`select table_name || '.' || column_name as name from information_schema.columns where table_schema = 'public'
      and (column_name ilike '%token%' or column_name ilike '%secret%' or column_name ilike '%password%' or column_name ilike '%api_key%' or column_name ilike '%credential%')`)).rows
      .map((row) => row.name).filter((name) => ![...excluded].includes(name.split('.')[0]));
    assert.deepEqual(secrets, ['crm_web_lead_forms.public_token_hash']);
  } finally { await db.close(); }
});

test('a record can be made in every table on the list, so none is only ever tested empty', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    const result = await restore.seedEveryTable(db, { companyId: COMPANY, userId: ADMIN });
    assert.deepEqual(result.failed, []);
    const { names } = await schema(db);
    for (const table of extra.filter((name) => names.includes(name))) {
      const count = Number((await db.query(`select count(*)::int as n from public."${table}"`)).rows[0].n);
      assert.ok(count >= 1, `${table} has a record`);
    }
  } finally { await db.close(); }
});

// Codex's case, end to end on one table: a permit goes in, the backup is made
// by the server's own code, an empty database is rebuilt from it, and the
// permit is there.
test('a job permit that is backed up comes back when the backup is restored', async () => {
  const source = await createEmptyDatabase({ quiet: true });
  const rebuilt = await createEmptyDatabase({ quiet: true });
  try {
    await source.query(`insert into public.crm_records(company_state_id, record_type, id, lead_id, owner_id, updated_by, data) values($1, 'contact', 'lead-1', 'lead-1', $2, $2, '{"name":"TEST Lead"}')`, [COMPANY, ADMIN]);
    await restore.seedEveryTable(source, { companyId: COMPANY, userId: ADMIN });
    const permit = (await source.query('select * from public.crm_permits')).rows;
    assert.equal(permit.length, 1);
    // The backup reads through the database's web interface; here that is this database, asked directly.
    let stored = null;
    const fetcher = async (input, options = {}) => {
      const url = new URL(input);
      const table = url.pathname.split('/').pop();
      const answer = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
      if (table === 'crm_store_split_backup') { stored = JSON.parse(options.body).p_backup; return answer(true); }
      if (table === 'crm_backups') return answer([]);
      if (url.pathname.endsWith(`/rpc/${backup.SQUARE_BACKUP_FUNCTION}`)) return answer(await squarePage(source, JSON.parse(options.body)));
      try {
        const scoped = url.searchParams.get('company_state_id');
        const like = url.searchParams.get('id')?.startsWith('like.') ? url.searchParams.get('id').slice(5).replace('*', '%') : '';
        const rows = (await source.query(`select * from public."${table}"${scoped ? ' where company_state_id = $1' : like ? ' where id like $1' : ''}`, scoped ? [scoped.slice(3)] : like ? [like] : [])).rows;
        return answer(JSON.parse(JSON.stringify(rows)));
      } catch { return answer({ code: '42P01' }, 404); }
    };
    const made = await backup.createDailyBackup({ origin: 'https://example.supabase.co', companyId: COMPANY, key: 'sb_secret_test', fetch: fetcher });
    assert.deepEqual(made.incomplete, undefined, 'the backup is whole');
    assert.equal(stored.payload.tables.crm_permits.length, 1, 'the permit is in the backup');
    assert.deepEqual(stored.payload.absentTables, [], 'no table of the backup is absent from a database built from the repo');
    assert.equal(stored.payload.tables.quote_requests.length, 1, 'the website quote request is in the backup');
    // The photo that request names is listed, so the copy of the files knows to fetch it.
    assert.deepEqual(stored.payload.quotePhotoPaths, restore.TEST_ROW_VALUES.quote_requests.photo_paths);
    assert.deepEqual(restore.backupGaps(stored.payload), []);

    await restore.restoreAll(rebuilt, stored.payload, { companyId: COMPANY });
    const back = (await rebuilt.query('select * from public.crm_permits')).rows;
    assert.deepEqual(JSON.parse(JSON.stringify(back)), JSON.parse(JSON.stringify(permit)), 'the permit came back exactly as it was');
    const comparison = await restore.compareWithBackup(rebuilt, stored.payload, { companyId: COMPANY });
    assert.deepEqual(restore.restoreVerdict(comparison, { payload: stored.payload }), []);
    // And not only permits: every table that had a record got it back.
    for (const item of comparison.filter((entry) => extra.includes(entry.table) && !entry.tableMissing)) {
      assert.ok(item.inBackup >= 1 && item.identical === item.inBackup, `${item.table}: ${item.identical} of ${item.inBackup} came back`);
    }
  } finally { await source.close(); await rebuilt.close(); }
});

test('a table the database does not have is a failure like any that cannot be read: none is optional, quote requests included', async () => {
  const run = async (status) => {
    let stored = null;
    const fetcher = async (input, options = {}) => {
      const table = new URL(input).pathname.split('/').pop();
      const answer = (body, code = 200) => ({ ok: code < 300, status: code, json: async () => body });
      if (table === 'crm_store_split_backup') { stored = JSON.parse(options.body).p_backup; return answer(true); }
      if (table === 'crm_backups') return answer([]);
      if (table === 'quote_requests' || table === 'crm_permits') return answer({}, status);
      return answer(emptySquarePage(input) || []);
    };
    const result = await backup.createDailyBackup({ origin: 'https://example.supabase.co', companyId: COMPANY, key: 'sb_secret_test', fetch: fetcher });
    return { result, payload: stored.payload };
  };
  // "No such table" used to be an answer for quote_requests. It is a table that could not be read now, as for permits.
  for (const status of [404, 500]) {
    const outcome = await run(status);
    assert.deepEqual(outcome.payload.absentTables, [], `status ${status}`);
    assert.deepEqual([...outcome.payload.skippedTables].sort(), ['crm_permits', 'quote_requests'], `status ${status}`);
    assert.deepEqual([...outcome.result.incomplete].sort(), ['crm_permits', 'quote_requests'], `status ${status}`);
    assert.deepEqual(outcome.payload.quotePhotoPaths, [], 'with no quote requests read, no photos are listed');
  }
  // A backup made while the table was still optional, by a database that did
  // not have it, holds no quote requests. It is said to be missing them.
  const without = Object.fromEntries(extra.filter((name) => name !== 'quote_requests').map((name) => [name, []]));
  assert.deepEqual(backup.missingTables({ tables: without, skippedTables: [], absentTables: ['quote_requests'] }), ['quote_requests']);
  assert.deepEqual(backup.missingTables({ tables: without, skippedTables: [], absentTables: [] }), ['quote_requests']);
  assert.deepEqual(backup.missingTables({ tables: { ...without, quote_requests: [] }, skippedTables: [], absentTables: [] }), []);
});

test('the way of marking a table optional still works, for the day a table needs it again', async () => {
  // Marked optional for this test only: a database without it records that, and the backup is whole.
  const entry = backup.EXTRA_TABLES.find((item) => item.table === 'quote_requests');
  entry.optional = true;
  try {
    let stored = null;
    const fetcher = async (input, options = {}) => {
      const table = new URL(input).pathname.split('/').pop();
      const answer = (body, code = 200) => ({ ok: code < 300, status: code, json: async () => body });
      if (table === 'crm_store_split_backup') { stored = JSON.parse(options.body).p_backup; return answer(true); }
      if (table === 'crm_backups') return answer([]);
      return table === 'quote_requests' ? answer({}, 404) : answer(emptySquarePage(input) || []);
    };
    const result = await backup.createDailyBackup({ origin: 'https://example.supabase.co', companyId: COMPANY, key: 'sb_secret_test', fetch: fetcher });
    assert.deepEqual(stored.payload.absentTables, ['quote_requests']);
    assert.deepEqual(stored.payload.skippedTables, []);
    assert.equal(result.incomplete, undefined);
    assert.deepEqual(backup.missingTables(stored.payload), []);
  } finally { delete entry.optional; }
});

test('the photos named by website quote requests are listed once each, and nothing else is', () => {
  const a = '0f8fad5b-d9cb-469f-a165-70867728950e/roof.jpg';
  const b = '7c9e6679-7425-40de-944b-e07fc1f90ae7/leak.png';
  assert.deepEqual(backup.quotePhotoPaths({ quote_requests: [{ photo_paths: [a, b] }, { photo_paths: [a] }, { photo_paths: [] }, { photo_paths: null }, {}, null, { photo_paths: ['', 7, null, { path: a }] }] }), [a, b]);
  assert.deepEqual(backup.quotePhotoPaths({}), []);
  assert.deepEqual(backup.quotePhotoPaths(), []);
  assert.deepEqual(backup.quotePhotoPaths({ quote_requests: 'lost' }), []);
  assert.equal(backup.QUOTE_PHOTO_BUCKET, 'quote-photos');
});
