-- Stable, company-scoped numbers reserved transactionally before record writes.
-- Existing nonblank numbers are registered unchanged; duplicate history aborts
-- migration for review rather than renumbering customer records.
begin;
create table if not exists public.crm_sales_numbers (
  company_state_id text not null, number_kind text not null check(number_kind in ('lead','project','estimate')),
  entity_id text not null, parent_id text, number_value text not null, created_by uuid references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key(company_state_id,number_kind,entity_id), unique(company_state_id,number_kind,number_value)
);
alter table public.crm_sales_numbers enable row level security;
revoke all on public.crm_sales_numbers from public,anon,authenticated;

do $$ begin
  if exists(select 1 from public.crm_records r where r.deleted_at is null and
    ((r.record_type='contact' and coalesce(r.data->>'leadNumber','')<>'' and r.data->>'leadNumber' !~ '^LD-[0-9]{8}-[0-9]{6}$') or
     (r.record_type='job' and coalesce(r.data->>'projectNumber','')<>'' and r.data->>'projectNumber' !~ '^LD-[0-9]{8}-[0-9]{6}-P[0-9]{2,}$') or
     (r.record_type='estimate' and coalesce(r.data->>'estimateNumber','')<>'' and r.data->>'estimateNumber' !~ '^EST-[0-9]{4,}$'))) then
    raise exception 'invalid_existing_sales_number' using errcode='23514'; end if;
  if exists(select 1 from (
    select company_state_id,'lead' kind,data->>'leadNumber' value from public.crm_records where record_type='contact' and deleted_at is null and coalesce(data->>'leadNumber','')<>''
    union all select company_state_id,'project',data->>'projectNumber' from public.crm_records where record_type='job' and deleted_at is null and coalesce(data->>'projectNumber','')<>''
    union all select company_state_id,'estimate',data->>'estimateNumber' from public.crm_records where record_type='estimate' and deleted_at is null and coalesce(data->>'estimateNumber','')<>''
  ) n group by company_state_id,kind,value having count(*)>1) then raise exception 'duplicate_existing_sales_number' using errcode='23505'; end if;
end $$;
insert into public.crm_sales_numbers(company_state_id,number_kind,entity_id,parent_id,number_value,created_by,created_at)
  select company_state_id,'lead',id,null,data->>'leadNumber',updated_by,created_at from public.crm_records
  where record_type='contact' and deleted_at is null and coalesce(data->>'leadNumber','')<>'' on conflict do nothing;
insert into public.crm_sales_numbers(company_state_id,number_kind,entity_id,parent_id,number_value,created_by,created_at)
  select company_state_id,'project',id,lead_id,data->>'projectNumber',updated_by,created_at from public.crm_records
  where record_type='job' and deleted_at is null and coalesce(data->>'projectNumber','')<>'' on conflict do nothing;
insert into public.crm_sales_numbers(company_state_id,number_kind,entity_id,parent_id,number_value,created_by,created_at)
  select company_state_id,'estimate',id,job_id,data->>'estimateNumber',updated_by,created_at from public.crm_records
  where record_type='estimate' and deleted_at is null and coalesce(data->>'estimateNumber','')<>'' on conflict do nothing;

create or replace function public.crm_reserve_sales_numbers(p_company text,p_lead_id text,p_job_id text default null,p_estimate_id text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); day_scope text:=to_char(clock_timestamp() at time zone 'UTC','YYYYMMDD');
  lead_number text; project_number text; estimate_number text; sequence_number bigint;
begin
  if actor is null or not coalesce(public.is_coastal_crest_user(),false) or p_company is distinct from public.crm_base_state_id()
    or coalesce(p_lead_id,'') !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$'
    or (p_job_id is not null and p_job_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$')
    or (p_estimate_id is not null and (p_job_id is null or p_estimate_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$')) then
    raise exception 'invalid_sales_number_scope' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('sales-numbers',p_company)::text,0));
  select number_value into lead_number from public.crm_sales_numbers where company_state_id=p_company and number_kind='lead' and entity_id=p_lead_id;
  if lead_number is null then
    select coalesce(max((substring(number_value from 13))::bigint),0)+1 into sequence_number from public.crm_sales_numbers
      where company_state_id=p_company and number_kind='lead' and number_value like 'LD-'||day_scope||'-%';
    lead_number:='LD-'||day_scope||'-'||lpad(sequence_number::text,6,'0');
    insert into public.crm_sales_numbers values(p_company,'lead',p_lead_id,null,lead_number,actor,clock_timestamp());
  end if;
  if p_job_id is not null then
    select number_value into project_number from public.crm_sales_numbers where company_state_id=p_company and number_kind='project' and entity_id=p_job_id;
    if project_number is null then
      select coalesce(max((substring(number_value from '-P([0-9]+)$'))::bigint),0)+1 into sequence_number from public.crm_sales_numbers
        where company_state_id=p_company and number_kind='project' and parent_id=p_lead_id;
      project_number:=lead_number||'-P'||lpad(sequence_number::text,2,'0');
      insert into public.crm_sales_numbers values(p_company,'project',p_job_id,p_lead_id,project_number,actor,clock_timestamp());
    elsif not exists(select 1 from public.crm_sales_numbers where company_state_id=p_company and number_kind='project' and entity_id=p_job_id and parent_id=p_lead_id) then
      raise exception 'project_number_parent_conflict' using errcode='23514'; end if;
  end if;
  if p_estimate_id is not null then
    select number_value into estimate_number from public.crm_sales_numbers where company_state_id=p_company and number_kind='estimate' and entity_id=p_estimate_id;
    if estimate_number is null then
      select greatest(1001,coalesce(max((substring(number_value from '^EST-([0-9]+)$'))::bigint),1000)+1) into sequence_number
        from public.crm_sales_numbers where company_state_id=p_company and number_kind='estimate';
      estimate_number:='EST-'||sequence_number;
      insert into public.crm_sales_numbers values(p_company,'estimate',p_estimate_id,p_job_id,estimate_number,actor,clock_timestamp());
    elsif not exists(select 1 from public.crm_sales_numbers where company_state_id=p_company and number_kind='estimate' and entity_id=p_estimate_id and parent_id=p_job_id) then
      raise exception 'estimate_number_parent_conflict' using errcode='23514'; end if;
  end if;
  return jsonb_build_object('leadId',p_lead_id,'jobId',p_job_id,'estimateId',p_estimate_id,'leadNumber',lead_number,
    'projectNumber',project_number,'estimateNumber',estimate_number);
end; $$;
revoke all on function public.crm_reserve_sales_numbers(text,text,text,text) from public,anon;
grant execute on function public.crm_reserve_sales_numbers(text,text,text,text) to authenticated;

create or replace function public.crm_validate_sales_numbers() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text; assigned_number text; parent text;
begin
  if new.record_type='contact' then kind:='lead'; assigned_number:=new.data->>'leadNumber'; parent:=null;
  elsif new.record_type='job' then kind:='project'; assigned_number:=new.data->>'projectNumber'; parent:=new.lead_id;
  elsif new.record_type='estimate' then kind:='estimate'; assigned_number:=new.data->>'estimateNumber'; parent:=new.job_id;
  else return new; end if;
  if tg_op='UPDATE' and coalesce(old.data->>(case kind when 'lead' then 'leadNumber' when 'project' then 'projectNumber' else 'estimateNumber' end),'')<>''
    and assigned_number is distinct from old.data->>(case kind when 'lead' then 'leadNumber' when 'project' then 'projectNumber' else 'estimateNumber' end) then
    raise exception 'sales_number_is_immutable' using errcode='23514'; end if;
  if coalesce(assigned_number,'')<>'' and not exists(select 1 from public.crm_sales_numbers n where n.company_state_id=new.company_state_id
    and n.number_kind=kind and n.entity_id=new.id and n.number_value=assigned_number and n.parent_id is not distinct from parent) then
    raise exception 'sales_number_not_reserved' using errcode='23514'; end if;
  if new.record_type='estimate' and (coalesce(new.data->>'leadNumber','')<>'' or coalesce(new.data->>'projectNumber','')<>'') and not (
    exists(select 1 from public.crm_sales_numbers n where n.company_state_id=new.company_state_id and n.number_kind='lead'
      and n.entity_id=new.lead_id and n.number_value=new.data->>'leadNumber') and
    exists(select 1 from public.crm_sales_numbers n where n.company_state_id=new.company_state_id and n.number_kind='project'
      and n.entity_id=new.job_id and n.parent_id=new.lead_id and n.number_value=new.data->>'projectNumber')) then
    raise exception 'estimate_sales_numbers_do_not_match' using errcode='23514'; end if;
  return new;
end; $$;
drop trigger if exists crm_validate_sales_numbers on public.crm_records;
create trigger crm_validate_sales_numbers before insert or update on public.crm_records for each row execute function public.crm_validate_sales_numbers();
revoke all on function public.crm_validate_sales_numbers() from public,anon,authenticated;
commit;
