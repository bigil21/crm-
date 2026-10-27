-- JobCrest workflow foundation, phase 1.
--
-- This migration intentionally keeps the existing crm_records documents
-- backward-compatible while moving relationship-heavy workflow data into
-- indexed relational tables.  New Supabase tables are not assumed to be
-- exposed automatically: privileges and RLS are declared explicitly.

create table if not exists public.crm_task_workflows (
  company_state_id text not null default public.crm_base_state_id(),
  task_id text not null,
  lead_id text not null default '',
  job_id text not null default '',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'blocked', 'completed', 'cancelled')),
  recurrence text not null default 'none' check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (company_state_id, task_id)
);

create table if not exists public.crm_task_participants (
  company_state_id text not null default public.crm_base_state_id(),
  id uuid primary key default gen_random_uuid(),
  task_id text not null,
  lead_id text not null default '',
  participant_user_id uuid,
  participant_email text not null default '',
  participant_name text not null default '',
  participant_kind text not null check (participant_kind in ('assignee', 'follower')),
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (company_state_id, task_id, participant_kind, participant_email)
);

create table if not exists public.crm_task_checklist_items (
  company_state_id text not null default public.crm_base_state_id(),
  id uuid primary key default gen_random_uuid(),
  task_id text not null,
  lead_id text not null default '',
  label text not null check (char_length(btrim(label)) between 1 and 500),
  position integer not null default 0 check (position >= 0),
  completed boolean not null default false,
  completed_at timestamptz,
  completed_by uuid,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.crm_task_comments (
  company_state_id text not null default public.crm_base_state_id(),
  id uuid primary key default gen_random_uuid(),
  task_id text not null,
  lead_id text not null default '',
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.crm_task_time_entries (
  company_state_id text not null default public.crm_base_state_id(),
  id uuid primary key default gen_random_uuid(),
  task_id text not null,
  lead_id text not null default '',
  user_id uuid not null default auth.uid(),
  started_at timestamptz not null,
  stopped_at timestamptz,
  note text not null default '',
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (stopped_at is null or stopped_at >= started_at)
);

create table if not exists public.crm_job_milestones (
  company_state_id text not null default public.crm_base_state_id(),
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  job_id text not null,
  title text not null check (char_length(btrim(title)) between 1 and 500),
  description text not null default '',
  due_date date,
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'blocked', 'completed')),
  owner_user_id uuid,
  owner_email text not null default '',
  owner_name text not null default '',
  position integer not null default 0 check (position >= 0),
  completed_at timestamptz,
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.crm_activity_events (
  company_state_id text not null default public.crm_base_state_id(),
  id uuid primary key default gen_random_uuid(),
  lead_id text not null,
  job_id text not null default '',
  event_type text not null,
  title text not null,
  description text not null default '',
  actor_user_id uuid,
  actor_name text not null default '',
  source_type text not null default '',
  source_id text not null default '',
  occurred_at timestamptz not null default clock_timestamp(),
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists crm_task_workflows_lead_job_idx
  on public.crm_task_workflows (company_state_id, lead_id, job_id, status);
create index if not exists crm_task_participants_task_idx
  on public.crm_task_participants (company_state_id, task_id, participant_kind);
create index if not exists crm_task_checklist_task_position_idx
  on public.crm_task_checklist_items (company_state_id, task_id, position);
create index if not exists crm_task_comments_task_created_idx
  on public.crm_task_comments (company_state_id, task_id, created_at desc);
create index if not exists crm_task_time_entries_task_started_idx
  on public.crm_task_time_entries (company_state_id, task_id, started_at desc);
create unique index if not exists crm_task_time_entries_one_active_per_user_idx
  on public.crm_task_time_entries (company_state_id, task_id, user_id)
  where stopped_at is null;
create index if not exists crm_job_milestones_job_position_idx
  on public.crm_job_milestones (company_state_id, lead_id, job_id, position);
create index if not exists crm_activity_events_lead_occurred_idx
  on public.crm_activity_events (company_state_id, lead_id, occurred_at desc);

create or replace function public.crm_workflow_row_access(p_company_state_id text, p_lead_id text, p_created_by uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_coastal_crest_user()
    and p_company_state_id = public.crm_base_state_id()
    and (
      public.can_manage_team_crm()
      or p_created_by = auth.uid()
      or exists (
        select 1
        from public.crm_records r
        where r.company_state_id = p_company_state_id
          and r.record_type = 'contact'
          and r.id = p_lead_id
          and r.owner_id = auth.uid()
          and r.deleted_at is null
      )
    );
$$;
revoke all on function public.crm_workflow_row_access(text, text, uuid) from public, anon;
grant execute on function public.crm_workflow_row_access(text, text, uuid) to authenticated;

create or replace function public.crm_stamp_workflow_row()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.company_state_id := public.crm_base_state_id();
    new.created_by := auth.uid();
    new.created_at := clock_timestamp();
  else
    new.company_state_id := old.company_state_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := auth.uid();
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function public.crm_stamp_workflow_row() from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'crm_task_workflows',
    'crm_task_participants',
    'crm_task_checklist_items',
    'crm_task_comments',
    'crm_task_time_entries',
    'crm_job_milestones',
    'crm_activity_events'
  ] loop
    execute format('drop trigger if exists crm_stamp_workflow_row on public.%I', table_name);
    execute format(
      'create trigger crm_stamp_workflow_row before insert or update on public.%I for each row execute function public.crm_stamp_workflow_row()',
      table_name
    );
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "CRM workflow rows are visible in scope" on public.%I', table_name);
    execute format('drop policy if exists "CRM workflow rows can be created in scope" on public.%I', table_name);
    execute format('drop policy if exists "CRM workflow rows can be changed in scope" on public.%I', table_name);
    execute format('drop policy if exists "CRM workflow rows can be removed in scope" on public.%I', table_name);
    execute format(
      'create policy "CRM workflow rows are visible in scope" on public.%I for select to authenticated using (public.crm_workflow_row_access(company_state_id, lead_id, created_by))',
      table_name
    );
    execute format(
      'create policy "CRM workflow rows can be created in scope" on public.%I for insert to authenticated with check (public.crm_workflow_row_access(company_state_id, lead_id, created_by))',
      table_name
    );
    execute format(
      'create policy "CRM workflow rows can be changed in scope" on public.%I for update to authenticated using (public.crm_workflow_row_access(company_state_id, lead_id, created_by)) with check (public.crm_workflow_row_access(company_state_id, lead_id, created_by))',
      table_name
    );
    execute format(
      'create policy "CRM workflow rows can be removed in scope" on public.%I for delete to authenticated using (public.crm_workflow_row_access(company_state_id, lead_id, created_by))',
      table_name
    );
    execute format('revoke all on table public.%I from public, anon', table_name);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', table_name);
  end loop;
end;
$$;
