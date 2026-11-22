-- QA issue 30: the Home Services pipeline ended at Invoiced, so a service job
-- could never be recorded as paid and was closed with money still owed.
-- Add a Paid stage after Invoiced. crm_assert_job_stage_transition already
-- requires confirmed payments covering the contract before any non-roofing
-- job enters Paid, so no function change is needed. Existing jobs are not
-- moved. Safe to re-run.
insert into public.crm_pipeline_stages
  (company_state_id, division_id, id, name, display_order, active)
select d.company_state_id, d.id, 'paid', 'Paid',
  coalesce((select max(s.display_order)
    from public.crm_pipeline_stages s
    where s.company_state_id = d.company_state_id
      and s.division_id = d.id and s.name <> 'Paid'), 0) + 10, true
from public.crm_divisions d
where d.id = 'services'
on conflict (company_state_id, division_id, name) do update
set active = true,
    display_order = greatest(public.crm_pipeline_stages.display_order, excluded.display_order),
    updated_at = clock_timestamp();
