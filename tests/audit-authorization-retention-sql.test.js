const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const root = path.resolve(__dirname, '..');
const db = new PGlite();
const ids = {
  admin: '10000000-0000-4000-8000-000000000001',
  manager: '10000000-0000-4000-8000-000000000002',
  sales: '10000000-0000-4000-8000-000000000003',
  otherSales: '10000000-0000-4000-8000-000000000004',
  viewer: '10000000-0000-4000-8000-000000000005',
  unapproved: '10000000-0000-4000-8000-000000000006',
};

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb default '{}'::jsonb);
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid,bucket_id text,name text,owner_id text);
    create function storage.foldername(text) returns text[] language sql immutable as
      $$select string_to_array(trim(both '/' from $1), '/')$$;
    grant usage on schema public,auth,storage to authenticated,anon,service_role;
    grant all on storage.objects to authenticated,service_role;
    alter table storage.objects enable row level security;
    insert into auth.users(id,email,raw_app_meta_data) values
      ('${ids.admin}','admin@coastalcrestroofing.com','{"role":"admin"}'),
      ('${ids.manager}','manager@coastalcrestroofing.com','{"role":"sales_manager"}'),
      ('${ids.sales}','sales@coastalcrestroofing.com','{"role":"sales"}'),
      ('${ids.otherSales}','other@coastalcrestroofing.com','{"role":"sales"}'),
      ('${ids.viewer}','viewer@coastalcrestroofing.com','{"role":"viewer"}'),
      ('${ids.unapproved}','pending@example.invalid','{"role":"admin"}');
  `);
  await db.exec(fs.readFileSync(path.join(root, 'supabase/schema.sql'), 'utf8'));
  await db.exec('grant all on all tables in schema public to authenticated,service_role;');
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20260914_conflict_safe_record_writes.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261014052721_audit_authorization_storage_retention.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20261022145711_critical_integrity_and_rep_scope.sql'), 'utf8'));
});

after(async () => db.close());

async function as(name) {
  await db.exec('reset role');
  if (name === 'service') {
    await db.query("select set_config('request.jwt.claims','{}',false)");
    await db.exec('set role service_role');
    return;
  }
  const id = ids[name];
  const email = name === 'unapproved' ? 'pending@example.invalid' : `${name === 'otherSales' ? 'other' : name}@coastalcrestroofing.com`;
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, email })]);
  await db.exec('set role authenticated');
}

const change = (id, expectedVersion = 0, ownerId) => ({
  company_state_id: 'coastal-crest', record_type: 'job', id, lead_id: id,
  expected_version: expectedVersion, data: { status: 'New' }, ...(ownerId ? { owner_id: ownerId } : {}),
});
async function commit(requestId, changes, events = []) {
  return db.query('select public.crm_commit_records($1,$2::jsonb,$3::jsonb) result',
    [requestId, JSON.stringify(changes), JSON.stringify(events)]);
}
const denied = fn => assert.rejects(fn, error => error.code === '42501');

test('approval registry and roles, not JWT metadata or domain alone, control access', async () => {
  await as('unapproved');
  await denied(() => commit('unapproved-write', []));
  await as('viewer');
  await denied(() => commit('viewer-write', [change('viewer-job')]));
});

test('sales can edit only owned records and managers can assign ownership', async () => {
  await as('sales');
  await commit('sales-create', [change('owned-job')]);
  await as('otherSales');
  assert.equal((await db.query("select id from public.crm_records where id='owned-job'")).rows.length, 0);
  await denied(() => commit('other-edit', [change('owned-job', 1)]));
  await as('manager');
  assert.equal((await db.query("select id from public.crm_records where id='owned-job'")).rows.length, 1);
  const result = await commit('manager-assign', [change('assigned-job', 0, ids.sales)]);
  assert.equal(result.rows[0].result.rows[0].owner_id, ids.sales);
});

test('unsafe record IDs and direct audit writes are rejected', async () => {
  await as('sales');
  await assert.rejects(() => commit('unsafe-id', [change('bad\" onclick=\"x')]), error => error.code === '22023');
  await denied(() => db.exec(`insert into public.crm_audit_events(id,company_state_id,lead_id) values('direct','coastal-crest','lead')`));
});

test('database rejects skipped stages and allows the next stage only after its gate', async () => {
  await as('sales');
  const contact = { company_state_id: 'coastal-crest', record_type: 'contact', id: 'gated-lead', lead_id: 'gated-lead', expected_version: 0,
    data: { name: 'Test Lead', phone: '(555) 555-0100', email: 'test@example.com', source: 'Referral', address: '1 Test Way', salesRep: 'Sales', notes: 'Roof replacement' } };
  const job = { ...change('gated-job'), lead_id: 'gated-lead', data: { status: 'New', address: '1 Test Way', salesRep: 'Sales', notes: 'Roof replacement' } };
  await commit('gate-create', [contact, job]);
  await assert.rejects(() => commit('gate-skip', [{ ...job, expected_version: 1, data: { ...job.data, status: 'Inspection' } }]),
    error => error.code === '23514' && error.message.includes('invalid_stage_transition'));
  await commit('gate-next', [{ ...job, expected_version: 1, data: { ...job.data, status: 'Contacted' } }]);
});

test('database refuses Paid until server-confirmed payments cover the contract', async () => {
  const checklist = { 'paid-job': { Completed: {
    'completion-photos': true, 'final-invoice': true, 'warranty-docs': true, walkthrough: true,
  } } };
  await db.exec('reset role');
  await db.query(`insert into public.crm_records
    (company_state_id,record_type,id,lead_id,job_id,owner_id,data,version,updated_by)
    values
    ('coastal-crest','contact','paid-lead','paid-lead',null,$1,$2::jsonb,1,$1),
    ('coastal-crest','job','paid-job','paid-lead','paid-job',$1,$3::jsonb,1,$1)`, [
    ids.sales,
    JSON.stringify({ name: 'Payment Gate', workflowChecklists: checklist }),
    JSON.stringify({ status: 'Completed', contractValue: 100, value: 100, paidAmount: 0 }),
  ]);
  await as('sales');
  const paidChange = {
    company_state_id: 'coastal-crest', record_type: 'job', id: 'paid-job', lead_id: 'paid-lead', job_id: 'paid-job',
    expected_version: 1, data: { status: 'Paid', contractValue: 100, value: 100, paidAmount: 100 },
  };
  await assert.rejects(() => commit('paid-spoof', [paidChange]),
    error => error.code === '23514' && error.message.includes('full_payment_required'));
  await db.exec('reset role');
  await db.exec(`update public.crm_records set data=jsonb_set(data,'{paidAmount}','100'::jsonb)
    where record_type='job' and id='paid-job'`);
  await as('sales');
  const result = await commit('paid-confirmed', [paidChange]);
  assert.equal(result.rows[0].result.rows[0].data.status, 'Paid');
});

test('storage objects are append-only and company-prefixed', async () => {
  await as('sales');
  await commit('storage-owner', [{
    company_state_id: 'coastal-crest', record_type: 'contact', id: 'lead', lead_id: 'lead', expected_version: 0,
    data: { name: 'Storage Owner' },
  }]);
  await db.exec(`insert into storage.objects(id,bucket_id,name,owner_id) values
    ('20000000-0000-4000-8000-000000000001','crm-documents','coastal-crest/lead/file.pdf','${ids.sales}')`);
  assert.equal((await db.query(`update storage.objects set name='coastal-crest/lead/changed.pdf' returning id`)).rows.length, 0);
  assert.equal((await db.query('delete from storage.objects returning id')).rows.length, 0);
  await denied(() => db.exec(`insert into storage.objects(id,bucket_id,name,owner_id) values
    ('20000000-0000-4000-8000-000000000002','crm-documents','other-company/file.pdf','${ids.sales}')`));
});

test('conversation authorship is derived and message bodies are immutable', async () => {
  await as('sales');
  await db.exec(`insert into public.crm_conversation_messages
    (id,company_state_id,lead_id,job_id,author_email,author_name,author_role,message_text,created_at)
    values('message-1','coastal-crest','lead','job','spoof@example.com','Spoof','admin','Original',now())`);
  let row = (await db.query("select * from public.crm_conversation_messages where id='message-1'")).rows[0];
  assert.equal(row.author_user_id, ids.sales);
  assert.equal(row.author_email, 'sales@coastalcrestroofing.com');
  await db.exec(`update public.crm_conversation_messages set message_text='Changed',read_by='["${ids.sales}"]' where id='message-1'`);
  row = (await db.query("select * from public.crm_conversation_messages where id='message-1'")).rows[0];
  assert.equal(row.message_text, 'Original');
  assert.deepEqual(row.read_by, [ids.sales]);
});

test('retention prunes operational rows without deleting business history', async () => {
  await db.exec('reset role');
  await db.exec(`
    insert into public.crm_audit_events(id,company_state_id,lead_id,event_type,created_at)
      values('old-commit','coastal-crest','lead','record_commit',now()-interval '100 days'),
            ('old-note','coastal-crest','lead','note',now()-interval '100 days');
    update public.crm_audit_events set created_at=now()-interval '100 days' where id in ('old-commit','old-note');
    insert into public.crm_backups(company_state_id,backup_date,payload,created_at)
      values('coastal-crest',current_date-40,'{}',now()-interval '40 days');
  `);
  await as('service');
  const result = await db.query('select public.crm_prune_operational_history() result');
  assert.equal(result.rows[0].result.recordCommits, 1);
  await db.exec('reset role');
  assert.equal((await db.query("select count(*)::int count from public.crm_audit_events where id='old-note'")).rows[0].count, 1);
});
