const crypto = require("node:crypto");
const { safeDriveId, safeFolderName } = require("./google-drive");

const GOOGLE_DRIVE_API = "https://www.googleapis.com/drive/v3";
const GOOGLE_DOCS_API = "https://docs.googleapis.com/v1";
const GOOGLE_SHEETS_API = "https://sheets.googleapis.com/v4";
const GOOGLE_TASKS_API = "https://tasks.googleapis.com/tasks/v1";
const GOOGLE_PEOPLE_API = "https://people.googleapis.com/v1";
const GOOGLE_GMAIL_API = "https://gmail.googleapis.com/gmail/v1";
const GOOGLE_ADMIN_API = "https://admin.googleapis.com/admin/directory/v1";

const GOOGLE_TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";
const GOOGLE_CONTACTS_SCOPE = "https://www.googleapis.com/auth/contacts";

function safeId(value, field = "id") {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(id)) throw new Error(`invalid_${field}`);
  return id;
}

function safeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("invalid_email");
  return email;
}

function safeText(value, maxLength, field = "text", { required = false } = {}) {
  const text = String(value || "").replace(/\u0000/g, "").trim();
  if ((required && !text) || text.length > maxLength) throw new Error(`invalid_${field}`);
  return text;
}

async function googleJson(fetchImpl, url, options = {}, errorCode = "google_request_failed") {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(options.timeout || 20000), ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(response.status === 401 ? "google_access_expired" : errorCode);
    error.status = response.status;
    throw error;
  }
  return result;
}

function bearer(accessToken, extra = {}) {
  if (typeof accessToken !== "string" || !accessToken) throw new Error("google_access_token_missing");
  return { Authorization: `Bearer ${accessToken}`, ...extra };
}

async function verifyDriveRoot(fetchImpl, accessToken, rootFolderId) {
  const id = safeDriveId(rootFolderId, "drive_root");
  const result = await googleJson(fetchImpl,
    `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,name,mimeType,driveId,webViewLink,trashed`,
    { headers: bearer(accessToken) }, "google_drive_root_unavailable");
  if (result.id !== id || result.mimeType !== "application/vnd.google-apps.folder" || result.trashed === true) {
    throw new Error("google_drive_root_invalid");
  }
  return { id, name: safeFolderName(result.name, "JobCrest"), driveId: result.driveId || "", webViewLink: result.webViewLink || "" };
}

async function copyGoogleDocTemplate(fetchImpl, accessToken, templateId, parentFolderId, name) {
  const sourceId = safeDriveId(templateId, "docs_template");
  const parent = safeDriveId(parentFolderId, "drive_parent");
  const result = await googleJson(fetchImpl,
    `${GOOGLE_DRIVE_API}/files/${encodeURIComponent(sourceId)}/copy?supportsAllDrives=true&fields=id,name,mimeType,webViewLink,parents`,
    {
      method: "POST",
      headers: bearer(accessToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({ name: safeFolderName(name, "JobCrest Document"), parents: [parent] }),
    }, "google_docs_copy_failed");
  if (result.mimeType !== "application/vnd.google-apps.document" || typeof result.id !== "string") throw new Error("google_docs_template_invalid");
  return { id: safeDriveId(result.id, "document"), name: result.name, webViewLink: result.webViewLink || "" };
}

function docsMergeRequests(values = {}) {
  const entries = Object.entries(values).slice(0, 100);
  return entries.map(([key, value]) => {
    const token = String(key || "").trim();
    if (!/^\{\{[a-z0-9_.-]{1,80}\}\}$/i.test(token)) throw new Error("invalid_docs_merge_token");
    return {
      replaceAllText: {
        containsText: { text: token, matchCase: true },
        replaceText: safeText(value, 10000, "docs_merge_value"),
      },
    };
  });
}

async function mergeGoogleDoc(fetchImpl, accessToken, documentId, values) {
  const id = safeDriveId(documentId, "document");
  const requests = docsMergeRequests(values);
  if (!requests.length) return { documentId: id, replacements: 0 };
  await googleJson(fetchImpl, `${GOOGLE_DOCS_API}/documents/${encodeURIComponent(id)}:batchUpdate`, {
    method: "POST", headers: bearer(accessToken, { "Content-Type": "application/json" }), body: JSON.stringify({ requests }),
  }, "google_docs_merge_failed");
  return { documentId: id, replacements: requests.length };
}

function sheetCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return String(value).replace(/\u0000/g, "").slice(0, 50000);
}

async function createGoogleSheet(fetchImpl, accessToken, parentFolderId, title, headers, rows) {
  const parent = safeDriveId(parentFolderId, "drive_parent");
  const file = await googleJson(fetchImpl, `${GOOGLE_DRIVE_API}/files?supportsAllDrives=true&fields=id,name,mimeType,webViewLink,parents`, {
    method: "POST", headers: bearer(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ name: safeFolderName(title, "JobCrest Report"), mimeType: "application/vnd.google-apps.spreadsheet", parents: [parent] }),
  }, "google_sheets_create_failed");
  if (file.mimeType !== "application/vnd.google-apps.spreadsheet" || typeof file.id !== "string") throw new Error("google_sheets_create_failed");
  const spreadsheetId = safeDriveId(file.id, "spreadsheet");
  const normalizedHeaders = (Array.isArray(headers) ? headers : []).slice(0, 100).map(sheetCell);
  const normalizedRows = (Array.isArray(rows) ? rows : []).slice(0, 10000).map((row) =>
    (Array.isArray(row) ? row : []).slice(0, normalizedHeaders.length || 100).map(sheetCell));
  if (normalizedHeaders.length) {
    await googleJson(fetchImpl, `${GOOGLE_SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
      method: "POST", headers: bearer(accessToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({ valueInputOption: "RAW", data: [{ range: "Sheet1!A1", majorDimension: "ROWS", values: [normalizedHeaders, ...normalizedRows] }] }),
    }, "google_sheets_write_failed");
    await googleJson(fetchImpl, `${GOOGLE_SHEETS_API}/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: "POST", headers: bearer(accessToken, { "Content-Type": "application/json" }),
      body: JSON.stringify({ requests: [{ repeatCell: { range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.9, green: 0.94, blue: 1 } } }, fields: "userEnteredFormat(textFormat,backgroundColor)" } }, { autoResizeDimensions: { dimensions: { sheetId: 0, dimension: "COLUMNS", startIndex: 0, endIndex: normalizedHeaders.length } } }] }),
    }, "google_sheets_format_failed");
  }
  return { spreadsheetId, webViewLink: file.webViewLink || `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`, rowCount: normalizedRows.length };
}

async function ensureTaskList(fetchImpl, accessToken, title = "JobCrest CRM") {
  const lists = await googleJson(fetchImpl, `${GOOGLE_TASKS_API}/users/@me/lists?maxResults=100`, { headers: bearer(accessToken) }, "google_tasks_list_failed");
  const wanted = safeText(title, 200, "task_list", { required: true });
  const existing = (lists.items || []).find((item) => item.title === wanted);
  if (existing?.id) return { id: safeId(existing.id, "task_list"), title: wanted, reused: true };
  const created = await googleJson(fetchImpl, `${GOOGLE_TASKS_API}/users/@me/lists`, {
    method: "POST", headers: bearer(accessToken, { "Content-Type": "application/json" }), body: JSON.stringify({ title: wanted }),
  }, "google_tasks_list_create_failed");
  return { id: safeId(created.id, "task_list"), title: wanted, reused: false };
}

function googleTaskResource(task = {}) {
  const due = new Date(task.dueAt || "");
  return {
    title: safeText(task.title || "JobCrest task", 1024, "task_title", { required: true }),
    notes: safeText([task.notes, task.jobcrestUrl, task.id ? `JobCrest Task: ${task.id}` : ""].filter(Boolean).join("\n"), 8000, "task_notes"),
    ...(Number.isFinite(due.getTime()) ? { due: due.toISOString() } : {}),
    status: task.completed || task.status === "completed" ? "completed" : "needsAction",
  };
}

async function upsertGoogleTask(fetchImpl, accessToken, listId, task) {
  const list = safeId(listId, "task_list");
  const resource = googleTaskResource(task);
  const taskId = task.googleTaskId ? safeId(task.googleTaskId, "google_task") : "";
  const url = taskId
    ? `${GOOGLE_TASKS_API}/lists/${encodeURIComponent(list)}/tasks/${encodeURIComponent(taskId)}`
    : `${GOOGLE_TASKS_API}/lists/${encodeURIComponent(list)}/tasks`;
  const result = await googleJson(fetchImpl, url, {
    method: taskId ? "PATCH" : "POST", headers: bearer(accessToken, { "Content-Type": "application/json" }), body: JSON.stringify(resource),
  }, "google_tasks_write_failed");
  return { taskId: safeId(result.id, "google_task"), updated: result.updated || new Date().toISOString(), webViewLink: result.webViewLink || "" };
}

async function deleteGoogleTask(fetchImpl, accessToken, listId, taskId) {
  const list = safeId(listId, "task_list");
  const task = safeId(taskId, "google_task");
  const response = await fetchImpl(`${GOOGLE_TASKS_API}/lists/${encodeURIComponent(list)}/tasks/${encodeURIComponent(task)}`, {
    method: "DELETE", signal: AbortSignal.timeout(20000), headers: bearer(accessToken),
  });
  if (!response.ok && response.status !== 404) {
    const error = new Error(response.status === 401 ? "google_access_expired" : "google_tasks_delete_failed");
    error.status = response.status;
    throw error;
  }
  return { deleted: true };
}

function contactResource(contact = {}) {
  const name = safeText(contact.name, 500, "contact_name", { required: true });
  const parts = name.split(/\s+/);
  const email = contact.email ? safeEmail(contact.email) : "";
  const phone = safeText(contact.phone, 100, "contact_phone");
  const address = safeText(contact.address, 1000, "contact_address");
  return {
    ...(contact.etag ? { etag: safeText(contact.etag, 500, "contact_etag", { required: true }) } : {}),
    names: [{ displayName: name, givenName: parts[0] || name, familyName: parts.slice(1).join(" ") }],
    ...(email ? { emailAddresses: [{ value: email, type: "work" }] } : {}),
    ...(phone ? { phoneNumbers: [{ value: phone, type: "work" }] } : {}),
    ...(address ? { addresses: [{ formattedValue: address, type: "work" }] } : {}),
    organizations: [{ name: safeText(contact.company || "JobCrest customer", 500, "contact_company"), title: safeText(contact.jobTitle, 500, "contact_job_title") }],
    biographies: [{ value: safeText(contact.notes, 10000, "contact_notes"), contentType: "TEXT_PLAIN" }],
  };
}

async function upsertGoogleContact(fetchImpl, accessToken, contact) {
  const resourceName = contact.googleContactResourceName
    ? String(contact.googleContactResourceName).match(/^people\/[A-Za-z0-9_-]{3,200}$/)?.[0] || (() => { throw new Error("invalid_google_contact"); })()
    : "";
  const body = contactResource(contact);
  if (resourceName && !body.etag) throw new Error("google_contact_etag_missing");
  const url = resourceName
    ? `${GOOGLE_PEOPLE_API}/${resourceName}:updateContact?updatePersonFields=names,emailAddresses,phoneNumbers,addresses,organizations,biographies&personFields=names,emailAddresses,phoneNumbers,addresses,organizations,biographies,metadata`
    : `${GOOGLE_PEOPLE_API}/people:createContact?personFields=names,emailAddresses,phoneNumbers,addresses,organizations,biographies,metadata`;
  const result = await googleJson(fetchImpl, url, {
    method: resourceName ? "PATCH" : "POST", headers: bearer(accessToken, { "Content-Type": "application/json" }), body: JSON.stringify(body),
  }, "google_contacts_write_failed");
  if (!/^people\/[A-Za-z0-9_-]{3,200}$/.test(result.resourceName || "")) throw new Error("google_contacts_write_failed");
  return { resourceName: result.resourceName, etag: String(result.etag || "").slice(0, 500) };
}

async function sendGoogleChatWebhook(fetchImpl, webhookUrl, notification = {}) {
  let target;
  try { target = new URL(webhookUrl); } catch { throw new Error("google_chat_not_configured"); }
  if (target.protocol !== "https:" || target.hostname !== "chat.googleapis.com" || !/^\/v1\/spaces\/[A-Za-z0-9_-]+\/messages$/.test(target.pathname) || !target.searchParams.get("key") || !target.searchParams.get("token")) {
    throw new Error("google_chat_not_configured");
  }
  const title = safeText(notification.title, 300, "chat_title", { required: true });
  const detail = safeText(notification.detail, 2000, "chat_detail");
  const url = notification.url && /^https:\/\/jobcrestcrm\.com(?:\/|$)/.test(notification.url) ? notification.url : "https://jobcrestcrm.com/";
  const text = [`*${title}*`, detail, `<${url}|Open in JobCrest>`].filter(Boolean).join("\n");
  const result = await googleJson(fetchImpl, target, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
  }, "google_chat_send_failed");
  return { sent: true, messageName: String(result.name || "").slice(0, 500) };
}

async function watchGmail(fetchImpl, accessToken, topicName) {
  const topic = String(topicName || "").trim();
  if (!/^projects\/[a-z][a-z0-9-]{4,61}[a-z0-9]\/topics\/[A-Za-z][A-Za-z0-9._~-]{2,254}$/.test(topic)) throw new Error("gmail_watch_not_configured");
  const result = await googleJson(fetchImpl, `${GOOGLE_GMAIL_API}/users/me/watch`, {
    method: "POST", headers: bearer(accessToken, { "Content-Type": "application/json" }),
    body: JSON.stringify({ topicName: topic, labelIds: ["INBOX"], labelFilterBehavior: "include" }),
  }, "gmail_watch_failed");
  if (!/^\d+$/.test(String(result.historyId || "")) || !Number.isFinite(Number(result.expiration))) throw new Error("gmail_watch_failed");
  return { historyId: String(result.historyId), expiration: new Date(Number(result.expiration)).toISOString() };
}

function decodeGmailPush(data) {
  let payload;
  try { payload = JSON.parse(Buffer.from(String(data || ""), "base64").toString("utf8")); } catch { throw new Error("invalid_gmail_push"); }
  return { emailAddress: safeEmail(payload.emailAddress), historyId: safeId(String(payload.historyId), "gmail_history") };
}

async function addGoogleGroupMember(fetchImpl, accessToken, groupEmail, memberEmail) {
  const group = safeEmail(groupEmail);
  const member = safeEmail(memberEmail);
  try {
    const result = await googleJson(fetchImpl, `${GOOGLE_ADMIN_API}/groups/${encodeURIComponent(group)}/members`, {
      method: "POST", headers: bearer(accessToken, { "Content-Type": "application/json" }), body: JSON.stringify({ email: member, role: "MEMBER" }),
    }, "google_group_member_failed");
    return { added: true, memberId: String(result.id || "").slice(0, 500), email: member, group };
  } catch (error) {
    if (error.status === 409) return { added: false, existing: true, email: member, group };
    throw error;
  }
}

module.exports = {
  GOOGLE_TASKS_SCOPE, GOOGLE_CONTACTS_SCOPE, safeId, safeText, verifyDriveRoot,
  copyGoogleDocTemplate, docsMergeRequests, mergeGoogleDoc, createGoogleSheet,
  ensureTaskList, googleTaskResource, upsertGoogleTask, deleteGoogleTask, contactResource, upsertGoogleContact,
  sendGoogleChatWebhook, watchGmail, decodeGmailPush, addGoogleGroupMember,
};

