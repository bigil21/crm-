-- One active invoice per progress draw. All new writes use the draw's
-- locked database values; a retry of the same generation is idempotent.
alter table public.crm_invoices add column if not exists source_draw_id text;
alter table public.crm_progress_billings add column if not exists billing_generation integer not null default 0;
create unique index if not exists crm_invoices_one_live_draw
  on public.crm_invoices(company_state_id,source_draw_id)
  where source_draw_id is not null and status <> 'void';

-- Fail closed for old tabs using the legacy three-request insert sequence.
-- Existing historical rows can still be voided.
create or replace function public.crm_require_atomic_draw_insert()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if starts_with(new.id,'draw_invoice_') then
    raise exception 'Refresh JobCrest before invoicing this draw.' using errcode='PT409';
  end if;
  return new;
end $$;
drop trigger if exists crm_require_atomic_draw_insert on public.crm_invoices;
create trigger crm_require_atomic_draw_insert before insert on public.crm_invoices
for each row execute function public.crm_require_atomic_draw_insert();

-- Also runs for updates from an older open tab. PostgreSQL already holds
-- the invoice row lock, the same lock used by the payment and credit RPCs.
create or replace function public.crm_apply_invoice_void()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.status = 'void' and new.status <> 'void' then
    raise exception 'A voided invoice cannot be reopened.' using errcode='PT409';
  end if;
  if new.status <> 'void' or old.status = 'void' then return new; end if;
  if public.is_crm_admin() is not true or old.company_state_id <> public.crm_base_state_id()
    then raise exception 'Administrator access required.' using errcode='42501'; end if;
  if old.provider <> 'internal' or old.status in ('partial','paid','credited') or old.amount_paid <> 0 or new.amount_paid <> 0
    or exists(select 1 from public.crm_payment_allocations where company_state_id=old.company_state_id and invoice_id=old.id)
    or exists(select 1 from public.crm_credit_notes where company_state_id=old.company_state_id and invoice_id=old.id and status='applied')
    or exists(select 1 from public.crm_progress_billings where company_state_id=old.company_state_id and invoice_id=old.id and (paid_amount>0 or status in ('paid','partially_paid')))
    then raise exception 'Cannot void an external invoice or one with payments or credits.' using errcode='PT409'; end if;
  update public.crm_progress_billings set status='planned', invoice_id='',
    billing_generation=billing_generation+1, updated_by=auth.uid()
    where company_state_id=old.company_state_id and invoice_id=old.id;
  if old.source_draw_id is not null and not found then
    raise exception 'Linked draw was not reopened; invoice not voided.' using errcode='PT409';
  end if;
  update public.crm_invoice_schedules set active=false, updated_by=auth.uid()
    where company_state_id=old.company_state_id and template_invoice_id=old.id and active;
  if exists(select 1 from public.crm_invoice_schedules where company_state_id=old.company_state_id and template_invoice_id=old.id and active)
    or exists(select 1 from public.crm_progress_billings where company_state_id=old.company_state_id and invoice_id=old.id)
    then raise exception 'Related billing records did not update; invoice not voided.' using errcode='PT409'; end if;
  return new;
end $$;
drop trigger if exists crm_apply_invoice_void on public.crm_invoices;
create trigger crm_apply_invoice_void before update of status on public.crm_invoices
for each row execute function public.crm_apply_invoice_void();

-- A stale scheduling dialog must not reactivate a voided template.
create or replace function public.crm_check_active_invoice_template()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.active then
    perform 1 from public.crm_invoices
      where company_state_id=new.company_state_id and id=new.template_invoice_id and status<>'void' for share;
    if not found then raise exception 'A voided or missing invoice cannot be scheduled.' using errcode='PT409'; end if;
  end if;
  return new;
end $$;
drop trigger if exists crm_check_active_invoice_template on public.crm_invoice_schedules;
create trigger crm_check_active_invoice_template before insert or update of active,template_invoice_id on public.crm_invoice_schedules
for each row execute function public.crm_check_active_invoice_template();

create or replace function public.crm_void_internal_invoice(p_invoice_id text)
returns text language plpgsql security invoker set search_path='' as $$
declare v public.crm_invoices%rowtype;
begin
  if public.is_crm_admin() is not true then raise exception 'Administrator access required.' using errcode='42501'; end if;
  select * into strict v from public.crm_invoices where company_state_id=public.crm_base_state_id() and id=p_invoice_id for update;
  if v.status <> 'void' then
    update public.crm_invoices set status='void', updated_by=auth.uid()
      where company_state_id=v.company_state_id and id=v.id;
    if not found then raise exception 'The invoice was not voided.'; end if;
  end if;
  return v.id;
end $$;

create or replace function public.crm_invoice_progress_draw(p_draw_id text,p_generation integer,p_terms text default '')
returns text language plpgsql security invoker set search_path='' as $$
declare d public.crm_progress_billings%rowtype; v_id text; v_number text;
  v_day date := (statement_timestamp() at time zone public.crm_company_time_zone())::date;
  v_contact jsonb; v_job jsonb;
begin
  if public.is_crm_admin() is not true then raise exception 'Administrator access required.' using errcode='42501'; end if;
  select * into strict d from public.crm_progress_billings where company_state_id=public.crm_base_state_id() and id=p_draw_id for update;
  if p_generation is distinct from d.billing_generation then raise exception 'This draw has changed. Refresh before invoicing.' using errcode='PT409'; end if;
  if d.invoice_id <> '' then
    if exists(select 1 from public.crm_invoices where company_state_id=d.company_state_id and id=d.invoice_id and status<>'void' and lead_id=d.lead_id and job_id=d.job_id and (source_draw_id=d.id or source_draw_id is null))
      then return d.invoice_id; end if;
    raise exception 'Draw invoice link needs review.' using errcode='PT409';
  end if;
  if d.amount<=0 or d.status not in ('planned','ready') or d.paid_amount<>0 then raise exception 'This draw cannot be invoiced.' using errcode='PT409'; end if;
  select data into strict v_contact from public.crm_records where company_state_id=d.company_state_id and record_type='contact' and id=d.lead_id and deleted_at is null;
  select data into strict v_job from public.crm_records where company_state_id=d.company_state_id and record_type='job' and id=d.job_id and lead_id=d.lead_id and deleted_at is null;
  v_id := 'draw_' || gen_random_uuid()::text;
  v_number := 'DRAW-' || substr(v_id,6);
  insert into public.crm_invoices(company_state_id,id,invoice_number,lead_id,job_id,source_draw_id,
    subtotal,total_amount,issue_date,due_date,terms,notes,owner_user_id,owner_email,owner_name)
  values(d.company_state_id,v_id,v_number,d.lead_id,d.job_id,d.id,d.amount,d.amount,v_day,
    case when d.due_on is not null then greatest(d.due_on,v_day) end,left(coalesce(p_terms,''),8000),
    'Progress billing draw ' || d.draw_number,auth.uid(),coalesce(v_contact->>'email',''),coalesce(v_contact->>'name',''));
  insert into public.crm_invoice_items(company_state_id,id,invoice_id,lead_id,job_id,description,quantity,unit_price,amount)
  values(d.company_state_id,v_id || '_1',v_id,d.lead_id,d.job_id,left(concat_ws(' · ',d.name,v_job->>'name'),2000),1,d.amount,d.amount);
  update public.crm_progress_billings set status='invoiced',invoice_id=v_id,updated_by=auth.uid()
    where company_state_id=d.company_state_id and id=d.id;
  if not found then raise exception 'Draw was not linked; no invoice created.'; end if;
  return v_id;
end $$;

revoke all on function public.crm_require_atomic_draw_insert(), public.crm_apply_invoice_void(),
  public.crm_check_active_invoice_template(),
  public.crm_invoice_progress_draw(text,integer,text), public.crm_void_internal_invoice(text) from public,anon,authenticated;
grant execute on function public.crm_invoice_progress_draw(text,integer,text), public.crm_void_internal_invoice(text) to authenticated;
