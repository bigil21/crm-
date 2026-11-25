function render() {
  globalThis.window?.RooflineProductionFlow?.beforeRender?.();
  renderSidebar();
  if (!canView(state.view)) {
    state.view = firstAllowedView();
  }
  // Page titles match the menu labels, so the page you land on is named what
  // you clicked.
  const titles = {
    dashboard: "Dashboard",
    leads: "Lead Intake",
    pipeline: "Sales Pipeline",
    contacts: "Contacts",
    jobs: "Jobs",
    projects: "Sold Jobs & Production",
    leadDetail: "Lead Detail",
    estimates: "Estimates",
    companyDocuments: "Documents",
    calendar: "Calendar",
    tasks: "Tasks",
    invoices: "Billing & Payments",
    reviews: "Reviews",
    reports: "Reports",
    company: "Settings",
  };

  els.viewTitle.textContent = titles[state.view];
  els.globalSearch.value = state.search;

  els.navItems.forEach((item) => {
    item.classList.toggle("hidden", !canView(item.dataset.view));
    item.classList.toggle("active", item.dataset.view === state.view);
  });

  Object.entries(els.views).forEach(([view, element]) => {
    element.classList.toggle("hidden", view !== state.view);
  });
  renderBrandLogo();
  renderSalesRepOptions();
  if (state.view !== "pipeline") document.body?.classList?.remove("pipeline-drawer-open");
  els.summaryStrip.classList.toggle("hidden", state.view !== "dashboard");
  els.workspace?.classList.toggle("dashboard-watermark", state.view === "dashboard");
  renderTopbarProfile();

  // Each workspace previously rendered every screen on every state change.
  // With a full CRM this left thousands of hidden rows/cards in the DOM and
  // made ordinary mouse-wheel scrolling compete with needless layout work.
  // Render the current workspace only; it is rebuilt from state whenever the
  // user opens it, so its data is always current without the background cost.
  const activeRenderer = {
    dashboard: () => {
      renderSummary();
      renderDashboard();
    },
    leads: renderLeadsView,
    pipeline: renderPipeline,
    contacts: renderContacts,
    jobs: renderJobsView,
    projects: renderProjectsView,
    leadDetail: renderLeadDetail,
    estimates: renderEstimates,
    companyDocuments: renderCompanyDocuments,
    calendar: renderCalendar,
    tasks: renderTasksView,
    invoices: renderInvoicesView,
    reviews: renderReviewsView,
    reports: renderReportsView,
    company: renderCompanyForm,
  };
  try {
    activeRenderer[state.view]?.();
    clearViewRenderError(state.view);
    renderPartialDataNotice(state.view);
  } catch (error) {
    // One failing screen must never blank the page or stop the rest of the
    // shell (navigation, search, permissions) from being drawn.
    console.error(`The ${state.view} view could not be drawn`, error);
    showViewRenderError(state.view, error);
  }
  renderLiveSearchResults();
  applyPermissionsToDom();
  globalThis.window?.RooflineWorkflowChecklist?.afterRender?.();
  globalThis.window?.RooflineProjectConversations?.afterRender?.();
}

function showViewRenderError(view, error) {
  const host = els.views?.[view];
  if (!host?.querySelector) return;
  let banner = host.querySelector(":scope > .view-render-error");
  if (!banner) {
    banner = document.createElement("div");
    banner.className = "view-render-error";
    banner.setAttribute("role", "alert");
    host.prepend(banner);
  }
  banner.textContent = `This page could not be fully displayed (${error?.message || "unexpected error"}). Your saved data is not affected. Reload the page, and report this message if it keeps happening.`;
}

function clearViewRenderError(view) {
  els.views?.[view]?.querySelector?.(":scope > .view-render-error")?.remove?.();
}

function renderBrandLogo() {
  const logoSource = companyLogoSource() || "icon.svg";
  if (els.brandLogo) {
    els.brandLogo.src = logoSource;
    els.brandLogo.alt = logoSource !== "icon.svg" ? `${state.company.name || "Company"} logo` : "";
  }
}

function renderTopbarProfile() {
  if (els.dashboardDateRange) {
    const start = rangeStart("week");
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    // This is a label, not a filter: it names the current week. It looked like
    // a date picker and did nothing when clicked, so say what it is.
    els.dashboardDateRange.innerHTML = `
      <span aria-hidden="true" data-icon="calendar"></span>
      <span>This week · ${formatDate(localDateISO(start))} - ${formatDate(localDateISO(end))}</span>
    `;
    els.dashboardDateRange.title = "The current week. Totals on each page say which period they cover.";
    hydrateIcons(els.dashboardDateRange);
  }

  const followUps = followUpSummary();
  const pendingTasks = followUps.overdue.length + followUps.today.length + followUps.estimates.length;
  // Only the bell's badge. This used to write the reminder count into every
  // badge in the header, including the @ mentions one.
  document.querySelectorAll(".notification-button .notification-dot").forEach((node) => {
    node.textContent = pendingTasks;
    node.classList.toggle("hidden", pendingTasks === 0);
  });
  document.querySelector(".notification-button")?.setAttribute("aria-label", `Open reminders: ${pendingTasks} need attention`);

  if (els.userChip) {
    const initials = (state.currentUser.name || "User")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
    els.userChip.innerHTML = `
      <span class="avatar">${escapeHtml(initials || "U")}</span>
      <span>
        <strong>${escapeHtml(state.currentUser.name || "User")}</strong>
        <small>${escapeHtml(roleLabel())} - <a href="/logout">Logout</a></small>
      </span>
    `;
  }
}

function applyPermissionsToDom() {
  // Don't offer sections (such as Settings) that the role would bounce from.
  document.querySelectorAll(".nav-item[data-view]").forEach((item) => {
    item.classList.toggle("hidden", !canView(item.dataset.view));
  });

  document.querySelectorAll("[data-action]").forEach((button) => {
    const permission = actionPermissions[button.dataset.action];
    if (permission) {
      button.classList.toggle("hidden", !canAction(permission));
      button.disabled = !canAction(permission) || button.dataset.ruleDisabled === "true";
    }
  });

  [
    [els.addContactButton, "manageContacts"],
    [els.addLeadFromLeadsButton, "manageContacts"],
    [els.importZohoButton, "manageContacts"],
    [els.editLeadDetailButton, "manageContacts"],
    [els.emailLeadDetailButton, "sendEmail"],
    [els.estimateLeadDetailButton, "manageEstimates"],
    [els.uploadLeadDocumentButton, "manageDocuments"],
    [els.uploadLeadPhotoButton, "manageDocuments"],
    [els.uploadCompanyDocumentButton, "manageDocuments"],
    [els.toggleEstimateCreateButton, "manageEstimates"],
    [els.newEstimateButton, "manageEstimates"],
    [els.addLineItemButton, "manageEstimates"],
    [els.deleteEstimateButton, "manageEstimates"],
    [els.saveEstimateButton, "manageEstimates"],
    [els.sendEstimateButton, "manageEstimates"],
  ].forEach(([element, permission]) => {
    if (!element) return;
    element.classList.toggle("hidden", !canAction(permission));
    element.disabled = !canAction(permission);
  });
  // The lead dialog's Delete and Estimate only apply to a saved lead. This
  // pass runs on every render (including realtime updates while someone is
  // typing a new lead), and used to reveal Delete in the spot where Save sat.
  const editingSavedContact = Boolean(els.contactForm?.elements?.id?.value && getContact(els.contactForm.elements.id.value));
  [
    [els.deleteContactButton, "manageContacts"],
    [els.estimateFromContactButton, "manageEstimates"],
  ].forEach(([element, permission]) => {
    if (!element) return;
    const allowed = canAction(permission) && editingSavedContact;
    element.classList.toggle("hidden", !allowed);
    element.disabled = !allowed;
  });

  const estimateWritable = canAction("manageEstimates");
  els.estimateForm?.querySelectorAll("input, textarea, select").forEach((field) => {
    field.disabled = !estimateWritable;
  });
  const hasEstimate = Boolean(getSelectedEstimate());
  els.copyEstimateButton.disabled = !hasEstimate;
  els.printEstimateButton.disabled = !hasEstimate;

  const jobWritable = canAction("manageJobs");
  els.leadJobForm?.querySelectorAll("input, textarea, select, button").forEach((field) => {
    field.disabled = !jobWritable;
  });

  const financialWritable = canAction("manageJobFinancials");
  els.profitCostForm?.querySelectorAll("input, textarea, select, button").forEach((field) => {
    field.disabled = !financialWritable;
  });
  if (els.profitJobSelect) els.profitJobSelect.disabled = !financialWritable;

  const emailWritable = canAction("sendEmail");
  els.leadEmailForm?.querySelectorAll("input, textarea, select, button").forEach((field) => {
    field.disabled = !emailWritable;
  });

  const companyWritable = canAction("manageCompany");
  els.companyForm?.querySelectorAll("input, textarea, button").forEach((field) => {
    field.disabled = !companyWritable;
  });

  const taskWritable = canAction("manageTasks");
  els.calendarTaskForm?.querySelectorAll("input, textarea, select, button").forEach((field) => {
    field.disabled = !taskWritable;
  });
}

function renderSummary() {
  const metrics = dashboardMetrics();
  // While the full record set is still loading there is no honest number to
  // show, so the cards say so instead of showing a partial total.
  const shown = (value) => (metrics.pending ? "…" : value);
  const note = (caption) => (metrics.pending ? companyTotalsCaption() : caption);

  const cards = [
    ["Total Leads", shown(metrics.leads), note(`${metrics.openLeads} with open jobs · all time`), "user", "blue"],
    ["Estimates Sent", shown(metrics.estimatesSent), note("Sent or won estimates · all time"), "file", "green"],
    ["Jobs Paid", shown(metrics.closedJobs), note("Contracts paid in full · all time"), "check", "purple"],
    // Money can be known before the counts are: see moneyTotalsForDisplay.
    ["Revenue Collected", metrics.moneyReady ? money.format(metrics.closedValue) : "…", metrics.moneyReady ? "All confirmed payments · all time" : companyTotalsCaption(), "dollar", "orange"],
    ["Pipeline Value", shown(money.format(metrics.pipelineValue)), note("Value of all jobs not lost"), "bar-chart", "cyan"],
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

function weatherCodeDetails(code) {
  const value = Number(code);
  if ([0].includes(value)) return { label: "Clear", icon: "sun" };
  if ([1, 2].includes(value)) return { label: "Partly Cloudy", icon: "partly" };
  if ([3].includes(value)) return { label: "Cloudy", icon: "cloud" };
  if ([45, 48].includes(value)) return { label: "Fog", icon: "fog" };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(value)) {
    return { label: "Rain", icon: "rain" };
  }
  if ([71, 73, 75, 77, 85, 86].includes(value)) return { label: "Snow", icon: "snow" };
  if ([95, 96, 99].includes(value)) return { label: "Storms", icon: "storm" };
  return { label: "Weather", icon: "partly" };
}

function formatTemperature(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))}&deg;` : "--&deg;";
}

function weatherDayLabel(isoDate) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

function weatherUpdatedLabel() {
  if (!weatherState.fetchedAt) return "Not updated yet";
  return `Updated ${new Date(weatherState.fetchedAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function getBrowserWeatherLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Browser location is unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: "Your Location",
          note: "Using browser location",
        });
      },
      (error) => reject(error),
      {
        enableHighAccuracy: false,
        maximumAge: weatherRefreshMs,
        timeout: 10000,
      },
    );
  });
}

function weatherApiUrl(location) {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "is_day",
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
    ].join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    forecast_days: "4",
    timezone: "auto",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

async function loadWeather({ force = false } = {}) {
  if (weatherState.status === "loading") return;
  const isFresh = weatherState.current && Date.now() - weatherState.fetchedAt < weatherRefreshMs;
  if (isFresh && !force) return;

  weatherState.status = "loading";
  weatherState.error = "";
  renderWeatherPanel();

  let location = fallbackWeatherLocation;
  let locationNote = "";
  if (force) {
    try {
      location = await getBrowserWeatherLocation();
    } catch {
      locationNote = fallbackWeatherLocation.note;
    }
  } else {
    locationNote = "Using the office forecast. Choose refresh to use this device's location.";
  }

  try {
    const response = await fetch(weatherApiUrl(location));
    if (!response.ok) throw new Error("Weather service unavailable");
    const data = await response.json();
    const current = data.current || {};
    const daily = data.daily || {};
    const condition = weatherCodeDetails(current.weather_code);

    weatherState.status = "ready";
    weatherState.fetchedAt = Date.now();
    weatherState.location = {
      ...location,
      note: locationNote || location.note || "Live local weather",
    };
    weatherState.current = {
      temperature: current.temperature_2m,
      apparentTemperature: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      precipitation: current.precipitation,
      windSpeed: current.wind_speed_10m,
      condition,
    };
    weatherState.daily = (daily.time || []).slice(0, 4).map((day, index) => ({
      day,
      condition: weatherCodeDetails(daily.weather_code?.[index]),
      high: daily.temperature_2m_max?.[index],
      low: daily.temperature_2m_min?.[index],
      rainChance: daily.precipitation_probability_max?.[index],
    }));
    weatherState.error = locationNote;
  } catch {
    weatherState.status = weatherState.current ? "ready" : "error";
    weatherState.error = "Live weather is temporarily unavailable";
  }
  renderWeatherPanel();
}

function ensureWeatherData() {
  if (state.view !== "dashboard") return;
  if (!weatherState.current || Date.now() - weatherState.fetchedAt >= weatherRefreshMs) {
    loadWeather();
  }
}

function dashboardWidgetLayoutItem(widgetId) {
  return state.dashboardWidgetLayout.find((item) => item.id === widgetId);
}

function saveDashboardWidgetLayout() {
  state.dashboardWidgetLayout = normalizeDashboardWidgetLayout(state.dashboardWidgetLayout);
  saveUiState();
}

function renderDashboardWidgetLayout() {
  if (!els.dashboardLayout) return;
  state.dashboardWidgetLayout = normalizeDashboardWidgetLayout(state.dashboardWidgetLayout);
  els.dashboardLayout.classList.toggle("is-customizing", dashboardCustomizeActive);
  els.dashboardCustomizeButton?.setAttribute("aria-pressed", String(dashboardCustomizeActive));
  if (els.dashboardCustomizeButton) {
    els.dashboardCustomizeButton.lastChild.textContent = dashboardCustomizeActive ? " Done" : " Customize widgets";
  }
  els.dashboardResetLayoutButton?.classList.toggle("hidden", !dashboardCustomizeActive);
  els.dashboardLayoutHelp?.classList.toggle("hidden", !dashboardCustomizeActive);

  els.dashboardLayout.querySelectorAll("[data-dashboard-widget]").forEach((widget) => {
    const item = dashboardWidgetLayoutItem(widget.dataset.dashboardWidget);
    if (!item) return;
    widget.style.setProperty("--dashboard-widget-columns", String(item.columns));
    widget.style.setProperty("--dashboard-widget-rows", String(item.rows));
    widget.style.order = String(item.order);
    widget.classList.toggle("is-widget-editable", dashboardCustomizeActive);

    let dragHandle = widget.querySelector("[data-dashboard-widget-drag]");
    if (!dragHandle) {
      dragHandle = document.createElement("button");
      dragHandle.type = "button";
      dragHandle.className = "dashboard-widget-drag-handle";
      dragHandle.dataset.dashboardWidgetDrag = "";
      dragHandle.textContent = "⋮⋮";
      dragHandle.title = "Drag to move this widget";
      dragHandle.setAttribute("aria-label", `Move ${widget.dataset.dashboardWidget} widget`);
      widget.append(dragHandle);
    }
    dragHandle.draggable = dashboardCustomizeActive;
    dragHandle.classList.toggle("hidden", !dashboardCustomizeActive);

    let resizeHandle = widget.querySelector("[data-dashboard-widget-resize]");
    if (!resizeHandle) {
      resizeHandle = document.createElement("button");
      resizeHandle.type = "button";
      resizeHandle.className = "dashboard-widget-resize-handle";
      resizeHandle.dataset.dashboardWidgetResize = "";
      resizeHandle.title = "Drag to resize this widget";
      resizeHandle.setAttribute("aria-label", `Resize ${widget.dataset.dashboardWidget} widget`);
      widget.append(resizeHandle);
    }
    resizeHandle.classList.toggle("hidden", !dashboardCustomizeActive);
  });
}

function moveDashboardWidget(draggedId, targetId) {
  if (!draggedId || !targetId || draggedId === targetId) return;
  const layout = normalizeDashboardWidgetLayout(state.dashboardWidgetLayout);
  const dragged = layout.find((item) => item.id === draggedId);
  if (!dragged || !layout.some((item) => item.id === targetId)) return;
  const remaining = layout.filter((item) => item.id !== draggedId);
  const targetIndex = remaining.findIndex((item) => item.id === targetId);
  remaining.splice(targetIndex < 0 ? remaining.length : targetIndex, 0, dragged);
  state.dashboardWidgetLayout = remaining.map((item, order) => ({ ...item, order }));
  saveDashboardWidgetLayout();
  renderDashboardWidgetLayout();
}

function beginDashboardWidgetResize(event, widget) {
  if (!dashboardCustomizeActive || !widget || !els.dashboardLayout) return;
  const item = dashboardWidgetLayoutItem(widget.dataset.dashboardWidget);
  if (!item) return;
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  const startColumns = item.columns;
  const startRows = item.rows;
  const columnStep = Math.max(60, els.dashboardLayout.getBoundingClientRect().width / 12);
  widget.classList.add("is-resizing");

  const move = (moveEvent) => {
    item.columns = Math.max(3, Math.min(12, Math.round(startColumns + (moveEvent.clientX - startX) / columnStep)));
    item.rows = Math.max(12, Math.min(40, Math.round(startRows + (moveEvent.clientY - startY) / 16)));
    widget.style.setProperty("--dashboard-widget-columns", String(item.columns));
    widget.style.setProperty("--dashboard-widget-rows", String(item.rows));
  };
  const finish = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    widget.classList.remove("is-resizing");
    saveDashboardWidgetLayout();
    renderDashboardWidgetLayout();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish, { once: true });
}

function bindDashboardWidgetEvents() {
  if (!els.dashboardLayout) return;
  els.dashboardCustomizeButton?.addEventListener("click", () => {
    dashboardCustomizeActive = !dashboardCustomizeActive;
    renderDashboardWidgetLayout();
  });
  els.dashboardResetLayoutButton?.addEventListener("click", () => {
    state.dashboardWidgetLayout = normalizeDashboardWidgetLayout();
    saveDashboardWidgetLayout();
    renderDashboardWidgetLayout();
    showToast("Dashboard layout reset");
  });
  els.dashboardLayout.addEventListener("dragstart", (event) => {
    const handle = event.target.closest("[data-dashboard-widget-drag]");
    const widget = handle?.closest("[data-dashboard-widget]");
    if (!dashboardCustomizeActive || !widget) return event.preventDefault();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", widget.dataset.dashboardWidget);
    widget.classList.add("is-dragging");
  });
  els.dashboardLayout.addEventListener("dragend", () => {
    els.dashboardLayout.querySelectorAll(".is-dragging, .is-drop-target").forEach((item) => item.classList.remove("is-dragging", "is-drop-target"));
  });
  els.dashboardLayout.addEventListener("dragover", (event) => {
    const widget = event.target.closest("[data-dashboard-widget]");
    if (!dashboardCustomizeActive || !widget) return;
    event.preventDefault();
    els.dashboardLayout.querySelectorAll(".is-drop-target").forEach((item) => item.classList.remove("is-drop-target"));
    widget.classList.add("is-drop-target");
  });
  els.dashboardLayout.addEventListener("drop", (event) => {
    const widget = event.target.closest("[data-dashboard-widget]");
    if (!dashboardCustomizeActive || !widget) return;
    event.preventDefault();
    moveDashboardWidget(event.dataTransfer.getData("text/plain"), widget.dataset.dashboardWidget);
  });
  els.dashboardLayout.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-dashboard-widget-resize]");
    if (handle) beginDashboardWidgetResize(event, handle.closest("[data-dashboard-widget]"));
  });
}

function renderDashboard() {
  if (!els.views.dashboard) return;
  renderDashboardWidgetLayout();

  document.querySelectorAll("[data-leaderboard-range]").forEach((button) => {
    button.classList.toggle("active", button.dataset.leaderboardRange === state.leaderboardRange);
  });

  const closedJobs = allJobs().filter(
    (job) => jobHasFullPayment(job) && isInLeaderboardRange(job, state.leaderboardRange),
  );
  const reps = closedJobs.reduce((acc, job) => {
    const name = canonicalRepresentativeName(job.salesRep || "Unassigned", job) || "Unassigned";
    if (!acc.has(name)) {
      acc.set(name, { name, closedJobs: 0, value: 0 });
    }
    const rep = acc.get(name);
    rep.closedJobs += 1;
    rep.value += number(job.paidAmount);
    return acc;
  }, new Map());

  const rows = [...reps.values()].sort((a, b) => b.value - a.value || b.closedJobs - a.closedJobs);
  const rangeStartDate = rangeStart(state.leaderboardRange);
  if (els.leaderboardRangeLabel) {
    els.leaderboardRangeLabel.textContent = `${leaderboardRanges[state.leaderboardRange]} results since ${formatDate(
      localDateISO(rangeStartDate),
    )}`;
  }

  if (els.leaderboardTableBody && dashboardDataSource() === "pending") {
    els.leaderboardTableBody.innerHTML = `<tr><td colspan="5"><div class="empty-state">${escapeHtml(companyTotalsCaption())}…</div></td></tr>`;
  } else if (els.leaderboardTableBody) {
    els.leaderboardTableBody.innerHTML = rows.length
      ? rows
          .map(
            (rep, index) => `
          <tr>
            <td><span class="rank-pill">#${index + 1}</span></td>
            <td class="person-cell">
              <strong>${escapeHtml(rep.name)}</strong>
              <span>${rep.closedJobs === 1 ? "1 paid job" : `${rep.closedJobs} paid jobs`}</span>
            </td>
            <td>${rep.closedJobs}</td>
            <td>${money.format(rep.value)}</td>
            <td>${money.format(rep.closedJobs ? rep.value / rep.closedJobs : 0)}</td>
          </tr>
        `,
          )
          .join("")
      : '<tr><td colspan="5"><div class="empty-state">No fully paid jobs in this period</div></td></tr>';
  }

  renderPipelineOverview();
  renderRevenueOverview();
  renderDashboardTasks();
  renderDashboardDonuts();
  renderRecentActivity();
  renderTodaySchedule();
  renderWeatherPanel();
  ensureWeatherData();
}

function renderDashboardTasks() {
  renderFollowUpSummary("followUpDashboard");
  if (!els.dashboardTasksList) return;
  const summary = followUpSummary();
  const tasks = [...summary.overdue, ...summary.today, ...summary.upcoming];
  els.dashboardTasksList.innerHTML = tasks.length
    ? tasks.map((task) => renderTaskCard(task, { compact: true })).join("")
    : '<div class="empty-state">No open calendar tasks</div>';
  hydrateIcons(els.dashboardTasksList);
}

function renderPipelineOverview() {
  if (!els.pipelineOverview) return;
  const source = dashboardDataSource();
  if (source === "pending") {
    els.pipelineOverview.innerHTML = `<div class="empty-state compact-empty">${escapeHtml(companyTotalsCaption())}…</div>`;
    return;
  }
  const jobs = allJobs();
  // The same figure as the Pipeline Value card above: every job that is not Lost.
  const totalValue = dashboardMetrics().pipelineValue;
  const stages = statuses.map((status) => {
    const stageJobs = jobs.filter((job) => job.status === status);
    const stageLeadIds = new Set(stageJobs.map((job) => job.contactId));
    return { status, count: stageLeadIds.size, value: stageJobs.reduce((sum, job) => sum + number(job.value), 0) };
  });
  // Stages used by Construction and Home Services jobs are not roofing stages;
  // show them as one group so the ribbon accounts for every job.
  const otherJobs = jobs.filter((job) => !statuses.includes(job.status));
  if (otherJobs.length) {
    stages.splice(Math.max(stages.length - 1, 0), 0, {
      status: "__other__",
      label: "Other division stages",
      count: new Set(otherJobs.map((job) => job.contactId)).size,
      value: otherJobs.reduce((sum, job) => sum + number(job.value), 0),
    });
  }

  els.pipelineOverview.innerHTML = `
    <div class="pipeline-ribbon">
      ${stages
        .map(
          (stage, index) => `
            <button class="pipeline-stage stage-${index}" type="button" ${stage.status === "__other__" ? 'data-view="pipeline"' : `data-dashboard-stage="${escapeHtml(stage.status)}"`} aria-label="View ${stage.count} ${escapeHtml(stage.label || stage.status)} lead${stage.count === 1 ? "" : "s"}">
              <span>${escapeHtml(stage.label || leadStatusLabel(stage.status))}</span>
              <strong>${stage.count}</strong>
              <small>${stage.count === 1 ? "1 lead" : `${stage.count} leads`} · ${money.format(stage.value)}</small>
            </button>
          `,
        )
        .join("")}
    </div>
    <div class="pipeline-total">Total Pipeline Value: <strong>${money.format(totalValue)}</strong> <small>· leads per stage; a lead with jobs in two stages is counted in both</small></div>
  `;
}

function renderRevenueOverview() {
  if (!els.revenueChart) return;

  // Build last 6 months of real closed revenue
  const now = new Date();
  const source = dashboardDataSource();
  if (source === "pending") {
    els.revenueChart.innerHTML = `<div class="empty-state compact-empty">${escapeHtml(companyTotalsCaption())}…</div>`;
    return;
  }
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return {
      label: d.toLocaleString("en-US", { month: "short" }),
      year: d.getFullYear(),
      month: d.getMonth(),
      value: 0,
    };
  });

  // Each payment lands in the month it was received. The chart used to place a
  // job's whole paid amount in the month of its latest payment, and only for
  // jobs paid in full, so money moved between months as jobs were updated.
  if (source === "local") collectedByMonth(months);

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
      <span style="font-size:12px;color:var(--muted)">Collected revenue — last 6 months</span>
      <strong style="font-size:13px">${money.format(totalClosed)}</strong>
    </div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Closed revenue by month bar chart" style="width:100%;display:block">
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
          <rect x="${b.x}" y="${b.y}" width="${b.barW}" height="${b.barH}"
            rx="3" fill="${isLatest ? "var(--accent)" : "var(--accent-soft)"}"
            stroke="${isLatest ? "var(--accent)" : "var(--line)"}" stroke-width="1"/>
          <text x="${b.x + b.barW / 2}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--muted)">${b.label}</text>
          ${b.value > 0 ? `<text x="${b.x + b.barW / 2}" y="${b.y - 4}" text-anchor="middle" font-size="8" fill="${isLatest ? "var(--accent-strong)" : "var(--muted)"}">${money.format(b.value).replace(/\.00$/, "")}</text>` : ""}
        `;
      }).join("")}
    </svg>
  `;
}

function renderDashboardDonuts() {
  const leadContacts = visibleContacts().filter((contact) =>
    contactJobs(contact).some((job) => !["Paid", "Lost"].includes(job.status)),
  );
  const source = dashboardDataSource();
  if (source === "pending") {
    [els.leadSourcesChart, els.jobsByTypeChart, els.projectStatusChart].forEach((container) => {
      if (container) container.innerHTML = `<div class="empty-state compact-empty">${escapeHtml(companyTotalsCaption())}…</div>`;
    });
    return;
  }
  const sources = topGroupsWithOther(aggregateCounts(leadContacts, (contact) => leadSourceLabel(contact.source)));
  const jobsByType = topGroupsWithOther(aggregateCounts(allJobs(), jobType));
  // Sold and still being delivered: after the sale, before the job is closed.
  const productionJobs = allJobs().filter(jobIsInProduction);
  const projectStatus = topGroupsWithOther(aggregateCounts(productionJobs, (job) => job.status));
  // The donut shows leads that still have an open job, so it is labelled that way.
  renderDonutWidget(els.leadSourcesChart, sources, leadContacts.length, "Open Leads");
  renderDonutWidget(els.jobsByTypeChart, jobsByType, dashboardMetrics().totalJobs, "Total Jobs");
  renderDonutWidget(
    els.projectStatusChart,
    projectStatus,
    productionJobs.length,
    "Jobs in Production",
  );
}

function renderDonutWidget(container, items, total, label) {
  if (!container) return;
  const colors = ["#1d5ed8", "#0f9f98", "#f59e0b", "#7651d1", "#1f9d55", "#9fb7da"];
  const sum = Math.max(items.reduce((value, item) => value + item.count, 0), 1);
  let cursor = 0;
  const gradient = items.length
    ? items
        .map((item, index) => {
          const start = cursor;
          cursor += (item.count / sum) * 100;
          return `${colors[index % colors.length]} ${start}% ${cursor}%`;
        })
        .join(", ")
    : `${colors[5]} 0% 100%`;
  container.innerHTML = `
    <div class="donut" style="--donut:${gradient}">
      <strong>${total}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
    <div class="donut-legend">
      ${(items.length ? items : [{ label: "No data", count: 0 }])
        .slice(0, 5)
        .map(
          (item, index) => `
            <span><i style="background:${colors[index % colors.length]}"></i>${escapeHtml(item.label)} <small>${item.count}</small></span>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderRecentActivity() {
  if (!els.recentActivityList) return;
  const activity = dashboardActivityItems(5);
  els.recentActivityList.innerHTML = activity.length
    ? activity
        .map(
          (item) => `
          <article class="activity-item">
            <span class="activity-icon" aria-hidden="true" data-icon="${item.icon}"></span>
            <button class="link-button" type="button" data-action="open-contact" data-contact-id="${item.contactId || ""}">
              ${escapeHtml(item.title)}
            </button>
            <span>${escapeHtml(item.value)}</span>
            <small>${escapeHtml(item.meta)}</small>
          </article>
        `,
        )
        .join("")
    : '<div class="empty-state">No recent activity yet</div>';
  hydrateIcons(els.recentActivityList);
}

function renderTodaySchedule() {
  if (!els.todayScheduleList) return;
  const today = todayISO();
  const tasks = visibleCalendarTasks()
    .filter((task) => !task.completed && String(task.dueAt).startsWith(today))
    .sort((a, b) => taskDueTime(a) - taskDueTime(b));
  const schedule = tasks;
  if (!schedule.length) {
    els.todayScheduleList.innerHTML = '<div class="empty-state">No tasks scheduled for today</div>';
    return;
  }
  els.todayScheduleList.innerHTML = schedule
    .slice(0, 5)
    .map((task) => {
      const date = taskDueTime(task);
      const contact = getContact(task.contactId);
      const taskAction = task.id
        ? `data-action="open-calendar-task" data-task-id="${escapeHtml(task.id)}"`
        : `data-view="calendar"`;
      return `
        <button class="schedule-card" type="button" ${taskAction} aria-label="Open ${escapeHtml(
          task.title,
        )} in calendar">
          <span>${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
          <strong>${escapeHtml(task.title)}</strong>
          <small>${escapeHtml(contact?.name || task.rep || "Internal")}</small>
        </button>
      `;
    })
    .join("");
}

function renderWeatherPanel() {
  if (!els.weatherPanel) return;
  const isLoading = weatherState.status === "loading";
  const current = weatherState.current;
  const condition = current?.condition || { label: "Loading", icon: "partly" };
  const statusNote = weatherState.error || weatherState.location.note || weatherUpdatedLabel();
  els.weatherPanel.innerHTML = `
    <div class="weather-card ${isLoading ? "is-loading" : ""}">
      <header class="weather-head">
        <div>
          <p class="eyebrow">Live weather</p>
          <strong>${escapeHtml(weatherState.location.label)}</strong>
          <span>${escapeHtml(statusNote)}</span>
        </div>
        <button class="mini-button weather-refresh" type="button" title="Refresh weather" aria-label="Refresh weather" data-action="refresh-weather">
          <span aria-hidden="true" data-icon="refresh"></span>
        </button>
      </header>
      <div class="weather-main">
        <span class="weather-icon weather-${escapeHtml(condition.icon)}"></span>
        <div>
          <strong>${current ? formatTemperature(current.temperature) : "--&deg;"}</strong>
          <span>${escapeHtml(condition.label)}</span>
        </div>
      </div>
      <div class="weather-stats">
        <span><strong>${current ? formatTemperature(current.apparentTemperature) : "--&deg;"}</strong>Feels</span>
        <span><strong>${current?.windSpeed ? `${Math.round(Number(current.windSpeed))} mph` : "--"}</strong>Wind</span>
        <span><strong>${Number.isFinite(Number(current?.humidity)) ? `${Math.round(Number(current.humidity))}%` : "--"}</strong>Humidity</span>
        <span><strong>${Number.isFinite(Number(current?.precipitation)) ? `${Number(current.precipitation).toFixed(2)} in` : "--"}</strong>Rain</span>
      </div>
      <div class="weather-days">
        ${
          weatherState.daily.length
            ? weatherState.daily
                .slice(1, 4)
                .map(
                  (day) => `
                    <span>
                      ${escapeHtml(weatherDayLabel(day.day))}
                      <i class="weather-dot weather-${escapeHtml(day.condition.icon)}"></i>
                      <strong>${
                        Number.isFinite(Number(day.high)) ? Math.round(Number(day.high)) : "--"
                      }/${Number.isFinite(Number(day.low)) ? Math.round(Number(day.low)) : "--"}</strong>
                      <small>${Number.isFinite(Number(day.rainChance)) ? `${Math.round(Number(day.rainChance))}% rain` : "Forecast"}</small>
                    </span>
                  `,
                )
                .join("")
            : "<span>Forecast loading</span><span>Forecast loading</span><span>Forecast loading</span>"
        }
      </div>
    </div>
  `;
  hydrateIcons(els.weatherPanel);
}

function renderPipelinePlaybook() {
  if (!els.views.pipeline) return;
  const division = activeDivisions().some((item) => item.id === state.pipelineDivision) ? state.pipelineDivision : "roofing";
  const opportunities = allJobs().filter((job) => (job.division || "roofing") === division);
  const divisionStages = pipelineStagesFor(division);
  const playbook = division === "roofing" ? pipelinePlaybook : divisionStages.map((status) => ({
    status,
    phase: division === "construction" ? "Project delivery" : "Service delivery",
    title: status,
    icon: status === "Paid" || status === "Completed" || status === "Invoiced" ? "check" : "clipboard",
    workspace: status === "Estimate" || status === "Contract" || status === "Invoiced" ? "estimates" : "jobs",
    workspaceLabel: status === "Estimate" || status === "Contract" || status === "Invoiced" ? "Open Estimates" : "Open Jobs",
    mission: `Complete the ${status} requirements and document the result before advancing.`,
    actions: ["Confirm the responsible person and due date", "Save required documents, photos, and notes", "Communicate the next step to the customer"],
    gate: `All ${status} work is complete and the next owner has a clear handoff.`,
  }));
  const terminalStage = divisionStages.at(-1);
  const activeLeads = opportunities.filter((job) => ![terminalStage, "Lost"].includes(job.status));
  const followUpsDue = visibleContacts().filter((contact) => {
    const status = primaryJob(contact).status || contact.status;
    return !["Won", "Lost"].includes(status) && staleLeadDays(contact) >= 3;
  }).length;
  const divisionPipelineValue = opportunities
    .filter((job) => job.status !== "Lost")
    .reduce((total, job) => total + number(job.contractValue ?? job.value), 0);
  const statusCount = (status) => opportunities.filter((job) => job.status === status).length;

  els.pipelineBoard.innerHTML = `
    <section class="pipeline-command-center" aria-label="Pipeline pulse">
      <div class="pipeline-command-copy">
        <span class="pipeline-live-dot" aria-hidden="true"></span>
        <span>Pipeline pulse</span>
        <strong>${activeLeads.length} active opportunities moving toward a decision</strong>
      </div>
      <div class="pipeline-command-stats">
        <label class="pipeline-division-control">Division
          <select data-pipeline-division>${activeDivisions().map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === division ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select>
        </label>
        <span><strong>${followUpsDue}</strong> need attention</span>
        <span><strong>${money.format(divisionPipelineValue)}</strong> potential value</span>
        <span><strong>${statusCount(terminalStage)}</strong> ${escapeHtml(terminalStage.toLowerCase())}</span>
      </div>
    </section>

    <div class="pipeline-journey" role="list" aria-label="Sales pipeline stages">
      ${playbook
        .map((stage, index) => {
          const count = statusCount(stage.status);
          return `
            <article class="pipeline-playbook-stage pipeline-playbook-stage-${index + 1}" role="listitem">
              <div class="pipeline-stage-marker" aria-hidden="true">
                <span>${index + 1}</span>
                <i data-icon="${stage.icon}"></i>
              </div>
              <div class="pipeline-stage-card">
                <header class="pipeline-stage-heading">
                  <div>
                    <p>Stage ${index + 1} &middot; ${escapeHtml(stage.phase)}</p>
                    <h3>${escapeHtml(stage.title)}</h3>
                  </div>
                  <span class="pipeline-stage-count">${count} ${count === 1 ? "lead" : "leads"}</span>
                </header>
                <p class="pipeline-stage-mission">${escapeHtml(stage.mission)}</p>
                <div class="pipeline-stage-body">
                  <div>
                    <h4>Rep actions</h4>
                    <ul class="pipeline-action-list">
                      ${stage.actions
                        .map(
                          (action) => `
                            <li>
                              <span aria-hidden="true" data-icon="check"></span>
                              ${escapeHtml(action)}
                            </li>
                          `,
                        )
                        .join("")}
                    </ul>
                  </div>
                  <aside class="pipeline-stage-gate">
                    <span>Ready to advance when</span>
                    <strong>${escapeHtml(stage.gate)}</strong>
                    <button class="pipeline-workspace-link" type="button" data-view="${stage.workspace}">
                      ${escapeHtml(stage.workspaceLabel)}
                      <span aria-hidden="true">&rarr;</span>
                    </button>
                  </aside>
                </div>
              </div>
              ${index < playbook.length - 1 ? '<div class="pipeline-connector" aria-hidden="true"><span></span></div>' : ""}
            </article>
          `;
        })
        .join("")}
    </div>

    <section class="pipeline-recovery-lane">
      <div class="pipeline-recovery-icon" aria-hidden="true" data-icon="refresh"></div>
      <div>
        <p class="eyebrow">Not ready is not the end</p>
        <h3>Recover, nurture, or close the loop</h3>
        <p>Record the real objection, agree on a follow-up date, and keep the lead in Contacted. Mark a lead Lost only after the rep records why the opportunity ended.</p>
      </div>
      <div class="pipeline-recovery-steps" aria-label="Lead recovery steps">
        <span><b>1</b> Name the objection</span>
        <span><b>2</b> Set the next date</span>
        <span><b>3</b> Return to the path</span>
        <span class="pipeline-lost-count"><b>${statusCount("Lost")}</b> closed as lost</span>
      </div>
    </section>
  `;
  hydrateIcons(els.pipelineBoard);
}

function pipelineOpportunityKey(contactId, jobId) {
  return `${contactId}:${jobId}`;
}

function pipelineOpportunityRows(division = state.pipelineDivision) {
  return visibleContacts().flatMap((contact) => contactJobs(contact)
    .filter((job) => (job.division || contact.division || "roofing") === division)
    .map((job) => ({ contact, job, key: pipelineOpportunityKey(contact.id, job.id) })));
}

function pipelineStageEnteredTimestamp(contact, job) {
  const direct = localTimestamp(job.salesStageEnteredAt);
  if (Number.isFinite(direct)) return direct;
  const history = [...(job.salesStageHistory || [])].reverse().find((entry) => entry.stage === job.salesStage);
  const historic = localTimestamp(history?.enteredAt);
  if (Number.isFinite(historic)) return historic;
  const matchingUpdate = (contact.updates || []).find((update) => update.jobId === job.id && update.status === job.status);
  return localTimestamp(matchingUpdate?.createdAt || job.updatedAt || job.createdAt || contact.createdAt) || Date.now();
}

function pipelineDaysInStage(contact, job, now = Date.now()) {
  return Math.max(0, Math.floor((now - pipelineStageEnteredTimestamp(contact, job)) / 86400000));
}

function pipelineStageTargetDays(stage = "") {
  const key = String(stage).toLowerCase();
  if (key.includes("new") || key === "contacted") return 1;
  if (key.includes("follow-up") || key.includes("revision") || key.includes("board")) return 5;
  if (key.includes("proposal") || key.includes("estimate") || key.includes("bid")) return 3;
  if (key.includes("inspection") || key.includes("consultation") || key.includes("site visit")) return 3;
  return 4;
}

function pipelineNextTask(contact, job) {
  return visibleCalendarTasks()
    .filter((task) => !task.completed && task.contactId === contact.id && (!task.jobId || task.jobId === job.id))
    .sort((left, right) => localTimestamp(left.dueAt) - localTimestamp(right.dueAt))[0] || null;
}

function pipelineChecklist(contact, job) {
  return window.RooflineWorkflowChecklist?.stageChecklist?.(contact, job, job.status) || {
    stage: job.status,
    items: [],
    completed: 0,
    total: 0,
    ready: true,
    missing: [],
  };
}

function pipelineLifecycleStatusFor(division, salesStage, currentStatus) {
  if (salesStage === "Lost") return "Lost";
  if (division === "services") {
    if (salesStage === "Scheduled/Quoted" || salesStage === "Approved") return "Scheduled";
    // Handing a sold service job to operations does not mean the work is done:
    // it stays Scheduled until the job itself is moved to Completed.
    if (salesStage === "Operations Handoff") return ["Completed", "Invoiced", "Paid"].includes(currentStatus) ? currentStatus : "Scheduled";
    if (salesStage === "New Request" && currentStatus === "New") return "New";
    return "Request";
  }
  if (division === "construction") {
    if (salesStage === "New" && currentStatus === "New") return "New";
    if (["New", "Contacted", "Consultation Scheduled"].includes(salesStage)) return "Consultation";
    if (["Site Visit & Measurements", "Design & Selections"].includes(salesStage)) return "Design & Selections";
    if (["Proposal Sent", "Revisions/Decision", "Bid Preparation", "Bid Submitted", "Management Review", "Board Approval"].includes(salesStage)) return "Estimate";
    return "Contract";
  }
  if (salesStage === "New") return "New";
  if (salesStage === "Contacted") return "Contacted";
  if (["Inspection Scheduled", "Inspection Complete"].includes(salesStage)) return "Inspection";
  if (["Estimate Sent", "Follow-Up/Decision", "Bid Preparation", "Bid Submitted", "Management Review", "Board Approval"].includes(salesStage)) return "Estimate Sent";
  if (["Contract & Deposit", "Production Handoff"].includes(salesStage)) return "Won";
  return currentStatus;
}

// Checklist items that must be complete before a card leaves a board column
// when the job's production stage stays the same. Ids match the production
// stage checklists in workflow-checklists-v65.js.
const salesStageExitRequirements = {
  roofing: {
    "Inspection Scheduled": ["inspection-complete", "photos-measurements", "findings-documented"],
    "Estimate Sent": ["estimate-sent", "estimate-reviewed", "follow-up-scheduled"],
    "Contract & Deposit": ["signed-contract", "deposit-terms"],
  },
  construction: {
    "Site Visit & Measurements": ["site-measured", "existing-photos"],
    "Proposal Sent": ["estimate-created", "estimate-sent", "estimate-reviewed"],
    "Contract & Deposit": ["signed-contract", "deposit-terms"],
  },
  services: {
    "Scheduled/Quoted": ["price-approved"],
  },
};

// Commercial and HOA opportunities pass through four bid-approval stages that
// residential ones do not have. Show those columns whenever such an
// opportunity is on the board; without them the card vanished for four stages.
function pipelineBoardStages(division, accountFilter, rows) {
  if (accountFilter !== "all" || division === "services") return salesPipelineStagesFor(division, accountFilter);
  const hasCommercial = rows.some(({ contact, job }) => ["commercial", "hoa"].includes(String(job.propertyType || contact.propertyType || "").toLowerCase()));
  return salesPipelineStagesFor(division, hasCommercial ? "commercial" : "all");
}

function pipelineOptionMarkup(values, selected, allLabel) {
  return [`<option value="all">${escapeHtml(allLabel)}</option>`, ...values.map((value) => `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(value)}</option>`)].join("");
}

function pipelineRowAttention(row, now = Date.now()) {
  const { contact, job } = row;
  const stage = job.salesStage || normalizeSalesStage(job, contact, job.division, job.propertyType);
  const task = pipelineNextTask(contact, job);
  const inactiveDays = Math.max(0, Math.floor((now - leadActivityTimestamp(contact)) / 86400000));
  const stageDays = pipelineDaysInStage(contact, job, now);
  const isNewStage = stage === salesPipelineStagesFor(job.division, job.propertyType)[0];
  return {
    unassigned: String(contact.source || "").toLowerCase() === "website" && (!job.salesRep || job.salesRep === "Unassigned"),
    // A logged call is recorded on the job itself. A lead's notes are loaded
    // only when the lead is opened, so they cannot be what says it was called.
    uncontacted: isNewStage && !(job.lastTouchAt || contact.lastTouchAt)
      && (!contact.lastContact || !(contact.updates || []).some((update) => update.jobId === job.id || !update.jobId)),
    overdue: Boolean(task && !task.completed && localTimestamp(task.dueAt) < now),
    inactive: inactiveDays >= state.pipelineStaleDays,
    noDecision: ["Estimate Sent", "Proposal Sent", "Follow-Up/Decision", "Revisions/Decision"].includes(stage) && !(job.decisionDate || job.nextDecisionDate),
    stuck: stageDays > pipelineStageTargetDays(stage),
  };
}

function pipelineFilteredRows({ ignoreAttention = false } = {}) {
  const now = Date.now();
  const cutoffDays = number(state.pipelineDateRange);
  return pipelineOpportunityRows().filter(({ contact, job, ...row }) => {
    const propertyType = String(job.propertyType || contact.propertyType || "residential").toLowerCase();
    if (state.pipelinePropertyType !== "all" && propertyType !== state.pipelinePropertyType) return false;
    if (state.pipelineRep !== "all" && (job.salesRep || contact.salesRep || "Unassigned") !== state.pipelineRep) return false;
    if (state.pipelineService !== "all" && (job.service || contact.service || "") !== state.pipelineService) return false;
    if (state.pipelineSource !== "all" && (contact.source || "No source") !== state.pipelineSource) return false;
    if (state.pipelineUrgency !== "all" && (job.urgency || contact.urgency || "normal") !== state.pipelineUrgency) return false;
    if (cutoffDays) {
      const created = localTimestamp(job.createdAt || contact.createdAt);
      if (!Number.isFinite(created) || created < now - cutoffDays * 86400000) return false;
    }
    if (ignoreAttention || state.pipelineAttention === "all") return true;
    return Boolean(pipelineRowAttention({ contact, job, ...row }, now)[state.pipelineAttention]);
  });
}

// ---- Today's worklist -------------------------------------------------------
// The "Needs attention" counts as a list a rep can work through: who to call,
// why, and a place to log the call and set the next step without leaving the
// pipeline. Each call ends with a dated follow-up, or says there is none.
const PIPELINE_ATTENTION_ORDER = ["overdue", "unassigned", "uncontacted", "noDecision", "stuck", "inactive"];
const PIPELINE_ATTENTION_LABELS = {
  overdue: "Follow-up overdue",
  unassigned: "Unassigned website request",
  uncontacted: "Not contacted yet",
  noDecision: "No decision date",
  stuck: "Stuck in this stage",
  inactive: "Gone quiet",
};
const PIPELINE_CALL_OUTCOMES = [
  ["spoke", "Spoke with the customer"],
  ["voicemail", "Left a voicemail"],
  ["no-answer", "No answer"],
  ["message", "Sent a text or email"],
  ["not-interested", "Not interested"],
];
const PIPELINE_DECISION_STAGES = ["Estimate Sent", "Proposal Sent", "Follow-Up/Decision", "Revisions/Decision"];
const PIPELINE_WAITING_REASONS = ["noDecision", "stuck", "inactive"];
let pipelineWorklistFormKey = "";

// Open opportunities that need something, most pressing first: the longest
// overdue follow-up at the top. Lost and handed-off work is not sales work.
function pipelineWorklistRows(now = Date.now()) {
  const rank = (item) => PIPELINE_ATTENTION_ORDER.indexOf(item.reasons[0]);
  return pipelineFilteredRows({ ignoreAttention: true }).map((row) => {
    const { contact, job } = row;
    const division = job.division || contact.division || "roofing";
    const stage = normalizeSalesStage(job, contact, division, job.propertyType);
    if (stage === "Lost" || stage === salesPipelineStagesFor(division, job.propertyType || contact.propertyType).at(-1)) return null;
    const attention = pipelineRowAttention(row, now);
    const task = pipelineNextTask(contact, job);
    // An opportunity with a follow-up already set for a later time has its
    // next step: it is not on today's list for being slow, quiet or undecided.
    // An overdue follow-up, a new lead nobody has called and a website request
    // nobody owns always are.
    const hasNextStep = Boolean(task) && localTimestamp(task.dueAt) > now;
    const reasons = PIPELINE_ATTENTION_ORDER.filter((key) => attention[key] && !(hasNextStep && PIPELINE_WAITING_REASONS.includes(key)));
    if (!reasons.length) return null;
    if (state.pipelineAttention !== "all" && !reasons.includes(state.pipelineAttention)) return null;
    return {
      ...row, stage, attention, reasons, task,
      overdueBy: attention.overdue && task ? now - localTimestamp(task.dueAt) : 0,
      stageDays: pipelineDaysInStage(contact, job, now),
    };
  }).filter(Boolean).sort((left, right) =>
    rank(left) - rank(right)
    || right.overdueBy - left.overdueBy
    || right.stageDays - left.stageDays
    || String(left.contact.name || "").localeCompare(String(right.contact.name || "")));
}

// Nine in the morning on the next working day.
function pipelineDefaultFollowUp(now = new Date()) {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return dateTimeLocalValue(next.toISOString());
}

function pipelineWorklistRowMarkup(row, canLog) {
  const { contact, job, key, task, reasons, stage, attention } = row;
  const phone = String(contact.phone || "").replace(/\D/g, "");
  const formOpen = canLog && pipelineWorklistFormKey === key;
  const touchedAt = job.lastTouchAt || contact.lastTouchAt || "";
  const touchLabel = PIPELINE_CALL_OUTCOMES.find(([id]) => id === (job.lastTouchOutcome || contact.lastTouchOutcome))?.[1] || "";
  const form = !formOpen ? "" : `
      <form class="pipeline-call-form" data-pipeline-call-form data-contact-id="${escapeHtml(contact.id)}" data-job-id="${escapeHtml(job.id)}">
        <label>What happened<select name="outcome" required>${PIPELINE_CALL_OUTCOMES.map(([id, label]) => `<option value="${id}">${escapeHtml(label)}</option>`).join("")}</select></label>
        <label>Note<input type="text" name="note" maxlength="500" placeholder="Optional" autocomplete="off" /></label>
        <label>Next follow-up<input type="datetime-local" name="nextAt" value="${pipelineDefaultFollowUp()}" /></label>
        ${PIPELINE_DECISION_STAGES.includes(stage) ? `<label>Decision expected by<input type="date" name="decisionDate" value="${escapeHtml(job.decisionDate || "")}" /></label>` : ""}
        <label class="pipeline-call-check"><input type="checkbox" name="noFollowUp" /> No further follow-up</label>
        ${task ? `<label class="pipeline-call-check"><input type="checkbox" name="completeTask" ${attention.overdue ? "checked" : ""} /> Mark &ldquo;${escapeHtml(task.title)}&rdquo; done</label>` : ""}
        <div class="pipeline-call-actions"><button class="primary-button" type="submit">Save call</button><button class="secondary-button" type="button" data-pipeline-call-cancel>Cancel</button></div>
      </form>`;
  return `
    <li class="pipeline-worklist-row ${formOpen ? "is-open" : ""}" data-pipeline-worklist-row="${escapeHtml(key)}">
      <div class="pipeline-worklist-who">
        <strong>${escapeHtml(contact.name)}</strong>
        <span>${escapeHtml(job.name)} · ${escapeHtml(stage)} · ${escapeHtml(job.salesRep || contact.salesRep || "Unassigned")}</span>
        <span class="pipeline-worklist-reasons">${reasons.map((reason) => `<em class="pipeline-reason ${reason}">${escapeHtml(PIPELINE_ATTENTION_LABELS[reason])}</em>`).join("")}</span>
      </div>
      <div class="pipeline-worklist-when">
        <span>${task ? `Next: ${escapeHtml(task.title)} · ${escapeHtml(formatDateTime(task.dueAt))}` : "No follow-up scheduled"}</span>
        <span>${touchedAt ? `Last call: ${escapeHtml(formatDateTime(touchedAt))}${touchLabel ? ` · ${escapeHtml(touchLabel)}` : ""}` : "No call logged yet"}</span>
      </div>
      <div class="pipeline-worklist-actions">
        ${phone ? `<a class="secondary-button" href="tel:${escapeHtml(phone)}"><span data-icon="phone"></span> ${escapeHtml(contact.phone)}</a>` : '<span class="pipeline-worklist-nophone">No phone number</span>'}
        ${canLog ? `<button class="primary-button" type="button" data-pipeline-log-call="${escapeHtml(key)}" aria-expanded="${formOpen}">Log call</button>` : ""}
        <button class="link-button" type="button" data-pipeline-open="${escapeHtml(key)}">Details</button>
      </div>${form}
    </li>`;
}

function pipelineWorklistMarkup() {
  const rows = pipelineWorklistRows();
  const open = Boolean(state.pipelineWorklist);
  const canLog = canAction("manageJobs") && canAction("manageTasks");
  const shown = rows.slice(0, 40);
  const summary = rows.length
    ? `${rows.length} ${rows.length === 1 ? "opportunity needs" : "opportunities need"} a call or a next step`
    : "Nothing is waiting for a call or a next step";
  return `
      <section class="pipeline-worklist" aria-label="Today's worklist">
        <header>
          <div><strong>Today's worklist</strong><span>${summary}</span></div>
          ${rows.length ? `<button class="secondary-button" type="button" data-pipeline-worklist-toggle aria-expanded="${open}">${open ? "Hide the list" : "Work the list"}</button>` : ""}
        </header>
        ${open && rows.length ? `<ol class="pipeline-worklist-rows">${shown.map((row) => pipelineWorklistRowMarkup(row, canLog)).join("")}</ol>${rows.length > shown.length ? `<p class="pipeline-worklist-more">Showing the ${shown.length} most pressing of ${rows.length}. The rest appear as these are dealt with.</p>` : ""}` : ""}
      </section>`;
}

// The board is redrawn whenever records change, including by someone else.
// What a rep has typed into the call form is carried across the redraw.
function pipelineCallFormDraft() {
  const form = els.pipelineBoard?.querySelector?.("[data-pipeline-call-form]");
  if (!form) return null;
  const values = {};
  [...form.elements].forEach((field) => { if (field.name) values[field.name] = field.type === "checkbox" ? field.checked : field.value; });
  const focused = document.activeElement;
  return { key: pipelineOpportunityKey(form.dataset.contactId, form.dataset.jobId), values, focus: focused && form.contains(focused) ? focused.name || "" : "" };
}

function restorePipelineCallFormDraft(draft) {
  const form = els.pipelineBoard?.querySelector?.("[data-pipeline-call-form]");
  if (!draft || !form || pipelineOpportunityKey(form.dataset.contactId, form.dataset.jobId) !== draft.key) return;
  Object.entries(draft.values).forEach(([name, value]) => {
    const field = form.elements[name];
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value); else field.value = value;
  });
  if (form.elements.nextAt) form.elements.nextAt.disabled = Boolean(form.elements.noFollowUp?.checked);
  if (draft.focus) form.elements[draft.focus]?.focus?.();
}

// Records a call on an opportunity and what happens next. One save holds the
// note, the date of the call, the finished task if there was one, and the next
// follow-up, so a call never ends without a dated next step unless the rep
// says there is none.
async function logPipelineCall(contactId, jobId, entry = {}) {
  if (!requireAction("manageJobs") || !requireAction("manageTasks")) return false;
  const contact = getContact(contactId);
  const job = contact ? contactJobs(contact).find((item) => item.id === jobId) : null;
  if (!contact || !job) {
    showToast("That opportunity could not be found");
    return false;
  }
  const outcome = PIPELINE_CALL_OUTCOMES.find(([id]) => id === entry.outcome);
  if (!outcome) {
    showToast("Choose what happened on the call");
    return false;
  }
  const followUp = !entry.noFollowUp;
  const nextAt = String(entry.nextAt || "");
  if (followUp && !(localTimestamp(nextAt) > Date.now())) {
    showToast("Choose a time in the future for the next follow-up, or tick \"No further follow-up\"");
    return false;
  }
  const decisionDate = /^\d{4}-\d{2}-\d{2}$/.test(String(entry.decisionDate || "")) ? entry.decisionDate : "";
  const now = new Date().toISOString();
  const typed = String(entry.note || "").trim().slice(0, 500);
  const note = typed && !/[.!?]$/.test(typed) ? `${typed}.` : typed;
  const finishedTask = entry.completeTask ? pipelineNextTask(contact, job) : null;
  const hasOwnJob = (contact.jobs || []).some((item) => item.id === jobId);
  const touch = { lastContact: todayISO(), lastTouchAt: now, lastTouchOutcome: outcome[0] };

  const nextTask = followUp ? normalizeCalendarTask({
    id: uid("task"),
    title: `Follow up with ${contact.name}`,
    rep: job.salesRep || contact.salesRep || currentOwner().name,
    ownerUserId: job.ownerUserId || contact.ownerUserId || currentOwner().userId,
    ownerEmail: job.ownerEmail || contact.ownerEmail || currentOwner().email,
    ownerName: job.ownerName || contact.ownerName || currentOwner().name,
    contactId: contact.id,
    jobId: hasOwnJob ? job.id : "",
    dueAt: nextAt,
    duration: 15,
    reminder: "popup",
    notes: `${outcome[1]} on ${formatDate(todayISO())}.${note ? ` ${note}` : ""}`,
    workflowStatus: "not_started",
    createdAt: now,
    updatedAt: now,
    googleSyncStatus: "pending",
  }) : null;

  // The lead: when it was called and how it went. Only a job the lead really
  // has is written to; the stand-in job shown for an old lead-only record is not.
  updateContact(contact.id, (current) => ({
    ...current,
    ...touch,
    jobs: hasOwnJob
      ? current.jobs.map((item) => (item.id === jobId ? { ...item, ...touch, ...(decisionDate ? { decisionDate } : {}), updatedAt: now } : item))
      : current.jobs,
  }));
  const message = [
    `Call: ${outcome[1].toLowerCase()}.`,
    note,
    nextTask ? `Next follow-up ${formatDateTime(nextAt)}.` : "No further follow-up.",
    decisionDate ? `Decision expected by ${formatDate(decisionDate)}.` : "",
  ].filter(Boolean).join(" ");
  addContactUpdate(contact.id, { jobId: hasOwnJob ? job.id : "", message });
  if (nextTask) state.calendarTasks.unshift(nextTask);
  pipelineWorklistFormKey = "";
  saveState({ localOnly: true });
  queueDurableRecordsSave();
  queueCloudSave();
  renderPipeline();
  showToast(nextTask ? `Call logged. Next follow-up ${formatDateTime(nextAt)}.` : "Call logged. No further follow-up.");

  // The finished task and the new one go to Google the way every task does.
  if (finishedTask) await completeCalendarTask(finishedTask.id);
  if (nextTask) await syncCalendarTaskToGoogle(nextTask);
  return true;
}

function pipelineStageWeight(stage, stages) {
  const index = stages.indexOf(stage);
  if (index < 0) return 0;
  return Math.min(0.95, 0.1 + (index / Math.max(1, stages.length - 1)) * 0.8);
}

function pipelineConversionRate(rows, stage, nextStage) {
  if (!nextStage) return "—";
  const entered = rows.filter(({ job }) => job.salesStage === stage || (job.salesStageHistory || []).some((entry) => entry.stage === stage));
  if (!entered.length) return "—";
  const advanced = entered.filter(({ job }) => job.salesStage === nextStage || (job.salesStageHistory || []).some((entry) => entry.stage === nextStage)).length;
  return `${Math.round((advanced / entered.length) * 100)}%`;
}

function pipelineOpportunityCard(row, stages) {
  const { contact, job, key } = row;
  const days = pipelineDaysInStage(contact, job);
  const target = pipelineStageTargetDays(job.salesStage);
  const ageingClass = days > target * 2 ? "is-overdue" : days > target ? "is-ageing" : "";
  const task = pipelineNextTask(contact, job);
  const checklist = pipelineChecklist(contact, job);
  const value = number(job.contractValue ?? job.value ?? contact.value);
  const draggable = canAction("manageJobs");
  return `
    <article class="sales-pipeline-card ${ageingClass}" data-pipeline-card="${escapeHtml(key)}" draggable="${draggable}">
      <button class="sales-pipeline-card-main" type="button" data-pipeline-open="${escapeHtml(key)}">
        <span class="sales-pipeline-card-heading"><strong>${escapeHtml(contact.name)}</strong><span>${escapeHtml(job.name)}</span></span>
        <span class="sales-pipeline-card-service">${escapeHtml(activeServices(job.division).find((service) => service.id === job.service)?.name || job.service || "Service not selected")}</span>
        <span class="sales-pipeline-card-value">${money.format(value)}</span>
        <span class="sales-pipeline-card-meta"><span>${escapeHtml(job.salesRep || contact.salesRep || "Unassigned")}</span><span class="pipeline-age ${ageingClass}">${days}d in stage</span></span>
        <span class="sales-pipeline-next-action">${task ? `Next: ${escapeHtml(task.title)} · ${escapeHtml(formatDateTime(task.dueAt))}` : "No next follow-up scheduled"}</span>
        <span class="sales-pipeline-badges">
          ${job.activeLeak || contact.activeLeak ? '<em class="pipeline-badge emergency">Active leak</em>' : ""}
          ${job.insuranceClaim || contact.insuranceClaim ? '<em class="pipeline-badge insurance">Insurance</em>' : ""}
          ${["commercial", "hoa"].includes(job.propertyType) ? `<em class="pipeline-badge account">${escapeHtml(job.propertyType.toUpperCase())}</em>` : ""}
          ${checklist.missing?.length ? `<em class="pipeline-badge missing">${checklist.missing.length} requirement${checklist.missing.length === 1 ? "" : "s"} missing</em>` : ""}
        </span>
      </button>
    </article>`;
}

function pipelineSidePanel(row, stages) {
  if (!row) return "";
  const { contact, job } = row;
  const task = pipelineNextTask(contact, job);
  const checklist = pipelineChecklist(contact, job);
  const estimates = visibleEstimates().filter((estimate) => estimate.contactId === contact.id && (!estimate.jobId || estimate.jobId === job.id));
  const documents = (contact.documents || []).filter((document) => !document.jobId || document.jobId === job.id);
  const updates = (contact.updates || []).filter((update) => !update.jobId || update.jobId === job.id).slice(0, 5);
  const currentIndex = stages.indexOf(job.salesStage);
  const nextStage = stages[currentIndex + 1] || "";
  return `
    <aside class="pipeline-detail-drawer" aria-label="Opportunity details" data-pipeline-drawer>
      <header>
        <div><p class="eyebrow">${escapeHtml(job.salesStage)}</p><h2>${escapeHtml(contact.name)}</h2><span>${escapeHtml(job.name)}</span></div>
        <button class="icon-button" type="button" data-pipeline-close aria-label="Close opportunity details">&times;</button>
      </header>
      <div class="pipeline-detail-actions">
        ${contact.phone ? `<a class="secondary-button" href="tel:${escapeHtml(contact.phone.replace(/\D/g, ""))}"><span data-icon="phone"></span> Call</a>` : ""}
        ${contact.email ? `<a class="secondary-button" href="mailto:${escapeHtml(contact.email)}"><span data-icon="mail"></span> Email</a>` : ""}
        <button class="primary-button" type="button" data-action="open-contact-tab" data-contact-id="${contact.id}" data-job-id="${job.id}" data-tab="conversation"><span data-icon="message"></span> Note</button>
      </div>
      <section class="pipeline-detail-section"><h3>Next action</h3>${task ? `<strong>${escapeHtml(task.title)}</strong><p>${escapeHtml(formatDateTime(task.dueAt))} · ${escapeHtml(task.rep || job.salesRep || "Unassigned")}</p>` : '<p class="pipeline-detail-empty">No follow-up is scheduled.</p>'}<button class="link-button" type="button" data-view="tasks">Open tasks</button></section>
      <section class="pipeline-detail-section"><div class="pipeline-detail-section-title"><h3>Stage checklist</h3><span>${checklist.completed}/${checklist.total}</span></div>${checklist.items.length ? checklist.items.map((item) => `<label class="pipeline-check-item ${item.complete ? "complete" : ""}"><input type="checkbox" data-pipeline-checklist data-contact-id="${contact.id}" data-job-id="${job.id}" data-stage="${escapeHtml(checklist.stage)}" data-item-id="${escapeHtml(item.id)}" ${item.complete ? "checked" : ""} ${item.mode === "auto" || !canAction("manageJobs") ? "disabled" : ""}/><span>${escapeHtml(item.label)}</span>${item.mode === "auto" ? "<small>System verified</small>" : ""}</label>`).join("") : '<p class="pipeline-detail-empty">No checklist is configured for this stage.</p>'}</section>
      <section class="pipeline-detail-section"><h3>Notes and conversations</h3><p>${escapeHtml(job.notes || contact.notes || "No notes saved yet.")}</p><button class="link-button" type="button" data-action="open-contact-tab" data-contact-id="${contact.id}" data-job-id="${job.id}" data-tab="conversation">Open conversation</button></section>
      <section class="pipeline-detail-grid"><div><span>Estimate</span><strong>${estimates.length ? `${escapeHtml(estimates[0].status || "Draft")} · ${money.format(totalsFor(estimates[0]).total)}` : "None"}</strong></div><div><span>Documents</span><strong>${documents.length}</strong></div><div><span>Days in stage</span><strong>${pipelineDaysInStage(contact, job)}</strong></div><div><span>Opportunity value</span><strong>${money.format(number(job.contractValue ?? job.value ?? contact.value))}</strong></div></section>
      <section class="pipeline-detail-section"><h3>Recent activity</h3>${updates.length ? updates.map((update) => `<div class="pipeline-activity-row"><strong>${escapeHtml(update.message || update.status || "Update")}</strong><span>${escapeHtml(formatDateTime(update.createdAt))}</span></div>`).join("") : '<p class="pipeline-detail-empty">No activity recorded yet.</p>'}</section>
      <footer>
        <button class="secondary-button" type="button" data-action="open-contact" data-contact-id="${contact.id}">Open full lead</button>
        ${nextStage ? `<button class="primary-button" type="button" data-pipeline-move="${escapeHtml(nextStage)}" data-contact-id="${contact.id}" data-job-id="${job.id}">Move to ${escapeHtml(nextStage)}</button>` : ""}
      </footer>
    </aside>`;
}

function renderPipeline() {
  if (!els.views.pipeline || !els.pipelineBoard) return;
  const division = activeDivisions().some((item) => item.id === state.pipelineDivision) ? state.pipelineDivision : "roofing";
  state.pipelineDivision = division;
  const accountFilter = state.pipelinePropertyType;
  const allRows = pipelineOpportunityRows(division).map((row) => ({
    ...row,
    job: { ...row.job, salesStage: normalizeSalesStage(row.job, row.contact, division, row.job.propertyType) },
  }));
  const stages = pipelineBoardStages(division, accountFilter, allRows);
  const rows = pipelineFilteredRows().map((row) => ({
    ...row,
    job: { ...row.job, salesStage: normalizeSalesStage(row.job, row.contact, division, row.job.propertyType) },
  }));
  const activeRows = rows.filter(({ job }) => !["Lost", stages.at(-1)].includes(job.salesStage));
  const pipelineValue = activeRows.reduce((sum, { contact, job }) => sum + number(job.contractValue ?? job.value ?? contact.value), 0);
  const weightedForecast = activeRows.reduce((sum, { contact, job }) => sum + number(job.contractValue ?? job.value ?? contact.value) * pipelineStageWeight(job.salesStage, stages), 0);
  const cycleRows = rows.filter(({ job }) => job.salesStage === stages.at(-1));
  const cyclePopulation = cycleRows.length ? cycleRows : activeRows;
  const averageCycleDays = cyclePopulation.length
    ? Math.round(cyclePopulation.reduce((sum, { contact, job }) => {
        const started = localTimestamp(job.createdAt || contact.createdAt) || Date.now();
        const ended = job.salesStage === stages.at(-1) ? pipelineStageEnteredTimestamp(contact, job) : Date.now();
        return sum + Math.max(0, (ended - started) / 86400000);
      }, 0) / cyclePopulation.length)
    : 0;
  const reps = [...new Set(allRows.map(({ contact, job }) => job.salesRep || contact.salesRep || "Unassigned"))].sort();
  const sources = [...new Set(allRows.map(({ contact }) => contact.source || "No source"))].sort();
  const services = activeServices(division);
  // "Needs attention" counts follow the same filters as the board (everything
  // except the attention filter itself), so a count and its column agree.
  const attentionBaseRows = pipelineFilteredRows({ ignoreAttention: true });
  const attentionRows = attentionBaseRows.map((row) => ({ row, attention: pipelineRowAttention(row) }));
  const attentionDefinitions = [
    ["unassigned", "Unassigned website requests"], ["uncontacted", "New leads not contacted"], ["overdue", "Overdue follow-ups"],
    ["inactive", `Inactive ${state.pipelineStaleDays}+ days`], ["noDecision", "Estimates without decision date"], ["stuck", "Stuck beyond stage target"],
  ];
  const selectedRow = rows.find((row) => row.key === state.pipelineSelectedOpportunity) || allRows.find((row) => row.key === state.pipelineSelectedOpportunity);
  const callFormDraft = pipelineCallFormDraft();

  els.pipelineBoard.innerHTML = `
    <section class="sales-pipeline-shell">
      <header class="sales-pipeline-header">
        <div><p class="eyebrow">Live sales command center</p><h2>Sales Pipeline</h2><p>Move qualified opportunities forward without mixing sales work with production delivery.</p></div>
        <div class="sales-pipeline-division-tabs" role="tablist" aria-label="Pipeline division">${activeDivisions().map((item) => `<button type="button" role="tab" data-pipeline-division-tab="${item.id}" aria-selected="${item.id === division}">${escapeHtml(item.name)}</button>`).join("")}</div>
      </header>
      <div class="sales-pipeline-filters">
        <label>Account type<select data-pipeline-control="pipelinePropertyType"><option value="all">All accounts</option><option value="residential" ${accountFilter === "residential" ? "selected" : ""}>Residential</option><option value="commercial" ${accountFilter === "commercial" ? "selected" : ""}>Commercial</option><option value="hoa" ${accountFilter === "hoa" ? "selected" : ""}>HOA / Association</option></select></label>
        <label>Sales rep<select data-pipeline-control="pipelineRep">${pipelineOptionMarkup(reps, state.pipelineRep, "All representatives")}</select></label>
        <label>Service<select data-pipeline-control="pipelineService"><option value="all">All services</option>${services.map((service) => `<option value="${escapeHtml(service.id)}" ${service.id === state.pipelineService ? "selected" : ""}>${escapeHtml(service.name)}</option>`).join("")}</select></label>
        <label>Source<select data-pipeline-control="pipelineSource">${pipelineOptionMarkup(sources, state.pipelineSource, "All sources")}</select></label>
        <label>Urgency<select data-pipeline-control="pipelineUrgency"><option value="all">All urgency</option><option value="normal" ${state.pipelineUrgency === "normal" ? "selected" : ""}>Normal</option><option value="priority" ${state.pipelineUrgency === "priority" ? "selected" : ""}>Priority</option><option value="emergency" ${state.pipelineUrgency === "emergency" ? "selected" : ""}>Emergency</option></select></label>
        <label>Created<select data-pipeline-control="pipelineDateRange"><option value="all">All dates</option><option value="30" ${state.pipelineDateRange === "30" ? "selected" : ""}>Last 30 days</option><option value="90" ${state.pipelineDateRange === "90" ? "selected" : ""}>Last 90 days</option><option value="365" ${state.pipelineDateRange === "365" ? "selected" : ""}>Last year</option></select></label>
      </div>
      <div class="sales-pipeline-metrics">
        <article><span>Active opportunities</span><strong>${activeRows.length}</strong><small>Currently moving toward a decision</small></article>
        <article><span>Total pipeline value</span><strong>${money.format(pipelineValue)}</strong><small>Open opportunity value</small></article>
        <article><span>Weighted forecast</span><strong>${money.format(weightedForecast)}</strong><small>Stage-probability forecast</small></article>
        <article><span>Average sales cycle</span><strong>${averageCycleDays} days</strong><small>Created through current or handoff</small></article>
      </div>
      <section class="pipeline-attention-strip" aria-label="Opportunities needing attention">
        <div class="pipeline-attention-title"><span data-icon="alert-triangle"></span><div><strong>Needs attention</strong><label>Inactive after <input type="number" min="1" max="90" value="${state.pipelineStaleDays}" data-pipeline-stale-days/> days</label></div></div>
        <div class="pipeline-attention-items"><button type="button" data-pipeline-attention="all" class="${state.pipelineAttention === "all" ? "active" : ""}"><strong>${attentionBaseRows.length}</strong><span>All opportunities</span></button>${attentionDefinitions.map(([key, label]) => `<button type="button" data-pipeline-attention="${key}" class="${state.pipelineAttention === key ? "active" : ""}"><strong>${attentionRows.filter((item) => item.attention[key]).length}</strong><span>${escapeHtml(label)}</span></button>`).join("")}</div>
      </section>${pipelineWorklistMarkup()}
      <section class="sales-pipeline-board-wrap" aria-label="Sales opportunity board">
        <div class="sales-pipeline-board" style="--pipeline-columns:${stages.length}">${stages.map((stage, index) => {
          const stageRows = rows.filter(({ job }) => job.salesStage === stage);
          const stageValue = stageRows.reduce((sum, { contact, job }) => sum + number(job.contractValue ?? job.value ?? contact.value), 0);
          const guideOpen = state.pipelineGuidanceStage === stage;
          return `<section class="sales-pipeline-column" data-pipeline-drop-stage="${escapeHtml(stage)}">
            <header><div><span>Stage ${index + 1}</span><strong>${escapeHtml(stage)}</strong></div><em>${stageRows.length}</em><p>${money.format(stageValue)} · ${pipelineConversionRate(allRows, stage, stages[index + 1])} to next</p><button type="button" data-pipeline-guidance="${escapeHtml(stage)}" aria-expanded="${guideOpen}">${guideOpen ? "Hide" : "Show"} stage guidance</button>${guideOpen ? `<aside><strong>Ready to advance when</strong><p>Required records and checklist items are complete, the next action is scheduled, and the customer knows what happens next.</p></aside>` : ""}</header>
            <div class="sales-pipeline-column-cards">${stageRows.length ? stageRows.sort((left, right) => pipelineDaysInStage(right.contact, right.job) - pipelineDaysInStage(left.contact, left.job)).map((row) => pipelineOpportunityCard(row, stages)).join("") : '<div class="sales-pipeline-empty">Drop an opportunity here</div>'}</div>
          </section>`;
        }).join("")}<section class="sales-pipeline-column is-lost" data-pipeline-drop-stage="Lost"><header><div><span>Closed</span><strong>Lost</strong></div><em>${rows.filter(({ job }) => job.salesStage === "Lost").length}</em><p>Excluded from forecast</p></header><div class="sales-pipeline-column-cards">${rows.filter(({ job }) => job.salesStage === "Lost").map((row) => pipelineOpportunityCard(row, stages)).join("") || '<div class="sales-pipeline-empty">No lost opportunities</div>'}</div></section></div>
      </section>
    </section>
    ${pipelineSidePanel(selectedRow, selectedRow ? salesPipelineStagesFor(division, selectedRow.job.propertyType) : stages)}
    ${selectedRow ? '<button class="pipeline-drawer-backdrop" type="button" data-pipeline-close aria-label="Close opportunity details"></button>' : ""}`;
  // The top bar sits in a higher layer than the board and covered the
  // drawer's title and close button; step it back while the drawer is open.
  document.body?.classList?.toggle("pipeline-drawer-open", Boolean(selectedRow));
  hydrateIcons(els.pipelineBoard);
  restorePipelineCallFormDraft(callFormDraft);
}

async function movePipelineOpportunity(contactId, jobId, targetStage) {
  if (!requireAction("manageJobs")) return false;
  const contact = getContact(contactId);
  const job = contactJobs(contact).find((item) => item.id === jobId);
  if (!contact || !job) return false;
  const division = job.division || contact.division || "roofing";
  const stages = salesPipelineStagesFor(division, job.propertyType || contact.propertyType);
  const currentStage = normalizeSalesStage(job, contact, division, job.propertyType);
  if (targetStage === currentStage) return true;
  const currentIndex = stages.indexOf(currentStage);
  const targetIndex = stages.indexOf(targetStage);
  if (targetStage !== "Lost") {
    if (targetIndex < 0) {
      // A refused drop used to do nothing at all; say why.
      showToast(commercialApprovalStages.includes(targetStage)
        ? `${targetStage} applies to commercial and HOA accounts only. The next stage for this opportunity is ${stages[currentIndex + 1] || currentStage}.`
        : `${targetStage} is not a stage in this opportunity's pipeline.`);
      return false;
    }
    if (targetIndex < currentIndex && !canManageTeamData()) {
      showToast("Ask a manager to move this opportunity back to an earlier stage.");
      return false;
    }
    if (targetIndex > currentIndex + 1) {
      showToast(`Move this opportunity one stage at a time. The next stage is ${stages[currentIndex + 1] || currentStage}.`);
      return false;
    }
  }

  const nextLifecycleStatus = pipelineLifecycleStatusFor(division, targetStage, job.status);
  if (targetIndex === currentIndex + 1 && nextLifecycleStatus === job.status) {
    // Both columns belong to one production stage. Only the items that belong
    // to the column being left are required here; the production stage's full
    // checklist is enforced below when a move changes that stage. (Requiring
    // the whole checklist asked for an estimate before an inspection could be
    // marked complete.)
    const requiredIds = salesStageExitRequirements[division]?.[currentStage] || [];
    const missing = pipelineChecklist(contact, job).items.filter((item) => requiredIds.includes(item.id) && !item.complete);
    if (missing.length) {
      state.pipelineSelectedOpportunity = pipelineOpportunityKey(contactId, jobId);
      saveUiState();
      renderPipeline();
      showToast(`Complete before moving to ${targetStage}: ${missing.map((item) => item.label).join(", ")}.`);
      return false;
    }
  }
  if (nextLifecycleStatus !== job.status) {
    const transition = window.RooflineWorkflowChecklist?.transitionCheck?.(contact, job, nextLifecycleStatus);
    if (transition && !transition.allowed) {
      state.pipelineSelectedOpportunity = pipelineOpportunityKey(contactId, jobId);
      saveUiState();
      renderPipeline();
      showToast(transition.reason || "Complete the stage checklist before moving this opportunity.");
      return false;
    }
  }

  const priorContact = JSON.parse(JSON.stringify(contact));
  const now = new Date().toISOString();
  const history = [...(job.salesStageHistory || [])];
  if (history.length && !history.at(-1).exitedAt) history[history.length - 1] = { ...history.at(-1), exitedAt: now };
  history.push({ stage: targetStage, enteredAt: now, exitedAt: "", actor: state.currentUser.name || currentOwner().name });
  const updateId = uid("update");
  updateContact(contactId, (current) => {
    const nextJobs = contactJobs(current).map((item) => item.id === jobId ? {
      ...item,
      status: nextLifecycleStatus,
      salesStage: targetStage,
      salesStageEnteredAt: now,
      salesStageHistory: history,
      closedDate: targetStage === "Contract & Deposit" ? item.closedDate || todayISO() : item.closedDate,
      updatedAt: now,
    } : item);
    const primary = nextJobs[0];
    return {
      ...current,
      jobs: nextJobs,
      status: primary?.status || current.status,
      type: ["Contract & Deposit", "Production Handoff", "Approved", "Operations Handoff"].includes(targetStage) ? "Customer" : current.type,
      closedDate: targetStage === "Contract & Deposit" ? current.closedDate || todayISO() : current.closedDate,
      updates: [{ id: updateId, author: state.currentUser.name || currentOwner().name, status: nextLifecycleStatus, jobId, message: `Sales pipeline moved from ${currentStage} to ${targetStage}.`, createdAt: now }, ...(current.updates || [])],
    };
  });
  state.pipelineSelectedOpportunity = pipelineOpportunityKey(contactId, jobId);
  saveState({ localOnly: true });
  renderPipeline();

  if (!canUseCloudSync()) {
    showToast(`Moved to ${targetStage}.`);
    return true;
  }
  let saved = false;
  try {
    saved = await persistLeadJobRecord(jobId, updateId);
  } catch (error) {
    console.warn("Pipeline stage could not be saved", error);
  }
  if (!saved) {
    state.contacts = state.contacts.map((item) => item.id === contactId ? normalizeContact(priorContact, state.company.documentCategories) : item);
    saveState({ localOnly: true });
    renderPipeline();
    showToast("The stage change was not confirmed and has been restored. Try again.");
    return false;
  }
  queueCloudSave();
  showToast(`Moved to ${targetStage}.`);
  void afterJobStageChange(contactId, jobId, job.status, nextLifecycleStatus);
  return true;
}

