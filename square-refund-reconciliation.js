'use strict';
// Server only. A notification identifies a refund; none of its amounts are trusted.
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(x);
const requireMatch=x=>{if(!x)throw Error('refund_evidence_disagrees')};
const cents=m=>{requireMatch(m&&m.currency==='USD'&&Number.isSafeInteger(m.amount)&&m.amount>=0);return m.amount};
async function reconcile(refundId,{get,lookup,apply}){
  requireMatch(id(refundId));
  const read=async(kind,key,field)=>(await get('/'+kind+'/'+encodeURIComponent(key)))[field];
  const refund=await read('refunds',refundId,'refund');requireMatch(refund?.id===refundId&&id(refund.payment_id));
  if(refund.status!=='COMPLETED')return {status:'not_completed'};
  const binding=await lookup(refund.payment_id);if(!binding)return {status:'not_mapped'};
  requireMatch(id(binding.provider_invoice)&&binding.origin==='square'&&binding.provider_payment_id===refund.payment_id);
  const payment=await read('payments',refund.payment_id,'payment');
  requireMatch(payment?.id===refund.payment_id&&payment.status==='COMPLETED'&&id(payment.order_id)&&id(payment.location_id)&&payment.location_id===refund.location_id);
  const gross=cents(payment.total_money), total=cents(payment.refunded_money);
  requireMatch(gross>0&&total>0&&total<=gross&&Math.round(Number(binding.amount)*100)===gross&&(!payment.tip_money||cents(payment.tip_money)===0));
  const invoice=await read('invoices',binding.provider_invoice,'invoice');
  requireMatch(invoice?.id===binding.provider_invoice&&invoice.order_id===payment.order_id&&invoice.location_id===payment.location_id);
  const order=await read('orders',payment.order_id,'order');
  requireMatch(order?.id===payment.order_id&&order.location_id===payment.location_id&&order.tenders?.filter(t=>(t.payment_id||t.id)===payment.id).length===1);
  const ids=payment.refund_ids;requireMatch(Array.isArray(ids)&&ids.length>0&&ids.length<=100&&ids.every(id)&&new Set(ids).size===ids.length&&ids.includes(refundId));
  let verified=0;
  for(const rid of ids){
    const r=rid===refundId?refund:await read('refunds',rid,'refund');
    requireMatch(r?.id===rid&&r.payment_id===payment.id&&r.location_id===payment.location_id);
    if(r.status==='COMPLETED'){const value=cents(r.amount_money);requireMatch(value>0);verified+=value;}
    else requireMatch(['PENDING','FAILED','REJECTED'].includes(r.status));
  }
  requireMatch(Number.isSafeInteger(verified)&&verified===total);
  const receipt=await apply({p_payment:payment.id,p_invoice:invoice.id,p_order:order.id,p_gross:gross,p_refunded:total});
  requireMatch(receipt?.durable===true);return receipt;
}
function create({get,lookup,apply,warn=()=>{}}){
  let scan=null,busy=false,next=0;const deps={get,lookup,apply};
  // Recover missed notifications after sleep/restart. Keep the high watermark fixed
  // across pages; failures retry the same page. No POST to Square, ever.
  async function sweep(){
    const now=Date.now();if(busy||now<next)return;busy=true;
    try{
      scan||={since:new Date(now-48*3600000).toISOString(),until:new Date(now).toISOString(),cursor:''};
      const q=new URLSearchParams({begin_time:scan.since,end_time:scan.until,limit:'50'});
      if(scan.cursor)q.set('cursor',scan.cursor);
      const result=await get('/refunds?'+q);requireMatch(Array.isArray(result.refunds||[]));
      for(const r of result.refunds||[])if(r.status==='COMPLETED'){
        try{await reconcile(r.id,deps);}catch{warn('Square sandbox refund evidence deferred');}
      }
      if(result.cursor){scan.cursor=result.cursor;next=Date.now()+5000;}
      else{scan=null;next=Date.now()+300000;}
    }catch{next=Date.now()+60000;warn('Square sandbox refund scan deferred');}finally{busy=false;}
  }
  return {sweep,reconcile:id=>reconcile(id,deps)};
}
module.exports={create,reconcile};
