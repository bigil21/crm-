-- Complete phase-two revenue controls: expenses, refunds, recurring invoice
-- drafts, and durable due/overdue notice work. Client roles receive only the
-- explicit Data API grants below and every table is protected with RLS.

alter table public.crm_invoices
  add column if not exists source_schedule_id text not null default '',
  add column if not exists billing_period_start date;

create unique index if not exists crm_invoices_schedule_period_unique_idx
  on public.crm_invoices(company_state_id, source_schedule_id, billing_period_start)
  where source_schedule_id <> '' and billing_period_start is not null;

create table if not exists public.crm_refunds (
  company_state_id text not null default public.crm_base_state_id(),
  id text not null,
  payment_id text not null,
  invoice_id text not null,
  lead_id text not null,
  job_id text not null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  provider text not null default 'manual' check (provider in ('manual','square','bank','financing','other')),
  provider_refund_id text not null default '',
  refunded_at timestamptz not null,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id),
  foreign key (company_state_id,payment_id) references public.crm_payments(company_state_id,id) on delete restrict,
  foreign key (company_state_id,invoice_id) references public.crm_invoices(company_state_id,id) on delete restrict
);

create table if not exists public.crm_invoice_schedules (
  company_state_id text not null default public.crm_base_state_id(),
  id text not null,
  template_invoice_id text not null,
  lead_id text not null,
  job_id text not null,
  cadence text not null check (cadence in ('monthly','quarterly','yearly')),
  next_issue_date date not null,
  due_days integer not null default 14 check (due_days between 0 and 365),
  remaining_count integer check (remaining_count is null or remaining_count > 0),
  active boolean not null default true,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id),
  unique (company_state_id,template_invoice_id),
  foreign key (company_state_id,template_invoice_id) references public.crm_invoices(company_state_id,id) on delete restrict
);

create table if not exists public.crm_billing_notices (
  company_state_id text not null default public.crm_base_state_id(),
  id text not null,
  invoice_id text not null,
  lead_id text not null,
  job_id text not null,
  notice_type text not null check (notice_type in ('due_soon','overdue')),
  recipient_email text not null check (recipient_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  scheduled_for timestamptz not null,
  status text not null default 'queued' check (status in ('queued','processing','sent','failed','cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 20),
  last_error text not null default '',
  sent_at timestamptz,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id),
  unique (company_state_id,invoice_id,notice_type,scheduled_for),
  foreign key (company_state_id,invoice_id) references public.crm_invoices(company_state_id,id) on delete restrict
);

create index if not exists crm_refunds_payment_date_idx on public.crm_refunds(company_state_id,payment_id,refunded_at desc);
create unique index if not exists crm_refunds_provider_unique_idx on public.crm_refunds(company_state_id,provider,provider_refund_id) where provider_refund_id <> '';
create index if not exists crm_invoice_schedules_due_idx on public.crm_invoice_schedules(company_state_id,active,next_issue_date);
create index if not exists crm_billing_notices_queue_idx on public.crm_billing_notices(company_state_id,status,scheduled_for);
create index if not exists crm_billing_notices_invoice_idx on public.crm_billing_notices(company_state_id,invoice_id,created_at desc);

do $$
declare table_name text;
begin
  foreach table_name in array array['crm_refunds','crm_invoice_schedules','crm_billing_notices'] loop
    execute format('drop trigger if exists crm_stamp_revenue_row on public.%I',table_name);
    execute format('create trigger crm_stamp_revenue_row before insert or update on public.%I for each row execute function public.crm_stamp_workflow_row()',table_name);
    execute format('alter table public.%I enable row level security',table_name);
    execute format('drop policy if exists "CRM revenue rows are visible in scope" on public.%I',table_name);
    execute format('drop policy if exists "CRM admins create revenue rows" on public.%I',table_name);
    execute format('drop policy if exists "CRM admins update revenue rows" on public.%I',table_name);
    execute format('create policy "CRM revenue rows are visible in scope" on public.%I for select to authenticated using (public.crm_workflow_row_access(company_state_id,lead_id,created_by))',table_name);
    execute format('create policy "CRM admins create revenue rows" on public.%I for insert to authenticated with check (public.is_crm_admin() and company_state_id=public.crm_base_state_id() and created_by=(select auth.uid()))',table_name);
    execute format('create policy "CRM admins update revenue rows" on public.%I for update to authenticated using (public.is_crm_admin() and company_state_id=public.crm_base_state_id()) with check (public.is_crm_admin() and company_state_id=public.crm_base_state_id())',table_name);
    execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
    execute format('grant select,insert,update on table public.%I to authenticated',table_name);
  end loop;
end;
$$;

revoke update on public.crm_refunds from authenticated;

create or replace function public.crm_record_expense(p_expense jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
  company_id text := public.crm_base_state_id();
  expense_id text := coalesce(p_expense->>'id','');
  lead_id_value text := coalesce(p_expense->>'lead_id','');
  job_id_value text := coalesce(p_expense->>'job_id','');
  expense_amount numeric(14,2);
begin
  if not public.is_crm_admin() then raise exception 'admin_required'; end if;
  if expense_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or lead_id_value !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or job_id_value !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or char_length(btrim(coalesce(p_expense->>'category',''))) not between 1 and 100
    or char_length(coalesce(p_expense->>'vendor','')) > 200
    or char_length(coalesce(p_expense->>'description','')) > 1000
  then raise exception 'invalid_expense_payload'; end if;
  expense_amount := round((p_expense->>'amount')::numeric,2);
  if expense_amount <= 0 then raise exception 'invalid_expense_amount'; end if;
  if not exists(select 1 from public.crm_records r where r.company_state_id=company_id and r.record_type='job' and r.id=job_id_value and r.lead_id=lead_id_value and r.deleted_at is null)
  then raise exception 'job_not_found'; end if;

  insert into public.crm_expenses(company_state_id,id,lead_id,job_id,category,vendor,description,amount,expense_date,reference,status,created_by,updated_by)
  values(company_id,expense_id,lead_id_value,job_id_value,btrim(p_expense->>'category'),coalesce(p_expense->>'vendor',''),coalesce(p_expense->>'description',''),expense_amount,(p_expense->>'expense_date')::date,coalesce(p_expense->>'reference',''),'recorded',auth.uid(),auth.uid());
  insert into public.crm_activity_events(company_state_id,lead_id,job_id,event_type,title,description,actor_user_id,actor_name,source_type,source_id)
  values(company_id,lead_id_value,job_id_value,'expense','Job expense recorded',concat(expense_amount::text,' USD · ',btrim(p_expense->>'category')),auth.uid(),'CRM administrator','expense',expense_id);
  return jsonb_build_object('expense_id',expense_id,'amount',expense_amount,'status','recorded');
exception
  when unique_violation then raise exception 'expense_already_exists';
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then raise exception 'invalid_expense_payload';
end;
$$;

create or replace function public.crm_record_refund(p_refund jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
  company_id text := public.crm_base_state_id();
  refund_id text := coalesce(p_refund->>'id','');
  payment_id_value text := coalesce(p_refund->>'payment_id','');
  payment_row public.crm_payments%rowtype;
  allocation_row public.crm_payment_allocations%rowtype;
  invoice_row public.crm_invoices%rowtype;
  refund_amount numeric(14,2);
  prior_refunds numeric(14,2);
  credits numeric(14,2);
  net_paid numeric(14,2);
  next_status text;
begin
  if not public.is_crm_admin() then raise exception 'admin_required'; end if;
  if refund_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' or payment_id_value !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'
    or char_length(btrim(coalesce(p_refund->>'reason',''))) not between 1 and 1000
  then raise exception 'invalid_refund_payload'; end if;
  refund_amount := round((p_refund->>'amount')::numeric,2);
  if refund_amount <= 0 then raise exception 'invalid_refund_amount'; end if;
  select * into payment_row from public.crm_payments p where p.company_state_id=company_id and p.id=payment_id_value for update;
  if not found then raise exception 'payment_not_found'; end if;
  select * into allocation_row from public.crm_payment_allocations a where a.company_state_id=company_id and a.payment_id=payment_id_value order by a.created_at limit 1;
  if not found then raise exception 'payment_allocation_not_found'; end if;
  select * into invoice_row from public.crm_invoices i where i.company_state_id=company_id and i.id=allocation_row.invoice_id for update;
  if not found then raise exception 'invoice_not_found'; end if;
  select coalesce(sum(r.amount),0) into prior_refunds from public.crm_refunds r where r.company_state_id=company_id and r.payment_id=payment_id_value;
  if refund_amount > payment_row.amount-prior_refunds then raise exception 'refund_exceeds_payment'; end if;

  insert into public.crm_refunds(company_state_id,id,payment_id,invoice_id,lead_id,job_id,amount,currency,reason,provider,provider_refund_id,refunded_at,created_by,updated_by)
  values(company_id,refund_id,payment_id_value,invoice_row.id,invoice_row.lead_id,invoice_row.job_id,refund_amount,invoice_row.currency,btrim(p_refund->>'reason'),coalesce(nullif(p_refund->>'provider',''),'manual'),coalesce(p_refund->>'provider_refund_id',''),(p_refund->>'refunded_at')::timestamptz,auth.uid(),auth.uid());
  net_paid := greatest(invoice_row.amount_paid-refund_amount,0);
  select coalesce(sum(c.amount),0) into credits from public.crm_credit_notes c where c.company_state_id=company_id and c.invoice_id=invoice_row.id and c.status='applied';
  next_status := case when net_paid+credits >= invoice_row.total_amount then case when credits >= invoice_row.total_amount then 'credited' else 'paid' end when net_paid > 0 then 'partial' when invoice_row.due_date < current_date then 'overdue' else 'sent' end;
  update public.crm_invoices set amount_paid=net_paid,status=next_status,updated_by=auth.uid(),updated_at=clock_timestamp() where company_state_id=company_id and id=invoice_row.id;
  insert into public.crm_activity_events(company_state_id,lead_id,job_id,event_type,title,description,actor_user_id,actor_name,source_type,source_id)
  values(company_id,invoice_row.lead_id,invoice_row.job_id,'refund','Payment refund recorded',concat(refund_amount::text,' ',invoice_row.currency,' · ',btrim(p_refund->>'reason')),auth.uid(),'CRM administrator','refund',refund_id);
  return jsonb_build_object('refund_id',refund_id,'invoice_id',invoice_row.id,'status',next_status,'amount_paid',net_paid);
exception
  when unique_violation then raise exception 'refund_already_exists';
  when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then raise exception 'invalid_refund_payload';
end;
$$;

create or replace function public.crm_save_invoice_schedule(p_schedule jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
  company_id text := public.crm_base_state_id();
  schedule_id text := coalesce(p_schedule->>'id','');
  template_id text := coalesce(p_schedule->>'template_invoice_id','');
  invoice_row public.crm_invoices%rowtype;
  cadence_value text := coalesce(p_schedule->>'cadence','');
  count_value integer;
begin
  if not public.is_crm_admin() then raise exception 'admin_required'; end if;
  if schedule_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' or template_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' or cadence_value not in ('monthly','quarterly','yearly')
  then raise exception 'invalid_schedule_payload'; end if;
  count_value := nullif(p_schedule->>'remaining_count','')::integer;
  if count_value is not null and count_value <= 0 then raise exception 'invalid_schedule_count'; end if;
  select * into invoice_row from public.crm_invoices i where i.company_state_id=company_id and i.id=template_id;
  if not found then raise exception 'invoice_not_found'; end if;
  insert into public.crm_invoice_schedules(company_state_id,id,template_invoice_id,lead_id,job_id,cadence,next_issue_date,due_days,remaining_count,active,created_by,updated_by)
  values(company_id,schedule_id,template_id,invoice_row.lead_id,invoice_row.job_id,cadence_value,(p_schedule->>'next_issue_date')::date,coalesce((p_schedule->>'due_days')::integer,14),count_value,true,auth.uid(),auth.uid())
  on conflict(company_state_id,template_invoice_id) do update set cadence=excluded.cadence,next_issue_date=excluded.next_issue_date,due_days=excluded.due_days,remaining_count=excluded.remaining_count,active=true,updated_by=auth.uid(),updated_at=clock_timestamp();
  return jsonb_build_object('schedule_id',schedule_id,'template_invoice_id',template_id,'status','active');
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then raise exception 'invalid_schedule_payload';
end;
$$;

create or replace function public.crm_generate_due_recurring_invoices(p_as_of date default current_date)
returns integer language plpgsql security invoker set search_path=''
as $$
declare
  company_id text := public.crm_base_state_id();
  schedule_row public.crm_invoice_schedules%rowtype;
  template_row public.crm_invoices%rowtype;
  new_id text;
  new_number text;
  produced integer := 0;
  following_date date;
begin
  if not public.is_crm_admin() then raise exception 'admin_required'; end if;
  for schedule_row in select * from public.crm_invoice_schedules s where s.company_state_id=company_id and s.active and s.next_issue_date <= p_as_of order by s.next_issue_date for update skip locked loop
    select * into template_row from public.crm_invoices i where i.company_state_id=company_id and i.id=schedule_row.template_invoice_id;
    if not found then continue; end if;
    new_id := concat('rec_',schedule_row.id,'_',to_char(schedule_row.next_issue_date,'YYYYMMDD'));
    new_number := concat(template_row.invoice_number,'-R',to_char(schedule_row.next_issue_date,'YYYYMMDD'));
    insert into public.crm_invoices(company_state_id,id,invoice_number,lead_id,job_id,estimate_id,status,currency,subtotal,tax_amount,tax_rate,total_amount,amount_paid,issue_date,due_date,terms,notes,provider,owner_user_id,owner_email,owner_name,source_schedule_id,billing_period_start,created_by,updated_by)
    values(company_id,new_id,new_number,template_row.lead_id,template_row.job_id,'','draft',template_row.currency,template_row.subtotal,template_row.tax_amount,template_row.tax_rate,template_row.total_amount,0,schedule_row.next_issue_date,schedule_row.next_issue_date+schedule_row.due_days,template_row.terms,template_row.notes,'internal',template_row.owner_user_id,template_row.owner_email,template_row.owner_name,schedule_row.id,schedule_row.next_issue_date,auth.uid(),auth.uid())
    on conflict(company_state_id,source_schedule_id,billing_period_start) where source_schedule_id <> '' and billing_period_start is not null do nothing;
    if found then
      insert into public.crm_invoice_items(company_state_id,id,invoice_id,lead_id,job_id,description,quantity,unit_price,amount,position,created_by,updated_by)
      select company_id,concat(new_id,'_',position,'_',left(md5(id),8)),new_id,lead_id,job_id,description,quantity,unit_price,amount,position,auth.uid(),auth.uid()
      from public.crm_invoice_items where company_state_id=company_id and invoice_id=template_row.id;
      produced := produced+1;
    end if;
    following_date := case schedule_row.cadence when 'monthly' then (schedule_row.next_issue_date+interval '1 month')::date when 'quarterly' then (schedule_row.next_issue_date+interval '3 months')::date else (schedule_row.next_issue_date+interval '1 year')::date end;
    update public.crm_invoice_schedules set next_issue_date=following_date,remaining_count=case when remaining_count is null then null else remaining_count-1 end,active=case when remaining_count is null then true else remaining_count>1 end,updated_by=auth.uid(),updated_at=clock_timestamp() where company_state_id=company_id and id=schedule_row.id;
  end loop;
  return produced;
end;
$$;

create or replace function public.crm_enqueue_due_notices(p_as_of date default current_date)
returns integer language plpgsql security invoker set search_path=''
as $$
declare company_id text := public.crm_base_state_id(); queued integer;
begin
  if not public.is_crm_admin() then raise exception 'admin_required'; end if;
  insert into public.crm_billing_notices(company_state_id,id,invoice_id,lead_id,job_id,notice_type,recipient_email,scheduled_for,status,created_by,updated_by)
  select company_id,concat('notice_',i.id,'_',case when i.due_date < p_as_of then 'overdue' else 'due' end,'_',to_char(p_as_of,'YYYYMMDD')),i.id,i.lead_id,i.job_id,
    case when i.due_date < p_as_of then 'overdue' else 'due_soon' end,i.owner_email,(p_as_of::text||'T09:00:00')::timestamptz,'queued',auth.uid(),auth.uid()
  from public.crm_invoices i
  where i.company_state_id=company_id and i.status not in ('paid','credited','void') and i.due_date between p_as_of-30 and p_as_of+7 and i.owner_email <> ''
  on conflict(company_state_id,invoice_id,notice_type,scheduled_for) do nothing;
  get diagnostics queued=row_count;
  update public.crm_invoices set status='overdue',updated_by=auth.uid(),updated_at=clock_timestamp() where company_state_id=company_id and status in ('draft','sent','partial') and due_date < p_as_of and total_amount>amount_paid;
  return queued;
end;
$$;

do $$
declare function_signature text;
begin
  foreach function_signature in array array[
    'public.crm_record_expense(jsonb)','public.crm_record_refund(jsonb)','public.crm_save_invoice_schedule(jsonb)',
    'public.crm_generate_due_recurring_invoices(date)','public.crm_enqueue_due_notices(date)'
  ] loop
    execute format('revoke all on function %s from public,anon',function_signature);
    execute format('grant execute on function %s to authenticated',function_signature);
  end loop;
end;
$$;
