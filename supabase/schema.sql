-- JobCrest CRM Supabase setup
-- Run this in Supabase Dashboard > SQL Editor before turning on CRM sync.

create table if not exists public.crm_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  owner_id uuid references auth.users(id),
  owner_email text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.crm_state
  add column if not exists owner_id uuid references auth.users(id);

alter table public.crm_state
  add column if not exists owner_email text;

update public.crm_state
set owner_id = updated_by
where owner_id is null
  and updated_by is not null;

create table if not exists public.crm_admins (
  email text primary key,
  created_at timestamptz not null default now()
);

-- Durable, append-only project conversation messages. Each message is stored
-- independently so another user's CRM save cannot overwrite conversation history.
create table if not exists public.crm_conversation_messages (
  id text primary key,
  company_state_id text not null,
  lead_id text not null,
  job_id text not null,
  contact_name text not null default '',
  job_name text not null default '',
  job_status text not null default '',
  author_user_id text,
  author_email text not null default '',
  author_name text not null default '',
  author_role text not null default '',
  message_text text not null check (char_length(message_text) between 1 and 4000),
  mentions jsonb not null default '[]'::jsonb,
  read_by jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists crm_conversation_messages_job_created_idx
  on public.crm_conversation_messages (company_state_id, lead_id, job_id, created_at);

-- Durable CRM records. One business object per row prevents an unrelated save
-- from replacing an entire salesperson or company JSON snapshot.
create table if not exists public.crm_records (
  company_state_id text not null,
  record_type text not null check (record_type in ('contact', 'job', 'estimate', 'task', 'document')),
  id text not null,
  lead_id text,
  job_id text,
  owner_id uuid references auth.users(id),
  data jsonb not null default '{}'::jsonb,
  version integer not null default 1 check (version > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (company_state_id, record_type, id)
);

create index if not exists crm_records_company_type_idx
  on public.crm_records (company_state_id, record_type, updated_at desc);
create index if not exists crm_records_lead_idx
  on public.crm_records (company_state_id, lead_id, record_type);

-- Activity history is append-only. Editing a lead can no longer erase its audit trail.
create table if not exists public.crm_audit_events (
  id text primary key,
  company_state_id text not null,
  lead_id text not null,
  job_id text,
  event_type text not null default 'note',
  actor_user_id uuid references auth.users(id),
  actor_name text not null default '',
  message text not null default '',
  status text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists crm_audit_events_lead_created_idx
  on public.crm_audit_events (company_state_id, lead_id, created_at desc);

create table if not exists public.crm_backups (
  id bigint generated always as identity primary key,
  company_state_id text not null,
  backup_date date not null default current_date,
  record_count integer not null default 0,
  payload jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (company_state_id, backup_date)
);

-- Private object storage for lead documents. The metadata row remains in
-- crm_records; the file bytes live in Storage rather than inside JSON/localStorage.
insert into storage.buckets (id, name, public, file_size_limit)
values ('crm-documents', 'crm-documents', false, 262144000)
on conflict (id) do update set public = false, file_size_limit = 262144000;

-- After your owner account exists, add the owner email here:
-- insert into public.crm_admins (email)
-- values ('owner@coastalcrestroofing.com')
-- on conflict (email) do nothing;
--
-- You can also set trusted app metadata on the owner user:
-- update auth.users
-- set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
-- where lower(email) = 'owner@coastalcrestroofing.com';

create or replace function public.crm_base_state_id()
returns text
language sql
stable
as $$
  select 'coastal-crest';
$$;

create or replace function public.is_coastal_crest_user()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) like '%@coastalcrestroofing.com';
$$;

create or replace function public.crm_app_role()
returns text
language sql
stable
as $$
  select replace(
    replace(
      lower(trim(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', 'viewer'))),
      '-',
      '_'
    ),
    ' ',
    '_'
  );
$$;

create or replace function public.is_crm_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.crm_app_role() = 'admin'
    or lower(coalesce(auth.jwt() ->> 'email', '')) in (
      'gil@coastalcrestroofing.com',
      'devon@coastalcrestroofing.com'
    )
    or exists (
      select 1
      from public.crm_admins
      where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

create or replace function public.can_manage_team_crm()
returns boolean
language sql
stable
as $$
  select public.is_crm_admin()
    or public.crm_app_role() in ('office_manager', 'sales_manager', 'operations_manager');
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_crm_state_updated_at on public.crm_state;
create trigger set_crm_state_updated_at
before update on public.crm_state
for each row
execute function public.set_updated_at();

drop trigger if exists set_crm_conversation_messages_updated_at on public.crm_conversation_messages;
create trigger set_crm_conversation_messages_updated_at
before update on public.crm_conversation_messages
for each row
execute function public.set_updated_at();

drop trigger if exists set_crm_records_updated_at on public.crm_records;
create trigger set_crm_records_updated_at
before update on public.crm_records
for each row
execute function public.set_updated_at();

alter table public.crm_state enable row level security;
alter table public.crm_admins enable row level security;
alter table public.crm_conversation_messages enable row level security;
alter table public.crm_records enable row level security;
alter table public.crm_audit_events enable row level security;
alter table public.crm_backups enable row level security;

drop policy if exists "Company users can read CRM state" on public.crm_state;
drop policy if exists "Company users can create CRM state" on public.crm_state;
drop policy if exists "Company users can update CRM state" on public.crm_state;
drop policy if exists "CRM users read allowed scoped state" on public.crm_state;
drop policy if exists "CRM users create allowed scoped state" on public.crm_state;
drop policy if exists "CRM users update allowed scoped state" on public.crm_state;

create policy "CRM users read allowed scoped state"
on public.crm_state
for select
to authenticated
using (
  public.is_coastal_crest_user()
  and (
    public.can_manage_team_crm()
    or owner_id = auth.uid()
    or id = public.crm_base_state_id() || ':company'
  )
);

create policy "CRM users create allowed scoped state"
on public.crm_state
for insert
to authenticated
with check (
  public.is_coastal_crest_user()
  and updated_by = auth.uid()
  and (
    public.can_manage_team_crm()
    or (
      id = public.crm_base_state_id() || ':user:' || auth.uid()::text
      and owner_id = auth.uid()
    )
    or (
      id = public.crm_base_state_id() || ':company'
      and owner_id is null
    )
  )
);

create policy "CRM users update allowed scoped state"
on public.crm_state
for update
to authenticated
using (
  public.is_coastal_crest_user()
  and (
    public.can_manage_team_crm()
    or owner_id = auth.uid()
    or id = public.crm_base_state_id() || ':company'
  )
)
with check (
  public.is_coastal_crest_user()
  and updated_by = auth.uid()
  and (
    public.can_manage_team_crm()
    or (
      id = public.crm_base_state_id() || ':user:' || auth.uid()::text
      and owner_id = auth.uid()
    )
    or (
      id = public.crm_base_state_id() || ':company'
      and owner_id is null
    )
  )
);

drop policy if exists "CRM admins read admin list" on public.crm_admins;
create policy "CRM admins read admin list"
on public.crm_admins
for select
to authenticated
using (public.is_crm_admin());

drop policy if exists "Company users read conversation messages" on public.crm_conversation_messages;
drop policy if exists "Company users create conversation messages" on public.crm_conversation_messages;
drop policy if exists "Message authors update conversation messages" on public.crm_conversation_messages;

create policy "Company users read conversation messages"
on public.crm_conversation_messages
for select
to authenticated
using (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
);

create policy "Company users create conversation messages"
on public.crm_conversation_messages
for insert
to authenticated
with check (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
  and (
    author_user_id = auth.uid()::text
    or public.can_manage_team_crm()
  )
);

create policy "Message authors update conversation messages"
on public.crm_conversation_messages
for update
to authenticated
using (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
  and (
    author_user_id = auth.uid()::text
    or public.can_manage_team_crm()
  )
)
with check (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
  and (
    author_user_id = auth.uid()::text
    or public.can_manage_team_crm()
  )
);

drop policy if exists "Company users read durable CRM records" on public.crm_records;
drop policy if exists "Company users create durable CRM records" on public.crm_records;
drop policy if exists "Company users update durable CRM records" on public.crm_records;
drop policy if exists "Company users delete durable CRM records" on public.crm_records;

create policy "Company users read durable CRM records"
on public.crm_records for select to authenticated
using (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
);

create policy "Company users create durable CRM records"
on public.crm_records for insert to authenticated
with check (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
  and updated_by = auth.uid()
);

create policy "Company users update durable CRM records"
on public.crm_records for update to authenticated
using (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
)
with check (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
  and updated_by = auth.uid()
);

create policy "Company users delete durable CRM records"
on public.crm_records for delete to authenticated
using (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
);

drop policy if exists "Company users read CRM audit events" on public.crm_audit_events;
drop policy if exists "Company users create CRM audit events" on public.crm_audit_events;

create policy "Company users read CRM audit events"
on public.crm_audit_events for select to authenticated
using (public.is_coastal_crest_user() and company_state_id = public.crm_base_state_id());

create policy "Company users create CRM audit events"
on public.crm_audit_events for insert to authenticated
with check (
  public.is_coastal_crest_user()
  and company_state_id = public.crm_base_state_id()
  and (actor_user_id = auth.uid() or public.can_manage_team_crm())
);

drop policy if exists "CRM managers read backups" on public.crm_backups;
drop policy if exists "CRM managers create backups" on public.crm_backups;

create policy "CRM managers read backups"
on public.crm_backups for select to authenticated
using (public.can_manage_team_crm() and company_state_id = public.crm_base_state_id());

create policy "CRM managers create backups"
on public.crm_backups for insert to authenticated
with check (
  public.can_manage_team_crm()
  and company_state_id = public.crm_base_state_id()
  and created_by = auth.uid()
);

drop policy if exists "Company users read CRM document objects" on storage.objects;
drop policy if exists "Company users upload CRM document objects" on storage.objects;
drop policy if exists "Company users update CRM document objects" on storage.objects;
drop policy if exists "Company users delete CRM document objects" on storage.objects;

create policy "Company users read CRM document objects"
on storage.objects for select to authenticated
using (bucket_id = 'crm-documents' and public.is_coastal_crest_user());

create policy "Company users upload CRM document objects"
on storage.objects for insert to authenticated
with check (bucket_id = 'crm-documents' and public.is_coastal_crest_user());

create policy "Company users update CRM document objects"
on storage.objects for update to authenticated
using (bucket_id = 'crm-documents' and public.is_coastal_crest_user())
with check (bucket_id = 'crm-documents' and public.is_coastal_crest_user());

create policy "Company users delete CRM document objects"
on storage.objects for delete to authenticated
using (bucket_id = 'crm-documents' and public.is_coastal_crest_user());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'crm_state'
    ) then
    alter publication supabase_realtime add table public.crm_state;
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'crm_conversation_messages'
    ) then
    alter publication supabase_realtime add table public.crm_conversation_messages;
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'crm_records'
    ) then
    alter publication supabase_realtime add table public.crm_records;
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'crm_audit_events'
    ) then
    alter publication supabase_realtime add table public.crm_audit_events;
  end if;
end $$;
