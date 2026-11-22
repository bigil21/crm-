-- QA issue 27: a permit, inspection or selection entered by mistake could only
-- have its status changed; it could never be removed, so mistakes stayed on
-- the job for good.
--
-- Allow the person who created the row, or a manager, to delete it, inside the
-- same job-access rule every other operation on these tables uses. Change
-- orders and billing draws are money records and keep their "void" status
-- instead of a delete. Safe to re-run.
do $$ declare table_name text;
begin
  foreach table_name in array array['crm_permits','crm_inspections','crm_job_selections'] loop
    execute format('drop policy if exists "CRM operations rows delete" on public.%I', table_name);
    execute format(
      'create policy "CRM operations rows delete" on public.%I for delete to authenticated using (public.crm_project_row_access(company_state_id,lead_id) and (public.can_manage_team_crm() or created_by=(select auth.uid())))',
      table_name
    );
    execute format('grant delete on table public.%I to authenticated', table_name);
  end loop;
end $$;
