-- Verify the same merchant, environment, order, invoice and tender. Keep the provider invoice's version and status intact:
-- its refund can settle before the invoice changes. The job projection is derived
-- in the existing AFTER UPDATE trigger in the same transaction.
create function public.crm_square_apply_verified_refund(
 p_company text,p_environment text,p_merchant text,p_payment text,p_invoice text,p_order text,
 p_gross bigint,p_refunded bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare w public.crm_square_invoice_watermarks%rowtype; p public.crm_payments%rowtype;
begin
 perform public.crm_square_payment_scope(p_company,p_environment,p_merchant);
 if not public.crm_payment_ledger_enabled()
    or p_gross is null or p_refunded is null or p_gross<=0 or p_refunded<=0 or p_refunded>p_gross then
   raise exception 'refund_scope_invalid'; end if;
 select * into strict w from public.crm_square_invoice_watermarks
 where company_state_id=p_company and environment=p_environment and merchant_id=p_merchant and invoice_id=p_invoice and order_id=p_order for update;
 perform 1 from public.crm_records where company_state_id=p_company and record_type='job' and id=w.job_id and lead_id=w.lead_id and deleted_at is null for update;
 if not found then raise exception 'refund_job_unavailable'; end if;
 select * into strict p from public.crm_payments where company_state_id=p_company and origin='square' and provider='square'
 and provider_payment_id=p_payment and provider_invoice=p_invoice and lead_id=w.lead_id and job_id=w.job_id
 and id='sq-'||md5(jsonb_build_array(p_environment,p_merchant,p_payment)::text) for update;
 if p.amount*100<>p_gross then raise exception 'refund_payment_disagrees'; end if;
 -- Comparing the cumulative verified amount makes duplicate and out-of-order
 -- events harmless, including an older invoice notification arriving later.
 if p.provider_refunded*100>=p_refunded then return jsonb_build_object('durable',true,'changed',false); end if;
 update public.crm_payments set provider_refunded=p_refunded::numeric/100 where company_state_id=p_company and id=p.id;
 return jsonb_build_object('durable',true,'changed',true);
end $$;
revoke all on function public.crm_square_apply_verified_refund(text,text,text,text,text,text,bigint,bigint) from public, anon, authenticated;
grant execute on function public.crm_square_apply_verified_refund(text,text,text,text,text,text,bigint,bigint) to service_role;
