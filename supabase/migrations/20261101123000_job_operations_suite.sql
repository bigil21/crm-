-- JobCrest operations suite: permitting, job selections, change orders,
-- progress billing, recurring maintenance, and commercial/HOA portfolios.

create table if not exists public.crm_permits (
  company_state_id text not null default public.crm_base_state_id(), id text not null,
  lead_id text not null, job_id text not null, permit_type text not null,
  permit_number text not null default '', authority text not null default '',
  status text not null default 'planned' check (status in ('not_required','planned','submitted','corrections','approved','issued','closed','expired')),
  submitted_on date, issued_on date, expires_on date, closed_on date, notes text not null default '',
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id)
);

create table if not exists public.crm_inspections (
  company_state_id text not null default public.crm_base_state_id(), id text not null,
  lead_id text not null, job_id text not null, permit_id text not null default '',
  inspection_type text not null, scheduled_at timestamptz, completed_at timestamptz,
  result text not null default 'scheduled' check (result in ('scheduled','passed','failed','cancelled','reschedule')),
  inspector text not null default '', reinspection_required boolean not null default false, notes text not null default '',
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id)
);

create table if not exists public.crm_job_selections (
  company_state_id text not null default public.crm_base_state_id(), id text not null,
  lead_id text not null, job_id text not null, category text not null default 'Finish', item_name text not null,
  allowance_amount numeric(14,2) not null default 0 check (allowance_amount >= 0),
  selected_product text not null default '', selected_vendor text not null default '',
  selected_amount numeric(14,2) not null default 0 check (selected_amount >= 0),
  status text not null default 'pending' check (status in ('pending','selected','approved','ordered','installed','declined')),
  customer_approved_at timestamptz, notes text not null default '',
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id)
);

create table if not exists public.crm_change_orders (
  company_state_id text not null default public.crm_base_state_id(), id text not null,
  lead_id text not null, job_id text not null, change_order_number text not null,
  title text not null, description text not null default '', amount numeric(14,2) not null default 0,
  schedule_days integer not null default 0 check (schedule_days between -3650 and 3650),
  status text not null default 'draft' check (status in ('draft','pending','approved','signed','rejected','void')),
  requested_by_name text not null default '', signed_at timestamptz, document_id text not null default '',
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id), unique (company_state_id,job_id,change_order_number)
);

create table if not exists public.crm_progress_billings (
  company_state_id text not null default public.crm_base_state_id(), id text not null,
  lead_id text not null, job_id text not null, draw_number integer not null check (draw_number > 0),
  name text not null, scheduled_percent numeric(7,4) not null default 0 check (scheduled_percent between 0 and 100),
  amount numeric(14,2) not null default 0 check (amount >= 0), paid_amount numeric(14,2) not null default 0 check (paid_amount >= 0),
  due_on date, status text not null default 'planned' check (status in ('planned','ready','invoiced','partially_paid','paid','void')),
  invoice_id text not null default '', notes text not null default '',
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id), unique (company_state_id,job_id,draw_number),
  check (paid_amount <= amount or status = 'void')
);

create table if not exists public.crm_maintenance_plans (
  company_state_id text not null default public.crm_base_state_id(), id text not null,
  lead_id text not null, job_id text not null, plan_name text not null, service_name text not null,
  frequency text not null default 'annual' check (frequency in ('monthly','quarterly','semiannual','annual','custom')),
  interval_months integer not null default 12 check (interval_months between 1 and 120),
  start_on date not null, next_service_on date not null, amount numeric(14,2) not null default 0 check (amount >= 0),
  auto_invoice boolean not null default false, assigned_user_id uuid, active boolean not null default true, notes text not null default '',
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id)
);

create table if not exists public.crm_maintenance_visits (
  company_state_id text not null default public.crm_base_state_id(), id text not null,
  lead_id text not null, job_id text not null, plan_id text not null, scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','completed','skipped','cancelled')),
  task_id text not null default '', invoice_id text not null default '', completed_at timestamptz, notes text not null default '',
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id),
  foreign key (company_state_id,plan_id) references public.crm_maintenance_plans(company_state_id,id) on delete restrict
);

create table if not exists public.crm_organization_accounts (
  company_state_id text not null default public.crm_base_state_id(), id text not null,
  name text not null, account_type text not null default 'commercial' check (account_type in ('commercial','hoa','property_manager','municipal','other')),
  owner_user_id uuid not null default auth.uid(), billing_email text not null default '', billing_phone text not null default '',
  billing_address text not null default '', payment_terms text not null default 'Due on receipt', active boolean not null default true,
  notes text not null default '', created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id)
);

create table if not exists public.crm_account_properties (
  company_state_id text not null default public.crm_base_state_id(), id text not null, account_id text not null,
  name text not null, address text not null, property_type text not null default 'commercial', units integer not null default 1 check (units > 0),
  annual_budget numeric(14,2) not null default 0 check (annual_budget >= 0), roof_system text not null default '',
  last_roof_year integer check (last_roof_year is null or last_roof_year between 1800 and 2500), notes text not null default '',
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id),
  foreign key (company_state_id,account_id) references public.crm_organization_accounts(company_state_id,id) on delete restrict
);

create table if not exists public.crm_account_contacts (
  company_state_id text not null default public.crm_base_state_id(), id text not null, account_id text not null,
  property_id text not null default '', name text not null, email text not null default '', phone text not null default '',
  role_name text not null default '', is_primary boolean not null default false,
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id),
  foreign key (company_state_id,account_id) references public.crm_organization_accounts(company_state_id,id) on delete restrict
);

create table if not exists public.crm_account_record_links (
  company_state_id text not null default public.crm_base_state_id(), id text not null,
  account_id text not null, property_id text not null default '', lead_id text not null, job_id text not null,
  relationship text not null default 'service_location',
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id), unique (company_state_id,job_id),
  foreign key (company_state_id,account_id) references public.crm_organization_accounts(company_state_id,id) on delete restrict
);

create index if not exists crm_permits_job_idx on public.crm_permits(company_state_id,lead_id,job_id,status);
create index if not exists crm_inspections_job_idx on public.crm_inspections(company_state_id,lead_id,job_id,scheduled_at);
create index if not exists crm_job_selections_job_idx on public.crm_job_selections(company_state_id,lead_id,job_id,status);
create index if not exists crm_change_orders_job_idx on public.crm_change_orders(company_state_id,lead_id,job_id,status,created_at desc);
create index if not exists crm_progress_billings_job_idx on public.crm_progress_billings(company_state_id,lead_id,job_id,draw_number);
create index if not exists crm_maintenance_plans_next_idx on public.crm_maintenance_plans(company_state_id,active,next_service_on);
create index if not exists crm_maintenance_visits_plan_idx on public.crm_maintenance_visits(company_state_id,plan_id,scheduled_for);
create index if not exists crm_account_properties_account_idx on public.crm_account_properties(company_state_id,account_id,name);
create index if not exists crm_account_contacts_account_idx on public.crm_account_contacts(company_state_id,account_id,is_primary desc,name);
create index if not exists crm_account_record_links_lead_idx on public.crm_account_record_links(company_state_id,lead_id,job_id);
create index if not exists crm_account_record_links_account_idx on public.crm_account_record_links(company_state_id,account_id);

create or replace function public.crm_account_access(p_company_state_id text,p_account_id text)
returns boolean language sql stable security definer set search_path=''
as $$
  select public.is_coastal_crest_user()
    and p_company_state_id=public.crm_base_state_id()
    and (public.can_manage_team_crm() or exists(
      select 1 from public.crm_organization_accounts a
      where a.company_state_id=p_company_state_id and a.id=p_account_id and a.owner_user_id=auth.uid()
    ) or exists(
      select 1
      from public.crm_account_record_links l
      join public.crm_records r on r.company_state_id=l.company_state_id and r.record_type='contact' and r.id=l.lead_id
      where l.company_state_id=p_company_state_id and l.account_id=p_account_id
        and r.owner_id=auth.uid() and r.deleted_at is null
    ));
$$;
revoke all on function public.crm_account_access(text,text) from public,anon;
grant execute on function public.crm_account_access(text,text) to authenticated;

do $$ declare table_name text;
begin
  foreach table_name in array array[
    'crm_permits','crm_inspections','crm_job_selections','crm_change_orders',
    'crm_maintenance_plans','crm_maintenance_visits'
  ] loop
    execute format('drop trigger if exists crm_stamp_operations_row on public.%I',table_name);
    execute format('create trigger crm_stamp_operations_row before insert or update on public.%I for each row execute function public.crm_stamp_workflow_row()',table_name);
    execute format('alter table public.%I enable row level security',table_name);
    execute format('drop policy if exists "CRM operations rows select" on public.%I',table_name);
    execute format('drop policy if exists "CRM operations rows insert" on public.%I',table_name);
    execute format('drop policy if exists "CRM operations rows update" on public.%I',table_name);
    execute format('create policy "CRM operations rows select" on public.%I for select to authenticated using(public.crm_project_row_access(company_state_id,lead_id))',table_name);
    execute format('create policy "CRM operations rows insert" on public.%I for insert to authenticated with check(public.crm_project_row_access(company_state_id,lead_id) and created_by=(select auth.uid()))',table_name);
    execute format('create policy "CRM operations rows update" on public.%I for update to authenticated using(public.crm_project_row_access(company_state_id,lead_id)) with check(public.crm_project_row_access(company_state_id,lead_id))',table_name);
    execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
    execute format('grant select,insert,update on table public.%I to authenticated',table_name);
  end loop;
end $$;

do $$ declare table_name text;
begin
  if exists (select 1 from pg_roles where rolname='service_role') then
    foreach table_name in array array[
      'crm_permits','crm_inspections','crm_job_selections','crm_change_orders','crm_progress_billings',
      'crm_maintenance_plans','crm_maintenance_visits','crm_organization_accounts','crm_account_properties',
      'crm_account_contacts','crm_account_record_links'
    ] loop
      execute format('grant select,insert,update,delete on table public.%I to service_role',table_name);
    end loop;
  end if;
end $$;

drop trigger if exists crm_stamp_progress_billing on public.crm_progress_billings;
create trigger crm_stamp_progress_billing before insert or update on public.crm_progress_billings for each row execute function public.crm_stamp_workflow_row();
alter table public.crm_progress_billings enable row level security;
drop policy if exists "CRM progress billings select" on public.crm_progress_billings;
drop policy if exists "CRM admins create progress billings" on public.crm_progress_billings;
drop policy if exists "CRM admins update progress billings" on public.crm_progress_billings;
create policy "CRM progress billings select" on public.crm_progress_billings for select to authenticated using(public.crm_project_row_access(company_state_id,lead_id));
create policy "CRM admins create progress billings" on public.crm_progress_billings for insert to authenticated with check(public.is_crm_admin() and company_state_id=public.crm_base_state_id() and created_by=(select auth.uid()));
create policy "CRM admins update progress billings" on public.crm_progress_billings for update to authenticated using(public.is_crm_admin() and company_state_id=public.crm_base_state_id()) with check(public.is_crm_admin() and company_state_id=public.crm_base_state_id());
revoke all on table public.crm_progress_billings from public,anon,authenticated;
grant select,insert,update on table public.crm_progress_billings to authenticated;

drop trigger if exists crm_stamp_customer_account on public.crm_organization_accounts;
create trigger crm_stamp_customer_account before insert or update on public.crm_organization_accounts for each row execute function public.crm_stamp_workflow_row();
alter table public.crm_organization_accounts enable row level security;
drop policy if exists "CRM accounts select" on public.crm_organization_accounts;
drop policy if exists "CRM accounts insert" on public.crm_organization_accounts;
drop policy if exists "CRM accounts update" on public.crm_organization_accounts;
create policy "CRM accounts select" on public.crm_organization_accounts for select to authenticated using(public.crm_account_access(company_state_id,id));
create policy "CRM accounts insert" on public.crm_organization_accounts for insert to authenticated with check(public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id() and owner_user_id=(select auth.uid()) and created_by=(select auth.uid()));
create policy "CRM accounts update" on public.crm_organization_accounts for update to authenticated using(public.crm_account_access(company_state_id,id)) with check(public.crm_account_access(company_state_id,id));
revoke all on table public.crm_organization_accounts from public,anon,authenticated;
grant select,insert,update on table public.crm_organization_accounts to authenticated;

do $$ declare table_name text; account_expression text;
begin
  foreach table_name in array array['crm_account_properties','crm_account_contacts','crm_account_record_links'] loop
    execute format('drop trigger if exists crm_stamp_account_child on public.%I',table_name);
    execute format('create trigger crm_stamp_account_child before insert or update on public.%I for each row execute function public.crm_stamp_workflow_row()',table_name);
    execute format('alter table public.%I enable row level security',table_name);
    execute format('drop policy if exists "CRM account children select" on public.%I',table_name);
    execute format('drop policy if exists "CRM account children insert" on public.%I',table_name);
    execute format('drop policy if exists "CRM account children update" on public.%I',table_name);
    execute format('create policy "CRM account children select" on public.%I for select to authenticated using(public.crm_account_access(company_state_id,account_id))',table_name);
    execute format('create policy "CRM account children insert" on public.%I for insert to authenticated with check(public.crm_account_access(company_state_id,account_id) and created_by=(select auth.uid()))',table_name);
    execute format('create policy "CRM account children update" on public.%I for update to authenticated using(public.crm_account_access(company_state_id,account_id)) with check(public.crm_account_access(company_state_id,account_id))',table_name);
    execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
    execute format('grant select,insert,update on table public.%I to authenticated',table_name);
  end loop;
end $$;

create or replace function public.crm_create_maintenance_plan(p_plan jsonb,p_visit jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare company_id text:=public.crm_base_state_id(); lead_id text:=coalesce(p_plan->>'lead_id',''); job_id text:=coalesce(p_plan->>'job_id','');
begin
  if not public.crm_project_row_access(company_id,lead_id) then raise exception 'job_access_required'; end if;
  if coalesce(p_plan->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' or coalesce(p_visit->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' then raise exception 'invalid_maintenance_payload'; end if;
  if not exists(select 1 from public.crm_records r where r.company_state_id=company_id and r.record_type='job' and r.id=job_id and r.lead_id=lead_id and r.deleted_at is null) then raise exception 'job_not_found'; end if;
  insert into public.crm_maintenance_plans(company_state_id,id,lead_id,job_id,plan_name,service_name,frequency,interval_months,start_on,next_service_on,amount,auto_invoice,active,notes,created_by,updated_by)
  values(company_id,p_plan->>'id',lead_id,job_id,btrim(p_plan->>'plan_name'),btrim(p_plan->>'service_name'),p_plan->>'frequency',coalesce((p_plan->>'interval_months')::integer,12),(p_plan->>'start_on')::date,(p_plan->>'next_service_on')::date,coalesce((p_plan->>'amount')::numeric,0),coalesce((p_plan->>'auto_invoice')::boolean,false),true,coalesce(p_plan->>'notes',''),auth.uid(),auth.uid());
  insert into public.crm_maintenance_visits(company_state_id,id,lead_id,job_id,plan_id,scheduled_for,status,task_id,invoice_id,notes,created_by,updated_by)
  values(company_id,p_visit->>'id',lead_id,job_id,p_plan->>'id',(p_visit->>'scheduled_for')::timestamptz,'scheduled',coalesce(p_visit->>'task_id',''),'',coalesce(p_visit->>'notes',''),auth.uid(),auth.uid());
  return jsonb_build_object('plan_id',p_plan->>'id','visit_id',p_visit->>'id','status','scheduled');
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or not_null_violation or check_violation then raise exception 'invalid_maintenance_payload';
end;
$$;
revoke all on function public.crm_create_maintenance_plan(jsonb,jsonb) from public,anon;
grant execute on function public.crm_create_maintenance_plan(jsonb,jsonb) to authenticated;

create or replace function public.crm_link_account_property(p_property jsonb,p_contact jsonb,p_link jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$
declare company_id text:=public.crm_base_state_id(); account_id text:=coalesce(p_property->>'account_id',''); lead_id text:=coalesce(p_link->>'lead_id',''); job_id text:=coalesce(p_link->>'job_id','');
begin
  if not public.crm_account_access(company_id,account_id) or not public.crm_project_row_access(company_id,lead_id) then raise exception 'account_job_access_required'; end if;
  if coalesce(p_property->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' or coalesce(p_link->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' then raise exception 'invalid_property_payload'; end if;
  if not exists(select 1 from public.crm_records r where r.company_state_id=company_id and r.record_type='job' and r.id=job_id and r.lead_id=lead_id and r.deleted_at is null) then raise exception 'job_not_found'; end if;
  insert into public.crm_account_properties(company_state_id,id,account_id,name,address,property_type,units,annual_budget,roof_system,notes,created_by,updated_by)
  values(company_id,p_property->>'id',account_id,btrim(p_property->>'name'),btrim(p_property->>'address'),coalesce(p_property->>'property_type','commercial'),coalesce((p_property->>'units')::integer,1),coalesce((p_property->>'annual_budget')::numeric,0),coalesce(p_property->>'roof_system',''),coalesce(p_property->>'notes',''),auth.uid(),auth.uid());
  if btrim(coalesce(p_contact->>'name',''))<>'' then
    if coalesce(p_contact->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' then raise exception 'invalid_property_payload'; end if;
    insert into public.crm_account_contacts(company_state_id,id,account_id,property_id,name,email,phone,role_name,is_primary,created_by,updated_by)
    values(company_id,p_contact->>'id',account_id,p_property->>'id',btrim(p_contact->>'name'),coalesce(p_contact->>'email',''),coalesce(p_contact->>'phone',''),coalesce(p_contact->>'role_name','Property contact'),coalesce((p_contact->>'is_primary')::boolean,true),auth.uid(),auth.uid());
  end if;
  insert into public.crm_account_record_links(company_state_id,id,account_id,property_id,lead_id,job_id,relationship,created_by,updated_by)
  values(company_id,p_link->>'id',account_id,p_property->>'id',lead_id,job_id,coalesce(p_link->>'relationship','service_location'),auth.uid(),auth.uid());
  return jsonb_build_object('account_id',account_id,'property_id',p_property->>'id','job_id',job_id,'status','linked');
exception when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation or unique_violation then raise exception 'invalid_property_payload';
end;
$$;
revoke all on function public.crm_link_account_property(jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.crm_link_account_property(jsonb,jsonb,jsonb) to authenticated;

