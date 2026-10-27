-- Step 3: native project delivery records. These are original JobCrest tables,
-- not copied Perfex structures.

create or replace function public.crm_project_row_access(p_company_state_id text,p_lead_id text)
returns boolean language sql stable security definer set search_path=''
as $$
  select public.is_coastal_crest_user()
    and p_company_state_id=public.crm_base_state_id()
    and (public.can_manage_team_crm() or exists(
      select 1 from public.crm_records r
      where r.company_state_id=p_company_state_id and r.record_type='contact' and r.id=p_lead_id
        and r.owner_id=auth.uid() and r.deleted_at is null
    ));
$$;
revoke all on function public.crm_project_row_access(text,text) from public,anon;
grant execute on function public.crm_project_row_access(text,text) to authenticated;

create table if not exists public.crm_project_members (
  company_state_id text not null default public.crm_base_state_id(), id text not null,
  lead_id text not null, job_id text not null, member_user_id uuid, member_email text not null default '',
  member_name text not null, role_name text not null default 'Project member', active boolean not null default true,
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key(company_state_id,id), unique(company_state_id,job_id,member_email)
);

create table if not exists public.crm_project_discussions (
  company_state_id text not null default public.crm_base_state_id(), id text not null,
  lead_id text not null, job_id text not null, body text not null check(char_length(btrim(body)) between 1 and 10000),
  visibility text not null default 'internal' check(visibility in ('internal','customer')),
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key(company_state_id,id)
);

create table if not exists public.crm_project_notes (
  company_state_id text not null default public.crm_base_state_id(), id text not null,
  lead_id text not null, job_id text not null, body text not null check(char_length(btrim(body)) between 1 and 10000),
  pinned boolean not null default false,
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key(company_state_id,id)
);

create table if not exists public.crm_job_time_entries (
  company_state_id text not null default public.crm_base_state_id(), id text not null,
  lead_id text not null, job_id text not null, task_id text not null default '', user_id uuid not null default auth.uid(),
  started_at timestamptz not null, stopped_at timestamptz, note text not null default '', billable boolean not null default false,
  hourly_rate numeric(14,2) not null default 0 check(hourly_rate>=0),
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key(company_state_id,id), check(stopped_at is null or stopped_at>=started_at)
);

create table if not exists public.crm_project_templates (
  company_state_id text not null default public.crm_base_state_id(), id text not null,
  name text not null check(char_length(btrim(name)) between 1 and 200), description text not null default '',
  milestones jsonb not null default '[]'::jsonb check(jsonb_typeof(milestones)='array'), active boolean not null default true,
  created_by uuid not null default auth.uid(), updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key(company_state_id,id), unique(company_state_id,name)
);

insert into public.crm_project_templates(company_state_id,id,name,description,milestones,created_by,updated_by)
values(public.crm_base_state_id(),'roof-replacement-standard','Standard Roof Replacement','Reusable delivery checkpoints for a typical replacement job','[{"title":"Permit approved"},{"title":"Materials ordered"},{"title":"Materials delivered"},{"title":"Production scheduled"},{"title":"Installation complete"},{"title":"Final inspection"},{"title":"Final payment received"}]'::jsonb,'00000000-0000-4000-8000-000000000000','00000000-0000-4000-8000-000000000000')
on conflict(company_state_id,id) do nothing;

create index if not exists crm_project_members_job_idx on public.crm_project_members(company_state_id,lead_id,job_id,active);
create index if not exists crm_project_discussions_job_idx on public.crm_project_discussions(company_state_id,lead_id,job_id,created_at desc);
create index if not exists crm_project_notes_job_idx on public.crm_project_notes(company_state_id,lead_id,job_id,pinned desc,created_at desc);
create index if not exists crm_job_time_entries_job_idx on public.crm_job_time_entries(company_state_id,lead_id,job_id,started_at desc);
create unique index if not exists crm_job_time_entries_one_active_idx on public.crm_job_time_entries(company_state_id,user_id) where stopped_at is null;

do $$ declare table_name text;
begin
  foreach table_name in array array['crm_project_members','crm_project_discussions','crm_project_notes','crm_job_time_entries'] loop
    execute format('drop trigger if exists crm_stamp_project_row on public.%I',table_name);
    execute format('create trigger crm_stamp_project_row before insert or update on public.%I for each row execute function public.crm_stamp_workflow_row()',table_name);
    execute format('alter table public.%I enable row level security',table_name);
    execute format('drop policy if exists "CRM project rows select" on public.%I',table_name);
    execute format('drop policy if exists "CRM project rows insert" on public.%I',table_name);
    execute format('drop policy if exists "CRM project rows update" on public.%I',table_name);
    execute format('create policy "CRM project rows select" on public.%I for select to authenticated using(public.crm_project_row_access(company_state_id,lead_id))',table_name);
    execute format('create policy "CRM project rows insert" on public.%I for insert to authenticated with check(public.crm_project_row_access(company_state_id,lead_id) and created_by=(select auth.uid()))',table_name);
    execute format('create policy "CRM project rows update" on public.%I for update to authenticated using(public.crm_project_row_access(company_state_id,lead_id)) with check(public.crm_project_row_access(company_state_id,lead_id))',table_name);
    execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
    execute format('grant select,insert,update on table public.%I to authenticated',table_name);
  end loop;
end $$;

drop trigger if exists crm_stamp_project_template on public.crm_project_templates;
create trigger crm_stamp_project_template before insert or update on public.crm_project_templates for each row execute function public.crm_stamp_workflow_row();
alter table public.crm_project_templates enable row level security;
drop policy if exists "CRM users read project templates" on public.crm_project_templates;
drop policy if exists "CRM admins create project templates" on public.crm_project_templates;
drop policy if exists "CRM admins update project templates" on public.crm_project_templates;
create policy "CRM users read project templates" on public.crm_project_templates for select to authenticated using(public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id());
create policy "CRM admins create project templates" on public.crm_project_templates for insert to authenticated with check(public.is_crm_admin() and company_state_id=public.crm_base_state_id() and created_by=(select auth.uid()));
create policy "CRM admins update project templates" on public.crm_project_templates for update to authenticated using(public.is_crm_admin() and company_state_id=public.crm_base_state_id()) with check(public.is_crm_admin() and company_state_id=public.crm_base_state_id());
revoke all on table public.crm_project_templates from public,anon,authenticated;
grant select,insert,update on table public.crm_project_templates to authenticated;

create or replace function public.crm_apply_project_template(p_template_id text,p_lead_id text,p_job_id text)
returns integer language plpgsql security invoker set search_path=''
as $$
declare company_id text:=public.crm_base_state_id(); template_row public.crm_project_templates%rowtype; item jsonb; added integer:=0;
begin
  if not public.crm_project_row_access(company_id,p_lead_id) then raise exception 'job_access_required'; end if;
  if not exists(select 1 from public.crm_records r where r.company_state_id=company_id and r.record_type='job' and r.id=p_job_id and r.lead_id=p_lead_id and r.deleted_at is null) then raise exception 'job_not_found'; end if;
  select * into template_row from public.crm_project_templates t where t.company_state_id=company_id and t.id=p_template_id and t.active;
  if not found then raise exception 'template_not_found'; end if;
  for item in select value from jsonb_array_elements(template_row.milestones) loop
    if char_length(btrim(coalesce(item->>'title',''))) between 1 and 500 then
      insert into public.crm_job_milestones(company_state_id,lead_id,job_id,title,description,due_date,status,position,created_by,updated_by)
      values(company_id,p_lead_id,p_job_id,btrim(item->>'title'),coalesce(item->>'description',''),null,'not_started',added,auth.uid(),auth.uid());
      added:=added+1;
    end if;
  end loop;
  insert into public.crm_activity_events(company_state_id,lead_id,job_id,event_type,title,description,actor_user_id,actor_name,source_type,source_id)
  values(company_id,p_lead_id,p_job_id,'template','Project template applied',template_row.name,auth.uid(),'CRM user','project_template',template_row.id);
  return added;
end $$;
revoke all on function public.crm_apply_project_template(text,text,text) from public,anon;
grant execute on function public.crm_apply_project_template(text,text,text) to authenticated;
