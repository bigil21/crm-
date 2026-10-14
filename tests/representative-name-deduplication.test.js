const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const start = app.indexOf('function normalizePersonName');
const end = app.indexOf('\nfunction nl2br', start);
const source = app.slice(start, end);
const context = {};
vm.runInNewContext(`${source}\nthis.normalizePersonName = normalizePersonName;`, context);

test('repeated full representative names collapse to one display name', () => {
  assert.equal(context.normalizePersonName('Gilberto Arellano Gilberto Arellano'), 'Gilberto Arellano');
  assert.equal(context.normalizePersonName('  Gilberto   Arellano   GILBERTO ARELLANO  '), 'Gilberto Arellano');
  assert.equal(context.normalizePersonName('Mary Ann Smith Mary Ann Smith'), 'Mary Ann Smith');
});

test('valid names are preserved and representative sources share normalization', () => {
  assert.equal(context.normalizePersonName('Gilberto Arellano'), 'Gilberto Arellano');
  assert.equal(context.normalizePersonName('Gil Gil'), 'Gil Gil');
  assert.match(app, /salesRep: normalizePersonName/);
  assert.match(app, /projectManager: normalizePersonName/);
  assert.match(app, /function uniqueSalesReps\(\)[\s\S]*?const unique = new Map\(\)/);
});
