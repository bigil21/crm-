-- Step 4: configurable lead organization and intake metadata.

create table if not exists public.crm_lead_sources (
 company_state_id text not null default public.crm_base_state_id(),id text not null,name text not null,display_order integer not null default 0,active boolean not null default true,
 created_by uuid not null default auth.uid(),updated_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id),unique(company_state_id,name));
create table if not exists public.crm_tags (
 company_state_id text not null default public.crm_base_state_id(),id text not null,name text not null,color text not null default '#2563eb' check(color~'^#[0-9A-Fa-f]{6}$'),active boolean not null default true,
 created_by uuid not null default auth.uid(),updated_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id),unique(company_state_id,name));
create table if not exists public.crm_record_tags (
 company_state_id text not null default public.crm_base_state_id(),id text not null,lead_id text not null,job_id text not null default '',record_type text not null check(record_type in ('lead','job')),record_id text not null,tag_id text not null,
 created_by uuid not null default auth.uid(),updated_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id),unique(company_state_id,record_type,record_id,tag_id),foreign key(company_state_id,tag_id) references public.crm_tags(company_state_id,id) on delete restrict);
create table if not exists public.crm_custom_fields (
 company_state_id text not null default public.crm_base_state_id(),id text not null,label text not null,field_key text not null,applies_to text not null check(applies_to in ('lead','job')),field_type text not null check(field_type in ('text','number','date','select','checkbox')),options jsonb not null default '[]'::jsonb,required boolean not null default false,display_order integer not null default 0,active boolean not null default true,
 created_by uuid not null default auth.uid(),updated_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id),unique(company_state_id,applies_to,field_key));
create table if not exists public.crm_custom_field_values (
 company_state_id text not null default public.crm_base_state_id(),id text not null,lead_id text not null,job_id text not null default '',record_type text not null check(record_type in ('lead','job')),record_id text not null,field_id text not null,value jsonb not null default 'null'::jsonb,
 created_by uuid not null default auth.uid(),updated_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id),unique(company_state_id,record_type,record_id,field_id),foreign key(company_state_id,field_id) references public.crm_custom_fields(company_state_id,id) on delete restrict);
create table if not exists public.crm_saved_filters (
 company_state_id text not null default public.crm_base_state_id(),id text not null,owner_user_id uuid not null default auth.uid(),name text not null,view_name text not null default 'leads',criteria jsonb not null default '{}'::jsonb,
 created_by uuid not null default auth.uid(),updated_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id),unique(company_state_id,owner_user_id,view_name,name));
create table if not exists public.crm_assignment_alerts (
 company_state_id text not null default public.crm_base_state_id(),id text not null,lead_id text not null,job_id text not null default '',assigned_user_id uuid not null,assigned_by uuid not null default auth.uid(),status text not null default 'unread' check(status in ('unread','read')),message text not null default '',
 created_by uuid not null default auth.uid(),updated_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id));
create table if not exists public.crm_web_lead_forms (
 company_state_id text not null default public.crm_base_state_id(),id text not null,name text not null,source_id text not null default '',fields jsonb not null default '[]'::jsonb,active boolean not null default true,public_token_hash text not null default '',
 created_by uuid not null default auth.uid(),updated_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id));

create index if not exists crm_record_tags_record_idx on public.crm_record_tags(company_state_id,record_type,record_id);
create index if not exists crm_custom_values_record_idx on public.crm_custom_field_values(company_state_id,record_type,record_id);
create index if not exists crm_saved_filters_owner_idx on public.crm_saved_filters(company_state_id,owner_user_id,view_name);
create index if not exists crm_assignment_alerts_user_idx on public.crm_assignment_alerts(company_state_id,assigned_user_id,status,created_at desc);

do $$ declare t text; begin
 foreach t in array array['crm_lead_sources','crm_tags','crm_record_tags','crm_custom_fields','crm_custom_field_values','crm_saved_filters','crm_assignment_alerts','crm_web_lead_forms'] loop
  execute format('drop trigger if exists crm_stamp_lead_org_row on public.%I',t);
  execute format('create trigger crm_stamp_lead_org_row before insert or update on public.%I for each row execute function public.crm_stamp_workflow_row()',t);
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on table public.%I from public,anon,authenticated',t);
 end loop;
end $$;

do $$ declare t text; begin
 foreach t in array array['crm_lead_sources','crm_tags','crm_custom_fields','crm_web_lead_forms'] loop
  execute format('drop policy if exists "CRM users read lead configuration" on public.%I',t);
  execute format('drop policy if exists "CRM admins insert lead configuration" on public.%I',t);
  execute format('drop policy if exists "CRM admins update lead configuration" on public.%I',t);
  execute format('create policy "CRM users read lead configuration" on public.%I for select to authenticated using(public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id())',t);
  execute format('create policy "CRM admins insert lead configuration" on public.%I for insert to authenticated with check(public.is_crm_admin() and company_state_id=public.crm_base_state_id() and created_by=(select auth.uid()))',t);
  execute format('create policy "CRM admins update lead configuration" on public.%I for update to authenticated using(public.is_crm_admin() and company_state_id=public.crm_base_state_id()) with check(public.is_crm_admin() and company_state_id=public.crm_base_state_id())',t);
  execute format('grant select,insert,update on table public.%I to authenticated',t);
 end loop;
end $$;

do $$ declare t text; begin
 foreach t in array array['crm_record_tags','crm_custom_field_values'] loop
  execute format('drop policy if exists "CRM scoped lead metadata select" on public.%I',t);
  execute format('drop policy if exists "CRM scoped lead metadata insert" on public.%I',t);
  execute format('drop policy if exists "CRM scoped lead metadata update" on public.%I',t);
  execute format('create policy "CRM scoped lead metadata select" on public.%I for select to authenticated using(public.crm_project_row_access(company_state_id,lead_id))',t);
  execute format('create policy "CRM scoped lead metadata insert" on public.%I for insert to authenticated with check(public.crm_project_row_access(company_state_id,lead_id) and created_by=(select auth.uid()))',t);
  execute format('create policy "CRM scoped lead metadata update" on public.%I for update to authenticated using(public.crm_project_row_access(company_state_id,lead_id)) with check(public.crm_project_row_access(company_state_id,lead_id))',t);
  execute format('grant select,insert,update on table public.%I to authenticated',t);
 end loop;
end $$;

drop policy if exists "CRM users read own saved filters" on public.crm_saved_filters;
drop policy if exists "CRM users create own saved filters" on public.crm_saved_filters;
drop policy if exists "CRM users update own saved filters" on public.crm_saved_filters;
drop policy if exists "CRM users delete own saved filters" on public.crm_saved_filters;
create policy "CRM users read own saved filters" on public.crm_saved_filters for select to authenticated using(company_state_id=public.crm_base_state_id() and owner_user_id=(select auth.uid()));
create policy "CRM users create own saved filters" on public.crm_saved_filters for insert to authenticated with check(company_state_id=public.crm_base_state_id() and owner_user_id=(select auth.uid()) and created_by=(select auth.uid()));
create policy "CRM users update own saved filters" on public.crm_saved_filters for update to authenticated using(company_state_id=public.crm_base_state_id() and owner_user_id=(select auth.uid())) with check(company_state_id=public.crm_base_state_id() and owner_user_id=(select auth.uid()));
create policy "CRM users delete own saved filters" on public.crm_saved_filters for delete to authenticated using(company_state_id=public.crm_base_state_id() and owner_user_id=(select auth.uid()));
grant select,insert,update,delete on table public.crm_saved_filters to authenticated;

drop policy if exists "CRM users read assigned alerts" on public.crm_assignment_alerts;
drop policy if exists "CRM managers create assignment alerts" on public.crm_assignment_alerts;
drop policy if exists "CRM users update assigned alerts" on public.crm_assignment_alerts;
create policy "CRM users read assigned alerts" on public.crm_assignment_alerts for select to authenticated using(company_state_id=public.crm_base_state_id() and (assigned_user_id=(select auth.uid()) or public.can_manage_team_crm()));
create policy "CRM managers create assignment alerts" on public.crm_assignment_alerts for insert to authenticated with check(company_state_id=public.crm_base_state_id() and public.can_manage_team_crm() and created_by=(select auth.uid()));
create policy "CRM users update assigned alerts" on public.crm_assignment_alerts for update to authenticated using(company_state_id=public.crm_base_state_id() and assigned_user_id=(select auth.uid())) with check(company_state_id=public.crm_base_state_id() and assigned_user_id=(select auth.uid()));
grant select,insert,update on table public.crm_assignment_alerts to authenticated;
