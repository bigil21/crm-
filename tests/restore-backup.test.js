// Restoring from a backup (to-do item 20). A backup that has never been
// restored is a hope, not a backup: these tests rebuild a database from one
// and hold the result against the original.
// Everything here is made-up data in an in-memory database on this computer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const backup = require('../recovery-backup.js');
const restore = require('../scripts/restore-backup.js');
const { createEmptyDatabase } = require('../scripts/local-cloud.js');

const COMPANY = 'coastal-crest';
const OWNER = '11111111-1111-4111-8111-111111111111';
const at = '2026-11-20T15:04:05.123456+00:00';
const record = (type, id, data, extra = {}) => ({ company_state_id: COMPANY, record_type: type, id, lead_id: type === 'contact' ? id : 'lead-1', job_id: null,
  owner_id: OWNER, data, version: 3, deleted_at: null, created_at: at, updated_at: at, updated_by: OWNER, ...extra });

// A backup as the server writes it, small enough to read.
function sampleBackup() {
  const records = [
    record('contact', 'lead-1', { name: 'TEST Customer', leadNumber: 'L-1001' }),
    record('contact', 'lead-archived', { name: 'TEST Archived', archived: true }),
    record('contact', 'lead-deleted', { name: 'TEST Deleted' }, { deleted_at: at }),
    record('job', 'job-1', { status: 'Paid', manualPayments: [{ id: 'pay-1', amount: '$1,200.50' }, { id: 'pay-2', amount: 799.5 }, { id: 'in-table', amount: 400 }],
      costItems: [{ id: 'cost-1', amount: 250.25 }, { id: 'nonsense', amount: 'n/a' }], squarePaidAmount: '300' }, { job_id: 'job-1' }),
    record('job', 'job-archived', { manualPayments: [{ id: 'pay-x', amount: 5000 }] }, { lead_id: 'lead-archived', job_id: 'job-archived' }),
    record('job', 'job-orphan', { manualPayments: [{ id: 'pay-y', amount: 7000 }] }, { lead_id: 'lead-deleted', job_id: 'job-orphan' }),
    record('estimate', 'est-1', { title: 'TEST estimate', items: [{ title: 'TEST line one', quantity: 2, rate: 150.25 }, { title: 'TEST line two', quantity: 1, rate: 99 }] }, { job_id: 'job-1', version: 7 }),
    record('task', 'task-1', { title: 'TEST call back', done: false }, { job_id: 'job-1' }),
    record('document', 'doc-1', { name: 'TEST contract.pdf', storagePath: 'coastal-crest/lead-1/TEST contract.pdf', previousVersions: [{ storagePath: 'coastal-crest/lead-1/old.pdf' }] }, { job_id: 'job-1' }),
  ];
  return {
    schemaVersion: 5, createdAt: '2026-11-21T05:00:00.000Z', source: 'server',
    company: { company: { name: 'TEST Roofing Co', defaultTerms: 'Net 14' } },
    stateRows: [{ id: 'coastal-crest:company', data: { company: { name: 'TEST Roofing Co', defaultTerms: 'Net 14' } } }],
    absentTables: [],
    records,
    auditEvents: [1, 2, 3].map((n) => ({ id: `audit-${n}`, company_state_id: COMPANY, lead_id: 'lead-1', job_id: 'job-1', event_type: 'note', actor_user_id: OWNER,
      actor_name: 'TEST Person', message: `TEST activity ${n}`, status: '', metadata: { n }, created_at: at })),
    conversationMessages: [{ id: 'message-1', company_state_id: COMPANY, lead_id: 'lead-1', job_id: 'job-1', contact_name: 'TEST Customer', job_name: '', job_status: '',
      author_user_id: OWNER, author_email: 'local-admin@coastalcrestroofing.com', author_name: 'TEST Person', author_role: 'admin', message_text: 'TEST message', mentions: [], read_by: [], created_at: at, updated_at: at }],
    tables: {
      // Every table a backup is meant to hold is in it, most of them empty here.
      ...Object.fromEntries(backup.EXTRA_TABLES.map(({ table }) => [table, []])),
      crm_sales_numbers: [{ company_state_id: COMPANY, number_kind: 'lead', entity_id: 'lead-1', parent_id: null, number_value: 'L-1001', created_by: OWNER, created_at: at }],
      crm_admins: [{ email: 'local-admin@coastalcrestroofing.com', created_at: at }],
    },
    skippedTables: [],
    storagePaths: backup.storagePaths(records),
  };
}
const backupFile = (payload, wrap = (value) => value) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jobcrest-restore-test-')), 'backup.json');
  fs.writeFileSync(file, JSON.stringify(wrap(payload)));
  return file;
};
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, arrayBuffer: async () => body, headers: { get: () => 'application/pdf' } });

test('the whole exercise passes on the local test copy: backup, rebuild, compare, files', async () => {
  const lines = [];
  const result = await restore.drill({ log: (line) => lines.push(line) });
  assert.equal(result.steps.length, 7, lines.join('\n'));
  assert.ok(result.records > 500 && result.files > 10 && result.collected > 0);
  assert.match(lines.at(-1), /PASS {2}7 checks/);
});

test('a backup goes back into an empty database exactly as it was saved', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    const payload = sampleBackup();
    await restore.restoreAll(db, payload);
    const comparison = await restore.compareWithBackup(db, payload);
    assert.deepEqual(restore.restoreVerdict(comparison, { money: restore.moneyInBackup(payload), totals: await restore.ledgerTotals(db) }), []);
    // The database's own rules did not re-stamp anything on the way in.
    const estimate = (await db.query(`select version, updated_by, updated_at = $1::timestamptz and created_at = $1::timestamptz as same_instant, data
      from public.crm_records t where record_type = 'estimate' and id = 'est-1'`, [at])).rows[0];
    assert.equal(estimate.version, 7);
    assert.equal(estimate.updated_by, OWNER);
    assert.equal(estimate.same_instant, true, 'to the microsecond');
    assert.equal(estimate.data.items.length, 2);
    assert.equal((await db.query(`select count(*)::int as n from public.crm_records where deleted_at is not null`)).rows[0].n, 1, 'a record that was in the bin stays in the bin');
    assert.deepEqual((await db.query(`select data from public.crm_state where id = 'coastal-crest:company'`)).rows[0].data, payload.company);
    assert.equal((await db.query(`select number_value from public.crm_sales_numbers where entity_id = 'lead-1'`)).rows[0].number_value, 'L-1001', 'a number already given out is still taken');
    // Money: only jobs whose lead is live count, as on the Dashboard.
    const totals = await restore.ledgerTotals(db);
    assert.equal(Number(totals.collected), 2700);
    assert.equal(Number(totals.expenses), 250.25);

    // A second restore into the same database is refused outright.
    await assert.rejects(restore.restoreAll(db, payload), /already holds 9 records/);
  } finally { await db.close(); }
});

test('the money is added up from the backup file with the ledger\'s own rules', () => {
  const money = restore.moneyInBackup(sampleBackup());
  // 1200.50 + 799.50 + 400 on the live job, + 300 Square. Archived and deleted leads do not count.
  assert.deepEqual(money, { payments: 2700, refunds: 0, collected: 2700, expenses: 250.25, leads: 1, jobs: 1 });
  const withTables = sampleBackup();
  withTables.tables.crm_payments = [{ id: 'in-table', amount: 400 }, { id: 'invoice-payment', amount: 1000 }];
  withTables.tables.crm_refunds = [{ id: 'refund-1', amount: 150 }];
  withTables.tables.crm_expenses = [{ id: 'cost-1', amount: 250.25 }, { id: 'expense-2', amount: 10 }];
  // The payment and the cost that are also in their own tables are counted once.
  assert.deepEqual(restore.moneyInBackup(withTables), { payments: 3700, refunds: 150, collected: 3550, expenses: 260.25, leads: 1, jobs: 1 });
});

test('a difference between a database and a backup is found and named', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    const payload = sampleBackup();
    await restore.restoreAll(db, payload);
    await db.exec(`set session_replication_role = replica;
      update public.crm_records set data = jsonb_set(data, '{items}', '[]'::jsonb) where record_type = 'estimate' and id = 'est-1';
      delete from public.crm_records where record_type = 'task' and id = 'task-1';
      insert into public.crm_records(company_state_id, record_type, id, lead_id, data) values('coastal-crest', 'task', 'task-new', 'lead-1', '{}');
      delete from public.crm_audit_events where id = 'audit-2';
      set session_replication_role = origin;`);
    const comparison = await restore.compareWithBackup(db, payload);
    const records = comparison.find((item) => item.table === 'crm_records');
    assert.equal(records.identical, 7);
    assert.deepEqual(records.different.map((item) => item.columns), [['data']]);
    assert.equal(records.missing.length, 1);
    assert.equal(records.notInBackup.length, 1);
    assert.equal(comparison.find((item) => item.table === 'crm_audit_events').missing.length, 1);
    const problems = restore.restoreVerdict(comparison, { money: restore.moneyInBackup(payload), totals: await restore.ledgerTotals(db) });
    assert.deepEqual(problems, ['crm_records: 1 rows are missing', 'crm_records: 1 rows differ', 'crm_records: 1 rows are not in the backup', 'crm_audit_events: 1 rows are missing']);
    // Money that does not add up to the backup is a failure too.
    assert.deepEqual(restore.restoreVerdict(comparison.filter((item) => item.table === 'company settings'), { money: { payments: 2700, refunds: 0, collected: 2699.5, expenses: 250.25 }, totals: await restore.ledgerTotals(db) }),
      ['collected: the database says $2,700.00, the backup says $2,699.50']);
  } finally { await db.close(); }
});

test('"check" rebuilds a database from a backup file, in the forms a person is likely to save one', async () => {
  const lines = [];
  const asSavedFromSqlEditor = backupFile(sampleBackup(), (payload) => [{ payload }]);
  const result = await restore.check(asSavedFromSqlEditor, { log: (line) => lines.push(line) });
  assert.deepEqual(result.problems, []);
  assert.match(lines.join('\n'), /Collected, by the backup file: +\$2,700\.00/);
  assert.match(lines.join('\n'), /Collected, by the restored database: +\$2,700\.00/);
  assert.match(lines.join('\n'), /PASS {2}the backup restores completely/);

  assert.equal(restore.readBackupFile(backupFile(sampleBackup(), (payload) => ({ payload: JSON.stringify(payload) }))).records.length, 9);
  assert.throws(() => restore.readBackupFile(backupFile({ hello: 'world' })), /not a JobCrest backup/);
});

// Found by Codex before release: a backup marked as missing the payments table
// was checked. The check printed that the table had been skipped, and then
// reported "the backup restores completely".
test('a backup that is missing a table it is meant to hold fails the check, whatever else restored', async () => {
  const withoutPayments = sampleBackup();
  delete withoutPayments.tables.crm_payments;
  withoutPayments.skippedTables = ['crm_payments'];
  const lines = [];
  const result = await restore.check(backupFile(withoutPayments), { log: (line) => lines.push(line) });
  const said = lines.join('\n');
  assert.deepEqual(result.problems, ['crm_payments: not in the backup (it could not be read when the backup was made)']);
  assert.deepEqual(result.incomplete, ['crm_payments']);
  assert.doesNotMatch(said, /PASS/);
  assert.doesNotMatch(said, /restores completely/);
  assert.match(said, /FAIL {2}the backup is incomplete: 1 problem/);
  assert.match(said, /Everything that is in the backup restored correctly\. What is missing from it cannot be restored from this file\./);

  // A table that is simply not there, without the backup saying why, is missing all the same.
  const silent = sampleBackup();
  delete silent.tables.crm_refunds;
  assert.deepEqual((await restore.check(backupFile(silent), { log() {} })).problems, ['crm_refunds: not in the backup']);
  // So is one the backup holds as something other than a list of rows.
  const mangled = sampleBackup();
  mangled.tables.crm_expenses = null;
  assert.deepEqual(restore.backupGaps(mangled), ['crm_expenses: not in the backup']);

  // The older format, from before these tables were included, holds none of them.
  const older = sampleBackup();
  older.schemaVersion = 3; delete older.tables; delete older.skippedTables; delete older.stateRows; delete older.absentTables;
  const olderLines = [];
  const olderResult = await restore.check(backupFile(older), { log: (line) => olderLines.push(line) });
  assert.equal(olderResult.problems.length, 1);
  assert.match(olderResult.problems[0], new RegExp(`older format: it holds the records but none of the ${backup.EXTRA_TABLES.length} other tables`));
  assert.equal(olderResult.incomplete.length, backup.EXTRA_TABLES.length);
  assert.doesNotMatch(olderLines.join('\n'), /PASS/);

  // A restore that also went wrong says that, not only that the backup is incomplete.
  assert.deepEqual(restore.restoreVerdict([{ table: 'crm_records', core: true, missing: ['a'], different: [], notInBackup: [] }], { payload: withoutPayments }),
    ['crm_payments: not in the backup (it could not be read when the backup was made)', 'crm_records: 1 rows are missing']);
  assert.deepEqual(restore.restoreVerdict([], { payload: sampleBackup() }), [], 'a whole backup that came back whole has no problems');
});

test('a copy of an incomplete backup, or one with a file missing, does not verify', async () => {
  const payload = sampleBackup();
  delete payload.tables.crm_payments;
  payload.skippedTables = ['crm_payments'];
  payload.storagePaths = ['coastal-crest/lead-1/TEST contract.pdf'];
  const bytes = crypto.randomBytes(512);
  const fetcher = async (input) => (new URL(input).pathname === '/rest/v1/crm_backups'
    ? response([{ backup_date: '2026-11-21', record_count: 8, payload }]) : response(bytes));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jobcrest-export-incomplete-'));
  const result = await restore.exportBackup({ origin: 'https://example.supabase.co', key: 'sb_secret_test', fetch: fetcher, folder });
  assert.deepEqual(result.incompleteTables, ['crm_payments']);
  assert.deepEqual(result.missing, []);
  assert.deepEqual(restore.verifyExport(result.folder).problems, ['crm_payments: not in the backup (it could not be read when the backup was made)']);

  // A copy whose own list of files is shorter than the backup's: the file is
  // not there and is not named missing either. Checksums alone would pass it.
  const manifestFile = path.join(result.folder, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  assert.ok(manifest.files.some(file => file.path.endsWith('/old.pdf')), 'the document record recovers the version omitted from the old path list');
  fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, files: manifest.files.filter(file => file.path.endsWith('/old.pdf')) }));
  assert.deepEqual(restore.verifyExport(result.folder).problems, [
    'crm_payments: not in the backup (it could not be read when the backup was made)',
    'coastal-crest/lead-1/TEST contract.pdf: the backup points to this file and the copy does not have it']);
});

test('a backup without its activity history or its conversations is not whole either', () => {
  const noHistory = sampleBackup();
  delete noHistory.auditEvents;
  noHistory.conversationMessages = 'lost';
  assert.deepEqual(restore.backupGaps(noHistory), ['crm_audit_events: not in the backup', 'crm_conversation_messages: not in the backup']);
  assert.deepEqual(restore.backupGaps(sampleBackup()), []);
});

test('chosen records are put back by SQL a person can read, and nothing else is touched', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    const payload = sampleBackup();
    await restore.restoreAll(db, payload);
    const fingerprint = async () => new Map((await db.query(`select record_type || ':' || id as key, md5(to_jsonb(t)::text) as hash from public.crm_records t`)).rows.map((row) => [row.key, row.hash]));
    const before = await fingerprint();
    // Someone empties the estimate (two saves later) and the task is gone for good.
    await db.exec(`update public.crm_records set data = '{"title":"TEST estimate","items":[]}'::jsonb, version = 9 where record_type = 'estimate' and id = 'est-1';
      set session_replication_role = replica; delete from public.crm_records where record_type = 'task' and id = 'task-1'; set session_replication_role = origin;`);

    const sql = restore.recordsSql(payload, ['estimate:est-1', 'task:task-1']);
    assert.match(sql, /^-- JobCrest: put 2 records back as the backup made 2026-11-21 05:00:00 UTC has them\./);
    assert.match(sql, /\nbegin;\n[^]*\ncommit;\n$/);
    assert.doesNotMatch(sql, /session_replication_role|delete from|drop |truncate/i, 'it switches no rule off and removes nothing');
    await db.exec(sql);

    const estimate = (await db.query(`select version, data from public.crm_records where record_type = 'estimate' and id = 'est-1'`)).rows[0];
    assert.equal(estimate.data.items.length, 2, 'the two lines are back');
    assert.equal(estimate.version, 10, 'one above what was there, so an open tab is told it changed');
    assert.equal((await db.query(`select data->>'title' as title from public.crm_records where record_type = 'task' and id = 'task-1'`)).rows[0].title, 'TEST call back', 'the removed task exists again');
    const after = await fingerprint();
    assert.deepEqual([...after.keys()].filter((key) => after.get(key) !== before.get(key)).sort(), ['estimate:est-1', 'task:task-1']);
    assert.equal((await db.query(`select count(*)::int as n from public.crm_audit_events where id like 'restore-%' and message like 'This % was put back from the backup made 2026-11-21 05:00:00 UTC.'`)).rows[0].n, 2);

    assert.throws(() => restore.recordsSql(payload, ['estimate:nope']), /has no record "estimate:nope"/);
    assert.throws(() => restore.recordsSql(payload, []), /Name at least one record/);
  } finally { await db.close(); }
});

test('putting a record back cannot break a rule the database enforces: all of it is refused, or none', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    const payload = sampleBackup();
    await restore.restoreAll(db, payload);
    await db.exec(`update public.crm_records set data = jsonb_set(data, '{title}', '"TEST changed"') where record_type = 'task' and id = 'task-1'`);
    const task = (await db.query(`select version, data from public.crm_records where record_type = 'task' and id = 'task-1'`)).rows[0];
    // The second record in the request is impossible: a version of zero.
    const broken = structuredClone(payload);
    broken.records.push(record('task', 'task-bad', { title: 'TEST impossible' }, { version: 0 }));
    await assert.rejects(db.exec(restore.recordsSql(broken, ['task:task-1', 'task:task-bad'])), /violates check constraint/);
    try { await db.exec('rollback'); } catch { /* the failed transaction is already closed */ }
    assert.deepEqual((await db.query(`select version, data from public.crm_records where record_type = 'task' and id = 'task-1'`)).rows[0], task, 'the good record was not changed either');
    assert.equal((await db.query(`select count(*)::int as n from public.crm_audit_events where id like 'restore-%'`)).rows[0].n, 0);
  } finally { await db.close(); }
});

test('the files are copied out with a checksum each, and one that is missing is named', async () => {
  const payload = sampleBackup();
  const contents = new Map([['coastal-crest/lead-1/TEST contract.pdf', crypto.randomBytes(4096)]]);
  const requests = [];
  const fetcher = async (input, options = {}) => {
    const url = new URL(input);
    requests.push({ url, options });
    if (url.pathname === '/rest/v1/crm_backups') return response([{ backup_date: '2026-11-21', record_count: 8, payload }]);
    const stored = contents.get(decodeURIComponent(url.pathname.replace('/storage/v1/object/crm-documents/', '')));
    return stored ? response(stored) : response(null, 400);
  };
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jobcrest-export-test-'));
  const result = await restore.exportBackup({ origin: 'https://example.supabase.co', key: 'sb_secret_test', fetch: fetcher, folder });
  assert.equal(result.folder, path.join(folder, '2026-11-21'));
  assert.deepEqual(result.missing, ['coastal-crest/lead-1/old.pdf']);
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].sha256, crypto.createHash('sha256').update(contents.get('coastal-crest/lead-1/TEST contract.pdf')).digest('hex'));
  assert.ok(fs.readFileSync(path.join(result.folder, 'files', 'coastal-crest', 'lead-1', 'TEST contract.pdf')).equals(contents.get('coastal-crest/lead-1/TEST contract.pdf')));
  assert.deepEqual(restore.readBackupFile(path.join(result.folder, 'backup.json')), payload);
  // It only reads, and the key travels in a header, never in an address.
  assert.ok(requests.every((request) => !request.options.method || request.options.method === 'GET'));
  assert.ok(requests.every((request) => !request.url.href.includes('sb_secret_test') && request.options.headers.apikey === 'sb_secret_test'));
  assert.match(requests[1].url.pathname, /TEST%20contract\.pdf$/);

  // A file the records point to that could not be copied is a hole in the copy, and verifying says so.
  const hole = 'coastal-crest/lead-1/old.pdf: not in this copy (it could not be read when the copy was made)';
  assert.deepEqual(restore.verifyExport(result.folder), { backupDate: '2026-11-21', files: 1, missing: ['coastal-crest/lead-1/old.pdf'], problems: [hole] });
  fs.appendFileSync(path.join(result.folder, 'files', 'coastal-crest', 'lead-1', 'TEST contract.pdf'), 'x');
  assert.deepEqual(restore.verifyExport(result.folder).problems, ['files/coastal-crest/lead-1/TEST contract.pdf: not the file that was copied', hole]);

  await assert.rejects(restore.exportBackup({ origin: 'https://example.supabase.co', key: 'k', fetch: async () => response([]), folder, date: '2026-01-01' }), /no backup dated 2026-01-01/);
  await assert.rejects(restore.exportBackup({ origin: 'https://example.supabase.co', key: 'k', fetch: async () => response({ message: 'secret detail' }, 500), folder }), (error) => error.message === 'The backup could not be read from the database.');
});

test('a stored path can never write outside the export folder', () => {
  assert.equal(restore.localFileName('coastal-crest/lead-1/photo.jpg'), 'coastal-crest/lead-1/photo.jpg');
  assert.equal(restore.localFileName('../../Windows/system.ini'), '_/_/Windows/system.ini');
  assert.equal(restore.localFileName('a//b/./c'), 'a/_/b/_/c');
  assert.equal(restore.localFileName('a\\..\\b/con:fig?.pdf'), 'a_.._b/con_fig_.pdf');
  assert.equal(restore.localFileName('trailing. /x'), 'trailing_/x');
});

test('the daily backup now holds the payment tables, given-out numbers, set-up lists and roles', async () => {
  const calls = [];
  const rows = {
    crm_state: [{ id: 'coastal-crest', data: { company: { name: 'TEST older copy' } } }, { id: 'coastal-crest:company', data: { company: { name: 'TEST' } } },
      { id: 'coastal-crest:user:u1', data: { owner: 'someone' } }, { id: 'coastal-crest-other:company', data: { company: { name: 'another company' } } }],
    crm_records: [{ id: 'lead-1', record_type: 'contact', data: {}, deleted_at: null }],
    crm_sales_numbers: [{ entity_id: 'lead-1', number_value: 'L-1' }],
    crm_payments: [{ id: 'p1', amount: 10 }],
    crm_user_access: [{ user_id: OWNER, role: 'admin' }],
  };
  // The backups table, stood in for: one backup per day, kept or replaced the way the database would.
  const backups = new Map();
  let unreadable = new Set();
  const fetcher = async (input, options = {}) => {
    const url = new URL(input);
    const table = url.pathname.split('/').pop();
    calls.push({ table, url, method: options.method || 'GET', prefer: options.headers?.Prefer || '' });
    if (table === 'crm_backups') {
      if (options.method === 'POST') {
        const body = JSON.parse(options.body);
        if (!backups.has(body.backup_date) || /resolution=merge-duplicates/.test(options.headers.Prefer)) backups.set(body.backup_date, body);
        return response(null, 201);
      }
      const row = backups.get(url.searchParams.get('backup_date').replace('eq.', ''));
      const wholeOnly = url.searchParams.get('payload->>skippedTables') === 'eq.[]';
      return response(row && (!wholeOnly || (JSON.stringify(row.payload.skippedTables) === '[]' &&
        url.searchParams.get('payload->>schemaVersion') === 'eq.' + row.payload.schemaVersion)) ? [{ backup_date: row.backup_date }] : []);
    }
    if (unreadable.has(table)) return response({ message: 'relation does not exist' }, 404);
    return response(rows[table] || []);
  };
  const config = { origin: 'https://example.supabase.co', companyId: COMPANY, key: 'sb_secret_test', fetch: fetcher, timeZone: 'America/New_York' };
  const first = await backup.createDailyBackup(config, new Date('2026-11-21T16:00:00.000Z'));
  assert.deepEqual(first, { backupDate: '2026-11-21', recordCount: 1 });
  const stored = backups.get('2026-11-21');
  assert.equal(stored.payload.schemaVersion, 5);
  // Every settings row of this company, and no other company's.
  assert.deepEqual(stored.payload.stateRows.map((row) => row.id), ['coastal-crest', 'coastal-crest:company', 'coastal-crest:user:u1']);
  assert.deepEqual(stored.payload.company, { company: { name: 'TEST' } });
  assert.equal(calls.find((call) => call.table === 'crm_state').url.searchParams.get('id'), 'like.coastal-crest*');
  // Every table on the list was asked for, and each is in the backup, empty or not.
  for (const { table } of backup.EXTRA_TABLES) {
    assert.ok(calls.some((call) => call.table === table), `${table} was read`);
    assert.ok(Array.isArray(stored.payload.tables[table]), `${table} is in the backup`);
  }
  assert.deepEqual(stored.payload.absentTables, []);
  assert.deepEqual(stored.payload.tables.crm_sales_numbers, rows.crm_sales_numbers);
  assert.deepEqual(stored.payload.tables.crm_payments, rows.crm_payments);
  assert.deepEqual(stored.payload.tables.crm_user_access, rows.crm_user_access);
  assert.deepEqual(stored.payload.skippedTables, []);
  assert.deepEqual(backup.missingTables(stored.payload), []);
  // Company tables are read for this company only; roles are not per company.
  assert.equal(calls.find((call) => call.table === 'crm_payments').url.searchParams.get('company_state_id'), 'eq.coastal-crest');
  assert.equal(calls.find((call) => call.table === 'crm_user_access').url.searchParams.get('company_state_id'), null);
  // Sign-in tokens and the backups themselves never go into a backup.
  const names = backup.EXTRA_TABLES.map((item) => item.table);
  for (const secret of ['crm_oauth_connections', 'crm_oauth_states', 'crm_backups', 'crm_write_receipts', 'crm_company_settings_receipts']) assert.equal(names.includes(secret), false, secret);
  assert.equal(calls.some((call) => /oauth/.test(call.table)), false);

  // Later the same day there is nothing to do, and no record is read again.
  const before = calls.length;
  assert.deepEqual(await backup.createDailyBackup(config, new Date('2026-11-21T20:00:00.000Z')), { backupDate: '2026-11-21', alreadyStored: true });
  assert.deepEqual(calls.slice(before).map((call) => `${call.method} ${call.table}`), ['GET crm_backups']);

  // ---- A day on which a table cannot be read (found by Codex before release:
  // such a backup was stored, and then never made again that day).
  unreadable = new Set(['crm_payments']);
  const partial = await backup.createDailyBackup(config, new Date('2026-11-22T10:00:00.000Z'));
  assert.deepEqual(partial, { backupDate: '2026-11-22', recordCount: 1, incomplete: ['crm_payments'] }, 'it is stored, and says what it is missing');
  assert.deepEqual(backups.get('2026-11-22').payload.skippedTables, ['crm_payments']);
  assert.equal(Object.hasOwn(backups.get('2026-11-22').payload.tables, 'crm_payments'), false);
  // An hour later the table still cannot be read: tried again, and the earlier copy is kept.
  const firstPartial = backups.get('2026-11-22');
  const stillPartial = await backup.createDailyBackup(config, new Date('2026-11-22T11:00:00.000Z'));
  assert.deepEqual(stillPartial, { backupDate: '2026-11-22', alreadyStored: true, incomplete: ['crm_payments'] });
  assert.equal(backups.get('2026-11-22'), firstPartial, 'one partial copy is not swapped for another');
  // Then it can be read: a whole backup takes the incomplete one's place.
  unreadable = new Set();
  const whole = await backup.createDailyBackup(config, new Date('2026-11-22T12:00:00.000Z'));
  assert.deepEqual(whole, { backupDate: '2026-11-22', recordCount: 1, replacedIncomplete: true });
  assert.deepEqual(backups.get('2026-11-22').payload.skippedTables, []);
  assert.deepEqual(backups.get('2026-11-22').payload.tables.crm_payments, rows.crm_payments);
  assert.match(calls.filter((call) => call.method === 'POST').at(-1).prefer, /resolution=merge-duplicates/);
  // After that the day is done, and a whole backup is never replaced.
  const settled = calls.length;
  assert.deepEqual(await backup.createDailyBackup(config, new Date('2026-11-22T13:00:00.000Z')), { backupDate: '2026-11-22', alreadyStored: true });
  assert.deepEqual(calls.slice(settled).map((call) => `${call.method} ${call.table}`), ['GET crm_backups']);
  assert.equal(calls.filter((call) => call.method === 'POST' && /merge-duplicates/.test(call.prefer)).length, 1);

  // A backup from before backups said what they hold is not whole, so the first
  // run of this code on its day makes a full one in its place.
  backups.set('2026-11-23', { backup_date: '2026-11-23', payload: { schemaVersion: 4, skippedTables: [], records: [] } });
  assert.equal(await backup.storedBackupState(config, '2026-11-23'), 'incomplete');
  assert.equal((await backup.createDailyBackup(config, new Date('2026-11-23T16:00:00.000Z'))).replacedIncomplete, true);
  assert.equal(backups.get('2026-11-23').payload.schemaVersion, 5);
  // When the question cannot even be asked, a backup is still made, and nothing is replaced.
  const offline = { ...config, fetch: async (input, options = {}) => (new URL(input).pathname.endsWith('crm_backups') && (options.method || 'GET') === 'GET' ? response({}, 503) : fetcher(input, options)) };
  assert.equal(await backup.storedBackupState(offline, '2026-11-24'), 'unknown');
  await backup.createDailyBackup(offline, new Date('2026-11-24T16:00:00.000Z'));
  assert.match(calls.filter((call) => call.method === 'POST').at(-1).prefer, /resolution=ignore-duplicates/);
});

test('the server is told when the day\'s backup is incomplete, so it shows in the log', async () => {
  const errors = [];
  const fetcher = async (input, options = {}) => {
    const table = new URL(input).pathname.split('/').pop();
    if (table === 'crm_backups') return options.method === 'POST' ? response(null, 201) : response([]);
    return table === 'crm_refunds' ? response({}, 500) : response([]);
  };
  const stop = backup.start({ origin: 'https://example.supabase.co', companyId: COMPANY, key: 'sb_secret_test', fetch: fetcher, intervalMs: 3600000, onError: (error) => errors.push(error.message) });
  for (let turn = 0; turn < 50 && !errors.length; turn += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  stop();
  assert.deepEqual(errors, ['Recovery backup is incomplete: crm_refunds could not be read.']);
});
