-- Reviewed rollout required: deploy compatible clients alongside this migration.
-- No business rows are deleted, renumbered, or backfilled by this migration.
begin;

create table if not exists public.crm_write_receipts (
  company_state_id text not null,
  actor_user_id uuid not null references auth.users(id),
  request_id text not null,
  payload_hash text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (company_state_id, actor_user_id, request_id)
);
alter table public.crm_write_receipts enable row level security;
revoke all on public.crm_write_receipts from public, anon, authenticated;

create or replace function public.crm_commit_records(
  p_request_id text, p_changes jsonb, p_events jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  company text := public.crm_base_state_id();
  admin boolean := coalesce(public.is_crm_admin(), false);
  digest text := pg_catalog.md5(p_changes::text || p_events::text);
  receipt public.crm_write_receipts%rowtype;
  previous public.crm_records%rowtype;
  saved public.crm_records%rowtype;
  change jsonb;
  event jsonb;
  incoming jsonb;
  old_data jsonb;
  field text;
  expected integer;
  expected_percent numeric;
  effective_paid numeric;
  manual_paid numeric;
  result jsonb := '[]'::jsonb;
  event_ids jsonb := '[]'::jsonb;
  exists_before boolean;
  removing boolean;
begin
  if actor is null or not coalesce(public.is_coastal_crest_user(), false) then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_request_id is null or length(p_request_id) not between 1 and 128 or
     jsonb_typeof(p_changes) is distinct from 'array' or jsonb_typeof(p_events) is distinct from 'array' then
    raise exception 'invalid_commit' using errcode = '22023';
  end if;
  if jsonb_array_length(p_changes) > 1000 or jsonb_array_length(p_events) > 2000 then
    raise exception 'commit_too_large' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(company || actor::text || p_request_id, 0));
  select * into receipt from public.crm_write_receipts
    where company_state_id = company and actor_user_id = actor and request_id = p_request_id;
  if found then
    if receipt.payload_hash <> digest then raise exception 'request_id_reused' using errcode = '22023'; end if;
    return receipt.response;
  end if;
  if exists (select 1 from jsonb_array_elements(p_changes) c
    group by c->>'record_type', c->>'id' having count(*) > 1) then
    raise exception 'duplicate_record_in_commit' using errcode = '22023';
  end if;

  -- Lock records in a consistent order. Every row and supplied audit event is
  -- committed together, or the entire operation rolls back.
  for change in select value from jsonb_array_elements(p_changes)
    order by value->>'record_type', value->>'id'
  loop
    if change->>'company_state_id' is distinct from company or
       coalesce(change->>'id', '') = '' or
       coalesce(change->>'record_type', '') not in ('contact','job','estimate','task','document') or
       coalesce(change->>'operation','upsert') not in ('upsert','delete') or
       not coalesce((change->>'expected_version') ~ '^[0-9]+$', false) then
      raise exception 'invalid_record_scope_or_version' using errcode = '22023';
    end if;
    expected := (change->>'expected_version')::integer;
    removing := coalesce(change->>'operation','upsert') = 'delete';
    select * into previous from public.crm_records
      where company_state_id = company and record_type = change->>'record_type' and id = change->>'id'
      for update;
    exists_before := found;
    if (exists_before and (previous.version <> expected or previous.deleted_at is not null)) or
       (not exists_before and (expected <> 0 or removing)) then
      raise exception 'record_conflict' using errcode = '40001',
        detail = jsonb_build_object('record_type',change->>'record_type','id',change->>'id',
          'expected_version',expected,'current_version',previous.version)::text;
    end if;
    incoming := case when removing then previous.data else change->'data' end;
    old_data := case when exists_before then previous.data else '{}'::jsonb end;
    if jsonb_typeof(incoming) is distinct from 'object' then
      raise exception 'invalid_record_data' using errcode = '22023';
    end if;

    if change->>'record_type' in ('job','estimate') then
      if not admin then
        if coalesce(incoming->'manualPayments','[]'::jsonb) is distinct from coalesce(old_data->'manualPayments','[]'::jsonb) then
          raise exception 'admin_required_for_payments' using errcode = '42501';
        end if;
        foreach field in array array['paidAmount','squarePaidAmount','square_paid_amount'] loop
          if coalesce(incoming->field,'0'::jsonb) is distinct from coalesce(old_data->field,'0'::jsonb) then
            raise exception 'admin_required_for_payments' using errcode = '42501';
          end if;
        end loop;
        foreach field in array array['squareInvoiceId','squareOrderId','paidAt','lastPaymentAt','squareLastPaymentAt','square_last_payment_at','squareStatus','paymentUpdatedAt'] loop
          if coalesce(incoming->>field,'') is distinct from coalesce(old_data->>field,'') then
            raise exception 'admin_required_for_payments' using errcode = '42501';
          end if;
        end loop;
        if coalesce(incoming->'paymentRequests','[]'::jsonb) is distinct from coalesce(old_data->'paymentRequests','[]'::jsonb) then
          raise exception 'admin_required_for_payments' using errcode = '42501';
        end if;
        -- A contract value edit may change the percentage, but cannot invent a
        -- paid percentage unrelated to the protected collected amount.
        if incoming ? 'paymentPercent' then
          if change->>'record_type' = 'job' then
            select coalesce(sum((p->>'amount')::numeric),0) into manual_paid
              from jsonb_array_elements(case when jsonb_typeof(incoming->'manualPayments')='array'
                then incoming->'manualPayments' else '[]'::jsonb end) p;
            effective_paid := round(manual_paid + greatest(0,coalesce((incoming->>'squarePaidAmount')::numeric,
              (incoming->>'square_paid_amount')::numeric,greatest(coalesce((incoming->>'paidAmount')::numeric,0)-manual_paid,0))),2);
          elsif coalesce(incoming->>'paidAt','')<>'' and coalesce((incoming->>'paidAmount')::numeric,0)=0 then
            effective_paid := coalesce((incoming->>'contractValue')::numeric,0);
          else
            effective_paid := coalesce((incoming->>'paidAmount')::numeric,0);
          end if;
          expected_percent := case when coalesce((incoming->>'contractValue')::numeric,(incoming->>'value')::numeric,0) > 0
            then least(100,effective_paid*100 /
              coalesce((incoming->>'contractValue')::numeric,(incoming->>'value')::numeric)) else 0 end;
          if jsonb_typeof(incoming->'paymentPercent') is distinct from 'number' or
            abs((incoming->>'paymentPercent')::numeric - expected_percent) > 0.000001 then
            raise exception 'invalid_payment_percentage' using errcode = '23514';
          end if;
        end if;
      end if;
      if removing and (coalesce(old_data->'manualPayments','[]'::jsonb) <> '[]'::jsonb or
          coalesce(old_data->>'squareInvoiceId','') <> '' or coalesce((old_data->>'paidAmount')::numeric,0) <> 0) then
        raise exception 'financial_history_must_be_retained' using errcode = '23514';
      end if;
      if not removing and coalesce(incoming->'manualPayments','[]'::jsonb) is distinct from coalesce(old_data->'manualPayments','[]'::jsonb) then
        if jsonb_typeof(incoming->'manualPayments') is distinct from 'array' then
          raise exception 'invalid_payments' using errcode = '22023';
        end if;
        if exists (select 1 from jsonb_array_elements(incoming->'manualPayments') p where
          coalesce(p->>'id','') = '' or jsonb_typeof(p->'amount') is distinct from 'number' or
          (p->>'amount')::numeric <= 0 or (p->>'amount')::numeric <> round((p->>'amount')::numeric,2) or
          coalesce(p->>'date','') !~ '^\d{4}-\d{2}-\d{2}$') or
          exists(select 1 from jsonb_array_elements(incoming->'manualPayments') p group by p->>'id' having count(*)>1) then
          raise exception 'invalid_or_duplicate_payment' using errcode = '22023';
        end if;
        -- A cast rejects impossible calendar dates as well as malformed strings.
        perform (p->>'date')::date from jsonb_array_elements(incoming->'manualPayments') p;
      end if;
    end if;

    if exists_before then
      update public.crm_records set
        lead_id = case when removing then previous.lead_id else nullif(change->>'lead_id','') end,
        job_id = case when removing then previous.job_id else nullif(change->>'job_id','') end,
        data = incoming, version = previous.version + 1, updated_by = actor,
        deleted_at = case when removing then clock_timestamp() else null end,
        updated_at = clock_timestamp()
        where company_state_id=company and record_type=previous.record_type and id=previous.id
        returning * into saved;
    else
      begin
        insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,owner_id,data,version,updated_by)
        values(company,change->>'record_type',change->>'id',nullif(change->>'lead_id',''),
          nullif(change->>'job_id',''),actor,incoming,1,actor) returning * into saved;
      exception when unique_violation then
        raise exception 'record_conflict' using errcode='40001';
      end;
    end if;
    insert into public.crm_audit_events(id,company_state_id,lead_id,job_id,event_type,actor_user_id,actor_name,message,metadata)
    values('commit:' || company || ':' || actor::text || ':' || p_request_id || ':' || saved.record_type || ':' || saved.id,
      company,coalesce(saved.lead_id,saved.id),saved.job_id,'record_commit',actor,
      coalesce(auth.jwt()->>'email','CRM user'),case when removing then 'Record archived' else 'Record saved' end,
      jsonb_build_object('record_type',saved.record_type,'record_id',saved.id,'version',saved.version));
    result := result || jsonb_build_array(to_jsonb(saved));
  end loop;
  for event in select value from jsonb_array_elements(p_events) loop
    if event->>'company_state_id' is distinct from company or coalesce(event->>'id','')='' or coalesce(event->>'lead_id','')='' then
      raise exception 'invalid_audit_event' using errcode='22023';
    end if;
    if exists (select 1 from public.crm_audit_events a where a.id = event->>'id' and
      (a.company_state_id is distinct from company or a.lead_id is distinct from event->>'lead_id' or
       a.job_id is distinct from nullif(event->>'job_id','') or a.message is distinct from coalesce(event->>'message',''))) then
      raise exception 'audit_event_conflict' using errcode = '40001';
    end if;
    insert into public.crm_audit_events(id,company_state_id,lead_id,job_id,event_type,actor_user_id,actor_name,message,status,created_at)
    values(event->>'id',company,event->>'lead_id',nullif(event->>'job_id',''),coalesce(event->>'event_type','note'),actor,
      coalesce(event->>'actor_name','CRM user'),coalesce(event->>'message',''),coalesce(event->>'status',''),
      coalesce((event->>'created_at')::timestamptz,now())) on conflict(id) do nothing;
    event_ids := event_ids || jsonb_build_array(event->>'id');
  end loop;
  result := jsonb_build_object('rows',result,'audit_ids',event_ids);
  insert into public.crm_write_receipts(company_state_id,actor_user_id,request_id,payload_hash,response)
    values(company,actor,p_request_id,digest,result);
  return result;
end;
$$;

revoke all on function public.crm_commit_records(text,jsonb,jsonb) from public, anon;
grant execute on function public.crm_commit_records(text,jsonb,jsonb) to authenticated;
-- Old clients must reload. There is intentionally no unsafe direct-write fallback.
revoke insert, update, delete, truncate, references, trigger on public.crm_records from public, anon, authenticated;
grant select on public.crm_records to authenticated;
commit;
