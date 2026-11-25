'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createEmptyDatabase } = require('../scripts/local-cloud.js');

test('cutover compares individual balances (including deleted jobs), corrects zero-contract percentages and cannot bypass the guard', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    const one = async (sql, params) => (await db.query(sql, params)).rows[0];
    const owner = '11111111-1111-4111-8111-111111111111';
    const insert = (type,id,data,deleted=false) => db.query(
      "insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,data,owner_id,updated_by,deleted_at) values ('coastal-crest',$1,$2,'test-lead',$3,$4,$5,$5,case when $6 then now() end)",
      [type,id,type==='job'?id:null,JSON.stringify(data),owner,deleted]);
    await insert('contact','test-lead',{id:'test-lead'});
    for(const [id,amt,c] of [['test-a',50,0],['test-b',25,50]]) {
      await insert('job',id,{id,status:'Completed',value:50,contractValue:c,paidAmount:amt,squarePaidAmount:0,manualPayments:[{id:'pay-'+id,amount:amt,date:'2026-11-01',method:'Check'}]});
    }
    await insert('job','deleted',{id:'deleted',status:'Lost',value:10,paidAmount:0},true);
    const acl=await one("select has_function_privilege('service_role','public.crm_activate_payment_ledger_core(jsonb)','execute') as bypass,has_function_privilege('authenticated','public.crm_activate_payment_ledger(jsonb)','execute') as browser,has_function_privilege('service_role','public.crm_activate_payment_ledger(jsonb)','execute') as server");
    assert.deepEqual(acl,{bypass:false,browser:false,server:true});
    // Opposite one-cent errors leave the company total unchanged; activation must still roll back.
    await db.exec("update public.crm_records set data=jsonb_set(data,'{paidAmount}',to_jsonb((data->>'paidAmount')::numeric+case id when 'test-a' then 0.01 else -0.01 end)) where record_type='job' and id in ('test-a','test-b')");
    await assert.rejects(db.query("select public.crm_activate_payment_ledger('[]')"),/ledger_cutover_changed_a_job_balance_or_status/);
    assert.deepEqual(await one("select public.crm_payment_ledger_enabled() as active, public.crm_ledger_totals()->>'collected' as collected"),{active:false,collected:'75.00'});
    await db.exec("update public.crm_records set data=jsonb_set(data,'{paidAmount}',to_jsonb(case id when 'test-a' then 50 else 25 end)) where record_type='job' and id in ('test-a','test-b')");
    const {digest}=await one(`insert into public.crm_backups(company_state_id,backup_date,record_count,payload)
      select 'coastal-crest','2026-01-01',4,jsonb_build_object('skippedTables','[]'::jsonb,'absentTables','[]'::jsonb,
      'records',(select jsonb_agg(to_jsonb(r)) from public.crm_records r),
      'tables',jsonb_build_object('crm_payments',(select jsonb_agg(to_jsonb(p)-'provider_invoice'-'provider_refunded') from public.crm_payments p),
      'crm_refunds','[]'::jsonb,'crm_credit_notes','[]'::jsonb,'crm_expenses','[]'::jsonb,'crm_invoices','[]'::jsonb))
      returning md5(payload::text) digest`);
    const reviewed=(total=75)=>one("select public.crm_activate_reviewed_payment_ledger('[]','2026-01-01',$1,$2) r",[digest,total]);
    await assert.rejects(reviewed(74.99),/collected_changed_since_rehearsal/);
    await db.exec("update public.crm_records set data=data||'{\"value\":51}' where record_type='job' and id='test-a'");
    await assert.rejects(reviewed(),/records_changed_since_rehearsal/);
    await db.exec("update public.crm_records set data=data||'{\"value\":50}' where record_type='job' and id='test-a'");
    const {r}=await reviewed();
    assert.deepEqual([r.jobsChecked,r.jobBalanceDifferences,r.before,r.after],[3,0,75,75]);
    assert.equal((await one("select (data->>'paymentPercent')::int percent from public.crm_records where record_type='job' and id='test-a'")).percent,100);
  } finally { await db.close(); }
});
