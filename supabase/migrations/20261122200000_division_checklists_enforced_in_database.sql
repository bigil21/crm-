-- Stage checklists for Construction and Home Services, enforced by the database.
--
-- Until now the database checked the stage checklist for roofing jobs only.
-- Construction and Home Services jobs were held to their checklists by the
-- browser alone, so an old tab, a bug or a second client could move a job
-- forward with steps undone.
--
-- This replaces crm_assert_job_stage_transition with the same function plus
-- the two missing divisions. The roofing rules are unchanged. The item ids are
-- the ones in workflow-checklists-v65.js (constructionChecklistDefinitions and
-- servicesChecklistDefinitions); the two lists must be kept in step.
--
-- Deliberately no stricter than the browser:
--   - a stage the company added itself in Settings has nothing to complete;
--   - a manager moving a job back, and a move to Lost, are not held to it;
--   - a job with no lead record keeps the previous behaviour (order and
--     payment are checked, the checklist is not).

begin;

create or replace function public.crm_assert_job_stage_transition(p_change jsonb,p_changes jsonb)
returns void language plpgsql security definer set search_path=''
as $$
declare
  old_row public.crm_records%rowtype;
  old_status text; new_status text; v_division text; lead text; job_data jsonb; contact_data jsonb; stage_data jsonb;
  stages text[]; required_keys text[]; key text; old_index integer; new_index integer; estimate_ready boolean := false;
  contract_value numeric := 0; paid_amount numeric := 0;
begin
  if p_change->>'record_type' <> 'job' or coalesce(p_change->>'operation','upsert') <> 'upsert' then return; end if;
  v_division := coalesce(nullif(p_change->'data'->>'division',''),'roofing');
  select array_agg(s.name order by s.display_order) into stages from public.crm_pipeline_stages s
    where s.company_state_id=public.crm_base_state_id() and s.division_id=v_division and s.active;
  if coalesce(array_length(stages,1),0)=0 then raise exception 'pipeline_not_configured' using errcode='23514'; end if;
  select * into old_row from public.crm_records where company_state_id=public.crm_base_state_id()
    and record_type='job' and id=p_change->>'id';
  if not found then
    if coalesce(p_change->'data'->>'status',stages[1]) <> stages[1] then raise exception 'new_job_must_start_first_stage' using errcode='23514'; end if;
    return;
  end if;
  old_status := coalesce(old_row.data->>'status',stages[1]);
  new_status := coalesce(p_change->'data'->>'status',old_status);
  if new_status=old_status or new_status='Lost' then return; end if;
  old_index := array_position(stages,old_status); new_index := array_position(stages,new_status);
  if public.can_manage_team_crm() and new_index is not null and ((old_index is null and new_status=stages[1]) or new_index<old_index) then return; end if;
  if old_index is null or new_index is null or new_index<>old_index+1 then raise exception 'invalid_stage_transition' using errcode='23514'; end if;
  job_data := p_change->'data';
  -- The lead as it will be after this save: the copy in this request if it is
  -- being saved with the job, otherwise the stored one.
  lead:=coalesce(nullif(p_change->>'lead_id',''),old_row.lead_id);
  select c.value->'data' into contact_data from jsonb_array_elements(p_changes) c(value)
    where c.value->>'record_type'='contact' and c.value->>'id'=lead and coalesce(c.value->>'operation','upsert')='upsert' limit 1;
  if contact_data is null then select data into contact_data from public.crm_records where company_state_id=public.crm_base_state_id() and record_type='contact' and id=lead and deleted_at is null; end if;

  if v_division<>'roofing' then
    if contact_data is not null then
      stage_data:=coalesce(jsonb_extract_path(contact_data,'workflowChecklists',p_change->>'id',old_status),'{}'::jsonb);
      required_keys:=case
        when v_division='construction' then case old_status
          when 'Consultation' then array['consultation-complete','goals-budget','site-visit-scheduled']
          when 'Design & Selections' then array['site-measured','existing-photos','scope-drafted','design-approved','selections-recorded','trade-pricing']
          when 'Estimate' then array['estimate-reviewed','revisions-documented']
          when 'Contract' then array['signed-contract','deposit-terms','hoa-financing','production-handoff']
          when 'Permits' then array['permits-submitted','permits-issued','noc-recorded','start-date']
          when 'Demo' then array['site-protection','demo-complete','debris-removed','hidden-conditions']
          when 'Rough-In' then array['framing-complete','trades-rough-in','rough-photos','inspections-requested']
          when 'Inspections' then array['inspections-passed','corrections-complete','results-saved']
          when 'Finishes' then array['finishes-installed','change-orders','quality-check']
          when 'Punch List' then array['punch-created','punch-complete','final-clean']
          when 'Final Walkthrough' then array['walkthrough','final-invoice','warranty-docs']
          else array[]::text[] end
        when v_division='services' then case old_status
          when 'Request' then array['request-confirmed','price-quoted','visit-agreed']
          when 'Scheduled' then array['price-approved','crew-assigned','customer-notified','access-notes']
          when 'Completed' then array['work-complete','customer-signoff','invoice-sent']
          else array[]::text[] end
        else array[]::text[] end;
      foreach key in array required_keys loop
        if lower(coalesce(stage_data->>key,'')) <> 'true' then raise exception 'workflow_checklist_incomplete' using errcode='23514'; end if;
      end loop;
      -- The first stage is checked from the record itself, as the browser does.
      if old_status='New' and v_division='construction' and not (
        length(trim(coalesce(contact_data->>'name','')))>0 and length(trim(coalesce(contact_data->>'phone','')))>0 and
        length(trim(coalesce(contact_data->>'email','')))>0 and length(trim(coalesce(contact_data->>'source','')))>0 and
        length(trim(coalesce(nullif(job_data->>'address',''),contact_data->>'address','')))>0 and
        length(trim(coalesce(nullif(job_data->>'salesRep',''),contact_data->>'salesRep','')))>0 and
        coalesce(nullif(job_data->>'salesRep',''),contact_data->>'salesRep','')<>'Unassigned' and
        length(trim(coalesce(nullif(job_data->>'notes',''),contact_data->>'notes','')))>0)
        then raise exception 'workflow_checklist_incomplete' using errcode='23514'; end if;
      if old_status='New' and v_division='services' and not (
        length(trim(coalesce(contact_data->>'name','')))>0 and length(trim(coalesce(contact_data->>'phone','')))>0 and
        length(trim(coalesce(nullif(job_data->>'address',''),contact_data->>'address','')))>0 and
        length(trim(coalesce(nullif(job_data->>'notes',''),contact_data->>'notes','')))>0)
        then raise exception 'workflow_checklist_incomplete' using errcode='23514'; end if;
      -- Construction's Estimate stage needs an estimate that has been sent.
      -- An older estimate saved without a job id counts for its lead, as it
      -- does in the browser.
      if v_division='construction' and old_status='Estimate' then
        select exists(
          select 1 from public.crm_records e where e.company_state_id=public.crm_base_state_id() and e.record_type='estimate' and e.deleted_at is null
            and (e.job_id=p_change->>'id' or (coalesce(e.job_id,'')='' and e.lead_id=lead)) and e.data->>'status' in ('Sent','Won','Approved')
          union all
          select 1 from jsonb_array_elements(p_changes) c(value) where c.value->>'record_type'='estimate' and coalesce(c.value->>'operation','upsert')='upsert'
            and (c.value->>'job_id'=p_change->>'id' or (coalesce(c.value->>'job_id','')='' and c.value->>'lead_id'=lead)) and c.value->'data'->>'status' in ('Sent','Won','Approved')
        ) into estimate_ready;
        if not estimate_ready then raise exception 'workflow_checklist_incomplete' using errcode='23514'; end if;
      end if;
    end if;
    if new_status='Paid' then
      contract_value:=coalesce(nullif(job_data->>'contractValue','')::numeric,nullif(job_data->>'value','')::numeric,0);
      paid_amount:=coalesce(nullif(old_row.data->>'paidAmount','')::numeric,0);
      if contract_value<=0 or paid_amount+0.005<contract_value then raise exception 'full_payment_required' using errcode='23514'; end if;
    end if;
    return;
  end if;

  -- Roofing: unchanged.
  if contact_data is null then raise exception 'stage_contact_required' using errcode='23514'; end if;
  stage_data:=coalesce(jsonb_extract_path(contact_data,'workflowChecklists',p_change->>'id',old_status),'{}'::jsonb);
  required_keys:=case old_status
    when 'Contacted' then array['customer-reached','decision-maker','needs-documented','inspection-scheduled','project-path']
    when 'Inspection' then array['inspection-complete','photos-measurements','findings-documented','scope-selected']
    when 'Estimate Sent' then array['estimate-reviewed','follow-up-scheduled','objections-documented','approval-received']
    when 'Won' then array['signed-contract','deposit-terms','production-handoff','permit-review','expectations-confirmed']
    when 'Scheduled' then array['start-date','crew-assigned','supplier-confirmed','customer-notified','access-notes']
    when 'Materials Ordered' then array['order-confirmed','delivery-confirmed','crew-reconfirmed','prestart-message','prejob-plan']
    when 'In Progress' then array['work-started','progress-current','change-orders','quality-check','punch-list']
    when 'Completed' then array['completion-photos','final-invoice','warranty-docs','walkthrough'] else array[]::text[] end;
  foreach key in array required_keys loop
    if coalesce((stage_data->>key)::boolean,false) is not true then raise exception 'workflow_checklist_incomplete' using errcode='23514'; end if;
  end loop;
  if old_status='New' and not (length(trim(coalesce(contact_data->>'name','')))>0 and length(trim(coalesce(contact_data->>'phone','')))>0 and
    length(trim(coalesce(contact_data->>'email','')))>0 and length(trim(coalesce(contact_data->>'source','')))>0 and
    length(trim(coalesce(nullif(job_data->>'address',''),contact_data->>'address','')))>0 and
    length(trim(coalesce(nullif(job_data->>'salesRep',''),contact_data->>'salesRep','')))>0 and
    coalesce(nullif(job_data->>'salesRep',''),contact_data->>'salesRep','')<>'Unassigned' and
    length(trim(coalesce(nullif(job_data->>'notes',''),contact_data->>'notes','')))>0)
    then raise exception 'workflow_checklist_incomplete' using errcode='23514'; end if;
  if old_status='Inspection' then
    select exists(select 1 from public.crm_records where company_state_id=public.crm_base_state_id() and record_type='estimate' and job_id=p_change->>'id' and deleted_at is null
      union all select 1 from jsonb_array_elements(p_changes) c(value) where c.value->>'record_type'='estimate' and c.value->>'job_id'=p_change->>'id' and coalesce(c.value->>'operation','upsert')='upsert') into estimate_ready;
    if not estimate_ready then raise exception 'workflow_checklist_incomplete' using errcode='23514'; end if;
  end if;
  if old_status='Estimate Sent' then
    select exists(select 1 from public.crm_records where company_state_id=public.crm_base_state_id() and record_type='estimate' and job_id=p_change->>'id' and deleted_at is null and data->>'status' in ('Sent','Won')
      union all select 1 from jsonb_array_elements(p_changes) c(value) where c.value->>'record_type'='estimate' and c.value->>'job_id'=p_change->>'id' and c.value->'data'->>'status' in ('Sent','Won')) into estimate_ready;
    if not estimate_ready then raise exception 'workflow_checklist_incomplete' using errcode='23514'; end if;
  end if;
  if old_status='Completed' and new_status='Paid' then
    contract_value:=coalesce(nullif(job_data->>'contractValue','')::numeric,nullif(job_data->>'value','')::numeric,0);
    paid_amount:=coalesce(nullif(old_row.data->>'paidAmount','')::numeric,0);
    if contract_value<=0 or paid_amount+0.005<contract_value then raise exception 'full_payment_required' using errcode='23514'; end if;
  end if;
end;
$$;
revoke all on function public.crm_assert_job_stage_transition(jsonb,jsonb) from public,anon,authenticated;

commit;
