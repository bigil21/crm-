// Regression tests for the October 2026 code review fixes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sendGmailMessage } = require('../google-workspace');

const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');

function extract(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  for (let i = source.indexOf('{', source.indexOf(')', start)); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`could not extract ${name}`);
}

function load(names, context = {}) {
  const sandbox = vm.createContext({ Intl, Date, Math, Number, String, ...context });
  vm.runInContext(`${names.map((name) => extract(app, name)).join('\n')}\nthis.api = { ${names.join(', ')} };`, sandbox);
  return sandbox.api;
}

test('formatDate accepts full timestamps such as Square paidAt without throwing', () => {
  const { formatDate } = load(['formatDate']);
  assert.equal(formatDate('2026-10-14'), 'Oct 14, 2026');
  assert.match(formatDate('2026-10-14T18:22:01Z'), /^Oct 14, 2026$/);
  assert.equal(formatDate('not a date'), 'Not set');
  assert.equal(formatDate(''), 'Not set');
});

test('payment percentages never round up to 100% while money is owed', () => {
  const { floorPercent } = load(['floorPercent']);
  assert.equal(floorPercent((9960 / 10000) * 100), 99);
  assert.equal(floorPercent(100), 100);
  assert.equal(floorPercent(((0.1 + 0.2) / 0.3) * 100), 100);
});

test('date-only values are read as local calendar days', () => {
  const { localTimestamp } = load(['localTimestamp']);
  const day = new Date(localTimestamp('2026-10-01'));
  assert.equal(day.getDate(), 1);
  assert.equal(day.getMonth(), 9);
  assert.equal(localTimestamp('2026-10-14T18:22:01Z'), Date.parse('2026-10-14T18:22:01Z'));
});

test('saving an edit dialog keeps fields the user did not change', () => {
  assert.match(app, /rememberFormBaseline\(els\.contactForm\)/);
  assert.match(app, /rememberFormBaseline\(els\.leadJobForm\)/);
  assert.match(app, /keepLatestUnchanged\(contact, existing, unchangedFormFields\(els\.contactForm, formData\)/);
  assert.match(app, /latestUnchangedJobFields\(existing, unchangedFormFields\(els\.leadJobForm, formData\)\)/);
});

test('payment-link email asks only for the amount still due', () => {
  assert.match(app, /Math\.max\(number\(estimate\.deposit\) - paid, 0\) \|\| Math\.max\(contractValue - paid, 0\)/);
  assert.match(app, /estimate\.squareInvoiceUrl && !isPaid/);
});

test('Gmail send distinguishes a rejected send from an unconfirmed one', async () => {
  const email = { fromEmail: 'rep@coastalcrestroofing.com', toEmail: 'a@example.com', subject: 'Hi', message: 'Hello' };
  const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });
  await assert.rejects(sendGmailMessage(reply(400, {}), 'token', email), /gmail_send_failed/);
  await assert.rejects(sendGmailMessage(reply(401, {}), 'token', email), /google_access_expired/);
  await assert.rejects(sendGmailMessage(reply(200, {}), 'token', email), /gmail_send_unconfirmed/);
});

test('Vercel routes every request through the authenticated server handler', () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../vercel.json'), 'utf8'));
  assert.equal(config.outputDirectory, 'vercel-public');
  assert.deepEqual(config.rewrites, [{ source: '/(.*)', destination: '/api/index' }]);
});
