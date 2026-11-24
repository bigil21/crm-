// The website's quote requests can be restored into a database built from this
// repo.
//
// Found after release b37d18c: the live project had a quote_requests table and
// a quote-photos bucket that were made there directly, and the repo had
// neither. A backup held the ten quote requests, and a database rebuilt from
// the repo had no table to put them back into. Two migrations now make both.
//
// A migration written by reading the live table is only as good as the reading.
// So the description of the live table was taken from the live project with
// the query below and saved in tests/fixtures/quote-requests-production.json,
// and here the same query is put to a database built from the repo. The two
// must agree on every column, limit, index, rule and permission. Nothing here
// touches a network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createEmptyDatabase } = require('../scripts/local-cloud.js');
const restore = require('../scripts/restore-backup.js');

const production = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'quote-requests-production.json'), 'utf8'));
const ADMIN = '11111111-1111-4111-8111-111111111111';

// The query the fixture was made with. One thing was added afterwards, and it
// changes nothing on the live project: "contype <> 'n'". The test database is
// PostgreSQL 18, which lists every NOT NULL as a constraint of its own; the
// live project is 17, which does not. Whether a column may be empty is compared
// all the same, as part of each column.
const DESCRIBE = `select jsonb_build_object(
  'columns', (select jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid)) order by a.attnum)
     from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = 'public.quote_requests'::regclass and a.attnum > 0 and not a.attisdropped),
  'constraints', (select jsonb_object_agg(conname, pg_get_constraintdef(oid)) from pg_constraint where conrelid = 'public.quote_requests'::regclass and contype <> 'n'),
  'indexes', (select jsonb_object_agg(indexname, indexdef) from pg_indexes where schemaname = 'public' and tablename = 'quote_requests'),
  'rowSecurity', (select relrowsecurity from pg_class where oid = 'public.quote_requests'::regclass),
  'policies', (select jsonb_agg(jsonb_build_object('name', policyname, 'command', cmd, 'roles', roles::text[], 'permissive', permissive, 'using', qual, 'check', with_check) order by policyname) from pg_policies where schemaname = 'public' and tablename = 'quote_requests'),
  'may', (select jsonb_object_agg(r || ' ' || p, has_table_privilege(r, 'public.quote_requests', p)) from unnest(array['anon','authenticated','service_role']) r, unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) p),
  'bucket', (select jsonb_build_object('public', public, 'limit', file_size_limit, 'types', allowed_mime_types) from storage.buckets where id = 'quote-photos'),
  'storagePolicies', (select jsonb_agg(jsonb_build_object('name', policyname, 'command', cmd, 'roles', roles::text[], 'using', qual, 'check', with_check) order by policyname) from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual,'') || coalesce(with_check,'')) like '%quote-photos%')
) as definition`;

const sorted = (object) => Object.fromEntries(Object.entries(object || {}).sort(([a], [b]) => a.localeCompare(b)));
const asVisitor = async (db, work) => {
  await db.exec(`begin; set local role anon; select set_config('request.jwt.claims', '{"role":"anon"}', true);`);
  try { return await work(); } finally { await db.exec('rollback'); }
};
const REQUEST = `insert into public.quote_requests(reference, segment, division, urgency, services, first_name, last_name, phone, email, street, city, zip, contact_pref, consent, photo_paths`;
const VALUES = `values('CC-202611-0002', 'residential', 'roofing', 'Within 2 weeks', array['Roof repair'], 'TEST', 'Visitor', '(555) 010-0199', 'visitor@example.com', '1 Example Street', 'Naples', '34102', 'Email'`;

test('a database built from the repo has the quote requests table exactly as the live project has it', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    const built = (await db.query(DESCRIBE)).rows[0].definition;
    assert.deepEqual(built.columns, production.columns, 'the same columns, in the same order, with the same defaults');
    assert.deepEqual(sorted(built.constraints), sorted(production.constraints), 'the same limits on what a request may hold');
    assert.deepEqual(sorted(built.indexes), sorted(production.indexes));
    assert.equal(built.rowSecurity, production.rowSecurity);
    assert.deepEqual(built.policies, production.policies, 'the one rule: a visitor may hand in a new request');
    assert.deepEqual(sorted(built.may), sorted(production.may), 'who may read and write it');
    assert.deepEqual(built.bucket, production.bucket, 'the photo bucket: private, images only, 10 MB a file');
    assert.deepEqual(built.storagePolicies, production.storagePolicies, 'the one rule on the photo bucket');
  } finally { await db.close(); }
});

test('every migration in the repo applies to a new database, the one that alters quote requests included', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  let db;
  try { db = await createEmptyDatabase(); } finally { console.log = original; }
  try {
    assert.deepEqual(lines.filter((line) => line.includes('skipped')), [], 'no migration was skipped');
    // The files that make the table and the bucket carry the names recorded on
    // the live project, so nothing there is applied a second time under a new name.
    const names = fs.readdirSync(path.join(__dirname, '..', 'supabase', 'migrations'));
    assert.ok(names.includes('20261020175804_create_staging_quote_requests.sql'));
    assert.ok(names.includes('20261029211854_attach_website_quote_photos.sql'));
    // The table is made before the migration that alters it is reached.
    const order = names.filter((name) => name.endsWith('.sql')).sort();
    assert.ok(order.indexOf('20261020175804_create_staging_quote_requests.sql') < order.indexOf('20261029095500_quote_request_import_status.sql'));
  } finally { await db?.close(); }
});

test('where the table and the bucket already exist, the two migrations change nothing', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    // The live project's case: the table is there, with requests in it.
    await restore.seedEveryTable(db, { companyId: 'coastal-crest', userId: ADMIN });
    const fingerprint = async () => ({
      definition: (await db.query(DESCRIBE)).rows[0].definition,
      rows: (await db.query(`select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by id), '')) as hash, count(*)::int as n from public.quote_requests t`)).rows[0],
      buckets: (await db.query('select * from storage.buckets order by id')).rows,
    });
    const before = await fingerprint();
    assert.equal(before.rows.n, 1);
    for (const name of ['20261020175804_create_staging_quote_requests.sql', '20261029211854_attach_website_quote_photos.sql']) {
      const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', name), 'utf8');
      await db.exec(sql);
      await db.exec(sql);
      // Neither file removes or replaces anything, and neither holds the office-notification trigger or its secret.
      assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\bdrop\b|\btruncate\b|\bdelete\b|create\s+trigger|http_request|bearer|authorization/i, name);
    }
    assert.deepEqual(await fingerprint(), before);
  } finally { await db.close(); }
});

test('a visitor can hand in a request and can do nothing else with the table', async () => {
  const db = await createEmptyDatabase({ quiet: true });
  try {
    await asVisitor(db, async () => {
      await db.query(`${REQUEST}) ${VALUES}, true, array['0f8fad5b-d9cb-469f-a165-70867728950e/TEST-roof.png'])`);
    });
    // Not without consent, not already marked as handled, not with office notes, not with more than ten photos.
    for (const [why, sql] of [
      ['no consent', `${REQUEST}) ${VALUES}, false, '{}')`],
      ['a status of its own choosing', `${REQUEST}, status) ${VALUES}, true, '{}', 'won')`],
      ['office notes', `${REQUEST}, office_notes) ${VALUES}, true, '{}', 'TEST note')`],
      ['eleven photos', `${REQUEST}) ${VALUES}, true, array(select 'p' || n from generate_series(1, 11) n))`],
    ]) {
      await assert.rejects(asVisitor(db, () => db.query(sql)), /row-level security/, why);
    }
    // And not read, change or remove one.
    for (const sql of ['select count(*) from public.quote_requests', `update public.quote_requests set status = 'won'`, 'delete from public.quote_requests']) {
      await assert.rejects(asVisitor(db, () => db.query(sql)), /permission denied/, sql);
    }
    // The limits themselves hold for everyone, the server included.
    await assert.rejects(db.query(`${REQUEST}) ${VALUES.replace('CC-202611-0002', 'not a reference')}, true, '{}')`), /quote_requests_reference_check/);
    await assert.rejects(db.query(`${REQUEST}) ${VALUES.replace(`'34102'`, `'3410'`)}, true, '{}')`), /quote_requests_zip_check/);
  } finally { await db.close(); }
});
