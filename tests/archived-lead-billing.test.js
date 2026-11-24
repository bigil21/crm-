// An archived lead is hidden from every list and all totals, its estimates and
// invoices included (QA 77). Found on production while clearing test records:
// archiving a test lead with a $100 Square invoice left "$100.00 owed on
// invoices" on the Billing screen.
// Nothing here touches a network or a real database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function load(names, globals = {}) {
  const context = vm.createContext({ ...globals });
  for (const name of names) {
    const match = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    assert.ok(match, `Function ${name} exists`);
    vm.runInContext(match[0], context);
  }
  return context;
}

const state = {
  contacts: [
    { id: 'lead-live', ownerUserId: 'me' },
    { id: 'lead-archived', ownerUserId: 'me', archived: true },
    { id: 'lead-other-rep', ownerUserId: 'someone-else' },
  ],
  estimates: [
    { id: 'est-live', contactId: 'lead-live', ownerUserId: 'me' },
    { id: 'est-archived', contactId: 'lead-archived', ownerUserId: 'me', squareInvoiceId: 'inv-1', contractValue: 100 },
    { id: 'est-other-rep', contactId: 'lead-other-rep', ownerUserId: 'someone-else' },
    { id: 'est-no-lead', contactId: 'lead-not-loaded', ownerUserId: 'me' },
  ],
};

test('an archived lead\'s estimates are put away with it', () => {
  const rep = load(['leadIsArchived', 'visibleEstimates'], { state, recordOwnedByCurrentUser: (record) => record?.ownerUserId === 'me' });
  assert.deepEqual(Array.from(rep.visibleEstimates(), (estimate) => estimate.id), ['est-live', 'est-no-lead']);
  // A manager sees everyone's estimates, and still not the archived lead's.
  const manager = load(['leadIsArchived', 'visibleEstimates'], { state, recordOwnedByCurrentUser: (record) => Boolean(record) });
  assert.deepEqual(Array.from(manager.visibleEstimates(), (estimate) => estimate.id), ['est-live', 'est-other-rep', 'est-no-lead']);
  assert.equal(rep.leadIsArchived('lead-archived'), true);
  assert.equal(rep.leadIsArchived('lead-live'), false);
  assert.equal(rep.leadIsArchived('lead-not-loaded'), false);
  assert.equal(rep.leadIsArchived(''), false);
});

test('restoring the lead brings its estimates back', () => {
  const restored = { contacts: state.contacts.map((contact) => ({ ...contact, archived: false })), estimates: state.estimates };
  const c = load(['leadIsArchived', 'visibleEstimates'], { state: restored, recordOwnedByCurrentUser: (record) => record?.ownerUserId === 'me' });
  assert.ok(Array.from(c.visibleEstimates(), (estimate) => estimate.id).includes('est-archived'));
});

test('Billing leaves an archived lead\'s invoices out of what was issued and what is owed', () => {
  const billing = source.match(/^function renderInvoicesView\([^]*?^}/m)[0];
  // Square invoices come from the estimates that are shown, which no longer include an archived lead's.
  assert.match(billing, /const estimates = \[\.\.\.visibleEstimates\(\)\]/);
  // Invoices made in the CRM are filtered the same way before any total is added up.
  assert.match(billing, /const internalInvoices = \(state\.invoices \|\| \[\]\)\.filter\(\(invoice\) => !leadIsArchived\(invoice\.contactId\)\)/);
  assert.ok(billing.indexOf('leadIsArchived(invoice.contactId)') < billing.indexOf('const totalInvoiced'), 'filtered before the totals');
  assert.ok(billing.indexOf('leadIsArchived(invoice.contactId)') < billing.indexOf('const totalPending'));
});
