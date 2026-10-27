const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("node:crypto");
const {
  createOAuthState, verifyOAuthState, createAuthorizationUrl, exchangeAuthorizationCode,
  refreshAccessToken, revokeGoogleToken, fetchGoogleIdentity, encryptSecret, decryptSecret, upsertCalendarEvent, deleteCalendarEvent,
  GOOGLE_GMAIL_SEND_SCOPE, GOOGLE_GMAIL_READ_SCOPE, sendGmailMessage, fetchGmailThread, gmailMessageResource,
} = require(path.join(__dirname, "google-workspace"));
const {
  GOOGLE_DRIVE_SCOPE, GOOGLE_DOCS_SCOPE, GOOGLE_SHEETS_SCOPE, GOOGLE_ADMIN_GROUP_SCOPE,
  safeDriveId, exchangeServiceAccountToken, ensureDocumentFolder, findOrCreateFolder, uploadDocument: uploadGoogleDriveDocument,
} = require(path.join(__dirname, "google-drive"));
const {
  GOOGLE_TASKS_SCOPE, GOOGLE_CONTACTS_SCOPE, verifyDriveRoot, copyGoogleDocTemplate, mergeGoogleDoc,
  createGoogleSheet, ensureTaskList, upsertGoogleTask, deleteGoogleTask, upsertGoogleContact, sendGoogleChatWebhook,
  watchGmail, decodeGmailPush, addGoogleGroupMember,
} = require(path.join(__dirname, "google-products"));
const {
  ZOHO_SIGN_SCOPES, createAuthorizationUrl: createZohoAuthorizationUrl,
  exchangeAuthorizationCode: exchangeZohoAuthorizationCode,
  refreshAccessToken: refreshZohoAccessToken, revokeRefreshToken: revokeZohoRefreshToken, createSmartDocument, createEmbeddedSendUrl,
} = require(path.join(__dirname, "zoho-sign"));
const {
  normalizeFields: normalizeSmartDocumentFields,
  normalizeResponses: normalizeSmartDocumentResponses,
  renderCompletedDocument,
} = require(path.join(__dirname, "smart-documents"));
const { createTeamInviteService } = require(path.join(__dirname, "team-invite-service"));
const { createCustomerPortalService } = require(path.join(__dirname, "customer-portal-service"));

const root = __dirname;
const envPaths = process.env.CRM_SKIP_ENV_FILES === "true" ? [] : [path.join(root, ".env"), path.join(root, ".env.local")];

envPaths.forEach((envPath) => {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
});

const port = Number(process.env.PORT || 4173);
const allowedEmailDomain = process.env.ALLOWED_EMAIL_DOMAIN || "coastalcrestroofing.com";
// Only these shipped browser assets are public. Never serve the repository itself.
const publicAssets = new Set([
  "/index.html", "/login.html", "/logout.html", "/reset-session.html", "/portal.html", "/portal.js",
  "/styles.css", "/app.js", "/record-writes.js", "/company-settings-writes.js", "/sales-numbering.js", "/payment-refresh.js", "/draft-recovery.js", "/session-guard.js", "/auth.js", "/login.js", "/logout.js", "/sw.js",
  "/production-flow-v64.js", "/workflow-checklists-v65.js", "/project-conversations-v67.js", "/team-onboarding.js",
  "/vendor/jspdf.umd.min.js", "/vendor/pdf.min.mjs", "/vendor/pdf.worker.min.mjs", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png",
]);
const publicAssetFiles = new Map([
  ["/vendor/pdf.min.mjs", path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.min.mjs")],
  ["/vendor/pdf.worker.min.mjs", path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs")],
]);

function authenticationRequired() {
  return !(process.env.NODE_ENV === "development" && process.env.ALLOW_LOCAL_DEMO === "true" && process.env.AUTH_REQUIRED === "false");
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function sendRedirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function supabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    anonKey:
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "",
  };
}

function authConfigScript() {
  const authConfig = squareStatusPublicConfig();
  const config = {
    supabaseUrl: authConfig?.origin || "",
    supabaseAnonKey: authConfig?.anonKey || "",
    allowedEmailDomain,
    defaultRole: process.env.DEFAULT_AUTH_ROLE || "viewer",
    authRequired: authenticationRequired(),
    syncEnabled: process.env.SUPABASE_SYNC_ENABLED === "true",
    stateId: process.env.SUPABASE_STATE_ID || "coastal-crest",
    stagingTestIdentity: stagingTestIdentity(),
    // Background workers never run inside a Vercel function, so don't tell the
    // browser to rely on them there.
    squarePaymentWorkerEnabled: !process.env.VERCEL && process.env.SQUARE_PAYMENT_WORKER_ENABLED === "true" && Boolean(squareWorkerConfig() && squareToken() && squareStatusSafeId(process.env.SQUARE_MERCHANT_ID)),
  };
  return `window.ROOFLINE_SUPABASE_CONFIG = ${JSON.stringify(config)};`;
}

function stagingTestIdentity() {
  // This exception cannot be enabled by a live Render deployment or a different
  // Supabase project, even if staging flags are accidentally copied there.
  if (process.env.CRM_STAGING_ACCESS !== "true" || process.env.NODE_ENV !== "development" ||
      process.env.CRM_SKIP_ENV_FILES !== "true" || !authenticationRequired() ||
      process.env.SUPABASE_SYNC_ENABLED !== "true" || process.env.SQUARE_ACCESS_TOKEN) return null;
  const projectOrigin = "https://ixksmfiektzsunmmwejz.supabase.co";
  if (supabaseConfig().url.replace(/\/$/, "") !== projectOrigin) return null;
  const email = String(process.env.CRM_STAGING_TEST_EMAIL || "").trim().toLowerCase();
  const userId = process.env.CRM_STAGING_TEST_USER_ID || "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId)) return null;
  return { email, userId, projectOrigin };
}

function isAllowedApiUser(user) {
  if (String(user?.email || "").toLowerCase().endsWith(`@${allowedEmailDomain.toLowerCase()}`)) return true;
  const test = stagingTestIdentity();
  return Boolean(test && user?.id === test.userId && String(user.email || "").toLowerCase() === test.email && user.app_metadata?.role === "sales");
}

const SQUARE_BASE = process.env.SQUARE_ENVIRONMENT === "sandbox"
  ? "https://connect.squareupsandbox.com/v2" : "https://connect.squareup.com/v2";
const SQUARE_VERSION = "2024-01-18";

function squareToken() {
  return process.env.SQUARE_ACCESS_TOKEN || "";
}

function squareWebhookKey() {
  return process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || "";
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

async function verifyApiUser(req) {
  if (!authenticationRequired()) {
    return { email: `local@${allowedEmailDomain}`, app_metadata: { role: "admin" }, local: true };
  }
  const config = squareStatusPublicConfig();
  const authorization = req.headers.authorization || "";
  if (!config || !/^Bearer \S+$/.test(authorization)) return null;
  const response = await fetch(`${config.origin}/auth/v1/user`, {
    signal: AbortSignal.timeout(15000),
    headers: { apikey: config.anonKey, Authorization: authorization },
  });
  if (!response.ok) return null;
  const user = await response.json();
  if (!isAllowedApiUser(user)) return null;
  const accessResponse = await fetch(`${config.origin}/rest/v1/rpc/crm_access_profile`, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { apikey: config.anonKey, Authorization: authorization, "Content-Type": "application/json" },
    body: "{}",
  });
  const access = await accessResponse.json().catch(() => null);
  if (!accessResponse.ok || access?.approved !== true) return null;
  return { ...user, app_metadata: { ...(user.app_metadata || {}), role: String(access.role || "viewer") } };
}

async function requireApiUser(req, res, handler) {
  try {
    const user = await verifyApiUser(req);
    if (!user) {
      sendJson(res, 401, { error: "authentication_required" });
      return;
    }
    await handler(req, res, user);
  } catch (error) {
    console.error("Authenticated API request failed", {
      path: String(req.url || "").split("?")[0],
      code: String(error?.code || error?.name || "request_failed").slice(0, 80),
    });
    sendJson(res, 500, { error: "request_failed" });
  }
}

function isApiAdmin(user = {}) {
  return Boolean(
    user.local ||
      String(user.app_metadata?.role || "").toLowerCase() === "admin",
  );
}

function canManageAssignedCalendar(user = {}) {
  return isApiAdmin(user) || ["office_manager", "sales_manager", "operations_manager"]
    .includes(String(user.app_metadata?.role || "").toLowerCase());
}

const localOAuthConnections = new Map();
const localOAuthStates = new Map();

function googleWorkspaceConfig() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
  const redirectUri = String(process.env.GOOGLE_REDIRECT_URI || "").trim();
  const stateSecret = String(process.env.GOOGLE_OAUTH_STATE_SECRET || "");
  const encryptionKey = String(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || "");
  let redirect;
  try {
    redirect = new URL(redirectUri);
    const loopback = ["localhost", "127.0.0.1"].includes(redirect.hostname);
    if ((!loopback && redirect.protocol !== "https:") || (loopback && !["http:", "https:"].includes(redirect.protocol)) || redirect.username || redirect.password || redirect.hash) return null;
  } catch { return null; }
  if (!clientId || !clientSecret || stateSecret.length < 32 || !/^[A-Za-z0-9+/]{43}=$/.test(encryptionKey)) return null;
  return {
    clientId, clientSecret, redirectUri: redirect.toString(), stateSecret, encryptionKey,
    additionalScopes: [GOOGLE_TASKS_SCOPE, GOOGLE_CONTACTS_SCOPE, GOOGLE_ADMIN_GROUP_SCOPE],
  };
}

function googleDriveConfig() {
  const clientEmail = String(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL || "").trim().toLowerCase();
  const privateKey = String(process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replaceAll("\\n", "\n").trim();
  const applicationCredentials = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  const rootFolderId = String(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || "").trim();
  const hasPrivateKey = privateKey.includes("BEGIN PRIVATE KEY");
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.iam\.gserviceaccount\.com$/.test(clientEmail) || (!hasPrivateKey && !applicationCredentials)) return null;
  try { safeDriveId(rootFolderId, "drive_root"); } catch { return null; }
  return { clientEmail, ...(hasPrivateKey ? { privateKey } : { applicationCredentials }), rootFolderId, credentialMode: hasPrivateKey ? "private-key" : "application-default" };
}

function googleProductsConfig() {
  const drive = googleDriveConfig();
  if (!drive) return null;
  let templates = {};
  try { templates = JSON.parse(process.env.GOOGLE_DOCS_TEMPLATES_JSON || "{}"); } catch { templates = {}; }
  templates = Object.fromEntries(Object.entries(templates).filter(([key, value]) => /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(key) && /^[A-Za-z0-9_-]{3,200}$/.test(String(value))));
  const groups = String(process.env.GOOGLE_GROUP_ALLOWLIST || "").split(",").map((value) => value.trim().toLowerCase()).filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  const delegatedAdmin = String(process.env.GOOGLE_ADMIN_DELEGATED_USER || "").trim().toLowerCase();
  const gmailTopic = String(process.env.GOOGLE_GMAIL_PUBSUB_TOPIC || "").trim();
  const gmailVerificationToken = String(process.env.GOOGLE_GMAIL_PUSH_VERIFICATION_TOKEN || "");
  const chatWebhook = String(process.env.GOOGLE_CHAT_WEBHOOK_URL || "").trim();
  return { ...drive, templates, groups, delegatedAdmin, gmailTopic, gmailVerificationToken, chatWebhook };
}

function integrationStoreConfig() {
  if (!authenticationRequired()) return { local: true, companyId: process.env.SUPABASE_STATE_ID || "coastal-crest" };
  const config = squareWorkerConfig();
  return config ? { ...config, local: false } : null;
}

function integrationStoreKey(companyId, provider, email) {
  return `${companyId}:${provider}:${String(email).toLowerCase()}`;
}

function integrationServiceHeaders(config, extra = {}) {
  return {
    apikey: config.key,
    ...(!config.key.startsWith("sb_secret_") ? { Authorization: `Bearer ${config.key}` } : {}),
    ...extra,
  };
}

function oauthStateHash(state) {
  return crypto.createHash("sha256").update(String(state || "")).digest("hex");
}

async function storeOAuthState(store, provider, identity, state) {
  const stateHash = oauthStateHash(state);
  if (store.local) {
    localOAuthStates.set(stateHash, { provider, userId: identity.sub, companyId: store.companyId, expiresAt: Date.now() + 10 * 60 * 1000 });
    return;
  }
  const response = await fetch(`${store.origin}/rest/v1/crm_oauth_states`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: integrationServiceHeaders(store, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ state_hash: stateHash, company_state_id: store.companyId, provider, crm_user_id: identity.sub, expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() }),
  });
  if (!response.ok) throw new Error("integration_state_store_unavailable");
}

async function consumeOAuthState(store, provider, identity, state) {
  const stateHash = oauthStateHash(state);
  if (store.local) {
    const saved = localOAuthStates.get(stateHash);
    localOAuthStates.delete(stateHash);
    if (!saved || saved.provider !== provider || saved.userId !== identity.sub || saved.companyId !== store.companyId || saved.expiresAt < Date.now()) throw new Error("invalid_oauth_state");
    return;
  }
  const url = new URL(`${store.origin}/rest/v1/crm_oauth_states`);
  url.searchParams.set("state_hash", `eq.${stateHash}`);
  url.searchParams.set("company_state_id", `eq.${store.companyId}`);
  url.searchParams.set("provider", `eq.${provider}`);
  url.searchParams.set("crm_user_id", `eq.${identity.sub}`);
  url.searchParams.set("expires_at", `gt.${new Date().toISOString()}`);
  const response = await fetch(url, {
    method: "DELETE", signal: AbortSignal.timeout(15000),
    headers: integrationServiceHeaders(store, { Prefer: "return=representation" }),
  });
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows) || rows.length !== 1) throw new Error("invalid_oauth_state");
}

async function getProviderConnection(store, provider, email) {
  const normalized = String(email || "").toLowerCase();
  if (!/^(google|zoho)$/.test(provider)) throw new Error("invalid_integration_provider");
  if (store.local) return localOAuthConnections.get(integrationStoreKey(store.companyId, provider, normalized)) || null;
  const url = new URL(`${store.origin}/rest/v1/crm_oauth_connections`);
  url.searchParams.set("select", "company_state_id,provider,crm_user_id,crm_email,provider_email,provider_subject,encrypted_refresh_token,scopes,updated_at");
  url.searchParams.set("company_state_id", `eq.${store.companyId}`);
  url.searchParams.set("provider", `eq.${provider}`);
  url.searchParams.set("crm_email", `eq.${normalized}`);
  url.searchParams.set("revoked_at", "is.null");
  url.searchParams.set("limit", "2");
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: integrationServiceHeaders(store) });
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows) || rows.length > 1) throw new Error("integration_store_unavailable");
  return rows[0] || null;
}

async function putProviderConnection(store, provider, connection) {
  if (!/^(google|zoho)$/.test(provider)) throw new Error("invalid_integration_provider");
  if (store.local) {
    localOAuthConnections.set(integrationStoreKey(store.companyId, provider, connection.crm_email), { ...connection, company_state_id: store.companyId, provider });
    return;
  }
  const response = await fetch(`${store.origin}/rest/v1/crm_oauth_connections?on_conflict=company_state_id,provider,crm_email`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: integrationServiceHeaders(store, { "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ ...connection, company_state_id: store.companyId, provider, revoked_at: null, updated_at: new Date().toISOString() }),
  });
  if (!response.ok) throw new Error("integration_store_unavailable");
}

async function revokeProviderConnection(store, provider, email) {
  const normalized = String(email || "").toLowerCase();
  if (!/^(google|zoho)$/.test(provider)) throw new Error("invalid_integration_provider");
  if (store.local) {
    localOAuthConnections.delete(integrationStoreKey(store.companyId, provider, normalized));
    return;
  }
  const url = new URL(`${store.origin}/rest/v1/crm_oauth_connections`);
  url.searchParams.set("company_state_id", `eq.${store.companyId}`);
  url.searchParams.set("provider", `eq.${provider}`);
  url.searchParams.set("crm_email", `eq.${normalized}`);
  const response = await fetch(url, {
    method: "PATCH", signal: AbortSignal.timeout(15000),
    headers: integrationServiceHeaders(store, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ revoked_at: new Date().toISOString(), encrypted_refresh_token: "" }),
  });
  if (!response.ok) throw new Error("integration_store_unavailable");
}

const getGoogleConnection = (store, email) => getProviderConnection(store, "google", email);
const putGoogleConnection = (store, connection) => putProviderConnection(store, "google", connection);
const revokeGoogleConnection = (store, email) => revokeProviderConnection(store, "google", email);

async function handleGoogleStatus(req, res, user) {
  const config = googleWorkspaceConfig();
  const store = integrationStoreConfig();
  if (!config || !store) {
    sendJson(res, 200, { configured: false, connected: false, email: String(user.email || "").toLowerCase() }); return;
  }
  const connection = await getGoogleConnection(store, user.email);
  const scopes = new Set(connection?.scopes || []);
  const products = googleProductsConfig();
  sendJson(res, 200, {
    configured: true, connected: Boolean(connection), email: String(user.email || "").toLowerCase(),
    providerEmail: connection?.provider_email || "", calendar: Boolean(connection),
    gmailSend: scopes.has(GOOGLE_GMAIL_SEND_SCOPE), gmailRead: scopes.has(GOOGLE_GMAIL_READ_SCOPE),
    tasks: scopes.has(GOOGLE_TASKS_SCOPE), contacts: scopes.has(GOOGLE_CONTACTS_SCOPE),
    drive: Boolean(googleDriveConfig()), docs: Boolean(products && Object.keys(products.templates).length),
    sheets: Boolean(googleDriveConfig()), chat: Boolean(products?.chatWebhook),
    gmailPush: Boolean(products?.gmailTopic && products?.gmailVerificationToken),
    groups: Boolean(products?.groups.length && scopes.has(GOOGLE_ADMIN_GROUP_SCOPE)),
    docTemplates: Object.keys(products?.templates || {}).map((key) => ({
      key, label: key.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
    })),
    ...(isApiAdmin(user) ? { groupOptions: products?.groups || [] } : {}),
  });
}

async function handleGoogleConnect(req, res, user) {
  const config = googleWorkspaceConfig();
  const store = integrationStoreConfig();
  if (!config || !store) { sendJson(res, 503, { error: "Google Workspace is not configured." }); return; }
  const identity = { sub: user.id || "local-admin", email: user.email, company: store.companyId };
  const state = createOAuthState(identity, config.stateSecret);
  await storeOAuthState(store, "google", identity, state);
  sendJson(res, 200, { authorizationUrl: createAuthorizationUrl(config, identity, state) });
}

async function handleGoogleCallback(url, res) {
  const config = googleWorkspaceConfig();
  const store = integrationStoreConfig();
  if (!config || !store) { sendRedirect(res, "/?google=not-configured"); return; }
  try {
    if (url.searchParams.get("error")) throw new Error("google_consent_denied");
    const identity = verifyOAuthState(url.searchParams.get("state"), config.stateSecret);
    if (identity.company !== store.companyId) throw new Error("invalid_oauth_state");
    await consumeOAuthState(store, "google", identity, url.searchParams.get("state"));
    const tokens = await exchangeAuthorizationCode(fetch, config, url.searchParams.get("code"));
    const googleIdentity = await fetchGoogleIdentity(fetch, tokens.access_token);
    if (googleIdentity.email !== identity.email) throw new Error("google_email_mismatch");
    const existing = await getGoogleConnection(store, identity.email);
    const refreshToken = tokens.refresh_token || (existing ? decryptSecret(existing.encrypted_refresh_token, config.encryptionKey) : "");
    if (!refreshToken) throw new Error("google_refresh_token_missing");
    await putGoogleConnection(store, {
      crm_user_id: identity.sub, crm_email: identity.email, provider_email: googleIdentity.email,
      provider_subject: googleIdentity.subject, encrypted_refresh_token: encryptSecret(refreshToken, config.encryptionKey),
      scopes: [...new Set([
        ...(existing?.scopes || []),
        ...String(tokens.scope || "").split(/\s+/).filter(Boolean),
      ])],
    });
    const products = googleProductsConfig();
    if (products?.gmailTopic && products?.gmailVerificationToken && String(tokens.scope || "").split(/\s+/).includes(GOOGLE_GMAIL_READ_SCOPE)) {
      try { await watchGmail(fetch, tokens.access_token, products.gmailTopic); }
      catch (watchError) { console.warn("Gmail push watch could not start after OAuth", { code: watchError?.message }); }
    }
    sendRedirect(res, "/?google=connected");
  } catch (error) {
    const code = ["google_email_mismatch", "google_consent_denied"].includes(error.message) ? error.message : "connection_failed";
    sendRedirect(res, `/?google=${encodeURIComponent(code)}`);
  }
}

function driveCategoryId(data = {}) {
  const valid = (value) => /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(String(value || "")) ? String(value) : "";
  const slug = String(data.category || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  // Keep the IDs earlier versions used (e.g. "Other") so existing Drive folders are reused.
  return valid(data.categoryId) || valid(data.category) || valid(data.folderId) || (slug ? `category-${slug}` : "other");
}

async function handleGoogleDisconnect(req, res, user) {
  const config = googleWorkspaceConfig();
  const store = integrationStoreConfig();
  if (!config || !store) { sendJson(res, 503, { error: "Google Workspace is not configured." }); return; }
  const connection = await getGoogleConnection(store, user.email);
  if (connection?.encrypted_refresh_token) {
    try {
      await revokeGoogleToken(fetch, decryptSecret(connection.encrypted_refresh_token, config.encryptionKey));
    } catch (error) {
      // Access may already be removed on Google's side; still disconnect here.
      console.warn("Google token revoke failed during disconnect:", error.message);
    }
  }
  await revokeGoogleConnection(store, user.email);
  sendJson(res, 200, { disconnected: true });
}

async function handleGoogleCalendarEvent(req, res, user) {
  const config = googleWorkspaceConfig();
  const store = integrationStoreConfig();
  if (!config || !store) { sendJson(res, 503, { error: "Google Workspace is not configured." }); return; }
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid task data." }); return; }
  const targetEmail = String(payload?.ownerEmail || user.email || "").trim().toLowerCase();
  if (!targetEmail.endsWith(`@${allowedEmailDomain.toLowerCase()}`) || (targetEmail !== String(user.email || "").toLowerCase() && !canManageAssignedCalendar(user))) {
    sendJson(res, 403, { error: "You cannot write to this representative's calendar." }); return;
  }
  const connection = await getGoogleConnection(store, targetEmail);
  if (!connection) { sendJson(res, 409, { error: "The assigned representative has not connected Google Calendar.", code: "google_not_connected" }); return; }
  try {
    const refreshToken = decryptSecret(connection.encrypted_refresh_token, config.encryptionKey);
    const tokens = await refreshAccessToken(fetch, config, refreshToken);
    const result = await upsertCalendarEvent(fetch, tokens.access_token, payload.task || {}, payload.contact || null, process.env.CRM_TIME_ZONE || "America/New_York");
    sendJson(res, 200, { synced: true, ownerEmail: targetEmail, ...result });
  } catch (error) {
    sendJson(res, 502, { error: error.message === "google_calendar_write_failed" ? "Google Calendar rejected the event." : "Google Calendar could not be updated." });
  }
}

async function handleGoogleCalendarDelete(req, res, user) {
  const config = googleWorkspaceConfig();
  const store = integrationStoreConfig();
  if (!config || !store) { sendJson(res, 503, { error: "Google Workspace is not configured." }); return; }
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid event data." }); return; }
  const targetEmail = String(payload?.ownerEmail || user.email || "").trim().toLowerCase();
  if (!targetEmail.endsWith(`@${allowedEmailDomain.toLowerCase()}`) || (targetEmail !== String(user.email || "").toLowerCase() && !canManageAssignedCalendar(user))) {
    sendJson(res, 403, { error: "You cannot remove events from this representative's calendar." }); return;
  }
  const connection = await getGoogleConnection(store, targetEmail);
  if (!connection) { sendJson(res, 409, { error: "The assigned representative has not connected Google Calendar.", code: "google_not_connected" }); return; }
  try {
    const refreshToken = decryptSecret(connection.encrypted_refresh_token, config.encryptionKey);
    const tokens = await refreshAccessToken(fetch, config, refreshToken);
    await deleteCalendarEvent(fetch, tokens.access_token, payload?.eventId);
    sendJson(res, 200, { deleted: true, ownerEmail: targetEmail });
  } catch (error) {
    sendJson(res, 502, { error: error.message === "google_calendar_delete_failed" ? "Google Calendar rejected the event removal." : "Google Calendar could not remove the event." });
  }
}

async function googleAccessForUser(user, requiredScope) {
  const config = googleWorkspaceConfig();
  const store = integrationStoreConfig();
  if (!config || !store) throw new Error("google_not_configured");
  const connection = await getGoogleConnection(store, user.email);
  if (!connection) throw new Error("google_not_connected");
  if (!(connection.scopes || []).includes(requiredScope)) throw new Error("google_scope_missing");
  const refreshToken = decryptSecret(connection.encrypted_refresh_token, config.encryptionKey);
  const tokens = await refreshAccessToken(fetch, config, refreshToken);
  return { accessToken: tokens.access_token, connection };
}

async function handleGoogleGmailSend(req, res, user) {
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid email data." }); return; }
  try {
    const { accessToken, connection } = await googleAccessForUser(user, GOOGLE_GMAIL_SEND_SCOPE);
    const result = await sendGmailMessage(fetch, accessToken, {
      fromEmail: connection.provider_email,
      toEmail: payload?.toEmail,
      subject: payload?.subject,
      message: payload?.message,
      threadId: payload?.threadId || "",
    });
    sendJson(res, 200, { sent: true, fromEmail: connection.provider_email, sentAt: new Date().toISOString(), ...result });
  } catch (error) {
    const status = ["invalid_email", "invalid_subject", "invalid_message", "invalid_gmail_thread"].includes(error.message) ? 400
      : ["google_not_connected", "google_scope_missing"].includes(error.message) ? 409 : error.message === "google_not_configured" ? 503 : 502;
    const messages = {
      google_not_configured: "Google Workspace is not configured.",
      google_not_connected: "Connect Google Workspace before sending from Gmail.",
      google_scope_missing: "Reconnect Google Workspace to approve Gmail access.",
      invalid_email: "Enter a valid customer email address.",
      invalid_subject: "Enter a valid email subject.",
      invalid_message: "Enter an email message under 500 KB.",
      invalid_gmail_thread: "The Gmail thread is invalid.",
      gmail_send_failed: "Gmail rejected the message.",
    };
    sendJson(res, status, { error: messages[error.message] || "Gmail could not send the message.", code: error.message });
  }
}

async function handleGoogleGmailThreads(req, res, user) {
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid thread request." }); return; }
  const threadIds = [...new Set(Array.isArray(payload?.threadIds) ? payload.threadIds : [])].slice(0, 20);
  if (!threadIds.length) { sendJson(res, 400, { error: "Choose at least one Gmail thread." }); return; }
  try {
    const { accessToken, connection } = await googleAccessForUser(user, GOOGLE_GMAIL_READ_SCOPE);
    const threads = [];
    for (const threadId of threadIds) {
      threads.push({ threadId, messages: await fetchGmailThread(fetch, accessToken, threadId, connection.provider_email) });
    }
    sendJson(res, 200, { synced: true, threads });
  } catch (error) {
    const status = error.message === "invalid_gmail_thread" ? 400
      : ["google_not_connected", "google_scope_missing"].includes(error.message) ? 409 : error.message === "google_not_configured" ? 503 : 502;
    const message = error.message === "google_scope_missing" ? "Reconnect Google Workspace to approve Gmail reply access."
      : error.message === "google_not_connected" ? "Connect Google Workspace before checking Gmail replies."
      : error.message === "invalid_gmail_thread" ? "The Gmail thread is invalid."
      : "Gmail replies could not be refreshed.";
    sendJson(res, status, { error: message, code: error.message });
  }
}

async function handleGoogleTask(req, res, user) {
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid Google Task request." }); return; }
  const ownerEmail = String(payload?.ownerEmail || user.email || "").trim().toLowerCase();
  if (ownerEmail !== String(user.email || "").toLowerCase() && !canManageAssignedCalendar(user)) {
    sendJson(res, 403, { error: "You cannot write to this representative's Google Tasks." }); return;
  }
  try {
    const { accessToken } = await googleAccessForUser({ ...user, email: ownerEmail }, GOOGLE_TASKS_SCOPE);
    const list = await ensureTaskList(fetch, accessToken);
    const result = await upsertGoogleTask(fetch, accessToken, list.id, payload?.task || {});
    sendJson(res, 200, { synced: true, ownerEmail, taskListId: list.id, ...result });
  } catch (error) {
    const status = ["google_not_connected", "google_scope_missing"].includes(error.message) ? 409
      : ["invalid_task_title", "invalid_task_notes", "invalid_google_task"].includes(error.message) ? 400 : 502;
    sendJson(res, status, { error: error.message === "google_scope_missing" ? "Reconnect Google Workspace to approve Google Tasks." : "Google Tasks could not be updated.", code: error.message });
  }
}

async function handleGoogleTaskDelete(req, res, user) {
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid Google Task request." }); return; }
  const ownerEmail = String(payload?.ownerEmail || user.email || "").trim().toLowerCase();
  if (ownerEmail !== String(user.email || "").toLowerCase() && !canManageAssignedCalendar(user)) {
    sendJson(res, 403, { error: "You cannot remove this representative's Google Task." }); return;
  }
  try {
    const { accessToken } = await googleAccessForUser({ ...user, email: ownerEmail }, GOOGLE_TASKS_SCOPE);
    await deleteGoogleTask(fetch, accessToken, payload?.taskListId, payload?.taskId);
    sendJson(res, 200, { deleted: true });
  } catch (error) {
    const status = ["google_not_connected", "google_scope_missing"].includes(error.message) ? 409
      : ["invalid_task_list", "invalid_google_task"].includes(error.message) ? 400 : 502;
    sendJson(res, status, { error: "Google Tasks could not remove the task.", code: error.message });
  }
}

async function handleGoogleContact(req, res, user) {
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid Google Contact request." }); return; }
  try {
    const store = integrationStoreConfig();
    if (!store || store.local) throw new Error("shared_storage_required");
    const record = await getTrustedRecord(store, "contact", payload?.contactId);
    if (!canAccessTrustedRecord(user, record)) throw new Error("contact_not_found");
    const { accessToken } = await googleAccessForUser(user, GOOGLE_CONTACTS_SCOPE);
    const result = await upsertGoogleContact(fetch, accessToken, {
      name: record.data.name, email: record.data.email, phone: record.data.phone, address: record.data.address,
      company: record.data.company || "", jobTitle: "JobCrest customer", notes: `JobCrest Lead ${record.data.leadNumber || record.id}`,
      googleContactResourceName: payload?.googleContactResourceName || record.data.googleContactResourceName || "",
      etag: payload?.etag || record.data.googleContactEtag || "",
    });
    sendJson(res, 200, { synced: true, ...result });
  } catch (error) {
    const status = error.message === "contact_not_found" ? 404 : ["google_not_connected", "google_scope_missing"].includes(error.message) ? 409
      : ["google_contact_etag_missing", "invalid_google_contact"].includes(error.message) ? 400 : 502;
    sendJson(res, status, { error: error.message === "google_scope_missing" ? "Reconnect Google Workspace to approve Google Contacts." : "The lead could not be copied to Google Contacts.", code: error.message });
  }
}

async function handleGoogleDriveVerify(req, res) {
  const config = googleProductsConfig();
  if (!config) { sendJson(res, 503, { error: "Google Shared Drive is not configured.", code: "google_drive_not_configured" }); return; }
  try {
    const accessToken = await exchangeServiceAccountToken(fetch, { ...config, scopes: [GOOGLE_DRIVE_SCOPE] });
    const root = await verifyDriveRoot(fetch, accessToken, config.rootFolderId);
    sendJson(res, 200, { verified: true, root });
  } catch (error) {
    sendJson(res, 502, { error: "The configured JobCrest Shared Drive folder could not be verified.", code: error.message });
  }
}

async function handleGoogleDocsGenerate(req, res, user) {
  const config = googleProductsConfig();
  const store = integrationStoreConfig();
  if (!config || !store || store.local) { sendJson(res, 503, { error: "Google Docs generation is not configured." }); return; }
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid Google Docs request." }); return; }
  try {
    const templateId = config.templates[String(payload?.templateKey || "")];
    if (!templateId) throw new Error("google_docs_template_not_allowed");
    const lead = await getTrustedRecord(store, "contact", payload?.leadId);
    const job = await getTrustedRecord(store, "job", payload?.jobId);
    if (job.lead_id !== lead.id || !canAccessTrustedRecord(user, lead) || !canAccessTrustedRecord(user, job)) throw new Error("document_context_not_found");
    const accessToken = await exchangeServiceAccountToken(fetch, { ...config, scopes: [GOOGLE_DRIVE_SCOPE, GOOGLE_DOCS_SCOPE] });
    const folders = await ensureDocumentFolder(fetch, accessToken, config.rootFolderId, {
      leadId: lead.id, leadNumber: lead.data.leadNumber || "", leadName: lead.data.name || "Customer",
      jobId: job.id, projectNumber: job.data.projectNumber || "", jobName: job.data.name || "Job",
      categoryId: "generated-documents", categoryName: "Generated Documents",
    });
    const document = await copyGoogleDocTemplate(fetch, accessToken, templateId, folders.categoryFolderId, payload?.name || `${job.data.name || lead.data.name} Document`);
    const merge = {
      "{{customer_name}}": lead.data.name || "",
      "{{lead_number}}": lead.data.leadNumber || "",
      "{{project_name}}": job.data.name || "",
      "{{project_number}}": job.data.projectNumber || "",
      "{{address}}": job.data.address || lead.data.address || "",
      "{{phone}}": lead.data.phone || "",
      "{{email}}": lead.data.email || "",
      "{{contract_value}}": Number(job.data.projectValue || job.data.contractValue || 0).toFixed(2),
      "{{sales_rep}}": job.data.salesRep || lead.data.salesRep || "",
      "{{today}}": new Intl.DateTimeFormat("en-US", { timeZone: process.env.CRM_TIME_ZONE || "America/New_York" }).format(new Date()),
    };
    const merged = await mergeGoogleDoc(fetch, accessToken, document.id, merge);
    sendJson(res, 200, { generated: true, document, folders, replacements: merged.replacements });
  } catch (error) {
    const status = ["google_docs_template_not_allowed"].includes(error.message) ? 400 : error.message === "document_context_not_found" ? 404 : 502;
    sendJson(res, status, { error: error.message === "google_docs_template_not_allowed" ? "Choose a configured Google Docs template." : "The Google document could not be generated.", code: error.message });
  }
}

async function handleGoogleSheetsExport(req, res) {
  const config = googleProductsConfig();
  if (!config) { sendJson(res, 503, { error: "Google Sheets export is not configured." }); return; }
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid Google Sheets export." }); return; }
  try {
    const accessToken = await exchangeServiceAccountToken(fetch, { ...config, scopes: [GOOGLE_DRIVE_SCOPE, GOOGLE_SHEETS_SCOPE] });
    const reports = await findOrCreateFolder(fetch, accessToken, config.rootFolderId, "Reports", "jobcrestFolder", "reports");
    const result = await createGoogleSheet(fetch, accessToken, reports.id, payload?.title || "JobCrest Report", payload?.headers, payload?.rows);
    sendJson(res, 200, { exported: true, ...result });
  } catch (error) {
    sendJson(res, 502, { error: "The Google Sheets report could not be created.", code: error.message });
  }
}

async function handleGoogleChatNotify(req, res) {
  const config = googleProductsConfig();
  if (!config?.chatWebhook) { sendJson(res, 503, { error: "Google Chat notifications are not configured." }); return; }
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid Google Chat notification." }); return; }
  const titles = {
    lead_assigned: "New lead assigned", estimate_won: "Estimate won", payment_received: "Payment received",
    task_overdue: "Task overdue", production_stage: "Production stage updated", approval_required: "Approval required",
  };
  if (!titles[payload?.type]) { sendJson(res, 400, { error: "Unsupported Google Chat notification." }); return; }
  try {
    const result = await sendGoogleChatWebhook(fetch, config.chatWebhook, { title: titles[payload.type], detail: payload?.detail, url: payload?.url });
    sendJson(res, 200, result);
  } catch (error) { sendJson(res, 502, { error: "Google Chat could not receive the notification.", code: error.message }); }
}

async function handleGoogleGmailWatch(req, res, user) {
  const config = googleProductsConfig();
  if (!config?.gmailTopic || !config?.gmailVerificationToken) { sendJson(res, 503, { error: "Automatic Gmail synchronization is not configured." }); return; }
  try {
    const { accessToken } = await googleAccessForUser(user, GOOGLE_GMAIL_READ_SCOPE);
    const result = await watchGmail(fetch, accessToken, config.gmailTopic);
    sendJson(res, 200, { watching: true, ...result });
  } catch (error) { sendJson(res, 502, { error: "Gmail automatic reply monitoring could not be started.", code: error.message }); }
}

async function reconcileGmailMailbox(emailAddress) {
  const store = integrationStoreConfig();
  const config = googleWorkspaceConfig();
  if (!store || store.local || !config) throw new Error("google_not_configured");
  const connection = await getGoogleConnection(store, emailAddress);
  if (!connection || !(connection.scopes || []).includes(GOOGLE_GMAIL_READ_SCOPE)) throw new Error("google_not_connected");
  const refreshToken = decryptSecret(connection.encrypted_refresh_token, config.encryptionKey);
  const tokens = await refreshAccessToken(fetch, config, refreshToken);
  const recordsUrl = new URL(`${store.origin}/rest/v1/crm_records`);
  recordsUrl.searchParams.set("select", "id,lead_id,data");
  recordsUrl.searchParams.set("company_state_id", `eq.${store.companyId}`);
  recordsUrl.searchParams.set("record_type", "eq.job");
  recordsUrl.searchParams.set("deleted_at", "is.null");
  recordsUrl.searchParams.set("limit", "1000");
  const recordsResponse = await fetch(recordsUrl, { signal: AbortSignal.timeout(20000), headers: integrationServiceHeaders(store) });
  const jobs = await recordsResponse.json().catch(() => []);
  if (!recordsResponse.ok || !Array.isArray(jobs)) throw new Error("gmail_job_lookup_failed");
  let captured = 0;
  for (const job of jobs) {
    const knownEmails = Array.isArray(job.data?.emails) ? job.data.emails : [];
    const threadIds = [...new Set(knownEmails
      .filter((message) => message?.provider === "gmail" && String(message.fromEmail || "").toLowerCase() === emailAddress && message.providerThreadId)
      .map((message) => message.providerThreadId))].slice(0, 50);
    if (!threadIds.length) continue;
    const knownIds = new Set(knownEmails.map((message) => message.providerMessageId).filter(Boolean));
    const additions = [];
    for (const threadId of threadIds) {
      const messages = await fetchGmailThread(fetch, tokens.access_token, threadId, connection.provider_email);
      for (const message of messages) {
        if (knownIds.has(message.messageId)) continue;
        additions.push({
          id: `gmail_${crypto.createHash("sha256").update(message.messageId).digest("hex").slice(0, 24)}`,
          fromEmail: message.fromEmail, toEmail: message.toEmail, subject: message.subject, message: message.message,
          createdAt: message.createdAt, createdBy: message.direction === "inbound" ? "Customer reply" : connection.provider_email,
          provider: "gmail", providerMessageId: message.messageId, providerThreadId: message.threadId,
          direction: message.direction, deliveryStatus: message.direction === "inbound" ? "received" : "sent",
        });
      }
    }
    if (!additions.length) continue;
    const rpcResponse = await fetch(`${store.origin}/rest/v1/rpc/crm_capture_gmail_messages`, {
      method: "POST", signal: AbortSignal.timeout(20000),
      headers: integrationServiceHeaders(store, { "Content-Type": "application/json" }),
      body: JSON.stringify({ p_job_id: job.id, p_messages: additions }),
    });
    if (!rpcResponse.ok) throw new Error("gmail_capture_store_failed");
    captured += Number(await rpcResponse.json().catch(() => 0)) || 0;
  }
  return { captured };
}

async function handleGoogleGmailPush(req, res, url) {
  const config = googleProductsConfig();
  if (!config?.gmailVerificationToken || url.searchParams.get("token") !== config.gmailVerificationToken) { sendJson(res, 404, { error: "not_found" }); return; }
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "invalid_push" }); return; }
  try {
    const event = decodeGmailPush(payload?.message?.data);
    void reconcileGmailMailbox(event.emailAddress).then((result) => {
      console.info("Gmail mailbox change reconciled", { email: event.emailAddress, historyId: event.historyId, captured: result.captured });
    }).catch((error) => console.error("Gmail mailbox reconciliation failed", { email: event.emailAddress, code: error?.message }));
    sendJson(res, 200, { received: true });
  } catch { sendJson(res, 400, { error: "invalid_push" }); }
}

async function handleGoogleGroupMember(req, res, user) {
  const config = googleProductsConfig();
  if (!config?.groups.length) { sendJson(res, 503, { error: "Google Groups onboarding is not configured." }); return; }
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid Google Groups request." }); return; }
  const requested = [...new Set(Array.isArray(payload?.groups) ? payload.groups.map((value) => String(value).trim().toLowerCase()) : [])];
  const groups = requested.filter((value) => config.groups.includes(value));
  if (!groups.length || groups.length !== requested.length) { sendJson(res, 400, { error: "Choose only administrator-approved Google Groups." }); return; }
  try {
    const { accessToken } = await googleAccessForUser(user, GOOGLE_ADMIN_GROUP_SCOPE);
    const memberships = [];
    for (const group of groups) memberships.push(await addGoogleGroupMember(fetch, accessToken, group, payload?.email));
    sendJson(res, 200, { synced: true, memberships });
  } catch (error) {
    const status = ["google_not_connected", "google_scope_missing"].includes(error.message) ? 409 : 502;
    sendJson(res, status, {
      error: error.message === "google_scope_missing"
        ? "Reconnect Google Workspace as a Groups administrator before managing memberships."
        : "Google Groups membership could not be updated.",
      code: error.message,
    });
  }
}

const ZOHO_DATA_CENTERS = {
  com: ["https://accounts.zoho.com", "https://sign.zoho.com"],
  eu: ["https://accounts.zoho.eu", "https://sign.zoho.eu"],
  in: ["https://accounts.zoho.in", "https://sign.zoho.in"],
  jp: ["https://accounts.zoho.jp", "https://sign.zoho.jp"],
  "com.au": ["https://accounts.zoho.com.au", "https://sign.zoho.com.au"],
  "zohocloud.ca": ["https://accounts.zohocloud.ca", "https://sign.zohocloud.ca"],
  sa: ["https://accounts.zoho.sa", "https://sign.zoho.sa"],
  uk: ["https://accounts.zoho.uk", "https://sign.zoho.uk"],
  sg: ["https://accounts.zoho.sg", "https://sign.zoho.sg"],
  ae: ["https://accounts.zoho.ae", "https://sign.zoho.ae"],
};

function zohoSignConfig() {
  const clientId = String(process.env.ZOHO_CLIENT_ID || "").trim();
  const clientSecret = String(process.env.ZOHO_CLIENT_SECRET || "").trim();
  const redirectUri = String(process.env.ZOHO_REDIRECT_URI || "").trim();
  const stateSecret = String(process.env.ZOHO_OAUTH_STATE_SECRET || "");
  const encryptionKey = String(process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY || "");
  const dataCenter = String(process.env.ZOHO_DATA_CENTER || "com").trim().toLowerCase();
  const origins = ZOHO_DATA_CENTERS[dataCenter];
  let redirect;
  try {
    redirect = new URL(redirectUri);
    const loopback = ["localhost", "127.0.0.1"].includes(redirect.hostname);
    if ((!loopback && redirect.protocol !== "https:") || (loopback && !["http:", "https:"].includes(redirect.protocol)) || redirect.username || redirect.password || redirect.hash) return null;
  } catch { return null; }
  if (!origins || !clientId || !clientSecret || stateSecret.length < 32 || !/^[A-Za-z0-9+/]{43}=$/.test(encryptionKey)) return null;
  return { clientId, clientSecret, redirectUri: redirect.toString(), stateSecret, encryptionKey, accountsOrigin: origins[0], signApiOrigin: origins[1], signWebOrigin: origins[1], dataCenter };
}

async function handleZohoStatus(req, res, user) {
  const config = zohoSignConfig();
  const store = integrationStoreConfig();
  if (!config || !store) { sendJson(res, 200, { configured: false, connected: false, email: String(user.email || "").toLowerCase() }); return; }
  const connection = await getProviderConnection(store, "zoho", user.email);
  sendJson(res, 200, { configured: true, connected: Boolean(connection), email: String(user.email || "").toLowerCase(), sign: Boolean(connection), dataCenter: config.dataCenter });
}

async function handleZohoConnect(req, res, user) {
  const config = zohoSignConfig();
  const store = integrationStoreConfig();
  if (!config || !store) { sendJson(res, 503, { error: "Zoho Sign is not configured." }); return; }
  const identity = { sub: user.id || "local-admin", email: user.email, company: store.companyId };
  const state = createOAuthState(identity, config.stateSecret);
  await storeOAuthState(store, "zoho", identity, state);
  sendJson(res, 200, { authorizationUrl: createZohoAuthorizationUrl(config, state) });
}

async function handleZohoCallback(url, res) {
  const config = zohoSignConfig();
  const store = integrationStoreConfig();
  if (!config || !store) { sendRedirect(res, "/?zoho=not-configured"); return; }
  try {
    if (url.searchParams.get("error")) throw new Error("zoho_consent_denied");
    const identity = verifyOAuthState(url.searchParams.get("state"), config.stateSecret);
    if (identity.company !== store.companyId) throw new Error("invalid_oauth_state");
    await consumeOAuthState(store, "zoho", identity, url.searchParams.get("state"));
    const tokens = await exchangeZohoAuthorizationCode(fetch, config, url.searchParams.get("code"));
    const existing = await getProviderConnection(store, "zoho", identity.email);
    const refreshToken = tokens.refresh_token || (existing ? decryptSecret(existing.encrypted_refresh_token, config.encryptionKey) : "");
    if (!refreshToken) throw new Error("zoho_refresh_token_missing");
    await putProviderConnection(store, "zoho", {
      crm_user_id: identity.sub, crm_email: identity.email, provider_email: identity.email,
      provider_subject: `zoho-sign:${identity.sub}`, encrypted_refresh_token: encryptSecret(refreshToken, config.encryptionKey),
      scopes: String(tokens.scope || ZOHO_SIGN_SCOPES.join(",")).split(/[\s,]+/).filter(Boolean),
    });
    sendRedirect(res, "/?zoho=connected");
  } catch (error) {
    sendRedirect(res, `/?zoho=${encodeURIComponent(error.message === "zoho_consent_denied" ? error.message : "connection_failed")}`);
  }
}

async function handleZohoDisconnect(req, res, user) {
  const config = zohoSignConfig();
  const store = integrationStoreConfig();
  if (!config || !store) { sendJson(res, 503, { error: "Zoho Sign is not configured." }); return; }
  const connection = await getProviderConnection(store, "zoho", user.email);
  if (connection?.encrypted_refresh_token) {
    try {
      await revokeZohoRefreshToken(fetch, config, decryptSecret(connection.encrypted_refresh_token, config.encryptionKey));
    } catch (error) {
      // Access may already be removed on Zoho's side; still disconnect here.
      console.warn("Zoho token revoke failed during disconnect:", error.message);
    }
  }
  await revokeProviderConnection(store, "zoho", user.email);
  sendJson(res, 200, { disconnected: true });
}

async function getTrustedRecord(store, recordType, recordId) {
  if (store.local) throw new Error("shared_document_required");
  if (!["contact", "job", "document"].includes(recordType)) throw new Error("invalid_record_type");
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(String(recordId || ""))) throw new Error(`invalid_${recordType}_id`);
  const url = new URL(`${store.origin}/rest/v1/crm_records`);
  url.searchParams.set("select", "id,lead_id,job_id,owner_id,data,version");
  url.searchParams.set("company_state_id", `eq.${store.companyId}`);
  url.searchParams.set("record_type", `eq.${recordType}`);
  url.searchParams.set("id", `eq.${recordId}`);
  url.searchParams.set("deleted_at", "is.null");
  url.searchParams.set("limit", "2");
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: integrationServiceHeaders(store) });
  const rows = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(rows)) throw new Error(`${recordType}_store_unavailable`);
  if (rows.length !== 1 || !rows[0]?.data || typeof rows[0].data !== "object") throw new Error(`${recordType}_not_found`);
  return rows[0];
}

const getTrustedDocumentRecord = (store, documentId) => getTrustedRecord(store, "document", documentId);

function canAccessTrustedRecord(user, record) {
  return canManageAssignedCalendar(user) || String(record?.owner_id || "") === String(user?.id || "");
}

async function downloadTrustedDocument(store, record, { maxBytes = 25 * 1024 * 1024, tooLargeCode = "zoho_sign_file_too_large" } = {}) {
  const storagePath = String(record.data.storagePath || "");
  const segments = storagePath.split("/");
  if (!storagePath.startsWith(`${store.companyId}/`) || segments.some((part) => !part || part === "." || part === "..")) throw new Error("shared_document_required");
  const path = segments.map(encodeURIComponent).join("/");
  const response = await fetch(`${store.origin}/storage/v1/object/authenticated/crm-documents/${path}`, {
    signal: AbortSignal.timeout(30000), headers: integrationServiceHeaders(store),
  });
  const announced = Number(response.headers.get("content-length") || 0);
  if (!response.ok) throw new Error("document_download_failed");
  if (announced > maxBytes) throw new Error(tooLargeCode);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw new Error(tooLargeCode);
  return { name: record.data.name, type: record.data.type, size: bytes.length, bytes };
}

function trustedStoragePath(store, storagePath) {
  const value = String(storagePath || "");
  const segments = value.split("/");
  if (!value.startsWith(`${store.companyId}/`) || segments.some((part) => !part || part === "." || part === ".." || !/^[A-Za-z0-9._:-]+$/.test(part))) {
    throw new Error("invalid_smart_document_storage_path");
  }
  return { value, encoded: segments.map(encodeURIComponent).join("/") };
}

async function downloadTrustedStorageObject(store, storagePath, maxBytes = 25 * 1024 * 1024) {
  const pathInfo = trustedStoragePath(store, storagePath);
  const response = await fetch(`${store.origin}/storage/v1/object/authenticated/crm-documents/${pathInfo.encoded}`, {
    signal: AbortSignal.timeout(30000), headers: integrationServiceHeaders(store),
  });
  const announced = Number(response.headers.get("content-length") || 0);
  if (!response.ok || announced > maxBytes) throw new Error("smart_document_download_failed");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw new Error("smart_document_download_failed");
  return bytes;
}

async function uploadSmartDocumentPdf(store, record, completed) {
  const segments = [
    store.companyId,
    String(record.lead_id || "company"),
    String(record.job_id || "shared"),
    String(record.data.categoryId || "other"),
    record.id,
    "smart",
    `${crypto.randomUUID()}.pdf`,
  ];
  if (segments.some((part) => !/^[A-Za-z0-9._:-]+$/.test(part))) throw new Error("invalid_smart_document_storage_path");
  const storagePath = segments.join("/");
  const response = await fetch(`${store.origin}/storage/v1/object/crm-documents/${segments.map(encodeURIComponent).join("/")}`, {
    method: "POST", signal: AbortSignal.timeout(60000),
    headers: integrationServiceHeaders(store, { "Content-Type": "application/pdf", "x-upsert": "false" }),
    body: completed.bytes,
  });
  if (!response.ok) throw new Error("smart_document_upload_failed");
  return { storagePath, name: completed.name, size: completed.bytes.length, type: "application/pdf" };
}

function smartDocumentPayload(existing, fields, responses, status, user, completedFile = null) {
  const revision = Math.max(0, Number(existing?.revision) || 0) + 1;
  const now = new Date().toISOString();
  const result = {
    fields,
    responses,
    status,
    analysisVersion: 1,
    revision,
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || user.id,
    updatedAt: now,
    updatedBy: user.id,
  };
  if (existing?.completedFile) result.completedFile = existing.completedFile;
  if (existing?.completedDocumentId) result.completedDocumentId = existing.completedDocumentId;
  if (Array.isArray(existing?.previousCompletions)) result.previousCompletions = existing.previousCompletions.slice(-9);
  if (completedFile) {
    if (result.completedFile) result.previousCompletions = [...(result.previousCompletions || []), result.completedFile].slice(-10);
    result.completedFile = { ...completedFile, completedAt: now, completedBy: user.id };
    result.completedAt = now;
    result.completedBy = user.id;
  }
  if (existing?.lastEmailedAt) {
    result.lastEmailedAt = existing.lastEmailedAt;
    result.lastEmailedTo = existing.lastEmailedTo;
    result.lastEmailMessageId = existing.lastEmailMessageId;
  }
  if (existing?.emailDelivery && typeof existing.emailDelivery === "object") result.emailDelivery = existing.emailDelivery;
  return result;
}

async function saveTrustedSmartDocument(store, user, record, smartDocument) {
  const response = await fetch(`${store.origin}/rest/v1/rpc/crm_save_smart_document`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: integrationServiceHeaders(store, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_company: store.companyId, p_document_id: record.id, p_smart_document: smartDocument, p_actor: user.id }),
  });
  const result = await response.json().catch(() => null);
  // The database refuses a second "sending" lock while another send is in flight.
  if (!response.ok && String(result?.message || "").includes("smart_document_email_pending")) throw new Error("smart_document_email_pending");
  if (!response.ok || !result?.saved || result.document_id !== record.id || result.status !== smartDocument.status) throw new Error("smart_document_record_unconfirmed");
  return result;
}

async function handleSmartDocumentSave(req, res, user) {
  const store = integrationStoreConfig();
  if (!store || store.local) { sendJson(res, 503, { error: "Shared document storage is not configured." }); return; }
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid Smart Document data." }); return; }
  try {
    const record = await getTrustedDocumentRecord(store, payload?.documentId);
    if (!canAccessTrustedRecord(user, record)) throw new Error("document_not_found");
    const fields = normalizeSmartDocumentFields(payload?.fields);
    const requestedStatus = payload?.status === "completed" ? "completed" : payload?.status === "template" ? "template" : "draft";
    const responses = normalizeSmartDocumentResponses(fields, payload?.responses, { requireComplete: requestedStatus === "completed" });
    let completedFile = null;
    let filledSourceFields = [];
    if (requestedStatus === "completed") {
      const source = await downloadTrustedDocument(store, record, { maxBytes: 25 * 1024 * 1024, tooLargeCode: "smart_document_source_too_large" });
      const completed = await renderCompletedDocument(source, { fields, responses }, { name: user.email, email: user.email });
      completedFile = await uploadSmartDocumentPdf(store, record, completed);
      filledSourceFields = completed.filledSourceFields;
    }
    const smartDocument = smartDocumentPayload(record.data.smartDocument, fields, responses, requestedStatus, user, completedFile);
    const saved = await saveTrustedSmartDocument(store, user, record, smartDocument);
    if (requestedStatus === "completed" && (!saved.completed_document_id || saved.completed_document?.id !== saved.completed_document_id || saved.completed_document?.storagePath !== completedFile.storagePath)) {
      throw new Error("smart_document_record_unconfirmed");
    }
    const savedSmartDocument = saved.smart_document || smartDocument;
    sendJson(res, 200, {
      saved: true,
      status: requestedStatus,
      revision: smartDocument.revision,
      smartDocument: savedSmartDocument,
      completedFile: savedSmartDocument.completedFile || null,
      completedDocumentId: saved.completed_document_id || null,
      completedDocument: saved.completed_document || null,
      filledSourceFields,
      recordVersion: saved.version,
    });
  } catch (error) {
    const badRequest = ["invalid_smart_document_fields", "duplicate_smart_document_field", "invalid_smart_document_field_type", "invalid_smart_document_field_placement", "invalid_smart_document_text", "invalid_smart_document_email", "invalid_smart_document_number", "invalid_smart_document_date", "smart_document_required_field_missing"].includes(error.message);
    const messages = {
      document_not_found: "The saved CRM document could not be found or is not assigned to you.",
      smart_document_required_field_missing: "Complete every required field before saving the completed document.",
      smart_document_pdf_unreadable: "This PDF is encrypted or cannot be filled. Upload an unlocked PDF and try again.",
      smart_document_source_too_large: "Smart Documents support source files up to 25 MB.",
      smart_document_upload_failed: "The completed PDF could not be stored.",
      smart_document_record_unconfirmed: "The completed file was created, but its CRM record could not be confirmed. Do not retry until an administrator reviews it.",
    };
    sendJson(res, badRequest ? 400 : error.message === "document_not_found" ? 404 : 502, { error: messages[error.message] || "The Smart Document could not be saved.", code: error.message });
  }
}

async function handleSmartDocumentEmail(req, res, user) {
  const store = integrationStoreConfig();
  if (!store || store.local) { sendJson(res, 503, { error: "Shared document storage is not configured." }); return; }
  let payload;
  let record;
  let pendingDelivery;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid Smart Document email." }); return; }
  try {
    record = await getTrustedDocumentRecord(store, payload?.documentId);
    if (!canAccessTrustedRecord(user, record)) throw new Error("document_not_found");
    const smartDocument = record.data.smartDocument;
    const completedFile = smartDocument?.completedFile;
    if (smartDocument?.status !== "completed" || !completedFile?.storagePath) throw new Error("smart_document_not_completed");
    if (smartDocument?.emailDelivery?.status === "sending") throw new Error("smart_document_email_pending");
    // Check everything that can fail without contacting the recipient before
    // taking the "sending" lock, so a typo or a missing Google connection never
    // locks the document.
    const bytes = await downloadTrustedStorageObject(store, completedFile.storagePath, 20 * 1024 * 1024);
    const { accessToken, connection } = await googleAccessForUser(user, GOOGLE_GMAIL_SEND_SCOPE);
    const outgoing = {
      fromEmail: connection.provider_email,
      toEmail: payload?.toEmail,
      subject: payload?.subject,
      message: payload?.message,
      attachment: { bytes, name: completedFile.name, type: "application/pdf" },
    };
    gmailMessageResource(outgoing);
    const deliveryId = crypto.randomUUID();
    const deliveryStartedAt = new Date().toISOString();
    pendingDelivery = {
      ...smartDocument,
      revision: Math.max(0, Number(smartDocument.revision) || 0) + 1,
      updatedAt: deliveryStartedAt,
      updatedBy: user.id,
      emailDelivery: {
        id: deliveryId,
        status: "sending",
        toEmail: String(payload?.toEmail || "").trim().toLowerCase(),
        subject: String(payload?.subject || "").trim().slice(0, 200),
        startedAt: deliveryStartedAt,
        actorUserId: user.id,
      },
    };
    await saveTrustedSmartDocument(store, user, record, pendingDelivery);
    let sent;
    try {
      sent = await sendGmailMessage(fetch, accessToken, outgoing);
    } catch (sendError) {
      // Gmail answered with an error, so nothing was sent: release the lock.
      // Timeouts and network failures stay "sending" because delivery is unknown.
      if (["gmail_send_failed", "google_access_expired"].includes(sendError.message)) {
        await saveTrustedSmartDocument(store, user, record, {
          ...pendingDelivery,
          revision: pendingDelivery.revision + 1,
          updatedAt: new Date().toISOString(),
          emailDelivery: { ...pendingDelivery.emailDelivery, status: "failed", failedAt: new Date().toISOString(), code: sendError.message },
        }).catch(() => {});
      }
      throw sendError;
    }
    const emailReceipt = {
      ...pendingDelivery,
      revision: pendingDelivery.revision + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
      lastEmailedAt: new Date().toISOString(),
      lastEmailedTo: String(payload?.toEmail || "").trim().toLowerCase(),
      lastEmailMessageId: sent.messageId,
      emailDelivery: {
        ...pendingDelivery.emailDelivery,
        status: "sent",
        sentAt: new Date().toISOString(),
        providerMessageId: sent.messageId,
      },
    };
    await saveTrustedSmartDocument(store, user, record, emailReceipt);
    sendJson(res, 200, { sent: true, fromEmail: connection.provider_email, toEmail: emailReceipt.lastEmailedTo, sentAt: emailReceipt.lastEmailedAt, ...sent });
  } catch (error) {
    const badRequest = ["invalid_email", "invalid_subject", "invalid_message", "invalid_gmail_attachment"].includes(error.message);
    const messages = {
      document_not_found: "The saved CRM document could not be found or is not assigned to you.",
      smart_document_not_completed: "Save the completed Smart Document before emailing it.",
      smart_document_email_pending: "A prior email may already have been sent but its receipt was not confirmed. An administrator must review Gmail before another send.",
      google_not_connected: "Connect Google Workspace in Settings before emailing documents.",
      google_scope_missing: "Reconnect Google Workspace to approve Gmail sending.",
      invalid_gmail_attachment: "The completed PDF is too large for direct Gmail delivery.",
      gmail_send_failed: "Gmail rejected the message.",
      google_access_expired: "Google access expired. Reconnect Google Workspace in Settings and try again.",
      gmail_send_unconfirmed: "Gmail may have sent this email but did not confirm it. Check Sent mail before trying again.",
    };
    const status = badRequest ? 400 : ["google_not_connected", "google_scope_missing", "google_access_expired", "smart_document_not_completed", "smart_document_email_pending"].includes(error.message) ? 409 : error.message === "document_not_found" ? 404 : 502;
    sendJson(res, status, { error: messages[error.message] || "The completed Smart Document could not be emailed.", code: error.message });
  }
}

async function attachZohoRequest(store, user, documentId, smartDocument) {
  const response = await fetch(`${store.origin}/rest/v1/rpc/crm_attach_zoho_sign`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: integrationServiceHeaders(store, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_company: store.companyId, p_document_id: documentId, p_request_id: smartDocument.requestId, p_status: smartDocument.status, p_recipient_email: smartDocument.recipientEmail, p_actor: user.id }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.saved || result.request_id !== smartDocument.requestId) throw new Error("zoho_sign_record_unconfirmed");
  return result;
}

async function handleZohoSmartDocument(req, res, user) {
  const config = zohoSignConfig();
  const store = integrationStoreConfig();
  if (!config || !store) { sendJson(res, 503, { error: "Zoho Sign is not configured." }); return; }
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid Smart Document request." }); return; }
  const connection = await getProviderConnection(store, "zoho", user.email);
  if (!connection) { sendJson(res, 409, { error: "Connect Zoho Sign in Settings before preparing a Smart Document.", code: "zoho_not_connected" }); return; }
  try {
    const record = await getTrustedDocumentRecord(store, payload?.documentId);
    if (!canAccessTrustedRecord(user, record)) throw new Error("document_not_found");
    const refreshToken = decryptSecret(connection.encrypted_refresh_token, config.encryptionKey);
    const tokens = await refreshZohoAccessToken(fetch, config, refreshToken);
    let requestId = String(record.data?.zohoSign?.requestId || "");
    let smartDocument = null;
    if (!requestId) {
      const document = await downloadTrustedDocument(store, record);
      smartDocument = await createSmartDocument(fetch, config, tokens.access_token, document, {
        name: payload?.recipientName, email: payload?.recipientEmail, notes: payload?.notes,
        expirationDays: payload?.expirationDays, requestName: record.data.name,
      });
      await attachZohoRequest(store, user, record.id, smartDocument);
      requestId = smartDocument.requestId;
    }
    const sendUrl = await createEmbeddedSendUrl(fetch, config, tokens.access_token, requestId);
    sendJson(res, 200, { prepared: true, created: Boolean(smartDocument), requestId, status: smartDocument?.status || record.data?.zohoSign?.status || "draft", recipientEmail: smartDocument?.recipientEmail || record.data?.zohoSign?.recipientEmail || "", sendUrl });
  } catch (error) {
    const messages = {
      shared_document_required: "The document must finish saving to shared storage before it can become a Smart Document.",
      document_not_found: "The saved CRM document could not be found.",
      unsupported_zoho_sign_file: "Zoho Sign does not support this file type.",
      zoho_sign_file_too_large: "Zoho Sign accepts files up to 25 MB.",
      zoho_sign_record_unconfirmed: "The Zoho draft was created, but JobCrest could not safely attach it. Do not retry yet; an administrator should review the request.",
    };
    sendJson(res, 502, { error: messages[error.message] || "Zoho Sign could not prepare this document.", code: error.message });
  }
}

async function attachGoogleDriveDocument(store, user, record, driveFile, folders) {
  const webViewLink = String(driveFile.webViewLink || "");
  if (!/^https:\/\/drive\.google\.com\//.test(webViewLink)) throw new Error("google_drive_link_invalid");
  const documentVersion = Math.max(1, Number(record.data.versionNumber || record.data.version) || 1);
  const response = await fetch(`${store.origin}/rest/v1/rpc/crm_attach_google_drive_document`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: integrationServiceHeaders(store, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      p_company: store.companyId, p_document_id: record.id, p_file_id: driveFile.id, p_web_view_link: webViewLink,
      p_lead_folder_id: folders.leadFolderId || "", p_job_folder_id: folders.jobFolderId || "",
      p_category_folder_id: folders.categoryFolderId, p_document_version: documentVersion, p_actor: user.id,
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.saved || result.file_id !== driveFile.id || result.document_version !== documentVersion) throw new Error("google_drive_record_unconfirmed");
  return { webViewLink, documentVersion };
}

async function handleGoogleDriveStatus(req, res) {
  const config = googleDriveConfig();
  const store = integrationStoreConfig();
  sendJson(res, 200, { configured: Boolean(config && store && !store.local), companyOwned: true, automaticCopies: true });
}

async function handleGoogleDriveDocument(req, res, user) {
  const config = googleDriveConfig();
  const store = integrationStoreConfig();
  if (!config || !store || store.local) { sendJson(res, 503, { error: "Google Drive shared storage is not configured.", code: "google_drive_not_configured" }); return; }
  let payload;
  try { payload = JSON.parse(await readRequestBody(req)); } catch { sendJson(res, 400, { error: "Invalid Drive document request." }); return; }
  try {
    const record = await getTrustedDocumentRecord(store, payload?.documentId);
    if (!canAccessTrustedRecord(user, record)) throw new Error("document_not_found");
    const currentVersion = Math.max(1, Number(record.data.versionNumber || record.data.version) || 1);
    const existing = record.data.googleDrive;
    if (existing?.fileId && Number(existing.versionNumber) === currentVersion && /^https:\/\/drive\.google\.com\//.test(existing.webViewLink || "")) {
      sendJson(res, 200, { synced: true, reused: true, fileId: existing.fileId, webViewLink: existing.webViewLink, googleDrive: existing }); return;
    }

    const companyDocument = record.lead_id === "company";
    let lead = null;
    let job = null;
    if (!companyDocument) {
      lead = await getTrustedRecord(store, "contact", record.lead_id);
      job = await getTrustedRecord(store, "job", record.job_id);
      if (job.lead_id !== record.lead_id || !canAccessTrustedRecord(user, lead) || !canAccessTrustedRecord(user, job)) throw new Error("document_not_found");
    }
    const accessToken = await exchangeServiceAccountToken(fetch, config);
    const folders = await ensureDocumentFolder(fetch, accessToken, config.rootFolderId, {
      companyDocument,
      leadId: record.lead_id,
      leadNumber: lead?.data?.leadNumber || "",
      leadName: lead?.data?.name || "Customer",
      jobId: record.job_id,
      projectNumber: job?.data?.projectNumber || "",
      jobName: job?.data?.name || "Job",
      categoryId: driveCategoryId(record.data),
      categoryName: record.data.category || "Other",
    });
    const document = await downloadTrustedDocument(store, record, { maxBytes: 50 * 1024 * 1024, tooLargeCode: "google_drive_file_too_large" });
    const driveFile = await uploadGoogleDriveDocument(fetch, accessToken, folders.categoryFolderId, document, { documentId: record.id, versionNumber: currentVersion });
    const attached = await attachGoogleDriveDocument(store, user, record, driveFile, folders);
    sendJson(res, 200, {
      synced: true, reused: driveFile.reused === true, fileId: driveFile.id, webViewLink: attached.webViewLink,
      googleDrive: { fileId: driveFile.id, webViewLink: attached.webViewLink, ...folders, versionNumber: currentVersion, syncedAt: new Date().toISOString(), syncedBy: user.id },
    });
  } catch (error) {
    const messages = {
      shared_document_required: "The document must finish saving to shared CRM storage before it can be copied to Drive.",
      document_not_found: "The saved CRM document could not be found.",
      job_not_found: "The document's job could not be found.",
      contact_not_found: "The document's lead could not be found.",
      google_drive_file_too_large: "Google Drive copies are limited to 50 MB in JobCrest.",
      google_drive_duplicate_folder: "More than one matching Drive folder exists. An administrator must resolve the duplicate folders.",
      google_drive_duplicate_document: "More than one matching Drive file exists. An administrator must resolve the duplicate copies.",
      google_drive_record_unconfirmed: "The file reached Drive, but JobCrest could not safely attach the link. Do not retry until an administrator reviews it.",
    };
    const status = ["document_not_found", "job_not_found", "contact_not_found"].includes(error.message) ? 404
      : ["invalid_document_id", "invalid_drive_id"].includes(error.message) ? 400 : 502;
    sendJson(res, status, { error: messages[error.message] || "Google Drive could not copy this document.", code: error.message });
  }
}

async function requireApiAdmin(req, res, handler) {
  try {
    const user = await verifyApiUser(req);
    if (!user) {
      sendJson(res, 401, { error: "authentication_required", noProviderAction: true });
      return;
    }
    if (!isApiAdmin(user)) {
      sendJson(res, 403, { error: "admin_required", noProviderAction: true });
      return;
    }
    await handler(req, res, user);
  } catch (error) {
    console.error("Administrative API request failed", {
      path: String(req.url || "").split("?")[0],
      code: String(error?.code || error?.name || "request_failed").slice(0, 80),
    });
    sendJson(res, 500, { error: "request_failed" });
  }
}

function crmPublicOrigin() {
  const value = String(process.env.CRM_PUBLIC_ORIGIN || "https://jobcrestcrm.com").trim().replace(/\/$/, "");
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((!loopback && url.protocol !== "https:") || (loopback && !["http:", "https:"].includes(url.protocol)) ||
        url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function handleTeamInvitation(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
    if (!payload || Array.isArray(payload) || typeof payload.email !== "string" ||
        (payload.groups !== undefined && !Array.isArray(payload.groups)) ||
        Object.keys(payload).some((key) => !["email", "groups"].includes(key))) throw new Error("invalid_payload");
  } catch {
    sendJson(res, 400, { error: "Enter one company email address to invite." });
    return;
  }

  const config = squareWorkerConfig();
  const appOrigin = crmPublicOrigin();
  if (!config || !appOrigin) {
    sendJson(res, 503, { error: "Team invitations are not configured on this server." });
    return;
  }

  try {
    const products = googleProductsConfig();
    const requestedGroups = [...new Set((payload.groups || []).map((value) => String(value).trim().toLowerCase()))];
    const allowedGroups = requestedGroups.filter((group) => products?.groups.includes(group));
    if (allowedGroups.length !== requestedGroups.length) { sendJson(res, 400, { error: "Choose only administrator-approved Google Groups." }); return; }
    const result = await createTeamInviteService({
      fetchImpl: fetch,
      origin: config.origin,
      key: config.key,
      companyId: config.companyId,
      allowedEmailDomain,
      appOrigin,
    }).invite(payload.email);
    if (allowedGroups.length && products?.delegatedAdmin) {
      try {
        const accessToken = await exchangeServiceAccountToken(fetch, { ...products, subject: products.delegatedAdmin, scopes: [GOOGLE_ADMIN_GROUP_SCOPE] });
        result.groupsAdded = [];
        for (const group of allowedGroups) result.groupsAdded.push(await addGoogleGroupMember(fetch, accessToken, group, result.email));
      } catch (groupError) {
        console.error("Google Groups onboarding failed", { code: groupError?.message });
        result.groupWarning = "The CRM invitation worked, but Google Groups access needs an administrator to retry it.";
      }
    }
    sendJson(res, 200, result);
  } catch (error) {
    const rateLimited = error?.status === 429 || /rate|too many|security purposes/i.test(String(error?.message || ""));
    const invalid = error?.status === 400 && ["invalid_email", "invalid_email_domain"].includes(error?.code);
    const status = rateLimited ? 429 : invalid ? 400 : 503;
    const message = rateLimited
      ? "Email sending is temporarily rate-limited. Wait a few minutes, then send the invitation again."
      : invalid ? error.message
        : error?.code === "access_provision_failed" ? error.message
          : "The invitation could not be completed. No password was created; try again shortly.";
    sendJson(res, status, { error: message });
  }
}

async function handleCustomerPortalInvitation(req,res){let payload;try{payload=JSON.parse(await readRequestBody(req));if(!payload||Array.isArray(payload)||typeof payload.email!=="string"||typeof payload.leadId!=="string"||Object.keys(payload).some((key)=>!["email","leadId","displayName"].includes(key)))throw new Error("invalid_payload");}catch{sendJson(res,400,{error:"Choose a lead and enter one customer email address."});return;}const config=squareWorkerConfig();const appOrigin=crmPublicOrigin();if(!config||!appOrigin){sendJson(res,503,{error:"Customer portal invitations are not configured on this server."});return;}try{const result=await createCustomerPortalService({fetchImpl:fetch,origin:config.origin,key:config.key,companyId:config.companyId,appOrigin}).invite(payload);sendJson(res,200,result);}catch(error){console.error("Customer portal invitation failed",{message:error?.message});sendJson(res,error?.status===400?400:503,{error:error?.message||"The customer invitation could not be completed."});}}

async function squareRequest(method, path, body) {
  const https = require("https");
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(SQUARE_BASE + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        "Authorization": `Bearer ${squareToken()}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("Square request timed out; check invoice status before retrying")));
    if (payload) req.write(payload);
    req.end();
  });
}

function squareLineItem(item = {}) {
  const quantity = Number(item.quantity);
  const rate = Number(item.rate);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000 ||
      !Number.isFinite(rate) || rate < 0 || !Number.isSafeInteger(Math.round(rate * 100))) {
    throw new Error("Line items require a positive quantity and a valid non-negative price");
  }
  return {
    name: String(item.title || "Line item").slice(0, 500),
    quantity: String(quantity),
    base_price_money: { amount: Math.round(rate * 100), currency: "USD" },
    note: String(item.description || "").slice(0, 2000),
  };
}

function squareWorkerConfig() {
  const publicConfig = squareStatusPublicConfig();
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  let serverKey = /^sb_secret_[A-Za-z0-9_-]+$/.test(key);
  if (!serverKey) {
    try {
      const parts = key.split(".");
      serverKey = parts.length === 3 && JSON.parse(Buffer.from(parts[1], "base64url").toString()).role === "service_role";
    } catch { serverKey = false; }
  }
  if (!publicConfig || !serverKey) return null;
  return { origin: publicConfig.origin, companyId: publicConfig.companyId, key };
}

function recoveryBackupConfig() {
  const config = supabaseConfig();
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!config.url || !key || process.env.SUPABASE_SYNC_ENABLED !== "true") return null;
  return {
    origin: config.url.replace(/\/$/, ""),
    companyId: process.env.SUPABASE_STATE_ID || "coastal-crest",
    key,
    fetch,
    timeZone: process.env.CRM_TIME_ZONE || "America/New_York",
    onError: () => console.warn("Daily CRM recovery backup could not be confirmed; it will retry."),
  };
}

function startRecoveryBackupWorker() {
  const config = recoveryBackupConfig();
  if (!config) return null;
  return require(path.join(__dirname, "recovery-backup.js")).start(config);
}

async function squareWorkerRpc(config, name, payload) {
  const response = await fetch(`${config.origin}/rest/v1/rpc/${name}`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: {
      apikey: config.key, "Content-Type": "application/json",
      ...(!config.key.startsWith("sb_secret_") ? { Authorization: `Bearer ${config.key}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) {
    // Do not expose database details, provider payloads or credentials.
    const error = new Error("The invoice database step could not be confirmed.");
    error.code = typeof result?.message === "string" ? result.message : "invoice_database_unavailable";
    throw error;
  }
  return result;
}

function createSquareInvoiceStore(config, user) {
  return {
    begin: (estimateId, expectedVersion) => squareWorkerRpc(config, "crm_square_begin_invoice", {
      p_company: config.companyId, p_actor: user.id, p_estimate_id: estimateId,
      p_expected_version: expectedVersion, p_environment: process.env.SQUARE_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
    }),
    checkpoint: (intent, stage, receipt) => squareWorkerRpc(config, "crm_square_checkpoint_invoice", {
      p_company: config.companyId, p_intent: intent.id, p_stage: stage, p_receipt: receipt,
    }),
    complete: (intent, result) => squareWorkerRpc(config, "crm_square_complete_invoice", {
      p_company: config.companyId, p_intent: intent.id, p_result: result,
    }),
  };
}

async function handleSquareCreateInvoice(req, res, user) {
  if (!user?.id || user.local || !isApiAdmin(user)) {
    sendJson(res, 403, { error: "A signed-in company administrator is required." }); return;
  }
  let body;
  try {
    body = JSON.parse(await readRequestBody(req));
    if (!body || Array.isArray(body) || !squareStatusSafeId(body.estimateId) ||
        !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 ||
        Object.keys(body).some(key => !["estimateId", "expectedVersion"].includes(key))) throw Error();
  } catch {
    sendJson(res, 400, { error: "Send only the saved estimate ID and its current version.", noProviderAction: true }); return;
  }
  const config = squareWorkerConfig();
  if (!config || !squareToken()) {
    sendJson(res, 503, { error: "Reliable Square invoice storage is not configured. No invoice was sent.", noProviderAction: true }); return;
  }
  try {
    const workflow = require(path.join(__dirname, "square-invoice-workflow.js")).create({
      store: createSquareInvoiceStore(config, user), request: squareRequest,
    });
    const result = await workflow.send(body.estimateId, body.expectedVersion);
    if (result?.durable !== true) throw new Error("Missing durable invoice confirmation");
    sendJson(res, 200, result);
  } catch (error) {
    const known = {
      legacy_invoice_review_required: "An administrator must check Square for an earlier invoice attempt before sending this older estimate.",
      estimate_changed_before_invoice: "The estimate changed. Reload and review the saved estimate before sending.",
      won_estimate_required: "Save the estimate as Won before sending an invoice.",
      invoice_already_linked: "This estimate already has a linked Square invoice. Reload its invoice status.",
      saved_customer_email_and_numbers_required: "Save the customer email, lead number and project number before sending.",
    };
    const code = error.storeCode || error.code;
    const message = known[code] || "Invoice sending could not be fully confirmed. Review the saved attempt and invoice status before retrying. Do not create a separate invoice.";
    sendJson(res, known[code] ? 409 : 503, {
      error: message, reviewRequired: true,
      ...(known[code] && error.storeCode ? { code, stage: "begin", noProviderAction: true } : {}),
    });
  }
}

function squareInvoicePaymentSummary(invoice = {}) {
  const requests = invoice.payment_requests || [];
  const paidCents = requests.reduce(
    (sum, request) => sum + Number(request.total_completed_amount_money?.amount || 0),
    0,
  );
  const contractCents = requests.reduce(
    (sum, request) => sum + Number(request.computed_amount_money?.amount || 0),
    0,
  );
  return {
    invoiceId: invoice.id || "",
    orderId: invoice.order_id || "",
    status: invoice.status || "",
    contractAmount: contractCents / 100,
    paidAmount: paidCents / 100,
    paymentPercent: contractCents ? Math.min(100, (paidCents / contractCents) * 100) : 0,
    updatedAt: invoice.updated_at || new Date().toISOString(),
    paymentRequests: requests.map((request) => ({
      type: request.request_type || "",
      requestedAmount: Number(request.computed_amount_money?.amount || 0) / 100,
      paidAmount: Number(request.total_completed_amount_money?.amount || 0) / 100,
      dueDate: request.due_date || "",
    })),
  };
}

function squareStatusSafeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(value);
}

function squareStatusPublicConfig() {
  const config = supabaseConfig();
  let origin;
  try {
    const url = new URL(config.url);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) return null;
    origin = url.origin;
  } catch { return null; }
  // Never send a service/secret key, including a misconfigured legacy JWT, to
  // these reads. The verified user's bearer preserves PostgREST/RLS scope.
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(config.anonKey);
  if (!publicKey) {
    try {
      const parts = config.anonKey.split(".");
      publicKey = parts.length === 3 && JSON.parse(Buffer.from(parts[1], "base64url").toString()).role === "anon";
    } catch { publicKey = false; }
  }
  if (!publicKey) return null;
  return { origin, anonKey: config.anonKey, companyId: process.env.SUPABASE_STATE_ID || "coastal-crest" };
}

async function squareStatusReadRecords(config, authorization, recordType, filterField, ids, signal) {
  const rows = [], seen = new Set();
  let expectedCount = null;
  // These are targeted reference reads, never whole-company snapshots. Both
  // total rows and page count are bounded; exceeding either fails closed.
  for (let page = 0; page < 20; page++) {
    signal?.throwIfAborted();
    const url = new URL(`${config.origin}/rest/v1/crm_records`);
    url.searchParams.set("select", "id,record_type,company_state_id,lead_id,job_id,data,version,deleted_at");
    url.searchParams.set("company_state_id", `eq.${config.companyId}`);
    url.searchParams.set("record_type", `eq.${recordType}`);
    url.searchParams.set("deleted_at", "is.null");
    url.searchParams.set(filterField, `in.(${ids.map(id => `"${id}"`).join(",")})`);
    url.searchParams.set("order", "id.asc");
    url.searchParams.set("offset", String(rows.length));
    url.searchParams.set("limit", "100");
    const response = await fetch(url, {
      method: "GET", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      headers: { apikey: config.anonKey, Authorization: authorization, Prefer: "count=exact" },
    });
    if (!response.ok) throw new Error("payment_reference_lookup_failed");
    const chunk = await response.json();
    const range = /^(?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(response.headers.get("content-range") || "");
    const count = range ? Number(range[3]) : NaN;
    if (!Array.isArray(chunk) || !Number.isSafeInteger(count) || count > 2000 ||
        (expectedCount !== null && count !== expectedCount) ||
        (chunk.length > 0 && (Number(range[1]) !== rows.length || Number(range[2]) - Number(range[1]) + 1 !== chunk.length)) ||
        chunk.length > 100 || rows.length + chunk.length > count || (chunk.length === 0 && rows.length !== count)) {
      throw new Error("payment_reference_snapshot_incomplete");
    }
    expectedCount = count;
    for (const row of chunk) {
      if (!row || !squareStatusSafeId(row.id) || row.record_type !== recordType || row.company_state_id !== config.companyId ||
          row.deleted_at !== null || !row.data || typeof row.data !== "object" || Array.isArray(row.data) ||
          seen.has(row.id) || (rows.length > 0 && rows[rows.length - 1].id >= row.id) ||
          (filterField === "id" && !ids.includes(row.id)) ||
          (filterField === "data->>squareInvoiceId" && !ids.includes(row.data.squareInvoiceId))) {
        throw new Error("payment_reference_snapshot_invalid");
      }
      seen.add(row.id); rows.push(row);
    }
    if (rows.length === count) return rows;
  }
  throw new Error("payment_reference_snapshot_incomplete");
}

async function squareStatusResolveReferences(config, authorization, invoiceIds, signal) {
  const estimates = await squareStatusReadRecords(config, authorization, "estimate", "data->>squareInvoiceId", invoiceIds, signal);
  const references = new Map();
  for (const estimate of estimates) {
    if (!squareStatusSafeId(estimate.lead_id) || !squareStatusSafeId(estimate.job_id) || estimate.data.id !== estimate.id ||
        estimate.data.contactId !== estimate.lead_id || estimate.data.jobId !== estimate.job_id ||
        (estimate.data.squareOrderId && !squareStatusSafeId(estimate.data.squareOrderId))) throw new Error("payment_reference_invalid");
    const invoiceId = estimate.data.squareInvoiceId;
    const previous = references.get(invoiceId);
    const orderId = estimate.data.squareOrderId || "";
    if (previous && (previous.leadId !== estimate.lead_id || previous.jobId !== estimate.job_id ||
        (previous.orderId && orderId && previous.orderId !== orderId))) throw new Error("payment_reference_ambiguous");
    references.set(invoiceId, { leadId: estimate.lead_id, jobId: estimate.job_id, orderId: orderId || previous?.orderId || "" });
  }
  if (references.size !== invoiceIds.length) throw new Error("payment_reference_unavailable");
  const leadIds = [...new Set([...references.values()].map(reference => reference.leadId))];
  const jobIds = [...new Set([...references.values()].map(reference => reference.jobId))];
  const contacts = await squareStatusReadRecords(config, authorization, "contact", "id", leadIds, signal);
  const jobs = await squareStatusReadRecords(config, authorization, "job", "id", jobIds, signal);
  const contactsById = new Map(contacts.map(contact => [contact.id, contact]));
  const jobsById = new Map(jobs.map(job => [job.id, job]));
  for (const reference of references.values()) {
    const contact = contactsById.get(reference.leadId), job = jobsById.get(reference.jobId);
    if (!contact || !job || contact.data.id !== contact.id || contact.lead_id !== contact.id || contact.job_id !== null ||
        job.data.id !== job.id || job.lead_id !== contact.id || job.job_id !== job.id ||
        (job.data.contactId !== undefined && job.data.contactId !== contact.id) ||
        (job.data.leadId !== undefined && job.data.leadId !== contact.id)) throw new Error("payment_reference_invalid");
  }
  return references;
}

async function squareStatusReadInvoice(invoiceId, reference, signal) {
  signal?.throwIfAborted();
  const response = await fetch(`${SQUARE_BASE}/invoices/${encodeURIComponent(invoiceId)}`, {
    method: "GET", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${squareToken()}`, "Square-Version": SQUARE_VERSION, "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("Square invoice could not be retrieved");
  const result = await response.json();
  if (result.invoice?.id !== invoiceId || (reference.orderId && result.invoice.order_id !== reference.orderId)) {
    throw new Error("Square invoice association could not be confirmed");
  }
  if (["REFUNDED", "PARTIALLY_REFUNDED"].includes(result.invoice.status)) {
    const snapshot = await require(path.join(__dirname, "square-payment-worker.js")).readSnapshot({
      get: squareProviderReader(signal), invoiceId, expectedOrderId: reference.orderId,
      minimumVersion: result.invoice.version,
    });
    return { ...snapshot, leadId: reference.leadId, jobId: reference.jobId };
  }
  const requests = result.invoice.payment_requests;
  if (!Array.isArray(requests) || requests.length > 100 || typeof result.invoice.status !== "string" || !result.invoice.status ||
      !Number.isFinite(Date.parse(result.invoice.updated_at || ""))) throw new Error("Incomplete Square invoice response");
  let paidCents = 0, contractCents = 0;
  for (const request of requests) {
    if (!request || typeof request !== "object") throw new Error("Invalid Square payment request");
    for (const money of [request.total_completed_amount_money, request.computed_amount_money]) {
      if (money !== undefined && (!money || !Number.isSafeInteger(money.amount) || money.amount < 0 ||
          (money.currency !== undefined && money.currency !== "USD"))) throw new Error("Invalid Square money amount");
    }
    paidCents += request.total_completed_amount_money?.amount || 0;
    contractCents += request.computed_amount_money?.amount || 0;
    if (!Number.isSafeInteger(paidCents) || !Number.isSafeInteger(contractCents)) throw new Error("Square money amount exceeds supported precision");
  }
  return { ...squareInvoicePaymentSummary(result.invoice), leadId: reference.leadId, jobId: reference.jobId };
}

async function handleSquarePaymentStatus(req, res, user) {
  const authorization = req.headers.authorization || "";
  if (!user?.id || user.local || !/^Bearer \S+$/.test(authorization)) {
    sendJson(res, 401, { error: "authenticated_cloud_user_required" }); return;
  }
  let invoiceIds;
  try {
    const body = JSON.parse(await readRequestBody(req));
    invoiceIds = body?.invoiceIds;
    if (!body || Array.isArray(body) || !Array.isArray(invoiceIds) || invoiceIds.length < 1 || invoiceIds.length > 20 ||
        !invoiceIds.every(squareStatusSafeId) || new Set(invoiceIds).size !== invoiceIds.length) throw new Error("invalid_invoice_ids");
  } catch {
    sendJson(res, 400, { error: "Provide 1 to 20 unique valid invoice IDs." }); return;
  }
  const config = squareStatusPublicConfig();
  if (!config || !squareToken()) {
    sendJson(res, 503, { error: "Payment lookup is not configured for authenticated shared records." }); return;
  }
  let references;
  // Bound the entire reference/provider phase below the browser's 60s deadline,
  // including four-worker batches and unusually small database page caps.
  const signal = AbortSignal.timeout(40000);
  try {
    // Complete every association check before revealing anything from Square.
    references = await squareStatusResolveReferences(config, authorization, invoiceIds, signal);
  } catch {
    sendJson(res, 409, { error: "Invoice references could not be confirmed against the current shared CRM. Refresh the CRM and retry." }); return;
  }
  const payments = Object.create(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, invoiceIds.length) }, async () => {
    while (next < invoiceIds.length) {
      const invoiceId = invoiceIds[next++];
      try { payments[invoiceId] = await squareStatusReadInvoice(invoiceId, references.get(invoiceId), signal); }
      catch { payments[invoiceId] = { invoiceId, error: "Square invoice could not be retrieved or its association could not be confirmed" }; }
    }
  }));
  sendJson(res, 200, { payments });
}

async function handleSquareWebhook(req, res) {
  const key = squareWebhookKey();
  const webhookUrl = process.env.SQUARE_WEBHOOK_URL;
  const config = squareWorkerConfig();
  const merchantId = process.env.SQUARE_MERCHANT_ID || "";
  if (!key || !webhookUrl || !config || !squareStatusSafeId(merchantId)) {
    sendJson(res, 503, { error: "Durable webhook verification/storage is not configured." }); return;
  }
  try {
    const rawBody = await readRequestBody(req);
    const crypto = require("crypto");
    const expected = Buffer.from(crypto.createHmac("sha256", key).update(webhookUrl + rawBody).digest("base64"));
    const received = Buffer.from(String(req.headers["x-square-hmacsha256-signature"] || ""));
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      sendJson(res, 401, { error: "Invalid signature" }); return;
    }
    let event;
    try { event = JSON.parse(rawBody); } catch { sendJson(res, 400, { error: "Invalid webhook JSON" }); return; }
    const environment = process.env.SQUARE_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
    if (event?.merchant_id !== merchantId || (req.headers["square-environment"] && String(req.headers["square-environment"]).trim().toLowerCase() !== environment)) {
      sendJson(res, 403, { error: "Webhook merchant or environment mismatch" }); return;
    }
    const events = ["invoice.created", "invoice.published", "invoice.updated", "invoice.payment_made",
      "invoice.scheduled_charge_failed", "invoice.canceled", "invoice.refunded", "invoice.deleted"];
    if (!events.includes(event.type)) {
      sendJson(res, 200, { received: true, ignored: true }); return;
    }
    if (!squareStatusSafeId(event.event_id) || !squareStatusSafeId(event.data?.object?.invoice?.id) ||
        !Number.isFinite(Date.parse(event.created_at || ""))) {
      sendJson(res, 400, { error: "Incomplete invoice webhook" }); return;
    }
    const receipt = await squareWorkerRpc(config, "crm_square_enqueue_webhook", {
      p_company: config.companyId, p_environment: environment, p_event: event,
    });
    if (receipt?.durable !== true || receipt.eventId !== event.event_id) throw new Error("Unconfirmed webhook receipt");
    // This acknowledges durable receipt, not a completed payment reconciliation.
    sendJson(res, 200, { received: true, queued: true });
  } catch {
    sendJson(res, 503, { error: "Webhook storage was not confirmed; retry delivery." });
  }
}

function squareProviderReader(signal = AbortSignal.timeout(60000)) {
  return async (providerPath) => {
    if (!/^\/(invoices|orders|payments)\/[A-Za-z0-9_%:-]+$/.test(providerPath)) throw new Error("Invalid provider read path");
    const response = await fetch(`${SQUARE_BASE}${providerPath}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      headers: { Authorization: `Bearer ${squareToken()}`, "Square-Version": SQUARE_VERSION, "Content-Type": "application/json" },
    });
    if (!response.ok) throw new Error("Provider payment read unavailable");
    return response.json();
  };
}

function startSquarePaymentWorker() {
  // Enabled only after all worker migrations and secret settings are verified.
  // No browser/tab is needed; database leases coordinate multiple server instances.
  if (process.env.SQUARE_PAYMENT_WORKER_ENABLED !== "true") return null;
  const config = squareWorkerConfig();
  const merchantId = process.env.SQUARE_MERCHANT_ID || "";
  if (!config || !squareToken() || !squareStatusSafeId(merchantId)) {
    throw new Error("Square payment worker requires its server-only database key, token and merchant ID.");
  }
  const environment = process.env.SQUARE_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
  const scope = { companyId: config.companyId, environment, merchantId };
  const base = { p_company: config.companyId, p_environment: environment, p_merchant: merchantId };
  const workerModule = require(path.join(__dirname, "square-payment-worker.js"));
  const worker = workerModule.create({
    scope,
    store: {
      claim: () => squareWorkerRpc(config, "crm_square_claim_webhook", base),
      apply: (claim, snapshot) => squareWorkerRpc(config, "crm_square_apply_payment", {
        ...base, p_event_id: claim.eventId, p_lease_id: claim.leaseId, p_snapshot: snapshot,
      }),
      fail: (claim, code, retryable) => squareWorkerRpc(config, "crm_square_fail_webhook", {
        ...base, p_event_id: claim.eventId, p_lease_id: claim.leaseId, p_code: code, p_retryable: retryable,
      }),
    },
    read: (claim) => workerModule.readSnapshot({
      get: squareProviderReader(), invoiceId: claim.invoiceId,
      notBefore: claim.invoiceUpdatedAt || undefined, minimumVersion: claim.invoiceVersion ?? undefined,
    }),
    onError: (code) => console.warn(`Square payment processing deferred: ${code}`),
  });
  const run = () => worker.tick().catch(() => console.warn("Square payment worker could not confirm its queue state; retained for retry."));
  const timer = setInterval(run, 5000);
  timer.unref();
  run();
  return () => clearInterval(timer);
}

async function handleSquareSyncStatus(req, res, user) {
  if (!user?.id || user.local || !isApiAdmin(user)) {
    sendJson(res, 403, { error: "A signed-in company administrator is required." }); return;
  }
  const config = squareWorkerConfig();
  const merchantId = process.env.SQUARE_MERCHANT_ID || "";
  if (!config || !squareStatusSafeId(merchantId)) {
    sendJson(res, 503, { error: "Payment synchronization is not configured." }); return;
  }
  try {
    const status = await squareWorkerRpc(config, "crm_square_sync_status", {
      p_company: config.companyId, p_environment: process.env.SQUARE_ENVIRONMENT === "sandbox" ? "sandbox" : "production", p_merchant: merchantId,
    });
    if (!status || ![status.pending, status.review].every(n => Number.isSafeInteger(n) && n >= 0) ||
        [status.lastProcessedAt, status.oldestPendingAt].some(date => date !== null && (typeof date !== "string" || !Number.isFinite(Date.parse(date))))) {
      throw new Error("Invalid synchronization status");
    }
    sendJson(res, 200, { enabled: process.env.SQUARE_PAYMENT_WORKER_ENABLED === "true" && Boolean(squareToken()),
      pending: status.pending, review: status.review, lastProcessedAt: status.lastProcessedAt, oldestPendingAt: status.oldestPendingAt });
  } catch {
    sendJson(res, 503, { error: "Payment synchronization could not be confirmed." });
  }
}

const handleRequest = (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=(self)");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  let url;
  let decodedPath;
  try {
    url = new URL(req.url, "http://localhost");
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    send(res, 400, "Invalid request URL");
    return;
  }
  if (url.pathname === "/api/health" && req.method === "GET") {
    sendJson(res, 200, {
      ok: true,
      service: "jobcrest-crm",
      release: process.env.RENDER_GIT_COMMIT || "full-audit-repairs-20260921",
      timestamp: new Date().toISOString(),
    });
    return;
  }
  if (url.pathname === "/api/integrations/google/callback" && req.method === "GET") {
    handleGoogleCallback(url, res);
    return;
  }
  if (url.pathname === "/api/integrations/google/status" && req.method === "GET") {
    requireApiUser(req, res, handleGoogleStatus);
    return;
  }
  if (url.pathname === "/api/integrations/google/connect" && req.method === "POST") {
    requireApiUser(req, res, handleGoogleConnect);
    return;
  }
  if (url.pathname === "/api/integrations/google/disconnect" && req.method === "POST") {
    requireApiUser(req, res, handleGoogleDisconnect);
    return;
  }
  if (url.pathname === "/api/integrations/google/calendar/event" && req.method === "POST") {
    requireApiUser(req, res, handleGoogleCalendarEvent);
    return;
  }
  if (url.pathname === "/api/integrations/google/calendar/event" && req.method === "DELETE") {
    requireApiUser(req, res, handleGoogleCalendarDelete);
    return;
  }
  if (url.pathname === "/api/integrations/google/gmail/send" && req.method === "POST") {
    requireApiUser(req, res, handleGoogleGmailSend);
    return;
  }
  if (url.pathname === "/api/integrations/google/gmail/threads" && req.method === "POST") {
    requireApiUser(req, res, handleGoogleGmailThreads);
    return;
  }
  if (url.pathname === "/api/integrations/google/gmail/watch" && req.method === "POST") {
    requireApiUser(req, res, handleGoogleGmailWatch);
    return;
  }
  if (url.pathname === "/api/integrations/google/gmail/push" && req.method === "POST") {
    handleGoogleGmailPush(req, res, url);
    return;
  }
  if (url.pathname === "/api/integrations/google/tasks/task" && req.method === "POST") {
    requireApiUser(req, res, handleGoogleTask);
    return;
  }
  if (url.pathname === "/api/integrations/google/tasks/task" && req.method === "DELETE") {
    requireApiUser(req, res, handleGoogleTaskDelete);
    return;
  }
  if (url.pathname === "/api/integrations/google/contacts/contact" && req.method === "POST") {
    requireApiUser(req, res, handleGoogleContact);
    return;
  }
  if (url.pathname === "/api/integrations/google/drive/status" && req.method === "GET") {
    requireApiUser(req, res, handleGoogleDriveStatus);
    return;
  }
  if (url.pathname === "/api/integrations/google/drive/verify" && req.method === "GET") {
    requireApiAdmin(req, res, handleGoogleDriveVerify);
    return;
  }
  if (url.pathname === "/api/integrations/google/drive/document" && req.method === "POST") {
    requireApiUser(req, res, handleGoogleDriveDocument);
    return;
  }
  if (url.pathname === "/api/integrations/google/docs/generate" && req.method === "POST") {
    requireApiUser(req, res, handleGoogleDocsGenerate);
    return;
  }
  if (url.pathname === "/api/integrations/google/sheets/export" && req.method === "POST") {
    requireApiAdmin(req, res, handleGoogleSheetsExport);
    return;
  }
  if (url.pathname === "/api/integrations/google/chat/notify" && req.method === "POST") {
    requireApiUser(req, res, handleGoogleChatNotify);
    return;
  }
  if (url.pathname === "/api/integrations/google/groups/member" && req.method === "POST") {
    requireApiAdmin(req, res, handleGoogleGroupMember);
    return;
  }
  if (url.pathname === "/api/smart-documents/save" && req.method === "POST") {
    requireApiUser(req, res, handleSmartDocumentSave);
    return;
  }
  if (url.pathname === "/api/smart-documents/email" && req.method === "POST") {
    requireApiUser(req, res, handleSmartDocumentEmail);
    return;
  }
  if (url.pathname === "/api/integrations/zoho/callback" && req.method === "GET") {
    handleZohoCallback(url, res);
    return;
  }
  if (url.pathname === "/api/integrations/zoho/status" && req.method === "GET") {
    requireApiUser(req, res, handleZohoStatus);
    return;
  }
  if (url.pathname === "/api/integrations/zoho/connect" && req.method === "POST") {
    requireApiUser(req, res, handleZohoConnect);
    return;
  }
  if (url.pathname === "/api/integrations/zoho/disconnect" && req.method === "POST") {
    requireApiUser(req, res, handleZohoDisconnect);
    return;
  }
  if (url.pathname === "/api/integrations/zoho/sign/request" && req.method === "POST") {
    requireApiUser(req, res, handleZohoSmartDocument);
    return;
  }
  if (url.pathname === "/api/square/create-invoice" && req.method === "POST") {
    requireApiAdmin(req, res, handleSquareCreateInvoice);
    return;
  }

  if (url.pathname === "/api/square/payment-status" && req.method === "POST") {
    requireApiUser(req, res, handleSquarePaymentStatus);
    return;
  }

  if (url.pathname === "/api/square/sync-status" && req.method === "GET") {
    requireApiAdmin(req, res, handleSquareSyncStatus);
    return;
  }

  if (url.pathname === "/api/admin/team-invitations" && req.method === "POST") {
    requireApiAdmin(req, res, handleTeamInvitation);
    return;
  }
  if (url.pathname === "/api/admin/customer-invitations" && req.method === "POST") {
    requireApiAdmin(req,res,handleCustomerPortalInvitation);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  if (url.pathname === "/webhooks/square" && req.method === "POST") {
    handleSquareWebhook(req, res);
    return;
  }

  if (url.pathname === "/auth-config.js") {
    send(res, 200, authConfigScript(), "text/javascript; charset=utf-8");
    return;
  }

  if (url.pathname === "/login/") {
    sendRedirect(res, "/login");
    return;
  }

  if (url.pathname === "/logout/") {
    sendRedirect(res, "/logout");
    return;
  }

  if (url.pathname === "/portal/") {
    sendRedirect(res, "/portal");
    return;
  }

  const routes = {
    "/": "/index.html",
    "/login": "/login.html",
    "/logout": "/logout.html",
    "/portal": "/portal.html",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed");
    return;
  }
  const requested = routes[decodedPath] || decodedPath;
  if (!publicAssets.has(requested)) {
    send(res, 404, "Not found");
    return;
  }
  const filePath = publicAssetFiles.get(requested) || path.normalize(path.join(root, requested));
  const containmentRoot = publicAssetFiles.has(requested) ? path.join(root, "node_modules", "pdfjs-dist", "build") : root;
  const relativePath = path.relative(containmentRoot, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath);
    const mimeType = types[ext] || "application/octet-stream";
    // Never cache HTML — always serve fresh so version-bumped assets load immediately
    if (ext === ".html" || ext === "") {
      res.writeHead(200, {
        "Content-Type": mimeType,
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "Surrogate-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } else {
      send(res, 200, req.method === "HEAD" ? undefined : content, mimeType);
    }
  });
};
const server = http.createServer(handleRequest);

if (require.main === module) {
  if (process.env.CRM_STAGING_ACCESS === "true" && !stagingTestIdentity()) {
    throw new Error("Staging safety checks failed. Use the approved test project, require sign-in, skip environment files, and remove Square credentials.");
  }
  server.listen(port, authenticationRequired() && !stagingTestIdentity() ? "0.0.0.0" : "127.0.0.1", () => {
    console.log(`JobCrest CRM running at http://localhost:${port}`);
  });
  const stopWorker = startSquarePaymentWorker();
  if (stopWorker) server.once("close", stopWorker);
  const stopBackupWorker = startRecoveryBackupWorker();
  if (stopBackupWorker) server.once("close", stopBackupWorker);
}

module.exports = { handleRequest, isApiAdmin, squareInvoicePaymentSummary };
