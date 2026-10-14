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

test('recovery notice dismissal is stable for the same draft and changes for new work', () => {
  const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
  const context = vm.createContext({ Math });
  vm.runInContext(extract(source, 'recoveryNoticeKey'), context);
  const first = [{ key: 'draft-a', raw: '{"updatedAt":"one"}' }];
  assert.equal(context.recoveryNoticeKey(first), context.recoveryNoticeKey([...first]));
  assert.notEqual(context.recoveryNoticeKey(first), context.recoveryNoticeKey([{ ...first[0], raw: '{"updatedAt":"two"}' }]));
  assert.match(source, /addNoticeCloseButton\(panel, dismissalKey/);
  assert.match(source, /aria-label/);
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
