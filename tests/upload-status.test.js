// Each uploaded file has its own status (to-do item 9): a rep sending twenty
// roof photos sees exactly which one failed and retries that one, without the
// other nineteen being sent again. Photos also get a small copy for the gallery.
// Nothing here touches a network or a real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const backup = require('../recovery-backup.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function load(names, globals = {}, setup = '') {
  const context = vm.createContext({ console: { warn() {} }, ...globals });
  if (setup) vm.runInContext(setup, context);
  for (const name of names) {
    const match = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    assert.ok(match, `Function ${name} exists`);
    vm.runInContext(match[0], context);
  }
  return context;
}
const ENGINE = ['documentUploadErrorMessage', 'leadUploadFailureMessage', 'fileLeadUpload', 'sendLeadUpload', 'noteLeadUploads', 'runLeadUploads',
  'queueLeadUploads', 'retryLeadUploads', 'clearLeadUploads', 'leadUploadSummary', 'leadUploadListMarkup'];
const ENGINE_STATE = 'var leadUploads = []; var LEAD_UPLOAD_ACTIVE = ["waiting", "sending", "confirming"]; var leadUploadsRunning = null; var leadUploadConfirmTail = Promise.resolve(); var leadUploadRefreshTimer = null;';
const TARGET = { contactId: 'lead-1', jobId: 'job-1', jobName: 'TEST Roof job', categoryId: 'job_photos', categoryName: 'Photos' };
const photo = (n, size = 2_400_000) => ({ name: `TEST-photo-${n}.jpg`, size, type: 'image/jpeg' });

// The upload engine with storage and the database stood in for.
function uploads({ failStorage = new Set(), failRecord = new Set(), cloud = true, localSaves = true } = {}) {
  const calls = { stored: [], previews: [], persisted: [], notes: [], toasts: [], saves: 0, active: 0, peak: 0 };
  const lead = { id: 'lead-1', updatedAt: 'unchanged', documents: [{ id: 'doc-existing', name: 'contract.pdf' }], jobs: [{ id: 'job-1', name: 'TEST Roof job' }] };
  let nextId = 0;
  const c = load(ENGINE, {
    state: { contacts: [lead], selectedContactId: 'lead-1', company: { documentCategories: [] }, currentUser: { name: 'TEST Rep' } },
    uid: (prefix) => `${prefix}-${(nextId += 1)}`,
    RESUMABLE_UPLOAD_THRESHOLD: 6 * 1024 * 1024,
    getContact: (id) => (id === lead.id && !lead.removed ? lead : null), contactJobs: (contact) => contact.jobs,
    normalizeDocument: (document) => document, currentActorName: () => 'TEST Rep',
    photoPreviewCache: new Map(), window: { clearTimeout() {}, setTimeout: () => 0 }, durableSaveTimer: null,
    canUseCloudSync: () => cloud, saveState: () => { calls.saves += 1; return localSaves; },
    renderLeadUploads() {}, scheduleLeadUploadRefresh() {},
    storeDocumentFile: async (file, target) => {
      calls.active += 1; calls.peak = Math.max(calls.peak, calls.active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      calls.active -= 1;
      calls.stored.push(file.name);
      if (failStorage.has(file.name)) throw new Error('TypeError: Failed to fetch');
      return { dataUrl: '', storagePath: `coastal-crest/${target.leadId}/jobs/${target.jobId}/${target.categoryId}/${target.documentId}/v1/${file.name}` };
    },
    storePhotoPreview: async (file, storagePath) => { calls.previews.push(file.name); return `${storagePath.slice(0, storagePath.lastIndexOf('/'))}/preview.jpg`; },
    persistLeadDocumentRecords: async (ids) => {
      const record = lead.documents.find((document) => document.id === ids[0]);
      calls.persisted.push(record.name);
      return !failRecord.has(record.name);
    },
    addContactUpdate: (id, update) => { calls.notes.push(update.message); lead.updatedAt = 'stamped once'; },
    queueDurableRecordsSave() {}, queueCloudSave() {}, showToast: (message) => calls.toasts.push(message),
  }, ENGINE_STATE);
  const statuses = () => Object.fromEntries(Array.from(c.leadUploads, (item) => [item.name, item.status]));
  return { c, calls, lead, statuses };
}

test('twenty photos, one fails: nineteen are saved and the one that failed says so', async () => {
  const files = Array.from({ length: 20 }, (_item, index) => photo(index + 1));
  const u = uploads({ failStorage: new Set(['TEST-photo-7.jpg']) });
  u.c.queueLeadUploads('photo', files, TARGET);
  await u.c.runLeadUploads();
  const statuses = u.statuses();
  assert.equal(Object.values(statuses).filter((status) => status === 'saved').length, 19);
  assert.equal(statuses['TEST-photo-7.jpg'], 'failed');
  const failed = Array.from(u.c.leadUploads).find((item) => item.status === 'failed');
  assert.equal(failed.message, 'Upload failed because the connection was interrupted. Please try again.');
  assert.ok(failed.file, 'the file is kept so it can be sent again without picking it');
  assert.equal(u.lead.documents.length, 20, 'the lead has its old file and the nineteen new photos');
  assert.equal(u.calls.peak, 2, 'never more than two files in flight');
  // One line in the lead's history for the run, and the lead itself is touched once, not once per photo.
  assert.deepEqual(u.calls.notes, ['Uploaded 19 job photos to TEST Roof job.']);
  assert.deepEqual(u.calls.toasts, ['19 files saved to TEST Roof job']);
  assert.equal(u.c.leadUploadSummary(Array.from(u.c.leadUploads), 'photo').message,
    '19 of 20 photos saved. 1 did not go through: use "Retry this file" below. The saved ones do not need sending again.');

  // Retrying sends that one file, and only that one.
  const sentBefore = u.calls.stored.length;
  u.calls.stored.length = 0;
  const failing = u.c;
  failing.storeDocumentFile = async (file, target) => { u.calls.stored.push(file.name); return { dataUrl: '', storagePath: `coastal-crest/${target.leadId}/retry/${file.name}` }; };
  await failing.retryLeadUploads([failed.id]);
  assert.equal(sentBefore, 20);
  assert.deepEqual(u.calls.stored, ['TEST-photo-7.jpg'], 'the other nineteen were not sent again');
  assert.equal(Object.values(u.statuses()).every((status) => status === 'saved'), true);
  assert.equal(u.lead.documents.length, 21);
  assert.deepEqual(u.calls.notes.at(-1), 'Uploaded 1 job photo to TEST Roof job.');
  assert.equal(u.c.leadUploadSummary(Array.from(u.c.leadUploads), 'photo').message, '20 photos saved to TEST Roof job.');
});

test('a file is saved only when its record under the job is confirmed, and a retry does not send the file twice', async () => {
  const u = uploads({ failRecord: new Set(['TEST-photo-2.jpg']) });
  u.c.queueLeadUploads('photo', [photo(1), photo(2), photo(3)], TARGET);
  await u.c.runLeadUploads();
  assert.deepEqual(u.statuses(), { 'TEST-photo-1.jpg': 'saved', 'TEST-photo-2.jpg': 'failed', 'TEST-photo-3.jpg': 'saved' });
  const failed = Array.from(u.c.leadUploads).find((item) => item.status === 'failed');
  assert.equal(failed.message, 'The file was sent, but saving it to this job could not be confirmed.');
  assert.equal(u.lead.documents.some((document) => document.name === 'TEST-photo-2.jpg'), false, 'it is not left on the lead looking saved');
  assert.equal(u.lead.documents.length, 3);

  u.c.persistLeadDocumentRecords = async (ids) => { u.calls.persisted.push(`retry:${u.lead.documents.find((document) => document.id === ids[0]).name}`); return true; };
  u.calls.stored.length = 0;
  await u.c.retryLeadUploads([failed.id]);
  assert.deepEqual(u.calls.stored, [], 'the file was already in storage; only its record is saved again');
  assert.equal(u.calls.persisted.at(-1), 'retry:TEST-photo-2.jpg');
  assert.equal(u.statuses()['TEST-photo-2.jpg'], 'saved');
});

test('each saved photo is filed under the right lead and job, with its small copy', async () => {
  const u = uploads();
  const [item] = u.c.queueLeadUploads('photo', [photo(1)], TARGET);
  await u.c.runLeadUploads();
  const record = u.lead.documents[0];
  assert.equal(record.id, item.documentId);
  assert.equal(record.kind, 'photo');
  assert.equal(record.leadId, 'lead-1');
  assert.equal(record.jobId, 'job-1');
  assert.equal(record.categoryId, 'job_photos');
  assert.match(record.storagePath, /^coastal-crest\/lead-1\/jobs\/job-1\/job_photos\/photo-\d+\/v1\/TEST-photo-1\.jpg$/);
  assert.equal(record.previewPath, record.storagePath.replace('TEST-photo-1.jpg', 'preview.jpg'));
  assert.equal(item.file, null, 'a saved file is no longer held in memory');
  // A document is not a photo: no small copy is made for it.
  const d = uploads();
  d.c.queueLeadUploads('document', [{ name: 'TEST permit.pdf', size: 90_000, type: 'application/pdf' }], { ...TARGET, categoryId: 'doccat_permits', categoryName: 'Permits' });
  await d.c.runLeadUploads();
  assert.deepEqual(d.calls.previews, []);
  assert.equal(d.lead.documents[0].kind, undefined);
  assert.equal(Object.hasOwn(d.lead.documents[0], 'previewPath'), false);
  assert.deepEqual(d.calls.notes, ['Uploaded TEST permit.pdf to TEST Roof job / Permits.']);
});

test('a lead or job removed while a file was on its way is reported, and nothing is filed', async () => {
  const u = uploads();
  u.c.queueLeadUploads('photo', [photo(1)], TARGET);
  u.lead.removed = true;
  await u.c.runLeadUploads();
  const [item] = Array.from(u.c.leadUploads);
  assert.equal(item.status, 'failed');
  assert.equal(item.message, 'The lead or job was removed before this file was saved.');
  assert.deepEqual(u.calls.notes, []);
});

test('without shared storage a full device is a failed file, not a saved one', async () => {
  const u = uploads({ cloud: false, localSaves: false });
  u.c.queueLeadUploads('document', [{ name: 'TEST permit.pdf', size: 90_000, type: 'application/pdf' }], TARGET);
  await u.c.runLeadUploads();
  assert.equal(u.statuses()['TEST permit.pdf'], 'failed');
  assert.match(Array.from(u.c.leadUploads)[0].message, /out of offline storage/);
  assert.equal(u.lead.documents.length, 1, 'only the file that was there before');
});

test('the list shows one line per file, and offers a retry only where one failed', () => {
  const u = uploads();
  const items = [
    { id: 'u1', name: 'IMG_0001.jpg', size: 2_400_000, status: 'saved', jobName: 'Smith Roof', message: '' },
    { id: 'u2', name: 'IMG_0002.jpg', size: 2_400_000, status: 'sending', jobName: 'Smith Roof', message: '' },
    { id: 'u3', name: '<b>odd</b>.jpg', size: 100, status: 'failed', jobName: 'Smith Roof', message: 'Upload failed because the connection was interrupted. Please try again.' },
    { id: 'u4', name: 'IMG_0004.jpg', size: 2_400_000, status: 'waiting', jobName: 'Smith Roof', message: '' },
  ];
  const html = load(['leadUploadListMarkup'], { escapeHtml: (value = '') => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'), formatBytes: (size) => `${size} B` }).leadUploadListMarkup(items);
  assert.equal((html.match(/class="upload-status-row/g) || []).length, 4);
  assert.match(html, /is-saved"[^>]*>[^]*?Saved to Smith Roof/);
  assert.match(html, /is-sending"[^>]*>[^]*?Sending…/);
  assert.match(html, /is-waiting"[^>]*>[^]*?Waiting/);
  assert.match(html, /is-failed"[^>]*>[^]*?connection was interrupted[^]*?data-upload-retry="u3">Retry this file</);
  assert.equal((html.match(/data-upload-retry="/g) || []).length, 1, 'only the failed file can be retried');
  assert.doesNotMatch(html, /<b>odd<\/b>/, 'a file name is shown as text');
  assert.doesNotMatch(html, /data-upload-retry-all/, 'one failure needs no "retry all"');
  assert.match(html, /data-upload-clear/);
  assert.equal(u.c.leadUploadSummary(items, 'photo').message, 'Sending 4 photos: 1 saved, 1 failed, 2 to go.');
});

test('the database must hand the record back under the lead and job it was sent to', async () => {
  const run = async (returned) => {
    const sent = { record_type: 'document', id: 'photo-1', lead_id: 'lead-1', job_id: 'job-1', data: {} };
    const c = load(['persistLeadDocumentRecords'], {
      durableRecordsReady: true, cloudClient: {}, authSession: { user: { id: 'rep' } }, durableSaveInFlight: false,
      waitForDurableSaveSlot: async () => true, invalidateDurableProjection() {}, durableStateProjection: () => ({ rows: [sent] }),
      durableAuditRowsFromState: () => [], markRecentLocalDurableWrite() {}, clearRecentLocalDurableWrite() {}, queueDurableRecordsSave() {},
      commitDurableChanges: async () => ({ data: { rows: [returned] }, error: null }),
    });
    return c.persistLeadDocumentRecords(['photo-1'], '');
  };
  assert.equal(await run({ record_type: 'document', id: 'photo-1', lead_id: 'lead-1', job_id: 'job-1' }), true);
  assert.equal(await run({ record_type: 'document', id: 'photo-1', lead_id: 'lead-1', job_id: 'job-2' }), false, 'filed under another job is not saved');
  assert.equal(await run({ record_type: 'document', id: 'photo-1', lead_id: 'lead-9', job_id: 'job-1' }), false);
  assert.equal(await run({ record_type: 'document', id: 'photo-other', lead_id: 'lead-1', job_id: 'job-1' }), false);
});

test('a photo\'s small copy is stored beside the original, and is never a reason for the upload to fail', async () => {
  const stored = [];
  const make = (blob, uploadError = null) => load(['storePhotoPreview'], {
    cloudClient: { storage: { from: () => ({ upload: async (name, body, options) => { stored.push({ name, size: body.size, options }); return { error: uploadError }; } }) } },
    SUPABASE_DOCUMENT_BUCKET: 'crm-documents', makePhotoPreview: async () => blob,
  });
  const original = 'coastal-crest/lead-1/jobs/job-1/job_photos/photo-1/v1/IMG_0001.jpg';
  assert.equal(await make({ size: 22_000 }).storePhotoPreview({ size: 2_400_000 }, original), 'coastal-crest/lead-1/jobs/job-1/job_photos/photo-1/v1/preview.jpg');
  assert.equal(stored[0].options.contentType, 'image/jpeg');
  assert.equal(stored[0].options.upsert, false);
  // No small copy when the browser could not draw the photo, when it would not be smaller, or when storing it failed.
  assert.equal(await make(null).storePhotoPreview({ size: 2_400_000 }, original), '');
  assert.equal(await make({ size: 30_000 }).storePhotoPreview({ size: 20_000 }, original), '');
  assert.equal(await make({ size: 22_000 }, { message: 'denied' }).storePhotoPreview({ size: 2_400_000 }, original), '');
  assert.equal(await make({ size: 22_000 }).storePhotoPreview({ size: 2_400_000 }, ''), '');
  assert.equal(await load(['makePhotoPreview'], { PHOTO_PREVIEW_SIDE: 480 }).makePhotoPreview({}), null, 'a browser that cannot do it makes none');
});

test('the gallery shows the small copy, and the original only for photos without one', async () => {
  const asked = [];
  const c = load(['managedPhotoPreviewUrl'], {
    photoPreviewCache: new Map(), unreadablePhotoPreviews: new Set(), SUPABASE_DOCUMENT_BUCKET: 'crm-documents',
    cloudClient: { storage: { from: () => ({ createSignedUrl: async (name) => { asked.push(name); return { data: { signedUrl: `signed:${name}` }, error: null }; } }) } },
  });
  const withCopy = { id: 'p1', storagePath: 'a/IMG_1.jpg', previewPath: 'a/preview.jpg' };
  assert.equal(await c.managedPhotoPreviewUrl(withCopy), 'signed:a/preview.jpg');
  assert.equal(await c.managedPhotoPreviewUrl(withCopy), 'signed:a/preview.jpg');
  assert.deepEqual(asked, ['a/preview.jpg'], 'asked for once, then remembered');
  assert.equal(await c.managedPhotoPreviewUrl(withCopy, { original: true }), 'signed:a/IMG_1.jpg', 'the original when the small copy will not load');
  assert.equal(await c.managedPhotoPreviewUrl({ id: 'p2', storagePath: 'b/old.jpg' }), 'signed:b/old.jpg', 'a photo from before small copies');
  assert.match(source.match(/^async function showLeadPhotoPreview\([^]*?^}/m)[0], /managedPhotoPreviewUrl\(photo, \{ original: true \}\)/);
});

// The file rules decide who may read which stored file. A person who may read
// a photo but is refused its small copy must still see the photo.
test('a small copy this person is refused is replaced by the original, and not asked for again', async () => {
  const asked = [];
  const c = load(['managedPhotoPreviewUrl'], {
    photoPreviewCache: new Map(), unreadablePhotoPreviews: new Set(), SUPABASE_DOCUMENT_BUCKET: 'crm-documents',
    cloudClient: { storage: { from: () => ({ createSignedUrl: async (name) => {
      asked.push(name);
      return name.endsWith('/preview.jpg') ? { data: null, error: { message: 'Object not found' } } : { data: { signedUrl: `signed:${name}` }, error: null };
    } }) } },
  });
  const refused = { id: 'p1', storagePath: 'a/IMG_1.jpg', previewPath: 'a/preview.jpg' };
  assert.equal(await c.managedPhotoPreviewUrl(refused), 'signed:a/IMG_1.jpg');
  assert.equal(await c.managedPhotoPreviewUrl(refused), 'signed:a/IMG_1.jpg');
  assert.deepEqual(asked, ['a/preview.jpg', 'a/IMG_1.jpg'], 'one refused request for the small copy, one for the original, then remembered');
  // A photo whose original cannot be read either is still an error for the caller to handle.
  await assert.rejects(c.managedPhotoPreviewUrl({ id: 'p2', storagePath: 'b/preview.jpg', previewPath: 'b/preview.jpg' }));
});

test('small copies travel with the photo: kept on its record and listed for the file backup', () => {
  const c = load(['normalizeDocument'], { COMPANY_DOCUMENT_LEAD_ID: 'company', JOB_PHOTO_CATEGORY_ID: 'job_photos', defaultDocumentCategories: [], categoryForLegacyName: () => null, uid: () => 'doc-x', number: Number });
  assert.equal(c.normalizeDocument({ id: 'p', name: 'IMG.jpg', leadId: 'lead-1', previewPath: 'a/preview.jpg' }).previewPath, 'a/preview.jpg');
  assert.equal(Object.hasOwn(c.normalizeDocument({ id: 'p', name: 'IMG.jpg', leadId: 'lead-1' }), 'previewPath'), false, 'older photos gain no new field');
  assert.deepEqual(backup.storagePaths([
    { record_type: 'document', deleted_at: null, data: { storagePath: 'a/IMG.jpg', previewPath: 'a/preview.jpg' } },
    { record_type: 'document', deleted_at: null, data: { storagePath: 'b/old.jpg' } },
  ]), ['a/IMG.jpg', 'a/preview.jpg', 'b/old.jpg']);
});

test('leaving the page while files are still being sent asks first', () => {
  assert.match(source, /const uploadsUnderWay = leadUploads\.some\(\(item\) => LEAD_UPLOAD_ACTIVE\.includes\(item\.status\)\);/);
  assert.match(source, /isEditorSessionCurrent\(\) && \(state\.companyFormDraft \|\| uploadsUnderWay \|\|/);
});
