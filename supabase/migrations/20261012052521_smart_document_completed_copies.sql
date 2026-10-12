-- Publish each completed PDF as a separate document in its source category.
-- The source and new copy commit together; reusing a stored PDF is idempotent.
create or replace function public.crm_save_smart_document(
  p_company text, p_document_id text, p_smart_document jsonb, p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.crm_records%rowtype;
  copy_row public.crm_records%rowtype;
  next_version bigint;
  copy_id text;
  copy_data jsonb;
  completed_file jsonb;
  saved_smart jsonb := p_smart_document;
  source_smart jsonb;
begin
  if p_company is null or p_company !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$'
     or p_document_id is null or p_document_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$'
     or p_actor is null or p_smart_document is null
     or jsonb_typeof(p_smart_document) is distinct from 'object'
     or coalesce(p_smart_document->>'status','') not in ('template','draft','completed')
     or jsonb_typeof(p_smart_document->'fields') is distinct from 'array'
     or jsonb_array_length(p_smart_document->'fields') not between 1 and 300
     or jsonb_typeof(p_smart_document->'responses') is distinct from 'object'
     or pg_column_size(p_smart_document) > 1048576 then
    raise exception 'invalid_smart_document';
  end if;

  select * into current_row from public.crm_records
    where company_state_id = p_company and record_type = 'document'
      and id = p_document_id and deleted_at is null for update;
  if not found then raise exception 'document_not_found'; end if;

  if p_smart_document->>'status' = 'completed' then
    completed_file := p_smart_document->'completedFile';
    if jsonb_typeof(completed_file) is distinct from 'object'
       or left(coalesce(completed_file->>'storagePath',''),length(p_company)+1) is distinct from p_company || '/'
       or coalesce(completed_file->>'name','') = ''
       or completed_file->>'type' is distinct from 'application/pdf'
       or coalesce((completed_file->>'size')::bigint,0) <= 0 then
      raise exception 'invalid_smart_document_completion';
    end if;
    copy_id := 'doc-completed-' || md5(p_document_id || ':' || (completed_file->>'storagePath'));
    saved_smart := jsonb_set(saved_smart, '{completedDocumentId}', to_jsonb(copy_id), true);
    copy_data := jsonb_build_object(
      'id', copy_id, 'name', completed_file->>'name', 'type', 'application/pdf',
      'size', (completed_file->>'size')::bigint, 'storagePath', completed_file->>'storagePath',
      'categoryId', coalesce(current_row.data->>'categoryId',''),
      'category', coalesce(current_row.data->>'category','Other'),
      'leadId', coalesce(current_row.data->>'leadId',''),
      'contactId', coalesce(current_row.data->>'contactId',''),
      'jobId', coalesce(current_row.job_id,current_row.data->>'jobId',''),
      'ownerUserId', current_row.owner_id,
      'uploadedAt', coalesce(completed_file->>'completedAt',clock_timestamp()::text),
      'uploadedBy', p_actor, 'versionNumber', 1,
      'source', 'smart-document-completion', 'sourceDocumentId', p_document_id,
      'smartDocument', saved_smart
    );
    insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,owner_id,data,version,updated_by)
      values(p_company,'document',copy_id,current_row.lead_id,current_row.job_id,current_row.owner_id,copy_data,1,p_actor)
      on conflict (company_state_id,record_type,id) do nothing;
    select * into copy_row from public.crm_records
      where company_state_id=p_company and record_type='document' and id=copy_id;
    if copy_row.deleted_at is not null or copy_row.data->>'sourceDocumentId' is distinct from p_document_id
       or copy_row.data->>'storagePath' is distinct from completed_file->>'storagePath' then
      raise exception 'smart_document_copy_conflict';
    end if;
    copy_data := copy_row.data;
  end if;

  next_version := current_row.version + 1;
  source_smart := case when copy_id is not null then
    saved_smart || jsonb_build_object('status','template','responses','{}'::jsonb)
    else saved_smart end;
  update public.crm_records set data=jsonb_set(current_row.data,'{smartDocument}',source_smart,true),
    version=next_version,updated_at=clock_timestamp(),updated_by=p_actor
    where company_state_id=p_company and record_type='document' and id=p_document_id;
  return jsonb_build_object('saved',true,'document_id',p_document_id,'version',next_version,
    'status',saved_smart->>'status','smart_document',saved_smart,
    'completed_document_id',copy_id,'completed_document',copy_data);
end;
$$;
revoke all on function public.crm_save_smart_document(text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.crm_save_smart_document(text,text,jsonb,uuid) to service_role;
