-- Durable receipt only: enqueue before acknowledging the provider. A reconciliation
-- worker must process pending rows; an inbox receipt is not a paid-balance update.
begin;
create table if not exists public.crm_square_webhook_events (
  company_state_id text not null, environment text not null check(environment in ('production','sandbox')),
  merchant_id text not null, event_id text not null, invoice_id text not null,
  event_type text not null, event_created_at timestamptz not null, payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','processing','review','complete')),
  attempts integer not null default 0, lease_until timestamptz, lease_id uuid,
  last_error text, received_at timestamptz not null default clock_timestamp(),
  processed_at timestamptz,
  primary key(company_state_id,environment,merchant_id,event_id)
);
alter table public.crm_square_webhook_events enable row level security;
revoke all on public.crm_square_webhook_events from public,anon,authenticated,service_role;
create index if not exists crm_square_webhook_pending on public.crm_square_webhook_events(company_state_id,environment,status,received_at);

create or replace function public.crm_square_enqueue_webhook(p_company text,p_environment text,p_event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior public.crm_square_webhook_events%rowtype; invoice_id text; created timestamptz;
begin
  perform public.crm_square_require_service();
  invoice_id:=p_event->'data'->'object'->'invoice'->>'id';
  if p_company is distinct from public.crm_base_state_id() or p_environment not in ('production','sandbox')
    or jsonb_typeof(p_event) is distinct from 'object' or octet_length(p_event::text)>1000000
    or coalesce(p_event->>'merchant_id','') !~ '^[A-Za-z0-9_:-]{1,200}$'
    or coalesce(p_event->>'event_id','') !~ '^[A-Za-z0-9_:-]{1,200}$'
    or coalesce(invoice_id,'') !~ '^[A-Za-z0-9_:-]{1,200}$'
    or coalesce(p_event->>'type','') not in ('invoice.created','invoice.published','invoice.updated','invoice.payment_made','invoice.scheduled_charge_failed','invoice.canceled','invoice.refunded','invoice.deleted')
    or coalesce(p_event->>'created_at','')='' then
    raise exception 'invalid_invoice_webhook' using errcode='22023'; end if;
  created:=(p_event->>'created_at')::timestamptz;
  perform pg_advisory_xact_lock(hashtextextended(p_company||p_environment||(p_event->>'merchant_id')||(p_event->>'event_id'),0));
  select * into prior from public.crm_square_webhook_events where company_state_id=p_company and environment=p_environment
    and merchant_id=p_event->>'merchant_id' and event_id=p_event->>'event_id';
  if found then
    if prior.payload is distinct from p_event then raise exception 'webhook_event_id_reused' using errcode='40001'; end if;
    return jsonb_build_object('durable',true,'duplicate',true,'eventId',prior.event_id);
  end if;
  insert into public.crm_square_webhook_events(company_state_id,environment,merchant_id,event_id,invoice_id,event_type,event_created_at,payload)
    values(p_company,p_environment,p_event->>'merchant_id',p_event->>'event_id',invoice_id,p_event->>'type',created,p_event);
  return jsonb_build_object('durable',true,'duplicate',false,'eventId',p_event->>'event_id');
end; $$;
revoke all on function public.crm_square_enqueue_webhook(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_square_enqueue_webhook(text,text,jsonb) to service_role;
commit;
