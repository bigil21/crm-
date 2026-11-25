async function squareApiHeaders() {
  const client = cloudClient || window.RooflineAuth?.createClient?.();
  const { data, error } = client?.auth ? await client.auth.getSession() : { data: {} };
  if (error) throw error;
  if (!window.RooflineAuth?.isEditorSessionCurrent?.(data?.session?.user)) throw new Error("Your login changed. Reopen the CRM before accessing payments.");
  const token = data?.session?.access_token || "";
  if (!token && supabaseConfig().authRequired) throw new Error("Your session expired. Sign in again before accessing payments.");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function squareInvoiceEmailDraft(estimate, contact) {
  const totals = totalsFor(estimate);
  const contractValue = number(estimate.contractValue) || totals.total;
  const paid = number(estimate.paidAmount);
  const amountDueNow = Math.max(number(estimate.deposit) - paid, 0) || Math.max(contractValue - paid, 0);
  const firstName = String(contact?.name || "there").trim().split(/\s+/)[0] || "there";
  const invoiceLabel = estimate.squareInvoiceNumber
    ? `#${estimate.squareInvoiceNumber}`
    : estimate.estimateNumber || estimate.projectNumber || "";
  const companyName = state.company.name || "Coastal Crest Construction";

  return {
    subject: `${companyName} invoice ${invoiceLabel}`.trim(),
    message: [
      `Hi ${firstName},`,
      "",
      `Your invoice for ${estimate.projectTitle || "your project"} is ready.`,
      `Contract total: ${money.format(contractValue)}`,
      `Amount due now: ${money.format(amountDueNow)}`,
      ...(estimate.projectNumber ? [`Project: ${estimate.projectNumber}`] : []),
      "",
      "View and pay securely through Square:",
      estimate.squareInvoiceUrl || "",
      "",
      "Thank you,",
      companyName,
    ].join("\n"),
  };
}

function gmailComposeUrl(toEmail, subject, message) {
  const url = new URL("https://mail.google.com/mail/");
  url.searchParams.set("view", "cm");
  url.searchParams.set("fs", "1");
  url.searchParams.set("to", toEmail || "");
  url.searchParams.set("su", subject || "");
  url.searchParams.set("body", message || "");
  return url.toString();
}

async function copySquareInvoiceLink(estimateId) {
  const estimate = state.estimates.find((item) => item.id === estimateId);
  const link = estimate?.squareInvoiceUrl || "";
  if (!link) {
    showToast("Square payment link is not available");
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    showToast("Square payment link copied");
  } catch {
    const input = document.createElement("textarea");
    input.value = link;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    showToast("Square payment link copied");
  }
}

function updateJobPaymentSnapshot(contactId, jobId) {
  const contact = getContact(contactId);
  const job = contactJobs(contact).find((item) => item.id === jobId);
  if (!contact || !job || job.paymentLedgerVersion === 2) return;
  const linked = state.estimates.filter(
    (estimate) => estimate.contactId === contactId && estimate.jobId === jobId && estimate.squareInvoiceId,
  );
  const byInvoice = new Map();
  linked.forEach((estimate) => {
    const previous = byInvoice.get(estimate.squareInvoiceId);
    if (!previous || String(estimate.paymentUpdatedAt || "") > String(previous.paymentUpdatedAt || "")) {
      byInvoice.set(estimate.squareInvoiceId, estimate);
    }
  });
  const invoices = [...byInvoice.values()];
  const squarePaidAmount = invoices.reduce((sum, estimate) => sum + number(estimate.paidAmount), 0);
  const manualPaidAmount = (job.manualPayments || []).reduce((sum, payment) => sum + number(payment.amount), 0);
  const paidAmount = Math.round((squarePaidAmount + manualPaidAmount) * 100) / 100;
  // Invoices collect against the agreed contract; they do not redefine it.
  const contractValue = number(job.contractValue ?? job.value);
  const paymentPercent = contractValue ? Math.min(100, (paidAmount / contractValue) * 100) : 0;
  const squareLastPaymentAt = invoices
    .map((estimate) => estimate.paymentUpdatedAt || estimate.paidAt || "")
    .filter(Boolean)
    .sort()
    .at(-1) || job.squareLastPaymentAt || "";
  const lastPaymentAt = [
    squareLastPaymentAt,
    ...(job.manualPayments || []).map((payment) => payment.date || payment.createdAt || ""),
  ]
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  updateContact(contactId, (current) => ({
    ...current,
    jobs: contactJobs(current).map((item) =>
      item.id === jobId
        ? {
            ...item,
            value: contractValue,
            contractValue,
            squarePaidAmount,
            paidAmount,
            paymentPercent,
            squareLastPaymentAt,
            lastPaymentAt,
          }
        : item,
    ),
  }));
}

const squareInvoiceSends = new Map();

function squareSendIdentity() {
  return JSON.stringify([authSession?.user?.id || "", String(authSession?.user?.email || "").toLowerCase(),
    authSession?.role || "", currentRole()]);
}

function showSquareSendNotice(estimateId, message) {
  const id = `square-send-notice-${encodeURIComponent(estimateId)}`;
  let notice = document.getElementById(id);
  if (!notice) {
    notice = document.createElement("aside");
    notice.id = id;
    notice.setAttribute("role", "alert");
    notice.style.cssText = "position:fixed;top:16px;left:16px;right:16px;z-index:100003;background:#fff4de;color:#34250b;border:2px solid #b87912;border-radius:12px;padding:16px";
    document.body.appendChild(notice);
  }
  notice.textContent = message;
}

function preserveSquareSendOutcome(attempt, result, message, sessionIsCurrent) {
  squareInvoiceSends.set(attempt.estimateId, { ...attempt, status: "review" });
  const payload = {
    p_request_id: attempt.requestId, rpc: "square_create_invoice", estimateId: attempt.estimateId,
    leadId: attempt.leadId, jobId: attempt.jobId, expectedVersion: attempt.expectedVersion,
    result: result && typeof result === "object" ? {
      durable: result.durable === true, estimateId: result.estimateId, leadId: result.leadId, jobId: result.jobId,
      squareInvoiceId: result.squareInvoiceId, squareOrderId: result.squareOrderId, status: result.status,
    } : null,
  };
  if (sessionIsCurrent) {
    // The server may already have committed a new estimate version. Do not
    // advance this editor's version or silently retry its older draft.
    preserveBlockedDurableWrite({ error: new Error(message), payload });
    showSquareSendNotice(attempt.estimateId, message);
  } else {
    // Keep late receipts under the initiating identity, never show private
    // financial details in a tab whose account changed while sending.
    try {
      localStorage.setItem(`jobcrest-square-send-recovery:${attempt.userId}:${attempt.requestId}`,
        JSON.stringify({ createdAt: new Date().toISOString(), request: payload }));
    } catch { /* The server's durable send intent remains the recovery authority. */ }
  }
}

function squareSendPreProviderRefusal(response, result) {
  // A generic failure can follow an accepted provider request. Only this
  // explicit server allowlist proves that this attempt never reached Square.
  if (response.ok || !result || result.noProviderAction !== true || result.durable === true
      || result.squareInvoiceId || result.squareOrderId || result.intentId) return "";
  const beginErrors = {
    legacy_invoice_review_required: "An administrator must check Square for an earlier invoice attempt before sending this older estimate.",
    estimate_changed_before_invoice: "The estimate changed. Reload and review the saved estimate before sending.",
    won_estimate_required: "Save the estimate as Won before sending an invoice.",
    invoice_already_linked: "This estimate already has a linked Square invoice. Reload its invoice status.",
    saved_customer_email_and_numbers_required: "Save the customer email, lead number and project number before sending.",
  };
  if (response.status === 409 && result.stage === "begin" && Object.hasOwn(beginErrors, result.code)) {
    return beginErrors[result.code];
  }
  if (response.status === 400 && result.error === "Send only the saved estimate ID and its current version.") return result.error;
  if ([401, 403].includes(response.status) && ["authentication_required", "admin_required"].includes(result.error)) {
    return result.error === "admin_required"
      ? "Your account is not currently approved to send Square invoices. Ask an administrator to review your assigned role."
      : "Your sign-in expired before Square was contacted. Sign in again and retry.";
  }
  if (response.status === 503 && result.error === "Reliable Square invoice storage is not configured. No invoice was sent.") return result.error;
  return "";
}

async function sendToSquare(estimateId) {
  if (currentRole() !== "admin") {
    showToast("Only an administrator can send Square invoices");
    return false;
  }
  if (squareInvoiceSends.has(estimateId)) return false;
  if (!canUseCloudSync() || !durableRecordsReady || !cloudClient || !authSession?.user?.id || durableWriteBlocked) {
    showSquareSendNotice(estimateId, "Invoice sending was not started. Connect to the shared CRM and resolve any save recovery notice first.");
    return false;
  }
  const original = state.estimates.find((item) => item.id === estimateId);
  const originalContact = getEstimateContact(original);
  const originalJob = getEstimateJob(original);
  if (!original || !originalContact || !originalJob || original.status !== "Won" || original.squareInvoiceId || !originalContact.email) {
    showSquareSendNotice(estimateId, "Invoice sending was not started. Choose a saved Won estimate with a valid lead, job, and customer email, and no existing Square invoice.");
    return false;
  }

  const identity = squareSendIdentity();
  const sessionIsCurrent = () => identity === squareSendIdentity() && currentRole() === "admin"
    && Boolean(window.RooflineAuth?.isEditorSessionCurrent?.(authSession?.user));
  const attempt = { requestId: crypto.randomUUID(), estimateId, leadId: original.contactId,
    jobId: original.jobId, userId: authSession.user.id, expectedVersion: 0, status: "sending" };
  squareInvoiceSends.set(estimateId, attempt);
  const currentTarget = (confirmedInvoiceId = "") => {
    const estimate = state.estimates.find((item) => item.id === estimateId);
    if (!estimate || estimate.contactId !== attempt.leadId || estimate.jobId !== attempt.jobId
        || (estimate.squareInvoiceId && estimate.squareInvoiceId !== confirmedInvoiceId)) return null;
    const contact = getEstimateContact(estimate);
    const job = getEstimateJob(estimate);
    return contact?.id === attempt.leadId && job?.id === attempt.jobId ? estimate : null;
  };
  const buttons = [...document.querySelectorAll("[data-square-send]")].filter((button) => button.dataset.squareSend === estimateId);
  buttons.forEach((button) => { button.disabled = true; button.textContent = "Sending…"; });
  let requested = false;
  let result = null;
  let confirmed = false;
  try {
    if (!sessionIsCurrent()) throw new Error("The signed-in account changed before sending.");
    const numbered = canUseCloudSync()
      ? { contact: getContact(attempt.leadId), job: contactJobs(getContact(attempt.leadId)).find(job => job.id === attempt.jobId) }
      : ensureLeadProjectNumbers(attempt.leadId, attempt.jobId);
    const target = currentTarget();
    if (!target || numbered?.contact?.id !== attempt.leadId || numbered?.job?.id !== attempt.jobId) {
      throw new Error("The estimate's lead or job changed before sending.");
    }
    target.leadNumber = numbered.contact.leadNumber;
    target.projectNumber = numbered.job.projectNumber;
    saveState({ localOnly: true });
    if (!(await waitForDurableSaveSlot()) || !sessionIsCurrent() || !(await flushDurableRecordsSave())) {
      throw new Error("The lead, job and estimate could not all be confirmed saved.");
    }
    const saved = currentTarget();
    if (!sessionIsCurrent() || !saved || saved.status !== "Won" || durableWriteBlocked || durableSaveInFlight || hasPendingDurableChanges()) {
      throw new Error("Finish saving the latest lead, job and estimate edits before sending.");
    }
    const snapshot = JSON.parse(JSON.stringify(saved));
    attempt.expectedVersion = getDurableCommitWriter().getVersion({ record_type: "estimate", id: estimateId });
    if (!Number.isSafeInteger(attempt.expectedVersion) || attempt.expectedVersion < 1) {
      throw new Error("The saved estimate version could not be confirmed.");
    }
    const headers = await squareApiHeaders();
    // Refreshing auth can yield while the rep edits. Billing must start from
    // the exact acknowledged version, not a newly typed browser-only amount.
    if (!sessionIsCurrent() || !currentTarget() || durableWriteBlocked || durableSaveInFlight || hasPendingDurableChanges()
        || !durableRecordDataMatches(currentTarget(), snapshot)
        || getDurableCommitWriter().getVersion({ record_type: "estimate", id: estimateId }) !== attempt.expectedVersion) {
      throw new Error("The estimate changed before sending. Save the latest edits and send again.");
    }
    requested = true;
    const response = await fetch("/api/square/create-invoice", {
      method: "POST", headers, signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ estimateId, expectedVersion: attempt.expectedVersion }),
    });
    result = await response.json();
    const preProviderRefusal = squareSendPreProviderRefusal(response, result);
    if (preProviderRefusal) {
      requested = false;
      throw new Error(preProviderRefusal);
    }
    if (!response.ok || result?.error || result?.durable !== true || result.estimateId !== estimateId
        || result.leadId !== attempt.leadId || result.jobId !== attempt.jobId
        || typeof result.squareInvoiceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(result.squareInvoiceId)
        || !Number.isFinite(result.contractValue) || result.contractValue <= 0) {
      throw new Error("Square invoice creation and its shared CRM association could not both be confirmed.");
    }
    if (!sessionIsCurrent()) throw new Error("The signed-in account changed while the invoice was being sent.");
    if (!currentTarget(result.squareInvoiceId) || durableWriteBlocked || durableSaveInFlight || hasPendingDurableChanges()) {
      throw new Error("The invoice is attached in the shared CRM, but this page has newer or changed records to review.");
    }
    // The server has already attached the invoice. Only guarded hydration may
    // adopt its version; never repeat the association as a browser money write.
    const rows = await reloadDurableRecords({ showUpdateToast: false });
    if (!sessionIsCurrent()) throw new Error("The signed-in account changed while confirming the shared invoice.");
    const refreshed = currentTarget(result.squareInvoiceId);
    if (rows === null || !refreshed || refreshed.squareInvoiceId !== result.squareInvoiceId) {
      throw new Error("The invoice was attached in the shared CRM, but this page could not safely reload the confirmation.");
    }
    document.getElementById(`square-send-notice-${encodeURIComponent(estimateId)}`)?.remove();
    if (state.view === "invoices" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) renderInvoicesView();
    confirmed = true;
    showToast("Invoice published in Square and attached to the shared CRM. Email delivery is not yet confirmed.");
    return true;
  } catch (error) {
    if (requested) {
      const message = result?.durable === true
        ? "Square reports the invoice is attached to the shared CRM, but this page could not safely adopt it. Do not send another invoice. Download unsaved work, then reload and review the shared record."
        : "The invoice outcome could not be confirmed. Do not create a separate invoice. Download unsaved work and have an administrator review Square and this saved estimate. After reloading and resolving save recovery, retry only this same saved estimate to resume its existing attempt.";
      preserveSquareSendOutcome(attempt, result, message, sessionIsCurrent());
    } else if (sessionIsCurrent()) {
      showSquareSendNotice(estimateId, `Invoice sending was not started. ${error.message}`);
    }
    return false;
  } finally {
    const review = squareInvoiceSends.get(estimateId)?.status === "review";
    if (!review) squareInvoiceSends.delete(estimateId);
    if (sessionIsCurrent()) buttons.forEach((button) => {
      button.disabled = review || confirmed;
      button.textContent = review ? "Review invoice outcome" : confirmed ? "Published in Square" : "Send to Square";
    });
  }
}

function setPaymentRefreshStatus(message) {
  let notice = document.getElementById("crmPaymentRefreshStatus");
  if (!notice && message) {
    notice = document.createElement("aside");
    notice.id = "crmPaymentRefreshStatus";
    notice.setAttribute("role", "status");
    notice.style.cssText = "position:fixed;bottom:12px;right:16px;max-width:420px;z-index:900;background:#fff4de;color:#34250b;padding:10px 14px;border:1px solid #b87912;border-radius:8px;font-size:13px";
    document.body.appendChild(notice);
  }
  if (notice) {
    notice.textContent = message;
    notice.hidden = !message;
  }
}

async function pollSquarePayments() {
  // Sales reps receive confirmed shared balances through record subscriptions.
  // Once enabled, the server worker alone reconciles provider payment fields.
  const currentIdentity = () => JSON.stringify([authSession?.user?.id || "", authSession?.user?.email || "",
    authSession?.user?.app_metadata?.role || ""]);
  const initiatingIdentity = currentIdentity();
  const sessionIsCurrent = () => currentRole() === "admin" && !durableWriteBlocked
    && currentIdentity() === initiatingIdentity && window.RooflineAuth.isEditorSessionCurrent();
  if (!sessionIsCurrent()) return;
  if (squarePollInFlight) return;
  squarePollInFlight = true;
  try {
    if (window.ROOFLINE_SUPABASE_CONFIG?.squarePaymentWorkerEnabled === true) {
      const headers = await squareApiHeaders();
      if (!sessionIsCurrent()) return;
      const response = await fetch("/api/square/sync-status", {
        method: "GET", headers, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Shared payment sync status is unavailable.");
      const status = await response.json();
      if (!sessionIsCurrent()) return;
      const validTime = (value) => typeof value === "string" && Boolean(value.trim()) && Number.isFinite(Date.parse(value));
      if (!status || Array.isArray(status) || status.enabled !== true
          || !Number.isSafeInteger(status.pending) || status.pending < 0
          || !Number.isSafeInteger(status.review) || status.review < 0
          || (status.lastProcessedAt !== null && !validTime(status.lastProcessedAt))
          || (status.oldestPendingAt != null && !validTime(status.oldestPendingAt))) {
        throw new Error("Shared payment sync status could not be confirmed.");
      }
      const delayedQueue = status.pending > 0 && validTime(status.oldestPendingAt)
        && Date.now() - Date.parse(status.oldestPendingAt) > 5 * 60 * 1000;
      setPaymentRefreshStatus(status.review > 0
        ? `${status.review} payment updates need administrator review; last confirmed balances are shown.`
        : delayedQueue ? `${status.pending} payment updates are queued; last confirmed balances are shown.` : "");
      // Realtime adopts confirmed database balances when safe. Never refresh
      // provider totals, save patches, or redraw the active editor here.
      return;
    }
    const snapshot = window.CrmPaymentRefresh.capture(state.estimates, {
      contractValue: (estimate) => number(estimate.contractValue) || totalsFor(estimate).total,
    });
    if (!snapshot.invoiceIds.length) { setPaymentRefreshStatus(""); return; }
    const collected = await window.CrmPaymentRefresh.collect(snapshot, async (invoiceIds, { signal }) => {
      if (!sessionIsCurrent()) throw new Error("The signed-in session changed.");
      const res = await fetch("/api/square/payment-status", {
        method: "POST",
        headers: await squareApiHeaders(),
        body: JSON.stringify({ invoiceIds }),
        signal,
      });
      if (!res.ok) throw new Error("Payment refresh failed. Last known balances are displayed.");
      return res.json();
    });
    // No await between checking identity/current drafts and applying payment-only
    // patches. A late reply must not mutate a new session or overwrite typing.
    if (!sessionIsCurrent()) return;
    const plan = window.CrmPaymentRefresh.reconcile(snapshot, collected, state.estimates, {
      isJobCurrent: (contactId, jobId) => {
        const contact = getContact(contactId);
        return Boolean(contact && contactJobs(contact).some((job) => job.id === jobId));
      },
    });
    if (plan.changed) {
      plan.patches.forEach((patch) => {
        const estimate = state.estimates.find((item) => item.id === patch.estimateId);
        Object.assign(estimate, JSON.parse(JSON.stringify(patch.fields)));
      });
      plan.touchedJobs.forEach(({ contactId, jobId }) => updateJobPaymentSnapshot(contactId, jobId));
      saveState({ localOnly: true });
      if (!["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) render();
    }
    setPaymentRefreshStatus(plan.message);
  } catch (error) {
    if (sessionIsCurrent()) setPaymentRefreshStatus(window.CrmPaymentRefresh.STALE_MESSAGE);
    console.warn("Square balances could not be refreshed", error.message);
  } finally {
    squarePollInFlight = false;
  }
}

// Keep Square payment progress current throughout the signed-in CRM session.
let squarePollInterval = null;
let squarePollInFlight = false;
function startSquarePoll() {
  if (squarePollInterval) return;
  pollSquarePayments();
  squarePollInterval = setInterval(pollSquarePayments, 30000);
}

// A voided invoice no longer bills its estimate, so the estimate can be
// invoiced again (the new invoice takes the next free number).
function internalInvoiceForEstimate(estimateId) {
  return (state.invoices || []).find((invoice) => invoice.estimateId === estimateId && invoice.provider === "internal" && invoice.status !== "void");
}

function nextInternalInvoiceNumber(estimate) {
  const base = `INV-${String(estimate.estimateNumber || estimate.projectNumber || estimate.id).replace(/^EST-/i, "")}`;
  const used = new Set((state.invoices || []).map((invoice) => invoice.invoiceNumber));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function dueDateAfter(issueDate, days = 14) {
  const date = new Date(`${issueDate}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createInternalInvoiceFromEstimate(estimateId) {
  if (!canManageManualPayments()) return showToast("Only an administrator can create an invoice");
  const estimate = state.estimates.find((item) => item.id === estimateId);
  const contact = estimate && getEstimateContact(estimate);
  const job = contact && contactJobs(contact).find((item) => item.id === estimate.jobId);
  if (!estimate || estimate.status !== "Won" || !contact || !job || job.status !== "Won") {
    return showToast("Save the won estimate and complete its job-stage checklist before creating an invoice");
  }
  const existing = internalInvoiceForEstimate(estimate.id);
  if (existing) return showToast(`${existing.invoiceNumber} already exists for this estimate`);
  if (invalidEstimateLineItems(estimate).length) return showToast("Fix incomplete estimate line items before creating the invoice");

  const totals = totalsFor(estimate);
  const issueDate = todayISO();
  const owner = currentOwner();
  const invoice = normalizeInvoice({
    id: uid("invoice"),
    invoiceNumber: nextInternalInvoiceNumber(estimate),
    contactId: contact.id,
    leadId: contact.id,
    jobId: job.id,
    estimateId: estimate.id,
    status: "draft",
    subtotal: totals.subtotal,
    taxAmount: totals.tax,
    taxRate: number(estimate.taxRate),
    totalAmount: totals.total,
    amountPaid: 0,
    issueDate,
    dueDate: dueDateAfter(issueDate),
    terms: "Due within 14 days",
    notes: estimate.notes || "",
    ownerUserId: estimate.ownerUserId || owner.userId,
    ownerEmail: estimate.ownerEmail || owner.email,
    ownerName: estimate.ownerName || owner.name,
    createdAt: new Date().toISOString(),
    items: estimate.items.map((item, position) => ({
      id: uid("invoiceitem"),
      description: [item.title, item.description].filter(Boolean).join(" — "),
      quantity: number(item.quantity),
      unitPrice: number(item.rate),
      amount: estimateLineAmount(item),
      position,
    })),
  });

  try {
    if (canUseCloudSync()) {
      if (!financialLedgerReady) throw new Error("The financial ledger is not ready yet");
      const { error } = await cloudClient.rpc("crm_create_invoice_from_estimate", {
        p_invoice: {
          id: invoice.id,
          invoice_number: invoice.invoiceNumber,
          lead_id: invoice.leadId,
          job_id: invoice.jobId,
          estimate_id: invoice.estimateId,
          subtotal: invoice.subtotal,
          tax_amount: invoice.taxAmount,
          total_amount: invoice.totalAmount,
          issue_date: invoice.issueDate,
          due_date: invoice.dueDate,
          terms: invoice.terms,
          notes: invoice.notes,
        },
        p_items: invoice.items.map((item) => ({
          id: item.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unitPrice,
          amount: item.amount,
          position: item.position,
        })),
      });
      if (error) throw error;
      if (!(await initializeFinancialLedger())) throw new Error("The invoice was created, but the ledger could not be refreshed");
    } else {
      state.invoices.unshift(invoice);
      saveState({ localOnly: true });
    }
    renderInvoicesView();
    showToast(`${invoice.invoiceNumber} created from ${estimate.estimateNumber}`);
  } catch (error) {
    console.error("Invoice conversion failed", error);
    showToast(error?.message || "The invoice could not be created");
  }
}

function financialLedgerEntries() {
  const entries = [];
  const paymentIds = new Set();
  const expenseIds = new Set();
  // A row from the money tables counts when its lead is one this user can see
  // and is not archived: the rule payments recorded on a job always followed.
  // An archived lead is left out of the totals however its money was recorded.
  // The database's own total (crm_ledger_totals) applies the same rule.
  const contacts = visibleContacts();
  const countedLeads = new Set(contacts.map((contact) => contact.id));
  const counts = (row) => !row.contactId || countedLeads.has(row.contactId);
  (state.invoices || []).filter(counts).forEach((invoice) => entries.push({
    id: `invoice-${invoice.id}`, at: invoice.issueDate, kind: "Invoice", contactId: invoice.contactId,
    jobId: invoice.jobId, label: invoice.invoiceNumber, detail: invoice.status, amount: invoice.totalAmount, direction: "debit",
  }));
  (state.financialPayments || []).filter(isInvoicePaymentRow).forEach((payment) => {
    paymentIds.add(payment.id);
    if (!counts(payment)) return;
    entries.push({ id: `payment-${payment.id}`, at: payment.receivedAt, kind: "Payment", contactId: payment.contactId,
      jobId: payment.jobId, label: payment.method, detail: payment.reference || payment.provider, amount: payment.amount, direction: "credit", paymentId: payment.id });
  });
  (state.financialExpenses || []).forEach((expense) => {
    expenseIds.add(expense.id);
    if (!counts(expense)) return;
    entries.push({ id: `expense-${expense.id}`, at: expense.expenseDate, kind: "Expense", contactId: expense.contactId,
      jobId: expense.jobId, label: expense.category, detail: expense.vendor || expense.description, amount: expense.amount, direction: "expense" });
  });
  const ledgerByJob = new Map();
  for (const p of state.jobLedgerPayments || []) {
    if (!ledgerByJob.has(p.jobId)) ledgerByJob.set(p.jobId, []);
    ledgerByJob.get(p.jobId).push(p);
  }
  contacts.forEach((contact) => contactJobs(contact).forEach((job) => {
    if (job.paymentLedgerVersion === 2) {
      (ledgerByJob.get(job.id) || []).filter(p => p.contactId === contact.id).forEach(p => entries.push({
        id: "ledger-" + p.id, kind: "Payment", at: p.receivedAt, contactId: contact.id, jobId: job.id, label: p.method,
        detail: p.reference || p.provider, amount: number(p.amount) - number(p.provider_refunded), direction: "credit",
      }));
    }
    (job.manualPayments || []).filter((payment) => !paymentIds.has(payment.id)).forEach((payment) => entries.push({
      id: `manual-${payment.id}`, at: payment.date || payment.createdAt, kind: "Payment", contactId: contact.id, jobId: job.id,
      label: payment.method || "Manual", detail: payment.reference || "Recorded in CRM", amount: number(payment.amount), direction: "credit",
    }));
    if (job.paymentLedgerVersion !== 2 && number(job.squarePaidAmount) > 0) entries.push({
      id: `square-${job.id}`, at: job.squareLastPaymentAt || job.lastPaymentAt, kind: "Payment", contactId: contact.id, jobId: job.id,
      label: "Square", detail: "Confirmed Square payments", amount: number(job.squarePaidAmount), direction: "credit",
    });
    (job.costItems || []).filter((expense) => !expenseIds.has(expense.id)).forEach((expense) => entries.push({
      id: `cost-${expense.id}`, at: expense.date || expense.createdAt, kind: "Expense", contactId: contact.id, jobId: job.id,
      label: expense.category || "Job cost", detail: expense.vendor || expense.description || "Recorded job cost", amount: number(expense.amount), direction: "expense",
    }));
  }));
  (state.creditNotes || []).filter(counts).forEach((credit) => entries.push({
    id: `credit-${credit.id}`, at: credit.issuedAt, kind: "Credit", contactId: credit.contactId, jobId: credit.jobId,
    label: credit.creditNumber, detail: credit.reason, amount: credit.amount, direction: "credit",
  }));
  (state.financialRefunds || []).filter(counts).forEach((refund) => entries.push({
    id: `refund-${refund.id}`, at: refund.refundedAt, kind: "Refund", contactId: refund.contactId, jobId: refund.jobId,
    label: "Payment refund", detail: refund.reason, amount: refund.amount, direction: "refund", paymentId: refund.paymentId,
  }));
  return entries.sort((a, b) => activityTimestamp(b.at) - activityTimestamp(a.at));
}

function invoiceCreditTotal(invoiceId) {
  return (state.creditNotes || [])
    .filter((credit) => credit.invoiceId === invoiceId && credit.status === "applied")
    .reduce((sum, credit) => sum + number(credit.amount), 0);
}

// Payments recorded on the job itself (the job's Payments tab, or Square) are
// money received for that job's contract, so they are applied to the job's
// invoices, oldest first. Without this an invoice kept showing its full
// balance on a job that was already paid in full, which invited recording the
// same money a second time.
function jobPaymentsAppliedToInvoice(invoice) {
  if (!invoice?.jobId || invoice.status === "void") return 0;
  const contact = state.contacts.find((item) => item.id === invoice.contactId);
  const job = contact && contactJobs(contact).find((item) => item.id === invoice.jobId);
  let pool = job?.paymentLedgerVersion === 2 ? number(job.manualPaidAmount) + number(job.squarePaidAmount) : number(job?.paidAmount);
  if (!(pool > 0)) return 0;
  const siblings = (state.invoices || [])
    .filter((item) => item.jobId === invoice.jobId && item.contactId === invoice.contactId && item.status !== "void")
    .sort((a, b) => activityTimestamp(a.issueDate) - activityTimestamp(b.issueDate) || String(a.id).localeCompare(String(b.id)));
  for (const sibling of siblings) {
    const owed = Math.max(number(sibling.totalAmount) - number(sibling.amountPaid) - invoiceCreditTotal(sibling.id), 0);
    const applied = Math.min(pool, owed);
    if (sibling.id === invoice.id) return Math.round(applied * 100) / 100;
    pool -= applied;
    if (pool <= 0) return 0;
  }
  return 0;
}

function invoiceOutstanding(invoice) {
  if (invoice?.status === "void") return 0;
  const owed = number(invoice.totalAmount) - number(invoice.amountPaid) - invoiceCreditTotal(invoice.id) - jobPaymentsAppliedToInvoice(invoice);
  return Math.max(Math.round(owed * 100) / 100, 0);
}

function invoiceAging(invoice) {
  if (["paid", "credited", "void"].includes(invoice.status) || invoiceOutstanding(invoice) <= 0) return { key: "closed", label: invoice.status };
  if (!invoice.dueDate) return { key: "open", label: "No due date" };
  const today = new Date(`${todayISO()}T12:00:00`).getTime();
  const due = new Date(`${invoice.dueDate}T12:00:00`).getTime();
  const days = Math.round((due - today) / 86400000);
  if (days < 0) return { key: "overdue", label: `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} overdue` };
  if (days <= 7) return { key: "due-soon", label: days === 0 ? "Due today" : `Due in ${days} days` };
  return { key: "current", label: `Due ${formatDate(invoice.dueDate)}` };
}

function openInvoicePaymentDialog(invoiceId) {
  if (!canManageManualPayments()) return showToast("Only an administrator can record payments");
  const invoice = (state.invoices || []).find((item) => item.id === invoiceId);
  if (!invoice || invoiceOutstanding(invoice) <= 0) return showToast("This invoice has no outstanding balance");
  els.invoicePaymentForm.reset();
  els.invoicePaymentForm.elements.invoiceId.value = invoice.id;
  els.invoicePaymentForm.elements.amount.value = invoiceOutstanding(invoice).toFixed(2);
  els.invoicePaymentForm.elements.receivedAt.value = todayISO();
  els.invoicePaymentTitle.textContent = `Record Payment · ${invoice.invoiceNumber}`;
  els.invoicePaymentDialog.showModal();
}

function openInvoiceCreditDialog(invoiceId) {
  if (!canManageManualPayments()) return showToast("Only an administrator can apply credits");
  const invoice = (state.invoices || []).find((item) => item.id === invoiceId);
  if (!invoice || invoiceOutstanding(invoice) <= 0) return showToast("This invoice has no outstanding balance");
  els.invoiceCreditForm.reset();
  els.invoiceCreditForm.elements.invoiceId.value = invoice.id;
  els.invoiceCreditForm.elements.amount.value = invoiceOutstanding(invoice).toFixed(2);
  els.invoiceCreditForm.elements.issuedAt.value = todayISO();
  els.invoiceCreditTitle.textContent = `Apply Credit · ${invoice.invoiceNumber}`;
  els.invoiceCreditDialog.showModal();
}

async function recordInvoicePayment(event) {
  event.preventDefault();
  if (!canManageManualPayments()) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const invoice = (state.invoices || []).find((item) => item.id === data.get("invoiceId"));
  const amount = parseCurrencyInput(data.get("amount"));
  if (!invoice || !(amount > 0) || amount > invoiceOutstanding(invoice) + 0.005) return showToast("Enter a payment no greater than the outstanding balance");
  const payment = normalizeFinancialPayment({
    id: uid("payment"), contactId: invoice.contactId, jobId: invoice.jobId, amount,
    method: data.get("method"), reference: data.get("reference"), note: data.get("note"),
    provider: "manual", receivedAt: `${data.get("receivedAt")}T12:00:00`, createdAt: new Date().toISOString(),
  });
  try {
    if (canUseCloudSync()) {
      const { error } = await cloudClient.rpc("crm_record_invoice_payment", { p_payment: {
        id: payment.id, allocation_id: uid("allocation"), invoice_id: invoice.id, amount: payment.amount,
        method: payment.method, reference: payment.reference, note: payment.note, provider: payment.provider,
        received_at: payment.receivedAt,
      } });
      if (error) throw error;
      if (!(await initializeFinancialLedger())) throw new Error("Payment saved, but ledger refresh failed");
      await refreshLedgerJobInView(invoice.contactId, invoice.jobId);
    } else {
      state.financialPayments.unshift(payment);
      state.paymentAllocations.unshift(normalizePaymentAllocation({ id: uid("allocation"), paymentId: payment.id, invoiceId: invoice.id, contactId: invoice.contactId, jobId: invoice.jobId, amount }));
      invoice.amountPaid = Math.round((number(invoice.amountPaid) + amount) * 100) / 100;
      invoice.status = invoiceOutstanding(invoice) <= 0.005 ? "paid" : "partial";
      invoice.updatedAt = new Date().toISOString();
      saveState({ localOnly: true });
    }
    els.invoicePaymentDialog.close();
    renderInvoicesView();
    showToast(`${money.format(amount)} recorded on ${invoice.invoiceNumber}`);
  } catch (error) {
    console.error("Invoice payment failed", error);
    showToast(error?.message || "The payment could not be recorded");
  }
}

async function applyInvoiceCredit(event) {
  event.preventDefault();
  if (!canManageManualPayments()) return;
  const form = event.currentTarget;
  const data = new FormData(form);
  const invoice = (state.invoices || []).find((item) => item.id === data.get("invoiceId"));
  const amount = parseCurrencyInput(data.get("amount"));
  const reason = String(data.get("reason") || "").trim();
  if (!invoice || !(amount > 0) || amount > invoiceOutstanding(invoice) + 0.005 || !reason) return showToast("Enter a valid credit and reason");
  const credit = normalizeCreditNote({
    id: uid("credit"), creditNumber: `CR-${invoice.invoiceNumber.replace(/^INV-/i, "")}-${Date.now().toString(36).toUpperCase()}`,
    invoiceId: invoice.id, contactId: invoice.contactId, jobId: invoice.jobId, amount, reason, status: "applied",
    issuedAt: data.get("issuedAt"), createdAt: new Date().toISOString(),
  });
  try {
    if (canUseCloudSync()) {
      const { error } = await cloudClient.rpc("crm_apply_credit_note", { p_credit: {
        id: credit.id, credit_number: credit.creditNumber, invoice_id: invoice.id, amount: credit.amount,
        reason: credit.reason, issued_at: credit.issuedAt,
      } });
      if (error) throw error;
      if (!(await initializeFinancialLedger())) throw new Error("Credit saved, but ledger refresh failed");
    } else {
      state.creditNotes.unshift(credit);
      invoice.status = invoiceOutstanding(invoice) <= 0.005 ? "credited" : number(invoice.amountPaid) > 0 ? "partial" : invoice.status;
      invoice.updatedAt = new Date().toISOString();
      saveState({ localOnly: true });
    }
    els.invoiceCreditDialog.close();
    renderInvoicesView();
    showToast(`${credit.creditNumber} applied to ${invoice.invoiceNumber}`);
  } catch (error) {
    console.error("Invoice credit failed", error);
    showToast(error?.message || "The credit could not be applied");
  }
}

// An invoice raised by mistake could not be removed in any way. Voiding keeps
// the record (and its number) for the books but takes it out of every total.
// Invoices with money recorded against them are corrected with a credit or a
// refund instead, so payment history is never orphaned.
async function voidInvoice(invoiceId) {
  if (!canManageManualPayments()) return showToast("Only an administrator can void an invoice");
  const invoice = (state.invoices || []).find((item) => item.id === invoiceId);
  if (!invoice || invoice.status === "void") return;
  if (number(invoice.amountPaid) > 0 || invoiceCreditTotal(invoice.id) > 0) {
    return showToast("This invoice has payments or credits recorded. Refund or credit it instead of voiding it.");
  }
  const confirmed = await appConfirm(
    `Void invoice ${invoice.invoiceNumber} for ${money.format(invoice.totalAmount)}? It stays on record as void and no longer counts as money owed.`,
    { title: "Void invoice", confirmLabel: "Void invoice", danger: true },
  );
  if (!confirmed) return;
  try {
    if (canUseCloudSync()) {
      const { data: voided, error } = await cloudClient.rpc("crm_void_internal_invoice", { p_invoice_id: invoice.id });
      if (error) throw error;
      if (voided !== invoice.id) throw new Error("The invoice was not confirmed void. Refresh before retrying.");
      if (!(await Promise.all([initializeFinancialLedger(), initializeJobOperations()])).every(Boolean))
        throw new Error("Invoice voided, but the billing view could not be refreshed.");
    } else {
      invoice.status = "void";
      invoice.updatedAt = new Date().toISOString();
      (state.invoiceSchedules || []).forEach((item) => { if (item.templateInvoiceId === invoice.id) item.active = false; });
      state.progressBillings = (state.progressBillings || []).map((item) => operationValue(item, "invoiceId", "invoice_id") === invoice.id
        ? { ...item, status: "planned", invoiceId: "", invoice_id: "" } : item);
      saveState({ localOnly: true });
    }
    renderInvoicesView();
    showToast(`${invoice.invoiceNumber} voided`);
  } catch (error) {
    console.error("Invoice void failed", error);
    showToast(error?.message || "The invoice could not be voided");
  }
}

function paymentRefundTotal(paymentId) {
  return (state.financialRefunds || []).filter((refund) => refund.paymentId === paymentId)
    .reduce((sum, refund) => sum + number(refund.amount), 0);
}

function populateExpenseJobOptions() {
  const form = els.financeExpenseForm;
  if (!form) return;
  const contact = state.contacts.find((item) => item.id === form.elements.leadId.value);
  const jobs = contact ? contactJobs(contact) : [];
  form.elements.jobId.innerHTML = jobs.map((job) => `<option value="${escapeHtml(job.id)}">${escapeHtml(job.name || job.projectNumber || "Job")}</option>`).join("");
}

function openFinanceExpenseDialog() {
  if (!canManageManualPayments()) return showToast("Only an administrator can record expenses");
  const contacts = visibleContacts().filter((contact) => contactJobs(contact).length);
  if (!contacts.length) return showToast("Create a job before recording an expense");
  els.financeExpenseForm.reset();
  els.financeExpenseForm.elements.leadId.innerHTML = contacts.map((contact) => `<option value="${escapeHtml(contact.id)}">${escapeHtml(contact.name)}</option>`).join("");
  els.financeExpenseForm.elements.expenseDate.value = todayISO();
  populateExpenseJobOptions();
  els.financeExpenseDialog.showModal();
}

async function recordFinanceExpense(event) {
  event.preventDefault();
  if (!canManageManualPayments()) return;
  const data = new FormData(event.currentTarget);
  const expense = normalizeFinancialExpense({
    id: uid("expense"), contactId: data.get("leadId"), jobId: data.get("jobId"), category: data.get("category"),
    vendor: data.get("vendor"), description: data.get("description"), amount: parseCurrencyInput(data.get("amount")),
    expenseDate: data.get("expenseDate"), reference: data.get("reference"), status: "recorded", createdAt: new Date().toISOString(),
  });
  if (!(expense.amount > 0) || !expense.contactId || !expense.jobId) return showToast("Enter a valid job expense");
  try {
    if (canUseCloudSync()) {
      const { error } = await cloudClient.rpc("crm_record_expense", { p_expense: {
        id: expense.id, lead_id: expense.contactId, job_id: expense.jobId, category: expense.category, vendor: expense.vendor,
        description: expense.description, amount: expense.amount, expense_date: expense.expenseDate, reference: expense.reference,
      } });
      if (error) throw error;
      if (!(await initializeFinancialLedger())) throw new Error("Expense saved, but the ledger refresh failed");
    } else {
      state.financialExpenses.unshift(expense);
      saveState({ localOnly: true });
    }
    els.financeExpenseDialog.close();
    renderInvoicesView();
    showToast(`${money.format(expense.amount)} expense recorded`);
  } catch (error) {
    console.error("Expense save failed", error);
    showToast(error?.message || "The expense could not be recorded");
  }
}

function openInvoiceRefundDialog(paymentId) {
  if (!canManageManualPayments()) return showToast("Only an administrator can record refunds");
  const payment = (state.financialPayments || []).find((item) => item.id === paymentId);
  const refundable = payment ? Math.max(payment.amount - paymentRefundTotal(payment.id), 0) : 0;
  if (!payment || refundable <= 0) return showToast("This payment has no refundable balance");
  els.invoiceRefundForm.reset();
  els.invoiceRefundForm.elements.paymentId.value = payment.id;
  els.invoiceRefundForm.elements.amount.value = refundable.toFixed(2);
  els.invoiceRefundForm.elements.refundedAt.value = todayISO();
  els.invoiceRefundTitle.textContent = `Record Refund · ${payment.reference || payment.method}`;
  els.invoiceRefundDialog.showModal();
}

async function recordInvoiceRefund(event) {
  event.preventDefault();
  if (!canManageManualPayments()) return;
  const data = new FormData(event.currentTarget);
  const payment = (state.financialPayments || []).find((item) => item.id === data.get("paymentId"));
  const amount = parseCurrencyInput(data.get("amount"));
  const refundable = payment ? Math.max(payment.amount - paymentRefundTotal(payment.id), 0) : 0;
  const reason = String(data.get("reason") || "").trim();
  if (!payment || !(amount > 0) || amount > refundable + 0.005 || !reason) return showToast("Enter a valid refund and reason");
  const allocation = (state.paymentAllocations || []).find((item) => item.paymentId === payment.id);
  const refund = normalizeFinancialRefund({ id: uid("refund"), paymentId: payment.id, invoiceId: allocation?.invoiceId || "", contactId: payment.contactId, jobId: payment.jobId, amount, reason, refundedAt: `${data.get("refundedAt")}T12:00:00`, provider: "manual" });
  try {
    if (canUseCloudSync()) {
      const { error } = await cloudClient.rpc("crm_record_refund", { p_refund: { id: refund.id, payment_id: payment.id, amount, reason, refunded_at: refund.refundedAt, provider: "manual" } });
      if (error) throw error;
      if (!(await initializeFinancialLedger())) throw new Error("Refund saved, but the ledger refresh failed");
      await refreshLedgerJobInView(payment.contactId, payment.jobId);
    } else {
      state.financialRefunds.unshift(refund);
      const invoice = (state.invoices || []).find((item) => item.id === allocation?.invoiceId);
      if (invoice) {
        invoice.amountPaid = Math.max(invoice.amountPaid - amount, 0);
        invoice.status = invoice.amountPaid > 0 ? "partial" : invoice.dueDate && invoice.dueDate < todayISO() ? "overdue" : "sent";
      }
      saveState({ localOnly: true });
    }
    els.invoiceRefundDialog.close();
    renderInvoicesView();
    showToast(`${money.format(amount)} refund recorded`);
  } catch (error) {
    console.error("Refund save failed", error);
    showToast(error?.message || "The refund could not be recorded");
  }
}

function openInvoiceScheduleDialog(invoiceId) {
  if (!canManageManualPayments()) return showToast("Only an administrator can schedule invoices");
  const invoice = (state.invoices || []).find((item) => item.id === invoiceId);
  if (!invoice) return;
  const existing = (state.invoiceSchedules || []).find((item) => item.templateInvoiceId === invoice.id);
  els.invoiceScheduleForm.reset();
  els.invoiceScheduleForm.elements.invoiceId.value = invoice.id;
  els.invoiceScheduleForm.elements.cadence.value = existing?.cadence || "monthly";
  els.invoiceScheduleForm.elements.nextIssueDate.value = existing?.nextIssueDate || addDaysISO(30);
  els.invoiceScheduleForm.elements.dueDays.value = existing?.dueDays ?? 14;
  els.invoiceScheduleForm.elements.remainingCount.value = existing?.remainingCount ?? "";
  els.invoiceScheduleTitle.textContent = `Recurring Schedule · ${invoice.invoiceNumber}`;
  els.invoiceScheduleDialog.showModal();
}

async function saveInvoiceSchedule(event) {
  event.preventDefault();
  if (!canManageManualPayments()) return;
  const data = new FormData(event.currentTarget);
  const invoice = (state.invoices || []).find((item) => item.id === data.get("invoiceId"));
  if (!invoice) return;
  const existing = (state.invoiceSchedules || []).find((item) => item.templateInvoiceId === invoice.id);
  const schedule = normalizeInvoiceSchedule({ id: existing?.id || uid("schedule"), templateInvoiceId: invoice.id, contactId: invoice.contactId, jobId: invoice.jobId, cadence: data.get("cadence"), nextIssueDate: data.get("nextIssueDate"), dueDays: data.get("dueDays"), remainingCount: data.get("remainingCount") ? Number(data.get("remainingCount")) : null, active: true });
  try {
    if (canUseCloudSync()) {
      const { error } = await cloudClient.rpc("crm_save_invoice_schedule", { p_schedule: { id: schedule.id, template_invoice_id: invoice.id, cadence: schedule.cadence, next_issue_date: schedule.nextIssueDate, due_days: schedule.dueDays, remaining_count: schedule.remainingCount ?? "" } });
      if (error) throw error;
      if (!(await initializeFinancialLedger())) throw new Error("Schedule saved, but the ledger refresh failed");
    } else {
      state.invoiceSchedules = [schedule, ...(state.invoiceSchedules || []).filter((item) => item.templateInvoiceId !== invoice.id)];
      saveState({ localOnly: true });
    }
    els.invoiceScheduleDialog.close();
    renderInvoicesView();
    showToast(`Recurring schedule saved for ${invoice.invoiceNumber}`);
  } catch (error) {
    console.error("Invoice schedule failed", error);
    showToast(error?.message || "The schedule could not be saved");
  }
}

async function runRevenueAutomation() {
  if (!canManageManualPayments()) return;
  try {
    if (canUseCloudSync()) {
      const [{ data: created, error: recurringError }, { data: queued, error: noticeError }] = await Promise.all([
        cloudClient.rpc("crm_generate_due_recurring_invoices", { p_as_of: todayISO() }),
        cloudClient.rpc("crm_enqueue_due_notices", { p_as_of: todayISO() }),
      ]);
      if (recurringError) throw recurringError;
      if (noticeError) throw noticeError;
      if (!(await initializeFinancialLedger())) throw new Error("Automation ran, but the ledger refresh failed");
      renderInvoicesView();
      showToast(`${number(created)} recurring draft${number(created) === 1 ? "" : "s"} created · ${number(queued)} reminder${number(queued) === 1 ? "" : "s"} queued`);
      return;
    }
    showToast("Revenue automation requires the shared database");
  } catch (error) {
    console.error("Revenue automation failed", error);
    showToast(error?.message || "Revenue automation could not run");
  }
}

function renderInvoicesView() {
  if (!els.invoicesList) return;
  startSquarePoll();

  const estimates = [...visibleEstimates()].sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate));
  const financialInvoices = [...new Map([...estimates]
    .filter((estimate) => estimate.squareInvoiceId)
    .sort((a, b) => String(a.paymentUpdatedAt || "").localeCompare(String(b.paymentUpdatedAt || "")))
    .map((estimate) => [estimate.squareInvoiceId, estimate])).values()];
  const internalInvoices = (state.invoices || []).filter((invoice) => !leadIsArchived(invoice.contactId))
    .sort((a, b) => activityTimestamp(b.issueDate) - activityTimestamp(a.issueDate));
  // Voided invoices stay in the list below but are left out of every total.
  const liveInvoices = internalInvoices.filter((invoice) => invoice.status !== "void");
  const convertedEstimateIds = new Set(liveInvoices.map((invoice) => invoice.estimateId).filter(Boolean));
  const totalInvoiced = liveInvoices.reduce((sum, invoice) => sum + number(invoice.totalAmount), 0) + financialInvoices
    .filter((estimate) => !convertedEstimateIds.has(estimate.id))
    .reduce((sum, estimate) => sum + (number(estimate.contractValue) || totalsFor(estimate).total), 0);
  const ledgerEntries = financialLedgerEntries();
  // The same answer the Dashboard and Reports get: this browser's ledger once
  // every record is in, the database's checked figure before that, else none.
  const ledger = moneyTotalsForDisplay(ledgerEntries);
  const totalRefunds = ledger.refunds;
  const totalPaid = ledger.collected;
  const totalExpenses = ledger.expenses;
  // What customers still owe on issued invoices: each invoice's own balance,
  // plus the unpaid part of Square invoices. This used to be "invoiced minus
  // everything ever collected", which is $0 as soon as job payments exceed the
  // invoiced total, even with an invoice thousands of dollars overdue.
  const totalPending = internalInvoices.filter((invoice) => invoice.status !== "void").reduce((sum, invoice) => sum + invoiceOutstanding(invoice), 0) + financialInvoices
    .filter((estimate) => !convertedEstimateIds.has(estimate.id))
    .reduce((sum, estimate) => sum + Math.max((number(estimate.contractValue) || totalsFor(estimate).total) - number(estimate.paidAmount), 0), 0);
  const overdueInvoices = internalInvoices.filter((invoice) => invoiceAging(invoice).key === "overdue");
  // Totals wait for every job to load; half the jobs gives half the money.
  const pendingTotals = coreRecordsArePartial();
  const cash = (value) => (pendingTotals ? "…" : money.format(value));
  // Collected, refunded, expenses and margin can be known before the rest.
  const moneyCash = (value) => (ledger.ready ? money.format(value) : "…");

  const summaryBar = `
    <div class="invoice-summary-bar">
      <div class="invoice-summary-stat">
        <span class="invoice-summary-label" title="Total of invoices issued from the CRM and through Square, all time">Invoices issued</span>
        <span class="invoice-summary-value">${cash(totalInvoiced)}</span>
      </div>
      <div class="invoice-summary-stat">
        <span class="invoice-summary-label" title="Every confirmed payment on every job, with or without an invoice, less refunds. All time.">Collected</span>
        <span class="invoice-summary-value" style="color:var(--green)">${moneyCash(totalPaid)}</span>
      </div>
      <div class="invoice-summary-stat">
        <span class="invoice-summary-label">Refunded</span>
        <span class="invoice-summary-value">${moneyCash(totalRefunds)}</span>
      </div>
      <div class="invoice-summary-stat">
        <span class="invoice-summary-label" title="Unpaid balance on issued invoices">Owed on invoices</span>
        <span class="invoice-summary-value" style="color:var(--gold)">${cash(totalPending)}</span>
      </div>
      <div class="invoice-summary-stat">
        <span class="invoice-summary-label" title="Job costs and recorded expenses, all time">Expenses</span>
        <span class="invoice-summary-value">${moneyCash(totalExpenses)}</span>
      </div>
      <div class="invoice-summary-stat">
        <span class="invoice-summary-label" title="Collected minus expenses">Gross cash margin</span>
        <span class="invoice-summary-value">${moneyCash(totalPaid - totalExpenses)}</span>
      </div>
      <div class="invoice-summary-stat">
        <span class="invoice-summary-label">Overdue</span>
        <span class="invoice-summary-value ${!pendingTotals && overdueInvoices.length ? "invoice-overdue-value" : ""}">${pendingTotals ? "…" : overdueInvoices.length}</span>
      </div>
      <div class="row-actions"><span class="invoice-poll-indicator" id="squarePollIndicator" title="Checking Square for payments every 30s">⟳ Live</span>${canManageManualPayments() ? '<button class="secondary-button" type="button" data-run-revenue-automation>Run billing automation</button>' : ""}</div>
    </div>
  `;

  const internalInvoiceMarkup = `
    <section class="invoice-ledger-section">
      <div class="invoice-section-heading"><div><p class="eyebrow">Customer invoices</p><h3>Created from won estimates</h3></div><span class="status-pill">${internalInvoices.length}</span></div>
      ${internalInvoices.length ? `<div class="invoice-list-table">${internalInvoices.map((invoice) => {
        const contact = state.contacts.find((item) => item.id === invoice.contactId);
        const invoiceJob = contact && contactJobs(contact).find((item) => item.id === invoice.jobId);
        // While records are still loading, an invoice whose job is not in
        // memory yet has an unknown balance: the payments made on that job are
        // not known. Say so instead of showing it as unpaid, and do not offer
        // to take a payment against it.
        const balancePending = pendingTotals && Boolean(invoice.jobId) && !invoiceJob && invoice.status !== "void";
        const outstanding = invoiceOutstanding(invoice);
        const jobPaymentsApplied = jobPaymentsAppliedToInvoice(invoice);
        const aging = balancePending ? { key: "pending", label: invoice.status } : invoiceAging(invoice);
        const schedule = (state.invoiceSchedules || []).find((item) => item.templateInvoiceId === invoice.id && item.active);
        const expenses = (state.financialExpenses || []).filter((item) => item.jobId === invoice.jobId).reduce((sum, item) => sum + number(item.amount), 0);
        const grossProfit = number(invoice.amountPaid) - expenses;
        return `<article class="invoice-list-row">
          <div><strong>${escapeHtml(invoice.invoiceNumber)}</strong><small>${escapeHtml(contact?.name || (pendingTotals ? "Loading lead…" : "Unknown lead"))}${invoiceJob ? ` · ${escapeHtml(invoiceJob.name)}` : ""} · ${escapeHtml(aging.label)}</small>${schedule ? `<small>Repeats ${escapeHtml(schedule.cadence)} · next ${escapeHtml(formatDate(schedule.nextIssueDate))}</small>` : ""}</div>
          <span class="status-pill invoice-aging-${escapeHtml(aging.key)}">${escapeHtml(invoice.status === "void" ? "void" : !balancePending && outstanding <= 0 && number(invoice.totalAmount) > 0 && !["paid", "credited"].includes(invoice.status) ? "paid on job" : invoice.status)}</span>
          <div class="invoice-row-amount"><strong>${money.format(invoice.totalAmount)}</strong><small>${balancePending ? `Balance: ${escapeHtml(companyTotalsCaption().toLowerCase())}…` : `${money.format(outstanding)} outstanding${jobPaymentsApplied > 0 ? ` · ${money.format(jobPaymentsApplied)} covered by payments on the job` : ""} · ${money.format(grossProfit)} cash margin`}</small></div>
          <div class="row-actions invoice-row-actions">
            ${outstanding > 0 && !balancePending && canManageManualPayments() ? `<button class="primary-button" type="button" data-record-invoice-payment="${escapeHtml(invoice.id)}">Payment</button><button class="secondary-button" type="button" data-apply-invoice-credit="${escapeHtml(invoice.id)}">Credit</button>` : ""}
            ${canManageManualPayments() && invoice.status !== "void" ? `<button class="secondary-button" type="button" data-schedule-invoice="${escapeHtml(invoice.id)}">${schedule ? "Edit recurring" : "Recurring"}</button>` : ""}
            ${canManageManualPayments() && invoice.status !== "void" && !(number(invoice.amountPaid) > 0) ? `<button class="secondary-button" type="button" data-void-invoice="${escapeHtml(invoice.id)}">Void</button>` : ""}
            <button class="secondary-button" type="button" data-action="open-job" data-contact-id="${escapeHtml(invoice.contactId)}" data-job-id="${escapeHtml(invoice.jobId || "")}">Open job</button>
          </div>
        </article>`;
      }).join("")}</div>` : '<div class="empty-state compact-empty">No internal invoices yet. Convert a won estimate below.</div>'}
    </section>
  `;
  const ledgerMarkup = (kinds, title, emptyMessage) => {
    const entries = ledgerEntries.filter((entry) => kinds.includes(entry.kind));
    return `
    <section class="invoice-ledger-section">
      <div class="invoice-section-heading"><div><p class="eyebrow">Financial ledger</p><h3>${escapeHtml(title)}</h3></div><span class="status-pill">${entries.length}</span></div>
      ${entries.length ? `<div class="financial-ledger-list">${entries.slice(0, 50).map((entry) => {
        const contact = state.contacts.find((item) => item.id === entry.contactId);
        const job = contact && contactJobs(contact).find((item) => item.id === entry.jobId);
        return `<div class="financial-ledger-row" role="button" tabindex="0" data-action="open-job" data-contact-id="${escapeHtml(entry.contactId)}" data-job-id="${escapeHtml(entry.jobId)}">
          <span class="ledger-kind ledger-kind-${entry.direction}">${escapeHtml(entry.kind)}</span>
          <span><strong>${escapeHtml(entry.label || entry.kind)}</strong><small>${escapeHtml(contact?.name || "Unknown lead")} · ${escapeHtml(job?.name || "Job")} · ${escapeHtml(entry.detail || "")}</small></span>
          <time>${escapeHtml(formatDate(entry.at))}</time>
          <strong class="ledger-amount ${entry.direction}">${["expense","refund"].includes(entry.direction) ? "−" : entry.direction === "credit" ? "+" : ""}${money.format(entry.amount)}</strong>
          ${entry.kind === "Payment" && entry.paymentId && canManageManualPayments() && number(entry.amount) - paymentRefundTotal(entry.paymentId) > 0 ? `<span class="ledger-actions"><button class="secondary-button" type="button" data-refund-payment="${escapeHtml(entry.paymentId)}">Refund</button></span>` : ""}
        </div>`;
      }).join("")}</div>` : `<div class="empty-state compact-empty">${escapeHtml(emptyMessage)}</div>`}
    </section>
  `; };
  const financeTabs = `
    <div class="finance-tabs" role="tablist" aria-label="Billing sections">
      ${[["invoices","Invoices"],["payments","Payments"],["expenses","Expenses"],["credits","Credits"]].map(([key,label]) => `<button type="button" role="tab" class="finance-tab ${state.financeTab === key ? "active" : ""}" aria-selected="${state.financeTab === key}" data-finance-tab="${key}">${label}</button>`).join("")}
    </div>`;
  const billingQueueHeading = '<div class="invoice-section-heading billing-queue-heading"><div><p class="eyebrow">Billing queue</p><h3>Won estimates and Square delivery</h3></div></div>';

  // The queue is what is ready to bill: won estimates, and anything already
  // sent through Square or invoiced. It used to list every estimate, drafts
  // and $0 ones included.
  const billingQueue = estimates.filter((estimate) => estimate.status === "Won" || estimate.squareInvoiceId || internalInvoiceForEstimate(estimate.id));
  const invoiceWorkspace = internalInvoiceMarkup + billingQueueHeading + (billingQueue.length
    ? billingQueue.map((estimate) => {
        const contact = getEstimateContact(estimate);
        const totals = totalsFor(estimate);
        const contractValue = number(estimate.contractValue) || totals.total;
        const paidAmount = number(estimate.paidAmount);
        const paymentPercent = contractValue ? Math.min(100, (paidAmount / contractValue) * 100) : 0;
        const isPaid = paymentPercent >= 100 || estimate.squareStatus === "PAID";
        const isSent = !!estimate.squareInvoiceId && !isPaid;
        const canSend = currentRole() === "admin" && !estimate.squareInvoiceId && estimate.status === "Won" && Boolean(contact?.email);
        const internalInvoice = internalInvoiceForEstimate(estimate.id);
        const linkedJob = contact && contactJobs(contact).find((item) => item.id === estimate.jobId);
        const canConvert = currentRole() === "admin" && estimate.status === "Won" && linkedJob?.status === "Won" && !internalInvoice;
        const emailDraft = estimate.squareInvoiceUrl && !isPaid
          ? squareInvoiceEmailDraft(estimate, contact)
          : null;
        const emailPaymentUrl = emailDraft
          ? gmailComposeUrl(contact?.email || estimate.squareRecipientEmail || "", emailDraft.subject, emailDraft.message)
          : "";
        const initials = contactInitials(contact?.name || "?");
        const avatarClass = initialsColor(contact?.name || "");

        return `
          <article class="record-card ${isPaid ? "invoice-paid" : ""}">
            <div class="record-card-top">
              <div class="lead-card-avatar ${avatarClass}" style="width:36px;height:36px;font-size:13px;flex-shrink:0">${escapeHtml(initials)}</div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <strong>${escapeHtml(estimate.projectNumber || estimate.leadNumber || estimate.estimateNumber)}</strong>
                  ${squareStatusPill(estimate)}
                </div>
                <span style="font-size:12px;color:var(--muted)">${escapeHtml(estimate.estimateNumber)}</span>
                ${estimate.status === "Won" ? `<span style="display:block;font-size:12px;color:var(--muted);margin-top:3px">Square recipient: ${escapeHtml(contact?.email || "No customer email on file")}</span>` : ""}
                <span style="font-size:12px;color:var(--muted)">${escapeHtml(contact?.name || "Unknown")} · ${escapeHtml(estimate.projectTitle || "")}</span>
              </div>
              <strong style="font-size:15px;white-space:nowrap">${money.format(contractValue)}</strong>
            </div>
            ${estimate.squareInvoiceId ? paymentProgressMarkup({ contractValue, paidAmount }, { compact: true }) : ""}
            ${isPaid ? `<p style="font-size:12px;color:var(--green);margin:4px 0 0">Paid ${estimate.paidAt ? formatDate(estimate.paidAt) : ""} via Square</p>` : ""}
            ${isSent && estimate.squareInvoiceUrl ? `
              <div class="invoice-delivery-note">
                <strong>Published in Square</strong>
                <span>Square email delivery is not confirmed. If the customer does not receive it, email the secure payment link below.</span>
              </div>
              <p style="font-size:12px;color:var(--muted);margin:4px 0 0">Awaiting payment · <a href="${escapeHtml(estimate.squareInvoiceUrl)}" target="_blank" rel="noopener" class="tel-link">View payment page ↗</a></p>
            ` : ""}
            <div class="row-actions" style="margin-top:8px">
              ${canConvert ? `
                <button class="primary-button" type="button" data-create-invoice="${estimate.id}">
                  <span aria-hidden="true" data-icon="file"></span>
                  Create Invoice
                </button>
              ` : ""}
              ${internalInvoice ? `<span class="status-pill pill-won">${escapeHtml(internalInvoice.invoiceNumber)} created</span>` : ""}
              ${canSend ? `
                <button class="primary-button" type="button" data-square-send="${estimate.id}">
                  <span aria-hidden="true" data-icon="send"></span>
                  Send to Square
                </button>
              ` : ""}
              ${emailPaymentUrl ? `
                <a class="primary-button" href="${escapeHtml(emailPaymentUrl)}" target="_blank" rel="noopener">
                  <span aria-hidden="true" data-icon="send"></span>
                  Email payment link
                </a>
                <button class="secondary-button" type="button" data-square-copy="${estimate.id}">
                  Copy payment link
                </button>
              ` : ""}
              <button class="secondary-button" type="button" data-action="select-estimate" data-estimate-id="${estimate.id}">
                <span aria-hidden="true" data-icon="file"></span>
                Open Estimate
              </button>
            </div>
          </article>
        `;
      }).join("")
    : '<div class="empty-state">Won estimates will appear here for an administrator to send through Square</div>');

  const activeWorkspace = state.financeTab === "invoices"
    ? invoiceWorkspace
      : state.financeTab === "payments"
        ? ledgerMarkup(["Payment","Refund"], "Payments and refunds", "No payments have been recorded yet.")
      : state.financeTab === "expenses"
        ? `${canManageManualPayments() ? '<div class="finance-action-bar"><button class="primary-button" type="button" data-add-finance-expense><span aria-hidden="true" data-icon="plus"></span>Record Expense</button></div>' : ""}${ledgerMarkup(["Expense"], "Job expenses", "Job costs recorded under Profit & Cost will appear here.")}`
        : ledgerMarkup(["Credit"], "Applied credit notes", "No credits have been applied yet.");
  els.invoicesList.innerHTML = summaryBar + financeTabs + activeWorkspace;

  hydrateIcons(els.invoicesList);

  // Wire up provider-backed invoice actions only. Payment state is reconciled
  // by the server and cannot be fabricated by an unrendered client control.
  els.invoicesList.querySelectorAll("[data-square-send]").forEach((btn) => {
    btn.addEventListener("click", () => sendToSquare(btn.dataset.squareSend));
  });
  els.invoicesList.querySelectorAll("[data-square-copy]").forEach((btn) => {
    btn.addEventListener("click", () => copySquareInvoiceLink(btn.dataset.squareCopy));
  });
  els.invoicesList.querySelectorAll("[data-create-invoice]").forEach((btn) => {
    btn.addEventListener("click", () => createInternalInvoiceFromEstimate(btn.dataset.createInvoice));
  });
  els.invoicesList.querySelectorAll("[data-finance-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.financeTab = btn.dataset.financeTab;
      saveUiState();
      renderInvoicesView();
    });
  });
  els.invoicesList.querySelectorAll("[data-record-invoice-payment]").forEach((btn) => {
    btn.addEventListener("click", () => openInvoicePaymentDialog(btn.dataset.recordInvoicePayment));
  });
  els.invoicesList.querySelectorAll("[data-apply-invoice-credit]").forEach((btn) => {
    btn.addEventListener("click", () => openInvoiceCreditDialog(btn.dataset.applyInvoiceCredit));
  });
  els.invoicesList.querySelectorAll("[data-refund-payment]").forEach((btn) => {
    btn.addEventListener("click", (event) => { event.stopPropagation(); openInvoiceRefundDialog(btn.dataset.refundPayment); });
  });
  els.invoicesList.querySelectorAll("[data-schedule-invoice]").forEach((btn) => {
    btn.addEventListener("click", () => openInvoiceScheduleDialog(btn.dataset.scheduleInvoice));
  });
  els.invoicesList.querySelectorAll("[data-void-invoice]").forEach((btn) => {
    btn.addEventListener("click", () => voidInvoice(btn.dataset.voidInvoice));
  });
  els.invoicesList.querySelector("[data-add-finance-expense]")?.addEventListener("click", openFinanceExpenseDialog);
  els.invoicesList.querySelector("[data-run-revenue-automation]")?.addEventListener("click", runRevenueAutomation);
}

function reviewRequestEmail(contact) {
  const reviewUrl = state.company.googleReviewUrl || "";
  const repName = state.currentUser.name || state.company.name;
  const reviewLine = reviewUrl
    ? `We'd love to hear about your experience! It would mean a lot if you could take a moment to leave us a review:\n\n${reviewUrl}\n\nIt only takes a minute and helps us continue doing great work for homeowners like you.`
    : `We'd love to hear about your experience! If you have a moment, please leave us a review on Google — it helps us continue doing great work for homeowners like you.`;
  return {
    toEmail: contact.email || "",
    subject: `How did we do, ${contact.name.split(" ")[0]}? — ${state.company.name}`,
    message: `Hi ${contact.name.split(" ")[0]},\n\nThank you so much for choosing ${state.company.name}! It was a pleasure working on your project and we hope you're thrilled with the results.\n\n${reviewLine}\n\nThank you again for your trust and business. Please don't hesitate to reach out if there's anything else we can help with.\n\nWarm regards,\n${repName}\n${state.company.name}\n${state.currentUser.phone || state.company.phone || ""}`,
  };
}

// The stage at which a job's work has been delivered, so a review can be asked for.
const deliveredStageByDivision = { roofing: "Completed", construction: "Final Walkthrough", services: "Completed" };
function jobIsDelivered(job = {}) {
  if (job.status === "Paid") return true;
  if (job.status === "Lost") return false;
  const division = job.division || "roofing";
  const stages = pipelineStagesFor(division);
  const deliveredFrom = stages.indexOf(deliveredStageByDivision[division] || "Completed");
  const index = stages.indexOf(job.status);
  return deliveredFrom >= 0 && index >= deliveredFrom;
}

// Remembers that a review was asked for, so nobody asks the same customer twice
// by accident. The email itself opens in the user's own mail program.
function markReviewRequested(contactId, jobId) {
  const contact = getContact(contactId);
  const job = contact && contactJobs(contact).find((item) => item.id === jobId);
  if (!contact || !job) return;
  const now = new Date().toISOString();
  updateContact(contactId, (current) => ({
    ...current,
    jobs: contactJobs(current).map((item) => item.id === jobId ? { ...item, reviewRequestedAt: now, reviewRequestedBy: state.currentUser.name || state.currentUser.email || "" } : item),
    updates: [{ id: uid("update"), author: state.currentUser.name || "CRM user", jobId, message: `Review request opened for ${job.name}.`, createdAt: now }, ...(current.updates || [])],
  }));
  saveState();
  renderReviewsView();
}

function renderReviewsView() {
  if (!els.reviewsList) return;
  // Only customers whose work has actually been delivered. This list used to
  // include every customer record, so leads at New or Contacted were offered a
  // review request.
  const customers = visibleContacts()
    .map((contact) => ({ contact, job: contactJobs(contact).filter(jobIsDelivered).sort((a, b) => activityTimestamp(b.closedDate || b.updatedAt) - activityTimestamp(a.closedDate || a.updatedAt))[0] }))
    .filter((entry) => entry.job)
    .sort((a, b) => Number(Boolean(a.job.reviewRequestedAt)) - Number(Boolean(b.job.reviewRequestedAt)) || activityTimestamp(b.job.closedDate || b.job.updatedAt) - activityTimestamp(a.job.closedDate || a.job.updatedAt));
  const hasReviewUrl = !!state.company.googleReviewUrl;

  const warningBanner = !hasReviewUrl ? `
    <div class="review-warning">
      <span data-icon="alert-triangle" aria-hidden="true"></span>
      ${canView("company")
        ? `No Google Review link saved yet — <button class="link-button" type="button" data-action="go-to-settings">add it in Settings</button> so it's included in every request.`
        : "No Google Review link saved yet. Ask an administrator to add it in Settings so it's included in every request."}
    </div>
  ` : "";

  els.reviewsList.innerHTML = warningBanner + (customers.length
    ? customers.map(({ contact, job }) => {
        const initials = contactInitials(contact.name);
        const avatarClass = initialsColor(contact.name);
        const email = contact.email || "";
        const requested = job.reviewRequestedAt ? `Review requested ${formatDate(job.reviewRequestedAt)}${job.reviewRequestedBy ? ` by ${job.reviewRequestedBy}` : ""}` : "";
        return `
          <article class="record-card">
            <div class="record-card-top">
              <div class="lead-card-avatar ${avatarClass}" style="width:36px;height:36px;font-size:13px;flex-shrink:0">${escapeHtml(initials)}</div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <strong>${escapeHtml(contact.name)}</strong>
                  <span class="status-pill ${statusPillClass(job.status)}">${escapeHtml(leadStatusLabel(job.status))}</span>
                </div>
                <span style="font-size:12px;color:var(--muted)">${escapeHtml(job.name || "Completed job")} &middot; ${escapeHtml(email || "No email saved")}</span>
                ${requested ? `<span style="display:block;font-size:12px;color:var(--green)">${escapeHtml(requested)}</span>` : ""}
              </div>
            </div>
            <div class="row-actions" style="margin-top:8px">
              ${email ? `
                <a class="${requested ? "secondary-button" : "primary-button"}"
                  href="${mailtoUrl(email, reviewRequestEmail(contact).subject, reviewRequestEmail(contact).message)}"
                  data-review-request
                  data-contact-id="${contact.id}"
                  data-job-id="${job.id}">
                  <span aria-hidden="true" data-icon="star"></span>
                  ${requested ? "Send Again" : "Send Review Request"}
                </a>
              ` : `<span style="font-size:12px;color:var(--muted)">No email address on file</span>`}
              <button class="secondary-button" type="button" data-action="open-job" data-contact-id="${contact.id}" data-job-id="${job.id}">
                <span aria-hidden="true" data-icon="open"></span>
                Open
              </button>
            </div>
          </article>
        `;
      }).join("")
    : '<div class="empty-state">Customers appear here once their job is completed, so you can ask for a review.</div>');

  els.reviewsList.querySelectorAll("[data-review-request]").forEach((link) => {
    // Let the mail program open first, then record the request.
    link.addEventListener("click", () => window.setTimeout(() => markReviewRequested(link.dataset.contactId, link.dataset.jobId), 400));
  });
  hydrateIcons(els.reviewsList);
}

function renderReportsView() {
  if (!els.reportsContent) return;
  const metrics = dashboardMetrics();
  // Credit reps when a job is sold, not only once it is fully paid.
  // Sold means sold in the job's own division (Won, Contract, Scheduled...),
  // not only the roofing stage names.
  const repRows = aggregateCounts(
    allJobs().filter((job) => soldJobStatuses.includes(job.status) || jobIsSold(job)),
    (job) => canonicalRepresentativeName(job.salesRep || "Unassigned", job) || "Unassigned",
    (job) => number(job.contractValue) || number(job.value),
  );
  // The same ledger Billing uses: job payments and costs as well as invoice
  // payments and recorded expenses. Reports used to read only the invoice
  // tables and showed $0 collected beside a Billing page showing six figures.
  const ledgerEntries = financialLedgerEntries();
  // The same answer the Dashboard and Billing get (see moneyTotalsForDisplay).
  const ledger = moneyTotalsForDisplay(ledgerEntries);
  const expenses = ledger.expenses, refunds = ledger.refunds, collected = ledger.collected, grossProfit = collected - expenses;
  const sourceRows=aggregateCounts(visibleContacts(),(contact)=>leadSourceLabel(contact.source),(contact)=>contactJobs(contact).filter((job)=>soldJobStatuses.includes(job.status) || jobIsSold(job)).length);
  const paymentMethodRows=aggregateCounts(ledgerEntries.filter((entry)=>entry.kind==="Payment"),(entry)=>entry.label||"Other",(entry)=>number(entry.amount));
  const aging={current:0,days30:0,days60:0,days90:0};state.invoices.forEach((invoice)=>{const due=Math.max(0,invoiceOutstanding(invoice));if(!due)return;const days=Math.floor((Date.now()-new Date(invoice.dueDate||invoice.issueDate||Date.now()).getTime())/86400000);if(days<=0)aging.current+=due;else if(days<=30)aging.days30+=due;else if(days<=60)aging.days60+=due;else aging.days90+=due;});
  const billableHours=state.jobTimeEntries.filter((item)=>item.billable).reduce((sum,item)=>sum+number(item.minutes),0)/60;const activeGoals=(state.crmGoals||[]).filter((goal)=>goal.status==="active");
  // Company-wide figures wait for every record to load (see dashboardMetrics).
  const shown = (value) => (metrics.pending ? "…" : value);
  // The tables below are totals too. Filled from a partly loaded set they
  // showed figures that did not add up to the cards above them.
  const tableRows = (columns, rows, emptyText) => (metrics.pending
    ? `<tr><td colspan="${columns}"><div class="empty-state">${escapeHtml(companyTotalsCaption())}…</div></td></tr>`
    : rows || `<tr><td colspan="${columns}">${emptyText}</td></tr>`);
  els.reportsContent.innerHTML = `
    <article class="report-card">
      <span class="eyebrow">Pipeline</span>
      <strong>${shown(money.format(metrics.pipelineValue))}</strong>
      <span>${metrics.pending ? companyTotalsCaption() : `${metrics.openContracts} open jobs · value of all jobs not lost`}</span>
    </article>
    <article class="report-card">
      <span class="eyebrow">Revenue Collected</span>
      <strong>${metrics.moneyReady ? money.format(metrics.closedValue) : "…"}</strong>
      <span>${metrics.pending ? (metrics.moneyReady ? "All confirmed payments" : companyTotalsCaption()) : `All confirmed payments · ${metrics.closedJobs} jobs paid in full`}</span>
    </article>
    <article class="report-card">
      <span class="eyebrow">Estimates Sent</span>
      <strong>${shown(metrics.estimatesSent)}</strong>
      <span>${visibleEstimates().length} total estimates</span>
    </article>
    <article class="report-card wide">
      <span class="eyebrow">Rep production · sold jobs</span>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Sales Representative</th>
              <th>Sold Jobs</th>
              <th>Sold Contract Value</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows(3, repRows
              .map(
                (rep) => `
                  <tr>
                    <td>${escapeHtml(rep.label)}</td>
                    <td>${rep.count}</td>
                    <td>${money.format(rep.value)}</td>
                  </tr>
                `,
              )
              .join(""), '<div class="empty-state">No sold jobs yet</div>')}
          </tbody>
        </table>
      </div>
    </article>
    <article class="report-card"><span class="eyebrow">Gross cash margin</span><strong>${ledger.ready ? money.format(grossProfit) : "…"}</strong><span>${!ledger.ready ? companyTotalsCaption() : `${money.format(collected)} collected · ${money.format(expenses)} expenses${refunds ? ` · ${money.format(refunds)} refunded` : ""}`}</span></article>
    <article class="report-card"><span class="eyebrow">Billable time</span><strong>${billableHours.toFixed(1)} hours</strong><span>${state.jobTimeEntries.length} time entries</span></article>
    <article class="report-card"><span class="eyebrow">Goals</span><strong>${activeGoals.length}</strong><span>active sales and production goals</span></article>
    <article class="report-card wide"><span class="eyebrow">Invoice aging</span><div class="report-metric-row"><span>Current <strong>${shown(money.format(aging.current))}</strong></span><span>1–30 days <strong>${shown(money.format(aging.days30))}</strong></span><span>31–60 days <strong>${shown(money.format(aging.days60))}</strong></span><span>61+ days <strong>${shown(money.format(aging.days90))}</strong></span></div></article>
    <article class="report-card wide"><span class="eyebrow">Lead source conversion</span><div class="table-wrap"><table class="data-table"><thead><tr><th>Source</th><th>Leads</th><th>Won jobs</th></tr></thead><tbody>${tableRows(3, sourceRows.map((row)=>`<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${row.value}</td></tr>`).join(""), "No source data")}</tbody></table></div></article>
    <article class="report-card wide"><span class="eyebrow">Payment methods</span><div class="table-wrap"><table class="data-table"><thead><tr><th>Method</th><th>Payments</th><th>Collected</th></tr></thead><tbody>${tableRows(3, paymentMethodRows.map((row)=>`<tr><td>${escapeHtml(row.label)}</td><td>${row.count}</td><td>${money.format(row.value)}</td></tr>`).join(""), "No payment data")}</tbody></table></div></article>
  `;
}

async function initializeReportsAndGoals(){if(!cloudReady||!cloudClient||!authSession?.user?.id)return true;try{const [goals,exports]=await Promise.all([cloudClient.from("crm_goals").select("*").eq("company_state_id",supabaseStateId()),cloudClient.from("crm_report_exports").select("*").eq("company_state_id",supabaseStateId())]);if(goals.error)throw goals.error;if(exports.error)throw exports.error;state.crmGoals=goals.data||[];state.reportExports=exports.data||[];saveState({localOnly:true});return true;}catch(error){console.warn("Reports and goals could not be loaded",error);return false;}}

async function initializeAdministration(){if(!cloudReady||!cloudClient||!authSession?.user?.id)return true;const tables=["crm_tax_rates","crm_payment_methods","crm_role_capabilities","crm_announcements","crm_operational_settings"];try{const results=await Promise.all(tables.map((table)=>cloudClient.from(table).select("*").eq("company_state_id",supabaseStateId())));const failed=results.find((result)=>result.error);if(failed)throw failed.error;[state.taxRates,state.paymentMethods,state.roleCapabilities,state.announcements,state.operationalSettings]=results.map((result)=>result.data||[]);saveState({localOnly:true});return true;}catch(error){console.warn("Administration configuration could not be loaded",error);return false;}}

function renderAdministration(){if(!els.adminOperationsSettings)return;els.adminOperationsSettings.classList.toggle("hidden",!canManageTeamData());if(!canManageTeamData())return;els.adminTaxList.innerHTML=state.taxRates.length?state.taxRates.map((item)=>`<article><strong>${escapeHtml(item.name)}</strong><span>${(number(item.rate)*100).toFixed(3).replace(/\.?0+$/,"")}% · ${item.active===false?"Inactive":"Active"}</span></article>`).join(""):'<div class="empty-state">No tax rates configured.</div>';els.adminConfigurationSummary.innerHTML=`<article class="report-card"><span class="eyebrow">Payment methods</span><strong>${state.paymentMethods.filter((item)=>item.active!==false).length}</strong><span>${state.paymentMethods.filter((item)=>item.active!==false).map((item)=>escapeHtml(item.name)).join(", ")||"Defaults load after migration"}</span></article><article class="report-card"><span class="eyebrow">Role capabilities</span><strong>${state.roleCapabilities.length}</strong><span>granular permission rules</span></article><article class="report-card"><span class="eyebrow">Announcements</span><strong>${state.announcements.filter((item)=>item.active!==false).length}</strong><span>active team notices</span></article><article class="report-card"><span class="eyebrow">Templates</span><strong>${state.projectTemplates.length+state.documentTemplates.length}</strong><span>project and document templates</span></article>`;if(els.customerPortalLead)els.customerPortalLead.innerHTML=['<option value="">Choose lead</option>',...visibleContacts().map((contact)=>`<option value="${escapeHtml(contact.id)}">${escapeHtml(contact.name)} · ${escapeHtml(contact.email||"no email")}</option>`)].join("");}

async function saveAdminTax(event){event.preventDefault();const form=event.currentTarget;if(!requireAction("manageCompany"))return;const data=new FormData(form);const item={id:uid("tax"),name:String(data.get("name")||"").trim(),rate:number(data.get("rate"))/100,active:true};if(!item.name||item.rate<0||item.rate>1)return showToast("Enter a valid tax name and percentage");try{if(canUseCloudSync()){const {error}=await cloudClient.from("crm_tax_rates").insert({company_state_id:supabaseStateId(),id:item.id,name:item.name,rate:item.rate,active:true,created_by:authSession.user.id,updated_by:authSession.user.id});if(error)throw error;await initializeAdministration();}else{state.taxRates.push(item);saveState({localOnly:true});}form.reset();renderAdministration();showToast("Tax rate added");}catch(error){showToast(error?.message||"Tax rate could not be added");}}

async function saveAdminAnnouncement(event){event.preventDefault();const form=event.currentTarget;if(!requireAction("manageCompany"))return;const data=new FormData(form);const item={id:uid("announcement"),title:String(data.get("title")||"").trim(),body:String(data.get("body")||"").trim(),audience_role:String(data.get("audience")||"all"),dismissible:data.get("dismissible")==="on",active:true};if(!item.title||!item.body)return;try{if(canUseCloudSync()){const {error}=await cloudClient.from("crm_announcements").insert({company_state_id:supabaseStateId(),...item,created_by:authSession.user.id,updated_by:authSession.user.id});if(error)throw error;await initializeAdministration();}else{state.announcements.unshift(item);saveState({localOnly:true});}form.reset();renderAdministration();showToast("Announcement published");}catch(error){showToast(error?.message||"Announcement could not be published");}}

async function inviteCustomerPortal(event){event.preventDefault();const form=event.currentTarget;if(!requireAction("manageCompany"))return;const data=new FormData(form);const leadId=String(data.get("leadId")||"");const contact=getContact(leadId);const email=String(data.get("email")||"").trim();if(!contact||!email)return;setSaveState(els.customerPortalInviteStatus,"Sending secure portal invitation…","saving");try{const headers=await squareApiHeaders();const response=await fetch("/api/admin/customer-invitations",{method:"POST",headers:{"Content-Type":"application/json",...headers},body:JSON.stringify({leadId,email,displayName:contact.name}),signal:AbortSignal.timeout(20000)});const result=await response.json().catch(()=>({}));if(!response.ok)throw new Error(result.error||"Invitation failed");setSaveState(els.customerPortalInviteStatus,`Portal invitation sent to ${email}`,"success");form.reset();renderAdministration();}catch(error){setSaveState(els.customerPortalInviteStatus,error?.message||"Portal invitation failed","error");}}

async function exportPerformanceReport(){if(coreRecordsArePartial()&&!(await ensureCompleteCoreRecordsLoaded()))return showToast("The report was not exported because the full record set is still loading. Try again in a moment.");const exportLedger=ledgerTotals();const rows=[["Report","Value"],["Pipeline",dashboardMetrics().pipelineValue],["Collected",exportLedger.collected],["Expenses",exportLedger.expenses],["Billable hours",(state.jobTimeEntries.filter((item)=>item.billable).reduce((sum,item)=>sum+number(item.minutes),0)/60).toFixed(2)]];const csv=rows.map((row)=>row.map((value)=>`"${String(value).replaceAll('"','""')}"`).join(",")).join("\r\n");const blob=new Blob([csv],{type:"text/csv"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`jobcrest-performance-${todayISO()}.csv`;link.click();URL.revokeObjectURL(url);if(canUseCloudSync())await cloudClient.from("crm_report_exports").insert({company_state_id:supabaseStateId(),id:uid("reportexport"),report_type:"performance",filters:{},row_count:rows.length-1,requested_by:authSession.user.id});}

async function exportPerformanceReportToGoogleSheets() {
  if (!requireAction("manageCompany")) return;
  if (coreRecordsArePartial() && !(await ensureCompleteCoreRecordsLoaded())) return showToast("The report was not exported because the full record set is still loading. Try again in a moment.");
  const metrics = dashboardMetrics();
  // The same figures the Dashboard, Billing, Reports and the CSV export show.
  // "Collected" and "Expenses" here used to add up the invoice tables only,
  // which left out every payment and cost recorded on a job.
  const exportLedger = ledgerTotals();
  const headers = ["Report", "Value"];
  const rows = [
    ["Pipeline", metrics.pipelineValue],
    ["Collected", exportLedger.collected],
    ["Expenses", exportLedger.expenses],
    ["Billable hours", Number((state.jobTimeEntries.filter((item) => item.billable).reduce((sum, item) => sum + number(item.minutes), 0) / 60).toFixed(2))],
    ...aggregateCounts(allJobs().filter((job) => soldJobStatuses.includes(job.status)), (job) => canonicalRepresentativeName(job.salesRep || "Unassigned", job) || "Unassigned", (job) => number(job.contractValue) || number(job.value))
      .map((rep) => [`Sold · ${rep.label} · ${rep.count} jobs`, rep.value]),
  ];
  try {
    const headersAuth = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/sheets/export", {
      method: "POST", headers: { "Content-Type": "application/json", ...headersAuth }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ title: `JobCrest Performance ${todayISO()}`, headers, rows }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.exported !== true || !/^https:\/\/docs\.google\.com\/spreadsheets\//.test(result.webViewLink || "")) throw new Error(result.error || "Google Sheets export failed.");
    window.open(result.webViewLink, "_blank", "noopener,noreferrer");
    if (canUseCloudSync()) await cloudClient.from("crm_report_exports").insert({
      company_state_id: supabaseStateId(), id: uid("reportexport"), report_type: "google_sheets_performance",
      filters: { spreadsheetId: result.spreadsheetId, webViewLink: result.webViewLink, exportedAt: new Date().toISOString() },
      row_count: rows.length, requested_by: authSession.user.id,
    });
    showToast("Google Sheets report created");
  } catch (error) { showToast(error.message || "Google Sheets report could not be created"); }
}

function estimateLeadSearchMatches(query = "") {
  const contacts = visibleContacts();
  const normalized = normalizeLeadSearch(query);
  const matches = normalized
    ? contacts.filter((contact) => contactMatchesSearch(contact, query))
    : [...contacts].sort((left, right) => left.name.localeCompare(right.name));
  return matches.slice(0, 30);
}

