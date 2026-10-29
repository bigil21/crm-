begin;

create or replace function public.crm_attach_website_photo_paths(
  p_company text,
  p_request_id text,
  p_paths jsonb
) returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  intake public.crm_website_intake_requests%rowtype;
  updated_count integer := 0;
begin
  if p_company is distinct from public.crm_base_state_id()
     or p_request_id !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$'
     or jsonb_typeof(p_paths) is distinct from 'array'
     or jsonb_array_length(p_paths) > 20
     or exists (
       select 1 from jsonb_array_elements_text(p_paths) item
       where length(item) > 500 or item !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'
     ) then
    raise exception 'invalid_website_photo_paths' using errcode='22023';
  end if;

  select * into intake
  from public.crm_website_intake_requests
  where company_state_id=p_company and request_id=p_request_id;
  if not found then raise exception 'website_intake_not_found' using errcode='P0002'; end if;

  update public.crm_records
  set data=jsonb_set(data,'{websitePhotoPaths}',p_paths,true),
      version=version+1,
      updated_at=clock_timestamp()
  where company_state_id=p_company
    and ((record_type='contact' and id=intake.lead_id) or (record_type='job' and id=intake.job_id))
    and deleted_at is null;
  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

revoke all on function public.crm_attach_website_photo_paths(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.crm_attach_website_photo_paths(text,text,jsonb) to service_role;

commit;
