'use strict';
// Staging-only preload: node --require ./square-staging-guard.cjs server.js.
// No secret values are printed. QA tests import the functions without starting the CRM.
const branch = 'qa/square-realtime-staging';
const prefix = 'jobcrest-square-staging';
const forbidden = new Set(['vtiespnuwtxwiegruzrx','ixksmfiektzsunmmwejz']);
const requireThat=(ok,message)=>{if(!ok)throw Error('Staging isolation: '+message);};
function configure(e) {
  requireThat(e.RENDER_GIT_BRANCH===branch,'wrong git branch');
  const ref=e.JOBCREST_STAGING_PROJECT_REF;
  requireThat(/^[a-z]{20}$/.test(ref||'')&&!forbidden.has(ref),'new dedicated project reference required');
  const db='https://'+ref+'.supabase.co', origin=e.RENDER_EXTERNAL_URL;
  requireThat(new RegExp('^https://'+prefix+'(?:-[a-z0-9]+)?\\.onrender\\.com$').test(origin||''),'dedicated staging service URL required');
  requireThat(e.SUPABASE_URL===db,'database origin mismatch');
  requireThat(!e.NEXT_PUBLIC_SUPABASE_URL||e.NEXT_PUBLIC_SUPABASE_URL===db,'secondary database origin mismatch');
  requireThat(e.SQUARE_ENVIRONMENT==='sandbox','Square Sandbox required');
  requireThat(e.AUTH_REQUIRED==='true'&&e.ALLOW_LOCAL_DEMO==='false'&&e.SUPABASE_SYNC_ENABLED==='true','real auth and database sync are required');
  requireThat(e.CRM_STAGING_ACCESS!=='true','local auth override not allowed');
  requireThat(e.SUPABASE_ANON_KEY?.startsWith('sb_publishable_'),'dedicated public key required');
  requireThat(!e.CRM_PUBLIC_ORIGIN||e.CRM_PUBLIC_ORIGIN===origin,'public origin mismatch');
  const webhook=origin+'/webhooks/square';
  requireThat(!e.SQUARE_WEBHOOK_URL||e.SQUARE_WEBHOOK_URL===webhook,'webhook origin mismatch');
  if(e.SQUARE_PAYMENT_WORKER_ENABLED==='true'){
    requireThat(e.SUPABASE_SECRET_KEY?.startsWith('sb_secret_') && e.SQUARE_ACCESS_TOKEN && e.SQUARE_WEBHOOK_SIGNATURE_KEY && e.SQUARE_MERCHANT_ID,'staging worker credentials missing');
  }
  for(const k of Object.keys(e)) {
    requireThat(!e[k] || !/^(GOOGLE_|ZOHO_|TWILIO_|R2_|AWS_|S3_|WEBSITE_INTAKE_SECRET$|SUPABASE_SERVICE_ROLE_KEY$)/.test(k),'unrelated integration configured: '+k);
  }
  Object.assign(e,{CRM_SKIP_ENV_FILES:'true',CRM_PUBLIC_ORIGIN:origin,SQUARE_WEBHOOK_URL:webhook,DEFAULT_AUTH_ROLE:'viewer',FILE_VAULT_ENABLED:'false'});
  return new Set([db,'https://connect.squareupsandbox.com']);
}
function guardedFetch(origins,transport) {
  return function (input,init){
    const raw=typeof input==='string'||input instanceof URL?input:input.url;
    const u=new URL(raw);
    requireThat(origins.has(u.origin)&&!u.username&&!u.password,'outbound origin blocked');
    // Check redirect hops by disallowing them, not by trusting only the original URL.
    return transport(input,{...init,redirect:'error'});
  };
}
if(process.env.NODE_OPTIONS?.includes('square-staging-guard') || module.isPreloading){
  const origins=configure(process.env);
  globalThis.fetch=guardedFetch(origins,globalThis.fetch.bind(globalThis));
}
module.exports={configure,guardedFetch};
