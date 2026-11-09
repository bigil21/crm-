const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

test('new estimate uses live lead search and keeps job selection as a dropdown', () => {
  assert.match(html, /id="newEstimateContactSearch"[^>]+type="search"[^>]+role="combobox"/);
  assert.match(html, /id="newEstimateContact" type="hidden"/);
  assert.match(html, /id="newEstimateContactResults"[^>]+role="listbox"/);
  assert.match(html, /<select id="newEstimateJob">/);
  assert.match(app, /function estimateLeadSearchMatches[\s\S]*contactMatchesSearch\(contact, query\)/);
  assert.match(app, /data-estimate-lead-target="\$\{target\}"/);
  assert.match(app, /selectEstimateLead\(first\.dataset\.estimateLeadId, target\)/);
});

test('estimate editor uses the same lead search and retains its job dropdown', () => {
  assert.match(html, /id="estimateContactSearch"[^>]+type="search"[^>]+role="combobox"/);
  assert.match(html, /id="estimateContact" name="contactId" type="hidden" required/);
  assert.match(html, /id="estimateContactResults"[^>]+role="listbox"/);
  assert.match(html, /<select id="estimateJob" name="jobId" required><\/select>/);
  assert.match(app, /updateSelectedEstimateFromField\("contactId", contact\.id\)/);
});

test('lead search covers customer and associated-job fields', () => {
  assert.match(app, /contactSearchFields[\s\S]*job\.name, job\.projectNumber, job\.address/);
  assert.match(app, /Try the customer, address, phone, email, job, or lead number/);
});
