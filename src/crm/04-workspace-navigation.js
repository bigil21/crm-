function setView(view) {
  if (!canView(view)) {
    showToast(`Your ${roleLabel()} role cannot access that section`);
    state.view = firstAllowedView();
    saveUiState();
    render();
    return;
  }
  state.view = view;
  saveUiState();
  render();
  if (viewNeedsCompleteCoreRecords(view) && !completeCoreRecordsLoaded) void ensureCompleteCoreRecordsLoaded();
}

function openLeadDetail(contactId, tab = "overview", jobId = "") {
  if (!canView("leadDetail")) {
    showToast(`Your ${roleLabel()} role cannot open client records`);
    return;
  }
  const changingContact = state.selectedContactId !== contactId;
  state.selectedContactId = contactId;
  const contact = getContact(contactId);
  const jobs = contactJobs(contact);
  if (jobId && jobs.some((job) => job.id === jobId)) {
    state.selectedLeadJobId = jobId;
  } else if (changingContact || !jobs.some((job) => job.id === state.selectedLeadJobId)) {
    state.selectedLeadJobId = jobs[0]?.id || "";
  }
  state.selectedProfitJobId = state.selectedLeadJobId;
  state.leadDetailTab = tab;
  state.view = "leadDetail";
  saveUiState();
  render();
}

function openLeadJob(contactId, jobId) {
  openLeadDetail(contactId, "jobs", jobId);
  const contact = getContact(contactId);
  const job = contactJobs(contact).find((item) => item.id === jobId);
  if (job) fillJobForm({ ...job, jobId: job.id });
}

function openLeadJobPhotos(contactId, jobId) {
  openLeadDetail(contactId, "photos", jobId);
}

function setSelectedEstimate(id) {
  state.selectedEstimateId = id;
  const estimate = getSelectedEstimate();
  if (estimate) state.selectedContactId = estimate.contactId;
  saveUiState();
  renderEstimates();
}

function getSelectedContact() {
  return visibleContacts().find((contact) => contact.id === state.selectedContactId) || null;
}

function getSelectedEstimate() {
  return visibleEstimates().find((estimate) => estimate.id === state.selectedEstimateId) || null;
}

function getContact(id) {
  return state.contacts.find((contact) => contact.id === id);
}

function contactJobs(contact) {
  return contact?.jobs?.length ? contact.jobs : [normalizeJob({}, contact)];
}

function allJobs() {
  return visibleContacts().flatMap((contact) =>
    contactJobs(contact).map((job) => ({
      ...job,
      contactId: contact.id,
      contactName: contact.name,
      contactType: contact.type,
    })),
  );
}

function primaryJob(contact) {
  return contactJobs(contact)[0];
}

function jobHasFullPayment(job = {}) {
  const { contractValue, paidAmount } = jobPaymentMetrics(job);
  return contractValue > 0 && paidAmount + 0.005 >= contractValue;
}

function summarizeContactJobs(contact, jobs = contactJobs(contact)) {
  const primary = jobs[0] || normalizeJob({}, contact);
  const totalValue = jobs.reduce((sum, job) => sum + number(job.contractValue ?? job.value), 0);
  return {
    jobs,
    status: primary.status,
    type: jobs.some((job) => soldJobStatuses.includes(job.status)) ? "Customer" : contact.type || "Lead",
    value: Math.round(totalValue * 100) / 100,
    closedDate: contact.closedDate || primary.closedDate || "",
  };
}

function updateContact(contactId, updater) {
  let updatedContact = null;
  state.contacts = state.contacts.map((contact) => {
    if (contact.id !== contactId) return contact;
    updatedContact = normalizeContact({ ...updater({ ...contact }), updatedAt: new Date().toISOString() });
    return updatedContact;
  });
  return updatedContact;
}

function getEstimateContact(estimate) {
  return getContact(estimate?.contactId) || null;
}

function getEstimateJob(estimate) {
  const contact = getEstimateContact(estimate);
  if (!contact) return null;
  const jobs = contactJobs(contact);
  return jobs.find((job) => job.id === estimate?.jobId) || null;
}

function numericHash(value = "") {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 1000000;
}

function leadNumberFor(contact = {}) {
  const date = String(contact.createdAt || todayISO()).slice(0, 10).replace(/\D/g, "") || "00000000";
  return `LD-${date}-${String(numericHash(contact.id || contact.name)).padStart(6, "0")}`;
}

function uniqueLeadNumberFor(contact = {}) {
  const base = leadNumberFor(contact);
  const prefix = base.slice(0, -6);
  const start = Number(base.slice(-6));
  const used = new Set(
    state.contacts
      .filter((item) => item.id !== contact.id && item.leadNumber)
      .map((item) => item.leadNumber),
  );
  for (let offset = 0; offset < 1000000; offset += 1) {
    const suffix = String((start + offset) % 1000000).padStart(6, "0");
    const candidate = `${prefix}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Unable to assign a unique lead number.");
}

function nextProjectNumber(contact = {}) {
  const leadNumber = contact.leadNumber || leadNumberFor(contact);
  const used = contactJobs(contact)
    .map((job) => Number(String(job.projectNumber || "").match(/-P(\d+)$/)?.[1] || 0))
    .filter(Boolean);
  return `${leadNumber}-P${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, "0")}`;
}

function ensureLeadProjectNumbers(contactId, preferredJobId = "") {
  let numberedContact = null;
  state.contacts = state.contacts.map((contact) => {
    if (contact.id !== contactId) return contact;
    const leadNumber = contact.leadNumber || uniqueLeadNumberFor(contact);
    let nextSequence = 1;
    const existingSequences = contactJobs(contact)
      .map((job) => Number(String(job.projectNumber || "").match(/-P(\d+)$/)?.[1] || 0))
      .filter(Boolean);
    if (existingSequences.length) nextSequence = Math.max(...existingSequences) + 1;
    const jobs = contactJobs(contact).map((job) => {
      if (job.projectNumber) return job;
      const projectNumber = `${leadNumber}-P${String(nextSequence).padStart(2, "0")}`;
      nextSequence += 1;
      return { ...job, projectNumber };
    });
    numberedContact = { ...contact, leadNumber, jobs };
    return numberedContact;
  });
  if (!numberedContact) return null;
  const job = contactJobs(numberedContact).find((item) => item.id === preferredJobId) || primaryJob(numberedContact);
  return { contact: numberedContact, job };
}

function ensureExistingSalesNumbers() {
  let changed = false;
  state.estimates.forEach((estimate) => {
    const numbered = ensureLeadProjectNumbers(estimate.contactId, estimate.jobId);
    if (!numbered) return;
    if (estimate.leadNumber !== numbered.contact.leadNumber || estimate.projectNumber !== numbered.job?.projectNumber) {
      estimate.leadNumber = numbered.contact.leadNumber;
      estimate.projectNumber = numbered.job?.projectNumber || "";
      changed = true;
    }
  });
  return changed;
}

function filteredContacts() {
  const contacts = visibleContacts();
  return !state.search.trim() ? contacts : contacts.filter((contact) => contactMatchesSearch(contact, state.search));
}

function normalizeLeadSearch(value) {
  return String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function contactSearchFields(contact, jobs = contactJobs(contact)) {
  // Estimate numbers too: "EST-1093" should find the lead it belongs to.
  const estimateNumbers = (state.estimates || []).filter((estimate) => estimate.contactId === contact.id).map((estimate) => estimate.estimateNumber);
  return [contact.name, contact.leadNumber, contact.type, contact.status, contact.source,
    contact.salesRep, contact.email, contact.phone, contact.address, contact.notes, ...estimateNumbers,
    ...jobs.flatMap((job) => [job.name, job.projectNumber, job.address, job.status, job.salesRep, job.notes, money.format(number(job.value))])]
    .filter(Boolean).map(normalizeLeadSearch);
}

function contactMatchesSearch(contact, query, jobs = contactJobs(contact)) {
  const normalized = normalizeLeadSearch(query);
  if (!normalized) return false;
  const fields = contactSearchFields(contact, jobs);
  const searchable = fields.join(" ");
  if (normalized.split(/\s+/).every((term) => searchable.includes(term))) return true;
  // Phone punctuation and spaces should never prevent a pasted number matching.
  const digits = String(query).replace(/\D/g, "");
  if (/^[\d\s()+.\-]+$/.test(query) && digits.length >= 3 &&
      String(contact.phone || "").replace(/\D/g, "").includes(digits)) return true;
  const compact = normalized.replace(/\s/g, "");
  return compact.length >= 3 && fields.some((field) => field.replace(/\s/g, "").includes(compact));
}

function searchResultJob(contact, query) {
  const jobs = contactJobs(contact);
  if (contactMatchesSearch(contact, query, [])) return jobs[0];
  return jobs.find((job) => contactMatchesSearch(contact, query, [job])) || jobs[0];
}

// The database's own rule (crm_commit_records) for who may save a record that
// already exists. An automatic correction checks it first, so a session that
// is not allowed to save a record never tries to: the attempt is refused and
// the user sees "Change not saved" for something they did not do.
function canSaveExistingRecord(recordType, ownerUserId) {
  const role = currentRole();
  if (role === "admin" || role === "office_manager") return true;
  if (role === "sales_manager") return ["contact", "job", "estimate", "task", "document"].includes(recordType);
  if (role === "operations_manager") return ["contact", "job", "task", "document"].includes(recordType);
  const own = Boolean(ownerUserId) && ownerUserId === authSession?.user?.id;
  if (role === "sales") return own;
  if (role === "production") return own && ["job", "task", "document"].includes(recordType);
  return false;
}

// Gives a number to records that should have one and do not: an estimate
// without its numbers, a job whose reserved number never reached its record,
// a sold job with no number. `only` limits the check to the records named in
// it ({ jobIds, estimateIds }), which is how it is used: on the records a user
// has just saved (see queueNumberingAfterSave). It is never run because a
// page was opened.
async function ensureExistingSharedSalesNumbers(only = null) {
  const wanted = (ids, id) => !only || Boolean(ids?.has(id));
  const missing = [];
  for (const estimate of state.estimates) {
    const contact = getEstimateContact(estimate);
    const job = getEstimateJob(estimate);
    if (!contact || !job) continue;
    if (!wanted(only?.estimateIds, estimate.id) && !wanted(only?.jobIds, job.id)) continue;
    if (contact.leadNumber && job.projectNumber && estimate.leadNumber === contact.leadNumber &&
        estimate.projectNumber === job.projectNumber && estimate.estimateNumber) continue;
    // Restoring a number changes the lead, the job or the estimate. Leave it
    // to a session that can save all three; everyone else still sees the
    // number, taken from the estimate.
    if (!canSaveExistingRecord("contact", contact.ownerUserId) || !canSaveExistingRecord("job", job.ownerUserId || contact.ownerUserId) ||
        !canSaveExistingRecord("estimate", estimate.ownerUserId || contact.ownerUserId)) continue;
    missing.push({ contactId: contact.id, jobId: job.id, estimateId: estimate.id });
  }
  // Every sold job has a number. A job sold without an estimate has no
  // estimate to be found through, so sold jobs are checked directly:
  // - one release numbered such a job at the sale but lost the job's own
  //   number on saving, so the lead kept its number and the job's record
  //   stayed blank. Reserving again hands back the number already reserved;
  // - a job sold before numbering at the sale existed gets its first number
  //   now, and so does its lead when the lead has none.
  // The session must be able to save what changes: the job, and the lead too
  // when the lead is being numbered.
  const alreadyListed = new Set(missing.map((item) => item.jobId));
  for (const contact of state.contacts) {
    for (const job of contactJobs(contact)) {
      if (job.projectNumber || alreadyListed.has(job.id) || !jobIsSold(job)) continue;
      if (!wanted(only?.jobIds, job.id)) continue;
      if (!canSaveExistingRecord("job", job.ownerUserId || contact.ownerUserId)) continue;
      if (!contact.leadNumber && !canSaveExistingRecord("contact", contact.ownerUserId)) continue;
      missing.push({ contactId: contact.id, jobId: job.id, estimateId: "" });
    }
  }
  const failures = [];
  // Numbering repairs are independent and bounded. A historical record that
  // cannot be numbered must not lock users out of the rest of the CRM.
  for (let offset = 0; offset < missing.length; offset += 4) {
    const batch = missing.slice(offset, offset + 4);
    const results = await Promise.allSettled(batch.map((item) =>
      reserveSharedSalesNumbers(item.contactId, item.jobId, item.estimateId),
    ));
    results.forEach((result, index) => {
      if (result.status === "rejected") failures.push({ ...batch[index], error: result.reason });
    });
  }
  if (failures.length) console.warn(`${failures.length} job or estimate number${failures.length === 1 ? "" : "s"} could not be repaired.`, failures);
  return { repaired: missing.length - failures.length, failures };
}

// Numbers are given out as part of a user's own save, never because a page
// was opened. This check used to run at startup and again when every record
// had loaded, and saved whatever it restored: opening the CRM changed records.
// Now, after a save goes through, the jobs and estimates in it are checked.
// One that should have a number and does not (a job that has just been sold,
// or one whose number was lost by an earlier release) gets it, and is saved
// again through the normal save. Once it holds its number there is nothing
// left to do for it, so this cannot repeat.
const numberingAfterSaveQueue = { jobIds: new Set(), estimateIds: new Set() };
let numberingAfterSaveTimer = null;
function queueNumberingAfterSave(changes = []) {
  if (!canUseCloudSync()) return;
  changes.forEach((row) => {
    if (!row || row.operation === "delete") return;
    if (row.record_type === "job") numberingAfterSaveQueue.jobIds.add(row.id);
    if (row.record_type === "estimate") numberingAfterSaveQueue.estimateIds.add(row.id);
  });
  if (!numberingAfterSaveQueue.jobIds.size && !numberingAfterSaveQueue.estimateIds.size) return;
  window.clearTimeout(numberingAfterSaveTimer);
  numberingAfterSaveTimer = window.setTimeout(() => { void numberRecordsJustSaved(); }, 0);
}

async function numberRecordsJustSaved() {
  const only = { jobIds: new Set(numberingAfterSaveQueue.jobIds), estimateIds: new Set(numberingAfterSaveQueue.estimateIds) };
  numberingAfterSaveQueue.jobIds.clear();
  numberingAfterSaveQueue.estimateIds.clear();
  try {
    const { repaired } = await ensureExistingSharedSalesNumbers(only);
    if (repaired) {
      queueDurableRecordsSave();
      renderDurableUpdateWhenIdle();
    }
    return repaired;
  } catch (error) {
    console.warn("Numbers could not be given to the records just saved", error);
    return 0;
  }
}

function getSalesNumbering() {
  if (!salesNumbering) salesNumbering = window.CrmSalesNumbering.create({
    companyId: supabaseStateId(), rpc: (name, payload) => cloudClient.rpc(name, payload),
  });
  return salesNumbering;
}

async function reserveSharedSalesNumbers(leadId, jobId = "", estimateId = "") {
  if (!canUseCloudSync()) return null;
  if (!cloudReady || !cloudClient || !durableRecordsReady || durableWriteBlocked || !window.RooflineAuth.isEditorSessionCurrent()) {
    throw new Error("Shared numbering is not ready. Keep this page open and try again.");
  }
  const identity = squareSendIdentity();
  const result = await getSalesNumbering().reserve({ leadId, jobId, estimateId });
  if (identity !== squareSendIdentity() || !window.RooflineAuth.isEditorSessionCurrent()) throw new Error("The signed-in account changed.");
  state.contacts = state.contacts.map(contact => contact.id !== leadId ? contact : {
    ...contact, leadNumber: result.leadNumber,
    jobs: contactJobs(contact).map(job => job.id === jobId ? { ...job, projectNumber: result.projectNumber } : job),
  });
  const estimate = estimateId && state.estimates.find(item => item.id === estimateId);
  if (estimate) {
    estimate.leadNumber = result.leadNumber;
    estimate.projectNumber = result.projectNumber;
    estimate.estimateNumber = result.estimateNumber;
  }
  saveState({ localOnly: true });
  return result;
}

function leadActivityTimestamp(contact = {}) {
  const candidates = [contact.updatedAt, contact.createdAt];
  (contact.updates || []).forEach((update) => candidates.push(update.createdAt));
  contactJobs(contact).forEach((job) => {
    candidates.push(job.updatedAt, job.createdAt, job.lastPaymentAt, job.squareLastPaymentAt);
    (job.costItems || []).forEach((item) => candidates.push(item.updatedAt, item.createdAt, item.date));
    (job.emails || []).forEach((email) => candidates.push(email.updatedAt, email.createdAt));
    (job.manualPayments || []).forEach((payment) => candidates.push(payment.updatedAt, payment.createdAt, payment.date));
  });
  (contact.documents || []).forEach((document) => candidates.push(document.updatedAt, document.uploadedAt));
  state.estimates
    .filter((estimate) => estimate.contactId === contact.id)
    .forEach((estimate) => candidates.push(estimate.updatedAt, estimate.sentAt, estimate.createdAt, estimate.issueDate));
  return candidates.reduce((latest, value) => {
    const timestamp = localTimestamp(value);
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
}

function sortLeadIntakeChronologically(contacts = []) {
  return contacts
    .map((contact, index) => ({ contact, index }))
    .sort((left, right) => {
      const activityDifference = leadActivityTimestamp(right.contact) - leadActivityTimestamp(left.contact);
      if (activityDifference) return activityDifference;
      const createdDifference = (Date.parse(right.contact.createdAt || "") || 0) - (Date.parse(left.contact.createdAt || "") || 0);
      return createdDifference || left.index - right.index;
    })
    .map(({ contact }) => contact);
}

function liveLeadSearchMatches(query = state.search, limit = 8) {
  const normalizedQuery = normalizeLeadSearch(query);
  if (!normalizedQuery) return { matches: [], total: 0 };
  const scored = visibleContacts()
    .map((contact) => {
      const name = normalizeLeadSearch(contact.name);
      const leadNumber = normalizeLeadSearch(contact.leadNumber);
      const email = String(contact.email || "").toLowerCase();
      const phone = String(contact.phone || "").toLowerCase();
      const phoneDigits = phone.replace(/\D/g, "");
      if (!contactMatchesSearch(contact, query)) return null;
      let score = 50;
      const rawQuery = String(query || "").trim().toLowerCase();
      const queryDigits = rawQuery.replace(/\D/g, "");
      // An exact match on any identifying field always comes first. (An exact
      // email used to rank below a lead whose name merely contained the text.)
      const exactEstimate = (state.estimates || []).some((estimate) => estimate.contactId === contact.id && normalizeLeadSearch(estimate.estimateNumber) === normalizedQuery);
      if (name === normalizedQuery || leadNumber === normalizedQuery || (email && email === rawQuery)
        || (queryDigits.length >= 7 && phoneDigits === queryDigits) || exactEstimate) score = 0;
      else if (name.startsWith(normalizedQuery)) score = 5;
      else if (leadNumber.startsWith(normalizedQuery)) score = 8;
      else if (name.split(/\s+/).some((part) => part.startsWith(normalizedQuery))) score = 10;
      else if (email.startsWith(normalizedQuery)) score = 15;
      else if (normalizedQuery.replace(/\D/g, "") && phoneDigits.startsWith(normalizedQuery.replace(/\D/g, ""))) score = 15;
      else if (name.includes(normalizedQuery)) score = 20;
      return { contact, score };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || String(a.contact.name).localeCompare(String(b.contact.name)));
  return { matches: scored.slice(0, limit).map((item) => item.contact), total: scored.length };
}

function hideLiveSearchResults() {
  els.globalSearchResults?.classList.add("hidden");
  els.globalSearch?.setAttribute("aria-expanded", "false");
  els.globalSearch?.removeAttribute("aria-activedescendant");
}

function renderLiveSearchResults() {
  if (!els.globalSearchResults || !els.globalSearch) return;
  const query = state.search.trim();
  if (!query || document.activeElement !== els.globalSearch) {
    hideLiveSearchResults();
    return;
  }
  const { matches, total } = liveLeadSearchMatches(query);
  liveSearchActiveIndex = matches.length
    ? Math.min(Math.max(liveSearchActiveIndex, -1), matches.length - 1)
    : -1;
  els.globalSearchResults.innerHTML = matches.length
    ? `${matches
        .map((contact, index) => {
          const job = searchResultJob(contact, query);
          const meta = [contact.leadNumber, contact.phone, contact.email].filter(Boolean).join(" · ");
          return `
            <button
              class="live-search-result ${index === liveSearchActiveIndex ? "is-active" : ""}"
              id="liveSearchResult${index}"
              type="button"
              role="option"
              aria-selected="${index === liveSearchActiveIndex}"
              data-live-search-contact="${escapeHtml(contact.id)}"
              data-live-search-job="${escapeHtml(job?.id || "")}"
            >
              <span class="live-search-result-avatar">${escapeHtml(contactInitials(contact.name))}</span>
              <span class="live-search-result-copy">
                <strong>${escapeHtml(contact.name || "Unnamed lead")}</strong>
                <span>${escapeHtml(meta || job?.address?.split("\n")[0] || "No contact details")}</span>
                ${job ? `<span class="live-search-job">${escapeHtml([job.projectNumber, job.name, job.address?.split("\n")[0]].filter(Boolean).join(" · "))}</span>` : ""}
              </span>
              <span class="status-pill ${statusPillClass(job?.status || contact.status)}">${escapeHtml(job?.status || contact.status || "New")}</span>
            </button>`;
        })
        .join("")}
      <div class="live-search-count">${total > matches.length ? `Showing ${matches.length} of ${total} matches` : `${total} match${total === 1 ? "" : "es"}`}</div>`
    : '<div class="live-search-empty">No matching leads yet</div>';
  els.globalSearchResults.classList.remove("hidden");
  els.globalSearch.setAttribute("aria-expanded", "true");
  if (liveSearchActiveIndex >= 0) {
    els.globalSearch.setAttribute("aria-activedescendant", `liveSearchResult${liveSearchActiveIndex}`);
    els.globalSearchResults.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  } else {
    els.globalSearch.removeAttribute("aria-activedescendant");
  }
}

function renderSearchFilteredView() {
  const renderers = {
    leads: renderLeadsView,
    contacts: renderContacts,
    jobs: renderJobsView,
    projects: renderProjectsView,
    estimates: renderEstimates,
  };
  renderers[state.view]?.();
}

function openLiveSearchResult(contactId, jobId = "") {
  if (!contactId) return;
  state.search = "";
  liveSearchActiveIndex = -1;
  els.globalSearch.value = "";
  hideLiveSearchResults();
  openLeadDetail(contactId, "overview", jobId);
}

function filteredEstimates() {
  const query = state.search.trim().toLowerCase();
  const estimates = visibleEstimates();
  if (!query) return estimates;
  return estimates.filter((estimate) => {
    const contact = getEstimateContact(estimate);
    return [
      estimate.estimateNumber,
      estimate.projectTitle,
      estimate.status,
      estimate.scopeSummary,
      contact?.name,
      contact?.email,
      ...estimate.items.flatMap((item) => [item.title, item.description]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function totalsFor(estimate) {
  // Sum rounded line cents, matching displayed line amounts and Square orders.
  const subtotalCents = estimate.items.reduce(
    (sum, item) => sum + Math.round(number(item.quantity) * Math.round(number(item.rate) * 100)),
    0,
  );
  const subtotal = subtotalCents / 100;
  const taxCents = Math.round(subtotalCents * number(estimate.taxRate) / 100);
  const tax = taxCents / 100;
  const total = (subtotalCents + taxCents) / 100;
  const balance = Math.max(subtotalCents + taxCents - Math.round(number(estimate.deposit) * 100), 0) / 100;
  return { subtotal, tax, total, balance };
}

function estimateLineAmount(item = {}) {
  return Math.round(number(item.quantity) * Math.round(number(item.rate) * 100)) / 100;
}

function invalidEstimateLineItems(estimate = {}) {
  return (estimate.items || []).filter((item) =>
    !String(item.title || "").trim() || !Number.isFinite(Number(item.quantity)) || number(item.quantity) <= 0 ||
    !Number.isFinite(Number(item.rate)) || number(item.rate) < 0,
  );
}

function statusPillClass(status = "") {
  if (globalThis.window?.RooflineProductionFlow?.statusPillClass) return window.RooflineProductionFlow.statusPillClass(status);
  const s = status.toLowerCase().replace(/\s+/g, "-");
  if (s === "won" || s === "approved" || s === "completed") return "pill-won";
  if (s === "lost" || s === "rejected") return "pill-lost";
  if (s === "estimate-sent" || s === "sent") return "pill-sent";
  if (s === "inspection") return "pill-inspection";
  if (s === "contacted") return "pill-contacted";
  if (s === "new") return "pill-new";
  if (s === "in-progress" || s === "in_progress") return "pill-inspection";
  return "pill-default";
}

function contactInitials(name = "") {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function initialsColor(name = "") {
  const colors = ["avatar-blue", "avatar-teal", "avatar-purple", "avatar-amber", "avatar-coral"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

// Date-only strings ("2026-10-01") are local calendar days, not UTC midnight.
function localTimestamp(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`).getTime() : Date.parse(text);
}

function staleLeadDays(contact) {
  if (!contact.lastContact) return 0;
  const last = localTimestamp(contact.lastContact);
  if (!Number.isFinite(last)) return 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lastDay = new Date(last);
  lastDay.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today - lastDay) / (1000 * 60 * 60 * 24)));
}

function staleClass(contact) {
  if (globalThis.window?.RooflineProductionFlow?.staleClass) return window.RooflineProductionFlow.staleClass(contact);
  if (["Won", "Lost"].includes(contact.status)) return "";
  const days = staleLeadDays(contact);
  if (days >= 14) return "stale-red";
  if (days >= 7) return "stale-amber";
  return "";
}

// Phone numbers typed or imported without punctuation ("2393516922") are shown
// in the same (239) 351-6922 form as the rest. Anything that is not a standard
// US number is shown exactly as it was entered.
function displayPhone(phone = "") {
  const text = String(phone || "").trim();
  const digits = text.replace(/\D/g, "");
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1")) ? formatPhoneNumber(digits) : text;
}

function telLink(phone = "") {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return `<a class="tel-link" href="tel:${digits}">${escapeHtml(displayPhone(phone))}</a>`;
}

// Leads that look like the same person: same phone number, same email, or the
// same name at the same address. Used to warn before saving a new lead and to
// list possible duplicates on the Contacts page.
function contactIdentityKeys(contact = {}) {
  const keys = [];
  const digits = String(contact.phone || "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length >= 10) keys.push(`phone:${digits}`);
  const email = String(contact.email || "").trim().toLowerCase();
  if (email) keys.push(`email:${email}`);
  const name = normalizeLeadSearch(contact.name);
  const address = normalizeLeadSearch(String(contact.address || "").split("\n")[0]);
  if (name && address) keys.push(`name-address:${name}|${address}`);
  return keys;
}

function findDuplicateContacts(candidate = {}, contacts = state.contacts) {
  const keys = new Set(contactIdentityKeys(candidate));
  if (!keys.size) return [];
  return contacts.filter((contact) => contact.id !== candidate.id && contactIdentityKeys(contact).some((key) => keys.has(key)));
}

function duplicateContactIds(contacts = state.contacts) {
  const byKey = new Map();
  contacts.forEach((contact) => contactIdentityKeys(contact).forEach((key) => {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(contact.id);
  }));
  const ids = new Set();
  byKey.forEach((group) => { if (group.length > 1) group.forEach((id) => ids.add(id)); });
  return ids;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizePersonName(value = "") {
  const name = String(value || "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim()
    .replace(/\s+/g, " ");
  const parts = name.split(" ").filter(Boolean);
  if (parts.length >= 4 && parts.length % 2 === 0) {
    const midpoint = parts.length / 2;
    const first = parts.slice(0, midpoint).join(" ");
    const second = parts.slice(midpoint).join(" ");
    if (first.localeCompare(second, undefined, { sensitivity: "accent" }) === 0) return first;
  }
  return name;
}

function canonicalRepresentativeName(value = "", record = {}) {
  const rawName = normalizePersonName(value);
  const ownerId = record.ownerUserId || record.userId || "";
  const ownerEmail = String(record.ownerEmail || record.email || "").trim().toLowerCase();
  const knownOwners = [...cloudKnownOwners.values(), currentOwner()].filter(Boolean);
  const directOwner = knownOwners.find((owner) =>
    (ownerId && owner.userId === ownerId) ||
    (ownerEmail && String(owner.email || "").trim().toLowerCase() === ownerEmail),
  );
  if (directOwner?.name) return normalizePersonName(directOwner.name);
  if (!rawName) return "";

  const rawParts = rawName.toLocaleLowerCase().split(" ");
  const compatible = [...new Set(knownOwners
    .map((owner) => normalizePersonName(owner.name))
    .filter(Boolean)
    .filter((knownName) => {
      const knownParts = knownName.toLocaleLowerCase().split(" ");
      const firstMatches = knownParts[0] === rawParts[0] ||
        (rawParts[0].length >= 3 && knownParts[0].startsWith(rawParts[0])) ||
        (knownParts[0].length >= 3 && rawParts[0].startsWith(knownParts[0]));
      if (!firstMatches) return false;
      if (rawParts.length === 1) return true;
      return knownParts.at(-1) === rawParts.at(-1);
    }))];
  return compatible.length === 1 ? compatible[0] : rawName;
}

function nl2br(value = "") {
  return escapeHtml(value).replaceAll("\n", "<br />");
}

function formatDate(value) {
  if (!value) return "Not set";
  const text = String(value);
  // Date-only values are local calendar days; full timestamps (e.g. Square's paidAt) parse as-is.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "Not set";
  // A date with no time ("2026-11-21") is a calendar day, not midnight UTC.
  // Parsing it as a timestamp showed the previous evening ("Nov 20, 7:00 PM")
  // for anything created on Nov 21 in Florida. Show the day, with no made-up time.
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return formatDate(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(size) {
  const bytes = number(size);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function canAssignLeadOwners() {
  // Operations managers may not write estimate rows, so they cannot move a
  // whole lead (with its estimates) to another rep.
  return ["admin", "office_manager", "sales_manager"].includes(currentRole());
}

async function loadAssignableTeam() {
  if (!canAssignLeadOwners() || !cloudClient?.rpc) return;
  const { data, error } = await cloudClient.rpc("crm_assignable_users");
  if (error) {
    console.warn("Team list for Sales Rep assignment is unavailable", error);
    return;
  }
  assignableTeam = (data || []).filter((row) => row.user_id).map((row) => ({
    userId: row.user_id,
    email: String(row.email || "").trim().toLowerCase(),
    name: normalizePersonName(row.name || String(row.email || "").split("@")[0]),
    role: row.role || "sales",
  }));
  assignableTeam.forEach((member) => cloudKnownOwners.set(member.userId, member));
  renderSalesRepOptions();
}

function assignableTeamMember(value) {
  const key = normalizePersonName(value).toLocaleLowerCase();
  if (!key) return null;
  return assignableTeam.find((member) => member.name.toLocaleLowerCase() === key || member.email === key) || null;
}

// The database shows a rep only the rows they own, so the Sales Rep chosen on
// a lead must also own the lead, its jobs, its estimates and the tasks that
// followed the previous owner. Documents always follow the lead's owner.
function applySalesRepAssignment(contact) {
  if (!contact || !canAssignLeadOwners()) return contact;
  const member = assignableTeamMember(contact.salesRep);
  if (!member) return contact;
  const owner = { ownerUserId: member.userId, ownerEmail: member.email, ownerName: member.name };
  const previousOwnerId = contact.ownerUserId || "";
  const jobs = (contact.jobs || []).map((job) => ({ ...job, ...owner, salesRep: member.name }));
  if (member.userId === previousOwnerId && (contact.jobs || []).every((job) => !job.ownerUserId || job.ownerUserId === member.userId)) {
    return { ...contact, salesRep: member.name, jobs };
  }
  state.estimates = state.estimates.map((estimate) =>
    estimate.contactId === contact.id ? { ...estimate, ...owner, projectManager: member.name, salesRepEmail: member.email } : estimate,
  );
  state.calendarTasks = state.calendarTasks.map((task) =>
    task.contactId === contact.id && (!task.ownerUserId || task.ownerUserId === previousOwnerId)
      ? normalizeCalendarTask({ ...task, ...owner, rep: member.name })
      : task,
  );
  return { ...contact, ...owner, salesRep: member.name, jobs };
}

// A person's name has at least two letters and no digits. Stray keystrokes
// saved as a sales rep ("6y") otherwise become a rep in every list and report.
function isPlausiblePersonName(value = "") {
  const name = normalizePersonName(value);
  return (name.match(/\p{L}/gu) || []).length >= 2 && !/\d/.test(name);
}

function uniqueSalesReps() {
  const unique = new Map();
  const teamNames = new Set(assignableTeam.map((member) => canonicalRepresentativeName(member.name).toLocaleLowerCase()));
  [
    ...assignableTeam.map((member) => member.name),
    ...visibleContacts().map((contact) => contact.salesRep),
    ...allJobs().map((job) => job.salesRep),
    ...visibleCalendarTasks().map((task) => task.rep),
    state.currentUser.name,
  ].forEach((value) => {
    const name = canonicalRepresentativeName(value);
    const key = name.toLocaleLowerCase();
    // Team members are always offered; names found on records must look like names.
    if (!teamNames.has(key) && !isPlausiblePersonName(name)) return;
    if (name && name !== "Unassigned" && !unique.has(key)) unique.set(key, name);
  });
  return [...unique.values()].sort((a, b) => a.localeCompare(b));
}

// Used when a lead or job is saved: refuses a sales rep that is not a name.
function salesRepNameProblem(value = "") {
  const name = normalizePersonName(value);
  if (!name || name === "Unassigned") return "";
  return isPlausiblePersonName(name) ? "" : `"${name}" does not look like a sales representative's name. Enter the rep's name, or leave it blank for Unassigned.`;
}

function renderSalesRepOptions() {
  if (!els.salesRepOptions) return;
  els.salesRepOptions.innerHTML = uniqueSalesReps()
    .map((rep) => `<option value="${escapeHtml(rep)}"></option>`)
    .join("");
  // Offer the sources already in use, so the same source is not typed five ways.
  const sourceField = els.contactForm?.elements?.source;
  if (!sourceField || typeof document.createElement !== "function") return;
  let sourceOptions = document.getElementById("leadSourceOptions");
  if (!sourceOptions) {
    sourceOptions = document.createElement("datalist");
    sourceOptions.id = "leadSourceOptions";
    els.salesRepOptions.after(sourceOptions);
    sourceField.setAttribute("list", "leadSourceOptions");
  }
  const sources = [...new Set(["Website", "Referral", "Google", "Facebook", "Repeat customer", "Door knock", "Yard sign",
    ...state.contacts.map((contact) => contact.source).filter(Boolean)].map(leadSourceLabel))]
    .filter((source) => source !== "No source").sort((a, b) => a.localeCompare(b));
  sourceOptions.innerHTML = sources.map((source) => `<option value="${escapeHtml(source)}"></option>`).join("");
}

function taskDueTime(task) {
  const date = new Date(task.dueAt);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function googleDate(value) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function googleCalendarUrl(task) {
  const start = taskDueTime(task);
  const end = new Date(start.getTime() + (number(task.duration) || 30) * 60 * 1000);
  const contact = getContact(task.contactId);
  const details = [
    task.notes,
    task.rep ? `Sales Representative: ${task.rep}` : "",
    contact ? `Related Lead: ${contact.name}` : "",
    contact?.phone ? `Phone: ${contact.phone}` : "",
    contact?.email ? `Email: ${contact.email}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: task.title,
    dates: `${googleDate(start)}/${googleDate(end)}`,
    details,
  });
  if (contact?.address) params.set("location", contact.address.replaceAll("\n", ", "));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function taskGoogleSyncLabel(task) {
  if (task.googleSyncStatus === "synced") return '<span class="status-pill pill-won">Google synced</span>';
  if (task.googleSyncStatus === "pending") return '<span class="status-pill pill-inspection">Google pending</span>';
  if (task.googleSyncStatus === "not_connected") return '<span class="status-pill pill-default">Google not connected</span>';
  if (task.googleSyncStatus === "error") return '<span class="status-pill pill-rejected">Google sync failed</span>';
  return "";
}

function taskGoogleTasksSyncLabel(task) {
  if (task.googleTaskSyncStatus === "synced") return '<span class="status-pill pill-won">Google Tasks synced</span>';
  if (task.googleTaskSyncStatus === "pending") return '<span class="status-pill pill-inspection">Google Tasks pending</span>';
  if (task.googleTaskSyncStatus === "not_connected") return '<span class="status-pill pill-default">Google Tasks not connected</span>';
  if (task.googleTaskSyncStatus === "error") return '<span class="status-pill pill-rejected">Google Tasks sync failed</span>';
  return "";
}

async function persistCalendarTaskUpdate(taskId) {
  saveState({ localOnly: true });
  if (!canUseCloudSync()) return true;
  try {
    const saved = await persistDurableRecordNow("task", taskId, (data) => data.id === taskId);
    if (saved) queueCloudSave();
    else queueDurableRecordsSave();
    return saved;
  } catch {
    queueDurableRecordsSave();
    return false;
  }
}

async function syncCalendarTaskToGoogle(task) {
  const snapshot = normalizeCalendarTask(JSON.parse(JSON.stringify(task)));
  const contact = getContact(snapshot.contactId);
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/calendar/event", {
      method: "POST", headers, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({
        ownerEmail: snapshot.ownerEmail || currentOwner().email,
        task: snapshot,
        contact: contact ? { name: contact.name, phone: contact.phone, email: contact.email, address: contact.address } : null,
      }),
    });
    const result = await response.json().catch(() => ({}));
    const current = state.calendarTasks.find((item) => item.id === snapshot.id);
    if (!current || current.title !== snapshot.title || current.dueAt !== snapshot.dueAt || current.ownerEmail !== snapshot.ownerEmail) return false;
    if (!response.ok || result?.synced !== true) {
      const notConnected = response.status === 409 && result?.code === "google_not_connected";
      Object.assign(current, {
        googleSyncStatus: notConnected ? "not_connected" : "error",
        googleSyncError: String(result?.error || "Google Calendar could not be updated.").slice(0, 300),
      });
      await persistCalendarTaskUpdate(current.id);
      if (state.view === "calendar" || state.view === "tasks") render();
      return false;
    }
    Object.assign(current, {
      googleEventId: result.eventId,
      googleEventUrl: result.htmlLink || "",
      googleMeetLink: result.meetLink || "",
      googleSyncStatus: "synced",
      googleSyncedAt: result.updated || new Date().toISOString(),
      googleSyncError: "",
    });
    await persistCalendarTaskUpdate(current.id);
    await syncCalendarTaskToGoogleTasks(current);
    if (state.view === "calendar" || state.view === "tasks") render();
    return true;
  } catch {
    const current = state.calendarTasks.find((item) => item.id === snapshot.id);
    if (current && current.title === snapshot.title && current.dueAt === snapshot.dueAt) {
      current.googleSyncStatus = "error";
      current.googleSyncError = "Google Calendar could not be reached.";
      await persistCalendarTaskUpdate(current.id);
      if (state.view === "calendar" || state.view === "tasks") render();
    }
    return false;
  }
}

async function syncCalendarTaskToGoogleTasks(task) {
  const snapshot = normalizeCalendarTask(JSON.parse(JSON.stringify(task)));
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/tasks/task", {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ ownerEmail: snapshot.ownerEmail || currentOwner().email, task: snapshot }),
    });
    const result = await response.json().catch(() => ({}));
    const current = state.calendarTasks.find((item) => item.id === snapshot.id);
    if (!current || current.updatedAt !== snapshot.updatedAt) return false;
    if (!response.ok || result?.synced !== true) {
      Object.assign(current, {
        googleTaskSyncStatus: response.status === 409 ? "not_connected" : "error",
        googleTaskSyncError: String(result?.error || "Google Tasks could not be updated.").slice(0, 300),
      });
      await persistCalendarTaskUpdate(current.id);
      return false;
    }
    Object.assign(current, {
      googleTaskId: result.taskId,
      googleTaskListId: result.taskListId,
      googleTaskSyncStatus: "synced",
      googleTaskSyncedAt: result.updated || new Date().toISOString(),
      googleTaskSyncError: "",
    });
    await persistCalendarTaskUpdate(current.id);
    return true;
  } catch {
    const current = state.calendarTasks.find((item) => item.id === snapshot.id);
    if (current && current.updatedAt === snapshot.updatedAt) {
      current.googleTaskSyncStatus = "error";
      current.googleTaskSyncError = "Google Tasks could not be reached.";
      await persistCalendarTaskUpdate(current.id);
    }
    return false;
  }
}

async function removeCalendarTaskFromGoogle(task) {
  if (!task?.googleEventId) return true;
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/calendar/event", {
      method: "DELETE", headers, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ ownerEmail: task.ownerEmail || currentOwner().email, eventId: task.googleEventId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.deleted !== true) {
      showToast(result?.error || "Google Calendar could not remove the event.");
      return false;
    }
    return true;
  } catch {
    showToast("Google Calendar could not be reached. The CRM task was kept to prevent an orphaned event.");
    return false;
  }
}

async function removeTaskFromGoogleTasks(task) {
  if (!task?.googleTaskId || !task?.googleTaskListId) return true;
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/tasks/task", {
      method: "DELETE", headers: { "Content-Type": "application/json", ...headers }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ ownerEmail: task.ownerEmail || currentOwner().email, taskId: task.googleTaskId, taskListId: task.googleTaskListId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.deleted !== true) {
      showToast(result?.error || "Google Tasks could not remove the task.");
      return false;
    }
    return true;
  } catch {
    showToast("Google Tasks could not be reached. The CRM task was kept to prevent an orphaned task.");
    return false;
  }
}

function upcomingTasks(limit = 6) {
  const now = new Date();
  return [...visibleCalendarTasks()]
    .filter((task) => !task.completed && taskDueTime(task) >= now)
    .sort((a, b) => taskDueTime(a) - taskDueTime(b))
    .slice(0, limit);
}

function dateFromISO(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rangeStart(range) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (range === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    return start;
  }
  if (range === "ytd") {
    return new Date(now.getFullYear(), 0, 1);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function isInLeaderboardRange(contact, range) {
  const closedDate = dateFromISO(contact.closedDate || contact.lastContact || contact.createdAt);
  if (!closedDate) return false;
  return closedDate >= rangeStart(range);
}

function estimateTotal(estimate) {
  return totalsFor(estimate).total;
}

// Where company-wide figures come from. One source per number:
//   "local"   every lead and job is in memory, so totals are computed here and
//             update the moment a record changes;
//   "pending" not every lead and job has loaded: show nothing rather than a
//             partial total.
// There used to be a third answer: after several failed attempts the
// Dashboard and Reports switched to totals worked out by the database. Those
// are defined differently (its "collected" is only the money on jobs marked
// Paid, not every confirmed payment) and Billing had no such fallback, so the
// three screens could show different things under the same label. Now all
// three ask the same question and either show the real figure or none, and
// the load keeps being retried (see scheduleCompleteCoreRecordsRetry).
function dashboardDataSource() {
  return coreRecordsArePartial() ? "pending" : "local";
}

// One money ledger for the dashboard, Billing and Reports: job payments
// (manual and Square), invoice payments, refunds, expenses and credits.
function ledgerTotals(entries = financialLedgerEntries()) {
  const sum = (kind) => entries.filter((entry) => entry.kind === kind).reduce((total, entry) => total + number(entry.amount), 0);
  const payments = sum("Payment");
  const refunds = sum("Refund");
  return { payments, refunds, collected: Math.max(payments - refunds, 0), expenses: sum("Expense"), credits: sum("Credit") };
}

// ---- The same totals, worked out by the database ----------------------------
// crm_ledger_totals() adds up the same ledger on the server, for the records
// the signed-in user is allowed to see. It is used for two things:
//   1. as a check: once every record has loaded, this browser's ledger and the
//      database's must agree to the cent;
//   2. as an early answer: while records are still loading, the money figures
//      can be shown at once instead of "…", but only if the last check in this
//      browser agreed. Until then the screens wait for the full load, as before.
let serverLedgerTotals = null;
let serverLedgerTotalsLoad = null;
const SERVER_LEDGER_CHECK_KEY = "jobcrest-ledger-check-v1";
const SERVER_LEDGER_CHECK_MAX_AGE = 30 * 86400000;

function normalizeServerLedgerTotals(payload) {
  const keys = ["payments", "refunds", "collected", "expenses"];
  if (!payload || typeof payload !== "object" || keys.some((key) => payload[key] === undefined || payload[key] === null)) return null;
  // Money on a job's record that has no row in the payments table. The
  // database files that row in the same save as the job, so this is 0 unless
  // something is wrong there. It is still counted in the totals above.
  if (number(payload.unsyncedJobPayments) > 0.005) {
    console.warn("Payments recorded on jobs are missing from the payments table. The totals still include them.", { amount: number(payload.unsyncedJobPayments) });
  }
  return { payments: number(payload.payments), refunds: number(payload.refunds), collected: number(payload.collected), expenses: number(payload.expenses), credits: number(payload.credits) };
}

async function refreshServerLedgerTotals() {
  if (!canUseCloudSync() || !cloudClient || !authSession?.user?.id) return null;
  if (serverLedgerTotalsLoad) return serverLedgerTotalsLoad;
  serverLedgerTotalsLoad = (async () => {
    const { data, error } = await cloudClient.rpc("crm_ledger_totals");
    if (error) throw error;
    serverLedgerTotals = normalizeServerLedgerTotals(data);
    return serverLedgerTotals;
  })().catch((error) => {
    // Not installed yet, or unreachable: the screens wait for the full load.
    console.warn("The database's ledger totals could not be read", error);
    return null;
  }).finally(() => { serverLedgerTotalsLoad = null; });
  return serverLedgerTotalsLoad;
}

function serverLedgerCheckKey() {
  return `${SERVER_LEDGER_CHECK_KEY}:${authSession?.user?.id || "anonymous"}`;
}

function readServerLedgerCheck() {
  try {
    return JSON.parse(window.localStorage.getItem(serverLedgerCheckKey()) || "null");
  } catch {
    return null;
  }
}

// True when this browser compared the database's totals with its own ledger
// recently and they agreed.
function serverLedgerIsTrusted(now = Date.now()) {
  const check = readServerLedgerCheck();
  return Boolean(check?.matched) && now - number(check.checkedAt) < SERVER_LEDGER_CHECK_MAX_AGE;
}

function ledgerFiguresAgree(local, server) {
  return ["payments", "refunds", "collected", "expenses"].every((key) => Math.abs(number(local?.[key]) - number(server?.[key])) < 0.005);
}

// Runs once every record is in memory and nothing is waiting to be saved.
// Returns true or false when the two were compared, null when the moment was
// wrong (a save in progress: worth trying again), and undefined when the
// database gave no answer (not installed yet: nothing to try again for).
async function compareServerLedgerWithLocal() {
  const settled = () => !coreRecordsArePartial() && financialLedgerReady && !durableSaveInFlight && !hasPendingDurableChanges();
  if (!settled()) return null;
  const revision = localEditRevision;
  const server = await refreshServerLedgerTotals();
  if (!server) return undefined;
  // A payment recorded while the question was being asked would be a false alarm.
  if (revision !== localEditRevision || !settled()) return null;
  const local = ledgerTotals();
  const matched = ledgerFiguresAgree(local, server);
  try {
    window.localStorage.setItem(serverLedgerCheckKey(), JSON.stringify({
      matched, checkedAt: Date.now(), local: { payments: local.payments, refunds: local.refunds, collected: local.collected, expenses: local.expenses }, server,
    }));
  } catch {
    // A private window cannot remember the result; the next visit just waits for the full load.
  }
  if (!matched) console.warn("The database's ledger totals differ from this browser's. The browser's figures are shown.", { local, server });
  return matched;
}

// The check often lands while the app is still saving something from startup.
// Try a few more times, a few seconds apart, until it can be made.
let serverLedgerCheckAttempts = 0;
function scheduleServerLedgerCheck() {
  if (serverLedgerCheckAttempts >= 6) return;
  serverLedgerCheckAttempts += 1;
  void compareServerLedgerWithLocal().then((verdict) => {
    if (verdict === null && !coreRecordsArePartial()) window.setTimeout(scheduleServerLedgerCheck, 5000);
  });
}

// The money figures for the Dashboard, Billing and Reports, decided in one place:
//   every record loaded  -> this browser's ledger, which updates the moment a
//                           payment is recorded;
//   still loading        -> the database's figure, if it has been checked here;
//   otherwise            -> nothing yet.
function moneyTotalsForDisplay(entries) {
  if (!coreRecordsArePartial()) return { ready: true, source: "local", ...ledgerTotals(entries) };
  if (serverLedgerTotals && serverLedgerIsTrusted()) return { ready: true, source: "server", ...serverLedgerTotals };
  return { ready: false, source: "pending", payments: 0, refunds: 0, collected: 0, expenses: 0, credits: 0 };
}

function dashboardMetrics() {
  const source = dashboardDataSource();
  if (source === "pending") {
    // Counts need every record. Money may already be known from the database.
    const early = moneyTotalsForDisplay();
    return { source, pending: true, moneyReady: early.ready, leads: 0, openLeads: 0, totalJobs: 0, estimatesSent: 0, openContracts: 0, openValue: 0, closedJobs: 0, closedValue: early.ready ? early.collected : 0, pipelineValue: 0 };
  }
  const contacts = visibleContacts();
  const estimates = visibleEstimates();
  const leads = contacts.length;
  const openLeads = contacts.filter((contact) => contactJobs(contact).some((job) => !["Paid", "Lost"].includes(job.status))).length;
  const jobs = allJobs();
  const openContracts = jobs.filter((job) => !["Paid", "Lost"].includes(job.status));
  const closedJobs = jobs.filter(jobHasFullPayment);
  const estimatesSent = estimates.filter((estimate) =>
    ["Sent", "Won"].includes(estimate.status),
  ).length;
  const pipelineValue = jobs
    .filter((job) => job.status !== "Lost")
    .reduce((sum, job) => sum + number(job.value), 0);
  return {
    source,
    moneyReady: true,
    leads,
    openLeads,
    totalJobs: jobs.length,
    estimatesSent,
    openContracts: openContracts.length,
    openValue: openContracts.reduce((sum, job) => sum + number(job.value), 0),
    closedJobs: closedJobs.length,
    // Every confirmed payment, from the same ledger Billing and Reports use.
    // This used to count only the money on jobs that were paid in full, so the
    // dashboard showed far less than Billing for the same records.
    closedValue: ledgerTotals().collected,
    pipelineValue,
  };
}

// Payments received per calendar month, by the date each payment was made.
function collectedByMonth(months, entries = financialLedgerEntries()) {
  entries.filter((entry) => entry.kind === "Payment" || entry.kind === "Refund").forEach((entry) => {
    const stamp = activityTimestamp(entry.at);
    if (!Number.isFinite(stamp) || !stamp) return;
    const date = new Date(stamp);
    const bucket = months.find((month) => month.year === date.getFullYear() && month.month === date.getMonth());
    if (bucket) bucket.value += entry.kind === "Refund" ? -number(entry.amount) : number(entry.amount);
  });
  months.forEach((month) => { month.value = Math.max(0, Math.round(month.value * 100) / 100); });
  return months;
}

function aggregateCounts(items, keyGetter, valueGetter = () => 1) {
  const groups = items.reduce((acc, item) => {
    const key = keyGetter(item) || "Other";
    if (!acc.has(key)) acc.set(key, { label: key, count: 0, value: 0 });
    const group = acc.get(key);
    group.count += 1;
    group.value += number(valueGetter(item));
    return acc;
  }, new Map());
  return [...groups.values()].sort((a, b) => b.count - a.count || b.value - a.value);
}

// A job's type is the service chosen for it. This used to guess from words in
// the job name and called everything else "Roof Replacement", so Construction
// and Home Services jobs were all counted as roof replacements.
function jobType(job = {}) {
  const services = state.services?.length ? state.services : defaultServices;
  const service = services.find((item) => item.id === job.service && (!job.division || item.divisionId === job.division))
    || services.find((item) => item.id === job.service);
  if (service?.name) return service.name;
  const division = activeDivisions().find((item) => item.id === (job.division || "roofing"));
  return job.service ? String(job.service) : `${division?.name || "Other"} (no service chosen)`;
}

// Keeps a chart readable: the largest groups, then one "Other" slice.
function topGroupsWithOther(groups, limit = 5) {
  if (groups.length <= limit) return groups;
  const rest = groups.slice(limit - 1);
  return [...groups.slice(0, limit - 1), { label: "Other", count: rest.reduce((sum, item) => sum + item.count, 0), value: rest.reduce((sum, item) => sum + number(item.value), 0) }];
}

function dashboardActivityItems(limit = 6) {
  const updates = visibleContacts().flatMap((contact) =>
    (contact.updates || []).map((update) => ({
      icon: update.status === "Won" ? "check" : "bell",
      title: update.status ? `Status: ${update.status}` : "Client update",
      meta: `${contact.name} - ${update.message || "Update posted"}`,
      value: "",
      date: update.createdAt,
      contactId: contact.id,
    })),
  );
  const estimateItems = visibleEstimates().map((estimate) => {
    const contact = getEstimateContact(estimate);
    return {
      icon: "file",
      title: `Estimate ${estimate.status}`,
      meta: `${contact?.name || "Unknown client"} - ${estimate.projectTitle}`,
      value: money.format(estimateTotal(estimate)),
      date: `${estimate.sentAt || estimate.issueDate || todayISO()}T12:00:00`,
      contactId: contact?.id,
    };
  });
  const jobItems = allJobs().map((job) => ({
    icon: job.status === "Won" ? "dollar" : "briefcase",
    title: job.status === "Won" ? "Job Won" : job.status,
    meta: `${job.contactName} - ${job.name}`,
    value: money.format(number(job.value)),
    date: `${job.closedDate || job.lastContact || job.createdAt || todayISO()}T12:00:00`,
    contactId: job.contactId,
  }));
  return [...updates, ...estimateItems, ...jobItems]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function fieldKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function rowToObject(headers, row) {
  return headers.reduce((record, header, index) => {
    record[fieldKey(header)] = (row[index] || "").trim();
    return record;
  }, {});
}

function getCsvField(record, names) {
  for (const name of names) {
    const value = record[fieldKey(name)];
    if (value) return value;
  }
  return "";
}

function parseDateToISO(value) {
  if (!value) return "";
  const isoDate = String(value).match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return localDateISO(parsed);
  return "";
}

function mapZohoStatus(status) {
  const normalized = fieldKey(status);
  if (["converted", "closedwon", "won", "customer"].includes(normalized)) return "Won";
  if (["lost", "closedlost", "junklead", "notqualified", "unqualified"].includes(normalized)) return "Lost";
  if (["contacted", "attemptedtocontact", "followup", "working"].includes(normalized)) return "Contacted";
  if (["inspection", "siteinspection", "appointment", "scheduled"].includes(normalized)) return "Inspection";
  if (["estimatesent", "proposal", "quote", "quotesent"].includes(normalized)) return "Estimate Sent";
  return "New";
}

function zohoLeadToContact(record) {
  const firstName = getCsvField(record, ["First Name", "FirstName"]);
  const lastName = getCsvField(record, ["Last Name", "LastName"]);
  const fullName = getCsvField(record, ["Full Name", "Lead Name", "Name"]);
  const company = getCsvField(record, ["Company", "Account Name", "Organization"]);
  const email = getCsvField(record, ["Email", "Email Address"]);
  const phone = getCsvField(record, ["Phone", "Mobile", "Mobile Phone", "Home Phone"]);
  const rawStatus = getCsvField(record, ["Lead Status", "Status"]);
  const status = mapZohoStatus(rawStatus);
  const street = getCsvField(record, ["Street", "Mailing Street", "Address"]);
  const city = getCsvField(record, ["City", "Mailing City"]);
  const stateName = getCsvField(record, ["State", "Province", "Mailing State"]);
  const zip = getCsvField(record, ["Zip Code", "Zip", "Postal Code", "Mailing Zip"]);
  const country = getCsvField(record, ["Country", "Mailing Country"]);
  const address = [street, [city, stateName, zip].filter(Boolean).join(", "), country]
    .filter(Boolean)
    .join("\n");
  const createdAt = parseDateToISO(getCsvField(record, ["Created Time", "Created Date", "Created At"])) || todayISO();
  const modifiedAt = parseDateToISO(getCsvField(record, ["Modified Time", "Modified Date", "Updated At"]));
  const closedDate = parseDateToISO(getCsvField(record, ["Closed Date", "Closing Date", "Converted Time"]));
  const externalId = getCsvField(record, ["Record Id", "Lead Id", "LEADID", "Id", "Lead ID"]);
  const value = number(
    getCsvField(record, [
      "Project Value",
      "Job Value",
      "Amount",
      "Deal Amount",
      "Expected Revenue",
      "Annual Revenue",
      "Lead Value",
    ]).replace(/[$,]/g, ""),
  );

  const contact = normalizeContact({
    id: uid("contact"),
    externalSource: "Zoho CRM",
    externalId,
    type: status === "Won" ? "Customer" : "Lead",
    status,
    name: fullName || [firstName, lastName].filter(Boolean).join(" ") || company || email || "Zoho Lead",
    source: getCsvField(record, ["Lead Source", "Source"]),
    salesRep: getCsvField(record, ["Lead Owner", "Owner", "Record Owner", "Sales Representative", "Sales Rep"]),
    email,
    phone,
    address,
    value,
    lastContact: modifiedAt || createdAt,
    closedDate: closedDate || (status === "Won" ? modifiedAt || createdAt : ""),
    notes: getCsvField(record, ["Description", "Notes", "Lead Description"]),
    createdAt,
  });
  contact.zohoImportFields = {
    status: Boolean(rawStatus),
    source: Boolean(getCsvField(record, ["Lead Source", "Source"])),
    salesRep: Boolean(getCsvField(record, ["Lead Owner", "Owner", "Record Owner", "Sales Representative", "Sales Rep"])),
    value: Boolean(getCsvField(record, ["Project Value", "Job Value", "Amount", "Deal Amount", "Expected Revenue", "Annual Revenue", "Lead Value"])),
    closedDate: Boolean(closedDate),
  };
  return contact;
}

function findExistingContact(imported) {
  if (imported.externalId) {
    const match = state.contacts.find(
      (contact) => contact.externalSource === "Zoho CRM" && contact.externalId === imported.externalId,
    );
    if (match) return match;
  }

  const email = imported.email.toLowerCase();
  if (email) {
    const match = state.contacts.find((contact) => (contact.email || "").toLowerCase() === email);
    if (match) return match;
  }

  const phone = imported.phone.replace(/\D/g, "");
  if (phone) {
    return state.contacts.find((contact) => (contact.phone || "").replace(/\D/g, "") === phone);
  }

  return null;
}

function mergeImportedContact(existing, imported) {
  const merged = normalizeContact({
    ...existing,
    id: existing.id,
    externalSource: imported.externalSource || existing.externalSource,
    externalId: imported.externalId || existing.externalId,
    name: imported.name || existing.name,
    source: imported.source || existing.source,
    email: imported.email || existing.email,
    phone: imported.phone || existing.phone,
    address: imported.address || existing.address,
    createdAt: existing.createdAt || imported.createdAt,
    updatedAt: new Date().toISOString(),
    lastContact: [existing.lastContact, imported.lastContact].filter(Boolean).sort().at(-1) || existing.lastContact,
    notes: [existing.notes, imported.notes].filter(Boolean).join(existing.notes && imported.notes ? "\n\n" : ""),
    type: existing.type,
    status: existing.status,
    salesRep: existing.salesRep,
    value: existing.value,
    closedDate: existing.closedDate,
    ownerUserId: existing.ownerUserId,
    ownerEmail: existing.ownerEmail,
    ownerName: existing.ownerName,
    jobs: existing.jobs,
    documents: existing.documents,
    updates: existing.updates,
  });
  delete merged.zohoImportFields;
  return merged;
}

function cleanImportedContact(imported) {
  const clean = { ...imported };
  delete clean.zohoImportFields;
  return normalizeContact(clean);
}

// The database requires every new job to start at New, so imported leads begin
// there and keep their Zoho stage (and owner, for reps' own imports) in the
// notes for the rep to work forward through the stage checklists.
function newImportedLead(imported) {
  const lead = cleanImportedContact(imported);
  const notes = [];
  if (lead.status && lead.status !== "New") notes.push(`Zoho status: ${lead.status}`);
  if (!canAssignLeadOwners() && lead.salesRep && lead.salesRep !== "Unassigned" &&
      normalizePersonName(lead.salesRep).toLocaleLowerCase() !== normalizePersonName(state.currentUser.name).toLocaleLowerCase()) {
    notes.push(`Zoho lead owner: ${lead.salesRep}`);
  }
  const salesRep = canAssignLeadOwners() ? lead.salesRep : state.currentUser.name || lead.salesRep;
  const started = normalizeContact({
    ...lead,
    type: "Lead",
    status: "New",
    closedDate: "",
    salesRep,
    notes: [lead.notes, ...notes].filter(Boolean).join("\n"),
    jobs: [],
  });
  started.jobs = [normalizeJob({ ...contactJobs(started)[0], status: "New", salesRep, closedDate: "" }, started)];
  return applySalesRepAssignment(started);
}

function zohoDuplicateKey(contact = {}) {
  if (contact.externalId) return `external:${String(contact.externalId).trim().toLowerCase()}`;
  if (contact.email) return `email:${String(contact.email).trim().toLowerCase()}`;
  const phone = String(contact.phone || "").replace(/\D/g, "");
  return phone ? `phone:${phone}` : "";
}

async function importZohoCsv(file) {
  if (!file) return;
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) {
    showToast("No leads found in that CSV");
    return;
  }

  const headers = rows[0];
  const dataRows = rows.slice(1).filter((row) => row.some((value) => String(value || "").trim()));
  if (dataRows.length > 5000) {
    showToast("Zoho import stopped: use a CSV with 5,000 leads or fewer.");
    return;
  }
  const importedContacts = dataRows.map((row) => zohoLeadToContact(rowToObject(headers, row)));
  const duplicateKeys = new Set();
  const seenKeys = new Set();
  importedContacts.forEach((contact) => {
    const key = zohoDuplicateKey(contact);
    if (key && seenKeys.has(key)) duplicateKeys.add(key);
    if (key) seenKeys.add(key);
  });
  if (duplicateKeys.size) {
    showToast(`Zoho import stopped: ${duplicateKeys.size} duplicate lead identifier${duplicateKeys.size === 1 ? " was" : "s were"} found in the CSV.`);
    return;
  }
  const preview = importedContacts.reduce((summary, contact) => {
    if (findExistingContact(contact)) summary.updated += 1;
    else summary.added += 1;
    return summary;
  }, { added: 0, updated: 0 });
  if (!(await appConfirm(`Import ${preview.added} new lead${preview.added === 1 ? "" : "s"} and update ${preview.updated} matched lead${preview.updated === 1 ? "" : "s"}? Existing jobs, documents, stages, ownership, and financial history will be preserved; new leads start in the New stage with their Zoho status noted.`, { title: "Import from Zoho", confirmLabel: "Import" }))) return;
  let added = 0;
  let updated = 0;

  importedContacts.forEach((contact) => {
    const existing = findExistingContact(contact);
    if (existing) {
      const merged = mergeImportedContact(existing, contact);
      state.contacts = state.contacts.map((item) => (item.id === existing.id ? merged : item));
      updated += 1;
    } else {
      state.contacts.unshift(newImportedLead(contact));
      added += 1;
    }
  });

  state.view = "dashboard";
  state.search = "";
  saveState();
  render();
  showToast(`Zoho import complete: ${added} added, ${updated} updated`);
}

// Authors are stored as whatever was known when an entry was written: a name,
// an email address, or the old placeholder "Local user". Show the person's
// name wherever the CRM knows it, so one person does not appear under three
// different labels in the same timeline.
function actorDisplayName(value = "") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (!text.includes("@")) return text;
  const lower = text.toLowerCase();
  let owners = [];
  try { owners = [...cloudKnownOwners.values(), currentOwner()].filter(Boolean); } catch { owners = []; }
  const owner = owners.find((item) => String(item.email || "").trim().toLowerCase() === lower);
  if (owner?.name && !String(owner.name).includes("@")) return normalizePersonName(owner.name);
  // No saved name: "pat.lee@example.com" reads better as "Pat Lee".
  return lower.split("@")[0].split(/[._-]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ") || text;
}

// Who to credit for a change made in this session.
function currentActorName() {
  return actorDisplayName(state.currentUser?.name || state.currentUser?.email || "") || "CRM user";
}

function addContactUpdate(contactId, { author = "", message, status = "", jobId = "" }) {
  if (!message?.trim() && !status) return null;
  return updateContact(contactId, (contact) => ({
    ...contact,
    updates: [
      {
        id: uid("update"),
        author: author.trim() || currentActorName(),
        message: message?.trim() || "",
        status,
        jobId,
        createdAt: new Date().toISOString(),
      },
      ...(contact.updates || []),
    ],
  }));
}

function applyStatusUpdate(contactId, nextStatus, author = "", message = "") {
  let contact = getContact(contactId);
  if (globalThis.window?.RooflineWorkflowChecklist?.allowStatusChange?.(contactId, nextStatus) === false) return contact;
  const currentJob = contact ? contactJobs(contact)[0] : null;
  const currentJobStatus = currentJob?.status || contact?.status || "";
  if (!contact || !nextStatus || currentJobStatus === nextStatus) return contact;
  if (nextStatus === "Paid" && !jobHasFullPayment(currentJob)) {
    showToast("Record confirmed payments covering the full contract before moving this job to Paid.");
    return contact;
  }
  if (["Estimate Sent", "Won"].includes(nextStatus)) {
    contact = canUseCloudSync() ? contact : ensureLeadProjectNumbers(contactId)?.contact || contact;
  }
  return updateContact(contactId, (current) => {
    const wasStatus = current.status;
    const nextJobs = contactJobs(current).map((job, index) =>
      index === 0
        ? {
            ...job,
            status: nextStatus,
            closedDate: nextStatus === "Won" ? job.closedDate || todayISO() : job.closedDate,
          }
        : job,
    );
    return {
      ...current,
      jobs: nextJobs,
      status: nextStatus,
      type: nextStatus === "Won" ? "Customer" : current.type,
      closedDate: nextStatus === "Won" ? current.closedDate || todayISO() : current.closedDate,
      updates: [
        {
          id: uid("update"),
          author: author.trim() || currentActorName(),
          status: nextStatus,
          jobId: nextJobs[0]?.id || "",
          message: message || `Status changed from ${wasStatus} to ${nextStatus}.`,
          createdAt: new Date().toISOString(),
        },
        ...(current.updates || []),
      ],
    };
  });
}

async function notifyGoogleChat(type, detail, url = "https://jobcrestcrm.com/") {
  if (!googleIntegrationState.chat) return false;
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/chat/notify", {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, signal: AbortSignal.timeout(12000),
      body: JSON.stringify({ type, detail: String(detail || "").slice(0, 2000), url }),
    });
    return response.ok;
  } catch { return false; }
}

