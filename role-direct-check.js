(() => {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("role-direct-check")) return;

  const upperFinancialEmails = ["gil@coastalcrestroofing.com", "devon@coastalcrestroofing.com"];
  const results = [];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function escapeText(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function appState() {
    try { return state; } catch { return null; }
  }

  function appContacts() {
    const current = appState();
    return Array.isArray(current?.contacts) ? current.contacts : [];
  }

  function roleValue() {
    try {
      if (typeof currentRole === "function") return currentRole();
    } catch {}
    return appState()?.currentUser?.role || "viewer";
  }

  function visible(node) {
    if (!node) return false;
    const styles = window.getComputedStyle(node);
    return !node.classList.contains("hidden") && styles.display !== "none" && styles.visibility !== "hidden";
  }

  function expectedCompanyView(role) {
    return role === "admin" || role === "office_manager";
  }

  function expectedTeamData(role) {
    return ["admin", "office_manager", "sales_manager", "operations_manager"].includes(role);
  }

  function expectedFinancials(role, email) {
    return role === "admin" || upperFinancialEmails.includes(String(email || "").toLowerCase());
  }

  function expectedEstimatesView(role) {
    return ["admin", "office_manager", "sales_manager", "sales", "viewer"].includes(role);
  }

  function expectedLeadsView(role) {
    return ["admin", "office_manager", "sales_manager", "sales", "viewer"].includes(role);
  }

  function add(status, name, detail) {
    results.push({ status, name, detail });
    renderPanel();
  }

  function expectBoolean(name, actual, expected, passDetail, failDetail) {
    add(actual === expected ? "pass" : "fail", name, actual === expected ? passDetail : failDetail);
  }

  function panelHtml() {
    const pass = results.filter((item) => item.status === "pass").length;
    const warn = results.filter((item) => item.status === "warn").length;
    const fail = results.filter((item) => item.status === "fail").length;
    return `
      <div class="direct-check-header">
        <div>
          <strong>Role Security Check</strong>
          <span>Runs inside the signed-in CRM page</span>
        </div>
        <button type="button" id="directCheckClose">Close</button>
      </div>
      <div class="direct-check-summary">
        <span><strong>${pass}</strong> Pass</span>
        <span><strong>${warn}</strong> Warn</span>
        <span><strong>${fail}</strong> Fail</span>
      </div>
      <div class="direct-check-actions">
        <button type="button" id="directCheckCopy">Copy JSON</button>
        <button type="button" id="directCheckRerun">Run Again</button>
      </div>
      <div class="direct-check-results">
        ${results.map((item) => `
          <article class="${item.status}">
            <strong>${escapeText(item.name)}</strong>
            <span>${escapeText(item.detail)}</span>
          </article>
        `).join("")}
      </div>
    `;
  }

  function renderPanel() {
    let panel = document.querySelector("#directRoleSecurityPanel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "directRoleSecurityPanel";
      panel.setAttribute("aria-live", "polite");
      document.body.appendChild(panel);
    }
    panel.innerHTML = panelHtml();
    panel.querySelector("#directCheckClose")?.addEventListener("click", () => panel.remove());
    panel.querySelector("#directCheckRerun")?.addEventListener("click", runCheck);
    panel.querySelector("#directCheckCopy")?.addEventListener("click", copyResults);
  }

  function installStyles() {
    if (document.querySelector("#directRoleSecurityStyles")) return;
    const style = document.createElement("style");
    style.id = "directRoleSecurityStyles";
    style.textContent = `
      #directRoleSecurityPanel {
        position: fixed;
        top: 18px;
        right: 18px;
        z-index: 99999;
        width: min(520px, calc(100vw - 24px));
        max-height: calc(100vh - 36px);
        overflow: auto;
        border: 1px solid #d9e2ef;
        border-radius: 10px;
        box-shadow: 0 22px 60px rgba(15, 23, 42, 0.25);
        background: #fff;
        color: #111827;
        font-family: Arial, Helvetica, sans-serif;
      }
      .direct-check-header {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        align-items: center;
        padding: 14px 16px;
        background: #0b1220;
        color: #fff;
      }
      .direct-check-header strong,
      .direct-check-header span { display: block; }
      .direct-check-header span { color: #cbd5e1; font-size: 12px; margin-top: 2px; }
      #directRoleSecurityPanel button {
        border: 0;
        border-radius: 7px;
        padding: 8px 10px;
        background: #0f5fe8;
        color: #fff;
        font-weight: 700;
        cursor: pointer;
      }
      .direct-check-header button { background: #334155; }
      .direct-check-summary,
      .direct-check-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        padding: 10px 16px;
        border-bottom: 1px solid #e2e8f0;
      }
      .direct-check-summary span {
        border: 1px solid #d9e2ef;
        border-radius: 7px;
        padding: 7px 9px;
        background: #f8fafc;
        font-size: 12px;
      }
      .direct-check-results { display: grid; gap: 8px; padding: 12px 16px 16px; }
      .direct-check-results article {
        border: 1px solid #d9e2ef;
        border-left-width: 5px;
        border-radius: 8px;
        padding: 9px 10px;
        background: #fff;
      }
      .direct-check-results article.pass { border-left-color: #15803d; }
      .direct-check-results article.warn { border-left-color: #b45309; }
      .direct-check-results article.fail { border-left-color: #b91c1c; }
      .direct-check-results strong { display: block; font-size: 13px; }
      .direct-check-results span { display: block; color: #64748b; font-size: 12px; margin-top: 3px; overflow-wrap: anywhere; }
    `;
    document.head.appendChild(style);
  }

  async function copyResults() {
    const payload = JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2);
    try {
      await navigator.clipboard.writeText(payload);
      add("pass", "Copy Results", "Diagnostics JSON copied to clipboard.");
    } catch {
      window.prompt("Copy diagnostics JSON", payload);
    }
  }

  async function waitForApp(timeoutMs = 15000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (document.querySelector("#globalSearch") && document.querySelector("#dashboardView") && appState()) {
        return true;
      }
      await sleep(250);
    }
    return false;
  }

  function parseJson(value) {
    try { return JSON.parse(value || "{}"); } catch { return {}; }
  }

  function readStorage(userId) {
    let activeKey = "roofline-crm-v1";
    try {
      if (typeof activeStorageKey === "function") activeKey = activeStorageKey();
    } catch {
      if (userId) activeKey = `roofline-crm-v1:${userId}`;
    }
    const active = parseJson(window.localStorage.getItem(activeKey));
    const crmKeys = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index) || "";
      if (key.startsWith("roofline-crm-v1")) crmKeys.push(key);
    }
    return { activeKey, active, crmKeys };
  }

  async function authSnapshot() {
    try {
      const trusted = await window.RooflineAuth?.getTrustedUser?.();
      if (trusted?.user) return trusted;
    } catch (error) {
      add("warn", "Authentication Snapshot", error.message || String(error));
    }
    const current = appState()?.currentUser || {};
    return {
      user: {
        id: "",
        email: current.email || "",
      },
      role: current.role || roleValue(),
    };
  }

  async function testRestrictedView(view, shouldAllow) {
    if (typeof setView !== "function") {
      add("fail", `Restricted View: ${view}`, "setView() is not available.");
      return;
    }
    setView(view);
    await sleep(500);
    const panelId = view === "companyDocuments" ? "companyDocumentsView" : `${view}View`;
    const isVisible = visible(document.querySelector(`#${panelId}`));
    expectBoolean(
      `Restricted View: ${view}`,
      isVisible,
      shouldAllow,
      shouldAllow ? `${panelId} is accessible as expected.` : `${panelId} stayed hidden as expected.`,
      shouldAllow ? `${panelId} should be accessible but was hidden.` : `${panelId} should be restricted but became visible.`,
    );
  }

  async function testProfitTab(canUseFinancials, contacts) {
    if (!contacts.length) {
      add("warn", "Profit/Cost Tab", "No contacts in this account, so use profit-role-test.html for the temporary-lead financial access test.");
      return;
    }
    if (typeof openLeadDetail !== "function") {
      add("fail", "Profit/Cost Tab", "openLeadDetail() is not available.");
      return;
    }
    openLeadDetail(contacts[0].id, "profit");
    await sleep(700);
    const tabVisible = visible(document.querySelector('[data-lead-tab="profit"]'));
    const panelVisible = visible(document.querySelector("#leadProfitPanel"));
    expectBoolean(
      "Profit/Cost Tab Visibility",
      tabVisible,
      canUseFinancials,
      canUseFinancials ? "Profit/cost tab is visible for this account." : "Profit/cost tab is hidden for this account.",
      canUseFinancials ? "Profit/cost tab should be visible but is hidden." : "Profit/cost tab should be hidden but is visible.",
    );
    if (!canUseFinancials) {
      expectBoolean(
        "Profit/Cost Panel Access",
        panelVisible,
        false,
        "Profit/cost panel did not open for restricted account.",
        "Profit/cost panel opened for restricted account.",
      );
    }
  }

  async function testSearchIsolation() {
    const canaryKey = "roofline-crm-v1:security-canary-user";
    const canaryName = "ZZ Forbidden Security Canary";
    const original = window.localStorage.getItem(canaryKey);
    try {
      window.localStorage.setItem(canaryKey, JSON.stringify({
        contacts: [{
          id: "security_canary_contact",
          type: "Lead",
          status: "New",
          name: canaryName,
          phone: "555-9999",
          email: "security-canary@example.com",
          address: "Hidden Address",
          salesRep: "Hidden Rep",
          jobs: [{ id: "security_canary_job", name: "Hidden Job", address: "Hidden Address", status: "New" }],
        }],
      }));
      if (typeof setView === "function") setView("dashboard");
      await sleep(500);
      const search = document.querySelector("#globalSearch");
      if (!search) {
        add("fail", "Dashboard Search Isolation", "Global search input was not found.");
        return;
      }
      search.value = "Forbidden Security Canary";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(1100);
      const leaked = Boolean(document.querySelector("#dashboardSearchResults")?.textContent?.includes(canaryName));
      expectBoolean(
        "Dashboard Search Isolation",
        leaked,
        false,
        "Dashboard search ignored a record stored under another user key.",
        "Dashboard search leaked a record from another user storage key.",
      );
    } finally {
      if (original === null) window.localStorage.removeItem(canaryKey);
      else window.localStorage.setItem(canaryKey, original);
      const current = appState();
      if (current) {
        current.search = "";
        try { if (typeof saveState === "function") saveState(); } catch {}
        try { if (typeof render === "function") render(); } catch {}
      }
    }
  }

  async function runCheck() {
    results.length = 0;
    add("warn", "Diagnostics", "Starting direct role/security check inside the signed-in CRM page. No real records will be created, edited, or deleted.");

    const ready = await waitForApp();
    if (!ready) {
      add("fail", "CRM Load", "The CRM did not finish loading within 15 seconds on this page.");
      return;
    }
    add("pass", "CRM Load", `Loaded ${window.location.pathname}${window.location.search}.`);

    const auth = await authSnapshot();
    const email = String(auth?.user?.email || appState()?.currentUser?.email || "").toLowerCase();
    const role = roleValue();
    add(email ? "pass" : "fail", "Signed-In User", email ? `${email} / role: ${role}` : "No signed-in user email was available.");

    const storage = readStorage(auth?.user?.id || "");
    const activeContacts = Array.isArray(storage.active.contacts) ? storage.active.contacts : appContacts();
    add("pass", "Active User Storage", `${storage.activeKey}; ${activeContacts.length} contact(s). CRM keys in this browser: ${storage.crmKeys.length}.`);

    if (typeof canView !== "function" || typeof canAction !== "function") {
      add("fail", "Permission Functions", "canView() or canAction() is not available.");
      return;
    }

    const shouldCompany = expectedCompanyView(role);
    const shouldTeam = expectedTeamData(role);
    const shouldFinancials = expectedFinancials(role, email);
    const shouldEstimates = expectedEstimatesView(role);
    const shouldLeads = expectedLeadsView(role);

    expectBoolean("Permission: Team Data", typeof canManageTeamData === "function" && canManageTeamData() === true, shouldTeam, `Team-data permission matches ${role}.`, `Team-data permission is incorrect for ${role}.`);
    expectBoolean("Permission: Job Financials", typeof canManageJobFinancials === "function" && canManageJobFinancials() === true, shouldFinancials, `Financial permission matches ${role}/${email}.`, `Financial permission is incorrect for ${role}/${email}.`);
    expectBoolean("Permission: Company Settings", canView("company") === true, shouldCompany, `Company settings visibility matches ${role}.`, `Company settings visibility is incorrect for ${role}.`);
    expectBoolean("Permission: Estimates View", canView("estimates") === true, shouldEstimates, `Estimate visibility matches ${role}.`, `Estimate visibility is incorrect for ${role}.`);
    expectBoolean("Permission: Leads View", canView("leads") === true, shouldLeads, `Lead visibility matches ${role}.`, `Lead visibility is incorrect for ${role}.`);
    expectBoolean("Permission: Manage Company Action", canAction("manageCompany") === true, role === "admin" || role === "office_manager", `Manage-company action matches ${role}.`, `Manage-company action is incorrect for ${role}.`);
    expectBoolean("Permission: Manage Financial Action", canAction("manageJobFinancials") === true, shouldFinancials, `Manage-financials action matches ${role}/${email}.`, `Manage-financials action is incorrect for ${role}/${email}.`);

    await testRestrictedView("company", shouldCompany);
    await testRestrictedView("estimates", shouldEstimates);
    await testProfitTab(shouldFinancials, activeContacts);
    await testSearchIsolation();
  }

  installStyles();
  renderPanel();
  window.addEventListener("load", () => setTimeout(runCheck, 500));
})();
