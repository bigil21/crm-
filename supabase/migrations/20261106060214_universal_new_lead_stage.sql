-- Add the shared intake stage before each division's existing delivery stages.
-- Keep the persisted value "New" for compatibility; the UI labels it New Lead.
-- Existing lead/job records and delivery statuses are intentionally untouched.
insert into public.crm_pipeline_stages
  (company_state_id, division_id, id, name, display_order, active)
select d.company_state_id, d.id, 'new', 'New',
  coalesce((select min(s.display_order) - 10
    from public.crm_pipeline_stages s
    where s.company_state_id = d.company_state_id
      and s.division_id = d.id and s.name <> 'New'), 0), true
from public.crm_divisions d
on conflict (company_state_id, division_id, name) do update
set active = true,
    display_order = least(public.crm_pipeline_stages.display_order, excluded.display_order),
    updated_at = clock_timestamp();
