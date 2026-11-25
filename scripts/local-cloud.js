// JobCrest local cloud: a signed-in, cloud-mode copy of the CRM that runs
// entirely on this computer.
//
//   - The database is a real PostgreSQL (PGlite, in memory) built from the
//     repo's own supabase/schema.sql and every migration, so row-level
//     security, grants, triggers and RPC functions behave as written.
//   - A small server on port 4321 speaks the parts of the Supabase API the CRM
//     uses (sign-in, tables, RPC, file links).
//   - The CRM itself is the repo's untouched code, served on port 4320 with
//     one change: /auth-config.js points it at the local server above.
//
// Nothing here talks to the internet or to the live database. All data is
// made-up test data and disappears when the process stops.
//
// Run:  npm run local-cloud
// Open: http://localhost:4320
// The two test accounts (an admin and a sales rep) get new passwords on every
// start. They are written to a file in this computer's temp folder, whose path
// is printed when the copy is ready; nothing is written inside the repo.
//
// Tests start it in-process with require('./local-cloud.js').start({ ... }).
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const os = require('node:os');
const { spawn } = require('node:child_process');

const REPO = process.env.JOBCREST_REPO || path.resolve(__dirname, '..');
let APP_PORT = Number(process.env.LOCAL_APP_PORT || 4320);
let CLOUD_PORT = Number(process.env.LOCAL_CLOUD_PORT || 4321);
let STATIC_PORT = Number(process.env.LOCAL_STATIC_PORT || 4322);
let CLOUD_ORIGIN = `http://localhost:${CLOUD_PORT}`;
let QUIET = false;
const ACCOUNTS_FILE = path.join(os.tmpdir(), 'jobcrest-local-cloud', 'local-test-accounts.json');
const COMPANY = 'coastal-crest';
const ANON_KEY = 'local-anon-key';
// What the CRM's own server uses for its background work (the daily backup).
// It is new on every start and is only handed to code that started this copy.
const SERVICE_KEY = `sb_secret_local_${crypto.randomBytes(18).toString('base64url')}`;
const { PGlite } = require(path.join(REPO, 'node_modules/@electric-sql/pglite'));

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'local-admin@coastalcrestroofing.com', role: 'admin', name: 'Local Admin' };
const REP = { id: '22222222-2222-4222-8222-222222222222', email: 'local-rep@coastalcrestroofing.com', role: 'sales', name: 'Local Rep' };
const accounts = [ADMIN, REP].map((user) => ({ ...user, password: crypto.randomBytes(12).toString('base64url') }));
function writeAccountsFile() {
  fs.mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: true });
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify({
    note: 'Local test accounts for the in-memory JobCrest database. They exist only while the local copy is running and are regenerated on every start.',
    url: `http://localhost:${APP_PORT}`,
    accounts: accounts.map(({ email, password, role }) => ({ email, password, role })),
  }, null, 2));
}

let db;
const state = { accessProfile: 'ok', requests: [], errors: [], delays: [], faults: [], storage: new Map(), missingFiles: new Set(), bootLog: [] };
const log = (line) => { state.bootLog.push(line); if (!QUIET) console.log(line); };

// ---------------------------------------------------------------- database
// A new, empty database with the CRM's tables, rules and functions and the two
// test accounts, and no records. buildDatabase() makes the one this copy runs
// on; the restore drill makes a second one to restore a backup into.
async function createEmptyDatabase({ quiet = false } = {}) {
  const note = quiet ? () => {} : log;
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role supabase_auth_admin nologin;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb default '{}'::jsonb,
      raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
    create function auth.jwt() returns jsonb language sql stable as
      $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub', '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select coalesce(auth.jwt()->>'role', 'anon') $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text, owner_id text, owner uuid, metadata jsonb, created_at timestamptz default now());
    -- As on the hosted project: every folder of a file's path, without its name.
    create function storage.foldername(name text) returns text[] language sql immutable as
      $$ select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1] $$;
    -- Who may store and read which file is decided by the rules the repo's own
    -- schema and migrations put on this table, as it is on the hosted project.
    alter table storage.objects enable row level security;
    grant select, insert on storage.objects to authenticated;
    grant all on storage.objects to service_role;
    grant usage on schema public, auth, storage to anon, authenticated, service_role, supabase_auth_admin;
    -- Supabase grants new objects in "public" to the API roles by default; the
    -- migrations then revoke what each table should not allow.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  `);
  for (const user of accounts) {
    await db.query('insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values($1,$2,$3,$4)',
      [user.id, user.email, JSON.stringify({ role: user.role }), JSON.stringify({ name: user.name })]);
  }
  const migrations = fs.readdirSync(path.join(REPO, 'supabase/migrations')).filter((name) => name.endsWith('.sql')).sort();
  // Two files share a date prefix but depend on each other in this order.
  const inbox = migrations.indexOf('20260915_square_webhook_inbox.sql');
  const reconciliation = migrations.indexOf('20260915_square_payment_reconciliation.sql');
  if (inbox > reconciliation && reconciliation >= 0) { migrations.splice(inbox, 1); migrations.splice(reconciliation, 0, '20260915_square_webhook_inbox.sql'); }
  const steps = [['schema.sql', path.join(REPO, 'supabase/schema.sql')], ...migrations.map((name) => [name, path.join(REPO, 'supabase/migrations', name)])];
  let applied = 0;
  for (const [name, file] of steps) {
    try {
      await db.exec(fs.readFileSync(file, 'utf8'));
      applied += 1;
    } catch (error) {
      try { await db.exec('rollback'); } catch { /* not in a transaction */ }
      note(`[database] skipped ${name}: ${String(error.message).slice(0, 160)}`);
    }
    if (name === 'schema.sql') {
      // The hosted project has this Auth trigger helper from its original setup.
      await db.exec(`create or replace function public.apply_crm_admin_metadata() returns trigger language plpgsql security definer set search_path=public as $$ begin return new; end; $$;`);
    }
  }
  note(`[database] built from schema.sql and ${applied - 1} of ${migrations.length} migrations`);
  for (const user of accounts) {
    await db.query(`insert into public.crm_user_access(user_id,email,role,approved,approved_at) values($1,$2,$3,true,clock_timestamp())
      on conflict(user_id) do update set role=excluded.role, approved=true, email=excluded.email`, [user.id, user.email, user.role]);
  }
  return db;
}
async function buildDatabase() {
  db = await createEmptyDatabase();
}

// Deterministic made-up data: enough leads and jobs to go well past the first
// page of 100 that the CRM loads at startup.
function seedRows() {
  const rows = [];
  const pipelines = {
    roofing: ['New', 'Contacted', 'Inspection', 'Estimate Sent', 'Won', 'Scheduled', 'Materials Ordered', 'In Progress', 'Completed', 'Paid', 'Lost'],
    construction: ['New', 'Consultation', 'Design & Selections', 'Estimate', 'Contract', 'Permits', 'Demo', 'Rough-In', 'Inspections', 'Finishes', 'Punch List', 'Final Walkthrough', 'Paid', 'Lost'],
    services: ['New', 'Request', 'Scheduled', 'Completed', 'Invoiced', 'Paid', 'Lost'],
  };
  const services = { roofing: ['roof-replacement', 'roof-repair'], construction: ['remodel-addition', 'windows-impact-openings'], services: ['pressure-washing', 'service-call'] };
  const soldFrom = { roofing: 'Won', construction: 'Contract', services: 'Scheduled' };
  const sources = ['Website', 'Referral', 'Google', 'Yard sign', 'Repeat customer'];
  const day = (offset) => new Date(Date.UTC(2026, 10, 22) - offset * 86400000);
  const iso = (date) => date.toISOString();
  const dateOnly = (date) => date.toISOString().slice(0, 10);
  let jobCount = 0;
  for (let index = 1; index <= 236; index += 1) {
    const owner = index % 3 === 0 ? REP : ADMIN;
    const leadId = `lead_local_${String(index).padStart(4, '0')}`;
    const created = day(400 - index);
    const jobsForLead = index % 5 === 0 ? 2 : 1;
    const jobs = [];
    for (let jobIndex = 0; jobIndex < jobsForLead; jobIndex += 1) {
      jobCount += 1;
      const division = ['roofing', 'roofing', 'construction', 'services'][(index + jobIndex) % 4];
      const stages = pipelines[division];
      // Spread jobs across every stage of every division.
      const status = stages[(index * 31 + jobIndex * 17 + (index >> 2)) % stages.length];
      const value = 1500 + ((index * 937 + jobIndex * 211) % 400) * 100;
      const stageIndex = stages.indexOf(status);
      const sold = status !== 'Lost' && stageIndex >= stages.indexOf(soldFrom[division]);
      const paidInFull = status === 'Paid';
      const payments = [];
      if (paidInFull) payments.push({ id: `pay_${leadId}_${jobIndex}_full`, date: dateOnly(day(index % 150)), method: 'Check', amount: value, reference: `CHK-${1000 + index}`, note: '', createdBy: owner.name, createdAt: iso(day(index % 150)) });
      else if (sold && index % 2 === 0) payments.push({ id: `pay_${leadId}_${jobIndex}_dep`, date: dateOnly(day(index % 150)), method: 'ACH', amount: Math.round(value * 0.3), reference: '', note: 'Deposit', createdBy: owner.name, createdAt: iso(day(index % 150)) });
      const costs = sold && index % 4 === 0 ? [{ id: `cost_${leadId}_${jobIndex}`, date: dateOnly(day(index % 120)), category: 'Materials', vendor: 'Test Supply Co', description: 'Materials', amount: Math.round(value * 0.35), paid: true, reference: '', createdAt: iso(day(index % 120)), createdBy: owner.name }] : [];
      const paidAmount = payments.reduce((sum, payment) => sum + payment.amount, 0);
      const jobId = `job_local_${String(index).padStart(4, '0')}_${jobIndex + 1}`;
      jobs.push({
        id: jobId, name: `TEST ${division === 'roofing' ? 'Roof' : division === 'construction' ? 'Remodel' : 'Service'} job ${index}${jobIndex ? 'b' : ''}`,
        status, division, service: services[division][index % 2], propertyType: index % 11 === 0 ? 'hoa' : 'residential', urgency: 'normal',
        insuranceClaim: false, activeLeak: false, value, contractValue: value, paidAmount, squarePaidAmount: 0, manualPayments: payments, costItems: costs,
        salesRep: owner.name, ownerUserId: owner.id, ownerEmail: owner.email, ownerName: owner.name,
        address: `${100 + index} Example Street\nNaples, FL 34102`, lastContact: dateOnly(day(index % 90)), createdAt: dateOnly(created),
        updatedAt: iso(day(index % 200)), closedDate: sold ? dateOnly(day(index % 150)) : '', notes: 'Made-up job for local testing.',
      });
    }
    const primary = jobs[0];
    rows.push({ type: 'contact', id: leadId, lead: leadId, job: null, owner: owner.id, updated: day(index % 200), data: {
      id: leadId, type: jobs.some((job) => job.paidAmount > 0) ? 'Customer' : 'Lead', status: primary.status, name: `TEST Lead ${String(index).padStart(3, '0')}`,
      source: sources[index % sources.length], email: `lead${index}@example.com`, phone: `(555) 01${String(index % 100).padStart(2, '0')}-${String(1000 + index).slice(-4)}`,
      address: primary.address, value: jobs.reduce((sum, job) => sum + job.value, 0), salesRep: owner.name, ownerUserId: owner.id, ownerEmail: owner.email, ownerName: owner.name,
      division: primary.division, service: primary.service, propertyType: primary.propertyType, urgency: 'normal', insuranceClaim: false, activeLeak: false,
      lastContact: primary.lastContact, createdAt: dateOnly(created), updatedAt: iso(day(index % 200)), closedDate: primary.closedDate, notes: 'Made-up lead for local testing.',
    } });
    jobs.forEach((job) => rows.push({ type: 'job', id: job.id, lead: leadId, job: job.id, owner: owner.id, updated: day(index % 200), data: job }));
    // A few photos, stored the way an upload to cloud storage records them.
    if (index <= 3) {
      for (let photo = 1; photo <= 4; photo += 1) {
        const documentId = `doc_local_${index}_${photo}`;
        rows.push({ type: 'document', id: documentId, lead: leadId, job: primary.id, owner: owner.id, updated: day(photo), data: {
          id: documentId, name: `TEST site photo ${photo}.png`, kind: 'photo', leadId, jobId: primary.id, categoryId: 'job_photos', category: 'Job Photos',
          type: 'image/png', size: 24000 + photo, storagePath: `${COMPANY}/${leadId}/jobs/${primary.id}/job_photos/${documentId}/v1/site-photo-${photo}.png`,
          uploadedAt: iso(day(photo)), uploadedBy: owner.name, versionNumber: 1,
        } });
      }
    }
  }
  return { rows, jobCount };
}

async function seedDatabase() {
  await db.query(`insert into public.crm_state(id,data,owner_id,owner_email,updated_by) values($1,$2,$3,$4,$3) on conflict(id) do nothing`,
    [`${COMPANY}:company`, JSON.stringify({ company: { name: 'Local Test Roofing Co', phone: '(555) 010-0000', email: 'office@example.com', address: '1 Example Plaza\nNaples, FL 34102', defaultTerms: 'Net 14' } }), ADMIN.id, ADMIN.email]);
  const { rows, jobCount } = seedRows();
  for (let offset = 0; offset < rows.length; offset += 100) {
    const batch = rows.slice(offset, offset + 100).map((row) => ({
      company_state_id: COMPANY, record_type: row.type, id: row.id, lead_id: row.lead, job_id: row.job, owner_id: row.owner,
      data: row.data, version: 1, updated_at: row.updated.toISOString(), created_at: row.updated.toISOString(), updated_by: row.owner,
    }));
    await db.query(`insert into public.crm_records(company_state_id,record_type,id,lead_id,job_id,owner_id,data,version,updated_at,created_at,updated_by)
      select company_state_id,record_type,id,lead_id,job_id,owner_id,data,version,updated_at,created_at,updated_by
      from jsonb_populate_recordset(null::public.crm_records, $1::jsonb)`, [JSON.stringify(batch)]);
  }
  log(`[database] seeded ${rows.filter((row) => row.type === 'contact').length} leads, ${jobCount} jobs, ${rows.filter((row) => row.type === 'document').length} photos`);
}

// What the database itself says the totals are, for comparing with the screen.
async function truth() {
  const result = await db.query(`
    with jobs as (select data, lead_id from public.crm_records where company_state_id=$1 and record_type='job' and deleted_at is null),
    payments as (select (p->>'amount')::numeric amount from jobs, jsonb_array_elements(coalesce(data->'manualPayments','[]'::jsonb)) p),
    costs as (select (c->>'amount')::numeric amount from jobs, jsonb_array_elements(coalesce(data->'costItems','[]'::jsonb)) c)
    select
      (select count(*) from public.crm_records where company_state_id=$1 and record_type='contact' and deleted_at is null)::int as leads,
      (select count(*) from jobs)::int as jobs,
      (select count(distinct lead_id) from jobs where data->>'status' not in ('Paid','Lost'))::int as leads_with_open_jobs,
      (select coalesce(sum((data->>'value')::numeric),0) from jobs where data->>'status' <> 'Lost')::float8 as pipeline_value,
      (select count(*) from jobs where (data->>'contractValue')::numeric > 0 and (data->>'paidAmount')::numeric + 0.005 >= (data->>'contractValue')::numeric)::int as jobs_paid_in_full,
      (select coalesce(sum(amount),0) from payments)::float8 as job_payments,
      (select coalesce(sum(amount),0) from costs)::float8 as job_costs,
      (select coalesce(sum(amount),0) from public.crm_payments where company_state_id=$1 and origin <> 'job')::float8 as invoice_payments,
      (select coalesce(sum(amount),0) from public.crm_payments where company_state_id=$1 and origin = 'job')::float8 as payment_rows_from_jobs,
      (select count(*) from public.crm_payments where company_state_id=$1 and origin = 'job')::int as payment_row_count_from_jobs,
      (select count(*) from payments)::int as job_payment_count,
      (select coalesce(sum(amount),0) from public.crm_expenses where company_state_id=$1)::float8 as recorded_expenses,
      (select count(*) from public.crm_records where company_state_id=$1 and record_type='estimate' and deleted_at is null)::int as estimates,
      (select count(*) from public.crm_backups where company_state_id=$1)::int as backups,
      (select max(record_count) from public.crm_backups where company_state_id=$1)::int as backup_record_count,
      (select count(*) from public.crm_records where company_state_id=$1 and deleted_at is null and record_type in ('contact','job','estimate','task'))::int as core_records
  `, [COMPANY]);
  return result.rows[0];
}

// ------------------------------------------------------------------- helpers
const b64url = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
function issueSession(user) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { aud: 'authenticated', role: 'authenticated', sub: user.id, email: user.email, iat: now, exp: now + 3600,
    app_metadata: { role: user.role, provider: 'email' }, user_metadata: { name: user.name } };
  return {
    access_token: `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.local`, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
    refresh_token: `refresh-${user.id}`, user: publicUser(user),
  };
}
function publicUser(user) {
  return { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, email_confirmed_at: '2026-01-01T00:00:00Z', phone: '',
    app_metadata: { role: user.role, provider: 'email', providers: ['email'] }, user_metadata: { name: user.name }, identities: [],
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' };
}
function claimsFrom(req) {
  if (req.headers.apikey === SERVICE_KEY) return { role: 'service_role' };
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token || token === ANON_KEY) return null;
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return accounts.some((user) => user.id === claims.sub) && claims.exp * 1000 > Date.now() ? claims : null;
  } catch { return null; }
}
const ident = (name) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw Object.assign(new Error(`invalid identifier: ${name}`), { status: 400, code: 'PGRST100' });
  return `"${name}"`;
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function send(res, status, body, headers = {}) {
  const payload = body === undefined || body === null ? '' : Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}
// The same translation PostgREST does from a database error to an HTTP status.
function sendDatabaseError(res, error, label) {
  const code = String(error.code || '');
  let status = Number(error.status) || 400;
  if (/^PT\d{3}$/.test(code)) status = Number(code.slice(2));
  else if (code === '42501') status = 403;
  else if (code === '23505' || code === '23503') status = 409;
  else if (code === '42P01' || code === '42883') status = 404;
  else if (code === '40001') {
    // Real PostgREST never returns this: it retries the transaction for ever.
    status = 500;
    log(`[WARNING] ${label} raised SQLSTATE 40001. A hosted Supabase would retry this request without end.`);
  }
  state.errors.push({ at: Date.now(), label, status, code, message: String(error.message || '').slice(0, 400) });
  send(res, status, { code: code || 'PGRST000', message: error.message || 'Database error', details: error.detail || null, hint: error.hint || null });
}
async function asRequestUser(claims, work) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims || { role: 'anon' })]);
    await tx.exec(`set local role ${claims?.role === 'service_role' ? 'service_role' : claims ? 'authenticated' : 'anon'}`);
    return work(tx);
  });
}

// --------------------------------------------------------------- REST tables
const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
function columnExpression(name, alias) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)((?:->>?[A-Za-z_][A-Za-z0-9_]*)*)$/.exec(name);
  if (!match) throw Object.assign(new Error(`unsupported column: ${name}`), { status: 400, code: 'PGRST100' });
  const base = `${alias ? `${alias}.` : ''}${ident(match[1])}`;
  return base + match[2].replace(/(->>?)([A-Za-z_][A-Za-z0-9_]*)/g, (_all, arrow, key) => `${arrow}'${key}'`);
}
function parseList(text) {
  const inner = text.replace(/^\(/, '').replace(/\)$/, '');
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char === '"') { quoted = !quoted; continue; }
    if (char === '\\' && quoted) { index += 1; current += inner[index]; continue; }
    if (char === ',' && !quoted) { values.push(current); current = ''; continue; }
    current += char;
  }
  if (inner.length) values.push(current);
  return values;
}
function buildFilters(searchParams, params, alias) {
  const clauses = [];
  for (const [key, raw] of searchParams) {
    if (RESERVED.has(key)) continue;
    if (key === 'or' || key === 'and') throw Object.assign(new Error('or/and filters are not supported by the local server'), { status: 400, code: 'PGRST100' });
    let expression = raw;
    let negate = false;
    if (expression.startsWith('not.')) { negate = true; expression = expression.slice(4); }
    const dot = expression.indexOf('.');
    const operator = dot < 0 ? expression : expression.slice(0, dot);
    const value = dot < 0 ? '' : expression.slice(dot + 1);
    const column = columnExpression(key, alias);
    const next = (item) => { params.push(item); return `$${params.length}`; };
    let clause;
    const comparison = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[operator];
    if (comparison) clause = `${column} ${comparison} ${next(value)}`;
    else if (operator === 'like' || operator === 'ilike') clause = `${column} ${operator} ${next(value.replaceAll('*', '%'))}`;
    else if (operator === 'is') {
      if (!['null', 'true', 'false'].includes(value)) throw Object.assign(new Error(`unsupported is.${value}`), { status: 400, code: 'PGRST100' });
      clause = `${column} is ${value}`;
    } else if (operator === 'in') {
      const list = parseList(value);
      clause = list.length ? `${column} in (${list.map(next).join(',')})` : 'false';
    } else if (operator === 'cs') clause = `${column} @> ${next(value)}::jsonb`;
    else throw Object.assign(new Error(`unsupported filter operator: ${operator}`), { status: 400, code: 'PGRST100' });
    clauses.push(negate ? `not (${clause})` : clause);
  }
  return clauses;
}
function selectList(searchParams, alias) {
  const select = searchParams.get('select');
  if (!select || select === '*') return alias ? `${alias}.*` : '*';
  return select.split(',').map((column) => `${alias ? `${alias}.` : ''}${ident(column.trim())}`).join(',');
}
function orderClause(searchParams, alias) {
  const order = searchParams.get('order');
  if (!order) return '';
  return ' order by ' + order.split(',').map((part) => {
    const [column, ...flags] = part.split('.');
    const direction = flags.includes('desc') ? 'desc' : 'asc';
    const nulls = flags.includes('nullsfirst') ? ' nulls first' : flags.includes('nullslast') ? ' nulls last' : '';
    return `${columnExpression(column, alias)} ${direction}${nulls}`;
  }).join(', ');
}

async function handleTable(req, res, url, table, body) {
  const claims = claimsFrom(req);
  const prefer = String(req.headers.prefer || '');
  const wantsRows = /return=representation/.test(prefer);
  const wantsCount = /count=exact/.test(prefer);
  const wantsObject = /vnd\.pgrst\.object/.test(String(req.headers.accept || ''));
  const target = `public.${ident(table)}`;
  const search = url.searchParams;
  try {
    const result = await asRequestUser(claims, async (tx) => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const params = [];
        const where = buildFilters(search, params, 't');
        const whereSql = where.length ? ` where ${where.join(' and ')}` : '';
        let count = null;
        if (wantsCount) count = Number((await tx.query(`select count(*)::int n from ${target} t${whereSql}`, params)).rows[0].n);
        if (req.method === 'HEAD') return { rows: [], count, head: true };
        // Rows are asked for either with limit/offset or with a Range header ("0-999").
        const range = /^(\d+)-(\d+)$/.exec(String(req.headers.range || '').trim());
        const limit = search.get('limit') ?? (range ? String(Number(range[2]) - Number(range[1]) + 1) : null);
        const offset = Number(search.get('offset') || (range ? range[1] : 0));
        const paging = `${limit !== null ? ` limit ${Number(limit)}` : ''}${offset ? ` offset ${offset}` : ''}`;
        const rows = (await tx.query(`select to_jsonb(q) as row from (select ${selectList(search, 't')} from ${target} t${whereSql}${orderClause(search, 't')}${paging}) q`, params)).rows.map((row) => row.row);
        return { rows, count, offset };
      }
      if (req.method === 'POST') {
        const payload = JSON.parse(body.toString('utf8') || 'null');
        const items = Array.isArray(payload) ? payload : [payload];
        if (!items.length || !items.every((item) => item && typeof item === 'object')) throw Object.assign(new Error('An insert needs at least one row'), { status: 400, code: 'PGRST102' });
        const columns = (search.get('columns') ? search.get('columns').split(',').map((name) => name.replace(/"/g, '')) : [...new Set(items.flatMap((item) => Object.keys(item)))]).map(ident);
        let conflict = '';
        if (/resolution=(merge|ignore)-duplicates/.test(prefer)) {
          let conflictColumns = search.get('on_conflict')?.split(',').map((name) => ident(name.trim()));
          if (!conflictColumns) {
            const keys = await tx.query(`select a.attname from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey) where i.indrelid=$1::regclass and i.indisprimary`, [target]);
            conflictColumns = keys.rows.map((row) => ident(row.attname));
          }
          const updates = columns.filter((column) => !conflictColumns.includes(column)).map((column) => `${column}=excluded.${column}`);
          conflict = ` on conflict (${conflictColumns.join(',')}) ${/merge-duplicates/.test(prefer) && updates.length ? `do update set ${updates.join(',')}` : 'do nothing'}`;
        }
        const rows = (await tx.query(`with written as (insert into ${target} (${columns.join(',')}) select ${columns.join(',')} from jsonb_populate_recordset(null::${target}, $1::jsonb)${conflict} returning *)
          select to_jsonb(q) as row from (select ${selectList(search)} from written) q`, [JSON.stringify(items)])).rows.map((row) => row.row);
        return { rows, created: true };
      }
      if (req.method === 'PATCH' || req.method === 'DELETE') {
        const params = [];
        let statement;
        if (req.method === 'PATCH') {
          const payload = JSON.parse(body.toString('utf8') || '{}');
          const columns = Object.keys(payload).map(ident);
          if (!columns.length) throw Object.assign(new Error('An update needs at least one column'), { status: 400, code: 'PGRST102' });
          params.push(JSON.stringify(payload));
          const where = buildFilters(search, params, 't');
          if (!where.length) throw Object.assign(new Error('Refusing an update with no filter'), { status: 400, code: 'PGRST100' });
          statement = `update ${target} as t set ${columns.map((column) => `${column}=r.${column}`).join(',')} from jsonb_populate_record(null::${target}, $1::jsonb) r where ${where.join(' and ')} returning t.*`;
        } else {
          const where = buildFilters(search, params, 't');
          if (!where.length) throw Object.assign(new Error('Refusing a delete with no filter'), { status: 400, code: 'PGRST100' });
          statement = `delete from ${target} as t where ${where.join(' and ')} returning t.*`;
        }
        const rows = (await tx.query(`with written as (${statement}) select to_jsonb(q) as row from (select ${selectList(search)} from written) q`, params)).rows.map((row) => row.row);
        return { rows };
      }
      throw Object.assign(new Error('Method not allowed'), { status: 405, code: 'PGRST105' });
    });
    if (result.head) return send(res, 200, null, { 'Content-Range': `*/${result.count ?? '*'}` });
    if (req.method === 'GET') {
      if (wantsObject) {
        if (result.rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${result.rows.length} rows`, hint: null });
        return send(res, 200, result.rows[0]);
      }
      const range = result.rows.length ? `${result.offset}-${result.offset + result.rows.length - 1}` : '*';
      return send(res, 200, result.rows, { 'Content-Range': `${range}/${result.count ?? '*'}` });
    }
    if (!wantsRows) return send(res, result.created ? 201 : 204, null);
    if (wantsObject) {
      if (result.rows.length !== 1) return send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${result.rows.length} rows`, hint: null });
      return send(res, result.created ? 201 : 200, result.rows[0]);
    }
    return send(res, result.created ? 201 : 200, result.rows);
  } catch (error) {
    return sendDatabaseError(res, error, `${req.method} ${table}`);
  }
}

// ----------------------------------------------------------------------- RPC
async function handleRpc(req, res, name, body) {
  const claims = claimsFrom(req);
  if (name === 'crm_access_profile' && state.accessProfile === 'fail') {
    // What the browser saw during the outage: the API had no free database connection.
    return send(res, 503, { code: 'PGRST003', message: 'Timed out acquiring connection from connection pool.', details: null, hint: null });
  }
  let args;
  try { args = JSON.parse(body.toString('utf8') || '{}') || {}; } catch { return send(res, 400, { code: 'PGRST102', message: 'Invalid JSON body' }); }
  try {
    ident(name);
    const candidates = (await db.query(`select p.oid, p.proargnames, p.proretset, p.prorettype::regtype::text as rettype, p.pronargs, p.pronargdefaults,
        (select array_agg(t::regtype::text order by ord) from unnest(p.proargtypes) with ordinality as x(t, ord)) as argtypes
      from pg_proc p where p.pronamespace='public'::regnamespace and p.proname=$1`, [name])).rows;
    const provided = Object.keys(args);
    const chosen = candidates.find((candidate) => {
      const names = (candidate.proargnames || []).slice(0, candidate.pronargs);
      const required = names.slice(0, candidate.pronargs - candidate.pronargdefaults);
      return provided.every((key) => names.includes(key)) && required.every((key) => provided.includes(key));
    });
    if (!chosen) return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${name}(${provided.join(', ')}) in the schema cache`, details: null, hint: null });
    const names = (chosen.proargnames || []).slice(0, chosen.pronargs);
    const params = [];
    const call = provided.map((key) => {
      const type = chosen.argtypes[names.indexOf(key)];
      const value = args[key];
      params.push(value === null || value === undefined ? null : /^jsonb?$/.test(type) ? JSON.stringify(value)
        : Array.isArray(value) ? `{${value.map((item) => `"${String(item).replace(/(["\\])/g, '\\$1')}"`).join(',')}}`
          : typeof value === 'object' ? JSON.stringify(value) : String(value));
      return `${ident(key)} => $${params.length}::${type}`;
    }).join(', ');
    const result = await asRequestUser(claims, async (tx) => {
      if (chosen.proretset) return { set: (await tx.query(`select to_jsonb(r) as row from public.${ident(name)}(${call}) r`, params)).rows.map((row) => row.row) };
      if (chosen.rettype === 'void') { await tx.query(`select public.${ident(name)}(${call})`, params); return { empty: true }; }
      return { value: (await tx.query(`select to_jsonb(public.${ident(name)}(${call})) as value`, params)).rows[0].value };
    });
    if (result.empty) return send(res, 204, null);
    return send(res, 200, result.set ?? result.value);
  } catch (error) {
    return sendDatabaseError(res, error, `rpc ${name}`);
  }
}

// ---------------------------------------------------------------------- auth
async function handleAuth(req, res, url, body) {
  const route = url.pathname.replace('/auth/v1', '');
  if (route === '/token' && req.method === 'POST') {
    const payload = JSON.parse(body.toString('utf8') || '{}');
    const grant = url.searchParams.get('grant_type');
    let user;
    if (grant === 'password') user = accounts.find((item) => item.email === String(payload.email || '').toLowerCase() && item.password === payload.password);
    if (grant === 'refresh_token') user = accounts.find((item) => `refresh-${item.id}` === payload.refresh_token);
    if (!user) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
    return send(res, 200, issueSession(user));
  }
  if (route === '/user' && req.method === 'GET') {
    const claims = claimsFrom(req);
    const user = claims && accounts.find((item) => item.id === claims.sub);
    if (!user) return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
    return send(res, 200, publicUser(user));
  }
  if (route === '/logout' && req.method === 'POST') return send(res, 204, null);
  if (route === '/settings') return send(res, 200, { external: { email: true }, disable_signup: true });
  return send(res, 404, { code: 404, msg: `The local server does not implement ${req.method} ${route}` });
}

// ------------------------------------------------------------------- storage
function testPng(seed) {
  const width = 320, height = 240;
  const hash = crypto.createHash('sha1').update(seed).digest();
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 3;
      const stripe = ((x >> 5) + (y >> 5)) % 2;
      raw[offset] = (hash[0] + x / 3 + stripe * 40) & 255;
      raw[offset + 1] = (hash[1] + y / 2) & 255;
      raw[offset + 2] = (hash[2] + stripe * 90) & 255;
    }
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(zlib.crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Picks the uploaded file out of a multipart form body.
function filePartFromForm(body, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  if (!match) return null;
  const boundary = Buffer.from(`--${match[1] || match[2]}`);
  let found = null;
  let start = body.indexOf(boundary);
  while (start !== -1) {
    const headerStart = start + boundary.length + 2;
    const headerEnd = body.indexOf('\r\n\r\n', headerStart);
    const next = body.indexOf(boundary, headerEnd + 4);
    if (headerEnd === -1 || next === -1) break;
    const headers = body.subarray(headerStart, headerEnd).toString('utf8');
    const part = { bytes: Buffer.from(body.subarray(headerEnd + 4, next - 2)), type: (/content-type:\s*([^\r\n]+)/i.exec(headers) || [])[1] || 'application/octet-stream' };
    // The file is the part with a file name; plain settings come as text parts.
    if (/filename=/i.test(headers)) return part;
    found = part;
    start = next;
  }
  return found;
}

// The file rules, asked of the database as the person making the request. The
// answers are the hosted file service's own: a file this person may not read
// "does not exist", and one they may not store is refused.
const NOT_FOUND = { statusCode: '404', error: 'not_found', message: 'Object not found' };
function bucketAndName(objectPath) {
  const slash = objectPath.indexOf('/');
  return [objectPath.slice(0, slash), objectPath.slice(slash + 1)];
}
async function mayReadFile(claims, objectPath) {
  const [bucket, name] = bucketAndName(objectPath);
  // A made-up record's file was never sent here, but it exists all the same.
  await db.query('insert into storage.objects(bucket_id, name) select $1, $2 where not exists (select 1 from storage.objects where bucket_id = $1 and name = $2)', [bucket, name]);
  const found = await asRequestUser(claims, (tx) => tx.query('select 1 from storage.objects where bucket_id = $1 and name = $2 limit 1', [bucket, name]));
  return found.rows.length > 0;
}
async function mayStoreFile(claims, objectPath) {
  const [bucket, name] = bucketAndName(objectPath);
  try {
    await asRequestUser(claims, (tx) => tx.query('insert into storage.objects(bucket_id, name, owner_id, owner) values ($1, $2, $3, $4)', [bucket, name, claims.sub || null, claims.sub || null]));
    return true;
  } catch (error) {
    if (error.code !== '42501') throw error;
    state.errors.push({ at: Date.now(), label: `storage ${objectPath}`, status: 403, code: '42501', message: String(error.message || '').slice(0, 400) });
    return false;
  }
}

async function handleStorage(req, res, url, body) {
  const route = decodeURIComponent(url.pathname.replace('/storage/v1', ''));
  if (route.startsWith('/object/sign/')) {
    const objectPath = route.slice('/object/sign/'.length);
    if (req.method === 'POST') {
      const claims = claimsFrom(req);
      if (!claims) return send(res, 400, { statusCode: '401', error: 'Unauthorized', message: 'A signed-in user is required' });
      if (!(await mayReadFile(claims, objectPath))) return send(res, 400, NOT_FOUND);
      return send(res, 200, { signedURL: `/object/sign/${objectPath.split('/').map(encodeURIComponent).join('/')}?token=local-signed` });
    }
    if (url.searchParams.get('token') !== 'local-signed') return send(res, 400, { statusCode: '400', error: 'InvalidJWT', message: 'signature verification failed' });
    const stored = state.storage.get(objectPath);
    const bytes = stored?.bytes || testPng(objectPath);
    res.writeHead(200, { 'Content-Type': stored?.type || 'image/png', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
    return res.end(bytes);
  }
  if (route.startsWith('/object/list/')) return send(res, 200, []);
  if (route.startsWith('/object/') && req.method === 'POST') {
    const claims = claimsFrom(req);
    if (!claims) return send(res, 400, { statusCode: '401', error: 'Unauthorized', message: 'A signed-in user is required' });
    const objectPath = route.slice('/object/'.length);
    if (!(await mayStoreFile(claims, objectPath))) return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
    if (state.storage.has(objectPath) && req.headers['x-upsert'] !== 'true')
      return send(res, 409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    // The browser sends a file as one part of a form. Keep the file itself, so
    // what is downloaded later is exactly what was uploaded.
    const contentType = String(req.headers['content-type'] || 'application/octet-stream');
    const filePart = /^multipart\/form-data/i.test(contentType) ? filePartFromForm(body, contentType) : null;
    state.storage.set(objectPath, filePart || { bytes: body, type: contentType });
    return send(res, 200, { Key: objectPath, Id: crypto.randomUUID() });
  }
  if (route.startsWith('/object/') && req.method === 'DELETE') return send(res, 200, []);
  // A direct download, as the CRM's own server does when it copies files out.
  if (route.startsWith('/object/') && req.method === 'GET') {
    const claims = claimsFrom(req);
    if (!claims) return send(res, 400, { statusCode: '401', error: 'Unauthorized', message: 'A signed-in user is required' });
    const objectPath = route.slice('/object/'.length).replace(/^authenticated\//, '');
    if (state.missingFiles.has(objectPath) || !(await mayReadFile(claims, objectPath))) return send(res, 400, NOT_FOUND);
    const stored = state.storage.get(objectPath);
    const bytes = stored?.bytes || testPng(objectPath);
    res.writeHead(200, { 'Content-Type': stored?.type || 'image/png', 'Content-Length': bytes.length, 'Cache-Control': 'no-store' });
    return res.end(bytes);
  }
  return send(res, 404, { statusCode: '404', error: 'not_found', message: `The local server does not implement ${req.method} ${route}` });
}

// ----------------------------------------------------- local-only inspection
async function handleLocal(req, res, url, body) {
  const route = url.pathname.replace('/__local', '');
  if (route === '/truth') return send(res, 200, await truth());
  if (route === '/log') {
    const since = Number(url.searchParams.get('since') || 0);
    return send(res, 200, { next: state.requests.length, requests: state.requests.slice(since) });
  }
  if (route === '/mode' && req.method === 'POST') {
    const payload = JSON.parse(body.toString('utf8') || '{}');
    if (['ok', 'fail'].includes(payload.accessProfile)) state.accessProfile = payload.accessProfile;
    // delays: [{ match, query, method, ms }]   faults: [{ match, query, method, status, remaining }]
    if (Array.isArray(payload.delays)) state.delays = payload.delays;
    if (Array.isArray(payload.faults)) state.faults = payload.faults;
    return send(res, 200, { accessProfile: state.accessProfile, delays: state.delays, faults: state.faults });
  }
  if (route === '/sql' && req.method === 'POST') {
    try {
      const payload = JSON.parse(body.toString('utf8') || '{}');
      const result = await db.query(String(payload.query || ''), payload.params || []);
      return send(res, 200, { rows: result.rows, affected: result.affectedRows ?? null });
    } catch (error) { return send(res, 400, { error: error.message, code: error.code || '' }); }
  }
  if (route === '/boot') return send(res, 200, { log: state.bootLog });
  if (route === '/errors') return send(res, 200, { errors: state.errors.slice(Number(url.searchParams.get('since') || 0)), next: state.errors.length });
  // Lets the local login page be filled in without the test password being typed or shown anywhere.
  if (route === '/accounts') return send(res, 200, accounts.map(({ email, password, role }) => ({ email, password, role })));
  return send(res, 404, { error: 'unknown local route' });
}

// -------------------------------------------------------------------- server
function corsHeaders(req) {
  return {
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'authorization, apikey, content-type, prefer, accept, range, x-client-info, accept-profile, content-profile, x-upsert',
    'Access-Control-Expose-Headers': 'Content-Range, Range',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}
function startCloudServer() {
  const server = http.createServer(async (req, res) => {
    // The drill rebuilds an in-memory database on this same event loop between
    // service reads. On busy runners that can outlast a pooled socket's idle
    // deadline. End each synthetic server-key connection after its response;
    // real browser sessions and production network behavior are unchanged.
    if (req.headers.apikey === SERVICE_KEY) res.setHeader('Connection', 'close');
    Object.entries(corsHeaders(req)).forEach(([key, value]) => res.setHeader(key, value));
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, CLOUD_ORIGIN);
    const entry = { method: req.method, path: url.pathname, query: url.search, at: Date.now() };
    res.on('finish', () => { entry.status = res.statusCode; if (!url.pathname.startsWith('/__local')) state.requests.push(entry); });
    try {
      const body = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) ? await readBody(req) : Buffer.alloc(0);
      if (url.pathname.startsWith('/__local/')) return await handleLocal(req, res, url, body);
      // Test switches: slow down or fail chosen requests to see how the CRM copes.
      const search = decodeURIComponent(url.search);
      const applies = (rule) => url.pathname.includes(rule.match) && (!rule.method || rule.method === req.method) && (!rule.query || search.includes(rule.query));
      for (const delay of state.delays) if (applies(delay)) await new Promise((resolve) => setTimeout(resolve, Number(delay.ms) || 0));
      const fault = state.faults.find((rule) => rule.remaining > 0 && applies(rule));
      if (fault) {
        fault.remaining -= 1;
        return send(res, fault.status || 503, { code: 'PGRST003', message: 'Timed out acquiring connection from connection pool.', details: null, hint: null });
      }
      if (url.pathname.startsWith('/auth/v1/')) return await handleAuth(req, res, url, body);
      if (url.pathname.startsWith('/storage/v1/')) return await handleStorage(req, res, url, body);
      if (url.pathname.startsWith('/rest/v1/rpc/')) return await handleRpc(req, res, url.pathname.slice('/rest/v1/rpc/'.length), body);
      if (url.pathname.startsWith('/rest/v1/')) return await handleTable(req, res, url, url.pathname.slice('/rest/v1/'.length), body);
      return send(res, 404, { message: `The local server does not implement ${url.pathname}` });
    } catch (error) {
      log(`[cloud] ${req.method} ${url.pathname} failed: ${error.message}`);
      if (!res.headersSent) send(res, 500, { code: 'LOCAL500', message: error.message });
    }
  });
  // Live updates use a websocket, which this server does not provide. The CRM
  // carries on without it; it simply does not hear about other people's edits.
  server.on('upgrade', (_req, socket) => socket.destroy());
  return new Promise((resolve) => server.listen(CLOUD_PORT, '127.0.0.1', () => resolve(server)));
}

// The CRM's own files come from the repo's server.js, untouched. Only the
// configuration script is replaced, to point the app at the local cloud.
function startStaticServer() {
  const child = spawn(process.execPath, [path.join(REPO, 'server.js')], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'development', ALLOW_LOCAL_DEMO: 'true', AUTH_REQUIRED: 'false', SUPABASE_SYNC_ENABLED: 'false', CRM_SKIP_ENV_FILES: 'true', PORT: String(STATIC_PORT) },
  });
  child.stdout.on('data', (chunk) => { if (!QUIET) process.stdout.write(`[app files] ${chunk}`); });
  child.stderr.on('data', (chunk) => { if (!QUIET) process.stderr.write(`[app files] ${chunk}`); });
  process.on('exit', () => child.kill());
  return child;
}
function startAppProxy() {
  const config = { supabaseUrl: CLOUD_ORIGIN, supabaseAnonKey: ANON_KEY, allowedEmailDomain: 'coastalcrestroofing.com', defaultRole: 'viewer',
    authRequired: true, syncEnabled: true, stateId: COMPANY, stagingTestIdentity: null, squarePaymentWorkerEnabled: false };
  const server = http.createServer((req, res) => {
    if (req.url.split('?')[0] === '/auth-config.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(`window.ROOFLINE_SUPABASE_CONFIG = ${JSON.stringify(config)};`);
    }
    const upstream = http.request({ host: '127.0.0.1', port: STATIC_PORT, path: req.url, method: req.method, headers: { ...req.headers, host: `localhost:${STATIC_PORT}` } }, (response) => {
      // Never let the browser keep an old copy of a file while the code is being tested.
      res.writeHead(response.statusCode || 502, { ...response.headers, 'cache-control': 'no-store' });
      response.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('The app file server is still starting. Reload in a moment.'); });
    req.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(APP_PORT, '127.0.0.1', () => resolve(server)));
}

// Waits until the app's own file server answers, so a test can open a page at once.
async function waitForAppFiles() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await new Promise((resolve) => {
      const request = http.get({ host: '127.0.0.1', port: STATIC_PORT, path: '/api/health' }, (response) => { response.resume(); resolve(true); });
      request.on('error', () => resolve(false));
    });
    if (ready) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

// Starts the local copy. Options: appPort, cloudPort, staticPort, quiet.
// Returns its addresses, the test accounts, a query function for checking the
// database directly, and stop().
async function start(options = {}) {
  if (options.appPort) APP_PORT = Number(options.appPort);
  if (options.cloudPort) CLOUD_PORT = Number(options.cloudPort);
  if (options.staticPort) STATIC_PORT = Number(options.staticPort);
  CLOUD_ORIGIN = `http://localhost:${CLOUD_PORT}`;
  QUIET = Boolean(options.quiet);
  writeAccountsFile();
  await buildDatabase();
  await seedDatabase();
  if (options.canonicalLedger === true) await db.query('select public.crm_activate_payment_ledger()');
  const files = startStaticServer();
  const cloud = await startCloudServer();
  const proxy = await startAppProxy();
  await waitForAppFiles();
  log(`[ready] CRM (signed-in, cloud mode): http://localhost:${APP_PORT}`);
  log(`[ready] local cloud API: ${CLOUD_ORIGIN}   accounts: ${ACCOUNTS_FILE}`);
  log(`[ready] database totals: ${JSON.stringify(await truth())}`);
  return {
    appUrl: `http://localhost:${APP_PORT}`,
    cloudUrl: CLOUD_ORIGIN,
    companyId: COMPANY,
    serviceKey: SERVICE_KEY,
    accountsFile: ACCOUNTS_FILE,
    accounts: accounts.map(({ email, password, role, id, name }) => ({ email, password, role, id, name })),
    query: (text, params = []) => db.query(text, params),
    exec: (text) => db.exec(text),
    truth,
    state,
    async stop() {
      files.kill();
      await Promise.all([cloud, proxy].map((server) => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); })));
      await db.close();
    },
  };
}

if (require.main === module) {
  start().catch((error) => { console.error('[fatal]', error); process.exit(1); });
}

module.exports = { start, createEmptyDatabase, ACCOUNTS_FILE };
