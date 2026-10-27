const crypto = require("node:crypto");
const { GoogleAuth, Impersonated } = require("google-auth-library");

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3";
const GOOGLE_DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
const GOOGLE_DOCS_SCOPE = "https://www.googleapis.com/auth/documents";
const GOOGLE_SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
const GOOGLE_ADMIN_GROUP_SCOPE = "https://www.googleapis.com/auth/admin.directory.group.member";
const GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const FOLDER_MIME = "application/vnd.google-apps.folder";

function safeDriveId(value, field = "drive_id") {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{3,200}$/.test(id)) throw new Error(`invalid_${field}`);
  return id;
}

function safeRecordId(value, field = "record_id") {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(id)) throw new Error(`invalid_${field}`);
  return id;
}

function safeFolderName(value, fallback = "Untitled") {
  const name = String(value || "").replace(/[\u0000-\u001f<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return name || fallback;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function createServiceAccountAssertion(config, now = Date.now()) {
  const issued = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: config.clientEmail,
    scope: [...new Set(Array.isArray(config.scopes) && config.scopes.length ? config.scopes : [GOOGLE_DRIVE_SCOPE])].join(" "),
    ...(config.subject ? { sub: String(config.subject).trim().toLowerCase() } : {}),
    aud: GOOGLE_TOKEN_URL,
    iat: issued,
    exp: issued + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), config.privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

async function exchangeServiceAccountToken(fetchImpl, config, now = Date.now()) {
  if (!config.privateKey) {
    if (config.subject) throw new Error("google_domain_delegation_requires_private_key");
    const scopes = [...new Set(Array.isArray(config.scopes) && config.scopes.length ? config.scopes : [GOOGLE_DRIVE_SCOPE])];
    const auth = config.googleAuth || new GoogleAuth({ scopes });
    let client = await auth.getClient();
    const alreadyImpersonating = Boolean(client?.serviceAccountImpersonationUrl)
      || client instanceof Impersonated;
    if (alreadyImpersonating && "scopes" in client) client.scopes = scopes;
    if (config.clientEmail && !alreadyImpersonating) {
      const sourceAuth = config.googleAuth || new GoogleAuth({ scopes: [GOOGLE_CLOUD_PLATFORM_SCOPE] });
      const sourceClient = config.googleAuth ? client : await sourceAuth.getClient();
      const impersonationOptions = {
        sourceClient,
        targetPrincipal: config.clientEmail,
        targetScopes: scopes,
        lifetime: 3600,
      };
      client = typeof config.impersonatedClientFactory === "function"
        ? config.impersonatedClientFactory(impersonationOptions)
        : new Impersonated(impersonationOptions);
    }
    const tokenResult = await client.getAccessToken();
    const accessToken = typeof tokenResult === "string" ? tokenResult : tokenResult?.token;
    if (typeof accessToken !== "string" || !accessToken) throw new Error("google_drive_token_failed");
    return accessToken;
  }
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: createServiceAccountAssertion(config, now) }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.access_token !== "string" || !result.access_token) throw new Error("google_drive_token_failed");
  return result.access_token;
}

function escapeDriveQuery(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}

async function findFolder(fetchImpl, accessToken, parentId, propertyKey, propertyValue) {
  const parent = safeDriveId(parentId, "drive_parent");
  const key = safeRecordId(propertyKey, "property_key");
  const value = safeRecordId(propertyValue, "property_value");
  const query = `'${escapeDriveQuery(parent)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false and appProperties has { key='${escapeDriveQuery(key)}' and value='${escapeDriveQuery(value)}' }`;
  const url = new URL(`${GOOGLE_DRIVE_API}/files`);
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "files(id,name,webViewLink,parents)");
  url.searchParams.set("pageSize", "2");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${accessToken}` } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(result.files)) throw new Error("google_drive_lookup_failed");
  if (result.files.length > 1) throw new Error("google_drive_duplicate_folder");
  return result.files[0] || null;
}

async function createFolder(fetchImpl, accessToken, parentId, name, appProperties) {
  const response = await fetchImpl(`${GOOGLE_DRIVE_API}/files?supportsAllDrives=true&fields=id,name,webViewLink,parents`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: safeFolderName(name), mimeType: FOLDER_MIME, parents: [safeDriveId(parentId, "drive_parent")], appProperties }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.id !== "string") throw new Error("google_drive_folder_create_failed");
  return { ...result, id: safeDriveId(result.id) };
}

async function findOrCreateFolder(fetchImpl, accessToken, parentId, name, propertyKey, propertyValue) {
  return await findFolder(fetchImpl, accessToken, parentId, propertyKey, propertyValue)
    || await createFolder(fetchImpl, accessToken, parentId, name, { [propertyKey]: safeRecordId(propertyValue, "property_value") });
}

async function ensureDocumentFolder(fetchImpl, accessToken, rootFolderId, context) {
  const root = safeDriveId(rootFolderId, "drive_root");
  if (context.companyDocument) {
    const library = await findOrCreateFolder(fetchImpl, accessToken, root, "Company Library", "jobcrestFolder", "company-library");
    const category = await findOrCreateFolder(fetchImpl, accessToken, library.id, context.categoryName || "Other", "jobcrestCategory", safeRecordId(context.categoryId || "other", "category"));
    return { leadFolderId: "", jobFolderId: "", categoryFolderId: category.id };
  }
  const leadId = safeRecordId(context.leadId, "lead");
  const jobId = safeRecordId(context.jobId, "job");
  const leadLabel = `Lead ${context.leadNumber || leadId} - ${context.leadName || "Customer"}`;
  const jobLabel = `Project ${context.projectNumber || jobId} - ${context.jobName || "Job"}`;
  const lead = await findOrCreateFolder(fetchImpl, accessToken, root, leadLabel, "jobcrestLeadId", leadId);
  const job = await findOrCreateFolder(fetchImpl, accessToken, lead.id, jobLabel, "jobcrestJobId", jobId);
  const category = await findOrCreateFolder(fetchImpl, accessToken, job.id, context.categoryName || "Other", "jobcrestCategory", safeRecordId(context.categoryId || "other", "category"));
  return { leadFolderId: lead.id, jobFolderId: job.id, categoryFolderId: category.id };
}

async function findDocument(fetchImpl, accessToken, folderId, documentId, versionNumber) {
  const parent = safeDriveId(folderId, "drive_parent");
  const document = safeRecordId(documentId, "document");
  const version = String(Math.max(1, Number(versionNumber) || 1));
  const query = `'${escapeDriveQuery(parent)}' in parents and trashed=false and appProperties has { key='jobcrestDocumentId' and value='${escapeDriveQuery(document)}' } and appProperties has { key='jobcrestVersion' and value='${version}' }`;
  const url = new URL(`${GOOGLE_DRIVE_API}/files`);
  url.searchParams.set("q", query);
  url.searchParams.set("fields", "files(id,name,mimeType,size,webViewLink,parents)");
  url.searchParams.set("pageSize", "2");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${accessToken}` } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(result.files)) throw new Error("google_drive_lookup_failed");
  if (result.files.length > 1) throw new Error("google_drive_duplicate_document");
  return result.files[0] || null;
}

async function uploadDocument(fetchImpl, accessToken, folderId, document, metadata) {
  const existing = await findDocument(fetchImpl, accessToken, folderId, metadata.documentId, metadata.versionNumber);
  if (existing) return { ...existing, id: safeDriveId(existing.id), reused: true };
  if (!Buffer.isBuffer(document.bytes) || !document.bytes.length || document.bytes.length > 50 * 1024 * 1024) throw new Error("google_drive_file_too_large");
  const boundary = `jobcrest_${crypto.randomBytes(12).toString("hex")}`;
  const fileMetadata = {
    name: safeFolderName(document.name, "Document"),
    parents: [safeDriveId(folderId, "drive_parent")],
    appProperties: {
      jobcrestDocumentId: safeRecordId(metadata.documentId, "document"),
      jobcrestVersion: String(Math.max(1, Number(metadata.versionNumber) || 1)),
    },
  };
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(fileMetadata)}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${String(document.type || "application/octet-stream").replace(/[\r\n]/g, "")}\r\n\r\n`),
    document.bytes,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  const response = await fetchImpl(`${GOOGLE_DRIVE_UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,mimeType,size,webViewLink,parents`, {
    method: "POST", signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": `multipart/related; boundary=${boundary}`, "Content-Length": String(body.length) }, body,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.id !== "string") throw new Error("google_drive_upload_failed");
  return { ...result, id: safeDriveId(result.id), reused: false };
}

module.exports = {
  GOOGLE_DRIVE_SCOPE, GOOGLE_DOCS_SCOPE, GOOGLE_SHEETS_SCOPE, GOOGLE_ADMIN_GROUP_SCOPE,
  safeDriveId, safeFolderName, createServiceAccountAssertion, exchangeServiceAccountToken,
  findOrCreateFolder, ensureDocumentFolder, findDocument, uploadDocument,
};
