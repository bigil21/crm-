// Only install into an empty, disposable local database. The exported helper
// is shared by the embedded regression suite and the two-connection test.
const fs = require('node:fs');
const path = require('node:path');
const migrations = path.resolve(__dirname, '../../supabase/migrations');
async function install(exec) {
  await exec(`
    create role anon; create role authenticated; create schema auth;
    create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('test.actor',true),''),'00000000-0000-4000-8000-000000000001')::uuid$$;
    grant usage on schema auth to authenticated;
    create function public.crm_base_state_id() returns text language sql stable as $$select 'coastal-crest'$$;
    create function public.is_coastal_crest_user() returns boolean language sql stable as $$select true$$;
    create function public.is_crm_admin() returns boolean language sql stable as $$select current_setting('test.role',true) is distinct from 'sales'$$;
    create function public.can_manage_team_crm() returns boolean language sql stable as $$select public.is_crm_admin()$$;
    create function public.crm_company_time_zone() returns text language sql stable as $$select 'America/New_York'$$;
    create table public.crm_records(company_state_id text not null,record_type text,id text,lead_id text,job_id text,owner_id uuid,data jsonb,deleted_at timestamptz);
    grant select on public.crm_records to authenticated;
    insert into public.crm_records(company_state_id,record_type,id,lead_id,data) values
      ('coastal-crest','contact','l','l','{"name":"Test customer"}'),('coastal-crest','job','j','l','{"name":"Test job"}');
  `);
  for(const file of ['20261027111541_perfex_foundation_phase1','20261027112852_estimate_invoice_financial_ledger',
    '20261027113614_invoice_controls_phase2','20261027114326_revenue_controls_complete','20261027114732_project_delivery_step3',
    '20261101123000_job_operations_suite','20261122181927_atomic_draw_billing','20261122181927_atomic_draw_billing']) {
    await exec(fs.readFileSync(path.join(migrations,file+'.sql'),'utf8'));
  }
  await exec(`insert into public.crm_progress_billings(id,lead_id,job_id,draw_number,name,amount)
    select 'd'||i,'l','j',i,'Fixture draw',100.50 from generate_series(1,5) i`);
}
const issue = 'select public.crm_invoice_progress_draw($1,$2) id';
const voidBill = 'select public.crm_void_internal_invoice($1) id';
const payment = (invoice) => ({id:'p1',invoice_id:invoice,method:'check',amount:50,received_at:'2026-11-22T10:00:00Z'});
module.exports = {install,issue,voidBill,payment};
