async function initializeCloudSync() {
  if (!canUseCloudSync()) return;
  cloudClient = window.RooflineAuth.createClient();
  if (!cloudClient) return;

  const trusted = await window.RooflineAuth.getTrustedUser();
  if (!trusted.user || !window.RooflineAuth.isAllowedUser(trusted.user)) {
    console.info("Supabase sync is waiting for a signed-in company user.");
    return;
  }
  authSession = trusted;
  state.currentUser = currentUserFromAuthSession(trusted);

  applyingCloudState = true;
  const loaded = await reloadCloudState();
  applyingCloudState = false;
  if (!loaded) return;

  cloudReady = true;
  queueCloudSave();
  subscribeToCloudState();
  loadAssignableTeam();
}

function subscribeToCloudState() {
  if (!cloudClient?.channel || cloudSubscription) return;
  cloudSubscription = cloudClient
    .channel(`crm-state-${supabaseStateId()}-${authSession?.user?.id || "user"}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: SUPABASE_CRM_TABLE,
      },
      async (payload) => {
        const row = payload.new || payload.old;
        if (!isRelevantCloudRow(row) || cloudSaveInFlight || consumeRecentCloudEcho(row)) return;
        if (hasPendingDurableChanges()) {
          queueDurableRecordsSave();
          return;
        }
        const applied = await reloadCloudState({ showUpdateToast: false });
        if (applied) render();
      },
    )
    .subscribe();
}

function durableRecordKey(record = {}) {
  return `${record.record_type}:${record.id}`;
}

function durableRecordData(record = {}) {
  const { jobs, documents, updates, dataUrl, downloadUrl, ...data } = record;
  if (record.storagePath) return data;
  return dataUrl ? { ...data, dataUrl } : data;
}

function durableRowsFromState() {
  const companyStateId = supabaseStateId();
  const updatedBy = authSession?.user?.id || null;
  const rows = [];
  state.contacts.forEach((contact) => {
    const ownerId = contactOwnerId(contact) || updatedBy;
    rows.push({
      company_state_id: companyStateId,
      record_type: "contact",
      id: contact.id,
      lead_id: contact.id,
      job_id: null,
      owner_id: ownerId,
      data: durableRecordData(contact),
      updated_by: updatedBy,
      deleted_at: null,
    });
    // Only explicit jobs are durable. contactJobs() intentionally creates a
    // display fallback for old lead-only data; persisting that fallback can
    // race a newly committed real job and create a duplicate project.
    (Array.isArray(contact.jobs) ? contact.jobs : []).forEach((job) => rows.push({
      company_state_id: companyStateId,
      record_type: "job",
      id: job.id,
      lead_id: contact.id,
      job_id: job.id,
      owner_id: job.ownerUserId || ownerId,
      data: durableRecordData(job),
      updated_by: updatedBy,
      deleted_at: null,
    }));
    (contact.documents || []).forEach((document) => rows.push({
      company_state_id: companyStateId,
      record_type: "document",
      id: document.id,
      lead_id: contact.id,
      job_id: document.jobId || null,
      owner_id: ownerId,
      data: durableRecordData(document),
      updated_by: updatedBy,
      deleted_at: null,
    }));
  });
  state.estimates.forEach((estimate) => rows.push({
    company_state_id: companyStateId,
    record_type: "estimate",
    id: estimate.id,
    lead_id: estimate.contactId,
    job_id: estimate.jobId || null,
    owner_id: estimateOwnerId(estimate) || updatedBy,
    data: durableRecordData(estimate),
    updated_by: updatedBy,
    deleted_at: null,
  }));
  state.calendarTasks.forEach((task) => rows.push({
    company_state_id: companyStateId,
    record_type: "task",
    id: task.id,
    lead_id: task.contactId || null,
    job_id: null,
    owner_id: calendarTaskOwnerId(task) || updatedBy,
    data: durableRecordData(task),
    updated_by: updatedBy,
    deleted_at: null,
  }));
  state.companyDocuments.forEach((document) => rows.push({
    company_state_id: companyStateId,
    record_type: "document",
    id: document.id,
    lead_id: COMPANY_DOCUMENT_LEAD_ID,
    job_id: null,
    owner_id: document.ownerUserId || updatedBy,
    data: durableRecordData(document),
    updated_by: updatedBy,
    deleted_at: null,
  }));
  // A missing parent is a data-review issue, never an implicit request to delete
  // the saved child. Keep unmapped rows untouched until a reviewed relationship
  // repair is loaded from the server, even if a local import reuses their IDs.
  const unmappedKeys = new Set(durableUnmappedRows.map(durableRecordKey));
  return preserveStoredPaidStageForNonManagers(preserveImmutableSalesNumbers(preserveReadOnlyPaymentFields([
    ...rows.filter(row => !unmappedKeys.has(durableRecordKey(row))),
    ...durableUnmappedRows.map(row => JSON.parse(JSON.stringify(row))),
  ])));
}

function durableAuditRowsFromState() {
  const actorUserId = authSession?.user?.id || null;
  return state.contacts.flatMap((contact) => (contact.updates || []).map((update) => ({
    id: update.id,
    company_state_id: supabaseStateId(),
    lead_id: contact.id,
    job_id: update.jobId || null,
    event_type: update.status ? "status_change" : "note",
    actor_user_id: actorUserId,
    actor_name: update.author || state.currentUser.name || "CRM User",
    message: update.message || "",
    status: update.status || "",
    metadata: {},
    created_at: update.createdAt || new Date().toISOString(),
  })));
}

function invalidateDurableProjection() {
  durableProjection = null;
  durableProjectionRevision = -1;
}

function durableStateProjection() {
  if (durableProjection && durableProjectionRevision === localEditRevision) return durableProjection;
  const rows = durableRowsFromState();
  const auditRows = durableAuditRowsFromState();
  const rowsByKey = new Map(rows.map((row) => [durableRecordKey(row), row]));
  const fingerprints = new Map(rows.map((row) => [durableRecordKey(row), durableFingerprint(row)]));
  const auditRowsById = new Map(auditRows.map((row) => [row.id, row]));
  durableProjection = {
    rows,
    auditRows,
    rowsByKey,
    fingerprints,
    auditRowsById,
    currentKeys: new Set(rowsByKey.keys()),
  };
  durableProjectionRevision = localEditRevision;
  return durableProjection;
}

function durableProjectedRow(recordType, recordId) {
  return durableStateProjection().rowsByKey.get(`${recordType}:${recordId}`) || null;
}

function durableProjectedAuditRow(updateId) {
  return durableStateProjection().auditRowsById.get(updateId) || null;
}

function durableFingerprint(row) {
  return JSON.stringify({
    lead_id: row.lead_id || null,
    job_id: row.job_id || null,
    owner_id: row.owner_id || null,
    data: row.data,
    deleted_at: row.deleted_at || null,
  });
}

function markRecentLocalDurableWrite(row) {
  if (!row) return;
  recentLocalDurableWrites.set(durableRecordKey(row), {
    fingerprint: durableFingerprint(row),
    expiresAt: Date.now() + 10000,
  });
}

function clearRecentLocalDurableWrite(row) {
  if (!row) return;
  const key = durableRecordKey(row);
  const recent = recentLocalDurableWrites.get(key);
  if (recent?.fingerprint === durableFingerprint(row)) recentLocalDurableWrites.delete(key);
}

function consumeRecentLocalDurableEcho(row) {
  if (!row?.record_type || !row?.id) return false;
  const key = durableRecordKey(row);
  const recent = recentLocalDurableWrites.get(key);
  if (!recent) return false;
  if (recent.expiresAt < Date.now()) {
    recentLocalDurableWrites.delete(key);
    return false;
  }
  if (recent.fingerprint !== durableFingerprint(row)) return false;
  recentLocalDurableWrites.delete(key);
  return true;
}

function hasPendingDurableChanges() {
  if (!durableRecordsReady) return false;
  const projection = typeof durableStateProjection === "function" ? durableStateProjection() : (() => {
    const rows = durableRowsFromState();
    const auditRows = durableAuditRowsFromState();
    return {
      rows,
      auditRows,
      currentKeys: new Set(rows.map(durableRecordKey)),
      fingerprints: new Map(rows.map((row) => [durableRecordKey(row), durableFingerprint(row)])),
    };
  })();
  if (projection.rows.some((row) => durableRecordFingerprints.get(durableRecordKey(row)) !== projection.fingerprints.get(durableRecordKey(row)))) {
    return true;
  }
  if ([...durableRecordFingerprints.keys()].some((key) => !projection.currentKeys.has(key))) return true;
  return projection.auditRows.some((row) => !durableAuditIds.has(row.id));
}

function rememberDurableRows(rows = [], auditRows = []) {
  // The UI normalizes old records with safe display defaults. Fingerprint the
  // normalized state that is actually in memory, while retaining the database
  // rows (and their versions) as the writer's concurrency baseline. Otherwise
  // a newly introduced optional property can make every unchanged record look
  // edited and cause an unnecessary versioned write immediately after loading.
  rows.forEach(row => durableFinancialBaseline.set(durableRecordKey(row), row.data));
  if (typeof invalidateDurableProjection === "function") invalidateDurableProjection();
  const normalizedRows = new Map(durableRowsFromState().map((row) => [durableRecordKey(row), row]));
  // Opening the CRM writes nothing. Every record is fingerprinted as it is
  // shown, so none of them is waiting to be saved just because it was loaded.
  // One correction used to be the exception: a job saved as Paid that is not
  // paid in full was marked here and saved straight after startup. That save
  // could be refused (a rep may not move a job back a stage) and was then
  // retried without end. The corrected stage is still what is shown; it is
  // saved the next time a manager saves that job for any reason (see
  // preserveStoredPaidStageForNonManagers for everyone else).
  durableRecordFingerprints = new Map(rows.filter(row => !row.deleted_at).map((row) => {
    const normalized = normalizedRows.get(durableRecordKey(row));
    return [durableRecordKey(row), durableFingerprint(normalized || row)];
  }));
  durableAuditIds = new Set(auditRows.map((row) => row.id));
  getDurableCommitWriter().remember(rows);
}

// A dropped connection is the most ordinary reason a save cannot be confirmed.
// The save used to be tried once more, at once, and then saving in the tab was
// paused until the page was reloaded: a few seconds without signal on a job
// site was enough. The same request is now sent again after a short wait, or
// as soon as the browser says the connection is back, for several minutes
// before the tab gives up. The database recognises a repeated request by its
// id and answers it once, so sending it again cannot save anything twice.
const SAVE_RETRY_ATTEMPTS = 8;
function waitBeforeSaveRetry(attempt) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const delay = offline ? 60000 : Math.min(1000 * 2 ** Math.max(attempt - 1, 0), 15000);
  return new Promise((resolve) => {
    const finish = () => {
      window.removeEventListener("online", finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, delay);
    window.addEventListener("online", finish);
  });
}

function getDurableCommitWriter() {
  if (!durableCommitWriter) durableCommitWriter = window.CrmRecordWrites.create({
    rpc: (name, payload) => cloudClient.rpc(name, payload),
    requestId: () => crypto.randomUUID(),
    transientRetries: SAVE_RETRY_ATTEMPTS,
    transientRetryWait: waitBeforeSaveRetry,
    // Two people saving the same record: merge instead of pausing this tab.
    baseFor: (row) => mergeReadyRecordData(row, durableFinancialBaseline.get(durableRecordKey(row))),
    fetchCurrent: async (changes) => (await fetchCurrentDurableRows(changes)).map((row) => ({ ...row, data: mergeReadyRecordData(row, row.data) })),
    onMerged: (entries) => applyMergedDurableRows(entries),
    onAcknowledged: (changes, auditIds) => {
      durableChangeCounter += 1;
      changes.forEach(row => {
        if (row.data) durableFinancialBaseline.set(durableRecordKey(row), row.data);
        if (row.operation === "delete") durableRecordFingerprints.delete(durableRecordKey(row));
        else durableRecordFingerprints.set(durableRecordKey(row), durableFingerprint(row));
      });
      auditIds.forEach(id => durableAuditIds.add(id));
      if (typeof invalidateDurableProjection === "function") invalidateDurableProjection();
      // A job or estimate in this save that should have a number gets it now.
      if (typeof queueNumberingAfterSave === "function") queueNumberingAfterSave(changes);
    },
    isExpectedRejection: (error) => Boolean(durableBusinessRuleRejection(error)),
    onRejected: (value) => handleRejectedDurableWrite(value),
    onBlocked: preserveBlockedDurableWrite,
  });
  return durableCommitWriter;
}

async function fetchCurrentDurableRows(changes = []) {
  const ids = [...new Set(changes.map((change) => String(change.id)))];
  if (!ids.length) return [];
  const { data, error } = await cloudClient.from(SUPABASE_RECORDS_TABLE).select("*")
    .eq("company_state_id", supabaseStateId()).in("id", ids);
  if (error || !Array.isArray(data)) throw error || new Error("Current records could not be loaded.");
  const wanted = new Set(changes.map(durableRecordKey));
  return data.filter((row) => wanted.has(durableRecordKey(row)));
}

function sameDurableData(left, right) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

// Records whose last save was combined with a teammate's. What came back for
// them is, rightly, not word for word what this editor sent.
const recentlyMergedDurableKeys = new Set();

function applyMergedDurableRows(entries = []) {
  const conflicted = [];
  entries.forEach(({ key, row, localData, conflicts }) => {
    if (key) recentlyMergedDurableKeys.add(key);
    if (!row) return;
    // What was saved holds the teammate's work as well as this editor's. This
    // editor's copy must take it in, always. It used to be skipped whenever
    // the editor had typed anything since the save was sent; the next save
    // then went out from a copy without the teammate's work and erased it.
    const projected = durableProjectedRow(row.record_type, row.id);
    if (projected) {
      const typedSince = !sameDurableData(projected.data, localData);
      // Typed since: keep those newer edits on top of what was saved. They
      // stay unsaved, and go out with the next save.
      const next = typedSince
        ? window.CrmRecordWrites.mergeRecordData(mergeReadyRecordData(row, localData), mergeReadyRecordData(row, projected.data), mergeReadyRecordData(row, row.data))
        : row.data;
      applyDurableRealtimeRecord({ ...row, data: next }, "UPDATE");
      if (typedSince) {
        // applyDurableRealtimeRecord treats what it is given as saved. Only
        // `row.data` is: put the saved copy back as the baseline, so the
        // newer edits are still seen as waiting to be saved.
        const recordKey = durableRecordKey(row);
        durableFinancialBaseline.set(recordKey, row.data || {});
        durableRecordFingerprints.set(recordKey, durableFingerprint(row));
        getDurableCommitWriter().remember([row]);
        invalidateDurableProjection();
        queueDurableRecordsSave();
      }
      // The estimate that is open shows the combined lines at once, so the
      // rows on screen and the lines in the estimate cannot drift apart.
      if (row.record_type === "estimate" && getSelectedEstimate()?.id === row.id && state.view === "estimates" && !els.estimateForm?.classList.contains("hidden")) {
        renderEstimateLineItemsKeepingFocus(getSelectedEstimate());
        scheduleEstimateVisualRefresh(row.id);
      }
    }
    if (conflicts?.length) conflicted.push(...conflicts);
  });
  if (!entries.length) return;
  const fields = [...new Set(conflicted.map((path) => String(path).split(".").pop()))].slice(0, 3);
  showToast(fields.length
    ? `A teammate edited this record at the same time. Both sets of changes were saved; your value was kept for ${fields.join(", ")}.`
    : "A teammate edited this record at the same time. Both sets of changes were saved.");
}

// Rule violations raised by crm_commit_records. The database rolled the whole
// request back, so the message says what to change instead of blaming the
// connection.
const durableRejectionReasons = {
  record_access_denied: "This record belongs to another rep, so your role cannot change it. Ask a manager to reassign the lead or make the change.",
  record_owner_spoofed: "New records you create must stay assigned to you. Ask a manager to assign the lead to someone else.",
  invalid_stage_transition: "A job can only move forward one stage at a time. Ask a manager to move a job back a stage or reopen a lost job.",
  new_job_must_start_new: "A new job must start in the New stage.",
  workflow_checklist_incomplete: "A job was moved forward before its stage checklist was complete.",
  stage_contact_required: "A job was saved without its lead.",
  full_payment_required: "A job can only be marked Paid after confirmed payments cover the full contract.",
  commit_too_large: "Too many records were saved at once. Import or edit fewer records at a time.",
  sales_number_is_immutable: "A saved lead, project, or estimate number cannot be changed. The original number has been restored.",
  sales_number_not_reserved: "This record needs a valid shared CRM number before it can be saved.",
  estimate_sales_numbers_do_not_match: "The estimate number does not match its saved lead and project. The original numbers have been restored.",
  authentication_required: "Your sign-in has expired or is not approved for the CRM. Sign in again.",
};

function durableRejectionReason(error) {
  const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  const code = Object.keys(durableRejectionReasons).find((name) => text.includes(name));
  return code ? durableRejectionReasons[code] : "";
}

function durableBusinessRuleRejection(error) {
  const text = `${error?.message || ""} ${error?.details || ""} ${error?.hint || ""}`;
  return Object.keys(durableRejectionReasons).find((name) => name !== "authentication_required" && text.includes(name)) || "";
}

// A job saved as Paid that is not paid in full is shown at the stage before
// Paid. Saving that stage is a move backward, which the database allows a
// manager only. For everyone else the stored stage is sent back unchanged, so
// their own edit to the job (a note, an address) is not refused because of a
// stage they never touched. Moving a job to Lost is open to everyone.
function preserveStoredPaidStageForNonManagers(rows) {
  if (canManageTeamData()) return rows;
  for (const row of rows) {
    if (row.record_type !== "job") continue;
    const baseline = durableFinancialBaseline.get(durableRecordKey(row));
    if (baseline?.status === "Paid" && row.data.status !== "Paid" && row.data.status !== "Lost") row.data.status = "Paid";
  }
  return rows;
}

function handleRejectedDurableWrite({ error }) {
  durableRejectionReloadPending = true;
  window.clearTimeout(durableSaveTimer);
  const reason = durableRejectionReason(error) || "That change is not allowed.";
  showToast(`Change not saved. ${reason}`);
  // The commit RPC confirmed that the whole request was rolled back. Restore
  // authoritative rows after the current save finishes instead of pausing the
  // entire CRM or repeatedly retrying the same rejected change.
  window.setTimeout(async () => {
    if (!durableRejectionReloadPending || durableSaveInFlight) return;
    const restored = await reloadDurableRecords({ force: true });
    if (restored !== null) {
      durableRejectionReloadPending = false;
      renderDurableUpdateWhenIdle();
    }
  }, 0);
}

let durableRecoveryStored = false;
let savePausedReloadRequested = false;

// Saving stops in this tab until it reloads, so say so where it cannot be
// missed. A brief toast was the only signal before, and people kept working
// (uploading documents, editing estimates) without anything being saved.
function showSavePausedNotice() {
  if (document.getElementById("crmSavePausedNotice")) return;
  const notice = document.createElement("aside");
  notice.id = "crmSavePausedNotice";
  notice.setAttribute("role", "alert");
  notice.style.cssText = "position:fixed;top:12px;left:16px;right:16px;z-index:100004;background:#fdecea;color:#5b1111;padding:14px 16px;border:2px solid #b42318;border-radius:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;box-shadow:0 8px 24px rgba(0,0,0,.18)";
  const message = document.createElement("span");
  message.style.cssText = "flex:1 1 320px;font-weight:600";
  message.textContent = "Saving is paused in this tab. Your last change could not be confirmed, so nothing else will save until you reload. A recovery copy was kept on this device.";
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload and sync";
  reload.style.cssText = "background:#b42318;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer";
  reload.addEventListener("click", () => {
    savePausedReloadRequested = true;
    window.location.reload();
  });
  notice.append(message, reload);
  document.body.appendChild(notice);
}

// The always-visible answer to "is my work saved?". Changes are saved a moment
// after they are made, and until now the only sign of that was the browser's
// "Leave site?" warning if you tried to leave too soon.
let saveIndicatorPendingSince = 0;
function saveIndicatorStatus(now = Date.now()) {
  if (!canUseCloudSync()) {
    saveIndicatorPendingSince = 0;
    return { tone: "local", label: "Saved on this device", title: "This copy of the CRM is not connected to the shared database." };
  }
  if (durableWriteBlocked || localStateWriteBlocked) {
    return { tone: "error", label: "Saving paused", title: "The last change could not be confirmed. Reload the page to sync before editing again." };
  }
  if (!durableRecordsReady) return { tone: "saving", label: "Loading…", title: "Loading your records." };
  const inFlight = durableSaveInFlight || cloudSaveInFlight;
  const pending = inFlight || hasPendingDurableChanges() || hasPendingCompanyChanges();
  if (!pending) {
    saveIndicatorPendingSince = 0;
    return { tone: "saved", label: "All changes saved", title: "Everything you have entered is saved to the shared CRM." };
  }
  if (!saveIndicatorPendingSince) saveIndicatorPendingSince = now;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { tone: "warning", label: "Offline · not saved yet", title: "You are offline. Your changes are kept on this device and save when the connection returns." };
  }
  if (state.companyFormDraft && !inFlight && !hasPendingDurableChanges()) {
    return { tone: "warning", label: "Unsaved settings", title: "Settings have changes that have not been saved. Open Settings and choose Save." };
  }
  // Normal saves finish in a second or two. Say so when one is taking longer.
  if (now - saveIndicatorPendingSince > 20000) {
    return { tone: "warning", label: "Still saving…", title: "A change has not been confirmed yet. The CRM keeps retrying; keep this page open." };
  }
  return { tone: "saving", label: "Saving…", title: "Your latest change is being saved." };
}

function renderSaveIndicator() {
  const node = els.saveIndicator;
  if (!node) return;
  let status;
  try { status = saveIndicatorStatus(); } catch { return; }
  if (node.dataset.tone === status.tone && node.dataset.label === status.label) return;
  node.dataset.tone = status.tone;
  node.dataset.label = status.label;
  node.title = status.title || "";
  node.textContent = status.label;
}

let saveIndicatorTimer = null;
function startSaveIndicator() {
  renderSaveIndicator();
  if (saveIndicatorTimer) return;
  saveIndicatorTimer = window.setInterval(renderSaveIndicator, 1000);
  window.addEventListener("online", renderSaveIndicator);
  window.addEventListener("offline", renderSaveIndicator);
}

// Recovery copies written when a save was blocked are for manual recovery only.
// Nothing ever removed them, so each one (about half a megabyte) stayed in the
// browser for good. Keep the five newest from the last 30 days.
function pruneBlockedSaveRecoveries(storage, now = Date.now()) {
  try {
    const prefix = "jobcrest-unsaved-recovery:";
    const entries = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      let createdAt = 0;
      try { createdAt = new Date(JSON.parse(storage.getItem(key))?.createdAt || 0).getTime() || 0; } catch { createdAt = 0; }
      entries.push({ key, createdAt });
    }
    entries.sort((a, b) => b.createdAt - a.createdAt);
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    const stale = entries.filter((entry, index) => index >= 5 || entry.createdAt < cutoff);
    stale.forEach((entry) => storage.removeItem(entry.key));
    return stale.length;
  } catch {
    return 0;
  }
}

function preserveBlockedDurableWrite({ error, payload }) {
  durableWriteBlocked = true;
  window.clearTimeout(durableSaveTimer);
  window.clearTimeout(cloudSaveTimer);
  const recoveryKey = `jobcrest-unsaved-recovery:${authSession?.user?.id || "local"}:${payload.p_request_id}`;
  const recovery = { createdAt: new Date().toISOString(), request: payload, state };
  if (typeof recoveryCache !== "undefined" && recoveryCache) {
    recoveryCache.put(recoveryKey, recovery).then(() => { durableRecoveryStored = true; }).catch(() => showDraftStorageWarning());
  } else {
    try { localStorage.setItem(recoveryKey, JSON.stringify(recovery)); durableRecoveryStored = true; } catch { /* Keep the in-memory download available. */ }
  }
  showSavePausedNotice();
  const rejection = durableRejectionReason(error);
  // A refused estimate is not lost: its lines are in the copy kept on this
  // device, and the estimate offers them back after the reload.
  const estimateRefused = Array.isArray(payload?.p_changes) && payload.p_changes.some((change) => change?.record_type === "estimate");
  // PT409 is the database's conflict code; 40001 is the code it used before.
  showToast(["PT409", "40001"].includes(error?.code)
    ? estimateRefused
      ? "Someone else saved this estimate first, so your changes were not saved. Reload the page, open the estimate and choose \"Recover unsaved lines\" to put your lines back."
      : "A newer shared version exists. Reload the page before editing this record again."
    : rejection
      ? `Change not saved. ${rejection}`
      : "Shared saving needs attention. Your recovery copy was kept on this device; reload the page before continuing.");
}

async function commitDurableChanges(rows, auditRows = [], removals = []) {
  if (durableWriteBlocked) return { data: null, error: new Error("Saving is paused in this tab. Reload the page to sync, then try again.") };
  checkpointPendingDraft();
  const result = await getDurableCommitWriter().commit(rows, auditRows, removals);
  // Callers may still hold the in-flight flag; defer cleanup until their
  // completion handlers run, and check CURRENT edits rather than sent data.
  window.setTimeout(checkpointPendingDraft, 0);
  return result;
}

function preserveReadOnlyPaymentFields(rows) {
  if (currentRole() === "admin") return rows;
  // Normalizers add display defaults to old data. Sales edits must retain the
  // original payment fields verbatim, not inadvertently rewrite that history.
  for (const row of rows) {
    if (!["job", "estimate"].includes(row.record_type)) continue;
    const baseline = durableFinancialBaseline.get(durableRecordKey(row)) || {};
    for (const field of protectedPaymentFields) {
      if (Object.prototype.hasOwnProperty.call(baseline, field)) row.data[field] = JSON.parse(JSON.stringify(baseline[field]));
      else delete row.data[field];
    }
  }
  return rows;
}

const immutableSalesNumberFields = {
  contact: ["leadNumber"],
  job: ["projectNumber"],
  estimate: ["estimateNumber", "leadNumber", "projectNumber"],
};

function preserveImmutableSalesNumbers(rows) {
  for (const row of rows) {
    const fields = immutableSalesNumberFields[row.record_type] || [];
    if (!fields.length) continue;
    const baseline = durableFinancialBaseline.get(durableRecordKey(row));
    if (!baseline) continue;
    for (const field of fields) {
      // Number reservations are permanent database identities. A stale tab or
      // display normalizer must never turn an ordinary edit into a renumbering.
      // Only a number that has been assigned is permanent, though. A blank is
      // not a number: treating it as one meant a job first saved without a
      // number could never receive it (the job's own record stayed blank and
      // showed "not numbered" again after a reload). The database applies the
      // same rule: blank to a reserved number is allowed, any later change is not.
      if (Object.prototype.hasOwnProperty.call(baseline, field) && baseline[field]) row.data[field] = baseline[field];
    }
  }
  return rows;
}

function restoreEstimateSalesNumbersFromBaseline(estimate) {
  if (!estimate?.id) return false;
  const baseline = durableFinancialBaseline.get(`estimate:${estimate.id}`);
  if (!baseline) return false;
  let changed = false;
  for (const field of immutableSalesNumberFields.estimate) {
    if (!Object.prototype.hasOwnProperty.call(baseline, field) || estimate[field] === baseline[field]) continue;
    estimate[field] = baseline[field];
    changed = true;
  }
  return changed;
}

// A lead's summary stage follows its first job. Keep that first job the same
// one however the records arrived. The complete load returns jobs in id order
// (oldest first); the first page at startup returns them most recently updated
// first. A lead with two jobs therefore showed one stage at startup and
// another once everything had loaded, and a lead saved as Paid could be marked
// for an automatic "repair" only because its newer, unpaid job came first.
function inStableJobOrder(jobs = []) {
  return [...jobs].sort((a, b) => {
    const left = String(a?.id || "");
    const right = String(b?.id || "");
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

function applyDurableRows(rows = [], auditRows = []) {
  const activeRows = rows.filter((row) => !row.deleted_at);
  const byType = (type) => activeRows.filter((row) => row.record_type === type);
  const activeLeadIds = new Set(byType('contact').map(row => row.id));
  durableUnmappedRows = activeRows.filter(row =>
    (row.record_type === 'job' || (row.record_type === 'document' && row.lead_id !== COMPANY_DOCUMENT_LEAD_ID))
    && !activeLeadIds.has(row.lead_id)
  ).map(row => JSON.parse(JSON.stringify(row)));
  showUnmappedRecordNotice(durableUnmappedRows.length);
  const jobsByLead = new Map();
  const documentsByLead = new Map();
  const updatesByLead = new Map();
  byType("job").forEach((row) => {
    if (!jobsByLead.has(row.lead_id)) jobsByLead.set(row.lead_id, []);
    jobsByLead.get(row.lead_id).push({ ...row.data, id: row.id });
  });
  byType("document").filter((row) => row.lead_id !== COMPANY_DOCUMENT_LEAD_ID).forEach((row) => {
    if (!documentsByLead.has(row.lead_id)) documentsByLead.set(row.lead_id, []);
    documentsByLead.get(row.lead_id).push({ ...row.data, id: row.id, leadId: row.lead_id, jobId: row.job_id || row.data?.jobId || "" });
  });
  auditRows.filter(row => row.event_type !== "record_commit").forEach((row) => {
    if (!updatesByLead.has(row.lead_id)) updatesByLead.set(row.lead_id, []);
    updatesByLead.get(row.lead_id).push({
      id: row.id,
      author: row.actor_name,
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      jobId: row.job_id || "",
    });
  });
  const contacts = byType("contact").map((row) => normalizeContact({
    ...row.data,
    id: row.id,
    ownerUserId: row.owner_id || row.data?.ownerUserId || "",
    jobs: inStableJobOrder(jobsByLead.get(row.id) || []),
    documents: documentsByLead.get(row.id) || [],
    updates: (updatesByLead.get(row.id) || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  }, state.company.documentCategories, { preserveEmptyJobs: true }));
  const estimates = byType("estimate").map((row) => ({ ...row.data, id: row.id, contactId: row.lead_id, jobId: row.job_id || row.data?.jobId || "", ownerUserId: row.owner_id || "" }));
  const calendarTasks = byType("task").map((row) => ({ ...row.data, id: row.id, contactId: row.lead_id || "", ownerUserId: row.owner_id || "" }));
  const companyDocumentRows = byType("document").filter((row) => row.lead_id === COMPANY_DOCUMENT_LEAD_ID);
  const companyDocuments = companyDocumentRows.map((row) => normalizeDocument({
    ...row.data,
    id: row.id,
    ownerUserId: row.owner_id || row.data?.ownerUserId || "",
  }));
  applySharedState({
    contacts,
    estimates,
    calendarTasks,
    companyDocuments,
  });
}

function showUnmappedRecordNotice(count) {
  const existing = document.getElementById('crmUnmappedRecords');
  if (!count) { existing?.remove(); return; }
  if (existing) return;
  const notice = document.createElement('aside');
  notice.id = 'crmUnmappedRecords';
  notice.setAttribute('role', 'alert');
  notice.style.cssText = 'background:#fff4de;color:#34250b;padding:12px;border-bottom:2px solid #b87912';
  notice.textContent = 'Some saved jobs or documents have a missing lead link. They have been retained without changes. An administrator needs to review the links; no files were deleted or assigned to another lead.';
  document.body.prepend(notice);
}

async function fetchCompleteDurableSnapshot() {
  const [rows, auditRows] = await Promise.all([
    fetchAllCompanyRows(SUPABASE_RECORDS_TABLE, ["record_type", "id"], {
      configure(query) { return query.in("record_type", ["contact", "job", "estimate", "task"]); },
    }),
    fetchRecentCompanyRows(SUPABASE_AUDIT_TABLE, 500, (query) => query.neq("event_type", "record_commit")),
  ]);
  return { rows, auditRows };
}

async function fetchDurableRows() {
  if (completeCoreRecordsLoaded) return fetchCompleteDurableSnapshot();
  if (recordPageClient && window.JobCrestRecordPages) {
    try {
      const [supportRows, leadPage, jobPage, auditRows] = await Promise.all([
        fetchAllCompanyRows(SUPABASE_RECORDS_TABLE, ["record_type", "id"], {
          configure(query) { return query.in("record_type", ["estimate", "task"]); },
        }),
        recordPageClient.leads({ limit: 100 }),
        recordPageClient.jobs({ limit: 100 }),
        fetchRecentCompanyRows(SUPABASE_AUDIT_TABLE, 500, (query) => query.neq("event_type", "record_commit")),
      ]);
      serverRecordPages.leads = { ...serverRecordPages.leads, ...leadPage, queryKey: JSON.stringify(["", ""]), error: "" };
      serverRecordPages.jobs = { ...serverRecordPages.jobs, ...jobPage, queryKey: JSON.stringify(["", ""]), error: "" };
      completeCoreRecordsLoaded = false;
      return {
        rows: window.JobCrestRecordPages.uniqueRows([
          ...supportRows,
          ...window.JobCrestRecordPages.rowsFromLeadItems(leadPage.items),
          ...window.JobCrestRecordPages.rowsFromJobItems(jobPage.items),
        ]),
        auditRows,
      };
    } catch (error) {
      // Keep a migration-order-safe fallback for local review and staged
      // rollouts. Once the RPC migration is present, startup never takes this
      // full-record path.
      console.warn("Server pagination is not installed yet; using the compatibility loader", error);
    }
  }
  const { rows, auditRows } = await fetchCompleteDurableSnapshot();
  completeCoreRecordsLoaded = true;
  return { rows, auditRows };
}

function configureRecordPages() {
  if (recordPageClient || !canUseCloudSync() || !cloudClient || !window.JobCrestRecordPages?.create) return Boolean(recordPageClient);
  recordPageClient = window.JobCrestRecordPages.create(cloudClient);
  return true;
}

function serverPageQuery(kind) {
  return { search: state.search || "", status: kind === "leads" ? state.leadStageFilter || "" : "" };
}

function serverPageQueryKey(kind) {
  const query = serverPageQuery(kind);
  return JSON.stringify([query.search.trim().toLowerCase(), query.status]);
}

function normalizeServerLeadItem(item = {}) {
  const row = item.record || {};
  const jobs = Array.isArray(item.jobs) ? item.jobs : [];
  return normalizeContact({
    ...(row.data || {}), id: row.id, ownerUserId: row.owner_id || row.data?.ownerUserId || "",
    jobs: inStableJobOrder(jobs.map((jobRow) => ({ ...(jobRow.data || {}), id: jobRow.id, ownerUserId: jobRow.owner_id || jobRow.data?.ownerUserId || "" }))),
    documents: [], updates: [],
  }, state.company.documentCategories, { preserveEmptyJobs: true });
}

function normalizeServerJobItem(item = {}) {
  const jobRow = item.record || {};
  const contactRow = item.contact || {};
  const contact = normalizeContact({
    ...(contactRow.data || {}), id: contactRow.id || jobRow.lead_id || "",
    ownerUserId: contactRow.owner_id || contactRow.data?.ownerUserId || "",
    jobs: [{ ...(jobRow.data || {}), id: jobRow.id, ownerUserId: jobRow.owner_id || jobRow.data?.ownerUserId || "" }],
    documents: [], updates: [],
  }, state.company.documentCategories);
  const job = contactJobs(contact)[0];
  return { ...job, contactId: contact.id, contactName: contact.name, contactType: contact.type };
}

function adoptServerPageItems(kind, items = []) {
  if (!items.length || !window.JobCrestRecordPages) return;
  const rows = kind === "leads"
    ? window.JobCrestRecordPages.rowsFromLeadItems(items)
    : window.JobCrestRecordPages.rowsFromJobItems(items);
  if (kind === "leads") {
    items.map(normalizeServerLeadItem).forEach((incoming) => {
      const existing = state.contacts.find((contact) => contact.id === incoming.id);
      const merged = existing ? { ...incoming, documents: existing.documents || [], updates: existing.updates || [] } : incoming;
      state.contacts = existing
        ? state.contacts.map((contact) => contact.id === incoming.id ? merged : contact)
        : [...state.contacts, merged];
    });
  } else {
    items.forEach((item) => {
      const incomingJob = normalizeServerJobItem(item);
      const existing = state.contacts.find((contact) => contact.id === incomingJob.contactId);
      if (!existing) {
        const contact = normalizeContact({ ...(item.contact?.data || {}), id: incomingJob.contactId, jobs: [{ ...(item.record?.data || {}), id: incomingJob.id }] }, state.company.documentCategories);
        state.contacts.push(contact);
        return;
      }
      const jobs = contactJobs(existing);
      existing.jobs = jobs.some((job) => job.id === incomingJob.id)
        ? jobs.map((job) => job.id === incomingJob.id ? normalizeJob(incomingJob, existing) : job)
        : [...jobs, normalizeJob(incomingJob, existing)];
    });
  }
  if (durableRecordsReady) rememberAdditionalDurableRows(rows);
  saveState({ localOnly: true });
}

async function loadServerSearchResults(query) {
  if (!recordPageClient || !String(query || "").trim()) return false;
  const sequence = ++serverSearchSequence;
  try {
    const result = await recordPageClient.leads({ limit: 25, search: query, status: "__all__" });
    if (sequence !== serverSearchSequence || String(query) !== String(state.search)) return false;
    adoptServerPageItems("leads", result.items);
    renderLiveSearchResults();
    return true;
  } catch (error) {
    console.warn("Server lead search could not be completed", error);
    return false;
  }
}

async function loadServerRecordPage(kind, { append = false, silent = false } = {}) {
  if (!recordPageClient || !["leads", "jobs"].includes(kind)) return false;
  const page = serverRecordPages[kind];
  if (page.loading) return false;
  const queryKey = serverPageQueryKey(kind);
  const sequence = ++recordPageRequestSequence;
  page.loading = true;
  page.error = "";
  if (!silent) kind === "leads" ? renderLeadsView() : renderJobsView();
  try {
    const result = await recordPageClient[kind]({
      ...serverPageQuery(kind), cursor: append && page.queryKey === queryKey ? page.nextCursor : null,
    });
    if (sequence !== recordPageRequestSequence && queryKey !== serverPageQueryKey(kind)) return false;
    page.items = append && page.queryKey === queryKey ? [...page.items, ...result.items] : result.items;
    page.totalCount = result.totalCount;
    page.hasMore = result.hasMore;
    page.nextCursor = result.nextCursor;
    page.queryKey = queryKey;
    adoptServerPageItems(kind, result.items);
    return true;
  } catch (error) {
    page.error = String(error?.message || "Server page unavailable");
    console.warn(`${kind} server page could not be loaded`, error);
    return false;
  } finally {
    page.loading = false;
    if (!silent && state.view === kind) kind === "leads" ? renderLeadsView() : renderJobsView();
  }
}

async function initializeRecordPages() {
  if (!configureRecordPages()) return false;
  const [leadResult, jobResult] = await Promise.allSettled([
    loadServerRecordPage("leads", { silent: true }),
    loadServerRecordPage("jobs", { silent: true }),
    // The database's own money totals, for the screens to show while the rest
    // of the records load (see moneyTotalsForDisplay). The older dashboard
    // aggregates are no longer fetched: nothing shows them, and their
    // "collected" was only the money on jobs marked Paid.
    refreshServerLedgerTotals(),
  ]);
  return leadResult.status === "fulfilled" || jobResult.status === "fulfilled";
}

function ensureServerRecordPage(kind) {
  if (!recordPageClient) return;
  const page = serverRecordPages[kind];
  if (!page.loading && page.queryKey !== serverPageQueryKey(kind)) void loadServerRecordPage(kind);
}

function invalidateServerRecordPages() {
  Object.values(serverRecordPages).forEach((page) => { page.queryKey = ""; });
  // While records are still loading, the screens may be showing the database's
  // money totals, so bring those up to date. The previous figures stay on
  // screen until the new ones arrive. Once everything is loaded the browser's
  // own ledger is used and there is nothing to ask the database for.
  if (coreRecordsArePartial()) {
    void refreshServerLedgerTotals().then((totals) => {
      if (totals && coreRecordsArePartial()) renderDurableUpdateWhenIdle();
    });
  }
}

async function fetchRecentCompanyRows(table, limit = 500, configure = (query) => query) {
  let query = cloudClient.from(table).select("*").eq("company_state_id", supabaseStateId());
  query = configure(query) || query;
  const { data, error } = await query.order("created_at", { ascending: false }).order("id", { ascending: true }).range(0, Math.max(0, limit - 1));
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Incomplete CRM response; existing data was preserved.");
  return data;
}

function rememberAdditionalDurableRows(rows = [], auditRows = []) {
  rows.forEach((row) => durableFinancialBaseline.set(durableRecordKey(row), row.data || {}));
  invalidateDurableProjection();
  const projection = durableStateProjection();
  rows.forEach((row) => {
    const normalized = projection.rowsByKey.get(durableRecordKey(row));
    if (normalized) durableRecordFingerprints.set(durableRecordKey(row), durableFingerprint(normalized));
  });
  auditRows.forEach((row) => durableAuditIds.add(row.id));
  getDurableCommitWriter().remember(rows);
}

async function loadDurableLeadHeavyRecords(contactId) {
  if (!canUseCloudSync() || !durableRecordsReady || !contactId) return true;
  if (durableHeavyLeadLoads.has(contactId)) return durableHeavyLeadLoads.get(contactId);
  const request = (async () => {
    try {
      const [documentRows, auditRows] = await Promise.all([
        fetchAllCompanyRows(SUPABASE_RECORDS_TABLE, ["record_type", "id"], {
          configure(query) { return query.eq("record_type", "document").eq("lead_id", contactId); },
        }),
        fetchAllCompanyRows(SUPABASE_AUDIT_TABLE, ["created_at", "id"], {
          configure(query) { return query.eq("lead_id", contactId).neq("event_type", "record_commit"); },
        }),
      ]);
      const contact = state.contacts.find((item) => item.id === contactId);
      if (!contact) return false;
      contact.documents = documentRows.map((row) => normalizeDocument(
        { ...row.data, id: row.id, jobId: row.job_id || row.data?.jobId || "" },
        { leadId: contactId, categoryId: row.data?.categoryId || "", categories: state.company.documentCategories },
      ));
      contact.updates = auditRows.map((row) => ({
        id: row.id,
        author: row.actor_name,
        message: row.message,
        status: row.status,
        createdAt: row.created_at,
        jobId: row.job_id || "",
      })).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      rememberAdditionalDurableRows(documentRows, auditRows);
      saveState({ localOnly: true });
      if (state.selectedContactId === contactId) renderLeadDetail();
      return true;
    } catch (error) {
      durableHeavyLeadLoads.delete(contactId);
      console.warn("Lead documents and activity could not be loaded", error);
      return false;
    }
  })();
  durableHeavyLeadLoads.set(contactId, request);
  return request;
}

async function loadDurableCompanyDocuments() {
  if (!canUseCloudSync() || !durableRecordsReady) return true;
  if (durableCompanyDocumentsLoad) return durableCompanyDocumentsLoad;
  durableCompanyDocumentsLoad = (async () => {
    try {
      const rows = await fetchAllCompanyRows(SUPABASE_RECORDS_TABLE, ["record_type", "id"], {
        configure(query) { return query.eq("record_type", "document").eq("lead_id", COMPANY_DOCUMENT_LEAD_ID); },
      });
      state.companyDocuments = rows.map((row) => normalizeDocument({ ...row.data, id: row.id, ownerUserId: row.owner_id || row.data?.ownerUserId || "" }));
      rememberAdditionalDurableRows(rows);
      saveState({ localOnly: true });
      if (state.view === "companyDocuments") renderCompanyDocuments();
      return true;
    } catch (error) {
      durableCompanyDocumentsLoad = null;
      console.warn("Company documents could not be loaded", error);
      return false;
    }
  })();
  return durableCompanyDocumentsLoad;
}

async function fetchAllCompanyRows(table, orderColumns = ["id"], { configure = (query) => query } = {}) {
  const rows = [];
  const seen = new Set();
  let pageStart = 0;
  while (true) {
    let query = cloudClient.from(table).select("*").eq("company_state_id", supabaseStateId());
    query = configure(query) || query;
    for (const column of orderColumns) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(pageStart, pageStart + 499);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Incomplete CRM response; existing data was preserved.");
    if (!data.length) break;
    for (const row of data) {
      const key = JSON.stringify(orderColumns.map((column) => row[column]));
      if (seen.has(key)) throw new Error("CRM page overlap detected; existing data was preserved.");
      seen.add(key);
      rows.push(row);
    }
    pageStart += data.length;
  }
  return rows;
}

async function ensureCompleteCoreRecordsLoaded() {
  if (completeCoreRecordsLoaded || !canUseCloudSync()) return true;
  if (completeCoreRecordsLoad) return completeCoreRecordsLoad;
  completeCoreRecordsLoad = (async () => {
    if (durableSaveInFlight || hasPendingDurableChanges()) {
      if (!(await settleDurableWritesBeforeTrustedMutation())) return false;
    }
    const revision = localEditRevision;
    const counter = durableChangeCounter;
    const { rows, auditRows } = await fetchCompleteDurableSnapshot();
    // Not applied if anything here moved on while it was being read; the
    // load is tried again shortly.
    if (revision !== localEditRevision || counter !== durableChangeCounter || durableSaveInFlight || hasPendingDurableChanges()) return false;
    applyingCloudState = true;
    applyDurableRows(rows, auditRows);
    rememberDurableRows(rows, auditRows);
    applyingCloudState = false;
    completeCoreRecordsLoaded = true;
    completeCoreRecordsAttempts = 0;
    saveState({ localOnly: true });
    // Never redraw over a field the user is typing in.
    renderDurableUpdateWhenIdle();
    // A record in the complete set that needs an automatic correction has
    // just been marked for one. The save queued at startup has usually run by
    // now, so start one: otherwise the correction waited for the user's next
    // edit and the save indicator sat on "Still saving…".
    if (hasPendingDurableChanges()) queueDurableRecordsSave();
    // Every record is in: check this browser's money totals against the
    // database's, so the database's can be trusted for an early answer next time.
    serverLedgerCheckAttempts = 0;
    scheduleServerLedgerCheck();
    return true;
  })().then((loaded) => {
    // The load is skipped while a save is in flight. Try again shortly rather
    // than leaving every total on this screen computed from a partial set.
    if (!loaded) scheduleCompleteCoreRecordsRetry();
    return loaded;
  }).catch((error) => {
    applyingCloudState = false;
    console.warn("The complete CRM workspace could not be loaded", error);
    scheduleCompleteCoreRecordsRetry();
    return false;
  }).finally(() => { completeCoreRecordsLoad = null; });
  return completeCoreRecordsLoad;
}

// A brief outage is covered by a few quick tries. After those the load used to
// be given up for the rest of the session, which left totals missing (or, on
// two screens, replaced by differently-computed ones) until the page was
// reloaded. It is now retried for as long as the session lasts, at a slower
// pace, and at once when the connection or the tab comes back.
const COMPLETE_LOAD_QUICK_ATTEMPTS = 8;
function scheduleCompleteCoreRecordsRetry() {
  if (completeCoreRecordsLoaded || completeCoreRecordsRetryTimer) return true;
  completeCoreRecordsAttempts += 1;
  const stalled = completeCoreRecordsAttempts >= COMPLETE_LOAD_QUICK_ATTEMPTS;
  if (completeCoreRecordsAttempts === COMPLETE_LOAD_QUICK_ATTEMPTS) {
    // Say so once, and let the open screen switch its notice to "not loaded yet".
    showToast("The full list of leads and jobs has not loaded yet. Totals stay hidden until it does. The CRM keeps trying.");
    renderDurableUpdateWhenIdle();
  }
  completeCoreRecordsRetryTimer = window.setTimeout(() => {
    completeCoreRecordsRetryTimer = null;
    void ensureCompleteCoreRecordsLoaded();
  }, stalled ? 30000 : Math.min(2000 * completeCoreRecordsAttempts, 10000));
  return true;
}

// Try now instead of waiting for the next timed attempt.
function retryCompleteCoreRecordsNow() {
  if (!coreRecordsArePartial()) return Promise.resolve(true);
  window.clearTimeout(completeCoreRecordsRetryTimer);
  completeCoreRecordsRetryTimer = null;
  return ensureCompleteCoreRecordsLoaded();
}

// Coming back online, or back to the tab, is when a stalled load is most likely
// to work.
function watchForCompleteLoadRetry() {
  window.addEventListener("online", () => { void retryCompleteCoreRecordsNow(); retryWaitingEstimatePdfFilings(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && companyTotalsState() === "stalled") void retryCompleteCoreRecordsNow();
  });
}

// True while only the first page of leads and jobs is in memory. A
// company-wide total computed from that partial set is simply wrong (it made
// the dashboard, billing and report figures change from one visit to the
// next), so screens that show totals wait for the complete set.
function coreRecordsArePartial() {
  return canUseCloudSync() && !completeCoreRecordsLoaded;
}

// One answer for every screen that shows a company-wide figure:
//   "ready"   every lead and job is in memory, so the figures can be shown;
//   "loading" the rest is still being fetched;
//   "stalled" several tries have failed; it is still being retried, more slowly.
// The Dashboard, Billing and Reports all go by this, so at any moment they
// either all show the same figures or all show none.
function companyTotalsState() {
  if (!coreRecordsArePartial()) return "ready";
  return completeCoreRecordsAttempts >= COMPLETE_LOAD_QUICK_ATTEMPTS ? "stalled" : "loading";
}

// The words shown in place of a figure that is not available yet.
function companyTotalsCaption() {
  return companyTotalsState() === "stalled" ? "Not loaded yet · still trying" : "Loading all records";
}

function viewNeedsCompleteCoreRecords(view) {
  return ["contacts", "pipeline", "projects", "estimates", "reviews", "reports", "dashboard", "invoices", "calendar"].includes(view);
}

// Shown at the top of a screen whose totals are not available yet.
function renderPartialDataNotice(view) {
  const host = els.views?.[view];
  if (!host?.querySelector) return;
  const existing = host.querySelector(":scope > .partial-data-notice");
  const totals = companyTotalsState();
  const needed = totals !== "ready" && viewNeedsCompleteCoreRecords(view);
  if (!needed) { existing?.remove(); return; }
  if (existing?.dataset.state === totals) return;
  const notice = existing || document.createElement("div");
  notice.className = "partial-data-notice";
  notice.dataset.state = totals;
  notice.setAttribute("role", "status");
  if (totals === "stalled") {
    notice.textContent = "Not every lead and job has loaded yet, so totals on this page are hidden rather than shown short. The CRM keeps trying. ";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Try again now";
    retry.addEventListener("click", () => {
      retry.disabled = true;
      retry.textContent = "Trying…";
      void retryCompleteCoreRecordsNow().finally(() => {
        // Loaded: the screen redraws and this notice goes. Not loaded: offer the button again.
        notice.dataset.state = "";
        renderPartialDataNotice(state.view);
      });
    });
    notice.append(retry);
  } else {
    notice.textContent = "Loading all records. Totals on this page appear once every lead and job has loaded.";
  }
  if (!existing) host.prepend(notice);
}

async function reloadDurableRecords({ showUpdateToast = false, allowInFlight = false, force = false } = {}) {
  if (durableWriteBlocked) return null;
  try {
    const revision = localEditRevision;
    if (!force && ((!allowInFlight && durableSaveInFlight) || hasPendingDurableChanges())) return null;
    let rows;
    let auditRows;
    for (let attempt = 0; ; attempt += 1) {
      const counter = durableChangeCounter;
      ({ rows, auditRows } = await fetchDurableRows());
      if (counter === durableChangeCounter) break;
      // Something was saved here, or arrived from someone else, while the
      // records were being read. What was read may be older than what is on
      // screen: applying it would undo that change here and put back its old
      // version number. A forced refresh reads again; any other is put off.
      if (force && attempt < 3) continue;
      if (force) break;
      queueDurableRecordsReload({ showUpdateToast: false });
      return null;
    }
    if (durableWriteBlocked || (!force && (revision !== localEditRevision || (!allowInFlight && durableSaveInFlight) || hasPendingDurableChanges()))) {
      // Do not advance fingerprints for a response we did not apply.
      queueDurableRecordsReload({ showUpdateToast: false });
      return null;
    }
    applyingCloudState = true;
    if (typeof durableHeavyLeadLoads !== "undefined") durableHeavyLeadLoads.clear();
    if (typeof durableCompanyDocumentsLoad !== "undefined") durableCompanyDocumentsLoad = null;
    applyDurableRows(rows, auditRows);
    rememberDurableRows(rows, auditRows);
    applyingCloudState = false;
    saveState({ localOnly: true });
    if (typeof invalidateServerRecordPages === "function") invalidateServerRecordPages();
    return rows;
  } catch (error) {
    applyingCloudState = false;
    console.warn("Durable CRM records are not ready. Run the latest Supabase schema.", error);
    return null;
  }
}

function queueDurableRecordsSave() {
  if (durableWriteBlocked || durableRejectionReloadPending) return;
  if (!durableWritesEnabled || !durableRecordsReady || !cloudClient || !authSession?.user?.id) return;
  window.clearTimeout(durableSaveTimer);
  durableSaveTimer = window.setTimeout(flushDurableRecordsSave, CLOUD_SAVE_DELAY);
}

function queueDurableRecordsReload({ showUpdateToast = true } = {}) {
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) return;
  if (durableSaveInFlight || hasPendingDurableChanges()) {
    queueDurableRecordsSave();
    return;
  }
  window.clearTimeout(durableReloadTimer);
  durableReloadTimer = window.setTimeout(async () => {
    durableReloadTimer = null;
    if (durableSaveInFlight || hasPendingDurableChanges()) {
      queueDurableRecordsSave();
      return;
    }
    if (durableReloadInFlight) {
      durableReloadQueued = true;
      return;
    }
    durableReloadInFlight = true;
    try {
      const appliedRows = await reloadDurableRecords({ showUpdateToast });
      if (appliedRows !== null) renderDurableUpdateWhenIdle();
    } finally {
      durableReloadInFlight = false;
      if (durableReloadQueued) {
        durableReloadQueued = false;
        queueDurableRecordsReload({ showUpdateToast: false });
      }
    }
  }, 500);
}

function activeTextEditor() {
  const element = document.activeElement;
  if (!element) return null;
  if (element.matches?.("textarea, select, [contenteditable='true']")) return element;
  if (!element.matches?.("input")) return null;
  return ["button", "checkbox", "file", "hidden", "radio", "reset", "submit"].includes(element.type)
    ? null
    : element;
}

function renderDurableUpdateWhenIdle() {
  if (activeTextEditor()) {
    pendingDurableRender = true;
    return false;
  }
  pendingDurableRender = false;
  render();
  return true;
}

async function flushDurableRecordsSave() {
  if (durableWriteBlocked) return false;
  if (!durableRecordsReady || durableSaveInFlight || !authSession?.user?.id) return false;
  const projection = typeof durableStateProjection === "function" ? durableStateProjection() : (() => {
    const rows = durableRowsFromState();
    const auditRows = durableAuditRowsFromState();
    return {
      rows,
      auditRows,
      currentKeys: new Set(rows.map(durableRecordKey)),
      fingerprints: new Map(rows.map((row) => [durableRecordKey(row), durableFingerprint(row)])),
    };
  })();
  const rows = projection.rows;
  const currentKeys = projection.currentKeys;
  const changedRows = rows.filter((row) => durableRecordFingerprints.get(durableRecordKey(row)) !== projection.fingerprints.get(durableRecordKey(row)));
  const removedByType = new Map();
  durableRecordFingerprints.forEach((_value, key) => {
    if (currentKeys.has(key)) return;
    const separator = key.indexOf(":");
    const type = key.slice(0, separator);
    const id = key.slice(separator + 1);
    if (!removedByType.has(type)) removedByType.set(type, []);
    removedByType.get(type).push(id);
  });
  const auditRows = projection.auditRows;
  const newAuditRows = auditRows.filter((row) => !durableAuditIds.has(row.id));
  if (!changedRows.length && !removedByType.size && !newAuditRows.length) return true;

  durableSaveInFlight = true;
  try {
    // crm_commit_records refuses more than 1000 rows or 2000 audit events per
    // request (commit_too_large), so large imports save in batches. Rows not
    // sent yet still differ from their fingerprints and go in the next save.
    const maxRows = 400;
    const removals = [...removedByType].flatMap(([record_type, ids]) => ids.map(id => ({ company_state_id: supabaseStateId(), record_type, id })));
    const batchRows = changedRows.slice(0, maxRows);
    const batchRemovals = removals.slice(0, maxRows - batchRows.length);
    const batchAuditRows = newAuditRows.slice(0, maxRows * 2);
    batchRows.forEach(markRecentLocalDurableWrite);
    const { error } = await commitDurableChanges(batchRows, batchAuditRows, batchRemovals);
    if (error) { batchRows.forEach(clearRecentLocalDurableWrite); throw error; }
    if (typeof invalidateServerRecordPages === "function") invalidateServerRecordPages();
    return true;
  } catch (error) {
    console.warn("Durable CRM record sync failed", error);
    return false;
  } finally {
    durableSaveInFlight = false;
    // Includes removals made while this request was in flight, not only updates.
    if (!durableRejectionReloadPending && hasPendingDurableChanges()) queueDurableRecordsSave();
  }
}

function setSaveState(element, message, tone = "", options = {}) {
  if (!element) return;
  const visibleMessage = tone === "success" && !options.showSuccess ? "" : message;
  element.textContent = visibleMessage;
  element.dataset.tone = visibleMessage ? tone : "";
}

async function waitForDurableSaveSlot() {
  const startedAt = Date.now();
  while (durableSaveInFlight && Date.now() - startedAt < 10000) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return !durableSaveInFlight;
}

async function settleDurableWritesBeforeTrustedMutation() {
  if (!canUseCloudSync()) return true;
  if (!(await waitForDurableSaveSlot()) || durableWriteBlocked) return false;
  window.clearTimeout(durableSaveTimer);
  if (hasPendingDurableChanges() && !(await flushDurableRecordsSave())) return false;
  return (await waitForDurableSaveSlot()) && !durableWriteBlocked && !hasPendingDurableChanges();
}

async function persistCriticalLeadChange({ statusElement, button, successMessage }) {
  if (criticalSaveInFlight) {
    setSaveState(statusElement, "Another save is finishing. Please try again in a moment.", "error");
    return false;
  }

  criticalSaveInFlight = true;
  if (button) button.disabled = true;
  setSaveState(statusElement, "Saving securely to the shared CRM...", "saving");
  saveState({ localOnly: true });
  window.clearTimeout(durableSaveTimer);

  try {
    if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) {
      if (!canUseCloudSync()) {
        setSaveState(statusElement, `${successMessage} on this device.`, "success");
        return true;
      }
      throw new Error("Shared cloud storage is not connected");
    }
    if (!(await waitForDurableSaveSlot())) throw new Error("The prior cloud save did not finish");
    const saved = await flushDurableRecordsSave();
    if (!saved) throw new Error("The cloud rejected the record update");

    queueCloudSave();
    setSaveState(statusElement, `${successMessage} to the shared CRM.`, "success");
    return true;
  } catch (error) {
    console.warn("Critical lead change could not be confirmed", error);
    setSaveState(statusElement, "Not saved to the shared CRM. Keep this page open and try again.", "error");
    showToast("Save failed—your entry is still on this page, but it is not in the shared CRM yet.");
    return false;
  } finally {
    criticalSaveInFlight = false;
    if (button) button.disabled = false;
  }
}

async function persistProfitCostRecord(jobId, costId, updateId) {
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) return false;
  if (!(await waitForDurableSaveSlot())) return false;
  if (typeof invalidateDurableProjection === "function") invalidateDurableProjection();
  const jobRow = typeof durableProjectedRow === "function" ? durableProjectedRow("job", jobId) : durableRowsFromState().find((row) => row.record_type === "job" && row.id === jobId);
  const auditRow = typeof durableProjectedAuditRow === "function" ? durableProjectedAuditRow(updateId) : durableAuditRowsFromState().find((row) => row.id === updateId);
  if (!jobRow) return false;

  const { data: commitResult, error: writeError } = await commitDurableChanges([jobRow], auditRow ? [auditRow] : []);
  if (writeError) throw writeError;

  const confirmed = commitResult.rows.find(saved => saved.record_type === "job" && saved.id === jobId);
  if (!(confirmed?.data?.costItems || []).some((item) => item.id === costId)) return false;
  // The writer acknowledged its detached request, never this still-editable row.
  return true;
}

async function persistManualPaymentRecord(jobId, paymentId, shouldExist, updateId) {
  if (!canUseCloudSync()) return true;
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) return false;
  if (!(await waitForDurableSaveSlot())) return false;
  if (typeof invalidateDurableProjection === "function") invalidateDurableProjection();
  const jobRow = typeof durableProjectedRow === "function" ? durableProjectedRow("job", jobId) : durableRowsFromState().find((row) => row.record_type === "job" && row.id === jobId);
  const auditRow = typeof durableProjectedAuditRow === "function" ? durableProjectedAuditRow(updateId) : durableAuditRowsFromState().find((row) => row.id === updateId);
  if (!jobRow) return false;

  const expectedData = JSON.parse(JSON.stringify(jobRow.data));
  durableSaveInFlight = true;
  try {
    const { data: commitResult, error: writeError } = await commitDurableChanges([jobRow], auditRow ? [auditRow] : []);
    if (writeError) throw writeError;

    const confirmed = commitResult.rows.find(saved => saved.record_type === "job" && saved.id === jobId);
    const exists = (confirmed?.data?.manualPayments || []).some((payment) => payment.id === paymentId);
    if (exists !== shouldExist) return false;
    if (!durableRecordDataMatches(confirmed?.data || {}, expectedData)) return false;
    queueCloudSave();
    return true;
  } finally {
    durableSaveInFlight = false;
    queueDurableRecordsSave();
  }
}

async function persistLeadJobRecord(jobId, updateId, { skipContact = false } = {}) {
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) return false;
  if (!(await waitForDurableSaveSlot())) return false;
  if (typeof invalidateDurableProjection === "function") invalidateDurableProjection();
  const durableRows = typeof durableStateProjection === "function" ? durableStateProjection().rows : durableRowsFromState();
  const projection = {
    rowsByKey: new Map(durableRows.map((row) => [`${row.record_type}:${row.id}`, row])),
    auditRowsById: new Map(durableAuditRowsFromState().map((row) => [row.id, row])),
  };
  const jobRow = projection.rowsByKey.get(`job:${jobId}`);
  const auditRow = projection.auditRowsById.get(updateId);
  if (!jobRow) return false;
  const contactRow = projection.rowsByKey.get(`contact:${jobRow.lead_id}`);
  const rowsToWrite = contactRow && !skipContact ? [contactRow, jobRow] : [jobRow];

  durableSaveInFlight = true;
  try {
    rowsToWrite.forEach(markRecentLocalDurableWrite);
    const { data: commitResult, error: writeError } = await commitDurableChanges(rowsToWrite, auditRow ? [auditRow] : []);
    if (writeError) throw writeError;

    const confirmed = commitResult.rows.find(saved => saved.record_type === "job" && saved.id === jobId);
    if (confirmed?.data?.status !== jobRow.data.status) return false;
    // Only getDurableCommitWriter.onAcknowledged advances confirmed fingerprints.
    return true;
  } catch (error) {
    rowsToWrite.forEach(clearRecentLocalDurableWrite);
    throw error;
  } finally {
    durableSaveInFlight = false;
    queueDurableRecordsSave();
  }
}

function canonicalRecordValue(value) {
  if (Array.isArray(value)) return value.map(canonicalRecordValue);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalRecordValue(value[key]);
        return result;
      }, {});
  }
  return value;
}

function durableRecordDataMatches(left, right) {
  return JSON.stringify(canonicalRecordValue(left)) === JSON.stringify(canonicalRecordValue(right));
}

async function persistDurableRecordNow(recordType, recordId, verify, { syncLegacy = true } = {}) {
  if (!canUseCloudSync()) return flushQueuedLocalStateSave();
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) return false;

  window.clearTimeout(durableSaveTimer);
  if (!(await waitForDurableSaveSlot())) return false;
  if (typeof invalidateDurableProjection === "function") invalidateDurableProjection();
  const row = typeof durableProjectedRow === "function" ? durableProjectedRow(recordType, recordId) : durableRowsFromState().find((candidate) => candidate.record_type === recordType && candidate.id === recordId);
  if (!row) return false;

  const expectedData = JSON.parse(JSON.stringify(row.data));
  const mergeKey = `${recordType}:${recordId}`;
  if (typeof recentlyMergedDurableKeys !== "undefined") recentlyMergedDurableKeys.delete(mergeKey);
  durableSaveInFlight = true;
  try {
    markRecentLocalDurableWrite(row);
    const { data: commitResult, error: writeError } = await commitDurableChanges([row]);
    if (writeError) {
      clearRecentLocalDurableWrite(row);
      throw writeError;
    }

    const confirmed = commitResult.rows.find(saved => saved.record_type === recordType && saved.id === recordId);
    // A save that was combined with a teammate's is saved: what came back
    // holds both people's work, so it is not what this editor sent. It used
    // to be reported as "Not saved", although it was.
    const combined = typeof recentlyMergedDurableKeys !== "undefined" && recentlyMergedDurableKeys.delete(mergeKey);
    if (!combined && !verify(confirmed?.data || {}, expectedData)) return false;

    // Later nested edits must remain dirty until a subsequent acknowledgement.
    if (syncLegacy) queueCloudSave();
    return true;
  } catch (error) {
    console.warn(`${recordType} record could not be verified in the shared CRM`, error);
    return false;
  } finally {
    durableSaveInFlight = false;
    queueDurableRecordsSave();
  }
}

async function persistChecklistRecord(contactId, jobId, stage, itemId, expectedValue) {
  return persistDurableRecordNow("contact", contactId, (confirmedData) =>
    confirmedData?.workflowChecklists?.[jobId]?.[stage]?.[itemId] === Boolean(expectedValue),
    { syncLegacy: false },
  );
}

async function persistChecklistStageRecord(contactId, jobId, stage, expectedStageData = {}) {
  return persistDurableRecordNow("contact", contactId, (confirmedData) => {
    const confirmedStage = confirmedData?.workflowChecklists?.[jobId]?.[stage] || {};
    return Object.entries(expectedStageData).every(
      ([itemId, expectedValue]) => confirmedStage[itemId] === Boolean(expectedValue),
    );
  }, { syncLegacy: false });
}

async function persistEstimateRecord(estimateId) {
  return persistDurableRecordNow("estimate", estimateId, (confirmedData, expectedData) =>
    durableRecordDataMatches(confirmedData, expectedData),
    { syncLegacy: false },
  );
}

async function persistLeadDocumentRecords(documentIds, updateId) {
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) return false;
  if (!(await waitForDurableSaveSlot())) return false;
  const wantedIds = new Set(documentIds);
  if (typeof invalidateDurableProjection === "function") invalidateDurableProjection();
  const durableRows = typeof durableStateProjection === "function" ? durableStateProjection().rows : durableRowsFromState();
  const projection = {
    rowsByKey: new Map(durableRows.map((row) => [`${row.record_type}:${row.id}`, row])),
    auditRowsById: new Map(durableAuditRowsFromState().map((row) => [row.id, row])),
  };
  const documentRows = [...wantedIds].map((id) => projection.rowsByKey.get(`document:${id}`)).filter(Boolean);
  const auditRow = projection.auditRowsById.get(updateId);
  if (documentRows.length !== wantedIds.size) return false;

  durableSaveInFlight = true;
  documentRows.forEach(markRecentLocalDurableWrite);
  try {
    const { data: commitResult, error: writeError } = await commitDurableChanges(documentRows, auditRow ? [auditRow] : []);
    if (writeError) {
      documentRows.forEach(clearRecentLocalDurableWrite);
      throw writeError;
    }

    const confirmed = commitResult.rows;
    if (new Set((confirmed || []).map((row) => row.id)).size !== wantedIds.size) return false;
    // A file is saved only when its record came back under the lead and job it
    // was sent to. A record filed anywhere else is not a saved file.
    const sent = new Map(documentRows.map((row) => [row.id, row]));
    if (!confirmed.every((row) => sent.has(row.id) && row.lead_id === sent.get(row.id).lead_id && (row.job_id || null) === (sent.get(row.id).job_id || null))) return false;
    // Preserve the writer's immutable acknowledgement when uploads overlap edits.
    return true;
  } finally {
    durableSaveInFlight = false;
    queueDurableRecordsSave();
  }
}

async function persistCompanyDocumentRecords(documentIds) {
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) return false;
  if (!(await waitForDurableSaveSlot())) return false;
  const wantedIds = new Set(documentIds);
  if (typeof invalidateDurableProjection === "function") invalidateDurableProjection();
  const durableRows = typeof durableStateProjection === "function" ? durableStateProjection().rows : durableRowsFromState();
  const projection = { rowsByKey: new Map(durableRows.map((row) => [`${row.record_type}:${row.id}`, row])) };
  const documentRows = [...wantedIds]
    .map((id) => projection.rowsByKey.get(`document:${id}`))
    .filter((row) => row?.lead_id === COMPANY_DOCUMENT_LEAD_ID);
  if (documentRows.length !== wantedIds.size) return false;

  window.clearTimeout(durableSaveTimer);
  durableSaveInFlight = true;
  documentRows.forEach(markRecentLocalDurableWrite);
  try {
    const { data: commitResult, error: writeError } = await commitDurableChanges(documentRows);
    if (writeError) {
      documentRows.forEach(clearRecentLocalDurableWrite);
      throw writeError;
    }
    const confirmed = commitResult.rows;
    if (new Set((confirmed || []).map((row) => row.id)).size !== wantedIds.size) return false;
    // Preserve the writer's immutable acknowledgement when uploads overlap edits.
    return true;
  } finally {
    durableSaveInFlight = false;
    queueDurableRecordsSave();
  }
}

function applyDurableRealtimeRecord(row, eventType = "UPDATE") {
  if (!row?.record_type || !row?.id || durableUnmappedRows.length) return false;
  const deleted = eventType === "DELETE" || Boolean(row.deleted_at);
  const type = row.record_type;
  if (type === "contact") {
    const index = state.contacts.findIndex((item) => item.id === row.id);
    if (deleted) {
      if (index >= 0) {
        // The lead's jobs and files are kept inside it here, so they leave the
        // screen with it. Whoever deleted the lead deleted them too, in the
        // same save. They must be forgotten as well: left on the list of
        // records this tab holds, they looked like records this tab had
        // removed, and it sent its own delete for each. The database refused
        // those as out of date and saving in the tab was paused. That is how
        // one person deleting a lead paused saving for everyone else.
        const gone = state.contacts[index];
        [...(gone.jobs || []).map((job) => `job:${job.id}`), ...(gone.documents || []).map((document) => `document:${document.id}`)].forEach((key) => {
          durableRecordFingerprints.delete(key);
          durableFinancialBaseline.delete(key);
        });
        state.contacts.splice(index, 1);
      }
    } else {
      const current = index >= 0 ? state.contacts[index] : null;
      const incomingJobs = current?.jobs || row.data?.jobs || [];
      const normalized = normalizeContact({
        ...(current || {}),
        ...row.data,
        id: row.id,
        ownerUserId: row.owner_id || row.data?.ownerUserId || current?.ownerUserId || "",
        jobs: incomingJobs,
        documents: current?.documents || row.data?.documents || [],
        updates: current?.updates || row.data?.updates || [],
      }, state.company.documentCategories, { preserveEmptyJobs: true });
      if (index >= 0) state.contacts[index] = normalized;
      else state.contacts.push(normalized);
    }
  } else if (type === "job") {
    const contact = state.contacts.find((item) => item.id === row.lead_id);
    // A deleted job of a lead that is already gone here needs nothing done to
    // the screen. Any other job without its lead needs a fresh read.
    if (!contact && !deleted) return false;
    if (contact) {
      // Do not materialize contactJobs()'s display-only fallback while a
      // contact and its first real job are arriving as separate realtime rows.
      contact.jobs = Array.isArray(contact.jobs) ? contact.jobs : [];
      const index = contact.jobs.findIndex((item) => item.id === row.id);
      if (deleted) {
        if (index >= 0) contact.jobs.splice(index, 1);
      } else {
        const normalized = normalizeJob({ ...row.data, id: row.id, ownerUserId: row.owner_id || row.data?.ownerUserId || "" }, contact);
        if (normalized.paymentLedgerVersion === 2 && normalized.ledgerChangedAt && normalized.ledgerChangedAt !== contact.jobs[index]?.ledgerChangedAt) scheduleLedgerReload();
        if (index >= 0) contact.jobs[index] = normalized;
        else contact.jobs.push(normalized);
      }
    }
  } else if (type === "document") {
    const collection = row.lead_id === COMPANY_DOCUMENT_LEAD_ID
      ? state.companyDocuments
      : state.contacts.find((item) => item.id === row.lead_id)?.documents;
    // As for a job: a deleted file of a lead that is gone, or whose files are
    // not loaded here, needs nothing done to the screen.
    if (!collection && !deleted) return false;
    const index = collection ? collection.findIndex((item) => item.id === row.id) : -1;
    if (deleted) {
      if (index >= 0) collection.splice(index, 1);
    } else {
      const normalized = normalizeDocument(
        { ...row.data, id: row.id, jobId: row.job_id || row.data?.jobId || null },
        { leadId: row.lead_id, categoryId: row.data?.categoryId || "", categories: state.company.documentCategories },
      );
      if (index >= 0) collection[index] = normalized;
      else collection.push(normalized);
    }
  } else if (type === "estimate") {
    const index = state.estimates.findIndex((item) => item.id === row.id);
    if (deleted) {
      if (index >= 0) state.estimates.splice(index, 1);
    } else {
      const normalized = normalizeEstimate({ ...row.data, id: row.id, contactId: row.lead_id, jobId: row.job_id || null }, state.contacts);
      if (index >= 0) state.estimates[index] = normalized;
      else state.estimates.push(normalized);
    }
  } else if (type === "task") {
    const index = state.calendarTasks.findIndex((item) => item.id === row.id);
    if (deleted) {
      if (index >= 0) state.calendarTasks.splice(index, 1);
    } else {
      const normalized = normalizeCalendarTask({ ...row.data, id: row.id, contactId: row.lead_id || row.data?.contactId || "" });
      if (index >= 0) state.calendarTasks[index] = normalized;
      else state.calendarTasks.push(normalized);
    }
  } else {
    return false;
  }

  if (deleted) {
    durableRecordFingerprints.delete(durableRecordKey(row));
    durableFinancialBaseline.delete(durableRecordKey(row));
  } else {
    durableFinancialBaseline.set(durableRecordKey(row), row.data || {});
  }
  invalidateDurableProjection();
  if (!deleted) {
    const normalizedRow = durableProjectedRow(type, row.id);
    if (!normalizedRow) return false;
    durableRecordFingerprints.set(durableRecordKey(row), durableFingerprint(normalizedRow));
  }
  getDurableCommitWriter().remember([row]);
  // What is on screen is now newer than anything read before this moment.
  durableChangeCounter += 1;
  saveState({ localOnly: true });
  renderDurableUpdateWhenIdle();
  return true;
}

function applyDurableRealtimeAudit(row, eventType = "INSERT") {
  if (!row?.id || row.event_type === "record_commit") return true;
  if (eventType === "DELETE") return false;
  const contact = state.contacts.find((item) => item.id === row.lead_id);
  if (!contact) return false;
  contact.updates ||= [];
  const update = {
    id: row.id,
    jobId: row.job_id || null,
    author: row.actor_name || "CRM User",
    message: row.message || "",
    status: row.status || "",
    createdAt: row.created_at || new Date().toISOString(),
  };
  const index = contact.updates.findIndex((item) => item.id === row.id);
  if (index >= 0) contact.updates[index] = update;
  else contact.updates.push(update);
  durableAuditIds.add(row.id);
  invalidateDurableProjection();
  saveState({ localOnly: true });
  renderDurableUpdateWhenIdle();
  return true;
}

// A record was changed somewhere else: by another person, or in another tab.
function handleDurableRecordEvent(payload) {
  const row = payload?.new || payload?.old;
  if (consumeRecentLocalDurableEcho(row)) return;
  if (durableSaveInFlight || hasPendingDurableChanges()) {
    queueDurableRecordsSave();
    return;
  }
  if (!applyDurableRealtimeRecord(row, payload.eventType)) queueDurableRecordsReload();
}

async function initializeDurableRecords() {
  if (!cloudReady || !cloudClient || !authSession?.user?.id) return;
  const rows = await reloadDurableRecords();
  if (rows === null) {
    // A failed authoritative read is not permission to display an old snapshot.
    durableBusinessStateAuthoritative = true;
    return;
  }
  // An empty authoritative table is not permission to resurrect old snapshots.
  // Legacy import must be an explicit, separately reviewed maintenance operation.
  durableRecordsReady = true;
  durableBusinessStateAuthoritative = true;
  // Replace any "Loading documents…" placeholders with the loaded lists.
  renderDurableUpdateWhenIdle();
  if (hasPendingDurableChanges()) queueDurableRecordsSave();
  void createDailyRecoveryBackup();
  if (!cloudClient.channel || durableRecordsSubscription) return;
  durableRecordsSubscription = cloudClient
    .channel(`crm-records-${supabaseStateId()}-${authSession.user.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_RECORDS_TABLE, filter: `company_state_id=eq.${supabaseStateId()}` }, async (payload) => handleDurableRecordEvent(payload))
    .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_AUDIT_TABLE, filter: `company_state_id=eq.${supabaseStateId()}` }, async (payload) => {
      const row = payload.new || payload.old;
      // Internal commit telemetry is never rendered and the matching record
      // change already drives one debounced reload.
      if (row?.event_type === "record_commit") return;
      if (row?.actor_user_id && row.actor_user_id === authSession?.user?.id) {
        if (row.id) durableAuditIds.add(row.id);
        return;
      }
      if (durableSaveInFlight || hasPendingDurableChanges()) {
        queueDurableRecordsSave();
        return;
      }
      if (!applyDurableRealtimeAudit(row, payload.eventType)) queueDurableRecordsReload();
    })
    .subscribe();
}

let ledgerReloadTimer = null;
function scheduleLedgerReload() {
  clearTimeout(ledgerReloadTimer);
  ledgerReloadTimer = setTimeout(async () => {
    if (await initializeFinancialLedger()) renderDurableUpdateWhenIdle();
  }, 300);
}

async function initializeFinancialLedger() {
  if (!cloudReady || !cloudClient || !authSession?.user?.id) {
    financialLedgerReady = true;
    return true;
  }
  const companyId = supabaseStateId();
  const tables = [
    "crm_invoices",
    "crm_invoice_items",
    "crm_payments",
    "crm_payment_allocations",
    "crm_expenses",
    "crm_credit_notes",
    "crm_refunds",
    "crm_invoice_schedules",
    "crm_billing_notices",
  ];
  try {
    const results = await Promise.all(tables.map(async (table) => {
      const data = [];
      let last = null;
      for (;;) {
        let query = cloudClient.from(table).select("*").eq("company_state_id", companyId).order("id").limit(250);
        if (last !== null) query = query.gt("id", last);
        const page = await query;
        if (page.error) throw page.error;
        if (!Array.isArray(page.data)) throw Error("Incomplete ledger response");
        if (!page.data.length) return { data };
        const next = page.data.at(-1).id;
        if (next == null || next === last) throw Error("Incomplete ledger page");
        last = next;
        data.push(...page.data);
      }
    }));
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;
    const [invoiceRows, itemRows, paymentRows, allocationRows, expenseRows, creditRows, refundRows, scheduleRows, noticeRows] = results.map((result) => result.data || []);
    const itemsByInvoice = new Map();
    itemRows.forEach((item) => {
      if (!itemsByInvoice.has(item.invoice_id)) itemsByInvoice.set(item.invoice_id, []);
      itemsByInvoice.get(item.invoice_id).push(item);
    });
    state.invoices = invoiceRows.map((invoice) => normalizeInvoice({
      ...invoice,
      items: (itemsByInvoice.get(invoice.id) || []).sort((a, b) => number(a.position) - number(b.position)),
    }));
    state.financialPayments = paymentRows.filter(isInvoicePaymentRow).map(normalizeFinancialPayment);
    state.jobLedgerPayments = paymentRows.filter((p) => !isInvoicePaymentRow(p)).map(normalizeFinancialPayment);
    state.paymentAllocations = allocationRows.map(normalizePaymentAllocation);
    state.financialExpenses = expenseRows.map(normalizeFinancialExpense);
    state.creditNotes = creditRows.map(normalizeCreditNote);
    state.financialRefunds = refundRows.map(normalizeFinancialRefund);
    state.invoiceSchedules = scheduleRows.map(normalizeInvoiceSchedule);
    state.billingNotices = noticeRows.map(normalizeBillingNotice);
    financialLedgerReady = true;
    saveState({ localOnly: true });
    return true;
  } catch (error) {
    financialLedgerReady = false;
    console.warn("The financial ledger could not be loaded", error);
    return false;
  }
}

async function initializeProjectDelivery() {
  if (!cloudReady || !cloudClient || !authSession?.user?.id) return true;
  const tables = ["crm_project_members","crm_project_discussions","crm_project_notes","crm_job_time_entries","crm_project_templates","crm_job_milestones"];
  try {
    const results = await Promise.all(tables.map((table) => cloudClient.from(table).select("*").eq("company_state_id",supabaseStateId())));
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;
    const [memberRows,discussionRows,noteRows,timeRows,templateRows,milestoneRows] = results.map((result) => result.data || []);
    state.projectMembers = memberRows.map(normalizeProjectMember);
    state.projectDiscussions = discussionRows.map(normalizeProjectDiscussion);
    state.projectNotes = noteRows.map(normalizeProjectNote);
    state.jobTimeEntries = timeRows.map(normalizeJobTimeEntry);
    state.projectTemplates = templateRows.map(normalizeProjectTemplate);
    const milestonesByJob=new Map();
    milestoneRows.forEach((row)=>{if(!milestonesByJob.has(row.job_id))milestonesByJob.set(row.job_id,[]);milestonesByJob.get(row.job_id).push(normalizeJobMilestone(row));});
    state.contacts=state.contacts.map((contact)=>({...contact,jobs:contactJobs(contact).map((job)=>{const relational=milestonesByJob.get(job.id)||[];return relational.length?{...job,milestones:relational}:job;})}));
    saveState({ localOnly: true });
    return true;
  } catch (error) {
    console.warn("Project delivery records could not be loaded",error);
    return false;
  }
}

async function insertProjectDeliveryRow(table,row) {
  if (!canUseCloudSync()) return true;
  const { error } = await cloudClient.from(table).insert({ company_state_id: supabaseStateId(), ...row });
  if (error) throw error;
  return initializeProjectDelivery();
}

const operationsTableStateMap = {
  crm_permits: "permits",
  crm_inspections: "inspections",
  crm_job_selections: "jobSelections",
  crm_change_orders: "changeOrders",
  crm_progress_billings: "progressBillings",
  crm_maintenance_plans: "maintenancePlans",
  crm_maintenance_visits: "maintenanceVisits",
  crm_organization_accounts: "customerAccounts",
  crm_account_properties: "accountProperties",
  crm_account_contacts: "accountContacts",
  crm_account_record_links: "accountRecordLinks",
};

async function initializeJobOperations() {
  if (!cloudReady || !cloudClient || !authSession?.user?.id) return true;
  const tables = Object.keys(operationsTableStateMap);
  try {
    const results = await Promise.all(tables.map((table) => cloudClient.from(table).select("*").eq("company_state_id", supabaseStateId())));
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;
    results.forEach((result, index) => {
      const key = operationsTableStateMap[tables[index]];
      const normalizer = key === "customerAccounts" ? normalizeCustomerAccount : key === "accountProperties" ? normalizeAccountProperty : key === "accountContacts" ? normalizeAccountContact : key === "accountRecordLinks" ? normalizeAccountRecordLink : normalizeJobOperation;
      state[key] = (result.data || []).map(normalizer);
    });
    saveState({ localOnly: true });
    return true;
  } catch (error) {
    console.warn("Job operations records could not be loaded", error);
    return false;
  }
}

async function insertJobOperation(table, row) {
  const stateKey = operationsTableStateMap[table];
  if (!stateKey) throw new Error("Unknown operations record type");
  if (canUseCloudSync()) {
    const { error } = await cloudClient.from(table).insert({ company_state_id: supabaseStateId(), ...row, created_by: authSession.user.id, updated_by: authSession.user.id });
    if (error) throw error;
    if (!(await initializeJobOperations())) throw new Error("The record was saved, but the operations view could not be refreshed");
    return;
  }
  const normalizer = stateKey === "customerAccounts" ? normalizeCustomerAccount : stateKey === "accountProperties" ? normalizeAccountProperty : stateKey === "accountContacts" ? normalizeAccountContact : stateKey === "accountRecordLinks" ? normalizeAccountRecordLink : normalizeJobOperation;
  state[stateKey] = [normalizer(row), ...(state[stateKey] || [])];
  saveState({ localOnly: true });
}

async function updateJobOperation(table, id, patch) {
  const stateKey = operationsTableStateMap[table];
  if (!stateKey) throw new Error("Unknown operations record type");
  if (canUseCloudSync()) {
    const { error } = await cloudClient.from(table).update({ ...patch, updated_by: authSession.user.id }).eq("company_state_id", supabaseStateId()).eq("id", id);
    if (error) throw error;
    if (!(await initializeJobOperations())) throw new Error("The record was updated, but the operations view could not be refreshed");
    return;
  }
  state[stateKey] = (state[stateKey] || []).map((item) => item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item);
  saveState({ localOnly: true });
}

// Permits, inspections and selections entered by mistake could only have their
// status changed, never be removed. Change orders and billing draws are money
// records and are voided through their status instead of deleted.
const deletableOperationTables = { crm_permits: "permit", crm_inspections: "inspection", crm_job_selections: "selection" };
async function deleteJobOperation(table, id) {
  const stateKey = operationsTableStateMap[table];
  if (!stateKey || !deletableOperationTables[table]) throw new Error("This record type cannot be deleted");
  if (canUseCloudSync()) {
    // Ask for the deleted row back: when the database refuses a delete it does
    // so silently, by deleting nothing.
    const { data, error } = await cloudClient.from(table).delete().eq("company_state_id", supabaseStateId()).eq("id", id).select("id");
    if (error) throw error;
    if (!Array.isArray(data) || !data.length) throw new Error("The record was not deleted. Only the person who created it, or a manager, can delete it.");
    if (!(await initializeJobOperations())) throw new Error("The record was deleted, but the operations view could not be refreshed");
    return;
  }
  state[stateKey] = (state[stateKey] || []).filter((item) => item.id !== id);
  saveState({ localOnly: true });
}

async function confirmDeleteJobOperation(table, id) {
  if (!requireAction("manageJobs")) return;
  const kind = deletableOperationTables[table];
  const row = (state[operationsTableStateMap[table]] || []).find((item) => item.id === id);
  if (!kind || !row) return;
  if (table === "crm_permits") {
    const linked = (state.inspections || []).filter((item) => (item.permitId || item.permit_id) === id).length;
    if (linked) return setOperationsStatus(`This permit has ${linked} inspection${linked === 1 ? "" : "s"} linked to it. Delete ${linked === 1 ? "it" : "them"} first.`, "error");
  }
  const label = operationValue(row, "permitType", "permit_type") || operationValue(row, "inspectionType", "inspection_type") || operationValue(row, "itemName", "item_name") || kind;
  if (!(await appConfirm(`Delete the ${kind} "${label}"? This cannot be undone.`, { title: `Delete ${kind}`, confirmLabel: `Delete ${kind}`, danger: true }))) return;
  try {
    await deleteJobOperation(table, id);
    renderLeadOperations(getSelectedContact());
    setOperationsStatus(`${kind[0].toUpperCase()}${kind.slice(1)} deleted`);
  } catch (error) {
    renderLeadOperations(getSelectedContact());
    setOperationsStatus(error.message || "The record could not be deleted", "error");
  }
}

function operationDeleteButton(table, id, label) {
  return canAction("manageJobs")
    ? `<button class="mini-button" type="button" title="Delete" aria-label="Delete ${escapeHtml(label || "record")}" data-operation-delete="${escapeHtml(table)}" data-operation-id="${escapeHtml(id)}"><span aria-hidden="true" data-icon="trash"></span></button>`
    : "";
}

// An approved change order changes what the customer owes. The job's contract
// value did not move, so the balance due stayed wrong by the change amount.
// Ask each time: some change orders are billed separately. The job remembers
// which change orders it has absorbed so none is applied twice.
function changeOrderCountsTowardContract(status) {
  return ["approved", "signed"].includes(String(status || ""));
}

async function reconcileChangeOrderWithContract(changeOrderId, previousStatus, nextStatus) {
  const order = (state.changeOrders || []).find((item) => item.id === changeOrderId);
  const contactId = order && (order.contactId || order.leadId || order.lead_id);
  const jobId = order && (order.jobId || order.job_id);
  const contact = contactId && getContact(contactId);
  const job = contact && contactJobs(contact).find((item) => item.id === jobId);
  if (!order || !job || !canAction("manageJobs")) return false;
  const applied = Array.isArray(job.appliedChangeOrders) ? job.appliedChangeOrders : [];
  const existing = applied.find((item) => item.id === changeOrderId);
  const nowCounts = changeOrderCountsTowardContract(nextStatus);
  const amount = Math.round(number(order.amount) * 100) / 100;
  const contractValue = number(job.contractValue) || number(job.value);
  const orderLabel = `${operationValue(order, "changeOrderNumber", "change_order_number")} (${money.format(amount)})`;
  let delta = 0;
  let nextApplied = applied;
  if (nowCounts && !existing && amount !== 0) {
    const newTotal = Math.round((contractValue + amount) * 100) / 100;
    const add = await appConfirm(
      `Change order ${orderLabel} is now ${nextStatus}. ${amount > 0 ? "Add it to" : "Take it off"} the contract value of ${job.name}? The contract would go from ${money.format(contractValue)} to ${money.format(newTotal)}.`,
      { title: "Update the contract value?", confirmLabel: `Make it ${money.format(newTotal)}`, cancelLabel: "Leave the contract as is" },
    );
    if (!add) return false;
    delta = amount;
    nextApplied = [...applied, { id: changeOrderId, amount }];
  } else if (!nowCounts && existing && changeOrderCountsTowardContract(previousStatus)) {
    const newTotal = Math.round((contractValue - number(existing.amount)) * 100) / 100;
    const remove = await appConfirm(
      `Change order ${orderLabel} is no longer approved, and it was added to the contract value of ${job.name}. Take it back off? The contract would go from ${money.format(contractValue)} to ${money.format(newTotal)}.`,
      { title: "Update the contract value?", confirmLabel: `Make it ${money.format(newTotal)}`, cancelLabel: "Leave the contract as is" },
    );
    if (!remove) return false;
    delta = -number(existing.amount);
    nextApplied = applied.filter((item) => item.id !== changeOrderId);
  } else {
    return false;
  }
  const newContract = Math.max(0, Math.round((contractValue + delta) * 100) / 100);
  const updateId = uid("update");
  updateContact(contact.id, (current) => {
    const jobs = contactJobs(current).map((item) => item.id === jobId ? { ...item, value: newContract, contractValue: newContract, appliedChangeOrders: nextApplied } : item);
    return {
      ...current,
      ...summarizeContactJobs(current, jobs),
      updates: [{ id: updateId, author: currentActorName(), jobId, message: `Contract value ${delta >= 0 ? "increased" : "reduced"} by ${money.format(Math.abs(delta))} to ${money.format(newContract)} for change order ${operationValue(order, "changeOrderNumber", "change_order_number")}.`, createdAt: new Date().toISOString() }, ...(current.updates || [])],
    };
  });
  saveState({ localOnly: true });
  let saved = !canUseCloudSync();
  try { if (canUseCloudSync()) saved = await persistLeadJobRecord(jobId, updateId); } catch (error) { console.warn("Contract value could not be confirmed", error); }
  if (!saved) queueDurableRecordsSave();
  showToast(`Contract value is now ${money.format(newContract)}.`);
  return true;
}

async function initializeLeadOrganization() {
  if (!cloudReady || !cloudClient || !authSession?.user?.id) return true;
  const tables=["crm_lead_sources","crm_tags","crm_record_tags","crm_custom_fields","crm_custom_field_values","crm_saved_filters","crm_divisions","crm_services","crm_pipeline_stages"];
  try {
    const results=await Promise.all(tables.map((table)=>cloudClient.from(table).select("*").eq("company_state_id",supabaseStateId())));
    const failed=results.find((result)=>result.error);if(failed)throw failed.error;
    const [sources,tags,recordTags,fields,values,filters,divisions,services,pipelineStages]=results.map((result)=>result.data||[]);
    state.leadSources=sources.map((item)=>({id:item.id,name:item.name,displayOrder:number(item.display_order),active:item.active!==false}));
    state.leadTags=tags.map((item)=>({id:item.id,name:item.name,color:item.color,active:item.active!==false}));
    state.recordTags=recordTags.map((item)=>({id:item.id,contactId:item.lead_id,jobId:item.job_id,recordType:item.record_type,recordId:item.record_id,tagId:item.tag_id}));
    state.customFields=fields.map((item)=>({id:item.id,label:item.label,fieldKey:item.field_key,appliesTo:item.applies_to,fieldType:item.field_type,options:item.options||[],required:item.required,displayOrder:number(item.display_order),active:item.active!==false}));
    state.customFieldValues=values.map((item)=>({id:item.id,contactId:item.lead_id,jobId:item.job_id,recordType:item.record_type,recordId:item.record_id,fieldId:item.field_id,value:item.value}));
    state.savedLeadFilters=filters.map((item)=>({id:item.id,name:item.name,criteria:item.criteria||{},viewName:item.view_name}));
    state.divisions=divisions.map((item)=>({id:item.id,name:item.name,displayOrder:number(item.display_order),active:item.active!==false}));
    state.services=services.map((item)=>({id:item.id,divisionId:item.division_id,name:item.name,displayOrder:number(item.display_order),active:item.active!==false}));
    state.pipelineStages=pipelineStages.map((item)=>({id:item.id,divisionId:item.division_id,name:item.name,displayOrder:number(item.display_order),active:item.active!==false}));
    saveState({localOnly:true});return true;
  }catch(error){console.warn("Lead organization records could not be loaded",error);return false;}
}

async function initializeCommunications() {
  if(!cloudReady||!cloudClient||!authSession?.user?.id)return true;
  const tables=["crm_email_templates","crm_scheduled_messages","crm_reminders","crm_notifications"];
  try{const results=await Promise.all(tables.map((table)=>cloudClient.from(table).select("*").eq("company_state_id",supabaseStateId())));const failed=results.find((result)=>result.error);if(failed)throw failed.error;const [templates,messages,reminders,notifications]=results.map((result)=>result.data||[]);state.emailTemplates=templates.map((item)=>({id:item.id,name:item.name,subjectTemplate:item.subject_template,bodyTemplate:item.body_template,category:item.category,active:item.active!==false}));state.scheduledMessages=messages.map((item)=>({id:item.id,contactId:item.lead_id,jobId:item.job_id,recipient:item.recipient,subject:item.subject,body:item.body,scheduledFor:item.scheduled_for,status:item.status,attempts:number(item.attempts),lastError:item.last_error}));state.crmReminders=reminders;state.crmNotifications=notifications;saveState({localOnly:true});return true;}catch(error){console.warn("Communication records could not be loaded",error);return false;}
}

async function initializeDocumentOperations() {
  if(!cloudReady||!cloudClient||!authSession?.user?.id)return true;
  const tables=["crm_document_versions","crm_document_comments","crm_document_access","crm_document_templates","crm_signature_requests"];
  try{const results=await Promise.all(tables.map((table)=>cloudClient.from(table).select("*").eq("company_state_id",supabaseStateId())));const failed=results.find((result)=>result.error);if(failed)throw failed.error;const [versions,comments,access,templates,signatures]=results.map((result)=>result.data||[]);
    state.documentVersions=versions.map((item)=>({id:item.id,documentId:item.document_id,contactId:item.lead_id,jobId:item.job_id,versionNumber:number(item.version_number),fileName:item.file_name,mimeType:item.mime_type,fileSize:number(item.file_size),storagePath:item.storage_path,checksum:item.checksum,createdAt:item.created_at}));
    state.documentComments=comments.map((item)=>({id:item.id,documentId:item.document_id,contactId:item.lead_id,jobId:item.job_id,body:item.body,customerVisible:item.customer_visible,createdAt:item.created_at}));
    state.documentAccess=access.map((item)=>({documentId:item.document_id,contactId:item.lead_id,jobId:item.job_id,customerVisible:item.customer_visible,downloadAllowed:item.download_allowed,updatedAt:item.updated_at}));
    state.documentTemplates=templates;state.signatureRequests=signatures;saveState({localOnly:true});return true;
  }catch(error){console.warn("Document operations could not be loaded",error);return false;}
}

async function createDailyRecoveryBackup() {
  if (!canManageTeamData() || !durableRecordsReady || !authSession?.user?.id) return;
  try {
    // One backup per day. Check before building it: every page load used to
    // assemble and upload the whole payload only for the database to refuse it
    // as a duplicate (the 409 seen in the browser's network log).
    const existing = await cloudClient.from("crm_backups").select("backup_date", { count: "exact", head: true })
      .eq("company_state_id", supabaseStateId()).eq("backup_date", todayISO());
    if (!existing.error && number(existing.count) > 0) return;
    // The backup must hold every record. fetchDurableRows() returns only the
    // first page of leads and jobs when the workspace loads in pages, and the
    // workspace snapshot leaves out document records (they load per lead), so
    // the backup reads every record type itself. Without the document records
    // the file list below was always empty.
    const [rows, auditRows] = await Promise.all([
      fetchAllCompanyRows(SUPABASE_RECORDS_TABLE, ["record_type", "id"]),
      fetchRecentCompanyRows(SUPABASE_AUDIT_TABLE, 500, (query) => query.neq("event_type", "record_commit")),
    ]);
    const conversationMessages = await fetchAllCompanyRows("crm_conversation_messages", ["created_at", "id"]);
    const payload = {
      schemaVersion: 2,
      createdAt: new Date().toISOString(),
      company: companyStatePayload(),
      records: rows,
      auditEvents: auditRows,
      conversationMessages,
      // File bytes still require a separately scheduled storage backup.
      storagePaths: [...new Set(rows.filter((row) => row.record_type === "document")
        .flatMap((row) => [row.data?.storagePath, ...(row.data?.previousVersions || []).map((version) => version.storagePath)])
        .filter(Boolean))],
    };
    const { error } = await cloudClient.from("crm_backups").insert({
      company_state_id: supabaseStateId(),
      backup_date: todayISO(),
      record_count: rows.filter((row) => !row.deleted_at).length,
      payload,
      created_by: authSession.user.id,
    });
    if (error && error.code !== "23505") throw error;
  } catch (error) {
    console.warn("Daily CRM recovery backup could not be created", error);
  }
}

function currentRole() {
  return window.RooflineAuth?.normalizeRole(authSession?.role || state.currentUser.role) || "viewer";
}

function canManageTeamData() {
  return ["admin", "office_manager", "sales_manager", "operations_manager"].includes(currentRole());
}

function canManageJobFinancials() {
  return ["admin", "office_manager", "sales_manager", "operations_manager"].includes(currentRole());
}

function canManageManualPayments() {
  return currentRole() === "admin";
}

function currentUserFromAuthSession(session) {
  return {
    name: normalizePersonName(
      session.user?.user_metadata?.name ||
      session.user?.user_metadata?.full_name ||
      session.user?.email?.split("@")[0] ||
      "CRM User",
    ),
    email: session.user?.email || "",
    role: window.RooflineAuth?.normalizeRole(session.role || session.user?.app_metadata?.role) || "viewer",
  };
}

function rolePolicy() {
  return rolePolicies[currentRole()] || rolePolicies.viewer;
}

function canView(view) {
  const views = rolePolicy().views;
  return views === "all" || views.includes(view);
}

function canAction(action) {
  if (action === "manageJobFinancials") return canManageJobFinancials();
  const actions = rolePolicy().actions;
  return actions === "all" || actions.includes(action);
}

function requireAction(action) {
  if (canAction(action)) return true;
  showToast(`Your ${roleLabel()} role does not allow that action`);
  return false;
}

function companyOfficeAddress() {
  return state.company.officeAddress || state.company.address || defaultCompany.officeAddress;
}

function estimateSalesRep(estimate = {}) {
  return {
    name: estimate.projectManager || state.currentUser.name || "Unassigned",
    email: estimate.salesRepEmail || state.currentUser.email || state.company.email || "",
    phone: estimate.salesRepPhone || state.currentUser.phone || state.company.phone || "",
    officeAddress: companyOfficeAddress(),
  };
}

const COASTAL_CREST_TRANSPARENT_MARK = "/coastal-crest-mark.png";
let coastalCrestMarkDataUrlPromise = null;

function isCoastalCrestCompany(company = state.company) {
  return /coastal\s+crest/i.test(String(company?.name || ""));
}

function companyLogoSource(company = state.company) {
  if (company?.logoDataUrl && (company.logoAssetVersion === "custom" || !isCoastalCrestCompany(company))) {
    return company.logoDataUrl;
  }
  if (isCoastalCrestCompany(company)) return COASTAL_CREST_TRANSPARENT_MARK;
  return company?.logoDataUrl || "";
}

async function companyLogoDataUrlForPdf(company = state.company) {
  const source = companyLogoSource(company);
  if (!source || source.startsWith("data:")) return source;
  if (source !== COASTAL_CREST_TRANSPARENT_MARK) return "";
  if (!coastalCrestMarkDataUrlPromise) {
    coastalCrestMarkDataUrlPromise = fetch(source, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error("Transparent logo asset could not be loaded");
        return response.blob();
      })
      .then(readFileAsDataUrl)
      .catch(() => "");
  }
  return coastalCrestMarkDataUrlPromise;
}

function companyLogoTag(className = "doc-logo") {
  const logoSource = companyLogoSource();
  if (logoSource) {
    return `<img class="${className}" src="${escapeHtml(logoSource)}" alt="${escapeHtml(
      state.company.name || "Company",
    )} logo" />`;
  }
  return `<div class="doc-mark">${escapeHtml((state.company.name || "R").slice(0, 1))}</div>`;
}

function firstAllowedView() {
  return ["dashboard", "leads", "contacts", "jobs", "projects", "estimates", "companyDocuments"].find(canView) || "dashboard";
}

