-- Read-only go-live checks. Run after schema.sql and the first manager login.
select record_type, count(*) as active_records
from public.crm_records
where company_state_id = public.crm_base_state_id() and deleted_at is null
group by record_type order by record_type;

select count(*) as active_leads_and_contacts
from public.crm_records
where company_state_id = public.crm_base_state_id()
  and record_type = 'contact' and deleted_at is null;

select id, count(*) as duplicate_count
from public.crm_records
where company_state_id = public.crm_base_state_id()
  and record_type = 'contact' and deleted_at is null
group by id having count(*) > 1;

select job.id as orphan_job_id, job.lead_id
from public.crm_records job
left join public.crm_records contact
  on contact.company_state_id = job.company_state_id
 and contact.record_type = 'contact' and contact.id = job.lead_id and contact.deleted_at is null
where job.company_state_id = public.crm_base_state_id()
  and job.record_type = 'job' and job.deleted_at is null and contact.id is null;

select document.id as orphan_document_id, document.lead_id,
       document.data ->> 'categoryId' as category_id
from public.crm_records document
left join public.crm_records contact
  on contact.company_state_id = document.company_state_id
 and contact.record_type = 'contact' and contact.id = document.lead_id and contact.deleted_at is null
where document.company_state_id = public.crm_base_state_id()
  and document.record_type = 'document' and document.deleted_at is null
  and (contact.id is null or coalesce(document.data ->> 'categoryId', '') = '');

select count(*) as conversation_messages
from public.crm_conversation_messages
where company_state_id = public.crm_base_state_id();

select backup_date, record_count, created_at
from public.crm_backups
where company_state_id = public.crm_base_state_id()
order by backup_date desc limit 7;
