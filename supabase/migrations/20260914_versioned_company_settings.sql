-- Apply after both 20260914 record-write and settings-permission migrations.
-- Deploy with the matching client in a coordinated maintenance window.
-- Existing settings and legacy document metadata are retained.
begin;

alter table public.crm_state
  add column if not exists version integer not null default 1 check (version > 0);

create table if not exists public.crm_company_settings_receipts (
  company_state_id text not null,
  actor_user_id uuid not null references auth.users(id),
  request_id text not null,
  payload_hash text not null,
  previous_data jsonb,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (company_state_id, actor_user_id, request_id)
);
alter table public.crm_company_settings_receipts enable row level security;
revoke all on public.crm_company_settings_receipts from public, anon, authenticated;

create or replace function public.crm_commit_company_settings(
  p_request_id text, p_expected_version integer, p_data jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  company text := public.crm_base_state_id();
  settings_id text := company || ':company';
  digest text := pg_catalog.md5(jsonb_build_object('version',p_expected_version,'data',p_data)::text);
  receipt public.crm_company_settings_receipts%rowtype;
  previous public.crm_state%rowtype;
  saved public.crm_state%rowtype;
  result jsonb;
  exists_before boolean;
begin
  if actor is null or not coalesce(public.is_coastal_crest_user(), false)
    or not coalesce(public.is_crm_admin(), false) then
    raise exception 'admin_required_for_settings' using errcode = '42501';
  end if;
  if p_request_id is null or length(p_request_id) not between 1 and 128
    or p_expected_version is null or p_expected_version < 0
    or jsonb_typeof(p_data) is distinct from 'object'
    or jsonb_typeof(p_data->'company') is distinct from 'object'
    or pg_catalog.octet_length(p_data::text) > 8388608 then
    raise exception 'invalid_settings_commit' using errcode = '22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_data) k where k <> 'company') then
    raise exception 'settings_only' using errcode = '22023';
  end if;

  -- Serializes both first creation and updates, including different admins.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm-settings:' || company, 0));
  select * into receipt from public.crm_company_settings_receipts
    where company_state_id=company and actor_user_id=actor and request_id=p_request_id;
  if found then
    if receipt.payload_hash <> digest then
      raise exception 'request_id_reused' using errcode = '22023';
    end if;
    return receipt.response;
  end if;
  select * into previous from public.crm_state where id=settings_id for update;
  exists_before := found;
  if (exists_before and previous.version <> p_expected_version)
    or (not exists_before and p_expected_version <> 0) then
    raise exception 'settings_conflict' using errcode = '40001';
  end if;
  if exists_before then
    update public.crm_state set data=previous.data || p_data,
      version=previous.version+1, owner_id=null, owner_email='', updated_by=actor,
      updated_at=clock_timestamp()
    where id=settings_id returning * into saved;
  else
    insert into public.crm_state(id,data,version,owner_id,owner_email,updated_by)
      values(settings_id,p_data,1,null,'',actor) returning * into saved;
  end if;
  -- Same validated envelope as record saves, without fabricating a lead record.
  result := jsonb_build_object('rows',jsonb_build_array(jsonb_build_object(
    'company_state_id',company,'record_type','company','id',settings_id,
    'version',saved.version,'data',p_data,'deleted_at',null)), 'audit_ids','[]'::jsonb);
  insert into public.crm_company_settings_receipts(
    company_state_id,actor_user_id,request_id,payload_hash,previous_data,response
  ) values(company,actor,p_request_id,digest,previous.data,result);
  return result;
end;
$$;
revoke all on function public.crm_commit_company_settings(text,integer,jsonb) from public, anon;
grant execute on function public.crm_commit_company_settings(text,integer,jsonb) to authenticated;

-- Admins also use the versioned RPC. Preserve existing reads/private-state policy.
drop policy if exists "Company settings require versioned insert" on public.crm_state;
create policy "Company settings require versioned insert" on public.crm_state
  as restrictive for insert to authenticated
  with check (id <> public.crm_base_state_id() || ':company');
drop policy if exists "Company settings require versioned update" on public.crm_state;
create policy "Company settings require versioned update" on public.crm_state
  as restrictive for update to authenticated
  using (id <> public.crm_base_state_id() || ':company')
  with check (id <> public.crm_base_state_id() || ':company');
commit;
