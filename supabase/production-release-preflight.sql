-- READ ONLY: aggregate release facts, no customer names, addresses or file contents.
-- Confirm the intended project in the dashboard before running. Do not run migrations here.
begin read only;
select jsonb_build_object(
  'postgres_version', current_setting('server_version'),
  'record_commit_installed', to_regprocedure('public.crm_commit_records(text,jsonb,jsonb)') is not null,
  'settings_commit_installed', to_regprocedure('public.crm_commit_company_settings(text,integer,jsonb)') is not null,
  'direct_record_insert', has_table_privilege('authenticated','public.crm_records','INSERT'),
  'direct_record_update', has_table_privilege('authenticated','public.crm_records','UPDATE'),
  'direct_record_delete', has_table_privilege('authenticated','public.crm_records','DELETE'),
  'records', (select coalesce(jsonb_agg(t),'[]'::jsonb) from (
    select record_type, count(*) as total,
      count(*) filter (where deleted_at is not null) as archived,
      count(*) filter (where version is null or version < 1) as invalid_versions,
      count(*) filter (where jsonb_typeof(data) is distinct from 'object') as invalid_payloads,
      count(*) filter (where company_state_id <> public.crm_base_state_id()) as other_company
    from public.crm_records group by record_type order by record_type
  ) t),
  'jobs_or_estimates_without_active_lead', (select count(*) from public.crm_records r
    where r.record_type in ('job','estimate') and r.deleted_at is null
    and not exists(select 1 from public.crm_records l where l.company_state_id=r.company_state_id
      and l.record_type='contact' and l.id=r.lead_id and l.deleted_at is null)),
  'duplicate_lead_number_groups', (select count(*) from (
    select company_state_id,data->>'leadNumber' from public.crm_records
    where record_type='contact' and deleted_at is null and coalesce(data->>'leadNumber','')<>''
    group by company_state_id,data->>'leadNumber' having count(*)>1
  ) t),
  'duplicate_square_invoice_groups', (select count(*) from (
    select company_state_id,data->>'squareInvoiceId' from public.crm_records
    where record_type='estimate' and deleted_at is null and coalesce(data->>'squareInvoiceId','')<>''
    group by company_state_id,data->>'squareInvoiceId' having count(*)>1
  ) t),
  'non_array_manual_payments', (select count(*) from public.crm_records
    where record_type in ('job','estimate') and data ? 'manualPayments'
    and jsonb_typeof(data->'manualPayments') is distinct from 'array'),
  'conversation_messages', (select count(*) from public.crm_conversation_messages),
  'audit_events', (select count(*) from public.crm_audit_events),
  'legacy_snapshots', (select count(*) from public.crm_state),
  'browser_recovery_snapshots', (select count(*) from public.crm_backups),
  'trusted_admin_entries', (select count(*) from public.crm_admins),
  'auth_users', (select count(*) from auth.users),
  'private_document_bucket', (select not public from storage.buckets where id='crm-documents'),
  'document_size_limit', (select file_size_limit from storage.buckets where id='crm-documents'),
  'stored_document_objects', (select count(*) from storage.objects where bucket_id='crm-documents'),
  'rls_tables', (select jsonb_agg(jsonb_build_object('table',c.relname,'rls',c.relrowsecurity) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname like 'crm_%' and c.relkind='r')
) as release_preflight;
rollback;
