create or replace function public.crm_capture_gmail_messages(p_job_id text, p_messages jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_emails jsonb;
  additions jsonb;
  added_count integer := 0;
begin
  if p_job_id is null or p_job_id = '' or jsonb_typeof(p_messages) <> 'array' then
    raise exception 'invalid_gmail_capture';
  end if;

  select coalesce(data->'emails', '[]'::jsonb)
    into current_emails
    from public.crm_records
   where company_state_id = public.crm_base_state_id()
     and record_type = 'job'
     and id = p_job_id
     and deleted_at is null
   for update;

  if current_emails is null then return 0; end if;

  select coalesce(jsonb_agg(message), '[]'::jsonb), count(*)::integer
    into additions, added_count
    from jsonb_array_elements(p_messages) message
   where message->>'provider' = 'gmail'
     and coalesce(message->>'providerMessageId', '') <> ''
     and not exists (
       select 1 from jsonb_array_elements(current_emails) existing
        where existing->>'providerMessageId' = message->>'providerMessageId'
     );

  if added_count > 0 then
    update public.crm_records
       set data = jsonb_set(data, '{emails}', additions || current_emails, true),
           updated_at = now()
     where company_state_id = public.crm_base_state_id()
       and record_type = 'job'
       and id = p_job_id
       and deleted_at is null;
  end if;
  return added_count;
end;
$$;

revoke all on function public.crm_capture_gmail_messages(text, jsonb) from public, anon, authenticated;
grant execute on function public.crm_capture_gmail_messages(text, jsonb) to service_role;
