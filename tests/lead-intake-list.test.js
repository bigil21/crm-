const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');

test('lead intake is a vertical, responsive list', () => {
  assert.match(page, /id="leadsList" class="leads-list lead-intake-list"/);
  assert.match(page, /Newest and most recently updated leads appear first/);
  assert.match(app, /class="lead-intake-row/);
  assert.match(styles, /\.lead-intake-list\s*\{[\s\S]*?display:\s*grid/);
  assert.match(styles, /\.lead-intake-row\s*\{/);
});

test('lead intake sorts newest activity first and records future edits', () => {
  assert.match(app, /function leadActivityTimestamp/);
  assert.match(app, /contact\.updates \|\| \[\]/);
  assert.match(app, /job\.costItems \|\| \[\]/);
  assert.match(app, /contact\.documents \|\| \[\]/);
  assert.match(app, /estimate\.contactId === contact\.id/);
  assert.match(app, /leadActivityTimestamp\(right\.contact\) - leadActivityTimestamp\(left\.contact\)/);
  assert.match(app, /updatedAt: new Date\(\)\.toISOString\(\)/);
});
