const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');

const widgetIds = [
  'pipeline',
  'revenue',
  'reminders',
  'lead-sources',
  'job-types',
  'project-status',
  'activity',
  'schedule',
  'weather',
  'leaderboard',
];

test('all main dashboard cards participate in the adjustable widget layout', () => {
  assert.match(html, /id="dashboardCustomizeButton"/);
  assert.match(html, /id="dashboardResetLayoutButton"/);
  assert.match(html, /id="dashboardLayout"/);
  for (const id of widgetIds) {
    assert.match(html, new RegExp(`data-dashboard-widget="${id}"`), id);
  }
});

test('widget layout is saved as local per-user UI state without a cloud state save', () => {
  assert.match(app, /dashboardWidgetLayout:\s*state\.dashboardWidgetLayout/);
  const saveFunction = app.match(/function saveDashboardWidgetLayout\(\) \{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(saveFunction, /saveUiState\(\)/);
  assert.doesNotMatch(saveFunction, /saveState|queue|cloud/i);
});

test('dashboard widgets support move, resize and reset controls', () => {
  assert.match(app, /function moveDashboardWidget\(/);
  assert.match(app, /function beginDashboardWidgetResize\(/);
  assert.match(app, /addEventListener\("dragstart"/);
  assert.match(app, /addEventListener\("drop"/);
  assert.match(app, /addEventListener\("pointerdown"/);
  assert.match(app, /dashboardResetLayoutButton\?\.addEventListener/);
});

test('desktop widgets repack densely while mobile retains the automatic stacked layout', () => {
  assert.match(css, /\.dashboard-widget-grid\s*\{[\s\S]*?grid-auto-flow:\s*dense/);
  assert.match(css, /grid-column:\s*span var\(--dashboard-widget-columns/);
  assert.match(css, /grid-row:\s*span var\(--dashboard-widget-rows/);
  assert.match(css, /@media screen and \(max-width:\s*1100px\)[\s\S]*?\.dashboard-layout-controls\s*\{\s*display:\s*none/);
  assert.match(css, /@media screen and \(max-width:\s*1100px\)[\s\S]*?grid-row:\s*auto !important/);
});
