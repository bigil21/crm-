"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const backup = require("../recovery-backup.js");

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("backup date uses the configured business time zone", () => {
  const instant = new Date("2026-10-12T02:30:00.000Z");
  assert.equal(backup.backupDate(instant, "America/New_York"), "2026-10-11");
  assert.equal(backup.backupDate(instant, "UTC"), "2026-10-12");
});

test("server recovery backup captures all paginated records and ignores a daily duplicate", async () => {
  const calls = [];
  const rows = {
    crm_state: [{ data: { company: { name: "JobCrest" } } }],
    crm_records: [
      { id: "lead-1", record_type: "contact", data: {}, deleted_at: null },
      { id: "doc-1", record_type: "document", data: { storagePath: "a.pdf", previousVersions: [{ storagePath: "old.pdf" }] }, deleted_at: null },
      { id: "old-doc", record_type: "document", data: { storagePath: "deleted.pdf" }, deleted_at: "2026-01-01T00:00:00Z" },
    ],
    crm_audit_events: [{ id: "a1" }, { id: "a2" }, { id: "a3" }],
    crm_conversation_messages: [{ id: "m1" }],
  };
  const fakeFetch = async (input, options = {}) => {
    const url = new URL(input);
    calls.push({ url, options });
    const table = url.pathname.split("/").pop();
    if (table === "crm_backups") return response(null, 201);
    const [from, to] = String(options.headers.Range).split("-").map(Number);
    return response((rows[table] || []).slice(from, to + 1));
  };
  const result = await backup.createDailyBackup({
    origin: "https://example.supabase.co", companyId: "coastal-crest", key: "sb_secret_test",
    fetch: fakeFetch, pageSize: 2, timeZone: "America/New_York",
  }, new Date("2026-10-11T16:00:00.000Z"));

  assert.deepEqual(result, { backupDate: "2026-10-11", recordCount: 2 });
  const insert = calls.at(-1);
  const body = JSON.parse(insert.options.body);
  assert.equal(body.created_by, null);
  assert.equal(body.payload.source, "server");
  assert.deepEqual(body.payload.storagePaths, ["a.pdf", "old.pdf"]);
  assert.equal(body.payload.auditEvents.length, 3);
  assert.match(insert.options.headers.Prefer, /resolution=ignore-duplicates/);
  assert.equal(insert.url.searchParams.get("on_conflict"), "company_state_id,backup_date");
  assert.ok(calls.filter((call) => call.url.pathname.endsWith("crm_records")).length >= 2);
});

test("backup errors do not expose provider response bodies", async () => {
  await assert.rejects(
    backup.createDailyBackup({
      origin: "https://example.supabase.co", companyId: "coastal-crest", key: "secret.jwt.value",
      fetch: async () => response({ message: "sensitive database detail" }, 500),
    }),
    (error) => error.message === "Recovery backup could not read crm_state."
  );
});
