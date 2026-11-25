function estimateLeadSearchMarkup(query = "", target = "new") {
  const matches = estimateLeadSearchMatches(query);
  if (!matches.length) {
    return `<div class="estimate-lead-results-empty">No leads match “${escapeHtml(query)}”. Try the customer, address, phone, email, job, or lead number.</div>`;
  }
  return matches.map((contact) => {
    const jobs = contactJobs(contact);
    const matchedJob = query ? searchResultJob(contact, query) : jobs[0];
    const jobSummary = matchedJob
      ? `${matchedJob.name}${matchedJob.address ? ` · ${matchedJob.address}` : ""}`
      : "No job saved";
    return `<button class="estimate-lead-result" type="button" role="option" data-estimate-lead-id="${escapeHtml(contact.id)}" data-estimate-lead-target="${target}">
      <strong>${escapeHtml(contact.name)}</strong>
      <span>${escapeHtml([contact.leadNumber, contact.salesRep, jobSummary].filter(Boolean).join(" · "))}</span>
    </button>`;
  }).join("");
}

function showEstimateLeadResults(target, query = "") {
  const isNew = target === "new";
  const input = isNew ? els.newEstimateContactSearch : els.estimateContactSearch;
  const results = isNew ? els.newEstimateContactResults : els.estimateContactResults;
  if (!input || !results) return;
  results.innerHTML = estimateLeadSearchMarkup(query, target);
  results.classList.remove("hidden");
  input.setAttribute("aria-expanded", "true");
}

function hideEstimateLeadResults(target) {
  const isNew = target === "new";
  const input = isNew ? els.newEstimateContactSearch : els.estimateContactSearch;
  const results = isNew ? els.newEstimateContactResults : els.estimateContactResults;
  results?.classList.add("hidden");
  input?.setAttribute("aria-expanded", "false");
}

function selectEstimateLead(contactId, target) {
  const contact = getContact(contactId);
  if (!contact) return;
  if (target === "new") {
    state.newEstimateContactId = contact.id;
    state.newEstimateJobId = primaryJob(contact)?.id || "";
    saveUiState();
    renderNewEstimatePickers();
    hideEstimateLeadResults("new");
    return;
  }
  updateSelectedEstimateFromField("contactId", contact.id);
  renderEstimates();
  hideEstimateLeadResults("editor");
}

function renderNewEstimatePickers() {
  if (!els.newEstimateContact || !els.newEstimateJob) return;
  const selectedContact = getContact(state.newEstimateContactId);
  const contactId = selectedContact ? selectedContact.id : "";
  const jobs = selectedContact ? contactJobs(selectedContact) : [];
  const selectedJob = jobs.find((job) => job.id === state.newEstimateJobId) || jobs[0];

  els.newEstimateContact.value = contactId;
  if (els.newEstimateContactSearch && document.activeElement !== els.newEstimateContactSearch) {
    els.newEstimateContactSearch.value = selectedContact?.name || "";
  }

  els.newEstimateJob.disabled = !selectedContact;
  els.newEstimateJob.innerHTML = selectedContact
    ? jobs
        .map(
          (job) => `
          <option value="${job.id}" ${job.id === selectedJob?.id ? "selected" : ""}>
            ${escapeHtml(job.name)} - ${escapeHtml(job.address || "No address")}
          </option>
        `,
        )
        .join("")
    : '<option value="">Choose lead first</option>';
}

function renderEstimates() {
  const estimate = getSelectedEstimate();
  const estimates = filteredEstimates();

  renderNewEstimatePickers();
  renderEstimateHistory(estimate, estimates);

  renderEstimateForm(estimate);
  renderEstimatePreview(estimate);
}

// Estimate numbers count upward, so the highest number is the newest.
function estimateSequence(estimate = {}) {
  const sequence = Number(String(estimate.estimateNumber || "").replace(/\D/g, ""));
  return Number.isFinite(sequence) ? sequence : 0;
}

function estimateHistoryMarkup(estimate, estimates) {
  // Newest first, always. The list used to follow the order records happened
  // to load in, which put two recent estimates above forty in ascending order.
  const ordered = [...estimates].sort((a, b) => estimateSequence(b) - estimateSequence(a)
    || activityTimestamp(b.issueDate) - activityTimestamp(a.issueDate));
  // An estimate whose lead has not loaded yet is not an orphan.
  const missingLeadLabel = coreRecordsArePartial() ? "Loading lead…" : "Lead not found";
  return ordered.length
    ? ordered
        .map((item) => {
          const contact = getEstimateContact(item);
          const total = totalsFor(item).total;
          return `
            <button type="button" class="${item.id === estimate?.id ? "active" : ""}" data-estimate-id="${escapeHtml(item.id)}">
              <span class="estimate-history-main">
                <strong>${escapeHtml(item.projectTitle || item.estimateNumber)}</strong>
                <small>${escapeHtml(item.estimateNumber)} · ${escapeHtml(contact?.name || missingLeadLabel)}</small>
              </span>
              <span class="estimate-history-side">
                <span class="status-pill">${escapeHtml(item.status)}</span>
                <small>${money.format(total)}</small>
              </span>
            </button>`;
        })
        .join("")
    : '<div class="empty-state">No matching estimates</div>';
}

function renderEstimateHistory(estimate = getSelectedEstimate(), estimates = filteredEstimates()) {
  if (els.estimateHistoryCount) els.estimateHistoryCount.textContent = visibleEstimates().length;
  if (els.estimateList) els.estimateList.innerHTML = estimateHistoryMarkup(estimate, estimates);
}

function renderEstimateActiveSummary(estimate) {
  if (!els.estimateActiveSummary) return;
  if (!estimate) {
    els.estimateActiveSummary.innerHTML = `
      <div><p class="eyebrow">No estimate selected</p><h3>Create an estimate to begin</h3></div>
      <span>Use the New Estimate button above.</span>`;
    return;
  }
  const contact = getEstimateContact(estimate);
  const total = totalsFor(estimate).total;
  els.estimateActiveSummary.innerHTML = `
    <div>
      <p class="eyebrow">Editing ${escapeHtml(estimate.estimateNumber)}</p>
      <h3>${escapeHtml(estimate.projectTitle || "Untitled estimate")}</h3>
      <span>
        ${contact ? `<button class="estimate-lead-link" type="button" data-action="open-estimate-lead" data-contact-id="${escapeHtml(contact.id)}">${escapeHtml(contact.name)}</button>` : "Unknown lead"}
        · Select the lead to save and open its overview
      </span>
    </div>
    <div class="estimate-active-meta">
      <span class="status-pill">${escapeHtml(estimate.status)}</span>
      <strong>${money.format(total)}</strong>
    </div>`;
}

function estimateLineItemMarkup(item, index) {
  return `
    <div class="line-item" data-line-index="${index}" data-line-id="${escapeHtml(item.id ?? "")}">
      <label class="line-item-title">
        Product Title
        <input data-line-field="title" value="${escapeHtml(item.title)}" />
      </label>
      <label class="line-item-description">
        Description
        <textarea data-line-field="description" rows="2">${escapeHtml(item.description)}</textarea>
      </label>
      <label>
        Qty
        <input data-line-field="quantity" type="text" inputmode="decimal" autocomplete="off" value="${number(
          item.quantity,
        )}" />
      </label>
      <label>
        Unit
        <input data-line-field="unit" value="${escapeHtml(item.unit)}" />
      </label>
      <label>
        Rate
        <input data-line-field="rate" type="text" inputmode="decimal" autocomplete="off" value="${number(item.rate)}" />
      </label>
      <div class="remove-cell">
        <button class="mini-button" type="button" title="Remove line item" aria-label="Remove line item" data-action="remove-line" data-line-index="${index}">
          <span aria-hidden="true" data-icon="trash"></span>
        </button>
      </div>
    </div>
  `;
}

function renderEstimateLineItems(estimate) {
  els.lineItems.innerHTML = estimate.items.map(estimateLineItemMarkup).join("");
  hydrateIcons(els.lineItems);
}

// Redraws the lines without throwing the person typing out of their field:
// the same field of the same line has the cursor afterwards, where it was.
function renderEstimateLineItemsKeepingFocus(estimate) {
  if (!estimate || !els.lineItems) return;
  const active = document.activeElement;
  const row = active?.closest?.("#lineItems [data-line-index]");
  const focus = row ? { id: row.dataset.lineId || "", field: active.dataset.lineField || "", start: active.selectionStart, end: active.selectionEnd } : null;
  renderEstimateLineItems(estimate);
  if (!focus?.id || !focus.field) return;
  const field = [...els.lineItems.querySelectorAll("[data-line-index]")].find((item) => item.dataset.lineId === focus.id)?.querySelector(`[data-line-field="${focus.field}"]`);
  if (!field) return;
  field.focus();
  try { if (focus.start !== null && focus.start !== undefined) field.setSelectionRange(focus.start, focus.end); } catch { /* not a text field */ }
}

function appendEstimateLineItem(estimate, index) {
  els.lineItems.insertAdjacentHTML("beforeend", estimateLineItemMarkup(estimate.items[index], index));
  const row = els.lineItems.lastElementChild;
  hydrateIcons(row);
  row?.querySelector('[data-line-field="title"]')?.focus();
}

// ---- Recovering unsaved estimate lines --------------------------------------
// While changes are waiting to be saved, a copy of the work is kept on this
// device. If a save is then refused (someone else saved the estimate first) or
// the tab is closed, the page reloads with the shared version and what was
// typed is no longer on screen. It is still in that copy. For the estimate
// that is open, the lines in the copy that the estimate does not have are
// offered back behind one button, a line at a time. Putting a line back is an
// ordinary edit of the current estimate, so nobody else's change is replaced.
const ESTIMATE_RECOVERY_DISMISSED_KEY = "jobcrest-estimate-recovery-dismissed";
const estimateRecoveryCopies = new Map(); // estimate id -> { items, capturedAt, stamp }
let estimateRecoverySources = [];
let estimateRecoveryPanelFor = "";

function estimateLineSignature(item = {}) {
  return JSON.stringify([
    String(item.title || "").trim().toLowerCase(), String(item.description || "").trim(),
    number(item.quantity), String(item.unit || "ea").trim().toLowerCase(), number(item.rate),
  ]);
}

function estimateRecoveryDismissed() {
  try {
    const stored = JSON.parse(localStorage.getItem(`${ESTIMATE_RECOVERY_DISMISSED_KEY}:${authSession?.user?.id || "local"}`) || "[]");
    return new Set(Array.isArray(stored) ? stored : []);
  } catch {
    return new Set();
  }
}

// The lines of an unsaved copy that the estimate does not have now. A line
// the estimate already has, word for word and number for number, is not one.
function estimateLinesToRecover(estimate, copy) {
  if (!estimate || !copy || !Array.isArray(copy.items)) return [];
  const have = new Map();
  (estimate.items || []).forEach((item) => {
    const signature = estimateLineSignature(item);
    have.set(signature, (have.get(signature) || 0) + 1);
  });
  const titleOf = (item) => String(item.title || "").trim().toLowerCase();
  return copy.items.map(normalizeLineItem).filter((item) => {
    const blank = (!titleOf(item) || titleOf(item) === "line item") && !String(item.description || "").trim() && !number(item.rate);
    if (blank || (typeof isPlaceholderEstimateItem === "function" && isPlaceholderEstimateItem(item))) return false;
    const signature = estimateLineSignature(item);
    if (!have.get(signature)) return true;
    have.set(signature, have.get(signature) - 1);
    return false;
  }).map((item) => {
    const targets = estimateRecoveryTargets(estimate, item);
    return {
      item,
      // The one line of the estimate this unsaved line belongs to, when that is certain.
      replacesIndex: targets.length === 1 ? targets[0] : -1,
      // Two or more lines it could belong to. The rep chooses; the CRM does not guess.
      choices: targets.length > 1 ? targets : [],
    };
  });
}

// Which line of the estimate an unsaved line belongs to.
// A line keeps its id for life, so the id decides, whatever the lines are
// called: two lines named "Labor" are told apart, and a line that was renamed
// is still found. An unsaved line whose id the estimate does not have was new
// (or has since been removed), so it replaces nothing.
// The one case an id cannot be relied on is a line numbered by its position
// ("line-2": see ensureEstimateLineIds). Someone may have saved a different
// list since, and then the same position is a different line. For those the
// name is checked as well, and when more than one line has that name every one
// of them is returned for the rep to choose from.
function estimateRecoveryTargets(estimate, item) {
  const items = estimate?.items || [];
  const titleOf = (line) => String(line?.title || "").trim().toLowerCase();
  const id = item?.id === undefined || item?.id === null ? "" : String(item.id);
  const byId = id ? items.findIndex((line) => String(line?.id ?? "") === id) : -1;
  const numberedByPosition = /^line-\d+$/.test(id);
  if (id && !numberedByPosition) return byId >= 0 ? [byId] : [];
  const sameName = [];
  items.forEach((line, index) => { if (titleOf(line) && titleOf(line) === titleOf(item)) sameName.push(index); });
  if (byId >= 0 && sameName.length === 1 && sameName[0] === byId) return [byId];
  return sameName;
}

// Reads the copies of earlier unsaved work kept on this device and remembers,
// per estimate, the lines of the most recent one. Done after the CRM is up,
// one copy at a time, so starting the CRM is not slowed down.
async function indexEstimateRecoveryCopies(entries = estimateRecoverySources) {
  const dismissed = estimateRecoveryDismissed();
  for (const entry of entries) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    let saved;
    try { saved = typeof entry.raw === "string" ? JSON.parse(entry.raw) : entry.raw; } catch { continue; }
    const capturedAt = String(saved?.updatedAt || "");
    // Only an estimate that was unsaved when the copy was taken counts. A copy
    // from before copies recorded that cannot tell, so it is left out.
    const pending = new Set(Array.isArray(saved?.pending) ? saved.pending : []);
    for (const estimate of Array.isArray(saved?.state?.estimates) ? saved.state.estimates : []) {
      if (!estimate?.id || !Array.isArray(estimate.items) || !pending.has(`estimate:${estimate.id}`)) continue;
      const stamp = `${estimate.id}:${capturedAt}`;
      const known = estimateRecoveryCopies.get(estimate.id);
      if (dismissed.has(stamp) || (known && known.capturedAt >= capturedAt)) continue;
      estimateRecoveryCopies.set(estimate.id, { items: estimate.items, capturedAt, stamp });
    }
  }
  const waiting = visibleEstimates().filter((estimate) => estimateLinesToRecover(estimate, estimateRecoveryCopies.get(estimate.id)).length);
  if (!waiting.length) return 0;
  if (state.view === "estimates") renderEstimateRecovery(getSelectedEstimate());
  showToast(waiting.length === 1
    ? `Estimate ${waiting[0].estimateNumber || ""} has lines you typed that were not saved. Open it and choose "Recover unsaved lines".`
    : `${waiting.length} estimates have lines you typed that were not saved. Open each one and choose "Recover unsaved lines".`);
  return waiting.length;
}

function estimateRecoveryPanelMarkup(estimate, copy, lines) {
  const describe = (item) => `${number(item.quantity)} ${escapeHtml(item.unit || "ea")} × ${money.format(number(item.rate))} = ${money.format(number(item.quantity) * number(item.rate))}`;
  return `
    <p><strong>${lines.length === 1 ? "One line" : `${lines.length} lines`} typed on this device${copy.capturedAt ? ` on ${escapeHtml(formatDateTime(copy.capturedAt))}` : ""} ${lines.length === 1 ? "was" : "were"} not saved.</strong>
      Putting a line back changes only that line. Nothing anyone else saved is replaced.</p>
    <ul>${lines.map(({ item, replacesIndex, choices = [] }, index) => {
      const current = replacesIndex >= 0 ? estimate.items[replacesIndex] : null;
      // Says which line is meant, so a line is never replaced unseen.
      const named = (line) => `${line.description ? `${escapeHtml(line.description)} · ` : ""}${describe(line)}`;
      const replaceButton = (line, label) => `<button class="secondary-button" type="button" data-recover-line="${index}" data-recover-mode="replace" data-recover-target="${escapeHtml(String(line.id ?? ""))}">${label}</button>`;
      return `
      <li>
        <div><strong>${escapeHtml(item.title)}</strong>${item.description ? `<span>${escapeHtml(item.description)}</span>` : ""}<span>${describe(item)}</span>${
          current ? `<span class="estimate-recovery-now">In the estimate now: ${named(current)}</span>` : ""}${
          choices.length ? `<span class="estimate-recovery-now">${choices.length} lines in the estimate are named "${escapeHtml(item.title)}". Choose the one this belongs to, or add it as another line.</span>` : ""}</div>
        <div class="estimate-recovery-actions">
          ${current ? replaceButton(current, "Use these numbers") : ""}
          ${choices.map((choice) => replaceButton(estimate.items[choice], `Replace line ${choice + 1}: ${named(estimate.items[choice])}`)).join("")}
          <button class="${current || choices.length ? "ghost-button" : "secondary-button"}" type="button" data-recover-line="${index}" data-recover-mode="add">${current || choices.length ? "Add as another line" : "Put this line back"}</button>
        </div>
      </li>`;
    }).join("")}</ul>
    <div class="estimate-recovery-actions">
      ${lines.length > 1 && lines.every((line) => line.replacesIndex < 0 && !(line.choices || []).length) ? '<button class="secondary-button" type="button" data-recover-all>Put all of them back</button>' : ""}
      <button class="ghost-button" type="button" data-recover-dismiss>I do not need these</button>
    </div>`;
}

// One button beside "Add Item", shown only when there is something to recover.
function renderEstimateRecovery(estimate = getSelectedEstimate()) {
  const anchor = els.addLineItemButton;
  if (!anchor?.parentElement || !els.lineItems?.parentElement) return;
  let button = document.getElementById("estimateRecoverButton");
  let panel = document.getElementById("estimateRecoveryPanel");
  const copy = estimate ? estimateRecoveryCopies.get(estimate.id) : null;
  const lines = copy && canAction("manageEstimates") ? estimateLinesToRecover(estimate, copy) : [];
  if (!lines.length) {
    button?.remove();
    panel?.remove();
    if (estimate && estimateRecoveryPanelFor === estimate.id) estimateRecoveryPanelFor = "";
    return;
  }
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.id = "estimateRecoverButton";
    button.className = "ghost-button estimate-recover-button";
    button.dataset.recoverToggle = "";
    anchor.parentElement.insertBefore(button, anchor);
  }
  const open = estimateRecoveryPanelFor === estimate.id;
  button.textContent = `Recover unsaved lines (${lines.length})`;
  button.setAttribute("aria-expanded", String(open));
  if (!open) {
    panel?.remove();
    return;
  }
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "estimateRecoveryPanel";
    panel.className = "estimate-recovery-panel";
    els.lineItems.parentElement.insertBefore(panel, els.lineItems);
  }
  panel.innerHTML = estimateRecoveryPanelMarkup(estimate, copy, lines);
}

// Puts one unsaved line (or all of them) back into the open estimate, as an
// ordinary edit that is then saved the way any other edit is.
function recoverEstimateLines(indexes, mode = "add", targetId = "") {
  if (!requireAction("manageEstimates")) return 0;
  const estimate = getSelectedEstimate();
  const lines = estimate ? estimateLinesToRecover(estimate, estimateRecoveryCopies.get(estimate.id)) : [];
  let chosen = indexes.map((index) => lines[index]).filter(Boolean);
  if (mode === "replace") {
    // Only a line that was offered for this one can be replaced: the single
    // line it belongs to, or the one of several that the rep pointed at.
    chosen = chosen.map((line) => {
      const offered = line.replacesIndex >= 0 ? [line.replacesIndex] : line.choices || [];
      const wanted = targetId ? offered.find((index) => String(estimate.items[index]?.id ?? "") === String(targetId)) : (offered.length === 1 ? offered[0] : undefined);
      return wanted === undefined ? null : { ...line, target: wanted };
    }).filter(Boolean);
  }
  if (!chosen.length) return 0;
  chosen.forEach(({ item, target }) => {
    const restored = { title: item.title, description: item.description, quantity: item.quantity, unit: item.unit, rate: item.rate };
    if (mode === "replace") estimate.items[target] = { ...estimate.items[target], ...restored };
    else estimate.items.push({ id: uid("line"), ...restored });
  });
  queueLocalStateSave();
  renderEstimateLineItems(estimate);
  queueEstimateVerifiedSave(estimate.id);
  scheduleEstimateVisualRefresh(estimate.id);
  renderEstimateRecovery(estimate);
  showToast(chosen.length === 1 ? `"${chosen[0].item.title}" is back in the estimate` : `${chosen.length} lines are back in the estimate`);
  return chosen.length;
}

function dismissEstimateRecovery() {
  const estimate = getSelectedEstimate();
  const copy = estimate ? estimateRecoveryCopies.get(estimate.id) : null;
  if (!copy) return;
  try {
    const key = `${ESTIMATE_RECOVERY_DISMISSED_KEY}:${authSession?.user?.id || "local"}`;
    localStorage.setItem(key, JSON.stringify([...estimateRecoveryDismissed(), copy.stamp].slice(-200)));
  } catch { /* The browser may deny storage; the lines are simply offered again next time. */ }
  estimateRecoveryCopies.delete(estimate.id);
  estimateRecoveryPanelFor = "";
  renderEstimateRecovery(estimate);
}

function renderEstimateForm(estimate) {
  const disabled = !estimate;
  renderEstimateActiveSummary(estimate);
  els.estimateForm.classList.toggle("hidden", disabled);
  els.deleteEstimateButton.disabled = disabled;
  els.copyEstimateButton.disabled = disabled;
  els.printEstimateButton.disabled = disabled;
  els.sendEstimateButton.disabled = disabled;

  if (!estimate) {
    setSaveState(els.estimateSaveStatus, "", "");
    renderEstimateRecovery(null);
    return;
  }
  renderEstimateSaveState(estimate.id);

  const estimateContact = getEstimateContact(estimate);
  els.estimateContact.value = estimateContact?.id || "";
  if (els.estimateContactSearch && document.activeElement !== els.estimateContactSearch) {
    els.estimateContactSearch.value = estimateContact?.name || "";
  }
  const estimateJobs = contactJobs(estimateContact);
  const estimateJob = getEstimateJob(estimate);
  els.estimateJob.innerHTML = estimateJobs
    .map(
      (job) => `
      <option value="${job.id}" ${job.id === estimateJob?.id ? "selected" : ""}>
        ${escapeHtml(job.name)} - ${escapeHtml(job.address || "No address")}
      </option>
    `,
    )
    .join("");

  els.estimateNumber.value = estimate.estimateNumber;
  els.estimateNumber.readOnly = true;
  els.estimateTitle.value = estimate.projectTitle;
  els.estimateStatus.value = estimate.status;
  els.projectManager.value = estimate.projectManager;
  const rep = estimateSalesRep(estimate);
  els.salesRepEmail.value = estimate.salesRepEmail || rep.email;
  els.salesRepPhone.value = formatPhoneNumber(estimate.salesRepPhone || rep.phone);
  els.issueDate.value = estimate.issueDate;
  els.validUntil.value = estimate.validUntil;
  els.scopeSummary.value = estimate.scopeSummary;
  els.taxRate.value = estimate.taxRate;
  els.deposit.value = estimate.deposit;
  els.estimateNotes.value = estimate.notes;

  renderEstimateLineItems(estimate);
  renderEstimateRecovery(estimate);
}

function renderEstimatePreview(estimate) {
  if (!estimate) {
    els.estimatePreview.innerHTML = '<div class="empty-state">Create an estimate to preview it</div>';
    return;
  }

  const contact = getEstimateContact(estimate);
  const job = getEstimateJob(estimate);
  const totals = totalsFor(estimate);
  const company = state.company;
  const rep = estimateSalesRep(estimate);
  const officeAddress = companyOfficeAddress();

  const statusColors = {
    Draft: "est-status-draft",
    Sent: "est-status-sent",
    Won: "est-status-approved",
    Rejected: "est-status-rejected",
    Invoiced: "est-status-invoiced",
  };
  const statusClass = statusColors[estimate.status] || "est-status-draft";

  els.estimatePreview.innerHTML = `
    <div class="est-preview">
      <div class="est-header">
        <div class="est-header-brand">
          ${companyLogoTag("est-logo")}
          <div>
            <p class="est-company-name">${escapeHtml(company.name)}</p>
            <p class="est-company-sub">${nl2br(officeAddress)}</p>
            <p class="est-company-sub">${escapeHtml(company.phone)}${company.phone && company.email ? " &middot; " : ""}${escapeHtml(company.email)}</p>
            ${company.license ? `<p class="est-company-sub">${escapeHtml(company.license)}</p>` : ""}
          </div>
        </div>
        <div class="est-header-meta">
          <p class="est-doc-label">${escapeHtml(estimateWordingFor(job?.division || contact?.division || "roofing").label)}</p>
          <p class="est-doc-kicker">PROPOSAL &amp; SCOPE OF WORK</p>
          <p class="est-doc-num">${escapeHtml(estimate.estimateNumber)}</p>
          <p class="est-doc-date">${escapeHtml([estimate.leadNumber, estimate.projectNumber].filter(Boolean).join(" · "))}</p>
          <p class="est-doc-date">Issued: ${formatDate(estimate.issueDate)}</p>
          <p class="est-doc-date">Valid through: ${formatDate(estimate.validUntil)}</p>
          <span class="est-status-chip ${statusClass}">${escapeHtml(estimate.status)}</span>
        </div>
      </div>
      <div class="est-accent-bar"></div>

      <div class="est-body">
        <div class="est-info-grid">
          <div class="est-info-box">
            <p class="est-info-label">Customer</p>
            ${contact
              ? `<button class="est-info-name estimate-lead-link estimate-lead-link-preview" type="button" data-action="open-estimate-lead" data-contact-id="${escapeHtml(contact.id)}">${escapeHtml(contact.name)}</button>`
              : '<p class="est-info-name">No customer selected</p>'}
            ${contact?.address ? `<p class="est-info-sub">${nl2br(contact.address)}</p>` : ""}
            ${contact?.phone ? `<p class="est-info-sub">${escapeHtml(contact.phone)}</p>` : ""}
            ${contact?.email ? `<p class="est-info-sub">${escapeHtml(contact.email)}</p>` : ""}
          </div>
          <div class="est-info-box">
            <p class="est-info-label">Project &amp; Representative</p>
            <p class="est-info-name">${escapeHtml(estimate.projectTitle || "Project estimate")}</p>
            <p class="est-info-sub">${escapeHtml((job?.address || contact?.address || "").split("\n")[0] || "")}</p>
            <p class="est-info-rep">${escapeHtml(rep.name || "Unassigned")}</p>
            ${rep.email ? `<p class="est-info-sub">${escapeHtml(rep.email)}</p>` : ""}
            ${rep.phone ? `<p class="est-info-sub">${escapeHtml(rep.phone)}</p>` : ""}
          </div>
        </div>

        <div class="est-investment-banner">
          <span>Total estimated investment</span>
          <strong>${money.format(totals.total)}</strong>
        </div>

        ${estimate.scopeSummary ? `
        <div class="est-scope-block">
          <p class="est-info-label">Project scope</p>
          <p class="est-scope-text">${nl2br(estimate.scopeSummary)}</p>
        </div>
        ` : ""}

        <table class="est-table">
          <thead>
            <tr>
              <th>Product / work item</th>
              <th class="est-th-r">Qty</th>
              <th>Unit</th>
              <th class="est-th-r">Rate</th>
              <th class="est-th-r">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${printableEstimateItems(estimate).map((item) => `
              <tr>
                <td>
                  <span class="est-item-title">${escapeHtml(item.title || "Line item")}</span>
                  ${item.description ? `<span class="est-item-desc">${nl2br(item.description)}</span>` : ""}
                </td>
                <td class="est-td-r est-td-muted">${number(item.quantity).toLocaleString("en-US")}</td>
                <td class="est-td-muted">${escapeHtml(item.unit || "ea")}</td>
                <td class="est-td-r est-td-muted">${money.format(number(item.rate))}</td>
                <td class="est-td-r est-td-amt">${money.format(estimateLineAmount(item))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div class="est-totals-block">
          <div class="est-totals-inner">
            <div class="est-total-row">
              <span>Subtotal</span><span>${money.format(totals.subtotal)}</span>
            </div>
            <div class="est-total-row">
              <span>Tax (${number(estimate.taxRate)}%)</span><span>${money.format(totals.tax)}</span>
            </div>
            <div class="est-total-row est-total-grand">
              <span>Total</span><span>${money.format(totals.total)}</span>
            </div>
            ${number(estimate.deposit) > 0 ? `<div class="est-total-row">
              <span>Deposit due at signing</span><span>&minus;${money.format(number(estimate.deposit))}</span>
            </div>` : ""}
            <div class="est-total-row est-total-balance">
              <span>Balance due on completion</span><span>${money.format(totals.balance)}</span>
            </div>
          </div>
        </div>

        <div class="est-payment-block">
          <p class="est-info-label">Payment schedule</p>
          ${number(estimate.deposit) > 0 ? `
          <div class="est-payment-row"><span>Initial deposit upon acceptance</span><span>${totals.total ? Math.round(number(estimate.deposit) / totals.total * 100) : 0}%</span><strong>${money.format(number(estimate.deposit))}</strong></div>
          <div class="est-payment-row"><span>Remaining balance due on completion</span><span>${totals.total ? Math.max(100 - Math.round(number(estimate.deposit) / totals.total * 100), 0) : 0}%</span><strong>${money.format(totals.balance)}</strong></div>
          ` : `
          <div class="est-payment-row"><span>Full balance due according to the terms below</span><span>100%</span><strong>${money.format(totals.total)}</strong></div>
          `}
        </div>

        ${(estimate.notes || company.defaultTerms) ? `
        <div class="est-notes-block">
          <p class="est-info-label">Notes &amp; Terms</p>
          <p class="est-notes-text">${nl2br(estimate.notes || company.defaultTerms)}</p>
        </div>
        ` : ""}

        <div class="est-acceptance-block">
          <p class="est-info-label">Acceptance of proposal</p>
          <p>I authorize the work described in this proposal and agree to the pricing, payment schedule, and terms shown above. Changes to this scope require written approval.</p>
        </div>
        <div class="est-sig-grid">
          <div class="est-sig-line">Customer signature</div>
          <div class="est-sig-line">Date</div>
        </div>
      </div>

      <div class="est-footer">
        <span>${escapeHtml(company.name)}${company.website ? ` &middot; ${escapeHtml(company.website)}` : ""}</span>
        <span>${escapeHtml(company.license || "")}</span>
      </div>
    </div>
  `;
}

function companyFormValues() {
  return {
    ...state.company,
    phone: formatPhoneNumber(state.company.phone),
    userName: state.currentUser.name,
    userEmail: state.currentUser.email,
    userPhone: formatPhoneNumber(state.currentUser.phone || ""),
    userRole: state.currentUser.role,
  };
}

function trackCompanyFormDraft(event) {
  const field = event.target;
  if (!canAction("manageCompany") || !field.name || field.type === "file") return;
  const baseline = companyFormValues();
  if (!Object.hasOwn(baseline, field.name)) return;
  const draft = { ...state.companyFormDraft };
  if (field.value === String(baseline[field.name] ?? "")) delete draft[field.name];
  else draft[field.name] = field.value;
  state.companyFormDraft = Object.keys(draft).length ? draft : null;
  // A form draft is local until explicit Save; it still guards remote hydration.
  queueLocalStateSave();
}

function renderGoogleIntegrationCard() {
  if (!els.googleIntegrationStatus || !els.googleIntegrationPill) return;
  const status = googleIntegrationState;
  if (status.loading || !status.loaded) {
    els.googleIntegrationStatus.textContent = "Checking your Google Workspace connection…";
    els.googleIntegrationPill.textContent = "Checking";
    els.googleIntegrationPill.className = "status-pill pill-default";
  } else if (!status.configured) {
    els.googleIntegrationStatus.textContent = "Google OAuth must be configured by an administrator before accounts can connect.";
    els.googleIntegrationPill.textContent = "Setup needed";
    els.googleIntegrationPill.className = "status-pill pill-inspection";
  } else if (status.connected) {
    const userProductsReady = status.gmailSend && status.gmailRead && status.tasks && status.contacts;
    els.googleIntegrationStatus.textContent = userProductsReady
      ? `Calendar, Gmail, Tasks, and Contacts connected as ${status.providerEmail || status.email}`
      : `Google connected as ${status.providerEmail || status.email}. Reconnect to approve the newest products.`;
    els.googleIntegrationPill.textContent = userProductsReady ? "Connected" : "Reconnect";
    els.googleIntegrationPill.className = userProductsReady ? "status-pill pill-won" : "status-pill pill-inspection";
  } else {
    els.googleIntegrationStatus.textContent = `Connect the Google account matching ${status.email || currentOwner().email}`;
    els.googleIntegrationPill.textContent = "Not connected";
    els.googleIntegrationPill.className = "status-pill pill-default";
  }
  if (els.connectGoogleWorkspaceButton) {
    const coreGoogleReady = status.connected && status.gmailSend && status.gmailRead && status.tasks && status.contacts;
    const groupsNeedReconnect = canManageTeamData() && status.groupOptions.length > 0 && !status.groups;
    els.connectGoogleWorkspaceButton.classList.toggle("hidden", coreGoogleReady && !groupsNeedReconnect);
    els.connectGoogleWorkspaceButton.textContent = status.connected ? "Reconnect Google Workspace" : "Connect Google Workspace";
    els.connectGoogleWorkspaceButton.disabled = status.loading || !status.configured;
  }
  if (els.disconnectGoogleWorkspaceButton) {
    els.disconnectGoogleWorkspaceButton.classList.toggle("hidden", !status.connected);
    els.disconnectGoogleWorkspaceButton.disabled = status.loading;
  }
  els.verifyGoogleDriveButton?.classList.toggle("hidden", !status.drive || !canManageTeamData());
  // Each employee connects their own account, and reps cannot open Settings,
  // so the Calendar page offers the connection too.
  els.calendarGoogleConnect?.classList.toggle("hidden", !(status.loaded && status.configured && !status.connected));
  document.querySelectorAll("[data-google-product]").forEach((badge) => {
    const key = badge.dataset.googleProduct;
    const enabled = key === "gmail" ? status.gmailSend && status.gmailRead : Boolean(status[key]);
    badge.classList.toggle("active", enabled);
    badge.classList.toggle("planned", !enabled);
  });
  if (els.googleProductsIntegrationStatus) {
    const ready = ["drive", "docs", "sheets", "chat", "gmailPush", "groups"].filter((key) => status[key]);
    els.googleProductsIntegrationStatus.textContent = ready.length
      ? `Company products ready: ${ready.map((key) => ({ gmailPush: "automatic Gmail", drive: "Drive", docs: "Docs", sheets: "Sheets", chat: "Chat", groups: "Groups" })[key]).join(", ")}.`
      : "Company Drive, Docs, Sheets, Chat, automatic Gmail, and Groups still need administrator setup.";
  }
}

async function refreshGoogleIntegrationStatus(force = false) {
  if (googleIntegrationState.loading || (googleIntegrationState.loaded && !force)) return;
  googleIntegrationState.loading = true;
  renderGoogleIntegrationCard();
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/status", { headers, signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({}));
    googleIntegrationState = {
      loaded: true, loading: false, configured: response.ok && result.configured === true,
      connected: response.ok && result.connected === true, email: result.email || currentOwner().email,
      providerEmail: result.providerEmail || "", gmailSend: result.gmailSend === true, gmailRead: result.gmailRead === true,
      calendar: result.calendar === true, tasks: result.tasks === true, contacts: result.contacts === true,
      drive: result.drive === true, docs: result.docs === true, sheets: result.sheets === true,
      chat: result.chat === true, gmailPush: result.gmailPush === true, groups: result.groups === true,
      docTemplates: Array.isArray(result.docTemplates) ? result.docTemplates : [],
      groupOptions: Array.isArray(result.groupOptions) ? result.groupOptions : [],
    };
  } catch {
    googleIntegrationState = {
      loaded: true, loading: false, configured: false, connected: false, email: currentOwner().email, providerEmail: "",
      calendar: false, gmailSend: false, gmailRead: false, tasks: false, contacts: false,
      drive: false, docs: false, sheets: false, chat: false, gmailPush: false, groups: false,
      docTemplates: [], groupOptions: [],
    };
  }
  renderGoogleIntegrationCard();
  if (googleIntegrationState.connected && googleIntegrationState.gmailRead && googleIntegrationState.gmailPush) void ensureGmailWatch();
}

async function ensureGmailWatch() {
  const email = String(googleIntegrationState.providerEmail || googleIntegrationState.email || "").toLowerCase();
  if (!email) return false;
  const key = `jobcrest-gmail-watch:${email}`;
  const last = Number(localStorage.getItem(key) || 0);
  if (Number.isFinite(last) && Date.now() - last < 24 * 60 * 60 * 1000) return true;
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/gmail/watch", { method: "POST", headers, signal: AbortSignal.timeout(20000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.watching !== true) return false;
    localStorage.setItem(key, String(Date.now()));
    return true;
  } catch { return false; }
}

async function connectGoogleWorkspace() {
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/connect", { method: "POST", headers, signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !/^https:\/\/accounts\.google\.com\//.test(result.authorizationUrl || "")) throw new Error(result.error || "Google connection could not start.");
    window.location.assign(result.authorizationUrl);
  } catch (error) {
    showToast(error.message || "Google connection could not start");
  }
}

async function verifyGoogleDriveConnection() {
  if (!requireAction("manageCompany")) return;
  if (els.verifyGoogleDriveButton) els.verifyGoogleDriveButton.disabled = true;
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/drive/verify", { headers, signal: AbortSignal.timeout(20000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.verified) throw new Error(result.error || "Company Drive verification failed.");
    if (els.googleDriveIntegrationStatus) els.googleDriveIntegrationStatus.textContent = `Verified company Drive folder: ${result.root.name}.`;
    showToast("Company Drive connection verified");
  } catch (error) { showToast(error.message || "Company Drive verification failed"); }
  finally { if (els.verifyGoogleDriveButton) els.verifyGoogleDriveButton.disabled = false; }
}

async function disconnectGoogleWorkspace() {
  if (!(await appConfirm("Disconnect Google Workspace from JobCrest? Existing Google events and sent Gmail messages will remain in Google.", { title: "Disconnect Google Workspace", confirmLabel: "Disconnect", danger: true }))) return;
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/disconnect", { method: "POST", headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Google Workspace could not be disconnected.");
    googleIntegrationState = {
      ...googleIntegrationState, loaded: true, loading: false, connected: false, providerEmail: "",
      calendar: false, gmailSend: false, gmailRead: false, tasks: false, contacts: false,
    };
    renderGoogleIntegrationCard();
    showToast("Google Workspace disconnected");
  } catch (error) { showToast(error.message); }
}

function renderZohoIntegrationCard() {
  if (!els.zohoIntegrationStatus || !els.zohoIntegrationPill) return;
  const status = zohoIntegrationState;
  if (status.loading || !status.loaded) {
    els.zohoIntegrationStatus.textContent = "Checking your Zoho Sign connection…";
    els.zohoIntegrationPill.textContent = "Checking";
    els.zohoIntegrationPill.className = "status-pill pill-default";
  } else if (!status.configured) {
    els.zohoIntegrationStatus.textContent = "Zoho Sign OAuth must be configured before Smart Documents can be created.";
    els.zohoIntegrationPill.textContent = "Setup needed";
    els.zohoIntegrationPill.className = "status-pill pill-inspection";
  } else if (status.connected) {
    els.zohoIntegrationStatus.textContent = `Zoho Sign connected for ${status.email || currentOwner().email}`;
    els.zohoIntegrationPill.textContent = "Connected";
    els.zohoIntegrationPill.className = "status-pill pill-won";
  } else {
    els.zohoIntegrationStatus.textContent = `Connect Zoho Sign for ${status.email || currentOwner().email}`;
    els.zohoIntegrationPill.textContent = "Not connected";
    els.zohoIntegrationPill.className = "status-pill pill-default";
  }
  if (els.connectZohoSignButton) {
    els.connectZohoSignButton.classList.toggle("hidden", status.connected);
    els.connectZohoSignButton.disabled = status.loading || !status.configured;
  }
  if (els.disconnectZohoSignButton) {
    els.disconnectZohoSignButton.classList.toggle("hidden", !status.connected);
    els.disconnectZohoSignButton.disabled = status.loading;
  }
}

async function refreshZohoIntegrationStatus(force = false) {
  if (zohoIntegrationState.loading || (zohoIntegrationState.loaded && !force)) return;
  zohoIntegrationState.loading = true;
  renderZohoIntegrationCard();
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/zoho/status", { headers, signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({}));
    zohoIntegrationState = {
      loaded: true, loading: false, configured: response.ok && result.configured === true,
      connected: response.ok && result.connected === true, email: result.email || currentOwner().email,
      dataCenter: result.dataCenter || "",
    };
  } catch {
    zohoIntegrationState = { loaded: true, loading: false, configured: false, connected: false, email: currentOwner().email, dataCenter: "" };
  }
  renderZohoIntegrationCard();
}

async function connectZohoSign() {
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/zoho/connect", { method: "POST", headers, signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !/^https:\/\/accounts\.(?:zoho\.(?:com|eu|in|jp|com\.au|sa|uk|sg|ae)|zohocloud\.ca)\/oauth\/v2\/auth\?/.test(result.authorizationUrl || "")) throw new Error(result.error || "Zoho Sign connection could not start.");
    window.location.assign(result.authorizationUrl);
  } catch (error) { showToast(error.message || "Zoho Sign connection could not start"); }
}

async function disconnectZohoSign() {
  if (!(await appConfirm("Disconnect Zoho Sign from JobCrest? Existing Zoho drafts will remain in Zoho Sign.", { title: "Disconnect Zoho Sign", confirmLabel: "Disconnect", danger: true }))) return;
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/zoho/disconnect", { method: "POST", headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Zoho Sign could not be disconnected.");
    zohoIntegrationState = { ...zohoIntegrationState, loaded: true, loading: false, connected: false };
    renderZohoIntegrationCard();
    showToast("Zoho Sign disconnected");
  } catch (error) { showToast(error.message); }
}

function renderCompanyForm() {
  const form = els.companyForm;
  state.company = normalizeCompany(state.company);
  Object.entries({ ...companyFormValues(), ...state.companyFormDraft }).forEach(([key, value]) => {
    const field = form.elements[key];
    const nextValue = String(value ?? "");
    if (field && field.type !== "file" && field.value !== nextValue) field.value = nextValue;
  });
  if (els.companyLogoPreview) {
    const logoSource = companyLogoSource();
    els.companyLogoPreview.src = logoSource || "icon.svg";
    els.companyLogoPreview.classList.toggle("logo-placeholder", !logoSource);
  }
  if (typeof renderGoogleIntegrationCard === "function") renderGoogleIntegrationCard();
  if (typeof refreshGoogleIntegrationStatus === "function") void refreshGoogleIntegrationStatus();
  if (typeof refreshGoogleDriveStatus === "function") void refreshGoogleDriveStatus();
  if (typeof renderZohoIntegrationCard === "function") renderZohoIntegrationCard();
  if (typeof refreshZohoIntegrationStatus === "function") void refreshZohoIntegrationStatus();
  renderDocumentCategoriesSettings();
  if (typeof renderAdministration === "function") renderAdministration();
}

function documentCategoryDocumentCount(categoryId) {
  return state.contacts.reduce(
    (total, contact) => total + (contact.documents || []).filter((document) => document.categoryId === categoryId).length,
    0,
  );
}

function renderDocumentCategoriesSettings() {
  if (!els.documentCategoriesList) return;
  const categories = state.company.documentCategories || [];
  const writable = canAction("manageCompany");
  els.documentCategoryCreateForm?.querySelectorAll("input, select, button").forEach((control) => {
    control.disabled = !writable;
  });
  els.documentCategoriesList.innerHTML = categories
    .map((category, index) => {
      const documentCount = documentCategoryDocumentCount(category.id);
      const mergeOptions = categories
        .filter((target) => target.id !== category.id)
        .map((target) => `<option value="${escapeHtml(target.id)}">${escapeHtml(target.name)}</option>`)
        .join("");
      return `
        <article class="document-category-admin-row ${category.active ? "" : "is-inactive"}" draggable="${writable}" data-category-id="${escapeHtml(category.id)}">
          <div class="document-category-drag" title="Drag to reorder" aria-label="Drag ${escapeHtml(category.name)} to reorder">⋮⋮</div>
          <span class="document-category-color" style="--category-color:${escapeHtml(category.color)}" aria-hidden="true" data-icon="${escapeHtml(category.icon)}"></span>
          <div class="document-category-fields">
            <label>Name<input data-category-field="name" value="${escapeHtml(category.name)}" maxlength="80" ${writable ? "" : "disabled"} /></label>
            <label>Icon<select data-category-field="icon" ${writable ? "" : "disabled"}>${documentCategoryIcons
              .map((icon) => `<option value="${icon}" ${icon === category.icon ? "selected" : ""}>${icon.replace(/^./, (letter) => letter.toUpperCase())}</option>`)
              .join("")}</select></label>
            <label>Color<input data-category-field="color" type="color" value="${escapeHtml(category.color)}" ${writable ? "" : "disabled"} /></label>
          </div>
          <div class="document-category-meta">
            <strong>${category.active ? "Active" : "Inactive"}</strong>
            <span>${documentCount} document${documentCount === 1 ? "" : "s"}</span>
            <span>Created ${escapeHtml(formatDateTime(category.createdAt))}</span>
            <span>Modified ${escapeHtml(formatDateTime(category.updatedAt))}</span>
          </div>
          <div class="document-category-actions">
            <button class="secondary-button" type="button" data-action="edit-document-category" data-category-id="${escapeHtml(category.id)}" ${writable ? "" : "disabled"}>Save</button>
            <button class="ghost-button" type="button" data-action="toggle-document-category" data-category-id="${escapeHtml(category.id)}" ${writable ? "" : "disabled"}>${category.active ? "Disable" : "Enable"}</button>
            <div class="category-order-buttons" aria-label="Reorder ${escapeHtml(category.name)}">
              <button class="mini-button" type="button" title="Move up" data-action="move-document-category-up" data-category-id="${escapeHtml(category.id)}" data-rule-disabled="${index === 0}" ${writable && index > 0 ? "" : "disabled"}>↑</button>
              <button class="mini-button" type="button" title="Move down" data-action="move-document-category-down" data-category-id="${escapeHtml(category.id)}" data-rule-disabled="${index === categories.length - 1}" ${writable && index < categories.length - 1 ? "" : "disabled"}>↓</button>
            </div>
            <div class="document-category-merge">
              <select aria-label="Merge ${escapeHtml(category.name)} into" data-merge-target ${writable && mergeOptions ? "" : "disabled"}>${mergeOptions}</select>
              <button class="ghost-button" type="button" data-action="merge-document-category" data-category-id="${escapeHtml(category.id)}" data-rule-disabled="${!mergeOptions}" ${writable && mergeOptions ? "" : "disabled"}>Merge</button>
            </div>
            <button class="ghost-button danger" type="button" data-action="delete-document-category" data-category-id="${escapeHtml(category.id)}" data-rule-disabled="${documentCount > 0}" ${writable && documentCount === 0 ? "" : "disabled"} title="${documentCount ? "Merge or move documents before deleting" : "Delete empty category"}">Delete</button>
          </div>
        </article>`;
    })
    .join("");
  hydrateIcons(els.documentCategoriesList);
}

function saveDocumentCategories(categories, message = "Document categories updated") {
  const previousCategories = new Map(
    (state.company.documentCategories || []).map((category) => [category.id, category]),
  );
  const now = new Date().toISOString();
  state.company.documentCategories = normalizeDocumentCategories(
    categories.map((category, displayOrder) => ({
      ...category,
      displayOrder,
      updatedAt:
        previousCategories.get(category.id)?.displayOrder !== displayOrder ? now : category.updatedAt,
    })),
  );
  const categoryById = new Map(state.company.documentCategories.map((category) => [category.id, category]));
  state.contacts = state.contacts.map((contact) => ({
    ...contact,
    documents: (contact.documents || []).map((document) => ({
      ...document,
      leadId: contact.id,
      contactId: contact.id,
      category: categoryById.get(document.categoryId)?.name || document.category,
    })),
  }));
  saveState();
  renderDocumentCategoriesSettings();
  const selectedContact = getSelectedContact();
  if (selectedContact) renderLeadDocuments(selectedContact);
  showToast(message);
}

function createDocumentCategory(event) {
  event.preventDefault();
  if (!requireAction("manageCompany")) return;
  const formData = new FormData(els.documentCategoryCreateForm);
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  if (state.company.documentCategories.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
    showToast("Category names must be unique");
    return;
  }
  const now = new Date().toISOString();
  const category = normalizeDocumentCategory({
    id: uid("doccat"),
    name,
    displayOrder: state.company.documentCategories.length,
    icon: formData.get("icon"),
    color: formData.get("color"),
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  els.documentCategoryCreateForm.reset();
  els.documentCategoryCreateForm.elements.color.value = "#2563eb";
  saveDocumentCategories([...state.company.documentCategories, category], `${name} category created`);
}

function editDocumentCategory(categoryId, row) {
  const category = state.company.documentCategories.find((item) => item.id === categoryId);
  if (!category || !row) return;
  const name = String(row.querySelector('[data-category-field="name"]')?.value || "").trim();
  if (!name) {
    showToast("Category name is required");
    return;
  }
  if (state.company.documentCategories.some((item) => item.id !== categoryId && item.name.toLowerCase() === name.toLowerCase())) {
    showToast("Category names must be unique");
    return;
  }
  const updated = {
    ...category,
    name,
    icon: row.querySelector('[data-category-field="icon"]')?.value,
    color: row.querySelector('[data-category-field="color"]')?.value,
    updatedAt: new Date().toISOString(),
  };
  saveDocumentCategories(
    state.company.documentCategories.map((item) => (item.id === categoryId ? updated : item)),
    `${name} category saved`,
  );
}

function toggleDocumentCategory(categoryId) {
  const now = new Date().toISOString();
  saveDocumentCategories(
    state.company.documentCategories.map((category) =>
      category.id === categoryId ? { ...category, active: !category.active, updatedAt: now } : category,
    ),
  );
}

async function deleteDocumentCategory(categoryId) {
  const category = state.company.documentCategories.find((item) => item.id === categoryId);
  if (!category) return;
  if (documentCategoryDocumentCount(categoryId)) {
    showToast("Only empty categories can be deleted");
    return;
  }
  if (!(await appConfirm(`Delete the empty ${category.name} category?`, { title: "Delete category", confirmLabel: "Delete category", danger: true }))) return;
  saveDocumentCategories(
    state.company.documentCategories.filter((item) => item.id !== categoryId),
    `${category.name} category deleted`,
  );
}

async function mergeDocumentCategory(sourceId, targetId) {
  const source = state.company.documentCategories.find((category) => category.id === sourceId);
  const target = state.company.documentCategories.find((category) => category.id === targetId);
  if (!source || !target || source.id === target.id) return;
  if (!(await appConfirm(`Merge ${source.name} into ${target.name}? All documents will move and ${source.name} will be removed.`, { title: "Merge categories", confirmLabel: "Merge" }))) return;
  state.contacts = state.contacts.map((contact) => ({
    ...contact,
    documents: (contact.documents || []).map((document) =>
      document.categoryId === sourceId
        ? { ...document, leadId: contact.id, contactId: contact.id, categoryId: targetId, category: target.name }
        : document,
    ),
  }));
  saveDocumentCategories(
    state.company.documentCategories
      .filter((category) => category.id !== sourceId)
      .map((category) =>
        category.id === targetId ? { ...category, updatedAt: new Date().toISOString() } : category,
      ),
    `${source.name} merged into ${target.name}`,
  );
}

function moveDocumentCategory(categoryId, offset) {
  const categories = [...state.company.documentCategories];
  const index = categories.findIndex((category) => category.id === categoryId);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= categories.length) return;
  [categories[index], categories[targetIndex]] = [categories[targetIndex], categories[index]];
  saveDocumentCategories(categories, "Category order updated");
}

function reorderDocumentCategory(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const categories = [...state.company.documentCategories];
  const sourceIndex = categories.findIndex((category) => category.id === sourceId);
  const targetIndex = categories.findIndex((category) => category.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [moved] = categories.splice(sourceIndex, 1);
  categories.splice(targetIndex, 0, moved);
  saveDocumentCategories(categories, "Category order updated");
}

function openContactDialog(contactId, defaults = {}) {
  const contact = contactId ? getContact(contactId) : null;
  els.contactDialogTitle.textContent = contact ? "Edit Contact" : `Add ${defaults.type || "Lead"}`;
  els.deleteContactButton.classList.toggle("hidden", !contact || !canAction("manageContacts"));
  els.estimateFromContactButton.classList.toggle("hidden", !contact || !canAction("manageEstimates"));

  const data = {
    id: "",
    type: defaults.type || "Lead",
    status: "New",
    name: "",
    source: "",
    division: "roofing",
    service: "roof-replacement",
    propertyType: "residential",
    urgency: "normal",
    insuranceClaim: false,
    activeLeak: false,
    salesRep: "",
    email: "",
    phone: "",
    address: "",
    value: "",
    lastContact: todayISO(),
    closedDate: "",
    notes: "",
    ...contact,
  };
  populateDivisionFields(els.contactForm, data);

  // Reps always own the leads they create (the database refuses anything
  // else), so their name is filled in and only managers can reassign.
  const repField = els.contactForm.elements.salesRep;
  const unassigned = !data.salesRep || data.salesRep === "Unassigned";
  if (unassigned && (!contact || !canAssignLeadOwners())) data.salesRep = state.currentUser.name || "";
  if (repField) {
    repField.readOnly = !canAssignLeadOwners();
    repField.title = repField.readOnly ? "Ask a manager to reassign this lead" : "Choose a team member to give them this lead";
  }

  Object.entries(data).forEach(([key, value]) => {
    const field = els.contactForm.elements[key];
    if (field?.type === "checkbox") field.checked = Boolean(value);
    else if (field) {
      field.value = key === "phone" ? formatPhoneNumber(value) : key === "value" ? formatCurrencyInput(value) : value ?? "";
    }
  });
  rememberFormBaseline(els.contactForm);

  els.contactDialog.showModal();
}

async function saveContactFromForm(event) {
  event.preventDefault();
  if (!requireAction("manageContacts")) return;
  const formData = new FormData(els.contactForm);
  const id = formData.get("id") || uid("contact");
  const existing = getContact(id);
  const repProblem = salesRepNameProblem(formData.get("salesRep"));
  if (repProblem && normalizePersonName(formData.get("salesRep")) !== normalizePersonName(existing?.salesRep)) {
    showToast(repProblem);
    els.contactForm.elements.salesRep?.focus();
    return;
  }
  // A new lead with the same phone, email, or name and address as an existing
  // one is almost always the same person entered twice. Say so before saving.
  if (!existing) {
    const duplicates = findDuplicateContacts({ id, name: formData.get("name"), phone: formData.get("phone"), email: formData.get("email"), address: formData.get("address") });
    if (duplicates.length) {
      const first = duplicates[0];
      const choice = await openAppDialog({
        title: "This may be a duplicate",
        message: `${first.name}${first.leadNumber ? ` (${first.leadNumber})` : ""}${first.archived ? ", archived," : ""} has the same phone number, email, or name and address${duplicates.length > 1 ? `, and so do ${duplicates.length - 1} other lead${duplicates.length === 2 ? "" : "s"}` : ""}.`,
        confirmLabel: `Open ${first.name}`,
        extraLabel: "Save as a new lead",
        cancelLabel: "Cancel",
      });
      if (choice === true) {
        els.contactDialog.close();
        if (first.archived) { state.view = "contacts"; saveUiState(); render(); showToast(`${first.name} is archived. Restore it from Contacts > Archived.`); }
        else openLeadDetail(first.id);
        return;
      }
      if (choice !== "extra") return;
    }
  }
  const contact = {
    ...(existing || { createdAt: todayISO(), createdTimestamp: new Date().toISOString() }),
    id,
    type: formData.get("type"),
    status: formData.get("status"),
    name: formData.get("name").trim(),
    // "REFERRAL", "referral" and "Refferal" are saved as one source.
    source: formData.get("source").trim() ? leadSourceLabel(formData.get("source")) : "",
    division: formData.get("division") || "roofing",
    service: formData.get("service") || "",
    propertyType: formData.get("propertyType") || "residential",
    urgency: formData.get("activeLeak") === "on" ? "emergency" : formData.get("urgency") || "normal",
    insuranceClaim: formData.get("insuranceClaim") === "on",
    activeLeak: formData.get("activeLeak") === "on",
    email: formData.get("email").trim(),
    phone: formatPhoneNumber(formData.get("phone")),
    address: formData.get("address").trim(),
    value: number(formData.get("value")),
    salesRep: normalizePersonName(formData.get("salesRep").trim() || "Unassigned"),
    lastContact: formData.get("lastContact"),
    closedDate:
      formData.get("closedDate") ||
      (formData.get("status") === "Won" ? existing?.closedDate || todayISO() : ""),
    documents: existing?.documents || [],
    updates: existing?.updates || [],
    notes: formData.get("notes").trim(),
    updatedAt: new Date().toISOString(),
  };
  keepLatestUnchanged(contact, existing, unchangedFormFields(els.contactForm, formData),
    ["type", "status", "name", "source", "division", "service", "propertyType", "urgency", "insuranceClaim", "activeLeak", "email", "phone", "address", "value", "salesRep", "lastContact", "notes"]);
  const currentJobs = existing?.jobs?.length ? existing.jobs : [normalizeJob({}, contact)];
  const primary = normalizeJob(
    {
      ...currentJobs[0],
      name: currentJobs[0]?.name || `${contact.name} Job`,
      status: contact.status,
      division: contact.division,
      service: contact.service,
      propertyType: contact.propertyType,
      urgency: contact.urgency,
      insuranceClaim: contact.insuranceClaim,
      activeLeak: contact.activeLeak,
      value: contact.value,
      contractValue: contact.value,
      salesRep: contact.salesRep,
      address: contact.address,
      lastContact: contact.lastContact,
      closedDate: contact.closedDate,
      updatedAt: contact.updatedAt,
    },
    contact,
  );
  contact.jobs = [primary, ...currentJobs.slice(1)];
  Object.assign(contact, applySalesRepAssignment(contact));

  if (existing && existing.status !== contact.status) {
    contact.updates = [
      {
        id: uid("update"),
        author: currentActorName(),
        status: contact.status,
        message: `Status changed from ${existing.status} to ${contact.status}.`,
        createdAt: new Date().toISOString(),
      },
      ...(existing.updates || []),
    ];
  }

  if (existing) {
    state.contacts = state.contacts.map((item) => (item.id === id ? contact : item));
  } else {
    state.contacts.unshift(contact);
  }

  state.selectedContactId = id;
  saveState();
  els.contactDialog.close();
  render();
  showToast(`${contact.name} saved`);
}

function contactHasFinancialHistory(contactId) {
  const contact = getContact(contactId);
  if (!contact) return false;
  const jobs = contactJobs(contact);
  const estimates = state.estimates.filter((estimate) => estimate.contactId === contactId);
  return jobs.some((job) =>
    (job.manualPayments || []).length || number(job.paidAmount) > 0 || number(job.squarePaidAmount) > 0 ||
    Boolean(job.squareInvoiceId || job.squareOrderId || job.paidAt || job.lastPaymentAt || job.squareLastPaymentAt) ||
    (job.paymentRequests || []).length
  ) || estimates.some((estimate) =>
    number(estimate.paidAmount) > 0 || Boolean(estimate.squareInvoiceId || estimate.squareOrderId || estimate.paidAt) ||
    (estimate.paymentRequests || []).length
  );
}

async function deleteContact(contactId) {
  if (!requireAction("manageContacts")) return;
  const contact = getContact(contactId);
  if (!contact) return;
  if (contactHasFinancialHistory(contactId)) {
    // Payment history is never deleted. Offer the archive instead of a toast
    // that vanished in a second and left the record in every list and total.
    if (!canManageTeamData()) {
      showToast("This lead has invoice or payment history and must be retained for financial records. Ask a manager to archive it instead.");
      return;
    }
    await setContactArchived(contactId, true);
    return;
  }
  const hasEstimates = state.estimates.some((estimate) => estimate.contactId === contactId);
  const documentCount = (contact.documents || []).length;
  const affected = [
    hasEstimates ? "its estimates" : "",
    documentCount ? `${documentCount} document record${documentCount === 1 ? "" : "s"} (stored file revisions will be retained)` : "",
  ].filter(Boolean).join(" and ");
  const message = affected ? `Delete ${contact.name} and archive ${affected}?` : `Delete ${contact.name}?`;
  if (!(await appConfirm(message, { title: "Delete lead", confirmLabel: "Delete lead", danger: true }))) return;

  if (!(await settleDurableWritesBeforeTrustedMutation())) {
    showToast("This lead was not deleted because pending shared changes could not be confirmed.");
    return;
  }
  const previousContacts = state.contacts;
  const previousEstimates = state.estimates;
  const previousContactId = state.selectedContactId;
  const previousEstimateId = state.selectedEstimateId;
  const previousView = state.view;
  state.contacts = state.contacts.filter((item) => item.id !== contactId);
  state.estimates = state.estimates.filter((estimate) => estimate.contactId !== contactId);
  // Go back to the lead list. This used to select whichever lead happened to
  // be first and show its page, which looked like the delete had failed and
  // made it easy to delete a second, unrelated lead.
  state.selectedContactId = null;
  if (state.selectedEstimateId && !state.estimates.some((estimate) => estimate.id === state.selectedEstimateId)) {
    state.selectedEstimateId = state.estimates[0]?.id || null;
  }
  if (state.view === "leadDetail") state.view = canView("leads") ? "leads" : firstAllowedView();
  saveState({ localOnly: true });
  if (canUseCloudSync() && !(await flushDurableRecordsSave())) {
    state.contacts = previousContacts;
    state.estimates = previousEstimates;
    state.selectedContactId = previousContactId;
    state.selectedEstimateId = previousEstimateId;
    state.view = previousView;
    saveState({ localOnly: true });
    showToast("The lead was not deleted because the shared CRM did not confirm the archive.");
    render();
    return;
  }
  queueCloudSave();
  saveUiState();
  els.contactDialog.close();
  render();
  showToast(`${contact.name} deleted`);
}

// A draft nobody has filled in yet: no prices and nothing but the starter line.
function estimateIsUntouchedDraft(estimate = {}) {
  return estimate.status === "Draft" && !estimate.squareInvoiceId && totalsFor(estimate).total === 0
    && (estimate.items || []).every((item) => isPlaceholderEstimateItem(item) || (!number(item.rate) && !String(item.title || "").trim()));
}

function openExistingEstimate(estimate, contactId, shouldRender = true) {
  state.selectedEstimateId = estimate.id;
  state.selectedContactId = contactId;
  state.newEstimateContactId = "";
  state.newEstimateJobId = "";
  state.view = "estimates";
  saveUiState();
  if (shouldRender) render();
  return estimate;
}

async function createEstimate(contactId, shouldRender = true, jobId = "", { forceNew = false } = {}) {
  if (!requireAction("manageEstimates")) return null;
  if (!contactId) {
    showToast("Choose a lead before creating an estimate");
    return null;
  }
  let contact = getContact(contactId);
  if (!contact) {
    showToast("Choose a valid lead before creating an estimate");
    return null;
  }
  const initialJob = contactJobs(contact).find((item) => item.id === jobId) || primaryJob(contact);
  // The Estimate button on a lead or job used to add a new blank draft on every
  // click (one job collected ten $0.00 drafts). Reuse an untouched draft, and
  // ask before adding another estimate to a job that already has one.
  if (!forceNew && initialJob) {
    const existing = state.estimates
      .filter((item) => item.contactId === contactId && (item.jobId === initialJob.id || (!item.jobId && primaryJob(contact)?.id === initialJob.id)))
      .sort((a, b) => activityTimestamp(b.updatedAt || b.sentAt || b.issueDate) - activityTimestamp(a.updatedAt || a.sentAt || a.issueDate));
    const untouched = existing.find(estimateIsUntouchedDraft);
    if (untouched) {
      showToast(`Opened draft ${untouched.estimateNumber}, which is still blank for this job.`);
      return openExistingEstimate(untouched, contactId, shouldRender);
    }
    if (existing.length) {
      const latest = existing[0];
      const choice = await openAppDialog({
        title: "This job already has an estimate",
        message: `${initialJob.name} has ${existing.length} estimate${existing.length === 1 ? "" : "s"}. The latest is ${latest.estimateNumber} (${latest.status}, ${money.format(totalsFor(latest).total)}).`,
        confirmLabel: `Open ${latest.estimateNumber}`,
        extraLabel: "Create a new estimate",
        cancelLabel: "Cancel",
      });
      if (choice === true) return openExistingEstimate(latest, contactId, shouldRender);
      if (choice !== "extra") return null;
    }
  }
  const wording = estimateWordingFor(initialJob?.division || contact.division || "roofing");
  const estimateId = uid("estimate");
  let reservation = null;
  if (canUseCloudSync()) {
    try { reservation = await reserveSharedSalesNumbers(contactId, initialJob?.id || jobId, estimateId); }
    catch (error) { showToast(error.message || "A shared estimate number could not be reserved."); return null; }
  }
  const numbered = reservation ? null : ensureLeadProjectNumbers(contactId, initialJob?.id || jobId);
  contact = getContact(contactId) || numbered?.contact || contact;
  const job = contactJobs(contact).find((item) => item.id === (initialJob?.id || jobId)) || numbered?.job || initialJob;

  const estimate = {
    id: estimateId,
    contactId,
    jobId: job?.id || "",
    leadNumber: reservation?.leadNumber || contact.leadNumber,
    projectNumber: reservation?.projectNumber || job?.projectNumber || "",
    estimateNumber: reservation?.estimateNumber || nextEstimateNumber(),
    projectTitle: job?.name || wording.title,
    status: "Draft",
    projectManager: normalizePersonName(job?.salesRep || contact.salesRep || state.currentUser.name || ""),
    salesRepEmail: state.currentUser.email || state.company.email || "",
    salesRepPhone: state.currentUser.phone || state.company.phone || "",
    issueDate: todayISO(),
    validUntil: addDaysISO(14),
    scopeSummary: wording.scope,
    taxRate: 0,
    deposit: 0,
    contractValue: 0,
    paidAmount: 0,
    paymentPercent: 0,
    paymentRequests: [],
    notes: state.company.defaultTerms,
    sentAt: "",
    items: [
      {
        id: uid("line"),
        title: wording.line,
        description: ESTIMATE_PLACEHOLDER_DESCRIPTION,
        quantity: 1,
        unit: "job",
        rate: 0,
      },
    ],
  };

  state.estimates.unshift(estimate);
  state.selectedEstimateId = estimate.id;
  state.selectedContactId = contactId;
  state.newEstimateContactId = "";
  state.newEstimateJobId = "";
  state.view = "estimates";
  saveState();
  queueEstimateVerifiedSave(estimate.id, { immediate: true });
  if (shouldRender) render();
  return estimate;
}

function nextEstimateNumber() {
  const values = state.estimates
    .map((estimate) => Number(String(estimate.estimateNumber).replace(/\D/g, "")))
    .filter(Number.isFinite);
  const next = values.length ? Math.max(...values) + 1 : 1001;
  return `EST-${next}`;
}

function renderEstimateSaveState(estimateId = getSelectedEstimate()?.id) {
  if (!els.estimateSaveStatus) return;
  const stateForEstimate = estimateSaveStates.get(estimateId) || {
    message: "",
    tone: "",
  };
  setSaveState(
    els.estimateSaveStatus,
    stateForEstimate.message,
    stateForEstimate.tone,
    { showSuccess: true },
  );
}

function setEstimateSaveState(estimateId, message, tone = "") {
  estimateSaveStates.set(estimateId, { message, tone });
  if (getSelectedEstimate()?.id === estimateId) renderEstimateSaveState(estimateId);
}

async function flushEstimateVerifiedSave(estimateId, revision = estimateSaveRevisions.get(estimateId) || 0) {
  if (localStateWriteBlocked) {
    setEstimateSaveState(estimateId, "Not saved. Another CRM tab saved newer work; reload this tab before editing again.", "error");
    return false;
  }
  if (durableWriteBlocked) {
    setEstimateSaveState(estimateId, "Not saved. Saving is paused in this tab; reload the page to sync, then save again.", "error");
    return false;
  }
  if (!estimateId || !state.estimates.some((estimate) => estimate.id === estimateId)) return false;
  window.clearTimeout(estimateSaveTimers.get(estimateId));
  estimateSaveTimers.delete(estimateId);
  const isExplicitSave = estimateExplicitSaves.has(estimateId);
  if (!isExplicitSave) setEstimateSaveState(estimateId, "", "");

  const saved = await persistEstimateRecord(estimateId);
  const latestRevision = estimateSaveRevisions.get(estimateId) || 0;
  if (saved && revision === latestRevision) {
    if (!isExplicitSave) setEstimateSaveState(estimateId, "", "");
  } else if (!saved && revision === latestRevision) {
    setEstimateSaveState(estimateId, "Not saved to the shared CRM. Use Save Estimate to retry.", "error");
    showToast("Estimate save failed—your values are still on this page. Please retry.");
  }
  return saved;
}

function queueEstimateVerifiedSave(estimateId, { immediate = false } = {}) {
  if (durableWriteBlocked) return;
  if (!estimateId) return;
  const revision = (estimateSaveRevisions.get(estimateId) || 0) + 1;
  estimateSaveRevisions.set(estimateId, revision);
  estimateCompletedSaveRevisions.delete(estimateId);
  window.clearTimeout(estimateSaveTimers.get(estimateId));
  setEstimateSaveState(estimateId, "", "");
  const timer = window.setTimeout(
    () => void flushEstimateVerifiedSave(estimateId, revision),
    immediate ? 0 : 2000,
  );
  estimateSaveTimers.set(estimateId, timer);
}

function scheduleEstimateVisualRefresh(estimateId) {
  window.clearTimeout(estimateVisualRefreshTimer);
  estimateVisualRefreshTimer = window.setTimeout(() => {
    const estimate = state.estimates.find((item) => item.id === estimateId);
    if (!estimate || getSelectedEstimate()?.id !== estimateId) return;
    renderEstimatePreview(estimate);
    renderSummary();
    renderEstimateActiveSummary(estimate);
  }, 80);
}

function updateSelectedEstimateFromField(fieldName, value) {
  if (!canAction("manageEstimates")) return;
  const estimate = getSelectedEstimate();
  if (!estimate) return;
  if (fieldName === "estimateNumber") {
    els.estimateNumber.value = estimate.estimateNumber;
    return;
  }
  if (canUseCloudSync() && estimate.estimateNumber && ["contactId", "jobId"].includes(fieldName) && value !== estimate[fieldName]) {
    showToast("A numbered estimate stays with its original lead and job. Create a new estimate for a different project.");
    renderEstimateForm(estimate);
    return;
  }
  if (["contactId", "jobId"].includes(fieldName) && value !== estimate[fieldName]) {
    const hasDocument = state.contacts.some((contact) => (contact.documents || []).some((document) => document.estimateId === estimate.id));
    if (estimate.squareInvoiceId || number(estimate.paidAmount) > 0 || hasDocument) {
      showToast("This estimate already has a saved PDF or invoice. Create a new estimate for a different lead or job.");
      renderEstimateForm(estimate);
      return;
    }
    const contact = getContact(fieldName === "contactId" ? value : estimate.contactId);
    if (!contact || (fieldName === "jobId" && !contactJobs(contact).some((job) => job.id === value))) {
      showToast("Select an existing lead and a job belonging to that lead.");
      renderEstimateForm(estimate);
      return;
    }
  }

  if (fieldName === "deposit" && /%/.test(String(value))) {
    showToast("Enter the deposit as a dollar amount, not a percentage.");
    renderEstimateForm(estimate);
    return;
  }
  const enteringSent = fieldName === "status" && value === "Sent" && estimate.status !== "Sent";
  if (["taxRate", "deposit"].includes(fieldName)) {
    estimate[fieldName] = Math.max(0, number(value));
  } else if (fieldName === "projectManager") {
    estimate[fieldName] = normalizePersonName(value);
  } else {
    estimate[fieldName] = value;
  }

  if (fieldName === "status") {
    if (enteringSent) estimate.sentAt = new Date().toISOString();
    syncEstimatePipelineStage(estimate, value);
  }

  if (fieldName === "contactId") {
    const numbered = ensureLeadProjectNumbers(value);
    const contact = numbered?.contact || getContact(value);
    estimate.jobId = numbered?.job?.id || primaryJob(contact)?.id || "";
    estimate.leadNumber = contact?.leadNumber || "";
    estimate.projectNumber = numbered?.job?.projectNumber || "";
    estimate.projectManager = normalizePersonName(contact?.salesRep || estimate.projectManager);
    state.selectedContactId = value;
    renderEstimateForm(estimate);
  }
  if (fieldName === "jobId") {
    const numbered = ensureLeadProjectNumbers(estimate.contactId, value);
    estimate.leadNumber = numbered?.contact?.leadNumber || estimate.leadNumber || "";
    estimate.projectNumber = numbered?.job?.projectNumber || "";
    estimate.projectTitle = numbered?.job?.name || estimate.projectTitle;
  }
  queueLocalStateSave();
  queueEstimateVerifiedSave(estimate.id);
  scheduleEstimateVisualRefresh(estimate.id);
}

// Which line of the estimate a row on screen is. The row carries the line's
// id: a teammate's line can be combined into the estimate while this editor
// is still showing the rows it drew before, and the position alone would then
// point at a different line.
function estimateLineIndex(estimate, row) {
  const id = row?.dataset?.lineId || "";
  if (id) {
    const byId = (estimate?.items || []).findIndex((item) => String(item.id ?? "") === id);
    if (byId >= 0) return byId;
    // The line this row showed is gone (a teammate removed it).
    if ((estimate?.items || []).some((item) => item.id !== undefined && item.id !== "")) return -1;
  }
  return Number(row?.dataset?.lineIndex);
}

function updateLineItem(input) {
  if (!canAction("manageEstimates")) return;
  const estimate = getSelectedEstimate();
  if (!estimate) return;
  const row = input.closest("[data-line-index]");
  const index = estimateLineIndex(estimate, row);
  const field = input.dataset.lineField;
  if (!estimate.items[index] || !field) return;

  estimate.items[index][field] = ["quantity", "rate"].includes(field) ? number(input.value) : input.value;
  queueLocalStateSave();
  queueEstimateVerifiedSave(estimate.id);
  scheduleEstimateVisualRefresh(estimate.id);
}

async function deleteEstimate() {
  if (!requireAction("manageEstimates")) return;
  const estimate = getSelectedEstimate();
  if (!estimate) return;
  if (estimate.squareInvoiceId || number(estimate.paidAmount) > 0 || state.contacts.some((contact) =>
    (contact.documents || []).some((document) => document.estimateId === estimate.id))) {
    showToast("This estimate has an invoice, payment, or saved PDF and must be retained for your records.");
    return;
  }

  if (!(await appConfirm(`Delete estimate ${estimate.estimateNumber}?`, { title: "Delete estimate", confirmLabel: "Delete estimate", danger: true }))) return;
  state.estimates = state.estimates.filter((item) => item.id !== estimate.id);
  state.selectedEstimateId = state.estimates[0]?.id || null;
  saveState();
  render();
  showToast("Estimate deleted");
}

function estimateText(estimate = getSelectedEstimate()) {
  if (!estimate) return "";
  const contact = getEstimateContact(estimate);
  const job = getEstimateJob(estimate);
  const totals = totalsFor(estimate);
  const rep = estimateSalesRep(estimate);
  const lines = estimate.items
    .map(
      (item) =>
        `- ${item.title || "Line item"}: ${number(item.quantity)} ${item.unit} x ${money.format(
          number(item.rate),
        )} = ${money.format(estimateLineAmount(item))}${
          item.description ? `\n  ${item.description}` : ""
        }`,
    )
    .join("\n");

  return `${state.company.name}
Estimate ${estimate.estimateNumber}
Title: ${estimate.projectTitle || ""}

Job:
${job?.name || ""}
${job?.address || contact?.address || ""}

Customer:
${contact?.name || ""}
${contact?.address || ""}
${contact?.phone || ""}
${contact?.email || ""}

Sales Representative:
${rep.name || ""}
${rep.email || ""}
${rep.phone || ""}
${rep.officeAddress || ""}

Scope:
${estimate.scopeSummary}

Items:
${lines}

Subtotal: ${money.format(totals.subtotal)}
Tax: ${money.format(totals.tax)}
Deposit: ${money.format(number(estimate.deposit))}
Total: ${money.format(totals.total)}
Balance Due: ${money.format(totals.balance)}

Notes:
${estimate.notes || state.company.defaultTerms}`;
}

function estimateFileName(estimate = getSelectedEstimate()) {
  const contact = getEstimateContact(estimate);
  // Name the file after the job it is for: a lead can have several jobs, and
  // every one of their estimates used to carry only the lead's name.
  const job = getEstimateJob(estimate);
  const jobLabel = job?.name && job.name !== contact?.name ? job.name : "";
  return [estimate?.estimateNumber || "estimate", contact?.name || "customer", jobLabel].filter(Boolean).join("-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .concat(".pdf");
}

// The copy of an estimate's PDF that is already filed under its lead, if any.
// A lead's documents are loaded only when someone opens them, so on the
// Estimates screen the filed copy was usually not known about: each download
// then filed a second, separate copy of the same PDF under the lead instead of
// updating the first. When the documents are not loaded this asks the database
// for that one record.
//
// The answer has two parts, and the second matters as much as the first:
//   document  the filed copy, or null;
//   known     true when that is certain. False when the question could not be
//             asked (the connection failed, the lead's documents could not be
//             loaded). "Could not look" is not "there is none": treating it as
//             none filed a second copy of a PDF that was already there.
async function findFiledEstimatePdf(contactId, estimateId, jobId = null) {
  const authoritative = jobId !== null && canUseCloudSync();
  const local = () => (getContact(contactId)?.documents || []).find((document) => document.source === "Estimate PDF" && document.estimateId === estimateId) || null;
  const answer = (known) => { const document = local(); return { document, known: Boolean(document) || known === true }; };
  if (!authoritative && local()) return answer(true);
  // Without the shared CRM, what is on this device is all there is.
  if (!canUseCloudSync()) return answer(true);
  if (!durableRecordsReady || !cloudClient) return { known: false, document: null };
  if (!authoritative && durableHeavyLeadLoads.has(contactId)) {
    // The lead's documents are loaded or loading. That load says whether it worked.
    return answer((await durableHeavyLeadLoads.get(contactId)) === true);
  }
  try {
    const query = cloudClient.from(SUPABASE_RECORDS_TABLE).select("*")
      .eq("company_state_id", supabaseStateId()).eq("record_type", "document").eq("lead_id", contactId)
      .is("deleted_at", null).eq("data->>estimateId", estimateId).eq("data->>source", "Estimate PDF");
    if (authoritative) query.eq("job_id", jobId);
    const { data, error } = await query.order("id", { ascending: true }).limit(1);
    if (error || !Array.isArray(data)) {
      console.warn("The filed estimate PDF could not be looked up", error);
      return { known: false, document: null };
    }
    const row = data[0];
    const contact = getContact(contactId);
    if (!contact) return { known: false, document: null };
    if (!row) return authoritative ? { known: true, document: null } : answer(true);
    if (!authoritative && local()) return answer(true);
    const filed = normalizeDocument(
      { ...row.data, id: row.id, jobId: row.job_id || row.data?.jobId || "" },
      { leadId: contactId, categoryId: row.data?.categoryId || "", categories: state.company.documentCategories },
    );
    // Set directly, as loading a lead's documents does: finding a record is not
    // an edit, so the lead is not marked as changed.
    contact.documents = [filed, ...(contact.documents || []).filter((document) => document.id !== filed.id)];
    rememberAdditionalDurableRows([row]);
    return authoritative ? { known: true, document: filed, row } : answer(true);
  } catch (error) {
    console.warn("The filed estimate PDF could not be looked up", error);
    return { known: false, document: null };
  }
}

// ---- Filing a PDF later, when it could not be checked for a copy ------------
// The rep still gets the PDF straight away. It is filed under the lead once
// the CRM can say whether a copy is already there: as a new version of that
// copy if so, as the first copy if not. Kept only while this tab is open.
const ESTIMATE_PDF_FILING_RETRY_DELAYS = [15000, 45000, 120000, 300000, 600000];
const estimatePdfFilingRetries = new Map(); // estimate id -> { estimate, doc, attempt, timer }

function clearEstimatePdfFilingRetry(estimateId) {
  const waiting = estimatePdfFilingRetries.get(estimateId);
  if (waiting) window.clearTimeout(waiting.timer);
  estimatePdfFilingRetries.delete(estimateId);
}

function queueEstimatePdfFiling(estimate, doc, attempt = 0) {
  clearEstimatePdfFilingRetry(estimate.id);
  if (attempt >= ESTIMATE_PDF_FILING_RETRY_DELAYS.length) return false;
  const timer = window.setTimeout(() => { void retryEstimatePdfFiling(estimate.id); }, ESTIMATE_PDF_FILING_RETRY_DELAYS[attempt]);
  estimatePdfFilingRetries.set(estimate.id, { estimate, doc, attempt, timer });
  return true;
}

async function retryEstimatePdfFiling(estimateId) {
  const waiting = estimatePdfFilingRetries.get(estimateId);
  if (!waiting) return false;
  clearEstimatePdfFilingRetry(estimateId);
  const contact = getEstimateContact(waiting.estimate);
  // The estimate or its lead has gone, or this person may no longer file documents.
  if (!contact || !state.estimates.some((item) => item.id === estimateId) || !canAction("manageDocuments")) return false;
  try {
    const filed = await saveEstimatePdfDocument(waiting.estimate, contact, waiting.doc);
    if (!filed) return false;
    setEstimateSaveState(estimateId, "The estimate's PDF is now filed under the lead.", "success");
    showToast(`The PDF of estimate ${waiting.estimate.estimateNumber || ""} is now filed under the lead`.replace("  ", " "));
    return true;
  } catch (error) {
    if (error?.code === "estimate_pdf_lookup_unavailable") {
      // Still cannot look. Try again later, a few times, and then leave it:
      // the next download or save of this estimate files it.
      if (!queueEstimatePdfFiling(waiting.estimate, waiting.doc, waiting.attempt + 1)) {
        setEstimateSaveState(estimateId, "The estimate's PDF is still not filed under the lead. Download it again once the CRM is reachable.", "error");
      }
      return false;
    }
    console.warn("Estimate PDF could not be filed on a later try", error);
    return false;
  }
}

// When the connection comes back, do not wait out the timers.
