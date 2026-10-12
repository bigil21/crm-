const ZOHO_SIGN_SCOPES = [
  "ZohoSign.documents.CREATE",
  "ZohoSign.documents.READ",
  "ZohoSign.documents.UPDATE",
];
const SUPPORTED_EXTENSIONS = new Set([
  "pdf", "jpg", "jpeg", "png", "doc", "docx", "html", "htm", "tex", "txt", "sxw", "odt", "rtf", "xls", "xlsx", "ods",
]);
const MAX_ZOHO_SIGN_FILE_SIZE = 25 * 1024 * 1024;

function safeText(value, max, fallback = "") {
  const text = String(value || fallback).trim();
  if (!text || text.length > max) throw new Error("invalid_zoho_sign_text");
  return text;
}

function safeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("invalid_recipient_email");
  return email;
}

function safeZohoId(value, field = "zoho_id") {
  const id = String(value || "");
  if (!/^[0-9]{1,30}$/.test(id)) throw new Error(`invalid_${field}`);
  return id;
}

function safeFileName(value) {
  const name = safeText(value, 255, "document.pdf").replace(/[\r\n"\\/]/g, "-");
  const extension = name.split(".").pop().toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(extension)) throw new Error("unsupported_zoho_sign_file");
  return name;
}

function createAuthorizationUrl(config, state) {
  const url = new URL("/oauth/v2/auth", config.accountsOrigin);
  url.search = new URLSearchParams({
    scope: ZOHO_SIGN_SCOPES.join(","), client_id: config.clientId,
    response_type: "code", access_type: "offline", prompt: "consent",
    redirect_uri: config.redirectUri, state,
  }).toString();
  return url.toString();
}

async function tokenRequest(fetchImpl, config, fields) {
  const response = await fetchImpl(new URL("/oauth/v2/token", config.accountsOrigin), {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, ...fields }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.access_token !== "string" || !result.access_token) throw new Error("zoho_token_exchange_failed");
  return result;
}

function exchangeAuthorizationCode(fetchImpl, config, code) {
  if (typeof code !== "string" || !code || code.length > 2048) throw new Error("invalid_authorization_code");
  return tokenRequest(fetchImpl, config, { code, grant_type: "authorization_code" });
}

function refreshAccessToken(fetchImpl, config, refreshToken) {
  if (typeof refreshToken !== "string" || !refreshToken) throw new Error("zoho_refresh_token_missing");
  return tokenRequest(fetchImpl, config, { refresh_token: refreshToken, grant_type: "refresh_token" });
}

function validateDocument(document) {
  const name = safeFileName(document?.name);
  const size = Number(document?.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_ZOHO_SIGN_FILE_SIZE) throw new Error("zoho_sign_file_too_large");
  if (!Buffer.isBuffer(document?.bytes) || document.bytes.length !== size) throw new Error("invalid_zoho_sign_file");
  return { name, size, type: String(document.type || "application/octet-stream").slice(0, 100), bytes: document.bytes };
}

async function createSmartDocument(fetchImpl, config, accessToken, document, recipient) {
  const file = validateDocument(document);
  const recipientName = safeText(recipient?.name, 200);
  const recipientEmail = safeEmail(recipient?.email);
  const expirationDays = Number(recipient?.expirationDays || 10);
  if (!Number.isSafeInteger(expirationDays) || expirationDays < 1 || expirationDays > 365) throw new Error("invalid_expiration_days");
  const request = {
    request_name: safeText(recipient?.requestName || file.name.replace(/\.[^.]+$/, ""), 255),
    description: String(recipient?.notes || "Prepared from JobCrest CRM").trim().slice(0, 2000),
    expiration_days: expirationDays, is_sequential: true, email_reminders: true, reminder_period: Math.min(5, expirationDays),
    actions: [{ action_type: "SIGN", recipient_email: recipientEmail, recipient_name: recipientName, signing_order: 0, verify_recipient: true, verification_type: "EMAIL", private_notes: "Please review and sign this document." }],
  };
  const form = new FormData();
  form.append("data", JSON.stringify({ requests: request }));
  form.append("file", new Blob([file.bytes], { type: file.type }), file.name);
  const response = await fetchImpl(`${config.signApiOrigin}/api/v1/requests`, {
    method: "POST", signal: AbortSignal.timeout(30000), headers: { Authorization: `Zoho-oauthtoken ${accessToken}` }, body: form,
  });
  const result = await response.json().catch(() => ({}));
  const created = result?.requests;
  if (!response.ok || result?.status !== "success" || !created?.request_id) throw new Error(result?.code === 9018 ? "zoho_sign_file_too_large" : "zoho_sign_create_failed");
  return { requestId: safeZohoId(created.request_id, "zoho_request"), status: String(created.request_status || "draft").slice(0, 40), recipientEmail };
}

async function createEmbeddedSendUrl(fetchImpl, config, accessToken, requestId) {
  const safeRequestId = safeZohoId(requestId, "zoho_request");
  const response = await fetchImpl(`${config.signApiOrigin}/api/v1/requests/${safeRequestId}/embedsendtoken`, {
    method: "POST", signal: AbortSignal.timeout(15000), headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  const result = await response.json().catch(() => ({}));
  let sendUrl;
  try { sendUrl = new URL(result.send_url); } catch { throw new Error("zoho_sign_link_failed"); }
  if (!response.ok || result?.status !== "success" || sendUrl.origin !== config.signWebOrigin || sendUrl.pathname !== "/embedsend") throw new Error("zoho_sign_link_failed");
  return sendUrl.toString();
}

module.exports = {
  ZOHO_SIGN_SCOPES, SUPPORTED_EXTENSIONS, MAX_ZOHO_SIGN_FILE_SIZE,
  createAuthorizationUrl, exchangeAuthorizationCode, refreshAccessToken,
  createSmartDocument, createEmbeddedSendUrl, safeZohoId,
};
