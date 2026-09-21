const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const estimate = id => ({ id, contactId: `lead-${id}`, jobId: `job-${id}`, estimateNumber: id,
  items: [{ title: 'Original roof', quantity: 1, rate: 35250.75 }], status: 'Draft' });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function load(names, globals = {}) {
  const state = { estimates: [estimate('A'), estimate('B')], selectedEstimateId: 'A', view: 'estimates', company: {} };
  const statuses = [];
  const context = vm.createContext({ console, state, statuses, estimateExplicitSaves: new Set(),
    estimateSaveRevisions: new Map(), flushQueuedLocalStateSave() {},
    getSelectedEstimate: () => state.estimates.find(item => item.id === state.selectedEstimateId),
    getContact: id => ({ id, name: id }),
    durableRecordDataMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    setEstimateSaveState: (...args) => statuses.push(args), showToast() {},
    flushEstimateVerifiedSave: async () => true, downloadEstimatePdf: async () => true,
    window: { confirm: () => true }, ...globals });
  for (const name of names) {
    const match = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    assert.ok(match, `Function ${name} exists`);
    vm.runInContext(match[0], context);
  }
  return context;
}

test('explicit PDF save stays with its original estimate after selection changes', async () => {
  const save = deferred(); let captured;
  const c = load(['saveCurrentEstimateAndPdf'], {
    flushEstimateVerifiedSave: () => save.promise,
    downloadEstimatePdf: async options => { captured = clone(options.estimateSnapshot); return true; },
  });
  const pending = c.saveCurrentEstimateAndPdf();
  c.state.selectedEstimateId = 'B';
  save.resolve(true);
  assert.equal(await pending, true);
  assert.equal(captured.id, 'A');
  assert.equal(captured.contactId, 'lead-A');
  assert.equal(captured.jobId, 'job-A');
  assert.equal(c.estimateExplicitSaves.size, 0);
});

test('typing during estimate confirmation is not exported or marked fully saved', async () => {
  const save = deferred(); let pdfCalls = 0;
  const c = load(['saveCurrentEstimateAndPdf'], {
    flushEstimateVerifiedSave: () => save.promise,
    downloadEstimatePdf: async () => { pdfCalls++; return true; },
  });
  const pending = c.saveCurrentEstimateAndPdf();
  // Also protect mutations that do not increment the UI revision counter.
  c.state.estimates[0].items[0].title = 'Still typing';
  save.resolve(true);
  assert.equal(await pending, false);
  assert.equal(pdfCalls, 0);
  assert.equal(c.state.estimates[0].items[0].title, 'Still typing');
  assert.equal(c.statuses.at(-1)[2], 'error');
});

test('a changed revision is not considered saved even if values were changed back', async () => {
  const save = deferred(); let pdfCalls = 0;
  const c = load(['saveCurrentEstimateAndPdf'], {
    flushEstimateVerifiedSave: () => save.promise,
    downloadEstimatePdf: async () => { pdfCalls++; return true; },
  });
  const pending = c.saveCurrentEstimateAndPdf();
  c.estimateSaveRevisions.set('A', c.estimateSaveRevisions.get('A') + 1);
  save.resolve(true);
  assert.equal(await pending, false);
  assert.equal(pdfCalls, 0);
});

test('typing during PDF upload leaves the new draft dirty and preserves the sent snapshot', async () => {
  const upload = deferred(); const started = deferred(); let captured;
  const c = load(['saveCurrentEstimateAndPdf'], {
    downloadEstimatePdf: options => { captured = options.estimateSnapshot; started.resolve(); return upload.promise; },
  });
  const pending = c.saveCurrentEstimateAndPdf();
  await started.promise;
  c.state.estimates[0].items[0].rate = 42000.25;
  c.estimateSaveRevisions.set('A', c.estimateSaveRevisions.get('A') + 1);
  upload.resolve(true);
  assert.equal(await pending, false);
  assert.equal(captured.items[0].rate, 35250.75);
  assert.equal(c.state.estimates[0].items[0].rate, 42000.25);
  assert.equal(c.statuses.at(-1)[2], 'error');
});

test('failed estimate confirmation never generates a PDF', async () => {
  let pdfCalls = 0;
  const c = load(['saveCurrentEstimateAndPdf'], {
    flushEstimateVerifiedSave: async () => false,
    downloadEstimatePdf: async () => { pdfCalls++; return true; },
  });
  assert.equal(await c.saveCurrentEstimateAndPdf(), false);
  assert.equal(pdfCalls, 0);
  assert.equal(c.estimateExplicitSaves.size, 0);
});

test('delayed lead navigation cannot hijack another estimate or view', async () => {
  for (const changeSelection of [
    c => { c.state.selectedEstimateId = 'B'; },
    c => { c.state.view = 'jobs'; },
  ]) {
    const save = deferred(); const opened = [];
    const c = load(['openEstimateLeadOverview'], {
      saveCurrentEstimateAndPdf: () => save.promise,
      openLeadDetail: (...args) => opened.push(args),
    });
    const pending = c.openEstimateLeadOverview();
    changeSelection(c);
    save.resolve(true);
    assert.equal(await pending, false);
    assert.equal(opened.length, 0);
  }
});

test('lead navigation requires a fully saved original estimate and its actual lead', async () => {
  const opened = [];
  const c = load(['openEstimateLeadOverview'], {
    saveCurrentEstimateAndPdf: async () => true,
    openLeadDetail: (...args) => opened.push(args),
  });
  assert.equal(await c.openEstimateLeadOverview('lead-B'), false);
  assert.equal(await c.openEstimateLeadOverview(), true);
  assert.deepEqual(opened, [['lead-A', 'overview', 'job-A']]);
  c.saveCurrentEstimateAndPdf = async () => false;
  assert.equal(await c.openEstimateLeadOverview(), false);
  assert.equal(opened.length, 1);
});

test('PDF renderer uses a detached explicit snapshot without changing the drawing layout', async () => {
  let attached; const saved = deferred(); const started = deferred(); const drawn = [];
  function Pdf() {
    return new Proxy({}, { get: (_target, key) => {
      if (key === 'splitTextToSize') return text => [text];
      if (key === 'getTextWidth') return text => String(text).length;
      if (key === 'text') return text => drawn.push(text);
      return () => {};
    } });
  }
  const c = load(['downloadEstimatePdf'], {
    window: { jspdf: { jsPDF: Pdf } }, getEstimateContact: item => ({ id: item.contactId, name: item.contactId }),
    getEstimateJob: item => ({ id: item.jobId }), estimateSalesRep: () => ({}), companyOfficeAddress: () => '',
    totalsFor: () => ({ subtotal: 35250.75, tax: 0, total: 35250.75, balance: 35250.75 }),
    PDF_PAGE_WIDTH: 612, PDF_PAGE_HEIGHT: 792, pdfAddPageIfNeeded: () => false,
    pdfDrawEstimateTableHeader() {}, formatDate: () => '', number: value => Number(value) || 0,
    money: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }),
    saveEstimatePdfDocument: (item, contact) => {
      attached = { item, contact }; started.resolve(); return saved.promise;
    },
  });
  c.state.selectedEstimateId = 'B';
  const snapshot = clone(c.state.estimates[0]);
  const pending = c.downloadEstimatePdf({ estimateSnapshot: snapshot, silent: true, download: false });
  await started.promise;
  snapshot.items[0].title = 'Mutation after PDF rendering';
  saved.resolve({ id: 'document-A' });
  assert.equal(await pending, true);
  assert.equal(attached.item.id, 'A');
  assert.equal(attached.contact.id, 'lead-A');
  assert.equal(attached.item.items[0].title, 'Original roof');
  assert.ok(drawn.some(value => Array.isArray(value) && value.includes('Original roof')));
  assert.ok(drawn.includes('CUSTOMER'));
  assert.ok(drawn.includes('PROJECT & REPRESENTATIVE'));
});

test('PDF upload cannot attach to a removed or reassigned estimate target', async () => {
  for (const invalidate of ['estimate', 'lead', 'job', 'assignment']) {
    const upload = deferred(); let attached = 0; let leadExists = true; let jobExists = true;
    const c = load(['saveEstimatePdfDocument'], {
      canAction: () => true,
      getContact: id => leadExists ? { id, documents: [] } : null,
      getEstimateJob: item => jobExists ? { id: item.jobId } : null,
      defaultDocumentCategories: [{ id: 'doccat_estimates', name: 'Estimates' }],
      estimateFileName: () => 'estimate-A.pdf', uid: () => 'document-A',
      File: class { constructor() { this.size = 12; } },
      storeDocumentFile: () => upload.promise,
      normalizeDocument: item => item, updateContact: () => attached++,
    });
    const snapshot = clone(c.state.estimates[0]);
    const pending = c.saveEstimatePdfDocument(snapshot, { id: 'lead-A' }, { output: () => 'PDF bytes' });
    if (invalidate === 'estimate') c.state.estimates.splice(0, 1);
    if (invalidate === 'lead') leadExists = false;
    if (invalidate === 'job') jobExists = false;
    if (invalidate === 'assignment') c.state.estimates[0].jobId = 'another-job';
    upload.resolve({ storagePath: 'synthetic/immutable-version.pdf' });
    await assert.rejects(pending, /changed during upload/);
    assert.equal(attached, 0);
  }
});
