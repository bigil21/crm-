// One filed copy of an estimate's PDF per estimate.
// Found by the two-person release workflow test: an admin who downloaded an
// estimate a rep had already saved filed a second, separate copy of the same
// PDF under the lead, and the lead record was saved again each time.
// Nothing here touches a network or a real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { jsPDF } = require('../vendor/jspdf.umd.min.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function load(names, globals = {}) {
  const context = vm.createContext({ console: { warn() {} }, crypto: webcrypto, Uint8Array, TextEncoder, ...globals });
  for (const name of names) {
    const match = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    assert.ok(match, `Function ${name} exists`);
    vm.runInContext(match[0], context);
  }
  return context;
}
const pdf = (lines) => {
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({ title: 'E-1001', subject: 'Estimate', author: 'TEST Roofing Co' });
  lines.forEach((line, index) => doc.text(line, 48, 80 + index * 18));
  return doc;
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the same estimate gives the same PDF fingerprint whenever it is made; a changed one does not', async () => {
  const c = load(['estimatePdfContentKey']);
  const lines = ['TEST Tear off existing shingles   24 sq   $85.00', 'Total $10,713.50'];
  const first = pdf(lines);
  await pause(1100); // The PDF records the second it was made.
  const second = pdf(lines);
  assert.notEqual(first.output(), second.output(), 'the raw files differ: each carries its own time and file id');
  const key = await c.estimatePdfContentKey(first);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(await c.estimatePdfContentKey(second), key);
  assert.notEqual(await c.estimatePdfContentKey(pdf(['TEST Tear off existing shingles   24 sq   $85.00', 'Total $10,713.51'])), key, 'one cent is a different PDF');
  // Where it cannot be worked out, the answer is blank, which only means "file it again".
  assert.equal(await load(['estimatePdfContentKey'], { crypto: undefined }).estimatePdfContentKey(first), '');
  assert.equal(await c.estimatePdfContentKey({ output() { throw Error('no output'); } }), '');
});

function filing({ documents = [], key = 'key-1', cloud = true, lookup = null, extra = [] } = {}) {
  const calls = { uploads: 0, updates: 0, notes: 0, persisted: [] };
  const contact = { id: 'lead-1', name: 'TEST Customer', documents, updatedAt: '2026-11-20T00:00:00.000Z' };
  const estimate = { id: 'est-1', contactId: 'lead-1', jobId: 'job-1', estimateNumber: 'E-1001' };
  const c = load(['estimatePdfDocumentId', 'commitSharedEstimatePdf', 'saveEstimatePdfDocument', ...extra], {
    state: { estimates: [estimate], company: { documentCategories: [{ id: 'doccat_estimates', name: 'Estimates' }] }, currentUser: { name: 'TEST Person' } },
    canAction: () => true, getContact: () => contact, getEstimateJob: () => ({ id: 'job-1' }),
    defaultDocumentCategories: [], categoryForLegacyName: () => null,
    estimateFileName: () => 'e-1001-test-customer.pdf', uid: () => 'doc-new', number: Number,
    File: class { constructor(parts, name) { this.name = name; this.size = 2048; } },
    findFiledEstimatePdf: async () => {
      const found = lookup ? lookup(contact) : { document: contact.documents.find((item) => item.source === 'Estimate PDF' && item.estimateId === 'est-1') || null, known: true };
      return { ...found, row: found.document ? { record_type: 'document', id: found.document.id, version: 1, data: found.document } : null };
    },
    estimatePdfContentKey: async () => key,
    storeDocumentFile: async () => { calls.uploads += 1; return { storagePath: `coastal-crest/lead-1/upload-${calls.uploads}.pdf` }; },
    normalizeDocument: (item) => item, currentActorName: () => 'TEST Person',
    updateContact: (_id, updater) => { calls.updates += 1; Object.assign(contact, updater(contact), { updatedAt: 'changed' }); return contact; },
    addContactUpdate: () => { calls.notes += 1; return { updates: [{ id: 'update-1' }] }; },
    saveState() {}, canUseCloudSync: () => cloud, queueCloudSave() {}, queueDurableRecordsSave() {},
    window: { CrmRecordWrites: require('../record-writes.js') }, authSession: { user: { id: 'rep' } },
    supabaseStateId: () => 'coastal-crest', contactOwnerId: () => 'rep', durableRecordData: (d) => JSON.parse(JSON.stringify(d)),
    durableChangeCounter: 0, rememberAdditionalDurableRows() {},
    cloudClient: { rpc: async (_rpc, { p_changes, p_events }) => {
      const [change] = p_changes;
      calls.persisted.push([change.id]); calls.notes += p_events.length;
      return { data: { rows: [{ ...change, version: change.expected_version + 1 }], audit_ids: p_events.map(e => e.id) } };
    } },
  });
  return { c, calls, contact, estimate, save: () => c.saveEstimatePdfDocument(estimate, contact, { output: () => 'PDF' }) };
}

test('downloading an estimate that has not changed files nothing and saves nothing', async () => {
  const filed = { id: 'doc-1', source: 'Estimate PDF', estimateId: 'est-1', storagePath: 'coastal-crest/lead-1/first.pdf', versionNumber: 1, previousVersions: [], pdfContentKey: 'key-1' };
  const h = filing({ documents: [filed] });
  assert.equal(await h.save(), filed, 'the copy already filed is the answer');
  assert.deepEqual(h.calls, { uploads: 0, updates: 0, notes: 0, persisted: [] });
  assert.equal(h.contact.updatedAt, '2026-11-20T00:00:00.000Z', 'the lead is not touched');
  assert.equal(h.contact.documents.length, 1);
});

test('a changed estimate becomes a new version of the same filed PDF, never a second copy', async () => {
  const filed = { id: 'doc-1', name: 'old.pdf', source: 'Estimate PDF', estimateId: 'est-1', storagePath: 'coastal-crest/lead-1/first.pdf', versionNumber: 1, previousVersions: [], pdfContentKey: 'key-0', uploadedAt: 'then', uploadedBy: 'Rep' };
  const h = filing({ documents: [filed], key: 'key-1' });
  const saved = await h.save();
  assert.equal(saved.id, 'doc-1');
  assert.equal(saved.versionNumber, 2);
  assert.equal(saved.pdfContentKey, 'key-1');
  assert.deepEqual(Array.from(saved.previousVersions, (version) => version.storagePath), ['coastal-crest/lead-1/first.pdf']);
  assert.equal(h.contact.documents.length, 1, 'still one document');
  assert.equal(h.calls.uploads, 1);
  assert.equal(h.calls.notes, 0, 'a new version does not add another "saved to documents" note');
  assert.deepEqual(h.calls.persisted, [['doc-1']]);
});

test('the first PDF of an estimate is filed once, with its fingerprint', async () => {
  const h = filing();
  const saved = await h.save();
  assert.match(saved.id, /^doc-estpdf-[0-9a-f]{64}$/);
  assert.equal(saved.versionNumber, 1);
  assert.equal(saved.pdfContentKey, 'key-1');
  assert.equal(h.contact.documents.length, 1);
  assert.equal(h.calls.notes, 1);
  // A PDF whose fingerprint could not be worked out is always filed again.
  const blank = filing({ documents: [{ id: 'doc-1', source: 'Estimate PDF', estimateId: 'est-1', storagePath: 'p.pdf', versionNumber: 1, previousVersions: [], pdfContentKey: '' }], key: '' });
  assert.equal((await blank.save()).versionNumber, 2);
  // An older filed PDF has no fingerprint yet: it gains one with its next version.
  const older = filing({ documents: [{ id: 'doc-1', source: 'Estimate PDF', estimateId: 'est-1', storagePath: 'p.pdf', versionNumber: 3, previousVersions: [] }], key: 'key-1' });
  const upgraded = await older.save();
  assert.equal(upgraded.versionNumber, 4);
  assert.equal(upgraded.pdfContentKey, 'key-1');
});

function lookup({ documents, loaded = false, rows = [], error = null, cloud = true, loading = null } = {}) {
  const contact = { id: 'lead-1', updatedAt: 'unchanged', ...(documents ? { documents } : {}) };
  const queries = [];
  const remembered = [];
  const heavy = new Map();
  if (loaded) heavy.set('lead-1', Promise.resolve(true));
  if (loading) heavy.set('lead-1', loading(contact));
  const query = { filters: [],
    select() { return this; }, eq(column, value) { this.filters.push(`${column}=${value}`); return this; }, is(column, value) { this.filters.push(`${column} is ${value}`); return this; },
    order() { return this; }, limit(count) { this.filters.push(`limit ${count}`); queries.push(this.filters); return Promise.resolve({ data: rows, error }); } };
  const c = load(['findFiledEstimatePdf'], {
    getContact: () => contact, canUseCloudSync: () => cloud, durableRecordsReady: true, durableHeavyLeadLoads: heavy,
    cloudClient: { from: () => ({ ...query, filters: [] }) }, SUPABASE_RECORDS_TABLE: 'crm_records', supabaseStateId: () => 'coastal-crest',
    state: { company: { documentCategories: [] } }, normalizeDocument: (item) => item,
    rememberAdditionalDurableRows: (items) => remembered.push(...items),
  });
  return { c, contact, queries, remembered };
}
const row = { id: 'doc-1', job_id: 'job-1', version: 2, data: { name: 'e-1001.pdf', source: 'Estimate PDF', estimateId: 'est-1', storagePath: 'p.pdf', pdfContentKey: 'key-1' } };

test('the filed PDF is found even when the lead\'s documents have not been opened', async () => {
  const h = lookup({ rows: [row] });
  const answer = await h.c.findFiledEstimatePdf('lead-1', 'est-1');
  assert.equal(answer.known, true);
  const found = answer.document;
  assert.equal(found.id, 'doc-1');
  assert.equal(found.jobId, 'job-1');
  assert.deepEqual(Array.from(h.queries[0]), ['company_state_id=coastal-crest', 'record_type=document', 'lead_id=lead-1', 'deleted_at is null', 'data->>estimateId=est-1', 'data->>source=Estimate PDF', 'limit 1']);
  assert.equal(h.contact.documents.length, 1);
  assert.equal(h.contact.updatedAt, 'unchanged', 'finding a record is not an edit');
  assert.deepEqual(h.remembered, [row], 'and the save pipeline knows the record is already in the database');
  // Asking again uses what is now known.
  await h.c.findFiledEstimatePdf('lead-1', 'est-1');
  assert.equal(h.queries.length, 1);
});

test('what is already loaded is used without asking the database', async () => {
  const known = { id: 'doc-1', source: 'Estimate PDF', estimateId: 'est-1' };
  const local = lookup({ documents: [known] });
  const plain = (answer) => ({ document: answer.document, known: answer.known });
  assert.deepEqual(plain(await local.c.findFiledEstimatePdf('lead-1', 'est-1')), { document: known, known: true });
  assert.equal(local.queries.length, 0);
  // The lead's documents were opened and hold no PDF for this estimate.
  const none = lookup({ documents: [{ id: 'doc-9', source: 'Estimate PDF', estimateId: 'another' }], loaded: true });
  assert.deepEqual(plain(await none.c.findFiledEstimatePdf('lead-1', 'est-1')), { document: null, known: true });
  assert.equal(none.queries.length, 0);
  // They are being loaded right now: wait for that instead of asking twice.
  const during = lookup({ loading: async (contact) => { await pause(20); contact.documents = [known]; return true; } });
  assert.deepEqual(plain(await during.c.findFiledEstimatePdf('lead-1', 'est-1')), { document: known, known: true });
  assert.equal(during.queries.length, 0);
  // Not signed in to the shared CRM: what is on this computer is all there is.
  const offline = lookup({ cloud: false });
  assert.deepEqual(plain(await offline.c.findFiledEstimatePdf('lead-1', 'est-1')), { document: null, known: true });
  assert.equal(offline.queries.length, 0);
});

// Found by Codex before release: with the original PDF already filed, the
// lookup was made to time out. The CRM read "could not check" as "no PDF
// exists", uploaded another copy and made a second document.
test('finding no filed PDF is an answer; not being able to look is not', async () => {
  const plain = (answer) => ({ document: answer.document, known: answer.known });
  const nothing = lookup({ rows: [] });
  assert.deepEqual(plain(await nothing.c.findFiledEstimatePdf('lead-1', 'est-1')), { document: null, known: true }, 'asked, and there is none');
  assert.equal(nothing.remembered.length, 0);
  const failed = lookup({ rows: null, error: { message: 'timeout' } });
  assert.deepEqual(plain(await failed.c.findFiledEstimatePdf('lead-1', 'est-1')), { document: null, known: false }, 'the question was refused');
  const garbled = lookup({ rows: 'not a list' });
  assert.equal((await garbled.c.findFiledEstimatePdf('lead-1', 'est-1')).known, false, 'an answer that is not a list of rows');
  const thrown = lookup();
  thrown.c.cloudClient.from = () => { throw Error('offline'); };
  assert.equal((await thrown.c.findFiledEstimatePdf('lead-1', 'est-1')).known, false, 'the connection failed');
  // The lead's documents were being loaded, and that load failed.
  const loadFailed = lookup({ loading: async () => { await pause(5); return false; } });
  assert.deepEqual(plain(await loadFailed.c.findFiledEstimatePdf('lead-1', 'est-1')), { document: null, known: false });
  // The shared records are not ready at all.
  const notReady = lookup();
  notReady.c.durableRecordsReady = false;
  assert.equal((await notReady.c.findFiledEstimatePdf('lead-1', 'est-1')).known, false);
  assert.equal(notReady.queries.length, 0);
});

// The CRM around one filing: the copy already under the lead in the database,
// not yet known to this browser, and a connection that can be cut.
function unreliable() {
  const original = { id: 'doc-1', name: 'e-1001.pdf', source: 'Estimate PDF', estimateId: 'est-1', storagePath: 'coastal-crest/lead-1/first.pdf', versionNumber: 1, previousVersions: [], pdfContentKey: 'key-0', uploadedAt: 'then', uploadedBy: 'Rep' };
  const net = { down: true, lookups: 0 };
  const timers = [];
  const said = { states: [], toasts: [] };
  const h = filing({
    key: 'key-1', extra: ['clearEstimatePdfFilingRetry', 'queueEstimatePdfFiling', 'retryEstimatePdfFiling', 'retryWaitingEstimatePdfFilings'],
    lookup: (contact) => {
      net.lookups += 1;
      if (net.down) return { document: null, known: false };
      // What the real lookup does when it gets through: the filed copy becomes known to this browser.
      if (!contact.documents.some((item) => item.id === original.id)) contact.documents = [original, ...contact.documents];
      return { document: contact.documents.find((item) => item.id === original.id), known: true };
    },
  });
  Object.assign(h.c, {
    ESTIMATE_PDF_FILING_RETRY_DELAYS: [15000, 45000, 120000, 300000, 600000], estimatePdfFilingRetries: new Map(),
    window: { ...h.c.window, setTimeout: (run, delay) => { timers.push({ run, delay }); return timers.length; }, clearTimeout() {} },
    getEstimateContact: () => h.contact, setEstimateSaveState: (_id, message, tone) => said.states.push([tone, message]), showToast: (message) => said.toasts.push(message),
  });
  return { ...h, original, net, timers, said, doc: { output: () => 'PDF' } };
}

test('a connection failure never files a second copy: nothing is filed until the CRM can look, then the original gets the new version', async () => {
  const h = unreliable();
  // The download: the lookup times out.
  await assert.rejects(h.save(), (error) => error.code === 'estimate_pdf_lookup_unavailable');
  assert.deepEqual(h.calls, { uploads: 0, updates: 0, notes: 0, persisted: [] }, 'nothing was uploaded and no record was made');
  assert.deepEqual(h.contact.documents, [], 'no second document, and no new document id');
  assert.equal(h.contact.updatedAt, '2026-11-20T00:00:00.000Z', 'the lead is not touched');

  // It is put aside to be filed later, and the first try is soon.
  assert.equal(h.c.queueEstimatePdfFiling(h.estimate, h.doc), true);
  assert.deepEqual(h.timers.map((timer) => timer.delay), [15000]);
  // Still no connection at that first try: it waits again, longer, and still files nothing.
  assert.equal(await h.c.retryEstimatePdfFiling('est-1'), false);
  assert.deepEqual(h.timers.map((timer) => timer.delay), [15000, 45000]);
  assert.equal(h.calls.uploads, 0);

  // The connection is back. The copy that was there all along is found, and this PDF becomes its next version.
  h.net.down = false;
  assert.equal(await h.c.retryEstimatePdfFiling('est-1'), true);
  assert.deepEqual(Array.from(h.contact.documents, (item) => [item.id, item.versionNumber]), [['doc-1', 2]], 'one document, the original, now at version 2');
  assert.deepEqual(Array.from(h.contact.documents[0].previousVersions, (version) => version.storagePath), ['coastal-crest/lead-1/first.pdf']);
  assert.deepEqual(h.calls.persisted, [['doc-1']]);
  assert.equal(h.calls.uploads, 1);
  assert.equal(h.calls.notes, 0, 'no "saved to documents" note for a new version');
  assert.equal(h.c.estimatePdfFilingRetries.size, 0, 'nothing is left waiting');
  assert.deepEqual(h.said.states.at(-1), ['success', 'The estimate\'s PDF is now filed under the lead.']);
  assert.equal(await h.c.retryEstimatePdfFiling('est-1'), false, 'and it is not filed twice');
  assert.equal(h.calls.uploads, 1);
});

test('waiting filings are retried when the connection returns, give up after a few tries, and are dropped once a newer PDF is filed', async () => {
  // Back online: the wait is not sat out.
  const online = unreliable();
  online.c.queueEstimatePdfFiling(online.estimate, online.doc);
  online.net.down = false;
  online.c.retryWaitingEstimatePdfFilings();
  await pause(20);
  assert.deepEqual(Array.from(online.contact.documents, (item) => [item.id, item.versionNumber]), [['doc-1', 2]]);

  // Never reachable: five tries, each later than the last, then it stops and says so. Still nothing filed.
  const never = unreliable();
  never.c.queueEstimatePdfFiling(never.estimate, never.doc);
  for (let turn = 0; turn < 8; turn += 1) await never.c.retryEstimatePdfFiling('est-1');
  assert.deepEqual(never.timers.map((timer) => timer.delay), [15000, 45000, 120000, 300000, 600000]);
  assert.equal(never.c.estimatePdfFilingRetries.size, 0);
  assert.deepEqual(never.contact.documents, []);
  assert.equal(never.calls.uploads, 0);
  assert.match(never.said.states.at(-1)[1], /still not filed under the lead\. Download it again once the CRM is reachable\./);

  // A newer PDF of the same estimate was filed in the meantime: the older one waiting is not filed over it.
  const superseded = unreliable();
  superseded.c.queueEstimatePdfFiling(superseded.estimate, superseded.doc);
  superseded.c.clearEstimatePdfFilingRetry('est-1');
  superseded.net.down = false;
  assert.equal(await superseded.c.retryEstimatePdfFiling('est-1'), false);
  assert.equal(superseded.calls.uploads, 0);

  // The estimate was deleted while its PDF waited: nothing to file.
  const gone = unreliable();
  gone.c.queueEstimatePdfFiling(gone.estimate, gone.doc);
  gone.c.state.estimates.length = 0;
  gone.net.down = false;
  assert.equal(await gone.c.retryEstimatePdfFiling('est-1'), false);
  assert.equal(gone.calls.uploads, 0);
});

test('the rep still gets the PDF when it cannot be filed yet, and is told it will be filed later', () => {
  const download = source.match(/^async function downloadEstimatePdf\([^]*?^}/m)[0];
  const tail = download.slice(download.indexOf('let savedDocument = null;'));
  // The lookup failure is handled on its own: queued, and said plainly.
  assert.match(tail, /if \(error\?\.code === "estimate_pdf_lookup_unavailable"\) \{[^]*?filingWaits = queueEstimatePdfFiling\(estimate, doc\);/);
  assert.match(tail, /It will be filed when the connection is back\./);
  // The download itself comes after, and does not depend on the filing.
  assert.ok(tail.indexOf('doc.save(estimateFileName(estimate));') > tail.indexOf('queueEstimatePdfFiling(estimate, doc)'));
  assert.match(tail, /filingWaits \? "Estimate PDF downloaded\. It will be filed under the lead when the CRM can be reached\."/);
  // A filing that succeeds cancels an older PDF of the same estimate that was still waiting.
  assert.match(tail, /if \(savedDocument\) clearEstimatePdfFilingRetry\(estimate\.id\);/);
  assert.match(source, /window\.addEventListener\("online", \(\) => \{ void retryCompleteCoreRecordsNow\(\); retryWaitingEstimatePdfFilings\(\); \}\);/);
});

test('only estimate PDFs carry the fingerprint, so no other document changes shape', () => {
  const c = load(['normalizeDocument'], { COMPANY_DOCUMENT_LEAD_ID: 'company', JOB_PHOTO_CATEGORY_ID: 'doccat_photos', defaultDocumentCategories: [], categoryForLegacyName: () => null, uid: () => 'doc-x', number: Number });
  assert.equal(c.normalizeDocument({ id: 'd', name: 'photo.jpg', leadId: 'lead-1' }).pdfContentKey, undefined);
  assert.equal(Object.hasOwn(c.normalizeDocument({ id: 'd', name: 'photo.jpg', leadId: 'lead-1' }), 'pdfContentKey'), false);
  assert.equal(c.normalizeDocument({ id: 'd', name: 'e.pdf', leadId: 'lead-1', pdfContentKey: 'abc' }).pdfContentKey, 'abc');
});
