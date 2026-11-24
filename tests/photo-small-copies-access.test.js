// Who may read a job photo's small gallery copy (to-do item 9).
// The file rules are the database's own: the policies the repo's schema and
// migrations put on storage.objects, run here for real in an in-memory
// PostgreSQL. Managers read every stored file. Anyone else reads only the
// files their own records name, and since this migration that includes the
// small copy kept beside a photo. Nothing here touches a network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEmptyDatabase } = require('../scripts/local-cloud.js');

const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261122220000_photo_small_copies_readable.sql'), 'utf8');
const ADMIN = { sub: '11111111-1111-4111-8111-111111111111', email: 'local-admin@coastalcrestroofing.com' };
const REP = { sub: '22222222-2222-4222-8222-222222222222', email: 'local-rep@coastalcrestroofing.com' };
const folder = (lead, photo) => `coastal-crest/${lead}/jobs/job-1/job_photos/${photo}/v1`;

// Two leads, one owned by the rep and one by the admin, each with a photo
// that has a small copy. The rep also owns a record that names, as its small
// copy, a file in someone else's folder.
const FILES = {
  repOriginal: `${folder('lead-rep', 'photo-1')}/IMG_0001.jpg`,
  repSmallCopy: `${folder('lead-rep', 'photo-1')}/preview.jpg`,
  repOtherOriginal: `${folder('lead-rep', 'photo-2')}/IMG_0002.jpg`,
  officeOriginal: `${folder('lead-office', 'photo-9')}/IMG_0009.jpg`,
  officeSmallCopy: `${folder('lead-office', 'photo-9')}/preview.jpg`,
  unrecorded: `${folder('lead-rep', 'photo-3')}/preview.jpg`,
};

async function database() {
  const db = await createEmptyDatabase({ quiet: true });
  const document = (id, lead, owner, data) => db.query(
    `insert into public.crm_records(company_state_id, record_type, id, lead_id, job_id, owner_id, data)
     values('coastal-crest', 'document', $1, $2, 'job-1', $3, $4)`, [id, lead, owner, JSON.stringify({ kind: 'photo', ...data })]);
  await db.exec('set session_replication_role = replica');
  await document('photo-1', 'lead-rep', REP.sub, { storagePath: FILES.repOriginal, previewPath: FILES.repSmallCopy });
  await document('photo-2', 'lead-rep', REP.sub, { storagePath: FILES.repOtherOriginal, previewPath: FILES.officeSmallCopy });
  await document('photo-9', 'lead-office', ADMIN.sub, { storagePath: FILES.officeOriginal, previewPath: FILES.officeSmallCopy });
  for (const name of Object.values(FILES)) await db.query("insert into storage.objects(bucket_id, name) values('crm-documents', $1)", [name]);
  await db.exec('set session_replication_role = origin');
  return db;
}

async function readableBy(db, user) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ ...user, role: 'authenticated' })]);
    await tx.exec('set local role authenticated');
    return (await tx.query("select name from storage.objects where bucket_id = 'crm-documents' order by name")).rows.map((row) => row.name);
  });
}

test('a rep reads their own photo and its small copy, and nothing of anyone else\'s', async () => {
  const db = await database();
  try {
    assert.deepEqual(await readableBy(db, REP), [FILES.repOriginal, FILES.repSmallCopy, FILES.repOtherOriginal].sort());
  } finally { await db.close(); }
});

test('naming a file in someone else\'s folder as a small copy does not make it readable', async () => {
  const db = await database();
  try {
    const seen = await readableBy(db, REP);
    assert.equal(seen.includes(FILES.officeSmallCopy), false, 'photo-2 names the office\'s small copy; the rep still cannot read it');
    assert.equal(seen.includes(FILES.officeOriginal), false);
    assert.equal(seen.includes(FILES.unrecorded), false, 'a preview.jpg no record names is not readable either');
  } finally { await db.close(); }
});

test('a manager still reads every stored file, and a deleted photo\'s small copy goes with it', async () => {
  const db = await database();
  try {
    assert.deepEqual(await readableBy(db, ADMIN), Object.values(FILES).sort());
    await db.exec(`set session_replication_role = replica;
      update public.crm_records set deleted_at = now() where record_type = 'document' and id = 'photo-1';
      set session_replication_role = origin;`);
    assert.deepEqual(await readableBy(db, REP), [FILES.repOtherOriginal]);
  } finally { await db.close(); }
});

test('before this migration a rep was refused the small copy, which is why it exists', async () => {
  const db = await database();
  try {
    // The rule as it stands on production today (from the migration of 2026-10-22).
    const before = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261022145711_critical_integrity_and_rep_scope.sql'), 'utf8')
      .match(/drop policy if exists "Approved CRM users read company document objects" on storage\.objects;[^]*?\n\);/);
    assert.ok(before, 'the earlier read rule is still in its migration');
    await db.exec(before[0]);
    assert.deepEqual(await readableBy(db, REP), [FILES.repOriginal, FILES.repOtherOriginal].sort(), 'originals only');
    await db.exec(migration);
    await db.exec(migration); // Safe to apply twice.
    assert.ok((await readableBy(db, REP)).includes(FILES.repSmallCopy));
  } finally { await db.close(); }
});

test('the migration changes the read rule only', () => {
  assert.equal((migration.match(/create policy/g) || []).length, 1);
  assert.match(migration, /on storage\.objects for select to authenticated/);
  assert.doesNotMatch(migration, /for (insert|update|delete)/);
  // Every earlier condition is still there.
  for (const kept of ["bucket_id='crm-documents'", 'public.is_coastal_crest_user()', "(storage.foldername(name))[1]=public.crm_base_state_id()",
    'public.can_manage_team_crm()', "(storage.foldername(name))[2]='company'", "r.data->>'storagePath'=storage.objects.name", "version_item.value->>'storagePath'=storage.objects.name"]) {
    assert.ok(migration.includes(kept), `still requires: ${kept}`);
  }
});
