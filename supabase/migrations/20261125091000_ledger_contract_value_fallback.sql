-- Additive pre-activation guard. Installing this migration neither activates the
-- ledger nor writes financial records. Use after canonical_payment_ledger.
begin;
set local lock_timeout = '5s';

-- Match the browser: zero or missing contractValue falls back to the job value.
-- Abort if the expected prior definition changed rather than patching a different guard.
do $repair$
declare src text := pg_get_functiondef('public.crm_guard_ledger_job()'::regprocedure);
        old_line text := $old$contract:=coalesce(nullif(new.data->>'contractValue','')::numeric,nullif(new.data->>'value','')::numeric,0);$old$;
        new_line text := $new$contract:=coalesce(nullif(public.crm_money(new.data->>'contractValue'),0),public.crm_money(new.data->>'value'),0);$new$;
begin
  if strpos(src, old_line)=0 then raise exception 'unexpected_ledger_job_guard'; end if;
  execute replace(src, old_line, new_line);
end
$repair$;

-- Numeric equality, not a checksum or a rounded aggregate. The map includes
-- deleted jobs, and changes to identity, ownership of the lead, contract,
-- paid amount, stage or deletion flag prevent activation.
create function public.crm_cutover_job_balance_snapshot()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(j.id,jsonb_build_array(
    j.lead_id, j.deleted_at is not null, j.data->>'status',
    coalesce(nullif(public.crm_money(j.data->>'contractValue'),0),public.crm_money(j.data->>'value')),
    public.crm_money(j.data->>'paidAmount')
  )), '{}'::jsonb)
  from public.crm_records j
  where j.company_state_id=public.crm_base_state_id() and j.record_type='job'
$$;
revoke all on function public.crm_cutover_job_balance_snapshot() from public,anon,authenticated,service_role;

alter function public.crm_activate_payment_ledger(jsonb) rename to crm_activate_payment_ledger_core;
revoke all on function public.crm_activate_payment_ledger_core(jsonb) from public,anon,authenticated,service_role;
create function public.crm_activate_payment_ledger(p_history jsonb default '[]')
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare before_jobs jsonb; after_jobs jsonb; receipt jsonb; job_count bigint;
begin
  if auth.uid() is not null then raise exception 'server_only' using errcode='42501'; end if;
  lock table public.crm_records,public.crm_payments,public.crm_refunds in share row exclusive mode;
  if public.crm_payment_ledger_enabled() then return jsonb_build_object('alreadyActive',true); end if;
  before_jobs:=public.crm_cutover_job_balance_snapshot();
  receipt:=public.crm_activate_payment_ledger_core(p_history);
  after_jobs:=public.crm_cutover_job_balance_snapshot();
  if before_jobs is distinct from after_jobs then
    raise exception 'ledger_cutover_changed_a_job_balance_or_status' using errcode='PT409';
  end if;
  if (receipt->>'active') is distinct from 'true'
     or receipt->>'before' is null or (receipt->>'before')::numeric is distinct from (receipt->>'after')::numeric
     or (public.crm_payments_reconciliation()->>'matched') is distinct from 'true' then
    raise exception 'ledger_cutover_did_not_reconcile' using errcode='PT409';
  end if;
  select count(*) into job_count from jsonb_object_keys(after_jobs);
  return receipt || jsonb_build_object('jobsChecked',job_count,'jobBalanceDifferences',0);
end $$;
revoke all on function public.crm_activate_payment_ledger(jsonb) from public,anon,authenticated;
grant execute on function public.crm_activate_payment_ledger(jsonb) to service_role;
-- Only a server may promote a reviewed backup; recheck under the same write
-- barrier as activation so new work can never slip between compare and commit.
create function public.crm_activate_reviewed_payment_ledger(p_history jsonb,p_day date,p_digest text,p_collected numeric)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare co text:=public.crm_base_state_id(); b jsonb; receipt jsonb; mismatches bigint; tbl text; current_rows jsonb;
begin
  if auth.uid() is not null or p_day is null or p_digest is null or p_collected is null then raise exception 'invalid_cutover_request'; end if;
  lock table public.crm_records,public.crm_payments,public.crm_refunds,public.crm_invoices,public.crm_credit_notes,public.crm_expenses in share row exclusive mode;
  if public.crm_payment_ledger_enabled() then return jsonb_build_object('alreadyActive',true); end if;
  select payload into strict b from public.crm_backups where company_state_id=co and backup_date=p_day;
  if pg_catalog.md5(b::text) is distinct from p_digest or b->'skippedTables' is distinct from '[]'::jsonb or b->'absentTables' is distinct from '[]'::jsonb then raise exception 'reviewed_backup_changed'; end if;
  with v as (
    select 'b' side,r obj from jsonb_array_elements(b->'records') r
    union all select 'a',to_jsonb(r) from public.crm_records r where r.company_state_id=co
  ), projected as (
    select side,obj->>'record_type' kind,obj->>'id' id,obj->>'lead_id' lid,obj->>'job_id' jid,(obj->>'deleted_at') is not null gone,
      (select jsonb_object_agg(key,value) from jsonb_each(obj->'data') f where key=any(array['paidAmount','manualPayments','squarePaidAmount','contractValue','value','status','division','archived','squareInvoiceId','squareOrderId','costItems','squareStatus','paymentPercent'])) fields
    from v where obj->>'record_type' in ('contact','job','estimate')
  ) select count(*) into mismatches from (select * from projected where side='b') x full join (select * from projected where side='a') y using(kind,id)
    where x.id is null or y.id is null or (x.lid,x.jid,x.gone,x.fields) is distinct from (y.lid,y.jid,y.gone,y.fields);
  if mismatches<>0 then raise exception 'records_changed_since_rehearsal'; end if;
  foreach tbl in array array['crm_payments','crm_refunds','crm_invoices','crm_credit_notes','crm_expenses'] loop
    -- The installed (inactive) ledger added two default columns to payments.
    execute format('select coalesce(jsonb_agg(%s order by t.id),''[]''::jsonb) from public.%I t where t.company_state_id=$1',
      case when tbl='crm_payments' then 'to_jsonb(t)-''provider_refunded''-''provider_invoice''' else 'to_jsonb(t)' end,tbl)
      into current_rows using co;
    if jsonb_typeof(b->'tables'->tbl) is distinct from 'array' or current_rows is distinct from
       (select coalesce(jsonb_agg(case when tbl='crm_payments' then v-'provider_refunded'-'provider_invoice' else v end order by v->>'id'),'[]'::jsonb) from jsonb_array_elements(b->'tables'->tbl) v)
       then raise exception 'financial_table_changed_since_rehearsal: %',tbl; end if;
  end loop;
  if exists(select 1 from public.crm_payments where company_state_id=co and (origin='square' or provider_invoice<>'' or provider_refunded<>0))
    then raise exception 'unexpected_pre_cutover_provider_rows'; end if;
  if exists(select 1 from public.crm_records e where e.company_state_id=co and e.record_type='estimate' and e.deleted_at is null and coalesce(e.data->>'squareInvoiceId','')<>''
    and not exists(select 1 from jsonb_array_elements(p_history) s where s->>'invoiceId'=e.data->>'squareInvoiceId' and s->>'orderId'=e.data->>'squareOrderId')) then raise exception 'not_all_linked_invoices_verified'; end if;
  if (public.crm_ledger_totals()->>'collected')::numeric is distinct from p_collected then raise exception 'collected_changed_since_rehearsal'; end if;
  receipt:=public.crm_activate_payment_ledger(p_history);
  if (receipt->>'after')::numeric is distinct from p_collected or (receipt->>'jobBalanceDifferences')::int is distinct from 0 then raise exception 'cutover_receipt_did_not_match_rehearsal'; end if;
  return receipt;
end $$;
revoke all on function public.crm_activate_reviewed_payment_ledger(jsonb,date,text,numeric) from public,anon,authenticated;
grant execute on function public.crm_activate_reviewed_payment_ledger(jsonb,date,text,numeric) to service_role;
commit;
