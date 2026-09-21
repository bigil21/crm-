const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');

function functions(file, names, globals = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const context = vm.createContext({ console, URL, setTimeout, clearTimeout, durableWriteBlocked: false, cloudSaveInFlight: false, hasPendingCompanyChanges: () => false, checkpointPendingDraft() {}, ...globals });
  for (const name of names) {
    const match = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm')) ||
      source.match(new RegExp(`^const ${name} = \\([^]*?^};`, 'm'));
    assert.ok(match, `Function ${name} exists in ${file}`);
    vm.runInContext(match[0], context);
  }
  return context;
}

function backend(env = {}) {
  let handler;
  const context = vm.createContext({
    console, URL, Buffer, setTimeout, clearTimeout, AbortSignal,
    __dirname: root, module: { exports: {} },
    process: { env: { AUTH_REQUIRED: 'true', ...env } },
    require(name) {
      if (name === 'fs') return {
        existsSync: () => false,
        readFile: (_file, callback) => callback(null, Buffer.from('synthetic public asset')),
      };
      if (name === 'http') return { createServer: fn => { handler = fn; return {}; } };
      return require(name);
    },
    fetch: async () => { throw Error('External network is forbidden in regression tests'); },
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), context);
  context.request = (url, method = 'GET', body = '') => new Promise((resolve, reject) => {
    const req = new EventEmitter();
    Object.assign(req, { url, method, headers: { host: 'localhost' }, socket: { remoteAddress: '127.0.0.1' } });
    const headers = {};
    const res = {
      setHeader: (key, value) => { headers[key] = value; },
      writeHead(status, extra = {}) { this.status = status; Object.assign(headers, extra); },
      end(value) { resolve({ status: this.status, headers, body: value?.toString() || '' }); },
    };
    try {
      Promise.resolve(handler(req, res)).catch(reject);
      queueMicrotask(() => { if (body) req.emit('data', Buffer.from(body)); req.emit('end'); });
    } catch (error) { reject(error); }
  });
  return context;
}

for (const url of ['/server.js', '/.env', '/.git/config', '/square-payments.json', '/tests/audit-regressions.test.js', '/role-direct-check-v56.js', '/%2eenv']) {
  test(`private route is denied: ${url}`, async () => {
    assert.equal((await backend().request(url)).status, 404);
  });
}
for (const url of ['/', '/login', '/logout', '/app.js?v=999', '/record-writes.js', '/company-settings-writes.js', '/draft-recovery.js', '/session-guard.js', '/sw.js', '/vendor/jspdf.umd.min.js']) {
  test(`public asset remains available: ${url}`, async () => {
    assert.equal((await backend().request(url)).status, 200);
  });
}
test('malformed request encoding returns controlled 400', async () => {
  assert.equal((await backend().request('/%E0%A4%A')).status, 400);
});
test('authentication fails closed when flag is absent', async () => {
  assert.equal((await backend({ AUTH_REQUIRED: undefined }).request('/api/square/create-invoice', 'POST', '{}')).status, 401);
});
test('protected APIs reject anonymous requests', async () => {
  assert.equal((await backend().request('/api/square/payment-status', 'POST', '{}')).status, 401);
});
test('unconfigured webhook rejects events rather than accepting unsigned data', async () => {
  assert.equal((await backend().request('/webhooks/square', 'POST', '{}')).status, 503);
});
test('login redirect cannot resolve to a different origin', () => {
  const c = functions('login.js', ['sanitizeRedirect'], { CRM_ENTRY_URL: '/', location: { origin: 'https://crm.example' } });
  for (const input of ['/\\evil.example', '//evil.example', '/%5cevil.example', 'https://evil.example']) {
    assert.equal(new URL(c.sanitizeRedirect(input), 'https://crm.example').origin, 'https://crm.example');
  }
  assert.equal(c.sanitizeRedirect('/?lead=123'), '/?lead=123');
});
test('cache quota failure does not prevent durable save scheduling', () => {
  let queued = 0;
  const c = functions('app.js', ['writeStateToLocalStorage', 'saveState'], {
    state: {}, localStorage: { setItem() { throw Error('QuotaExceededError'); } },
    activeStorageKey: () => 'test', localStateSaveTimer: null, localEditRevision: 0,
    applyingCloudState: false, window: { clearTimeout() {} },
    queueCloudSave() { queued++; }, queueDurableRecordsSave() { queued++; },
    console: { warn() {} },
  });
  c.saveState();
  assert.equal(queued, 2);
});

test('durable mode never duplicates business rows in legacy background saves', () => {
  for (const admin of [true, false]) {
    const c = functions('app.js', ['companyStatePayload', 'cloudRowsForSave', 'cloudSnapshotPayload'], {
      durableBusinessStateAuthoritative: true, canAction: () => admin,
      authSession: { user: { id: 'synthetic-user' } }, cloudCompanyStateId: () => 'test:company',
      state: { company: { name: 'Test' }, contacts: [{ id: 'sensitive-lead' }], companyDocuments: [{ id: 'file' }] },
    });
    const rows = JSON.parse(JSON.stringify(c.cloudRowsForSave()));
    assert.equal(rows.length, admin ? 1 : 0);
    assert.equal(JSON.stringify(rows).includes('sensitive-lead'), false);
    assert.equal(JSON.stringify(rows).includes('companyDocuments'), false);
    const snapshot = c.cloudSnapshotPayload();
    c.state.contacts.push({ id: 'another-lead' });
    assert.equal(JSON.stringify(c.cloudSnapshotPayload()), JSON.stringify(snapshot));
  }
});
test('reload does not overwrite an edit made while fetching', async () => {
  let resolve;
  const c = functions('app.js', ['reloadDurableRecords'], {
    fetchDurableRows: () => new Promise(done => { resolve = done; }),
    localEditRevision: 0, durableSaveInFlight: false, durableReloadQueued: false,
    hasPendingDurableChanges: () => false, applyingCloudState: false,
    applyDurableRows() { c.notes = 'stale'; }, rememberDurableRows() {}, saveState() {},
    queueDurableRecordsReload() {}, notes: 'initial',
  });
  const pending = c.reloadDurableRecords();
  c.notes = 'newly typed'; c.localEditRevision++;
  resolve({ rows: [{ record_type: 'contact' }], auditRows: [] });
  await pending;
  assert.equal(c.notes, 'newly typed');
});
test('successful empty reload is authoritative', async () => {
  let applied = false;
  const c = functions('app.js', ['reloadDurableRecords'], {
    fetchDurableRows: async () => ({ rows: [], auditRows: [] }),
    localEditRevision: 0, durableSaveInFlight: false, hasPendingDurableChanges: () => false,
    applyingCloudState: false, applyDurableRows() { applied = true; },
    rememberDurableRows() {}, saveState() {},
  });
  await c.reloadDurableRecords();
  assert.equal(applied, true);
});

test('pending company-setting edits prevent stale background hydration', async () => {
  let read = false;
  const c = functions('app.js', ['reloadCloudState'], {
    hasPendingCompanyChanges: () => true, fetchCloudRows: () => { read = true; throw Error('Should not fetch'); },
  });
  assert.equal(await c.reloadCloudState(), false);
  assert.equal(read, false);
});

test('durable startup reads only company settings, not every legacy business snapshot', async () => {
  const c = functions('app.js', ['fetchCloudRows'], {
    durableBusinessStateAuthoritative: true, SUPABASE_CRM_TABLE: 'crm_state', cloudCompanyStateId: () => 'coastal-crest:company',
    cloudClient: { from: table => ({ select: () => ({ eq: (field, id) => ({ table, field, id }) }) }) },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await c.fetchCloudRows())), { table: 'crm_state', field: 'id', id: 'coastal-crest:company' });
});
test('orphan jobs and documents survive hydration without implicit deletion or reassignment', () => {
  const rows = ['job', 'document'].map(record_type => ({
    company_state_id: 'coastal-crest', record_type, id: `${record_type}-orphan`,
    lead_id: 'missing-lead', job_id: 'missing-job', owner_id: 'original-owner',
    version: 3, data: { title: 'Preserve original', customField: 'Keep this too' }, deleted_at: null,
  }));
  let noticed = 0;
  const c = functions('app.js', ['applyDurableRows', 'durableRowsFromState', 'durableFingerprint', 'hasPendingDurableChanges'], {
    state: { company: {}, contacts: [], estimates: [], calendarTasks: [], companyDocuments: [] },
    durableUnmappedRows: [], COMPANY_DOCUMENT_LEAD_ID: '__company__',
    showUnmappedRecordNotice: count => { noticed = count; },
    applySharedState: data => { Object.assign(c.state, data); },
    normalizeContact: value => value, normalizeDocument: value => value,
    supabaseStateId: () => 'coastal-crest', authSession: { user: { id: 'test' } },
    preserveReadOnlyPaymentFields: value => value,
    durableRecordKey: row => `${row.record_type}:${row.id}`,
    durableRecordsReady: true, durableRecordFingerprints: new Map(),
    durableAuditRowsFromState: () => [], durableAuditIds: new Set(),
  });
  c.applyDurableRows(rows, []);
  assert.equal(noticed, 2);
  assert.equal(c.state.contacts.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(c.durableRowsFromState())), rows);
  c.durableRecordFingerprints = new Map(rows.map(row => [c.durableRecordKey(row), c.durableFingerprint(row)]));
  assert.equal(c.hasPendingDurableChanges(), false);
  const copy = c.durableRowsFromState(); copy[0].data.title = 'Mutated temporary snapshot';
  assert.equal(c.durableRowsFromState()[0].data.title, 'Preserve original');
  c.applyDurableRows([], []);
  assert.equal(c.durableRowsFromState().length, 0);
  assert.equal(noticed, 0);
});

test('company reload remembers only the version actually applied to the editor', async () => {
  let remembered;
  const row = { id: 'coastal-crest:company', version: 7, data: { company: { name: 'Latest' } } };
  const c = functions('app.js', ['reloadCloudState'], {
    durableBusinessStateAuthoritative: true, localEditRevision: 0, durableSaveInFlight: false,
    hasPendingDurableChanges: () => false, fetchCloudRows: async () => ({ data: [row] }),
    isCompanyCloudRow: value => value.id === row.id,
    getCompanySettingsWriter: () => ({ remember: value => { remembered = value; } }),
    mergeCloudRows() {}, sharedStateSnapshot: () => 'confirmed', saveState() {},
  });
  assert.equal(await c.reloadCloudState(), true);
  assert.equal(remembered.version, 7);
  assert.equal(c.lastCloudSnapshot, 'confirmed');
});

test('durable settings save uses RPC and retains edits typed while awaiting confirmation', async () => {
  let finish, queued = 0, snapshot = 'first';
  const c = functions('app.js', ['flushCloudSave'], {
    durableBusinessStateAuthoritative: true, durableRecordsReady: true, cloudReady: true,
    authSession: { user: { id: 'test-admin' } }, canUseCloudSync: () => true,
    cloudClient: { from() { throw Error('Direct upsert forbidden'); } },
    cloudRowsForSave: () => [{ data: { company: { name: 'First' } } }],
    sharedStateSnapshot: () => snapshot, lastCloudSnapshot: 'original',
    getCompanySettingsWriter: () => ({ commit: () => new Promise(resolve => { finish = resolve; }) }),
    markRecentCloudWrite() {}, clearRecentCloudWrite() {}, queueCloudSave() { queued++; },
  });
  const pending = c.flushCloudSave();
  assert.equal(c.cloudSaveInFlight, true);
  snapshot = 'second';
  finish({ error: null });
  assert.equal(await pending, true);
  assert.equal(c.lastCloudSnapshot, 'first');
  assert.equal(c.cloudSaveInFlight, false);
  assert.equal(queued, 1);
});

test('failed settings confirmation does not mark the current draft saved', async () => {
  const c = functions('app.js', ['flushCloudSave'], {
    durableBusinessStateAuthoritative: true, durableRecordsReady: true, cloudReady: true,
    authSession: { user: { id: 'test-admin' } }, canUseCloudSync: () => true, cloudClient: {},
    cloudRowsForSave: () => [{ data: { company: {} } }], sharedStateSnapshot: () => 'pending',
    lastCloudSnapshot: 'original', getCompanySettingsWriter: () => ({ commit: async () => {
      c.durableWriteBlocked = true; return { error: { code: '40001' } };
    } }), markRecentCloudWrite() {}, clearRecentCloudWrite() {},
    console: { warn() {} }, showToast() { throw Error('Routine notice must stay quiet'); },
  });
  assert.equal(await c.flushCloudSave(), false);
  assert.equal(c.lastCloudSnapshot, 'original');
  assert.equal(c.cloudSaveInFlight, false);
});

test('orphan estimate never falls back to another customer or project', () => {
  const c = functions('app.js', ['getEstimateContact', 'getEstimateJob'], {
    state: { contacts: [{ id: 'unrelated' }] }, getContact: () => null,
    contactJobs: () => [{ id: 'wrong-job' }],
  });
  assert.equal(c.getEstimateContact({ contactId: 'missing' }), null);
  assert.equal(c.getEstimateJob({ contactId: 'missing', jobId: 'missing' }), null);
});
test('Square quantity validation preserves fractions and rejects invalid values', () => {
  const c = backend();
  assert.equal(c.squareLineItem({ title: 'Half unit', quantity: 0.5, rate: 100 }).quantity, '0.5');
  assert.equal(c.squareLineItem({ quantity: 1, rate: 35250.75 }).base_price_money.amount, 3525075);
  for (const quantity of [0, -1, 'bad', Infinity]) assert.throws(() => c.squareLineItem({ quantity, rate: 100 }));
  assert.throws(() => c.squareLineItem({ quantity: 1, rate: -1 }));
});
test('invoice reconciliation counts each Square invoice once and preserves contract', () => {
  const job = { id: 'job', value: 32000, contractValue: 32000, manualPayments: [{ amount: 5000 }] };
  const contact = { id: 'lead', jobs: [job] };
  const c = functions('app.js', ['number', 'updateJobPaymentSnapshot'], {
    state: { estimates: [1, 2].map(() => ({ contactId: 'lead', jobId: 'job', squareInvoiceId: 'inv', paidAmount: 16000, contractValue: 20000 })) },
    getContact: () => contact, contactJobs: value => value?.jobs || [],
    updateContact: (_id, update) => Object.assign(contact, update(contact)), totalsFor: () => ({ total: 20000 }),
  });
  c.updateJobPaymentSnapshot('lead', 'job');
  assert.equal(contact.jobs[0].paidAmount, 21000);
  assert.equal(contact.jobs[0].contractValue, 32000);
  assert.equal(contact.jobs[0].paymentPercent, 65.625);
});

test('paged reads include more than 1000 rows even with a smaller server page cap', async () => {
  const source = Array.from({length:1201}, (_,id) => ({id:String(id).padStart(5,'0')}));
  let pages = 0;
  const c = functions('app.js',['fetchAllCompanyRows'], {
    supabaseStateId: () => 'test-company',
    cloudClient: { from() { return {
      select(_fields, opts) { assert.equal(opts.count, 'exact'); return this; },
      eq() { return this; }, order() { return this; },
      async range(start, end) { pages++; return {data:source.slice(start,Math.min(end+1,start+100)),count:source.length}; },
    }; } },
  });
  const rows = await c.fetchAllCompanyRows('crm_records');
  assert.equal(rows.length,1201); assert.equal(pages,13);
  assert.equal(rows[1200].id,'01200');
});
for (const failure of ['count changed','empty page','duplicate page','provider error']) {
  test(`paged reads reject an incomplete snapshot: ${failure}`, async () => {
    let page = 0;
    const c = functions('app.js',['fetchAllCompanyRows'], {
      supabaseStateId: () => 'test-company',
      cloudClient: { from() { return {
        select() { return this; }, eq() { return this; }, order() { return this; },
        async range() {
          if (page++ === 0) return {data:[{id:'one'}],count:2};
          return failure === 'provider error' ? {error:Error('offline')} :
            {count:failure === 'count changed' ? 3 : 2,data:failure === 'empty page' ? [] : [{id:'one'}]};
        },
      }; } },
    });
    await assert.rejects(c.fetchAllCompanyRows('crm_records'));
  });
}
test('legacy snapshot reload cannot overwrite new edits', async () => {
  let resolve, applied = false;
  const c = functions('app.js',['reloadCloudState'], {
    localEditRevision:0, durableSaveInFlight:false, hasPendingDurableChanges:() => false,
    fetchCloudRows:() => new Promise(done => {resolve=done;}),
    mergeCloudRows:() => {applied=true;}, sharedStateSnapshot:() => '',saveState() {},
  });
  const pending = c.reloadCloudState(); c.localEditRevision++;
  resolve({data:[],error:null});
  assert.equal(await pending,false); assert.equal(applied,false);
});
test('service worker does not intercept HTML, private files, configuration or API data', () => {
  const handlers = {};
  const context = vm.createContext({ URL, self:{ location:{origin:'https://crm.example'},addEventListener:(type,fn) => {handlers[type]=fn;} } });
  vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),context);
  for (const path of ['/', '/index.html?v=999', '/api/health','/server.js','/auth-config.js','/square-payments.json','/diagnostics.html']) {
    let intercepted = false;
    handlers.fetch({request:{method:'GET',url:'https://crm.example'+path},respondWith:() => {intercepted=true;}});
    assert.equal(intercepted,false,path);
  }
});
test('invoiced estimate cannot be reassigned or deleted', () => {
  const estimate = {id:'estimate', contactId:'lead',jobId:'job',squareInvoiceId:'invoice'};
  const c = functions('app.js',['number','updateSelectedEstimateFromField','deleteEstimate'], {
    state:{contacts:[],estimates:[estimate]}, canAction:() => true,requireAction:() => true,
    canUseCloudSync:() => false,
    getSelectedEstimate:() => estimate, showToast() {},renderEstimateForm() {},
    window:{confirm(){throw Error('Deletion must be blocked before confirmation');}},
  });
  c.updateSelectedEstimateFromField('contactId','unrelated');
  c.deleteEstimate();
  assert.equal(estimate.contactId,'lead'); assert.equal(c.state.estimates.length,1);
});

test('upload batch retains successes when one file fails and bounds concurrency', async () => {
  let active=0,peak=0;
  const c=functions('app.js',['uploadDocumentBatch']);
  const result=await c.uploadDocumentBatch(Array.from({length:8},(_,id)=>({name:`file${id}`,id})),async file=>{
    active++; peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,1)); active--;
    if(file.id===2)throw Error('interrupted');
    return {id:file.id};
  });
  assert.equal(result.documents.length,7); assert.equal(result.failures[0].name,'file2'); assert.equal(peak,3);
});
test('upload batch fails explicitly if no file is stored',async()=>{
  const c=functions('app.js',['uploadDocumentBatch']);
  await assert.rejects(c.uploadDocumentBatch([{name:'file'}],async()=>{throw Error('offline');}),/offline/);
});
test('cloud file revisions use distinct immutable paths',async()=>{
  const uploads=[];let next=0;
  const c=functions('app.js',['storeDocumentFile'],{
    cloudReady:true,authSession:{user:{id:'user'}},supabaseStateId:()=> 'company',
    SUPABASE_DOCUMENT_BUCKET:'crm-documents',uid:()=>`v${++next}`,safeStorageFileName:x=>x,
    cloudClient:{storage:{from(){return{async upload(...args){uploads.push(args);return{};}};}}},
  });
  const args={documentId:'doc',leadId:'lead',jobId:'job',categoryId:'estimates'};
  const first=await c.storeDocumentFile({name:'estimate.pdf',type:'application/pdf'},args);
  const second=await c.storeDocumentFile({name:'estimate.pdf',type:'application/pdf'},args);
  assert.notEqual(first.storagePath,second.storagePath);
  assert.equal(uploads[0][2].upsert,false);
});
test('configured cloud upload never silently falls back to local-only storage',async()=>{
  const c=functions('app.js',['storeDocumentFile'],{cloudReady:false,canUseCloudSync:()=>true});
  await assert.rejects(c.storeDocumentFile({name:'file'},{documentId:'id'}),/not ready/);
});

test('estimate totals sum line cents consistently with Square',()=>{
  const c=functions('app.js',['number','totalsFor']);
  const result=c.totalsFor({items:[{quantity:0.5,rate:0.01},{quantity:0.5,rate:0.01}],taxRate:0,deposit:0});
  assert.equal(result.total,0.02);
  const contract=c.totalsFor({items:[{quantity:1,rate:35250.75}],taxRate:0,deposit:17625.38});
  assert.equal(contract.balance,17625.37);
});

test('shared-data redraw waits until the active text editor loses focus', () => {
  const input = { type: 'text', matches: selector => selector === 'input' };
  let rendered = 0;
  const c = functions('app.js', ['activeTextEditor', 'renderDurableUpdateWhenIdle'], {
    document: { activeElement: input }, pendingDurableRender: false, render: () => rendered++,
  });
  assert.equal(c.renderDurableUpdateWhenIdle(), false);
  assert.equal(c.pendingDurableRender, true);
  assert.equal(rendered, 0);
  c.document.activeElement = { matches: () => false };
  assert.equal(c.renderDurableUpdateWhenIdle(), true);
  assert.equal(c.pendingDurableRender, false);
  assert.equal(rendered, 1);
});

test('the production render wrapper does not draw the active page twice', () => {
  const source = fs.readFileSync(path.join(root, 'production-flow-v64.js'), 'utf8');
  const wrapper = source.match(/assignGlobal\("render", function productionRenderWrapper\(\) \{([^]*?)\n\s*\}\);/);
  assert.ok(wrapper, 'production render wrapper exists');
  assert.match(wrapper[1], /previousRender\(\)/);
  assert.doesNotMatch(wrapper[1], /refreshCurrentView\(\)/);
});

test('Save Estimate has a direct click path in addition to keyboard form submit', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  assert.match(source, /els\.saveEstimateButton\?\.addEventListener\("click", \(event\) => \{\s*event\.preventDefault\(\);[^]*?saveCurrentEstimateAndPdf\(\)/);
});

test('explicit saves can show success without restoring noisy autosave notices', () => {
  const c = functions('app.js', ['setSaveState']);
  const element = { textContent: '', dataset: {} };
  c.setSaveState(element, 'Saved', 'success');
  assert.equal(element.textContent, '');
  c.setSaveState(element, 'Saved with PDF', 'success', { showSuccess: true });
  assert.equal(element.textContent, 'Saved with PDF');
  assert.equal(element.dataset.tone, 'success');
});

test('local saves report cache quota failures instead of claiming persistence', () => {
  const c = functions('app.js', ['writeStateToLocalStorage', 'saveState'], {
    state: { contacts: [] }, activeStorageKey: () => 'crm-test',
    localStorage: { setItem: () => { throw Error('Quota exceeded'); } },
    window: { clearTimeout() {} }, localStateSaveTimer: null,
    localEditRevision: 0, applyingCloudState: false,
    queueCloudSave() {}, queueDurableRecordsSave() {},
  });
  assert.equal(c.saveState({ localOnly: true }), false);
});

test('local file uploads roll back their in-memory cards when offline storage is full', () => {
  const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  for (const name of ['uploadLeadDocuments', 'uploadLeadPhotos']) {
    const match = source.match(new RegExp(`async function ${name}\\([^]*?^}`, 'm'));
    assert.ok(match, `${name} exists`);
    assert.match(match[0], /!canUseCloudSync\(\) && !localSaved/);
    assert.match(match[0], /state\.contacts = state\.contacts\.map/);
  }
});

test('failed authoritative startup does not load business data from legacy snapshots', async () => {
  let legacyReads = 0;
  const c = functions('app.js', ['initializeDurableRecords'], {
    cloudReady: true, cloudClient: {}, authSession: { user: { id: 'rep' } },
    reloadDurableRecords: async () => null,
    reloadCloudState: async () => legacyReads++, durableBusinessStateAuthoritative: true,
  });
  await c.initializeDurableRecords();
  assert.equal(legacyReads, 0);
  assert.equal(c.durableBusinessStateAuthoritative, true);
});

test('old payment display defaults cannot turn a sales edit into a payment rewrite', () => {
  const baseline = { manualPayments: [{ id: 'old-payment', amount: 50 }], paidAmount: 50 };
  const c = functions('app.js', ['preserveReadOnlyPaymentFields'], {
    currentRole: () => 'sales', durableRecordKey: row => `${row.record_type}:${row.id}`,
    durableFinancialBaseline: new Map([['job:j', baseline]]),
    protectedPaymentFields: ['manualPayments', 'paidAmount', 'squarePaidAmount'],
  });
  const rows = [{ record_type: 'job', id: 'j', data: { status: 'Inspection', paidAmount: 50, squarePaidAmount: 0, manualPayments: [{ ...baseline.manualPayments[0], method: 'Check', createdBy: 'CRM admin' }] } }];
  c.preserveReadOnlyPaymentFields(rows);
  assert.equal(JSON.stringify(rows[0].data.manualPayments), JSON.stringify(baseline.manualPayments));
  assert.equal(rows[0].data.status, 'Inspection');
  assert.equal('squarePaidAmount' in rows[0].data, false);
});

test('failed document archive leaves the visible record and file untouched', async () => {
  let removals = 0;
  const document = { id: 'doc', name: 'estimate.pdf', storagePath: 'immutable/v1.pdf' };
  const c = functions('app.js', ['archiveDocumentRecord', 'removeLeadDocument'], {
    requireAction: () => true, getSelectedContact: () => ({ id: 'lead', documents: [document] }),
    canUseCloudSync: () => true, durableRecordsReady: true,
    authSession: { user: { id: 'rep' } }, cloudClient: { storage: { from: () => { throw Error('File bytes must not be deleted'); } } },
    waitForDurableSaveSlot: async () => true,
    durableRowsFromState: () => [{ record_type: 'document', id: 'doc', data: document }],
    commitDurableChanges: async () => ({ error: { code: '40001' } }),
    showToast: () => {}, updateContact: () => removals++,
  });
  await c.removeLeadDocument('doc');
  assert.equal(removals, 0);
});

test('document archive keeps bytes and sends a versioned metadata deletion', async () => {
  let sent;
  const record = { id: 'doc', storagePath: 'immutable/v1.pdf' };
  const c = functions('app.js', ['archiveDocumentRecord'], {
    canUseCloudSync: () => true, durableRecordsReady: true, cloudClient: {}, authSession: { user: { id: 'rep' } },
    waitForDurableSaveSlot: async () => true,
    durableRowsFromState: () => [{ record_type: 'document', id: 'doc', data: record }],
    commitDurableChanges: async (...args) => { sent = args; return {}; },
  });
  assert.equal(await c.archiveDocumentRecord(record), true);
  assert.equal(sent[0].length, 0);
  assert.equal(sent[2][0].id, 'doc');
});

test('local document removal stops if a recoverable copy cannot be stored', async () => {
  const c = functions('app.js', ['archiveDocumentRecord'], {
    canUseCloudSync: () => false, localStorage: { setItem: () => { throw Error('Quota exceeded'); } }, showToast: () => {},
  });
  assert.equal(await c.archiveDocumentRecord({ id: 'doc', dataUrl: 'data:application/pdf;base64,AA==' }), false);
});

module.exports = { functions, backend };
