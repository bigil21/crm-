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
    schemaVersion: backup.BACKUP_FORMAT, createdAt: '2026-11-21T05:00:00.000Z', source: 'server',
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

// The photos a visitor attaches to a website quote request are in a bucket of
// their own. Until 2026-11-24 nothing copied them: the export read only the
// CRM's documents bucket, so three real photos were in no copy at all.
test('ordinary exports omit private Square data; only an explicit server recovery export joins the matching snapshot', async () => {
  const payload = sampleBackup();
  const keys = backup.EXTRA_TABLES.filter(t=>t.via===backup.SQUARE_BACKUP_FUNCTION).map(t=>t.table);
  const square = Object.fromEntries(keys.map(k=>[k,[{ sample: 'SERVER-ONLY-CANARY' }]]));
  keys.forEach(k=>delete payload.tables[k]);
  payload.privateSquareSnapshot='00000000-0000-4000-8000-000000000001';
  let reads=0, deny=false;
  const config={origin:'https://example.supabase.co',key:'synthetic',folder:fs.mkdtempSync(path.join(os.tmpdir(),'jobcrest-role-export-')),
    fetch:async (input,opts)=>{
      const url=new URL(input);
      if(url.pathname.endsWith('/crm_backups')) return response([{backup_date:'2026-11-24',record_count:8,payload:structuredClone(payload)}]);
      if(url.pathname.endsWith('/crm_private_square_snapshot')) {
        reads++;
        assert.deepEqual(JSON.parse(opts.body),{p_company:COMPANY,p_day:'2026-11-24',p_snapshot:payload.privateSquareSnapshot});
        return response(square,deny?403:200);
      }
      return {ok:true,headers:{get:()=>null},arrayBuffer:async()=>Buffer.from('local document')};
    }};
  try {
    const ordinary=await restore.exportBackup(config);
    assert.equal(reads,0);
    assert.equal(ordinary.scope,'manager');
    const original=fs.readFileSync(path.join(ordinary.folder,'backup.json'));
    await assert.rejects(restore.exportBackup(config),{code:'EEXIST'});
    assert.deepEqual(fs.readFileSync(path.join(ordinary.folder,'backup.json')),original);
    assert.ok(!fs.readFileSync(path.join(ordinary.folder,'backup.json'),'utf8').includes('SERVER-ONLY-CANARY'));
    assert.deepEqual(restore.verifyExport(ordinary.folder).problems,[]);
    await assert.rejects(restore.restoreAll(null,payload),/server-only Square snapshot/);
    const full=await restore.exportBackup({...config,includePrivateSquare:true});
    assert.equal(reads,1);
    assert.notEqual(full.folder,ordinary.folder);
    assert.deepEqual(restore.readBackupFile(path.join(full.folder,'backup.json')).tables[keys[0]],square[keys[0]]);
    assert.deepEqual(restore.verifyExport(full.folder).problems,[]);
    deny=true;
    await assert.rejects(restore.exportBackup({...config,includePrivateSquare:true}),/Cannot read the matching/);
  } finally { fs.rmSync(config.folder,{recursive:true,force:true}); }
});

// Found reviewing release 43bf4d9, which moved Square's tables out of the copy
// managers can read. Two things followed that were not meant:
//   - "check" stopped with an error on every backup file a person can get
//     without the server's key (the stored payload, or an ordinary export),
//     so nobody without that key could check a backup any more;
//   - a full copy in which one Square table could not be read was refused
//     outright and called a manager copy, where any other incomplete backup is
//     restored as far as it goes with the gap named.
test('"check" works on the copy a person can get without the server\'s key, and says what that copy leaves out', async () => {
  const keys = backup.EXTRA_TABLES.filter((item) => item.via === backup.SQUARE_BACKUP_FUNCTION).map((item) => item.table);
  const payload = sampleBackup();
  keys.forEach((table) => delete payload.tables[table]);
  payload.privateSquareSnapshot = '00000000-0000-4000-8000-000000000001';
  const lines = [];
  const result = await restore.check(backupFile(payload), { log: (line) => lines.push(line) });
  const said = lines.join('\n');
  assert.deepEqual(result.problems, []);
  assert.equal(result.scope, 'manager');
  assert.deepEqual([...result.keptApart].sort(), [...keys].sort());
  assert.deepEqual(result.incomplete, []);
  // Everything it holds came back, records and money included.
  assert.equal(result.comparison.find((item) => item.table === 'crm_records').identical, payload.records.length);
  assert.equal(result.totals.collected, result.money.collected);
  // It passes as what it is. It is never called "the backup", and it says what it cannot do.
  assert.match(said, /PASS {2}the manager copy restores completely/);
  assert.doesNotMatch(said, /the backup restores completely/);
  assert.match(said, /Square's tables are not in this file \(5 of them\)/);
  assert.match(said, /cannot rebuild the CRM by itself/);
  assert.match(said, /export --include-private-square/);

  // A real rebuild from that copy is still refused: it would give Square invoicing a new switch-on date.
  const db = await createEmptyDatabase({ quiet: true });
  try {
    await assert.rejects(restore.restoreAll(db, payload), /server-only Square snapshot/);
    assert.equal((await db.query('select count(*)::int as n from public.crm_records')).rows[0].n, 0, 'and nothing was put in');
  } finally { await db.close(); }

  // A manager copy that is missing something else fails, and only for that.
  const short = structuredClone(payload);
  delete short.tables.crm_payments;
  short.skippedTables = ['crm_payments'];
  const shortLines = [];
  const shortResult = await restore.check(backupFile(short), { log: (line) => shortLines.push(line) });
  assert.deepEqual(shortResult.problems, ['crm_payments: not in the backup (it could not be read when the backup was made)']);
  assert.deepEqual(shortResult.incomplete, ['crm_payments']);
  assert.doesNotMatch(shortLines.join('\n'), /PASS/);

  // A backup from before Square's tables were kept apart, with none of them in it, is simply missing them.
  const older = structuredClone(payload);
  delete older.privateSquareSnapshot;
  older.schemaVersion = 5;
  const olderResult = await restore.check(backupFile(older), { log: () => {} });
  assert.deepEqual([...olderResult.problems].sort(), keys.map((table) => `${table}: not in the backup`).sort());
  assert.equal(olderResult.scope, undefined);
});

test('a copy in which one Square table could not be read is restored as far as it goes, with the gap named', async () => {
  const keys = backup.EXTRA_TABLES.filter((item) => item.via === backup.SQUARE_BACKUP_FUNCTION).map((item) => item.table);
  const gap = 'crm_square_webhook_events: not in the backup (it could not be read when the backup was made)';
  const switchedOn = [{ company_state_id: COMPANY, environment: 'production', installed_at: '2026-09-21T13:43:28.935762+00:00' },
    { company_state_id: COMPANY, environment: 'sandbox', installed_at: '2026-09-21T13:43:28.939294+00:00' }];

  // The full copy, from the server: four Square tables are in it, and the fifth is named as not read.
  const full = sampleBackup();
  full.privateSquareSnapshot = '00000000-0000-4000-8000-000000000002';
  full.tables.crm_square_invoice_policy = switchedOn;
  delete full.tables.crm_square_webhook_events;
  full.skippedTables = ['crm_square_webhook_events'];
  const db = await createEmptyDatabase({ quiet: true });
  try {
    await restore.restoreAll(db, full);
    // The date Square invoicing was switched on came back, which is what those tables are backed up for.
    const dates = (await db.query(`select environment, installed_at from public.crm_square_invoice_policy where company_state_id = $1 order by environment`, [COMPANY])).rows;
    assert.deepEqual(dates.map((row) => new Date(row.installed_at).toISOString()), ['2026-09-21T13:43:28.935Z', '2026-09-21T13:43:28.939Z']);
    assert.equal((await db.query('select count(*)::int as n from public.crm_records')).rows[0].n, full.records.length);
  } finally { await db.close(); }
  const lines = [];
  const result = await restore.check(backupFile(full), { log: (line) => lines.push(line) });
  assert.deepEqual(result.problems, [gap]);
  assert.equal(result.scope, undefined, 'it is the full copy, not a manager copy');
  assert.match(lines.join('\n'), /FAIL {2}the backup is incomplete: 1 problem/);
  assert.match(lines.join('\n'), /Everything that is in the backup restored correctly/);
  assert.doesNotMatch(lines.join('\n'), /PASS/);

  // The manager's copy of the same day: the four kept apart are not a gap, the one never read is.
  const managerCopy = structuredClone(full);
  keys.forEach((table) => delete managerCopy.tables[table]);
  const managerLines = [];
  const managerResult = await restore.check(backupFile(managerCopy), { log: (line) => managerLines.push(line) });
  assert.deepEqual(managerResult.problems, [gap]);
  assert.equal(managerResult.scope, 'manager');
  assert.deepEqual([...managerResult.keptApart].sort(), keys.filter((table) => table !== 'crm_square_webhook_events').sort());
  assert.deepEqual(managerResult.incomplete, ['crm_square_webhook_events']);
  assert.doesNotMatch(managerLines.join('\n'), /PASS/);
});

test('website quote photos are copied out of their own bucket, checked, and sent back to it', async () => {
  const good = '0f8fad5b-d9cb-469f-a165-70867728950e/TEST roof 1.jpg';
  const gone = '7c9e6679-7425-40de-944b-e07fc1f90ae7/TEST gone.jpg';
  // What a visitor could type into a request to make the copy read something else.
  const bad = ['../crm-documents/coastal-crest/lead-1/TEST contract.pdf', 'not-a-random-id/x.jpg', 'coastal-crest/lead-1/TEST contract.pdf', '0f8fad5b-d9cb-469f-a165-70867728950e', '0f8fad5b-d9cb-469f-a165-70867728950e/../../x.jpg'];
  const payload = sampleBackup();
  payload.tables.quote_requests = [{ id: 'q1', photo_paths: [good, gone] }, { id: 'q2', photo_paths: [] }, { id: 'q3', photo_paths: [good, ...bad] }];
  payload.quotePhotoPaths = backup.quotePhotoPaths(payload.tables);
  const stored = new Map([
    ['crm-documents/coastal-crest/lead-1/TEST contract.pdf', crypto.randomBytes(2048)],
    ['crm-documents/coastal-crest/lead-1/old.pdf', crypto.randomBytes(1024)],
    [`quote-photos/${good}`, crypto.randomBytes(3072)],
  ]);
  const requests = [];
  const sent = new Map();
  const fetcher = async (input, options = {}) => {
    const url = new URL(input);
    if (url.pathname === '/rest/v1/crm_backups') return response([{ backup_date: '2026-11-21', record_count: 8, payload }]);
    const object = decodeURIComponent(url.pathname.replace('/storage/v1/object/', ''));
    requests.push({ object, raw: url.pathname, method: options.method || 'GET', headers: options.headers });
    if (options.method === 'POST') { sent.set(object, Buffer.from(options.body)); return response({ Key: object }); }
    return stored.has(object) ? response(stored.get(object)) : response(null, 400);
  };
  const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jobcrest-export-quote-photos-'));
  const result = await restore.exportBackup({ origin: 'https://example.supabase.co', key: 'sb_secret_test', fetch: fetcher, folder });

  // The photo is in the copy, under a folder of its own, with its bucket named.
  const photo = result.files.find((file) => file.bucket === 'quote-photos');
  assert.deepEqual({ path: photo.path, file: photo.file, bytes: photo.bytes, sha256: photo.sha256 },
    { path: good, file: `files/_quote-photos/${good}`, bytes: 3072, sha256: sha(stored.get(`quote-photos/${good}`)) });
  assert.ok(fs.readFileSync(path.join(result.folder, 'files', '_quote-photos', ...good.split('/'))).equals(stored.get(`quote-photos/${good}`)));
  // The documents are copied as before, and their lines in the list are unchanged: no bucket on them.
  assert.deepEqual(result.files.filter((file) => !file.bucket).map((file) => file.path).sort(), ['coastal-crest/lead-1/TEST contract.pdf', 'coastal-crest/lead-1/old.pdf']);
  assert.equal(result.files.length, 3);
  // A photo that is not there, and every path that is not a photo's, is named missing, with its bucket.
  assert.deepEqual([...result.missing].sort(), [gone, ...bad].map((item) => `quote-photos/${item}`).sort());
  // Nothing a request names is ever fetched from the documents bucket, or from outside a random-id folder.
  const fetched = requests.filter((request) => request.method === 'GET').map((request) => request.object).sort();
  assert.deepEqual(fetched, ['crm-documents/coastal-crest/lead-1/TEST contract.pdf', 'crm-documents/coastal-crest/lead-1/old.pdf', `quote-photos/${gone}`, `quote-photos/${good}`].sort());
  assert.ok(requests.every((request) => !request.raw.includes('..') && request.headers.apikey === 'sb_secret_test'));

  // The check accounts for the photo: every missing one is a problem, and a copy whose list leaves the photo out fails.
  const problems = restore.verifyExport(result.folder).problems;
  assert.deepEqual([...problems].sort(), [gone, ...bad].map((item) => `quote-photos/${item}: not in this copy (it could not be read when the copy was made)`).sort());
  const manifestFile = path.join(result.folder, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, files: manifest.files.filter((file) => file.bucket !== 'quote-photos') }));
  assert.ok(restore.verifyExport(result.folder).problems.includes(`quote-photos/${good}: the backup points to this file and the copy does not have it`));
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));

  // Sent back, each file goes to the bucket it came from, and is never written over what is there.
  const returned = await restore.uploadFiles({ origin: 'https://example.supabase.co', key: 'sb_secret_test', fetch: fetcher, folder: result.folder });
  assert.deepEqual([...returned.sent].sort(), ['coastal-crest/lead-1/TEST contract.pdf', 'coastal-crest/lead-1/old.pdf', `quote-photos/${good}`].sort());
  assert.deepEqual(returned.failed, []);
  assert.ok(sent.get(`quote-photos/${good}`).equals(stored.get(`quote-photos/${good}`)));
  assert.ok(!sent.has(`crm-documents/${good}`), 'the photo did not go to the documents bucket');
  assert.ok(requests.filter((request) => request.method === 'POST').every((request) => request.headers['x-upsert'] === 'false'));

  // A backup made before the photos were listed still names them, in its quote requests: they are copied all the same.
  delete payload.quotePhotoPaths;
  const older = await restore.exportBackup({ origin: 'https://example.supabase.co', key: 'sb_secret_test', fetch: fetcher, folder: path.join(folder, 'older') });
  assert.ok(older.files.some((file) => file.bucket === 'quote-photos' && file.path === good && file.sha256 === sha(stored.get(`quote-photos/${good}`))));
  assert.equal(older.files.length, 3);
});

test('sending files back: only "already there" counts as kept; any other refusal is a file that did not go back', async () => {
  const payload = sampleBackup();
  const names = ['a', 'b', 'c', 'd', 'e', 'f'].map((letter) => `0f8fad5b-d9cb-469f-a165-70867728950e/TEST ${letter}.jpg`);
  payload.tables.quote_requests = [{ id: 'q1', photo_paths: names }];
  const answers = {
    a: response({ Key: 'ok' }),
    b: response({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, 400),
    c: response({ statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, 409),
    // The photo bucket takes images only, and says no with the same status as "already there".
    d: response({ statusCode: '415', error: 'invalid_mime_type', message: 'mime type application/octet-stream is not supported' }, 400),
    e: response({ statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }, 400),
    f: { ok: false, status: 400, json: async () => { throw new Error('not JSON'); } },
  };
  const fetcher = async (input, options = {}) => {
    const url = new URL(input);
    if (url.pathname === '/rest/v1/crm_backups') return response([{ backup_date: '2026-11-21', record_count: 8, payload }]);
    if (options.method !== 'POST') return response(Buffer.from(decodeURIComponent(url.pathname)));
    const letter = decodeURIComponent(url.pathname).match(/TEST (\w)\.jpg$/)?.[1];
    return letter ? answers[letter] : response({ Key: 'ok' });
  };
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jobcrest-export-kept-'));
  const result = await restore.exportBackup({ origin: 'https://example.supabase.co', key: 'sb_secret_test', fetch: fetcher, folder });
  const returned = await restore.uploadFiles({ origin: 'https://example.supabase.co', key: 'sb_secret_test', fetch: fetcher, folder: result.folder });
  const photo = (letter) => `quote-photos/0f8fad5b-d9cb-469f-a165-70867728950e/TEST ${letter}.jpg`;
  assert.deepEqual(returned.sent.filter((name) => name.startsWith('quote-photos/')), [photo('a')]);
  assert.deepEqual(returned.kept, [photo('b'), photo('c')]);
  assert.deepEqual(returned.failed, [photo('d'), photo('e'), photo('f')]);
});

test('two stored files whose names differ only in capitals do not overwrite each other in the copy', async () => {
  const payload = sampleBackup();
  payload.tables.quote_requests = [{ id: 'q1', photo_paths: ['0f8fad5b-d9cb-469f-a165-70867728950e/Roof.jpg', '0F8FAD5B-D9CB-469F-A165-70867728950E/roof.JPG'] }];
  const fetcher = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/rest/v1/crm_backups') return response([{ backup_date: '2026-11-21', record_count: 8, payload }]);
    return response(Buffer.from(decodeURIComponent(url.pathname)));
  };
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jobcrest-export-case-'));
  const result = await restore.exportBackup({ origin: 'https://example.supabase.co', key: 'sb_secret_test', fetch: fetcher, folder });
  const photos = result.files.filter((file) => file.bucket === 'quote-photos');
  assert.equal(photos.length, 2);
  assert.equal(new Set(photos.map((file) => file.file.toLowerCase())).size, 2, 'each has a file of its own');
  assert.equal(new Set(photos.map((file) => file.sha256)).size, 2);
  assert.deepEqual(restore.verifyExport(result.folder).problems, []);
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
    crm_square_invoice_policy: [{ company_state_id: COMPANY, environment: 'production', installed_at: '2026-09-21T13:43:28.935762+00:00' },
      { company_state_id: COMPANY, environment: 'sandbox', installed_at: '2026-09-21T13:43:28.939294+00:00' }],
  };
  // The backups table, stood in for: one backup per day, kept or replaced the way the database would.
  const backups = new Map();
  let unreadable = new Set();
  const fetcher = async (input, options = {}) => {
    const url = new URL(input);
    // A Square table is asked of the database's function; the table it is asked for is in the request.
    const viaFunction = url.pathname.endsWith(`/rpc/${backup.SQUARE_BACKUP_FUNCTION}`);
    const table = viaFunction ? JSON.parse(options.body).p_table : url.pathname.split('/').pop();
    calls.push({ table, url, method: viaFunction ? 'GET' : options.method || 'GET', replace: table === 'crm_store_split_backup' && JSON.parse(options.body).p_replace, viaFunction });
    if (viaFunction) return unreadable.has(table) ? response({ message: 'permission denied' }, 403) : response({ total: (rows[table] || []).length, rows: rows[table] || [] });
    if (table === 'crm_store_split_backup') {
      const {p_backup: body,p_replace} = JSON.parse(options.body);
      if (!backups.has(body.backup_date) || p_replace) backups.set(body.backup_date, body);
      return response(true);
    }
    if (table === 'crm_backups') {
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
  assert.equal(stored.payload.schemaVersion, 6);
  assert.equal(backup.BACKUP_FORMAT, 6);
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
  // Square's tables are in it too, with the date invoicing was switched on. They
  // were asked of the database's function, for this company, and never read as tables.
  assert.deepEqual(stored.payload.tables.crm_square_invoice_policy, rows.crm_square_invoice_policy);
  const squareCalls = calls.filter((call) => call.table.startsWith('crm_square_'));
  assert.equal(squareCalls.length, 5);
  assert.ok(squareCalls.every((call) => call.viaFunction && call.url.pathname === '/rest/v1/rpc/crm_square_backup_page'));
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
  assert.equal(calls.filter((call) => call.method === 'POST').at(-1).replace, true);
  // After that the day is done, and a whole backup is never replaced.
  const settled = calls.length;
  assert.deepEqual(await backup.createDailyBackup(config, new Date('2026-11-22T13:00:00.000Z')), { backupDate: '2026-11-22', alreadyStored: true });
  assert.deepEqual(calls.slice(settled).map((call) => `${call.method} ${call.table}`), ['GET crm_backups']);
  assert.equal(calls.filter((call) => call.method === 'POST' && call.replace).length, 1);

  // A backup in the format before this one is not whole: it has no Square
  // tables, though it skipped nothing it knew of. So the first run of this code
  // on its day makes a full one in its place.
  backups.set('2026-11-23', { backup_date: '2026-11-23', payload: { schemaVersion: 5, skippedTables: [], records: [] } });
  assert.equal(await backup.storedBackupState(config, '2026-11-23'), 'incomplete');
  assert.equal((await backup.createDailyBackup(config, new Date('2026-11-23T16:00:00.000Z'))).replacedIncomplete, true);
  assert.equal(backups.get('2026-11-23').payload.schemaVersion, 6);
  assert.equal(await backup.storedBackupState(config, '2026-11-23'), 'complete');
  // When the question cannot even be asked, a backup is still made, and nothing is replaced.
  const offline = { ...config, fetch: async (input, options = {}) => (new URL(input).pathname.endsWith('crm_backups') && (options.method || 'GET') === 'GET' ? response({}, 503) : fetcher(input, options)) };
  assert.equal(await backup.storedBackupState(offline, '2026-11-24'), 'unknown');
  await backup.createDailyBackup(offline, new Date('2026-11-24T16:00:00.000Z'));
  assert.equal(calls.filter((call) => call.method === 'POST').at(-1).replace, false);
});

test('the server is told when the day\'s backup is incomplete, so it shows in the log', async () => {
  const errors = [];
  const fetcher = async (input, options = {}) => {
    const table = new URL(input).pathname.split('/').pop();
    if (table === 'crm_backups') return response([]);
    if (table === 'crm_store_split_backup') return response(true);
    if (table === backup.SQUARE_BACKUP_FUNCTION) return response({ total: 0, rows: [] });
    return table === 'crm_refunds' ? response({}, 500) : response([]);
  };
  const stop = backup.start({ origin: 'https://example.supabase.co', companyId: COMPANY, key: 'sb_secret_test', fetch: fetcher, intervalMs: 3600000, onError: (error) => errors.push(error.message) });
  for (let turn = 0; turn < 50 && !errors.length; turn += 1) await new Promise((resolve) => setTimeout(resolve, 10));
  stop();
  assert.deepEqual(errors, ['Recovery backup is incomplete: crm_refunds could not be read.']);
});
