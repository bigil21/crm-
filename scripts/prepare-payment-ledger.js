'use strict';
// Server-only rollout tool. Default is read-only; it never asks Square to change anything.
const {readSnapshot} = require('../square-payment-worker.js');
async function prepare({list,provider,merchant,environment}) {
  const estimates=await list();
  const links=new Map();
  for (const {data,lead_id,job_id} of estimates) {
    if (!data?.squareInvoiceId) continue;
    const invoice=data.squareInvoiceId, order=data.squareOrderId;
    const prior=links.get(invoice);
    if (!order || (prior && (prior.order!==order || prior.job!==job_id || prior.lead!==lead_id))) throw Error('Conflicting Square invoice links; no cutover attempted.');
    links.set(invoice,{order,lead:lead_id,job:job_id});
  }
  const history=[];
  if (links.size) {
    const identity=await provider('/merchants/'+encodeURIComponent(merchant));
    if (identity?.merchant?.id!==merchant) throw Error('Square merchant does not match configuration.');
  }
  for(const [invoiceId,{order}] of links) {
    const snap=await readSnapshot({get:provider,invoiceId,expectedOrderId:order,withTenders:true});
    history.push({invoiceId,orderId:order,version:snap.version,paidAmount:snap.paidAmount,tenders:snap.tenders,merchant,environment});
  }
  return history;
}
async function main() {
  const {SUPABASE_URL,SUPABASE_SECRET_KEY,SUPABASE_SERVICE_ROLE_KEY,SUPABASE_STATE_ID='coastal-crest',SQUARE_ACCESS_TOKEN,SQUARE_MERCHANT_ID,SQUARE_ENVIRONMENT} = process.env;
  const key=SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !SUPABASE_URL || !['sandbox','production'].includes(SQUARE_ENVIRONMENT)) throw Error('Set server database credentials and the explicit Square environment.');
  const base=new URL(SUPABASE_URL); if(base.protocol!=='https:' && !['localhost','127.0.0.1'].includes(base.hostname))throw Error('Use TLS.');
  const api=async(path,body)=>{
    const res=await fetch(new URL(path,base),{method:body?'POST':'GET',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000),redirect:'error'});
    if(!res.ok) throw Error('Database request failed ('+res.status+'); no successful cutover confirmed.');
    return res.json();
  };
  const list=async()=>{
    const rows=[]; let last='';
    for(;;){
      const q=new URLSearchParams({company_state_id:'eq.'+SUPABASE_STATE_ID,record_type:'eq.estimate',deleted_at:'is.null',select:'id,lead_id,job_id,data->squareInvoiceId,data->squareOrderId',order:'id.asc',limit:'250'});
      if(last)q.set('id','gt.'+last);
      const page=await api('/rest/v1/crm_records?'+q);
      if(!Array.isArray(page))throw Error('Invalid database response.');
      if(!page.length)return rows;
      if(!page.at(-1).id || page.at(-1).id===last)throw Error('Estimate cursor stalled.');
      last=page.at(-1).id;
      rows.push(...page.map(({id,lead_id,job_id,squareInvoiceId,squareOrderId})=>({id,lead_id,job_id,data:{squareInvoiceId,squareOrderId}})));
    }
  };
  const host=SQUARE_ENVIRONMENT==='production'?'connect.squareup.com':'connect.squareupsandbox.com';
  const provider=async p=>{
    if(!SQUARE_ACCESS_TOKEN || !SQUARE_MERCHANT_ID)throw Error('Square server credentials are required for linked invoices.');
    const res=await fetch('https://'+host+'/v2'+p,{headers:{Authorization:'Bearer '+SQUARE_ACCESS_TOKEN,'Square-Version':'2024-01-18'},signal:AbortSignal.timeout(20000),redirect:'error'});
    if(!res.ok)throw Error('Square read failed ('+res.status+').');return res.json();
  };
  const history=await prepare({list,provider,merchant:SQUARE_MERCHANT_ID,environment:SQUARE_ENVIRONMENT});
  console.log('Verified',history.length,'linked invoices and',history.reduce((n,i)=>n+i.tenders.length,0),'captures.');
  if (process.argv.includes('--activate')) {
    const receipt=await api('/rest/v1/rpc/crm_activate_payment_ledger',{p_history:history});
    if(!receipt?.alreadyActive && !(receipt?.active===true && receipt.before===receipt.after))throw Error('No matching cutover receipt.');
    console.log(receipt.alreadyActive?'Ledger was already active.':'Ledger activated; collected total reconciled.');
  } else console.log('Read-only preparation finished. No changes applied.');
}
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={prepare};
