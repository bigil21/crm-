-- Install first. Activation is an explicit server-side transaction after reconciliation.
begin;
alter table public.crm_payments drop constraint crm_payments_origin_check;
alter table public.crm_payments add constraint crm_payments_origin_check check(origin in ('invoice','job','square'));
alter table public.crm_payments add column provider_refunded numeric(14,2) not null default 0
  check(provider_refunded>=0 and provider_refunded<=amount and (origin='square' or provider_refunded=0));
alter table public.crm_payments add column provider_invoice text not null default '';
create index crm_payments_job_ledger on public.crm_payments(company_state_id,job_id,lead_id);
create or replace function public.crm_payment_ledger_enabled() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.crm_state where id=public.crm_base_state_id()||':payment-ledger-v2' and data->>'active'='true')
$$;
revoke all on function public.crm_payment_ledger_enabled() from public,anon;
grant execute on function public.crm_payment_ledger_enabled() to authenticated,service_role;

-- This control row cannot be toggled or removed by a CRM settings save.
create function public.crm_guard_payment_cutover() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (tg_op <> 'INSERT' and old.id like '%:payment-ledger-v2') or (tg_op <> 'DELETE' and new.id like '%:payment-ledger-v2') then
   if tg_op <> 'INSERT' or current_user not in ('postgres','supabase_admin','service_role')
      or coalesce(current_setting('crm.ledger_cutover',true),'') <> 'on' or auth.uid() is not null
   then raise exception 'ledger_control_is_server_only' using errcode='42501'; end if;
 end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.crm_guard_payment_cutover() from public, anon, authenticated;
create trigger crm_guard_payment_cutover before insert or update or delete on public.crm_state for each row execute function public.crm_guard_payment_cutover();

-- Only amounts are projected into job records for old readers, the portal and stage checks.
-- SELECT ... FOR UPDATE needs an UPDATE grant even if no data is written.
-- Keep the table immutable to browsers; authorize only the one lock the refund RPC needs.
create function public.crm_lock_refundable_invoice_payment(p_id text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not public.is_crm_admin() then raise exception 'admin_required' using errcode='42501'; end if;
 perform 1 from public.crm_payments where company_state_id=public.crm_base_state_id() and id=p_id and origin='invoice' and provider<>'square' for update;
 if not found then raise exception 'manual_invoice_payment_required'; end if;
end $$;
revoke all on function public.crm_lock_refundable_invoice_payment(text) from public,anon;
grant execute on function public.crm_lock_refundable_invoice_payment(text) to authenticated;
do $$
declare olddef text:=pg_get_functiondef('public.crm_record_refund(jsonb)'::regprocedure); changed text;
begin
 changed:=replace(olddef,
 'select * into payment_row from public.crm_payments p where p.company_state_id=company_id and p.id=payment_id_value for update;',
 'perform public.crm_lock_refundable_invoice_payment(payment_id_value);
  select * into payment_row from public.crm_payments p where p.company_state_id=company_id and p.id=payment_id_value;');
 if changed=olddef then raise exception 'unrecognized_invoice_refund_lock'; end if; execute changed;
end $$;

-- The individual payments are NEVER written back to the job once activated.
create function public.crm_job_ledger_fields(co text, jid text, lid text) returns jsonb
language sql stable security invoker set search_path='' as $$
 with p as(select coalesce(sum(amount) filter(where origin='job'),0) manual,
 coalesce(sum(amount-provider_refunded) filter(where origin='square'),0) square,
 coalesce(sum(amount) filter(where origin='invoice'),0) invoice, max(received_at) last_at
 from public.crm_payments where company_state_id=co and job_id=jid and lead_id=lid),
 r as(select coalesce(sum(amount),0) refunded from public.crm_refunds where company_state_id=co and job_id=jid and lead_id=lid)
 select jsonb_build_object('paymentLedgerVersion',2,'manualPaidAmount',manual,'squarePaidAmount',square,
 'invoicePaidNet',invoice-refunded,'paidAmount',greatest(0,manual+square+invoice-refunded),'lastPaymentAt',coalesce(last_at::text,'')) from p,r
$$;
revoke all on function public.crm_job_ledger_fields(text,text,text) from public,anon;
grant execute on function public.crm_job_ledger_fields(text,text,text) to authenticated,service_role;

create function public.crm_guard_ledger_job() returns trigger language plpgsql security definer set search_path='' as $$
declare fields jsonb; contract numeric; before_paid text;
begin
 if new.record_type<>'job' or not public.crm_payment_ledger_enabled() then return new; end if;
 if new.deleted_at is not null and tg_op='UPDATE' and old.deleted_at is not null then return new; end if;
 if tg_op='UPDATE' and old.deleted_at is not null and new.deleted_at is null and old.data->>'paymentLedgerVersion' is distinct from '2'
   and (coalesce(old.data->'manualPayments','[]')<>'[]' or public.crm_money(old.data->>'paidAmount')<>0)
 then raise exception 'historical_job_restore_requires_ledger_reconciliation' using errcode='PT409'; end if;
 if coalesce(new.data->'manualPayments','[]')<>'[]' and coalesce(current_setting('crm.ledger_cutover',true),'')<>'on'
 then raise exception 'payments_moved_to_ledger_reload' using errcode='PT409'; end if;
 fields:=public.crm_job_ledger_fields(new.company_state_id,new.id,new.lead_id);
 if tg_op='UPDATE' and (new.deleted_at is distinct from old.deleted_at or new.lead_id is distinct from old.lead_id)
 and exists(select 1 from public.crm_payments where company_state_id=old.company_state_id and job_id=old.id)
 then raise exception 'job_has_payment_history' using errcode='23514'; end if;
 contract:=coalesce(nullif(new.data->>'contractValue','')::numeric,nullif(new.data->>'value','')::numeric,0);
 new.data:=(new.data-'manualPayments')||fields||jsonb_build_object('paymentPercent',case when contract>0 then least(100,(fields->>'paidAmount')::numeric*100/contract) else 0 end);
 if new.data->>'status'='Paid' and (contract<=0 or (fields->>'paidAmount')::numeric<contract) then
   if tg_op='INSERT' or old.data->>'status' is distinct from 'Paid' then raise exception 'job_not_paid_in_full' using errcode='23514'; end if;
   select s.name into before_paid from public.crm_pipeline_stages s join public.crm_pipeline_stages t using(company_state_id,division_id)
    where s.company_state_id=new.company_state_id and s.division_id=coalesce(nullif(new.data->>'division',''),'roofing') and s.active and t.active
    and t.name='Paid' and s.display_order<t.display_order order by s.display_order desc limit 1;
   if before_paid is null then raise exception 'missing_stage_before_paid'; end if;
   new.data:=new.data||jsonb_build_object('status',before_paid);
 end if;
 return new;
end $$;
revoke all on function public.crm_guard_ledger_job() from public,anon,authenticated;
-- Run AFTER the original Square binding guard; derived values cannot be set by client input.
create trigger zz_crm_guard_ledger_job before insert or update on public.crm_records for each row execute function public.crm_guard_ledger_job();

create function public.crm_refresh_job_ledger() returns trigger language plpgsql security definer set search_path='' as $$
declare co text; jid text; lid text;
begin
 if not public.crm_payment_ledger_enabled() then return null; end if;
 if tg_op='DELETE' then co:=old.company_state_id; jid:=old.job_id; lid:=old.lead_id;
 else co:=new.company_state_id; jid:=new.job_id; lid:=new.lead_id; end if;
 update public.crm_records set version=version+1,updated_at=clock_timestamp(),data=jsonb_set(data,'{ledgerChangedAt}',to_jsonb(clock_timestamp()))
 where company_state_id=co and record_type='job' and id=jid and lead_id=lid and deleted_at is null;
 if not found then raise exception 'ledger_job_not_found' using errcode='23503'; end if;
 return null;
end $$;
revoke all on function public.crm_refresh_job_ledger() from public,anon,authenticated;
create trigger crm_refresh_job_from_payment after insert or update or delete on public.crm_payments for each row execute function public.crm_refresh_job_ledger();
create trigger crm_refresh_job_from_refund after insert or update or delete on public.crm_refunds for each row execute function public.crm_refresh_job_ledger();

-- Disable the old job-to-table synchronization after activation, including its repair entry point.
alter function public.crm_sync_job_payments(text,text) rename to crm_sync_job_payments_legacy;
create function public.crm_sync_job_payments(p_company text,p_job_id text) returns integer language plpgsql security definer set search_path='' as $$
begin
 if public.crm_payment_ledger_enabled() then
  return (select count(*)::int from public.crm_payments where company_state_id=p_company and job_id=p_job_id and origin='job');
 end if;
 return public.crm_sync_job_payments_legacy(p_company,p_job_id);
end $$;
revoke all on function public.crm_sync_job_payments(text,text), public.crm_sync_job_payments_legacy(text,text) from public,anon,authenticated,service_role;

-- Compatibility adjustments to the original, version-checked record writer and the
-- Square binding guard. Preserve ALL other role, version, binding and stage checks.
do $$
declare f record; def text; changed text; hits integer:=0;
begin
 for f in select oid from pg_proc where pronamespace='public'::regnamespace and proname like 'crm_commit_records%' loop
  def:=pg_get_functiondef(f.oid);
  changed:=replace(def,'effective_paid := round(manual_paid +', 'effective_paid := case when old_data->>''paymentLedgerVersion''=''2'' then coalesce((old_data->>''paidAmount'')::numeric,0) else round(manual_paid +');
  if changed<>def then
   changed:=replace(changed,'-manual_paid,0))),2);','-manual_paid,0))),2) end;');
   execute changed; hits:=hits+1;
  end if;
 end loop;
 if hits<>1 then raise exception 'unknown_record_payment_guard'; end if;
 def:=pg_get_functiondef('public.crm_square_protect_payment_authority()'::regprocedure);
 changed:=replace(def,'    square_total:=coalesce(', '    if old.data->>''paymentLedgerVersion''=''2'' then return new; end if;
    square_total:=coalesce(');
 if changed=def then raise exception 'unknown_square_job_validation'; end if; execute changed;
end $$;

-- Reconcile under a write barrier. Roll back everything on a discrepancy, never
-- synthesize provider IDs from an aggregate, and leave deleted historical jobs alone.
create function public.crm_activate_payment_ledger(p_history jsonb default '[]') returns jsonb language plpgsql security definer set search_path='' as $$
declare co text:=public.crm_base_state_id(); comparison jsonb; old_total numeric; new_total numeric;
 snap jsonb; li public.crm_records%rowtype; job public.crm_records%rowtype; t jsonb; tids text[]:='{}'; invs text[]:='{}';
 net numeric; cents numeric; refunded numeric; received timestamptz; txid text; inv text; ord text; env text; merchant text;
begin
 if auth.uid() is not null then raise exception 'server_only' using errcode='42501'; end if;
 lock table public.crm_records,public.crm_payments,public.crm_refunds in share row exclusive mode;
 if public.crm_payment_ledger_enabled() then return jsonb_build_object('alreadyActive',true); end if;
 comparison:=public.crm_payments_reconciliation();
 if comparison->>'matched' is distinct from 'true' then raise exception 'ledger_cutover_reconciliation_failed'; end if;
 old_total:=(public.crm_ledger_totals()->>'collected')::numeric;
 if jsonb_typeof(p_history) is distinct from 'array' then raise exception 'invalid_square_history'; end if;
 for snap in select value from jsonb_array_elements(p_history) loop
  inv:=snap->>'invoiceId';ord:=snap->>'orderId';env:=snap->>'environment';merchant:=snap->>'merchant';
  if inv is null or inv=any(invs) or coalesce(env,'') not in ('sandbox','production') or coalesce(merchant,'')='' or coalesce(ord,'')='' or jsonb_typeof(snap->'tenders') is distinct from 'array' then raise exception 'invalid_square_history'; end if;
  invs:=array_append(invs,inv);
  select e.* into strict li from public.crm_records e where e.company_state_id=co and e.record_type='estimate' and e.deleted_at is null and e.data->>'squareInvoiceId'=inv order by e.id limit 1;
  select j.* into strict job from public.crm_records j where j.company_state_id=co and j.record_type='job' and j.deleted_at is null and j.id=li.job_id and j.lead_id=li.lead_id;
  if exists(select 1 from public.crm_records e where e.company_state_id=co and e.record_type='estimate' and e.deleted_at is null and e.data->>'squareInvoiceId'=inv and
   (e.job_id is distinct from job.id or e.lead_id is distinct from job.lead_id or e.data->>'squareOrderId' is distinct from ord or public.crm_money(e.data->>'paidAmount') is distinct from (snap->>'paidAmount')::numeric))
  or exists(select 1 from public.crm_square_invoice_watermarks w where w.company_state_id=co and w.invoice_id=inv and
   (w.merchant_id<>merchant or w.environment<>env or w.order_id<>ord or w.job_id<>job.id or w.invoice_version>(snap->>'version')::bigint))
  then raise exception 'historical_square_mapping_changed'; end if;
  net:=0;
  for t in select value from jsonb_array_elements(snap->'tenders') loop
   txid:=t->>'id';cents:=(t->>'grossCents')::numeric;refunded:=(t->>'refundedCents')::numeric;received:=(t->>'receivedAt')::timestamptz;
   if coalesce(txid,'') !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$' or txid=any(tids) or cents is null or cents<=0 or cents<>trunc(cents)
    or refunded is null or refunded<>trunc(refunded) or refunded<0 or refunded>cents or received is null or not isfinite(received) then raise exception 'invalid_historical_square_capture'; end if;
   tids:=array_append(tids,txid); net:=net+(cents-refunded)/100;
   insert into public.crm_payments(company_state_id,id,lead_id,job_id,amount,provider_refunded,method,provider,provider_payment_id,provider_invoice,received_at,origin,created_by,updated_by)
   values(co,'sq-'||md5(jsonb_build_array(env,merchant,txid)::text),job.lead_id,job.id,cents/100,refunded/100,'Square','square',txid,inv,received,'square',coalesce(job.updated_by,job.owner_id),coalesce(job.updated_by,job.owner_id));
  end loop;
  if net is distinct from (snap->>'paidAmount')::numeric then raise exception 'historical_square_total_mismatch'; end if;
 end loop;
 if exists(select 1 from public.crm_records e where e.company_state_id=co and e.record_type='estimate' and e.deleted_at is null and coalesce(e.data->>'squareInvoiceId','')<>'' and
  (public.crm_money(e.data->>'paidAmount')<>0 or upper(coalesce(e.data->>'squareStatus','')) in ('REFUNDED','PARTIALLY_REFUNDED','PAID','PARTIALLY_PAID')) and not(e.data->>'squareInvoiceId'=any(invs)))
 or exists(select 1 from public.crm_records j where j.company_state_id=co and j.record_type='job' and j.deleted_at is null and
   coalesce(nullif(j.data->>'squarePaidAmount','')::numeric,greatest(0,public.crm_money(j.data->>'paidAmount')-
     (select coalesce(sum(p.amount),0) from public.crm_payments p where p.company_state_id=co and p.job_id=j.id and p.origin='job'))) <>
   (select coalesce(sum(p.amount-p.provider_refunded),0) from public.crm_payments p where p.company_state_id=co and p.job_id=j.id and p.origin='square'))
 then raise exception 'verified_historical_square_tenders_required_before_cutover'; end if;
 perform set_config('crm.ledger_cutover','on',true);
 insert into public.crm_state(id,data,version) values(co||':payment-ledger-v2','{"active":true}',1);
 update public.crm_records set version=version+1,updated_at=clock_timestamp()
 where company_state_id=co and record_type='job' and deleted_at is null;
 perform set_config('crm.ledger_cutover','off',true);
 new_total:=(public.crm_ledger_totals()->>'collected')::numeric;
 if old_total is null or new_total is distinct from old_total then raise exception 'ledger_cutover_changed_collected_total'; end if;
 return jsonb_build_object('active',true,'before',old_total,'after',new_total);
end $$;
revoke all on function public.crm_activate_payment_ledger(jsonb) from public,anon,authenticated;
grant execute on function public.crm_activate_payment_ledger(jsonb) to service_role;

create function public.crm_write_job_payment(p_job text,p_id text,p_payment jsonb,p_expected timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare co text:=public.crm_base_state_id(); actor uuid:=auth.uid(); j public.crm_records%rowtype;
 existing public.crm_payments%rowtype; amt numeric; received timestamptz; op text;
begin
 if actor is null or not public.is_crm_admin() then raise exception 'admin_required_for_payments' using errcode='42501'; end if;
 if not public.crm_payment_ledger_enabled() then raise exception 'ledger_not_active'; end if;
 if coalesce(p_id,'') !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$' then raise exception 'invalid_payment_id' using errcode='22023'; end if;
 select * into strict j from public.crm_records where company_state_id=co and record_type='job' and id=p_job and deleted_at is null for update;
 if not exists(select 1 from public.crm_records where company_state_id=co and record_type='contact' and id=j.lead_id and deleted_at is null and coalesce(data->>'archived','false')<>'true') then raise exception 'lead_not_active'; end if;
 select * into existing from public.crm_payments where company_state_id=co and id=p_id for update;
 if found and (existing.origin<>'job' or existing.job_id<>p_job or existing.lead_id<>j.lead_id) then raise exception 'payment_identity_conflict' using errcode='PT409'; end if;
 if p_payment is null then
  if p_expected is null then raise exception 'payment_version_required'; end if;
  if existing.id is null then return jsonb_build_object('deleted',true,'id',p_id); end if;
  if existing.updated_at<>p_expected then raise exception 'payment_changed_reload' using errcode='PT409'; end if;
  delete from public.crm_payments where company_state_id=co and id=p_id; op:='removed';
 else
  amt:=(p_payment->>'amount')::numeric;
  if amt is null or amt<=0 or amt<>round(amt,2) or amt>999999999999.99 or coalesce(p_payment->>'date','') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(trim(p_payment->>'method'),'')='' then raise exception 'invalid_payment' using errcode='22023'; end if;
  received:=((p_payment->>'date')::date+time '17:00') at time zone 'UTC';
  if existing.id is not null and (existing.amount,existing.received_at,existing.method,existing.note,existing.reference) is not distinct from
   (amt,received,trim(p_payment->>'method'),coalesce(p_payment->>'note',''),coalesce(p_payment->>'reference','')) then return to_jsonb(existing); end if;
  if existing.updated_at is distinct from p_expected then raise exception 'payment_changed_reload' using errcode='PT409'; end if;
  if existing.id is null then
   if exists(select 1 from public.crm_audit_events where company_state_id=co and event_type='job_payment_removed' and metadata->>'paymentId'=p_id)
   then raise exception 'payment_was_removed' using errcode='PT409'; end if;
   perform set_config('crm.payment_sync','on',true);
   insert into public.crm_payments(company_state_id,id,lead_id,job_id,amount,method,reference,note,received_at,origin,created_by,updated_by)
   values(co,p_id,j.lead_id,p_job,amt,trim(p_payment->>'method'),coalesce(p_payment->>'reference',''),coalesce(p_payment->>'note',''),received,'job',actor,actor) returning * into existing;
   perform set_config('crm.payment_sync','off',true); op:='recorded';
  else
   if exists(select 1 from public.crm_payment_allocations where company_state_id=co and payment_id=p_id) or exists(select 1 from public.crm_refunds where company_state_id=co and payment_id=p_id) then raise exception 'payment_has_financial_history'; end if;
   update public.crm_payments set amount=amt,received_at=received,method=trim(p_payment->>'method'),note=coalesce(p_payment->>'note',''),reference=coalesce(p_payment->>'reference','')
   where company_state_id=co and id=p_id returning * into existing; op:='updated';
  end if;
 end if;
 insert into public.crm_audit_events(id,company_state_id,lead_id,job_id,event_type,actor_user_id,message,metadata)
 values(gen_random_uuid()::text,co,j.lead_id,p_job,'job_payment_'||op,actor,'Job payment '||op,jsonb_build_object('paymentId',p_id,'amount',existing.amount));
 return case when op='removed' then jsonb_build_object('deleted',true,'id',p_id) else to_jsonb(existing) end;
end $$;
revoke all on function public.crm_write_job_payment(text,text,jsonb,timestamptz) from public,anon;
grant execute on function public.crm_write_job_payment(text,text,jsonb,timestamptz) to authenticated;

create function public.crm_guard_square_tender() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (new.origin='square' or new.provider_refunded<>0 or new.provider_invoice<>'' or (new.provider='square' and public.crm_payment_ledger_enabled()))
 and (auth.uid() is not null or coalesce(auth.jwt()->>'role','')='authenticated' or current_user not in ('postgres','service_role','supabase_admin'))
 then raise exception 'square_tenders_are_server_only' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.crm_guard_square_tender() from public,anon,authenticated;
create trigger crm_guard_square_tender before insert or update on public.crm_payments for each row execute function public.crm_guard_square_tender();

-- The first-stage ledger already counts manual and invoice rows. Switch Square's
-- net source to individual verified captures without counting them as invoices too.
do $$
declare def text; changed text;
begin
 def:=pg_get_functiondef('public.crm_ledger_totals()'::regprocedure);
 changed:=replace(def,'from counted_payments where origin <> ''job''','from counted_payments where origin = ''invoice''');
 changed:=replace(changed,'select public.crm_money(j.data->>''squarePaidAmount'') as amount from jobs j',
 'select public.crm_money(j.data->>''squarePaidAmount'') as amount from jobs j where j.data->>''paymentLedgerVersion'' is distinct from ''2''
 union all select p.amount-p.provider_refunded from public.crm_payments p join jobs j on j.id=p.job_id where p.company_state_id=public.crm_base_state_id() and p.origin=''square'' and j.data->>''paymentLedgerVersion''=''2''');
 if changed=def or position('p.provider_refunded' in changed)=0 then raise exception 'unknown_ledger_definition'; end if; execute changed;
 def:=pg_get_functiondef('public.crm_square_apply_payment(text,text,text,text,uuid,jsonb)'::regprocedure);
 changed:=replace(def,'prior_paid:=null; current_invoice:=null;', 'if job.data->>''paymentLedgerVersion''=''2'' then
 manual_total:=public.crm_money(job.data->>''manualPaidAmount'')+public.crm_money(job.data->>''invoicePaidNet''); end if;
 prior_paid:=null; current_invoice:=null;');
 if changed=def then raise exception 'unknown_square_reconciliation'; end if; execute changed;
end $$;
alter function public.crm_square_apply_payment(text,text,text,text,uuid,jsonb) rename to crm_square_apply_payment_core;
alter function public.crm_square_claim_webhook(text,text,text) rename to crm_square_claim_webhook_core;
revoke all on function public.crm_square_claim_webhook_core(text,text,text) from public,anon,authenticated,service_role;
create function public.crm_square_claim_webhook(p_company text,p_environment text,p_merchant text) returns jsonb
language sql volatile security definer set search_path='' as $$
 select public.crm_square_claim_webhook_core(p_company,p_environment,p_merchant) || jsonb_build_object('ledgerV2',public.crm_payment_ledger_enabled())
$$;
revoke all on function public.crm_square_claim_webhook(text,text,text) from public,anon,authenticated;
grant execute on function public.crm_square_claim_webhook(text,text,text) to service_role;
revoke all on function public.crm_square_apply_payment_core(text,text,text,text,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.crm_square_apply_payment(p_company text,p_environment text,p_merchant text,p_event_id text,p_lease_id uuid,p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt jsonb; item jsonb; w public.crm_square_invoice_watermarks%rowtype; actor uuid;
 captured numeric:=0; net numeric:=0; charge numeric; refund numeric; txid text; ids text[]:='{}'; saved record; happened timestamptz;
begin
 -- Keep watermark comparisons compatible with all earlier releases.
 receipt:=public.crm_square_apply_payment_core(p_company,p_environment,p_merchant,p_event_id,p_lease_id,p_snapshot-'tenders');
 if not public.crm_payment_ledger_enabled() then return receipt; end if;
 select * into strict w from public.crm_square_invoice_watermarks where company_state_id=p_company and environment=p_environment and merchant_id=p_merchant and invoice_id=p_snapshot->>'invoiceId';
 if w.invoice_version>(p_snapshot->>'version')::bigint then return receipt; end if;
 if jsonb_typeof(p_snapshot->'tenders') is distinct from 'array' or jsonb_array_length(p_snapshot->'tenders')>100 then raise exception 'payment_snapshot_invalid'; end if;
 select coalesce(r.updated_by,r.owner_id,(select user_id from public.crm_user_access where role='admin' and approved order by user_id limit 1))
 into actor from public.crm_records r where r.company_state_id=p_company and r.record_type='job' and r.id=w.job_id;
 for item in select value from jsonb_array_elements(p_snapshot->'tenders') loop
  txid:=item->>'id'; charge:=(item->>'grossCents')::numeric/100; refund:=(item->>'refundedCents')::numeric/100;
  happened:=(item->>'receivedAt')::timestamptz;
  if coalesce(txid,'') !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$' or txid=any(ids) or happened is null or not isfinite(happened)
   or charge is null or refund is null or charge<>round(charge,2) or refund<>round(refund,2) or charge<=0 or refund<0 or refund>charge then raise exception 'payment_snapshot_invalid'; end if;
  ids:=array_append(ids,txid); captured:=captured+charge; net:=net+charge-refund;
  insert into public.crm_payments(company_state_id,id,lead_id,job_id,amount,provider_refunded,method,provider,provider_payment_id,provider_invoice,received_at,origin,created_by,updated_by)
  values(p_company,'sq-'||md5(jsonb_build_array(p_environment,p_merchant,txid)::text),w.lead_id,w.job_id,charge,refund,'Square','square',txid,w.invoice_id,happened,'square',actor,actor)
  on conflict(company_state_id,id) do nothing;
  select * into strict saved from public.crm_payments where company_state_id=p_company and provider='square' and provider_payment_id=txid for update;
  if saved.origin<>'square' or saved.job_id<>w.job_id or saved.lead_id<>w.lead_id or saved.provider_invoice<>w.invoice_id or saved.amount<>charge
    or saved.received_at<>happened or saved.provider_refunded>refund then raise exception 'payment_history_ambiguous'; end if;
  if saved.provider_refunded<refund then update public.crm_payments set provider_refunded=refund where company_state_id=p_company and id=saved.id; end if;
 end loop;
 if net<>(p_snapshot->>'paidAmount')::numeric or captured<>(select coalesce(sum((e->>'paidAmount')::numeric),0) from jsonb_array_elements(p_snapshot->'paymentRequests') e)
  or exists(select 1 from public.crm_payments where company_state_id=p_company and origin='square' and provider_invoice=w.invoice_id and not(provider_payment_id=any(ids))) then
  raise exception 'payment_history_ambiguous'; end if;
 return receipt;
end $$;
revoke all on function public.crm_square_apply_payment(text,text,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crm_square_apply_payment(text,text,text,text,uuid,jsonb) to service_role;

alter function public.crm_payments_reconciliation() rename to crm_payments_reconciliation_legacy;
create function public.crm_payments_reconciliation() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cnt int; n int; total numeric;
begin
 if auth.uid() is not null and not public.can_manage_team_crm() then raise exception 'manager_required' using errcode='42501'; end if;
 if not public.crm_payment_ledger_enabled() then return public.crm_payments_reconciliation_legacy(); end if;
 select count(*) into cnt from public.crm_records j where j.company_state_id=public.crm_base_state_id() and j.record_type='job' and j.deleted_at is null
 and (coalesce(j.data->>'paymentLedgerVersion','')<>'2' or coalesce(j.data->'manualPayments','[]')<>'[]' or not(j.data @> (public.crm_job_ledger_fields(j.company_state_id,j.id,j.lead_id)-'lastPaymentAt')));
 select count(*),coalesce(sum(amount),0) into n,total from public.crm_payments where company_state_id=public.crm_base_state_id() and origin='job';
 return jsonb_build_object('source','ledger','matched',cnt=0,'differenceCount',cnt,'rowsFromJobs',n,'totalInTable',total);
end $$;
revoke all on function public.crm_payments_reconciliation() from public,anon;
grant execute on function public.crm_payments_reconciliation() to authenticated,service_role;
commit;

