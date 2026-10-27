const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {
  GOOGLE_DRIVE_SCOPE, safeFolderName, createServiceAccountAssertion, exchangeServiceAccountToken, ensureDocumentFolder, uploadDocument,
} = require('../google-drive');

test('Drive service account assertion is short-lived and limited to Drive', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Date.parse('2026-10-05T12:00:00Z');
  const assertion = createServiceAccountAssertion({ clientEmail: 'jobcrest@example.iam.gserviceaccount.com', privateKey }, now);
  const [header, payload, signature] = assertion.split('.');
  assert.ok(header && payload && signature);
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.iss, 'jobcrest@example.iam.gserviceaccount.com');
  assert.equal(claims.scope, GOOGLE_DRIVE_SCOPE);
  assert.equal(claims.exp - claims.iat, 3600);
});

test('Drive uses short-lived application default credentials when no private key is configured', async () => {
  const requestedScopes = [];
  const token = await exchangeServiceAccountToken(null, {
    scopes: [GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_SCOPE],
    googleAuth: {
      async getClient() {
        requestedScopes.push(GOOGLE_DRIVE_SCOPE);
        return { async getAccessToken() { return { token: 'short-lived-token' }; } };
      },
    },
  });
  assert.equal(token, 'short-lived-token');
  assert.deepEqual(requestedScopes, [GOOGLE_DRIVE_SCOPE]);
});

test('Drive explicitly impersonates the configured service account with product scopes', async () => {
  const sourceClient = { async getAccessToken() { return { token: 'source-token' }; } };
  let options;
  const token = await exchangeServiceAccountToken(null, {
    clientEmail: 'jobcrest@example.iam.gserviceaccount.com',
    scopes: [GOOGLE_DRIVE_SCOPE, GOOGLE_DRIVE_SCOPE],
    googleAuth: { async getClient() { return sourceClient; } },
    impersonatedClientFactory(value) {
      options = value;
      return { async getAccessToken() { return { token: 'drive-token' }; } };
    },
  });
  assert.equal(token, 'drive-token');
  assert.equal(options.sourceClient, sourceClient);
  assert.equal(options.targetPrincipal, 'jobcrest@example.iam.gserviceaccount.com');
  assert.deepEqual(options.targetScopes, [GOOGLE_DRIVE_SCOPE]);
  assert.equal(options.lifetime, 3600);
});

test('Drive rejects domain delegation when using keyless application credentials', async () => {
  await assert.rejects(
    exchangeServiceAccountToken(null, { subject: 'admin@example.com', googleAuth: {} }),
    /google_domain_delegation_requires_private_key/,
  );
});

test('Drive folder names remove filesystem separators and control characters', () => {
  assert.equal(safeFolderName(' Lead 12 / Smith: Roof\n '), 'Lead 12 Smith Roof');
  assert.equal(safeFolderName(''), 'Untitled');
});

test('Drive creates a deterministic lead, job and category hierarchy', async () => {
  const calls = [];
  let nextId = 1;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (!options.method) return { ok: true, json: async () => ({ files: [] }) };
    const body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ id: `folder-${nextId++}`, name: body.name, parents: body.parents }) };
  };
  const folders = await ensureDocumentFolder(fetchImpl, 'token', 'root-folder', {
    leadId: 'lead-1', leadNumber: 'L-100', leadName: 'Maya Torres', jobId: 'job-1', projectNumber: 'P-101', jobName: 'Main Roof', categoryId: 'photos', categoryName: 'Photos',
  });
  assert.deepEqual(folders, { leadFolderId: 'folder-1', jobFolderId: 'folder-2', categoryFolderId: 'folder-3' });
  const createdNames = calls.filter((call) => call.options.method === 'POST').map((call) => JSON.parse(call.options.body).name);
  assert.deepEqual(createdNames, ['Lead L-100 - Maya Torres', 'Project P-101 - Main Roof', 'Photos']);
});

test('Drive document upload reuses an existing CRM document version', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return { ok: true, json: async () => ({ files: [{ id: 'drive-file-1', name: 'estimate.pdf', webViewLink: 'https://drive.google.com/file/d/drive-file-1/view' }] }) };
  };
  const result = await uploadDocument(fetchImpl, 'token', 'folder-1', { name: 'estimate.pdf', type: 'application/pdf', bytes: Buffer.from('pdf') }, { documentId: 'doc-1', versionNumber: 2 });
  assert.equal(result.id, 'drive-file-1');
  assert.equal(result.reused, true);
  assert.equal(calls, 1);
});

test('Drive upload sends bytes only after the duplicate check is empty', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (!options.method) return { ok: true, json: async () => ({ files: [] }) };
    return { ok: true, json: async () => ({ id: 'drive-file-2', name: 'photo.jpg', webViewLink: 'https://drive.google.com/file/d/drive-file-2/view' }) };
  };
  const result = await uploadDocument(fetchImpl, 'token', 'folder-1', { name: 'photo.jpg', type: 'image/jpeg', bytes: Buffer.from('image-bytes') }, { documentId: 'photo-1', versionNumber: 1 });
  assert.equal(result.reused, false);
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /upload\/drive\/v3\/files/);
  assert.equal(calls[1].options.method, 'POST');
  assert.ok(Buffer.isBuffer(calls[1].options.body));
});
