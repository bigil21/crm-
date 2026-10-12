const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument } = require('pdf-lib');
const { PGlite } = require('@electric-sql/pglite');
const { normalizeFields, normalizeResponses, renderCompletedDocument } = require('../smart-documents');

test('Smart Document validation preserves typed fields and enforces required responses', () => {
  const fields = normalizeFields([
    { id: 'customer-name', label: 'Customer Name', type: 'text', required: true, page: 1, x: 0.1, y: 0.2, width: 0.4, height: 0.04 },
    { id: 'approved', label: 'Approved', type: 'checkbox', required: true, page: 1, x: 0.1, y: 0.3, width: 0.04, height: 0.04 },
  ]);
  assert.deepEqual(normalizeResponses(fields, { 'customer-name': 'Jordan Blake', approved: true }, { requireComplete: true }), {
    'customer-name': 'Jordan Blake', approved: true,
  });
  assert.throws(() => normalizeResponses(fields, { 'customer-name': '', approved: false }, { requireComplete: true }), /smart_document_required_field_missing/);
  assert.throws(() => normalizeFields([{ id: 'email', label: 'Email', type: 'script' }]), /invalid_smart_document_field_type/);
  assert.throws(() => normalizeFields([{ id: 'bad', label: 'Bad', type: 'text', page: 1, x: .9, y: .2, width: .2, height: .04 }]), /invalid_smart_document_field_placement/);
});

test('completed Smart Document fills the original PDF field without appending a questionnaire page', async () => {
  const source = await PDFDocument.create();
  const page = source.addPage([612, 792]);
  const field = source.getForm().createTextField('Customer Name');
  field.addToPage(page, { x: 80, y: 650, width: 280, height: 28 });
  const bytes = Buffer.from(await source.save());
  const result = await renderCompletedDocument(
    { name: 'Agreement.pdf', type: 'application/pdf', size: bytes.length, bytes },
    { fields: [{ id: 'customer', label: 'Customer', sourceName: 'Customer Name', type: 'text', required: true, page: 1, x: 80 / 612, y: (792 - 678) / 792, width: 280 / 612, height: 28 / 792 }], responses: { customer: 'Jordan Blake' } },
    { name: 'Sales Representative' },
  );
  const completed = await PDFDocument.load(result.bytes);
  assert.equal(completed.getPageCount(), 1);
  assert.equal(completed.getForm().getFields().length, 0, 'completed form is flattened onto the original page');
  assert.deepEqual(result.filledSourceFields, ['Customer Name']);
  assert.equal(result.name, 'Agreement - Completed.pdf');
});

test('positioned Smart Document values are embedded on their original page', async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const bytes = Buffer.from(await source.save());
  const result = await renderCompletedDocument(
    { name: 'Work Order.pdf', type: 'application/pdf', size: bytes.length, bytes },
    { fields: [{ id: 'material', label: 'Material', type: 'text', required: true, page: 1, x: 0.2, y: 0.3, width: 0.35, height: 0.05, fontSize: 11 }], responses: { material: 'Architectural shingles' } },
    { name: 'Sales Representative' },
  );
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(result.bytes), disableWorker: true });
  const rendered = await loadingTask.promise;
  const text = await (await rendered.getPage(1)).getTextContent();
  assert.match(text.items.map(item => item.str).join(' '), /Architectural shingles/);
  assert.equal(rendered.numPages, 1);
  await loadingTask.destroy();
});

test('Smart Document RPC is service-only, row-locked, and bounded', () => {
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012043232_smart_document_positioned_fields.sql'), 'utf8');
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /jsonb_array_length\(p_smart_document->'fields'\) > 300/i);
  assert.match(migration, /revoke all on function public\.crm_save_smart_document[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
});

test('Smart Document RPC durably updates only the targeted document record', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table public.crm_records(
        company_state_id text not null, record_type text not null, id text not null,
        data jsonb not null default '{}', version bigint not null default 1,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz,
        primary key(company_state_id,record_type,id)
      );
      insert into public.crm_records(company_state_id,record_type,id,data)
      values('coastal-crest','document','doc-1','{"name":"Agreement.pdf"}');
    `);
    const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012041248_native_smart_documents.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261012043232_smart_document_positioned_fields.sql'), 'utf8'));
    const smart = { status: 'draft', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }], responses: { name: 'Jordan' } };
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select public.crm_save_smart_document($1,$2,$3::jsonb,$4::uuid)', ['coastal-crest','doc-1',JSON.stringify(smart),'00000000-0000-4000-8000-000000000001']), error => error.code === '42501');
    await db.exec('reset role; set role service_role');
    const saved = await db.query('select public.crm_save_smart_document($1,$2,$3::jsonb,$4::uuid) result', ['coastal-crest','doc-1',JSON.stringify(smart),'00000000-0000-4000-8000-000000000001']);
    assert.equal(saved.rows[0].result.saved, true);
    await db.exec('reset role');
    const row = (await db.query("select data,version from public.crm_records where id='doc-1'")).rows[0];
    assert.equal(row.data.smartDocument.responses.name, 'Jordan');
    assert.equal(Number(row.version), 2);
  } finally { await db.close(); }
});

test('lead and job document cards expose native Smart Document actions', () => {
  const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const styles = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
  assert.match(app, /data-action="open-smart-document"/);
  assert.match(app, /\/api\/smart-documents\/save/);
  assert.match(app, /\/api\/smart-documents\/email/);
  assert.match(page, /id="smartDocumentDialog"/);
  assert.match(page, /id="analyzeSmartDocument"/);
  assert.match(page, /id="smartDocumentPages"/);
  assert.match(app, /pdf\.min\.mjs/);
  assert.match(app, /renderSmartDocumentOverlays/);
  assert.match(app, /deleteSelectedSmartDocumentField/);
  assert.match(app, /use arrow keys for precise movement/);
  assert.match(page, /id="deleteSelectedSmartField"/);
  assert.match(styles, /\.smart-field-overlay\.selected/);
  assert.match(page, /Save Completed PDF/);
  assert.match(page, /Email Completed PDF/);
});
