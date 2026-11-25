(() => {
  const productionStatuses = [
    "New",
    "Contacted",
    "Inspection",
    "Estimate Sent",
    "Won",
    "Scheduled",
    "Materials Ordered",
    "In Progress",
    "Completed",
    "Paid",
    "Lost",
  ];
  const activeContractStatuses = ["Won", "Scheduled", "Materials Ordered", "In Progress"];
  const closedProductionStatuses = ["Completed", "Paid"];
  const soldStatuses = [...activeContractStatuses, ...closedProductionStatuses];
  const terminalStatuses = ["Paid", "Lost"];

  function hasAppGlobals() {
    try {
      return Boolean(state && els && typeof render === "function");
    } catch {
      return false;
    }
  }

  function isSoldStatus(status = "") {
    return soldStatuses.includes(status);
  }

  function isClosedProductionStatus(status = "") {
    return closedProductionStatuses.includes(status);
  }

  function isTerminalStatus(status = "") {
    return terminalStatuses.includes(status);
  }

  function nextWorkflowStatus(status = "New") {
    const index = productionStatuses.indexOf(status);
    if (index === -1) return "Contacted";
    return productionStatuses[Math.min(index + 1, productionStatuses.length - 1)];
  }

  function syncStatuses() {
    try {
      if (Array.isArray(statuses)) {
        statuses.splice(0, statuses.length, ...productionStatuses);
      }
    } catch {}
  }

  function ensureStatusOptions(root = document) {
    root.querySelectorAll('select[name="status"]').forEach((select) => {
      const currentValue = select.value;
      const existing = new Set([...select.options].map((option) => option.value || option.textContent));
      productionStatuses.forEach((status) => {
        if (existing.has(status)) return;
        const option = document.createElement("option");
        option.value = status;
        option.textContent = status;
        select.appendChild(option);
      });
      if (currentValue) select.value = currentValue;
    });
  }

  function patchedStatusPillClass(status = "") {
    const normalized = String(status || "").toLowerCase().replace(/\s+/g, "-");
    if (["won", "completed", "paid", "contract", "approved"].includes(normalized)) return "pill-won";
    if (normalized === "lost" || normalized === "rejected" || normalized === "declined") return "pill-lost";
    if (["estimate-sent", "sent", "estimate", "invoiced"].includes(normalized)) return "pill-sent";
    if (["inspection", "scheduled", "materials-ordered", "in-progress", "design-&-selections", "permits", "demo", "rough-in", "inspections", "finishes", "punch-list", "final-walkthrough"].includes(normalized)) return "pill-inspection";
    if (["contacted", "consultation", "request"].includes(normalized)) return "pill-contacted";
    if (normalized === "new") return "pill-new";
    return "pill-default";
  }

  function patchedStaleClass(contact) {
    if (isSoldStatus(contact.status) || contact.status === "Lost") return "";
    try {
      if (contactJobs(contact).every((job) => jobLifecyclePhase(job) !== "sales")) return "";
    } catch { /* Fall back to the roofing stage names above. */ }
    const days = staleLeadDays(contact);
    if (days >= 14) return "stale-red";
    if (days >= 7) return "stale-amber";
    return "";
  }

  function patchedRenderLeadCard(contact) {
    const job = primaryJob(contact);
    const nextStatus = nextWorkflowStatus(contact.status);
    const days = staleLeadDays(contact);
    const sc = patchedStaleClass(contact);
    const staleTag = sc ? `<span class="stale-badge ${sc}">${days}d no contact</span>` : "";
    const initials = contactInitials(contact.name);
    const avatarClass = initialsColor(contact.name);
    return `
      <article class="lead-card ${sc}">
        <header>
          <div class="lead-card-avatar ${avatarClass}">${escapeHtml(initials)}</div>
          <div class="lead-card-header-text">
            <h4>
              <button class="link-button" type="button" data-action="open-contact" data-contact-id="${contact.id}">
                ${escapeHtml(contact.name)}
              </button>
            </h4>
            <p>${escapeHtml(contact.source || "No source")} &middot; ${money.format(
              contactJobs(contact).reduce((sum, item) => sum + number(item.value), 0),
            )}</p>
          </div>
          <span class="status-pill ${patchedStatusPillClass(contact.status)}">${escapeHtml(contact.status)}</span>
        </header>
        ${staleTag}
        <p>${telLink(contact.phone) || "No phone"}<br />${escapeHtml(contact.email || "No email")}</p>
        <p>${escapeHtml(job.name)}<br />${escapeHtml((job.address || contact.address || "").split("\n")[0] || "No job address")}</p>
        <div class="card-actions">
          <button class="secondary-button" type="button" data-action="open-contact" data-contact-id="${contact.id}">
            <span aria-hidden="true" data-icon="open"></span>
            Open
          </button>
          <button class="mini-button" type="button" title="Edit contact" aria-label="Edit ${escapeHtml(
            contact.name,
          )}" data-action="edit-contact" data-contact-id="${contact.id}">
            <span aria-hidden="true" data-icon="edit"></span>
          </button>
          <button class="mini-button" type="button" title="Create estimate" aria-label="Create estimate for ${escapeHtml(
            contact.name,
          )}" data-action="estimate-contact" data-contact-id="${contact.id}">
            <span aria-hidden="true" data-icon="file"></span>
          </button>
          ${
            !isTerminalStatus(contact.status)
              ? `<button class="ghost-button" type="button" data-action="advance-contact" data-contact-id="${contact.id}" data-next-status="${nextStatus}">${nextStatus}</button>`
              : ""
          }
        </div>
      </article>
    `;
  }

  function refreshCurrentView() {
    ensureStatusOptions();
    if (state.view === "dashboard") { renderSummary(); renderDashboard(); }
    if (state.view === "projects") renderProjectsView();
    if (state.view === "reviews") renderReviewsView();
    if (state.view === "pipeline") {
      try {
        renderPipeline();
      } catch {}
    }
    applyPermissionsToDom();
  }

  function installProductionFlow() {
    if (!hasAppGlobals() || window.__rooflineProductionFlowV64Installed) return false;
    window.__rooflineProductionFlowV64Installed = true;
    window.RooflineProductionFlow = {
      beforeRender: syncStatuses, statusPillClass: patchedStatusPillClass, staleClass: patchedStaleClass, renderLeadCard: patchedRenderLeadCard,
      version: "64",
      statuses: productionStatuses,
      activeContractStatuses,
      closedProductionStatuses,
      soldStatuses,
      isSoldStatus,
      isClosedProductionStatus,
      nextWorkflowStatus,
    };

    syncStatuses();
    try {
      render();
    } catch {
      refreshCurrentView();
    }
    return true;
  }

  if (window.JobCrestApp?.ready) installProductionFlow();
  else window.addEventListener("jobcrest:app-ready", installProductionFlow, { once: true });
})();
