-- Critical integrity repair: payment-gated completion and owner-scoped reads.
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

drop policy if exists "Company users read durable CRM records" on public.crm_records;
drop policy if exists "Approved users read assigned CRM records" on public.crm_records;
create policy "Approved users read assigned CRM records" on public.crm_records for select to authenticated
using (
  public.is_coastal_crest_user()
  and company_state_id=public.crm_base_state_id()
  and (
    public.can_manage_team_crm()
    or owner_id=(select auth.uid())
    or (record_type='document' and lead_id='company')
  )
);
revoke insert,update,delete on public.crm_records from public,anon,authenticated;

drop policy if exists "Company users read conversation messages" on public.crm_conversation_messages;
drop policy if exists "Approved users read assigned conversations" on public.crm_conversation_messages;
create policy "Approved users read assigned conversations" on public.crm_conversation_messages for select to authenticated
using (
  public.is_coastal_crest_user()
  and company_state_id=public.crm_base_state_id()
  and (
    public.can_manage_team_crm()
    or exists (
      select 1 from public.crm_records r
      where r.company_state_id=crm_conversation_messages.company_state_id
        and r.record_type='contact' and r.id=crm_conversation_messages.lead_id
        and r.owner_id=(select auth.uid()) and r.deleted_at is null
    )
  )
);

drop policy if exists "Company users create conversation messages" on public.crm_conversation_messages;
create policy "Company users create conversation messages" on public.crm_conversation_messages for insert to authenticated
with check (
  public.is_coastal_crest_user()
  and company_state_id=public.crm_base_state_id()
  and (
    public.can_manage_team_crm()
    or (
      author_user_id=(select auth.uid())::text
      and exists (
        select 1 from public.crm_records r
        where r.company_state_id=crm_conversation_messages.company_state_id
          and r.record_type='contact' and r.id=crm_conversation_messages.lead_id
          and r.owner_id=(select auth.uid()) and r.deleted_at is null
      )
    )
  )
);
drop policy if exists "Message authors update conversation messages" on public.crm_conversation_messages;
create policy "Message authors update conversation messages" on public.crm_conversation_messages for update to authenticated
using (
  public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id()
  and (
    public.can_manage_team_crm()
    or (
      author_user_id=(select auth.uid())::text
      and exists (
        select 1 from public.crm_records r
        where r.company_state_id=crm_conversation_messages.company_state_id
          and r.record_type='contact' and r.id=crm_conversation_messages.lead_id
          and r.owner_id=(select auth.uid()) and r.deleted_at is null
      )
    )
  )
)
with check (
  public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id()
  and (public.can_manage_team_crm() or author_user_id=(select auth.uid())::text)
);

drop policy if exists "Company users read CRM audit events" on public.crm_audit_events;
drop policy if exists "Approved users read assigned audit history" on public.crm_audit_events;
create policy "Approved users read assigned audit history" on public.crm_audit_events for select to authenticated
using (
  public.is_coastal_crest_user()
  and company_state_id=public.crm_base_state_id()
  and (
    public.can_manage_team_crm()
    or exists (
      select 1 from public.crm_records r
      where r.company_state_id=crm_audit_events.company_state_id
        and r.record_type='contact' and r.id=crm_audit_events.lead_id
        and r.owner_id=(select auth.uid()) and r.deleted_at is null
    )
  )
);

drop policy if exists "Approved CRM users read company document objects" on storage.objects;
create policy "Approved CRM users read company document objects"
on storage.objects for select to authenticated
using (
  bucket_id='crm-documents'
  and public.is_coastal_crest_user()
  and (storage.foldername(name))[1]=public.crm_base_state_id()
  and (
    public.can_manage_team_crm()
    or (storage.foldername(name))[2]='company'
    or exists (
      select 1 from public.crm_records r
      where r.company_state_id=public.crm_base_state_id()
        and r.record_type='document' and r.owner_id=(select auth.uid()) and r.deleted_at is null
        and (
          r.data->>'storagePath'=storage.objects.name
          or exists (
            select 1 from jsonb_array_elements(coalesce(r.data->'previousVersions','[]'::jsonb)) as version_item(value)
            where version_item.value->>'storagePath'=storage.objects.name
          )
        )
    )
  )
);

drop policy if exists "Approved CRM users append company document objects" on storage.objects;
create policy "Approved CRM users append company document objects"
on storage.objects for insert to authenticated
with check (
  bucket_id='crm-documents'
  and public.is_coastal_crest_user()
  and (storage.foldername(name))[1]=public.crm_base_state_id()
  and owner_id=(select auth.uid())::text
  and (
    public.can_manage_team_crm()
    or (storage.foldername(name))[2]='company'
    or exists (
      select 1 from public.crm_records r
      where r.company_state_id=public.crm_base_state_id()
        and r.record_type='contact' and r.id=(storage.foldername(name))[2]
        and r.owner_id=(select auth.uid()) and r.deleted_at is null
    )
  )
);

commit;
