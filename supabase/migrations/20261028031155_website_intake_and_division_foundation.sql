-- Division-aware CRM foundation and authenticated website lead intake.
begin;

create table if not exists public.crm_divisions (
  company_state_id text not null default public.crm_base_state_id(),
  id text not null check (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name text not null,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id),
  unique (company_state_id,name)
);

create table if not exists public.crm_services (
  company_state_id text not null default public.crm_base_state_id(),
  id text not null check (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  division_id text not null,
  name text not null,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,id),
  unique (company_state_id,division_id,name),
  foreign key (company_state_id,division_id) references public.crm_divisions(company_state_id,id) on delete restrict
);

create table if not exists public.crm_pipeline_stages (
  company_state_id text not null default public.crm_base_state_id(),
  division_id text not null,
  id text not null check (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name text not null,
  display_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,division_id,id),
  unique (company_state_id,division_id,name),
  unique (company_state_id,division_id,display_order),
  foreign key (company_state_id,division_id) references public.crm_divisions(company_state_id,id) on delete restrict
);

create table if not exists public.crm_website_intake_requests (
  company_state_id text not null,
  request_id text not null check (request_id ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$'),
  payload_hash text not null check (payload_hash ~ '^[a-f0-9]{64}$'),
  lead_id text not null,
  job_id text not null,
  request_payload jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id,request_id),
  unique (company_state_id,lead_id),
  unique (company_state_id,job_id)
);

create index if not exists crm_services_division_idx on public.crm_services(company_state_id,division_id,display_order);
create index if not exists crm_pipeline_stages_division_idx on public.crm_pipeline_stages(company_state_id,division_id,display_order);
create index if not exists crm_website_intake_created_idx on public.crm_website_intake_requests(company_state_id,created_at desc);

insert into public.crm_divisions(company_state_id,id,name,display_order) values
  (public.crm_base_state_id(),'roofing','Roofing',10),
  (public.crm_base_state_id(),'construction','Construction',20),
  (public.crm_base_state_id(),'services','Home Services',30)
on conflict (company_state_id,id) do update set name=excluded.name,display_order=excluded.display_order,active=true,updated_at=clock_timestamp();

insert into public.crm_services(company_state_id,id,division_id,name,display_order) values
  (public.crm_base_state_id(),'roof-replacement','roofing','Roof Replacement',10),
  (public.crm_base_state_id(),'roof-repair','roofing','Roof Repair',20),
  (public.crm_base_state_id(),'roof-inspection','roofing','Roof Inspection',30),
  (public.crm_base_state_id(),'emergency-leak-repair','roofing','Emergency Leak Repair',40),
  (public.crm_base_state_id(),'commercial-roofing','roofing','Commercial Roofing',50),
  (public.crm_base_state_id(),'preventive-maintenance','roofing','Preventive Maintenance',60),
  (public.crm_base_state_id(),'remodel-addition','construction','Remodel / Addition',10),
  (public.crm_base_state_id(),'windows-impact-openings','construction','Windows & Impact Openings',20),
  (public.crm_base_state_id(),'pool-cages-screen-enclosures','construction','Pool Cages & Screen Enclosures',30),
  (public.crm_base_state_id(),'carports','construction','Carports',40),
  (public.crm_base_state_id(),'block-masonry','construction','Block & Masonry',50),
  (public.crm_base_state_id(),'general-construction','construction','General Construction',60),
  (public.crm_base_state_id(),'pressure-washing','services','Pressure Washing',10),
  (public.crm_base_state_id(),'dump-trailer','services','Dump Trailer',20),
  (public.crm_base_state_id(),'seasonal-checkup','services','Seasonal Checkup',30),
  (public.crm_base_state_id(),'facility-maintenance','services','Facility Maintenance',40),
  (public.crm_base_state_id(),'sealant-program','services','Sealant Program',50),
  (public.crm_base_state_id(),'service-call','services','Service Call',60)
on conflict (company_state_id,id) do update set division_id=excluded.division_id,name=excluded.name,display_order=excluded.display_order,active=true,updated_at=clock_timestamp();

insert into public.crm_pipeline_stages(company_state_id,division_id,id,name,display_order) values
  (public.crm_base_state_id(),'roofing','new','New',10),(public.crm_base_state_id(),'roofing','contacted','Contacted',20),
  (public.crm_base_state_id(),'roofing','inspection','Inspection',30),(public.crm_base_state_id(),'roofing','estimate-sent','Estimate Sent',40),
  (public.crm_base_state_id(),'roofing','won','Won',50),(public.crm_base_state_id(),'roofing','scheduled','Scheduled',60),
  (public.crm_base_state_id(),'roofing','materials-ordered','Materials Ordered',70),(public.crm_base_state_id(),'roofing','in-progress','In Progress',80),
  (public.crm_base_state_id(),'roofing','completed','Completed',90),(public.crm_base_state_id(),'roofing','paid','Paid',100),
  (public.crm_base_state_id(),'construction','consultation','Consultation',10),(public.crm_base_state_id(),'construction','design-selections','Design & Selections',20),
  (public.crm_base_state_id(),'construction','estimate','Estimate',30),(public.crm_base_state_id(),'construction','contract','Contract',40),
  (public.crm_base_state_id(),'construction','permits','Permits',50),(public.crm_base_state_id(),'construction','demo','Demo',60),
  (public.crm_base_state_id(),'construction','rough-in','Rough-In',70),(public.crm_base_state_id(),'construction','inspections','Inspections',80),
  (public.crm_base_state_id(),'construction','finishes','Finishes',90),(public.crm_base_state_id(),'construction','punch-list','Punch List',100),
  (public.crm_base_state_id(),'construction','final-walkthrough','Final Walkthrough',110),(public.crm_base_state_id(),'construction','paid','Paid',120),
  (public.crm_base_state_id(),'services','request','Request',10),(public.crm_base_state_id(),'services','scheduled','Scheduled',20),
  (public.crm_base_state_id(),'services','completed','Completed',30),(public.crm_base_state_id(),'services','invoiced','Invoiced',40)
on conflict (company_state_id,division_id,id) do update set name=excluded.name,display_order=excluded.display_order,active=true,updated_at=clock_timestamp();

do $$ declare table_name text; begin
  foreach table_name in array array['crm_divisions','crm_services','crm_pipeline_stages'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
    execute format('drop policy if exists "CRM users read division configuration" on public.%I',table_name);
    execute format('drop policy if exists "CRM admins create division configuration" on public.%I',table_name);
    execute format('drop policy if exists "CRM admins update division configuration" on public.%I',table_name);
    execute format('drop policy if exists "CRM admins delete division configuration" on public.%I',table_name);
    execute format('create policy "CRM users read division configuration" on public.%I for select to authenticated using(public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id())',table_name);
    execute format('create policy "CRM admins create division configuration" on public.%I for insert to authenticated with check(public.is_crm_admin() and company_state_id=public.crm_base_state_id())',table_name);
    execute format('create policy "CRM admins update division configuration" on public.%I for update to authenticated using(public.is_crm_admin() and company_state_id=public.crm_base_state_id()) with check(public.is_crm_admin() and company_state_id=public.crm_base_state_id())',table_name);
    execute format('create policy "CRM admins delete division configuration" on public.%I for delete to authenticated using(public.is_crm_admin() and company_state_id=public.crm_base_state_id())',table_name);
    execute format('grant select,insert,update,delete on table public.%I to authenticated',table_name);
  end loop;
end $$;

alter table public.crm_website_intake_requests enable row level security;
revoke all on table public.crm_website_intake_requests from public,anon,authenticated;
drop policy if exists "CRM managers read website intake receipts" on public.crm_website_intake_requests;
create policy "CRM managers read website intake receipts" on public.crm_website_intake_requests for select to authenticated
  using(company_state_id=public.crm_base_state_id() and public.can_manage_team_crm());
grant select on table public.crm_website_intake_requests to authenticated;

create or replace function public.crm_ingest_website_request(
  p_company text,p_request_id text,p_payload_hash text,p_lead_id text,p_job_id text,p_owner_id uuid,p_request jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  existing public.crm_website_intake_requests%rowtype;
  v_division_id text := p_request->>'division';
  v_service_id text := p_request->>'service';
  initial_status text;
  owner uuid;
  lead_data jsonb;
  job_data jsonb;
begin
  if p_company is distinct from public.crm_base_state_id() or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$' or
     p_payload_hash !~ '^[a-f0-9]{64}$' or p_lead_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$' or
     p_job_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$' or jsonb_typeof(p_request) is distinct from 'object' then
    raise exception 'invalid_website_intake' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_company || ':' || p_request_id,0));
  select * into existing from public.crm_website_intake_requests where company_state_id=p_company and request_id=p_request_id;
  if found then
    if existing.payload_hash is distinct from p_payload_hash then raise exception 'request_id_reused' using errcode='22023'; end if;
    return jsonb_build_object('created',false,'lead_id',existing.lead_id,'job_id',existing.job_id);
  end if;
  if length(trim(coalesce(p_request->>'name','')))=0 or length(trim(coalesce(p_request->>'address','')))=0 or
     (length(trim(coalesce(p_request->>'email','')))=0 and length(trim(coalesce(p_request->>'phone','')))=0) then
    raise exception 'website_contact_required' using errcode='22023';
  end if;
  if not exists(select 1 from public.crm_services s where s.company_state_id=p_company and s.id=v_service_id and s.division_id=v_division_id and s.active) then
    raise exception 'invalid_division_service' using errcode='22023';
  end if;
  select s.name into initial_status from public.crm_pipeline_stages s where s.company_state_id=p_company and s.division_id=v_division_id and s.active order by s.display_order limit 1;
  if initial_status is null then raise exception 'pipeline_not_configured' using errcode='22023'; end if;
  select a.user_id into owner from public.crm_user_access a where a.user_id=p_owner_id and a.approved limit 1;
  lead_data := jsonb_build_object(
    'id',p_lead_id,'type','Lead','status',initial_status,'name',p_request->>'name','email',coalesce(p_request->>'email',''),
    'phone',coalesce(p_request->>'phone',''),'address',p_request->>'address','source','Website','division',v_division_id,
    'service',v_service_id,'propertyType',p_request->>'propertyType','urgency',p_request->>'urgency',
    'activeLeak',coalesce((p_request->>'activeLeak')::boolean,false),'insuranceClaim',coalesce((p_request->>'insuranceClaim')::boolean,false),
    'notes',coalesce(p_request->>'notes',''),'photos',coalesce(p_request->'photos','[]'::jsonb),'salesRep','Unassigned',
    'createdAt',left(coalesce(p_request->>'receivedAt',clock_timestamp()::text),10),'updatedAt',clock_timestamp()::text
  );
  job_data := jsonb_build_object(
    'id',p_job_id,'name',(p_request->>'name') || ' — ' || (select s.name from public.crm_services s where s.company_state_id=p_company and s.id=v_service_id),
    'status',initial_status,'address',p_request->>'address','division',v_division_id,'service',v_service_id,
    'propertyType',p_request->>'propertyType','urgency',p_request->>'urgency','activeLeak',coalesce((p_request->>'activeLeak')::boolean,false),
    'insuranceClaim',coalesce((p_request->>'insuranceClaim')::boolean,false),'notes',coalesce(p_request->>'notes',''),
    'photos',coalesce(p_request->'photos','[]'::jsonb),'salesRep','Unassigned','value',0,'contractValue',0,'paidAmount',0,'paymentPercent',0,
    'createdAt',left(coalesce(p_request->>'receivedAt',clock_timestamp()::text),10),'updatedAt',clock_timestamp()::text
  );
  insert into public.crm_records(company_state_id,record_type,id,lead_id,owner_id,data,version)
    values(p_company,'contact',p_lead_id,p_lead_id,owner,lead_data,1);
  insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,owner_id,data,version)
    values(p_company,'job',p_job_id,p_lead_id,p_job_id,owner,job_data,1);
  insert into public.crm_website_intake_requests(company_state_id,request_id,payload_hash,lead_id,job_id,request_payload)
    values(p_company,p_request_id,p_payload_hash,p_lead_id,p_job_id,p_request);
  insert into public.crm_audit_events(id,company_state_id,lead_id,job_id,event_type,actor_name,message,metadata)
    values('website-intake:'||p_company||':'||p_request_id,p_company,p_lead_id,p_job_id,'website_lead','Website',
      'Website request received',jsonb_build_object('division',v_division_id,'service',v_service_id,'urgency',p_request->>'urgency'));
  return jsonb_build_object('created',true,'lead_id',p_lead_id,'job_id',p_job_id,'status',initial_status);
exception when unique_violation then
  raise exception 'website_intake_conflict' using errcode='40001';
end;
$$;
revoke all on function public.crm_ingest_website_request(text,text,text,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.crm_ingest_website_request(text,text,text,text,text,uuid,jsonb) to service_role;

-- Replace the roofing-only transition list with the configured pipeline for
-- each division. Roofing keeps its existing checklist, estimate, and payment
-- gates; construction and service jobs advance exactly one configured stage.
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
  if v_division<>'roofing' then
    if new_status='Paid' then
      contract_value:=coalesce(nullif(job_data->>'contractValue','')::numeric,nullif(job_data->>'value','')::numeric,0);
      paid_amount:=coalesce(nullif(old_row.data->>'paidAmount','')::numeric,0);
      if contract_value<=0 or paid_amount+0.005<contract_value then raise exception 'full_payment_required' using errcode='23514'; end if;
    end if;
    return;
  end if;
  lead:=coalesce(nullif(p_change->>'lead_id',''),old_row.lead_id);
  select c.value->'data' into contact_data from jsonb_array_elements(p_changes) c(value)
    where c.value->>'record_type'='contact' and c.value->>'id'=lead and coalesce(c.value->>'operation','upsert')='upsert' limit 1;
  if contact_data is null then select data into contact_data from public.crm_records where company_state_id=public.crm_base_state_id() and record_type='contact' and id=lead and deleted_at is null; end if;
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
