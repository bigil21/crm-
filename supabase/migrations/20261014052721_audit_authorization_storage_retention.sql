-- Local audit repair migration. Review and stage before any production apply.
begin;

-- Keep helper resolution deterministic even if a caller changes search_path.
alter function public.crm_base_state_id() set search_path = '';
alter function public.is_coastal_crest_user() set search_path = '';
alter function public.crm_app_role() set search_path = '';
alter function public.is_crm_admin() set search_path = '';
alter function public.can_manage_team_crm() set search_path = '';
alter function public.set_updated_at() set search_path = '';

-- Approval and roles are server-owned. Existing company accounts are retained;
-- future signups receive no CRM access until a trusted administrator approves
-- them in this registry.
create table if not exists public.crm_user_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'viewer' check (role in ('admin','office_manager','sales_manager','operations_manager','sales','production','viewer')),
  approved boolean not null default false,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.crm_user_access(user_id,email,role,approved,approved_at)
select id,lower(email),
  case when replace(replace(lower(trim(coalesce(raw_app_meta_data->>'role','viewer'))),'-','_'),' ','_')
    in ('admin','office_manager','sales_manager','operations_manager','sales','production','viewer')
    then replace(replace(lower(trim(coalesce(raw_app_meta_data->>'role','viewer'))),'-','_'),' ','_') else 'viewer' end,
  true,clock_timestamp()
from auth.users where lower(coalesce(email,'')) like '%@coastalcrestroofing.com'
on conflict(user_id) do nothing;

alter table public.crm_user_access enable row level security;
drop policy if exists "Users read own CRM access" on public.crm_user_access;
drop policy if exists "CRM admins read access registry" on public.crm_user_access;
create policy "Users read own CRM access" on public.crm_user_access for select to authenticated using (user_id=(select auth.uid()));
create policy "CRM admins read access registry" on public.crm_user_access for select to authenticated using (public.is_crm_admin());
revoke insert,update,delete on public.crm_user_access from public,anon,authenticated;

create or replace function public.is_coastal_crest_user() returns boolean
language sql stable security definer set search_path=''
as $$ select exists(select 1 from public.crm_user_access where user_id=auth.uid() and approved and lower(email)=lower(coalesce(auth.jwt()->>'email',''))) $$;
create or replace function public.crm_app_role() returns text
language sql stable security definer set search_path=''
as $$ select coalesce((select role from public.crm_user_access where user_id=auth.uid() and approved),'viewer') $$;
create or replace function public.crm_access_profile() returns jsonb
language sql stable security definer set search_path=''
as $$ select jsonb_build_object('approved',coalesce(a.approved,false),'role',coalesce(a.role,'viewer'),'email',coalesce(a.email,''))
  from (select 1) seed left join public.crm_user_access a on a.user_id=auth.uid() $$;
revoke all on function public.crm_access_profile() from public,anon;
grant execute on function public.crm_access_profile() to authenticated;
create or replace function public.is_crm_admin() returns boolean
language sql stable security definer set search_path=''
as $$ select public.crm_app_role() = 'admin' $$;

drop policy if exists "Company users read durable CRM records" on public.crm_records;
drop policy if exists "Approved users read assigned CRM records" on public.crm_records;
create policy "Approved users read assigned CRM records" on public.crm_records for select to authenticated
using (public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id());
drop policy if exists "Company users read conversation messages" on public.crm_conversation_messages;
drop policy if exists "Approved users read assigned conversations" on public.crm_conversation_messages;
create policy "Approved users read assigned conversations" on public.crm_conversation_messages for select to authenticated
using (public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id());
drop policy if exists "Company users read CRM audit events" on public.crm_audit_events;
drop policy if exists "Approved users read assigned audit history" on public.crm_audit_events;
create policy "Approved users read assigned audit history" on public.crm_audit_events for select to authenticated
using (public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id());

-- OAuth state is one-time and server-owned. Deleting the matching row before a
-- token exchange makes callback replay fail across instances and restarts.
create table if not exists public.crm_oauth_states (
  state_hash text primary key check (state_hash ~ '^[0-9a-f]{64}$'),
  company_state_id text not null,
  provider text not null check (provider in ('google','zoho')),
  crm_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.crm_oauth_states enable row level security;
revoke all on public.crm_oauth_states from public,anon,authenticated;
grant all on public.crm_oauth_states to service_role;
create index if not exists crm_oauth_states_expiry_idx on public.crm_oauth_states(expires_at);

-- New IDs must remain safe in HTML attributes and trusted server paths. Old
-- rows are not destroyed by this rollout; the client quarantines any legacy
-- invalid identifier instead of rendering it.
do $$ begin
  if not exists(select 1 from pg_constraint where conname='crm_records_safe_id') then
    alter table public.crm_records add constraint crm_records_safe_id
      check(id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$') not valid;
  end if;
end $$;

create or replace function public.crm_assert_job_stage_transition(p_change jsonb,p_changes jsonb)
returns void language plpgsql security definer set search_path=''
as $$
declare
  old_row public.crm_records%rowtype;
  old_status text; new_status text; lead text; job_data jsonb; contact_data jsonb; stage_data jsonb;
  stages text[] := array['New','Contacted','Inspection','Estimate Sent','Won','Scheduled','Materials Ordered','In Progress','Completed','Paid'];
  required_keys text[]; key text; old_index integer; new_index integer; estimate_ready boolean := false;
begin
  if p_change->>'record_type' <> 'job' or coalesce(p_change->>'operation','upsert') <> 'upsert' then return; end if;
  select * into old_row from public.crm_records where company_state_id=public.crm_base_state_id()
    and record_type='job' and id=p_change->>'id';
  if not found then
    if coalesce(p_change->'data'->>'status','New') <> 'New' then
      raise exception 'new_job_must_start_new' using errcode='23514';
    end if;
    return;
  end if;
  old_status := coalesce(old_row.data->>'status','New');
  new_status := coalesce(p_change->'data'->>'status',old_status);
  if new_status = old_status or new_status = 'Lost' then return; end if;
  old_index := array_position(stages,old_status); new_index := array_position(stages,new_status);
  if old_index is null or new_index is null or new_index <> old_index + 1 then
    raise exception 'invalid_stage_transition' using errcode='23514';
  end if;
  lead := coalesce(nullif(p_change->>'lead_id',''),old_row.lead_id);
  select c.value->'data' into contact_data from jsonb_array_elements(p_changes) c(value)
    where c.value->>'record_type'='contact' and c.value->>'id'=lead and coalesce(c.value->>'operation','upsert')='upsert' limit 1;
  if contact_data is null then
    select data into contact_data from public.crm_records where company_state_id=public.crm_base_state_id()
      and record_type='contact' and id=lead and deleted_at is null;
  end if;
  if contact_data is null then raise exception 'stage_contact_required' using errcode='23514'; end if;
  job_data := p_change->'data';
  stage_data := coalesce(jsonb_extract_path(contact_data,'workflowChecklists',p_change->>'id',old_status),'{}'::jsonb);
  required_keys := case old_status
    when 'Contacted' then array['customer-reached','decision-maker','needs-documented','inspection-scheduled','project-path']
    when 'Inspection' then array['inspection-complete','photos-measurements','findings-documented','scope-selected']
    when 'Estimate Sent' then array['estimate-reviewed','follow-up-scheduled','objections-documented','approval-received']
    when 'Won' then array['signed-contract','deposit-terms','production-handoff','permit-review','expectations-confirmed']
    when 'Scheduled' then array['start-date','crew-assigned','supplier-confirmed','customer-notified','access-notes']
    when 'Materials Ordered' then array['order-confirmed','delivery-confirmed','crew-reconfirmed','prestart-message','prejob-plan']
    when 'In Progress' then array['work-started','progress-current','change-orders','quality-check','punch-list']
    when 'Completed' then array['completion-photos','final-invoice','warranty-docs','walkthrough','final-payment']
    else array[]::text[] end;
  foreach key in array required_keys loop
    if coalesce((stage_data->>key)::boolean,false) is not true then
      raise exception 'workflow_checklist_incomplete' using errcode='23514';
    end if;
  end loop;
  if old_status='New' and not (
    length(trim(coalesce(contact_data->>'name','')))>0 and length(trim(coalesce(contact_data->>'phone','')))>0 and
    length(trim(coalesce(contact_data->>'email','')))>0 and length(trim(coalesce(contact_data->>'source','')))>0 and
    length(trim(coalesce(job_data->>'address',contact_data->>'address','')))>0 and
    length(trim(coalesce(job_data->>'salesRep',contact_data->>'salesRep','')))>0 and
    coalesce(job_data->>'salesRep',contact_data->>'salesRep','')<>'Unassigned' and
    length(trim(coalesce(job_data->>'notes',contact_data->>'notes','')))>0
  ) then raise exception 'workflow_checklist_incomplete' using errcode='23514'; end if;
  if old_status='Inspection' then
    select exists(
      select 1 from public.crm_records where company_state_id=public.crm_base_state_id() and record_type='estimate'
        and job_id=p_change->>'id' and deleted_at is null
      union all
      select 1 from jsonb_array_elements(p_changes) c(value) where c.value->>'record_type'='estimate'
        and c.value->>'job_id'=p_change->>'id' and coalesce(c.value->>'operation','upsert')='upsert'
    ) into estimate_ready;
    if not estimate_ready then raise exception 'workflow_checklist_incomplete' using errcode='23514'; end if;
  end if;
  if old_status='Estimate Sent' then
    select exists(
      select 1 from public.crm_records where company_state_id=public.crm_base_state_id() and record_type='estimate'
        and job_id=p_change->>'id' and deleted_at is null and data->>'status' in ('Sent','Won')
      union all
      select 1 from jsonb_array_elements(p_changes) c(value) where c.value->>'record_type'='estimate'
        and c.value->>'job_id'=p_change->>'id' and c.value->'data'->>'status' in ('Sent','Won')
    ) into estimate_ready;
    if not estimate_ready then raise exception 'workflow_checklist_incomplete' using errcode='23514'; end if;
  end if;
end;
$$;
revoke all on function public.crm_assert_job_stage_transition(jsonb,jsonb) from public,anon,authenticated;

-- Preserve the reviewed conflict-safe implementation behind an authorization
-- wrapper. Managers can reassign owner_id; individual contributors can change
-- only their assigned records; viewers cannot write.
do $$ begin
  if to_regprocedure('public.crm_commit_records_authorized_legacy(text,jsonb,jsonb)') is null then
    alter function public.crm_commit_records(text,jsonb,jsonb) rename to crm_commit_records_authorized_legacy;
  end if;
end $$;
revoke all on function public.crm_commit_records_authorized_legacy(text,jsonb,jsonb) from public,anon,authenticated;

create or replace function public.crm_commit_records(p_request_id text,p_changes jsonb,p_events jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  actor uuid := auth.uid(); role_name text := public.crm_app_role(); change jsonb;
  previous_owner uuid; exists_before boolean; allowed boolean; result jsonb; corrected jsonb;
begin
  if actor is null or not public.is_coastal_crest_user() then raise exception 'authentication_required' using errcode='42501'; end if;
  if public.is_crm_admin() then role_name := 'admin'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then raise exception 'invalid_commit' using errcode='22023'; end if;
  for change in select value from jsonb_array_elements(p_changes) loop
    if coalesce(change->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$' then
      raise exception 'invalid_record_id' using errcode='22023';
    end if;
    select owner_id into previous_owner from public.crm_records
      where company_state_id=public.crm_base_state_id() and record_type=change->>'record_type' and id=change->>'id';
    exists_before := found;
    allowed := case
      when role_name in ('admin','office_manager') then true
      when role_name='sales_manager' then change->>'record_type' in ('contact','job','estimate','task','document')
      when role_name='operations_manager' then change->>'record_type' in ('contact','job','task','document')
      when role_name='sales' then (not exists_before or previous_owner=actor)
      when role_name='production' then change->>'record_type' in ('job','task','document') and (not exists_before or previous_owner=actor)
      else false end;
    if not allowed then raise exception 'record_access_denied' using errcode='42501'; end if;
    if role_name in ('sales','production') and not exists_before and nullif(change->>'owner_id','') is not null
       and (change->>'owner_id')::uuid <> actor then raise exception 'record_owner_spoofed' using errcode='42501'; end if;
    perform public.crm_assert_job_stage_transition(change,p_changes);
  end loop;
  result := public.crm_commit_records_authorized_legacy(p_request_id,p_changes,p_events);
  if role_name in ('admin','office_manager','sales_manager','operations_manager') then
    for change in select value from jsonb_array_elements(p_changes) loop
      if coalesce(change->>'operation','upsert')='upsert' and nullif(change->>'owner_id','') is not null then
        update public.crm_records set owner_id=(change->>'owner_id')::uuid
          where company_state_id=public.crm_base_state_id() and record_type=change->>'record_type' and id=change->>'id';
      end if;
    end loop;
  end if;
  select coalesce(jsonb_agg(to_jsonb(r) order by c.ordinality),'[]'::jsonb) into corrected
    from jsonb_array_elements(p_changes) with ordinality c(change,ordinality)
    join public.crm_records r on r.company_state_id=public.crm_base_state_id()
      and r.record_type=c.change->>'record_type' and r.id=c.change->>'id';
  return jsonb_set(result,'{rows}',corrected,true);
end;
$$;
revoke all on function public.crm_commit_records(text,jsonb,jsonb) from public,anon;
grant execute on function public.crm_commit_records(text,jsonb,jsonb) to authenticated;

-- CRM file revisions are immutable. Browser users may read existing objects and
-- append a new version under the one company prefix, but may never overwrite or
-- delete bytes. Retention/removal is a service-role maintenance operation.
drop policy if exists "Company users read CRM document objects" on storage.objects;
drop policy if exists "Company users upload CRM document objects" on storage.objects;
drop policy if exists "Company users update CRM document objects" on storage.objects;
drop policy if exists "Company users delete CRM document objects" on storage.objects;
drop policy if exists "Approved CRM users read company document objects" on storage.objects;
drop policy if exists "Approved CRM users append company document objects" on storage.objects;

create policy "Approved CRM users read company document objects"
on storage.objects for select to authenticated
using (
  bucket_id = 'crm-documents'
  and public.is_coastal_crest_user()
  and (storage.foldername(name))[1] = public.crm_base_state_id()
);

create policy "Approved CRM users append company document objects"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'crm-documents'
  and public.is_coastal_crest_user()
  and (storage.foldername(name))[1] = public.crm_base_state_id()
  and owner_id = (select auth.uid())::text
);

-- Audit history is written only by the versioned commit RPC, which derives the
-- actor from auth.uid(). Direct inserts previously allowed spoofed actor names.
create or replace function public.crm_protect_audit_event()
returns trigger language plpgsql security invoker set search_path=''
as $$ begin
  new.actor_user_id := auth.uid();
  new.actor_name := lower(coalesce(auth.jwt()->>'email','CRM user'));
  new.created_at := clock_timestamp();
  return new;
end $$;
drop trigger if exists crm_protect_audit_event on public.crm_audit_events;
create trigger crm_protect_audit_event before insert on public.crm_audit_events
for each row execute function public.crm_protect_audit_event();
revoke execute on function public.crm_protect_audit_event() from public,anon,authenticated;
drop policy if exists "Company users create CRM audit events" on public.crm_audit_events;
revoke insert, update, delete on public.crm_audit_events from public, anon, authenticated;

-- Conversation message identity and contents become immutable at insertion.
-- Existing read-receipt updates remain possible through the read_by field.
create or replace function public.crm_protect_conversation_message()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.author_user_id := (select auth.uid())::text;
    new.author_email := lower(coalesce(auth.jwt()->>'email', ''));
    new.author_name := new.author_email;
    new.author_role := public.crm_app_role();
    new.created_at := clock_timestamp();
    new.updated_at := new.created_at;
  else
    new.id := old.id;
    new.company_state_id := old.company_state_id;
    new.lead_id := old.lead_id;
    new.job_id := old.job_id;
    new.contact_name := old.contact_name;
    new.job_name := old.job_name;
    new.job_status := old.job_status;
    new.author_user_id := old.author_user_id;
    new.author_email := old.author_email;
    new.author_name := old.author_name;
    new.author_role := old.author_role;
    new.message_text := old.message_text;
    new.mentions := old.mentions;
    new.created_at := old.created_at;
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists crm_protect_conversation_message on public.crm_conversation_messages;
create trigger crm_protect_conversation_message
before insert or update on public.crm_conversation_messages
for each row execute function public.crm_protect_conversation_message();

revoke execute on function public.crm_protect_conversation_message() from public, anon, authenticated;

-- Operational rows are bounded without erasing business notes, payment events,
-- or user-authored history. A trusted scheduler/service invokes this function.
create index if not exists crm_audit_record_commit_retention_idx
  on public.crm_audit_events(created_at) where event_type = 'record_commit';
create index if not exists crm_write_receipts_retention_idx on public.crm_write_receipts(created_at);
create index if not exists crm_backups_retention_idx on public.crm_backups(created_at);

create or replace function public.crm_prune_operational_history()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_count integer;
  receipt_count integer;
  backup_count integer;
begin
  delete from public.crm_audit_events
    where event_type = 'record_commit' and created_at < clock_timestamp() - interval '90 days';
  get diagnostics audit_count = row_count;
  delete from public.crm_write_receipts
    where created_at < clock_timestamp() - interval '30 days';
  get diagnostics receipt_count = row_count;
  delete from public.crm_backups
    where created_at < clock_timestamp() - interval '30 days';
  get diagnostics backup_count = row_count;
  delete from public.crm_oauth_states where expires_at < clock_timestamp();
  return jsonb_build_object('recordCommits', audit_count, 'writeReceipts', receipt_count, 'backups', backup_count);
end;
$$;

revoke all on function public.crm_prune_operational_history() from public, anon, authenticated;
grant execute on function public.crm_prune_operational_history() to service_role;

commit;
