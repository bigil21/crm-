-- QA issue 26: crm_create_maintenance_plan and crm_link_account_property declared
-- PL/pgSQL variables named lead_id and job_id. Those are also crm_records
-- columns, so the job lookup inside each function failed on every call with
-- `column reference "job_id" is ambiguous` (42702) and no maintenance plan or
-- property link could ever be saved. Re-create both with prefixed variables.
-- Signatures, grants and behaviour are unchanged; safe to re-run.
create or replace function public.crm_create_maintenance_plan(p_plan jsonb,p_visit jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$
-- Variables carry a v_ prefix: a bare lead_id or job_id is also a crm_records
-- column, and PostgreSQL rejects the call with 42702 (ambiguous column).
declare v_company_id text:=public.crm_base_state_id(); v_lead_id text:=coalesce(p_plan->>'lead_id',''); v_job_id text:=coalesce(p_plan->>'job_id','');
begin
  if not public.crm_project_row_access(v_company_id,v_lead_id) then raise exception 'job_access_required'; end if;
  if coalesce(p_plan->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' or coalesce(p_visit->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' then raise exception 'invalid_maintenance_payload'; end if;
  if not exists(select 1 from public.crm_records r where r.company_state_id=v_company_id and r.record_type='job' and r.id=v_job_id and r.lead_id=v_lead_id and r.deleted_at is null) then raise exception 'job_not_found'; end if;
  insert into public.crm_maintenance_plans(company_state_id,id,lead_id,job_id,plan_name,service_name,frequency,interval_months,start_on,next_service_on,amount,auto_invoice,active,notes,created_by,updated_by)
  values(v_company_id,p_plan->>'id',v_lead_id,v_job_id,btrim(p_plan->>'plan_name'),btrim(p_plan->>'service_name'),p_plan->>'frequency',coalesce((p_plan->>'interval_months')::integer,12),(p_plan->>'start_on')::date,(p_plan->>'next_service_on')::date,coalesce((p_plan->>'amount')::numeric,0),coalesce((p_plan->>'auto_invoice')::boolean,false),true,coalesce(p_plan->>'notes',''),auth.uid(),auth.uid());
  insert into public.crm_maintenance_visits(company_state_id,id,lead_id,job_id,plan_id,scheduled_for,status,task_id,invoice_id,notes,created_by,updated_by)
  values(v_company_id,p_visit->>'id',v_lead_id,v_job_id,p_plan->>'id',(p_visit->>'scheduled_for')::timestamptz,'scheduled',coalesce(p_visit->>'task_id',''),'',coalesce(p_visit->>'notes',''),auth.uid(),auth.uid());
  return jsonb_build_object('plan_id',p_plan->>'id','visit_id',p_visit->>'id','status','scheduled');
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or not_null_violation or check_violation then raise exception 'invalid_maintenance_payload';
end;
$$;
revoke all on function public.crm_create_maintenance_plan(jsonb,jsonb) from public,anon;
grant execute on function public.crm_create_maintenance_plan(jsonb,jsonb) to authenticated;

create or replace function public.crm_link_account_property(p_property jsonb,p_contact jsonb,p_link jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$
-- Variables carry a v_ prefix: a bare lead_id or job_id is also a crm_records
-- column, and PostgreSQL rejects the call with 42702 (ambiguous column).
declare v_company_id text:=public.crm_base_state_id(); v_account_id text:=coalesce(p_property->>'account_id',''); v_lead_id text:=coalesce(p_link->>'lead_id',''); v_job_id text:=coalesce(p_link->>'job_id','');
begin
  if not public.crm_account_access(v_company_id,v_account_id) or not public.crm_project_row_access(v_company_id,v_lead_id) then raise exception 'account_job_access_required'; end if;
  if coalesce(p_property->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' or coalesce(p_link->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' then raise exception 'invalid_property_payload'; end if;
  if not exists(select 1 from public.crm_records r where r.company_state_id=v_company_id and r.record_type='job' and r.id=v_job_id and r.lead_id=v_lead_id and r.deleted_at is null) then raise exception 'job_not_found'; end if;
  insert into public.crm_account_properties(company_state_id,id,account_id,name,address,property_type,units,annual_budget,roof_system,notes,created_by,updated_by)
  values(v_company_id,p_property->>'id',v_account_id,btrim(p_property->>'name'),btrim(p_property->>'address'),coalesce(p_property->>'property_type','commercial'),coalesce((p_property->>'units')::integer,1),coalesce((p_property->>'annual_budget')::numeric,0),coalesce(p_property->>'roof_system',''),coalesce(p_property->>'notes',''),auth.uid(),auth.uid());
  if btrim(coalesce(p_contact->>'name',''))<>'' then
    if coalesce(p_contact->>'id','') !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' then raise exception 'invalid_property_payload'; end if;
    insert into public.crm_account_contacts(company_state_id,id,account_id,property_id,name,email,phone,role_name,is_primary,created_by,updated_by)
    values(v_company_id,p_contact->>'id',v_account_id,p_property->>'id',btrim(p_contact->>'name'),coalesce(p_contact->>'email',''),coalesce(p_contact->>'phone',''),coalesce(p_contact->>'role_name','Property contact'),coalesce((p_contact->>'is_primary')::boolean,true),auth.uid(),auth.uid());
  end if;
  insert into public.crm_account_record_links(company_state_id,id,account_id,property_id,lead_id,job_id,relationship,created_by,updated_by)
  values(v_company_id,p_link->>'id',v_account_id,p_property->>'id',v_lead_id,v_job_id,coalesce(p_link->>'relationship','service_location'),auth.uid(),auth.uid());
  return jsonb_build_object('account_id',v_account_id,'property_id',p_property->>'id','job_id',v_job_id,'status','linked');
exception when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation or unique_violation then raise exception 'invalid_property_payload';
end;
$$;
revoke all on function public.crm_link_account_property(jsonb,jsonb,jsonb) from public,anon;
grant execute on function public.crm_link_account_property(jsonb,jsonb,jsonb) to authenticated;
