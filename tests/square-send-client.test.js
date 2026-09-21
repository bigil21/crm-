const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create } = require('../record-writes.js');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const receipt = overrides => ({ durable: true, estimateId: 'estimate-A', leadId: 'lead-A', jobId: 'job-A',
  squareInvoiceId: 'inv:synthetic', squareOrderId: 'order-A', contractValue: 32000, status: 'UNPAID', ...overrides });

function harness(options = {}) {
  const contact = { id: 'lead-A', name: 'Synthetic customer', email: 'customer@example.invalid', leadNumber: 'LEAD-1' };
  const job = { id: 'job-A', projectNumber: 'PROJECT-1' };
  const state = { view: 'invoices', estimates: [{ id: 'estimate-A', contactId: contact.id, jobId: job.id,
    status: 'Won', items: [{ title: 'Original roof', rate: 32000, quantity: 1 }], paidAmount: 1000 }] };
  const actor = { role: 'admin', current: true };
  const notices = new Map(), recoveryStorage = new Map();
  const calls = { fetch: [], save: [], flush: 0, reload: 0, blocked: [], render: 0, toast: [] };
  const button = { dataset: { squareSend: 'estimate-A' }, disabled: false, textContent: 'Send to Square' };
  let requestSequence = 0;
  const writer = create({ rpc: () => { throw Error('No browser financial commits are allowed'); }, requestId: () => 'unused' });
  writer.remember([{ record_type: 'estimate', id: 'estimate-A', version: 7 }]);
  const c = vm.createContext({
    console, state, actor, contact, job, calls, notices, recoveryStorage, button, writer, pending: false,
    squareInvoiceSends: new Map(), authSession: { user: { id: 'admin-A', email: 'admin@example.invalid', app_metadata: { role: 'admin' } } },
    durableRecordsReady: true, durableWriteBlocked: false, durableSaveInFlight: false, cloudClient: {},
    currentRole: () => actor.role, canUseCloudSync: () => true,
    window: { RooflineAuth: { isEditorSessionCurrent: () => actor.current } },
    crypto: { randomUUID: () => `attempt-${++requestSequence}` }, AbortSignal,
    getEstimateContact: estimate => estimate?.contactId === contact.id && !c.missingLead ? contact : null,
    getEstimateJob: estimate => estimate?.contactId === contact.id && estimate?.jobId === job.id && !c.missingJob ? job : null,
    getContact: contactId => contactId === contact.id && !c.missingLead ? contact : null,
    contactJobs: value => value?.id === contact.id && !c.missingJob ? [job] : [],
    ensureLeadProjectNumbers: () => {
      contact.leadNumber = 'LEAD-1'; job.projectNumber = 'PROJECT-1'; return { contact, job };
    },
    saveState: opts => calls.save.push(clone(opts)),
    waitForDurableSaveSlot: async () => true,
    flushDurableRecordsSave: async () => { calls.flush++; return options.flush ? options.flush(c) : true; },
    hasPendingDurableChanges: () => c.pending,
    durableRecordDataMatches: (left, right) => JSON.stringify(left) === JSON.stringify(right),
    getDurableCommitWriter: () => writer,
    squareApiHeaders: () => options.headers ? options.headers(c) : Promise.resolve({ Authorization: 'Bearer synthetic' }),
    fetch: async (url, init) => {
      calls.fetch.push({ url, init });
      if (options.fetch) return options.fetch(c, url, init);
      return { ok: true, json: async () => receipt() };
    },
    reloadDurableRecords: async () => {
      calls.reload++;
      if (options.reload) return options.reload(c);
      const saved = { ...clone(state.estimates[0]), squareInvoiceId: 'inv:synthetic', squareOrderId: 'order-A', contractValue: 32000 };
      state.estimates = [saved];
      const rows = [{ record_type: 'estimate', id: saved.id, version: 8, data: saved }];
      writer.remember(rows);
      return rows;
    },
    preserveBlockedDurableWrite: value => { c.durableWriteBlocked = true; calls.blocked.push(value); },
    localStorage: { setItem: (key, value) => recoveryStorage.set(key, value) },
    renderInvoicesView: () => calls.render++, showToast: message => calls.toast.push(message),
    document: {
      activeElement: null, querySelectorAll: () => [button], getElementById: id => notices.get(id),
      createElement: () => ({ style: {}, setAttribute() {}, remove() { notices.delete(this.id); } }),
      body: { appendChild: node => notices.set(node.id, node) },
    },
  });
  for (const name of ['squareSendIdentity', 'showSquareSendNotice', 'preserveSquareSendOutcome', 'squareSendPreProviderRefusal', 'sendToSquare']) {
    const match = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    assert.ok(match, `Function ${name} exists`);
    vm.runInContext(match[0], c);
  }
  return c;
}

test('writer version getter reports only applied or acknowledged versions', async () => {
  const response = deferred(); const row = { company_state_id: 'company', record_type: 'estimate', id: 'estimate', data: { title: 'Saved' } };
  const writer = create({ requestId: () => 'write-1', rpc: async (_name, payload) => {
    await response.promise;
    return { data: { rows: payload.p_changes.map(change => ({ ...change, version: change.expected_version + 1, deleted_at: null })), audit_ids: [] }, error: null };
  } });
  assert.equal(writer.getVersion(row), 0);
  writer.remember([{ ...row, version: 4 }]);
  const pending = writer.commit([row]);
  assert.equal(writer.getVersion(row), 4);
  assert.equal(writer.getVersion({ ...row, id: 'unknown' }), 0);
  response.resolve();
  assert.equal((await pending).error, null);
  assert.equal(writer.getVersion(row), 5);
});

test('sender persists numbered records then posts only the acknowledged identity and version', async () => {
  const c = harness();
  assert.equal(await c.sendToSquare('estimate-A'), true);
  assert.equal(c.calls.flush, 1);
  assert.equal(c.calls.fetch.length, 1);
  assert.deepEqual(JSON.parse(c.calls.fetch[0].init.body), { estimateId: 'estimate-A', expectedVersion: 7 });
  assert.equal(c.contact.leadNumber, 'LEAD-1');
  assert.equal(c.job.projectNumber, 'PROJECT-1');
  assert.deepEqual(c.calls.save, [{ localOnly: true }]);
  assert.equal(c.calls.reload, 1);
  assert.equal(c.writer.getVersion({ record_type: 'estimate', id: 'estimate-A' }), 8);
  assert.equal(c.button.disabled, true);
  assert.ok(c.calls.toast.some(message => message.includes('Email delivery is not yet confirmed')));
});

test('failed record save never starts a Square request', async () => {
  const c = harness({ flush: async () => false });
  assert.equal(await c.sendToSquare('estimate-A'), false);
  assert.equal(c.calls.fetch.length, 0);
  assert.equal(c.calls.blocked.length, 0);
  assert.match([...c.notices.values()][0].textContent, /not started/);
});

test('new typing during auth refresh prevents invoice creation from an unconfirmed draft', async () => {
  const auth = deferred(), started = deferred();
  const c = harness({ headers: () => { started.resolve(); return auth.promise; } });
  const pending = c.sendToSquare('estimate-A');
  await started.promise;
  c.state.estimates[0].items[0].rate = 35000;
  c.pending = true;
  auth.resolve({ Authorization: 'Bearer synthetic' });
  assert.equal(await pending, false);
  assert.equal(c.calls.fetch.length, 0);
  assert.equal(c.state.estimates[0].items[0].rate, 35000);
});

test('duplicate clicks share a lock and never start another provider operation', async () => {
  const response = deferred(), started = deferred();
  const c = harness({ fetch: () => { started.resolve(); return response.promise; } });
  const first = c.sendToSquare('estimate-A');
  await started.promise;
  assert.equal(await c.sendToSquare('estimate-A'), false);
  assert.equal(c.calls.fetch.length, 1);
  response.resolve({ ok: true, json: async () => receipt() });
  assert.equal(await first, true);
});

test('hydration replacing the original estimate cannot lose the server association', async () => {
  const response = deferred(), started = deferred();
  const c = harness({ fetch: () => { started.resolve(); return response.promise; } });
  const original = c.state.estimates[0];
  const pending = c.sendToSquare('estimate-A');
  await started.promise;
  c.state.estimates = [clone(original)];
  response.resolve({ ok: true, json: async () => receipt() });
  assert.equal(await pending, true);
  assert.equal(original.squareInvoiceId, undefined);
  assert.equal(c.state.estimates[0].squareInvoiceId, 'inv:synthetic');
  assert.deepEqual(c.calls.save, [{ localOnly: true }]);
});

test('newer edits after sending are retained without adopting unseen versions or writing payment fields', async () => {
  const response = deferred(), started = deferred();
  const c = harness({ fetch: () => { started.resolve(); return response.promise; } });
  const pending = c.sendToSquare('estimate-A');
  await started.promise;
  c.state.estimates[0].items[0].title = 'Keep my newer typing'; c.pending = true;
  response.resolve({ ok: true, json: async () => receipt() });
  assert.equal(await pending, false);
  assert.equal(c.calls.reload, 0);
  assert.equal(c.state.estimates[0].items[0].title, 'Keep my newer typing');
  assert.equal(c.state.estimates[0].squareInvoiceId, undefined);
  assert.equal(c.writer.getVersion({ record_type: 'estimate', id: 'estimate-A' }), 7);
  assert.equal(c.calls.blocked[0].payload.result.squareInvoiceId, 'inv:synthetic');
  assert.match([...c.notices.values()][0].textContent, /Do not send another invoice/);
  assert.equal(await c.sendToSquare('estimate-A'), false);
  assert.equal(c.calls.fetch.length, 1);
});

for (const [name, mutate] of [
  ['lead', c => { c.state.estimates[0].contactId = 'another-lead'; }],
  ['job', c => { c.state.estimates[0].jobId = 'another-job'; }],
  ['invoice', c => { c.state.estimates[0].squareInvoiceId = 'another-invoice'; }],
  ['deleted estimate', c => { c.state.estimates = []; }],
  ['deleted lead', c => { c.missingLead = true; }],
  ['deleted job', c => { c.missingJob = true; }],
]) {
  test(`in-flight ${name} changes cannot receive a stale invoice association`, async () => {
    const response = deferred(), started = deferred();
    const c = harness({ fetch: () => { started.resolve(); return response.promise; } });
    const pending = c.sendToSquare('estimate-A'); await started.promise;
    mutate(c);
    response.resolve({ ok: true, json: async () => receipt() });
    assert.equal(await pending, false);
    assert.equal(c.calls.reload, 0);
    assert.equal(c.calls.blocked.length, 1);
    assert.equal(c.writer.getVersion({ record_type: 'estimate', id: 'estimate-A' }), 7);
  });
}

for (const [name, mutate] of [
  ['account', c => { c.authSession.user = { id: 'different-user', email: 'different@example.invalid', app_metadata: { role: 'admin' } }; }],
  ['role', c => { c.actor.role = 'sales'; }],
  ['sign-out', c => { c.actor.current = false; }],
]) {
  test(`late invoice receipt stays private after ${name} changes`, async () => {
    const response = deferred(), started = deferred();
    const c = harness({ fetch: () => { started.resolve(); return response.promise; } });
    const pending = c.sendToSquare('estimate-A'); await started.promise;
    mutate(c);
    response.resolve({ ok: true, json: async () => receipt() });
    assert.equal(await pending, false);
    assert.equal(c.calls.reload, 0);
    assert.equal(c.calls.blocked.length, 0);
    assert.equal(c.notices.size, 0);
    assert.equal(c.state.estimates[0].squareInvoiceId, undefined);
    assert.equal(c.recoveryStorage.size, 1);
    assert.match([...c.recoveryStorage.keys()][0], /^jobcrest-square-send-recovery:admin-A:/);
  });
}

test('an uncertain response creates persistent review state without retry or false success', async () => {
  const c = harness({ fetch: async () => { throw new Error('synthetic lost response'); } });
  assert.equal(await c.sendToSquare('estimate-A'), false);
  assert.equal(await c.sendToSquare('estimate-A'), false);
  assert.equal(c.calls.fetch.length, 1);
  assert.equal(c.calls.reload, 0);
  assert.equal(c.calls.blocked.length, 1);
  assert.equal(c.calls.toast.length, 0);
  assert.equal(c.button.textContent, 'Review invoice outcome');
  assert.equal(c.writer.getVersion({ record_type: 'estimate', id: 'estimate-A' }), 7);
  assert.match([...c.notices.values()][0].textContent, /retry only this same saved estimate to resume its existing attempt/);
});

for (const [code, message] of [
  ['legacy_invoice_review_required', 'An administrator must check Square for an earlier invoice attempt before sending this older estimate.'],
  ['estimate_changed_before_invoice', 'The estimate changed. Reload and review the saved estimate before sending.'],
  ['won_estimate_required', 'Save the estimate as Won before sending an invoice.'],
  ['invoice_already_linked', 'This estimate already has a linked Square invoice. Reload its invoice status.'],
  ['saved_customer_email_and_numbers_required', 'Save the customer email, lead number and project number before sending.'],
]) {
  test(`definitive begin refusal explains ${code} without blocking unrelated saves`, async () => {
    const c = harness({ fetch: async () => ({ ok: false, status: 409,
      json: async () => ({ code, stage: 'begin', noProviderAction: true, reviewRequired: true, error: 'Never render arbitrary server details' }) }) });
    assert.equal(await c.sendToSquare('estimate-A'), false);
    assert.equal(c.calls.blocked.length, 0);
    assert.equal(c.durableWriteBlocked, false);
    assert.equal(c.calls.reload, 0);
    assert.equal(c.calls.toast.length, 0);
    assert.equal(c.button.disabled, false);
    assert.equal(c.squareInvoiceSends.size, 0);
    assert.equal(c.writer.getVersion({ record_type: 'estimate', id: 'estimate-A' }), 7);
    assert.equal([...c.notices.values()][0].textContent, `Invoice sending was not started. ${message}`);
    // No automatic retry; a subsequent intentional click is not locked out.
    assert.equal(c.calls.fetch.length, 1);
    assert.equal(await c.sendToSquare('estimate-A'), false);
    assert.equal(c.calls.fetch.length, 2);
  });
}

for (const [status, error] of [
  [400, 'Send only the saved estimate ID and its current version.'],
  [503, 'Reliable Square invoice storage is not configured. No invoice was sent.'],
]) {
  test(`definitive ${status} pre-provider refusal preserves newer typing without a global block`, async () => {
    const started = deferred(), response = deferred();
    const c = harness({ fetch: () => { started.resolve(); return response.promise; } });
    const pending = c.sendToSquare('estimate-A'); await started.promise;
    c.state.estimates[0].notes = 'Keep this draft'; c.pending = true;
    response.resolve({ ok: false, status, json: async () => ({ error, noProviderAction: true }) });
    assert.equal(await pending, false);
    assert.equal(c.state.estimates[0].notes, 'Keep this draft');
    assert.equal(c.pending, true);
    assert.equal(c.calls.blocked.length, 0);
    assert.equal(c.calls.reload, 0);
    assert.equal(c.durableWriteBlocked, false);
    assert.equal([...c.notices.values()][0].textContent, `Invoice sending was not started. ${error}`);
  });
}

for (const [name, overrides, status = 409, ok = false] of [
  ['unknown code', { code: 'unknown_failure' }],
  ['prototype key', { code: 'toString' }],
  ['wrong stage', { stage: 'publish' }],
  ['missing explicit guarantee', { noProviderAction: undefined }],
  ['nonboolean guarantee', { noProviderAction: 'true' }],
  ['contradictory durable receipt', { durable: true }],
  ['provider invoice receipt', { squareInvoiceId: 'inv:synthetic' }],
  ['provider order receipt', { squareOrderId: 'order-synthetic' }],
  ['existing intent receipt', { intentId: 'intent-synthetic' }],
  ['wrong status', {}, 503],
  ['successful HTTP status', {}, 409, true],
  ['unlisted configuration failure', { error: 'Different configuration failure' }, 503],
  ['unlisted request failure', { error: 'Different request failure' }, 400],
]) {
  test(`unproven no-provider guarantee remains ambiguous: ${name}`, async () => {
    const c = harness({ fetch: async () => ({ ok, status, json: async () => ({
      code: 'legacy_invoice_review_required', stage: 'begin', noProviderAction: true, error: 'Unsafe details', ...overrides,
    }) }) });
    assert.equal(await c.sendToSquare('estimate-A'), false);
    assert.equal(c.calls.blocked.length, 1);
    assert.equal(c.button.disabled, true);
    assert.equal(c.calls.reload, 0);
    assert.doesNotMatch([...c.notices.values()][0].textContent, /Unsafe details/);
  });
}

test('late definitive refusal does not reveal its warning in a different signed-in account', async () => {
  const started = deferred(), response = deferred();
  const c = harness({ fetch: () => { started.resolve(); return response.promise; } });
  const pending = c.sendToSquare('estimate-A'); await started.promise;
  c.authSession.user = { id: 'another-admin', email: 'other@example.invalid', app_metadata: { role: 'admin' } };
  response.resolve({ ok: false, status: 409, json: async () => ({ code: 'legacy_invoice_review_required', stage: 'begin', noProviderAction: true }) });
  assert.equal(await pending, false);
  assert.equal(c.notices.size, 0);
  assert.equal(c.recoveryStorage.size, 0);
  assert.equal(c.calls.blocked.length, 0);
  assert.equal(c.squareInvoiceSends.size, 0);
});

test('a definitive invoice refusal never clears a separate save conflict raised while waiting', async () => {
  const started = deferred(), response = deferred();
  const c = harness({ fetch: () => { started.resolve(); return response.promise; } });
  const pending = c.sendToSquare('estimate-A'); await started.promise;
  c.durableWriteBlocked = true;
  c.state.estimates[0].notes = 'Draft with a separate conflict'; c.pending = true;
  response.resolve({ ok: false, status: 409, json: async () => ({ code: 'estimate_changed_before_invoice', stage: 'begin', noProviderAction: true }) });
  assert.equal(await pending, false);
  assert.equal(c.durableWriteBlocked, true);
  assert.equal(c.pending, true);
  assert.equal(c.state.estimates[0].notes, 'Draft with a separate conflict');
  assert.equal(c.calls.blocked.length, 0);
  assert.equal(c.calls.reload, 0);
  assert.equal(c.squareInvoiceSends.size, 0);
  assert.equal(await c.sendToSquare('estimate-A'), false);
  assert.equal(c.calls.fetch.length, 1);
});

for (const override of [{ durable: false }, { estimateId: 'other' }, { leadId: 'other' }, { jobId: 'other' },
  { squareInvoiceId: '../invalid' }, { contractValue: -1 }, { contractValue: '32000' }]) {
  test(`mismatched confirmation is not accepted: ${JSON.stringify(override)}`, async () => {
    const c = harness({ fetch: async () => ({ ok: true, json: async () => receipt(override) }) });
    assert.equal(await c.sendToSquare('estimate-A'), false);
    assert.equal(c.calls.reload, 0);
    assert.equal(c.state.estimates[0].squareInvoiceId, undefined);
    assert.equal(c.calls.blocked.length, 1);
  });
}

test('guarded reload refusing a late edit retains the draft and pauses for review', async () => {
  const reload = deferred(), started = deferred();
  const c = harness({ reload: () => { started.resolve(); return reload.promise; } });
  const pending = c.sendToSquare('estimate-A'); await started.promise;
  c.state.estimates[0].notes = 'Typed during reload'; c.pending = true;
  reload.resolve(null);
  assert.equal(await pending, false);
  assert.equal(c.state.estimates[0].notes, 'Typed during reload');
  assert.equal(c.calls.blocked.length, 1);
  assert.equal(c.writer.getVersion({ record_type: 'estimate', id: 'estimate-A' }), 7);
});

test('a matching invoice already hydrated by realtime is confirmed without resending financial data', async () => {
  const response = deferred(), started = deferred();
  const c = harness({ fetch: () => { started.resolve(); return response.promise; } });
  const pending = c.sendToSquare('estimate-A'); await started.promise;
  c.state.estimates[0].squareInvoiceId = 'inv:synthetic';
  response.resolve({ ok: true, json: async () => receipt() });
  assert.equal(await pending, true);
  assert.deepEqual(c.calls.save, [{ localOnly: true }]);
  assert.equal(c.calls.fetch.length, 1);
  assert.equal(c.calls.blocked.length, 0);
});

test('sales, existing invoices, missing parents and unsaved versions do not start invoice creation', async () => {
  for (const mutate of [
    c => { c.actor.role = 'sales'; },
    c => { c.state.estimates[0].squareInvoiceId = 'already-published'; },
    c => { c.state.estimates[0].status = 'Draft'; },
    c => { c.missingLead = true; },
    c => { c.missingJob = true; },
    c => { c.getDurableCommitWriter = () => ({ getVersion: () => 0 }); },
  ]) {
    const c = harness(); mutate(c);
    assert.equal(await c.sendToSquare('estimate-A'), false);
    assert.equal(c.calls.fetch.length, 0);
  }
});
