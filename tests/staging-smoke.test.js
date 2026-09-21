const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
test('hosted staging smoke script validates ten checks and rolls fixtures back', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text);
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid,bucket_id text);
      grant usage on schema public,auth,storage to authenticated,anon;`);
    await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
    await db.exec('grant all on all tables in schema public to authenticated;');
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20260914_conflict_safe_record_writes.sql'), 'utf8'));
    const results = await db.exec(fs.readFileSync(path.join(root, 'supabase/staging-permissions-smoke.sql'), 'utf8'));
    const checks = results.find(r => r.rows?.[0]?.staging_results).rows[0].staging_results;
    assert.equal(checks.length, 10);
    assert.ok(checks.every(c => c.passed));
    for (const table of ['auth.users', 'public.crm_records', 'public.crm_audit_events', 'public.crm_write_receipts']) {
      assert.equal((await db.query(`select count(*)::int as count from ${table}`)).rows[0].count, 0);
    }
  } finally { await db.close(); }
});
