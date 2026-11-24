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
    // A name on a list that the database does not have is a typing mistake, unless it is marked optional.
    const optional = backup.EXTRA_TABLES.filter((item) => item.optional).map((item) => item.table);
    assert.deepEqual(lists.filter((name) => !names.includes(name) && !optional.includes(name)), []);
    assert.deepEqual(optional, ['quote_requests'], 'the one table production has that the repo\'s schema does not');
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
    for (const { table, order, everyCompany, optional } of backup.EXTRA_TABLES) {
      if (optional && !names.includes(table)) continue;
      const columns = columnsOf(table);
      assert.equal(canRead.get(table), true, `${table}: the server's key may read it`);
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
    // The reason given for leaving the Square tables out is true: the server's key cannot read them.
    for (const table of excluded.filter((name) => name.startsWith('crm_square_'))) assert.equal(canRead.get(table), false, `${table} is closed to the server's key`);
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
      if (table === 'crm_backups') { if (options.method === 'POST') stored = JSON.parse(options.body); return answer(options.method === 'POST' ? null : []); }
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
    assert.deepEqual(stored.payload.absentTables, ['quote_requests']);
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

test('a table that only some databases have is recorded as absent, not as a failure; one that cannot be read is a failure', async () => {
  const run = async (status) => {
    let stored = null;
    const fetcher = async (input, options = {}) => {
      const table = new URL(input).pathname.split('/').pop();
      const answer = (body, code = 200) => ({ ok: code < 300, status: code, json: async () => body });
      if (table === 'crm_backups') { if (options.method === 'POST') stored = JSON.parse(options.body); return answer(options.method === 'POST' ? null : []); }
      if (table === 'quote_requests' || table === 'crm_permits') return answer({}, status);
      return answer([]);
    };
    const result = await backup.createDailyBackup({ origin: 'https://example.supabase.co', companyId: COMPANY, key: 'sb_secret_test', fetch: fetcher });
    return { result, payload: stored.payload };
  };
  // "No such table" for the optional one is an answer. For permits, which every database has, it is not.
  const absent = await run(404);
  assert.deepEqual(absent.payload.absentTables, ['quote_requests']);
  assert.deepEqual(absent.payload.skippedTables, ['crm_permits']);
  assert.deepEqual(absent.result.incomplete, ['crm_permits']);
  // Any other failure, for either of them, is a table that could not be read.
  const unreadable = await run(500);
  assert.deepEqual(unreadable.payload.absentTables, []);
  assert.deepEqual(unreadable.result.incomplete.sort(), ['crm_permits', 'quote_requests']);
  assert.deepEqual(backup.missingTables({ tables: Object.fromEntries(extra.filter((name) => name !== 'quote_requests').map((name) => [name, []])), skippedTables: [], absentTables: ['quote_requests'] }), []);
  assert.deepEqual(backup.missingTables({ tables: Object.fromEntries(extra.filter((name) => name !== 'quote_requests').map((name) => [name, []])), skippedTables: [], absentTables: [] }), ['quote_requests']);
});
