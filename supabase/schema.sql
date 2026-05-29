-- Roofline CRM Supabase setup
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

alter table public.crm_state enable row level security;
alter table public.crm_admins enable row level security;

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
end $$;
