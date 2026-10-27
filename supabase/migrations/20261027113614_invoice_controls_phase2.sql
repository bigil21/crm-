-- Phase 2 invoice controls: atomic payment allocation and credit application.
-- These functions keep confirmed money append-only and update invoice balances
-- in the same transaction, so a browser interruption cannot split the ledger.

alter table public.crm_invoices
  drop constraint if exists crm_invoices_status_check;
alter table public.crm_invoices
  add constraint crm_invoices_status_check
  check (status in ('draft','sent','partial','paid','overdue','void','credited'));

alter table public.crm_invoices
  add column if not exists tax_rate numeric(6,3) not null default 0
  check (tax_rate between 0 and 100);

create or replace function public.crm_record_invoice_payment(p_payment jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  company_id text := public.crm_base_state_id();
  invoice_row public.crm_invoices%rowtype;
  payment_id text := coalesce(p_payment->>'id','');
  target_invoice_id text := coalesce(p_payment->>'invoice_id','');
  payment_amount numeric(14,2);
  applied_credits numeric(14,2);
  outstanding numeric(14,2);
  next_status text;
  provider_name text := coalesce(nullif(p_payment->>'provider',''),'manual');
begin
  if not public.is_crm_admin() then raise exception 'admin_required'; end if;
  if payment_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or target_invoice_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or provider_name not in ('manual','square','bank','financing','other')
    or char_length(btrim(coalesce(p_payment->>'method',''))) not between 1 and 120
  then raise exception 'invalid_payment_payload'; end if;

  payment_amount := round((p_payment->>'amount')::numeric, 2);
  if payment_amount <= 0 then raise exception 'invalid_payment_amount'; end if;

  select * into invoice_row
  from public.crm_invoices i
  where i.company_state_id=company_id and i.id=target_invoice_id
  for update;
  if not found then raise exception 'invoice_not_found'; end if;
  if invoice_row.status in ('paid','credited','void') then raise exception 'invoice_closed'; end if;

  select coalesce(sum(c.amount),0) into applied_credits
  from public.crm_credit_notes c
  where c.company_state_id=company_id and c.invoice_id=target_invoice_id and c.status='applied';
  outstanding := round(invoice_row.total_amount - invoice_row.amount_paid - applied_credits, 2);
  if payment_amount > outstanding then raise exception 'payment_exceeds_outstanding'; end if;

  insert into public.crm_payments(
    company_state_id,id,lead_id,job_id,amount,currency,method,reference,note,
    provider,provider_payment_id,received_at,created_by,updated_by
  ) values (
    company_id,payment_id,invoice_row.lead_id,invoice_row.job_id,payment_amount,invoice_row.currency,
    btrim(p_payment->>'method'),coalesce(p_payment->>'reference',''),coalesce(p_payment->>'note',''),
    provider_name,coalesce(p_payment->>'provider_payment_id',''),
    (p_payment->>'received_at')::timestamptz,auth.uid(),auth.uid()
  );

  insert into public.crm_payment_allocations(
    company_state_id,id,payment_id,invoice_id,lead_id,job_id,amount,created_by,updated_by
  ) values (
    company_id,coalesce(nullif(p_payment->>'allocation_id',''),payment_id || '_allocation'),
    payment_id,target_invoice_id,invoice_row.lead_id,invoice_row.job_id,payment_amount,auth.uid(),auth.uid()
  );

  next_status := case when payment_amount = outstanding then 'paid' else 'partial' end;
  update public.crm_invoices
  set amount_paid=round(amount_paid + payment_amount,2), status=next_status,
      updated_by=auth.uid(), updated_at=clock_timestamp()
  where company_state_id=company_id and id=target_invoice_id;

  insert into public.crm_activity_events(
    company_state_id,lead_id,job_id,event_type,title,description,
    actor_user_id,actor_name,source_type,source_id
  ) values (
    company_id,invoice_row.lead_id,invoice_row.job_id,'payment','Invoice payment recorded',
    concat(payment_amount::text,' ',invoice_row.currency,' via ',btrim(p_payment->>'method')),
    auth.uid(),'CRM administrator','payment',payment_id
  );

  return jsonb_build_object('payment_id',payment_id,'invoice_id',target_invoice_id,'status',next_status,
    'amount_paid',round(invoice_row.amount_paid + payment_amount,2),
    'outstanding',round(outstanding - payment_amount,2));
exception
  when unique_violation then raise exception 'payment_already_exists';
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception 'invalid_payment_payload';
end;
$$;

create or replace function public.crm_apply_credit_note(p_credit jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  company_id text := public.crm_base_state_id();
  invoice_row public.crm_invoices%rowtype;
  credit_id text := coalesce(p_credit->>'id','');
  target_invoice_id text := coalesce(p_credit->>'invoice_id','');
  credit_amount numeric(14,2);
  applied_credits numeric(14,2);
  outstanding numeric(14,2);
  next_status text;
begin
  if not public.is_crm_admin() then raise exception 'admin_required'; end if;
  if credit_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or target_invoice_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or coalesce(p_credit->>'credit_number','') !~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$'
    or char_length(btrim(coalesce(p_credit->>'reason',''))) not between 1 and 1000
  then raise exception 'invalid_credit_payload'; end if;

  credit_amount := round((p_credit->>'amount')::numeric, 2);
  if credit_amount <= 0 then raise exception 'invalid_credit_amount'; end if;

  select * into invoice_row
  from public.crm_invoices i
  where i.company_state_id=company_id and i.id=target_invoice_id
  for update;
  if not found then raise exception 'invoice_not_found'; end if;
  if invoice_row.status in ('paid','credited','void') then raise exception 'invoice_closed'; end if;

  select coalesce(sum(c.amount),0) into applied_credits
  from public.crm_credit_notes c
  where c.company_state_id=company_id and c.invoice_id=target_invoice_id and c.status='applied';
  outstanding := round(invoice_row.total_amount - invoice_row.amount_paid - applied_credits, 2);
  if credit_amount > outstanding then raise exception 'credit_exceeds_outstanding'; end if;

  insert into public.crm_credit_notes(
    company_state_id,id,credit_number,invoice_id,lead_id,job_id,amount,reason,status,issued_at,created_by,updated_by
  ) values (
    company_id,credit_id,p_credit->>'credit_number',target_invoice_id,invoice_row.lead_id,invoice_row.job_id,
    credit_amount,btrim(p_credit->>'reason'),'applied',(p_credit->>'issued_at')::date,auth.uid(),auth.uid()
  );

  next_status := case when credit_amount = outstanding then 'credited'
    when invoice_row.amount_paid > 0 then 'partial' else invoice_row.status end;
  update public.crm_invoices
  set status=next_status,updated_by=auth.uid(),updated_at=clock_timestamp()
  where company_state_id=company_id and id=target_invoice_id;

  insert into public.crm_activity_events(
    company_state_id,lead_id,job_id,event_type,title,description,
    actor_user_id,actor_name,source_type,source_id
  ) values (
    company_id,invoice_row.lead_id,invoice_row.job_id,'credit','Invoice credit applied',
    concat(credit_amount::text,' ',invoice_row.currency,' · ',btrim(p_credit->>'reason')),
    auth.uid(),'CRM administrator','credit_note',credit_id
  );

  return jsonb_build_object('credit_id',credit_id,'invoice_id',target_invoice_id,'status',next_status,
    'outstanding',round(outstanding-credit_amount,2));
exception
  when unique_violation then raise exception 'credit_already_exists';
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
    raise exception 'invalid_credit_payload';
end;
$$;

revoke all on function public.crm_record_invoice_payment(jsonb) from public, anon;
revoke all on function public.crm_apply_credit_note(jsonb) from public, anon;
grant execute on function public.crm_record_invoice_payment(jsonb) to authenticated;
grant execute on function public.crm_apply_credit_note(jsonb) to authenticated;
