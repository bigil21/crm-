const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function extract(source, name) {
  const match = source.match(new RegExp(`^( *)function ${name}\\([^]*?^\\1}`, 'm'));
  if (!match) throw new Error(`Missing ${name}`);
  return match[0];
}

function memory() {
  const data = new Map();
  return { get length() { return data.size; }, key: i => [...data.keys()][i] || null,
    getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}

test('earlier recovery copies are retained without reopening a login banner', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  assert.match(source, /const earlier = draftRecoveryStore\.list\(\)/);
  assert.doesNotMatch(source, /showPreviousDraftRecovery\(earlier\.entries\)/);
  assert.doesNotMatch(source, /id = "crmSaveRecovery"/);
});

test('external links do not destroy a valid signed-in tab session', () => {
  const source = fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8');
  const functions = ['removeAuthKeys', 'isExternalCrmEntry'];
  const sessionStorage = memory();
  sessionStorage.setItem('sb-project-auth-token', 'session');
  sessionStorage.setItem('jobcrest.crm.sign-in-unlock', 'pending');
  const context = vm.createContext({ URL, AUTH_STORAGE_KEY_PATTERN: /^(?:sb-|.*supabase\.auth(?:\.token)?)/,
    location: { pathname: '/', origin: 'https://jobcrestcrm.com' },
    document: { referrer: 'https://www.google.com/search?q=jobcrest' } });
  vm.runInContext(functions.map(name => extract(source, name)).join('\n'), context);
  assert.equal(context.isExternalCrmEntry(), false);
  assert.equal(sessionStorage.getItem('sb-project-auth-token'), 'session');
  assert.equal(sessionStorage.getItem('jobcrest.crm.sign-in-unlock'), 'pending');
  context.document.referrer = 'https://jobcrestcrm.com/login';
  assert.equal(context.isExternalCrmEntry(), false);
});

test('Supabase recovery and invite callbacks are forwarded to password setup before their hash is consumed', () => {
  const source = fs.readFileSync(path.join(__dirname, '../auth.js'), 'utf8');
  const context = vm.createContext({ URLSearchParams, window: { location: {} } });
  vm.runInContext(extract(source, 'passwordSetupCallbackType'), context);

  assert.equal(context.passwordSetupCallbackType({ hash: '#access_token=token&type=recovery', search: '' }), 'recovery');
  assert.equal(context.passwordSetupCallbackType({ hash: '', search: '?type=recovery' }), 'recovery');
  assert.equal(context.passwordSetupCallbackType({ hash: '#access_token=token&type=invite', search: '' }), 'invite');
  assert.equal(context.passwordSetupCallbackType({ hash: '#access_token=token&type=magiclink', search: '' }), '');
  assert.match(source, /passwordSetupType && auth\.user && !auth\.accessDenied/);
  assert.match(source, /passwordSetupType === "invite"/);
});
