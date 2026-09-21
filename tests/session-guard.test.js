const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { create } = require('../session-guard');
const user = { id: 'fixture-sales', email: 'sales@coastalcrestroofing.com', app_metadata: { role: 'sales' } };
test('normal token refresh and profile-name changes do not interrupt the editor', () => {
  const guard = create({ user });
  assert.equal(guard.observe('INITIAL_SESSION', { user }), true);
  assert.equal(guard.observe('TOKEN_REFRESHED', { user, access_token: 'synthetic-new-token' }), true);
  assert.equal(guard.observe('USER_UPDATED', { user: { ...user, user_metadata: { name: 'Changed name' } } }), true);
});
for (const [description, event, session] of [
  ['sign-out', 'SIGNED_OUT', null],
  ['account switch', 'SIGNED_IN', { user: { ...user, id: 'other-user' } }],
  ['role change', 'TOKEN_REFRESHED', { user: { ...user, app_metadata: { role: 'viewer' } } }],
  ['email change', 'USER_UPDATED', { user: { ...user, email: 'other@example.com' } }],
]) {
  test(`${description} invalidates this editor exactly once and cannot silently resume`, () => {
    let notices = 0;
    const guard = create({ user, onInvalidated: () => notices++ });
    assert.equal(guard.observe(event, session), false);
    assert.equal(guard.isCurrent(), false);
    assert.equal(guard.observe('SIGNED_IN', { user }), false);
    assert.equal(guard.allows(user), false);
    assert.equal(notices, 1);
  });
}
test('shared requests are blocked after cross-tab logout, while sign-in remains available', async () => {
  let clientOptions, callback, calls = 0, invalidated = 0;
  const context = vm.createContext({ URL, console,
    fetch: async () => { calls++; return { ok: true }; },
    CustomEvent: class { constructor(type) { this.type = type; } },
    document: { readyState: 'loading', addEventListener() {} },
    window: {
      ROOFLINE_SUPABASE_CONFIG: { supabaseUrl: 'https://synthetic.example', supabaseAnonKey: 'not-a-key', authRequired: true },
      CrmSessionGuard: { create }, dispatchEvent: () => invalidated++,
      supabase: { createClient: (_url, _key, options) => {
        clientOptions = options;
        return { auth: { onAuthStateChange: handler => { callback = handler; } } };
      } },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8'), context);
  context.window.RooflineAuth.bindEditorSession(user);
  await clientOptions.global.fetch('https://synthetic.example/rest/v1/crm_records');
  callback('SIGNED_OUT', null);
  for (const endpoint of ['rest/v1/rpc/crm_commit_records', 'rest/v1/crm_state', 'storage/v1/object/crm-documents/file']) {
    await assert.rejects(clientOptions.global.fetch(`https://synthetic.example/${endpoint}`, { method: 'POST' }), /login changed/);
  }
  await clientOptions.global.fetch('https://synthetic.example/auth/v1/token');
  assert.equal(calls, 2);
  assert.equal(invalidated, 1);
  assert.equal(context.window.RooflineAuth.isEditorSessionCurrent(user), false);
});
