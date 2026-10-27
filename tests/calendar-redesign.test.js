const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');

test('calendar provides day, week, month and schedule views', () => {
  for (const view of ['day', 'week', 'month', 'schedule']) {
    assert.match(page, new RegExp(`data-calendar-view="${view}"`));
  }
  assert.match(app, /function renderCalendarTimeGrid/);
  assert.match(app, /function renderCalendarMonth/);
  assert.match(app, /function renderCalendarSchedule/);
});

test('calendar keeps CRM context and representative filters', () => {
  assert.match(page, /id="calendarRepFilters"/);
  assert.match(page, /id="calendarTaskContact"/);
  assert.match(page, /id="calendarTaskJob"/);
  assert.match(app, /data-action="open-contact-tab"/);
  assert.match(app, /data-action="open-job"/);
});

test('calendar events support drag rescheduling and duration resizing', () => {
  assert.match(app, /addEventListener\("dragstart"/);
  assert.match(app, /addEventListener\("drop"/);
  assert.match(app, /data-calendar-resize/);
  assert.match(app, /async function rescheduleCalendarTask/);
  assert.match(app, /syncCalendarTaskToGoogle\(next\)/);
});

test('schedule keeps unfinished overdue tasks visible', () => {
  assert.match(app, /filter\(\(task\) => !task\.completed \|\| new Date\(task\.dueAt\) >= start\)/);
});

test('calendar layout is responsive and preserves a usable mobile agenda', () => {
  assert.match(styles, /\.calendar-workspace/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.calendar-agenda-day/);
  assert.match(styles, /\.calendar-resize-handle/);
});
