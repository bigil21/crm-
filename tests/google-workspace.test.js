const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GOOGLE_CALENDAR_SCOPE, GOOGLE_GMAIL_SEND_SCOPE, GOOGLE_GMAIL_READ_SCOPE,
  createOAuthState, verifyOAuthState, createAuthorizationUrl,
  encryptSecret, decryptSecret, calendarEventResource, upsertCalendarEvent, deleteCalendarEvent,
  gmailMessageResource, sendGmailMessage, fetchGmailThread,
} = require('../google-workspace');

const stateSecret = 'state-secret-that-is-at-least-thirty-two-characters';
const encryptionKey = Buffer.alloc(32, 7).toString('base64');

test('Google OAuth state is signed, scoped and expires', () => {
  const now = Date.parse('2026-10-05T12:00:00Z');
  const state = createOAuthState({ sub: 'user-1', email: 'Rep@Example.com', company: 'coastal-crest' }, stateSecret, now);
  assert.deepEqual(verifyOAuthState(state, stateSecret, now + 1000), { sub: 'user-1', email: 'rep@example.com', company: 'coastal-crest' });
  const [body, signature] = state.split('.');
  const tampered = `${body}.${signature.slice(0, 5)}${signature[5] === 'a' ? 'b' : 'a'}${signature.slice(6)}`;
  assert.throws(() => verifyOAuthState(tampered, stateSecret, now + 1000), /invalid_oauth_state/);
  assert.throws(() => verifyOAuthState(state, stateSecret, now + 11 * 60 * 1000), /expired_oauth_state/);
});

test('authorization URL requests offline access and the required Calendar and Gmail scopes', () => {
  const url = new URL(createAuthorizationUrl(
    { clientId: 'client-id', redirectUri: 'https://jobcrestcrm.com/api/integrations/google/callback' },
    { email: 'rep@example.com' }, 'signed-state',
  ));
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('include_granted_scopes'), 'true');
  assert.equal(url.searchParams.get('login_hint'), 'rep@example.com');
  assert.equal(url.searchParams.get('state'), 'signed-state');
  assert.ok(url.searchParams.get('scope').includes(GOOGLE_CALENDAR_SCOPE));
  assert.ok(url.searchParams.get('scope').includes(GOOGLE_GMAIL_SEND_SCOPE));
  assert.ok(url.searchParams.get('scope').includes(GOOGLE_GMAIL_READ_SCOPE));
});

test('Gmail message encoding rejects header injection and creates a plain-text MIME message', () => {
  const resource = gmailMessageResource({
    fromEmail: 'rep@example.com', toEmail: 'client@example.com', subject: 'Inspection follow-up', message: 'Hello client.\n\nThank you.',
  });
  const decoded = Buffer.from(resource.raw, 'base64url').toString('utf8');
  assert.match(decoded, /^From: rep@example\.com\r\nTo: client@example\.com\r\nSubject: Inspection follow-up/m);
  assert.match(decoded, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(decoded, /Hello client\.\r\n\r\nThank you\./);
  assert.throws(() => gmailMessageResource({ fromEmail: 'rep@example.com', toEmail: 'client@example.com', subject: 'Hello\r\nBcc: attacker@example.com', message: 'test' }), /invalid_subject/);
});

test('Gmail can send a completed Smart Document as a bounded PDF attachment', () => {
  const resource = gmailMessageResource({
    fromEmail: 'rep@example.com', toEmail: 'client@example.com', subject: 'Completed agreement', message: 'Attached is your completed document.',
    attachment: { name: 'Agreement - Completed.pdf', type: 'application/pdf', bytes: Buffer.from('%PDF-test') },
  });
  const decoded = Buffer.from(resource.raw, 'base64url').toString('utf8');
  assert.match(decoded, /Content-Type: multipart\/mixed/);
  assert.match(decoded, /Content-Type: application\/pdf; name="Agreement - Completed\.pdf"/);
  assert.match(decoded, /Content-Disposition: attachment; filename="Agreement - Completed\.pdf"/);
  assert.match(decoded, new RegExp(Buffer.from('%PDF-test').toString('base64')));
  assert.throws(() => gmailMessageResource({
    fromEmail: 'rep@example.com', toEmail: 'client@example.com', subject: 'Bad attachment', message: 'test',
    attachment: { name: 'bad.pdf', type: 'application/pdf', bytes: Buffer.alloc(20 * 1024 * 1024 + 1) },
  }), /invalid_gmail_attachment/);
});

test('Gmail sends one message and returns durable provider identifiers', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ id: 'message-1', threadId: 'thread-1' }) };
  };
  const result = await sendGmailMessage(fetchImpl, 'token', {
    fromEmail: 'rep@example.com', toEmail: 'client@example.com', subject: 'Update', message: 'The inspection is complete.',
  });
  assert.deepEqual(result, { messageId: 'message-1', threadId: 'thread-1' });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/users\/me\/messages\/send$/);
});

test('Gmail thread reader returns bounded inbound and outbound messages', async () => {
  const body = (value) => Buffer.from(value).toString('base64url');
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({
    id: 'thread-1', messages: [
      { id: 'message-1', internalDate: String(Date.parse('2026-10-05T12:00:00Z')), payload: { mimeType: 'text/plain', headers: [
        { name: 'From', value: 'Rep <rep@example.com>' }, { name: 'To', value: 'client@example.com' }, { name: 'Subject', value: 'Update' },
      ], body: { data: body('Sent update') } } },
      { id: 'message-2', internalDate: String(Date.parse('2026-10-05T13:00:00Z')), payload: { mimeType: 'multipart/alternative', headers: [
        { name: 'From', value: 'Client <client@example.com>' }, { name: 'To', value: 'rep@example.com' }, { name: 'Subject', value: 'Re: Update' },
      ], parts: [{ mimeType: 'text/plain', body: { data: body('Thanks!') } }] } },
    ],
  }) });
  const messages = await fetchGmailThread(fetchImpl, 'token', 'thread-1', 'rep@example.com');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].direction, 'outbound');
  assert.equal(messages[1].direction, 'inbound');
  assert.equal(messages[1].message, 'Thanks!');
});

test('refresh tokens use authenticated encryption and reject the wrong key', () => {
  const encrypted = encryptSecret('refresh-token-value', encryptionKey);
  assert.notEqual(encrypted, 'refresh-token-value');
  assert.equal(decryptSecret(encrypted, encryptionKey), 'refresh-token-value');
  assert.throws(() => decryptSecret(encrypted, Buffer.alloc(32, 8).toString('base64')), /encrypted_secret_invalid/);
});

test('calendar event carries CRM reference, lead details and reminder choice', () => {
  const event = calendarEventResource({ id: 'task-1', title: 'Call homeowner', dueAt: '2026-10-05T14:30:00-04:00', duration: 45, reminder: 'none', notes: 'Discuss color.' },
    { name: 'Jordan Blake', phone: '555-111-2222', email: 'jordan@example.com', address: '1 Main St\nCharlotte, NC' });
  assert.equal(event.summary, 'Call homeowner');
  assert.equal(event.location, '1 Main St, Charlotte, NC');
  assert.equal(event.extendedProperties.private.jobcrestTaskId, 'task-1');
  assert.deepEqual(event.reminders, { useDefault: false, overrides: [] });
  assert.match(event.description, /Related Lead: Jordan Blake/);
  assert.equal(Date.parse(event.end.dateTime) - Date.parse(event.start.dateTime), 45 * 60 * 1000);
});

test('calendar sync inserts once and updates the saved Google event thereafter', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ id: 'google-event-1', htmlLink: 'https://calendar.google.com/calendar/event?eid=1', updated: '2026-10-05T18:00:00Z' }) };
  };
  const base = { id: 'task-1', title: 'Inspection', dueAt: '2026-10-05T14:30:00-04:00', duration: 30, reminder: 'popup' };
  const created = await upsertCalendarEvent(fetchImpl, 'access-token', base, null, 'America/New_York');
  await upsertCalendarEvent(fetchImpl, 'access-token', { ...base, googleEventId: created.eventId }, null, 'America/New_York');
  assert.equal(calls[0].options.method, 'POST');
  assert.match(calls[0].url, /\/calendars\/primary\/events$/);
  assert.equal(calls[1].options.method, 'PUT');
  assert.match(calls[1].url, /\/events\/google-event-1$/);
});

test('calendar removal deletes the saved event and treats an already-missing event as success', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: false, status: 404 };
  };
  assert.deepEqual(await deleteCalendarEvent(fetchImpl, 'access-token', 'google-event-1'), { deleted: true });
  assert.equal(calls[0].options.method, 'DELETE');
  assert.match(calls[0].url, /\/events\/google-event-1$/);
});
