const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { create } = require('../sales-numbering.js');
const root = path.resolve(__dirname, '..');

test('browser numbering client sends only entity IDs and accepts an exact reservation', async () => {
  const calls = [];
  const client = create({ companyId: 'coastal-crest', rpc: async (name, payload) => {
    calls.push({ name, payload });
    return { data: { leadId: 'lead-1', jobId: 'job-1', estimateId: 'estimate-1', leadNumber: 'LD-20260916-000001',
      projectNumber: 'LD-20260916-000001-P01', estimateNumber: 'EST-1001' } };
  } });
  const result = await client.reserve({ leadId: 'lead-1', jobId: 'job-1', estimateId: 'estimate-1' });
  assert.equal(result.estimateNumber, 'EST-1001');
  assert.deepEqual(calls, [{ name: 'crm_reserve_sales_numbers', payload: { p_company: 'coastal-crest', p_lead_id: 'lead-1', p_job_id: 'job-1', p_estimate_id: 'estimate-1' } }]);
});

test('browser numbering client rejects malformed scope and unconfirmed replies', async () => {
  const client = create({ companyId: 'coastal-crest', rpc: async () => ({ data: { leadId: 'other' } }) });
  await assert.rejects(client.reserve({ leadId: 'bad id' }), /Valid lead/);
  await assert.rejects(client.reserve({ leadId: 'lead-1', estimateId: 'estimate-1' }), /Valid lead/);
  await assert.rejects(client.reserve({ leadId: 'lead-1' }), /invalid number reservation/);
});

test('browser numbering timeout does not invent a local number', async () => {
  const client = create({ companyId: 'coastal-crest', timeoutMs: 5, rpc: () => new Promise(() => {}) });
  await assert.rejects(client.reserve({ leadId: 'lead-1' }), /timed out/);
});

test('database reservations are stable, unique, scoped and required by writes', async () => {
  const db = new PGlite();
  const admin = '00000000-0000-4000-8000-000000000081', sales = '00000000-0000-4000-8000-000000000082';
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
      create table storage.objects(id uuid,bucket_id text);
      grant usage on schema public,auth,storage to anon,authenticated;`);
    await db.query('insert into auth.users values($1,$2,$3),($4,$5,$6)', [admin, 'admin@coastalcrestroofing.com', { role: 'admin' }, sales, 'sales@coastalcrestroofing.com', { role: 'sales' }]);
    await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
    await db.exec('grant all on all tables in schema public to authenticated;');
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20260914_conflict_safe_record_writes.sql'), 'utf8'));
    // Historical numbers are registered without renumbering.
    await db.query(`insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,data,owner_id,updated_by) values
      ('coastal-crest','contact','old-lead','old-lead',null,$1,$4,$4),
      ('coastal-crest','job','old-job','old-lead','old-job',$2,$4,$4),
      ('coastal-crest','estimate','old-estimate','old-lead','old-job',$3,$4,$4)`,
      [{ id: 'old-lead', leadNumber: 'LD-20260915-000111' }, { id: 'old-job', projectNumber: 'LD-20260915-000111-P01' },
        { id: 'old-estimate', contactId: 'old-lead', jobId: 'old-job', leadNumber: 'LD-20260915-000111', projectNumber: 'LD-20260915-000111-P01', estimateNumber: 'EST-1042' }, admin]);
    const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20260916_atomic_sales_numbers.sql'), 'utf8');
    await db.exec(migration);
    const claims = { sub: sales, email: 'sales@coastalcrestroofing.com', app_metadata: { role: 'sales' } };
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]); await db.exec('set role authenticated');
    const reserve = (lead, job, estimate) => db.query('select public.crm_reserve_sales_numbers($1,$2,$3,$4) result', ['coastal-crest', lead, job, estimate]);
    const [one, two] = await Promise.all([reserve('lead-a', 'job-a', 'estimate-a'), reserve('lead-b', 'job-b', 'estimate-b')]);
    const a = one.rows[0].result, b = two.rows[0].result;
    assert.notEqual(a.leadNumber, b.leadNumber); assert.notEqual(a.estimateNumber, b.estimateNumber);
    assert.equal(a.projectNumber, `${a.leadNumber}-P01`); assert.equal(b.projectNumber, `${b.leadNumber}-P01`);
    assert.deepEqual((await reserve('lead-a', 'job-a', 'estimate-a')).rows[0].result, a);
    await assert.rejects(reserve('lead-b', 'job-a', null), /project_number_parent_conflict/);
    await assert.rejects(db.query('select public.crm_reserve_sales_numbers($1,$2,$3,$4)', ['other', 'lead-c', null, null]), /invalid_sales_number_scope/);
    const change = { company_state_id: 'coastal-crest', record_type: 'contact', id: 'lead-a', lead_id: 'lead-a', job_id: null,
      expected_version: 0, data: { id: 'lead-a', leadNumber: a.leadNumber } };
    const saved = await db.query('select public.crm_commit_records($1,$2::jsonb,$3::jsonb) result', ['number-save', [change], []]);
    assert.equal(saved.rows[0].result.rows[0].data.leadNumber, a.leadNumber);
    await assert.rejects(db.query('select public.crm_commit_records($1,$2::jsonb,$3::jsonb)', ['forged-save', [{ ...change, id: 'forged', lead_id: 'forged', data: { id: 'forged', leadNumber: a.leadNumber } }], []]), /sales_number_not_reserved/);
    await db.exec('reset role');
    assert.equal((await db.query("select count(*)::integer n from public.crm_sales_numbers where entity_id like 'old-%'" )).rows[0].n, 3);
    await db.exec(migration);
    assert.equal((await db.query("select count(*)::integer n from public.crm_sales_numbers where entity_id like 'old-%'" )).rows[0].n, 3);
  } finally { await db.close(); }
});
