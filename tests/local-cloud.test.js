// The local test copy of the CRM (to-do item 1): a signed-in, cloud-mode copy
// that runs entirely on one computer. This starts it for real and checks the
// parts everything else relies on. Nothing here touches a network beyond
// localhost, or a real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const localCloud = require('../scripts/local-cloud.js');

const json = async (response) => ({ status: response.status, body: await response.json().catch(() => null) });

test('to-do 1: the local test copy starts, signs a test user in and enforces the real database rules', async () => {
  const copy = await localCloud.start({ appPort: 4420, cloudPort: 4421, staticPort: 4422, quiet: true });
  try {
    // Built from the repo's own schema and migrations, with made-up records.
    const totals = await copy.truth();
    assert.equal(totals.leads, 236);
    assert.equal(totals.jobs, 283);
    const backupRead = await fetch(`${copy.cloudUrl}/rest/v1/crm_backups?limit=1`, { headers: { apikey: copy.serviceKey } });
    assert.equal(backupRead.status, 200);
    assert.equal(backupRead.headers.get('connection'), 'close', 'the next synthetic backup read must use a fresh connection');
    await backupRead.arrayBuffer();
    const skipped = copy.state.bootLog.filter((line) => line.includes('skipped'));
    // Every one applies. One used to be skipped: it alters the website's quote
    // requests table, which the repo's schema did not make until 2026-11-24.
    assert.deepEqual(skipped, [], 'migrations that did not apply');
    // The app is served with its configuration pointed at the local copy only.
    const config = await (await fetch(`${copy.appUrl}/auth-config.js`)).text();
    assert.match(config, /"supabaseUrl":"http:\/\/localhost:4421"/);
    assert.match(config, /"authRequired":true/);
    assert.equal((await fetch(`${copy.appUrl}/`)).status, 200);
    // The test tooling itself is never served as part of the app.
    assert.equal((await fetch(`${copy.appUrl}/scripts/local-cloud.js`)).status, 404);
    // Test accounts are written outside the repo and change on every start.
    const saved = JSON.parse(fs.readFileSync(copy.accountsFile, 'utf8'));
    assert.deepEqual(saved.accounts.map((account) => account.role).sort(), ['admin', 'sales']);
    assert.ok(!copy.accountsFile.startsWith(require('node:path').resolve(__dirname, '..')), 'not inside the repo');

    const signIn = async (role, password) => {
      const account = copy.accounts.find((item) => item.role === role);
      return json(await fetch(`${copy.cloudUrl}/auth/v1/token?grant_type=password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password: password ?? account.password }),
      }));
    };
    assert.equal((await signIn('admin', 'wrong-password')).status, 400);
    const admin = await signIn('admin');
    const rep = await signIn('sales');
    assert.equal(admin.status, 200);
    const as = (session) => ({ Authorization: `Bearer ${session.body.access_token}`, apikey: 'local-anon-key', 'Content-Type': 'application/json' });

    // Row-level security is the real one: the rep sees only their own leads.
    const count = async (session) => {
      const response = await fetch(`${copy.cloudUrl}/rest/v1/crm_records?select=id&record_type=eq.contact`, { method: 'HEAD', headers: { ...as(session), Prefer: 'count=exact' } });
      return Number(response.headers.get('content-range').split('/')[1]);
    };
    assert.equal(await count(admin), 236);
    const repOwned = Number((await copy.query("select count(*)::int n from public.crm_records where record_type='contact' and owner_id=$1", [copy.accounts.find((item) => item.role === 'sales').id])).rows[0].n);
    assert.equal(await count(rep), repOwned);
    assert.ok(repOwned > 0 && repOwned < 236);
    // Nobody signed in gets nothing.
    const anonymous = await json(await fetch(`${copy.cloudUrl}/rest/v1/crm_records?select=id&limit=1`, { headers: { apikey: 'local-anon-key' } }));
    assert.ok(anonymous.status >= 400 || (Array.isArray(anonymous.body) && anonymous.body.length === 0));

    // Database functions answer as the signed-in user: the ledger total matches the records.
    const ledger = await json(await fetch(`${copy.cloudUrl}/rest/v1/rpc/crm_ledger_totals`, { method: 'POST', headers: as(admin), body: '{}' }));
    assert.equal(ledger.status, 200);
    assert.equal(Number(ledger.body.collected), totals.job_payments + totals.invoice_payments);
    assert.equal(Number(ledger.body.expenses), totals.job_costs + totals.recorded_expenses);
    // Every payment on a job is a row in the payments table (to-do item 6): the
    // same number of them, the same money, and nothing left only on a record.
    assert.ok(totals.job_payment_count >= 40, `the made-up records include dozens of payments (${totals.job_payment_count})`);
    assert.equal(totals.payment_row_count_from_jobs, totals.job_payment_count);
    assert.equal(totals.payment_rows_from_jobs, totals.job_payments);
    assert.equal(Number(ledger.body.unsyncedJobPayments), 0);
    const proof = await json(await fetch(`${copy.cloudUrl}/rest/v1/rpc/crm_payments_reconciliation`, { method: 'POST', headers: as(admin), body: '{}' }));
    assert.equal(proof.status, 200);
    assert.equal(proof.body.matched, true);
    assert.equal(proof.body.paymentsOnJobs, totals.job_payment_count);
    const repLedger = await json(await fetch(`${copy.cloudUrl}/rest/v1/rpc/crm_ledger_totals`, { method: 'POST', headers: as(rep), body: '{}' }));
    assert.ok(Number(repLedger.body.collected) < Number(ledger.body.collected), 'the rep gets totals for their own records only');

    // A refusal from the database comes back the way the hosted service returns it.
    const refused = await json(await fetch(`${copy.cloudUrl}/rest/v1/crm_records?id=eq.lead_local_0001`, { method: 'DELETE', headers: { ...as(rep), Prefer: 'return=representation' } }));
    assert.ok(refused.status === 403 || (refused.status === 200 && refused.body.length === 0), 'records cannot be deleted directly');
  } finally {
    await copy.stop();
  }
});
