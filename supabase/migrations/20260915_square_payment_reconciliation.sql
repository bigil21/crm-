-- Server-only reconciliation of verified Square snapshots. No historical rows
-- are backfilled and no provider calls occur inside these transactions.
begin;
alter table public.crm_square_webhook_events add column if not exists payment_applied boolean;
alter table public.crm_square_webhook_events add column if not exists payment_snapshot_hash text;

create table if not exists public.crm_square_invoice_watermarks (
  company_state_id text not null, environment text not null check(environment in ('production','sandbox')),
  merchant_id text not null, invoice_id text not null, order_id text not null, lead_id text not null, job_id text not null,
  invoice_version bigint not null check(invoice_version>=0), invoice_updated_at timestamptz not null,
  snapshot jsonb not null, applied_at timestamptz not null default clock_timestamp(),
  primary key(company_state_id,environment,merchant_id,invoice_id)
);
alter table public.crm_square_invoice_watermarks enable row level security;
revoke all on public.crm_square_invoice_watermarks from public,anon,authenticated,service_role;

create or replace function public.crm_square_payment_scope(p_company text,p_environment text,p_merchant text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public.crm_square_require_service();
  if p_company is distinct from public.crm_base_state_id() or p_environment not in ('production','sandbox') or p_environment is null
    or coalesce(p_merchant,'') !~ '^[A-Za-z0-9_:-]{1,200}$' then
    raise exception 'payment_scope_invalid' using errcode='42501'; end if;
end; $$;

create or replace function public.crm_square_claim_webhook(p_company text,p_environment text,p_merchant text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.crm_square_webhook_events%rowtype; lease uuid; version numeric; invoice_updated text; result jsonb;
begin
  perform public.crm_square_payment_scope(p_company,p_environment,p_merchant);
  for item in select * from public.crm_square_webhook_events e where e.company_state_id=p_company and e.environment=p_environment
    and e.merchant_id=p_merchant and e.status in ('pending','processing') and (e.lease_until is null or e.lease_until<=clock_timestamp())
    order by e.received_at,e.event_id limit 100 for update skip locked loop
    if item.attempts>=10 then
      update public.crm_square_webhook_events set status='review',last_error='payment_attempt_limit',lease_until=null
        where company_state_id=p_company and environment=p_environment and merchant_id=p_merchant and event_id=item.event_id;
      continue;
    end if;
    -- SKIP LOCKED alone cannot fence two different events for the same invoice.
    if not pg_try_advisory_xact_lock(hashtextextended(jsonb_build_array('square-payment',p_company,p_environment,p_merchant,item.invoice_id)::text,0)) then continue; end if;
    if exists(select 1 from public.crm_square_webhook_events e where e.company_state_id=p_company and e.environment=p_environment
      and e.merchant_id=p_merchant and e.invoice_id=item.invoice_id and e.event_id<>item.event_id and e.status='processing'
      and e.lease_until>clock_timestamp()) then continue; end if;
    lease:=gen_random_uuid();
    update public.crm_square_webhook_events set status='processing',attempts=attempts+1,lease_id=lease,
      lease_until=clock_timestamp()+interval '5 minutes',last_error=null
      where company_state_id=p_company and environment=p_environment and merchant_id=p_merchant and event_id=item.event_id returning * into item;
    result:=jsonb_build_object('companyId',p_company,'environment',p_environment,'merchantId',p_merchant,'eventId',item.event_id,
      'invoiceId',item.invoice_id,'leaseId',lease,'attempts',item.attempts,'eventCreatedAt',item.event_created_at);
    if jsonb_typeof(item.payload->'data'->'object'->'invoice'->'version')='number' then
      version:=(item.payload->'data'->'object'->'invoice'->>'version')::numeric;
      if version>=0 and version<=9007199254740991 and version=trunc(version) then result:=result||jsonb_build_object('invoiceVersion',version); end if;
    end if;
    invoice_updated:=item.payload->'data'->'object'->'invoice'->>'updated_at';
    begin
      if invoice_updated ~ '^\d{4}-\d{2}-\d{2}T' and isfinite(invoice_updated::timestamptz) then
        result:=result||jsonb_build_object('invoiceUpdatedAt',invoice_updated);
      end if;
    exception when others then null; end;
    return result;
  end loop;
  return null;
end; $$;

create or replace function public.crm_square_fail_webhook(p_company text,p_environment text,p_merchant text,p_event_id text,p_lease_id uuid,p_code text,p_retryable boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare item public.crm_square_webhook_events%rowtype; next_status text; delay_seconds integer;
begin
  perform public.crm_square_payment_scope(p_company,p_environment,p_merchant);
  if coalesce(p_code,'') !~ '^[a-z][a-z0-9_]{0,79}$' then raise exception 'payment_failure_code_invalid' using errcode='22023'; end if;
  select * into item from public.crm_square_webhook_events where company_state_id=p_company and environment=p_environment
    and merchant_id=p_merchant and event_id=p_event_id for update;
  if not found or item.lease_id is distinct from p_lease_id or p_lease_id is null then raise exception 'payment_lease_lost' using errcode='40001'; end if;
  next_status:=case when coalesce(p_retryable,false) and item.attempts<10 then 'pending' else 'review' end;
  if item.status=next_status and item.last_error=p_code then
    return jsonb_build_object('durable',true,'eventId',p_event_id,'status',item.status);
  end if;
  if item.status<>'processing' or item.lease_until is null or item.lease_until<=clock_timestamp() then raise exception 'payment_lease_lost' using errcode='40001'; end if;
  delay_seconds:=least(900,(30*power(2,greatest(0,item.attempts-1)))::integer);
  update public.crm_square_webhook_events set status=next_status,last_error=p_code,
    lease_until=case when next_status='pending' then clock_timestamp()+make_interval(secs=>delay_seconds) else null end
    where company_state_id=p_company and environment=p_environment and merchant_id=p_merchant and event_id=p_event_id;
  return jsonb_build_object('durable',true,'eventId',p_event_id,'status',next_status);
end; $$;

create or replace function public.crm_square_sync_status(p_company text,p_environment text,p_merchant text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.crm_square_payment_scope(p_company,p_environment,p_merchant);
  select jsonb_build_object('pending',count(*) filter(where status in ('pending','processing')),
    'review',count(*) filter(where status='review'),'lastProcessedAt',max(processed_at) filter(where status='complete'),
    'oldestPendingAt',min(received_at) filter(where status in ('pending','processing'))) into result
    from public.crm_square_webhook_events where company_state_id=p_company and environment=p_environment and merchant_id=p_merchant;
  return result;
end; $$;

create or replace function public.crm_square_apply_payment(p_company text,p_environment text,p_merchant text,p_event_id text,p_lease_id uuid,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare item public.crm_square_webhook_events%rowtype; watermark public.crm_square_invoice_watermarks%rowtype;
  e public.crm_records%rowtype; lead public.crm_records%rowtype; job public.crm_records%rowtype; payment jsonb; fields jsonb;
  invoice_id text; order_id text; lead_id text; job_id text; count_rows integer; snapshot_hash text; snapshot_time timestamptz;
  version numeric; paid numeric; contract numeric; denominator numeric; job_contract numeric; manual_total numeric:=0;
  request_paid numeric:=0; square_total numeric:=0; existing_square numeric:=0; total_paid numeric; percent numeric; last_square text:=''; last_manual text:='';
  snapshot_status text; observed_paid numeric; prior_paid numeric; current_invoice text; observed_time text; stored_square numeric; stored_total numeric;
begin
  perform public.crm_square_payment_scope(p_company,p_environment,p_merchant);
  if jsonb_typeof(p_snapshot) is distinct from 'object' or octet_length(p_snapshot::text)>200000
    or jsonb_typeof(p_snapshot->'invoiceId') is distinct from 'string' or coalesce(p_snapshot->>'invoiceId','') !~ '^[A-Za-z0-9_:-]{1,200}$'
    or jsonb_typeof(p_snapshot->'orderId') is distinct from 'string' or coalesce(p_snapshot->>'orderId','') !~ '^[A-Za-z0-9_:-]{1,200}$'
    or jsonb_typeof(p_snapshot->'version') is distinct from 'number' or jsonb_typeof(p_snapshot->'paidAmount') is distinct from 'number'
    or jsonb_typeof(p_snapshot->'contractAmount') is distinct from 'number' or jsonb_typeof(p_snapshot->'updatedAt') is distinct from 'string'
    or jsonb_typeof(p_snapshot->'paymentRequests') is distinct from 'array'
    or jsonb_array_length(p_snapshot->'paymentRequests')>100
    or coalesce(p_snapshot->>'status','') not in ('DRAFT','SCHEDULED','UNPAID','PARTIALLY_PAID','PAID','PAYMENT_PENDING','CANCELED','FAILED','PARTIALLY_REFUNDED','REFUNDED')
    or (p_snapshot ? 'currency' and p_snapshot->>'currency' is distinct from 'USD') then
    raise exception 'payment_snapshot_invalid' using errcode='22023'; end if;
  invoice_id:=p_snapshot->>'invoiceId'; order_id:=p_snapshot->>'orderId'; version:=(p_snapshot->>'version')::numeric;
  paid:=(p_snapshot->>'paidAmount')::numeric; contract:=(p_snapshot->>'contractAmount')::numeric; snapshot_status:=p_snapshot->>'status';
  if version<0 or version<>trunc(version) or version>9007199254740991 or paid<0 or paid<>round(paid,2) or paid*100>9007199254740991
    or contract<0 or contract<>round(contract,2) or contract*100>9007199254740991 then raise exception 'payment_snapshot_invalid' using errcode='22023'; end if;
  begin
    if p_snapshot->>'updatedAt' !~ '^\d{4}-\d{2}-\d{2}T' then raise exception 'invalid'; end if;
    snapshot_time:=(p_snapshot->>'updatedAt')::timestamptz;
    if not isfinite(snapshot_time) then raise exception 'invalid'; end if;
  exception when others then raise exception 'payment_snapshot_invalid' using errcode='22023'; end;
  for payment in select value from jsonb_array_elements(p_snapshot->'paymentRequests') loop
    if jsonb_typeof(payment) is distinct from 'object' or jsonb_typeof(payment->'paidAmount') is distinct from 'number'
      or jsonb_typeof(payment->'requestedAmount') is distinct from 'number'
      or (payment->>'paidAmount')::numeric<0 or (payment->>'paidAmount')::numeric<>round((payment->>'paidAmount')::numeric,2)
      or (payment->>'paidAmount')::numeric*100>9007199254740991 or (payment->>'requestedAmount')::numeric<0
      or (payment->>'requestedAmount')::numeric<>round((payment->>'requestedAmount')::numeric,2)
      or (payment->>'requestedAmount')::numeric*100>9007199254740991 then raise exception 'payment_snapshot_invalid' using errcode='22023'; end if;
    request_paid:=request_paid+(payment->>'paidAmount')::numeric;
  end loop;
  -- Refunded money is netted by the verified worker. Square keeps gross request
  -- completions unchanged, so equality here would incorrectly reject refunds.
  if request_paid<paid or request_paid*100>9007199254740991 then raise exception 'payment_snapshot_invalid' using errcode='22023'; end if;
  snapshot_hash:=md5(p_snapshot::text);
  select * into item from public.crm_square_webhook_events where company_state_id=p_company and environment=p_environment
    and merchant_id=p_merchant and event_id=p_event_id for update;
  if not found or p_lease_id is null or item.lease_id is distinct from p_lease_id or item.invoice_id<>invoice_id then
    raise exception 'payment_lease_lost' using errcode='40001'; end if;
  if item.status='complete' then
    if item.payment_snapshot_hash is distinct from snapshot_hash then raise exception 'payment_version_conflict' using errcode='23514'; end if;
    return jsonb_build_object('durable',true,'eventId',p_event_id,'applied',item.payment_applied);
  end if;
  if item.status<>'processing' or item.lease_until is null or item.lease_until<=clock_timestamp() then raise exception 'payment_lease_lost' using errcode='40001'; end if;
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array('square-payment',p_company,p_environment,p_merchant,invoice_id)::text,0));
  select * into watermark from public.crm_square_invoice_watermarks w where w.company_state_id=p_company and w.environment=p_environment
    and w.merchant_id=p_merchant and w.invoice_id=invoice_id for update;
  if found then
    if version=watermark.invoice_version and p_snapshot is distinct from watermark.snapshot then raise exception 'payment_version_conflict' using errcode='23514'; end if;
    if version<watermark.invoice_version or (version=watermark.invoice_version and p_snapshot=watermark.snapshot) then
      update public.crm_square_webhook_events set status='complete',processed_at=clock_timestamp(),payment_applied=false,payment_snapshot_hash=snapshot_hash,last_error=null
        where company_state_id=p_company and environment=p_environment and merchant_id=p_merchant and event_id=p_event_id;
      return jsonb_build_object('durable',true,'eventId',p_event_id,'applied',false);
    end if;
    if snapshot_time<watermark.invoice_updated_at or order_id<>watermark.order_id then raise exception 'payment_version_conflict' using errcode='23514'; end if;
  end if;
  select count(*),min(r.lead_id),min(r.job_id) into count_rows,lead_id,job_id from public.crm_records r where r.company_state_id=p_company
    and r.record_type='estimate' and r.deleted_at is null and r.data->>'squareInvoiceId'=invoice_id;
  if count_rows=0 then raise exception 'payment_mapping_unavailable' using errcode='23514'; end if;
  if lead_id is null or job_id is null or exists(select 1 from public.crm_records r where r.company_state_id=p_company and r.record_type='estimate'
      and r.deleted_at is null and r.data->>'squareInvoiceId'=invoice_id and (r.lead_id is distinct from lead_id or r.job_id is distinct from job_id
        or r.data->>'squareOrderId' is distinct from order_id)) then raise exception 'payment_mapping_ambiguous' using errcode='23514'; end if;
  -- Lock the complete affected job aggregate, not just the incoming invoice.
  -- This is the same record_type/id order used by ordinary record commits.
  perform 1 from public.crm_records r where r.company_state_id=p_company and
    ((r.record_type='contact' and r.id=lead_id) or (r.record_type='job' and r.id=job_id) or
      (r.record_type='estimate' and ((r.lead_id=lead_id and r.job_id=job_id) or r.data->>'squareInvoiceId'=invoice_id)))
    order by r.record_type,r.id for update;
  select * into lead from public.crm_records r where r.company_state_id=p_company and r.record_type='contact' and r.id=lead_id;
  select * into job from public.crm_records r where r.company_state_id=p_company and r.record_type='job' and r.id=job_id;
  if lead.id is null or job.id is null or lead.deleted_at is not null or job.deleted_at is not null then raise exception 'payment_mapping_unavailable' using errcode='23514'; end if;
  if lead.lead_id is distinct from lead.id or lead.job_id is not null or lead.data->>'id' is distinct from lead.id
    or job.lead_id is distinct from lead.id or job.job_id is distinct from job.id or job.data->>'id' is distinct from job.id then
    raise exception 'payment_mapping_ambiguous' using errcode='23514'; end if;
  if watermark.invoice_id is not null and (watermark.lead_id<>lead_id or watermark.job_id<>job_id) then raise exception 'payment_mapping_ambiguous' using errcode='23514'; end if;
  if jsonb_typeof(coalesce(nullif(job.data->'contractValue','null'::jsonb),job.data->'value')) is distinct from 'number' then raise exception 'payment_contract_missing' using errcode='23514'; end if;
  job_contract:=coalesce(job.data->>'contractValue',job.data->>'value')::numeric;
  if job_contract<=0 or job_contract<>round(job_contract,2) or job_contract*100>9007199254740991 then raise exception 'payment_contract_missing' using errcode='23514'; end if;
  if job.data ? 'manualPayments' and jsonb_typeof(job.data->'manualPayments') is distinct from 'array' then raise exception 'manual_payment_invalid' using errcode='23514'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(job.data->'manualPayments','[]'::jsonb)) m
    group by m->>'id' having coalesce(m->>'id','')='' or count(*)>1) then raise exception 'manual_payment_invalid' using errcode='23514'; end if;
  for payment in select value from jsonb_array_elements(coalesce(job.data->'manualPayments','[]'::jsonb)) loop
    if jsonb_typeof(payment->'amount') is distinct from 'number' or (payment->>'amount')::numeric<0
      or (payment->>'amount')::numeric<>round((payment->>'amount')::numeric,2) or (payment->>'amount')::numeric*100>9007199254740991 then
      raise exception 'manual_payment_invalid' using errcode='23514'; end if;
    manual_total:=manual_total+(payment->>'amount')::numeric;
    observed_time:=coalesce(nullif(payment->>'date',''),nullif(payment->>'createdAt',''),'');
    if observed_time<>'' then
      begin
        if not isfinite(observed_time::timestamptz) then raise exception 'invalid'; end if;
      exception when others then raise exception 'manual_payment_invalid' using errcode='23514'; end;
      if last_manual='' or observed_time::timestamptz>last_manual::timestamptz then last_manual:=observed_time; end if;
    end if;
  end loop;
  -- Before replacing a job aggregate, prove every previously recorded Square
  -- dollar is represented by its linked estimates. Legacy totals that cannot be
  -- traced are retained for administrator review rather than silently reduced.
  prior_paid:=null; current_invoice:=null;
  for e in select * from public.crm_records r where r.company_state_id=p_company and r.record_type='estimate' and r.deleted_at is null
    and r.lead_id=lead_id and r.job_id=job_id and coalesce(r.data->>'squareInvoiceId','')<>'' order by r.data->>'squareInvoiceId',r.id loop
    if jsonb_typeof(e.data->'paidAmount')='number' then observed_paid:=(e.data->>'paidAmount')::numeric;
    elsif not e.data ? 'paidAmount' then observed_paid:=0;
    else raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
    if observed_paid<0 or observed_paid<>round(observed_paid,2) or observed_paid*100>9007199254740991 then raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
    if current_invoice is distinct from e.data->>'squareInvoiceId' then
      current_invoice:=e.data->>'squareInvoiceId'; prior_paid:=observed_paid; existing_square:=existing_square+observed_paid;
    elsif prior_paid<>observed_paid then raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
  end loop;
  if job.data ? 'squarePaidAmount' then
    if jsonb_typeof(job.data->'squarePaidAmount') is distinct from 'number' then raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
    stored_square:=(job.data->>'squarePaidAmount')::numeric;
    if stored_square<0 or stored_square<>round(stored_square,2) or stored_square*100>9007199254740991 or stored_square<>existing_square then
      raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
  else stored_square:=existing_square; end if;
  if job.data ? 'paidAmount' then
    if jsonb_typeof(job.data->'paidAmount') is distinct from 'number' then raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
    stored_total:=(job.data->>'paidAmount')::numeric;
    if stored_total<0 or stored_total<>round(stored_total,2) or stored_total*100>9007199254740991
      or stored_total<>stored_square+manual_total then raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
  end if;
  for e in select * from public.crm_records r where r.company_state_id=p_company and r.record_type='estimate'
    and r.deleted_at is null and r.data->>'squareInvoiceId'=invoice_id loop
    if e.lead_id is distinct from lead_id or e.job_id is distinct from job_id or e.data->>'id' is distinct from e.id
      or e.data->>'contactId' is distinct from lead_id or e.data->>'jobId' is distinct from job_id
      or e.data->>'squareOrderId' is distinct from order_id then raise exception 'payment_mapping_ambiguous' using errcode='23514'; end if;
    if exists(select 1 from public.crm_square_invoice_intents i where i.company_state_id=p_company and i.estimate_id=e.id
      and i.status='complete' and i.environment<>p_environment and i.result->>'squareInvoiceId'=invoice_id)
      and not exists(select 1 from public.crm_square_invoice_intents i where i.company_state_id=p_company and i.estimate_id=e.id
        and i.status='complete' and i.environment=p_environment and i.result->>'squareInvoiceId'=invoice_id) then
      raise exception 'payment_mapping_ambiguous' using errcode='23514'; end if;
    if jsonb_typeof(e.data->'contractValue') is distinct from 'number' then raise exception 'payment_contract_missing' using errcode='23514'; end if;
    denominator:=(e.data->>'contractValue')::numeric;
    if denominator<=0 or denominator<>round(denominator,2) or denominator*100>9007199254740991 then raise exception 'payment_contract_missing' using errcode='23514'; end if;
    if jsonb_typeof(e.data->'paidAmount')='number' then observed_paid:=(e.data->>'paidAmount')::numeric;
    elsif not e.data ? 'paidAmount' then observed_paid:=0;
    else raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
    if observed_paid<0 or observed_paid<>round(observed_paid,2) or observed_paid*100>9007199254740991 then raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
    if prior_paid is not null and prior_paid<>observed_paid then raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
    prior_paid:=observed_paid;
    fields:=jsonb_build_object('paidAmount',paid,'paymentPercent',least(100,paid/denominator*100),'squareStatus',snapshot_status,
      'paymentRequests',p_snapshot->'paymentRequests','paymentUpdatedAt',p_snapshot->>'updatedAt',
      'paidAt',case when paid>=denominator then coalesce(nullif(e.data->>'paidAt',''),p_snapshot->>'updatedAt') else '' end);
    update public.crm_records set data=e.data||fields,version=e.version+1,updated_at=clock_timestamp()
      where company_state_id=p_company and record_type='estimate' and id=e.id;
  end loop;
  prior_paid:=null; current_invoice:=null;
  for e in select * from public.crm_records r where r.company_state_id=p_company and r.record_type='estimate' and r.deleted_at is null
    and r.lead_id=lead_id and r.job_id=job_id and coalesce(r.data->>'squareInvoiceId','')<>'' order by r.data->>'squareInvoiceId',r.id loop
    if jsonb_typeof(e.data->'paidAmount')='number' then observed_paid:=(e.data->>'paidAmount')::numeric;
    elsif not e.data ? 'paidAmount' then observed_paid:=0;
    else raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
    if observed_paid<0 or observed_paid<>round(observed_paid,2) or observed_paid*100>9007199254740991 then raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
    if current_invoice is distinct from e.data->>'squareInvoiceId' then
      current_invoice:=e.data->>'squareInvoiceId'; prior_paid:=observed_paid; square_total:=square_total+observed_paid;
    elsif prior_paid<>observed_paid then raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
    observed_time:=coalesce(nullif(e.data->>'paymentUpdatedAt',''),nullif(e.data->>'paidAt',''),'');
    if observed_time<>'' then
      begin
        if not isfinite(observed_time::timestamptz) then raise exception 'invalid'; end if;
      exception when others then raise exception 'payment_history_ambiguous' using errcode='23514'; end;
      if last_square='' or observed_time::timestamptz>last_square::timestamptz then last_square:=observed_time; end if;
    end if;
  end loop;
  total_paid:=square_total+manual_total;
  if total_paid*100>9007199254740991 then raise exception 'payment_snapshot_invalid' using errcode='22023'; end if;
  observed_time:=case when last_square='' then last_manual when last_manual='' then last_square
    when last_square::timestamptz>=last_manual::timestamptz then last_square else last_manual end;
  fields:=jsonb_build_object('squarePaidAmount',square_total,'paidAmount',total_paid,'paymentPercent',least(100,total_paid/job_contract*100),
    'squareLastPaymentAt',last_square,'lastPaymentAt',observed_time);
  update public.crm_records set data=job.data||fields,version=job.version+1,updated_at=clock_timestamp()
    where company_state_id=p_company and record_type='job' and id=job.id;
  insert into public.crm_square_invoice_watermarks(company_state_id,environment,merchant_id,invoice_id,order_id,lead_id,job_id,invoice_version,invoice_updated_at,snapshot)
    values(p_company,p_environment,p_merchant,invoice_id,order_id,lead_id,job_id,version,snapshot_time,p_snapshot)
    on conflict on constraint crm_square_invoice_watermarks_pkey do update set invoice_version=excluded.invoice_version,
      invoice_updated_at=excluded.invoice_updated_at,snapshot=excluded.snapshot,applied_at=clock_timestamp();
  insert into public.crm_audit_events(id,company_state_id,lead_id,job_id,event_type,message,metadata)
    values('square-payment:'||md5(jsonb_build_array(p_company,p_environment,p_merchant,p_event_id)::text),p_company,lead_id,job_id,'square_payment_reconciled',
      'Verified Square payment balance reconciled',jsonb_build_object('invoiceId',invoice_id,'eventId',p_event_id,'invoiceVersion',version,'paidAmount',paid));
  update public.crm_square_webhook_events set status='complete',processed_at=clock_timestamp(),payment_applied=true,payment_snapshot_hash=snapshot_hash,last_error=null
    where company_state_id=p_company and environment=p_environment and merchant_id=p_merchant and event_id=p_event_id;
  return jsonb_build_object('durable',true,'eventId',p_event_id,'applied',true);
end; $$;

create or replace function public.crm_square_protect_payment_authority() returns trigger
language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare service boolean:=coalesce(auth.jwt()->>'role','')='service_role'; linked boolean:=false;
  manual_total numeric:=0; square_total numeric:=0; paid_total numeric:=0; denominator numeric; expected_percent numeric; payment jsonb;
begin
  if tg_op='INSERT' then
    if not service and new.record_type='estimate' and coalesce(new.data->>'squareInvoiceId','')<>'' then
      raise exception 'square_payment_binding_is_server_owned' using errcode='42501'; end if;
    return new;
  end if;
  if old.record_type='estimate' then linked:=coalesce(old.data->>'squareInvoiceId','')<>'' or coalesce(new.data->>'squareInvoiceId','')<>'';
  elsif old.record_type='job' then linked:=exists(select 1 from public.crm_records r where r.company_state_id=old.company_state_id
    and r.record_type='estimate' and r.deleted_at is null and r.job_id=old.id and coalesce(r.data->>'squareInvoiceId','')<>'');
  elsif old.record_type='contact' then linked:=exists(select 1 from public.crm_records r where r.company_state_id=old.company_state_id
    and r.record_type='estimate' and r.deleted_at is null and r.lead_id=old.id and coalesce(r.data->>'squareInvoiceId','')<>'');
  end if;
  if not linked then if tg_op='DELETE' then return old; else return new; end if; end if;
  if tg_op='DELETE' then raise exception 'square_payment_history_is_locked' using errcode='23514'; end if;
  if new.deleted_at is not null or new.lead_id is distinct from old.lead_id or new.job_id is distinct from old.job_id
    or new.data->>'id' is distinct from old.data->>'id' then raise exception 'square_payment_history_is_locked' using errcode='23514'; end if;
  if service then return new; end if;
  if old.record_type='estimate' then
    if new.data->'contactId' is distinct from old.data->'contactId' or new.data->'jobId' is distinct from old.data->'jobId'
      or new.data->'squareInvoiceId' is distinct from old.data->'squareInvoiceId' or new.data->'squareOrderId' is distinct from old.data->'squareOrderId'
      or new.data->'items' is distinct from old.data->'items' or new.data->'taxRate' is distinct from old.data->'taxRate'
      or new.data->'deposit' is distinct from old.data->'deposit' or new.data->'contractValue' is distinct from old.data->'contractValue'
      or new.data->'paidAmount' is distinct from old.data->'paidAmount' or new.data->'squareStatus' is distinct from old.data->'squareStatus'
      or new.data->'paymentRequests' is distinct from old.data->'paymentRequests' or new.data->'paymentUpdatedAt' is distinct from old.data->'paymentUpdatedAt'
      or new.data->'paidAt' is distinct from old.data->'paidAt' or new.data->'paymentPercent' is distinct from old.data->'paymentPercent' then
      raise exception 'square_payment_fields_are_server_owned' using errcode='42501'; end if;
  elsif old.record_type='job' then
    if new.data->'squarePaidAmount' is distinct from old.data->'squarePaidAmount'
      or new.data->'squareLastPaymentAt' is distinct from old.data->'squareLastPaymentAt' then
      raise exception 'square_payment_fields_are_server_owned' using errcode='42501'; end if;
    if jsonb_typeof(coalesce(new.data->'manualPayments','[]'::jsonb)) is distinct from 'array'
      or jsonb_typeof(coalesce(new.data->'squarePaidAmount','0'::jsonb)) is distinct from 'number'
      or jsonb_typeof(coalesce(new.data->'paidAmount','0'::jsonb)) is distinct from 'number'
      or jsonb_typeof(new.data->'paymentPercent') is distinct from 'number' then raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
    square_total:=coalesce((new.data->>'squarePaidAmount')::numeric,0);
    for payment in select value from jsonb_array_elements(coalesce(new.data->'manualPayments','[]'::jsonb)) loop
      if jsonb_typeof(payment->'amount') is distinct from 'number' or (payment->>'amount')::numeric<=0
        or (payment->>'amount')::numeric<>round((payment->>'amount')::numeric,2) then raise exception 'manual_payment_invalid' using errcode='23514'; end if;
      manual_total:=manual_total+(payment->>'amount')::numeric;
    end loop;
    paid_total:=(new.data->>'paidAmount')::numeric;
    if jsonb_typeof(coalesce(nullif(new.data->'contractValue','null'::jsonb),new.data->'value')) is distinct from 'number' then
      raise exception 'payment_contract_missing' using errcode='23514'; end if;
    denominator:=coalesce((new.data->>'contractValue')::numeric,(new.data->>'value')::numeric);
    expected_percent:=case when denominator>0 then least(100,(square_total+manual_total)*100/denominator) else 0 end;
    if paid_total<>square_total+manual_total or abs((new.data->>'paymentPercent')::numeric-expected_percent)>0.000001 then
      raise exception 'payment_history_ambiguous' using errcode='23514'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists crm_square_payment_authority on public.crm_records;
create trigger crm_square_payment_authority before insert or update or delete on public.crm_records
  for each row execute function public.crm_square_protect_payment_authority();

revoke all on function public.crm_square_payment_scope(text,text,text),public.crm_square_claim_webhook(text,text,text),
  public.crm_square_fail_webhook(text,text,text,text,uuid,text,boolean),public.crm_square_apply_payment(text,text,text,text,uuid,jsonb),
  public.crm_square_sync_status(text,text,text),public.crm_square_protect_payment_authority() from public,anon,authenticated;
grant execute on function public.crm_square_claim_webhook(text,text,text),public.crm_square_fail_webhook(text,text,text,text,uuid,text,boolean),
  public.crm_square_apply_payment(text,text,text,text,uuid,jsonb),public.crm_square_sync_status(text,text,text) to service_role;
commit;
