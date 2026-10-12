const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261005_google_drive_documents.sql'), 'utf8');
const db = new PGlite();
const actor = '00000000-0000-4000-8000-000000000001';

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table public.crm_records(
      company_state_id text not null, record_type text not null, id text not null,
      lead_id text, job_id text, owner_id uuid, data jsonb not null default '{}',
      version integer not null default 1, updated_by uuid, updated_at timestamptz default now(), deleted_at timestamptz,
      primary key(company_state_id,record_type,id)
    );
    insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,owner_id,data)
    values('coastal-crest','document','doc-1','lead-1','job-1','${actor}','{"name":"estimate.pdf","versionNumber":1}');
  `);
  await db.exec(migration);
});
after(() => db.close());

async function attach(fileId, version = 1) {
  return (await db.query(`select public.crm_attach_google_drive_document(
    'coastal-crest','doc-1',$1,'https://drive.google.com/file/d/${fileId}/view',
    'lead-folder','job-folder','category-folder',$2,'${actor}'::uuid
  ) as result`, [fileId, version])).rows[0].result;
}

test('Drive attachment RPC is denied to browser roles', async () => {
  await db.exec('set role authenticated');
  await assert.rejects(() => attach('drive-file-1'), error => error.code === '42501');
  await db.exec('reset role');
});

test('service role attaches one Drive file idempotently and increments the durable version', async () => {
  await db.exec('set role service_role');
  const first = await attach('drive-file-1');
  assert.equal(first.saved, true);
  await db.exec('reset role');
  const afterFirst = (await db.query("select data,version from public.crm_records where id='doc-1'")).rows[0];
  assert.equal(afterFirst.data.googleDrive.fileId, 'drive-file-1');
  assert.equal(afterFirst.data.googleDrive.versionNumber, 1);
  assert.equal(afterFirst.version, 2);
  await db.exec('set role service_role');
  await attach('drive-file-1');
  await db.exec('reset role');
  const afterRetry = (await db.query("select data,version from public.crm_records where id='doc-1'")).rows[0];
  assert.equal(afterRetry.version, 2);
  await db.exec('set role service_role');
  await assert.rejects(() => attach('different-file', 1), /google_drive_version_already_attached/);
  await db.exec('reset role');
});

test('a new CRM document version may attach a new immutable Drive copy', async () => {
  await db.exec('set role service_role');
  await attach('drive-file-2', 2);
  await db.exec('reset role');
  const row = (await db.query("select data from public.crm_records where id='doc-1'")).rows[0];
  assert.equal(row.data.googleDrive.fileId, 'drive-file-2');
  assert.equal(row.data.googleDrive.versionNumber, 2);
});
