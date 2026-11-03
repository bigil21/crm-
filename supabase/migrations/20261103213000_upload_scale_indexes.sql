-- Cover the remaining authorization foreign keys so user provisioning and
-- OAuth cleanup do not require avoidable table scans as the CRM grows.
create index if not exists crm_oauth_states_crm_user_id_idx
  on public.crm_oauth_states (crm_user_id);

create index if not exists crm_user_access_approved_by_idx
  on public.crm_user_access (approved_by);
