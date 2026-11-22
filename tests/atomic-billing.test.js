const test = require('node:test');
const assert = require('node:assert/strict');
const {PGlite} = require('@electric-sql/pglite');
const {install,issue,voidBill,payment} = require('./helpers/billing-fixture');

test('billing transactions against the local CRM ledger schema',async (t)=>{
  const db = new PGlite();
  t.after(()=>db.close());
  await install(sql=>db.exec(sql));
  await db.exec('set role authenticated');
  const first=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
  await t.test('a payment or applied credit landing after confirmation prevents void, including in old tabs',async()=>{
    const {id}=await first(issue,['d1',0]);
    await first('select public.crm_record_invoice_payment($1)',[JSON.stringify(payment(id))]);
    await assert.rejects(first(voidBill,[id]),/payments or credits/);
    await assert.rejects(first("update public.crm_invoices set status='void' where id=$1",[id]),/payments or credits/);
    assert.equal((await first('select amount_paid::int n from public.crm_invoices where id=$1',[id])).n,50);
    const other=await first(issue,['d2',0]);
    await first('select public.crm_apply_credit_note($1)',[JSON.stringify({id:'c1',invoice_id:other.id,credit_number:'C-1',amount:10,reason:'Adjustment',issued_at:'2026-11-22'})]);
    await assert.rejects(first(voidBill,[other.id]),/payments or credits/);
  });
  await t.test('failure reopening a draw rolls back the void; retry reopens draw and disables schedule together',async()=>{
    const {id}=await first(issue,['d3',0]);
    await db.query("insert into public.crm_invoice_schedules(id,template_invoice_id,lead_id,job_id,cadence,next_issue_date) values('s',$1,'l','j','monthly',current_date)",[id]);
    await db.exec(`reset role; create function public.fail_reopen() returns trigger language plpgsql as $$begin raise exception 'injected reopen failure'; end$$;
      create trigger fail_reopen before update on public.crm_progress_billings for each row when (new.invoice_id='') execute function public.fail_reopen(); set role authenticated;`);
    await assert.rejects(first(voidBill,[id]),/injected reopen failure/);
    const snapshot=()=>first("select i.status, d.invoice_id,s.active from public.crm_invoices i,public.crm_progress_billings d,public.crm_invoice_schedules s where i.id=$1 and d.id='d3' and s.id='s'",[id]);
    assert.deepEqual(await snapshot(),{status:'draft',invoice_id:id,active:true});
    await db.exec('reset role; drop trigger fail_reopen on public.crm_progress_billings; set role authenticated');
    assert.equal((await first(voidBill,[id])).id,id);
    assert.deepEqual(await snapshot(),{status:'void',invoice_id:'',active:false});
    await assert.rejects(db.query("update public.crm_invoice_schedules set active=true where id='s'"),/cannot be scheduled/);
    await assert.rejects(first(issue,['d3',0]),/draw has changed/);
  });
  await t.test('replacement and repeated requests produce one live invoice and one line',async()=>{
    const {id}=await first(issue,['d4',0]); await first(voidBill,[id]);
    const {id:replacement}=await first(issue,['d4',1]);
    assert.notEqual(id,replacement); assert.equal((await first(issue,['d4',1])).id,replacement);
    assert.equal((await first("select count(*)::int n from public.crm_invoices where source_draw_id='d4' and status<>'void'")).n,1);
    assert.equal((await first('select count(*)::int n from public.crm_invoice_items where invoice_id=$1',[replacement])).n,1);
    await db.exec("set test.role='sales'");
    await assert.rejects(first(issue,['d5',0]),/Administrator access/);
    await assert.rejects(first(voidBill,[replacement]),/Administrator access/);
  });
});
