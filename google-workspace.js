const crypto = require("node:crypto");

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.owned";
const GOOGLE_GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
const GOOGLE_GMAIL_READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const IDENTITY_SCOPES = ["openid", "email"];

function safeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("invalid_email");
  return email;
}

function safeIdentifier(value, field = "identifier") {
  const id = String(value || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(id)) throw new Error(`invalid_${field}`);
  return id;
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function createOAuthState(payload, secret, now = Date.now()) {
  if (!secret || String(secret).length < 32) throw new Error("google_oauth_state_secret_missing");
  const body = {
    sub: safeIdentifier(payload.sub, "user"),
    email: safeEmail(payload.email),
    company: safeIdentifier(payload.company, "company"),
    nonce: crypto.randomBytes(18).toString("base64url"),
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 10 * 60,
  };
  const encoded = base64url(JSON.stringify(body));
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyOAuthState(state, secret, now = Date.now()) {
  if (!secret || String(secret).length < 32 || typeof state !== "string") throw new Error("invalid_oauth_state");
  const [encoded, signature, extra] = state.split(".");
  if (!encoded || !signature || extra) throw new Error("invalid_oauth_state");
  const expected = crypto.createHmac("sha256", secret).update(encoded).digest();
  let actual;
  try { actual = Buffer.from(signature, "base64url"); } catch { throw new Error("invalid_oauth_state"); }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("invalid_oauth_state");
  let payload;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw new Error("invalid_oauth_state"); }
  if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.exp < Math.floor(now / 1000) || payload.iat > Math.floor(now / 1000) + 60) {
    throw new Error("expired_oauth_state");
  }
  return { sub: safeIdentifier(payload.sub, "user"), email: safeEmail(payload.email), company: safeIdentifier(payload.company, "company") };
}

function createAuthorizationUrl(config, identity, state) {
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent select_account",
    scope: [...new Set([
      ...IDENTITY_SCOPES,
      GOOGLE_CALENDAR_SCOPE,
      GOOGLE_GMAIL_SEND_SCOPE,
      GOOGLE_GMAIL_READ_SCOPE,
      ...(Array.isArray(config.additionalScopes) ? config.additionalScopes : []),
    ])].join(" "),
    login_hint: safeEmail(identity.email),
    state,
  }).toString();
  return url.toString();
}

async function tokenRequest(fetchImpl, config, fields) {
  const response = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...fields }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.access_token !== "string" || !result.access_token) throw new Error("google_token_exchange_failed");
  return result;
}

function exchangeAuthorizationCode(fetchImpl, config, code) {
  if (typeof code !== "string" || !code || code.length > 2048) throw new Error("invalid_authorization_code");
  return tokenRequest(fetchImpl, config, { code, redirect_uri: config.redirectUri, grant_type: "authorization_code" });
}

function refreshAccessToken(fetchImpl, config, refreshToken) {
  if (typeof refreshToken !== "string" || !refreshToken) throw new Error("google_refresh_token_missing");
  return tokenRequest(fetchImpl, config, { refresh_token: refreshToken, grant_type: "refresh_token" });
}

async function revokeGoogleToken(fetchImpl, token) {
  if (typeof token !== "string" || !token) throw new Error("google_refresh_token_missing");
  const response = await fetchImpl(`${GOOGLE_TOKEN_URL.replace(/\/token$/, "/revoke")}?token=${encodeURIComponent(token)}`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!response.ok) throw new Error("google_token_revocation_failed");
}

async function fetchGoogleIdentity(fetchImpl, accessToken) {
  const response = await fetchImpl(GOOGLE_USERINFO_URL, {
    signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${accessToken}` },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.email_verified !== true) throw new Error("google_identity_unverified");
  return { email: safeEmail(result.email), subject: safeIdentifier(result.sub, "google_subject") };
}

function encryptionKey(value) {
  let key;
  try { key = Buffer.from(String(value || ""), "base64"); } catch { key = Buffer.alloc(0); }
  if (key.length !== 32) throw new Error("integration_encryption_key_invalid");
  return key;
}

function encryptSecret(value, encodedKey) {
  if (typeof value !== "string" || !value) throw new Error("secret_missing");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(encodedKey), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decryptSecret(value, encodedKey) {
  const [version, iv, tag, encrypted, extra] = String(value || "").split(".");
  if (version !== "v1" || !iv || !tag || !encrypted || extra) throw new Error("encrypted_secret_invalid");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(encodedKey), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch { throw new Error("encrypted_secret_invalid"); }
}

function calendarEventResource(task, contact, timeZone = "America/New_York") {
  const duration = Number(task.duration);
  if (!Number.isFinite(duration) || duration < 5 || duration > 1440) throw new Error("invalid_task_schedule");
  const localMatch = String(task.dueAt || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  let startDateTime;
  let endDateTime;
  if (localMatch) {
    const [, year, month, day, hour, minute, second = "00"] = localMatch;
    const wallClock = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
    if (wallClock.getUTCFullYear() !== Number(year) || wallClock.getUTCMonth() !== Number(month) - 1 || wallClock.getUTCDate() !== Number(day) ||
        wallClock.getUTCHours() !== Number(hour) || wallClock.getUTCMinutes() !== Number(minute)) throw new Error("invalid_task_schedule");
    startDateTime = `${year}-${month}-${day}T${hour}:${minute}:${second}`;
    wallClock.setUTCMinutes(wallClock.getUTCMinutes() + duration);
    const pad = value => String(value).padStart(2, "0");
    endDateTime = `${wallClock.getUTCFullYear()}-${pad(wallClock.getUTCMonth() + 1)}-${pad(wallClock.getUTCDate())}T${pad(wallClock.getUTCHours())}:${pad(wallClock.getUTCMinutes())}:${pad(wallClock.getUTCSeconds())}`;
  } else {
    const start = new Date(task.dueAt);
    if (!Number.isFinite(start.getTime())) throw new Error("invalid_task_schedule");
    startDateTime = start.toISOString();
    endDateTime = new Date(start.getTime() + duration * 60 * 1000).toISOString();
  }
  const description = [
    task.notes,
    contact?.name ? `Related Lead: ${contact.name}` : "",
    contact?.phone ? `Phone: ${contact.phone}` : "",
    contact?.email ? `Email: ${contact.email}` : "",
    `JobCrest CRM Task: ${task.id}`,
  ].filter(Boolean).join("\n").slice(0, 8000);
  const resource = {
    summary: String(task.title || "CRM task").trim().slice(0, 500),
    description,
    start: { dateTime: startDateTime, timeZone },
    end: { dateTime: endDateTime, timeZone },
    reminders: task.reminder === "none" ? { useDefault: false, overrides: [] } : { useDefault: true },
    extendedProperties: { private: { jobcrestTaskId: safeIdentifier(task.id, "task") } },
  };
  if (contact?.address) resource.location = String(contact.address).replaceAll("\n", ", ").slice(0, 1000);
  return resource;
}

async function upsertCalendarEvent(fetchImpl, accessToken, task, contact, timeZone) {
  const eventId = task.googleEventId ? safeIdentifier(task.googleEventId, "google_event") : "";
  const path = eventId
    ? `/calendars/primary/events/${encodeURIComponent(eventId)}`
    : "/calendars/primary/events";
  const url = new URL(`${GOOGLE_CALENDAR_API}${path}`);
  if (task.addGoogleMeet === true) url.searchParams.set("conferenceDataVersion", "1");
  const resource = calendarEventResource(task, contact, timeZone);
  if (task.addGoogleMeet === true) {
    resource.conferenceData = {
      createRequest: {
        requestId: `jobcrest-${safeIdentifier(task.id, "task")}-${crypto.randomBytes(6).toString("hex")}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  const response = await fetchImpl(url.toString(), {
    method: eventId ? "PUT" : "POST",
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(resource),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || typeof result.id !== "string" || !result.id) throw new Error(response.status === 401 ? "google_access_expired" : "google_calendar_write_failed");
  const meetLink = Array.isArray(result.conferenceData?.entryPoints)
    ? result.conferenceData.entryPoints.find((item) => item.entryPointType === "video" && /^https:\/\/meet\.google\.com\//.test(item.uri || ""))?.uri || ""
    : "";
  return { eventId: safeIdentifier(result.id, "google_event"), htmlLink: /^https:\/\/calendar\.google\.com\//.test(result.htmlLink || "") ? result.htmlLink : "", meetLink, updated: result.updated || new Date().toISOString() };
}

async function deleteCalendarEvent(fetchImpl, accessToken, eventId) {
  const safeEventId = safeIdentifier(eventId, "google_event");
  const response = await fetchImpl(`${GOOGLE_CALENDAR_API}/calendars/primary/events/${encodeURIComponent(safeEventId)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.ok || response.status === 404 || response.status === 410) return { deleted: true };
  throw new Error(response.status === 401 ? "google_access_expired" : "google_calendar_delete_failed");
}

function safeHeader(value, field, maxLength = 998) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength || /[\r\n]/.test(text)) throw new Error(`invalid_${field}`);
  return text;
}

function encodedHeader(value) {
  const text = safeHeader(value, "subject", 500);
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, "utf8").toString("base64")}?=`;
}

function gmailAttachment(value) {
  if (!value) return null;
  const bytes = Buffer.isBuffer(value.bytes) ? value.bytes : null;
  if (!bytes || !bytes.length || bytes.length > 20 * 1024 * 1024) throw new Error("invalid_gmail_attachment");
  const name = safeHeader(String(value.name || "JobCrest document.pdf").replace(/["\\\r\n]/g, "-"), "attachment_name", 180);
  const type = String(value.type || "application/octet-stream").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type)) throw new Error("invalid_gmail_attachment");
  return { bytes, name, type };
}

function gmailMessageResource(email) {
  const to = safeEmail(email.toEmail);
  const from = safeEmail(email.fromEmail);
  const subject = encodedHeader(email.subject || "JobCrest message");
  const message = String(email.message || "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\n", "\r\n");
  if (!message.trim() || Buffer.byteLength(message, "utf8") > 500_000) throw new Error("invalid_message");
  const attachment = gmailAttachment(email.attachment);
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
  ];
  if (attachment) {
    const boundary = `jobcrest-${crypto.randomBytes(18).toString("hex")}`;
    lines.push(
      `Content-Type: multipart/mixed; boundary="${boundary}"`, "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", message,
      `--${boundary}`,
      `Content-Type: ${attachment.type}; name="${attachment.name}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${attachment.name}"`, "",
      attachment.bytes.toString("base64").match(/.{1,76}/g).join("\r\n"),
      `--${boundary}--`, "",
    );
  } else {
    lines.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: 8bit", "", message);
  }
  const resource = { raw: Buffer.from(lines.join("\r\n"), "utf8").toString("base64url") };
  if (email.threadId) resource.threadId = safeIdentifier(email.threadId, "gmail_thread");
  return resource;
}

async function sendGmailMessage(fetchImpl, accessToken, email) {
  const response = await fetchImpl(`${GOOGLE_GMAIL_API}/users/me/messages/send`, {
    method: "POST",
    signal: AbortSignal.timeout(email.attachment ? 30000 : 15000),
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(gmailMessageResource(email)),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 401 ? "google_access_expired" : "gmail_send_failed");
  // Gmail accepted the request but the reply is unreadable: the email may have gone out.
  if (typeof result.id !== "string" || typeof result.threadId !== "string") throw new Error("gmail_send_unconfirmed");
  return { messageId: safeIdentifier(result.id, "gmail_message"), threadId: safeIdentifier(result.threadId, "gmail_thread") };
}

function gmailHeaders(payload) {
  return Object.fromEntries((payload?.headers || []).map((header) => [String(header.name || "").toLowerCase(), String(header.value || "")]));
}

function gmailTextBody(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    try { return Buffer.from(payload.body.data, "base64url").toString("utf8"); } catch { return ""; }
  }
  for (const part of payload.parts || []) {
    const value = gmailTextBody(part);
    if (value) return value;
  }
  return "";
}

async function fetchGmailThread(fetchImpl, accessToken, threadId, connectedEmail) {
  const id = safeIdentifier(threadId, "gmail_thread");
  const response = await fetchImpl(`${GOOGLE_GMAIL_API}/users/me/threads/${encodeURIComponent(id)}?format=full`, {
    signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${accessToken}` },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.id !== id || !Array.isArray(result.messages)) {
    throw new Error(response.status === 401 ? "google_access_expired" : "gmail_thread_read_failed");
  }
  const owner = safeEmail(connectedEmail);
  return result.messages.slice(-100).map((message) => {
    const headers = gmailHeaders(message.payload);
    const from = String(headers.from || "").slice(0, 500);
    const to = String(headers.to || "").slice(0, 1000);
    const timestamp = Number(message.internalDate);
    return {
      messageId: safeIdentifier(message.id, "gmail_message"),
      threadId: id,
      fromEmail: from,
      toEmail: to,
      subject: String(headers.subject || "Email").slice(0, 500),
      message: gmailTextBody(message.payload).slice(0, 500_000),
      createdAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString(),
      direction: from.toLowerCase().includes(owner) ? "outbound" : "inbound",
    };
  });
}

module.exports = {
  GOOGLE_CALENDAR_SCOPE, GOOGLE_GMAIL_SEND_SCOPE, GOOGLE_GMAIL_READ_SCOPE, safeEmail, createOAuthState, verifyOAuthState, createAuthorizationUrl,
  exchangeAuthorizationCode, refreshAccessToken, revokeGoogleToken, fetchGoogleIdentity, encryptSecret, decryptSecret,
  calendarEventResource, upsertCalendarEvent, deleteCalendarEvent, gmailMessageResource, sendGmailMessage, fetchGmailThread,
};
