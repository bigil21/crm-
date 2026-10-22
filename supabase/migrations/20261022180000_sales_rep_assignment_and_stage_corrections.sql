-- Sales-rep fixes:
-- 1. Managers can correct a job's stage (move back, or reopen Lost at New).
--    Previously no role, including admin, could ever undo a stage change.
-- 2. crm_assignable_users() lets managers pick an approved team member as a
--    lead's Sales Rep, which sets the lead's owner_id (and so who can see it).
begin;

create or replace function public.crm_assert_job_stage_transition(p_change jsonb,p_changes jsonb)
returns void language plpgsql security definer set search_path=''
as $$
declare
  old_row public.crm_records%rowtype;
  old_status text; new_status text; lead text; job_data jsonb; contact_data jsonb; stage_data jsonb;
  stages text[] := array['New','Contacted','Inspection','Estimate Sent','Won','Scheduled','Materials Ordered','In Progress','Completed','Paid'];
  required_keys text[]; key text; old_index integer; new_index integer; estimate_ready boolean := false;
  contract_value numeric := 0; paid_amount numeric := 0;
begin
  if p_change->>'record_type' <> 'job' or coalesce(p_change->>'operation','upsert') <> 'upsert' then return; end if;
  select * into old_row from public.crm_records where company_state_id=public.crm_base_state_id()
    and record_type='job' and id=p_change->>'id';
  if not found then
    if coalesce(p_change->'data'->>'status','New') <> 'New' then
      raise exception 'new_job_must_start_new' using errcode='23514';
    end if;
    return;
  end if;
  old_status := coalesce(old_row.data->>'status','New');
  new_status := coalesce(p_change->'data'->>'status',old_status);
  if new_status = old_status or new_status = 'Lost' then return; end if;
  -- Managers may correct mistakes: move a job back to an earlier stage, or
  -- reopen a Lost (or unrecognized) job at New. Forward moves stay gated.
  if public.can_manage_team_crm() then
    old_index := array_position(stages,old_status); new_index := array_position(stages,new_status);
    if new_index is not null and ((old_index is null and new_status='New') or new_index < old_index) then return; end if;
  end if;
  old_index := array_position(stages,old_status); new_index := array_position(stages,new_status);
  if old_index is null or new_index is null or new_index <> old_index + 1 then
    raise exception 'invalid_stage_transition' using errcode='23514';
  end if;
  lead := coalesce(nullif(p_change->>'lead_id',''),old_row.lead_id);
  select c.value->'data' into contact_data from jsonb_array_elements(p_changes) c(value)
    where c.value->>'record_type'='contact' and c.value->>'id'=lead and coalesce(c.value->>'operation','upsert')='upsert' limit 1;
  if contact_data is null then
    select data into contact_data from public.crm_records where company_state_id=public.crm_base_state_id()
      and record_type='contact' and id=lead and deleted_at is null;
  end if;
  if contact_data is null then raise exception 'stage_contact_required' using errcode='23514'; end if;
  job_data := p_change->'data';
  stage_data := coalesce(jsonb_extract_path(contact_data,'workflowChecklists',p_change->>'id',old_status),'{}'::jsonb);
  required_keys := case old_status
    when 'Contacted' then array['customer-reached','decision-maker','needs-documented','inspection-scheduled','project-path']
    when 'Inspection' then array['inspection-complete','photos-measurements','findings-documented','scope-selected']
    when 'Estimate Sent' then array['estimate-reviewed','follow-up-scheduled','objections-documented','approval-received']
    when 'Won' then array['signed-contract','deposit-terms','production-handoff','permit-review','expectations-confirmed']
    when 'Scheduled' then array['start-date','crew-assigned','supplier-confirmed','customer-notified','access-notes']
    when 'Materials Ordered' then array['order-confirmed','delivery-confirmed','crew-reconfirmed','prestart-message','prejob-plan']
    when 'In Progress' then array['work-started','progress-current','change-orders','quality-check','punch-list']
    when 'Completed' then array['completion-photos','final-invoice','warranty-docs','walkthrough']
    else array[]::text[] end;
  foreach key in array required_keys loop
    if coalesce((stage_data->>key)::boolean,false) is not true then
      raise exception 'workflow_checklist_incomplete' using errcode='23514';
    end if;
  end loop;
  if old_status='New' and not (
    length(trim(coalesce(contact_data->>'name','')))>0 and length(trim(coalesce(contact_data->>'phone','')))>0 and
    length(trim(coalesce(contact_data->>'email','')))>0 and length(trim(coalesce(contact_data->>'source','')))>0 and
    length(trim(coalesce(nullif(job_data->>'address',''),contact_data->>'address','')))>0 and
    length(trim(coalesce(nullif(job_data->>'salesRep',''),contact_data->>'salesRep','')))>0 and
    coalesce(nullif(job_data->>'salesRep',''),contact_data->>'salesRep','')<>'Unassigned' and
    length(trim(coalesce(nullif(job_data->>'notes',''),contact_data->>'notes','')))>0
  ) then raise exception 'workflow_checklist_incomplete' using errcode='23514'; end if;
  if old_status='Inspection' then
    select exists(
      select 1 from public.crm_records where company_state_id=public.crm_base_state_id() and record_type='estimate'
        and job_id=p_change->>'id' and deleted_at is null
      union all
      select 1 from jsonb_array_elements(p_changes) c(value) where c.value->>'record_type'='estimate'
        and c.value->>'job_id'=p_change->>'id' and coalesce(c.value->>'operation','upsert')='upsert'
    ) into estimate_ready;
    if not estimate_ready then raise exception 'workflow_checklist_incomplete' using errcode='23514'; end if;
  end if;
  if old_status='Estimate Sent' then
    select exists(
      select 1 from public.crm_records where company_state_id=public.crm_base_state_id() and record_type='estimate'
        and job_id=p_change->>'id' and deleted_at is null and data->>'status' in ('Sent','Won')
      union all
      select 1 from jsonb_array_elements(p_changes) c(value) where c.value->>'record_type'='estimate'
        and c.value->>'job_id'=p_change->>'id' and c.value->'data'->>'status' in ('Sent','Won')
    ) into estimate_ready;
    if not estimate_ready then raise exception 'workflow_checklist_incomplete' using errcode='23514'; end if;
  end if;
  if old_status='Completed' and new_status='Paid' then
    contract_value := coalesce(nullif(job_data->>'contractValue','')::numeric,nullif(job_data->>'value','')::numeric,0);
    -- Payment totals are server-owned. Never trust the submitted JSON here;
    -- otherwise a caller could spoof a full balance merely to pass the gate.
    paid_amount := coalesce(nullif(old_row.data->>'paidAmount','')::numeric,0);
    if contract_value <= 0 or paid_amount + 0.005 < contract_value then
      raise exception 'full_payment_required' using errcode='23514';
    end if;
  end if;
end;
$$;
revoke all on function public.crm_assert_job_stage_transition(jsonb,jsonb) from public,anon,authenticated;

create or replace function public.crm_assignable_users()
returns table(user_id uuid,email text,role text,name text)
language sql stable security definer set search_path=''
as $$
  select a.user_id,a.email,a.role,
    coalesce(nullif(trim(u.raw_user_meta_data->>'name'),''),nullif(trim(u.raw_user_meta_data->>'full_name'),''),split_part(a.email,'@',1))
  from public.crm_user_access a join auth.users u on u.id=a.user_id
  where a.approved and a.role in ('admin','office_manager','sales_manager','operations_manager','sales','production')
    and public.can_manage_team_crm()
  order by 4,2;
$$;
revoke all on function public.crm_assignable_users() from public,anon;
grant execute on function public.crm_assignable_users() to authenticated;

commit;
