(() => {
  if (!window.__ROOFLINE_SYSTEM_CHECK && !new URLSearchParams(location.search).has("system-check")) return;

  const results = [];
  const created = { contactId: "", estimateId: "" };
  const upperAdminEmails = ["gil@coastalcrestroofing.com", "devon@coastalcrestroofing.com"];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function escapeText(value = "") {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    })[char]);
  }

  function appState() {
    try { return state; } catch { return window.state || null; }
  }

  function roleValue() {
    try { return currentRole(); } catch {}
    return appState()?.currentUser?.role || "viewer";
  }

  function emailValue() {
    try { return currentUserEmail(); } catch {}
    return String(appState()?.currentUser?.email || "").toLowerCase();
  }

  function canViewValue(view) {
    try { return canView(view) === true; } catch { return false; }
  }

  function canActionValue(action) {
    try { return canAction(action) === true; } catch { return false; }
  }

  function teamDataValue() {
    try { return canManageTeamData() === true; } catch { return false; }
  }

  function financialsValue() {
    try { return canManageJobFinancials() === true; } catch { return false; }
  }

  function setViewValue(view) {
    try { setView(view); return true; } catch {}
    const current = appState();
    if (!current) return false;
    current.view = view;
    try { render(); } catch {}
    return true;
  }

  function visible(node) {
    if (!node) return false;
    const styles = getComputedStyle(node);
    return !node.classList.contains("hidden") && styles.display !== "none" && styles.visibility !== "hidden";
  }

  function add(status, name, detail) {
    results.push({ status, name, detail });
    renderPanel();
  }

  function expectBoolean(name, actual, expected, passDetail, failDetail) {
    add(actual === expected ? "pass" : "fail", name, actual === expected ? passDetail : failDetail);
  }

  function payload() {
    return JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2);
  }

  function renderPanel() {
    let panel = document.querySelector("#systemCheckPanel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "systemCheckPanel";
      document.body.appendChild(panel);
    }
    const pass = results.filter((item) => item.status === "pass").length;
    const warn = results.filter((item) => item.status === "warn").length;
    const fail = results.filter((item) => item.status === "fail").length;
    panel.innerHTML = `
      <div class="system-check-header">
        <div><strong>CRM System Check</strong><span>Upper-admin permissions, live AI, and estimate PDF smoke test</span></div>
        <button type="button" id="systemCheckClose">Close</button>
      </div>
      <div class="system-check-summary">
        <span><strong>${pass}</strong> Pass</span>
        <span><strong>${warn}</strong> Warn</span>
        <span><strong>${fail}</strong> Fail</span>
      </div>
      <div class="system-check-actions">
        <button type="button" id="systemCheckRunAll">Run All</button>
        <button type="button" id="systemCheckUpperAdmin">Upper Admin</button>
        <button type="button" id="systemCheckAi">AI</button>
        <button type="button" id="systemCheckPdf">PDF</button>
        <button type="button" id="systemCheckCopy">Copy JSON</button>
      </div>
      <div class="system-check-results">
        ${results.map((item) => `<article class="${item.status}"><strong>${escapeText(item.name)}</strong><span>${escapeText(item.detail)}</span></article>`).join("")}
      </div>
      <textarea id="systemCheckJson" readonly>${escapeText(payload())}</textarea>
    `;
    panel.querySelector("#systemCheckClose")?.addEventListener("click", () => panel.remove());
    panel.querySelector("#systemCheckRunAll")?.addEventListener("click", runAllChecks);
    panel.querySelector("#systemCheckUpperAdmin")?.addEventListener("click", async () => { results.length = 0; await runUpperAdminCheck(); });
    panel.querySelector("#systemCheckAi")?.addEventListener("click", async () => { results.length = 0; await runAiCheck(); });
    panel.querySelector("#systemCheckPdf")?.addEventListener("click", async () => { results.length = 0; await runPdfCheck(); });
    panel.querySelector("#systemCheckCopy")?.addEventListener("click", copyResults);
  }

  function installStyles() {
    if (document.querySelector("#systemCheckStyles")) return;
    const style = document.createElement("style");
    style.id = "systemCheckStyles";
    style.textContent = `
      #systemCheckPanel{position:fixed;top:18px;right:18px;z-index:99999;width:min(620px,calc(100vw - 24px));max-height:calc(100vh - 36px);overflow:auto;border:1px solid #d9e2ef;border-radius:10px;box-shadow:0 22px 60px rgba(15,23,42,.25);background:#fff;color:#111827;font-family:Arial,Helvetica,sans-serif}
      .system-check-header{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 16px;background:#0b1220;color:#fff}.system-check-header strong,.system-check-header span{display:block}.system-check-header span{color:#cbd5e1;font-size:12px;margin-top:2px}
      #systemCheckPanel button{border:0;border-radius:7px;padding:8px 10px;background:#0f5fe8;color:#fff;font-weight:700;cursor:pointer}.system-check-header button{background:#334155}
      .system-check-summary,.system-check-actions{display:flex;gap:8px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid #e2e8f0}.system-check-summary span{border:1px solid #d9e2ef;border-radius:7px;padding:7px 9px;background:#f8fafc;font-size:12px}
      .system-check-results{display:grid;gap:8px;padding:12px 16px}.system-check-results article{border:1px solid #d9e2ef;border-left-width:5px;border-radius:8px;padding:9px 10px;background:#fff}.system-check-results article.pass{border-left-color:#15803d}.system-check-results article.warn{border-left-color:#b45309}.system-check-results article.fail{border-left-color:#b91c1c}.system-check-results strong{display:block;font-size:13px}.system-check-results span{display:block;color:#64748b;font-size:12px;margin-top:3px;overflow-wrap:anywhere}
      #systemCheckJson{width:calc(100% - 32px);height:150px;margin:0 16px 16px;padding:10px;border:1px solid #d9e2ef;border-radius:8px;background:#0b1220;color:#e2e8f0;font-size:11px;font-family:Consolas,monospace;resize:vertical}
    `;
    document.head.appendChild(style);
  }

  async function copyResults() {
    const text = payload();
    const box = document.querySelector("#systemCheckJson");
    if (box) { box.value = text; box.focus(); box.select(); }
    try {
      await navigator.clipboard.writeText(text);
      add("pass", "Copy Results", "Diagnostics JSON copied to clipboard.");
    } catch {
      add("warn", "Copy Results", "Clipboard was blocked. The JSON is visible in the text box at the bottom of this panel.");
    }
  }

  async function waitForApp(timeoutMs = 18000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (document.querySelector("#globalSearch") && document.querySelector("#dashboardView") && appState()) return true;
      await sleep(250);
    }
    return false;
  }

  async function authSnapshot() {
    try {
      const trusted = await window.RooflineAuth?.getTrustedUser?.();
      if (trusted?.user) return trusted;
    } catch (error) {
      add("warn", "Authentication Snapshot", error.message || String(error));
    }
    const current = appState()?.currentUser || {};
    return { user: { id: "", email: current.email || emailValue() }, role: current.role || roleValue() };
  }

  async function runUpperAdminCheck() {
    add("warn", "Diagnostics", "Starting upper-admin permissions check. No records will be created, edited, or deleted.");
    if (!(await waitForApp())) {
      add("fail", "CRM Load", "The CRM did not finish loading within 18 seconds.");
      return;
    }
    add("pass", "CRM Load", `Loaded ${location.pathname}${location.search}.`);

    const auth = await authSnapshot();
    const email = String(auth?.user?.email || emailValue() || "").toLowerCase();
    const role = roleValue();
    const isUpperAdmin = upperAdminEmails.includes(email) || role === "admin";
    add(email ? "pass" : "fail", "Signed-In User", email ? `${email} / role: ${role}` : "No signed-in user email was available.");

    if (!isUpperAdmin) {
      add("warn", "Upper Admin Account", `This is not Gil or Devon. Sign in as gil@coastalcrestroofing.com or devon@coastalcrestroofing.com to verify owner-level access.`);
      return;
    }

    expectBoolean("Permission: Team Data", teamDataValue(), true, "Upper admin can see team data.", "Upper admin cannot see team data.");
    expectBoolean("Permission: Job Financials", financialsValue(), true, "Upper admin can access job financials.", "Upper admin cannot access job financials.");
    expectBoolean("Permission: Company Settings", canViewValue("company"), true, "Upper admin can view settings.", "Upper admin cannot view settings.");
    expectBoolean("Permission: Estimates View", canViewValue("estimates"), true, "Upper admin can view estimates.", "Upper admin cannot view estimates.");
    expectBoolean("Permission: Leads View", canViewValue("leads"), true, "Upper admin can view leads.", "Upper admin cannot view leads.");
    expectBoolean("Action: Manage Company", canActionValue("manageCompany"), true, "Upper admin can manage company settings.", "Upper admin cannot manage company settings.");
    expectBoolean("Action: Manage Contacts", canActionValue("manageContacts"), true, "Upper admin can manage contacts.", "Upper admin cannot manage contacts.");
    expectBoolean("Action: Manage Estimates", canActionValue("manageEstimates"), true, "Upper admin can manage estimates.", "Upper admin cannot manage estimates.");

    setViewValue("company");
    await sleep(500);
    expectBoolean("Restricted View: company", visible(document.querySelector("#companyView")), true, "Settings view opens for upper admin.", "Settings view did not open for upper admin.");
    setViewValue("estimates");
    await sleep(500);
    expectBoolean("Restricted View: estimates", visible(document.querySelector("#estimatesView")), true, "Estimates view opens for upper admin.", "Estimates view did not open for upper admin.");
  }

  async function runAiCheck() {
    add("warn", "Diagnostics", "Starting AI assistant check. No CRM records will be changed.");
    if (!(await waitForApp())) {
      add("fail", "CRM Load", "The CRM did not finish loading within 18 seconds.");
      return;
    }
    add("pass", "CRM Load", `Loaded ${location.pathname}${location.search}.`);

    let mathReply = "";
    try {
      if (typeof assistantMathAnswer === "function") mathReply = assistantMathAnswer("What is 1500 x 25?");
      if (!mathReply && typeof assistantRespond === "function") mathReply = await assistantRespond("What is 1500 x 25?");
    } catch (error) {
      add("fail", "AI Local Math", error.message || String(error));
    }
    expectBoolean("AI Local Math", /37,?500/.test(mathReply), true, `Math answer returned: ${mathReply || "blank"}.`, `Math answer was incorrect or blank: ${mathReply || "blank"}.`);

    if (typeof assistantRealtimeAnswer !== "function") {
      add("fail", "AI Live Endpoint", "assistantRealtimeAnswer() is not available in the CRM.");
      return;
    }

    let liveReply = "";
    try {
      liveReply = await assistantRealtimeAnswer("Reply with only the numeric result of 17 * 19.");
    } catch (error) {
      add("fail", "AI Live Endpoint", error.message || String(error));
      return;
    }
    const normalized = String(liveReply || "").replace(/[^0-9.-]/g, "");
    expectBoolean("AI Live Endpoint", normalized.includes("323"), true, `Live AI answered correctly: ${String(liveReply).slice(0, 160)}.`, `Live AI did not answer correctly: ${String(liveReply).slice(0, 220)}.`);
  }

  function callRender() { try { render(); } catch {} }
  function callSaveState(options) { try { saveState(options); } catch {} }
  function todaySafe() { try { return todayISO(); } catch { return new Date().toISOString().slice(0, 10); } }
  function addDaysSafe(days) {
    try { return addDaysISO(days); } catch {
      const date = new Date();
      date.setDate(date.getDate() + days);
      return date.toISOString().slice(0, 10);
    }
  }
  function uidSafe(prefix) {
    try { return uid(prefix); } catch { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`; }
  }
  function ownerSafe() {
    try { return currentOwner(); } catch { return { userId: "", email: emailValue(), name: "CRM User", role: roleValue() }; }
  }
  function normalizeContactSafe(contact) { try { return normalizeContact(contact); } catch { return contact; } }
  function normalizeJobSafe(job, contact) { try { return normalizeJob(job, contact); } catch { return job; } }
  function withOwnerSafe(record, owner) { try { return withOwner(record, owner); } catch { return { ...record, ownerUserId: owner.userId, ownerEmail: owner.email, ownerName: owner.name }; } }
  function getContactSafe(id) { try { return getContact(id); } catch { return appState()?.contacts?.find((contact) => contact.id === id); } }

  async function cleanupTempData() {
    const current = appState();
    if (!current) return;
    const beforeContacts = current.contacts.length;
    const beforeEstimates = current.estimates.length;
    current.contacts = current.contacts.filter((contact) => contact.id !== created.contactId && !String(contact.name || "").startsWith("QA System Check"));
    current.estimates = current.estimates.filter((estimate) => estimate.id !== created.estimateId && estimate.contactId !== created.contactId);
    if (current.selectedContactId === created.contactId) current.selectedContactId = current.contacts[0]?.id || null;
    if (current.selectedEstimateId === created.estimateId) current.selectedEstimateId = current.estimates[0]?.id || null;
    callSaveState();
    callRender();
    add("pass", "Cleanup", `Removed ${beforeContacts - current.contacts.length} temporary contact(s) and ${beforeEstimates - current.estimates.length} temporary estimate(s).`);
    await sleep(500);
  }

  async function createTemporaryEstimate() {
    const current = appState();
    const owner = ownerSafe();
    const contactId = uidSafe("qa_contact");
    const jobId = uidSafe("qa_job");
    const stamp = Date.now().toString(36);
    created.contactId = contactId;

    const contactBase = withOwnerSafe({
      id: contactId,
      type: "Lead",
      status: "New",
      name: `QA System Check ${stamp}`,
      source: "QA Test",
      email: `qa-${stamp}@coastalcrestroofing.com`,
      phone: "(555) 010-6262",
      address: "200 QA System Check Rd\nAustin, TX 78701",
      value: 14500,
      salesRep: owner.name || "QA User",
      lastContact: todaySafe(),
      closedDate: "",
      notes: "Temporary system-check lead. Safe to delete.",
      documents: [],
      updates: [],
      createdAt: todaySafe(),
    }, owner);

    const job = normalizeJobSafe(withOwnerSafe({
      id: jobId,
      name: "QA PDF Smoke Test Job",
      address: contactBase.address,
      status: "New",
      value: 14500,
      salesRep: contactBase.salesRep,
      lastContact: todaySafe(),
      closedDate: "",
      notes: "Temporary PDF smoke test job.",
      createdAt: todaySafe(),
    }, owner), contactBase);

    const contact = normalizeContactSafe({ ...contactBase, jobs: [job] });
    current.contacts.unshift(contact);
    current.selectedContactId = contactId;
    callSaveState();
    callRender();
    add("pass", "Create Lead", `Created temporary lead ${contact.name}.`);

    let estimate = null;
    try { estimate = createEstimate(contact.id, false, job.id); } catch (error) { throw new Error(`createEstimate failed: ${error.message || error}`); }
    if (!estimate) throw new Error("createEstimate returned no estimate.");
    created.estimateId = estimate.id;
    estimate.projectTitle = "QA PDF Smoke Test Estimate";
    estimate.projectManager = contact.salesRep;
    estimate.salesRepEmail = appState().currentUser.email || contact.email;
    estimate.salesRepPhone = "(555) 010-6262";
    estimate.issueDate = todaySafe();
    estimate.validUntil = addDaysSafe(14);
    estimate.scopeSummary = "QA PDF smoke test scope with enough description to verify text wrapping and estimate document generation.";
    estimate.taxRate = 0;
    estimate.deposit = 500;
    estimate.notes = "Temporary QA PDF smoke test estimate.";
    estimate.items = [
      {
        title: "Roof system installation",
        description: "Install underlayment, starter, architectural shingles, ridge cap, ventilation accessories, flashing details, and final cleanup.",
        quantity: 30,
        unit: "sq",
        rate: 330,
      },
      {
        title: "Tear off and disposal",
        description: "Remove existing roofing to decking, haul away debris, protect the property, and complete magnetic nail sweep.",
        quantity: 30,
        unit: "sq",
        rate: 75,
      },
    ];
    appState().selectedEstimateId = estimate.id;
    appState().selectedContactId = contact.id;
    callSaveState();
    callRender();
    add("pass", "Create Estimate", `Created ${estimate.estimateNumber} for PDF smoke test.`);
    return { contact, job, estimate };
  }

  async function runPdfCheck() {
    add("warn", "Diagnostics", "Starting estimate PDF smoke test. A temporary lead, job, estimate, and PDF document will be created, then deleted.");
    try {
      if (!(await waitForApp())) throw new Error("CRM did not finish loading within 18 seconds.");
      add("pass", "CRM Load", `Loaded ${location.pathname}${location.search}.`);
      if (!canActionValue("manageContacts")) throw new Error("This account cannot create leads.");
      if (!canActionValue("manageJobs")) throw new Error("This account cannot manage jobs.");
      if (!canActionValue("manageEstimates")) throw new Error("This account cannot create estimates.");
      if (!canActionValue("manageDocuments")) throw new Error("This account cannot manage documents.");
      add("pass", "PDF Permissions", "Lead, job, estimate, and document permissions are available.");

      await cleanupTempData();
      const { contact, estimate } = await createTemporaryEstimate();
      if (!window.jspdf?.jsPDF) throw new Error("jsPDF was not loaded.");
      add("warn", "PDF Download", "The browser may download one temporary QA estimate PDF during this step.");
      const result = await downloadEstimatePdf({ silent: true });
      if (!result) throw new Error("downloadEstimatePdf returned false.");
      await sleep(500);
      const updatedContact = getContactSafe(contact.id);
      const document = (updatedContact?.documents || []).find((item) => item.source === "Estimate PDF" && item.estimateId === estimate.id);
      if (!document) throw new Error("Estimate PDF was not saved under the lead documents.");
      if (!document.dataUrl?.startsWith("data:application/pdf")) throw new Error("Saved estimate document is not a PDF data URL.");
      if (document.size < 1000) throw new Error("Saved PDF document looks too small to be valid.");
      add("pass", "PDF Saved To Lead", `Estimate PDF saved under lead documents as ${document.name}.`);
    } catch (error) {
      add("fail", "PDF Smoke Test", error.message || String(error));
    } finally {
      if (created.contactId || created.estimateId) await cleanupTempData();
      created.contactId = "";
      created.estimateId = "";
    }
  }

  async function runAllChecks() {
    results.length = 0;
    await runUpperAdminCheck();
    await runAiCheck();
    await runPdfCheck();
  }

  installStyles();
  renderPanel();
  window.addEventListener("load", () => setTimeout(() => add("warn", "Ready", "Click Run All to start. The PDF check may download one temporary QA PDF."), 600));
})();
