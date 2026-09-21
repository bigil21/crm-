const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../app.js'), 'utf8');
function harness() {
  const state = { company: { name: 'Company', phone: '5551234567', defaultTerms: 'Original' },
    currentUser: { name: 'Tester', email: 'tester@example.invalid', role: 'admin' } };
  let writes = 0, revisions = 0, allowed = true, requests = 0;
  const elements = Object.fromEntries(['name', 'phone', 'defaultTerms', 'userName', 'userEmail', 'userPhone', 'userRole'].map(name => {
    let value = '';
    return [name, { name, type: 'text', get value() { return value; }, set value(next) { value = next; writes++; } }];
  }));
  const c = vm.createContext({ state, els: { companyForm: { elements } },
    canAction: () => allowed, formatPhoneNumber: value => value || '', normalizeCompany: value => value,
    renderDocumentCategoriesSettings() {}, queueLocalStateSave() { revisions++; },
    cloudReady: true, durableBusinessStateAuthoritative: true, sharedStateSnapshot: () => 'baseline', lastCloudSnapshot: 'baseline',
    cloudSaveInFlight: false, durableWriteBlocked: false, localEditRevision: 0,
    fetchCloudRows: async () => { requests++; return { data: [] }; },
  });
  for (const name of ['companyFormValues', 'trackCompanyFormDraft', 'renderCompanyForm', 'hasPendingCompanyChanges', 'reloadCloudState']) {
    const match = source.match(new RegExp(`^( *)(?:async )?function ${name}\\([^]*?^\\1}`, 'm'));
    assert.ok(match, name); vm.runInContext(match[0], c);
  }
  c.renderCompanyForm();
  return { c, state, elements, get writes() { return writes; }, get revisions() { return revisions; }, get requests() { return requests; }, deny() { allowed = false; } };
}
test('settings draft survives unrelated render and focus changes without cursor-resetting writes', () => {
  const h = harness();
  h.elements.defaultTerms.value = 'Still typing the terms';
  h.c.trackCompanyFormDraft({ target: h.elements.defaultTerms });
  const count = h.writes;
  h.c.renderCompanyForm(); h.c.renderCompanyForm();
  assert.equal(h.elements.defaultTerms.value, 'Still typing the terms');
  assert.equal(h.state.company.defaultTerms, 'Original', 'draft is not implicitly submitted');
  assert.equal(h.writes, count, 'unchanged DOM values are not assigned again');
  assert.equal(h.revisions, 1);
  assert.equal(h.c.hasPendingCompanyChanges(), true);
});
test('unsubmitted company fields block remote baseline adoption', async () => {
  const h = harness(); h.elements.name.value = 'Unsaved company';
  h.c.trackCompanyFormDraft({ target: h.elements.name });
  assert.equal(await h.c.reloadCloudState(), false);
  assert.equal(h.requests, 0);
  assert.equal(h.state.company.name, 'Company');
});
test('changing a settings field back to its saved value clears the draft', () => {
  const h = harness(); h.elements.name.value = 'Draft'; h.c.trackCompanyFormDraft({ target: h.elements.name });
  h.elements.name.value = 'Company'; h.c.trackCompanyFormDraft({ target: h.elements.name });
  assert.equal(h.state.companyFormDraft, null); assert.equal(h.c.hasPendingCompanyChanges(), false);
});
test('partial settings drafts do not hide unrelated updated fields', () => {
  const h = harness(); h.elements.name.value = 'Draft'; h.c.trackCompanyFormDraft({ target: h.elements.name });
  h.state.company.phone = '5557654321'; h.c.renderCompanyForm();
  assert.equal(h.elements.name.value, 'Draft'); assert.equal(h.elements.phone.value, '5557654321');
});
test('file controls, unrelated controls, and unauthorized input cannot create a settings draft', () => {
  const h = harness();
  for (const target of [{ name: 'logoDataUrl', type: 'file', value: 'file' }, { name: 'unknown', value: 'bad' }, { value: 'bad' }]) h.c.trackCompanyFormDraft({ target });
  h.deny(); h.elements.name.value = 'Unauthorized'; h.c.trackCompanyFormDraft({ target: h.elements.name });
  assert.equal(h.state.companyFormDraft, undefined); assert.equal(h.revisions, 0);
});
test('draft lifecycle is bound to input, protected on exit, cleared only on submit or fresh cloud startup', () => {
  assert.match(source, /companyForm\.addEventListener\("input", trackCompanyFormDraft\)/);
  assert.match(source, /companyForm\.addEventListener\("change", trackCompanyFormDraft\)/);
  assert.match(source, /isEditorSessionCurrent\(\) && \(state\.companyFormDraft/);
  const save = source.match(/^function saveCompany\([^]*?^}/m)[0];
  assert.ok(save.indexOf('state.companyFormDraft = null') > save.indexOf('state.company ='));
  assert.match(source.match(/^async function startApp\([^]*?^}/m)[0], /state\.companyDocuments = \[\];[^]*?state\.companyFormDraft = null/);
});
