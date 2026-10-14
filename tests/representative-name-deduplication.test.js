const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = app.indexOf('function normalizePersonName');
const end = app.indexOf('\nfunction nl2br', start);
const source = app.slice(start, end);
const context = {};
vm.runInNewContext(`${source}\nthis.normalizePersonName = normalizePersonName;`, context);

test('repeated full representative names collapse to one display name', () => {
  assert.equal(context.normalizePersonName('Gilberto Arellano Gilberto Arellano'), 'Gilberto Arellano');
  assert.equal(context.normalizePersonName('  Gilberto   Arellano   GILBERTO ARELLANO  '), 'Gilberto Arellano');
  assert.equal(context.normalizePersonName('Mary Ann Smith Mary Ann Smith'), 'Mary Ann Smith');
  assert.equal(context.normalizePersonName('Gilberto\u200b Arellano Gilberto Arellano'), 'Gilberto Arellano');
});

test('valid names are preserved and representative sources share normalization', () => {
  assert.equal(context.normalizePersonName('Gilberto Arellano'), 'Gilberto Arellano');
  assert.equal(context.normalizePersonName('Gil Gil'), 'Gil Gil');
  assert.match(app, /salesRep: normalizePersonName/);
  assert.match(app, /projectManager: normalizePersonName/);
  assert.match(app, /function uniqueSalesReps\(\)[\s\S]*?const unique = new Map\(\)/);
});

test('sales representative inputs share one app-controlled suggestion list', () => {
  assert.equal((page.match(/<datalist id="salesRepOptions">/g) || []).length, 1);
  assert.equal((page.match(/list="salesRepOptions"/g) || []).length, 4);
  assert.doesNotMatch(page, /list="salesRepOptions"[^>]*autocomplete="name"/);
  assert.match(app, /renderBrandLogo\(\);\s*renderSalesRepOptions\(\);/);
});

test('lead overview shows the representative only in the dedicated Sales Rep field', () => {
  assert.match(app, /\["Sales Rep", contact\.salesRep \|\| "Unassigned", "Owner"\]/);
  assert.doesNotMatch(app, /contact\.status} - \$\{contact\.salesRep/);
  assert.doesNotMatch(app, /contact\.source \|\| "No source"\)} &middot; \$\{escapeHtml\(contact\.salesRep/);
});
