const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const pages = require('../record-pages.js');
const dashboard = require('../dashboard-data.js');

const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261104173517_server_pagination_and_aggregates.sql'), 'utf8');

test('pagination client bounds inputs and preserves opaque cursors', async () => {
  const calls = [];
  const client = pages.create({
    async rpc(name, args) {
      calls.push({ name, args });
      return name === 'crm_dashboard_aggregates'
        ? { data: { leads: 12 }, error: null }
        : { data: { items: [{ id: 'one' }], totalCount: 12, hasMore: true, nextCursor: { updatedAt: '2026-11-04T12:00:00Z', id: 'lead-1' } }, error: null };
    },
  });
  const result = await client.leads({ limit: 900, cursor: { updatedAt: '2026-11-04T12:00:00Z', id: 'lead-1' }, search: '  Smith  ', status: 'New' });
  assert.equal(result.totalCount, 12);
  assert.equal(calls[0].name, 'crm_lead_page');
  assert.equal(calls[0].args.p_limit, 100);
  assert.equal(calls[0].args.p_search, 'Smith');
  assert.equal(calls[0].args.p_cursor_id, 'lead-1');
  assert.deepEqual(await client.aggregates(), { leads: 12 });
});

test('lead and job RPCs keyset-page records and aggregates totals', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select '00000000-0000-4000-8000-000000000001'::uuid$$;
      create table public.crm_records(
        company_state_id text not null, record_type text not null, id text not null,
        lead_id text not null default '', job_id text not null default '', owner_id uuid,
        data jsonb not null default '{}'::jsonb, version integer not null default 1,
        updated_at timestamptz not null default now(), updated_by uuid, deleted_at timestamptz,
        primary key(company_state_id, record_type, id)
      );
      create function public.crm_base_state_id() returns text language sql stable set search_path='' as $$select 'coastal-crest'$$;
    `);
    await db.exec(migration);
    await db.exec(migration);
    for (let index = 0; index < 125; index += 1) {
      const id = `lead-${String(index).padStart(3, '0')}`;
      const timestamp = new Date(Date.UTC(2026, 10, 4, 12, 0, 0) - index * 1000).toISOString();
      await db.query(`insert into public.crm_records(company_state_id,record_type,id,lead_id,data,updated_at)
        values ('coastal-crest','contact',$1,$1,$2::jsonb,$3),
               ('coastal-crest','job',$4,$1,$5::jsonb,$3)`, [
        id, JSON.stringify({ name: `Customer ${index}`, email: `customer${index}@example.com` }), timestamp,
        `job-${String(index).padStart(3, '0')}`, JSON.stringify({ name: `Job ${index}`, status: index % 2 ? 'New' : 'Paid', value: '100.25', paidAmount: index % 2 ? '0' : '100.25' }),
      ]);
    }
    const first = await db.query(`select public.crm_lead_page(50,null,null,'','New') value`);
    const firstPage = first.rows[0].value;
    assert.equal(firstPage.items.length, 50);
    assert.equal(Number(firstPage.totalCount), 62);
    assert.equal(firstPage.hasMore, true);
    const cursor = firstPage.nextCursor;
    const second = await db.query(`select public.crm_lead_page(50,$1,$2,'','New') value`, [cursor.updatedAt, cursor.id]);
    const secondPage = second.rows[0].value;
    assert.equal(secondPage.items.length, 12);
    const ids = [...firstPage.items, ...secondPage.items].map((item) => item.record.id);
    assert.equal(new Set(ids).size, 62);

    const jobs = await db.query(`select public.crm_job_page(50,null,null,'Customer 12','') value`);
    assert.ok(Number(jobs.rows[0].value.totalCount) > 0);
    const totals = await db.query(`select public.crm_dashboard_aggregates() value`);
    assert.equal(Number(totals.rows[0].value.leads), 125);
    assert.equal(Number(totals.rows[0].value.totalJobs), 125);
    assert.equal(Number(totals.rows[0].value.pipelineValue), 12531.25);
  } finally {
    await db.close();
  }
});

test('migration keeps RLS authoritative and exposes only authenticated RPCs', () => {
  assert.match(migration, /security invoker/gi);
  assert.match(migration, /revoke all on function public\.crm_lead_page[\s\S]*from public, anon/i);
  assert.match(migration, /grant execute on function public\.crm_dashboard_aggregates\(\) to authenticated/i);
  assert.doesNotMatch(migration, /security definer/i);
});

test('browser loads pagination module before the main application', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.ok(html.indexOf('record-pages.js') < html.indexOf('app.js'));
  assert.ok(html.indexOf('dashboard-data.js') < html.indexOf('app.js'));
  assert.match(server, /"\/record-pages\.js"/);
  assert.match(server, /"\/dashboard-data\.js"/);
});

test('startup hydrates bounded pages and defers complete core records to legacy workspaces', () => {
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const fetchBody = app.slice(app.indexOf('async function fetchDurableRows()'), app.indexOf('function configureRecordPages'));
  assert.match(fetchBody, /recordPageClient\.leads\(\{ limit: 100 \}\)/);
  assert.match(fetchBody, /recordPageClient\.jobs\(\{ limit: 100 \}\)/);
  assert.match(fetchBody, /\["estimate", "task"\]/);
  assert.match(app, /function viewNeedsCompleteCoreRecords[\s\S]*"contacts", "pipeline", "projects", "estimates", "reviews", "reports"/);
  assert.match(app, /viewNeedsCompleteCoreRecords\(view\)[\s\S]*ensureCompleteCoreRecordsLoaded\(\)/);
});

test('dashboard projections use database aggregate groups without full resident data', () => {
  const payload = {
    stageLeadCounts: { New: 7 }, stageValues: { New: 1000.25 },
    leadSources: [{ label: 'Website', count: 5 }],
    revenueMonths: { '2026-11': 2500.75 },
  };
  assert.deepEqual(dashboard.stageGroups(payload, ['New']), [{ status: 'New', count: 7, value: 1000.25 }]);
  assert.deepEqual(dashboard.groups(payload, 'leadSources'), [{ label: 'Website', count: 5, value: 0 }]);
  const months = dashboard.revenueMonths(payload, new Date(2026, 10, 4));
  assert.equal(months.at(-1).value, 2500.75);
});
