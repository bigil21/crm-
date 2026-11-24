// Restoring a JobCrest backup (to-do item 20).
//
// The CRM's server stores one backup a day in the crm_backups table. Until now
// nothing could put one back, so nobody knew whether a backup was any use.
//
//   npm run restore:drill
//       The whole exercise on the local test copy: make a backup with the
//       server's own code, rebuild an empty database from it, and check that
//       every record, the money totals and the files come back identical.
//       Uses made-up data and nothing but this computer.
//
//   node scripts/restore-backup.js check <backup.json>
//       Rebuilds an empty database, in memory on this computer, from a real
//       backup file and reports what came back. The live database is not
//       involved: this only proves the file is complete and usable.
//
//   node scripts/restore-backup.js records <backup.json> <type:id> [<type:id> ...]
//       Prints SQL that puts the named records back the way the backup has
//       them (for example  estimate:est-123  job:job-456). It runs nothing.
//       A person reads the SQL and runs it in the database's SQL editor.
//
//   node --env-file=.env scripts/restore-backup.js export --to <folder> [--date 2026-11-22]
//   Default: manager copy, with no raw Square rows. For a full disaster-recovery
//   copy, run ONLY on the trusted server and add --include-private-square.
//   Keep its <date>-server-only directory in restricted backup storage; never share it.
//       Copies a day's backup and every file it lists (photos, PDFs) out of
//       the live project into a folder. It only reads. This is the copy of
//       the files that the daily backup does not hold. Needs SUPABASE_URL and
//       SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).
//
//   node scripts/restore-backup.js verify-export <folder>
//       Checks every file in an exported folder against its recorded checksum.
//
// A backup file is what crm_backups.payload holds. The SQL editor's
//   select payload from crm_backups order by backup_date desc limit 1;
// saved as JSON is accepted as it is.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const backup = require('../recovery-backup.js');

const BUCKET = 'crm-documents';
const DEFAULT_COMPANY = 'coastal-crest';
const CORE = [
  { key: 'records', table: 'crm_records' },
  { key: 'auditEvents', table: 'crm_audit_events' },
  { key: 'conversationMessages', table: 'crm_conversation_messages' },
];

const ident = (name) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected table or column name: ${name}`);
  return `"${name}"`;
};
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}
const dollars = (amount) => `$${Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ------------------------------------------------------------- the backup
function readBackupFile(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  let payload = first && Object.hasOwn(first, 'payload') ? first.payload : first;
  if (typeof payload === 'string') payload = JSON.parse(payload);
  if (!payload || !Array.isArray(payload.records)) throw new Error('This file is not a JobCrest backup: it has no list of records.');
  return payload;
}

function tablesIn(payload) {
  const list = CORE.map(({ key, table }) => ({ table, rows: Array.isArray(payload[key]) ? payload[key] : [], core: true }));
  // Every settings row, in backups that hold them all (older ones hold only the company's own).
  if (Array.isArray(payload.stateRows)) list.unshift({ table: 'crm_state', rows: payload.stateRows, core: true });
  for (const [table, rows] of Object.entries(payload.tables || {})) if (Array.isArray(rows)) list.push({ table, rows, core: false });
  return list;
}

// Reads an amount the way the CRM does: "$1,200.50" is 1200.50, and anything
// that is not a number is 0.
function money(value) {
  const cleaned = String(value ?? '').replace(/[$,%\s]/g, '');
  return /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(cleaned) ? Number(cleaned) : 0;
}

// The money in a backup, added up from the file itself with the same rules the
// CRM's ledger uses. It is the figure to hold a restored database against.
function moneyInBackup(payload) {
  const records = payload.records || [];
  const leads = new Set(records.filter((row) => row.record_type === 'contact' && !row.deleted_at && String(row.data?.archived ?? '') !== 'true').map((row) => row.id));
  const jobs = records.filter((row) => row.record_type === 'job' && !row.deleted_at && leads.has(row.lead_id));
  const table = (name) => (Array.isArray(payload.tables?.[name]) ? payload.tables[name] : []);
  const jobIds = new Set(jobs.map((job) => job.id));
  // A row counts when its lead does; a payment recorded on a job (origin "job",
  // in backups made since payments got one home) also needs that job.
  const counts = (row) => !row.lead_id || leads.has(row.lead_id);
  const paymentRows = table('crm_payments');
  const fromJob = (row) => row.origin === 'job';
  const covers = (row, item, job) => row.id === item?.id && (!fromJob(row) || row.job_id === job.id);
  const expenseIds = new Set(table('crm_expenses').map((row) => row.id));
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  const list = (value) => (Array.isArray(value) ? value : []);
  const invoicePayments = sum(paymentRows.filter((row) => counts(row) && (!fromJob(row) || jobIds.has(row.job_id))).map((row) => money(row.amount)));
  // Payments on a job's record with no row in the table: all of them in an
  // older backup, none in a newer one.
  const jobPayments = sum(jobs.flatMap((job) => list(job.data?.manualPayments).filter((item) => !paymentRows.some((row) => covers(row, item, job))).map((item) => money(item?.amount))));
  const squarePayments = sum(jobs.map((job) => money(job.data?.squarePaidAmount)).filter((amount) => amount > 0));
  const refunds = sum(table('crm_refunds').filter(counts).map((row) => money(row.amount)));
  const expenses = sum(table('crm_expenses').filter(counts).map((row) => money(row.amount)))
    + sum(jobs.flatMap((job) => list(job.data?.costItems).filter((item) => !expenseIds.has(item?.id)).map((item) => money(item?.amount))));
  const payments = invoicePayments + jobPayments + squarePayments;
  const cents = (amount) => Math.round(amount * 100) / 100;
  return { payments: cents(payments), refunds: cents(refunds), collected: cents(Math.max(payments - refunds, 0)), expenses: cents(expenses), leads: leads.size, jobs: jobs.length };
}

// ---------------------------------------------- a row in every table (drill)
// A restore that is only ever tried on empty tables proves nothing about them.
// This puts one made-up row in every table the backup is meant to hold that
// has none, so the drill can require an actual record back from each. The row
// is built from the table's own definition: every column that must have a
// value gets one of the right kind. The few columns whose rules need a
// particular value are listed here.
const TEST_ROW_VALUES = {
  crm_sales_numbers: { number_kind: 'lead' },
  crm_website_intake_requests: { payload_hash: 'a'.repeat(64) },
  crm_invoice_schedules: { cadence: 'monthly' },
  crm_billing_notices: { notice_type: 'overdue', recipient_email: 'customer@example.com' },
  crm_task_participants: { participant_kind: 'assignee' },
  crm_customer_messages: { sender_type: 'staff' },
  crm_signature_requests: { provider: 'jobcrest' },
  crm_record_tags: { record_type: 'job' },
  crm_custom_fields: { applies_to: 'job', field_type: 'text' },
  crm_custom_field_values: { record_type: 'job' },
  crm_goals: { metric: 'collected_revenue' },
  // Square's tables take only the two environments Square has.
  crm_square_invoice_reviews: { environment: 'production', note: 'TEST reviewed before the first Square invoice was sent' },
  crm_square_invoice_intents: { environment: 'production' },
  crm_square_invoice_watermarks: { environment: 'production' },
  crm_square_webhook_events: { environment: 'production', event_type: 'invoice.payment_made' },
  // A website quote request, with one photo so the copy of the files has a quote photo to bring back.
  quote_requests: { reference: 'CC-202611-0001', segment: 'residential', division: 'roofing', urgency: 'Within 2 weeks', services: ['Roof repair'],
    first_name: 'TEST', last_name: 'Visitor', phone: '(555) 010-0199', email: 'visitor@example.com', street: '1 Example Street', city: 'Naples', zip: '34102',
    contact_pref: 'Email', consent: true, photo_paths: ['0f8fad5b-d9cb-469f-a165-70867728950e/TEST-quote-photo.png'] },
};

async function seedEveryTable(runner, { companyId = DEFAULT_COMPANY, userId, values = TEST_ROW_VALUES } = {}) {
  const seeded = [];
  const failed = [];
  const now = new Date().toISOString();
  for (const { table, everyCompany } of backup.EXTRA_TABLES) {
    const columns = (await runner.query(`select column_name as name, udt_name as type, is_nullable = 'YES' as nullable, column_default is not null as has_default,
        is_identity = 'YES' as identity, is_generated <> 'NEVER' as generated
      from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [table])).rows;
    if (!columns.length) continue; // an optional table this database does not have
    const scoped = !everyCompany && columns.some((column) => column.name === 'company_state_id');
    const existing = Number((await runner.query(`select count(*)::int as n from public.${ident(table)}${scoped ? ' where company_state_id = $1' : ''}`, scoped ? [companyId] : [])).rows[0].n);
    if (existing) continue;
    const row = {};
    for (const column of columns) {
      if (column.identity || column.generated) continue;
      const given = values[table]?.[column.name];
      if (given !== undefined) { row[column.name] = given; continue; }
      if (column.name === 'company_state_id') { row[column.name] = companyId; continue; }
      const kind = column.type;
      // "Who did this" columns default to the signed-in user, and nobody is signed in here.
      if (kind === 'uuid' && !column.nullable) { row[column.name] = userId; continue; }
      if (column.nullable || column.has_default) continue;
      if (kind === 'uuid') row[column.name] = userId;
      else if (['text', 'varchar', 'bpchar', 'citext'].includes(kind)) row[column.name] = /(^|_)id$/.test(column.name) ? `drill-${table.replace(/^crm_/, '')}` : `TEST ${column.name.replace(/_/g, ' ')}`;
      else if (['int2', 'int4', 'int8', 'numeric', 'float4', 'float8'].includes(kind)) row[column.name] = 1;
      else if (kind === 'bool') row[column.name] = true;
      else if (kind === 'jsonb' || kind === 'json') row[column.name] = {};
      else if (kind === 'timestamptz' || kind === 'timestamp') row[column.name] = now;
      else if (kind === 'date') row[column.name] = now.slice(0, 10);
      else if (kind.startsWith('_')) row[column.name] = [];
      else { failed.push({ table, problem: `no test value for column ${column.name} of type ${kind}` }); }
    }
    if (table === 'crm_document_versions') row.storage_path = `${companyId}/drill/version-only.pdf`;
    const names = Object.keys(row);
    try {
      await runner.exec('set session_replication_role = replica');
      await runner.query(`insert into public.${ident(table)} (${names.map(ident).join(', ')}) overriding system value
        select ${names.map(ident).join(', ')} from jsonb_populate_record(null::public.${ident(table)}, $1::jsonb)`, [JSON.stringify(row)]);
      seeded.push(table);
    } catch (error) {
      failed.push({ table, problem: String(error.message || error).slice(0, 200) });
    } finally {
      await runner.exec('set session_replication_role = origin');
    }
  }
  return { seeded, failed };
}

// ----------------------------------------------------------- the database
async function tableShape(db, table) {
  const name = `public.${table}`;
  const columns = (await db.query(`select a.attname as name, a.attgenerated <> '' as generated,
      a.attnotnull and a.atttypid in ('jsonb'::regtype, 'json'::regtype) as json_required
    from pg_attribute a
    where a.attrelid = to_regclass($1) and a.attnum > 0 and not a.attisdropped order by a.attnum`, [name])).rows;
  if (!columns.length) return null;
  const key = (await db.query(`select a.attname as name from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = to_regclass($1) and i.indisprimary order by array_position(i.indkey::int2[], a.attnum)`, [name])).rows.map((row) => row.name);
  return { columns: columns.filter((column) => !column.generated).map((column) => column.name), key,
    // Columns that must hold JSON and may hold the JSON value null. A backup is
    // JSON itself, where that value and "no value" look the same.
    jsonRequired: new Set(columns.filter((column) => column.json_required).map((column) => column.name)) };
}

// Puts a whole backup into an empty database. Rows go back exactly as they
// were saved: the database's own rules, which would re-stamp each row's date,
// version and author on the way in, are switched off for this one transaction.
async function restoreAll(db, payload, { companyId = DEFAULT_COMPANY } = {}) {
  if (payload.privateSquareSnapshot && !squareKeys.every(k => Array.isArray(payload.tables?.[k]))) {
    throw new Error('A full rebuild needs the server-only Square snapshot; a manager copy cannot be used.');
  }
  const existing = Number((await db.query('select count(*)::int as n from public.crm_records where company_state_id = $1', [companyId])).rows[0].n);
  if (existing) throw new Error(`This database already holds ${existing} records. A whole backup only goes into an empty database, so nothing can be overwritten by mistake. To put back chosen records, use the "records" command.`);
  const report = { tables: [], tablesNotInDatabase: [] };
  await db.transaction(async (tx) => {
    await tx.exec('set local session_replication_role = replica');
    // An older backup holds the company's settings only; a newer one holds every settings row, restored below with the rest.
    if (!Array.isArray(payload.stateRows)) {
      await tx.query(`insert into public.crm_state(id, data) values($1, $2::jsonb)
        on conflict(id) do update set data = excluded.data, updated_at = clock_timestamp()`, [`${companyId}:company`, JSON.stringify(payload.company || {})]);
    }
    for (const { table, rows } of tablesIn(payload)) {
      const shape = await tableShape(tx, table);
      if (!shape) { report.tablesNotInDatabase.push(table); continue; }
      const present = new Set(rows.flatMap((row) => Object.keys(row)));
      const columns = shape.columns.filter((name) => present.has(name));
      if (rows.length && columns.length) {
        const list = columns.map(ident).join(', ');
        const others = columns.filter((name) => !shape.key.includes(name));
        const conflict = !shape.key.length ? ''
          : ` on conflict (${shape.key.map(ident).join(', ')}) do ${others.length ? `update set ${others.map((name) => `${ident(name)} = excluded.${ident(name)}`).join(', ')}` : 'nothing'}`;
        // A column that must hold JSON gets the JSON value null back where the backup has null.
        const values = columns.map((name) => (shape.jsonRequired.has(name) ? `coalesce(${ident(name)}, 'null')` : ident(name))).join(', ');
        for (let offset = 0; offset < rows.length; offset += 250) {
          await tx.query(`insert into public.${ident(table)} (${list}) overriding system value
            select ${values} from jsonb_populate_recordset(null::public.${ident(table)}, $1::jsonb)${conflict}`, [JSON.stringify(rows.slice(offset, offset + 250))]);
        }
      }
      report.tables.push({ table, rows: rows.length });
    }
  });
  return report;
}

// Holds a database against a backup, row by row and column by column.
async function compareWithBackup(db, payload, { companyId = DEFAULT_COMPANY } = {}) {
  const results = [];
  for (const { table, rows, core } of tablesIn(payload)) {
    const shape = await tableShape(db, table);
    if (!shape) { results.push({ table, core, inBackup: rows.length, tableMissing: true }); continue; }
    const keyOf = (row) => stable(shape.key.map((name) => row[name]));
    // The backup's rows are read through the database, so dates and numbers
    // are written the same way on both sides before they are compared.
    const expected = [];
    for (let offset = 0; offset < rows.length; offset += 500) {
      const chunk = await db.query(`select to_jsonb(r) as row from jsonb_array_elements($1::jsonb) with ordinality e(value, position),
        jsonb_populate_record(null::public.${ident(table)}, e.value) r order by e.position`, [JSON.stringify(rows.slice(offset, offset + 500))]);
      expected.push(...chunk.rows.map((item) => item.row));
    }
    const scoped = shape.columns.includes('company_state_id');
    const found = (await db.query(`select to_jsonb(t) as row from public.${ident(table)} t${scoped ? ' where t.company_state_id = $1' : ''}`, scoped ? [companyId] : [])).rows.map((item) => item.row);
    const byKey = new Map(found.map((row) => [keyOf(row), row]));
    const different = [];
    const missing = [];
    let identical = 0;
    rows.forEach((original, index) => {
      const key = keyOf(expected[index]);
      const row = byKey.get(key);
      byKey.delete(key);
      if (!row) { missing.push(key); return; }
      const columns = Object.keys(original).filter((name) => shape.columns.includes(name));
      const changed = columns.filter((name) => stable(row[name]) !== stable(expected[index][name]));
      if (changed.length) different.push({ key, columns: changed }); else identical += 1;
    });
    results.push({ table, core, inBackup: rows.length, inDatabase: found.length, identical, different, missing, notInBackup: [...byKey.keys()] });
  }
  // A backup that holds every settings row has had them compared above, with the other tables.
  if (Array.isArray(payload.stateRows)) return results;
  const company = (await db.query('select data from public.crm_state where id = $1', [`${companyId}:company`])).rows[0]?.data;
  results.push({ table: 'company settings', core: true, inBackup: 1, inDatabase: company ? 1 : 0,
    identical: stable(company) === stable(payload.company || {}) ? 1 : 0, different: stable(company) === stable(payload.company || {}) ? [] : [{ key: 'company', columns: ['data'] }], missing: [], notInBackup: [] });
  return results;
}

async function ledgerTotals(db) {
  try { return (await db.query('select public.crm_ledger_totals() as totals')).rows[0].totals; } catch { return null; }
}

// What a backup is meant to hold and does not, said the way a person would.
// A backup that is missing a table restores everything that is in it and still
// cannot rebuild the CRM, so this is a failure, not a footnote.
function backupGaps(payload) {
  // The three lists every backup has always been made of.
  const gaps = CORE.filter(({ key }) => !Array.isArray(payload?.[key])).map(({ table }) => `${table}: not in the backup`);
  const missing = backup.missingTables(payload);
  // The settings rows other than the company's own (in a backup new enough to have the other tables).
  if (payload?.tables && typeof payload.tables === 'object' && !Array.isArray(payload.stateRows)) gaps.push('crm_state: only the company\'s own settings row is in the backup');
  if (!missing.length) return gaps;
  if (!payload?.tables || typeof payload.tables !== 'object') {
    return [...gaps, `the backup is in the older format: it holds the records but none of the ${missing.length} other tables (payments, refunds, expenses, invoices, given-out numbers, set-up lists, roles)`];
  }
  const skipped = new Set(Array.isArray(payload.skippedTables) ? payload.skippedTables : []);
  return [...gaps, ...missing.map((table) => `${table}: not in the backup${skipped.has(table) ? ' (it could not be read when the backup was made)' : ''}`)];
}

// A restore is good when the backup holds everything it is meant to and every
// table in it came back whole. Rows the database has and the backup does not
// are only a problem in the records themselves; the set-up lists start with
// rows of their own in a new database.
function restoreVerdict(comparison, { money: expectedMoney, totals, payload } = {}) {
  const problems = payload ? backupGaps(payload) : [];
  for (const item of comparison) {
    if (item.tableMissing) { if (item.inBackup) problems.push(`${item.table}: the database has no such table, so ${item.inBackup} rows were left out`); continue; }
    if (item.missing.length) problems.push(`${item.table}: ${item.missing.length} rows are missing`);
    if (item.different.length) problems.push(`${item.table}: ${item.different.length} rows differ`);
    if (item.core && item.notInBackup.length) problems.push(`${item.table}: ${item.notInBackup.length} rows are not in the backup`);
  }
  if (expectedMoney && totals) {
    for (const name of ['payments', 'refunds', 'collected', 'expenses']) {
      if (Math.abs(Number(totals[name]) - expectedMoney[name]) > 0.005) problems.push(`${name}: the database says ${dollars(totals[name])}, the backup says ${dollars(expectedMoney[name])}`);
    }
  }
  return problems;
}

// ----------------------------------------------- putting chosen records back
// SQL that returns the named records to the way the backup has them. It keeps
// the database's rules switched on, so a restore they would refuse (changing a
// number that has been given out, say) stops with the reason and changes
// nothing. Each record's version goes up by one, so anyone with it open is
// told it changed instead of saving over it.
function recordsSql(payload, selectors, { companyId = DEFAULT_COMPANY } = {}) {
  if (!selectors.length) throw new Error('Name at least one record, as type:id (for example estimate:est-123).');
  const tag = `jobcrest_${crypto.randomBytes(6).toString('hex')}`;
  const quote = (text) => {
    if (String(text).includes(`$${tag}$`)) throw new Error('A record contains the quoting marker; run the command again.');
    return `$${tag}$${text}$${tag}$`;
  };
  const made = String(payload.createdAt || '').slice(0, 19).replace('T', ' ');
  const lines = [
    `-- JobCrest: put ${selectors.length} record${selectors.length === 1 ? '' : 's'} back as the backup made ${made || 'earlier'} UTC has ${selectors.length === 1 ? 'it' : 'them'}.`,
    '-- Read this before running it. It changes only the records named below.',
    '-- If the database refuses any one of them, nothing at all is changed.',
    'begin;',
  ];
  for (const selector of selectors) {
    const separator = selector.indexOf(':');
    const type = selector.slice(0, separator);
    const id = selector.slice(separator + 1);
    const row = (payload.records || []).find((item) => item.record_type === type && item.id === id && (item.company_state_id || companyId) === companyId);
    if (separator < 1 || !row) throw new Error(`The backup has no record "${selector}". Records are named type:id, and the types are contact, job, estimate, task and document.`);
    const leadId = row.lead_id || (type === 'contact' ? row.id : '');
    lines.push(
      '',
      `-- ${type} ${id} (version ${row.version} in the backup${row.deleted_at ? ', deleted at the time' : ''})`,
      `insert into public.crm_records (company_state_id, record_type, id, lead_id, job_id, owner_id, data, version, deleted_at, created_at, updated_at, updated_by)`,
      `select r.company_state_id, r.record_type, r.id, r.lead_id, r.job_id, r.owner_id, r.data, r.version, r.deleted_at, r.created_at, clock_timestamp(), r.updated_by`,
      `from jsonb_populate_record(null::public.crm_records, ${quote(JSON.stringify({ ...row, company_state_id: companyId }))}::jsonb) r`,
      `on conflict (company_state_id, record_type, id) do update set`,
      `  data = excluded.data, lead_id = excluded.lead_id, job_id = excluded.job_id, owner_id = excluded.owner_id,`,
      `  deleted_at = excluded.deleted_at, version = public.crm_records.version + 1, updated_at = clock_timestamp();`,
    );
    if (leadId) lines.push(
      `insert into public.crm_audit_events (id, company_state_id, lead_id, job_id, event_type, actor_name, message)`,
      `values (${quote(`restore-${crypto.randomUUID()}`)}, ${quote(companyId)}, ${quote(leadId)}, ${row.job_id ? quote(row.job_id) : 'null'}, 'note', 'Backup restore',`,
      `  ${quote(`This ${type} was put back from the backup made ${made || 'earlier'} UTC.`)});`,
    );
  }
  lines.push('', 'commit;', '');
  return lines.join('\n');
}

// ------------------------------------------------------- copying the files
// One folder name per part of the stored path, with nothing that could climb
// out of the export folder or that Windows refuses in a file name.
function localFileName(storagePath) {
  return String(storagePath).split('/').map((part) => {
    const safe = part.replace(/[<>:"|?*\\\u0000-\u001f]/g, '_').replace(/[. ]+$/, '_');
    return !safe || safe === '.' || safe === '..' ? '_' : safe;
  }).join('/');
}
const objectUrl = (origin, storagePath, bucket = BUCKET) => `${origin}/storage/v1/object/${bucket}/${String(storagePath).split('/').map(encodeURIComponent).join('/')}`;

// Every stored file a backup points to, and the bucket each is in: the CRM's
// documents and photos, and the photos sent in with website quote requests,
// which are kept in a bucket of their own. "name" is how a file is referred to
// in lists; it is the path itself for a document, as it always was.
const QUOTE_PHOTO_FOLDER = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function filesNamedBy(payload, companyId) {
  const plain = (storagePath) => typeof storagePath === 'string' && !storagePath.includes('\\') && storagePath.split('/').every((part) => part && part !== '.' && part !== '..');
  const documents = [...new Set([...(payload.storagePaths || []), ...backup.storagePaths(payload.records || [], payload.tables)])]
    // Never fetch outside this company's part of the bucket.
    .map((storagePath) => ({ bucket: BUCKET, path: storagePath, name: storagePath, local: `files/${plain(storagePath) ? localFileName(storagePath) : '_'}`,
      allowed: plain(storagePath) && storagePath.startsWith(`${companyId}/`) }));
  const quotePhotos = [...new Set([...(payload.quotePhotoPaths || []), ...backup.quotePhotoPaths(payload.tables)])]
    // A visitor's photo is always inside a folder named with a random id.
    .map((storagePath) => ({ bucket: backup.QUOTE_PHOTO_BUCKET, path: storagePath, name: `${backup.QUOTE_PHOTO_BUCKET}/${storagePath}`,
      local: `files/_${backup.QUOTE_PHOTO_BUCKET}/${plain(storagePath) ? localFileName(storagePath) : '_'}`,
      allowed: plain(storagePath) && QUOTE_PHOTO_FOLDER.test(storagePath.split('/')[0]) && storagePath.split('/').length >= 2 }));
  return [...documents, ...quotePhotos];
}
// The same name for a file already copied, from its line in a copy's list. A
// document's line has no bucket, as before quote photos were copied too.
const entryName = (entry) => (entry.bucket && entry.bucket !== BUCKET ? `${entry.bucket}/${entry.path}` : entry.path);

const squareKeys = backup.EXTRA_TABLES.filter(t => t.via === backup.SQUARE_BACKUP_FUNCTION).map(t => t.table);
// Fetch the matching archived snapshot, never today's live provider tables.
async function completeServerPayload(config, row) {
  const payload = row.payload;
  if (!payload.privateSquareSnapshot) return payload; // older backup
  const response = await (config.fetch || fetch)(new URL(`${config.origin}/rest/v1/rpc/crm_private_square_snapshot`), {
    method: 'POST', signal: AbortSignal.timeout(120000), headers: backup.serviceHeaders(config.key, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({ p_company: config.companyId, p_day: row.backup_date, p_snapshot: payload.privateSquareSnapshot }),
  });
  if (!response.ok) throw new Error('Cannot read the matching server-only Square backup.');
  const square = await response.json();
  if (!square || typeof square !== 'object' || Array.isArray(square) || Object.keys(square).some(k => !squareKeys.includes(k))
      || !squareKeys.every(k => Array.isArray(square[k]) || (!Object.hasOwn(square,k) && payload.skippedTables?.includes(k)))) {
    throw new Error('Invalid server-only Square backup.');
  }
  return { ...payload, tables: { ...payload.tables, ...square } };
}
async function exportBackup({ origin, key, companyId = DEFAULT_COMPANY, fetch: fetcher = fetch, date = '', folder, includePrivateSquare = false, log = () => {} }) {
  if (!folder) throw new Error('Say where the copy should go, with --to <folder>.');
  const url = new URL(`${origin}/rest/v1/crm_backups`);
  url.searchParams.set('select', 'backup_date,record_count,payload');
  url.searchParams.set('company_state_id', `eq.${companyId}`);
  if (date) url.searchParams.set('backup_date', `eq.${date}`);
  url.searchParams.set('order', 'backup_date.desc');
  const response = await fetcher(url, { signal: AbortSignal.timeout(120000), headers: backup.serviceHeaders(key, { Range: '0-0' }) });
  if (!response.ok) throw new Error('The backup could not be read from the database.');
  const [row] = await response.json();
  if (!row?.payload) throw new Error(date ? `There is no backup dated ${date}.` : 'There is no backup yet.');
  const day = String(row.backup_date);
  const managerCopy = !includePrivateSquare && Boolean(row.payload.privateSquareSnapshot);
  if (includePrivateSquare) row.payload = await completeServerPayload({ origin, key, companyId, fetch: fetcher }, row);
  else if (squareKeys.some(k => (row.payload.tables?.[k]?.length || 0) > 0)) {
    throw new Error('Refusing to write raw Square records into a standard export.');
  }
  const target = path.join(folder, includePrivateSquare ? day + '-server-only' : day);
  fs.mkdirSync(path.join(target, 'files'), { recursive: true, mode: 0o700 });
  const backupText = JSON.stringify(row.payload);
  fs.writeFileSync(path.join(target, 'backup.json'), backupText, { mode: 0o600 });
  const files = [];
  const missing = [];
  const taken = new Set();
  for (const item of filesNamedBy(row.payload, companyId)) {
    // Keep the database record even if a bad historical reference cannot be
    // exported: the file is named as missing, and nothing is fetched for it.
    if (!item.allowed) { missing.push(item.name); continue; }
    let local = item.local;
    if (taken.has(local.toLowerCase())) local = `${local}.${sha256(item.name).slice(0, 8)}`;
    taken.add(local.toLowerCase());
    try {
      const file = await fetcher(objectUrl(origin, item.path, item.bucket), { signal: AbortSignal.timeout(300000), headers: backup.serviceHeaders(key) });
      if (!file.ok) { missing.push(item.name); continue; }
      const bytes = Buffer.from(await file.arrayBuffer());
      const destination = path.join(target, ...local.split('/'));
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, bytes);
      files.push({ path: item.path, ...(item.bucket === BUCKET ? {} : { bucket: item.bucket }), file: local, bytes: bytes.length, sha256: sha256(bytes), type: file.headers?.get?.('content-type') || '' });
      log(`  copied ${item.name}`);
    } catch {
      missing.push(item.name);
    }
  }
  const manifest = { backupDate: day, exportedAt: new Date().toISOString(), records: Number(row.record_count) || 0,
    backup: { file: 'backup.json', bytes: Buffer.byteLength(backupText), sha256: sha256(backupText) }, files, missing,
    // Tables the backup itself is missing. A copy of an incomplete backup is an incomplete copy.
    ...(managerCopy ? { scope: 'manager' } : {}),
    incompleteTables: backup.missingTables(row.payload).filter(k => !managerCopy || !squareKeys.includes(k) || row.payload.skippedTables?.includes(k)) };
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { folder: target, ...manifest };
}

// Checks an exported folder against its own list: every file present, the
// right size, and unchanged since it was copied.
function verifyExport(folder) {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  const problems = [];
  for (const entry of [manifest.backup, ...manifest.files]) {
    const file = path.join(folder, ...entry.file.split('/'));
    if (!fs.existsSync(file)) { problems.push(`${entry.file}: not there`); continue; }
    const bytes = fs.readFileSync(file);
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) problems.push(`${entry.file}: not the file that was copied`);
  }
  // The backup inside the folder is read again, not taken on the manifest's
  // word: what it is missing, and whether every file it points to is accounted
  // for in this copy, either as a file here or as one named missing.
  try {
    const payload = readBackupFile(path.join(folder, ...manifest.backup.file.split('/')));
    const managerCopy = manifest.scope === 'manager' && Boolean(payload.privateSquareSnapshot);
    if (managerCopy && squareKeys.some(k => Object.hasOwn(payload.tables || {},k))) problems.push('Unexpected Square data in the manager export');
    problems.push(...backupGaps(payload).filter(gap => !managerCopy || !squareKeys.some(k => gap === k + ': not in the backup')));
    const accountedFor = new Set([...(manifest.files || []).map(entryName), ...(manifest.missing || [])]);
    for (const item of filesNamedBy(payload, '')) {
      if (!accountedFor.has(item.name)) problems.push(`${item.name}: the backup points to this file and the copy does not have it`);
    }
  } catch {
    if (!problems.some((problem) => problem.startsWith(`${manifest.backup.file}:`))) problems.push(`${manifest.backup.file}: cannot be read as a backup`);
  }
  // A file the records point to that was never copied is a hole in the copy too.
  for (const storagePath of manifest.missing || []) problems.push(`${storagePath}: not in this copy (it could not be read when the copy was made)`);
  return { backupDate: manifest.backupDate, files: manifest.files.length, missing: manifest.missing, problems, ...(manifest.scope === 'manager' ? { scope: 'manager' } : {}) };
}

// "That file is already there" from the file service, and nothing else. It
// says so with status 409, or with 400 and the 409 in the answer itself. Any
// other refusal is a file that did not go back: the quote photo bucket, for
// one, turns away anything that is not an image, also with a 400.
async function alreadyThere(response) {
  if (response.status === 409) return true;
  if (response.status !== 400) return false;
  try {
    const answer = await response.json();
    return String(answer?.statusCode) === '409' || answer?.error === 'Duplicate';
  } catch {
    return false;
  }
}

// Sends exported files back to where the records expect them. A file that is
// already there is left alone, never replaced.
async function uploadFiles({ origin, key, fetch: fetcher = fetch, folder, log = () => {} }) {
  const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'manifest.json'), 'utf8'));
  const sent = [];
  const kept = [];
  const failed = [];
  for (const entry of manifest.files) {
    const name = entryName(entry);
    const bytes = fs.readFileSync(path.join(folder, ...entry.file.split('/')));
    if (sha256(bytes) !== entry.sha256) { failed.push(name); continue; }
    try {
      const response = await fetcher(objectUrl(origin, entry.path, entry.bucket || BUCKET), { method: 'POST', signal: AbortSignal.timeout(300000),
        headers: backup.serviceHeaders(key, { 'Content-Type': entry.type || 'application/octet-stream', 'x-upsert': 'false' }), body: bytes });
      if (response.ok) { sent.push(name); log(`  sent ${name}`); }
      else if (await alreadyThere(response)) kept.push(name);
      else failed.push(name);
    } catch {
      failed.push(name);
    }
  }
  return { sent, kept, failed };
}

// ------------------------------------------------------------------ reports
function printComparison(comparison, log) {
  for (const item of comparison) {
    if (item.tableMissing) { if (item.inBackup) log(`  ${item.table.padEnd(28)} ${String(item.inBackup).padStart(6)} in the backup   NOT RESTORED (no such table)`); continue; }
    if (!item.inBackup && !item.core) continue;
    const state = item.missing.length || item.different.length ? `${item.missing.length} missing, ${item.different.length} different` : 'all identical';
    log(`  ${item.table.padEnd(28)} ${String(item.inBackup).padStart(6)} in the backup   ${String(item.identical).padStart(6)} came back   ${state}`);
  }
}

// Rebuilds an empty database from a backup file and reports on it.
async function check(file, { log = console.log, companyId = DEFAULT_COMPANY } = {}) {
  const payload = readBackupFile(file);
  const { createEmptyDatabase } = require('./local-cloud.js');
  log(`Backup made ${payload.createdAt || '(no date)'} by ${payload.source === 'server' ? 'the server' : 'a browser'} (format ${payload.schemaVersion}).`);
  log('Building an empty database on this computer and restoring into it...');
  const db = await createEmptyDatabase({ quiet: true });
  try {
    const report = await restoreAll(db, payload, { companyId });
    const comparison = await compareWithBackup(db, payload, { companyId });
    const expectedMoney = moneyInBackup(payload);
    const totals = await ledgerTotals(db);
    printComparison(comparison, log);
    if (report.tablesNotInDatabase.length) log(`  Tables in the backup that this database does not have: ${report.tablesNotInDatabase.join(', ')}`);
    const live = (payload.records || []).filter((row) => !row.deleted_at);
    log(`  Leads ${live.filter((row) => row.record_type === 'contact').length}, jobs ${live.filter((row) => row.record_type === 'job').length}, estimates ${live.filter((row) => row.record_type === 'estimate').length}, tasks ${live.filter((row) => row.record_type === 'task').length}, documents ${live.filter((row) => row.record_type === 'document').length}.`);
    log(`  Collected, by the backup file:        ${dollars(expectedMoney.collected)}`);
    if (totals) log(`  Collected, by the restored database:  ${dollars(totals.collected)}`);
    log(`  Files the records point to: ${(payload.storagePaths || []).length}. They are not in the backup; "export" copies them.`);
    const gaps = backupGaps(payload);
    const problems = restoreVerdict(comparison, { money: expectedMoney, totals, payload });
    // "Restores completely" is said only of a backup that holds everything and
    // came back whole. One with a table missing fails, whatever else matched.
    if (!problems.length) log('\nPASS  the backup restores completely');
    else {
      const restoredWhatItHolds = problems.length === gaps.length;
      log(`\nFAIL  ${gaps.length ? 'the backup is incomplete' : 'the restore does not match the backup'}: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n  ${problems.join('\n  ')}`);
      if (gaps.length && restoredWhatItHolds) log('  Everything that is in the backup restored correctly. What is missing from it cannot be restored from this file.');
    }
    return { problems, incomplete: backup.missingTables(payload), comparison, money: expectedMoney, totals };
  } finally { await db.close(); }
}

// The full exercise on the local test copy.
async function drill({ ports = { appPort: 4620, cloudPort: 4621, staticPort: 4622 }, log = console.log } = {}) {
  const localCloud = require('./local-cloud.js');
  const steps = [];
  const step = (text) => { steps.push(text); log(`  ok  ${text}`); };
  const need = (condition, message, detail) => { if (!condition) throw new Error(`${message}${detail === undefined ? '' : `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); };
  log('Restore drill: a backup is made, the database is rebuilt from it, and the two are compared');
  const cloud = await localCloud.start({ ...ports, quiet: true });
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'jobcrest-restore-drill-'));
  let rebuilt;
  try {
    const companyId = cloud.companyId;
    const config = { origin: cloud.cloudUrl, companyId, key: cloud.serviceKey, fetch };
    const admin = cloud.accounts.find((account) => account.role === 'admin');

    // The made-up records get the other things a real CRM has: activity
    // history, a conversation, numbers that have been given out, an estimate,
    // a task, and a real attached file.
    const lead = (await cloud.query(`select id, lead_id from public.crm_records where company_state_id = $1 and record_type = 'job' order by id limit 1`, [companyId])).rows[0];
    await cloud.query(`insert into public.crm_audit_events(id, company_state_id, lead_id, job_id, event_type, actor_user_id, actor_name, message)
      select 'drill-audit-' || n, $1, $2, $3, 'note', $4::uuid, 'Local Admin', 'TEST activity ' || n from generate_series(1, 25) n`, [companyId, lead.lead_id, lead.id, admin.id]);
    await cloud.query(`insert into public.crm_conversation_messages(id, company_state_id, lead_id, job_id, author_user_id, author_email, author_name, message_text, created_at)
      values('drill-message-1', $1, $2, $3, $4, $5, 'Local Admin', 'TEST message about the job', clock_timestamp())`, [companyId, lead.lead_id, lead.id, admin.id, admin.email]);
    await cloud.query(`insert into public.crm_sales_numbers(company_state_id, number_kind, entity_id, parent_id, number_value, created_by)
      values($1, 'lead', $2, null, 'TEST-0001', $3::uuid), ($1, 'project', $4, $2, 'TEST-0001-01', $3::uuid)`, [companyId, lead.lead_id, admin.id, lead.id]);
    await cloud.query(`insert into public.crm_records(company_state_id, record_type, id, lead_id, job_id, owner_id, data, updated_by) values
      ($1, 'estimate', 'drill-estimate-1', $2, $3, $4::uuid, $5::jsonb, $4::uuid),
      ($1, 'task', 'drill-task-1', $2, $3, $4::uuid, $6::jsonb, $4::uuid),
      ($1, 'document', 'drill-document-1', $2, $3, $4::uuid, $7::jsonb, $4::uuid)`, [companyId, lead.lead_id, lead.id, admin.id,
      JSON.stringify({ title: 'TEST estimate', status: 'Draft', items: [{ title: 'TEST line', quantity: 2, rate: 150.25 }] }),
      JSON.stringify({ title: 'TEST call the customer', done: false }),
      JSON.stringify({ name: 'TEST contract.pdf', storagePath: `${companyId}/drill/TEST contract.pdf`, previousVersions: [] })]);
    const attachment = crypto.randomBytes(48 * 1024);
    const stored = await fetch(objectUrl(cloud.cloudUrl, `${companyId}/drill/TEST contract.pdf`), { method: 'POST', headers: backup.serviceHeaders(cloud.serviceKey, { 'Content-Type': 'application/pdf' }), body: attachment });
    need(stored.ok, 'The test file could not be stored');
    const versionOnly = await fetch(objectUrl(cloud.cloudUrl, `${companyId}/drill/version-only.pdf`), { method: 'POST', headers: backup.serviceHeaders(cloud.serviceKey, { 'Content-Type': 'application/pdf' }), body: attachment });
    need(versionOnly.ok, 'The separate document version could not be stored');
    // The older settings rows a live database also holds: one for the company
    // as a whole and one per user.
    await cloud.query(`insert into public.crm_state(id, data, owner_id, owner_email, updated_by) values
      ($1, $3::jsonb, $5::uuid, $6, $5::uuid), ($2, $4::jsonb, $5::uuid, $6, $5::uuid) on conflict (id) do nothing`,
      [companyId, `${companyId}:user:${admin.id}`, JSON.stringify({ company: { name: 'TEST older copy' }, contacts: [] }),
        JSON.stringify({ owner: admin.email, contacts: [{ id: 'TEST-older-lead' }], estimates: [], calendarTasks: [] }), admin.id, admin.email]);
    // And a record in every other table the backup is meant to hold, so that
    // none of them is only ever backed up and restored empty.
    const everyTable = await seedEveryTable(cloud, { companyId, userId: admin.id });
    need(!everyTable.failed.length, 'A test row could not be made for every table', everyTable.failed.slice(0, 5));
    // The website quote request made above names a photo. That photo is in a
    // bucket of its own, not with the CRM's documents.
    const quotePhotoPath = TEST_ROW_VALUES.quote_requests.photo_paths[0];
    const quotePhoto = crypto.randomBytes(12 * 1024);
    const storedPhoto = await fetch(objectUrl(cloud.cloudUrl, quotePhotoPath, backup.QUOTE_PHOTO_BUCKET), { method: 'POST', headers: backup.serviceHeaders(cloud.serviceKey, { 'Content-Type': 'image/png' }), body: quotePhoto });
    need(storedPhoto.ok, 'The test quote photo could not be stored');

    const made = await backup.createDailyBackup(config);
    const row = (await cloud.query('select record_count, payload from public.crm_backups where company_state_id = $1 order by backup_date desc limit 1', [companyId])).rows[0];
    need(row && made.recordCount === row.record_count, 'The server did not store a backup', made);
    const payload = await completeServerPayload(config, { ...row, backup_date: made.backupDate });
    need(!payload.skippedTables.length, 'The backup could not read some tables', payload.skippedTables);
    need(!backupGaps(payload).length, 'The backup is missing something it is meant to hold', backupGaps(payload));
    // Every table of the database is accounted for, and every one the backup
    // holds has at least one real record in it.
    const inDatabase = (await cloud.query(`select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`)).rows.map((item) => item.name);
    const listed = new Set([...backup.CORE_TABLES, ...backup.EXTRA_TABLES.map((item) => item.table), ...Object.keys(backup.EXCLUDED_TABLES)]);
    need(inDatabase.every((name) => listed.has(name)), 'A table is neither in the backup nor left out on purpose', inDatabase.filter((name) => !listed.has(name)));
    const held = backup.EXTRA_TABLES.map((item) => item.table).filter((name) => inDatabase.includes(name));
    const empty = held.filter((name) => !(payload.tables[name] || []).length);
    need(!empty.length, 'The backup holds no record from these tables, so it proves nothing about them', empty);
    need(payload.stateRows.length >= 3, 'The backup should hold every settings row', payload.stateRows.map((item) => item.id));
    need(payload.absentTables.every((name) => !inDatabase.includes(name)), 'A table was called absent that the database has', payload.absentTables);
    step(`the server's own backup code stored a backup of ${row.record_count} records and all ${held.length} other tables, each with a record in it`);
    const again = await backup.createDailyBackup(config);
    need(again.alreadyStored === true, 'A second run on the same day should find the backup already there', again);

    rebuilt = await localCloud.createEmptyDatabase({ quiet: true });
    await restoreAll(rebuilt, payload, { companyId });
    const comparison = await compareWithBackup(rebuilt, payload, { companyId });
    const expectedMoney = moneyInBackup(payload);
    const totals = await ledgerTotals(rebuilt);
    const problems = restoreVerdict(comparison, { money: expectedMoney, totals, payload });
    need(!problems.length, 'The rebuilt database does not match the backup', problems.join('; '));
    // An actual record came back in each table, not merely "nothing differed".
    const cameBack = new Map(comparison.map((item) => [item.table, item]));
    const notBack = held.filter((name) => !(cameBack.get(name)?.identical >= 1) || cameBack.get(name).identical !== cameBack.get(name).inBackup);
    need(!notBack.length, 'These tables did not get their records back', notBack);
    need(cameBack.get('crm_state')?.identical === payload.stateRows.length, 'Not every settings row came back', cameBack.get('crm_state'));
    step(`an empty database was rebuilt from it: every row matches the backup, and each of the ${held.length} tables got its record back`);

    // The backup could itself be wrong, so the rebuilt database is also held
    // against the one the backup was taken from, without going through it.
    // Every table the backup holds is compared this way, each row by its own key.
    const fingerprints = async (query) => {
      const map = new Map();
      for (const table of [...backup.CORE_TABLES, ...held]) {
        const shape = await tableShape({ query }, table);
        const key = shape.key.map((name) => `${ident(name)}::text`).join(` || ':' || `);
        const where = table === 'crm_state' ? `where id = $1 or id like $1 || ':%'` : shape.columns.includes('company_state_id') ? 'where company_state_id = $1' : '';
        const rows = (await query(`select ${key} as key, md5(to_jsonb(t)::text) as hash from public.${ident(table)} t ${where}`, where ? [companyId] : [])).rows;
        rows.forEach((item) => map.set(`${table}/${item.key}`, item.hash));
      }
      return map;
    };
    const before = await fingerprints(cloud.query);
    const after = await fingerprints((text, params) => rebuilt.query(text, params));
    const unequal = [...before].filter(([key, hash]) => after.get(key) !== hash).map(([key]) => key);
    need(before.size === after.size && !unequal.length, 'The rebuilt database is not the same as the original', { original: before.size, rebuilt: after.size, unequal: unequal.slice(0, 5) });
    step(`row for row it is the same as the original database (${before.size} rows compared directly)`);

    const sourceTotals = (await cloud.query('select public.crm_ledger_totals() as totals')).rows[0].totals;
    need(Number(sourceTotals.collected) > 0, 'The test data should have payments');
    for (const name of ['payments', 'refunds', 'collected', 'expenses', 'leads', 'jobs']) need(Number(totals[name]) === Number(sourceTotals[name]), `The ${name} total changed`, { original: sourceTotals[name], rebuilt: totals[name] });
    need(Math.abs(expectedMoney.collected - Number(totals.collected)) < 0.005, 'The backup file and the database disagree about the money');
    step(`the money is the same to the cent: ${dollars(totals.collected)} collected, ${dollars(totals.expenses)} in costs`);

    // Putting one damaged record back in a working database.
    const victim = (await cloud.query(`select id, version, data from public.crm_records where company_state_id = $1 and record_type = 'estimate' and id = 'drill-estimate-1'`, [companyId])).rows[0];
    await cloud.query(`update public.crm_records set data = jsonb_set(data, '{items}', '[]'::jsonb) where company_state_id = $1 and record_type = 'estimate' and id = 'drill-estimate-1'`, [companyId]);
    const damaged = (await cloud.query(`select version from public.crm_records where company_state_id = $1 and record_type = 'estimate' and id = 'drill-estimate-1'`, [companyId])).rows[0];
    await cloud.exec(recordsSql(payload, ['estimate:drill-estimate-1'], { companyId }));
    const mended = (await cloud.query(`select version, data from public.crm_records where company_state_id = $1 and record_type = 'estimate' and id = 'drill-estimate-1'`, [companyId])).rows[0];
    need(stable(mended.data) === stable(victim.data) && mended.version === damaged.version + 1, 'The damaged estimate was not put back', mended);
    const afterwards = await fingerprints(cloud.query);
    const touched = [...new Set([...before.keys(), ...afterwards.keys()])].filter((key) => before.get(key) !== afterwards.get(key));
    need(touched.length === 2 && touched.includes(`crm_records/${companyId}:estimate:drill-estimate-1`) && touched.some((key) => key.startsWith('crm_audit_events/restore-')),
      'Putting one record back should change that record and add one line of history, and nothing else', touched.slice(0, 6));
    step('one damaged estimate was put back on its own; nothing else changed except a history line saying so');

    // The files.
    const exported = await exportBackup({ ...config, folder, includePrivateSquare: true });
    need(exported.files.some(file => file.path === `${companyId}/drill/version-only.pdf` && file.sha256 === sha256(attachment)), 'A version stored only in the versions table was omitted');
    need(payload.quotePhotoPaths.length === 1 && payload.quotePhotoPaths[0] === quotePhotoPath, 'The backup should list the photo a website quote request names', payload.quotePhotoPaths);
    const listedFiles = payload.storagePaths.length + payload.quotePhotoPaths.length;
    need(exported.files.length === listedFiles && !exported.missing.length, 'Not every file was copied out', { listed: listedFiles, copied: exported.files.length, missing: exported.missing.slice(0, 3) });
    need(exported.files.some(file => file.bucket === backup.QUOTE_PHOTO_BUCKET && file.path === quotePhotoPath && file.sha256 === sha256(quotePhoto)), 'The website quote photo was not copied out of its own bucket');
    const verified = verifyExport(exported.folder);
    need(!verified.problems.length, 'The copied files do not match their checksums', verified.problems.slice(0, 3));
    cloud.state.missingFiles.add(`${BUCKET}/${companyId}/drill/TEST contract.pdf`);
    cloud.state.missingFiles.add(`${backup.QUOTE_PHOTO_BUCKET}/${quotePhotoPath}`);
    const second = await exportBackup({ ...config, folder: path.join(folder, 'second') });
    need(second.missing.length === 2 && second.missing.includes(`${companyId}/drill/TEST contract.pdf`) && second.missing.includes(`${backup.QUOTE_PHOTO_BUCKET}/${quotePhotoPath}`), 'Files that have gone missing should be named', second.missing);
    need(verifyExport(second.folder).problems.length === 2, 'A copy with files missing should not pass its check', verifyExport(second.folder).problems);
    cloud.state.missingFiles.clear();
    step(`all ${exported.files.length} files the records point to were copied out and verified, the website quote photo among them; missing ones are named`);

    cloud.state.storage.clear();
    const returned = await uploadFiles({ ...config, folder: exported.folder });
    need(returned.sent.length === exported.files.length && !returned.failed.length, 'Not every file went back', { sent: returned.sent.length, failed: returned.failed.slice(0, 3) });
    const fetched = await fetch(objectUrl(cloud.cloudUrl, `${companyId}/drill/TEST contract.pdf`), { headers: backup.serviceHeaders(cloud.serviceKey) });
    need(fetched.ok && sha256(Buffer.from(await fetched.arrayBuffer())) === sha256(attachment), 'The attachment did not come back unchanged');
    const photoBack = await fetch(objectUrl(cloud.cloudUrl, quotePhotoPath, backup.QUOTE_PHOTO_BUCKET), { headers: backup.serviceHeaders(cloud.serviceKey) });
    need(photoBack.ok && sha256(Buffer.from(await photoBack.arrayBuffer())) === sha256(quotePhoto), 'The website quote photo did not come back unchanged, in its own bucket');
    need(!cloud.state.storage.has(`${BUCKET}/${quotePhotoPath}`), 'The website quote photo was sent to the documents bucket');
    step('the files were sent back from the copy, each to its own bucket, and are the same byte for byte');

    log(`\nPASS  ${steps.length} checks`);
    return { steps, records: row.record_count, files: exported.files.length, collected: Number(totals.collected) };
  } finally {
    try { await rebuilt?.close(); } catch { /* already closed */ }
    await cloud.stop();
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

// --------------------------------------------------------------------- CLI
function liveConfig() {
  const origin = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!origin || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY first (for example: node --env-file=.env scripts/restore-backup.js export --to <folder>).');
  return { origin, key, companyId: process.env.SUPABASE_STATE_ID || DEFAULT_COMPANY, fetch };
}

async function main(argv) {
  const [command = 'drill', ...rest] = argv;
  const option = (name) => { const at = rest.indexOf(name); return at >= 0 ? rest[at + 1] : ''; };
  if (command === 'drill') { await drill(); return 0; }
  if (command === 'check') {
    if (!rest[0]) throw new Error('Name the backup file: node scripts/restore-backup.js check <backup.json>');
    return (await check(rest[0])).problems.length ? 1 : 0;
  }
  if (command === 'records') {
    if (!rest[0]) throw new Error('Name the backup file, then the records: node scripts/restore-backup.js records <backup.json> estimate:est-123');
    process.stdout.write(recordsSql(readBackupFile(rest[0]), rest.slice(1), { companyId: process.env.SUPABASE_STATE_ID || DEFAULT_COMPANY }));
    return 0;
  }
  if (command === 'export') {
    const result = await exportBackup({ ...liveConfig(), folder: option('--to'), date: option('--date'), includePrivateSquare: rest.includes('--include-private-square'), log: console.log });
    console.log(`\nBackup of ${result.backupDate}: ${result.records} records and ${result.files.length} files copied to ${result.folder}`);
    if (result.scope === 'manager') console.log('Manager copy: raw Square records stay on the server. This is not a full disaster-recovery export.');
    if (result.missing.length) console.log(`MISSING  ${result.missing.length} files the records point to could not be copied:\n  ${result.missing.join('\n  ')}`);
    if (result.incompleteTables.length) console.log(`INCOMPLETE  the backup itself is missing ${result.incompleteTables.length} table${result.incompleteTables.length === 1 ? '' : 's'}: ${result.incompleteTables.join(', ')}`);
    return result.missing.length || result.incompleteTables.length ? 1 : 0;
  }
  if (command === 'verify-export') {
    if (!rest[0]) throw new Error('Name the exported folder (the one that holds manifest.json).');
    const result = verifyExport(rest[0]);
    console.log(result.problems.length ? `FAIL\n  ${result.problems.join('\n  ')}` : `PASS  ${result.scope === 'manager' ? 'manager copy (excludes server-only Square records)' : 'backup'} of ${result.backupDate} and its ${result.files} files are intact`);
    return result.problems.length ? 1 : 0;
  }
  throw new Error(`Unknown command "${command}". The commands are drill, check, records, export and verify-export.`);
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => { console.error(`\nFAIL  ${error.message}`); process.exit(1); });
}

module.exports = { TEST_ROW_VALUES, backupGaps, check, compareWithBackup, drill, exportBackup, filesNamedBy, ledgerTotals, seedEveryTable, localFileName, moneyInBackup, readBackupFile, recordsSql, restoreAll, restoreVerdict, tablesIn, uploadFiles, verifyExport };
