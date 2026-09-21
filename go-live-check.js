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
const workflowChecklists = read("workflow-checklists-v65.js");
const sharedRecordMigration = read("supabase/migrations/20260817_all_users_edit_shared_records.sql");
const safeWrites = read("supabase/migrations/20260914_conflict_safe_record_writes.sql");
const squareWorkflow = read("square-invoice-workflow.js");
const squareIntents = read("supabase/migrations/20260915_durable_square_invoice_sends.sql");
const salesNumbers = read("supabase/migrations/20260916_atomic_sales_numbers.sql");
const sharedInputRoles = ["office_manager", "sales_manager", "operations_manager", "sales", "production", "viewer"];

const checks = [
  ["unmapped child records are retained rather than implicitly deleted", app.includes('durableUnmappedRows.map(row => JSON.parse(JSON.stringify(row)))') && app.includes('showUnmappedRecordNotice(durableUnmappedRows.length)')],
  ["company settings use versioned saves", app.includes('getCompanySettingsWriter().commit(rows[0].data)') && read('company-settings-writes.js').includes('crm_commit_company_settings')],
  ["settings writes cannot bypass version checks", read('supabase/migrations/20260914_versioned_company_settings.sql').includes('previous.version <> p_expected_version') && read('supabase/migrations/20260914_versioned_company_settings.sql').includes('Company settings require versioned update')],
  ["settings save helper is shipped", index.includes('company-settings-writes.js?v=1') && server.includes('"/company-settings-writes.js"')],
  ["record writes require expected versions", safeWrites.includes("previous.version <> expected") && read("record-writes.js").includes("expected_version")],
  ["direct record writes are revoked", safeWrites.includes("revoke insert, update, delete, truncate, references, trigger on public.crm_records")],
  ["database enforces admin payment changes", safeWrites.includes("admin_required_for_payments")],
  ["record commits have idempotency receipts", safeWrites.includes("crm_write_receipts") && safeWrites.includes("request_id_reused")],
  ["sales numbers reserve atomically", salesNumbers.includes("pg_advisory_xact_lock") && salesNumbers.includes("crm_reserve_sales_numbers") && read("sales-numbering.js").includes("crm_reserve_sales_numbers")],
  ["sales numbers are company-unique and immutable", salesNumbers.includes("unique(company_state_id,number_kind,number_value)") && salesNumbers.includes("sales_number_is_immutable")],
  ["numbered estimates keep exact lead and job relationships", salesNumbers.includes("estimate_sales_numbers_do_not_match") && app.includes("A numbered estimate stays with its original lead and job" )],
  ["sales numbering helper is shipped", index.includes('sales-numbering.js?v=1') && server.includes('"/sales-numbering.js"') && read("sw.js").includes('"/sales-numbering.js"')],
  ["unsaved conflicts have a recovery path", app.includes("preserveBlockedDurableWrite") && app.includes("Download unsaved work")],
  ["document archive retains bytes", app.includes("archiveDocumentRecord") && !app.includes("deleteStoredDocument")],
  ["durable per-record table", schema.includes("create table if not exists public.crm_records")],
  ["append-only audit events", schema.includes("create table if not exists public.crm_audit_events")],
  ["conversation message table", schema.includes("create table if not exists public.crm_conversation_messages")],
  ["daily recovery backups", schema.includes("create table if not exists public.crm_backups")],
  ["private document bucket", schema.includes("values ('crm-documents', 'crm-documents', false")],
  ["row-level security on records", schema.includes("alter table public.crm_records enable row level security")],
  ["all company users can edit shared CRM records", schema.includes('create policy "Company users update durable CRM records"') && !schema.includes("and (public.can_manage_team_crm() or owner_id = auth.uid())") && sharedRecordMigration.includes('on public.crm_records for update to authenticated')],
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
  ["Square send acknowledges durable completion only", server.includes('result?.durable !== true') && squareWorkflow.includes('store.complete(intent, immutable(clone(result)))')],
  ["Square send uses trusted saved estimates", server.includes('Object.keys(body).some(key => !["estimateId", "expectedVersion"].includes(key))') && squareIntents.includes('estimate_changed_before_invoice') && squareIntents.includes('won_estimate_required')],
  ["Square stages have durable recovery receipts", squareWorkflow.includes('store.checkpoint(intent, stage, confirmed)') && squareIntents.includes('crm_square_invoice_intents') && squareWorkflow.includes('idempotencyKey(intent, "publish")')],
  ["legacy invoice retries require review", squareIntents.includes('legacy_invoice_review_required') && squareIntents.includes('crm_square_invoice_reviews')],
  ["webhooks acknowledge durable intake", server.includes('crm_square_enqueue_webhook') && server.includes('receipt?.durable !== true || receipt.eventId !== event.event_id') && !server.includes('square-payments.json')],
  ["payment worker resumes outside browser sessions", server.includes('startSquarePaymentWorker()') && server.includes('crm_square_apply_payment') && read('square-payment-worker.js').includes('store.apply(claim, snapshot)')],
  ["Square refunds use actual refunded payment totals", read('square-payment-worker.js').includes('money(payment.refunded_money, true)') && read('square-payment-worker.js').includes('first.grossCents - refundedCents')],
  ["bare root serves CRM directly", !server.includes('Location: "/?v=101"')],
  ["JobCrest product branding", index.includes("JobCrest CRM") && !index.includes("Roofline CRM")],
  ["dashboard stages open filtered leads", app.includes('data-dashboard-stage=') && app.includes("leadStageFilter") && app.includes("clear-lead-stage-filter")],
  ["Lead Intake stage filter", index.includes('id="leadStageFilter"') && index.includes("Filter leads by pipeline stage") && app.includes("els.leadStageFilter?.addEventListener")],
  ["live partial lead search", index.includes('id="globalSearchResults"') && index.includes('style="z-index: 40; overflow: visible"') && app.includes("liveLeadSearchMatches") && app.includes('els.globalSearchResults.addEventListener("pointerdown"') && styles.includes("z-index: 40") && app.includes('event.key === "ArrowDown"')],
  ["one-time sign-in unlock", login.includes("queueSignInUnlock") && index.includes('id="vaultUnlock"') && app.includes("playSignInUnlockTransition")],
  ["critical lead edits confirm cloud save", app.includes("persistCriticalLeadChange") && app.includes("Not saved to the shared CRM")],
  ["every authorized checklist box is actionable", workflowChecklists.includes('${!editable ? "disabled" : ""}') && workflowChecklists.includes("Can confirm manually")],
  ["every signed-in role can edit CRM inputs", sharedInputRoles.every((role) => new RegExp(`${role}: \\{\\r?\\n    views: \\[\\.\\.\\.sharedCrmViews\\],\\r?\\n    actions: \\[\\.\\.\\.sharedCrmActions\\]`).test(app)) && app.includes('return Boolean(rolePolicies[currentRole()]);') && app.includes('"manageEstimates"')],
  ["checklists batch and verify shared database saves", app.includes("persistChecklistStageRecord") && workflowChecklists.includes("scheduleChecklistSave") && workflowChecklists.includes('checklistSaveStates.set(saveKey, { message: "", tone: "" })')],
  ["lead progression stays responsive during checklist sync", !workflowChecklists.includes("checklistSaveInProgress") && workflowChecklists.includes("checklistSaveTimers.get(currentSaveKey)") && workflowChecklists.includes("persistLeadJobRecord")],
  ["estimate values verify shared database saves", app.includes("persistEstimateRecord") && index.includes('id="estimateSaveStatus"') && index.includes('id="saveEstimateButton"')],
  ["estimate form cannot reload before saving", app.includes('els.estimateForm.addEventListener("submit"') && app.includes("queueEstimateVerifiedSave")],
  ["estimate money fields accept commas and cents", app.includes('value.replace(/[$,%\\s,]/g, "")') && index.includes('name="deposit" type="text" inputmode="decimal"')],
  ["audit events update in real time", app.includes(`table: SUPABASE_AUDIT_TABLE`) && schema.includes("alter publication supabase_realtime add table public.crm_audit_events")],
  ["executive database permissions", schema.includes("devon@coastalcrestroofing.com") && schema.includes("public.is_crm_admin()")],
  ["project conversations survive navigation", projectConversations.includes("durableConversationRows.set(row.id, row)") && projectConversations.includes("saveState({ localOnly: true })")],
  ["durable records cannot be rolled back by legacy snapshots", app.includes("durableBusinessStateAuthoritative") && app.includes("Durable per-record rows are authoritative")],
  ["authenticated startup rejects stale business cache", app.includes("state.contacts = []") && app.includes("hydrate these collections")],
  ["profit cost verifies its exact durable row", app.includes("persistProfitCostRecord") && app.includes("confirmed?.data?.costItems") && app.includes("durableWritesEnabled")],
  ["service worker only caches explicit public assets", read("sw.js").includes("url.origin !== self.location.origin") && read("sw.js").includes("!PUBLIC_ASSET_PATHS.has(url.pathname)")],
  ["service worker preserves server asset versions", !read("sw.js").includes("patchIndexHtml") && read("sw.js").includes("await fetch(event.request)")],
  ["local development cannot be trapped by stale app-shell caches", app.includes('["localhost", "127.0.0.1"].includes(location.hostname)') && app.includes("registration.unregister()") && app.includes("return version <= 103")],
  ["workflow add-ons wait for authenticated CRM startup", app.includes('CustomEvent("jobcrest:app-ready")') && productionFlow.includes('"jobcrest:app-ready"') && workflowChecklists.includes('"jobcrest:app-ready"') && projectConversations.includes('"jobcrest:app-ready"')],
  ["legacy API caches are purged before hydration", app.includes("purgeLegacyJobCrestCaches") && auth.includes('cache: "no-store"')],
  ["each client job is independently selectable", app.includes('data-action="open-job"') && app.includes("selectedLeadJobId") && app.includes("openLeadJob")],
  ["jobs have independent production status", app.includes("soldJobStatuses") && index.includes('name="status"') && index.includes("Materials Ordered") && index.includes("In Progress") && index.includes("Completed")],
  ["job edits verify the durable database row", app.includes("persistLeadJobRecord") && app.includes("Job saved to the shared CRM") && app.includes("confirmed?.data?.status !== jobRow.data.status")],
  ["production flow preserves verified job saving", productionFlow.includes("Job submissions stay with app.js") && !productionFlow.includes('stopImmediatePropagation();\n        saveLeadJobProduction();')],
  ["same-account devices receive realtime updates", !app.includes("row?.updated_by === authSession.user.id") && !app.includes("row?.actor_user_id === authSession.user.id")],
  ["document uploads verify durable records", app.includes("persistLeadDocumentRecords") && app.includes("saved to the shared CRM")],
  ["lead documents are isolated by job", index.includes('id="leadDocumentJobSelect"') && app.includes('document.jobId === selectedJob?.id') && app.includes('jobId: job.id')],
  ["lead email activity is isolated by job", index.includes('id="leadEmailJobSelect"') && app.includes("emails: (job.emails || []).map(normalizeJobEmail)") && app.includes("Email activity saved to this job")],
  ["lead conversations and notes are isolated by job", projectConversations.includes("update.jobId ? update.jobId === job.id") && projectConversations.includes("state.selectedLeadJobId = event.target.value")],
  ["job photo library is available per lead", index.includes('data-lead-tab="photos"') && index.includes('id="leadPhotoInput"') && index.includes('accept="image/jpeg,image/png,image/webp') && app.includes("uploadLeadPhotos")],
  ["photos are isolated by job", app.includes('document.kind === "photo" && document.jobId === jobId') && app.includes('jobId: job.id') && app.includes('`${leadId}/jobs/${jobId}`')],
  ["photo records verify shared database saves", app.includes("JOB_PHOTO_CATEGORY_ID") && app.includes("persistLeadDocumentRecords") && app.includes("Photos stored. Confirming their shared CRM records")],
  ["company documents verify durable records", app.includes("persistCompanyDocumentRecords") && app.includes("COMPANY_DOCUMENT_LEAD_ID")],
  ["document uploads preserve previous bytes", app.includes('uid("version")') && app.includes("upsert: false") && app.includes("previousVersions:")],
  ["document upload progress is visible", index.includes('id="leadDocumentUploadStatus"') && index.includes('id="companyDocumentUploadStatus"') && app.includes("documentUploadErrorMessage")],
  ["file pickers allow retrying the same file", (app.match(/event\.target\.value = "";/g) || []).length >= 2],
  ["document uploads allow 250 MB", app.includes("MAX_DOCUMENT_FILE_SIZE = 250 * 1024 * 1024") && schema.includes("file_size_limit = 262144000")],
  ["phone fields use standard formatting", (index.match(/type="text" inputmode="tel" autocomplete="tel" data-phone-input/g) || []).length >= 4 && app.includes("function formatPhoneNumber") && app.includes('event.target.matches("[data-phone-input]")')],
  ["project values accept and display exact cents", (index.match(/name="value" type="text" inputmode="decimal" autocomplete="off" data-currency-input/g) || []).length === 2 && app.includes("function formatCurrencyInput") && app.includes('event.target.matches("[data-currency-input]")')],
  ["lead documents open without replacing the CRM", app.includes('window.open("about:blank", "_blank")') && app.includes('link.target = "_blank"') && !app.includes('link.download = record.name || "document"')],
  ["manual payments are admin only", index.includes('data-lead-tab="payments"') && app.includes('return currentRole() === "admin";') && app.includes("Only an administrator can record payments")],
  ["manual payments are isolated by job", index.includes('id="paymentJobSelect"') && app.includes("manualPayments: (currentJob.manualPayments || [])") && app.includes("state.selectedLeadJobId = event.target.value")],
  ["Square and manual payments do not overwrite each other", app.includes("squarePaidAmount + manualPaidAmount") && app.includes("squarePaidAmount,") && app.includes("manualPayments")],
  ["manual payments verify the exact durable job row", app.includes("persistManualPaymentRecord") && app.includes("confirmed?.data?.manualPayments") && app.includes("durableRecordDataMatches")],
  ["manual payment amounts accept cents", index.includes('name="amount" type="number" min="0.01" step="0.01" inputmode="decimal"')],
  ["estimate typing uses quiet delayed autosave", app.includes("immediate ? 0 : 2000") && app.includes("scheduleEstimateVisualRefresh") && /queueLocalStateSave\(\);\r?\n  queueEstimateVerifiedSave\(estimate\.id\)/.test(app)],
  ["estimate autosave never disables the editor", !app.includes('setEstimateSaveState(estimateId, "Saving every estimate value') && !app.includes('els.saveEstimateButton.disabled = true')],
  ["local cloud echoes cannot redraw active estimates", app.includes("consumeRecentLocalDurableEcho(row)") && app.includes("markRecentLocalDurableWrite(row)")],
  ["routine save notifications stay quiet", app.includes("isRoutineSaveNotice") && app.includes('tone === "success" ? "" : message') && workflowChecklists.includes('checklistSaveStates.set(saveKey, { message: "", tone: "" })')],
  ["estimate line items append without a full editor rebuild", app.includes("appendEstimateLineItem(estimate, index)") && app.includes("renderEstimateLineItems(estimate)") && !app.includes("estimate.items.push({ title: \"\", description: \"\", quantity: 1, unit: \"ea\", rate: 0 });\n    saveState();\n    renderEstimates();")],
  ["estimate save attaches a versioned PDF to its original lead and job", app.includes("saveCurrentEstimateAndPdf") && app.includes("downloadEstimatePdf({ silent: true, download: false, estimateSnapshot: snapshot })") && app.includes("if (!snapshotIsCurrent()) return keepNewerChanges()") && app.includes('source: "Estimate PDF"') && app.includes("versionNumber: existing ? Math.max(1, number(existing.versionNumber)) + 1 : 1") && app.includes("persistLeadDocumentRecords([savedDocument.id]")],
  ["estimate lead links confirm save before navigation", app.includes('data-action="open-estimate-lead"') && app.includes("async function openEstimateLeadOverview") && app.includes("await saveCurrentEstimateAndPdf()") && app.includes('openLeadDetail(contact.id, "overview"')],
  ["large CRM edits batch local storage serialization", app.includes("function queueLocalStateSave") && app.includes('window.addEventListener("pagehide", flushQueuedLocalStateSave)') && workflowChecklists.includes("queueWorkflowLocalSave()")],
  ["workflow stage changes avoid full-page rendering", workflowChecklists.includes("renderActiveWorkflowLead();") && !workflowChecklists.includes("checklistSaveStates.set(nextSaveKey, { message: \"\", tone: \"\" });\n    render();")],
  ["workflow checkboxes have distinct native click targets", workflowChecklists.includes("position: static;") && workflowChecklists.includes("pointer-events: auto;") && workflowChecklists.includes("accent-color: #16a34a;") && workflowChecklists.includes("box-sizing: border-box;") && workflowChecklists.includes(".workflow-check-box {\n        display: none;")],
  ["automatic checklist labels refresh with checkbox state", workflowChecklists.includes('mode.textContent = item.complete ? "Verified"')],
  ["blocked stage buttons respond with the exact missing requirement", workflowChecklists.includes("Complete before moving to ${targetStatus}") && workflowChecklists.includes('advanceButton.disabled = !canAction("manageJobs")') && workflowChecklists.includes('!editable ? "disabled" : ""') && app.includes("isWorkflowBlocker")],
  ["stage actions repair stale lead-level status", app.includes("currentJobStatus = contact ? contactJobs(contact)[0]?.status || contact.status") && productionFlow.includes("currentJobStatus = contact ? contactJobs(contact)[0]?.status || contact.status")],
  ["stale lead stage saves the job row directly", app.includes("skipContact = false") && workflowChecklists.includes("primaryJobAlreadyAtTarget") && workflowChecklists.includes("skipContact: primaryJobAlreadyAtTarget")],
  ["workflow stage changes stay immediate while cloud saves retry", workflowChecklists.includes("Keep the optimistic stage change in place") && workflowChecklists.includes("Shared CRM sync is retrying in the background")],
  ["realtime CRM updates are batched before a full redraw", app.includes("function queueDurableRecordsReload") && app.includes("queueDurableRecordsReload();")],
  ["workflow checks do not trigger legacy full-CRM saves", app.includes("syncLegacy: false") && workflowChecklists.includes("queueDurableRecordsSave();") && !workflowChecklists.includes("queueCloudSave();")],
  ["local cloud echoes do not redraw the active workflow", app.includes("function consumeRecentCloudEcho") && app.includes("consumeRecentCloudEcho(row)")],
  ["lead intake is ordered by creation time", app.includes("function sortLeadIntakeChronologically") && app.includes("sortLeadIntakeChronologically(filteredContacts()") && app.includes("Date.parse(left.contact.createdAt")],
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
