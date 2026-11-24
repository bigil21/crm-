// Collected revenue worked out once, by the database (to-do item 5).
// The database function is run for real in an in-memory PostgreSQL and its
// answer is compared with the browser's own ledger over the same records.
// Nothing here touches a network or a real database.
//
// crm_ledger_totals() has since been rewritten to add payments up from the
// payments table (to-do item 6). tests/payments-one-home-database.test.js
// tests that version on the full schema, and proves it gives the same figures
// as the one here. This file still covers: the first version agreeing with the
// browser, crm_money, and the browser's rules for using the database's figure.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const app = read('app.js');
const migration = read('supabase/migrations/20261122210000_ledger_totals_from_database.sql');

function functions(names, globals = {}) {
  const context = vm.createContext({ console, ...globals });
  for (const name of names) {
    const declared = app.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    const constant = declared ? null : (app.match(new RegExp(`^const ${name} = [^\\n]*;$`, 'm')) ||
      app.match(new RegExp(`^const ${name} = [^]*?^[}\\]]\\)?;$`, 'm')));
    assert.ok(declared || constant, `${name} exists in app.js`);
    vm.runInContext(declared ? declared[0] : constant[0].replace(/^const /, 'var '), context);
  }
  return context;
}

// ---- One set of made-up records, given to both sides ------------------------
const leads = [
  { id: 'lead-a', data: { name: 'TEST A' } },
  { id: 'lead-b', data: { name: 'TEST B' } },
  { id: 'lead-archived', data: { name: 'TEST archived', archived: true } },
  { id: 'lead-deleted', data: { name: 'TEST deleted' }, deleted: true },
];
const jobs = [
  { id: 'job-a1', lead: 'lead-a', data: {
    manualPayments: [{ id: 'pay-1', amount: 1500 }, { id: 'pay-2', amount: '$2,250.75' }, { id: 'pay-in-table', amount: 400 }, { amount: 99.5 }],
    squarePaidAmount: 300, costItems: [{ id: 'cost-1', amount: 600 }, { id: 'expense-in-table', amount: 50 }] } },
  { id: 'job-a2', lead: 'lead-a', data: { manualPayments: [{ id: 'pay-3', amount: 'not a number' }], squarePaidAmount: 0 } },
  { id: 'job-b1', lead: 'lead-b', data: { manualPayments: [{ id: 'pay-4', amount: 10000.1 }], squarePaidAmount: '1,000', costItems: [{ id: 'cost-2', amount: '75.25' }] } },
  { id: 'job-archived', lead: 'lead-archived', data: { manualPayments: [{ id: 'pay-5', amount: 7777 }], squarePaidAmount: 500, costItems: [{ id: 'cost-3', amount: 10 }] } },
  { id: 'job-of-deleted-lead', lead: 'lead-deleted', data: { manualPayments: [{ id: 'pay-6', amount: 8888 }] } },
  { id: 'job-deleted', lead: 'lead-a', deleted: true, data: { manualPayments: [{ id: 'pay-7', amount: 9999 }] } },
  { id: 'job-orphan', lead: 'no-such-lead', data: { manualPayments: [{ id: 'pay-8', amount: 4444 }] } },
];
const payments = [{ id: 'pay-in-table', lead: 'lead-a', job: 'job-a1', amount: 400 }, { id: 'pay-invoice', lead: 'lead-b', job: 'job-b1', amount: 250.25 }];
const expenses = [{ id: 'expense-in-table', lead: 'lead-a', job: 'job-a1', amount: 50 }, { id: 'expense-2', lead: 'lead-b', job: 'job-b1', amount: 120 }];
const refunds = [{ id: 'refund-1', lead: 'lead-b', job: 'job-b1', amount: 100 }];
const credits = [{ id: 'credit-1', lead: 'lead-b', job: 'job-b1', amount: 20 }];

// What the browser's own ledger makes of them.
function browserTotals({ refundRows = refunds } = {}) {
  const liveLeads = leads.filter((lead) => !lead.deleted);
  const state = {
    contacts: liveLeads.map((lead) => ({ id: lead.id, ...lead.data, jobs: jobs.filter((job) => job.lead === lead.id && !job.deleted).map((job) => ({ id: job.id, ...job.data })) })),
    invoices: [],
    financialPayments: payments.map((row) => ({ id: row.id, contactId: row.lead, jobId: row.job, amount: row.amount })),
    financialExpenses: expenses.map((row) => ({ id: row.id, contactId: row.lead, jobId: row.job, amount: row.amount })),
    financialRefunds: refundRows.map((row) => ({ id: row.id, contactId: row.lead, jobId: row.job, amount: row.amount })),
    creditNotes: credits.map((row) => ({ id: row.id, contactId: row.lead, jobId: row.job, amount: row.amount })),
  };
  const context = functions(['number', 'isInvoicePaymentRow', 'financialLedgerEntries', 'ledgerTotals'], {
    state,
    visibleContacts: () => state.contacts.filter((contact) => !contact.archived),
    contactJobs: (contact) => contact.jobs,
    activityTimestamp: () => 0,
  });
  return JSON.parse(JSON.stringify(context.ledgerTotals()));
}

async function database({ refundRows = refunds } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create function public.crm_base_state_id() returns text language sql stable as $$ select 'co' $$;
    create table public.crm_records(company_state_id text not null, record_type text not null, id text not null, lead_id text, owner_id text,
      data jsonb not null default '{}'::jsonb, deleted_at timestamptz, primary key(company_state_id, record_type, id));
    create table public.crm_payments(company_state_id text not null, id text not null, lead_id text, job_id text, amount numeric(14,2) not null);
    create table public.crm_expenses(company_state_id text not null, id text not null, lead_id text, job_id text, amount numeric(14,2) not null);
    create table public.crm_refunds(company_state_id text not null, id text not null, lead_id text, job_id text, amount numeric(14,2) not null);
    create table public.crm_credit_notes(company_state_id text not null, id text not null, lead_id text, job_id text, amount numeric(14,2) not null);
    grant usage on schema public to authenticated;
    grant select on all tables in schema public to authenticated;
    grant execute on function public.crm_base_state_id() to authenticated;
  `);
  await db.exec(migration);
  for (const lead of leads) {
    await db.query("insert into public.crm_records values('co','contact',$1,$1,$2,$3,$4)", [lead.id, lead.owner || 'rep-1', JSON.stringify(lead.data), lead.deleted ? new Date().toISOString() : null]);
  }
  for (const job of jobs) {
    await db.query("insert into public.crm_records values('co','job',$1,$2,$3,$4,$5)", [job.id, job.lead, 'rep-1', JSON.stringify(job.data), job.deleted ? new Date().toISOString() : null]);
  }
  // Another company's records in the same tables are never counted.
  await db.query("insert into public.crm_records values('other-co','contact','x','x','rep-9','{}',null), ('other-co','job','xj','x','rep-9','{\"manualPayments\":[{\"id\":\"p\",\"amount\":123456}]}',null)");
  await db.query("insert into public.crm_payments values('other-co','p2','x','xj',55555)");
  for (const [table, rows] of [['crm_payments', payments], ['crm_expenses', expenses], ['crm_refunds', refundRows], ['crm_credit_notes', credits]]) {
    for (const row of rows) await db.query(`insert into public.${table} values('co',$1,$2,$3,$4)`, [row.id, row.lead, row.job, row.amount]);
  }
  return db;
}

const totalsFrom = async (db) => (await db.query('select public.crm_ledger_totals() as totals')).rows[0].totals;

test('to-do 5: the database and the browser add the same records up to the same figures', async () => {
  const db = await database();
  try {
    const server = await totalsFrom(db);
    const browser = browserTotals();
    // By hand: 400 + 250.25 in the payments table; on jobs 1500 + 2250.75 + 99.5 + 0 + 10000.1 (the one
    // also in the table is not counted twice); Square 300 + 1000.
    assert.equal(Number(server.payments), 15800.6);
    assert.equal(Number(server.refunds), 100);
    assert.equal(Number(server.collected), 15700.6);
    // 50 + 120 in the expenses table; on jobs 600 + 75.25.
    assert.equal(Number(server.expenses), 845.25);
    assert.equal(Number(server.credits), 20);
    for (const key of ['payments', 'refunds', 'collected', 'expenses', 'credits']) {
      assert.ok(Math.abs(Number(server[key]) - browser[key]) < 0.005, `${key}: database ${server[key]} · browser ${browser[key]}`);
    }
    // Archived, deleted and lead-less records are left out by both.
    assert.equal(Number(server.leads), 2);
    assert.equal(Number(server.jobs), 3);
    // The app's own comparison agrees.
    const { ledgerFiguresAgree } = functions(['number', 'ledgerFiguresAgree']);
    assert.equal(ledgerFiguresAgree(browser, server), true);
    assert.equal(ledgerFiguresAgree({ ...browser, collected: browser.collected + 0.01 }, server), false);
  } finally { await db.close(); }
});

test('to-do 5: collected never goes below zero, on either side', async () => {
  const bigRefund = [{ id: 'refund-big', lead: 'lead-b', job: 'job-b1', amount: 999999 }];
  const db = await database({ refundRows: bigRefund });
  try {
    const server = await totalsFrom(db);
    assert.equal(Number(server.collected), 0);
    assert.equal(browserTotals({ refundRows: bigRefund }).collected, 0);
  } finally { await db.close(); }
});

test('to-do 5: amounts are read the way the browser reads them', async () => {
  const db = await database();
  try {
    const { number } = functions(['number']);
    for (const value of ['1500', '$2,250.75', ' 1,000 ', '12.', '.5', '-40', '1e3', '15%', '', 'abc', '1.2.3', '12abc']) {
      const server = Number((await db.query('select public.crm_money($1) as amount', [value])).rows[0].amount);
      assert.equal(server, number(value), JSON.stringify(value));
    }
    assert.equal(Number((await db.query('select public.crm_money(null) as amount')).rows[0].amount), 0);
    // A record whose payment or cost list is not a list is skipped, not an error.
    const before = await totalsFrom(db);
    await db.query(`insert into public.crm_records values('co','job','job-odd','lead-a','rep-1','{"manualPayments":"oops","costItems":{"a":1},"squarePaidAmount":"n/a"}',null)`);
    const after = await totalsFrom(db);
    assert.equal(Number(after.collected), Number(before.collected));
    assert.equal(Number(after.expenses), Number(before.expenses));
  } finally { await db.close(); }
});

test('to-do 5: each user gets totals for the records they are allowed to see', async () => {
  const db = await database();
  try {
    // A second rep owns lead B; row-level security shows each rep only their own.
    await db.exec(`
      update public.crm_records set owner_id = 'rep-2' where id in ('lead-b','job-b1');
      alter table public.crm_records enable row level security;
      create policy own_rows on public.crm_records for select to authenticated using (owner_id = current_setting('test.user', true));
    `);
    const as = async (user) => db.transaction(async (tx) => {
      await tx.query("select set_config('test.user', $1, true)", [user]);
      await tx.exec('set local role authenticated');
      return (await tx.query('select public.crm_ledger_totals() as totals')).rows[0].totals;
    });
    const repOne = await as('rep-1');
    const repTwo = await as('rep-2');
    // Rep 1 sees lead A's jobs only: 1500 + 2250.75 + 99.5 on jobs, 300 Square. The payments table is not
    // restricted in this test, so its 650.25 counts for both.
    assert.equal(Number(repOne.jobPayments), 3850.25);
    assert.equal(Number(repOne.squarePayments), 300);
    assert.equal(Number(repTwo.jobPayments), 10000.1);
    assert.equal(Number(repTwo.squarePayments), 1000);
    assert.equal(Number(repOne.jobs), 2);
    assert.equal(Number(repTwo.jobs), 1);
    assert.match(migration, /function public\.crm_ledger_totals\(\)\s+returns jsonb language sql stable security invoker/);
    assert.match(migration, /revoke all on function public\.crm_ledger_totals\(\) from public, anon;\s+grant execute on function public\.crm_ledger_totals\(\) to authenticated;/);
    // Applying the migration twice is harmless.
    await db.exec(migration);
  } finally { await db.close(); }
});

// ---- The browser's rules for using the database's figure --------------------

function browser({ loaded = false, server = null, check = null, pendingSave = false, ledger = { payments: 100, refunds: 0, collected: 100, expenses: 40, credits: 0 } } = {}) {
  const storage = new Map(check ? [['jobcrest-ledger-check-v1:user-1', JSON.stringify(check)]] : []);
  const warnings = [];
  const context = functions(['number', 'SERVER_LEDGER_CHECK_KEY', 'SERVER_LEDGER_CHECK_MAX_AGE', 'normalizeServerLedgerTotals', 'refreshServerLedgerTotals', 'serverLedgerCheckKey',
    'readServerLedgerCheck', 'serverLedgerIsTrusted', 'ledgerFiguresAgree', 'compareServerLedgerWithLocal', 'moneyTotalsForDisplay'], {
    console: { warn: (...args) => warnings.push(args) },
    canUseCloudSync: () => true, authSession: { user: { id: 'user-1' } },
    cloudClient: { rpc: async (name) => (name === 'crm_ledger_totals' && server ? { data: server, error: null } : { data: null, error: { message: 'function not found' } }) },
    coreRecordsArePartial: () => !loaded, financialLedgerReady: true, durableSaveInFlight: false, hasPendingDurableChanges: () => pendingSave, localEditRevision: 1,
    ledgerTotals: () => ledger,
    window: { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } },
    serverLedgerTotals: null, serverLedgerTotalsLoad: null,
  });
  return { context, storage, warnings };
}

test('to-do 5: the database figure is shown early only after it has matched this browser once', async () => {
  const server = { payments: 100, refunds: 0, collected: 100, expenses: 40, credits: 0 };
  // First visit: the figure has arrived but has never been checked here, so the screens still wait.
  const first = browser({ server });
  await first.context.refreshServerLedgerTotals();
  assert.equal(first.context.moneyTotalsForDisplay().ready, false);
  // Everything loads, the two agree, and the result is remembered.
  const loaded = browser({ loaded: true, server });
  assert.equal(await loaded.context.compareServerLedgerWithLocal(), true);
  const remembered = JSON.parse(loaded.storage.get('jobcrest-ledger-check-v1:user-1'));
  assert.equal(remembered.matched, true);
  assert.equal(loaded.context.moneyTotalsForDisplay().source, 'local', 'once loaded, the browser\'s own ledger is what is shown');
  // Next visit: the checked figure is shown at once, before the records finish loading.
  const next = browser({ server, check: remembered });
  await next.context.refreshServerLedgerTotals();
  const early = next.context.moneyTotalsForDisplay();
  assert.deepEqual({ ready: early.ready, source: early.source, collected: early.collected, expenses: early.expenses }, { ready: true, source: 'server', collected: 100, expenses: 40 });
  // A check older than a month no longer counts.
  const stale = browser({ server, check: { ...remembered, checkedAt: Date.now() - 31 * 86400000 } });
  await stale.context.refreshServerLedgerTotals();
  assert.equal(stale.context.moneyTotalsForDisplay().ready, false);
  // Another user on the same computer starts from scratch.
  assert.equal(JSON.parse(loaded.storage.get('jobcrest-ledger-check-v1:user-2') || 'null'), null);
});

test('to-do 5: a disagreement is recorded and the database figure is not used', async () => {
  const disagree = browser({ loaded: true, server: { payments: 90, refunds: 0, collected: 90, expenses: 40, credits: 0 } });
  assert.equal(await disagree.context.compareServerLedgerWithLocal(), false);
  assert.equal(disagree.warnings.length, 1);
  const remembered = JSON.parse(disagree.storage.get('jobcrest-ledger-check-v1:user-1'));
  assert.equal(remembered.matched, false);
  const next = browser({ server: { payments: 90, refunds: 0, collected: 90, expenses: 40, credits: 0 }, check: remembered });
  await next.context.refreshServerLedgerTotals();
  assert.equal(next.context.moneyTotalsForDisplay().ready, false, 'the screens go back to waiting for the full load');
});

test('to-do 5: nothing is compared or shown when the answer cannot be relied on', async () => {
  // The function is not installed yet (code deployed before the migration): the app behaves as before.
  const missing = browser({ loaded: true, server: null });
  assert.equal(await missing.context.compareServerLedgerWithLocal(), undefined, 'no answer: nothing to try again for');
  assert.equal(missing.storage.size, 0);
  assert.equal(missing.warnings.length, 1, 'noted in the console, nothing shown to the user');
  // A save is in progress: the two sides may differ for a moment, so no verdict.
  const saving = browser({ loaded: true, pendingSave: true, server: { payments: 1, refunds: 0, collected: 1, expenses: 0 } });
  assert.equal(await saving.context.compareServerLedgerWithLocal(), null);
  assert.equal(saving.storage.size, 0);
  // Records still loading: no verdict either.
  const partial = browser({ loaded: false, server: { payments: 1, refunds: 0, collected: 1, expenses: 0 } });
  assert.equal(await partial.context.compareServerLedgerWithLocal(), null);
  // A malformed answer is ignored.
  const { normalizeServerLedgerTotals } = functions(['number', 'normalizeServerLedgerTotals']);
  assert.equal(normalizeServerLedgerTotals({ payments: 1 }), null);
  assert.equal(normalizeServerLedgerTotals(null), null);
  // A check that lands during a save is tried again; one with no answer is not.
  const timers = [];
  const retry = functions(['scheduleServerLedgerCheck'], {
    serverLedgerCheckAttempts: 0, coreRecordsArePartial: () => false,
    compareServerLedgerWithLocal: async () => null, window: { setTimeout: (run, ms) => timers.push(ms) },
  });
  retry.scheduleServerLedgerCheck();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(timers, [5000]);
  const noAnswer = functions(['scheduleServerLedgerCheck'], {
    serverLedgerCheckAttempts: 0, coreRecordsArePartial: () => false,
    compareServerLedgerWithLocal: async () => undefined, window: { setTimeout: (run, ms) => timers.push(ms) },
  });
  noAnswer.scheduleServerLedgerCheck();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(timers, [5000], 'no second timer');
  // Where it is wired in.
  assert.match(app.match(/^async function ensureCompleteCoreRecordsLoaded\(\) \{[^]*?^}/m)[0], /scheduleServerLedgerCheck\(\);/);
  assert.match(app.match(/^async function initializeRecordPages\(\) \{[^]*?^}/m)[0], /refreshServerLedgerTotals\(\),/);
});
