begin;

-- Fix mutable function search paths reported by Supabase Security Advisor.
-- Every referenced non-system object is schema-qualified, so an empty search
-- path prevents object-shadowing without changing the functions' behavior.
alter function public.crm_base_state_id() set search_path = '';
alter function public.is_coastal_crest_user() set search_path = '';
alter function public.crm_app_role() set search_path = '';
alter function public.can_manage_team_crm() set search_path = '';
alter function public.set_updated_at() set search_path = '';
alter function public.is_crm_admin() set search_path = '';

-- Generic trigger helpers are implementation details, not public RPCs.
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- The Auth trigger helper is not an RPC. It must never be directly callable
-- from PostgREST. The trigger itself continues to execute as its owner.
-- Older databases have this helper; databases built from the current schema
-- do not, so only harden it when it exists (otherwise this migration aborts).
do $$ begin
  if to_regprocedure('public.apply_crm_admin_metadata()') is not null then
    alter function public.apply_crm_admin_metadata() set search_path = '';
    revoke execute on function public.apply_crm_admin_metadata() from public, anon, authenticated;
    grant execute on function public.apply_crm_admin_metadata() to supabase_auth_admin;
  end if;
end $$;

-- Anonymous sessions have no reason to call these authorization helpers.
-- Authenticated access is retained because RLS policies and the intentional
-- authenticated RPCs evaluate them for the signed-in actor.
revoke execute on function public.is_crm_admin() from public, anon;
grant execute on function public.is_crm_admin() to authenticated, service_role;

revoke execute on function public.crm_base_state_id() from public, anon;
revoke execute on function public.is_coastal_crest_user() from public, anon;
revoke execute on function public.crm_app_role() from public, anon;
revoke execute on function public.can_manage_team_crm() from public, anon;
grant execute on function public.crm_base_state_id() to authenticated, service_role;
grant execute on function public.is_coastal_crest_user() to authenticated, service_role;
grant execute on function public.crm_app_role() to authenticated, service_role;
grant execute on function public.can_manage_team_crm() to authenticated, service_role;

-- Cache the authenticated user lookup once per statement instead of once per
-- row. Policy meaning is unchanged; this removes the Advisor init-plan warnings.
drop policy if exists "Company users create CRM audit events" on public.crm_audit_events;
create policy "Company users create CRM audit events"
on public.crm_audit_events for insert to authenticated
with check (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
  and (actor_user_id = (select auth.uid()) or public.can_manage_team_crm())
);

drop policy if exists "CRM managers create backups" on public.crm_backups;
create policy "CRM managers create backups"
on public.crm_backups for insert to authenticated
with check (
  public.can_manage_team_crm()
  and company_state_id = public.crm_base_state_id()
  and created_by = (select auth.uid())
);

drop policy if exists "CRM users read allowed scoped state" on public.crm_state;
create policy "CRM users read allowed scoped state"
on public.crm_state for select to authenticated
using (
  public.is_coastal_crest_user()
  and (
    public.can_manage_team_crm()
    or owner_id = (select auth.uid())
    or id = public.crm_base_state_id() || ':company'
  )
);

drop policy if exists "CRM users create allowed scoped state" on public.crm_state;
create policy "CRM users create allowed scoped state"
on public.crm_state for insert to authenticated
with check (
  public.is_coastal_crest_user()
  and updated_by = (select auth.uid())
  and (
    public.can_manage_team_crm()
    or (
      id = public.crm_base_state_id() || ':user:' || (select auth.uid())::text
      and owner_id = (select auth.uid())
    )
    or (
      id = public.crm_base_state_id() || ':company'
      and owner_id is null
    )
  )
);

drop policy if exists "CRM users update allowed scoped state" on public.crm_state;
create policy "CRM users update allowed scoped state"
on public.crm_state for update to authenticated
using (
  public.is_coastal_crest_user()
  and (
    public.can_manage_team_crm()
    or owner_id = (select auth.uid())
    or id = public.crm_base_state_id() || ':company'
  )
)
with check (
  public.is_coastal_crest_user()
  and updated_by = (select auth.uid())
  and (
    public.can_manage_team_crm()
    or (
      id = public.crm_base_state_id() || ':user:' || (select auth.uid())::text
      and owner_id = (select auth.uid())
    )
    or (
      id = public.crm_base_state_id() || ':company'
      and owner_id is null
    )
  )
);

drop policy if exists "Company users create conversation messages" on public.crm_conversation_messages;
create policy "Company users create conversation messages"
on public.crm_conversation_messages for insert to authenticated
with check (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
  and (author_user_id = (select auth.uid())::text or public.can_manage_team_crm())
);

drop policy if exists "Message authors update conversation messages" on public.crm_conversation_messages;
create policy "Message authors update conversation messages"
on public.crm_conversation_messages for update to authenticated
using (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
  and (author_user_id = (select auth.uid())::text or public.can_manage_team_crm())
)
with check (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
  and (author_user_id = (select auth.uid())::text or public.can_manage_team_crm())
);

drop policy if exists "Company users create durable CRM records" on public.crm_records;
create policy "Company users create durable CRM records"
on public.crm_records for insert to authenticated
with check (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
  and updated_by = (select auth.uid())
);

drop policy if exists "Company users update durable CRM records" on public.crm_records;
create policy "Company users update durable CRM records"
on public.crm_records for update to authenticated
using (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
)
with check (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
  and updated_by = (select auth.uid())
);

-- Cover every foreign key reported by Performance Advisor. These indexes also
-- bound the cost of user cleanup, audit filtering, and ownership lookups.
create index if not exists crm_audit_events_actor_user_id_idx
  on public.crm_audit_events(actor_user_id);
create index if not exists crm_backups_created_by_idx
  on public.crm_backups(created_by);
create index if not exists crm_company_settings_receipts_actor_user_id_idx
  on public.crm_company_settings_receipts(actor_user_id);
create index if not exists crm_records_owner_id_idx
  on public.crm_records(owner_id);
create index if not exists crm_records_updated_by_idx
  on public.crm_records(updated_by);
create index if not exists crm_sales_numbers_created_by_idx
  on public.crm_sales_numbers(created_by);
create index if not exists crm_square_invoice_intents_created_by_idx
  on public.crm_square_invoice_intents(created_by);
create index if not exists crm_square_invoice_reviews_reviewed_by_idx
  on public.crm_square_invoice_reviews(reviewed_by);
create index if not exists crm_state_owner_id_idx
  on public.crm_state(owner_id);
create index if not exists crm_state_updated_by_idx
  on public.crm_state(updated_by);
create index if not exists crm_write_receipts_actor_user_id_idx
  on public.crm_write_receipts(actor_user_id);

commit;
