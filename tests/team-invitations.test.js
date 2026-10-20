const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeInviteEmail, createTeamInviteService } = require('../team-invite-service');

const USER_ID = '11111111-2222-4333-8444-555555555555';

function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function service(fetchImpl) {
  return createTeamInviteService({
    fetchImpl,
    origin: 'https://project.supabase.co',
    key: 'sb_secret_test',
    companyId: 'coastal-crest',
    allowedEmailDomain: 'coastalcrestroofing.com',
    appOrigin: 'https://jobcrestcrm.com',
  });
}

test('team invitations accept only the configured company domain', () => {
  assert.equal(normalizeInviteEmail(' New.Rep@CoastalCrestRoofing.com ', 'coastalcrestroofing.com'), 'new.rep@coastalcrestroofing.com');
  assert.throws(() => normalizeInviteEmail('rep@example.com', 'coastalcrestroofing.com'), /limited/);
  assert.throws(() => normalizeInviteEmail('not-an-email', 'coastalcrestroofing.com'), /valid work email/);
});

test('a new rep receives an invite that opens Create Password and approved sales access', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/auth/v1/admin/users')) return response(200, { users: [] });
    if (String(url).includes('/auth/v1/invite')) return response(200, { id: USER_ID, email: 'new.rep@coastalcrestroofing.com' });
    if (String(url).includes('/rest/v1/crm_user_access')) return response(201);
    throw new Error(`Unexpected request: ${url}`);
  };
  const result = await service(fetchImpl).invite('new.rep@coastalcrestroofing.com');
  assert.deepEqual(result, { email: 'new.rep@coastalcrestroofing.com', role: 'sales', sent: true, existing: false });
  const invite = calls.find(call => call.url.includes('/auth/v1/invite'));
  assert.match(invite.url, /redirect_to=https%3A%2F%2Fjobcrestcrm\.com%2Flogin%3Finvite%3D1%26redirect%3D%252F/);
  assert.equal(JSON.parse(invite.options.body).email, 'new.rep@coastalcrestroofing.com');
  const access = calls.find(call => call.url.includes('/rest/v1/crm_user_access'));
  assert.deepEqual(JSON.parse(access.options.body), {
    user_id: USER_ID, email: 'new.rep@coastalcrestroofing.com', role: 'sales', approved: true,
    approved_at: JSON.parse(access.options.body).approved_at,
  });
});

test('re-inviting an existing rep repairs access and sends a password setup email', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/auth/v1/admin/users')) return response(200, { users: [{ id: USER_ID, email: 'levi@coastalcrestroofing.com' }] });
    if (String(url).includes('/rest/v1/crm_user_access')) return response(201);
    if (String(url).includes('/auth/v1/recover')) return response(200);
    throw new Error(`Unexpected request: ${url}`);
  };
  const result = await service(fetchImpl).invite('levi@coastalcrestroofing.com');
  assert.equal(result.existing, true);
  assert.equal(calls.some(call => call.url.includes('/auth/v1/invite')), false);
  const recovery = calls.find(call => call.url.includes('/auth/v1/recover'));
  assert.match(recovery.url, /invite%3D1/);
  assert.ok(calls.findIndex(call => call.url.includes('/rest/v1/crm_user_access')) < calls.findIndex(call => call.url.includes('/auth/v1/recover')));
});

test('an access provisioning failure is explicit instead of claiming onboarding succeeded', async () => {
  const fetchImpl = async (url) => {
    if (String(url).includes('/auth/v1/admin/users')) return response(200, { users: [] });
    if (String(url).includes('/auth/v1/invite')) return response(200, { id: USER_ID });
    if (String(url).includes('/rest/v1/crm_user_access')) return response(500, { message: 'hidden database detail' });
    throw new Error(`Unexpected request: ${url}`);
  };
  await assert.rejects(() => service(fetchImpl).invite('new.rep@coastalcrestroofing.com'), error => error.code === 'access_provision_failed');
});
