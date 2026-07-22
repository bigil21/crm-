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
  const preSaleStatuses = ["New", "Contacted", "Inspection", "Estimate Sent"];
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

  function assignGlobal(name, value) {
    try {
      window[name] = value;
    } catch {}
    try {
      Function("value", `${name} = value;`)(value);
    } catch {}
  }

  function safeNumber(value) {
    try {
      return number(value);
    } catch {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
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

  function productionClosedDate(status, explicitDate = "", fallbackDate = "") {
    if (explicitDate) return explicitDate;
    if (isSoldStatus(status)) return fallbackDate || todayISO();
    return "";
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

  function normalizeProductionState() {
    let changed = false;
    state.contacts = state.contacts.map((contact) => {
      const jobs = contactJobs(contact).map((job) => {
        const status = productionStatuses.includes(job.status) ? job.status : "New";
        const closedDate = productionClosedDate(status, job.closedDate, contact.closedDate || job.lastContact || contact.lastContact);
        const nextJob = { ...job, status, closedDate };
        if (nextJob.status !== job.status || nextJob.closedDate !== job.closedDate) changed = true;
        return nextJob;
      });
      const primary = jobs[0] || contactJobs(contact)[0];
      const contactStatus = productionStatuses.includes(contact.status) ? contact.status : primary.status;
      const nextContact = {
        ...contact,
        status: contactStatus,
        type: isSoldStatus(contactStatus) || jobs.some((job) => isSoldStatus(job.status)) ? "Customer" : contact.type,
        closedDate: productionClosedDate(contactStatus, contact.closedDate, primary.closedDate || contact.lastContact),
        jobs,
      };
      if (nextContact.status !== contact.status || nextContact.type !== contact.type || nextContact.closedDate !== contact.closedDate) {
        changed = true;
      }
      return nextContact;
    });
    return changed;
  }

  function patchedStatusPillClass(status = "") {
    const normalized = String(status || "").toLowerCase().replace(/\s+/g, "-");
    if (["won", "completed", "paid"].includes(normalized)) return "pill-won";
    if (normalized === "lost" || normalized === "rejected" || normalized === "declined") return "pill-lost";
    if (normalized === "estimate-sent" || normalized === "sent") return "pill-sent";
    if (["inspection", "scheduled", "materials-ordered", "in-progress"].includes(normalized)) return "pill-inspection";
    if (normalized === "contacted") return "pill-contacted";
    if (normalized === "new") return "pill-new";
    return "pill-default";
  }

  function patchedStaleClass(contact) {
    if (isSoldStatus(contact.status) || contact.status === "Lost") return "";
    const days = staleLeadDays(contact);
    if (days >= 14) return "stale-red";
    if (days >= 7) return "stale-amber";
    return "";
  }

  function patchedDashboardMetrics() {
    const leads = state.contacts.filter((contact) => contact.type === "Lead" && preSaleStatuses.includes(contact.status)).length;
    const jobs = allJobs();
    const openContracts = jobs.filter((job) => activeContractStatuses.includes(job.status));
    const closedJobs = jobs.filter((job) => isClosedProductionStatus(job.status));
    const estimatesSent = state.estimates.filter((estimate) => ["Sent", "Approved"].includes(estimate.status)).length;
    const pipelineValue = jobs
      .filter((job) => job.status !== "Lost")
      .reduce((sum, job) => sum + safeNumber(job.value), 0);
    return {
      leads,
      totalJobs: jobs.length,
      estimatesSent,
      openContracts: openContracts.length,
      openValue: openContracts.reduce((sum, job) => sum + safeNumber(job.value), 0),
      closedJobs: closedJobs.length,
      closedValue: closedJobs.reduce((sum, job) => sum + safeNumber(job.value), 0),
      pipelineValue,
    };
  }

  function patchedRenderSummary() {
    if (!els.summaryStrip) return;
    const metrics = patchedDashboardMetrics();
    const cards = [
      ["Total Leads", metrics.leads, "Open sales opportunities", "user", "blue"],
      ["Estimates Sent", metrics.estimatesSent, "Sent or approved", "file", "green"],
      ["Open Contracts", metrics.openContracts, money.format(metrics.openValue), "briefcase", "purple"],
      ["Closed Jobs", metrics.closedJobs, money.format(metrics.closedValue), "check", "orange"],
      ["Pipeline Value", money.format(metrics.pipelineValue), "All non-lost job value", "bar-chart", "cyan"],
    ];

    els.summaryStrip.innerHTML = cards
      .map(
        ([label, value, caption, iconName, tone]) => `
          <article class="summary-card metric-card ${tone}">
            <span class="metric-icon" aria-hidden="true" data-icon="${iconName}"></span>
            <div>
              <span class="eyebrow">${label}</span>
              <strong>${value}</strong>
              <span class="trend-line">${caption}</span>
            </div>
          </article>
        `,
      )
      .join("");
    hydrateIcons(els.summaryStrip);
  }

  function patchedApplyStatusUpdate(contactId, nextStatus, author = "Local user", message = "") {
    const contact = getContact(contactId);
    if (!contact || !nextStatus || contact.status === nextStatus) return contact;
    return updateContact(contactId, (current) => {
      const wasStatus = current.status;
      const nextJobs = contactJobs(current).map((job, index) => {
        if (index !== 0) return job;
        return {
          ...job,
          status: nextStatus,
          closedDate: productionClosedDate(nextStatus, job.closedDate, current.closedDate || job.lastContact),
        };
      });
      const primary = nextJobs[0];
      return {
        ...current,
        jobs: nextJobs,
        status: nextStatus,
        type: isSoldStatus(nextStatus) ? "Customer" : current.type,
        closedDate: productionClosedDate(nextStatus, current.closedDate, primary?.closedDate || current.lastContact),
        updates: [
          {
            id: uid("update"),
            author: author.trim() || "Local user",
            status: nextStatus,
            message: message || `Status changed from ${wasStatus} to ${nextStatus}.`,
            createdAt: new Date().toISOString(),
          },
          ...(current.updates || []),
        ],
      };
    });
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
          <div class="lead-card-avatar ${avatarClass}">${initials}</div>
          <div class="lead-card-header-text">
            <h4>
              <button class="link-button" type="button" data-action="open-contact" data-contact-id="${contact.id}">
                ${escapeHtml(contact.name)}
              </button>
            </h4>
            <p>${escapeHtml(contact.source || "No source")} &middot; ${money.format(
              contactJobs(contact).reduce((sum, item) => sum + safeNumber(item.value), 0),
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

  function patchedRenderDashboard() {
    if (!els.views.dashboard) return;
    document.querySelectorAll("[data-leaderboard-range]").forEach((button) => {
      button.classList.toggle("active", button.dataset.leaderboardRange === state.leaderboardRange);
    });

    const soldJobs = allJobs().filter(
      (job) => isSoldStatus(job.status) && isInLeaderboardRange(job, state.leaderboardRange),
    );
    const reps = soldJobs.reduce((acc, job) => {
      const name = job.salesRep || "Unassigned";
      if (!acc.has(name)) acc.set(name, { name, closedJobs: 0, value: 0 });
      const rep = acc.get(name);
      rep.closedJobs += 1;
      rep.value += safeNumber(job.value);
      return acc;
    }, new Map());

    const rows = [...reps.values()].sort((a, b) => b.value - a.value || b.closedJobs - a.closedJobs);
    const rangeStartDate = rangeStart(state.leaderboardRange);
    if (els.leaderboardRangeLabel) {
      els.leaderboardRangeLabel.textContent = `${leaderboardRanges[state.leaderboardRange]} sold jobs since ${formatDate(
        rangeStartDate.toISOString().slice(0, 10),
      )}`;
    }

    if (els.leaderboardTableBody) {
      els.leaderboardTableBody.innerHTML = rows.length
        ? rows
            .map(
              (rep, index) => `
                <tr>
                  <td><span class="rank-pill">#${index + 1}</span></td>
                  <td class="person-cell">
                    <strong>${escapeHtml(rep.name)}</strong>
                    <span>${rep.closedJobs === 1 ? "1 sold job" : `${rep.closedJobs} sold jobs`}</span>
                  </td>
                  <td>${rep.closedJobs}</td>
                  <td>${money.format(rep.value)}</td>
                  <td>${money.format(rep.closedJobs ? rep.value / rep.closedJobs : 0)}</td>
                </tr>
              `,
            )
            .join("")
        : '<tr><td colspan="5"><div class="empty-state">No sold jobs in this period</div></td></tr>';
    }

    renderPipelineOverview();
    patchedRenderRevenueOverview();
    renderDashboardTasks();
    patchedRenderDashboardDonuts();
    renderRecentActivity();
    renderTodaySchedule();
    renderWeatherPanel();
    ensureWeatherData();
  }

  function patchedRenderRevenueOverview() {
    if (!els.revenueChart) return;
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      return { label: d.toLocaleString("en-US", { month: "short" }), year: d.getFullYear(), month: d.getMonth(), value: 0 };
    });

    allJobs()
      .filter((job) => isSoldStatus(job.status) && (job.closedDate || job.lastContact || job.createdAt))
      .forEach((job) => {
        const d = new Date(job.closedDate || job.lastContact || job.createdAt);
        const bucket = months.find((m) => m.year === d.getFullYear() && m.month === d.getMonth());
        if (bucket) bucket.value += safeNumber(job.value);
      });

    const max = Math.max(...months.map((m) => m.value), 1);
    const W = 390, H = 180, padL = 48, padR = 16, padT = 16, padB = 28;
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const barW = Math.floor((chartW / months.length) * 0.55);
    const gap = chartW / months.length;
    const bars = months.map((m, i) => {
      const x = padL + i * gap + (gap - barW) / 2;
      const barH = Math.max(2, (m.value / max) * chartH);
      const y = padT + chartH - barH;
      return { x, y, barH, barW, label: m.label, value: m.value };
    });
    const totalSold = months.reduce((sum, month) => sum + month.value, 0);

    els.revenueChart.innerHTML = `
      <div class="chart-legend" style="margin-bottom:8px">
        <span style="font-size:12px;color:var(--muted)">Sold revenue - last 6 months</span>
        <strong style="font-size:13px">${money.format(totalSold)}</strong>
      </div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sold revenue by month bar chart" style="width:100%;display:block">
        <g class="chart-grid">
          <line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="var(--line)" stroke-width="0.5"/>
          <line x1="${padL}" y1="${padT + chartH / 2}" x2="${W - padR}" y2="${padT + chartH / 2}" stroke="var(--line)" stroke-width="0.5"/>
          <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="var(--line)" stroke-width="1"/>
        </g>
        <text x="${padL - 4}" y="${padT + 4}" text-anchor="end" font-size="9" fill="var(--muted)">${money.format(max).replace(/\.00$/, "")}</text>
        <text x="${padL - 4}" y="${padT + chartH / 2 + 4}" text-anchor="end" font-size="9" fill="var(--muted)">${money.format(max / 2).replace(/\.00$/, "")}</text>
        <text x="${padL - 4}" y="${padT + chartH + 4}" text-anchor="end" font-size="9" fill="var(--muted)">$0</text>
        ${bars.map((bar, index) => {
          const isLatest = index === bars.length - 1;
          return `
            <rect x="${bar.x}" y="${bar.y}" width="${bar.barW}" height="${bar.barH}" rx="3" fill="${isLatest ? "var(--accent)" : "var(--accent-soft)"}" stroke="${isLatest ? "var(--accent)" : "var(--line)"}" stroke-width="1"/>
            <text x="${bar.x + bar.barW / 2}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--muted)">${bar.label}</text>
            ${bar.value > 0 ? `<text x="${bar.x + bar.barW / 2}" y="${bar.y - 4}" text-anchor="middle" font-size="8" fill="${isLatest ? "var(--accent-strong)" : "var(--muted)"}">${money.format(bar.value).replace(/\.00$/, "")}</text>` : ""}
          `;
        }).join("")}
      </svg>
    `;
  }

  function patchedRenderDashboardDonuts() {
    const leadContacts = state.contacts.filter((contact) => contact.type === "Lead" && preSaleStatuses.includes(contact.status));
    const sources = aggregateCounts(leadContacts, (contact) => contact.source || "Other");
    const jobsByType = aggregateCounts(allJobs(), jobType);
    const projectStatus = aggregateCounts(allJobs().filter((job) => job.status !== "Lost"), (job) => job.status);
    renderDonutWidget(els.leadSourcesChart, sources, leadContacts.length, "Total Leads");
    renderDonutWidget(els.jobsByTypeChart, jobsByType, patchedDashboardMetrics().totalJobs, "Total Jobs");
    renderDonutWidget(
      els.projectStatusChart,
      projectStatus,
      allJobs().filter((job) => job.status !== "Lost").length,
      "Active Projects",
    );
  }

  function patchedRenderProjectsView() {
    if (!els.projectsGrid) return;
    const projects = allJobs().filter((job) => isSoldStatus(job.status));
    els.projectsGrid.innerHTML = projects.length
      ? projects
          .map(
            (job) => `
              <article class="record-card">
                <span class="status-pill ${patchedStatusPillClass(job.status)}">${escapeHtml(job.status)}</span>
                <strong>${escapeHtml(job.name)}</strong>
                <span>${escapeHtml(job.contactName)} - ${money.format(safeNumber(job.value))}</span>
                <p>${escapeHtml((job.address || "No address").split("\n")[0])}</p>
                <div class="row-actions">
                  <button class="secondary-button" type="button" data-action="open-contact-tab" data-contact-id="${job.contactId}" data-tab="jobs">
                    <span aria-hidden="true" data-icon="open"></span>
                    Open Job
                  </button>
                </div>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-state">Sold jobs will appear here once they move into production</div>';
    hydrateIcons(els.projectsGrid);
  }

  function patchedRenderReviewsView() {
    if (!els.reviewsList) return;
    const customers = state.contacts.filter((contact) =>
      contact.type === "Customer" || isSoldStatus(contact.status) || contactJobs(contact).some((job) => isSoldStatus(job.status)),
    );
    const hasReviewUrl = !!state.company.googleReviewUrl;
    const warningBanner = !hasReviewUrl
      ? `
        <div class="review-warning">
          <span data-icon="alert-triangle" aria-hidden="true"></span>
          No Google Review link saved yet - <button class="link-button" type="button" data-action="go-to-settings">add it in Settings</button> so it is included in every request.
        </div>
      `
      : "";

    els.reviewsList.innerHTML =
      warningBanner +
      (customers.length
        ? customers
            .map((contact) => {
              const initials = contactInitials(contact.name);
              const avatarClass = initialsColor(contact.name);
              const job = primaryJob(contact);
              const email = contact.email || "";
              return `
                <article class="record-card">
                  <div class="record-card-top">
                    <div class="lead-card-avatar ${avatarClass}" style="width:36px;height:36px;font-size:13px;flex-shrink:0">${initials}</div>
                    <div style="flex:1;min-width:0">
                      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <strong>${escapeHtml(contact.name)}</strong>
                        <span class="status-pill ${patchedStatusPillClass(contact.status)}">${escapeHtml(contact.status)}</span>
                      </div>
                      <span style="font-size:12px;color:var(--muted)">${escapeHtml(job.name || "Completed job")} &middot; ${escapeHtml(email || "No email saved")}</span>
                    </div>
                  </div>
                  <div class="row-actions" style="margin-top:8px">
                    ${email ? `
                      <a class="primary-button" href="${mailtoUrl(email, reviewRequestEmail(contact).subject, reviewRequestEmail(contact).message)}" data-action="log-review-request" data-contact-id="${contact.id}">
                        <span aria-hidden="true" data-icon="star"></span>
                        Send Review Request
                      </a>
                    ` : `<span style="font-size:12px;color:var(--muted)">No email address on file</span>`}
                    <button class="secondary-button" type="button" data-action="open-contact" data-contact-id="${contact.id}">
                      <span aria-hidden="true" data-icon="open"></span>
                      Open
                    </button>
                  </div>
                </article>
              `;
            })
            .join("")
        : '<div class="empty-state">Sold and completed customers will appear here for review follow-up</div>');
    hydrateIcons(els.reviewsList);
  }

  function installFormInterceptors() {
    if (window.__rooflineProductionFormInterceptorsV64) return;
    window.__rooflineProductionFormInterceptorsV64 = true;

    els.contactForm?.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        saveContactFromFormProduction();
      },
      true,
    );

    els.leadJobForm?.addEventListener(
      "submit",
      (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        saveLeadJobProduction();
      },
      true,
    );
  }

  function formText(formData, key) {
    return String(formData.get(key) || "").trim();
  }

  function saveContactFromFormProduction() {
    if (!requireAction("manageContacts")) return;
    const formData = new FormData(els.contactForm);
    const id = formData.get("id") || uid("contact");
    const existing = getContact(id);
    const status = formData.get("status") || "New";
    const contact = {
      ...(existing || { createdAt: todayISO() }),
      id,
      type: isSoldStatus(status) ? "Customer" : formData.get("type"),
      status,
      name: formText(formData, "name"),
      source: formText(formData, "source"),
      email: formText(formData, "email"),
      phone: formText(formData, "phone"),
      address: formText(formData, "address"),
      value: safeNumber(formData.get("value")),
      salesRep: formText(formData, "salesRep") || "Unassigned",
      lastContact: formData.get("lastContact"),
      closedDate: productionClosedDate(status, formData.get("closedDate"), existing?.closedDate || existing?.lastContact),
      documents: existing?.documents || [],
      updates: existing?.updates || [],
      notes: formText(formData, "notes"),
    };
    const currentJobs = existing?.jobs?.length ? existing.jobs : [normalizeJob({}, contact)];
    const primary = normalizeJob(
      {
        ...currentJobs[0],
        name: currentJobs[0]?.name || `${contact.name} Job`,
        status: contact.status,
        value: contact.value,
        salesRep: contact.salesRep,
        address: contact.address,
        lastContact: contact.lastContact,
        closedDate: contact.closedDate,
      },
      contact,
    );
    contact.jobs = [primary, ...currentJobs.slice(1)];

    if (existing && existing.status !== contact.status) {
      contact.updates = [
        {
          id: uid("update"),
          author: contact.salesRep || "Local user",
          status: contact.status,
          message: `Status changed from ${existing.status} to ${contact.status}.`,
          createdAt: new Date().toISOString(),
        },
        ...(existing.updates || []),
      ];
    }

    if (existing) state.contacts = state.contacts.map((item) => (item.id === id ? normalizeContact(contact) : item));
    else state.contacts.unshift(normalizeContact(contact));

    state.selectedContactId = id;
    saveState();
    els.contactDialog.close();
    render();
    showToast(`${contact.name} saved`);
  }

  function saveLeadJobProduction() {
    if (!requireAction("manageJobs")) return;
    const contact = getSelectedContact();
    if (!contact) return;
    const formData = new FormData(els.leadJobForm);
    const jobId = formData.get("jobId") || uid("job");
    const existing = contactJobs(contact).find((job) => job.id === jobId);
    const status = formData.get("status") || "New";
    const job = normalizeJob(
      {
        ...(existing || { id: jobId, createdAt: todayISO() }),
        id: jobId,
        name: formText(formData, "name"),
        status,
        value: safeNumber(formData.get("value")),
        salesRep: formText(formData, "salesRep") || contact.salesRep || "Unassigned",
        lastContact: formData.get("lastContact"),
        closedDate: productionClosedDate(status, formData.get("closedDate"), existing?.closedDate || contact.closedDate || contact.lastContact),
        address: formText(formData, "address"),
        notes: formText(formData, "notes"),
      },
      contact,
    );

    updateContact(contact.id, (current) => {
      const jobs = contactJobs(current);
      const nextJobs = existing ? jobs.map((item) => (item.id === jobId ? job : item)) : [job, ...jobs];
      const primary = nextJobs[0];
      return {
        ...current,
        jobs: nextJobs,
        status: primary.status,
        type: isSoldStatus(primary.status) ? "Customer" : current.type,
        value: primary.value,
        salesRep: primary.salesRep,
        address: primary.address,
        closedDate: productionClosedDate(primary.status, primary.closedDate, current.closedDate || primary.lastContact),
        updates: [
          {
            id: uid("update"),
            author: job.salesRep || "Local user",
            status: job.status,
            message: `${existing ? "Updated" : "Added"} job: ${job.name}.`,
            createdAt: new Date().toISOString(),
          },
          ...(current.updates || []),
        ],
      };
    });

    els.leadJobForm.reset();
    state.leadDetailTab = "jobs";
    saveState();
    render();
    showToast(`${job.name} saved`);
  }

  function refreshCurrentView() {
    ensureStatusOptions();
    patchedRenderSummary();
    if (state.view === "dashboard") patchedRenderDashboard();
    if (state.view === "projects") patchedRenderProjectsView();
    if (state.view === "reviews") patchedRenderReviewsView();
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
    normalizeProductionState();
    assignGlobal("statusPillClass", patchedStatusPillClass);
    assignGlobal("staleClass", patchedStaleClass);
    assignGlobal("dashboardMetrics", patchedDashboardMetrics);
    assignGlobal("renderSummary", patchedRenderSummary);
    assignGlobal("applyStatusUpdate", patchedApplyStatusUpdate);
    assignGlobal("renderLeadCard", patchedRenderLeadCard);
    assignGlobal("renderDashboard", patchedRenderDashboard);
    assignGlobal("renderRevenueOverview", patchedRenderRevenueOverview);
    assignGlobal("renderDashboardDonuts", patchedRenderDashboardDonuts);
    assignGlobal("renderProjectsView", patchedRenderProjectsView);
    assignGlobal("renderReviewsView", patchedRenderReviewsView);
    installFormInterceptors();

    const previousRender = typeof render === "function" ? render : null;
    if (previousRender && !window.__rooflineProductionRenderWrappedV64) {
      window.__rooflineProductionRenderWrappedV64 = true;
      assignGlobal("render", function productionRenderWrapper() {
        syncStatuses();
        previousRender();
        refreshCurrentView();
      });
    }

    saveState();
    try {
      render();
    } catch {
      refreshCurrentView();
    }
    return true;
  }

  const timer = window.setInterval(() => {
    if (installProductionFlow()) window.clearInterval(timer);
  }, 200);
  window.setTimeout(() => window.clearInterval(timer), 15000);
})();
