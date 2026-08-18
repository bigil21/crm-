-- Allow every authenticated Coastal Crest CRM user to read and edit all shared
-- leads, jobs, estimates, tasks, and document metadata, regardless of who
-- originally created or owns the record.

drop policy if exists "Company users read durable CRM records" on public.crm_records;
drop policy if exists "Company users create durable CRM records" on public.crm_records;
drop policy if exists "Company users update durable CRM records" on public.crm_records;
drop policy if exists "Company users delete durable CRM records" on public.crm_records;

create policy "Company users read durable CRM records"
on public.crm_records for select to authenticated
using (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
);

create policy "Company users create durable CRM records"
on public.crm_records for insert to authenticated
with check (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
  and updated_by = auth.uid()
);

create policy "Company users update durable CRM records"
on public.crm_records for update to authenticated
using (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
)
with check (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
  and updated_by = auth.uid()
);

create policy "Company users delete durable CRM records"
on public.crm_records for delete to authenticated
using (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
);
