-- Attach a Zoho Sign request to exactly one durable CRM document. This RPC is
-- service-only because the trusted Render server performs the Zoho upload and
-- must confirm the provider request before JobCrest records the relationship.

create or replace function public.crm_attach_zoho_sign(
  p_company text,
  p_document_id text,
  p_request_id text,
  p_status text,
  p_recipient_email text,
  p_actor uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.crm_records%rowtype;
  existing_request text;
begin
  if p_company !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$'
     or p_document_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$'
     or p_request_id !~ '^[0-9]{1,30}$'
     or p_status !~ '^[A-Za-z][A-Za-z0-9_-]{0,39}$'
     or p_recipient_email <> lower(p_recipient_email)
     or p_recipient_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_actor is null then
    raise exception 'invalid_zoho_sign_attachment';
  end if;

  select * into current_row from public.crm_records
    where company_state_id=p_company and record_type='document' and id=p_document_id and deleted_at is null
    for update;
  if not found then raise exception 'document_not_found'; end if;

  existing_request := current_row.data #>> '{zohoSign,requestId}';
  if existing_request is not null and existing_request <> p_request_id then
    raise exception 'document_already_linked_to_zoho';
  end if;

  if existing_request is null then
    update public.crm_records set
      data = current_row.data || jsonb_build_object('zohoSign', jsonb_build_object(
        'requestId', p_request_id,
        'status', p_status,
        'recipientEmail', p_recipient_email,
        'createdAt', clock_timestamp(),
        'createdBy', p_actor::text
      )),
      version = current_row.version + 1,
      updated_at = clock_timestamp(),
      updated_by = p_actor
      where company_state_id=p_company and record_type='document' and id=p_document_id;
  end if;

  return jsonb_build_object('saved',true,'document_id',p_document_id,'request_id',p_request_id);
end;
$$;

revoke all on function public.crm_attach_zoho_sign(text,text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.crm_attach_zoho_sign(text,text,text,text,text,uuid) to service_role;
