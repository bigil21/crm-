-- Add a sales-only stage and durable stage-entry history without changing the
-- production status used by permits, scheduling, materials, and billing.

with job_rows as (
  select
    company_state_id,
    id,
    data,
    coalesce(nullif(data->>'division',''),'roofing') as division,
    lower(coalesce(nullif(data->>'status',''),'new')) as lifecycle_status,
    coalesce(nullif(data->>'salesStageEnteredAt',''),nullif(data->>'updatedAt',''),nullif(data->>'createdAt',''),updated_at::text,clock_timestamp()::text) as entered_at
  from public.crm_records
  where record_type='job'
), derived as (
  select *, case
    when lifecycle_status='lost' then 'Lost'
    when division='services' and lifecycle_status in ('completed','invoiced','paid') then 'Operations Handoff'
    when division='services' and lifecycle_status in ('approved','won') then 'Approved'
    when division='services' and lifecycle_status='scheduled' then 'Scheduled/Quoted'
    when division='services' and lifecycle_status='contacted' then 'Contacted'
    when division='services' then 'New Request'
    when division='construction' and lifecycle_status in ('paid','final walkthrough','punch list','finishes','inspections','rough-in','demo','permits','scheduled','materials ordered','in progress','completed') then 'Production Handoff'
    when division='construction' and lifecycle_status in ('contract','won') then 'Contract & Deposit'
    when division='construction' and lifecycle_status in ('estimate','estimate sent') then 'Proposal Sent'
    when division='construction' and lifecycle_status='design & selections' then 'Design & Selections'
    when division='construction' and lifecycle_status in ('inspection','site visit & measurements') then 'Site Visit & Measurements'
    when division='construction' and lifecycle_status in ('consultation','consultation scheduled') then 'Consultation Scheduled'
    when division='construction' and lifecycle_status='contacted' then 'Contacted'
    when division='construction' then 'New'
    when lifecycle_status='won' then 'Contract & Deposit'
    when lifecycle_status in ('scheduled','materials ordered','in progress','completed','paid') then 'Production Handoff'
    when lifecycle_status='estimate sent' then 'Estimate Sent'
    when lifecycle_status='inspection complete' then 'Inspection Complete'
    when lifecycle_status in ('inspection','inspection scheduled') then 'Inspection Scheduled'
    when lifecycle_status='contacted' then 'Contacted'
    else 'New'
  end as sales_stage
  from job_rows
)
update public.crm_records record
set data = jsonb_set(
  jsonb_set(
    jsonb_set(record.data,'{salesStage}',to_jsonb(coalesce(nullif(record.data->>'salesStage',''),derived.sales_stage)),true),
    '{salesStageEnteredAt}',to_jsonb(coalesce(nullif(record.data->>'salesStageEnteredAt',''),derived.entered_at)),true
  ),
  '{salesStageHistory}',
  case when jsonb_typeof(record.data->'salesStageHistory')='array' and jsonb_array_length(record.data->'salesStageHistory')>0
    then record.data->'salesStageHistory'
    else jsonb_build_array(jsonb_build_object('stage',derived.sales_stage,'enteredAt',derived.entered_at,'exitedAt','','actor',coalesce(record.data->>'salesRep','')))
  end,
  true
)
from derived
where record.company_state_id=derived.company_state_id and record.id=derived.id and record.record_type='job'
  and (nullif(record.data->>'salesStage','') is null or nullif(record.data->>'salesStageEnteredAt','') is null or coalesce(jsonb_array_length(case when jsonb_typeof(record.data->'salesStageHistory')='array' then record.data->'salesStageHistory' else '[]'::jsonb end),0)=0);

create or replace function public.crm_guard_sales_pipeline_transition()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  division text := coalesce(nullif(new.data->>'division',''),'roofing');
  property_type text := lower(coalesce(nullif(new.data->>'propertyType',''),'residential'));
  old_stage text := nullif(old.data->>'salesStage','');
  new_stage text := nullif(new.data->>'salesStage','');
  stages text[];
  old_index integer;
  new_index integer;
  history jsonb;
begin
  if new.record_type <> 'job' or new_stage is null or old_stage is null or new_stage=old_stage then return new; end if;
  -- Lifecycle status changes are already validated by crm_assert_job_stage_transition.
  -- They may legitimately cover an intermediate sales-only column (for
  -- example Inspection Scheduled -> Inspection Complete -> Estimate Sent).
  if coalesce(old.data->>'status','') is distinct from coalesce(new.data->>'status','') then return new; end if;
  if division='services' then
    stages := array['New Request','Contacted','Scheduled/Quoted','Approved','Operations Handoff'];
  elsif division='construction' then
    stages := array['New','Contacted','Consultation Scheduled','Site Visit & Measurements','Design & Selections','Proposal Sent','Revisions/Decision','Contract & Deposit','Production Handoff'];
  else
    stages := array['New','Contacted','Inspection Scheduled','Inspection Complete','Estimate Sent','Follow-Up/Decision','Contract & Deposit','Production Handoff'];
  end if;
  if property_type in ('commercial','hoa') and division <> 'services' then
    stages := stages[1:array_position(stages,'Contract & Deposit')-1]
      || array['Bid Preparation','Bid Submitted','Management Review','Board Approval']
      || stages[array_position(stages,'Contract & Deposit'):array_length(stages,1)];
  end if;
  if new_stage='Lost' then return new; end if;
  old_index := array_position(stages,old_stage);
  new_index := array_position(stages,new_stage);
  if new_index is null then raise exception 'invalid_sales_pipeline_stage' using errcode='23514'; end if;
  if old_index is null then return new; end if;
  if new_index < old_index and public.can_manage_team_crm() then return new; end if;
  if new_index <> old_index + 1 then raise exception 'invalid_sales_pipeline_transition' using errcode='23514'; end if;
  if nullif(new.data->>'salesStageEnteredAt','') is null then raise exception 'sales_stage_timestamp_required' using errcode='23514'; end if;
  history := new.data->'salesStageHistory';
  if jsonb_typeof(history) <> 'array' or jsonb_array_length(history)=0 or history->(jsonb_array_length(history)-1)->>'stage' <> new_stage then
    raise exception 'sales_stage_history_required' using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists crm_guard_sales_pipeline_transition on public.crm_records;
create trigger crm_guard_sales_pipeline_transition
before update of data on public.crm_records
for each row
when (old.record_type='job' and new.record_type='job')
execute function public.crm_guard_sales_pipeline_transition();
