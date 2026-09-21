-- Isolated hosted role/transaction smoke, NOT a real Auth browser login.
-- TEMPLATE: substitute the approved identity only in a private, Git-ignored copy.
-- All synthetic records, audit events and receipts are rolled back.
begin;
select set_config('request.jwt.claims', '{"sub":"__STAGING_TEST_USER_ID__","email":"__STAGING_TEST_EMAIL__","iss":"https://ixksmfiektzsunmmwejz.supabase.co/auth/v1","app_metadata":{"role":"sales"}}', true);
set local role authenticated;
do $$
declare saved jsonb;
begin
  if not coalesce(public.is_coastal_crest_user(),false) or public.is_crm_admin() then raise exception 'Sales identity scope failed'; end if;
  saved := public.crm_commit_records('approved-sales-smoke-save', '[{"company_state_id":"coastal-crest","record_type":"job","id":"approved-sales-smoke-job","lead_id":"synthetic-lead","expected_version":0,"data":{"contractValue":35250.75,"costItems":[{"id":"cost-fixture","amount":50.38}],"workflowChecklists":{"inspected":true}}}]', '[]');
  if (saved->'rows'->0->'data'->>'contractValue')::numeric <> 35250.75 then raise exception 'Sales cents save failed'; end if;
  begin
    perform public.crm_commit_records('approved-sales-smoke-payment', '[{"company_state_id":"coastal-crest","record_type":"job","id":"approved-sales-smoke-job","lead_id":"synthetic-lead","expected_version":1,"data":{"contractValue":35250.75,"paidAmount":100}}]', '[]');
    raise exception 'Payment protection failed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.crm_state(id,data,updated_by) values('coastal-crest:company','{}',auth.uid())
      on conflict(id) do update set data='{}',updated_by=auth.uid();
    raise exception 'Settings protection failed';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"__STAGING_TEST_USER_ID__","email":"__STAGING_TEST_EMAIL__","iss":"https://another-project.supabase.co/auth/v1","app_metadata":{"role":"sales"}}',true);
do $$ begin
  if coalesce(public.is_coastal_crest_user(),false) then raise exception 'Wrong project issuer accepted'; end if;
  if exists(select 1 from public.crm_records where id='approved-sales-smoke-job') then raise exception 'Wrong project could read records'; end if;
end $$;
select 'PASS: sales/cents save, admin-only payments/settings, wrong-project denial; synthetic data rolled back next' as approved_sales_checks;
rollback;
