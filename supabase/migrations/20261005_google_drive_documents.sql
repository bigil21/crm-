-- Attach a confirmed Google Drive copy to one durable CRM document.
-- Only the trusted server may call this operation; browsers cannot fabricate
-- Drive links or replace a copy for the same document version.

create or replace function public.crm_attach_google_drive_document(
  p_company text,
  p_document_id text,
  p_file_id text,
  p_web_view_link text,
  p_lead_folder_id text,
  p_job_folder_id text,
  p_category_folder_id text,
  p_document_version integer,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.crm_records%rowtype;
  existing jsonb;
begin
  if p_company !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$'
     or p_document_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$'
     or p_file_id !~ '^[A-Za-z0-9_-]{3,200}$'
     or p_category_folder_id !~ '^[A-Za-z0-9_-]{3,200}$'
     or (coalesce(p_lead_folder_id, '') <> '' and p_lead_folder_id !~ '^[A-Za-z0-9_-]{3,200}$')
     or (coalesce(p_job_folder_id, '') <> '' and p_job_folder_id !~ '^[A-Za-z0-9_-]{3,200}$')
     or p_document_version < 1
     or p_web_view_link !~ '^https://drive\.google\.com/'
     or p_actor is null then
    raise exception 'invalid_google_drive_attachment';
  end if;

  select * into target
  from public.crm_records
  where company_state_id = p_company and record_type = 'document'
    and id = p_document_id and deleted_at is null
  for update;

  if not found then raise exception 'document_not_found'; end if;
  existing := target.data->'googleDrive';

  if existing is not null
     and coalesce((existing->>'versionNumber')::integer, 0) = p_document_version
     and existing->>'fileId' <> p_file_id then
    raise exception 'google_drive_version_already_attached';
  end if;

  if existing is not null
     and coalesce((existing->>'versionNumber')::integer, 0) = p_document_version
     and existing->>'fileId' = p_file_id then
    return jsonb_build_object('saved', true, 'file_id', p_file_id, 'document_version', p_document_version);
  end if;

  update public.crm_records
  set data = jsonb_set(target.data, '{googleDrive}', jsonb_build_object(
        'fileId', p_file_id,
        'webViewLink', p_web_view_link,
        'leadFolderId', coalesce(p_lead_folder_id, ''),
        'jobFolderId', coalesce(p_job_folder_id, ''),
        'categoryFolderId', p_category_folder_id,
        'versionNumber', p_document_version,
        'syncedAt', now(),
        'syncedBy', p_actor
      ), true),
      version = target.version + 1,
      updated_by = p_actor,
      updated_at = now()
  where company_state_id = p_company and record_type = 'document' and id = p_document_id;

  return jsonb_build_object('saved', true, 'file_id', p_file_id, 'document_version', p_document_version);
end;
$$;

revoke all on function public.crm_attach_google_drive_document(text,text,text,text,text,text,text,integer,uuid) from public, anon, authenticated;
grant execute on function public.crm_attach_google_drive_document(text,text,text,text,text,text,text,integer,uuid) to service_role;
