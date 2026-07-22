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
  const soldStatuses = ["Won", "Scheduled", "Materials Ordered", "In Progress", "Completed", "Paid"];
  const activeProductionStatuses = ["Won", "Scheduled", "Materials Ordered", "In Progress"];
  const closedProductionStatuses = ["Completed", "Paid"];
  const terminalStatuses = ["Paid", "Lost"];

  function canUseApp() {
    try { return Boolean(state && els); } catch { return false; }
  }

  function safeNumber(value) {
    try { return number(value); } catch { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
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
      productionStatuses.forEach((status) => {
        if ([...select.options].some((option) => option.value === status || option.textContent === status)) return;
        const option = document.createElement("option");
        option.value = status;
        option.textContent = status;
        select.appendChild(option);
      });
      if (currentValue) select.value = currentValue;
    });
  }

  function patchStatusPills() {
    const previousStatusPillClass = typeof statusPillClass === "function" ? statusPillClass : null;
    window.statusPillClass = function patchedStatusPillClass(status = "") {
      const normalized = String(status || "").toLowerCase().replace(/\s+/g, "-");
      if (["won", "completed", "paid"].includes(normalized)) return "pill-won";
      if (normalized === "lost" || normalized === "rejected") return "pill-lost";
      if (normalized === "estimate-sent" || normalized === "sent") return "pill-sent";
      if (["inspection", "scheduled", "materials-ordered", "in-progress"].includes(normalized)) return "pill-inspection";
      if (normalized === "contacted") return "pill-contacted";
      if (normalized === "new") return "pill-new";
      return previousStatusPillClass ? previousStatusPillClass(status) : "pill-default";
    };
  }

  function patchMetrics() {
    if (typeof dashboardMetrics === "function") {
      window.dashboardMetrics = function patchedDashboardMetrics() {
        const leads = state.contacts.filter((contact) => contact.type === "Lead" && !isSoldStatus(contact.status)).length;
        const jobs = allJobs();
        const openContracts = jobs.filter((job) => !["Lost", "Completed", "Paid"].includes(job.status));
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
      };
    }
  }

  function patchApplyStatusUpdate() {
    if (typeof applyStatusUpdate !== "function") return;
    window.applyStatusUpdate = function patchedApplyStatusUpdate(contactId, nextStatus, author = "Local user", message = "") {
      const contact = getContact(contactId);
      if (!contact || !nextStatus || contact.status === nextStatus) return contact;
      return updateContact(contactId, (current) => {
        const wasStatus = current.status;
        const nextJobs = contactJobs(current).map((job, index) =>
          index === 0
            ? {
                ...job,
                status: nextStatus,
                closedDate: isClosedProductionStatus(nextStatus) ? job.closedDate || todayISO() : job.closedDate,
              }
            : job,
        );
        return {
          ...current,
          jobs: nextJobs,
          status: nextStatus,
          type: isSoldStatus(nextStatus) ? "Customer" : current.type,
          closedDate: isClosedProductionStatus(nextStatus) ? current.closedDate || todayISO() : current.closedDate,
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
    };
  }

  function patchLeadCard() {
    if (typeof renderLeadCard !== "function") return;
    window.renderLeadCard = function patchedRenderLeadCard(contact) {
      const job = primaryJob(contact);
      const nextStatus = nextWorkflowStatus(contact.status);
      const days = staleLeadDays(contact);
      const sc = staleClass(contact);
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
            <span class="status-pill ${statusPillClass(contact.status)}">${escapeHtml(contact.status)}</span>
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
    };
  }

  function patchDashboard() {
    if (typeof renderDashboard === "function") {
      window.renderDashboard = function patchedRenderDashboard() {
        if (!els.views.dashboard) return;

        document.querySelectorAll("[data-leaderboard-range]").forEach((button) => {
          button.classList.toggle("active", button.dataset.leaderboardRange === state.leaderboardRange);
        });

        const closedJobs = allJobs().filter(
          (job) => isSoldStatus(job.status) && isInLeaderboardRange(job, state.leaderboardRange),
        );
        const reps = closedJobs.reduce((acc, job) => {
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
          els.leaderboardRangeLabel.textContent = `${leaderboardRanges[state.leaderboardRange]} results since ${formatDate(
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
                  <span>${rep.closedJobs === 1 ? "1 sold/production job" : `${rep.closedJobs} sold/production jobs`}</span>
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
        renderRevenueOverview();
        renderDashboardTasks();
        renderDashboardDonuts();
        renderRecentActivity();
        renderTodaySchedule();
        renderWeatherPanel();
        ensureWeatherData();
      };
    }

    if (typeof renderRevenueOverview === "function") {
      window.renderRevenueOverview = function patchedRenderRevenueOverview() {
        if (!els.revenueChart) return;
        const now = new Date();
        const months = Array.from({ length: 6 }, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
          return { label: d.toLocaleString("en-US", { month: "short" }), year: d.getFullYear(), month: d.getMonth(), value: 0 };
        });

        allJobs().filter((job) => isSoldStatus(job.status) && (job.closedDate || job.lastContact || job.createdAt)).forEach((job) => {
          const d = new Date(job.closedDate || job.lastContact || job.createdAt);
          const bucket = months.find((m) => m.year === d.getFullYear() && m.month === d.getMonth());
          if (bucket) bucket.value += safeNumber(job.value);
        });

        const max = Math.max(...months.map((m) => m.value), 1);
        const W = 390, H = 180, padL = 48, padR = 16, padT = 16, padB = 28;
        const chartW = W - padL - padR;
        const chartH = H - padT - padB;
        const barW = Math.floor(chartW / months.length * 0.55);
        const gap = chartW / months.length;
        const bars = months.map((m, i) => {
          const x = padL + i * gap + (gap - barW) / 2;
          const barH = Math.max(2, (m.value / max) * chartH);
          const y = padT + chartH - barH;
          return { x, y, barH, barW, label: m.label, value: m.value };
        });
        const totalClosed = months.reduce((s, m) => s + m.value, 0);

        els.revenueChart.innerHTML = `
          <div class="chart-legend" style="margin-bottom:8px">
            <span style="font-size:12px;color:var(--muted)">Sold/production revenue - last 6 months</span>
            <strong style="font-size:13px">${money.format(totalClosed)}</strong>
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
            ${bars.map((b, i) => {
              const isLatest = i === bars.length - 1;
              return `
                <rect x="${b.x}" y="${b.y}" width="${b.barW}" height="${b.barH}" rx="3" fill="${isLatest ? "var(--accent)" : "var(--accent-soft)"}" stroke="${isLatest ? "var(--accent)" : "var(--line)"}" stroke-width="1"/>
                <text x="${b.x + b.barW / 2}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--muted)">${b.label}</text>
                ${b.value > 0 ? `<text x="${b.x + b.barW / 2}" y="${b.y - 4}" text-anchor="middle" font-size="8" fill="${isLatest ? "var(--accent-strong)" : "var(--muted)"}">${money.format(b.value).replace(/\.00$/, "")}</text>` : ""}
              `;
            }).join("")}
          </svg>
        `;
      };
    }
  }

  function patchProjectsAndReviews() {
    if (typeof renderProjectsView === "function") {
      window.renderProjectsView = function patchedRenderProjectsView() {
        if (!els.projectsGrid) return;
        const projects = allJobs().filter((job) => activeProductionStatuses.includes(job.status) || closedProductionStatuses.includes(job.status));
        els.projectsGrid.innerHTML = projects.length
          ? projects
              .map(
                (job) => `
              <article class="record-card">
                <span class="status-pill ${statusPillClass(job.status)}">${escapeHtml(job.status)}</span>
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
      };
    }

    if (typeof renderReviewsView === "function") {
      window.renderReviewsView = function patchedRenderReviewsView() {
        if (!els.reviewsList) return;
        const customers = state.contacts.filter((contact) =>
          contact.type === "Customer" || isSoldStatus(contact.status) || contactJobs(contact).some((job) => isSoldStatus(job.status)),
        );
        const hasReviewUrl = !!state.company.googleReviewUrl;
        const warningBanner = !hasReviewUrl ? `
          <div class="review-warning">
            <span data-icon="alert-triangle" aria-hidden="true"></span>
            No Google Review link saved yet - <button class="link-button" type="button" data-action="go-to-settings">add it in Settings</button> so it is included in every request.
          </div>
        ` : "";

        els.reviewsList.innerHTML = warningBanner + (customers.length
          ? customers.map((contact) => {
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
                        <span class="status-pill ${statusPillClass(contact.status)}">${escapeHtml(contact.status)}</span>
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
            }).join("")
          : '<div class="empty-state">Sold and completed customers will appear here for review follow-up</div>');

        hydrateIcons(els.reviewsList);
      };
    }
  }

  function installProductionFlow() {
    if (!canUseApp() || window.__rooflineProductionFlowInstalled) return false;
    window.__rooflineProductionFlowInstalled = true;
    syncStatuses();
    patchStatusPills();
    patchMetrics();
    patchApplyStatusUpdate();
    patchLeadCard();
    patchDashboard();
    patchProjectsAndReviews();
    ensureStatusOptions();

    const previousRender = typeof render === "function" ? render : null;
    if (previousRender && !window.__rooflineProductionFlowRenderWrapped) {
      window.__rooflineProductionFlowRenderWrapped = true;
      window.render = function patchedRender() {
        syncStatuses();
        previousRender();
        ensureStatusOptions();
      };
    }

    try { render(); } catch {}
    return true;
  }

  const timer = window.setInterval(() => {
    if (installProductionFlow()) window.clearInterval(timer);
  }, 250);
  window.setTimeout(() => window.clearInterval(timer), 15000);
})();
