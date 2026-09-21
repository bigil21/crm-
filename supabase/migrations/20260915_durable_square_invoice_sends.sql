-- Server-only invoice intents. No historical business data is rewritten.
-- Requires conflict-safe record writes. Install/test before enabling the worker.
begin;

create table if not exists public.crm_square_invoice_policy (
  company_state_id text not null,
  environment text not null check(environment in ('production','sandbox')),
  installed_at timestamptz not null default clock_timestamp(),
  primary key(company_state_id,environment)
);
insert into public.crm_square_invoice_policy(company_state_id,environment)
values(public.crm_base_state_id(),'production'),(public.crm_base_state_id(),'sandbox') on conflict do nothing;

create table if not exists public.crm_square_invoice_reviews (
  company_state_id text not null, environment text not null,
  estimate_id text not null, reviewed_by uuid not null references auth.users(id),
  note text not null, reviewed_at timestamptz not null default clock_timestamp(),
  primary key(company_state_id,environment,estimate_id)
);

create table if not exists public.crm_square_invoice_intents (
  id uuid primary key default gen_random_uuid(),
  company_state_id text not null, environment text not null check(environment in ('production','sandbox')),
  estimate_id text not null, lead_id text not null, job_id text not null,
  created_by uuid not null references auth.users(id),
  status text not null default 'pending' check(status in ('pending','complete')),
  payload jsonb not null, receipts jsonb not null default '{}'::jsonb, result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(company_state_id,environment,estimate_id)
);
alter table public.crm_square_invoice_policy enable row level security;
alter table public.crm_square_invoice_reviews enable row level security;
alter table public.crm_square_invoice_intents enable row level security;
revoke all on public.crm_square_invoice_policy, public.crm_square_invoice_reviews, public.crm_square_invoice_intents from public,anon,authenticated,service_role;

create or replace function public.crm_square_require_service() returns void
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'server_worker_required' using errcode='42501';
  end if;
end; $$;

create or replace function public.crm_square_require_admin(p_company text,p_actor uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public.crm_square_require_service();
  if p_company is distinct from public.crm_base_state_id() or not exists(
    select 1 from auth.users u where u.id=p_actor and lower(u.email) like '%@coastalcrestroofing.com'
      and (lower(u.raw_app_meta_data->>'role')='admin' or exists(select 1 from public.crm_admins a where lower(a.email)=lower(u.email)))
  ) then raise exception 'company_admin_required' using errcode='42501'; end if;
end; $$;

create or replace function public.crm_square_intent_json(p_row public.crm_square_invoice_intents) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',p_row.id,'companyId',p_row.company_state_id,'environment',p_row.environment,
    'status',p_row.status,'payload',p_row.payload,'receipts',p_row.receipts,'result',p_row.result);
$$;

create or replace function public.crm_square_clear_legacy_attempt(p_company text,p_actor uuid,p_environment text,p_estimate_id text,p_note text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public.crm_square_require_admin(p_company,p_actor);
  if p_environment not in ('production','sandbox') or coalesce(length(trim(p_note)),0) not between 20 and 2000 then
    raise exception 'document_provider_review_before_clearing' using errcode='22023'; end if;
  insert into public.crm_square_invoice_reviews(company_state_id,environment,estimate_id,reviewed_by,note)
    values(p_company,p_environment,p_estimate_id,p_actor,p_note) on conflict do nothing;
end; $$;

create or replace function public.crm_square_begin_invoice(p_company text,p_actor uuid,p_estimate_id text,p_expected_version integer,p_environment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  intent public.crm_square_invoice_intents%rowtype;
  e public.crm_records%rowtype; c public.crm_records%rowtype; j public.crm_records%rowtype;
  line jsonb; subtotal numeric := 0; total numeric; tax numeric; deposit numeric; payload jsonb;
  tomorrow date := (clock_timestamp() at time zone 'UTC')::date+1; due date;
begin
  perform public.crm_square_require_admin(p_company,p_actor);
  if p_environment not in ('production','sandbox') or p_expected_version is null or p_expected_version<1 or coalesce(length(p_estimate_id),0) not between 1 and 200 then
    raise exception 'invalid_invoice_request' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company||':'||p_environment||':'||p_estimate_id,0));
  select * into intent from public.crm_square_invoice_intents where company_state_id=p_company and environment=p_environment and estimate_id=p_estimate_id;
  if found then return public.crm_square_intent_json(intent); end if;
  select * into e from public.crm_records where company_state_id=p_company and record_type='estimate' and id=p_estimate_id;
  if not found then raise exception 'estimate_not_found' using errcode='22023'; end if;
  -- Same record order as crm_commit_records. Re-read after locking.
  perform 1 from public.crm_records where company_state_id=p_company and
    ((record_type='estimate' and id=e.id) or (record_type='contact' and id=e.lead_id) or (record_type='job' and id=e.job_id))
    order by record_type,id for update;
  select * into e from public.crm_records where company_state_id=p_company and record_type='estimate' and id=p_estimate_id;
  select * into c from public.crm_records where company_state_id=p_company and record_type='contact' and id=e.lead_id;
  select * into j from public.crm_records where company_state_id=p_company and record_type='job' and id=e.job_id;
  if e.deleted_at is not null or c.id is null or j.id is null or c.deleted_at is not null or j.deleted_at is not null
    or e.id !~ '^[A-Za-z0-9_:-]{1,200}$' or c.id !~ '^[A-Za-z0-9_:-]{1,200}$' or j.id !~ '^[A-Za-z0-9_:-]{1,200}$'
    or c.lead_id is distinct from c.id or c.job_id is not null or j.lead_id is distinct from c.id or j.job_id is distinct from j.id
    or e.data->>'id' is distinct from e.id or e.data->>'contactId' is distinct from c.id or e.data->>'jobId' is distinct from j.id
    or c.data->>'id' is distinct from c.id or j.data->>'id' is distinct from j.id then
    raise exception 'invalid_invoice_relationship' using errcode='23514'; end if;
  if e.version<>p_expected_version then raise exception 'estimate_changed_before_invoice' using errcode='40001'; end if;
  if e.data->>'status' is distinct from 'Won' then raise exception 'won_estimate_required' using errcode='23514'; end if;
  if coalesce(e.data->>'squareInvoiceId','')<>'' then raise exception 'invoice_already_linked' using errcode='23514'; end if;
  if not exists(select 1 from public.crm_square_invoice_policy p where p.company_state_id=p_company and p.environment=p_environment
       and e.created_at>=p.installed_at) and not exists(select 1 from public.crm_square_invoice_reviews r where
       r.company_state_id=p_company and r.environment=p_environment and r.estimate_id=e.id) then
    raise exception 'legacy_invoice_review_required' using errcode='23514'; end if;
  if length(coalesce(c.data->>'email',''))>254 or coalesce(c.data->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or coalesce(trim(c.data->>'leadNumber'),'')='' or coalesce(trim(j.data->>'projectNumber'),'')='' or coalesce(trim(e.data->>'estimateNumber'),'')='' then
    raise exception 'saved_customer_email_and_numbers_required' using errcode='23514'; end if;
  if jsonb_typeof(e.data->'items') is distinct from 'array' or jsonb_array_length(e.data->'items') not between 1 and 500 then
    raise exception 'invalid_invoice_items' using errcode='23514'; end if;
  for line in select value from jsonb_array_elements(e.data->'items') loop
    if jsonb_typeof(line->'title') is distinct from 'string' or (line ? 'description' and jsonb_typeof(line->'description') is distinct from 'string')
      or jsonb_typeof(line->'quantity') is distinct from 'number' or jsonb_typeof(line->'rate') is distinct from 'number'
      or (line->>'quantity')::numeric<=0 or (line->>'quantity')::numeric>1000000
      or (line->>'quantity')::numeric<>round((line->>'quantity')::numeric,5)
      or (line->>'rate')::numeric<0 or (line->>'rate')::numeric*100>9007199254740991 or (line->>'rate')::numeric<>round((line->>'rate')::numeric,2) then
      raise exception 'invalid_invoice_item_amount' using errcode='23514'; end if;
    subtotal:=subtotal+round((line->>'quantity')::numeric*round((line->>'rate')::numeric*100));
  end loop;
  tax:=coalesce((e.data->>'taxRate')::numeric,0); deposit:=coalesce((e.data->>'deposit')::numeric,0);
  total:=(subtotal+round(subtotal*tax/100))/100;
  if tax<0 or tax>100 or total<=0 or total*100>9007199254740991 or deposit<0 or deposit>total or deposit<>round(deposit,2) then
    raise exception 'invalid_invoice_total_or_deposit' using errcode='23514'; end if;
  due:=greatest(tomorrow,coalesce(nullif(e.data->>'validUntil','')::date,tomorrow+29));
  payload:=jsonb_build_object('estimateId',e.id,'leadId',c.id,'jobId',j.id,'leadNumber',c.data->>'leadNumber',
    'projectNumber',j.data->>'projectNumber','estimateNumber',e.data->>'estimateNumber',
    'projectTitle',coalesce(e.data->>'projectTitle',''),'jobAddress',coalesce(j.data->>'address',c.data->>'address',''),
    'contactName',coalesce(c.data->>'name',''),'contactEmail',c.data->>'email','lineItems',e.data->'items',
    'taxRate',tax,'deposit',deposit,'total',total,'dueDate',due,'depositDueDate',tomorrow);
  insert into public.crm_square_invoice_intents(company_state_id,environment,estimate_id,lead_id,job_id,created_by,payload)
    values(p_company,p_environment,e.id,c.id,j.id,p_actor,payload) returning * into intent;
  return public.crm_square_intent_json(intent);
end; $$;

create or replace function public.crm_square_checkpoint_invoice(p_company text,p_intent uuid,p_stage text,p_receipt jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare intent public.crm_square_invoice_intents%rowtype; predecessor text;
begin
  perform public.crm_square_require_service();
  select * into intent from public.crm_square_invoice_intents where id=p_intent and company_state_id=p_company for update;
  if not found then raise exception 'invoice_intent_not_found' using errcode='22023'; end if;
  if p_stage not in ('customer','location','order','invoice','published') or jsonb_typeof(p_receipt) is distinct from 'object'
    or coalesce(p_receipt->>'id','')='' or octet_length(p_receipt::text)>200000 then
    raise exception 'invalid_invoice_receipt' using errcode='22023'; end if;
  if intent.receipts ? p_stage then
    if intent.receipts->p_stage is distinct from p_receipt then raise exception 'invoice_receipt_conflict' using errcode='40001'; end if;
    return public.crm_square_intent_json(intent);
  end if;
  predecessor:=case p_stage when 'location' then 'customer' when 'order' then 'location' when 'invoice' then 'order' when 'published' then 'invoice' end;
  if intent.status<>'pending' or (predecessor is not null and not intent.receipts ? predecessor) then
    raise exception 'invoice_receipt_out_of_sequence' using errcode='23514'; end if;
  update public.crm_square_invoice_intents set receipts=receipts||jsonb_build_object(p_stage,p_receipt),updated_at=clock_timestamp()
    where id=p_intent returning * into intent;
  return public.crm_square_intent_json(intent);
end; $$;

create or replace function public.crm_square_complete_invoice(p_company text,p_intent uuid,p_result jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare intent public.crm_square_invoice_intents%rowtype; e public.crm_records%rowtype; saved public.crm_records%rowtype;
  published jsonb; final_result jsonb; fields jsonb;
begin
  perform public.crm_square_require_service();
  select * into intent from public.crm_square_invoice_intents where id=p_intent and company_state_id=p_company for update;
  if not found then raise exception 'invoice_intent_not_found' using errcode='22023'; end if;
  if intent.status='complete' then return public.crm_square_intent_json(intent); end if;
  published:=intent.receipts->'published';
  if published is null or published->>'id' is distinct from intent.receipts->'invoice'->>'id'
    or published->>'delivery_method' is distinct from 'EMAIL'
    or published->'primary_recipient'->>'customer_id' is distinct from intent.receipts->'customer'->>'id'
    or p_result->>'squareInvoiceId' is distinct from published->>'id'
    or p_result->>'squareOrderId' is distinct from intent.receipts->'order'->>'id'
    or coalesce(published->>'status','') not in ('SCHEDULED','UNPAID','PARTIALLY_PAID','PAID','PAYMENT_PENDING') then
    raise exception 'published_invoice_receipt_required' using errcode='23514'; end if;
  select * into e from public.crm_records where company_state_id=p_company and record_type='estimate' and id=intent.estimate_id for update;
  if not found or e.deleted_at is not null or e.lead_id is distinct from intent.lead_id or e.job_id is distinct from intent.job_id
    or coalesce(e.data->>'squareInvoiceId','') not in ('',published->>'id') then
    raise exception 'invoice_target_changed' using errcode='40001'; end if;
  fields:=jsonb_build_object('squareInvoiceId',published->>'id','squareOrderId',intent.receipts->'order'->>'id',
    'squareInvoiceNumber',coalesce(published->>'invoice_number',''),'squareInvoiceUrl',coalesce(published->>'public_url',''),
    'squareDeliveryMethod','EMAIL','squarePublishedAt',coalesce(published->>'updated_at',intent.updated_at::text),
    'squareRecipientEmail',intent.payload->>'contactEmail','squareStatus',published->>'status','contractValue',intent.payload->'total');
  update public.crm_records set data=e.data||fields,version=e.version+1,updated_at=clock_timestamp(),updated_by=intent.created_by
    where company_state_id=p_company and record_type='estimate' and id=e.id returning * into saved;
  final_result:=fields||jsonb_build_object('status',published->>'status','durable',true,'intentId',intent.id,'estimateId',e.id,'leadId',intent.lead_id,
    'jobId',intent.job_id,'rows',jsonb_build_array(to_jsonb(saved)));
  insert into public.crm_audit_events(id,company_state_id,lead_id,job_id,event_type,actor_user_id,message,metadata)
    values('square-invoice:'||intent.id::text,p_company,intent.lead_id,intent.job_id,'square_invoice_published',intent.created_by,
      'Square invoice attached to its saved estimate and job',jsonb_build_object('intentId',intent.id,'squareInvoiceId',published->>'id'));
  update public.crm_square_invoice_intents set status='complete',result=final_result,updated_at=clock_timestamp()
    where id=p_intent returning * into intent;
  return public.crm_square_intent_json(intent);
end; $$;

-- Block removal/reassignment and invoice-content edits once sending has begun.
-- Costs, notes, checklists and unrelated fields may still be edited normally.
create or replace function public.crm_square_protect_target() returns trigger
language plpgsql security definer set search_path='' as $$
declare bound boolean;
begin
  select exists(select 1 from public.crm_square_invoice_intents i where i.company_state_id=old.company_state_id and
    ((old.record_type='estimate' and old.id=i.estimate_id) or (old.record_type='job' and old.id=i.job_id) or (old.record_type='contact' and old.id=i.lead_id))) into bound;
  if not bound then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op='DELETE' or new.deleted_at is not null or new.lead_id is distinct from old.lead_id or new.job_id is distinct from old.job_id
    or new.data->>'id' is distinct from old.data->>'id' then
    raise exception 'invoice_history_target_is_locked' using errcode='23514'; end if;
  if old.record_type='estimate' and (new.data->'items' is distinct from old.data->'items' or new.data->'taxRate' is distinct from old.data->'taxRate'
    or new.data->'deposit' is distinct from old.data->'deposit' or new.data->'contactId' is distinct from old.data->'contactId'
    or new.data->'jobId' is distinct from old.data->'jobId') then
    raise exception 'invoice_content_is_locked' using errcode='23514'; end if;
  if old.record_type='estimate' and coalesce(auth.jwt()->>'role','')<>'service_role'
    and (new.data->'squareInvoiceId' is distinct from old.data->'squareInvoiceId' or new.data->'squareOrderId' is distinct from old.data->'squareOrderId') then
    raise exception 'invoice_binding_is_server_owned' using errcode='42501'; end if;
  return new;
end; $$;
drop trigger if exists crm_square_protect_target on public.crm_records;
create trigger crm_square_protect_target before update or delete on public.crm_records for each row execute function public.crm_square_protect_target();

revoke all on function public.crm_square_require_service(), public.crm_square_require_admin(text,uuid),
  public.crm_square_intent_json(public.crm_square_invoice_intents), public.crm_square_protect_target(),
  public.crm_square_clear_legacy_attempt(text,uuid,text,text,text), public.crm_square_begin_invoice(text,uuid,text,integer,text),
  public.crm_square_checkpoint_invoice(text,uuid,text,jsonb), public.crm_square_complete_invoice(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crm_square_clear_legacy_attempt(text,uuid,text,text,text), public.crm_square_begin_invoice(text,uuid,text,integer,text),
  public.crm_square_checkpoint_invoice(text,uuid,text,jsonb), public.crm_square_complete_invoice(text,uuid,jsonb) to service_role;
commit;
