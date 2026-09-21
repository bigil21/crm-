-- Apply after the conflict-safe record-write migration and matching frontend.
-- No business data is changed. Older clients must not keep writing company
-- snapshots on behalf of sales users. Existing read permissions remain intact.
begin;

drop policy if exists "Only admins insert company settings" on public.crm_state;
create policy "Only admins insert company settings" on public.crm_state
as restrictive for insert to authenticated
with check (
  id <> public.crm_base_state_id() || ':company'
  or (public.is_crm_admin() and owner_id is null)
);

drop policy if exists "Only admins update company settings" on public.crm_state;
create policy "Only admins update company settings" on public.crm_state
as restrictive for update to authenticated
using (id <> public.crm_base_state_id() || ':company' or public.is_crm_admin())
with check (
  id <> public.crm_base_state_id() || ':company'
  or (public.is_crm_admin() and owner_id is null)
);

-- TRUNCATE is not subject to row-level security. Client code has no use for it.
revoke truncate, delete on public.crm_state from authenticated, anon;
commit;
