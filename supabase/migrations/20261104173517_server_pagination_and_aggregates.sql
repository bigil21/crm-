-- Server-side lead/job paging and dashboard totals.
-- These functions are SECURITY INVOKER so crm_records RLS remains the source
-- of truth for both managers and assigned sales representatives.

create index if not exists crm_records_company_type_updated_id_idx
  on public.crm_records(company_state_id, record_type, updated_at desc, id desc)
  where deleted_at is null;

create index if not exists crm_records_company_type_status_idx
  on public.crm_records(company_state_id, record_type, (data->>'status'))
  where deleted_at is null;

create or replace function public.crm_lead_page(
  p_limit integer default 50,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id text default null,
  p_search text default '',
  p_status text default ''
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  normalized_search text := lower(trim(coalesce(p_search, '')));
  normalized_status text := trim(coalesce(p_status, ''));
  result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  with visible_contacts as (
    select c.*,
      greatest(c.updated_at, coalesce((
        select max(j.updated_at)
        from public.crm_records j
        where j.company_state_id = c.company_state_id
          and j.record_type = 'job'
          and j.lead_id = c.id
          and j.deleted_at is null
      ), c.updated_at)) as sort_updated_at
    from public.crm_records c
    where c.company_state_id = public.crm_base_state_id()
      and c.record_type = 'contact'
      and c.deleted_at is null
  ), filtered as (
    select c.*
    from visible_contacts c
    where (
      normalized_search = ''
      or lower(concat_ws(' ', c.id, c.data->>'name', c.data->>'email', c.data->>'phone', c.data->>'leadNumber', c.data->>'address')) like '%' || normalized_search || '%'
      or exists (
        select 1 from public.crm_records j
        where j.company_state_id = c.company_state_id and j.record_type = 'job'
          and j.lead_id = c.id and j.deleted_at is null
          and lower(concat_ws(' ', j.id, j.data->>'name', j.data->>'address', j.data->>'projectNumber')) like '%' || normalized_search || '%'
      )
    )
    and (
      normalized_status = '__all__'
      or
      (normalized_status = '' and exists (
        select 1 from public.crm_records j
        where j.company_state_id = c.company_state_id and j.record_type = 'job'
          and j.lead_id = c.id and j.deleted_at is null
          and coalesce(j.data->>'status', '') not in ('Paid', 'Lost')
      ))
      or (normalized_status <> '' and exists (
        select 1 from public.crm_records j
        where j.company_state_id = c.company_state_id and j.record_type = 'job'
          and j.lead_id = c.id and j.deleted_at is null
          and coalesce(j.data->>'status', '') = normalized_status
      ))
    )
  ), windowed as (
    select f.*
    from filtered f
    where p_cursor_updated_at is null
       or (f.sort_updated_at, f.id) < (p_cursor_updated_at, coalesce(p_cursor_id, ''))
    order by f.sort_updated_at desc, f.id desc
    limit safe_limit + 1
  ), page as (
    select * from windowed order by sort_updated_at desc, id desc limit safe_limit
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'record', to_jsonb(p) - 'sort_updated_at',
        'jobs', coalesce((
          select jsonb_agg(to_jsonb(j) order by j.updated_at desc, j.id desc)
          from public.crm_records j
          where j.company_state_id = p.company_state_id and j.record_type = 'job'
            and j.lead_id = p.id and j.deleted_at is null
        ), '[]'::jsonb)
      ) order by p.sort_updated_at desc, p.id desc) from page p
    ), '[]'::jsonb),
    'totalCount', (select count(*) from filtered),
    'hasMore', (select count(*) > safe_limit from windowed),
    'nextCursor', (
      select case when (select count(*) > safe_limit from windowed)
        then jsonb_build_object('updatedAt', p.sort_updated_at, 'id', p.id)
        else null end
      from page p order by p.sort_updated_at asc, p.id asc limit 1
    )
  ) into result;
  return result;
end;
$$;

create or replace function public.crm_job_page(
  p_limit integer default 50,
  p_cursor_updated_at timestamptz default null,
  p_cursor_id text default null,
  p_search text default '',
  p_status text default ''
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  safe_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  normalized_search text := lower(trim(coalesce(p_search, '')));
  normalized_status text := trim(coalesce(p_status, ''));
  result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  with filtered as (
    select j.*
    from public.crm_records j
    left join public.crm_records c
      on c.company_state_id = j.company_state_id and c.record_type = 'contact'
      and c.id = j.lead_id and c.deleted_at is null
    where j.company_state_id = public.crm_base_state_id()
      and j.record_type = 'job' and j.deleted_at is null
      and (normalized_status = '' or coalesce(j.data->>'status', '') = normalized_status)
      and (normalized_search = '' or lower(concat_ws(' ', j.id, j.data->>'name', j.data->>'address',
        j.data->>'projectNumber', j.data->>'status', j.data->>'salesRep', c.data->>'name', c.data->>'email')) like '%' || normalized_search || '%')
  ), windowed as (
    select f.* from filtered f
    where p_cursor_updated_at is null
       or (f.updated_at, f.id) < (p_cursor_updated_at, coalesce(p_cursor_id, ''))
    order by f.updated_at desc, f.id desc
    limit safe_limit + 1
  ), page as (
    select * from windowed order by updated_at desc, id desc limit safe_limit
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'record', to_jsonb(p),
        'contact', coalesce((
          select to_jsonb(c) from public.crm_records c
          where c.company_state_id = p.company_state_id and c.record_type = 'contact'
            and c.id = p.lead_id and c.deleted_at is null limit 1
        ), '{}'::jsonb)
      ) order by p.updated_at desc, p.id desc) from page p
    ), '[]'::jsonb),
    'totalCount', (select count(*) from filtered),
    'hasMore', (select count(*) > safe_limit from windowed),
    'nextCursor', (
      select case when (select count(*) > safe_limit from windowed)
        then jsonb_build_object('updatedAt', p.updated_at, 'id', p.id)
        else null end
      from page p order by p.updated_at asc, p.id asc limit 1
    )
  ) into result;
  return result;
end;
$$;

create or replace function public.crm_dashboard_aggregates()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;

  with contacts as (
    select * from public.crm_records
    where company_state_id = public.crm_base_state_id() and record_type = 'contact' and deleted_at is null
  ), jobs as (
    select * from public.crm_records
    where company_state_id = public.crm_base_state_id() and record_type = 'job' and deleted_at is null
  ), estimates as (
    select * from public.crm_records
    where company_state_id = public.crm_base_state_id() and record_type = 'estimate' and deleted_at is null
  )
  select jsonb_build_object(
    'leads', (select count(*) from contacts),
    'openLeads', (select count(distinct lead_id) from jobs where coalesce(data->>'status','') not in ('Paid','Lost')),
    'totalJobs', (select count(*) from jobs),
    'estimatesSent', (select count(*) from estimates where coalesce(data->>'status','') in ('Sent','Won')),
    'openContracts', (select count(*) from jobs where coalesce(data->>'status','') not in ('Paid','Lost')),
    'openValue', (select coalesce(sum(case when coalesce(data->>'value','') ~ '^-?[0-9]+([.][0-9]+)?$' then (data->>'value')::numeric else 0 end),0) from jobs where coalesce(data->>'status','') not in ('Paid','Lost')),
    'closedJobs', (select count(*) from jobs where coalesce(data->>'status','') = 'Paid'),
    'closedValue', (select coalesce(sum(case when coalesce(data->>'paidAmount','') ~ '^-?[0-9]+([.][0-9]+)?$' then (data->>'paidAmount')::numeric else 0 end),0) from jobs where coalesce(data->>'status','') = 'Paid'),
    'pipelineValue', (select coalesce(sum(case when coalesce(data->>'value','') ~ '^-?[0-9]+([.][0-9]+)?$' then (data->>'value')::numeric else 0 end),0) from jobs where coalesce(data->>'status','') <> 'Lost'),
    'stageCounts', coalesce((select jsonb_object_agg(status, item_count) from (
      select coalesce(data->>'status','Unspecified') status, count(*) item_count from jobs group by 1
    ) grouped), '{}'::jsonb),
    'stageLeadCounts', coalesce((select jsonb_object_agg(status, item_count) from (
      select coalesce(data->>'status','Unspecified') status, count(distinct lead_id) item_count from jobs group by 1
    ) grouped), '{}'::jsonb),
    'stageValues', coalesce((select jsonb_object_agg(status, item_value) from (
      select coalesce(data->>'status','Unspecified') status,
        coalesce(sum(case when coalesce(data->>'value','') ~ '^-?[0-9]+([.][0-9]+)?$' then (data->>'value')::numeric else 0 end),0) item_value from jobs group by 1
    ) grouped), '{}'::jsonb),
    'leadSources', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'count', item_count) order by item_count desc, label) from (
      select coalesce(nullif(c.data->>'source',''),'Other') label, count(*) item_count
      from contacts c where exists (
        select 1 from jobs j where j.lead_id=c.id and coalesce(j.data->>'status','') not in ('Paid','Lost')
      ) group by 1
    ) grouped), '[]'::jsonb),
    'jobTypes', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'count', item_count) order by item_count desc, label) from (
      select case
        when lower(concat_ws(' ',data->>'name',data->>'notes')) like '%repair%' then 'Roof Repair'
        when lower(concat_ws(' ',data->>'name',data->>'notes')) like '%storm%' or lower(concat_ws(' ',data->>'name',data->>'notes')) like '%damage%' then 'Storm Damage'
        when lower(concat_ws(' ',data->>'name',data->>'notes')) like '%gutter%' then 'Gutters'
        when lower(concat_ws(' ',data->>'name',data->>'notes')) like '%maintenance%' then 'Maintenance'
        else 'Roof Replacement' end label, count(*) item_count from jobs group by 1
    ) grouped), '[]'::jsonb),
    'projectStatuses', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'count', item_count) order by item_count desc, label) from (
      select coalesce(data->>'status','Unspecified') label, count(*) item_count from jobs
      where coalesce(data->>'status','') in ('Won','Scheduled','Materials Ordered','In Progress','Completed','Paid') group by 1
    ) grouped), '[]'::jsonb),
    'revenueMonths', coalesce((select jsonb_object_agg(month_key, item_value) from (
      select to_char(case when coalesce(data->>'lastPaymentAt','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          then (data->>'lastPaymentAt')::timestamptz
          when coalesce(data->>'closedDate','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' then (data->>'closedDate')::timestamptz
          else updated_at end, 'YYYY-MM') month_key,
        coalesce(sum(case when coalesce(data->>'paidAmount','') ~ '^-?[0-9]+([.][0-9]+)?$' then (data->>'paidAmount')::numeric else 0 end),0) item_value
      from jobs
      where coalesce(data->>'paidAmount','') ~ '^-?[0-9]+([.][0-9]+)?$'
        and (data->>'paidAmount')::numeric > 0
      group by 1
    ) grouped), '{}'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.crm_lead_page(integer,timestamptz,text,text,text) from public, anon;
revoke all on function public.crm_job_page(integer,timestamptz,text,text,text) from public, anon;
revoke all on function public.crm_dashboard_aggregates() from public, anon;
grant execute on function public.crm_lead_page(integer,timestamptz,text,text,text) to authenticated;
grant execute on function public.crm_job_page(integer,timestamptz,text,text,text) to authenticated;
grant execute on function public.crm_dashboard_aggregates() to authenticated;
