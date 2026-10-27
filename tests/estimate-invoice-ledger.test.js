const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const phaseOne = fs.readFileSync(path.join(root, 'supabase/migrations/20261027111541_perfex_foundation_phase1.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261027112852_estimate_invoice_financial_ledger.sql'), 'utf8');
const controlsMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261027113614_invoice_controls_phase2.sql'), 'utf8');
const revenueMigration = fs.readFileSync(path.join(root, 'supabase/migrations/20261027114326_revenue_controls_complete.sql'), 'utf8');

test('financial ledger schema is relational, fixed precision, append-only, and RLS protected', () => {
  for (const table of ['crm_invoices', 'crm_invoice_items', 'crm_payments', 'crm_payment_allocations', 'crm_expenses', 'crm_credit_notes']) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  }
  assert.match(migration, /numeric\(14,2\)/);
  assert.match(migration, /alter table public\.%I enable row level security/);
  assert.match(migration, /grant select, insert, update on table public\.%I to authenticated/);
  assert.match(migration, /revoke update on public\.crm_payments, public\.crm_payment_allocations/);
  assert.match(migration, /crm_create_invoice_from_estimate/);
  assert.match(migration, /coalesce\(estimate_row\.data->>'status',''\) <> 'Won'/);
  assert.match(migration, /coalesce\(job_row\.data->>'status',''\) <> 'Won'/);
});

test('financial migration executes, is repeatable, and creates all protected tables', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as
        $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
      create table public.crm_records (
        company_state_id text not null,
        record_type text not null,
        id text not null,
        lead_id text not null default '',
        job_id text not null default '',
        owner_id uuid,
        data jsonb not null default '{}'::jsonb,
        deleted_at timestamptz
      );
      create function public.crm_base_state_id() returns text language sql stable set search_path='' as
        $$ select 'coastal-crest' $$;
      create function public.is_coastal_crest_user() returns boolean language sql stable set search_path='' as
        $$ select true $$;
      create function public.can_manage_team_crm() returns boolean language sql stable set search_path='' as
        $$ select true $$;
      create function public.is_crm_admin() returns boolean language sql stable set search_path='' as
        $$ select true $$;
    `);
    await db.exec(phaseOne);
    await db.exec(migration);
    await db.exec(migration);
    await db.exec(controlsMigration);
    await db.exec(controlsMigration);
    await db.exec(revenueMigration);
    await db.exec(revenueMigration);
    const tables = await db.query(`
      select count(*)::int as count from pg_tables
      where schemaname='public' and tablename = any($1)
    `, [[
      'crm_invoices', 'crm_invoice_items', 'crm_payments',
      'crm_payment_allocations', 'crm_expenses', 'crm_credit_notes',
      'crm_refunds', 'crm_invoice_schedules', 'crm_billing_notices',
    ]]);
    assert.equal(tables.rows[0].count, 9);
    const rls = await db.query(`
      select count(*)::int as count from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relrowsecurity and c.relname = any($1)
    `, [[
      'crm_invoices', 'crm_invoice_items', 'crm_payments',
      'crm_payment_allocations', 'crm_expenses', 'crm_credit_notes',
      'crm_refunds', 'crm_invoice_schedules', 'crm_billing_notices',
    ]]);
    assert.equal(rls.rows[0].count, 9);

    await db.exec(`
      insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,owner_id,data)
      values
        ('coastal-crest','estimate','estimate_qa','lead_qa','job_qa','00000000-0000-4000-8000-000000000001','{"status":"Won","ownerEmail":"qa@example.invalid","ownerName":"QA"}'),
        ('coastal-crest','job','job_qa','lead_qa','job_qa','00000000-0000-4000-8000-000000000001','{"status":"Estimate Sent"}');
    `);
    const invoice = {
      id: 'invoice_qa', invoice_number: 'INV-QA', lead_id: 'lead_qa', job_id: 'job_qa', estimate_id: 'estimate_qa',
      subtotal: 125.5, tax_amount: 10.04, total_amount: 135.54, issue_date: '2026-10-27', due_date: '2026-11-10',
    };
    const items = [{ id: 'invoiceitem_qa', description: 'Verified line', quantity: 2, unit_price: 62.75, amount: 125.5, position: 0 }];
    await assert.rejects(
      db.query('select public.crm_create_invoice_from_estimate($1::jsonb,$2::jsonb)', [JSON.stringify(invoice), JSON.stringify(items)]),
      /won_job_required/,
    );
    await db.exec(`update public.crm_records set data='{"status":"Won"}' where record_type='job' and id='job_qa'`);
    const created = await db.query('select public.crm_create_invoice_from_estimate($1::jsonb,$2::jsonb) as result', [JSON.stringify(invoice), JSON.stringify(items)]);
    assert.equal(created.rows[0].result.invoice_number, 'INV-QA');
    const saved = await db.query(`select total_amount::text as total, status from public.crm_invoices where id='invoice_qa'`);
    assert.deepEqual(saved.rows[0], { total: '135.54', status: 'draft' });

    const payment = {
      id: 'payment_qa', allocation_id: 'allocation_qa', invoice_id: 'invoice_qa', amount: 35.54,
      method: 'Check', reference: 'CHK-100', note: 'QA payment', provider: 'manual', received_at: '2026-10-27T12:00:00Z',
    };
    const paymentResult = await db.query('select public.crm_record_invoice_payment($1::jsonb) as result', [JSON.stringify(payment)]);
    assert.equal(paymentResult.rows[0].result.outstanding, 100);
    await assert.rejects(
      db.query('select public.crm_record_invoice_payment($1::jsonb)', [JSON.stringify({ ...payment, id: 'payment_too_large', allocation_id: 'allocation_too_large', amount: 100.01 })]),
      /payment_exceeds_outstanding/,
    );
    const credit = { id: 'credit_qa', credit_number: 'CR-QA-1', invoice_id: 'invoice_qa', amount: 100, reason: 'Approved QA adjustment', issued_at: '2026-10-27' };
    const creditResult = await db.query('select public.crm_apply_credit_note($1::jsonb) as result', [JSON.stringify(credit)]);
    assert.equal(creditResult.rows[0].result.status, 'credited');
    const settled = await db.query(`
      select i.status, i.amount_paid::text as paid,
        (select count(*)::int from public.crm_payment_allocations a where a.invoice_id=i.id) as allocations,
        (select count(*)::int from public.crm_credit_notes c where c.invoice_id=i.id and c.status='applied') as credits
      from public.crm_invoices i where i.id='invoice_qa'
    `);
    assert.deepEqual(settled.rows[0], { status: 'credited', paid: '35.54', allocations: 1, credits: 1 });
    const activity = await db.query(`
      select source_type from public.crm_activity_events
      where source_id = any($1)
      order by source_type
    `, [['payment_qa', 'credit_qa']]);
    assert.deepEqual(activity.rows.map((row) => row.source_type), ['credit_note', 'payment']);

    const expenseResult = await db.query('select public.crm_record_expense($1::jsonb) as result', [JSON.stringify({
      id: 'expense_qa', lead_id: 'lead_qa', job_id: 'job_qa', category: 'Materials', vendor: 'QA Supply',
      description: 'Verified expense', amount: 12.34, expense_date: '2026-10-27', reference: 'PO-QA',
    })]);
    assert.equal(expenseResult.rows[0].result.amount, 12.34);
    const refundResult = await db.query('select public.crm_record_refund($1::jsonb) as result', [JSON.stringify({
      id: 'refund_qa', payment_id: 'payment_qa', amount: 5, reason: 'QA refund', provider: 'manual', refunded_at: '2026-10-27T13:00:00Z',
    })]);
    assert.equal(refundResult.rows[0].result.amount_paid, 30.54);
    await assert.rejects(
      db.query('select public.crm_record_refund($1::jsonb)', [JSON.stringify({ id: 'refund_too_large', payment_id: 'payment_qa', amount: 31, reason: 'Too much', refunded_at: '2026-10-27T13:00:00Z' })]),
      /refund_exceeds_payment/,
    );
    const finalCredit = { id: 'credit_qa_2', credit_number: 'CR-QA-2', invoice_id: 'invoice_qa', amount: 5, reason: 'Final QA adjustment', issued_at: '2026-10-27' };
    const finalCreditResult = await db.query('select public.crm_apply_credit_note($1::jsonb) as result', [JSON.stringify(finalCredit)]);
    assert.equal(finalCreditResult.rows[0].result.status, 'credited');

    await db.query('select public.crm_save_invoice_schedule($1::jsonb)', [JSON.stringify({
      id: 'schedule_qa', template_invoice_id: 'invoice_qa', cadence: 'monthly', next_issue_date: '2026-10-01', due_days: 14, remaining_count: 2,
    })]);
    const recurring = await db.query("select public.crm_generate_due_recurring_invoices('2026-10-27') as count");
    assert.equal(recurring.rows[0].count, 1);
    const recurringAgain = await db.query("select public.crm_generate_due_recurring_invoices('2026-10-27') as count");
    assert.equal(recurringAgain.rows[0].count, 0);
    await db.exec("update public.crm_invoices set status='sent' where id='rec_schedule_qa_20261001'");
    const notices = await db.query("select public.crm_enqueue_due_notices('2026-10-27') as count");
    assert.equal(notices.rows[0].count, 1);
    const noticeRows = await db.query("select status,notice_type from public.crm_billing_notices where invoice_id='rec_schedule_qa_20261001'");
    assert.deepEqual(noticeRows.rows[0], { status: 'queued', notice_type: 'overdue' });
  } finally {
    await db.close();
  }
});

test('won estimates can be converted without replacing the Square flow', () => {
  assert.match(app, /function createInternalInvoiceFromEstimate/);
  assert.match(app, /estimate\.status !== "Won"/);
  assert.match(app, /job\.status !== "Won"/);
  assert.match(app, /crm_create_invoice_from_estimate/);
  assert.match(app, /data-create-invoice/);
  assert.match(app, /data-square-send/);
  assert.match(app, /function initializeFinancialLedger/);
});

test('billing view presents a unified financial ledger and remains responsive', () => {
  assert.match(page, /Invoices &amp; financial ledger/);
  assert.match(app, /function financialLedgerEntries/);
  assert.match(app, /Gross cash margin/);
  assert.match(app, /Job costs recorded under Profit & Cost will appear here/);
  assert.match(styles, /\.financial-ledger-row/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(page, /id="invoicePaymentDialog"/);
  assert.match(page, /id="invoiceCreditDialog"/);
  assert.match(app, /function invoiceAging/);
  assert.match(app, /function recordInvoicePayment/);
  assert.match(app, /function applyInvoiceCredit/);
  assert.match(app, /Invoice payment recorded/);
  assert.match(app, /Invoice credit applied/);
  assert.match(app, /data-finance-tab/);
  assert.match(controlsMigration, /crm_record_invoice_payment/);
  assert.match(controlsMigration, /crm_apply_credit_note/);
  assert.match(controlsMigration, /insert into public\.crm_activity_events/);
  assert.match(revenueMigration, /crm_record_expense/);
  assert.match(revenueMigration, /crm_record_refund/);
  assert.match(revenueMigration, /crm_generate_due_recurring_invoices/);
  assert.match(revenueMigration, /crm_enqueue_due_notices/);
  assert.match(page, /id="financeExpenseDialog"/);
  assert.match(page, /id="invoiceRefundDialog"/);
  assert.match(page, /id="invoiceScheduleDialog"/);
  assert.match(app, /function runRevenueAutomation/);
});
