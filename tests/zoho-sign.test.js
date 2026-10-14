const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ZOHO_SIGN_SCOPES, MAX_ZOHO_SIGN_FILE_SIZE, createAuthorizationUrl,
  revokeRefreshToken, createSmartDocument, createEmbeddedSendUrl,
} = require('../zoho-sign');

const config = {
  clientId: 'client-id', clientSecret: 'secret',
  redirectUri: 'https://jobcrestcrm.com/api/integrations/zoho/callback',
  accountsOrigin: 'https://accounts.zoho.com', signApiOrigin: 'https://sign.zoho.com', signWebOrigin: 'https://sign.zoho.com',
};

test('Zoho OAuth requests offline access with only document scopes', () => {
  const url = new URL(createAuthorizationUrl(config, 'signed-state'));
  assert.equal(url.origin, config.accountsOrigin);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('state'), 'signed-state');
  assert.deepEqual(url.searchParams.get('scope').split(','), ZOHO_SIGN_SCOPES);
});

test('Zoho disconnect revokes the provider refresh token', async () => {
  const calls = [];
  await revokeRefreshToken(async (url, options) => { calls.push({ url: String(url), options }); return { ok: true }; }, config, 'refresh-token');
  assert.equal(calls[0].options.method, 'POST');
  assert.match(calls[0].url, /^https:\/\/accounts\.zoho\.com\/oauth\/v2\/token\/revoke\?token=refresh-token$/);
  await assert.rejects(revokeRefreshToken(async () => ({ ok: false }), config, 'refresh-token'), /zoho_token_revocation_failed/);
});

test('Smart Document upload creates a draft with one verified signer', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, json: async () => ({ status: 'success', requests: { request_id: '14197000000767334', request_status: 'draft' } }) };
  };
  const created = await createSmartDocument(fetchImpl, config, 'token',
    { name: 'Contract.pdf', type: 'application/pdf', size: 4, bytes: Buffer.from('test') },
    { name: 'Jordan Blake', email: 'Jordan@Example.com', expirationDays: 10, notes: 'Please sign.' });
  assert.equal(created.requestId, '14197000000767334');
  assert.equal(created.recipientEmail, 'jordan@example.com');
  assert.equal(calls[0].options.method, 'POST');
  assert.match(calls[0].options.headers.Authorization, /^Zoho-oauthtoken /);
});

test('Smart Document validation rejects unsupported and oversized files before network access', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; };
  await assert.rejects(createSmartDocument(fetchImpl, config, 'token',
    { name: 'archive.zip', size: 1, bytes: Buffer.from('x') }, { name: 'Signer', email: 'signer@example.com' }), /unsupported_zoho_sign_file/);
  await assert.rejects(createSmartDocument(fetchImpl, config, 'token',
    { name: 'large.pdf', size: MAX_ZOHO_SIGN_FILE_SIZE + 1, bytes: Buffer.alloc(0) }, { name: 'Signer', email: 'signer@example.com' }), /zoho_sign_file_too_large/);
  assert.equal(called, false);
});

test('embedded send URL is accepted only from the configured Zoho Sign origin', async () => {
  const good = async () => ({ ok: true, json: async () => ({ status: 'success', send_url: 'https://sign.zoho.com/embedsend?send_id=short-lived' }) });
  assert.match(await createEmbeddedSendUrl(good, config, 'token', '14197000000767334'), /^https:\/\/sign\.zoho\.com\/embedsend/);
  const malicious = async () => ({ ok: true, json: async () => ({ status: 'success', send_url: 'https://evil.example/embedsend?send_id=x' }) });
  await assert.rejects(createEmbeddedSendUrl(malicious, config, 'token', '14197000000767334'), /zoho_sign_link_failed/);
});
