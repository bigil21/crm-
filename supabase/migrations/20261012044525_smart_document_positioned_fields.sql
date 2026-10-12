-- Expand native Smart Documents for page-positioned fields while preserving
-- the service-only, row-locked update boundary.

create or replace function public.crm_save_smart_document(
  p_company text,
  p_document_id text,
  p_smart_document jsonb,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.crm_records%rowtype;
  next_version bigint;
begin
  if p_company !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$'
     or p_document_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$'
     or p_actor is null
     or jsonb_typeof(p_smart_document) <> 'object'
     or p_smart_document->>'status' not in ('template','draft','completed')
     or jsonb_typeof(p_smart_document->'fields') <> 'array'
     or jsonb_array_length(p_smart_document->'fields') < 1
     or jsonb_array_length(p_smart_document->'fields') > 300
     or jsonb_typeof(p_smart_document->'responses') <> 'object'
     or pg_column_size(p_smart_document) > 1048576 then
    raise exception 'invalid_smart_document';
  end if;

  select * into current_row
    from public.crm_records
    where company_state_id = p_company
      and record_type = 'document'
      and id = p_document_id
      and deleted_at is null
    for update;
  if not found then raise exception 'document_not_found'; end if;

  next_version := current_row.version + 1;
  update public.crm_records
    set data = jsonb_set(current_row.data, '{smartDocument}', p_smart_document, true),
        version = next_version,
        updated_at = clock_timestamp(),
        updated_by = p_actor
    where company_state_id = p_company
      and record_type = 'document'
      and id = p_document_id;

  return jsonb_build_object(
    'saved', true,
    'document_id', p_document_id,
    'version', next_version,
    'status', p_smart_document->>'status'
  );
end;
$$;

revoke all on function public.crm_save_smart_document(text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.crm_save_smart_document(text,text,jsonb,uuid) to service_role;
