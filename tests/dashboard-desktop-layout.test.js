const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const styles = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');

test('desktop dashboard cards stretch to their grid rows without black gaps', () => {
  assert.match(styles, /\.dashboard-layout\s*\{[\s\S]*?align-items:\s*stretch/);
  assert.match(styles, /\.dashboard-layout\s*>\s*\*\s*\{[\s\S]*?align-self:\s*stretch/);
});

test('dashboard cards are not size-contained while offscreen', () => {
  const optimizationRule = styles.match(/[^{}]+\{\s*content-visibility:\s*auto;\s*contain-intrinsic-size:\s*auto 280px;\s*\}/)?.[0] || '';
  assert.doesNotMatch(optimizationRule, /dashboard-layout|dashboard-panel|leaderboard-panel/);
  assert.match(optimizationRule, /leads-list/);
  assert.match(optimizationRule, /payment-ledger-list/);
});
