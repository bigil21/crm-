function renderLeadProfit(contact) {
  if (!els.leadProfitPanel) return;
  if (!canManageJobFinancials()) {
    els.leadProfitPanel.innerHTML = '<div class="empty-state">Profit and cost is restricted to upper admin.</div>';
    return;
  }

  const selected = selectedProfitJob(contact);

  if (els.profitJobSelect) {
    els.profitJobSelect.innerHTML = jobContextOptions(contact, selected?.id);
  }

  const metrics = jobProfitMetrics(selected);
  if (els.profitSummary) {
    els.profitSummary.innerHTML = [
      ["Contract Value", money.format(metrics.contractValue), "Customer/job value"],
      ["Total Cost", money.format(metrics.totalCost), `${selected.costItems.length} cost line${selected.costItems.length === 1 ? "" : "s"}`],
      ["Projected Profit", money.format(metrics.profit), `${metrics.margin.toFixed(1)}% gross margin`],
    ]
      .map(
        ([label, value, caption]) => `
          <article class="summary-card">
            <span class="eyebrow">${label}</span>
            <strong>${escapeHtml(value)}</strong>
            <span>${escapeHtml(caption)}</span>
          </article>
        `,
      )
      .join("");
  }

  if (els.profitCostList) {
    const rows = [...(selected.costItems || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    els.profitCostList.innerHTML = rows.length
      ? rows
          .map(
            (item) => `
              <article class="cost-card">
                <div>
                  <span class="status-pill">${escapeHtml(item.category)}</span>
                  <strong>${money.format(number(item.amount))}</strong>
                  <span>${escapeHtml(item.vendor || "No vendor")} - ${escapeHtml(formatDate(item.date))}</span>
                  <p>${nl2br(item.description || "No description")}</p>
                  <small>${escapeHtml(item.reference || "No reference")} ${item.paid ? "- Paid" : "- Unpaid"}</small>
                </div>
                <div class="row-actions">
                  <button class="mini-button" type="button" title="Edit cost" aria-label="Edit cost" data-action="edit-cost-item" data-cost-id="${item.id}">
                    <span aria-hidden="true" data-icon="edit"></span>
                  </button>
                  <button class="mini-button" type="button" title="Delete cost" aria-label="Delete cost" data-action="delete-cost-item" data-cost-id="${item.id}">
                    <span aria-hidden="true" data-icon="trash"></span>
                  </button>
                </div>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-state">No costs have been entered for this job yet.</div>';
    hydrateIcons(els.profitCostList);
  }
}

function manualPaymentRows(job) {
  if (job?.paymentLedgerVersion !== 2) return job?.manualPayments || [];
  return (state.jobLedgerPayments || []).filter((row) => row.jobId === job.id && row.origin === "job")
    .map((row) => ({ ...row, date: row.receivedAt.slice(0, 10), createdBy: row.created_by }));
}

// Read back the job projection too: the payment row and stage were committed in one
// transaction, but realtime notification delivery can lag (or be disconnected).
async function refreshLedgerJobInView(contactId, jobId) {
  const job = getContact(contactId)?.jobs?.find(row => row.id === jobId);
  if (job?.paymentLedgerVersion !== 2) return;
  const shared = await cloudClient.from("crm_records").select("*").eq("company_state_id", supabaseStateId()).eq("lead_id",contactId).eq("record_type","job").eq("id",jobId).single();
  if (shared.error || !shared.data) throw Error("Payment change was saved. Reload to refresh the job balance.");
  if (getDurableCommitWriter().getVersion(shared.data) >= shared.data.version) return;
  if (durableSaveInFlight || hasPendingDurableChanges() || !applyDurableRealtimeRecord(shared.data)) queueDurableRecordsReload();
}

async function writeCanonicalJobPayment(job, id, payment, expected) {
  const form = els.manualPaymentForm;
  if (form.dataset.submitting === "true") return;
  form.dataset.submitting = "true";
  els.manualPaymentSaveButton.disabled = true;
  let committed = false;
  try {
    if (!cloudReady || !financialLedgerReady || !cloudClient) throw Error("The shared payment ledger is not available.");
    if (durableSaveInFlight || hasPendingDurableChanges()) throw Error("Finish saving your other changes before recording a payment.");
    const result = await cloudClient.rpc("crm_write_job_payment", { p_job: job.id, p_id: id, p_payment: payment, p_expected: expected || null });
    if (result.error) throw result.error;
    if (result.data?.id !== id || (!payment && result.data?.deleted !== true)) throw Error("Payment receipt was not confirmed.");
    committed = true;
    if (!await initializeFinancialLedger()) throw Error("refresh");
    await refreshLedgerJobInView(result.data.lead_id || getSelectedContact()?.id, job.id);
    delete form.dataset.pendingId;
    delete form.dataset.expectedVersion;
    fillManualPaymentForm();
    render();
    setSaveState(els.manualPaymentSaveStatus, payment ? "Payment saved to the shared CRM." : "Payment deleted.", "success");
  } catch (error) {
    setSaveState(els.manualPaymentSaveStatus, committed ? "Payment change was saved. Reload to see the updated balance; do not enter it again." :
      error?.code === "PT409" ? "This payment changed. Reload and review it before trying again." :
      "Payment could not be confirmed. Check the connection and retry the same entry.", "error");
  } finally {
    delete form.dataset.submitting;
    els.manualPaymentSaveButton.disabled = false;
  }
}

function renderLeadPayments(contact) {
  if (!els.leadPaymentsPanel) return;
  if (!canManageManualPayments()) {
    els.leadPaymentsPanel.innerHTML = '<div class="empty-state">Payments are restricted to administrators.</div>';
    return;
  }

  const job = selectedLeadJob(contact);
  if (!job) return;
  if (els.paymentJobSelect) els.paymentJobSelect.innerHTML = jobContextOptions(contact, job.id);
  if (els.manualPaymentForm && !els.manualPaymentForm.elements.date.value) fillManualPaymentForm();

  const metrics = jobPaymentMetrics(job);
  const manualPaidAmount = job.paymentLedgerVersion === 2 ? number(job.manualPaidAmount) : (job.manualPayments || []).reduce((sum, payment) => sum + number(payment.amount), 0);
  const squarePaidAmount = number(job.squarePaidAmount);
  const overpayment = Math.max(metrics.paidAmount - metrics.contractValue, 0);
  const balanceLabel = overpayment ? "Customer Credit" : "Balance Due";
  const balanceAmount = overpayment || metrics.balance;
  const roundedPercent = floorPercent(metrics.percentage);

  if (els.paymentSummary) {
    els.paymentSummary.innerHTML = [
      ["Contract Value", money.format(metrics.contractValue), job.projectNumber || job.name],
      ["Total Collected", money.format(metrics.paidAmount), `${roundedPercent}% paid`],
      [balanceLabel, money.format(balanceAmount), overpayment ? "Collected above contract value" : "Still owed on this job"],
      ["Payment Sources", `${money.format(squarePaidAmount)} Square`, `${money.format(manualPaidAmount)} recorded manually${job.paymentLedgerVersion === 2 ? " · " + money.format(number(job.invoicePaidNet)) + " invoice payments (net)" : ""}`],
    ]
      .map(
        ([label, value, caption]) => `
          <article class="summary-card">
            <span class="eyebrow">${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
            <span>${escapeHtml(caption)}</span>
          </article>
        `,
      )
      .join("");
  }

  if (els.manualPaymentList) {
    const manualRows = [...manualPaymentRows(job)].sort((a, b) =>
      `${b.date}|${b.createdAt}`.localeCompare(`${a.date}|${a.createdAt}`),
    );
    const squareRow = job.paymentLedgerVersion === 2
      ? (state.jobLedgerPayments || []).filter((row) => row.jobId === job.id && row.origin === "square").map((row) =>
        `<article class="cost-card payment-ledger-card payment-ledger-square"><div><span class="status-pill pill-won">Square · Automatic</span><strong>${money.format(row.amount)}</strong><span>${escapeHtml(formatDate(row.receivedAt))}</span>${row.provider_refunded > 0 ? "<p>Refunded: "+money.format(row.provider_refunded)+"</p>" : ""}</div></article>`).join("")
      : squarePaidAmount
      ? `
          <article class="cost-card payment-ledger-card payment-ledger-square">
            <div>
              <span class="status-pill pill-won">Square · Automatic</span>
              <strong>${money.format(squarePaidAmount)}</strong>
              <span>${job.squareLastPaymentAt ? `Updated ${escapeHtml(formatDate(job.squareLastPaymentAt))}` : "Synced from Square invoices"}</span>
              <p>Square payments are refreshed automatically and cannot be edited here.</p>
            </div>
          </article>
        `
      : "";
    const manualMarkup = manualRows
      .map(
        (payment) => `
          <article class="cost-card payment-ledger-card">
            <div>
              <span class="status-pill">${escapeHtml(payment.method)}</span>
              <strong>${money.format(number(payment.amount))}</strong>
              <span>${escapeHtml(formatDate(payment.date))}${payment.reference ? ` · ${escapeHtml(payment.reference)}` : ""}</span>
              <p>${nl2br(payment.note || "No note")}</p>
              <small>Recorded by ${escapeHtml(payment.createdBy || "CRM admin")}</small>
            </div>
            <div class="row-actions">
              <button class="mini-button" type="button" title="Edit payment" aria-label="Edit payment" data-action="edit-manual-payment" data-payment-id="${payment.id}">
                <span aria-hidden="true" data-icon="edit"></span>
              </button>
              <button class="mini-button" type="button" title="Delete payment" aria-label="Delete payment" data-action="delete-manual-payment" data-payment-id="${payment.id}">
                <span aria-hidden="true" data-icon="trash"></span>
              </button>
            </div>
          </article>
        `,
      )
      .join("");
    const invoiceMarkup = job.paymentLedgerVersion === 2 ? (state.financialPayments || []).filter(p => p.jobId === job.id && p.contactId === contact.id).map(p =>
      `<article class="cost-card payment-ledger-card"><div><span class="status-pill">Invoice payment</span><strong>${money.format(p.amount)}</strong><span>${escapeHtml(formatDate(p.receivedAt))}</span><p>Managed in Billing &amp; Payments.</p></div></article>`).join("") : "";
    els.manualPaymentList.innerHTML = squareRow || manualMarkup || invoiceMarkup
      ? `${squareRow}${manualMarkup}${invoiceMarkup}`
      : '<div class="empty-state">No payments have been collected for this job yet.</div>';
    hydrateIcons(els.manualPaymentList);
  }
}

function fillManualPaymentForm(payment = {}) {
  if (!els.manualPaymentForm) return;
  const data = {
    paymentId: "",
    date: todayISO(),
    method: "Check",
    amount: "",
    reference: "",
    note: "",
    ...payment,
  };
  Object.entries(data).forEach(([key, value]) => {
    const field = els.manualPaymentForm.elements[key];
    if (field) field.value = value ?? "";
  });
  if (els.manualPaymentSaveButton) {
    els.manualPaymentSaveButton.lastChild.textContent = payment.id ? " Update Payment" : " Record Payment";
  }
}

async function saveManualPayment(event) {
  event.preventDefault();
  if (!canManageManualPayments()) {
    showToast("Only an administrator can record payments");
    return;
  }
  const contact = getSelectedContact();
  const job = selectedLeadJob(contact);
  if (!contact || !job) return;
  const formData = new FormData(els.manualPaymentForm);
  const amount = Math.round(number(formData.get("amount")) * 100) / 100;
  if (amount <= 0) {
    setSaveState(els.manualPaymentSaveStatus, "Enter a payment amount greater than $0.00.", "error");
    return;
  }

  if (job.paymentLedgerVersion === 2 && els.manualPaymentForm.dataset.pendingJob !== job.id) {
    delete els.manualPaymentForm.dataset.pendingId;
    els.manualPaymentForm.dataset.pendingJob = job.id;
  }
  const paymentId = formData.get("paymentId") || (job.paymentLedgerVersion === 2 ? (els.manualPaymentForm.dataset.pendingId ||= uid("payment")) : uid("payment"));
  const previousPayments = [...manualPaymentRows(job)];
  const existing = previousPayments.find((payment) => payment.id === paymentId);
  // A payment larger than what is owed is usually a typing mistake (a $20,000
  // payment on a $13,500 balance was accepted without a word). Ask first.
  const contractTotal = number(job.contractValue) || number(job.value);
  const collectedAfter = Math.round((number(job.paidAmount) - number(existing?.amount) + amount) * 100) / 100;
  if (contractTotal > 0 && collectedAfter > contractTotal + 0.005) {
    const over = Math.round((collectedAfter - contractTotal) * 100) / 100;
    const proceed = await appConfirm(
      `This brings the total collected on ${job.name} to ${money.format(collectedAfter)}, which is ${money.format(over)} more than the contract value of ${money.format(contractTotal)}. Record it anyway? The extra shows as a customer credit.`,
      { title: "Payment is more than the balance", confirmLabel: "Record payment", cancelLabel: "Go back" },
    );
    if (!proceed) return;
  }
  const now = new Date().toISOString();
  const payment = normalizeManualPayment({
    ...(existing || { id: paymentId, createdAt: now }),
    id: paymentId,
    date: formData.get("date") || todayISO(),
    method: formData.get("method") || "Other",
    amount,
    reference: String(formData.get("reference") || "").trim(),
    note: String(formData.get("note") || "").trim(),
    updatedAt: now,
    createdBy: existing?.createdBy || state.currentUser.name || state.currentUser.email || "CRM admin",
  });
  if (job.paymentLedgerVersion === 2) return writeCanonicalJobPayment(job, paymentId, payment, formData.get("paymentId") ? els.manualPaymentForm.dataset.expectedVersion : null);

  updateSelectedProfitJob((currentJob) => ({
    ...currentJob,
    manualPayments: existing
      ? (currentJob.manualPayments || []).map((item) => (item.id === paymentId ? payment : item))
      : [payment, ...(currentJob.manualPayments || [])],
  }));
  const updatedContact = addContactUpdate(contact.id, {
    author: state.currentUser.name || "CRM admin",
    jobId: job.id,
    message: `${existing ? "Updated" : "Recorded"} ${payment.method} payment on ${job.name}: ${money.format(payment.amount)}.`,
  });
  const updateId = updatedContact?.updates?.[0]?.id || "";

  state.leadDetailTab = "payments";
  saveState({ localOnly: true });
  renderLeadDetail();
  setSaveState(els.manualPaymentSaveStatus, "Saving securely to the shared CRM...", "saving");
  els.manualPaymentSaveButton.disabled = true;
  let saved = false;
  try {
    saved = await persistManualPaymentRecord(job.id, paymentId, true, updateId);
  } catch (error) {
    console.warn("Payment write could not be confirmed", error);
  } finally {
    els.manualPaymentSaveButton.disabled = false;
  }

  if (!saved) {
    updateContact(contact.id, (current) => ({
      ...current,
      jobs: contactJobs(current).map((item) =>
        item.id === job.id ? { ...item, manualPayments: previousPayments } : item,
      ),
      updates: (current.updates || []).filter((update) => update.id !== updateId),
    }));
    saveState({ localOnly: true });
    renderLeadDetail();
    setSaveState(els.manualPaymentSaveStatus, "Payment was not saved to the shared CRM. Please try again.", "error");
    return;
  }

  fillManualPaymentForm();
  setSaveState(els.manualPaymentSaveStatus, "Payment saved to the shared CRM.", "success");
  saveState();
  render();
  showToast(`${payment.method} payment recorded`);
}

function editManualPayment(paymentId) {
  if (!canManageManualPayments()) return;
  const contact = getSelectedContact();
  const job = selectedLeadJob(contact);
  const payment = manualPaymentRows(job).find((item) => item.id === paymentId);
  if (!payment) return;
  state.leadDetailTab = "payments";
  renderLeadDetail();
  fillManualPaymentForm({ ...payment, paymentId: payment.id });
  els.manualPaymentForm.dataset.expectedVersion = payment.updated_at || "";
  els.manualPaymentForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteManualPayment(paymentId) {
  if (!canManageManualPayments()) return;
  const contact = getSelectedContact();
  const job = selectedLeadJob(contact);
  const payment = manualPaymentRows(job).find((item) => item.id === paymentId);
  if (!contact || !job || !payment) return;
  const remaining = Math.round((number(job.paidAmount) - number(payment.amount)) * 100) / 100;
  const contractTotal = number(job.contractValue) || number(job.value);
  const reopens = job.status === "Paid" && !(contractTotal > 0 && remaining + 0.005 >= contractTotal);
  const confirmed = await appConfirm(
    `Delete the ${money.format(payment.amount)} ${payment.method} payment from ${job.name}?${reopens ? `\n\nThe job will no longer be paid in full, so it moves back from Paid to ${stageBeforePaid(job.division)}.` : ""}`,
    { title: "Delete payment", confirmLabel: "Delete payment", danger: true },
  );
  if (!confirmed) return;

  if (job.paymentLedgerVersion === 2) return writeCanonicalJobPayment(job, paymentId, null, payment.updated_at);
  const previousPayments = [...(job.manualPayments || [])];
  updateSelectedProfitJob((currentJob) => ({
    ...currentJob,
    manualPayments: (currentJob.manualPayments || []).filter((item) => item.id !== paymentId),
  }));
  const updatedContact = addContactUpdate(contact.id, {
    author: state.currentUser.name || "CRM admin",
    jobId: job.id,
    message: `Removed ${payment.method} payment from ${job.name}: ${money.format(payment.amount)}.`,
  });
  const updateId = updatedContact?.updates?.[0]?.id || "";
  saveState({ localOnly: true });
  renderLeadDetail();
  let saved = false;
  try {
    saved = await persistManualPaymentRecord(job.id, paymentId, false, updateId);
  } catch (error) {
    console.warn("Payment deletion could not be confirmed", error);
  }
  if (!saved) {
    updateContact(contact.id, (current) => ({
      ...current,
      jobs: contactJobs(current).map((item) =>
        item.id === job.id ? { ...item, manualPayments: previousPayments } : item,
      ),
      updates: (current.updates || []).filter((update) => update.id !== updateId),
    }));
    saveState({ localOnly: true });
    renderLeadDetail();
    // Say so where the user is looking as well as in the toast: this failure
    // was easy to miss and looked like the Delete button did nothing.
    setSaveState(els.manualPaymentSaveStatus, "Payment was not deleted. The shared CRM did not confirm the change; reload the page and try again.", "error");
    showToast("Payment was not deleted because the shared CRM did not confirm the change");
    return;
  }
  fillManualPaymentForm();
  saveState();
  render();
  showToast("Payment deleted");
}

function fillProfitCostForm(item = {}) {
  if (!els.profitCostForm) return;
  const data = {
    costId: "",
    date: todayISO(),
    category: "Materials",
    vendor: "",
    amount: "",
    description: "",
    reference: "",
    paid: false,
    ...item,
  };
  Object.entries(data).forEach(([key, value]) => {
    const field = els.profitCostForm.elements[key];
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value ?? "";
  });
}

function updateSelectedProfitJob(updater) {
  const contact = getSelectedContact();
  if (!contact || !state.selectedLeadJobId) return null;
  let updatedJob = null;
  updateContact(contact.id, (current) => {
    const jobs = contactJobs(current).map((job) => {
      if (job.id !== state.selectedLeadJobId) return job;
      updatedJob = normalizeJob(updater({ ...job }), current);
      return updatedJob;
    });
    const primary = jobs[0];
    return {
      ...current,
      jobs,
      status: primary.status,
      value: primary.value,
      salesRep: primary.salesRep,
      address: primary.address,
      closedDate: primary.closedDate,
    };
  });
  return updatedJob;
}

async function saveProfitCost(event) {
  event.preventDefault();
  if (!requireAction("manageJobFinancials")) return;
  const contact = getSelectedContact();
  const job = selectedProfitJob(contact);
  if (!contact || !job) return;
  state.selectedLeadJobId = job.id;
  state.selectedProfitJobId = job.id;
  const formData = new FormData(els.profitCostForm);
  const costId = formData.get("costId") || uid("cost");
  els.profitCostForm.elements.costId.value = costId;
  const existing = (job.costItems || []).find((item) => item.id === costId);
  const nextItem = normalizeCostItem({
    ...(existing || { id: costId }),
    id: costId,
    date: formData.get("date") || todayISO(),
    category: formData.get("category"),
    vendor: formData.get("vendor").trim(),
    amount: number(formData.get("amount")),
    description: formData.get("description").trim(),
    reference: formData.get("reference").trim(),
    paid: formData.get("paid") === "on",
    createdBy: state.currentUser.name || state.currentUser.email || "Upper admin",
  });

  updateSelectedProfitJob((currentJob) => ({
    ...currentJob,
    costItems: existing
      ? (currentJob.costItems || []).map((item) => (item.id === costId ? nextItem : item))
      : [nextItem, ...(currentJob.costItems || [])],
  }));

  const costUpdateContact = addContactUpdate(contact.id, {
    author: state.currentUser.name || "Upper admin",
    jobId: job.id,
    message: `${existing ? "Updated" : "Added"} cost on ${job.name}: ${money.format(nextItem.amount)} ${nextItem.category}.`,
  });

  state.leadDetailTab = "profit";
  saveState({ localOnly: true });
  render();
  setSaveState(els.profitSaveStatus, "Saving securely to the shared CRM...", "saving");
  els.profitSaveButton.disabled = true;
  let saved = false;
  try {
    saved = await persistProfitCostRecord(job.id, costId, costUpdateContact?.updates?.[0]?.id || "");
  } catch (error) {
    console.warn("Profit and Cost write could not be confirmed", error);
  } finally {
    els.profitSaveButton.disabled = false;
  }
  setSaveState(
    els.profitSaveStatus,
    saved ? "Cost saved to the shared CRM." : "Not saved to the shared CRM. Keep this page open and try again.",
    saved ? "success" : "error",
  );
  if (!saved) return;
  fillProfitCostForm();
  showToast("Cost saved to the shared CRM");
}

function editCostItem(costId) {
  if (!requireAction("manageJobFinancials")) return;
  const contact = getSelectedContact();
  const job = selectedProfitJob(contact);
  const item = (job?.costItems || []).find((cost) => cost.id === costId);
  if (!item) return;
  state.leadDetailTab = "profit";
  renderLeadDetail();
  fillProfitCostForm({ ...item, costId: item.id });
}

async function deleteCostItem(costId) {
  if (!requireAction("manageJobFinancials")) return;
  const contact = getSelectedContact();
  const job = selectedProfitJob(contact);
  if (!contact || !job) return;
  const item = (job.costItems || []).find((cost) => cost.id === costId);
  if (!item) return;
  if (!(await appConfirm(`Delete the ${money.format(item.amount)} ${item.category || "cost"}${item.vendor ? ` from ${item.vendor}` : ""} on ${job.name}?`, { title: "Delete cost", confirmLabel: "Delete cost", danger: true }))) return;
  updateSelectedProfitJob((currentJob) => ({
    ...currentJob,
    costItems: (currentJob.costItems || []).filter((cost) => cost.id !== costId),
  }));
  addContactUpdate(contact.id, {
    author: state.currentUser.name || "Upper admin",
    jobId: job.id,
    message: `Removed cost on ${job.name}: ${item ? money.format(item.amount) : "cost item"}.`,
  });
  fillProfitCostForm();
  saveState();
  render();
  showToast("Cost removed");
}

function populateDivisionFields(form, record = {}) {
  if (!form) return;
  const division = record.division || "roofing";
  const divisionField = form.elements.division;
  const serviceField = form.elements.service;
  const statusField = form.elements.status;
  if (divisionField) {
    divisionField.innerHTML = activeDivisions().map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
    divisionField.value = division;
  }
  if (serviceField) {
    const choices = activeServices(division);
    serviceField.innerHTML = choices.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
    serviceField.value = choices.some((item) => item.id === record.service) ? record.service : choices[0]?.id || "";
  }
  if (statusField) {
    const choices = [...pipelineStagesFor(division), "Lost"];
    statusField.innerHTML = choices.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(leadStatusLabel(item))}</option>`).join("");
    statusField.value = choices.includes(record.status) ? record.status : choices[0] || "New";
  }
}

function refreshDivisionForm(form) {
  if (!form) return;
  const current = {
    division: form.elements.division?.value || "roofing",
    service: form.elements.service?.value || "",
    status: form.elements.status?.value || "",
  };
  populateDivisionFields(form, current);
}

function fillJobForm(job = {}) {
  const contact = getSelectedContact();
  const data = {
    jobId: "",
    name: "",
    status: pipelineStagesFor(job.division || contact?.division || "roofing")[0] || "New",
    division: contact?.division || "roofing",
    service: contact?.service || "roof-replacement",
    propertyType: contact?.propertyType || "residential",
    urgency: contact?.urgency || "normal",
    insuranceClaim: Boolean(contact?.insuranceClaim),
    activeLeak: Boolean(contact?.activeLeak),
    value: "",
    salesRep: contact?.salesRep || "",
    lastContact: todayISO(),
    closedDate: "",
    address: "",
    notes: "",
    ...job,
  };
  populateDivisionFields(els.leadJobForm, data);
  els.leadJobForm.dataset.contactId = contact?.id || "";
  Object.entries(data).forEach(([key, value]) => {
    const field = els.leadJobForm.elements[key];
    if (field?.type === "checkbox") field.checked = Boolean(value);
    else if (field) field.value = key === "value" ? formatCurrencyInput(value) : value ?? "";
  });
  rememberFormBaseline(els.leadJobForm);
}

// Remember what an edit form showed when it was filled. On save, fields this
// user did not touch keep the latest saved value, so a teammate's edit made
// while the form was open is not silently overwritten.
function rememberFormBaseline(form) {
  if (!form) return;
  const values = {};
  new FormData(form).forEach((value, key) => {
    if (typeof value === "string") values[key] = value;
  });
  form.dataset.baseline = JSON.stringify(values);
}

function unchangedFormFields(form, formData) {
  let baseline = null;
  try { baseline = JSON.parse(form?.dataset.baseline || "null"); } catch { baseline = null; }
  if (!baseline) return new Set();
  return new Set(Object.keys(baseline).filter((key) => String(formData.get(key) ?? "") === baseline[key]));
}

function keepLatestUnchanged(target, latest, unchanged, fields) {
  if (!latest) return;
  fields.forEach((key) => {
    if (unchanged.has(key) && Object.prototype.hasOwnProperty.call(latest, key)) target[key] = latest[key];
  });
  // closedDate is filled automatically when the status changes, so only keep the
  // saved one when neither field was touched.
  if (unchanged.has("closedDate") && unchanged.has("status") && Object.prototype.hasOwnProperty.call(latest, "closedDate")) {
    target.closedDate = latest.closedDate;
  }
}

function latestUnchangedJobFields(existing, unchanged) {
  const kept = {};
  keepLatestUnchanged(kept, existing, unchanged, ["name", "status", "division", "service", "propertyType", "urgency", "insuranceClaim", "activeLeak", "salesRep", "lastContact", "address", "notes"]);
  if (existing && unchanged.has("value")) {
    kept.value = existing.value;
    kept.contractValue = existing.contractValue ?? existing.value;
  }
  return kept;
}

async function saveLeadJob(event) {
  event.preventDefault();
  if (!requireAction("manageJobs")) return;
  let contact = getSelectedContact();
  if (!contact) return;
  const formData = new FormData(els.leadJobForm);
  const jobId = formData.get("jobId") || uid("job");
  const existing = contactJobs(contact).find((job) => job.id === jobId);
  const repProblem = salesRepNameProblem(formData.get("salesRep"));
  if (repProblem && normalizePersonName(formData.get("salesRep")) !== normalizePersonName(existing?.salesRep)) {
    setSaveState(els.jobSaveStatus, repProblem, "error");
    showToast(repProblem);
    return;
  }
  let reservedProjectNumber = existing?.projectNumber || "";
  if (!existing && contact.leadNumber && canUseCloudSync()) {
    try {
      const reservation = await reserveSharedSalesNumbers(contact.id, jobId);
      reservedProjectNumber = reservation.projectNumber;
      contact = getSelectedContact();
    } catch (error) {
      setSaveState(els.jobSaveStatus, error.message || "A shared project number could not be reserved.", "error");
      return;
    }
  }
  const job = normalizeJob(
    {
      ...(existing || { id: jobId, createdAt: todayISO(), createdTimestamp: new Date().toISOString() }),
      id: jobId,
      projectNumber: existing?.projectNumber || reservedProjectNumber || (contact.leadNumber ? nextProjectNumber(contact) : ""),
      name: formData.get("name").trim(),
      status: formData.get("status"),
      division: formData.get("division") || contact.division || "roofing",
      service: formData.get("service") || contact.service || "",
      propertyType: formData.get("propertyType") || contact.propertyType || "residential",
      urgency: formData.get("activeLeak") === "on" ? "emergency" : formData.get("urgency") || "normal",
      insuranceClaim: formData.get("insuranceClaim") === "on",
      activeLeak: formData.get("activeLeak") === "on",
      value: number(formData.get("value")),
      contractValue: number(formData.get("value")),
      salesRep: normalizePersonName(formData.get("salesRep").trim() || contact.salesRep || "Unassigned"),
      lastContact: formData.get("lastContact"),
      closedDate:
        formData.get("closedDate") ||
        (soldJobStatuses.includes(formData.get("status")) ? existing?.closedDate || todayISO() : ""),
      address: formData.get("address").trim(),
      notes: formData.get("notes").trim(),
      updatedAt: new Date().toISOString(),
      ...latestUnchangedJobFields(existing, unchangedFormFields(els.leadJobForm, formData)),
    },
    contact,
  );

  const initialStage = pipelineStagesFor(job.division)[0] || "New";
  if (!existing && job.status !== initialStage) {
    setSaveState(els.jobSaveStatus, `A new ${activeDivisions().find((item) => item.id === job.division)?.name || "job"} job must begin in ${initialStage}.`, "error");
    showToast(`Create the job in ${initialStage}, then move through its pipeline in order.`);
    return;
  }
  if (existing && existing.status !== job.status) {
    const divisionStages = pipelineStagesFor(job.division);
    const currentIndex = divisionStages.indexOf(existing.status);
    const nextIndex = divisionStages.indexOf(job.status);
    // One rule set for every division. The old inline rule for Construction
    // and Home Services had no way for a manager to step a job back a stage.
    const transition = window.RooflineWorkflowChecklist?.transitionCheck
      ? window.RooflineWorkflowChecklist.transitionCheck(contact, existing, job.status)
      : { allowed: job.status === "Lost" || nextIndex === currentIndex + 1 || (canManageTeamData() && nextIndex >= 0 && nextIndex < currentIndex), reason: "Move this job one stage at a time." };
    if (transition && !transition.allowed) {
      setSaveState(els.jobSaveStatus, transition.reason, "error");
      showToast(transition.reason);
      return;
    }
  }
  if (job.status === "Paid" && !jobHasFullPayment(job)) {
    setSaveState(els.jobSaveStatus, "Paid requires confirmed payments covering the contract total.", "error");
    showToast("Record the full payment before moving this job to Paid.");
    return;
  }

  const jobUpdate = {
    id: uid("update"),
    // The person making the change, not the job's sales rep.
    author: currentActorName(),
    status: job.status,
    jobId: job.id,
    message: `${existing ? "Updated" : "Added"} job: ${job.name}. Status: ${job.status}.`,
    createdAt: new Date().toISOString(),
  };
  updateContact(contact.id, (current) => {
    const jobs = contactJobs(current);
    const nextJobs = existing ? jobs.map((item) => (item.id === jobId ? job : item)) : [...jobs, job];
    const summary = summarizeContactJobs(current, nextJobs);
    return {
      ...current,
      ...summary,
      updates: [jobUpdate, ...(current.updates || [])],
    };
  });

  state.selectedLeadJobId = job.id;
  state.leadDetailTab = "jobs";
  saveState({ localOnly: true });
  window.clearTimeout(durableSaveTimer);
  render();
  setSaveState(els.jobSaveStatus, "Saving job to the shared CRM...", "saving");
  if (els.jobSaveButton) els.jobSaveButton.disabled = true;
  let saved = !canUseCloudSync();
  try {
    if (canUseCloudSync()) saved = await persistLeadJobRecord(job.id, jobUpdate.id);
  } catch (error) {
    console.warn("Job write could not be confirmed", error);
    saved = false;
  } finally {
    if (els.jobSaveButton) els.jobSaveButton.disabled = false;
  }
  setSaveState(
    els.jobSaveStatus,
    saved ? "Job saved to the shared CRM." : "Not saved to the shared CRM. Keep this page open and try again.",
    saved ? "success" : "error",
  );
  if (!saved) {
    showToast("Job was not confirmed in the shared CRM");
    return;
  }
  queueCloudSave();
  fillJobForm({ ...job, jobId: job.id });
  showToast(`${job.name} saved to the shared CRM`);
  if (existing) void afterJobStageChange(contact.id, job.id, existing.status, job.status);
}

function editLeadJob(jobId) {
  const contact = getSelectedContact();
  const job = contactJobs(contact).find((item) => item.id === jobId);
  if (!job) return;
  state.selectedLeadJobId = jobId;
  state.selectedProfitJobId = jobId;
  state.leadDetailTab = "jobs";
  renderLeadDetail();
  fillJobForm({ ...job, jobId: job.id });
}

function deleteLeadJob(jobId) {
  if (!requireAction("manageJobs")) return;
  const contact = getSelectedContact();
  if (!contact || contactJobs(contact).length <= 1) return;
  const job = contactJobs(contact).find((item) => item.id === jobId);
  if (!job) return;
  const hasHistory = state.estimates.some((estimate) => estimate.contactId === contact.id && estimate.jobId === jobId) ||
    (job.manualPayments || []).length || number(job.paidAmount) > 0 || (job.costItems || []).length ||
    (job.emails || []).length || (contact.updates || []).some((update) => update.jobId === jobId) ||
    Object.values(state.company.jobConversations || {}).some((entry) => entry.jobId === jobId && (entry.messages || []).length);
  if (hasHistory) {
    showToast("This job has estimates, payments, costs, or history. Keep it for your records instead of deleting it.");
    return;
  }
  const linkedDocumentCount = (contact.documents || []).filter((document) => document.jobId === jobId).length;
  if (linkedDocumentCount) {
    showToast(
      `Remove the ${linkedDocumentCount} file${linkedDocumentCount === 1 ? "" : "s"} from ${job?.name || "this job"} before deleting it.`,
    );
    return;
  }
  updateContact(contact.id, (current) => {
    const nextJobs = contactJobs(current).filter((item) => item.id !== jobId);
    const primary = nextJobs[0];
    const summary = summarizeContactJobs(current, nextJobs);
    return {
      ...current,
      ...summary,
      updates: [
        {
          id: uid("update"),
          author: currentActorName(),
          message: `Removed job: ${job?.name || "job"}.`,
          createdAt: new Date().toISOString(),
        },
        ...(current.updates || []),
      ],
    };
  });
  state.selectedLeadJobId = contactJobs(getContact(contact.id))[0]?.id || "";
  saveState();
  render();
  showToast("Job removed");
}

// Text in a template that the sender is meant to replace before sending.
const EMAIL_PLACEHOLDER_PATTERN = /\[(?:Add|Insert|Enter)\b[^\]]*\]/i;

function leadEmailTemplate(contact, job = selectedLeadJob(contact), template = "follow-up") {
  // The customer sees this text: use the job's name, not the internal job number.
  const projectLabel = job?.name || "your project";
  const firstName = String(contact.name || "there").trim().split(/\s+/)[0] || "there";
  const company = state.company.name || "our team";
  const sender = state.currentUser.name || company;
  const configured=(state.emailTemplates||[]).find((item)=>item.id===template&&item.active!==false);
  if(configured){const tokens={"{{first_name}}":firstName,"{{customer_name}}":contact.name||"","{{project_name}}":projectLabel,"{{company_name}}":company,"{{sender_name}}":sender};const merge=(value)=>Object.entries(tokens).reduce((text,[token,replacement])=>text.split(token).join(replacement),String(value||""));return {fromEmail:googleIntegrationState.providerEmail||state.currentUser.email||state.company.email||"",toEmail:contact.email||"",subject:merge(configured.subjectTemplate),message:merge(configured.bodyTemplate)};}
  const choices = {
    inspection: [`Inspection confirmation for ${projectLabel}`, `Hi ${firstName},\n\nThis is a confirmation regarding the inspection for ${projectLabel}. Please let me know if the scheduled time still works or if anything has changed.\n\nThank you,\n${sender}`],
    estimate: [`Estimate follow-up for ${projectLabel}`, `Hi ${firstName},\n\nI wanted to follow up on the estimate for ${projectLabel}. I am happy to answer any questions or review the scope with you.\n\nThank you,\n${sender}`],
    deposit: [`Deposit reminder for ${projectLabel}`, `Hi ${firstName},\n\nThis is a friendly reminder regarding the deposit for ${projectLabel}. Please let me know if you need the invoice or payment instructions resent.\n\nThank you,\n${sender}`],
    production: [`Production update for ${projectLabel}`, `Hi ${firstName},\n\nHere is an update on ${projectLabel}.\n\n[Add the current production status here.]\n\nThank you,\n${sender}`],
    review: [`Thank you from ${company}`, `Hi ${firstName},\n\nThank you for trusting ${company} with ${projectLabel}. We appreciate your business and would be grateful if you shared your experience with a review.\n\n${state.company.reviewLink || "[Add review link]"}\n\nThank you,\n${sender}`],
    "follow-up": [`${company} follow-up for ${projectLabel}`, `Hi ${firstName},\n\nI wanted to follow up on ${projectLabel}.\n\nPlease let me know if you have any questions or if there is a good time to connect.\n\nThank you,\n${sender}`],
  };
  const [subject, message] = choices[template] || choices["follow-up"];
  return { fromEmail: googleIntegrationState.providerEmail || state.currentUser.email || state.company.email || "", toEmail: contact.email || "", subject, message };
}

function applyLeadEmailTemplate(contact, job, template = "follow-up") {
  if (!els.leadEmailForm) return;
  const data = leadEmailTemplate(contact, job, template);
  Object.entries(data).forEach(([key, value]) => {
    const field = els.leadEmailForm.elements[key];
    if (field) field.value = value;
  });
}

function renderLeadEmail(contact) {
  if (!els.leadEmailForm) return;
  const job = selectedLeadJob(contact);
  if(els.leadEmailTemplate){const builtIn=[['follow-up','General Follow-up'],['inspection','Inspection Confirmation'],['estimate','Estimate Follow-up'],['deposit','Deposit Reminder'],['production','Production Update'],['review','Review Request']];const current=els.leadEmailTemplate.value||'follow-up';els.leadEmailTemplate.innerHTML=[...builtIn,...(state.emailTemplates||[]).filter((item)=>item.active!==false).map((item)=>[item.id,item.name])].map(([value,label])=>`<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('');els.leadEmailTemplate.value=[...els.leadEmailTemplate.options].some((option)=>option.value===current)?current:'follow-up';}
  if (els.leadEmailJobSelect) {
    els.leadEmailJobSelect.innerHTML = jobContextOptions(contact, job?.id);
    els.leadEmailJobSelect.disabled = !job;
  }
  if (els.leadEmailHeading) els.leadEmailHeading.textContent = job ? `${job.name} Email` : "Email for this job";
  const emailContext = `${contact.id}:${job?.id || ""}`;
  if (els.leadEmailForm.dataset.emailContext !== emailContext) {
    els.leadEmailForm.dataset.emailContext = emailContext;
    if (els.leadEmailTemplate) els.leadEmailTemplate.value = "follow-up";
    applyLeadEmailTemplate(contact, job, "follow-up");
  }
  if (!googleIntegrationState.loaded && !googleIntegrationState.loading) void refreshGoogleIntegrationStatus().then(() => renderLeadEmail(getSelectedContact()));
  if (els.leadEmailSubmitLabel) els.leadEmailSubmitLabel.textContent = googleIntegrationState.gmailSend ? "Send with Gmail" : "Open Email";
  const fromField = els.leadEmailForm.elements.fromEmail;
  if (fromField) {
    fromField.readOnly = googleIntegrationState.gmailSend;
    fromField.title = googleIntegrationState.gmailSend ? "Messages are sent from the connected Google Workspace account" : "Email account used by your default mail application";
    if (googleIntegrationState.gmailSend && googleIntegrationState.providerEmail) fromField.value = googleIntegrationState.providerEmail;
  }
  if (els.leadEmailHistory) {
    const scheduled = (state.scheduledMessages || [])
      .filter((item) => item.contactId === contact.id && item.jobId === (job?.id || ""))
      .map((item) => ({
        subject: item.subject,
        message: item.body,
        createdAt: item.scheduledFor,
        direction: "outbound",
        deliveryStatus: item.status || "queued",
        toEmail: item.recipient,
        createdBy: "Scheduled message",
        scheduled: true,
      }));
    const emails = [...(job?.emails || []), ...scheduled].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    els.leadEmailHistory.innerHTML = emails.length
      ? emails
          .map(
            (email) => `
              <article class="conversation-item">
                <div class="conversation-meta">
                  <strong>${escapeHtml(email.subject || "Client email")}</strong>
                  <span>${escapeHtml(formatDateTime(email.createdAt))}</span>
                </div>
                <span class="status-pill">${email.direction === "inbound" ? "Reply received" : email.scheduled ? escapeHtml(`${email.deliveryStatus || "queued"} · ${formatDateTime(email.createdAt)}`) : escapeHtml(email.deliveryStatus === "sent" ? "Sent with Gmail" : email.toEmail || "No recipient")}</span>
                <p>${nl2br(email.message || "No message saved")}</p>
                ${email.attachmentName ? `<small><strong>Attachment:</strong> ${escapeHtml(email.attachmentName)}</small>` : ""}
                <small>Prepared by ${escapeHtml(email.createdBy || "CRM user")}</small>
              </article>`,
          )
          .join("")
      : `<div class="empty-state">No email activity saved for ${escapeHtml(job?.name || "this job")} yet.</div>`;
  }
  const hasGmailThreads = Boolean((job?.emails || []).some((email) => email.provider === "gmail" && email.providerThreadId));
  if (els.refreshLeadEmailThreadsButton) {
    els.refreshLeadEmailThreadsButton.disabled = !hasGmailThreads || !googleIntegrationState.gmailRead;
    els.refreshLeadEmailThreadsButton.title = !googleIntegrationState.gmailRead ? "Connect or reconnect Google Workspace to check Gmail replies" : "Check Gmail for new replies to this job";
  }
}

function leadEmailPayload() {
  const contact = getSelectedContact();
  if (!contact || !els.leadEmailForm) return null;
  const job = selectedLeadJob(contact);
  if (!job) return null;
  const formData = new FormData(els.leadEmailForm);
  return {
    contact,
    job,
    fromEmail: formData.get("fromEmail").trim(),
    toEmail: formData.get("toEmail").trim(),
    subject: formData.get("subject").trim(),
    message: formData.get("message").trim(),
    scheduledFor: String(formData.get("scheduledFor") || ""),
    templateId: String(formData.get("template") || ""),
  };
}

async function scheduleLeadEmail() {
  if(!requireAction("sendEmail"))return;const payload=leadEmailPayload();if(!payload)return;
  if(!payload.toEmail||!payload.subject||!payload.message)return showToast("Add the recipient, subject, and message first");
  const scheduledAt=new Date(payload.scheduledFor).getTime();if(!payload.scheduledFor||!Number.isFinite(scheduledAt)||scheduledAt<=Date.now())return showToast("Choose a future date and time");
  const message={id:uid("scheduledmessage"),contactId:payload.contact.id,jobId:payload.job.id,templateId:payload.templateId,recipient:payload.toEmail,subject:payload.subject,body:payload.message,scheduledFor:new Date(scheduledAt).toISOString(),status:"queued",attempts:0};
  try{if(canUseCloudSync()){const {error}=await cloudClient.rpc("crm_schedule_email",{p_message:{id:message.id,lead_id:message.contactId,job_id:message.jobId,template_id:message.templateId,recipient:message.recipient,subject:message.subject,body:message.body,scheduled_for:message.scheduledFor}});if(error)throw error;await initializeCommunications();}else state.scheduledMessages.unshift(message);saveState({localOnly:true});renderLeadEmail(payload.contact);showToast(`Email scheduled for ${formatDateTime(message.scheduledFor)}`);}catch(error){console.error(error);showToast(error?.message||"The email could not be scheduled");}
}

function mailtoUrl(toEmail, subject, message) {
  return `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    message,
  )}`;
}

async function submitLeadEmail(event) {
  event.preventDefault();
  if (!requireAction("sendEmail")) return;
  const payload = leadEmailPayload();
  if (!payload) return;
  if (!payload.toEmail) {
    showToast("Add a client email address first");
    return;
  }
  if (!payload.subject || !payload.message) { showToast("Add an email subject and message first"); return; }
  // Never send the template's own instructions ("[Add the current production
  // status here.]") to a customer.
  const unfilled = `${payload.subject}\n${payload.message}`.match(EMAIL_PLACEHOLDER_PATTERN);
  if (unfilled) {
    setSaveState(els.leadEmailSaveStatus, `Replace the placeholder text ${unfilled[0]} before sending.`, "error");
    showToast(`This message still contains placeholder text: ${unfilled[0]}. Replace it before sending.`);
    return;
  }
  let providerResult = null;
  if (googleIntegrationState.gmailSend) {
    setSaveState(els.leadEmailSaveStatus, "Sending securely through Gmail…", "saving");
    try {
      const headers = await squareApiHeaders();
      const response = await fetch("/api/integrations/google/gmail/send", {
        method: "POST", headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ toEmail: payload.toEmail, subject: payload.subject, message: payload.message }),
        signal: AbortSignal.timeout(20000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.sent) throw new Error(result.error || "Gmail could not send the message.");
      providerResult = result;
    } catch (error) {
      setSaveState(els.leadEmailSaveStatus, error.message || "Gmail could not send the message.", "error");
      return;
    }
  }
  const emailRecord = normalizeJobEmail({
    id: uid("job_email"),
    fromEmail: providerResult?.fromEmail || payload.fromEmail,
    toEmail: payload.toEmail,
    subject: payload.subject,
    message: payload.message,
    createdBy: state.currentUser.name || state.currentUser.email || "CRM user",
    createdAt: providerResult?.sentAt || new Date().toISOString(),
    provider: providerResult ? "gmail" : "",
    providerMessageId: providerResult?.messageId || "",
    providerThreadId: providerResult?.threadId || "",
    deliveryStatus: providerResult ? "sent" : "draft_opened",
  });
  updateContact(payload.contact.id, (current) => ({
    ...current,
    jobs: contactJobs(current).map((job) =>
      job.id === payload.job.id ? { ...job, emails: [emailRecord, ...(job.emails || [])] } : job,
    ),
  }));
  const emailUpdateContact = addContactUpdate(payload.contact.id, {
    author: currentActorName(),
    jobId: payload.job.id,
    message: `${providerResult ? "Sent Gmail message" : "Opened email draft"}: ${payload.subject || "Client email"}.`,
  });
  saveState({ localOnly: true });
  renderLeadEmail(getSelectedContact());
  setSaveState(els.leadEmailSaveStatus, `${providerResult ? "Gmail sent" : "Email draft opened"}. Saving activity to this job…`, "saving");
  const emailSave = canUseCloudSync()
    ? persistLeadJobRecord(payload.job.id, emailUpdateContact?.updates?.[0]?.id || "")
    : Promise.resolve(true);
  void emailSave
    .then((saved) => {
      if (!saved) {
        queueDurableRecordsSave();
        setSaveState(els.leadEmailSaveStatus, "Email is saved locally and will retry shared CRM sync.", "error");
        return;
      }
      queueCloudSave();
      setSaveState(els.leadEmailSaveStatus, `${providerResult ? "Gmail sent and" : "Email activity"} saved to this job.`, "success");
    })
    .catch((error) => {
      console.warn("Job email sync failed", error);
      queueDurableRecordsSave();
      setSaveState(els.leadEmailSaveStatus, "Email is saved locally and will retry shared CRM sync.", "error");
    });
  if (!providerResult) window.location.href = mailtoUrl(payload.toEmail, payload.subject, payload.message);
  showToast(`${providerResult ? "Email sent from Gmail" : "Email draft opened"} and saved to ${payload.job.name}`);
}

async function refreshLeadEmailThreads() {
  if (!requireAction("sendEmail")) return;
  const contact = getSelectedContact();
  const job = contact && selectedLeadJob(contact);
  if (!contact || !job) return;
  const threadIds = [...new Set((job.emails || []).filter((email) => email.provider === "gmail" && email.providerThreadId).map((email) => email.providerThreadId))];
  if (!threadIds.length) { showToast("Send an email with Gmail before checking replies"); return; }
  setSaveState(els.leadEmailSaveStatus, "Checking Gmail for replies…", "saving");
  if (els.refreshLeadEmailThreadsButton) els.refreshLeadEmailThreadsButton.disabled = true;
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/gmail/threads", {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ threadIds }), signal: AbortSignal.timeout(30000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.synced) throw new Error(result.error || "Gmail replies could not be checked.");
    const known = new Set((job.emails || []).map((email) => email.providerMessageId).filter(Boolean));
    const additions = result.threads.flatMap((thread) => thread.messages || []).filter((message) => !known.has(message.messageId)).map((message) => normalizeJobEmail({
      id: uid("job_email"), fromEmail: message.fromEmail, toEmail: message.toEmail, subject: message.subject, message: message.message,
      createdAt: message.createdAt, createdBy: message.direction === "inbound" ? "Customer reply" : state.currentUser.name || "CRM user",
      provider: "gmail", providerMessageId: message.messageId, providerThreadId: message.threadId, direction: message.direction, deliveryStatus: message.direction === "inbound" ? "received" : "sent",
    }));
    if (additions.length) {
      updateContact(contact.id, (current) => ({ ...current, jobs: contactJobs(current).map((item) => item.id === job.id ? { ...item, emails: [...additions, ...(item.emails || [])] } : item) }));
      const saved = canUseCloudSync() ? await persistLeadJobRecord(job.id, "") : true;
      if (!saved) queueDurableRecordsSave();
      saveState();
      renderLeadEmail(getSelectedContact());
    }
    setSaveState(els.leadEmailSaveStatus, additions.length ? `${additions.length} new Gmail message${additions.length === 1 ? "" : "s"} saved to this job.` : "No new Gmail replies found.", "success");
  } catch (error) {
    setSaveState(els.leadEmailSaveStatus, error.message || "Gmail replies could not be checked.", "error");
  } finally {
    renderLeadEmail(getSelectedContact());
  }
}

async function copyLeadEmail() {
  if (!requireAction("sendEmail")) return;
  const payload = leadEmailPayload();
  if (!payload) return;
  const text = `To: ${payload.toEmail}\nFrom: ${payload.fromEmail}\nSubject: ${payload.subject}\n\n${payload.message}`;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Email copied to clipboard");
  } catch {
    showToast("Clipboard access was blocked");
  }
}

function supportsZohoSmartDocument(record) {
  return number(record?.size) > 0 && number(record.size) <= 25 * 1024 * 1024 &&
    /\.(pdf|jpe?g|png|docx?|html?|tex|txt|sxw|odt|rtf|xlsx?|ods)$/i.test(record?.name || "");
}

function supportsNativeSmartDocument(record) {
  const supportedFormat = /(?:application\/pdf|image\/(?:png|jpeg))/i.test(record?.type || "") || /\.(?:pdf|png|jpe?g)$/i.test(record?.name || "");
  return supportedFormat && number(record?.size) > 0 && number(record.size) <= 25 * 1024 * 1024 && Boolean(record.storagePath || record.dataUrl);
}

function nativeSmartDocumentButton(record) {
  const supported = supportsNativeSmartDocument(record);
  const status = record.smartDocument?.status || "";
  const label = status === "completed" ? "Open Completed Doc" : status ? "Continue Smart Doc" : "Create Smart Doc";
  const title = supported
    ? "Create, fill, save, and email this document without leaving JobCrest"
    : "Smart Documents currently support saved PDF, PNG, and JPEG files up to 25 MB";
  return `<button class="secondary-button smart-document-button" type="button" data-action="open-smart-document" data-document-id="${escapeHtml(record.id)}" ${supported ? "" : "disabled"} title="${escapeHtml(title)}" aria-label="${escapeHtml(label)}"><span aria-hidden="true" data-icon="edit"></span>${label}</button>`;
}

function zohoSmartDocumentButton(record) {
  // Zoho Sign remains intentionally dormant until its separate rollout is approved.
  if (!zohoIntegrationState.configured) return "";
  const supported = supportsZohoSmartDocument(record);
  const linked = Boolean(record?.zohoSign?.requestId);
  const title = supported
    ? linked ? "Continue preparing this Smart Document in Zoho Sign" : "Turn this file into a Zoho Sign Smart Document"
    : "Zoho Sign supports common PDF, image, document, and spreadsheet files up to 25 MB";
  return `
    <button class="secondary-button zoho-smart-button" type="button" data-action="prepare-zoho-smart-document" data-document-id="${escapeHtml(record.id)}" ${supported ? "" : "disabled"} title="${escapeHtml(title)}" aria-label="${linked ? "Continue Zoho Sign" : "Prepare in Zoho Sign"}">
      <span aria-hidden="true" data-icon="send"></span>${linked ? "Continue Zoho Sign" : "Zoho Sign"}
    </button>`;
}

function googleDriveDocumentButton(record) {
  const currentCopy = record.googleDrive?.fileId && record.googleDrive.versionNumber === record.versionNumber;
  if (currentCopy) {
    return `<a class="secondary-button" href="${escapeHtml(record.googleDrive.webViewLink)}" target="_blank" rel="noopener noreferrer" title="Open the company Drive copy" aria-label="Open in Google Drive"><span aria-hidden="true" data-icon="folder"></span>Drive</a>`;
  }
  if (!googleDriveState.configured) return "";
  return `<button class="secondary-button" type="button" data-action="sync-google-drive-document" data-document-id="${escapeHtml(record.id)}" title="Copy this saved CRM file to the company Drive" aria-label="Copy to Google Drive"><span aria-hidden="true" data-icon="upload"></span>Copy to Drive</button>`;
}

async function refreshGoogleDriveStatus(force = false) {
  if (googleDriveState.loading || (googleDriveState.loaded && !force)) return googleDriveState;
  googleDriveState.loading = true;
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/drive/status", { headers, signal: AbortSignal.timeout(15000) });
    const result = await response.json().catch(() => ({}));
    googleDriveState = { loaded: true, loading: false, configured: response.ok && result.configured === true };
  } catch {
    googleDriveState = { loaded: true, loading: false, configured: false };
  }
  if (els.googleDriveIntegrationStatus) {
    els.googleDriveIntegrationStatus.textContent = googleDriveState.configured
      ? "Company Shared Drive is ready. Use Copy to Drive on the files that need a Drive copy; JobCrest remains the primary file library."
      : "Company Shared Drive setup is required before files can be copied on demand.";
  }
  return googleDriveState;
}

async function syncDocumentsToGoogleDrive(documentIds, { statusElement = null, force = false } = {}) {
  if (!canUseCloudSync() || !documentIds?.length) return { synced: 0, skipped: true };
  const status = await refreshGoogleDriveStatus(force);
  if (!status.configured) return { synced: 0, skipped: true };
  if (statusElement) setSaveState(statusElement, "Saved to JobCrest. Copying to the company Drive in the background…", "saving");
  const headers = await squareApiHeaders();
  const failures = [];
  let synced = 0;
  for (let offset = 0; offset < documentIds.length; offset += 2) {
    const batch = documentIds.slice(offset, offset + 2);
    const results = await Promise.allSettled(batch.map(async (documentId) => {
      const response = await fetch("/api/integrations/google/drive/document", {
        method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ documentId }), signal: AbortSignal.timeout(90000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.synced) throw new Error(result.error || "Drive copy failed.");
      return result;
    }));
    results.forEach((result, index) => {
      if (result.status === "fulfilled") synced += 1;
      else failures.push({ documentId: batch[index], error: result.reason });
    });
  }
  if (synced) await reloadDurableRecords({ showUpdateToast: false });
  render();
  if (statusElement) {
    setSaveState(statusElement, failures.length
      ? `${synced} Drive cop${synced === 1 ? "y" : "ies"} completed. ${failures.length} will need to be retried.`
      : `${synced} file${synced === 1 ? "" : "s"} saved to JobCrest and the company Drive.`, failures.length ? "error" : "success");
  }
  if (failures.length) console.warn("Google Drive copies failed", failures);
  return { synced, failures };
}

