-- Step 5: reusable communication templates and durable scheduled work.
create table if not exists public.crm_email_templates(
 company_state_id text not null default public.crm_base_state_id(),id text not null,name text not null,subject_template text not null,body_template text not null,category text not null default 'general',active boolean not null default true,
 created_by uuid not null default auth.uid(),updated_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id),unique(company_state_id,name));
create table if not exists public.crm_scheduled_messages(
 company_state_id text not null default public.crm_base_state_id(),id text not null,lead_id text not null,job_id text not null default '',template_id text not null default '',channel text not null default 'email' check(channel='email'),recipient text not null,subject text not null,body text not null,scheduled_for timestamptz not null,status text not null default 'queued' check(status in ('queued','processing','sent','failed','cancelled')),attempts integer not null default 0 check(attempts between 0 and 20),max_attempts integer not null default 5 check(max_attempts between 1 and 20),next_attempt_at timestamptz not null,last_error text not null default '',provider_message_id text not null default '',sent_at timestamptz,
 created_by uuid not null default auth.uid(),updated_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id));
create table if not exists public.crm_reminders(
 company_state_id text not null default public.crm_base_state_id(),id text not null,lead_id text not null,job_id text not null default '',title text not null,remind_at timestamptz not null,assigned_user_id uuid not null,status text not null default 'pending' check(status in ('pending','completed','dismissed')),
 created_by uuid not null default auth.uid(),updated_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id));
create table if not exists public.crm_notifications(
 company_state_id text not null default public.crm_base_state_id(),id text not null,lead_id text not null default '',job_id text not null default '',recipient_user_id uuid not null,notification_type text not null,title text not null,body text not null default '',status text not null default 'unread' check(status in ('unread','read','archived')),source_type text not null default '',source_id text not null default '',
 created_by uuid not null default auth.uid(),updated_by uuid not null default auth.uid(),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(company_state_id,id));
create index if not exists crm_scheduled_messages_queue_idx on public.crm_scheduled_messages(company_state_id,status,next_attempt_at);
create index if not exists crm_reminders_user_due_idx on public.crm_reminders(company_state_id,assigned_user_id,status,remind_at);
create index if not exists crm_notifications_user_status_idx on public.crm_notifications(company_state_id,recipient_user_id,status,created_at desc);

do $$ declare t text;begin foreach t in array array['crm_email_templates','crm_scheduled_messages','crm_reminders','crm_notifications'] loop execute format('drop trigger if exists crm_stamp_communication_row on public.%I',t);execute format('create trigger crm_stamp_communication_row before insert or update on public.%I for each row execute function public.crm_stamp_workflow_row()',t);execute format('alter table public.%I enable row level security',t);execute format('revoke all on table public.%I from public,anon,authenticated',t);end loop;end $$;

drop policy if exists "CRM users read email templates" on public.crm_email_templates;
drop policy if exists "CRM admins create email templates" on public.crm_email_templates;
drop policy if exists "CRM admins update email templates" on public.crm_email_templates;
create policy "CRM users read email templates" on public.crm_email_templates for select to authenticated using(public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id());
create policy "CRM admins create email templates" on public.crm_email_templates for insert to authenticated with check(public.is_crm_admin() and company_state_id=public.crm_base_state_id() and created_by=(select auth.uid()));
create policy "CRM admins update email templates" on public.crm_email_templates for update to authenticated using(public.is_crm_admin() and company_state_id=public.crm_base_state_id()) with check(public.is_crm_admin() and company_state_id=public.crm_base_state_id());
grant select,insert,update on public.crm_email_templates to authenticated;

do $$ declare t text;begin foreach t in array array['crm_scheduled_messages','crm_reminders'] loop execute format('drop policy if exists "CRM scoped communication select" on public.%I',t);execute format('drop policy if exists "CRM scoped communication insert" on public.%I',t);execute format('drop policy if exists "CRM scoped communication update" on public.%I',t);execute format('create policy "CRM scoped communication select" on public.%I for select to authenticated using(public.crm_project_row_access(company_state_id,lead_id))',t);execute format('create policy "CRM scoped communication insert" on public.%I for insert to authenticated with check(public.crm_project_row_access(company_state_id,lead_id) and created_by=(select auth.uid()))',t);execute format('create policy "CRM scoped communication update" on public.%I for update to authenticated using(public.crm_project_row_access(company_state_id,lead_id)) with check(public.crm_project_row_access(company_state_id,lead_id))',t);execute format('grant select,insert,update on table public.%I to authenticated',t);end loop;end $$;

drop policy if exists "CRM users read own notifications" on public.crm_notifications;
drop policy if exists "CRM users update own notifications" on public.crm_notifications;
drop policy if exists "CRM users create notifications" on public.crm_notifications;
create policy "CRM users read own notifications" on public.crm_notifications for select to authenticated using(company_state_id=public.crm_base_state_id() and (recipient_user_id=(select auth.uid()) or public.can_manage_team_crm()));
create policy "CRM users update own notifications" on public.crm_notifications for update to authenticated using(company_state_id=public.crm_base_state_id() and recipient_user_id=(select auth.uid())) with check(company_state_id=public.crm_base_state_id() and recipient_user_id=(select auth.uid()));
create policy "CRM users create notifications" on public.crm_notifications for insert to authenticated with check(public.is_coastal_crest_user() and company_state_id=public.crm_base_state_id() and created_by=(select auth.uid()));
grant select,insert,update on public.crm_notifications to authenticated;

create or replace function public.crm_schedule_email(p_message jsonb)
returns jsonb language plpgsql security invoker set search_path=''
as $$ declare company_id text:=public.crm_base_state_id();message_id text:=coalesce(p_message->>'id','');lead_value text:=coalesce(p_message->>'lead_id','');job_value text:=coalesce(p_message->>'job_id','');scheduled timestamptz;
begin
 if not public.crm_project_row_access(company_id,lead_value) then raise exception 'lead_access_required';end if;
 if message_id!~'^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' or job_value!~'^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$' or coalesce(p_message->>'recipient','')!~*'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(btrim(coalesce(p_message->>'subject',''))) not between 1 and 500 or char_length(btrim(coalesce(p_message->>'body',''))) not between 1 and 50000 then raise exception 'invalid_message_payload';end if;
 scheduled:=(p_message->>'scheduled_for')::timestamptz;if scheduled<clock_timestamp()-interval '1 minute' then raise exception 'scheduled_time_in_past';end if;
 insert into public.crm_scheduled_messages(company_state_id,id,lead_id,job_id,template_id,recipient,subject,body,scheduled_for,next_attempt_at,status,created_by,updated_by)
 values(company_id,message_id,lead_value,job_value,coalesce(p_message->>'template_id',''),lower(p_message->>'recipient'),btrim(p_message->>'subject'),p_message->>'body',scheduled,scheduled,'queued',auth.uid(),auth.uid());
 insert into public.crm_activity_events(company_state_id,lead_id,job_id,event_type,title,description,actor_user_id,actor_name,source_type,source_id) values(company_id,lead_value,job_value,'email_scheduled','Email scheduled',btrim(p_message->>'subject'),auth.uid(),'CRM user','scheduled_message',message_id);
 return jsonb_build_object('message_id',message_id,'status','queued','scheduled_for',scheduled);
exception when unique_violation then raise exception 'message_already_exists';when invalid_text_representation or datetime_field_overflow then raise exception 'invalid_message_payload';end $$;
revoke all on function public.crm_schedule_email(jsonb) from public,anon;
grant execute on function public.crm_schedule_email(jsonb) to authenticated;
