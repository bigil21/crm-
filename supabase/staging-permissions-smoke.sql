-- ONLY for the verified, empty crm testing project (ixksmfiektzsunmmwejz).
-- Uses temporary synthetic identities in a transaction, then rolls all fixtures back.
-- This exercises hosted PostgreSQL/RLS, NOT real Auth sign-in or Storage HTTP APIs.
begin;
do $$ begin
  if exists(select 1 from public.crm_records) or exists(select 1 from auth.users) then
    raise exception 'Expected empty staging data; refusing fixture insertion';
  end if;
end $$;
create temporary table staging_checks(check_name text, passed boolean);
grant select,insert on staging_checks to authenticated,anon;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','staging-admin@coastalcrestroofing.com'),
 ('00000000-0000-4000-8000-000000000002','staging-sales@coastalcrestroofing.com'),
 ('00000000-0000-4000-8000-000000000003','staging-outsider@example.com');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","email":"staging-sales@coastalcrestroofing.com","app_metadata":{"role":"sales"}}',true);
set local role authenticated;
select public.crm_commit_records('smoke-create','[
 {"company_state_id":"coastal-crest","record_type":"contact","id":"staging-lead","lead_id":"staging-lead","expected_version":0,"data":{"name":"Fictional staging lead","workflowChecklists":{"checked":true}}},
 {"company_state_id":"coastal-crest","record_type":"job","id":"staging-job","lead_id":"staging-lead","job_id":"staging-job","expected_version":0,"data":{"status":"Inspection","contractValue":35250.75,"costItems":[{"id":"cost-1","amount":100.25}]}}
 ]'::jsonb);
insert into staging_checks select 'Sales normal edits and cents',
 (select data->>'contractValue'='35250.75' and version=1 from public.crm_records where id='staging-job');
select public.crm_commit_records('smoke-next','[{"company_state_id":"coastal-crest","record_type":"job","id":"staging-job","lead_id":"staging-lead","job_id":"staging-job","expected_version":1,"data":{"status":"Estimate Sent","contractValue":35250.75}}]'::jsonb);
select public.crm_commit_records('smoke-next','[{"company_state_id":"coastal-crest","record_type":"job","id":"staging-job","lead_id":"staging-lead","job_id":"staging-job","expected_version":1,"data":{"status":"Estimate Sent","contractValue":35250.75}}]'::jsonb);
insert into staging_checks select 'Retry does not duplicate the write',version=2 from public.crm_records where id='staging-job';
do $$ declare rejected boolean:=false; begin
 begin perform public.crm_commit_records('smoke-stale','[{"company_state_id":"coastal-crest","record_type":"job","id":"staging-job","expected_version":1,"data":{"status":"New"}}]'::jsonb);
 exception when sqlstate '40001' then rejected:=true; end;
 insert into staging_checks values('Stale record rejected',rejected);
end $$;
do $$ declare rejected boolean:=false; begin
 begin perform public.crm_commit_records('smoke-batch','[{"company_state_id":"coastal-crest","record_type":"contact","id":"batch-probe","expected_version":0,"data":{}},{"company_state_id":"coastal-crest","record_type":"job","id":"staging-job","expected_version":1,"data":{}}]'::jsonb);
 exception when sqlstate '40001' then rejected:=true; end;
 insert into staging_checks select 'Conflicting batch rolls back completely', rejected and not exists(select 1 from public.crm_records where id='batch-probe') and not exists(select 1 from public.crm_audit_events where metadata->>'record_id'='batch-probe');
end $$;
do $$ declare rejected boolean:=false; begin
 begin update public.crm_records set data='{}' where id='staging-job';
 exception when insufficient_privilege then rejected:=true; end;
 insert into staging_checks values('Direct record update denied',rejected);
end $$;
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","email":"staging-admin@coastalcrestroofing.com","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
select public.crm_commit_records('smoke-admin-payment','[{"company_state_id":"coastal-crest","record_type":"job","id":"staging-job","lead_id":"staging-lead","job_id":"staging-job","expected_version":2,"data":{"contractValue":35250.75,"paidAmount":100.25,"manualPayments":[{"id":"check-1","amount":100.25,"date":"2026-09-14"}]}}]'::jsonb);
insert into staging_checks select 'Admin payment recorded',data->>'paidAmount'='100.25' and version=3 from public.crm_records where id='staging-job';
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","email":"staging-sales@coastalcrestroofing.com","app_metadata":{"role":"sales"}}',true);
set local role authenticated;
do $$ declare rejected boolean:=false; begin
 begin perform public.crm_commit_records('smoke-payment-bypass','[{"company_state_id":"coastal-crest","record_type":"job","id":"staging-job","expected_version":3,"data":{"paidAmount":0,"manualPayments":[]}}]'::jsonb);
 exception when insufficient_privilege then rejected:=true; end;
 insert into staging_checks values('Sales payment change denied',rejected);
end $$;
select public.crm_commit_records('smoke-paid-job-edit','[{"company_state_id":"coastal-crest","record_type":"job","id":"staging-job","lead_id":"staging-lead","job_id":"staging-job","expected_version":3,"data":{"status":"In Progress","contractValue":35250.75,"paidAmount":100.25,"manualPayments":[{"id":"check-1","amount":100.25,"date":"2026-09-14"}],"profitNotes":"Fictional cost review"}}]'::jsonb);
insert into staging_checks select 'Sales can edit paid jobs without altering payments',version=4 and data->>'paidAmount'='100.25' and data->>'status'='In Progress' from public.crm_records where id='staging-job';
reset role;
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000003","email":"staging-outsider@example.com","app_metadata":{"role":"admin"}}',true);
set local role authenticated;
do $$ declare rejected boolean:=false; begin
 begin perform public.crm_commit_records('smoke-outsider','[]'::jsonb);
 exception when insufficient_privilege then rejected:=true; end;
 insert into staging_checks select 'Outside-company access denied',rejected and not exists(select 1 from public.crm_records);
end $$;
reset role;
select set_config('request.jwt.claims','{}',true);
set local role anon;
do $$ declare rejected boolean:=false; begin
 begin perform public.crm_commit_records('smoke-anon','[]'::jsonb);
 exception when insufficient_privilege then rejected:=true; end;
 insert into staging_checks values('Anonymous commit denied',rejected);
end $$;
reset role;
do $$ begin
 if (select count(*) from staging_checks)<>10 or exists(select 1 from staging_checks where passed is distinct from true) then
  raise exception 'Staging permission test failed';
 end if;
end $$;
select jsonb_agg(jsonb_build_object('check',check_name,'passed',passed) order by check_name) as staging_results from staging_checks;
rollback;
