const fs = require("fs");
const path = require("path");

const root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("app.js");
const schema = read("supabase/schema.sql");
const server = read("server.js");
const auth = read("auth.js");
const login = read("login.js");
const index = read("index.html");
const projectConversations = read("project-conversations-v67.js");

const checks = [
  ["durable per-record table", schema.includes("create table if not exists public.crm_records")],
  ["append-only audit events", schema.includes("create table if not exists public.crm_audit_events")],
  ["conversation message table", schema.includes("create table if not exists public.crm_conversation_messages")],
  ["daily recovery backups", schema.includes("create table if not exists public.crm_backups")],
  ["private document bucket", schema.includes("values ('crm-documents', 'crm-documents', false")],
  ["row-level security on records", schema.includes("alter table public.crm_records enable row level security")],
  ["record-level client save", app.includes("flushDurableRecordsSave")],
  ["legacy record migration", app.includes("initializeDurableRecords")],
  ["managed file upload", app.includes("storeDocumentFile")],
  ["signed document downloads", app.includes("createSignedUrl")],
  ["health endpoint", server.includes('url.pathname === "/api/health"')],
  ["no hardcoded auth-project fallback", auth.includes('supabaseUrl: ""') && auth.includes('supabaseAnonKey: ""')],
  ["company email restriction", login.includes("validateEmailDomain") && login.includes("isAllowedEmail")],
  ["safe redirect validation", login.includes("sanitizeRedirect")],
  ["password recovery flow", login.includes("resetPasswordForEmail") && login.includes("updateUser({ password })")],
  ["failed sign-in preserves existing session", !/Signing in\.\.\."\);\s*await signOutCurrentSession\(\)/.test(login)],
  ["AI feature removed", !index.includes("ai-assistant") && !app.includes("/api/assistant") && !server.includes("/api/assistant")],
  ["Square publish status is honest", app.includes("Published in Square") && !app.includes("Sent to Square</span>")],
  ["Square email fallback", app.includes("Email payment link") && app.includes("Copy payment link")],
  ["Square publish failure is handled", server.includes("Square created the invoice but could not publish it")],
  ["sign-in bypasses bare-root redirect", login.includes('const CRM_ENTRY_URL = "/?v=90"') && server.includes('Location: "/?v=90"')],
  ["JobCrest product branding", index.includes("JobCrest CRM") && !index.includes("Roofline CRM")],
  ["dashboard stages open filtered leads", app.includes('data-dashboard-stage=') && app.includes("leadStageFilter") && app.includes("clear-lead-stage-filter")],
  ["Lead Intake stage filter", index.includes('id="leadStageFilter"') && index.includes("Filter leads by pipeline stage") && app.includes("els.leadStageFilter?.addEventListener")],
  ["one-time sign-in unlock", login.includes("queueSignInUnlock") && index.includes('id="vaultUnlock"') && app.includes("playSignInUnlockTransition")],
  ["critical lead edits confirm cloud save", app.includes("persistCriticalLeadChange") && app.includes("Not saved to the shared CRM")],
  ["audit events update in real time", app.includes(`table: SUPABASE_AUDIT_TABLE`) && schema.includes("alter publication supabase_realtime add table public.crm_audit_events")],
  ["executive database permissions", schema.includes("devon@coastalcrestroofing.com") && schema.includes("public.is_crm_admin()")],
  ["project conversations survive navigation", projectConversations.includes("durableConversationRows.set(row.id, row)") && projectConversations.includes("saveState({ localOnly: true })")],
  ["durable records cannot be rolled back by legacy snapshots", app.includes("durableBusinessStateAuthoritative") && app.includes("Durable per-record rows are authoritative")],
];

let failed = 0;
checks.forEach(([name, passed]) => {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) failed += 1;
});

if (failed) {
  console.error(`\n${failed} go-live check${failed === 1 ? "" : "s"} failed.`);
  process.exit(1);
}

console.log(`\nAll ${checks.length} go-live architecture checks passed.`);
