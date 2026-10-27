-- Step 6: relational document operations layered over the existing private file store.
create table if not exists public.crm_document_versions(
 company_state_id text not null default public.crm_base_state_id(),id text not null,document_id text not null,lead_id text not null default '',job_id text not null default '',version_number integer not null check(version_number>0),file_name text not null,mime_type text not null default 'application/octet-stream',file_size bigint not null default 0 check(file_size>=0),storage_path text not null,checksum text not null default '',created_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id),unique(company_state_id,document_id,version_number));
create table if not exists public.crm_document_comments(
 company_state_id text not null default public.crm_base_state_id(),id text not null,document_id text not null,lead_id text not null default '',job_id text not null default '',body text not null check(char_length(btrim(body)) between 1 and 5000),customer_visible boolean not null default false,created_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id));
create table if not exists public.crm_document_access(
 company_state_id text not null default public.crm_base_state_id(),document_id text not null,lead_id text not null default '',job_id text not null default '',customer_visible boolean not null default false,download_allowed boolean not null default true,updated_by uuid not null default auth.uid(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,document_id));
create table if not exists public.crm_document_templates(
 company_state_id text not null default public.crm_base_state_id(),id text not null,name text not null,category_id text not null default '',source_document_id text not null,smart_fields jsonb not null default '[]'::jsonb,active boolean not null default true,created_by uuid not null default auth.uid(),updated_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id),unique(company_state_id,name));
create table if not exists public.crm_signature_requests(
 company_state_id text not null default public.crm_base_state_id(),id text not null,document_id text not null,lead_id text not null,job_id text not null default '',provider text not null check(provider in ('jobcrest','zoho')),provider_request_id text not null default '',recipient_email text not null,status text not null default 'draft' check(status in ('draft','sent','viewed','signed','declined','expired','cancelled')),sent_at timestamptz,completed_at timestamptz,created_by uuid not null default auth.uid(),updated_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id));
create index if not exists crm_document_versions_document_idx on public.crm_document_versions(company_state_id,document_id,version_number desc);
create index if not exists crm_document_comments_document_idx on public.crm_document_comments(company_state_id,document_id,created_at desc);
create index if not exists crm_signature_requests_document_idx on public.crm_signature_requests(company_state_id,document_id,created_at desc);

do $$ declare t text;begin foreach t in array array['crm_document_versions','crm_document_comments','crm_document_access','crm_document_templates','crm_signature_requests'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on table public.%I from public,anon,authenticated',t);end loop;end $$;

do $$ declare t text;begin foreach t in array array['crm_document_versions','crm_document_comments','crm_signature_requests'] loop
 execute format('drop policy if exists "CRM document operations select" on public.%I',t);execute format('drop policy if exists "CRM document operations insert" on public.%I',t);execute format('create policy "CRM document operations select" on public.%I for select to authenticated using((lead_id='''' and public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id()) or public.crm_project_row_access(company_state_id,lead_id))',t);execute format('create policy "CRM document operations insert" on public.%I for insert to authenticated with check(((lead_id='''' and public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id()) or public.crm_project_row_access(company_state_id,lead_id)) and created_by=(select auth.uid()))',t);execute format('grant select,insert on public.%I to authenticated',t);
 end loop;end $$;
drop policy if exists "CRM document operations select" on public.crm_document_access;
drop policy if exists "CRM document operations insert" on public.crm_document_access;
create policy "CRM document operations select" on public.crm_document_access for select to authenticated using((lead_id='' and public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id()) or public.crm_project_row_access(company_state_id,lead_id));
create policy "CRM document operations insert" on public.crm_document_access for insert to authenticated with check(((lead_id='' and public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id()) or public.crm_project_row_access(company_state_id,lead_id)) and updated_by=(select auth.uid()));
grant select,insert on public.crm_document_access to authenticated;
drop policy if exists "CRM document access update" on public.crm_document_access;
create policy "CRM document access update" on public.crm_document_access for update to authenticated using((lead_id='' and public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id()) or public.crm_project_row_access(company_state_id,lead_id)) with check((lead_id='' and public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id()) or public.crm_project_row_access(company_state_id,lead_id));
grant update on public.crm_document_access to authenticated;
drop policy if exists "CRM signature update" on public.crm_signature_requests;
create policy "CRM signature update" on public.crm_signature_requests for update to authenticated using(public.crm_project_row_access(company_state_id,lead_id)) with check(public.crm_project_row_access(company_state_id,lead_id));
grant update on public.crm_signature_requests to authenticated;
drop policy if exists "CRM users read document templates" on public.crm_document_templates;
drop policy if exists "CRM admins insert document templates" on public.crm_document_templates;
drop policy if exists "CRM admins update document templates" on public.crm_document_templates;
create policy "CRM users read document templates" on public.crm_document_templates for select to authenticated using(public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id());
create policy "CRM admins insert document templates" on public.crm_document_templates for insert to authenticated with check(public.is_crm_admin() and company_state_id=public.crm_base_state_id() and created_by=(select auth.uid()));
create policy "CRM admins update document templates" on public.crm_document_templates for update to authenticated using(public.is_crm_admin() and company_state_id=public.crm_base_state_id()) with check(public.is_crm_admin() and company_state_id=public.crm_base_state_id());
grant select,insert,update on public.crm_document_templates to authenticated;

create or replace function public.crm_publish_document_version(p_version jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$declare company_id text:=public.crm_base_state_id();lead_value text:=coalesce(p_version->>'lead_id','');document_value text:=coalesce(p_version->>'document_id','');next_version integer;
begin
 if not ((lead_value='' and public.is_coastal_crest_user()) or public.crm_project_row_access(company_id,lead_value)) then raise exception 'document_access_required';end if;
 if document_value!~'^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' or coalesce(p_version->>'id','')!~'^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' or char_length(coalesce(p_version->>'storage_path','')) not between 1 and 1000 then raise exception 'invalid_document_version';end if;
 select coalesce(max(version_number),0)+1 into next_version from public.crm_document_versions where company_state_id=company_id and document_id=document_value;
 insert into public.crm_document_versions(company_state_id,id,document_id,lead_id,job_id,version_number,file_name,mime_type,file_size,storage_path,checksum,created_by)
 values(company_id,p_version->>'id',document_value,lead_value,coalesce(p_version->>'job_id',''),next_version,coalesce(nullif(btrim(p_version->>'file_name'),''),'document'),coalesce(nullif(p_version->>'mime_type',''),'application/octet-stream'),greatest(0,coalesce((p_version->>'file_size')::bigint,0)),p_version->>'storage_path',coalesce(p_version->>'checksum',''),auth.uid());
 insert into public.crm_activity_events(company_state_id,lead_id,job_id,event_type,title,description,actor_user_id,actor_name,source_type,source_id) values(company_id,lead_value,coalesce(p_version->>'job_id',''),'document_version','Document version published',coalesce(p_version->>'file_name','document'),auth.uid(),'CRM user','document',document_value);
 return jsonb_build_object('document_id',document_value,'version_number',next_version);
exception when unique_violation then raise exception 'document_version_already_exists';when invalid_text_representation then raise exception 'invalid_document_version';end$$;
revoke all on function public.crm_publish_document_version(jsonb) from public,anon;
grant execute on function public.crm_publish_document_version(jsonb) to authenticated;
