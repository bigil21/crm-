const test = require("node:test");
const assert = require("node:assert/strict");

const {
  GOOGLE_TASKS_SCOPE, GOOGLE_CONTACTS_SCOPE, docsMergeRequests, googleTaskResource,
  contactResource, decodeGmailPush, sendGoogleChatWebhook, createGoogleSheet,
  deleteGoogleTask,
} = require("../google-products");

test("additional Google product scopes remain narrowly product-specific", () => {
  assert.equal(GOOGLE_TASKS_SCOPE, "https://www.googleapis.com/auth/tasks");
  assert.equal(GOOGLE_CONTACTS_SCOPE, "https://www.googleapis.com/auth/contacts");
});

test("Docs merge accepts only explicit template tokens", () => {
  assert.deepEqual(docsMergeRequests({ "{{customer_name}}": "Ada Lovelace" })[0], {
    replaceAllText: { containsText: { text: "{{customer_name}}", matchCase: true }, replaceText: "Ada Lovelace" },
  });
  assert.throws(() => docsMergeRequests({ customer_name: "Ada" }), /invalid_docs_merge_token/);
});

test("Google task resources preserve completion and JobCrest identity", () => {
  const value = googleTaskResource({ id: "task-1", title: "Call customer", dueAt: "2026-10-28T11:00:00-04:00", completed: true });
  assert.equal(value.status, "completed");
  assert.match(value.notes, /JobCrest Task: task-1/);
  assert.equal(value.due, "2026-10-28T15:00:00.000Z");
});

test("Google task deletion is scoped to the saved list and task", async () => {
  let call;
  const result = await deleteGoogleTask(async (url, options) => {
    call = { url: String(url), options };
    return { ok: true, status: 204 };
  }, "token", "list_123", "task_456");
  assert.equal(result.deleted, true);
  assert.match(call.url, /lists\/list_123\/tasks\/task_456$/);
  assert.equal(call.options.method, "DELETE");
});

test("Google contact resources are allow-listed", () => {
  const value = contactResource({ name: "Ada Lovelace", email: "ADA@example.com", phone: "555-0100", address: "1 Main St" });
  assert.equal(value.names[0].givenName, "Ada");
  assert.equal(value.emailAddresses[0].value, "ada@example.com");
  assert.equal(value.phoneNumbers[0].value, "555-0100");
});

test("Google contact updates preserve the provider etag", () => {
  assert.equal(contactResource({ name: "Ada Lovelace", etag: "etag-123" }).etag, "etag-123");
});

test("Gmail push payloads require an email and numeric history id", () => {
  const encoded = Buffer.from(JSON.stringify({ emailAddress: "gil@coastalcrestroofing.com", historyId: "1234" })).toString("base64");
  assert.deepEqual(decodeGmailPush(encoded), { emailAddress: "gil@coastalcrestroofing.com", historyId: "1234" });
  assert.throws(() => decodeGmailPush(Buffer.from("{}").toString("base64")), /invalid_email/);
});

test("Chat notifications reject non-Google webhook destinations", async () => {
  await assert.rejects(() => sendGoogleChatWebhook(fetch, "https://example.com/hook", { title: "Won" }), /google_chat_not_configured/);
});

test("Sheets export creates a Shared Drive spreadsheet and writes rows in a batch", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("/drive/v3/files")) return { ok: true, json: async () => ({ id: "sheet_123", name: "Pipeline", mimeType: "application/vnd.google-apps.spreadsheet", webViewLink: "https://docs.google.com/spreadsheets/d/sheet_123/edit" }) };
    return { ok: true, json: async () => ({}) };
  };
  const result = await createGoogleSheet(fetchImpl, "token", "folder_123", "Pipeline", ["Lead", "Value"], [["Acme", 1250.5]]);
  assert.equal(result.rowCount, 1);
  assert.equal(calls.length, 3);
  const valuesCall = calls.find((call) => call.url.includes("values:batchUpdate"));
  assert.deepEqual(JSON.parse(valuesCall.options.body).data[0].values, [["Lead", "Value"], ["Acme", 1250.5]]);
});

