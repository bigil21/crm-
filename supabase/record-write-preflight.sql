-- READ ONLY. Review counts and privileges before requesting production rollout.
-- No customer names, emails, amounts, or document contents are returned.
begin read only;

select current_setting('server_version') as postgres_version,
  to_regprocedure('public.crm_commit_records(text,jsonb,jsonb)') is not null as safe_commit_installed,
  has_table_privilege('authenticated', 'public.crm_records', 'SELECT') as authenticated_can_read,
  has_table_privilege('authenticated', 'public.crm_records', 'INSERT') as direct_insert_allowed,
  has_table_privilege('authenticated', 'public.crm_records', 'UPDATE') as direct_update_allowed,
  has_table_privilege('authenticated', 'public.crm_records', 'DELETE') as direct_delete_allowed;

select record_type, count(*) as record_count,
  count(*) filter (where deleted_at is not null) as archived_count,
  count(*) filter (where version is null or version < 1) as invalid_versions,
  count(*) filter (where jsonb_typeof(data) is distinct from 'object') as invalid_payloads,
  count(*) filter (where company_state_id <> public.crm_base_state_id()) as other_company_rows
from public.crm_records group by record_type order by record_type;

select count(*) as non_array_manual_payment_records
from public.crm_records
where record_type in ('job','estimate') and data ? 'manualPayments'
  and jsonb_typeof(data->'manualPayments') is distinct from 'array';

select count(*) as duplicate_lead_number_groups from (
  select company_state_id, data->>'leadNumber'
  from public.crm_records where record_type='contact' and deleted_at is null
    and coalesce(data->>'leadNumber','')<>''
  group by company_state_id, data->>'leadNumber' having count(*)>1
) duplicates;

select count(*) as records_without_active_lead from public.crm_records r
where r.record_type in ('job','estimate') and r.deleted_at is null
  and not exists(select 1 from public.crm_records lead where lead.company_state_id=r.company_state_id
    and lead.record_type='contact' and lead.id=r.lead_id and lead.deleted_at is null);

rollback;
