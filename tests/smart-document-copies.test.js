const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PGlite } = require('@electric-sql/pglite');
const migration = fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261012052521_smart_document_completed_copies.sql'),'utf8');
const actor='00000000-0000-4000-8000-000000000001';

test('completion publishes a separate copy in the same company or job category, retaining the original bytes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.crm_records(company_state_id text not null,record_type text not null,id text not null,
        lead_id text,job_id text,owner_id uuid,data jsonb not null default '{}',version bigint default 1,
        updated_at timestamptz default now(),updated_by uuid,deleted_at timestamptz,
        primary key(company_state_id,record_type,id));`);
    await db.exec(migration);
    for (const [id,lead,job,categoryId,category] of [['company-template','company-documents',null,'','Sales Reference'],['job-template','lead-1','job-2','roofing','Roofing']]) {
      const original={name:'Sales Sheet.pdf',storagePath:`coastal-crest/${id}/original.pdf`,categoryId,category,leadId:lead,jobId:job};
      await db.query("insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,owner_id,data) values('coastal-crest','document',$1,$2,$3,$4,$5::jsonb)",[id,lead,job,actor,JSON.stringify(original)]);
      const smart={status:'completed',fields:[{id:'name',label:'Client name',type:'text'}],responses:{name:'Test Client'},completedFile:{name:'Sales Sheet - Completed.pdf',storagePath:`coastal-crest/${id}/smart/filled.pdf`,size:100,type:'application/pdf'}};
      const save=async value=>(await db.query('select public.crm_save_smart_document($1,$2,$3::jsonb,$4::uuid) result',['coastal-crest',id,JSON.stringify(value),actor])).rows[0].result;
      await db.exec('set role authenticated');
      await assert.rejects(save(smart),error=>error.code==='42501');
      await db.exec('reset role; set role service_role');
      const result=await save(smart);
      assert.notEqual(result.completed_document_id,id);
      assert.equal(result.completed_document.category,category);
      assert.equal(result.completed_document.categoryId,categoryId);
      assert.equal(result.completed_document.storagePath,smart.completedFile.storagePath);
      assert.equal(result.completed_document.smartDocument.responses.name,'Test Client');
      assert.equal(result.completed_document.sourceDocumentId,id);
      assert.equal((await save(smart)).completed_document_id,result.completed_document_id,'same completed file reuses its copy');
      await db.exec('reset role');
      const rows=(await db.query("select * from public.crm_records where data->>'sourceDocumentId'=$1",[id])).rows;
      assert.equal(rows.length,1);
      assert.equal(rows[0].lead_id,lead);assert.equal(rows[0].job_id,job);assert.equal(rows[0].owner_id,actor);
      assert.equal((await db.query("select data from public.crm_records where id=$1",[id])).rows[0].data.storagePath,original.storagePath);
      const template=(await db.query("select data from public.crm_records where id=$1",[id])).rows[0].data.smartDocument;
      assert.equal(template.status,'template');
      assert.deepEqual(template.responses,{});
      await db.exec('set role service_role');
      smart.completedFile.storagePath=`coastal-crest/${id}/smart/second.pdf`;
      assert.notEqual((await save(smart)).completed_document_id,result.completed_document_id);
      await db.exec('reset role');
      assert.equal((await db.query("select count(*)::integer n from public.crm_records where data->>'sourceDocumentId'=$1",[id])).rows[0].n,2);
      await db.exec('set role service_role');
      await assert.rejects(save({...smart,completedFile:{...smart.completedFile,storagePath:'other-company/file.pdf'}}),/invalid_smart_document_completion/);
      const draft=await save({...smart,status:'draft'});
      assert.equal(draft.completed_document_id,null);
      await db.exec('reset role');
      assert.equal((await db.query("select count(*)::integer n from public.crm_records where data->>'sourceDocumentId'=$1",[id])).rows[0].n,2,'drafts never publish copies');
    }
  } finally {await db.close();}
});

test('client switches preview and future email to the saved copy after reloading its category', async()=>{
  const app=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
  const source=app.slice(app.indexOf('async function saveNativeSmartDocument('),app.indexOf('async function emailNativeSmartDocument('));
  const smart={status:'completed',revision:2,completedFile:{storagePath:'coastal-crest/filled.pdf'}};
  const copy={id:'copy-1',name:'Sales Sheet - Completed.pdf',category:'Sales Reference',smartDocument:smart};
  const h={messages:[],reload:false,preview:null};
  const element=()=>({textContent:'',classList:{toggle(){},add(){}}});
  const context=vm.createContext({requireAction:()=>true,smartDocumentPayloadFromEditor:()=>({documentId:'original'}),
    settleDurableWritesBeforeTrustedMutation:async()=>true,setSmartDocumentButtonsDisabled:()=>{},
    setSaveState:(_el,message,status)=>h.messages.push({message,status}),canUseCloudSync:()=>false,
    squareApiHeaders:async()=>({}),AbortSignal,
    fetch:async()=>({ok:true,json:async()=>({saved:true,status:'completed',revision:2,smartDocument:smart,completedDocumentId:copy.id,completedDocument:copy})}),
    reloadDurableRecords:async()=>{h.reload=true;return [];},findManagedDocument:id=>{assert.equal(h.reload,true);return {record:id==='copy-1'?copy:null};},
    normalizeDocument:value=>value,smartDocumentPreviewUrl:async record=>{h.preview=record.id;return 'https://example.invalid/filled.pdf';},
    renderSmartDocumentCanvas:async()=>{},renderSmartDocumentOverlays:()=>{},queueDurableRecordsReload:()=>{},
    els:{smartDocumentSaveStatus:element(),smartDocumentMeta:element(),smartDocumentTitle:element(),smartDocumentEmailPanel:element(),emailSmartDocument:element(),smartDocumentPreviewFallback:element(),smartDocumentForm:{elements:{documentId:{value:'original'}}}},
  });
  vm.runInContext(source,context);
  assert.equal(await context.saveNativeSmartDocument('completed'),true);
  assert.equal(context.els.smartDocumentForm.elements.documentId.value,'copy-1');
  assert.equal(h.preview,'copy-1');
  assert.match(h.messages.at(-1).message,/new copy in Sales Reference/);
});
