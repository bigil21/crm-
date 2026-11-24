// An estimate's PDF can be filed again after it was removed from its lead.
//
// A first filing uses an id worked out from the lead, job and estimate, so two
// people filing at once make one record. Found while reviewing that change:
// when the filed PDF was later removed from the lead's documents, the removed
// record kept that id, and the database never writes to a removed record
// again. Every later filing of that estimate's PDF was refused, for good, and
// "Save Estimate" could never finish for that estimate.
//
// These tests run the CRM's own filing code and its own record writer against
// the real schema and save function in an in-memory PostgreSQL. Nothing here
// touches a network or a real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createEmptyDatabase } = require('../scripts/local-cloud.js');
const recordWrites = require('../record-writes.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const CO = 'coastal-crest';
const ADMIN = { sub: '11111111-1111-4111-8111-111111111111', email: 'local-admin@coastalcrestroofing.com' };
const REP = { sub: '22222222-2222-4222-8222-222222222222', email: 'local-rep@coastalcrestroofing.com' };

// One signed-in person's CRM tab, filing through the real database.
async function crm(db, user = REP) {
  const as = (work) => db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ ...user, role: 'authenticated' })]);
    await tx.exec('set local role authenticated');
    return work(tx);
  });
  const contact = { id: 'lead-1', name: 'TEST Customer', documents: [], updates: [] };
  const estimate = { id: 'est-1', contactId: 'lead-1', jobId: 'job-1', estimateNumber: 'E-1001' };
  const calls = { rpc: [], uploads: [] };
  const live = async () => (await as((tx) => tx.query(`select * from public.crm_records where company_state_id = $1 and record_type = 'document'
    and lead_id = 'lead-1' and job_id = 'job-1' and deleted_at is null and data->>'estimateId' = 'est-1' and data->>'source' = 'Estimate PDF' order by id limit 1`, [CO]))).rows[0];
  let key = 'a'.repeat(64);
  let uid = 0;
  const context = vm.createContext({
    console: { warn() {} }, crypto: globalThis.crypto, TextEncoder, JSON, Array, Uint8Array, Object, Error, Math, Date, Promise, Boolean, Number: Number,
    state: { estimates: [estimate], company: { documentCategories: [{ id: 'doccat_estimates', name: 'Estimates' }] }, currentUser: { name: 'TEST Person' } },
    canAction: () => true, getContact: () => contact, getEstimateJob: () => ({ id: 'job-1' }), defaultDocumentCategories: [], categoryForLegacyName: () => null,
    estimateFileName: () => 'e-1001-test-customer.pdf', uid: (prefix) => `${prefix}-${user.sub.slice(0, 4)}-${(uid += 1)}`, number: Number,
    File: class { constructor(parts, name) { this.name = name; this.size = 2048; } },
    estimatePdfContentKey: async () => key,
    storeDocumentFile: async (file, target) => { const stored = `${CO}/lead-1/jobs/job-1/doccat_estimates/${target.documentId}/${target.estimatePdfKey}/${file.name}`; calls.uploads.push(stored); return { dataUrl: '', storagePath: stored }; },
    normalizeDocument: (item) => item, currentActorName: () => 'TEST Person', saveState() {}, canUseCloudSync: () => true,
    updateContact() {}, addContactUpdate() {},
    window: { CrmRecordWrites: recordWrites }, authSession: { user: { id: user.sub } }, supabaseStateId: () => CO, contactOwnerId: () => REP.sub,
    durableRecordData: (item) => JSON.parse(JSON.stringify(item)), durableChangeCounter: 0, rememberAdditionalDurableRows() {},
    // The real lookup asks the database for the copy that is filed and not removed.
    findFiledEstimatePdf: async () => { const row = await live(); return { known: true, document: row ? { ...row.data, id: row.id } : null, row: row || null }; },
    cloudClient: { rpc: async (name, args) => {
      calls.rpc.push(args.p_changes.map((change) => change.id));
      try {
        const result = await as((tx) => tx.query(`select public.${name}($1, $2::jsonb, $3::jsonb) as result`, [args.p_request_id, JSON.stringify(args.p_changes), JSON.stringify(args.p_events || [])]));
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error: { code: error.code, message: error.message } }; }
    } },
  });
  vm.runInContext('var ESTIMATE_PDF_ID_SERIES_LIMIT = ' + source.match(/^const ESTIMATE_PDF_ID_SERIES_LIMIT = (\d+);$/m)[1], context);
  for (const name of ['estimatePdfDocumentId', 'commitSharedEstimatePdf', 'saveEstimatePdfDocument']) {
    vm.runInContext(source.match(new RegExp(`^async function ${name}\\([^]*?^}`, 'm'))[0], context);
  }
  return { context, contact, estimate, calls, live,
    file: (content) => { key = content.repeat(64).slice(0, 64); return context.saveEstimatePdfDocument(estimate, contact, { output: () => 'PDF' }); },
    // The CRM's own "remove this document": the record is kept, marked removed.
    remove: async (row) => as((tx) => tx.query('select public.crm_commit_records($1, $2::jsonb, $3::jsonb)', [`remove-${row.id}-${row.version}`,
      JSON.stringify([{ company_state_id: CO, record_type: 'document', id: row.id, lead_id: row.lead_id, job_id: row.job_id, data: row.data, expected_version: row.version, operation: 'delete' }]), '[]'])) };
}

async function database() {
  const db = await createEmptyDatabase({ quiet: true });
  await db.query(`insert into public.crm_records(company_state_id, record_type, id, lead_id, job_id, owner_id, updated_by, data, version) values
    ($1, 'contact', 'lead-1', 'lead-1', null, $2, $2, '{"name":"TEST Customer"}', 1), ($1, 'job', 'job-1', 'lead-1', 'job-1', $2, $2, '{"name":"TEST job","status":"New"}', 1)`, [CO, REP.sub]);
  return db;
}
const records = async (db) => (await db.query(`select id, version, deleted_at is not null as removed, data->>'pdfContentKey' as key, (data->>'versionNumber')::int as pdf_version
  from public.crm_records where record_type = 'document' order by id`)).rows;

test('a filed estimate PDF that was removed from the lead can be filed again, as often as it is removed', async () => {
  const db = await database();
  try {
    const tab = await crm(db);
    const first = await tab.file('a');
    assert.match(first.id, /^doc-estpdf-[0-9a-f]{64}$/);
    const base = first.id;
    assert.deepEqual(await records(db), [{ id: base, version: 1, removed: false, key: 'a'.repeat(64), pdf_version: 1 }]);

    // The rep removes it from the lead's documents, changes the estimate and saves it again.
    await tab.remove(await tab.live());
    assert.equal(await tab.live(), undefined, 'nothing is filed now');
    const second = await tab.file('b');
    assert.equal(second.id, `${base}-2`, 'the next id in the same series');
    assert.equal(second.versionNumber, 1, 'a fresh first version: the removed copy is not brought back');
    assert.deepEqual(await records(db), [
      { id: base, version: 2, removed: true, key: 'a'.repeat(64), pdf_version: 1 },
      { id: `${base}-2`, version: 1, removed: false, key: 'b'.repeat(64), pdf_version: 1 }]);
    assert.deepEqual(tab.calls.rpc.slice(-2), [[base], [`${base}-2`]], 'the refused id was tried once, then the next one');

    // From here it behaves as any filed PDF does: a change is a new version of it, an unchanged one is left alone.
    const third = await tab.file('c');
    assert.deepEqual([third.id, third.versionNumber], [`${base}-2`, 2]);
    const again = await tab.file('c');
    assert.equal(again.id, `${base}-2`);
    assert.equal((await records(db)).length, 2, 'no further record');

    // Removed a second time, and filed a third.
    await tab.remove(await tab.live());
    const fourth = await tab.file('d');
    assert.equal(fourth.id, `${base}-3`);
    assert.deepEqual((await records(db)).map((row) => [row.id.slice(base.length), row.removed]), [['', true], ['-2', true], ['-3', false]]);
    assert.equal((await records(db)).filter((row) => !row.removed).length, 1, 'one filed PDF for the estimate, never two');
  } finally { await db.close(); }
});

test('two people filing at once after a removal still make one record', async () => {
  const db = await database();
  try {
    const rep = await crm(db, REP);
    const admin = await crm(db, ADMIN);
    const base = (await rep.file('a')).id;
    await rep.remove(await rep.live());
    // Both press Save with the same estimate in front of them.
    const [one, two] = await Promise.all([rep.file('b'), admin.file('b')]);
    assert.equal(one.id, `${base}-2`);
    assert.equal(two.id, `${base}-2`, 'the second person is given the copy the first one filed');
    const now = await records(db);
    assert.deepEqual(now.map((row) => [row.id.slice(base.length), row.removed, row.pdf_version]), [['', true, 1], ['-2', false, 1]]);
    // With different PDFs in front of them, one wins and the other is told to retry; a retry then adds a version.
    await rep.remove(await rep.live());
    const outcomes = await Promise.allSettled([rep.file('c'), admin.file('d')]);
    assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ['fulfilled', 'rejected']);
    assert.match(outcomes.find((outcome) => outcome.status === 'rejected').reason.message, /was not confirmed\. Retry from the current estimate\./);
    const loser = outcomes[0].status === 'rejected' ? rep : admin;
    const retried = await loser.file(outcomes[0].status === 'rejected' ? 'c' : 'd');
    assert.deepEqual([retried.id, retried.versionNumber], [`${base}-3`, 2]);
    assert.equal((await records(db)).filter((row) => !row.removed).length, 1);
  } finally { await db.close(); }
});

test('the series is tried only for an id a removed record holds, and it ends', async () => {
  const db = await database();
  try {
    const tab = await crm(db);
    const base = (await tab.file('a')).id;
    // A refusal for any other reason is not answered by trying another id: here, someone who may not file documents on this lead.
    const stranger = await crm(db, { sub: '33333333-3333-4333-8333-333333333333', email: 'nobody@example.com' });
    await assert.rejects(stranger.file('z'));
    assert.deepEqual((await records(db)).map((row) => row.id), [base], 'no record under another id');
    // Every id of the series held by a removed record: the filing stops and says so, and makes nothing.
    await tab.remove(await tab.live());
    const limit = Number(source.match(/^const ESTIMATE_PDF_ID_SERIES_LIMIT = (\d+);$/m)[1]);
    await db.exec('set session_replication_role = replica');
    for (let turn = 2; turn <= limit; turn += 1) {
      await db.query(`insert into public.crm_records(company_state_id, record_type, id, lead_id, job_id, owner_id, updated_by, data, version, deleted_at)
        values($1, 'document', $2, 'lead-1', 'job-1', $3, $3, '{"source":"Estimate PDF","estimateId":"est-1"}', 2, now())`, [CO, `${base}-${turn}`, REP.sub]);
    }
    await db.exec('set session_replication_role = origin');
    await assert.rejects(tab.file('b'), /was not confirmed\. Retry from the current estimate\./);
    assert.equal((await records(db)).filter((row) => !row.removed).length, 0);
    assert.equal(tab.calls.rpc.length <= 1 + 1 + limit, true, 'it does not go on trying for ever');
  } finally { await db.close(); }
});

test('the filed PDF is stored under its own file name, in a folder named for what is in it', () => {
  const store = source.match(/^async function storeDocumentFile\([^]*?^}/m)[0];
  assert.match(store, /const versionSegment = contentAddressed \? estimatePdfKey : safeStoragePathSegment\(uid\("version"\), "version"\);/);
  assert.match(store, /\$\{versionSegment\}\/\$\{safeStorageFileName\(file\.name\)\}`;/);
  assert.doesNotMatch(store, /"estimate\.pdf"/, 'not a fixed name: a browser offers the stored name when the PDF is saved from Documents');
});
