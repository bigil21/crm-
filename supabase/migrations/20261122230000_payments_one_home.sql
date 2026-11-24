-- Payments get one home: the payments table (to-do item 6, part 1).
--
-- Until now a payment recorded on a job's Payments tab lived only inside that
-- job's record (data->'manualPayments'), and public.crm_payments held only
-- payments recorded against an invoice. Money had two homes, and every total
-- had to add the two together and take care not to count a payment twice.
--
-- From here on the database keeps a row in crm_payments for every payment
-- recorded on a job. It does this itself, in the same transaction as the save
-- of the job, so no browser - old or new - can record a payment that is not in
-- the table, or leave one in the table that was removed from the job.
--
--   1. crm_payments.origin says where a row came from: 'invoice' (recorded
--      against an invoice, as before) or 'job' (recorded on a job).
--   2. A trigger on job records keeps the job's rows equal to its payments.
--   3. The payments already on jobs are copied in once (the backfill).
--   4. crm_ledger_totals() adds payments up from the table.
--   5. crm_payments_reconciliation() proves the table and the job records
--      agree, payment by payment, to the cent.
--
-- Not changed here: how a payment is typed in (the job record is still what
-- the browser saves, and it keeps its own list), the rules on who may record
-- one, and Square, which keeps a running total per job rather than a list of
-- payments. Those are part 2.
--
-- Changes no existing row in any table. Safe to apply twice.

begin;

-- ---------------------------------------------------------------- 1. origin
alter table public.crm_payments add column if not exists origin text not null default 'invoice';
alter table public.crm_payments drop constraint if exists crm_payments_origin_check;
alter table public.crm_payments add constraint crm_payments_origin_check check (origin in ('invoice','job'));
create index if not exists crm_payments_job_origin_idx
  on public.crm_payments(company_state_id, job_id) where origin = 'job';

-- Who recorded a payment row, and when. The same as the stamp every financial
-- table has, with two differences that only matter for a job's payments:
--   * when the database itself copies a payment (no signed-in user, as in the
--     backfill below), the user it was given is kept instead of being blanked;
--   * only the database's own copy may say a row came from a job, and where a
--     row came from never changes afterwards.
create or replace function public.crm_stamp_payment_row()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.origin = 'job' and coalesce(current_setting('crm.payment_sync', true), '') <> 'on' then
      raise exception 'job_payments_are_written_by_the_database' using errcode = '42501';
    end if;
    new.company_state_id := public.crm_base_state_id();
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := clock_timestamp();
  else
    new.company_state_id := old.company_state_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.origin := old.origin;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.crm_stamp_payment_row() from public, anon, authenticated;

drop trigger if exists crm_stamp_financial_row on public.crm_payments;
create trigger crm_stamp_financial_row before insert or update on public.crm_payments
for each row execute function public.crm_stamp_payment_row();

-- ------------------------------------------------- 2. rows follow the record
-- The moment a payment recorded on a job counts as received. The job keeps a
-- calendar day; the table keeps a moment. 17:00 UTC is the middle of that day
-- in the eastern United States and still the same day everywhere else in the
-- country, so a payment lands in the same month wherever it is read.
create or replace function public.crm_payment_received_at(p_date text, p_recorded text)
returns timestamptz language plpgsql immutable set search_path = ''
as $$
begin
  if coalesce(p_date, '') ~ '^\d{4}-\d{2}-\d{2}$' then
    begin
      return ((p_date::date + time '17:00') at time zone 'UTC');
    exception when others then null; -- 2026-02-31 and the like
    end;
  end if;
  begin
    return p_recorded::timestamptz;
  exception when others then return null;
  end;
end;
$$;
revoke all on function public.crm_payment_received_at(text, text) from public, anon, authenticated;

-- The payments on one job's record, and for each one whether it gets a row.
--
-- A payment gets a row when it is one the CRM's save rules accept: it has an
-- id, its amount is above zero with at most two decimals, and no earlier
-- payment on the same job has the same id. The table holds one row per id, so
-- a second payment with an id already used cannot have one.
--
-- Anything else is left on the record and named in "problem". It is not lost:
-- the totals count it from the record exactly as they always did, and the
-- check (crm_payments_reconciliation) reports it. The copy, the totals and
-- the check all read this one function, so they cannot disagree about which
-- payments those are.
create or replace function public.crm_job_payment_entries(p_data jsonb)
returns table(payment_id text, amount numeric, entry jsonb, list_position integer, problem text)
language sql immutable set search_path = ''
as $$
  with entries as (
    select coalesce(p.value->>'id', '') as payment_id, public.crm_money(p.value->>'amount') as amount, p.value as entry, p.ordinality::integer as list_position
    from jsonb_array_elements(case when jsonb_typeof(p_data->'manualPayments') = 'array' then p_data->'manualPayments' else '[]'::jsonb end)
      with ordinality p(value, ordinality)
  ),
  judged as (
    select e.*,
      case when e.payment_id = '' then 'payment_has_no_id'
           when e.amount <= 0 then 'payment_is_not_an_amount_above_zero'
           when e.amount <> round(e.amount, 2) then 'amount_has_more_than_two_decimals'
      end as own_problem
    from entries e
  )
  select j.payment_id, j.amount, j.entry, j.list_position,
    coalesce(j.own_problem,
      case when row_number() over (partition by j.payment_id, (j.own_problem is null) order by j.list_position) > 1
        then 'payment_id_used_twice_on_the_job' end) as problem
  from judged j;
$$;
revoke all on function public.crm_job_payment_entries(jsonb) from public, anon;
grant execute on function public.crm_job_payment_entries(jsonb) to authenticated, service_role;

-- Makes the payment rows of one job equal the payments on its record:
-- a row for each payment, changed when the payment is changed, removed when
-- the payment is removed. Returns how many rows the job has.
create or replace function public.crm_sync_job_payments(p_company text, p_job_id text)
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  job public.crm_records%rowtype;
  entry jsonb;
  entry_id text;
  entry_amount numeric(14,2);
  actor uuid;
  kept text[] := '{}';
begin
  select * into job from public.crm_records r
  where r.company_state_id = p_company and r.record_type = 'job' and r.id = p_job_id;
  if not found then return 0; end if;

  perform set_config('crm.payment_sync', 'on', true);

  -- A deleted job has no payments that count, so it has no rows. They come
  -- back with the job if it is restored: its record still holds them.
  if job.deleted_at is not null then
    delete from public.crm_payments p
    where p.company_state_id = p_company and p.job_id = job.id and p.origin = 'job';
    perform set_config('crm.payment_sync', 'off', true);
    return 0;
  end if;

  actor := coalesce(auth.uid(), job.updated_by, job.owner_id,
    (select a.user_id from public.crm_user_access a where a.approved and a.role = 'admin' order by a.approved_at nulls last, a.user_id limit 1));

  for entry, entry_id, entry_amount in
    select e.entry, e.payment_id, e.amount from public.crm_job_payment_entries(job.data) e
    where e.problem is null order by e.list_position
  loop
    kept := kept || entry_id;

    insert into public.crm_payments(
      company_state_id, id, lead_id, job_id, amount, currency, method, reference, note,
      provider, provider_payment_id, received_at, created_by, updated_by, origin
    ) values (
      p_company, entry_id, coalesce(job.lead_id, ''), job.id, entry_amount, 'USD',
      coalesce(nullif(btrim(entry->>'method'), ''), 'Other'), coalesce(entry->>'reference', ''), coalesce(entry->>'note', entry->>'memo', ''),
      'manual', '',
      coalesce(public.crm_payment_received_at(entry->>'date', entry->>'createdAt'), job.updated_at, clock_timestamp()),
      actor, actor, 'job'
    )
    on conflict (company_state_id, id) do update set
      lead_id = excluded.lead_id, amount = excluded.amount, method = excluded.method,
      reference = excluded.reference, note = excluded.note, received_at = excluded.received_at,
      updated_by = excluded.updated_by
    -- Only this job's own row. An id already used by an invoice payment, or by
    -- another job, is left exactly as it is.
    where crm_payments.origin = 'job' and crm_payments.job_id = excluded.job_id
      and (crm_payments.lead_id, crm_payments.amount, crm_payments.method, crm_payments.reference, crm_payments.note, crm_payments.received_at)
        is distinct from (excluded.lead_id, excluded.amount, excluded.method, excluded.reference, excluded.note, excluded.received_at);
  end loop;

  delete from public.crm_payments p
  where p.company_state_id = p_company and p.job_id = job.id and p.origin = 'job' and not (p.id = any(kept));

  perform set_config('crm.payment_sync', 'off', true);
  return coalesce(array_length(kept, 1), 0);
exception
  -- A refund or an invoice points at the payment that was removed.
  when foreign_key_violation then
    raise exception 'payment_has_a_refund_or_invoice_link' using errcode = '23503';
end;
$$;
revoke all on function public.crm_sync_job_payments(text, text) from public, anon, authenticated;

create or replace function public.crm_job_payments_follow_record()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform public.crm_sync_job_payments(new.company_state_id, new.id);
  return null;
end;
$$;
revoke all on function public.crm_job_payments_follow_record() from public, anon, authenticated;

-- Only when it matters: a job arriving with payments, or a job whose payments,
-- lead or deleted state changed. An ordinary save of a job does nothing here.
drop trigger if exists crm_job_payments_follow_insert on public.crm_records;
create trigger crm_job_payments_follow_insert after insert on public.crm_records
for each row when (new.record_type = 'job' and coalesce(new.data->'manualPayments', '[]'::jsonb) <> '[]'::jsonb)
execute function public.crm_job_payments_follow_record();

drop trigger if exists crm_job_payments_follow_update on public.crm_records;
create trigger crm_job_payments_follow_update after update on public.crm_records
for each row when (new.record_type = 'job' and (
  coalesce(old.data->'manualPayments', '[]'::jsonb) is distinct from coalesce(new.data->'manualPayments', '[]'::jsonb)
  or old.lead_id is distinct from new.lead_id
  or (old.deleted_at is null) is distinct from (new.deleted_at is null)))
execute function public.crm_job_payments_follow_record();

-- Every job, again. Used once below, and afterwards only if the check further
-- down ever reports a difference. Returns how many jobs have payments.
create or replace function public.crm_sync_all_job_payments()
returns integer language plpgsql security definer set search_path = ''
as $$
declare
  job record;
  jobs_with_payments integer := 0;
begin
  if auth.uid() is not null then raise exception 'not_available_to_users' using errcode = '42501'; end if;
  for job in
    select r.company_state_id, r.id from public.crm_records r
    where r.record_type = 'job'
      and (r.deleted_at is null and coalesce(r.data->'manualPayments', '[]'::jsonb) <> '[]'::jsonb
        or exists (select 1 from public.crm_payments p where p.company_state_id = r.company_state_id and p.job_id = r.id and p.origin = 'job'))
    order by r.id
  loop
    if public.crm_sync_job_payments(job.company_state_id, job.id) > 0 then jobs_with_payments := jobs_with_payments + 1; end if;
  end loop;
  return jobs_with_payments;
end;
$$;
revoke all on function public.crm_sync_all_job_payments() from public, anon, authenticated;
grant execute on function public.crm_sync_all_job_payments() to service_role;

-- ------------------------------------------------------------- 3. backfill
select public.crm_sync_all_job_payments();

-- ---------------------------------------------------------------- 4. totals
-- The same answer as before, from the table.
--   payments  = every payment row that counts
--             + confirmed Square payments on a job (a running total per job)
--   refunds   = every refund row that counts
--   collected = payments - refunds, never below zero
--   expenses  = every expense row that counts
--             + costs recorded on a job that are not also in crm_expenses
-- A row counts when its lead exists, is not deleted and is not archived; a
-- payment recorded on a job also needs that job. This is the rule job payments
-- always followed. It now holds for every row, however it was recorded, so an
-- archived lead is left out of the totals completely.
--
-- A payment that is on a job's record and has no row is still counted, so the
-- figure cannot fall short if the table were ever behind. That amount is also
-- reported on its own as unsyncedJobPayments, and should always be 0.
--
-- security invoker: the caller's own row-level security applies, so each user
-- gets totals for the records they are allowed to see and no others.
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
  payment_rows as (
    select p.id, p.amount, p.origin, p.lead_id, p.job_id from public.crm_payments p, company where p.company_state_id = company.id
  ),
  counted_payments as (
    select r.amount, r.origin from payment_rows r
    where (r.lead_id = '' or exists (select 1 from leads l where l.id = r.lead_id))
      and (r.origin <> 'job' or exists (select 1 from jobs j where j.id = r.job_id))
  ),
  expense_rows as (select e.id, e.amount, e.lead_id from public.crm_expenses e, company where e.company_state_id = company.id),
  -- Still only on a job's record: a payment that has no row of its own. That
  -- is every payment the copy does not write (see crm_job_payment_entries),
  -- and any it should have written and has not. A payment whose id an invoice
  -- payment already has is the same money recorded twice, and is counted once,
  -- from the invoice payment: the rule the browser has always used.
  unsynced_job_payments as (
    select e.amount
    from jobs j cross join lateral public.crm_job_payment_entries(j.data) e
    where not exists (select 1 from payment_rows r where r.id = e.payment_id and r.origin <> 'job')
      and (e.problem is not null
        or not exists (select 1 from payment_rows r where r.id = e.payment_id and r.origin = 'job' and r.job_id = j.id))
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
      (select coalesce(sum(amount), 0) from counted_payments where origin <> 'job') as invoice_payments,
      (select coalesce(sum(amount), 0) from counted_payments where origin = 'job') as job_payment_rows,
      (select coalesce(sum(amount), 0) from unsynced_job_payments) as unsynced_job_payments,
      (select coalesce(sum(amount), 0) from square_payments where amount > 0) as square_payments,
      (select coalesce(sum(r.amount), 0) from public.crm_refunds r, company
        where r.company_state_id = company.id and (r.lead_id = '' or exists (select 1 from leads l where l.id = r.lead_id))) as refunds,
      (select coalesce(sum(e.amount), 0) from expense_rows e
        where e.lead_id = '' or exists (select 1 from leads l where l.id = e.lead_id)) as recorded_expenses,
      (select coalesce(sum(amount), 0) from job_costs) as job_costs,
      (select coalesce(sum(n.amount), 0) from public.crm_credit_notes n, company
        where n.company_state_id = company.id and (n.lead_id = '' or exists (select 1 from leads l where l.id = n.lead_id))) as credits
  )
  select jsonb_build_object(
    'payments', invoice_payments + job_payment_rows + unsynced_job_payments + square_payments,
    'refunds', refunds,
    'collected', greatest(invoice_payments + job_payment_rows + unsynced_job_payments + square_payments - refunds, 0),
    'expenses', recorded_expenses + job_costs,
    'credits', credits,
    'invoicePayments', invoice_payments,
    'jobPayments', job_payment_rows + unsynced_job_payments,
    'unsyncedJobPayments', unsynced_job_payments,
    'squarePayments', square_payments,
    'leads', (select count(*) from leads),
    'jobs', (select count(*) from jobs),
    'computedAt', clock_timestamp()
  ) from totals;
$$;
revoke all on function public.crm_ledger_totals() from public, anon;
grant execute on function public.crm_ledger_totals() to authenticated;

-- ----------------------------------------------------------------- 5. proof
-- Compares the payments on every live job's record with that job's rows in
-- the table. "matched" is true only when all three of these hold:
--   * one payment at a time: every payment has a row for the same job and the
--     same amount, and no row is left over;
--   * the count: as many rows as there are payments on jobs;
--   * the money: the rows add up to what the payments on jobs add up to.
-- The last two are asked separately on purpose. Two payments on a job with the
-- same id share one row; comparing payment by payment alone would find a row
-- for each of them and call that a match while half the money was missing.
-- For managers, the server, and the SQL editor. Reads only.
create or replace function public.crm_payments_reconciliation()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  company_id text := public.crm_base_state_id();
  result jsonb;
begin
  if auth.uid() is not null and not public.can_manage_team_crm() then
    raise exception 'manager_required' using errcode = '42501';
  end if;

  with live_jobs as (
    select j.id, j.data from public.crm_records j
    where j.company_state_id = company_id and j.record_type = 'job' and j.deleted_at is null
  ),
  on_records as (
    select j.id as job_id, e.payment_id, e.amount, e.list_position, e.problem
    from live_jobs j cross join lateral public.crm_job_payment_entries(j.data) e
  ),
  in_table as (
    select p.id as payment_id, p.job_id, p.amount, p.origin from public.crm_payments p where p.company_state_id = company_id
  ),
  differences as (
    -- A payment that gets no row, and why; or one whose row is missing, someone else's, or wrong.
    select r.job_id, r.payment_id, r.list_position,
      coalesce(r.problem,
        case when t.payment_id is null then 'no_row_in_the_table'
             when t.origin <> 'job' or t.job_id <> r.job_id then 'id_used_by_another_payment'
             else 'amount_differs' end) as problem,
      r.amount as amount_on_record, t.amount as amount_in_table
    from on_records r left join in_table t on t.payment_id = r.payment_id and r.problem is null
    where r.problem is not null or t.payment_id is null or t.origin <> 'job' or t.job_id <> r.job_id or t.amount <> r.amount
    union all
    select t.job_id, t.payment_id, 0, 'row_without_a_payment_on_the_job', null, t.amount
    from in_table t
    where t.origin = 'job'
      and not exists (select 1 from on_records r where r.payment_id = t.payment_id and r.job_id = t.job_id and r.problem is null)
  ),
  figures as (
    select
      (select count(*) from on_records) as payments_on_jobs,
      (select count(*) from in_table where origin = 'job') as rows_from_jobs,
      (select coalesce(sum(amount), 0) from on_records) as total_on_jobs,
      (select coalesce(sum(amount), 0) from in_table where origin = 'job') as total_in_table,
      (select count(*) from differences) as difference_count
  )
  select jsonb_build_object(
    'matched', f.difference_count = 0 and f.payments_on_jobs = f.rows_from_jobs and f.total_on_jobs = f.total_in_table,
    'countsAgree', f.payments_on_jobs = f.rows_from_jobs,
    'totalsAgree', f.total_on_jobs = f.total_in_table,
    'jobsWithPayments', (select count(distinct job_id) from on_records),
    'paymentsOnJobs', f.payments_on_jobs,
    'rowsFromJobs', f.rows_from_jobs,
    'totalOnJobs', f.total_on_jobs,
    'totalInTable', f.total_in_table,
    'differenceCount', f.difference_count,
    'differences', coalesce((select jsonb_agg(to_jsonb(d)) from (
      select job_id, payment_id, problem, amount_on_record, amount_in_table from differences order by job_id, payment_id, list_position limit 50) d), '[]'::jsonb),
    'checkedAt', clock_timestamp()
  ) into result from figures f;
  return result;
end;
$$;
revoke all on function public.crm_payments_reconciliation() from public, anon;
grant execute on function public.crm_payments_reconciliation() to authenticated, service_role;

commit;
