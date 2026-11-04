const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function functionSource(name) {
  const match = appSource.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
  assert.ok(match, `${name} exists`);
  return match[0];
}

test('durable state projection is reused until the edit revision changes', () => {
  let rowBuilds = 0;
  let auditBuilds = 0;
  const largeRows = Array.from({ length: 10000 }, (_, index) => ({ record_type: 'contact', id: `lead-${index}`, data: { name: `Lead ${index}` } }));
  const context = vm.createContext({
    Map, Set,
    durableProjection: null,
    durableProjectionRevision: -1,
    localEditRevision: 4,
    durableRowsFromState() { rowBuilds += 1; return largeRows; },
    durableAuditRowsFromState() { auditBuilds += 1; return [{ id: 'audit-1' }]; },
    durableRecordKey(row) { return `${row.record_type}:${row.id}`; },
    durableFingerprint(row) { return JSON.stringify(row.data); },
  });
  vm.runInContext(functionSource('durableStateProjection'), context);
  vm.runInContext(functionSource('invalidateDurableProjection'), context);
  context.durableStateProjection();
  context.durableStateProjection();
  context.durableStateProjection();
  for (let index = 0; index < 100; index += 1) context.durableStateProjection();
  assert.equal(rowBuilds, 1);
  assert.equal(auditBuilds, 1);
  context.localEditRevision += 1;
  context.durableStateProjection();
  assert.equal(rowBuilds, 2);
  assert.equal(auditBuilds, 2);
  context.invalidateDurableProjection();
  context.durableStateProjection();
  assert.equal(rowBuilds, 3);
});

test('ordinary durable checks and flushes consume the indexed projection', () => {
  assert.match(functionSource('hasPendingDurableChanges'), /durableStateProjection/);
  assert.match(functionSource('flushDurableRecordsSave'), /durableStateProjection/);
  for (const name of [
    'persistProfitCostRecord',
    'persistManualPaymentRecord',
    'persistLeadJobRecord',
    'persistDurableRecordNow',
    'persistLeadDocumentRecords',
    'persistCompanyDocumentRecords',
  ]) {
    assert.match(functionSource(name), /durableProjected|durableStateProjection/);
  }
});

test('navigation remains isolated from business-state serialization', () => {
  for (const name of ['setView', 'saveUiState']) {
    assert.doesNotMatch(functionSource(name), /durableRowsFromState|writeStateToLocalStorage/);
  }
});

test('large authenticated recovery snapshots use IndexedDB instead of localStorage', () => {
  const cache = fs.readFileSync(path.join(root, 'recovery-cache.js'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(cache, /indexedDb\.open\(DATABASE/);
  assert.match(cache, /objectStore\(STORE/);
  assert.doesNotMatch(cache, /localStorage/);
  assert.ok(html.indexOf('recovery-cache.js') < html.indexOf('app.js'));
  assert.match(functionSource('writeStateToLocalStorage'), /recoveryCache\.put\(activeStorageKey\(\), state\)/);
});

test('realtime record events patch one record before falling back to a full reload', () => {
  const initialize = functionSource('initializeDurableRecords');
  assert.match(initialize, /applyDurableRealtimeRecord\(row, payload\.eventType\)/);
  assert.match(initialize, /applyDurableRealtimeAudit\(row, payload\.eventType\)/);
  assert.doesNotMatch(functionSource('applyDurableRealtimeRecord'), /fetchDurableRows|reloadDurableRecords/);
  assert.doesNotMatch(functionSource('applyDurableRealtimeAudit'), /fetchDurableRows|reloadDurableRecords/);
});

test('heavy PDF libraries load only when a PDF is requested', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+jspdf\.umd\.min\.js/);
  assert.match(functionSource('loadEstimatePdfGenerator'), /createElement\("script"\)/);
  assert.match(functionSource('downloadEstimatePdf'), /await loadEstimatePdfGenerator\(\)/);
});

test('startup excludes document payloads and bounds the initial activity query', () => {
  const fetchRows = functionSource('fetchDurableRows');
  assert.match(fetchRows, /\["estimate", "task"\]/);
  assert.match(fetchRows, /recordPageClient\.leads\(\{ limit: 100 \}\)/);
  assert.match(fetchRows, /recordPageClient\.jobs\(\{ limit: 100 \}\)/);
  assert.doesNotMatch(fetchRows, /"document"/);
  assert.match(fetchRows, /fetchRecentCompanyRows\(SUPABASE_AUDIT_TABLE, 500/);
  assert.match(functionSource('loadDurableLeadHeavyRecords'), /eq\("record_type", "document"\).*eq\("lead_id", contactId\)/s);
  assert.match(functionSource('loadDurableCompanyDocuments'), /eq\("lead_id", COMPANY_DOCUMENT_LEAD_ID\)/);
});

test('image rasterization and PDF rendering use browser workers when available', () => {
  const imageWorker = fs.readFileSync(path.join(root, 'image-worker.js'), 'utf8');
  assert.match(functionSource('rasterizeLogoDataUrl'), /new window\.Worker\("\/image-worker\.js\?v=1"\)/);
  assert.match(imageWorker, /OffscreenCanvas/);
  assert.match(appSource, /GlobalWorkerOptions\.workerSrc = "\/vendor\/pdf\.worker\.min\.mjs\?v=1"/);
});
