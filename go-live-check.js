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
const styles = read("styles.css");
const projectConversations = read("project-conversations-v67.js");
const productionFlow = read("production-flow-v64.js");

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
  ["bare root serves CRM directly", !server.includes('Location: "/?v=101"')],
  ["JobCrest product branding", index.includes("JobCrest CRM") && !index.includes("Roofline CRM")],
  ["dashboard stages open filtered leads", app.includes('data-dashboard-stage=') && app.includes("leadStageFilter") && app.includes("clear-lead-stage-filter")],
  ["Lead Intake stage filter", index.includes('id="leadStageFilter"') && index.includes("Filter leads by pipeline stage") && app.includes("els.leadStageFilter?.addEventListener")],
  ["live partial lead search", index.includes('id="globalSearchResults"') && app.includes("liveLeadSearchMatches") && app.includes('els.globalSearchResults.addEventListener("pointerdown"') && styles.includes("z-index: 40") && app.includes('event.key === "ArrowDown"')],
  ["one-time sign-in unlock", login.includes("queueSignInUnlock") && index.includes('id="vaultUnlock"') && app.includes("playSignInUnlockTransition")],
  ["critical lead edits confirm cloud save", app.includes("persistCriticalLeadChange") && app.includes("Not saved to the shared CRM")],
  ["audit events update in real time", app.includes(`table: SUPABASE_AUDIT_TABLE`) && schema.includes("alter publication supabase_realtime add table public.crm_audit_events")],
  ["executive database permissions", schema.includes("devon@coastalcrestroofing.com") && schema.includes("public.is_crm_admin()")],
  ["project conversations survive navigation", projectConversations.includes("durableConversationRows.set(row.id, row)") && projectConversations.includes("saveState({ localOnly: true })")],
  ["durable records cannot be rolled back by legacy snapshots", app.includes("durableBusinessStateAuthoritative") && app.includes("Durable per-record rows are authoritative")],
  ["authenticated startup rejects stale business cache", app.includes("state.contacts = []") && app.includes("hydrate these collections")],
  ["profit cost verifies its exact durable row", app.includes("persistProfitCostRecord") && app.includes("confirmed?.data?.costItems") && app.includes("durableWritesEnabled")],
  ["service worker never caches live APIs", read("sw.js").includes("url.origin !== self.location.origin") && read("sw.js").includes('url.pathname.startsWith("/api/")')],
  ["legacy API caches are purged before hydration", app.includes("purgeLegacyJobCrestCaches") && auth.includes('cache: "no-store"')],
  ["each client job is independently selectable", app.includes('data-action="open-job"') && app.includes("selectedLeadJobId") && app.includes("openLeadJob")],
  ["jobs have independent production status", app.includes("soldJobStatuses") && index.includes('name="status"') && index.includes("Materials Ordered") && index.includes("In Progress") && index.includes("Completed")],
  ["job edits verify the durable database row", app.includes("persistLeadJobRecord") && app.includes("Job saved to the shared CRM") && app.includes("confirmed?.data?.status !== jobRow.data.status")],
  ["production flow preserves verified job saving", productionFlow.includes("Job submissions stay with app.js") && !productionFlow.includes('stopImmediatePropagation();\n        saveLeadJobProduction();')],
  ["same-account devices receive realtime updates", !app.includes("row?.updated_by === authSession.user.id") && !app.includes("row?.actor_user_id === authSession.user.id")],
  ["document uploads verify durable records", app.includes("persistLeadDocumentRecords") && app.includes("saved to the shared CRM")],
  ["company documents verify durable records", app.includes("persistCompanyDocumentRecords") && app.includes("COMPANY_DOCUMENT_LEAD_ID")],
  ["document upload retries are idempotent", app.includes("upsert: true") && app.includes("resource already exists")],
  ["document upload progress is visible", index.includes('id="leadDocumentUploadStatus"') && index.includes('id="companyDocumentUploadStatus"') && app.includes("documentUploadErrorMessage")],
  ["file pickers allow retrying the same file", (app.match(/event\.target\.value = "";/g) || []).length >= 2],
  ["document uploads allow 250 MB", app.includes("MAX_DOCUMENT_FILE_SIZE = 250 * 1024 * 1024") && schema.includes("file_size_limit = 262144000")],
  ["project values accept cents", !index.includes('step="100"') && (index.match(/name="value" type="number" min="0" step="0\.01"/g) || []).length === 2],
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
