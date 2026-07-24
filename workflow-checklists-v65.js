(() => {
  const progressionStages = [
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
  ];

  const checklistDefinitions = {
    New: [
      autoItem("contact-name", "Customer name entered", (contact) => Boolean(contact.name?.trim())),
      autoItem("contact-phone", "Phone number entered", (contact) => Boolean(contact.phone?.trim())),
      autoItem("contact-email", "Email address entered", (contact) => Boolean(contact.email?.trim())),
      autoItem(
        "job-address",
        "Job address entered",
        (contact, job) => Boolean((job.address || contact.address || "").trim()),
      ),
      autoItem("lead-source", "Lead source entered", (contact) => Boolean(contact.source?.trim())),
      autoItem(
        "sales-rep",
        "Sales representative assigned",
        (contact, job) => Boolean((job.salesRep || contact.salesRep || "").trim()) &&
          (job.salesRep || contact.salesRep) !== "Unassigned",
      ),
      autoItem(
        "project-notes",
        "Requested work documented",
        (contact, job) => Boolean((job.notes || contact.notes || "").trim()),
      ),
    ],
    Contacted: [
      manualItem("customer-reached", "Customer reached and introduction completed"),
      manualItem("decision-maker", "Decision maker confirmed"),
      manualItem("needs-documented", "Project needs and urgency documented"),
      manualItem("inspection-scheduled", "Inspection appointment scheduled"),
      manualItem("project-path", "Insurance, retail, or service path identified"),
    ],
    Inspection: [
      manualItem("inspection-complete", "Inspection completed"),
      manualItem("photos-measurements", "Photos and measurements saved"),
      manualItem("findings-documented", "Damage and inspection findings documented"),
      manualItem("scope-selected", "Scope and material system confirmed"),
      autoItem(
        "estimate-created",
        "Estimate created for this job",
        (contact, job) => estimatesForJob(contact, job).length > 0,
      ),
    ],
    "Estimate Sent": [
      autoItem(
        "estimate-sent",
        "Estimate marked Sent or Approved",
        (contact, job) =>
          estimatesForJob(contact, job).some((estimate) => ["Sent", "Approved"].includes(estimate.status)),
      ),
      manualItem("estimate-reviewed", "Estimate reviewed with customer"),
      manualItem("follow-up-scheduled", "Follow-up date scheduled"),
      manualItem("objections-documented", "Objections, financing, and payment path documented"),
      manualItem("approval-received", "Customer approval or signed contract received"),
    ],
    Won: [
      manualItem("signed-contract", "Signed contract uploaded to Documents"),
      manualItem("deposit-terms", "Deposit and payment terms recorded"),
      manualItem("production-handoff", "Production handoff notes completed"),
      manualItem("permit-review", "Permit and HOA requirements reviewed"),
      manualItem("expectations-confirmed", "Customer expectations and communication plan confirmed"),
    ],
    Scheduled: [
      manualItem("start-date", "Installation or start date confirmed"),
      manualItem("crew-assigned", "Project manager and crew assigned"),
      manualItem("supplier-confirmed", "Supplier and material list confirmed"),
      manualItem("customer-notified", "Customer notified of schedule"),
      manualItem("access-notes", "Site access and property-protection instructions documented"),
    ],
    "Materials Ordered": [
      manualItem("order-confirmed", "Purchase order or material order confirmed"),
      manualItem("delivery-confirmed", "Delivery date confirmed"),
      manualItem("crew-reconfirmed", "Crew start date reconfirmed"),
      manualItem("prestart-message", "Customer pre-start communication sent"),
      manualItem("prejob-plan", "Pre-job photos and site-protection plan completed"),
    ],
    "In Progress": [
      manualItem("work-started", "Crew checked in and work started"),
      manualItem("progress-current", "Progress notes and photos current"),
      manualItem("change-orders", "Change orders documented and approved"),
      manualItem("quality-check", "Quality-control inspection completed"),
      manualItem("punch-list", "Punch list completed"),
    ],
    Completed: [
      manualItem("completion-photos", "Completion photos saved"),
      manualItem("final-invoice", "Final invoice sent"),
      manualItem("warranty-docs", "Warranty and closeout documents delivered"),
      manualItem("walkthrough", "Final walkthrough accepted"),
      manualItem("final-payment", "Final payment received"),
    ],
    Paid: [
      manualItem("warranty-registered", "Warranty registered"),
      manualItem("review-requested", "Review request sent"),
      manualItem("referral-requested", "Referral request completed"),
    ],
    Lost: [
      manualItem("loss-reason", "Loss reason documented"),
      manualItem("final-note", "Final customer note recorded"),
      manualItem("nurture-date", "Future follow-up or nurture date considered"),
    ],
  };

  const chronologicalNavigation = [
    {
      label: "Overview",
      items: [{ view: "dashboard", label: "Dashboard", icon: "home" }],
    },
    {
      label: "Sales Process",
      items: [
        { view: "leads", label: "Lead Intake", icon: "user", step: "1" },
        { view: "contacts", label: "Contacts", icon: "users", step: "2" },
        { view: "pipeline", label: "Sales Pipeline", icon: "bar-chart", step: "3" },
        { view: "jobs", label: "Inspections & Jobs", icon: "briefcase", step: "4" },
        { view: "estimates", label: "Estimates", icon: "file", step: "5" },
        { view: "projects", label: "Sold Jobs & Production", icon: "hammer", step: "6" },
        { view: "invoices", label: "Billing & Payments", icon: "invoice", step: "7" },
        { view: "reviews", label: "Reviews & Referrals", icon: "star", step: "8" },
      ],
    },
    {
      label: "Workspace",
      items: [
        { view: "calendar", label: "Calendar", icon: "calendar" },
        { view: "tasks", label: "Tasks", icon: "clipboard" },
        { view: "companyDocuments", label: "Documents", icon: "folder" },
        { view: "reports", label: "Reports", icon: "bar-chart" },
        { view: "company", label: "Settings", icon: "settings" },
      ],
    },
  ];

  let selectedWorkflowJobId = "";
  let originalApplyStatusUpdate = null;

  function autoItem(id, label, test) {
    return { id, label, mode: "auto", test };
  }

  function manualItem(id, label) {
    return { id, label, mode: "manual" };
  }

  function hasAppGlobals() {
    try {
      return Boolean(
        state &&
          els &&
          typeof render === "function" &&
          typeof renderLeadDetail === "function" &&
          typeof updateContact === "function" &&
          window.RooflineProductionFlow,
      );
    } catch {
      return false;
    }
  }

  function assignGlobal(name, value) {
    try {
      window[name] = value;
    } catch {}
    try {
      Function("value", `${name} = value;`)(value);
    } catch {}
  }

  function estimatesForJob(contact, job) {
    try {
      return state.estimates.filter(
        (estimate) =>
          estimate.contactId === contact.id &&
          (estimate.jobId === job.id || (!estimate.jobId && primaryJob(contact)?.id === job.id)),
      );
    } catch {
      return [];
    }
  }

  function workflowData(contact, job) {
    return contact.workflowChecklists?.[job.id] || {};
  }

  function itemComplete(contact, job, stage, item) {
    if (item.mode === "auto") {
      try {
        return Boolean(item.test(contact, job));
      } catch {
        return false;
      }
    }
    return Boolean(workflowData(contact, job)?.[stage]?.[item.id]);
  }

  function stageChecklist(contact, job, stage = job.status || contact.status || "New") {
    const definitions = checklistDefinitions[stage] || [];
    const items = definitions.map((item) => ({
      ...item,
      complete: itemComplete(contact, job, stage, item),
    }));
    return {
      stage,
      items,
      completed: items.filter((item) => item.complete).length,
      total: items.length,
      ready: items.length > 0 && items.every((item) => item.complete),
      missing: items.filter((item) => !item.complete),
    };
  }

  function stageIndex(status) {
    return progressionStages.indexOf(status);
  }

  function nextStage(status) {
    const index = stageIndex(status);
    if (index < 0 || index >= progressionStages.length - 1) return "";
    return progressionStages[index + 1];
  }

  function transitionCheck(contact, job, targetStatus) {
    const currentStatus = job.status || contact.status || "New";
    if (!targetStatus || targetStatus === currentStatus) return { allowed: true };
    if (targetStatus === "Lost") return { allowed: true };

    const currentIndex = stageIndex(currentStatus);
    const targetIndex = stageIndex(targetStatus);
    if (targetIndex < 0) return { allowed: true };
    if (currentIndex < 0 || targetIndex < currentIndex) return { allowed: true };
    if (targetIndex !== currentIndex + 1) {
      return {
        allowed: false,
        reason: `Move this job one stage at a time. The next stage is ${nextStage(currentStatus) || currentStatus}.`,
      };
    }

    const checklist = stageChecklist(contact, job, currentStatus);
    if (!checklist.ready) {
      return {
        allowed: false,
        reason: `${checklist.missing.length} required checklist item${checklist.missing.length === 1 ? "" : "s"} remaining.`,
        checklist,
      };
    }
    return { allowed: true, checklist };
  }

  function updateChecklistItem(contactId, jobId, stage, itemId, checked) {
    const contact = getContact(contactId);
    if (!contact) return;
    updateContact(contactId, (current) => {
      const currentJobData = current.workflowChecklists?.[jobId] || {};
      const currentStageData = currentJobData[stage] || {};
      return {
        ...current,
        workflowChecklists: {
          ...(current.workflowChecklists || {}),
          [jobId]: {
            ...currentJobData,
            [stage]: {
              ...currentStageData,
              [itemId]: Boolean(checked),
            },
          },
        },
      };
    });
    saveState();
  }

  function selectedWorkflowJob(contact) {
    const jobs = contactJobs(contact);
    const selected = jobs.find((job) => job.id === selectedWorkflowJobId) || jobs[0];
    selectedWorkflowJobId = selected?.id || "";
    return selected;
  }

  function routeForStatus(status) {
    if (status === "New") return "leads";
    if (status === "Contacted" || status === "Lost") return "pipeline";
    if (status === "Inspection") return "jobs";
    if (status === "Estimate Sent") return "estimates";
    if (["Won", "Scheduled", "Materials Ordered", "In Progress", "Completed"].includes(status)) return "projects";
    if (status === "Paid") return "reviews";
    return "leads";
  }

  function activeNavigationView() {
    if (state.view !== "leadDetail") return state.view;
    const contact = getSelectedContact();
    return routeForStatus(contact?.status || "New");
  }

  function addPipelinePermissions() {
    try {
      ["office_manager", "sales_manager", "sales", "viewer"].forEach((role) => {
        const views = rolePolicies[role]?.views;
        if (Array.isArray(views) && !views.includes("pipeline")) views.push("pipeline");
      });
    } catch {}
  }

  function navigationMarkup() {
    return chronologicalNavigation
      .map(
        (group) => `
          <div class="workflow-nav-group">
            <span class="workflow-nav-heading">${escapeHtml(group.label)}</span>
            ${group.items
              .map(
                (item) => `
                  <button class="nav-item" type="button" data-view="${item.view}">
                    ${
                      item.step
                        ? `<span class="workflow-nav-step" aria-hidden="true">${item.step}</span>`
                        : `<span aria-hidden="true" data-icon="${item.icon}"></span>`
                    }
                    <span>${escapeHtml(item.label)}</span>
                  </button>
                `,
              )
              .join("")}
          </div>
        `,
      )
      .join("");
  }

  function ensureChronologicalNavigation() {
    const nav = document.querySelector(".nav-list");
    if (!nav) return;
    if (nav.dataset.workflowNavigation !== "65") {
      nav.dataset.workflowNavigation = "65";
      nav.innerHTML = navigationMarkup();
      hydrateIcons(nav);
    }
    const activeView = activeNavigationView();
    nav.querySelectorAll("[data-view]").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === activeView);
    });
    try {
      applyPermissionsToDom();
    } catch {}
  }

  function checklistStageMarkup(status) {
    const currentIndex = stageIndex(status);
    return progressionStages
      .map((stage, index) => {
        let stateClass = "upcoming";
        if (index < currentIndex) stateClass = "complete";
        if (index === currentIndex) stateClass = "current";
        return `
          <div class="workflow-stage ${stateClass}" title="${escapeHtml(stage)}">
            <span>${index + 1}</span>
            <strong>${escapeHtml(stage)}</strong>
          </div>
        `;
      })
      .join("");
  }

  function checklistItemsMarkup(contact, job, checklist, editable) {
    return checklist.items
      .map((item) => {
        const automatic = item.mode === "auto";
        return `
          <label class="workflow-check-item ${item.complete ? "complete" : "missing"} ${automatic ? "automatic" : ""}">
            <input
              type="checkbox"
              data-workflow-checkbox
              data-contact-id="${contact.id}"
              data-job-id="${job.id}"
              data-stage="${escapeHtml(checklist.stage)}"
              data-item-id="${item.id}"
              ${item.complete ? "checked" : ""}
              ${automatic || !editable ? "disabled" : ""}
            />
            <span class="workflow-check-box" aria-hidden="true"></span>
            <span class="workflow-check-label">${escapeHtml(item.label)}</span>
            ${automatic ? `<span class="workflow-check-mode">${item.complete ? "Verified" : "Missing"}</span>` : ""}
          </label>
        `;
      })
      .join("");
  }

  function workflowPanelMarkup(contact, job) {
    const status = job.status || contact.status || "New";
    const checklist = stageChecklist(contact, job, status);
    const next = nextStage(status);
    const editable = canAction("manageJobs");
    const automaticMissing = checklist.missing.some((item) => item.mode === "auto");
    const progress = checklist.total ? Math.round((checklist.completed / checklist.total) * 100) : 100;
    const terminal = status === "Lost" || !next;
    const actionLabel =
      status === "Lost"
        ? "Lost lead checklist"
        : next
          ? `Ready for ${next}`
          : checklist.ready
            ? "Closeout complete"
            : "Final closeout";

    return `
      <section class="workflow-checklist" id="workflowChecklistPanel" aria-label="Job progression checklist">
        <div class="workflow-checklist-head">
          <div>
            <p class="eyebrow">Job progression</p>
            <h3>${escapeHtml(job.name)}: ${escapeHtml(status)}</h3>
          </div>
          ${
            contactJobs(contact).length > 1
              ? `
                <label class="workflow-job-picker">
                  Job
                  <select data-workflow-job-select>
                    ${contactJobs(contact)
                      .map(
                        (item) =>
                          `<option value="${item.id}" ${item.id === job.id ? "selected" : ""}>${escapeHtml(
                            item.name,
                          )}</option>`,
                      )
                      .join("")}
                  </select>
                </label>
              `
              : ""
          }
        </div>

        <div class="workflow-stage-track">${checklistStageMarkup(status)}</div>

        <div class="workflow-checklist-summary">
          <div>
            <strong>${escapeHtml(actionLabel)}</strong>
            <span>${checklist.completed} of ${checklist.total} required items complete</span>
          </div>
          <div class="workflow-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
            <span style="width:${progress}%"></span>
          </div>
        </div>

        <div class="workflow-check-items">
          ${checklistItemsMarkup(contact, job, checklist, editable)}
        </div>

        <div class="workflow-checklist-actions">
          <div class="workflow-gate-status ${checklist.ready ? "ready" : "blocked"}">
            <span aria-hidden="true" data-icon="${checklist.ready ? "check" : "clipboard"}"></span>
            ${
              checklist.ready
                ? terminal
                  ? "Checklist complete"
                  : `All requirements complete for ${escapeHtml(next)}`
                : `${checklist.missing.length} required item${checklist.missing.length === 1 ? "" : "s"} remaining`
            }
          </div>
          <div class="workflow-action-buttons">
            ${
              automaticMissing
                ? `<button class="secondary-button" type="button" data-action="edit-contact" data-contact-id="${contact.id}">
                    <span aria-hidden="true" data-icon="edit"></span>
                    Update Lead Info
                  </button>`
                : ""
            }
            ${
              next
                ? `<button class="primary-button" type="button" data-workflow-action="advance" data-contact-id="${contact.id}" data-job-id="${job.id}" ${
                    !checklist.ready || !editable ? "disabled" : ""
                  }>
                    <span aria-hidden="true" data-icon="check"></span>
                    Move to ${escapeHtml(next)}
                  </button>`
                : ""
            }
          </div>
        </div>
      </section>
    `;
  }

  function renderWorkflowPanel() {
    if (!els.leadOverviewPanel || state.view !== "leadDetail") return;
    const contact = getSelectedContact();
    if (!contact) return;
    const job = selectedWorkflowJob(contact);
    if (!job) return;

    els.leadOverviewPanel.querySelector("#workflowChecklistPanel")?.remove();
    const actions = els.leadOverviewPanel.querySelector(".overview-quick-actions");
    if (actions) actions.insertAdjacentHTML("afterend", workflowPanelMarkup(contact, job));
    else els.leadOverviewPanel.insertAdjacentHTML("afterbegin", workflowPanelMarkup(contact, job));
    hydrateIcons(els.leadOverviewPanel);
  }

  function augmentJobCards() {
    if (!els.leadJobsList || state.view !== "leadDetail") return;
    const contact = getSelectedContact();
    if (!contact) return;
    const jobs = contactJobs(contact);
    const cards = [...els.leadJobsList.querySelectorAll(".job-card")];
    cards.forEach((card, index) => {
      const job = jobs[index];
      const actions = card.querySelector(".row-actions");
      if (!job || !actions || actions.querySelector("[data-workflow-action='open-job']")) return;
      const button = document.createElement("button");
      button.className = "secondary-button";
      button.type = "button";
      button.dataset.workflowAction = "open-job";
      button.dataset.contactId = contact.id;
      button.dataset.jobId = job.id;
      button.innerHTML = '<span aria-hidden="true" data-icon="clipboard"></span> Checklist';
      actions.prepend(button);
    });
    hydrateIcons(els.leadJobsList);
  }

  function showBlockedTransition(contact, job, result) {
    selectedWorkflowJobId = job.id;
    state.selectedContactId = contact.id;
    state.leadDetailTab = "overview";
    state.view = "leadDetail";
    saveState();
    render();
    showToast(result.reason || "Complete the stage checklist before moving forward");
  }

  function gatedApplyStatusUpdate(contactId, targetStatus, author = "Local user", message = "") {
    const contact = getContact(contactId);
    if (!contact) return null;
    const job = primaryJob(contact);
    const result = transitionCheck(contact, job, targetStatus);
    if (!result.allowed) {
      showBlockedTransition(contact, job, result);
      return contact;
    }
    return originalApplyStatusUpdate(contactId, targetStatus, author, message);
  }

  function advanceSecondaryJob(contact, job, targetStatus) {
    const author = state.currentUser?.name || state.currentUser?.email || "CRM user";
    return updateContact(contact.id, (current) => ({
      ...current,
      jobs: contactJobs(current).map((item) =>
        item.id === job.id
          ? {
              ...item,
              status: targetStatus,
              closedDate:
                ["Won", "Scheduled", "Materials Ordered", "In Progress", "Completed", "Paid"].includes(targetStatus)
                  ? item.closedDate || todayISO()
                  : item.closedDate,
            }
          : item,
      ),
      updates: [
        {
          id: uid("update"),
          author,
          status: targetStatus,
          message: `${job.name} moved from ${job.status} to ${targetStatus}.`,
          createdAt: new Date().toISOString(),
        },
        ...(current.updates || []),
      ],
    }));
  }

  function advanceWorkflowJob(contactId, jobId) {
    if (!requireAction("manageJobs")) return;
    const contact = getContact(contactId);
    if (!contact) return;
    const job = contactJobs(contact).find((item) => item.id === jobId) || primaryJob(contact);
    const targetStatus = nextStage(job.status);
    if (!targetStatus) return;
    const result = transitionCheck(contact, job, targetStatus);
    if (!result.allowed) {
      showBlockedTransition(contact, job, result);
      return;
    }

    if (primaryJob(contact).id === job.id) {
      originalApplyStatusUpdate(contact.id, targetStatus, state.currentUser?.name || "CRM user");
    } else {
      advanceSecondaryJob(contact, job, targetStatus);
    }
    selectedWorkflowJobId = job.id;
    saveState();
    render();
    showToast(`${job.name} moved to ${targetStatus}`);
  }

  function formTransitionContext(form) {
    const targetStatus = String(new FormData(form).get("status") || "");
    if (!targetStatus) return null;

    if (form.id === "contactForm") {
      const id = String(form.elements.id?.value || "");
      const contact = id ? getContact(id) : null;
      if (!contact) {
        return targetStatus === "New"
          ? null
          : { blockedNew: true, targetStatus, reason: "New leads must begin at Lead Intake." };
      }
      return { contact, job: primaryJob(contact), targetStatus };
    }

    const contact = getSelectedContact();
    if (!contact) return null;
    if (form.id === "leadJobForm") {
      const jobId = String(form.elements.jobId?.value || "");
      const job = contactJobs(contact).find((item) => item.id === jobId);
      if (!job) {
        return targetStatus === "New"
          ? null
          : { blockedNew: true, targetStatus, reason: "New jobs must begin at Lead Intake." };
      }
      return { contact, job, targetStatus };
    }
    if (form.id === "leadConversationForm") {
      return { contact, job: primaryJob(contact), targetStatus };
    }
    return null;
  }

  function guardStatusSubmit(event) {
    const form = event.target;
    if (!["contactForm", "leadJobForm", "leadConversationForm"].includes(form?.id)) return;
    const context = formTransitionContext(form);
    if (!context) return;

    const result = context.blockedNew
      ? { allowed: false, reason: context.reason }
      : transitionCheck(context.contact, context.job, context.targetStatus);
    if (result.allowed) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const statusSelect = form.querySelector('[name="status"]');
    if (statusSelect && context.job) statusSelect.value = context.job.status;
    showToast(result.reason || "Complete the stage checklist before moving forward");
  }

  function handleWorkflowChange(event) {
    const checkbox = event.target.closest("[data-workflow-checkbox]");
    if (checkbox) {
      updateChecklistItem(
        checkbox.dataset.contactId,
        checkbox.dataset.jobId,
        checkbox.dataset.stage,
        checkbox.dataset.itemId,
        checkbox.checked,
      );
      renderLeadDetail();
      return;
    }

    const jobSelect = event.target.closest("[data-workflow-job-select]");
    if (jobSelect) {
      selectedWorkflowJobId = jobSelect.value;
      renderLeadDetail();
    }
  }

  function handleWorkflowClick(event) {
    const button = event.target.closest("[data-workflow-action]");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (button.dataset.workflowAction === "advance") {
      advanceWorkflowJob(button.dataset.contactId, button.dataset.jobId);
      return;
    }

    if (button.dataset.workflowAction === "open-job") {
      selectedWorkflowJobId = button.dataset.jobId;
      state.selectedContactId = button.dataset.contactId;
      state.leadDetailTab = "overview";
      state.view = "leadDetail";
      saveState();
      render();
    }
  }

  function installStyles() {
    if (document.querySelector("#workflowChecklistStylesV65")) return;
    const style = document.createElement("style");
    style.id = "workflowChecklistStylesV65";
    style.textContent = `
      .nav-list[data-workflow-navigation="65"] {
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .workflow-nav-group {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }
      .workflow-nav-heading {
        padding: 0 12px 5px;
        color: rgba(255,255,255,.48);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0;
      }
      .workflow-nav-step {
        width: 22px;
        height: 22px;
        flex: 0 0 22px;
        display: inline-grid;
        place-items: center;
        border: 1px solid rgba(255,255,255,.28);
        border-radius: 50%;
        color: rgba(255,255,255,.82);
        font-size: 10px;
        font-weight: 800;
      }
      .nav-item.active .workflow-nav-step {
        border-color: #fff;
        background: #fff;
        color: #111;
      }
      .workflow-checklist {
        margin: 18px 0;
        padding: 18px;
        border: 1px solid var(--line);
        border-left: 4px solid var(--accent);
        border-radius: 6px;
        background: #f8fafc;
      }
      .workflow-checklist-head,
      .workflow-checklist-summary,
      .workflow-checklist-actions {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
      }
      .workflow-checklist-head h3 {
        margin: 3px 0 0;
        font-size: 16px;
      }
      .workflow-job-picker {
        min-width: 220px;
        font-size: 11px;
        font-weight: 700;
        color: var(--muted);
      }
      .workflow-job-picker select {
        width: 100%;
        margin-top: 5px;
      }
      .workflow-stage-track {
        display: grid;
        grid-template-columns: repeat(10, minmax(88px, 1fr));
        gap: 0;
        margin: 18px 0;
        overflow-x: auto;
        padding-bottom: 5px;
      }
      .workflow-stage {
        position: relative;
        display: grid;
        justify-items: center;
        gap: 6px;
        min-width: 88px;
        color: var(--muted);
        font-size: 10px;
        text-align: center;
      }
      .workflow-stage::before {
        content: "";
        position: absolute;
        top: 13px;
        left: 0;
        right: 0;
        height: 2px;
        background: var(--line);
        z-index: 0;
      }
      .workflow-stage:first-child::before { left: 50%; }
      .workflow-stage:last-child::before { right: 50%; }
      .workflow-stage span {
        position: relative;
        z-index: 1;
        width: 28px;
        height: 28px;
        display: grid;
        place-items: center;
        border: 2px solid var(--line);
        border-radius: 50%;
        background: #fff;
        font-size: 10px;
        font-weight: 800;
      }
      .workflow-stage strong {
        max-width: 88px;
        font-size: 10px;
        line-height: 1.25;
      }
      .workflow-stage.complete::before,
      .workflow-stage.complete span {
        border-color: #16a34a;
        background: #16a34a;
        color: #fff;
      }
      .workflow-stage.complete::before { background: #16a34a; }
      .workflow-stage.current { color: var(--ink); }
      .workflow-stage.current span {
        border-color: var(--accent);
        background: var(--accent);
        color: #fff;
        box-shadow: 0 0 0 4px rgba(37,99,235,.12);
      }
      .workflow-checklist-summary {
        align-items: flex-end;
        padding: 13px 0;
        border-top: 1px solid var(--line);
        border-bottom: 1px solid var(--line);
      }
      .workflow-checklist-summary > div:first-child {
        display: grid;
        gap: 3px;
      }
      .workflow-checklist-summary strong { font-size: 13px; }
      .workflow-checklist-summary span { color: var(--muted); font-size: 12px; }
      .workflow-progress {
        width: min(260px, 42%);
        height: 7px;
        overflow: hidden;
        border-radius: 4px;
        background: #e2e8f0;
      }
      .workflow-progress span {
        display: block;
        height: 100%;
        background: #2563eb;
        transition: width .18s ease;
      }
      .workflow-check-items {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        column-gap: 28px;
        margin-top: 8px;
      }
      .workflow-check-item {
        min-height: 46px;
        display: grid;
        grid-template-columns: 22px minmax(0, 1fr) auto;
        align-items: center;
        gap: 9px;
        border-bottom: 1px solid var(--line);
        cursor: pointer;
      }
      .workflow-check-item.automatic { cursor: default; }
      .workflow-check-item input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
      }
      .workflow-check-box {
        width: 20px;
        height: 20px;
        display: grid;
        place-items: center;
        border: 2px solid #94a3b8;
        border-radius: 4px;
        background: #fff;
      }
      .workflow-check-item.complete .workflow-check-box {
        border-color: #16a34a;
        background: #16a34a;
      }
      .workflow-check-item.complete .workflow-check-box::after {
        content: "";
        width: 8px;
        height: 4px;
        border-left: 2px solid #fff;
        border-bottom: 2px solid #fff;
        transform: rotate(-45deg) translateY(-1px);
      }
      .workflow-check-label {
        color: var(--ink);
        font-size: 12px;
        line-height: 1.35;
      }
      .workflow-check-item.complete .workflow-check-label {
        color: #166534;
      }
      .workflow-check-mode {
        color: var(--muted);
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
      }
      .workflow-check-item.missing .workflow-check-mode { color: #b45309; }
      .workflow-checklist-actions {
        margin-top: 16px;
      }
      .workflow-gate-status {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: #b45309;
        font-size: 12px;
        font-weight: 700;
      }
      .workflow-gate-status.ready { color: #15803d; }
      .workflow-gate-status [data-icon] {
        width: 17px;
        height: 17px;
      }
      .workflow-action-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        flex-wrap: wrap;
      }
      [data-workflow-action="advance"]:disabled {
        opacity: .45;
        cursor: not-allowed;
      }
      @media (max-width: 900px) {
        .workflow-checklist-head,
        .workflow-checklist-summary,
        .workflow-checklist-actions {
          align-items: stretch;
          flex-direction: column;
        }
        .workflow-job-picker,
        .workflow-progress { width: 100%; max-width: none; }
        .workflow-check-items { grid-template-columns: 1fr; }
        .workflow-action-buttons { justify-content: stretch; }
        .workflow-action-buttons button { flex: 1 1 auto; }
      }
    `;
    document.head.appendChild(style);
  }

  function installWorkflowChecklists() {
    if (!hasAppGlobals() || window.__rooflineWorkflowChecklistsV65Installed) return false;
    window.__rooflineWorkflowChecklistsV65Installed = true;

    addPipelinePermissions();
    installStyles();

    originalApplyStatusUpdate = applyStatusUpdate;
    assignGlobal("applyStatusUpdate", gatedApplyStatusUpdate);

    const previousRenderLeadDetail = renderLeadDetail;
    assignGlobal("renderLeadDetail", function workflowLeadDetailWrapper() {
      previousRenderLeadDetail();
      renderWorkflowPanel();
      augmentJobCards();
    });

    const previousRender = render;
    assignGlobal("render", function workflowRenderWrapper() {
      previousRender();
      ensureChronologicalNavigation();
      renderWorkflowPanel();
      augmentJobCards();
    });

    document.addEventListener("submit", guardStatusSubmit, true);
    document.addEventListener("change", handleWorkflowChange, true);
    document.addEventListener("click", handleWorkflowClick, true);

    window.RooflineWorkflowChecklist = {
      version: "65",
      stages: progressionStages,
      definitions: checklistDefinitions,
      stageChecklist,
      transitionCheck,
      updateChecklistItem,
      advanceWorkflowJob,
    };

    ensureChronologicalNavigation();
    try {
      render();
    } catch {
      renderWorkflowPanel();
      augmentJobCards();
    }
    return true;
  }

  const timer = window.setInterval(() => {
    if (installWorkflowChecklists()) window.clearInterval(timer);
  }, 200);
  window.setTimeout(() => window.clearInterval(timer), 15000);
})();

