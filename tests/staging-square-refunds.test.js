'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reconcile,create}=require('../square-refund-reconciliation');
const money=amount=>({amount,currency:'USD'});
test('signed refund events reconcile only after authenticating the merchant and exact signature',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
 const src=fs.readFileSync(require.resolve('../server.js'),'utf8');let res,got=[];
 const url='https://crm.invalid/webhooks/square',secret='unit-test';
 const ctx=vm.createContext({Buffer,require,process:{env:{SQUARE_WEBHOOK_URL:url,SQUARE_ENVIRONMENT:'sandbox',SQUARE_MERCHANT_ID:'m'}},
   squareWebhookKey:()=>secret,squareWorkerConfig:()=>({}),readRequestBody:async r=>r.body,sendJson:(_,s,b)=>{res={s,b}},stagingRefundWorker:{reconcile:async id=>{got.push(id);return {durable:true}}}});
 for(const n of ['squareStatusSafeId','handleSquareWebhook'])vm.runInContext(src.match(new RegExp('^( *)(?:async )?function '+n+'\\([^]*?^\\1}', 'm'))[0],ctx);
 async function post(merchant,valid){const body=JSON.stringify({type:'refund.updated',merchant_id:merchant,event_id:'event',data:{object:{refund:{id:'r',amount_money:money(99999)}}}});
 const sig=crypto.createHmac('sha256',secret).update(url+body).digest('base64');await ctx.handleSquareWebhook({body,headers:{'x-square-hmacsha256-signature':valid?sig:'bad','square-environment':'sandbox'}},{});return res.s;}
 assert.equal(await post('m',false),401);assert.equal(await post('other',true),403);assert.deepEqual(got,[]);
 assert.equal(await post('m',true),200);assert.deepEqual(got,['r']);
});
function fixture(){
 const refund={id:'r',payment_id:'p',location_id:'l',amount_money:money(1500),status:'COMPLETED'};
 const payment={id:'p',order_id:'o',location_id:'l',status:'COMPLETED',total_money:money(6000),refunded_money:money(1500),refund_ids:['r']};
 const invoice={id:'i',order_id:'o',location_id:'l',status:'PAID'};
 const order={id:'o',location_id:'l',tenders:[{id:'p'}]};
 const map={'/refunds/r':{refund},'/payments/p':{payment},'/invoices/i':{invoice},'/orders/o':{order}};
 const binding={provider_invoice:'i',provider_payment_id:'p',origin:'square',amount:60};
 const writes=[];
 const deps={get:async p=>map[p],lookup:async()=>binding,apply:async args=>{writes.push(args);return {durable:true}}};
 return {refund,payment,order,invoice,binding,writes,map,deps};
}
test('completed tender refund works when its invoice is still PAID; submits cumulative cents, not a delta',async()=>{
 const f=fixture();await reconcile('r',f.deps);await reconcile('r',f.deps);
 assert.equal(f.writes.length,2);assert.deepEqual(f.writes[0],f.writes[1]);assert.deepEqual(f.writes[0],{p_payment:'p',p_invoice:'i',p_order:'o',p_gross:6000,p_refunded:1500});
});
test('multiple completed refunds reconcile together; a pending refund is not counted',async()=>{
 const f=fixture();f.payment.refund_ids.push('r2','r3');f.map['/refunds/r2']={refund:{...f.refund,id:'r2',amount_money:money(500)}};f.map['/refunds/r3']={refund:{...f.refund,id:'r3',status:'PENDING'}};
 f.payment.refunded_money=money(2000);await reconcile('r',f.deps);assert.equal(f.writes[0].p_refunded,2000);
});
for(const [name,alter] of Object.entries({
 'unmatched order':f=>f.invoice.order_id='other','wrong capture':f=>f.payment.order_id='other','wrong refund location':f=>f.refund.location_id='other',
 'currency':f=>f.refund.amount_money.currency='CAD','tip':f=>f.payment.tip_money=money(25),'refund total mismatch':f=>f.payment.refunded_money=money(1501),
 'amount exceeds capture':f=>f.payment.refunded_money=money(9000),'duplicate refund ids':f=>f.payment.refund_ids.push('r'),'missing charge':f=>f.order.tenders=[],
 'ledger amount mismatch':f=>f.binding.amount=61,'unknown webhook refund':f=>f.payment.refund_ids=[],
})){test('no write: '+name,async()=>{const f=fixture();alter(f);await assert.rejects(reconcile('r',f.deps));assert.equal(f.writes.length,0)});}
test('ignore pending refunds and unrelated merchant payments',async()=>{const f=fixture();f.refund.status='PENDING';assert.equal((await reconcile('r',f.deps)).status,'not_completed');f.refund.status='COMPLETED';f.deps.lookup=async()=>null;assert.equal((await reconcile('r',f.deps)).status,'not_mapped');assert.equal(f.writes.length,0)});
test('missed notifications recovered from Square, not from directly editing a job',async()=>{const f=fixture();const get=f.deps.get;f.deps.get=async p=>p.startsWith('/refunds?')?{refunds:[f.refund]}:get(p);const w=create(f.deps);await w.sweep();await w.sweep();assert.equal(f.writes.length,1)});
test('real database projects the $15 refund once, rejects cross-scope writes and keeps the two original payments',async()=>{
 const db=await require('../scripts/local-cloud').createEmptyDatabase({quiet:true});
 try{
  await db.exec(`select set_config('request.jwt.claims','{"role":"service_role"}',false);
    select public.crm_activate_payment_ledger();
    insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,owner_id,updated_by,data)
    values ('coastal-crest','contact','lead','lead',null,'11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','{"name":"Synthetic"}'),
    ('coastal-crest','job','job','lead','job','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','{"contractValue":100,"status":"Won"}');
    insert into public.crm_square_invoice_watermarks(company_state_id,environment,merchant_id,invoice_id,order_id,lead_id,job_id,invoice_version,invoice_updated_at,snapshot)
    values ('coastal-crest','sandbox','m','i','o','lead','job',3,now(),'{"status":"PAID"}');
    insert into public.crm_payments(company_state_id,id,lead_id,job_id,amount,method,provider,provider_payment_id,provider_invoice,received_at,origin,created_by,updated_by)
    select 'coastal-crest','sq-'||md5(jsonb_build_array('sandbox'::text,'m'::text,t.id)::text),'lead','job',t.amt,'Square','square',t.id,'i',now(),'square','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111'
    from (values ('d',40),('p',60)) as t(id,amt);`);
  const apply=(env,order,total,amount)=>db.query("select public.crm_square_apply_verified_refund('coastal-crest',$1,'m','p','i',$2,$3,$4) as v",[env,order,total,amount]);
  await assert.rejects(apply('production','o',6000,1500));await assert.rejects(apply('sandbox','wrong',6000,1500));await assert.rejects(apply('sandbox','o',5999,1500));
  assert.equal((await apply('sandbox','o',6000,1500)).rows[0].v.changed,true);
  assert.equal((await apply('sandbox','o',6000,1500)).rows[0].v.changed,false);
  assert.equal((await apply('sandbox','o',6000,500)).rows[0].v.changed,false);
  assert.equal((await db.query("select data->>'paidAmount' as net from crm_records where record_type='job' and id='job'")).rows.map(r=>Number(r.net))[0],85);
  assert.equal((await db.query("select count(*)::int as n from crm_payments")).rows[0].n,2);
  const priv=(await db.query("select has_function_privilege('authenticated','public.crm_square_apply_verified_refund(text,text,text,text,text,text,bigint,bigint)','execute') as rep, has_function_privilege('anon','public.crm_square_apply_verified_refund(text,text,text,text,text,text,bigint,bigint)','execute') as anon")).rows[0];
  assert.deepEqual(priv,{rep:false,anon:false});
 }finally{await db.close()}
});
