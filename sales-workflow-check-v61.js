(() => {
  if (!window.__ROOFLINE_SALES_WORKFLOW_CHECK && !new URLSearchParams(location.search).has("sales-workflow-check")) return;

  const results = [];
  const created = { contactId: "", estimateId: "" };
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

  function add(status, name, detail) {
    results.push({ status, name, detail });
    renderPanel();
  }

  function payload() {
    return JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2);
  }

  function appState() {
    try { return state; } catch { return null; }
  }

  function canActionValue(action) {
    try { return canAction(action) === true; } catch { return false; }
  }

  function callRender() {
    try { render(); } catch {}
  }

  function callSaveState(options) {
    try { saveState(options); } catch {}
  }

  function currentOwnerSafe() {
    try { return currentOwner(); } catch { return { userId: "", email: "", name: "CRM User", role: "sales" }; }
  }

  function todaySafe() {
    try { return todayISO(); } catch { return new Date().toISOString().slice(0, 10); }
  }

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

  function normalizeContactSafe(contact) {
    try { return normalizeContact(contact); } catch { return contact; }
  }

  function normalizeJobSafe(job, contact) {
    try { return normalizeJob(job, contact); } catch { return job; }
  }

  function withOwnerSafe(record, owner) {
    try { return withOwner(record, owner); } catch { return { ...record, ownerUserId: owner.userId, ownerEmail: owner.email, ownerName: owner.name }; }
  }

  function getContactSafe(id) {
    try { return getContact(id); } catch { return appState()?.contacts?.find((contact) => contact.id === id); }
  }

  function getEstimateContactSafe(estimate) {
    try { return getEstimateContact(estimate); } catch { return getContactSafe(estimate?.contactId); }
  }

  function contactJobsSafe(contact) {
    try { return contactJobs(contact); } catch { return contact?.jobs || []; }
  }

  function visible(node) {
    if (!node) return false;
    const styles = getComputedStyle(node);
    return !node.classList.contains("hidden") && styles.display !== "none" && styles.visibility !== "hidden";
  }

  function renderPanel() {
    let panel = document.querySelector("#salesWorkflowCheckPanel");
    if (!panel) {
      panel = document.createElement("section");
      panel.id = "salesWorkflowCheckPanel";
      document.body.appendChild(panel);
    }
    const pass = results.filter((item) => item.status === "pass").length;
    const warn = results.filter((item) => item.status === "warn").length;
    const fail = results.filter((item) => item.status === "fail").length;
    panel.innerHTML = `
      <div class="workflow-check-header">
        <div><strong>Sales Workflow Check</strong><span>Creates a temporary lead, job, estimate, PDF document, then deletes them.</span></div>
        <button type="button" id="workflowCheckClose">Close</button>
      </div>
      <div class="workflow-check-summary">
        <span><strong>${pass}</strong> Pass</span>
        <span><strong>${warn}</strong> Warn</span>
        <span><strong>${fail}</strong> Fail</span>
      </div>
      <div class="workflow-check-actions">
        <button type="button" id="workflowCheckRun">Run Workflow Test</button>
        <button type="button" id="workflowCheckCopy">Copy JSON</button>
      </div>
      <div class="workflow-check-results">
        ${results.map((item) => `<article class="${item.status}"><strong>${escapeText(item.name)}</strong><span>${escapeText(item.detail)}</span></article>`).join("")}
      </div>
      <textarea id="workflowCheckJson" readonly>${escapeText(payload())}</textarea>
    `;
    panel.querySelector("#workflowCheckClose")?.addEventListener("click", () => panel.remove());
    panel.querySelector("#workflowCheckRun")?.addEventListener("click", runWorkflowCheck);
    panel.querySelector("#workflowCheckCopy")?.addEventListener("click", copyResults);
  }

  function installStyles() {
    if (document.querySelector("#salesWorkflowCheckStyles")) return;
    const style = document.createElement("style");
    style.id = "salesWorkflowCheckStyles";
    style.textContent = `
      #salesWorkflowCheckPanel{position:fixed;top:18px;right:18px;z-index:99999;width:min(590px,calc(100vw - 24px));max-height:calc(100vh - 36px);overflow:auto;border:1px solid #d9e2ef;border-radius:10px;box-shadow:0 22px 60px rgba(15,23,42,.25);background:#fff;color:#111827;font-family:Arial,Helvetica,sans-serif}
      .workflow-check-header{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 16px;background:#0b1220;color:#fff}.workflow-check-header strong,.workflow-check-header span{display:block}.workflow-check-header span{color:#cbd5e1;font-size:12px;margin-top:2px}
      #salesWorkflowCheckPanel button{border:0;border-radius:7px;padding:8px 10px;background:#0f5fe8;color:#fff;font-weight:700;cursor:pointer}.workflow-check-header button{background:#334155}
      .workflow-check-summary,.workflow-check-actions{display:flex;gap:8px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid #e2e8f0}.workflow-check-summary span{border:1px solid #d9e2ef;border-radius:7px;padding:7px 9px;background:#f8fafc;font-size:12px}
      .workflow-check-results{display:grid;gap:8px;padding:12px 16px}.workflow-check-results article{border:1px solid #d9e2ef;border-left-width:5px;border-radius:8px;padding:9px 10px;background:#fff}.workflow-check-results article.pass{border-left-color:#15803d}.workflow-check-results article.warn{border-left-color:#b45309}.workflow-check-results article.fail{border-left-color:#b91c1c}.workflow-check-results strong{display:block;font-size:13px}.workflow-check-results span{display:block;color:#64748b;font-size:12px;margin-top:3px;overflow-wrap:anywhere}
      #workflowCheckJson{width:calc(100% - 32px);height:150px;margin:0 16px 16px;padding:10px;border:1px solid #d9e2ef;border-radius:8px;background:#0b1220;color:#e2e8f0;font-size:11px;font-family:Consolas,monospace;resize:vertical}
    `;
    document.head.appendChild(style);
  }

  async function copyResults() {
    const text = payload();
    const box = document.querySelector("#workflowCheckJson");
    if (box) { box.value = text; box.focus(); box.select(); }
    try {
      await navigator.clipboard.writeText(text);
      add("pass", "Copy Results", "Workflow JSON copied to clipboard.");
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

  async function cleanupTempData() {
    const current = appState();
    if (!current) return;
    const beforeContacts = current.contacts.length;
    const beforeEstimates = current.estimates.length;
    current.contacts = current.contacts.filter((contact) => contact.id !== created.contactId && !String(contact.name || "").startsWith("QA Sales Workflow"));
    current.estimates = current.estimates.filter((estimate) => estimate.id !== created.estimateId && estimate.contactId !== created.contactId);
    if (current.selectedContactId === created.contactId) current.selectedContactId = current.contacts[0]?.id || null;
    if (current.selectedEstimateId === created.estimateId) current.selectedEstimateId = current.estimates[0]?.id || null;
    callSaveState();
    callRender();
    const removedContacts = beforeContacts - current.contacts.length;
    const removedEstimates = beforeEstimates - current.estimates.length;
    add("pass", "Cleanup", `Removed ${removedContacts} temporary contact(s) and ${removedEstimates} temporary estimate(s).`);
    await sleep(900);
  }

  async function createTemporaryLead() {
    const owner = currentOwnerSafe();
    const contactId = uidSafe("qa_contact");
    const jobId = uidSafe("qa_job");
    const stamp = Date.now().toString(36);
    created.contactId = contactId;
    const contactBase = withOwnerSafe({
      id: contactId,
      type: "Lead",
      status: "New",
      name: `QA Sales Workflow ${stamp}`,
      source: "QA Test",
      email: `qa-${stamp}@coastalcrestroofing.com`,
      phone: "(555) 010-6161",
      address: "100 QA Workflow Rd\nAustin, TX 78701",
      value: 12850,
      salesRep: owner.name || "QA Sales Rep",
      lastContact: todaySafe(),
      closedDate: "",
      notes: "Temporary workflow test lead. Safe to delete.",
      documents: [],
      updates: [],
      createdAt: todaySafe(),
    }, owner);
    const job = normalizeJobSafe(withOwnerSafe({
      id: jobId,
      name: "QA Roof Replacement Test Job",
      address: contactBase.address,
      status: "New",
      value: 12850,
      salesRep: contactBase.salesRep,
      lastContact: todaySafe(),
      closedDate: "",
      notes: "Temporary workflow test job.",
      createdAt: todaySafe(),
    }, owner), contactBase);
    const contact = normalizeContactSafe({ ...contactBase, jobs: [job] });
    appState().contacts.unshift(contact);
    appState().selectedContactId = contactId;
    callSaveState();
    callRender();
    add("pass", "Create Lead", `Created temporary lead ${contact.name}.`);
    return { contact, job };
  }

  async function createAndVerifyEstimate(contact, job) {
    let estimate = null;
    try { estimate = createEstimate(contact.id, false, job.id); } catch (error) { throw new Error(`createEstimate failed: ${error.message || error}`); }
    if (!estimate) throw new Error("createEstimate returned no estimate. Check sales estimate permission.");
    created.estimateId = estimate.id;
    estimate.projectTitle = "QA Roof Replacement Workflow Estimate";
    estimate.projectManager = contact.salesRep;
    estimate.salesRepEmail = appState().currentUser.email || contact.email;
    estimate.salesRepPhone = "(555) 010-6161";
    estimate.issueDate = todaySafe();
    estimate.validUntil = addDaysSafe(14);
    estimate.scopeSummary = "QA workflow scope: tear off existing shingles, inspect decking, install underlayment, starter, architectural shingles, ridge cap, ventilation, and cleanup.";
    estimate.taxRate = 0;
    estimate.deposit = 1000;
    estimate.notes = "Temporary QA estimate generated by the CRM workflow test.";
    estimate.items = [
      {
        title: "Architectural shingle roof system",
        description: "Install full roofing system with underlayment, starter strip, shingles, ridge cap, ventilation, and flashing accessories.",
        quantity: 28,
        unit: "sq",
        rate: 325,
      },
      {
        title: "Tear off and disposal",
        description: "Remove existing shingle roof to decking, haul away debris, and perform magnetic nail sweep.",
        quantity: 28,
        unit: "sq",
        rate: 72,
      },
    ];
    appState().selectedEstimateId = estimate.id;
    appState().selectedContactId = contact.id;
    callSaveState();
    callRender();
    add("pass", "Create Estimate", `Created ${estimate.estimateNumber} attached to ${job.name}.`);

    const selected = (() => { try { return getSelectedEstimate(); } catch { return estimate; } })();
    const selectedJob = (() => { try { return getEstimateJob(selected); } catch { return job; } })();
    if (selected.contactId !== contact.id || selected.jobId !== job.id || selectedJob?.id !== job.id) {
      throw new Error("Estimate is not attached to the expected lead/job.");
    }
    add("pass", "Estimate Attachment", "Estimate is attached to the temporary lead and job.");
    return estimate;
  }

  async function verifyPdfAndLeadDocument(contact, estimate) {
    if (!window.jspdf?.jsPDF) {
      add("fail", "PDF Library", "jsPDF was not loaded, so PDF download could not be tested.");
      return;
    }
    add("warn", "PDF Download", "The browser may download one temporary QA estimate PDF during this step.");
    const result = await downloadEstimatePdf({ silent: true });
    if (!result) throw new Error("downloadEstimatePdf returned false.");
    await sleep(500);
    const updatedContact = getContactSafe(contact.id);
    const document = (updatedContact?.documents || []).find((item) => item.source === "Estimate PDF" && item.estimateId === estimate.id);
    if (!document) throw new Error("Estimate PDF was not saved under the lead documents.");
    if (document.jobId !== estimate.jobId) throw new Error("Saved estimate PDF does not reference the expected job.");
    if (!document.dataUrl?.startsWith("data:application/pdf")) throw new Error("Saved estimate document is not a PDF data URL.");
    add("pass", "Save PDF To Lead", `Estimate PDF saved under lead documents as ${document.name}.`);
  }

  async function verifyLeadDetail(contact) {
    try { openLeadDetail(contact.id, "documents"); } catch {}
    await sleep(500);
    const docsPanelVisible = visible(document.querySelector("#leadDocumentsPanel"));
    if (!docsPanelVisible) {
      add("warn", "Lead Documents View", "Lead detail opened, but the Documents panel was not visibly active. Document storage was still verified.");
      return;
    }
    add("pass", "Lead Documents View", "Lead Documents tab opens for the temporary lead.");
  }

  async function runWorkflowCheck() {
    results.length = 0;
    created.contactId = "";
    created.estimateId = "";
    add("warn", "Diagnostics", "Starting sales workflow test. A temporary lead, job, estimate, and PDF document will be created, then deleted.");
    try {
      const ready = await waitForApp();
      if (!ready) throw new Error("CRM did not finish loading within 18 seconds.");
      add("pass", "CRM Load", `Loaded ${location.pathname}${location.search}.`);
      if (!canActionValue("manageContacts")) throw new Error("This account cannot create leads.");
      if (!canActionValue("manageJobs")) throw new Error("This account cannot manage jobs.");
      if (!canActionValue("manageEstimates")) throw new Error("This account cannot create estimates.");
      if (!canActionValue("manageDocuments")) throw new Error("This account cannot manage documents.");
      add("pass", "Sales Permissions", "Lead, job, estimate, and document permissions are available.");

      await cleanupTempData();
      const { contact, job } = await createTemporaryLead();
      const estimate = await createAndVerifyEstimate(contact, job);
      await verifyPdfAndLeadDocument(contact, estimate);
      await verifyLeadDetail(contact);
    } catch (error) {
      add("fail", "Sales Workflow", error.message || String(error));
    } finally {
      if (created.contactId || created.estimateId) {
        await cleanupTempData();
      }
    }
  }

  installStyles();
  renderPanel();
  window.addEventListener("load", () => setTimeout(() => add("warn", "Ready", "Click Run Workflow Test to start. One temporary QA PDF may download."), 600));
})();
