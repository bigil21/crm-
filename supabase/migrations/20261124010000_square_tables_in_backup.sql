-- Lets the server's daily backup hold the five Square tables.
--
-- Those tables are closed to every role, the server's own key included: all
-- reading and writing goes through the database's Square functions. That is on
-- purpose and stays as it is. It also meant the daily backup, which the server
-- makes with that key, could not read them, so they were in no backup.
--
-- What is lost without them: when Square invoicing was switched on for each
-- environment (crm_square_invoice_policy.installed_at). A database rebuilt from
-- a backup gets a new date there, and every estimate made before that date
-- then needs a written review before it can be invoiced. Also the reviews
-- themselves, invoices in the middle of being sent, how far each invoice's
-- notices have been applied, and the queue of notices from Square.
--
-- This adds one function, in the same style as the others: it runs only for
-- the server's key, only for this company, and it only reads. It hands over
-- one of the five tables a page at a time, in the order of the table's own key,
-- together with the table's row count, so the backup can tell that it has every
-- row. No table's permissions change, and nothing is written.

create or replace function public.crm_square_backup_page(p_company text, p_table text, p_offset integer, p_limit integer)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  total bigint;
  page jsonb;
begin
  perform public.crm_square_require_service();
  if p_company is null or p_company is distinct from public.crm_base_state_id() then
    raise exception 'company_required' using errcode = '42501';
  end if;
  if p_offset is null or p_offset < 0 or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid_backup_page' using errcode = '22023';
  end if;

  -- The function is "stable": the count and the rows are read from the same
  -- moment, so a row arriving while it runs is in both or in neither.
  if p_table = 'crm_square_invoice_policy' then
    select count(*) into total from public.crm_square_invoice_policy t where t.company_state_id = p_company;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.environment), '[]'::jsonb) into page from (
      select t.* from public.crm_square_invoice_policy t where t.company_state_id = p_company
      order by t.environment offset p_offset limit p_limit) q;
  elsif p_table = 'crm_square_invoice_reviews' then
    select count(*) into total from public.crm_square_invoice_reviews t where t.company_state_id = p_company;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.environment, q.estimate_id), '[]'::jsonb) into page from (
      select t.* from public.crm_square_invoice_reviews t where t.company_state_id = p_company
      order by t.environment, t.estimate_id offset p_offset limit p_limit) q;
  elsif p_table = 'crm_square_invoice_intents' then
    select count(*) into total from public.crm_square_invoice_intents t where t.company_state_id = p_company;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.id), '[]'::jsonb) into page from (
      select t.* from public.crm_square_invoice_intents t where t.company_state_id = p_company
      order by t.id offset p_offset limit p_limit) q;
  elsif p_table = 'crm_square_invoice_watermarks' then
    select count(*) into total from public.crm_square_invoice_watermarks t where t.company_state_id = p_company;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.environment, q.merchant_id, q.invoice_id), '[]'::jsonb) into page from (
      select t.* from public.crm_square_invoice_watermarks t where t.company_state_id = p_company
      order by t.environment, t.merchant_id, t.invoice_id offset p_offset limit p_limit) q;
  elsif p_table = 'crm_square_webhook_events' then
    select count(*) into total from public.crm_square_webhook_events t where t.company_state_id = p_company;
    select coalesce(jsonb_agg(to_jsonb(q) order by q.environment, q.merchant_id, q.event_id), '[]'::jsonb) into page from (
      select t.* from public.crm_square_webhook_events t where t.company_state_id = p_company
      order by t.environment, t.merchant_id, t.event_id offset p_offset limit p_limit) q;
  else
    raise exception 'not_a_square_table' using errcode = '22023';
  end if;

  return jsonb_build_object('total', total, 'rows', page);
end;
$$;

revoke all on function public.crm_square_backup_page(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.crm_square_backup_page(text, text, integer, integer) to service_role;

-- Raw provider records must never be stored in the manager-readable backup.
-- This schema is not exposed by PostgREST. Even direct SQL as a CRM role has
-- no schema or table access. The parent's retention policy owns both halves.
create schema if not exists jobcrest_backup_private;
revoke all on schema jobcrest_backup_private from public, anon, authenticated, service_role;
create table if not exists jobcrest_backup_private.square_snapshots (
  backup_id bigint primary key references public.crm_backups(id) on delete cascade,
  snapshot_id uuid not null,
  tables jsonb not null check (jsonb_typeof(tables) = 'object')
);
alter table jobcrest_backup_private.square_snapshots enable row level security;
revoke all on jobcrest_backup_private.square_snapshots from public, anon, authenticated, service_role;

alter table public.crm_backups drop constraint if exists crm_backups_no_square_tables;
alter table public.crm_backups add constraint crm_backups_no_square_tables check (
  not ((payload->'tables') ?| array['crm_square_invoice_policy','crm_square_invoice_reviews',
    'crm_square_invoice_intents','crm_square_invoice_watermarks','crm_square_webhook_events']));
drop policy if exists "Only server backups carry a private snapshot" on public.crm_backups;
create policy "Only server backups carry a private snapshot" on public.crm_backups
  as restrictive for insert to authenticated with check (not (payload ? 'privateSquareSnapshot'));
drop policy if exists "Preserve linked server backups" on public.crm_backups;
create policy "Preserve linked server backups" on public.crm_backups as restrictive for update to authenticated
  using (not (payload ? 'privateSquareSnapshot')) with check (not (payload ? 'privateSquareSnapshot'));

create or replace function public.crm_store_split_backup(p_backup jsonb, p_replace boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  company text := p_backup->>'company_state_id';
  body jsonb := p_backup->'payload';
  data_tables jsonb := body->'tables';
  private_tables jsonb := '{}'::jsonb;
  slot uuid := gen_random_uuid();
  saved_id bigint;
  k text;
begin
  perform public.crm_square_require_service();
  if company is null or company is distinct from public.crm_base_state_id() then
    raise exception 'company_required' using errcode='42501';
  end if;
  if (body->>'schemaVersion') is distinct from '6' or (body->>'source') is distinct from 'server'
     or jsonb_typeof(data_tables) is distinct from 'object'
     or jsonb_typeof(body->'skippedTables') is distinct from 'array' then
    raise exception 'invalid_backup' using errcode='22023';
  end if;
  foreach k in array array['crm_square_invoice_policy','crm_square_invoice_reviews','crm_square_invoice_intents',
                           'crm_square_invoice_watermarks','crm_square_webhook_events'] loop
    if data_tables ? k then
      if jsonb_typeof(data_tables->k) is distinct from 'array' then raise exception 'invalid_square_backup'; end if;
      private_tables := private_tables || jsonb_build_object(k,data_tables->k);
      data_tables := data_tables - k;
    elsif not ((body->'skippedTables') ? k) then
      raise exception 'unaccounted_square_table';
    end if;
  end loop;
  body := jsonb_set(body,'{tables}',data_tables) || jsonb_build_object('privateSquareSnapshot',slot);
  insert into public.crm_backups as b(company_state_id,backup_date,record_count,payload,created_by)
    values(company,(p_backup->>'backup_date')::date,(p_backup->>'record_count')::integer,body,null)
    on conflict(company_state_id,backup_date) do update set
      record_count=excluded.record_count, payload=excluded.payload, created_by=null
    where p_replace and body->'skippedTables'='[]'::jsonb and not
      (b.payload ? 'privateSquareSnapshot' and coalesce(b.payload->'skippedTables','null'::jsonb)='[]'::jsonb)
    returning id into saved_id;
  if saved_id is null then return false; end if;
  insert into jobcrest_backup_private.square_snapshots(backup_id,snapshot_id,tables)
    values(saved_id,slot,private_tables) on conflict(backup_id) do update set
      snapshot_id=excluded.snapshot_id,tables=excluded.tables;
  return true;
end;
$$;
revoke all on function public.crm_store_split_backup(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.crm_store_split_backup(jsonb,boolean) to service_role;

create or replace function public.crm_private_square_snapshot(p_company text,p_day date,p_snapshot uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  perform public.crm_square_require_service();
  if p_company is null or p_company is distinct from public.crm_base_state_id() then
    raise exception 'company_required' using errcode='42501';
  end if;
  select s.tables into strict result from jobcrest_backup_private.square_snapshots s
    join public.crm_backups b on b.id=s.backup_id where b.company_state_id=p_company and b.backup_date=p_day
    and s.snapshot_id=p_snapshot and b.payload->>'privateSquareSnapshot'=p_snapshot::text;
  return result;
end;
$$;
revoke all on function public.crm_private_square_snapshot(text,date,uuid) from public,anon,authenticated;
grant execute on function public.crm_private_square_snapshot(text,date,uuid) to service_role;
