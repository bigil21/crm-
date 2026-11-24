// Payments get one home: the payments table (to-do item 6, part 1).
// The database files a row in crm_payments for every payment recorded on a
// job, in the same save as the job. Everything here runs the repo's real
// schema, migrations and save function in an in-memory PostgreSQL; nothing
// touches a network or a real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createEmptyDatabase } = require('../scripts/local-cloud.js');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.js');
const migration = read('supabase/migrations/20261122230000_payments_one_home.sql');
const earlierTotals = read('supabase/migrations/20261122210000_ledger_totals_from_database.sql');

const CO = 'coastal-crest';
const ADMIN = { sub: '11111111-1111-4111-8111-111111111111', email: 'local-admin@coastalcrestroofing.com' };
const REP = { sub: '22222222-2222-4222-8222-222222222222', email: 'local-rep@coastalcrestroofing.com' };

// ---- helpers ----------------------------------------------------------------
const as = (db, user, work) => db.transaction(async (tx) => {
  await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ ...user, role: 'authenticated' })]);
  await tx.exec('set local role authenticated');
  return work(tx);
});
const put = (db, type, id, lead, data, { owner = REP.sub, deleted = false } = {}) => db.query(
  `insert into public.crm_records(company_state_id, record_type, id, lead_id, job_id, owner_id, updated_by, data, version, deleted_at)
   values($1, $2, $3, $4, $5, $6, $6, $7, 1, $8)`,
  [CO, type, id, lead, type === 'job' ? id : null, owner, JSON.stringify(data), deleted ? new Date().toISOString() : null]);
// Without the database's triggers: how records looked before this migration.
const quietly = async (db, work) => {
  await db.exec('set session_replication_role = replica');
  try { return await work(); } finally { await db.exec('set session_replication_role = origin'); }
};
const rows = async (db, where = 'true') => (await db.query(
  `select id, lead_id, job_id, amount::float8 as amount, method, reference, note, provider, origin, received_at, created_by, updated_at
   from public.crm_payments where company_state_id = $1 and ${where} order by id`, [CO])).rows;
const totals = async (db, user = null) => {
  const ask = (runner) => runner.query('select public.crm_ledger_totals() as totals').then((result) => result.rows[0].totals);
  return user ? as(db, user, ask) : ask(db);
};
const proof = async (db, user = null) => {
  const ask = (runner) => runner.query('select public.crm_payments_reconciliation() as proof').then((result) => result.rows[0].proof);
  return user ? as(db, user, ask) : ask(db);
};
let requests = 0;
// The CRM's own save, as the browser calls it.
async function save(db, user, jobId, lead, data, version) {
  requests += 1;
  const change = { company_state_id: CO, record_type: 'job', id: jobId, lead_id: lead, job_id: jobId, data, expected_version: version, operation: 'upsert' };
  return as(db, user, (tx) => tx.query('select public.crm_commit_records($1, $2::jsonb, $3::jsonb) as result', [`test-request-${requests}`, JSON.stringify([change]), '[]']));
}
const job = (payments, more = {}) => {
  const paid = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  return { name: 'TEST Roof job', status: 'Won', division: 'roofing', value: 20000, contractValue: 20000, squarePaidAmount: 0,
    manualPayments: payments, paidAmount: paid, paymentPercent: Math.min(100, paid * 100 / 20000), ...more };
};
const payment = (id, amount, more = {}) => ({ id, amount, date: '2026-11-03', method: 'Check', reference: '', note: '', createdAt: '2026-11-03T15:00:00.000Z', createdBy: 'Local Admin', ...more });

async function oneLead() {
  const db = await createEmptyDatabase({ quiet: true });
  await put(db, 'contact', 'lead-1', 'lead-1', { name: 'TEST Lead' });
  await put(db, 'job', 'job-1', 'lead-1', job([]));
  await put(db, 'job', 'job-2', 'lead-1', job([payment('pay-other', 750)]));
  return db;
}

// ---- recording, changing and removing a payment -----------------------------
test('a payment recorded on a job is in the payments table in the same save', async () => {
  const db = await oneLead();
  try {
    await save(db, ADMIN, 'job-1', 'lead-1', job([payment('pay-1', 1500.5, { reference: 'CHK-1041', note: 'Deposit' })]), 1);
    const [row] = await rows(db, "job_id = 'job-1'");
    assert.deepEqual({ ...row, received_at: row.received_at.toISOString(), updated_at: null }, {
      id: 'pay-1', lead_id: 'lead-1', job_id: 'job-1', amount: 1500.5, method: 'Check', reference: 'CHK-1041', note: 'Deposit',
      provider: 'manual', origin: 'job', received_at: '2026-11-03T17:00:00.000Z', created_by: ADMIN.sub, updated_at: null,
    });
    // The day it was received is the same day anywhere in the United States.
    for (const zone of ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Pacific/Honolulu']) {
      assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(row.received_at), '2026-11-03', zone);
    }
    assert.equal((await proof(db)).matched, true);
  } finally { await db.close(); }
});

test('changing a payment changes its row, removing it removes the row, and no other job is touched', async () => {
  const db = await oneLead();
  try {
    await save(db, ADMIN, 'job-1', 'lead-1', job([payment('pay-1', 1500), payment('pay-2', 200)]), 1);
    const other = (await rows(db, "id = 'pay-other'"))[0];
    await save(db, ADMIN, 'job-1', 'lead-1', job([payment('pay-1', 1650.25, { method: 'ACH / Bank Transfer', date: '2026-11-05' }), payment('pay-2', 200)]), 2);
    let mine = await rows(db, "job_id = 'job-1'");
    assert.deepEqual(mine.map((row) => [row.id, row.amount, row.method, row.received_at.toISOString().slice(0, 10)]),
      [['pay-1', 1650.25, 'ACH / Bank Transfer', '2026-11-05'], ['pay-2', 200, 'Check', '2026-11-03']]);
    await save(db, ADMIN, 'job-1', 'lead-1', job([payment('pay-2', 200)]), 3);
    mine = await rows(db, "job_id = 'job-1'");
    assert.deepEqual(mine.map((row) => row.id), ['pay-2']);
    assert.deepEqual((await rows(db, "id = 'pay-other'"))[0], other, 'the other job\'s row is exactly as it was');
    assert.equal((await proof(db)).matched, true);
  } finally { await db.close(); }
});

test('a save that is refused leaves nothing in the table', async () => {
  const db = await oneLead();
  try {
    // A rep may not record a payment at all.
    await assert.rejects(save(db, REP, 'job-1', 'lead-1', job([payment('pay-rep', 500)]), 1), /admin_required_for_payments/);
    // An admin's payment that the save rules refuse (three decimal places).
    await assert.rejects(save(db, ADMIN, 'job-1', 'lead-1', job([payment('pay-bad', 10.005)]), 1), /invalid_or_duplicate_payment/);
    // A save from an out-of-date copy of the job.
    await assert.rejects(save(db, ADMIN, 'job-1', 'lead-1', job([payment('pay-late', 500)]), 7));
    assert.deepEqual((await rows(db)).map((row) => row.id), ['pay-other']);
  } finally { await db.close(); }
});

test('an ordinary save of a job does not touch its payment rows', async () => {
  const db = await oneLead();
  try {
    const before = (await rows(db, "id = 'pay-other'"))[0];
    await save(db, REP, 'job-2', 'lead-1', job([payment('pay-other', 750)], { notes: 'The rep changed a note.' }), 1);
    assert.deepEqual((await rows(db, "id = 'pay-other'"))[0], before);
  } finally { await db.close(); }
});

test('nobody can write a job\'s payment row by hand, and a payment\'s origin never changes', async () => {
  const db = await oneLead();
  try {
    const insert = (origin) => as(db, ADMIN, (tx) => tx.query(
      `insert into public.crm_payments(company_state_id, id, lead_id, job_id, amount, method, received_at, origin)
       values($1, $2, 'lead-1', 'job-1', 25, 'Cash', now(), $3)`, [CO, `pay-by-hand-${origin}`, origin]));
    await assert.rejects(insert('job'), /job_payments_are_written_by_the_database/);
    await assert.rejects(as(db, ADMIN, (tx) => tx.query("update public.crm_payments set amount = 1 where id = 'pay-other'")), /permission denied/);
    await assert.rejects(as(db, ADMIN, (tx) => tx.query("delete from public.crm_payments where id = 'pay-other'")), /permission denied/);
    await assert.rejects(as(db, ADMIN, (tx) => tx.query('select public.crm_sync_job_payments($1, $2)', [CO, 'job-2'])), /permission denied/);
    await assert.rejects(as(db, ADMIN, (tx) => tx.query('select public.crm_sync_all_job_payments()')), /permission denied/);
    // An invoice payment is still an admin's to record, and is still stamped with who recorded it.
    await insert('invoice');
    const byHand = (await rows(db, "id = 'pay-by-hand-invoice'"))[0];
    assert.equal(byHand.origin, 'invoice');
    assert.equal(byHand.created_by, ADMIN.sub);
    await db.exec("update public.crm_payments set origin = 'job' where id = 'pay-by-hand-invoice'");
    assert.equal((await rows(db, "id = 'pay-by-hand-invoice'"))[0].origin, 'invoice');
    assert.equal((await rows(db, "id = 'pay-other'"))[0].amount, 750);
  } finally { await db.close(); }
});

test('a deleted job has no rows, and they come back with the job', async () => {
  const db = await oneLead();
  try {
    await db.exec("update public.crm_records set deleted_at = now() where record_type = 'job' and id = 'job-2'");
    assert.deepEqual(await rows(db), []);
    await db.exec("update public.crm_records set deleted_at = null where record_type = 'job' and id = 'job-2'");
    assert.deepEqual((await rows(db)).map((row) => [row.id, row.amount]), [['pay-other', 750]]);
    // Moving a job to another lead moves its rows with it.
    await put(db, 'contact', 'lead-2', 'lead-2', { name: 'TEST Lead two' });
    await db.exec("update public.crm_records set lead_id = 'lead-2' where record_type = 'job' and id = 'job-2'");
    assert.equal((await rows(db))[0].lead_id, 'lead-2');
  } finally { await db.close(); }
});

// ---- the records that were already there ------------------------------------
// The same made-up records the collected-revenue tests use: jobs under a live
// lead, an archived lead, a deleted lead and no lead at all, a deleted job,
// amounts typed as text, a payment with no id, and one whose id an invoice
// payment already has.
async function legacyRecords() {
  const db = await createEmptyDatabase({ quiet: true });
  await quietly(db, async () => {
    await put(db, 'contact', 'lead-a', 'lead-a', { name: 'TEST A' });
    await put(db, 'contact', 'lead-b', 'lead-b', { name: 'TEST B' }, { owner: ADMIN.sub });
    await put(db, 'contact', 'lead-archived', 'lead-archived', { name: 'TEST archived', archived: true });
    await put(db, 'contact', 'lead-deleted', 'lead-deleted', { name: 'TEST deleted' }, { deleted: true });
    await put(db, 'job', 'job-a1', 'lead-a', { manualPayments: [{ id: 'pay-1', amount: 1500, date: '2026-10-31', method: 'Check' }, { id: 'pay-2', amount: '$2,250.75', date: '2026-11-01' },
      { id: 'pay-in-table', amount: 400, date: '2026-11-02' }, { amount: 99.5 }], squarePaidAmount: 300, costItems: [{ id: 'cost-1', amount: 600 }] });
    await put(db, 'job', 'job-a2', 'lead-a', { manualPayments: [{ id: 'pay-3', amount: 'not a number' }], squarePaidAmount: 0 });
    await put(db, 'job', 'job-b1', 'lead-b', { manualPayments: [{ id: 'pay-4', amount: 10000.1, date: '2026-09-15' }], squarePaidAmount: '1,000', costItems: [{ id: 'cost-2', amount: '75.25' }] }, { owner: ADMIN.sub });
    await put(db, 'job', 'job-archived', 'lead-archived', { manualPayments: [{ id: 'pay-5', amount: 7777 }], squarePaidAmount: 500 });
    await put(db, 'job', 'job-of-deleted-lead', 'lead-deleted', { manualPayments: [{ id: 'pay-6', amount: 8888 }] });
    await put(db, 'job', 'job-deleted', 'lead-a', { manualPayments: [{ id: 'pay-7', amount: 9999 }] }, { deleted: true });
    await put(db, 'job', 'job-orphan', 'no-such-lead', { manualPayments: [{ id: 'pay-8', amount: 4444 }] });
    // Payments recorded against an invoice, and a refund of one.
    for (const [id, lead, jobId, amount] of [['pay-in-table', 'lead-a', 'job-a1', 400], ['pay-invoice', 'lead-b', 'job-b1', 250.25]]) {
      await db.query(`insert into public.crm_payments(company_state_id, id, lead_id, job_id, amount, method, received_at, created_by, updated_by)
        values($1, $2, $3, $4, $5, 'Check', '2026-11-10T17:00:00Z', $6, $6)`, [CO, id, lead, jobId, amount, ADMIN.sub]);
    }
    await db.query(`insert into public.crm_refunds(company_state_id, id, payment_id, invoice_id, lead_id, job_id, amount, reason, refunded_at, created_by, updated_by)
      values($1, 'refund-1', 'pay-invoice', 'invoice-x', 'lead-b', 'job-b1', 100, 'Overpaid', now(), $2, $2)`, [CO, ADMIN.sub]);
  });
  return db;
}

// The browser's own ledger over the same records.
async function browserTotals(db) {
  const records = (await db.query("select record_type, id, lead_id, data, deleted_at from public.crm_records where company_state_id = $1", [CO])).rows;
  const table = async (name) => (await db.query(`select * from public.${name} where company_state_id = $1`, [CO])).rows;
  const context = vm.createContext({ console, uid: () => 'x' });
  for (const name of ['number', 'isInvoicePaymentRow', 'normalizeFinancialPayment', 'financialLedgerEntries', 'ledgerTotals']) {
    const declared = app.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^}`, 'm'));
    const constant = declared ? null : (app.match(new RegExp(`^const ${name} = [^\\n]*;$`, 'm')) || app.match(new RegExp(`^const ${name} = [^]*?^[}\\]]\\)?;$`, 'm')));
    assert.ok(declared || constant, `${name} exists in app.js`);
    vm.runInContext(declared ? declared[0] : constant[0].replace(/^const /, 'var '), context);
  }
  const jobs = records.filter((row) => row.record_type === 'job' && !row.deleted_at);
  const contacts = records.filter((row) => row.record_type === 'contact' && !row.deleted_at)
    .map((row) => ({ id: row.id, ...row.data, jobs: jobs.filter((item) => item.lead_id === row.id).map((item) => ({ id: item.id, ...item.data })) }));
  const flat = (row) => ({ id: row.id, contactId: row.lead_id, jobId: row.job_id, amount: Number(row.amount), origin: row.origin });
  // What the browser keeps of the payments table once it has loaded it.
  const kept = (await table('crm_payments')).filter(context.isInvoicePaymentRow).map(context.normalizeFinancialPayment);
  Object.assign(context, {
    state: { contacts, invoices: [], financialPayments: kept, financialExpenses: (await table('crm_expenses')).map(flat),
      financialRefunds: (await table('crm_refunds')).map(flat), creditNotes: (await table('crm_credit_notes')).map(flat) },
    visibleContacts: () => contacts.filter((contact) => !contact.archived), contactJobs: (contact) => contact.jobs, activityTimestamp: () => 0,
  });
  return JSON.parse(JSON.stringify(context.ledgerTotals()));
}

test('the total is the same to the cent before and after, and the browser agrees with both', async () => {
  const db = await legacyRecords();
  try {
    assert.deepEqual((await rows(db, "origin = 'job'")), [], 'no job payment is in the table yet');
    // Before: the first version of the database's total (to-do item 5).
    await db.exec(earlierTotals);
    const before = await totals(db);
    assert.equal(Number(before.collected), 15700.6);
    // After: this migration, which copies the payments in and replaces that function.
    await db.exec(migration);
    const after = await totals(db);
    for (const key of ['payments', 'refunds', 'collected', 'expenses', 'credits', 'jobPayments', 'invoicePayments', 'squarePayments', 'leads', 'jobs']) {
      assert.equal(Number(after[key]), Number(before[key]), key);
    }
    const browser = await browserTotals(db);
    for (const key of ['payments', 'refunds', 'collected', 'expenses', 'credits']) {
      assert.ok(Math.abs(Number(after[key]) - browser[key]) < 0.005, `${key}: database ${after[key]} · browser ${browser[key]}`);
    }
    // Every payment on a live job has its row: under a live lead, an archived one, a deleted one or none.
    // Not copied: the deleted job's, the one whose id an invoice payment has, and the two that are not payments.
    assert.deepEqual((await rows(db, "origin = 'job'")).map((row) => [row.id, row.job_id, row.amount]), [
      ['pay-1', 'job-a1', 1500], ['pay-2', 'job-a1', 2250.75], ['pay-4', 'job-b1', 10000.1],
      ['pay-5', 'job-archived', 7777], ['pay-6', 'job-of-deleted-lead', 8888], ['pay-8', 'job-orphan', 4444]]);
    assert.equal((await rows(db, "id = 'pay-in-table'"))[0].origin, 'invoice', 'the invoice payment is exactly as it was');
    // What is still only on a record is counted all the same, and named.
    assert.equal(Number(after.unsyncedJobPayments), 99.5);
    const check = await proof(db);
    assert.equal(check.matched, false);
    assert.deepEqual(check.differences.map((item) => [item.payment_id, item.problem]).sort(), [
      ['', 'payment_has_no_id'], ['pay-3', 'payment_is_not_an_amount_above_zero'], ['pay-in-table', 'id_used_by_another_payment']]);
    // Applying the migration again changes nothing.
    const stamped = await rows(db);
    await db.exec(migration);
    assert.deepEqual(await rows(db), stamped);
  } finally { await db.close(); }
});

test('an archived lead is left out of the totals however its money was recorded', async () => {
  const db = await legacyRecords();
  try {
    await db.exec(migration);
    const before = await totals(db);
    await quietly(db, async () => {
      await db.query(`insert into public.crm_payments(company_state_id, id, lead_id, job_id, amount, method, received_at, created_by, updated_by)
        values($1, 'pay-archived-invoice', 'lead-archived', 'job-archived', 321, 'Check', now(), $2, $2)`, [CO, ADMIN.sub]);
      await db.query(`insert into public.crm_refunds(company_state_id, id, payment_id, invoice_id, lead_id, job_id, amount, reason, refunded_at, created_by, updated_by)
        values($1, 'refund-archived', 'pay-archived-invoice', 'invoice-y', 'lead-archived', 'job-archived', 21, 'Overpaid', now(), $2, $2)`, [CO, ADMIN.sub]);
    });
    const archived = await totals(db);
    assert.equal(Number(archived.collected), Number(before.collected));
    assert.equal(Number(archived.refunds), Number(before.refunds));
    assert.ok(Math.abs((await browserTotals(db)).collected - Number(archived.collected)) < 0.005);
    // Restored, all of it counts: 7777 on the job, 500 from Square, 321 on the invoice, less the 21 refund.
    await db.exec("update public.crm_records set data = data - 'archived' where record_type = 'contact' and id = 'lead-archived'");
    const restored = await totals(db);
    assert.equal(Number(restored.collected), Math.round((Number(before.collected) + 7777 + 500 + 321 - 21) * 100) / 100);
    assert.ok(Math.abs((await browserTotals(db)).collected - Number(restored.collected)) < 0.005);
  } finally { await db.close(); }
});

test('each person gets totals for the records they may see', async () => {
  const db = await legacyRecords();
  try {
    await db.exec(migration);
    const rep = await totals(db, REP);
    const admin = await totals(db, ADMIN);
    // The rep owns lead A only: 1500 + 2250.75 in the table, 99.5 still on the record, the 400 invoice payment, 300 Square.
    assert.equal(Number(rep.payments), 4550.25);
    assert.equal(Number(rep.leads), 1);
    assert.equal(Number(admin.collected), 15700.6);
    // The proof is for managers.
    await assert.rejects(proof(db, REP), /manager_required/);
    assert.equal((await proof(db, ADMIN)).paymentsOnJobs, 9);
  } finally { await db.close(); }
});

test('the proof finds a row that is missing, wrong or left over, and the repair puts it right', async () => {
  const db = await oneLead();
  try {
    await save(db, ADMIN, 'job-1', 'lead-1', job([payment('pay-1', 1500), payment('pay-2', 200)]), 1);
    const clean = await proof(db);
    assert.deepEqual([clean.matched, clean.jobsWithPayments, clean.paymentsOnJobs, clean.rowsFromJobs, Number(clean.totalOnJobs), Number(clean.totalInTable)], [true, 2, 3, 3, 2450, 2450]);
    assert.equal(Number((await totals(db)).unsyncedJobPayments), 0);
    await quietly(db, async () => {
      await db.exec("update public.crm_payments set amount = 1499.99 where id = 'pay-1'; delete from public.crm_payments where id = 'pay-2';");
      await db.query(`insert into public.crm_payments(company_state_id, id, lead_id, job_id, amount, method, received_at, created_by, updated_by, origin)
        values($1, 'pay-left-over', 'lead-1', 'job-1', 5, 'Cash', now(), $2, $2, 'job')`, [CO, ADMIN.sub]);
    });
    const broken = await proof(db);
    assert.equal(broken.matched, false);
    assert.deepEqual(broken.differences.map((item) => [item.payment_id, item.problem]), [
      ['pay-1', 'amount_differs'], ['pay-2', 'no_row_in_the_table'], ['pay-left-over', 'row_without_a_payment_on_the_job']]);
    await db.query('select public.crm_sync_all_job_payments()');
    assert.equal((await proof(db)).matched, true);
    assert.deepEqual((await rows(db, "job_id = 'job-1'")).map((row) => [row.id, row.amount]), [['pay-1', 1500], ['pay-2', 200]]);
  } finally { await db.close(); }
});

// Found by Codex before release: two $50 payments on one job carried the same
// id. The job said $100, one $50 row reached the table, and the check still
// said "matched": it looked for a row for each payment and found one for both,
// the same row.
test('two payments on a job with the same id: no money is lost from the total, and the check does not call it a match', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    await put(db, 'contact', 'lead-1', 'lead-1', { name: 'TEST Lead' });
    // The CRM's own save refuses a repeated id, so only an older record can look like this.
    await put(db, 'job', 'job-1', 'lead-1', job([]));
    await assert.rejects(save(db, ADMIN, 'job-1', 'lead-1', job([payment('pay-twin', 50), payment('pay-twin', 50)]), 1), /invalid_or_duplicate_payment/);
    await put(db, 'job', 'job-twins', 'lead-1', { manualPayments: [payment('pay-twin', 50), payment('pay-twin', 50)], squarePaidAmount: 0 });
    assert.deepEqual((await rows(db)).map((row) => [row.id, row.job_id, row.amount]), [['pay-twin', 'job-twins', 50]], 'one id can only ever have one row');

    const check = await proof(db);
    assert.equal(check.matched, false, 'half the money is not in the table: that is not a match');
    assert.deepEqual([check.countsAgree, check.totalsAgree], [false, false]);
    assert.deepEqual([check.paymentsOnJobs, check.rowsFromJobs, Number(check.totalOnJobs), Number(check.totalInTable)], [2, 1, 100, 50]);
    assert.deepEqual(check.differences.map((item) => [item.job_id, item.payment_id, item.problem, Number(item.amount_on_record)]),
      [['job-twins', 'pay-twin', 'payment_id_used_twice_on_the_job', 50]]);

    // The second $50 is still counted, from the record, and the total says how much is counted that way.
    const figures = await totals(db);
    assert.equal(Number(figures.collected), 100);
    assert.equal(Number(figures.unsyncedJobPayments), 50);
    assert.equal((await browserTotals(db)).collected, 100, 'the browser and the database still agree');

    // Running the copy again changes nothing and does not make the check pass.
    await db.query('select public.crm_sync_all_job_payments()');
    assert.equal((await proof(db)).matched, false);
    assert.equal(Number((await totals(db)).collected), 100);
  } finally { await db.close(); }
});

test('payments the table cannot hold stay on the record, are counted from it, and are each named by the check', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    await put(db, 'contact', 'lead-1', 'lead-1', { name: 'TEST Lead' });
    await put(db, 'job', 'job-odd', 'lead-1', { squarePaidAmount: 0, manualPayments: [
      payment('pay-same', 50), payment('pay-same', 70), // the same id with two amounts: the first has the row
      payment('pay-thirds', 10.005),                    // more decimals than money has
      payment('', 20),                                  // no id
      payment('pay-zero', 0), payment('pay-good', 300),
    ] });
    assert.deepEqual((await rows(db)).map((row) => [row.id, row.amount]), [['pay-good', 300], ['pay-same', 50]]);
    const figures = await totals(db);
    assert.equal(Number(figures.payments), 450.005);
    assert.equal(Number(figures.unsyncedJobPayments), 100.005);
    assert.ok(Math.abs((await browserTotals(db)).payments - 450.005) < 0.000001);
    const check = await proof(db);
    assert.equal(check.matched, false);
    assert.deepEqual(check.differences.map((item) => [item.payment_id, item.problem]), [
      ['', 'payment_has_no_id'], ['pay-same', 'payment_id_used_twice_on_the_job'],
      ['pay-thirds', 'amount_has_more_than_two_decimals'], ['pay-zero', 'payment_is_not_an_amount_above_zero']]);
  } finally { await db.close(); }
});

test('a match needs the payments, the count and the money to agree, each asked on its own', () => {
  assert.match(migration, /'matched', f\.difference_count = 0 and f\.payments_on_jobs = f\.rows_from_jobs and f\.total_on_jobs = f\.total_in_table,/);
  // The copy, the totals and the check all take the list of payments from one place.
  for (const reader of [
    /select e\.entry, e\.payment_id, e\.amount from public\.crm_job_payment_entries\(job\.data\) e/, // the copy
    /from jobs j cross join lateral public\.crm_job_payment_entries\(j\.data\) e/,                    // the totals
    /from live_jobs j cross join lateral public\.crm_job_payment_entries\(j\.data\) e/,               // the check
  ]) assert.match(migration, reader);
  assert.equal((migration.match(/jsonb_array_elements\([^)]*manualPayments/g) || []).length, 1, 'no second reading of the list anywhere');
});

test('the migration adds to the payments table and changes no rule about who may record a payment', () => {
  assert.doesNotMatch(migration, /crm_commit_records|crm_assert_job_stage_transition|crm_square_/);
  assert.doesNotMatch(migration, /drop table|truncate|alter table public\.crm_records/i);
  assert.match(migration, /add column if not exists origin text not null default 'invoice'/);
  // The two ways into the copy are closed to signed-in users.
  assert.match(migration, /revoke all on function public\.crm_sync_job_payments\(text, text\) from public, anon, authenticated;/);
  assert.match(migration, /revoke all on function public\.crm_sync_all_job_payments\(\) from public, anon, authenticated;/);
  // The browser keeps reading a job's payments from the job, and only the other rows from the table.
  assert.match(app, /state\.financialPayments = paymentRows\.filter\(isInvoicePaymentRow\)\.map\(normalizeFinancialPayment\);/);
});
