-- Roofline CRM Supabase setup
-- Run this in Supabase Dashboard > SQL Editor before turning on CRM sync.

create table if not exists public.crm_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create or replace function public.is_coastal_crest_user()
returns boolean
language sql
stable
as $$
  select lower(coalesce(auth.jwt() ->> 'email', '')) like '%@coastalcrestroofing.com';
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

drop policy if exists "Company users can read CRM state" on public.crm_state;
create policy "Company users can read CRM state"
on public.crm_state
for select
to authenticated
using (public.is_coastal_crest_user());

drop policy if exists "Company users can create CRM state" on public.crm_state;
create policy "Company users can create CRM state"
on public.crm_state
for insert
to authenticated
with check (
  id = 'coastal-crest'
  and updated_by = auth.uid()
  and public.is_coastal_crest_user()
);

drop policy if exists "Company users can update CRM state" on public.crm_state;
create policy "Company users can update CRM state"
on public.crm_state
for update
to authenticated
using (public.is_coastal_crest_user())
with check (
  id = 'coastal-crest'
  and updated_by = auth.uid()
  and public.is_coastal_crest_user()
);

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
