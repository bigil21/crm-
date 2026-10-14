const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { PDFDocument, degrees } = require('@cantoo/pdf-lib');

const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const analysisSource = app.slice(app.indexOf('function smartFieldTypeFromAnnotation('), app.indexOf('async function renderSmartDocumentCanvas('));

function harness(pages, module, initialFields = [], responses = {}) {
  const h = { fields: initialFields, responses, statuses: [], renders: 0 };
  const context = vm.createContext({
    smartDocumentPdf: { numPages: pages.length }, smartDocumentPdfModule: module,
    smartDocumentRenderToken: 1, smartDocumentAnalysisPdf: null,
    els: { analyzeSmartDocument: { disabled: false }, smartDocumentSaveStatus: {}, smartDocumentCanvasHelp: {},
      smartDocumentPages: { querySelectorAll: () => pages } },
    number: Number, uid: () => `field-${++h.ids}`, isPlacedSmartField: field => ['x','y','width','height'].every(key => Number.isFinite(field[key])),
    defaultSmartFieldSize: () => ({ width: .32, height: .045 }),
    smartDocumentFieldRows: () => h.fields.slice(), smartDocumentResponseValues: () => h.responses,
    renderSmartDocumentEditor: (fields, values) => { h.fields = fields; h.responses = values; h.renders++; },
    setSaveState: (_element, message, status) => h.statuses.push({ message, status }),
  });
  h.ids = 0; h.context = context;
  vm.runInContext(analysisSource, context);
  h.analyze = () => context.analyzeSmartDocumentPages();
  return h;
}

async function loadPages(bytes, { rotation, scale = 1.35 } = {}) {
  const module = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = module.getDocument({ data: new Uint8Array(bytes) });
  const pdf = await task.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale, ...(rotation === undefined ? {} : { rotation }) });
    pages.push({ dataset: { smartPage: String(i) }, _pdfPage: page, _pdfViewport: viewport });
  }
  return { module, pages, destroy: () => task.destroy() };
}

test('supplied lead sheet creates all 31 native bubbles without scanning text or duplicating them', async () => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/sales-lead-sheet.pdf'));
  const loaded = await loadPages(bytes);
  try {
    const page = loaded.pages[0]._pdfPage;
    assert.equal(loaded.pages[0]._pdfViewport.convertToViewportRectangle, undefined, 'exercise the deployed PDF.js 6 API');
    let annotationReads = 0;
    const originalAnnotations = page.getAnnotations.bind(page);
    page.getAnnotations = async (...args) => { annotationReads++; return originalAnnotations(...args); };
    page.getTextContent = () => { throw new Error('native fields must bypass text scanning'); };
    const h = harness(loaded.pages, loaded.module);
    await h.analyze();
    assert.equal(h.fields.length, 31);
    assert.equal(h.fields.filter(field => field.type === 'checkbox').length, 10);
    const byName = Object.fromEntries(h.fields.map(field => [field.sourceName, field]));
    assert.equal(byName.client_email.type, 'email');
    assert.equal(byName.client_phone.type, 'text');
    assert.equal(byName.lead_id.type, 'text');
    assert.equal(byName.appointment_date_time.type, 'text');
    assert.equal(byName.visit_date.type, 'date');
    assert.equal(byName.main_goal.type, 'textarea');
    assert.ok(Math.abs(byName.sales_rep.x - 36 / 612) < 1e-6);
    assert.ok(Math.abs(byName.sales_rep.y - 80 / 792) < 1e-6);
    assert.ok(Math.abs(byName.interest_roof.width - 12 / 612) < 1e-6);
    h.responses[byName.client_name.id] = 'Sample client';
    await h.analyze();
    assert.equal(h.fields.length, 31);
    assert.equal(h.responses[byName.client_name.id], 'Sample client');
    assert.equal(annotationReads, 1, 'reuse page annotations when analyzing again');
    assert.equal(h.context.els.analyzeSmartDocument.disabled, false);
    assert.equal(h.statuses.at(-1).status, 'success');
  } finally { await loaded.destroy(); }
});

test('native placements respect cropped and rotated pages at different scales', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612,792]);
  page.setCropBox(20,40,500,650);
  page.setRotation(degrees(90));
  source.getForm().createTextField('Name').addToPage(page, { x: 80, y: 500, width: 120, height: 24, borderWidth: 0 });
  const bytes = await source.save();
  for (const scale of [1, 2]) {
    const loaded = await loadPages(bytes, { scale });
    try {
      const h = harness(loaded.pages, loaded.module);
      await h.analyze();
      const field = h.fields[0];
      assert.ok(Math.abs(field.x - (500 - 40) / 650) < 1e-6);
      assert.ok(Math.abs(field.y - (80 - 20) / 500) < 1e-6);
      assert.ok(Math.abs(field.width - 24 / 650) < 1e-6);
      assert.ok(Math.abs(field.height - 120 / 500) < 1e-6);
    } finally { await loaded.destroy(); }
  }
});

test('pages without native fields still detect blank lines and retain manual fields and responses', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612,792]);
  page.drawText('Customer Name: ____________', { x: 40, y: 650, size: 12 });
  const loaded = await loadPages(await source.save());
  try {
    const manual = { id: 'manual', label: 'Manual notes', page: 1, x: .1, y: .7, width: .4, height: .1, type: 'textarea' };
    const h = harness(loaded.pages, loaded.module, [manual], { manual: 'Keep this response' });
    await h.analyze();
    assert.equal(h.fields.length, 2);
    assert.equal(h.fields[1].label, 'Customer Name');
    assert.equal(h.responses.manual, 'Keep this response');
    await h.analyze();
    assert.equal(h.fields.length, 2);
  } finally { await loaded.destroy(); }
});

test('analyze does not start overlapping work or update a different open document', async () => {
  let resolve; let reads = 0;
  const page = { dataset: { smartPage: '1' }, _pdfViewport: { width: 612, height: 792 },
    _pdfPage: { getAnnotations: () => { reads++; return new Promise(done => { resolve = done; }); } } };
  const h = harness([page], {});
  const pending = h.analyze();
  await h.analyze();
  assert.equal(reads, 1);
  h.context.smartDocumentRenderToken++;
  h.context.smartDocumentPdf = null;
  resolve([]);
  await pending;
  assert.equal(h.renders, 0);
  assert.equal(h.statuses.length, 1);
  assert.equal(h.context.smartDocumentAnalysisPdf, null);
});

test('analysis errors clear the analyzing hint and enable a retry', async () => {
  const page = { dataset: { smartPage: '1' }, _pdfViewport: { width: 612, height: 792 },
    _pdfPage: { getAnnotations: async () => { throw new Error('Unreadable page'); } } };
  const h = harness([page], {});
  await h.analyze();
  assert.equal(h.statuses.at(-1).status, 'error');
  assert.match(h.context.els.smartDocumentCanvasHelp.textContent, /Analysis stopped/);
  assert.equal(h.context.els.analyzeSmartDocument.disabled, false);
});
