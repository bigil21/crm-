'use strict';

// Server/CLI only. No delete, update, retention sweep, or restore-to-CRM operation.
const crypto = require('node:crypto');
const fs = require('node:fs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { serviceHeaders } = require('../recovery-backup');
const { exchangeServiceAccountToken } = require('../google-drive');
const BUCKETS = ['crm-documents', 'quote-photos'];
const ROOT = 'jobcrest-media/v1/';
const PAGE = 100;
const digest = (data) => crypto.createHash('sha256').update(data).digest('hex');
const encode = encodeURIComponent;
const err = (s) => { throw new Error(s); };
function safePath(s) {
  return typeof s === 'string' && s.length > 0 && !s.includes('\\') && !s.includes('\0')
    && s.split('/').every(x => x && x !== '.' && x !== '..');
}
function objectId(x) { return digest(JSON.stringify([x.bucket,x.path,x.id,x.updated,x.etag,x.size])); }
function inventoryId(items) { return digest(JSON.stringify(items.map(objectId).sort())); }
function source(config, fetcher = fetch) {
  const url = new URL(config.origin);
  if (url.protocol !== 'https:' || url.hostname !== config.projectRef+'.supabase.co' ||
      url.origin !== config.origin || !config.secret || !config.company) err('Invalid source configuration');
  const headers = serviceHeaders(config.secret);
  async function call(path, options = {}) {
    const r = await fetcher(url.origin+path,{...options,redirect:'error',signal:AbortSignal.timeout(600000),
      headers:{...headers,...options.headers}});
    if (!r.ok) err('Source read refused: '+r.status);
    return r;
  }
  return {
    async list() {
      const objects = [], seen = new Set();
      for (const bucket of BUCKETS) {
        const dirs = [''];
        while (dirs.length) {
          const prefix=dirs.pop();
          let previous='';
          for (let offset=0;;) {
            const rows=await (await call('/storage/v1/object/list/'+bucket,{method:'POST',headers:{'Content-Type':'application/json'},
              body:JSON.stringify({prefix,offset,limit:PAGE,sortBy:{column:'name',order:'asc'}})})).json();
            if (!Array.isArray(rows)) err('Invalid storage inventory');
            if (!rows.length) break;
            for (const r of rows) {
              if (!safePath(r.name) || r.name.includes('/')) err('Invalid storage entry');
              const path=prefix ? prefix+'/'+r.name : r.name, identity=bucket+'/'+path;
              if(bucket===BUCKETS[0] && !prefix && (r.name!==config.company || r.id!==null))
                err('Unclassified object prefix in CRM bucket; refusing an incomplete or cross-company snapshot');
              if (seen.has(identity)) err('Duplicate storage entry; retry inventory');
              seen.add(identity);
              if (r.id === null && r.metadata === null) { dirs.push(path); continue; }
              if (!r.id || !r.updated_at || !Number.isSafeInteger(r.metadata?.size) || r.metadata.size<0) err('Incomplete storage metadata');
              objects.push({bucket,path,id:r.id,updated:r.updated_at,etag:String(r.metadata.eTag || r.metadata.etag || '').replaceAll('"',''),
                size:r.metadata.size, type:r.metadata.mimetype || 'application/octet-stream'});
            }
            if (previous===rows.at(-1).name) err('Storage page did not advance');
            previous=rows.at(-1).name; offset+=rows.length;
          }
        }
      }
      return objects;
    },
    async open(x) {
      if (!BUCKETS.includes(x.bucket) || !safePath(x.path) || (x.bucket===BUCKETS[0] && !x.path.startsWith(config.company+'/'))) err('Invalid source object');
      const r=await call('/storage/v1/object/authenticated/'+x.bucket+'/'+x.path.split('/').map(encode).join('/'));
      return Readable.fromWeb(r.body);
    },
    async estimatePaths() {
      const qp=new URLSearchParams({select:'path:data->>storagePath',company_state_id:'eq.'+config.company,record_type:'eq.document',
        'data->>estimateId':'neq.','data->>storagePath':'not.is.null',order:'id.asc'});
      const paths=new Set();
      for(let start=0;;) {
        qp.set('offset',String(start)); qp.set('limit',String(PAGE));
        const rows=await (await call('/rest/v1/crm_records?'+qp)).json();
        if(!Array.isArray(rows)) err('Invalid estimate document index');
        if(!rows.length) break;
        for(const r of rows) if(r.path) paths.add(r.path);
        start+=rows.length;
      }
      return paths;
    },
  };
}

function gcsVault(cfg, token, fetcher=fetch) {
  if (typeof cfg.bucket!=='string' || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(cfg.bucket) || !/^\d+$/.test(cfg.projectNumber) ||
      !/^projects\/[\w-]+\/locations\/[\w-]+\/keyRings\/[\w-]+\/cryptoKeys\/[\w-]+$/.test(cfg.kmsKey)) err('Invalid vault configuration');
  const bucket='https://storage.googleapis.com/storage/v1/b/'+encode(cfg.bucket);
  async function call(url,options={}) {
    return fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(600000),
      headers:{...options.headers,Authorization:'Bearer '+await token()}});
  }
  const objectUrl=k => {
    if(!k.startsWith(ROOT) || !safePath(k)) err('Invalid vault path');
    return bucket+'/o/'+encode(k);
  };
  function checkObject(o) {
    if(o.bucket!==cfg.bucket || !(o.kmsKeyName===cfg.kmsKey || o.kmsKeyName?.startsWith(cfg.kmsKey+'/cryptoKeyVersions/')) ||
       !/^\d+$/.test(o.generation) || !o.md5Hash) err('Vault object encryption or integrity metadata missing');
    return o;
  }
  async function meta(k) {
    const r=await call(objectUrl(k)); if(r.status===404) return null;
    if(!r.ok) err('Vault metadata read refused: '+r.status); return checkObject(await r.json());
  }
  async function get(k,generation) {
    if(!/^\d+$/.test(generation)) err('Missing immutable generation');
    const r=await call(objectUrl(k)+'?alt=media&generation='+generation);
    if(!r.ok) err('Vault restore refused: '+r.status); return Readable.fromWeb(r.body);
  }
  async function create(k,body) {
    objectUrl(k);
    const qp=new URLSearchParams({uploadType:'media',name:k,ifGenerationMatch:'0',kmsKeyName:cfg.kmsKey});
    const r=await call('https://storage.googleapis.com/upload/storage/v1/b/'+encode(cfg.bucket)+'/o?'+qp,
      {method:'POST',headers:{'Content-Type':'application/octet-stream'},body,duplex:'half'});
    if(r.status===412) return null; // concurrent writer; never overwrite
    if(!r.ok) err('Vault insert refused: '+r.status);
    return checkObject(await r.json());
  }
  return {meta,get,create,async preflight(){
    const r=await call(bucket); if(!r.ok) err('Vault preflight refused: '+r.status);
    const b=await r.json();
    if(b.name!==cfg.bucket || String(b.projectNumber)!==cfg.projectNumber || b.encryption?.defaultKmsKeyName!==cfg.kmsKey ||
      b.iamConfiguration?.publicAccessPrevention!=='enforced' || !b.iamConfiguration?.uniformBucketLevelAccess?.enabled || b.versioning?.enabled!==true ||
      b.lifecycle?.rule?.some(x=>x.action?.type==='Delete')) err('Vault owner, encryption, privacy or retention mismatch');
  }};
}

function meter() {
  const sha=crypto.createHash('sha256'), md=crypto.createHash('md5'); let size=0, prefix=Buffer.alloc(0);
  const stream=new Transform({transform(buf,_,cb){size+=buf.length;sha.update(buf);md.update(buf);
    if(prefix.length<32) prefix=Buffer.concat([prefix,buf.subarray(0,32-prefix.length)]);
    cb(null,buf);}});
  return {stream, finish:()=>({sha256:sha.digest('hex'),md5:md.digest('base64'),size,prefix})};
}
async function measure(stream) {
  const m=meter(); await pipeline(stream,m.stream,async function(s){ for await(const _ of s){} }); return m.finish();
}
async function readJson(v,key) {
  const m=await v.meta(key); if(!m)return null;
  const parts=[]; for await(const b of await v.get(key,m.generation)) parts.push(b);
  const bytes=Buffer.concat(parts);
  if(crypto.createHash('md5').update(bytes).digest('base64')!==m.md5Hash) err('Manifest integrity check failed');
  return JSON.parse(bytes);
}
async function putJson(v,key,value) {
  const body=Buffer.from(JSON.stringify(value));
  const m=await v.create(key,body);
  if(m && m.md5Hash!==crypto.createHash('md5').update(body).digest('base64')) err('Vault metadata checksum mismatch');
  return Boolean(m);
}
async function archiveOne(src,v,x) {
  const id=objectId(x), key=ROOT+'objects/'+id, receiptKey=ROOT+'receipts/'+id+'.json';
  const prior=await readJson(v,receiptKey);
  let obj=await v.meta(key);
  if(prior && obj && prior.generation===obj.generation && prior.md5===obj.md5Hash && Number(obj.size)===x.size &&
    prior.id===id && /^[a-f0-9]{64}$/.test(prior.sha256)) return prior;
  if(prior) err('Immutable receipt does not match archived file');
  const input=await src.open(x); let check;
  if(obj) check=await measure(input);
  else {
    const m=meter(), pump=pipeline(input,m.stream); pump.catch(()=>{});
    try {
      obj=await v.create(key,m.stream);
      // Some transports can return a precondition response before reading the body.
      if(!obj) { m.stream.resume(); await pump; obj=await v.meta(key); } else await pump;
      check=m.finish();
    } catch(e){input.destroy();m.stream.destroy();await pump.catch(()=>{});throw e;}
  }
  if(!obj || Number(obj.size)!==x.size || check.size!==x.size || obj.md5Hash!==check.md5 ||
    (/^[a-f0-9]{32}$/i.test(x.etag) && Buffer.from(check.md5,'base64').toString('hex')!==x.etag.toLowerCase())) err('Transferred bytes differ from source');
  const receipt={id,generation:obj.generation,sha256:check.sha256,md5:check.md5};
  if(!await putJson(v,receiptKey,receipt) && JSON.stringify(await readJson(v,receiptKey))!==JSON.stringify(receipt)) err('Conflicting vault receipt');
  return receipt;
}
function assertRestored(x,result) {
  if(result.size!==x.size || result.sha256!==x.sha256 || result.md5!==x.md5) err('Restored file differs from backup');
}
function isPhoto(head) {
  return head[0]===255 && head[1]===216 && head[2]===255 || head.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) ||
    head.subarray(0,4).toString()==='RIFF' && head.subarray(8,12).toString()==='WEBP' || head.subarray(0,3).toString()==='GIF';
}
async function restoreDrill(v,entries,estimates) {
  const photo=entries.find(x=>/\.(?:jpe?g|png|webp|gif)$/i.test(x.path) && !x.path.endsWith('/preview.jpg'));
  const pdf=entries.find(x=>x.bucket===BUCKETS[0] && estimates.has(x.path) && /\.pdf$/i.test(x.path));
  if(!photo || !pdf) err('No original photo or CRM-linked estimate PDF available for the restore drill');
  return verifySamples(v,photo,pdf);
}
async function verifySamples(v,photo,pdf) {
  for(const x of [photo,pdf]) {
    const result=await measure(await v.get(ROOT+'objects/'+x.id,x.generation)); assertRestored(x,result);
    if(x===photo ? !isPhoto(result.prefix) : !result.prefix.subarray(0,5).equals(Buffer.from('%PDF-'))) err('Restored file type does not match');
  }
  return {photo:photo.id,estimatePdf:pdf.id};
}
function validatedManifest(m,day) {
  if(m?.version!==1 || m.day!==day || !Array.isArray(m.entries) || !m.entries.length)
    err('Invalid daily manifest');
  const ids=new Set();
  for(const e of m.entries) {
    if(!e || !BUCKETS.includes(e.bucket) || !safePath(e.path) || !/^[a-f0-9]{64}$/.test(e.id)
      || ids.has(e.id) || !/^\d+$/.test(e.generation) || !Number.isSafeInteger(e.size) || e.size<0
      || !/^[a-f0-9]{64}$/.test(e.sha256) || !/^[A-Za-z0-9+/]{22}==$/.test(e.md5)) err('Invalid archived file entry');
    ids.add(e.id);
  }
  if(digest(JSON.stringify([...ids].sort()))!==m.inventory) err('Incomplete daily inventory');
  const photo=m.entries.find(e=>e.id===m.drill?.photo), pdf=m.entries.find(e=>e.id===m.drill?.estimatePdf);
  if(!photo || !pdf || photo===pdf || photo.path.endsWith('/preview.jpg') || pdf.bucket!==BUCKETS[0] || !/\.pdf$/i.test(pdf.path))
    err('Invalid restore samples in daily manifest');
  return {photo,pdf};
}
async function verifyDay(v,day) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)) err('Invalid backup day');
  await v.preflight();
  const m=await readJson(v,ROOT+'days/'+day+'.json');
  const {photo,pdf}=validatedManifest(m,day);
  await verifySamples(v,photo,pdf); // independent vault download; no CRM, provider or source credentials
  return {day,objects:m.entries.length,verifiedRestores:2,drill:m.drill};
}
async function run({src,vault,day=new Date().toISOString().slice(0,10)}) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)) err('Invalid backup day');
  await vault.preflight(); const key=ROOT+'days/'+day+'.json';
  const previous=await readJson(vault,key);
  if(previous) {
    const {photo,pdf}=validatedManifest(previous,day);
    await verifySamples(vault,photo,pdf);
    return {alreadyComplete:true,count:previous.entries.length,verifiedRestores:2};
  }
  const items=await src.list(), initial=inventoryId(items);
  if(!items.length) err('No source files; refusing empty backup');
  const entries=[]; for(const x of items) entries.push({...x,...await archiveOne(src,vault,x)});
  const drill=await restoreDrill(vault,entries,await src.estimatePaths());
  if(inventoryId(await src.list())!==initial) err('Source changed during backup; retry without deleting archived versions');
  const manifest={version:1,day,inventory:initial,drill,entries};
  if(!await putJson(vault,key,manifest)) {
    const winner=await readJson(vault,key);
    const {photo,pdf}=validatedManifest(winner,day);
    if(winner.inventory!==initial) err('Concurrent daily snapshot differs');
    await verifySamples(vault,photo,pdf);
  }
  return {count:items.length,bytes:items.reduce((s,x)=>s+x.size,0),verifiedRestores:2};
}
async function restoreFile(v,day,id,output) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^[a-f0-9]{64}$/.test(id)) err('Invalid snapshot or object ID');
  await v.preflight();
  const m=await readJson(v,ROOT+'days/'+day+'.json'); validatedManifest(m,day);
  const x=m.entries.find(e=>e.id===id);
  if(!x) err('File not present in committed backup');
  const met=meter(), input=await v.get(ROOT+'objects/'+id,x.generation);
  let handle;
  try {handle=await fs.promises.open(output,'wx',0o600);} catch(e){input.destroy();throw e;}
  // A failure leaves an explicitly unverified file; never delete or overwrite evidence.
  await pipeline(input,met.stream,handle.createWriteStream()); assertRestored(x,met.finish());
}
function configuredVault(env=process.env) {
  const cfg={bucket:env.FILE_VAULT_BUCKET,projectNumber:env.FILE_VAULT_PROJECT_NUMBER,kmsKey:env.FILE_VAULT_KMS_KEY};
  const credentialPath=env.FILE_VAULT_WIF_CONFIG || env.GOOGLE_APPLICATION_CREDENTIALS;
  if(!/^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/.test(env.FILE_VAULT_SERVICE_ACCOUNT||'') || !credentialPath) err('Missing dedicated vault identity');
  // Require a real federation config. Never fall back to an unrelated default or a private key.
  const wif=JSON.parse(fs.readFileSync(credentialPath,'utf8'));
  if(wif.type!=='external_account'||!wif.service_account_impersonation_url) err('Vault workload identity federation required');
  const account={clientEmail:env.FILE_VAULT_SERVICE_ACCOUNT,externalAccountCredentials:wif,
    scopes:['https://www.googleapis.com/auth/devstorage.read_write']};
  let cached='',validTo=0;
  const token=async()=>{if(Date.now()>=validTo){cached=await exchangeServiceAccountToken(fetch,account);validTo=Date.now()+45*60000;}return cached;};
  return gcsVault(cfg,token);
}
function configured(env=process.env) {
  if(env.FILE_VAULT_ENABLED!=='true')return null;
  const projectRef=env.FILE_VAULT_SOURCE_REF,origin=env.SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL;
  if(!/^[a-z0-9]{20}$/.test(projectRef||'')) err('Missing vault source pin');
  return {src:source({origin,projectRef,company:env.SUPABASE_STATE_ID||'coastal-crest',secret:env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY}),vault:configuredVault(env)};
}
// Same always-on service as the existing database backup; bounded memory, one file in flight.
// Cross-instance runs can only create new generations; a daily marker is published last.
function start(env=process.env) {
  if(env.FILE_VAULT_ENABLED!=='true')return null;
  let busy=false, complete='', stopped=false;
  const tick=async()=>{
    const now=new Date(), day=now.toISOString().slice(0,10);
    if(stopped||busy||complete===day||now.getUTCHours()<6)return;
    busy=true;try{const result=await run({...configured(env),day}); complete=day;
      console.log('Media vault verified',day,JSON.stringify(result));}
    catch(e){console.error('Media vault incomplete; will retry',day,String(e.message).replace(/https?:\/\/\S+/g,'[endpoint]').slice(0,180));}
    finally{busy=false;}
  };
  const timer=setInterval(tick,30*60000);timer.unref();const first=setTimeout(tick,60000);first.unref();
  return ()=>{stopped=true;clearInterval(timer);clearTimeout(first);};
}
module.exports={ROOT,BUCKETS,source,gcsVault,run,restoreFile,verifyDay,configured,configuredVault,start};
if(require.main===module) {
  (async()=>{
    const [cmd,day,id,output]=process.argv.slice(2);
    if(cmd==='backup') {
      const conf=configured(); if(!conf)err('Vault is not enabled');
      console.log(JSON.stringify(await run(conf)));
    }
    else if(cmd==='inspect' && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
      const vault=configuredVault();await vault.preflight();const m=await readJson(vault,ROOT+'days/'+day+'.json');
      validatedManifest(m,day);
      console.log(JSON.stringify({day:m.day,objects:m.entries.length,drill:m.drill}));
    } else if(cmd==='verify' && day) {console.log(JSON.stringify(await verifyDay(configuredVault(),day)));}
    else if(cmd==='restore' && day && id && output) {await restoreFile(configuredVault(),day,id,output);console.log('Verified restored file; original unchanged');}
    else err('Expected backup, inspect/verify YYYY-MM-DD, or restore YYYY-MM-DD object-id new-output-path');
  })().catch(e=>{console.error(e.message);process.exitCode=1;});
}
