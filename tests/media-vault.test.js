'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {Readable} = require('node:stream');
const fs=require('node:fs/promises'), os=require('node:os'), path=require('node:path'), crypto=require('node:crypto');
const {PDFDocument}=require('@cantoo/pdf-lib');
const {ROOT,source,gcsVault,run,restoreFile,configured,configuredVault,start}=require('../scripts/media-vault');
const hash=(algo,b,enc)=>crypto.createHash(algo).update(b).digest(enc);
const bytes=async body=>{ if(Buffer.isBuffer(body))return body;const parts=[]; for await(const b of body)parts.push(b);return Buffer.concat(parts); };
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZqcAAAAAASUVORK5CYII=','base64');
async function setup(){
  const pdf=await PDFDocument.create();pdf.addPage().drawText('QA estimate 1001 - roofing');
  const p=Buffer.from(await pdf.save()), files=[['crm-documents','coastal-crest/deleted/roof.png',png],['crm-documents','coastal-crest/job/estimate.pdf',p],
    ['quote-photos','quote/incoming.png',png],['crm-documents','coastal-crest/unlinked/memo',Buffer.from('unlinked')]];
  const items=files.map(([bucket,path,b],i)=>({bucket,path,id:String(i+1),size:b.length,updated:'v1',etag:hash('md5',b,'hex')}));
  const src={list:async()=>items.map(x=>({...x})),open:async x=>Readable.from([files.find(f=>f[1]===x.path)[2]]),
    estimatePaths:async()=>new Set([files[1][1]])};
  // Encrypted synthetic object store. Only this fake KMS holds the test key.
  const key=crypto.randomBytes(32), store=new Map();
  const v={preflight:async()=>{},meta:async k=>store.get(k)?.meta||null,
    async create(k,body){const b=await bytes(body);if(store.has(k))return null;
      const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key,iv),cipher=Buffer.concat([c.update(b),c.final()]);
      const meta={generation:String(store.size+1),md5Hash:hash('md5',b,'base64'),size:String(b.length)};
      store.set(k,{iv,cipher,tag:c.getAuthTag(),meta});return meta;},
    async get(k,g){const entry=store.get(k);assert.equal(g,entry.meta.generation);
      const c=crypto.createDecipheriv('aes-256-gcm',key,entry.iv); c.setAuthTag(entry.tag);
      return Readable.from([Buffer.concat([c.update(entry.cipher),c.final()])]);}};
  return {v,src,files,items,store,p};
}
test('daily snapshot restores a deleted-document photo and CRM-linked estimate PDF to new files without touching originals',async()=>{
  const {src,v,files,store,p}=await setup(), day='2026-11-24';
  assert.deepEqual(await run({src,vault:v,day}),{count:4,bytes:files.reduce((s,f)=>s+f[2].length,0),verifiedRestores:2});
  const marker=ROOT+'days/'+day+'.json',m=JSON.parse(await bytes(await v.get(marker,store.get(marker).meta.generation)));
  assert.equal(m.entries.length,4); assert.ok(![...store.keys()].some(k=>k.includes('roof')||k.includes('estimate')));
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'jobcrest-vault-drill-'));  // retain outputs; no cleanup or deletes
  const photo=path.join(folder,'restored.png'), estimate=path.join(folder,'restored-estimate.pdf');
  await restoreFile(v,day,m.drill.photo,photo);await restoreFile(v,day,m.drill.estimatePdf,estimate);
  assert.deepEqual(await fs.readFile(photo),png); assert.deepEqual(await fs.readFile(estimate),p);
  assert.equal((await PDFDocument.load(await fs.readFile(estimate))).getPageCount(),1);
  await assert.rejects(restoreFile(v,day,m.drill.estimatePdf,photo),{code:'EEXIST'});assert.deepEqual(await fs.readFile(photo),png);
  assert.equal((await run({src,vault:v,day})).alreadyComplete,true);
  const count=store.size;src.open=async()=>{throw Error('unchanged source should not be downloaded again');};
  await run({src,vault:v,day:'2026-11-25'});assert.equal(store.size,count+1);
  console.log('Retained synthetic restore evidence:',folder);
});
test('a second version is appended and an object later removed from inventory remains restorable',async()=>{
  const {src,v,store,files,items}=await setup();
  await run({src,vault:v,day:'2026-11-24'});const originals=[...store.keys()];
  files[3][2]=Buffer.from('newer'); Object.assign(items[3],{updated:'v2',size:5,etag:hash('md5',files[3][2],'hex')});
  await run({src,vault:v,day:'2026-11-25'}); items.pop(); await run({src,vault:v,day:'2026-11-26'});
  assert.ok(originals.every(x=>store.has(x))); assert.equal([...store.keys()].filter(x=>x.includes('/objects/')).length,5);
});
test('a failed restore, a changed inventory, and a denied source never publish a success marker',async()=>{
  for(const failure of ['corruption','inventory','refused','estimate']){
    const {src,v,store}=await setup();let n=0;
    if(failure==='corruption'){const get=v.get;v.get=(k,g)=>k.includes('/objects/')?Readable.from([Buffer.from('bad')]):get(k,g);}
    if(failure==='inventory'){const list=src.list;src.list=async()=>{const rows=await list();return ++n===2?rows.slice(1):rows;};}
    if(failure==='refused')src.open=async()=>{throw Error('denied');};
    if(failure==='estimate')src.estimatePaths=async()=>new Set();
    await assert.rejects(run({src,vault:v,day:'2026-11-24'})); assert.ok(![...store.keys()].some(k=>k.includes('/days/')));
  }
});
test('walks both buckets including truncated pages, nested folders and unlinked files; never uses customer-record visibility',async()=>{
  const calls=[];const src=source({origin:'https://example.supabase.co',projectRef:'example',company:'coastal-crest',secret:'synthetic'},async(u,o)=>{
    assert.equal(o.method,'POST');let {prefix,offset}=JSON.parse(o.body);const bucket=u.split('/').at(-1);calls.push({bucket,prefix,offset});
    const data=bucket==='crm-documents' && !prefix?[{name:'coastal-crest',id:null,metadata:null}]:prefix==='coastal-crest'?[{name:'deleted',id:null,metadata:null}]:prefix==='coastal-crest/deleted'?[1,2].map(i=>({name:i+'.jpg',id:i,updated_at:'date',metadata:{size:i}})):[];
    return Response.json(data.slice(offset,offset+1));});
  assert.equal((await src.list()).length,2);assert.ok(calls.some(c=>c.bucket==='quote-photos'));assert.ok(calls.some(c=>c.offset===2));
});
test('cloud adapter rejects wrong owner, key, public access and delete lifecycle; every write is create-only with the named KMS key',async()=>{
  const cfg={bucket:'private-qa-vault',projectNumber:'1234',kmsKey:'projects/company/locations/us/keyRings/backup/cryptoKeys/media'};
  const good={name:cfg.bucket,projectNumber:'1234',versioning:{enabled:true},encryption:{defaultKmsKeyName:cfg.kmsKey},iamConfiguration:{publicAccessPrevention:'enforced',uniformBucketLevelAccess:{enabled:true}}};
  for(const change of [{projectNumber:'999'},{encryption:{}},{iamConfiguration:{}},{versioning:{}},{lifecycle:{rule:[{action:{type:'Delete'}}]}}]){
    await assert.rejects(gcsVault(cfg,async()=>'synthetic',async()=>Response.json({...good,...change})).preflight());
  }
  const calls=[]; const v=gcsVault(cfg,async()=>'synthetic',async(u,o)=>{calls.push([u,o.method]);return o.method==='POST'?new Response(null,{status:412}):Response.json(good);});
  await v.preflight();assert.equal(await v.create(ROOT+'objects/test',Buffer.from('x')),null);
  const u=new URL(calls[1][0]);assert.equal(u.searchParams.get('ifGenerationMatch'),'0');assert.equal(u.searchParams.get('kmsKeyName'),cfg.kmsKey);
  assert.equal(start({}),null);assert.equal(configured({}),null);
});
test('an unexpected prefix stops the inventory before any file contents can be read',async()=>{
  let calls=0;
  const s=source({origin:'https://example.supabase.co',projectRef:'example',company:'coastal-crest',secret:'synthetic'},async(u,o)=>{
    calls++;assert.equal(o.method,'POST');return Response.json([{name:'another-company',id:null,metadata:null}]);});
  await assert.rejects(s.list(),/Unclassified/);assert.equal(calls,1);
});
test('disaster recovery can configure a reader without a running CRM, database credentials, or the daily scheduler',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'jobcrest-vault-config-'));
  const fixture=path.join(folder,'wif-test.json');
  await fs.writeFile(fixture,JSON.stringify({type:'external_account',service_account_impersonation_url:'https://iamcredentials.googleapis.com/test-only'}),{flag:'wx'});
  const env={FILE_VAULT_BUCKET:'private-qa-vault',FILE_VAULT_PROJECT_NUMBER:'1234',FILE_VAULT_KMS_KEY:'projects/demo/locations/us/keyRings/backup/cryptoKeys/media',
    FILE_VAULT_SERVICE_ACCOUNT:'reader@demo.iam.gserviceaccount.com',GOOGLE_APPLICATION_CREDENTIALS:fixture};
  assert.equal(configured(env),null);assert.equal(typeof configuredVault(env).get,'function');
  assert.throws(()=>configured({...env,FILE_VAULT_ENABLED:'true'}),/source pin/);
  const wrong=path.join(folder,'not-wif.json');await fs.writeFile(wrong,'{"type":"authorized_user"}',{flag:'wx'});
  assert.throws(()=>configuredVault({...env,GOOGLE_APPLICATION_CREDENTIALS:wrong}),/federation required/);
});
