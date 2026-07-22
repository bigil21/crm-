(() => {
  const panelId = "productionFlowCheckPanel";
  const results = [];

  function add(status, name, detail) {
    results.push({ status, name, detail });
    renderPanel();
  }

  function appReady() {
    try {
      return Boolean(state && els && window.RooflineProductionFlow && typeof render === "function");
    } catch {
      return false;
    }
  }

  function renderPanel() {
    let panel = document.getElementById(panelId);
    if (!panel) {
      panel = document.createElement("section");
      panel.id = panelId;
      panel.style.cssText = [
        "position:fixed",
        "right:18px",
        "bottom:18px",
        "z-index:99999",
        "width:min(460px,calc(100vw - 36px))",
        "max-height:70vh",
        "overflow:auto",
        "background:#fff",
        "border:1px solid #cbd5e1",
        "box-shadow:0 20px 50px rgba(15,23,42,.22)",
        "border-radius:10px",
        "padding:14px",
        "font:13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif",
        "color:#0f172a",
      ].join(";");
      document.body.appendChild(panel);
    }
    const counts = results.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {});
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px">
        <strong>Production Flow Check</strong>
        <button type="button" data-close-production-check style="border:0;background:#f1f5f9;border-radius:6px;padding:5px 8px;cursor:pointer">Close</button>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <span>Pass: ${counts.pass || 0}</span>
        <span>Warn: ${counts.warn || 0}</span>
        <span>Fail: ${counts.fail || 0}</span>
      </div>
      <div style="display:grid;gap:8px">
        ${results
          .map((item) => {
            const color = item.status === "pass" ? "#15803d" : item.status === "fail" ? "#b91c1c" : "#a16207";
            return `<article style="border-left:4px solid ${color};background:#f8fafc;border-radius:6px;padding:8px"><strong>${item.name}</strong><br><span>${item.detail}</span></article>`;
          })
          .join("")}
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button type="button" data-run-production-check style="border:0;background:#111827;color:white;border-radius:6px;padding:7px 10px;cursor:pointer">Run Again</button>
        <button type="button" data-copy-production-check style="border:1px solid #cbd5e1;background:white;border-radius:6px;padding:7px 10px;cursor:pointer">Copy Results</button>
      </div>
    `;
    panel.querySelector("[data-close-production-check]")?.addEventListener("click", () => panel.remove());
    panel.querySelector("[data-run-production-check]")?.addEventListener("click", () => runProductionFlowCheck());
    panel.querySelector("[data-copy-production-check]")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
        add("pass", "Copy Results", "Diagnostics JSON copied to clipboard.");
      } catch {
        add("warn", "Copy Results", "Clipboard copy was blocked by the browser.");
      }
    });
  }

  function removeTemporaryRecords(token) {
    const beforeContacts = state.contacts.length;
    state.contacts = state.contacts.filter((contact) => contact.id !== token && !String(contact.name || "").includes(token));
    state.estimates = state.estimates.filter((estimate) => estimate.contactId !== token);
    return beforeContacts - state.contacts.length;
  }

  function assert(condition, name, passDetail, failDetail) {
    add(condition ? "pass" : "fail", name, condition ? passDetail : failDetail);
  }

  function runProductionFlowCheck() {
    results.splice(0, results.length);
    add("warn", "Diagnostics", "Starting production workflow check. A temporary QA lead will be created and deleted.");

    if (!appReady()) {
      add("fail", "CRM Load", "CRM or production flow script is not ready yet.");
      return;
    }

    const flow = window.RooflineProductionFlow;
    const expectedStatuses = [
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
    assert(
      expectedStatuses.every((status) => flow.statuses.includes(status)),
      "Status Definitions",
      "All production statuses are registered.",
      "One or more production statuses are missing.",
    );

    const selectValues = [...document.querySelectorAll('select[name="status"]')].flatMap((select) =>
      [...select.options].map((option) => option.value || option.textContent),
    );
    assert(
      expectedStatuses.every((status) => selectValues.includes(status)),
      "Status Dropdowns",
      "Contact, job, and note status dropdowns include the production stages.",
      "At least one status dropdown is missing a production stage.",
    );

    const token = `qa_production_${Date.now()}`;
    removeTemporaryRecords(token);
    const contact = normalizeContact({
      id: token,
      type: "Lead",
      status: "New",
      name: `QA Production Flow ${token}`,
      source: "QA",
      email: "qa-production@coastalcrestroofing.com",
      phone: "555-0100",
      address: "100 QA Production Way",
      value: 12345,
      salesRep: state.currentUser.name || "QA Rep",
      lastContact: todayISO(),
      closedDate: "",
      notes: "Temporary production workflow test record.",
      createdAt: todayISO(),
      jobs: [
        {
          id: `${token}_job`,
          name: "QA Production Roof Replacement",
          status: "New",
          value: 12345,
          salesRep: state.currentUser.name || "QA Rep",
          lastContact: todayISO(),
          closedDate: "",
          address: "100 QA Production Way",
          notes: "Temporary production workflow test job.",
          createdAt: todayISO(),
        },
      ],
    });
    state.contacts.unshift(contact);
    saveState();
    render();
    add("pass", "Temporary Lead", `Created ${token}.`);

    const path = ["Contacted", "Inspection", "Estimate Sent", "Won", "Scheduled", "Materials Ordered", "In Progress", "Completed", "Paid"];
    path.forEach((status) => {
      applyStatusUpdate(token, status, "QA", `QA status moved to ${status}.`);
    });

    const updated = getContact(token);
    const job = contactJobs(updated)[0];
    assert(updated?.status === "Paid", "Status Advance", "Lead advanced through the full production path to Paid.", `Expected Paid, found ${updated?.status || "missing"}.`);
    assert(job?.status === "Paid", "Primary Job Status", "Primary job stayed in sync with the lead status.", `Expected Paid, found ${job?.status || "missing"}.`);
    assert(updated?.type === "Customer", "Customer Conversion", "Lead converts to Customer once sold.", `Expected Customer, found ${updated?.type || "missing"}.`);
    assert(Boolean(updated?.closedDate && job?.closedDate), "Closed Date", "Sold/paid record has closed-date tracking.", "Closed date was not set on the paid record.");

    const metrics = dashboardMetrics();
    assert(metrics.closedJobs >= 1 && metrics.closedValue >= 12345, "Dashboard Metrics", "Paid job is counted in closed jobs and closed job value.", "Paid job was not counted by dashboard metrics.");

    const removed = removeTemporaryRecords(token);
    saveState();
    render();
    add("pass", "Cleanup", `Removed ${removed} temporary contact(s).`);
  }

  window.runProductionFlowCheck = runProductionFlowCheck;

  const timer = window.setInterval(() => {
    if (!appReady()) return;
    window.clearInterval(timer);
    if (window.__ROOFLINE_PRODUCTION_FLOW_CHECK || new URLSearchParams(location.search).has("production-flow-check")) {
      runProductionFlowCheck();
    }
  }, 250);
  window.setTimeout(() => window.clearInterval(timer), 15000);
})();
