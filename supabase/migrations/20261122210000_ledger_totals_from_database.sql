-- One collected-revenue figure, worked out by the database.
--
-- The Dashboard, Billing and Reports add up money in the browser, which only
-- works once every lead and job has been downloaded. This function returns the
-- same totals straight from the database, so the right number can be shown
-- without waiting, and so there is one figure to check the browser against.
--
-- It follows the browser's ledger (financialLedgerEntries in app.js) exactly:
--   payments  = every row in crm_payments
--             + payments recorded on a job that are not also in crm_payments
--             + confirmed Square payments on a job
--   refunds   = every row in crm_refunds
--   collected = payments - refunds, never below zero
--   expenses  = every row in crm_expenses
--             + costs recorded on a job that are not also in crm_expenses
-- Jobs count only when their lead exists, is not deleted and is not archived.
--
-- security invoker: the caller's own row-level security applies, so each user
-- gets totals for the records they are allowed to see and no others.

begin;

-- Reads an amount the way the browser's number() does: "$1,200.50" is 1200.50
-- and anything that is not a number is 0.
create or replace function public.crm_money(p_value text)
returns numeric language sql immutable set search_path=''
as $$
  select case
    when cleaned ~ '^[+-]?([0-9]+([.][0-9]*)?|[.][0-9]+)([eE][+-]?[0-9]+)?$' then cleaned::numeric
    else 0 end
  from (select regexp_replace(coalesce(p_value,''), '[$,%[:space:]]', '', 'g') as cleaned) s;
$$;
revoke all on function public.crm_money(text) from public, anon;
grant execute on function public.crm_money(text) to authenticated, service_role;

create or replace function public.crm_ledger_totals()
returns jsonb language sql stable security invoker set search_path=''
as $$
  with company as (select public.crm_base_state_id() as id),
  leads as (
    select c.id from public.crm_records c, company
    where c.company_state_id = company.id and c.record_type = 'contact' and c.deleted_at is null
      and coalesce(c.data->>'archived','') <> 'true'
  ),
  jobs as (
    select j.id, j.data from public.crm_records j join leads l on l.id = j.lead_id, company
    where j.company_state_id = company.id and j.record_type = 'job' and j.deleted_at is null
  ),
  payment_rows as (select p.id, p.amount from public.crm_payments p, company where p.company_state_id = company.id),
  expense_rows as (select e.id, e.amount from public.crm_expenses e, company where e.company_state_id = company.id),
  job_payments as (
    select public.crm_money(p.value->>'amount') as amount
    from jobs j, jsonb_array_elements(case when jsonb_typeof(j.data->'manualPayments') = 'array' then j.data->'manualPayments' else '[]'::jsonb end) p(value)
    where not exists (select 1 from payment_rows r where r.id = p.value->>'id')
  ),
  square_payments as (
    select public.crm_money(j.data->>'squarePaidAmount') as amount from jobs j
  ),
  job_costs as (
    select public.crm_money(c.value->>'amount') as amount
    from jobs j, jsonb_array_elements(case when jsonb_typeof(j.data->'costItems') = 'array' then j.data->'costItems' else '[]'::jsonb end) c(value)
    where not exists (select 1 from expense_rows r where r.id = c.value->>'id')
  ),
  totals as (
    select
      (select coalesce(sum(amount), 0) from payment_rows) as invoice_payments,
      (select coalesce(sum(amount), 0) from job_payments) as job_payments,
      (select coalesce(sum(amount), 0) from square_payments where amount > 0) as square_payments,
      (select coalesce(sum(r.amount), 0) from public.crm_refunds r, company where r.company_state_id = company.id) as refunds,
      (select coalesce(sum(amount), 0) from expense_rows) as recorded_expenses,
      (select coalesce(sum(amount), 0) from job_costs) as job_costs,
      (select coalesce(sum(n.amount), 0) from public.crm_credit_notes n, company where n.company_state_id = company.id) as credits
  )
  select jsonb_build_object(
    'payments', invoice_payments + job_payments + square_payments,
    'refunds', refunds,
    'collected', greatest(invoice_payments + job_payments + square_payments - refunds, 0),
    'expenses', recorded_expenses + job_costs,
    'credits', credits,
    'invoicePayments', invoice_payments,
    'jobPayments', job_payments,
    'squarePayments', square_payments,
    'leads', (select count(*) from leads),
    'jobs', (select count(*) from jobs),
    'computedAt', clock_timestamp()
  ) from totals;
$$;
revoke all on function public.crm_ledger_totals() from public, anon;
grant execute on function public.crm_ledger_totals() to authenticated;

commit;
