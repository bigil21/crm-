-- Keep idempotency receipts small. The caller already resubmits the identical
-- validated payload on a retry, so storing two complete copies of company
-- settings in every receipt is unnecessary.

alter table public.crm_company_settings_receipts
  add column if not exists saved_version integer;

alter table public.crm_company_settings_receipts
  drop constraint if exists crm_company_settings_receipts_saved_version_check;
alter table public.crm_company_settings_receipts
  add constraint crm_company_settings_receipts_saved_version_check
  check (saved_version is null or saved_version > 0);

alter table public.crm_company_settings_receipts
  alter column previous_data drop not null;

create index if not exists crm_company_settings_receipts_created_at_idx
  on public.crm_company_settings_receipts(created_at);

create or replace function public.crm_commit_company_settings(
  p_request_id text,
  p_expected_version integer,
  p_data jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
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
  receipt_version integer;
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('crm-settings:' || company, 0));
  select * into receipt from public.crm_company_settings_receipts
    where company_state_id=company and actor_user_id=actor and request_id=p_request_id;
  if found then
    if receipt.payload_hash <> digest then
      raise exception 'request_id_reused' using errcode = '22023';
    end if;
    receipt_version := coalesce(
      receipt.saved_version,
      nullif(receipt.response#>>'{rows,0,version}', '')::integer
    );
    if receipt_version is null then return receipt.response; end if;
    return jsonb_build_object('rows',jsonb_build_array(jsonb_build_object(
      'company_state_id',company,'record_type','company','id',settings_id,
      'version',receipt_version,'data',p_data,'deleted_at',null)), 'audit_ids','[]'::jsonb);
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

  result := jsonb_build_object('rows',jsonb_build_array(jsonb_build_object(
    'company_state_id',company,'record_type','company','id',settings_id,
    'version',saved.version,'data',p_data,'deleted_at',null)), 'audit_ids','[]'::jsonb);
  insert into public.crm_company_settings_receipts(
    company_state_id,actor_user_id,request_id,payload_hash,previous_data,response,saved_version
  ) values(
    company,actor,p_request_id,digest,null,
    jsonb_build_object('version',saved.version),saved.version
  );
  return result;
end;
$$;

revoke all on function public.crm_commit_company_settings(text,integer,jsonb) from public, anon;
grant execute on function public.crm_commit_company_settings(text,integer,jsonb) to authenticated;

-- This function is deliberately not scheduled. Applying the migration changes
-- no historical rows. An operator must preview the cutoff and invoke it with
-- service-role credentials after a recovery export has been retained.
create or replace function public.crm_prune_company_settings_receipts(
  p_before timestamptz default now() - interval '30 days'
) returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count bigint;
begin
  if p_before is null or p_before > now() - interval '1 day' then
    raise exception 'invalid_settings_receipt_cutoff' using errcode = '22023';
  end if;
  delete from public.crm_company_settings_receipts where created_at < p_before;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.crm_prune_company_settings_receipts(timestamptz)
  from public, anon, authenticated;
grant execute on function public.crm_prune_company_settings_receipts(timestamptz)
  to service_role;
