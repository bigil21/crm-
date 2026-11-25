function normalizeInvoice(invoice = {}) {
  return {
    ...invoice,
    id: String(invoice.id || uid("invoice")),
    invoiceNumber: String(invoice.invoiceNumber || invoice.invoice_number || ""),
    contactId: String(invoice.contactId || invoice.leadId || invoice.lead_id || ""),
    leadId: String(invoice.leadId || invoice.contactId || invoice.lead_id || ""),
    jobId: String(invoice.jobId || invoice.job_id || ""),
    estimateId: String(invoice.estimateId || invoice.estimate_id || ""),
    status: String(invoice.status || "draft").toLowerCase(),
    currency: String(invoice.currency || "USD"),
    subtotal: number(invoice.subtotal),
    taxAmount: number(invoice.taxAmount ?? invoice.tax_amount),
    taxRate: number(invoice.taxRate ?? invoice.tax_rate ?? (number(invoice.subtotal) ? number(invoice.taxAmount ?? invoice.tax_amount) / number(invoice.subtotal) * 100 : 0)),
    totalAmount: number(invoice.totalAmount ?? invoice.total_amount),
    amountPaid: number(invoice.amountPaid ?? invoice.amount_paid),
    issueDate: invoice.issueDate || invoice.issue_date || todayISO(),
    dueDate: invoice.dueDate || invoice.due_date || "",
    terms: String(invoice.terms || ""),
    notes: String(invoice.notes || ""),
    provider: String(invoice.provider || "internal"),
    providerInvoiceId: String(invoice.providerInvoiceId || invoice.provider_invoice_id || ""),
    providerUrl: String(invoice.providerUrl || invoice.provider_url || ""),
    ownerUserId: invoice.ownerUserId || invoice.owner_user_id || "",
    ownerEmail: invoice.ownerEmail || invoice.owner_email || "",
    ownerName: invoice.ownerName || invoice.owner_name || "",
    createdAt: invoice.createdAt || invoice.created_at || new Date().toISOString(),
    updatedAt: invoice.updatedAt || invoice.updated_at || invoice.createdAt || invoice.created_at || new Date().toISOString(),
    items: (invoice.items || []).map((item, position) => ({
      id: String(item.id || uid("invoiceitem")),
      description: String(item.description || item.title || "Line item"),
      quantity: number(item.quantity),
      unitPrice: number(item.unitPrice ?? item.unit_price ?? item.rate),
      amount: number(item.amount),
      position: Number.isFinite(Number(item.position)) ? Number(item.position) : position,
    })),
  };
}

// The payments table holds every payment. The database files a row there for
// each payment recorded on a job (origin "job"), in the same save as the job.
// This browser already has those payments on the job records it holds, which
// live updates keep current, so it reads them from there and takes only the
// other rows (payments recorded against an invoice) from the table. The
// database adds the same money up from the table (crm_ledger_totals), and the
// two answers are compared: see compareServerLedgerWithLocal.
function isInvoicePaymentRow(payment) {
  return payment?.origin !== "job" && payment?.origin !== "square";
}

function normalizeFinancialPayment(payment = {}) {
  return {
    ...payment,
    id: String(payment.id || uid("payment")),
    contactId: String(payment.contactId || payment.leadId || payment.lead_id || ""),
    leadId: String(payment.leadId || payment.contactId || payment.lead_id || ""),
    jobId: String(payment.jobId || payment.job_id || ""),
    amount: number(payment.amount),
    method: String(payment.method || "Other"),
    reference: String(payment.reference || ""),
    note: String(payment.note || ""),
    provider: String(payment.provider || "manual"),
    providerPaymentId: String(payment.providerPaymentId || payment.provider_payment_id || ""),
    receivedAt: payment.receivedAt || payment.received_at || payment.date || new Date().toISOString(),
    createdAt: payment.createdAt || payment.created_at || new Date().toISOString(),
  };
}

function normalizeFinancialExpense(expense = {}) {
  return {
    ...expense,
    id: String(expense.id || uid("expense")),
    contactId: String(expense.contactId || expense.leadId || expense.lead_id || ""),
    leadId: String(expense.leadId || expense.contactId || expense.lead_id || ""),
    jobId: String(expense.jobId || expense.job_id || ""),
    category: String(expense.category || "Other"),
    vendor: String(expense.vendor || ""),
    description: String(expense.description || ""),
    amount: number(expense.amount),
    expenseDate: expense.expenseDate || expense.expense_date || todayISO(),
    reference: String(expense.reference || ""),
    status: String(expense.status || "recorded"),
    createdAt: expense.createdAt || expense.created_at || new Date().toISOString(),
  };
}

function normalizeCreditNote(credit = {}) {
  return {
    ...credit,
    id: String(credit.id || uid("credit")),
    creditNumber: String(credit.creditNumber || credit.credit_number || ""),
    invoiceId: String(credit.invoiceId || credit.invoice_id || ""),
    contactId: String(credit.contactId || credit.leadId || credit.lead_id || ""),
    leadId: String(credit.leadId || credit.contactId || credit.lead_id || ""),
    jobId: String(credit.jobId || credit.job_id || ""),
    amount: number(credit.amount),
    reason: String(credit.reason || ""),
    status: String(credit.status || "draft"),
    issuedAt: credit.issuedAt || credit.issued_at || todayISO(),
    createdAt: credit.createdAt || credit.created_at || new Date().toISOString(),
  };
}

function normalizePaymentAllocation(allocation = {}) {
  return {
    ...allocation,
    id: String(allocation.id || uid("allocation")),
    paymentId: String(allocation.paymentId || allocation.payment_id || ""),
    invoiceId: String(allocation.invoiceId || allocation.invoice_id || ""),
    contactId: String(allocation.contactId || allocation.leadId || allocation.lead_id || ""),
    leadId: String(allocation.leadId || allocation.contactId || allocation.lead_id || ""),
    jobId: String(allocation.jobId || allocation.job_id || ""),
    amount: number(allocation.amount),
    createdAt: allocation.createdAt || allocation.created_at || new Date().toISOString(),
  };
}

function normalizeFinancialRefund(refund = {}) {
  return {
    ...refund,
    id: String(refund.id || uid("refund")),
    paymentId: String(refund.paymentId || refund.payment_id || ""),
    invoiceId: String(refund.invoiceId || refund.invoice_id || ""),
    contactId: String(refund.contactId || refund.leadId || refund.lead_id || ""),
    leadId: String(refund.leadId || refund.contactId || refund.lead_id || ""),
    jobId: String(refund.jobId || refund.job_id || ""),
    amount: number(refund.amount),
    reason: String(refund.reason || ""),
    provider: String(refund.provider || "manual"),
    refundedAt: refund.refundedAt || refund.refunded_at || new Date().toISOString(),
    createdAt: refund.createdAt || refund.created_at || new Date().toISOString(),
  };
}

function normalizeInvoiceSchedule(schedule = {}) {
  return {
    ...schedule,
    id: String(schedule.id || uid("schedule")),
    templateInvoiceId: String(schedule.templateInvoiceId || schedule.template_invoice_id || ""),
    contactId: String(schedule.contactId || schedule.leadId || schedule.lead_id || ""),
    leadId: String(schedule.leadId || schedule.contactId || schedule.lead_id || ""),
    jobId: String(schedule.jobId || schedule.job_id || ""),
    cadence: ["monthly", "quarterly", "yearly"].includes(schedule.cadence) ? schedule.cadence : "monthly",
    nextIssueDate: schedule.nextIssueDate || schedule.next_issue_date || todayISO(),
    dueDays: Math.max(0, Math.min(365, Math.round(number(schedule.dueDays ?? schedule.due_days) || 14))),
    remainingCount: schedule.remainingCount ?? schedule.remaining_count ?? null,
    active: schedule.active !== false,
  };
}

function normalizeBillingNotice(notice = {}) {
  return {
    ...notice,
    id: String(notice.id || uid("notice")),
    invoiceId: String(notice.invoiceId || notice.invoice_id || ""),
    contactId: String(notice.contactId || notice.leadId || notice.lead_id || ""),
    leadId: String(notice.leadId || notice.contactId || notice.lead_id || ""),
    jobId: String(notice.jobId || notice.job_id || ""),
    noticeType: String(notice.noticeType || notice.notice_type || "due_soon"),
    recipientEmail: String(notice.recipientEmail || notice.recipient_email || ""),
    scheduledFor: notice.scheduledFor || notice.scheduled_for || new Date().toISOString(),
    status: String(notice.status || "queued"),
    attempts: Math.max(0, Math.round(number(notice.attempts))),
  };
}

function normalizeProjectMember(item = {}) {
  return { ...item, id: String(item.id || uid("member")), contactId: String(item.contactId || item.leadId || item.lead_id || ""), leadId: String(item.leadId || item.contactId || item.lead_id || ""), jobId: String(item.jobId || item.job_id || ""), memberEmail: String(item.memberEmail || item.member_email || ""), memberName: String(item.memberName || item.member_name || ""), roleName: String(item.roleName || item.role_name || "Project member"), active: item.active !== false };
}

function normalizeProjectDiscussion(item = {}) {
  return { ...item, id: String(item.id || uid("discussion")), contactId: String(item.contactId || item.leadId || item.lead_id || ""), leadId: String(item.leadId || item.contactId || item.lead_id || ""), jobId: String(item.jobId || item.job_id || ""), body: String(item.body || ""), visibility: item.visibility === "customer" ? "customer" : "internal", createdAt: item.createdAt || item.created_at || new Date().toISOString() };
}

function normalizeProjectNote(item = {}) {
  return { ...item, id: String(item.id || uid("projectnote")), contactId: String(item.contactId || item.leadId || item.lead_id || ""), leadId: String(item.leadId || item.contactId || item.lead_id || ""), jobId: String(item.jobId || item.job_id || ""), body: String(item.body || ""), pinned: Boolean(item.pinned), createdAt: item.createdAt || item.created_at || new Date().toISOString() };
}

function normalizeJobTimeEntry(item = {}) {
  return { ...item, id: String(item.id || uid("time")), contactId: String(item.contactId || item.leadId || item.lead_id || ""), leadId: String(item.leadId || item.contactId || item.lead_id || ""), jobId: String(item.jobId || item.job_id || ""), taskId: String(item.taskId || item.task_id || ""), startedAt: item.startedAt || item.started_at || new Date().toISOString(), stoppedAt: item.stoppedAt || item.stopped_at || "", note: String(item.note || ""), billable: Boolean(item.billable), hourlyRate: number(item.hourlyRate ?? item.hourly_rate), userId: item.userId || item.user_id || "" };
}

function normalizeProjectTemplate(item = {}) {
  return { ...item, id: String(item.id || uid("projecttemplate")), name: String(item.name || "Project template"), description: String(item.description || ""), milestones: Array.isArray(item.milestones) ? item.milestones : [], active: item.active !== false };
}

function normalizeJobOperation(item = {}) {
  return {
    ...item,
    id: String(item.id || uid("operation")),
    contactId: String(item.contactId || item.leadId || item.lead_id || ""),
    leadId: String(item.leadId || item.contactId || item.lead_id || ""),
    jobId: String(item.jobId || item.job_id || ""),
    createdAt: item.createdAt || item.created_at || new Date().toISOString(),
    updatedAt: item.updatedAt || item.updated_at || item.createdAt || item.created_at || new Date().toISOString(),
  };
}

function normalizeCustomerAccount(item = {}) {
  return { ...item, id: String(item.id || uid("account")), accountType: String(item.accountType || item.account_type || "commercial"), ownerUserId: item.ownerUserId || item.owner_user_id || "", billingEmail: String(item.billingEmail || item.billing_email || ""), billingPhone: String(item.billingPhone || item.billing_phone || ""), billingAddress: String(item.billingAddress || item.billing_address || ""), paymentTerms: String(item.paymentTerms || item.payment_terms || "Due on receipt"), active: item.active !== false };
}

function normalizeAccountProperty(item = {}) {
  return { ...item, id: String(item.id || uid("property")), accountId: String(item.accountId || item.account_id || ""), propertyType: String(item.propertyType || item.property_type || "commercial"), annualBudget: number(item.annualBudget ?? item.annual_budget), roofSystem: String(item.roofSystem || item.roof_system || "") };
}

function normalizeAccountContact(item = {}) {
  return { ...item, id: String(item.id || uid("accountcontact")), accountId: String(item.accountId || item.account_id || ""), propertyId: String(item.propertyId || item.property_id || ""), roleName: String(item.roleName || item.role_name || ""), isPrimary: Boolean(item.isPrimary ?? item.is_primary) };
}

function normalizeAccountRecordLink(item = {}) {
  return { ...normalizeJobOperation(item), accountId: String(item.accountId || item.account_id || ""), propertyId: String(item.propertyId || item.property_id || "") };
}

function normalizeCompany(company = {}) {
  const merged = { ...defaultCompany, ...(company || {}) };
  const officeAddress = merged.officeAddress || merged.address || defaultCompany.officeAddress;
  return {
    ...merged,
    address: merged.address || officeAddress,
    officeAddress,
    logoDataUrl: merged.logoDataUrl || "",
    logoAssetVersion: String(merged.logoAssetVersion || ""),
    documentCategories: normalizeDocumentCategories(merged.documentCategories),
    companyDocumentFolders: normalizeCompanyDocumentFolders(merged.companyDocumentFolders),
  };
}

function normalizeCompanyDocumentFolders(folders) {
  const source = Array.isArray(folders) ? folders : defaultCompanyDocumentFolders;
  const seenNames = new Set();
  return source
    .map((folder, index) => ({
      id: String(folder?.id || uid("companyfolder")),
      name: String(folder?.name || `Folder ${index + 1}`).trim().slice(0, 120),
      displayOrder: Number.isFinite(Number(folder?.displayOrder)) ? Number(folder.displayOrder) : index,
      createdAt: folder?.createdAt || new Date().toISOString(),
      updatedAt: folder?.updatedAt || folder?.createdAt || new Date().toISOString(),
    }))
    .filter((folder) => {
      const key = documentCategoryNameKey(folder.name);
      if (!key || seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    })
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
    .map((folder, displayOrder) => ({ ...folder, displayOrder }));
}

function companyDocumentFoldersWithLegacy(folders, documents = []) {
  const migrated = [...normalizeCompanyDocumentFolders(folders)];
  documents.forEach((document) => {
    const name = String(document?.category || "Other").trim() || "Other";
    const key = documentCategoryNameKey(name);
    if (migrated.some((folder) => folder.id === document.folderId || documentCategoryNameKey(folder.name) === key)) return;
    const createdAt = document.uploadedAt || DOCUMENT_CATEGORY_CREATED_AT;
    migrated.push({ id: document.folderId || `companyfolder_${key || migrated.length + 1}`, name, displayOrder: migrated.length, createdAt, updatedAt: createdAt });
  });
  return normalizeCompanyDocumentFolders(migrated);
}

function normalizeDocumentCategory(category = {}, index = 0) {
  const now = new Date().toISOString();
  return {
    id: category.id || uid("doccat"),
    name: String(category.name || `Category ${index + 1}`).trim(),
    displayOrder: Number.isFinite(Number(category.displayOrder)) ? Number(category.displayOrder) : index,
    icon: documentCategoryIcons.includes(category.icon) ? category.icon : "folder",
    color: /^#[0-9a-f]{6}$/i.test(String(category.color || "")) ? category.color : "#64748b",
    active: category.active !== false,
    createdAt: category.createdAt || now,
    updatedAt: category.updatedAt || category.lastModifiedAt || category.createdAt || now,
  };
}

function normalizeDocumentCategories(categories) {
  const source = Array.isArray(categories) ? categories : defaultDocumentCategories;
  return source
    .map(normalizeDocumentCategory)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
    .map((category, displayOrder) => ({ ...category, displayOrder }));
}

function documentCategoryNameKey(name = "") {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/s$/, "");
}

function categoriesWithLegacyDocuments(categories, contacts) {
  const migrated = [...categories];
  contacts.forEach((contact) => {
    (contact.documents || []).forEach((document) => {
      const name = String(document.category || "").trim();
      if (!name) return;
      const nameKey = documentCategoryNameKey(name);
      const exists = migrated.some(
        (category) => category.id === document.categoryId || documentCategoryNameKey(category.name) === nameKey,
      );
      if (exists) return;
      const slug = nameKey || Math.random().toString(36).slice(2, 8);
      const createdAt = document.uploadedAt || DOCUMENT_CATEGORY_CREATED_AT;
      migrated.push(
        normalizeDocumentCategory({
          id: document.categoryId || `doccat_${slug}`,
          name,
          displayOrder: migrated.length,
          icon: "folder",
          color: "#64748b",
          active: true,
          createdAt,
          updatedAt: createdAt,
        }),
      );
    });
  });
  return normalizeDocumentCategories(migrated);
}

function categoryForLegacyName(name, categories = defaultDocumentCategories) {
  const normalizedName = documentCategoryNameKey(name || "Other");
  return (
    categories.find((category) => documentCategoryNameKey(category.name) === normalizedName) ||
    categories.find((category) => category.name.toLowerCase() === "other") ||
    categories[0]
  );
}

function normalizeContact(contact, categories = defaultDocumentCategories, options = {}) {
  const status = contact.status || "New";
  const seeded = seedContacts.find((seed) => seed.id === contact.id);
  const savedRep = contact.salesRep && contact.salesRep !== "Unassigned" ? contact.salesRep : "";
  const closedDate =
    contact.closedDate ||
    seeded?.closedDate ||
    (status === "Won" ? contact.lastContact || contact.createdAt || todayISO() : "");
  const baseContact = {
    ...contact,
    type: contact.type || (status === "Won" ? "Customer" : "Lead"),
    status,
    ownerUserId: contact.ownerUserId || contact.owner_id || "",
    ownerEmail: contact.ownerEmail || contact.owner_email || "",
    ownerName: contact.ownerName || contact.owner_name || "",
    salesRep: normalizePersonName(savedRep || contact.rep || contact.owner || seeded?.salesRep || "Unassigned"),
    division: contact.division || "roofing",
    service: contact.service || contact.serviceType || "roof-replacement",
    propertyType: contact.propertyType || "residential",
    urgency: contact.urgency || "normal",
    insuranceClaim: Boolean(contact.insuranceClaim),
    activeLeak: Boolean(contact.activeLeak),
    value: number(contact.value),
    createdAt: contact.createdAt || todayISO(),
    updatedAt: contact.updatedAt || contact.modifiedAt || contact.createdAt || todayISO(),
    lastContact: contact.lastContact || todayISO(),
    closedDate,
    documents: (contact.documents || []).map((document) =>
      normalizeDocument(document, { leadId: contact.id, categories }),
    ),
    updates: (contact.updates || contact.activity || []).map(normalizeUpdate),
  };
  const preserveEmptyJobs = options.preserveEmptyJobs === true && Array.isArray(contact.jobs);
  const jobs = contact.jobs?.length
    ? contact.jobs.map((job) => normalizeJob(job, baseContact))
    : preserveEmptyJobs
      ? []
      : [normalizeJob({}, baseContact)];
  const primaryJobId = jobs[0]?.id || "";
  return {
    ...baseContact,
    // Keep the lead summary aligned with the primary job after repairing a
    // legacy Paid-without-payment status in normalizeJob.
    status: jobs[0]?.status || baseContact.status,
    jobs,
    documents: baseContact.documents.map((document) => ({
      ...document,
      jobId: document.jobId || primaryJobId,
    })),
  };
}

function stageBeforePaid(division = "roofing") {
  const stages = typeof pipelineStagesFor === "function" ? pipelineStagesFor(division) : [];
  const paidIndex = stages.indexOf("Paid");
  return paidIndex > 0 ? stages[paidIndex - 1] : "Completed";
}

function normalizeJob(job, contact = {}) {
  // Relational and legacy payloads can contain a null placeholder in the jobs
  // array. Treat it like an empty job instead of letting one malformed row
  // abort the entire CRM render during startup.
  job = job && typeof job === "object" ? job : {};
  contact = contact && typeof contact === "object" ? contact : {};
  const status = job.status || contact.status || "New";
  const manualPayments = (job.manualPayments || []).map(normalizeManualPayment);
  const manualPaidAmount = manualPayments.reduce((sum, payment) => sum + number(payment.amount), 0);
  const legacyPaidAmount = number(job.paidAmount);
  const squarePaidAmount = Math.max(
    0,
    number(
      job.squarePaidAmount ??
        job.square_paid_amount ??
        Math.max(legacyPaidAmount - manualPaidAmount, 0),
    ),
  );
  const paidAmount = job.paymentLedgerVersion === 2 ? number(job.paidAmount) : Math.round((squarePaidAmount + manualPaidAmount) * 100) / 100;
  const contractValue = number(job.contractValue ?? job.value ?? contact.value);
  // A job cannot stay Paid without confirmed money covering the contract (old
  // records, or a payment removed afterwards). It drops back to the stage
  // before Paid in its own division's pipeline. This used to be "Completed"
  // for every division, which is not a Construction stage: the database then
  // refused the save, so a mistaken payment on a Paid Construction job could
  // never be deleted.
  const normalizedStatus = status === "Paid" && !(contractValue > 0 && paidAmount + 0.005 >= contractValue)
    ? (typeof stageBeforePaid === "function" ? stageBeforePaid(job.division || contact.division || "roofing") : "Completed")
    : status;
  const closedDate =
    job.closedDate || (soldJobStatuses.includes(normalizedStatus) ? contact.closedDate || contact.lastContact || todayISO() : "");
  const squareLastPaymentAt = job.squareLastPaymentAt || job.square_last_payment_at || (job.paymentLedgerVersion !== 2 && !manualPayments.length ? job.lastPaymentAt || "" : "");
  const lastPaymentAt = job.paymentLedgerVersion === 2 ? (job.lastPaymentAt || "") : [
    squareLastPaymentAt,
    ...manualPayments.map((payment) => payment.date || payment.createdAt || ""),
  ]
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  const division = job.division || contact.division || "roofing";
  const propertyType = job.propertyType || contact.propertyType || "residential";
  const requestedSalesStage = String(job.salesStage || job.sales_stage || "").trim();
  const salesStage = typeof normalizeSalesStage === "function"
    ? normalizeSalesStage(job, contact, division, propertyType)
    : String(job.salesStage || status || "New");
  const stageTimestamp = requestedSalesStage === salesStage
    ? job.salesStageEnteredAt || job.sales_stage_entered_at || job.updatedAt || job.modifiedAt || job.createdAt || contact.updatedAt || contact.createdAt || new Date().toISOString()
    : job.updatedAt || job.modifiedAt || contact.updatedAt || new Date().toISOString();
  const salesStageHistory = Array.isArray(job.salesStageHistory)
    ? job.salesStageHistory.filter((entry) => entry && entry.stage && entry.enteredAt).map((entry) => ({
        stage: String(entry.stage),
        enteredAt: entry.enteredAt,
        exitedAt: entry.exitedAt || "",
        actor: entry.actor || "",
      }))
    : [];
  if (!salesStageHistory.length) {
    salesStageHistory.push({ stage: salesStage, enteredAt: stageTimestamp, exitedAt: "", actor: job.salesRep || contact.salesRep || "" });
  } else if (salesStageHistory.at(-1).stage !== salesStage) {
    if (!salesStageHistory.at(-1).exitedAt) salesStageHistory[salesStageHistory.length - 1] = { ...salesStageHistory.at(-1), exitedAt: stageTimestamp };
    salesStageHistory.push({ stage: salesStage, enteredAt: stageTimestamp, exitedAt: "", actor: job.salesRep || contact.salesRep || "" });
  }
  return {
    ...job,
    id: job.id || uid("job"),
    projectNumber: job.projectNumber || "",
    name: job.name || job.title || `${contact.name || "Client"} Job`,
    address: job.address || contact.address || "",
    status: normalizedStatus,
    value: number(job.value ?? contact.value),
    contractValue,
    squarePaidAmount,
    manualPayments,
    paidAmount,
    paymentPercent: contractValue ? Math.min(100, (paidAmount / contractValue) * 100) : 0,
    squareLastPaymentAt,
    lastPaymentAt,
    ownerUserId: job.ownerUserId || contact.ownerUserId || "",
    ownerEmail: job.ownerEmail || contact.ownerEmail || "",
    ownerName: job.ownerName || contact.ownerName || "",
    salesRep: normalizePersonName(job.salesRep || contact.salesRep || "Unassigned"),
    division,
    service: job.service || job.serviceType || contact.service || "roof-replacement",
    propertyType,
    salesStage,
    salesStageEnteredAt: stageTimestamp,
    salesStageHistory,
    urgency: job.urgency || contact.urgency || "normal",
    insuranceClaim: Boolean(job.insuranceClaim ?? contact.insuranceClaim),
    activeLeak: Boolean(job.activeLeak ?? contact.activeLeak),
    lastContact: job.lastContact || contact.lastContact || todayISO(),
    closedDate,
    notes: job.notes || "",
    costItems: (job.costItems || job.costs || []).map(normalizeCostItem),
    emails: (job.emails || []).map(normalizeJobEmail),
    milestones: (job.milestones || []).map((milestone, index) => {
      const milestoneStatus = ["not_started", "in_progress", "blocked", "completed"].includes(milestone.status)
        ? milestone.status
        : milestone.completed ? "completed" : "not_started";
      return {
        ...milestone,
        id: milestone.id || `milestone-${index + 1}`,
        title: String(milestone.title || "Milestone").trim().slice(0, 500),
        description: String(milestone.description || "").trim(),
        dueDate: milestone.dueDate || milestone.due_date || "",
        status: milestoneStatus,
        ownerUserId: milestone.ownerUserId || "",
        ownerEmail: milestone.ownerEmail || "",
        ownerName: milestone.ownerName || "",
        position: Math.max(0, Math.round(number(milestone.position ?? index))),
        completedAt: milestoneStatus === "completed" ? milestone.completedAt || "" : "",
        createdAt: milestone.createdAt || job.createdAt || contact.createdAt || todayISO(),
        updatedAt: milestone.updatedAt || milestone.createdAt || job.updatedAt || job.createdAt || contact.updatedAt || contact.createdAt || todayISO(),
      };
    }),
    profitNotes: job.profitNotes || "",
    createdAt: job.createdAt || contact.createdAt || todayISO(),
    updatedAt: job.updatedAt || job.modifiedAt || job.createdAt || contact.updatedAt || contact.createdAt || todayISO(),
  };
}

function normalizeJobMilestone(milestone = {}, index = 0) {
  const status = ["not_started", "in_progress", "blocked", "completed"].includes(milestone.status)
    ? milestone.status
    : milestone.completed ? "completed" : "not_started";
  return {
    id: milestone.id || uid("milestone"),
    title: String(milestone.title || "Milestone").trim().slice(0, 500),
    description: String(milestone.description || "").trim(),
    dueDate: milestone.dueDate || milestone.due_date || "",
    status,
    ownerUserId: milestone.ownerUserId || "",
    ownerEmail: milestone.ownerEmail || "",
    ownerName: milestone.ownerName || "",
    position: Math.max(0, Math.round(number(milestone.position ?? index))),
    completedAt: status === "completed" ? milestone.completedAt || new Date().toISOString() : "",
    createdAt: milestone.createdAt || new Date().toISOString(),
    updatedAt: milestone.updatedAt || milestone.createdAt || new Date().toISOString(),
  };
}

function normalizeCostItem(item = {}) {
  return {
    id: item.id || uid("cost"),
    date: item.date || todayISO(),
    category: costCategories.includes(item.category) ? item.category : "Other",
    vendor: item.vendor || "",
    description: item.description || item.memo || "",
    amount: number(item.amount),
    paid: Boolean(item.paid),
    reference: item.reference || item.invoice || "",
    createdAt: item.createdAt || new Date().toISOString(),
    createdBy: item.createdBy || "",
  };
}

function normalizeDocument(document, { leadId = "", categoryId = "", categories = defaultDocumentCategories } = {}) {
  // Company library files are stored under the placeholder lead id "company".
  // That is not a lead: treating it as one wiped the file's folder and re-filed
  // it under "Other" whenever the live-sync echo of an upload or move arrived.
  const rawLeadId = document.leadId || document.contactId || leadId;
  const resolvedLeadId = rawLeadId === COMPANY_DOCUMENT_LEAD_ID ? "" : rawLeadId;
  const isLeadDocument = Boolean(resolvedLeadId);
  const category =
    isLeadDocument
      ? categories?.find((item) => item.id === (document.categoryId || categoryId)) ||
        categoryForLegacyName(document.category, categories || defaultDocumentCategories)
      : null;
  return {
    id: document.id || uid("doc"),
    name: document.name || "Document",
    leadId: resolvedLeadId,
    categoryId: isLeadDocument ? document.categoryId || categoryId || category?.id || "" : document.categoryId || "",
    category: isLeadDocument ? category?.name || document.category || "Other" : document.category || "Other",
    folderId: isLeadDocument ? "" : document.folderId || "",
    type: document.type || "application/octet-stream",
    size: number(document.size),
    dataUrl: document.dataUrl || "",
    storagePath: document.storagePath || document.storage_path || "",
    externalUrl: /^https:\/\/(?:docs|drive)\.google\.com\//.test(String(document.externalUrl || "")) ? document.externalUrl : "",
    googleDocumentId: document.googleDocumentId || "",
    previousVersions: Array.isArray(document.previousVersions) ? document.previousVersions : [],
    uploadedAt: document.uploadedAt || new Date().toISOString(),
    uploadedBy: document.uploadedBy || "Local user",
    versionNumber: Math.max(1, number(document.versionNumber || document.version) || 1),
    source: document.source || "",
    sourceDocumentId: document.sourceDocumentId || "",
    estimateId: document.estimateId || "",
    // Only estimate PDFs carry this, so no other document gains a new field.
    ...(document.pdfContentKey ? { pdfContentKey: String(document.pdfContentKey) } : {}),
    // Where a photo's small gallery copy is kept, for photos that have one.
    ...(document.previewPath ? { previewPath: String(document.previewPath) } : {}),
    smartDocument: document.smartDocument && Array.isArray(document.smartDocument.fields)
      ? {
          fields: document.smartDocument.fields.slice(0, 300).map((field, index) => ({
            id: String(field?.id || `field-${index + 1}`),
            label: String(field?.label || `Field ${index + 1}`),
            type: ["text", "textarea", "date", "number", "email", "checkbox", "radio", "signature", "initials"].includes(field?.type) ? field.type : "text",
            required: Boolean(field?.required),
            sourceName: String(field?.sourceName || ""),
            placeholder: String(field?.placeholder || ""),
            page: Math.max(1, Math.round(number(field?.page) || 1)),
            x: field?.x !== null && field?.x !== undefined && field?.x !== "" && Number.isFinite(Number(field.x)) ? Math.max(0, Math.min(1, Number(field.x))) : null,
            y: field?.y !== null && field?.y !== undefined && field?.y !== "" && Number.isFinite(Number(field.y)) ? Math.max(0, Math.min(1, Number(field.y))) : null,
            width: field?.width !== null && field?.width !== undefined && field?.width !== "" && Number.isFinite(Number(field.width)) ? Math.max(0.01, Math.min(1, Number(field.width))) : null,
            height: field?.height !== null && field?.height !== undefined && field?.height !== "" && Number.isFinite(Number(field.height)) ? Math.max(0.01, Math.min(1, Number(field.height))) : null,
            fontSize: Math.max(6, Math.min(72, number(field?.fontSize) || 10)),
            fontFamily: ["Helvetica", "Times Roman", "Courier"].includes(field?.fontFamily) ? field.fontFamily : "Helvetica",
            bold: Boolean(field?.bold),
            italic: Boolean(field?.italic),
            underline: Boolean(field?.underline),
            textColor: /^#[0-9a-f]{6}$/i.test(field?.textColor || "") ? field.textColor : "#071525",
            highlightColor: /^#[0-9a-f]{6}$/i.test(field?.highlightColor || "") ? field.highlightColor : "",
            textAlign: ["left", "center", "right"].includes(field?.textAlign) ? field.textAlign : "left",
            detected: Boolean(field?.detected),
          })),
          responses: document.smartDocument.responses && typeof document.smartDocument.responses === "object" ? { ...document.smartDocument.responses } : {},
          status: ["template", "draft", "completed"].includes(document.smartDocument.status) ? document.smartDocument.status : "template",
          analysisVersion: Math.max(0, Math.round(number(document.smartDocument.analysisVersion) || 0)),
          revision: Math.max(1, number(document.smartDocument.revision) || 1),
          createdAt: document.smartDocument.createdAt || "",
          createdBy: document.smartDocument.createdBy || "",
          updatedAt: document.smartDocument.updatedAt || "",
          updatedBy: document.smartDocument.updatedBy || "",
          completedAt: document.smartDocument.completedAt || "",
          completedBy: document.smartDocument.completedBy || "",
          completedFile: document.smartDocument.completedFile?.storagePath ? { ...document.smartDocument.completedFile } : null,
          completedDocumentId: document.smartDocument.completedDocumentId || "",
          previousCompletions: Array.isArray(document.smartDocument.previousCompletions) ? document.smartDocument.previousCompletions.slice(-10) : [],
          lastEmailedAt: document.smartDocument.lastEmailedAt || "",
          lastEmailedTo: document.smartDocument.lastEmailedTo || "",
          lastEmailMessageId: document.smartDocument.lastEmailMessageId || "",
        }
      : null,
    zohoSign: document.zohoSign?.requestId
      ? {
          requestId: String(document.zohoSign.requestId),
          status: String(document.zohoSign.status || "draft"),
          recipientEmail: String(document.zohoSign.recipientEmail || ""),
          createdAt: document.zohoSign.createdAt || "",
          createdBy: document.zohoSign.createdBy || "",
        }
      : null,
    googleDrive: document.googleDrive?.fileId && /^https:\/\/drive\.google\.com\//.test(document.googleDrive.webViewLink || "")
      ? {
          fileId: String(document.googleDrive.fileId),
          webViewLink: String(document.googleDrive.webViewLink),
          leadFolderId: String(document.googleDrive.leadFolderId || ""),
          jobFolderId: String(document.googleDrive.jobFolderId || ""),
          categoryFolderId: String(document.googleDrive.categoryFolderId || ""),
          versionNumber: Math.max(1, number(document.googleDrive.versionNumber) || 1),
          syncedAt: document.googleDrive.syncedAt || "",
          syncedBy: document.googleDrive.syncedBy || "",
        }
      : null,
    contactId: document.contactId || resolvedLeadId,
    jobId: document.jobId || "",
    kind:
      document.kind || document.recordKind ||
      ((document.categoryId || categoryId) === JOB_PHOTO_CATEGORY_ID ? "photo" : "document"),
  };
}

function normalizeManualPayment(payment = {}) {
  return {
    id: payment.id || uid("payment"),
    date: payment.date || todayISO(),
    method: payment.method || "Check",
    amount: Math.round(Math.max(0, number(payment.amount)) * 100) / 100,
    reference: payment.reference || "",
    note: payment.note || payment.memo || "",
    createdAt: payment.createdAt || new Date().toISOString(),
    updatedAt: payment.updatedAt || payment.createdAt || new Date().toISOString(),
    createdBy: payment.createdBy || "CRM admin",
  };
}

function normalizeJobEmail(email = {}) {
  return {
    id: email.id || uid("job_email"),
    fromEmail: email.fromEmail || "",
    toEmail: email.toEmail || "",
    subject: email.subject || "",
    message: email.message || "",
    createdAt: email.createdAt || new Date().toISOString(),
    createdBy: email.createdBy || "CRM user",
    provider: email.provider || "",
    providerMessageId: email.providerMessageId || email.gmailMessageId || "",
    providerThreadId: email.providerThreadId || email.gmailThreadId || "",
    direction: email.direction === "inbound" ? "inbound" : "outbound",
    deliveryStatus: email.deliveryStatus || "",
    attachmentName: email.attachmentName || "",
  };
}

function normalizeCalendarTask(task) {
  const workflowStatus = ["not_started", "in_progress", "blocked", "completed", "cancelled"].includes(task.workflowStatus)
    ? task.workflowStatus
    : task.completed ? "completed" : "not_started";
  const checklist = (Array.isArray(task.checklist) ? task.checklist : []).map((item, index) => ({
    id: item.id || uid("check"),
    label: String(item.label || item.title || "Checklist item").trim().slice(0, 500),
    completed: Boolean(item.completed),
    position: Math.max(0, Math.round(number(item.position ?? index))),
    completedAt: item.completed ? item.completedAt || "" : "",
  }));
  return {
    id: task.id || uid("task"),
    title: task.title || "Calendar task",
    rep: task.rep || "Unassigned",
    ownerUserId: task.ownerUserId || "",
    ownerEmail: task.ownerEmail || "",
    ownerName: task.ownerName || "",
    contactId: task.contactId || "",
    jobId: task.jobId || "",
    dueAt: task.dueAt || new Date().toISOString(),
    duration: Math.max(number(task.duration) || 30, 5),
    reminder: task.reminder || "popup",
    notes: task.notes || "",
    priority: ["low", "normal", "high", "urgent"].includes(task.priority) ? task.priority : "normal",
    workflowStatus,
    recurrence: ["none", "daily", "weekly", "monthly", "yearly"].includes(task.recurrence) ? task.recurrence : "none",
    followers: (Array.isArray(task.followers) ? task.followers : String(task.followers || "").split(","))
      .map((value) => String(value || "").trim().toLowerCase())
      .filter((value, index, values) => value && values.indexOf(value) === index),
    checklist,
    comments: (Array.isArray(task.comments) ? task.comments : []).map((comment) => ({
      id: comment.id || uid("comment"),
      body: String(comment.body || comment.message || "").trim(),
      author: comment.author || "CRM user",
      createdAt: comment.createdAt || new Date().toISOString(),
    })).filter((comment) => comment.body),
    timeEntries: (Array.isArray(task.timeEntries) ? task.timeEntries : []).map((entry) => ({
      id: entry.id || uid("time"),
      startedAt: entry.startedAt || new Date().toISOString(),
      stoppedAt: entry.stoppedAt || "",
      userEmail: entry.userEmail || "",
    })),
    createdAt: task.createdAt || new Date().toISOString(),
    updatedAt: task.updatedAt || task.createdAt || new Date().toISOString(),
    completed: workflowStatus === "completed" || Boolean(task.completed),
    googleEventId: task.googleEventId || "",
    googleEventUrl: task.googleEventUrl || "",
    googleSyncStatus: ["synced", "pending", "not_connected", "error"].includes(task.googleSyncStatus) ? task.googleSyncStatus : "",
    googleSyncedAt: task.googleSyncedAt || "",
    googleSyncError: task.googleSyncError || "",
    addGoogleMeet: Boolean(task.addGoogleMeet),
    googleMeetLink: /^https:\/\/meet\.google\.com\//.test(task.googleMeetLink || "") ? task.googleMeetLink : "",
    googleTaskId: task.googleTaskId || "",
    googleTaskListId: task.googleTaskListId || "",
    googleTaskSyncStatus: ["synced", "pending", "not_connected", "error"].includes(task.googleTaskSyncStatus) ? task.googleTaskSyncStatus : "",
    googleTaskSyncedAt: task.googleTaskSyncedAt || "",
    googleTaskSyncError: task.googleTaskSyncError || "",
  };
}

function normalizeUpdate(update) {
  return {
    id: update.id || uid("update"),
    author: update.author || "Local user",
    message: update.message || "",
    status: update.status || "",
    jobId: update.jobId || "",
    createdAt: update.createdAt || new Date().toISOString(),
  };
}

function normalizeEstimate(estimate, contacts = []) {
  const contact = contacts.find((item) => item.id === estimate.contactId);
  const jobs = contact ? contactJobs(contact) : [];
  const job = jobs.find((item) => item.id === estimate.jobId) || jobs[0];
  const normalized = {
    ...estimate,
    status: estimate.status === "Approved" ? "Won" : estimate.status || "Draft",
    jobId: estimate.jobId || job?.id || "",
    projectTitle:
      estimate.projectTitle ||
      estimate.title ||
      `${job?.name || contact?.name || "Customer"} Exterior Estimate`,
    projectManager: normalizePersonName(estimate.projectManager || job?.salesRep || contact?.salesRep || ""),
    ownerUserId: estimate.ownerUserId || contact?.ownerUserId || "",
    ownerEmail: estimate.ownerEmail || contact?.ownerEmail || "",
    ownerName: estimate.ownerName || contact?.ownerName || "",
    salesRepEmail: estimate.salesRepEmail || estimate.repEmail || "",
    salesRepPhone: estimate.salesRepPhone || estimate.repPhone || "",
    items: ensureEstimateLineIds((estimate.items || []).map(normalizeLineItem)),
    leadNumber: estimate.leadNumber || contact?.leadNumber || "",
    projectNumber: estimate.projectNumber || job?.projectNumber || "",
    squareInvoiceId: estimate.squareInvoiceId || "",
    squareOrderId: estimate.squareOrderId || "",
    squareInvoiceUrl: estimate.squareInvoiceUrl || "",
    squareStatus: estimate.squareStatus || "",
    paidAt: estimate.paidAt || "",
    contractValue: number(estimate.contractValue),
    paidAmount: number(estimate.paidAmount),
    paymentPercent: number(estimate.paymentPercent),
    paymentRequests: Array.isArray(estimate.paymentRequests) ? estimate.paymentRequests : [],
    paymentUpdatedAt: estimate.paymentUpdatedAt || "",
  };
  if (normalized.paidAt && !normalized.paidAmount) {
    const legacyPaidTotal = totalsFor(normalized).total;
    normalized.contractValue = normalized.contractValue || legacyPaidTotal;
    normalized.paidAmount = normalized.contractValue;
    normalized.paymentPercent = normalized.contractValue ? 100 : 0;
  }
  normalized.paymentPercent = normalized.contractValue ? Math.min(100, normalized.paidAmount / normalized.contractValue * 100) : 0;
  return normalized;
}

// Every estimate line has an id of its own. When two people change the same
// estimate, the save combines their work line by line: a line one of them
// added, changed or removed is kept as they left it. Without ids the list of
// lines could only be taken whole from whoever saved last, and the other
// person's lines silently disappeared.
//
// Lines saved before ids existed are numbered by position ("line-1", ...).
// That is the same on every device that loads the same estimate, which is what
// lets two people who both opened the old copy still be combined. Lines made
// from now on get a random id when they are created.
function ensureEstimateLineIds(items = []) {
  const list = Array.isArray(items) ? items : [];
  const hasId = (item) => Boolean(item) && ["string", "number"].includes(typeof item.id) && item.id !== "";
  if (list.every(hasId) && new Set(list.map((item) => String(item.id))).size === list.length) return list;
  const savedBeforeIds = !list.some(hasId);
  const used = new Set();
  return list.map((item, index) => {
    let id = hasId(item) ? String(item.id) : savedBeforeIds ? `line-${index + 1}` : uid("line");
    while (used.has(id)) id = uid("line");
    used.add(id);
    return { ...item, id };
  });
}

// The same ids on the copies a save is merged with: the one this editor
// loaded and the one that is in the database now.
function mergeReadyRecordData(row, data) {
  if (row?.record_type !== "estimate" || !data || typeof data !== "object" || !Array.isArray(data.items)) return data;
  return { ...data, items: ensureEstimateLineIds(data.items) };
}

function normalizeLineItem(item) {
  const title = item.title || item.name || item.product || "Line item";
  return {
    ...item,
    title,
    description: item.description || item.details || "",
    quantity: number(item.quantity),
    unit: item.unit || "ea",
    rate: number(item.rate),
  };
}

let draftRecoveryStore = null;
let recoveryCache = null;
const DISMISSED_NOTICE_PREFIX = "jobcrest.crm.dismissed-notice:";

function noticeWasDismissed(key, storage = localStorage) {
  try { return storage.getItem(`${DISMISSED_NOTICE_PREFIX}${key}`) === "1"; }
  catch { return false; }
}

function addNoticeCloseButton(panel, key, { storage = localStorage, label = "Close this notice" } = {}) {
  const close = document.createElement("button");
  close.type = "button";
  close.className = "crm-notice-close";
  close.setAttribute("aria-label", label);
  close.title = label;
  close.textContent = "×";
  close.addEventListener("click", () => {
    try { storage.setItem(`${DISMISSED_NOTICE_PREFIX}${key}`, "1"); } catch { /* Closing still works for this page. */ }
    panel.remove();
  });
  panel.appendChild(close);
  return close;
}

function recoveryNoticeKey(entries) {
  let hash = 2166136261;
  const value = entries.map((entry) => `${entry.key}:${entry.raw}`).sort().join("|");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `draft-recovery:${entries.length}:${(hash >>> 0).toString(16)}`;
}

function hasPendingCompanyChanges() {
  return canAction("manageCompany") && (Boolean(state.companyFormDraft) ||
    (cloudReady && durableBusinessStateAuthoritative && sharedStateSnapshot() !== lastCloudSnapshot));
}

// Which records have an edit that has not been saved yet, as "type:id".
function pendingDurableRecordKeys() {
  try {
    const projection = durableStateProjection();
    return projection.rows.map(durableRecordKey).filter((key) => durableRecordFingerprints.get(key) !== projection.fingerprints.get(key));
  } catch {
    return [];
  }
}

function checkpointPendingDraft(serializedState) {
  if (!draftRecoveryStore || !durableRecordsReady || applyingCloudState) return;
  if (durableWriteBlocked || hasPendingDurableChanges() || hasPendingCompanyChanges()) {
    // The copy says which records were unsaved when it was taken. Everything
    // else in it had been saved, and must not be mistaken for lost work later.
    const details = { pending: typeof pendingDurableRecordKeys === "function" ? pendingDurableRecordKeys() : [] };
    const stored = typeof serializedState === "string" ? draftRecoveryStore.captureSerialized(serializedState, details) : draftRecoveryStore.capture(state, details);
    if (stored?.then) stored.then((available) => { if (!available) showDraftStorageWarning(); });
    else if (!stored) showDraftStorageWarning();
  } else if (!durableSaveInFlight && !cloudSaveInFlight) {
    const settled = draftRecoveryStore.settle();
    if (settled?.catch) settled.catch(() => showDraftStorageWarning());
  }
}

function showDraftStorageWarning() {
  if (document.getElementById("crmDraftStorageWarning")) return;
  const dismissalKey = "draft-storage-warning";
  if (noticeWasDismissed(dismissalKey, sessionStorage)) return;
  const notice = document.createElement("aside");
  notice.id = "crmDraftStorageWarning";
  notice.setAttribute("role", "alert");
  notice.style.cssText = "position:fixed;top:12px;left:16px;right:16px;z-index:100001;background:#fff4de;color:#34250b;padding:16px 52px 16px 16px;border:2px solid #b87912;border-radius:12px";
  const message = document.createElement("span");
  message.textContent = "This browser cannot keep a recovery copy. Shared saving will still be attempted. Keep this tab open until your changes are saved; closing it during a connection problem could lose unsaved work.";
  notice.appendChild(message);
  addNoticeCloseButton(notice, dismissalKey, { storage: sessionStorage, label: "Close recovery warning" });
  document.body.appendChild(notice);
}

function showPreviousDraftRecovery(entries) {
  if (!entries.length) return;
  const dismissalKey = recoveryNoticeKey(entries);
  if (noticeWasDismissed(dismissalKey)) return;
  const panel = document.createElement("aside");
  panel.id = "crmPreviousDraftRecovery";
  panel.setAttribute("role", "alert");
  panel.style.cssText = "position:fixed;top:16px;left:16px;right:16px;z-index:100002;background:#fff4de;color:#34250b;border:2px solid #b87912;border-radius:12px;padding:16px 52px 16px 16px";
  const message = document.createElement("p");
  message.textContent = "Unfinished work from an earlier session is available. The shared CRM has not been overwritten. Download the recovery copy and compare it with the current records before reapplying missing edits. The file contains private customer data.";
  const download = document.createElement("button");
  download.type = "button";
  download.textContent = "Download earlier work";
  let downloaded = false;
  download.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 1, entries }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "jobcrest-earlier-unsaved-work.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    downloaded = true;
  });
  const reviewed = document.createElement("button");
  reviewed.type = "button";
  reviewed.textContent = "I have kept the recovery file";
  reviewed.addEventListener("click", async () => {
    if (!downloaded) { message.textContent = "Download the recovery file first, then confirm it is safely saved. No earlier edits will be reapplied automatically."; return; }
    if (!(await appConfirm("Has the recovery file finished downloading and been saved securely? Only these exported device copies will be removed.", { title: "Remove device copies", confirmLabel: "Remove copies" }))) return;
    if (draftRecoveryStore.acknowledge(entries)) panel.remove();
    else message.textContent = "The browser could not remove the device copies. Keep your downloaded file secure.";
  });
  panel.append(message, download, reviewed);
  addNoticeCloseButton(panel, dismissalKey, { label: "Close earlier-work notice" });
  document.body.appendChild(panel);
}

function writeStateToLocalStorage() {
  if (typeof recoveryCache !== "undefined" && recoveryCache) {
    checkpointPendingDraft();
    recoveryCache.put(activeStorageKey(), state).catch(() => showDraftStorageWarning());
    return true;
  }
  try {
    if (localStateWriteBlocked) return false;
    const storageKey = activeStorageKey();
    const metadata = readLocalStateMetadata(storageKey);
    if (metadata.revision > localStateBaseRevision && metadata.writerId !== localStateWriterId) {
      localStateWriteBlocked = true;
      return false;
    }
    const serializedState = JSON.stringify(state);
    checkpointPendingDraft(serializedState);
    localStorage.setItem(storageKey, serializedState);
    localStateBaseRevision = Math.max(metadata.revision, localStateBaseRevision) + 1;
    localStorage.setItem(localStateMetadataKey(storageKey), JSON.stringify({
      revision: localStateBaseRevision,
      writerId: localStateWriterId,
      writtenAt: new Date().toISOString(),
    }));
    localStateWriteBlocked = false;
    return true;
  } catch {
    console.warn("Local recovery cache is unavailable. Cloud saving will still be attempted; keep this tab open until saving completes.");
    return false;
  }
}

function flushQueuedLocalStateSave() {
  window.clearTimeout(localStateSaveTimer);
  localStateSaveTimer = null;
  return writeStateToLocalStorage();
}

function queueLocalStateSave(delay = 200) {
  localEditRevision += 1;
  if (typeof invalidateDurableProjection === "function") invalidateDurableProjection();
  window.clearTimeout(localStateSaveTimer);
  localStateSaveTimer = window.setTimeout(flushQueuedLocalStateSave, delay);
}

function saveState(options = {}) {
  if (!options.localOnly && !applyingCloudState) localEditRevision += 1;
  // localOnly saves commonly follow an in-place edit. Never reuse a projection
  // captured before that edit, even when this cache-only write does not advance
  // the edit revision.
  if (typeof invalidateDurableProjection === "function") invalidateDurableProjection();
  window.clearTimeout(localStateSaveTimer);
  localStateSaveTimer = null;
  const localSaved = writeStateToLocalStorage();
  if (!options.localOnly && !applyingCloudState) {
    queueCloudSave();
    queueDurableRecordsSave();
  }
  return localSaved;
}

function supabaseConfig() {
  return window.RooflineAuth?.config || {};
}

function supabaseStateId() {
  return supabaseConfig().stateId || "coastal-crest";
}

function cloudCompanyStateId() {
  return `${supabaseStateId()}:${COMPANY_STATE_SUFFIX}`;
}

function cloudUserStateId(userId = authSession?.user?.id) {
  return `${supabaseStateId()}:user:${userId || "anonymous"}`;
}

function canUseCloudSync() {
  return Boolean(supabaseConfig().syncEnabled && window.RooflineAuth?.hasConfig());
}

function currentOwner() {
  return {
    userId: authSession?.user?.id || "",
    email: authSession?.user?.email || state.currentUser.email || "",
    name: state.currentUser.name || authSession?.user?.email?.split("@")[0] || "CRM User",
    role: currentRole(),
  };
}

function recordOwnedByCurrentUser(record = {}) {
  if (!authSession?.user?.id) return true;
  if (canManageTeamData()) return true;
  const ownerId = record.ownerUserId || record.owner_id || "";
  const ownerEmail = String(record.ownerEmail || record.owner_email || "").trim().toLowerCase();
  const signedInEmail = String(authSession.user.email || "").trim().toLowerCase();
  return ownerId === authSession.user.id || Boolean(ownerEmail && ownerEmail === signedInEmail);
}

// Archived leads are kept (with their jobs, files and payment history) but are
// left out of every list, board and total. A lead with payments can never be
// deleted, so archiving is how a test or mistaken record is put away.
function visibleContacts() {
  return state.contacts.filter((contact) => recordOwnedByCurrentUser(contact) && !contact.archived);
}

function archivedContacts() {
  return state.contacts.filter((contact) => recordOwnedByCurrentUser(contact) && contact.archived);
}

async function setContactArchived(contactId, archived) {
  if (!requireAction("manageContacts")) return false;
  if (!canManageTeamData()) { showToast("Ask a manager to archive or restore a lead."); return false; }
  const contact = getContact(contactId);
  if (!contact || Boolean(contact.archived) === archived) return false;
  if (archived && !(await appConfirm(
    `Archive ${contact.name}? The lead, its jobs, documents and payment history are kept, but it is hidden from every list, the pipeline, and all totals. You can restore it from Contacts > Archived.`,
    { title: "Archive lead", confirmLabel: "Archive lead" },
  ))) return false;
  const updateId = uid("update");
  updateContact(contactId, (current) => ({
    ...current,
    archived,
    archivedAt: archived ? new Date().toISOString() : "",
    updates: [{ id: updateId, author: currentActorName(), message: archived ? "Lead archived." : "Lead restored from the archive.", createdAt: new Date().toISOString() }, ...(current.updates || [])],
  }));
  if (archived && state.selectedContactId === contactId) {
    state.selectedContactId = null;
    if (state.view === "leadDetail") state.view = "contacts";
  }
  saveState();
  if (typeof els.contactDialog?.close === "function" && els.contactDialog.open) els.contactDialog.close();
  render();
  showToast(archived ? `${contact.name} archived` : `${contact.name} restored`);
  return true;
}

// An archived lead's estimates and invoices are put away with it. They used to
// stay in the estimate list and in Billing: archiving a test lead with a $100
// Square invoice left "$100.00 owed on invoices" on the Billing screen, although
// archiving says the lead is hidden from every list and all totals.
function leadIsArchived(contactId) {
  return Boolean(contactId && state.contacts.find((contact) => contact.id === contactId)?.archived);
}

function visibleEstimates() {
  return state.estimates.filter((estimate) => {
    const contact = state.contacts.find((item) => item.id === estimate.contactId);
    if (contact?.archived) return false;
    return recordOwnedByCurrentUser(estimate) || recordOwnedByCurrentUser(contact);
  });
}

function visibleCalendarTasks() {
  return state.calendarTasks.filter((task) =>
    recordOwnedByCurrentUser(task) || recordOwnedByCurrentUser(state.contacts.find((contact) => contact.id === task.contactId)),
  );
}

function ownerFromRow(row = {}) {
  const dataOwner = row.data?.owner || {};
  const owner = {
    userId: dataOwner.userId || row.owner_id || row.updated_by || "",
    email: dataOwner.email || row.owner_email || "",
    name: dataOwner.name || row.owner_email || "CRM User",
    role: dataOwner.role || "sales",
  };
  if (owner.userId) cloudKnownOwners.set(owner.userId, owner);
  return owner;
}

function ownerForUserId(ownerId) {
  if (ownerId && cloudKnownOwners.has(ownerId)) return cloudKnownOwners.get(ownerId);
  const owner = currentOwner();
  return ownerId === owner.userId ? owner : { userId: ownerId || "", email: "", name: "CRM User", role: "sales" };
}

function withOwner(record = {}, owner = currentOwner()) {
  return {
    ...record,
    ownerUserId: record.ownerUserId || owner.userId,
    ownerEmail: record.ownerEmail || owner.email,
    ownerName: record.ownerName || owner.name,
  };
}

function tagContactOwner(contact, owner) {
  const tagged = withOwner(contact, owner);
  const jobs = (tagged.jobs || []).map((job) => withOwner(job, owner));
  return normalizeContact({ ...tagged, jobs });
}

function tagEstimateOwner(estimate, owner, contacts = state.contacts) {
  const contact = contacts.find((item) => item.id === estimate.contactId);
  const inferredOwner = contact?.ownerUserId
    ? { userId: contact.ownerUserId, email: contact.ownerEmail, name: contact.ownerName, role: owner.role }
    : owner;
  return normalizeEstimate(withOwner(estimate, inferredOwner), contacts);
}

function tagCalendarTaskOwner(task, owner, contacts = state.contacts) {
  const contact = contacts.find((item) => item.id === task.contactId);
  const inferredOwner = contact?.ownerUserId
    ? { userId: contact.ownerUserId, email: contact.ownerEmail, name: contact.ownerName, role: owner.role }
    : owner;
  return normalizeCalendarTask(withOwner(task, inferredOwner));
}

function ensureStateOwnership() {
  const owner = currentOwner();
  state.contacts = state.contacts.map((contact) => (contact.ownerUserId ? normalizeContact(contact) : tagContactOwner(contact, owner)));
  state.estimates = state.estimates.map((estimate) =>
    estimate.ownerUserId ? normalizeEstimate(estimate, state.contacts) : tagEstimateOwner(estimate, owner),
  );
  state.calendarTasks = state.calendarTasks.map((task) =>
    task.ownerUserId ? normalizeCalendarTask(task) : tagCalendarTaskOwner(task, owner),
  );
}

function contactOwnerId(contact) {
  return contact?.ownerUserId || currentOwner().userId;
}

function estimateOwnerId(estimate) {
  const contact = getContact(estimate?.contactId);
  return estimate?.ownerUserId || contact?.ownerUserId || currentOwner().userId;
}

function calendarTaskOwnerId(task) {
  const contact = getContact(task?.contactId);
  return task?.ownerUserId || contact?.ownerUserId || currentOwner().userId;
}

function ownerIdsInState() {
  const ids = new Set([currentOwner().userId]);
  state.contacts.forEach((contact) => ids.add(contactOwnerId(contact)));
  state.estimates.forEach((estimate) => ids.add(estimateOwnerId(estimate)));
  state.calendarTasks.forEach((task) => ids.add(calendarTaskOwnerId(task)));
  return [...ids].filter(Boolean);
}

function companyStatePayload() {
  return {
    company: state.company,
    ...(durableBusinessStateAuthoritative ? {} : { companyDocuments: state.companyDocuments }),
  };
}

function privateStatePayload(ownerId = currentOwner().userId) {
  const owner = ownerForUserId(ownerId);
  return {
    owner,
    contacts: state.contacts.filter((contact) => contactOwnerId(contact) === ownerId),
    estimates: state.estimates.filter((estimate) => estimateOwnerId(estimate) === ownerId),
    calendarTasks: state.calendarTasks.filter((task) => calendarTaskOwnerId(task) === ownerId),
  };
}

function cloudRowsForSave() {
  if (durableBusinessStateAuthoritative) {
    // Business objects already use versioned record transactions. Never send a
    // second, unversioned copy of every lead/job when one field changes.
    if (!canAction("manageCompany")) return [];
    return [{ id: cloudCompanyStateId(), data: companyStatePayload(), owner_id: null,
      owner_email: "", updated_by: authSession.user.id, updated_at: new Date().toISOString() }];
  }
  ensureStateOwnership();
  const now = new Date().toISOString();
  const ownerIds = canManageTeamData() ? ownerIdsInState() : [currentOwner().userId];
  const privateRows = ownerIds.map((ownerId) => {
    const owner = ownerForUserId(ownerId);
    return {
      id: cloudUserStateId(ownerId),
      data: privateStatePayload(ownerId),
      owner_id: ownerId,
      owner_email: owner.email || "",
      updated_by: authSession.user.id,
      updated_at: now,
    };
  });

  return [
    {
      id: cloudCompanyStateId(),
      data: companyStatePayload(),
      owner_id: null,
      owner_email: "",
      updated_by: authSession.user.id,
      updated_at: now,
    },
    ...privateRows,
  ];
}

function cloudSnapshotPayload() {
  if (durableBusinessStateAuthoritative) return canAction("manageCompany") ? { company: companyStatePayload() } : {};
  ensureStateOwnership();
  const ownerIds = canManageTeamData() ? ownerIdsInState() : [currentOwner().userId];
  return {
    company: companyStatePayload(),
    privateRows: ownerIds.map((ownerId) => ({
      id: cloudUserStateId(ownerId),
      ownerId,
      data: privateStatePayload(ownerId),
    })),
  };
}

function sharedStateSnapshot(payload = cloudSnapshotPayload()) {
  return JSON.stringify(payload);
}

function applySharedState(data = {}) {
  const personalState = {
    view: state.view,
    search: state.search,
    sidebarMode: state.sidebarMode,
    reminderFilter: state.reminderFilter,
    pipelineFilter: state.pipelineFilter,
    leadStageFilter: state.leadStageFilter,
    leaderboardRange: state.leaderboardRange,
    leadDetailTab: state.leadDetailTab,
    selectedContactId: state.selectedContactId,
    selectedEstimateId: state.selectedEstimateId,
    currentUser: state.currentUser,
  };
  state = normalizeState({
    ...createEmptyState(),
    ...state,
    ...data,
    ...personalState,
  });
}

function isCompanyCloudRow(row = {}) {
  return row.id === cloudCompanyStateId();
}

function isRelevantCloudRow(row = {}) {
  if (!row?.id) return false;
  if (canManageTeamData()) return row.id === supabaseStateId() || row.id.startsWith(`${supabaseStateId()}:`);
  return row.id === cloudCompanyStateId() || row.id === cloudUserStateId();
}

function cloudRowFingerprint(row = {}) {
  return JSON.stringify(canonicalRecordValue({ id: row.id || "", data: row.data || {} }));
}

function markRecentCloudWrite(row) {
  if (!row?.id) return;
  recentCloudWrites.set(row.id, {
    fingerprint: cloudRowFingerprint(row),
    expiresAt: Date.now() + 10000,
  });
}

function clearRecentCloudWrite(row) {
  if (!row?.id) return;
  const recent = recentCloudWrites.get(row.id);
  if (recent?.fingerprint === cloudRowFingerprint(row)) recentCloudWrites.delete(row.id);
}

function consumeRecentCloudEcho(row) {
  if (!row?.id) return false;
  const recent = recentCloudWrites.get(row.id);
  if (!recent) return false;
  if (recent.expiresAt < Date.now()) {
    recentCloudWrites.delete(row.id);
    return false;
  }
  if (recent.fingerprint !== cloudRowFingerprint(row)) return false;
  recentCloudWrites.delete(row.id);
  return true;
}

function mergeCloudRows(rows = []) {
  const companyRow = rows.find(isCompanyCloudRow);
  const fallbackCompanyRow = rows.find((row) => row.data?.company || row.data?.companyDocuments);
  const companyData = companyRow?.data || (durableBusinessStateAuthoritative ? {} : fallbackCompanyRow?.data) || {};
  const contactMap = new Map();
  const estimateMap = new Map();
  const taskMap = new Map();

  rows
    .filter((row) => !isCompanyCloudRow(row))
    .forEach((row) => {
      const owner = ownerFromRow(row);
      const rowContacts = (row.data?.contacts || []).map((contact) => tagContactOwner(contact, owner));
      rowContacts.forEach((contact) => contactMap.set(contact.id, contact));
      const mergedContacts = [...contactMap.values()];

      (row.data?.estimates || [])
        .map((estimate) => tagEstimateOwner(estimate, owner, mergedContacts))
        .forEach((estimate) => estimateMap.set(estimate.id, estimate));

      (row.data?.calendarTasks || [])
        .map((task) => tagCalendarTaskOwner(task, owner, mergedContacts))
        .forEach((task) => taskMap.set(task.id, task));
    });

  const durableBusinessState = durableBusinessStateAuthoritative
    ? {
        contacts: state.contacts,
        estimates: state.estimates,
        calendarTasks: state.calendarTasks,
        companyDocuments: state.companyDocuments,
      }
    : {
        contacts: [...contactMap.values()],
        estimates: [...estimateMap.values()],
        calendarTasks: [...taskMap.values()],
        companyDocuments: companyData.companyDocuments || state.companyDocuments,
      };

  applySharedState({
    company: companyData.company || state.company,
    ...durableBusinessState,
  });
  ensureStateOwnership();
}

async function fetchCloudRows() {
  const selectColumns = "*";
  if (durableBusinessStateAuthoritative) return cloudClient.from(SUPABASE_CRM_TABLE).select(selectColumns).eq("id", cloudCompanyStateId());
  const query =
    canManageTeamData()
      ? cloudClient.from(SUPABASE_CRM_TABLE).select(selectColumns).order("updated_at", { ascending: true })
      : cloudClient
          .from(SUPABASE_CRM_TABLE)
          .select(selectColumns)
          .in("id", [cloudCompanyStateId(), cloudUserStateId()])
          .order("updated_at", { ascending: true });
  return query;
}

async function reloadCloudState({ showUpdateToast = false } = {}) {
  if (durableWriteBlocked) return false;
  if (cloudSaveInFlight || hasPendingCompanyChanges()) return false;
  const revision = localEditRevision;
  const { data, error } = await fetchCloudRows();
  if (error) {
    console.warn("Supabase CRM state could not be loaded", error);
    showToast("Supabase is connected, but the CRM table needs the latest setup.");
    return false;
  }
  if (durableWriteBlocked || revision !== localEditRevision || cloudSaveInFlight || hasPendingCompanyChanges() || durableSaveInFlight || hasPendingDurableChanges()) return false;
  if (durableBusinessStateAuthoritative) {
    try { getCompanySettingsWriter().remember((data || []).find(isCompanyCloudRow)); }
    catch (error) {
      preserveBlockedDurableWrite({ error, payload: { p_request_id: crypto.randomUUID(), rpc: 'crm_commit_company_settings' } });
      return false;
    }
  }
  applyingCloudState = true;
  mergeCloudRows(data || []);
  applyingCloudState = false;
  lastCloudSnapshot = sharedStateSnapshot();
  saveState({ localOnly: true });
  return true;
}

function queueCloudSave() {
  if (durableWriteBlocked) return;
  if (canUseCloudSync() && !durableRecordsReady) return;
  if (!cloudReady || !cloudClient || !authSession?.user?.id) return;
  const snapshot = sharedStateSnapshot();
  if (snapshot === lastCloudSnapshot) return;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(flushCloudSave, CLOUD_SAVE_DELAY);
}

function getCompanySettingsWriter() {
  if (!companySettingsWriter) companySettingsWriter = window.CrmCompanySettingsWrites.create({
    companyId: supabaseStateId(), requestId: () => crypto.randomUUID(),
    rpc: (name, payload) => cloudClient.rpc(name, payload),
    fetchCurrent: async () => {
      const { data, error } = await cloudClient.from(SUPABASE_CRM_TABLE).select("id,version,data")
        .eq("id", `${supabaseStateId()}:company`).maybeSingle();
      if (error) throw error;
      return data && Number.isSafeInteger(data.version) ? data : null;
    },
    onMerged: (entries) => applyMergedCompanySettings(entries),
    onBlocked: preserveBlockedDurableWrite,
  });
  return companySettingsWriter;
}

// After a settings save was merged with a teammate's newer save, bring their
// additions into this tab without dropping anything typed here since the save
// started (three-way: what we sent, what we have now, what was saved).
function applyMergedCompanySettings(entries = []) {
  const entry = entries.find((item) => item?.row?.data?.company);
  if (!entry) return;
  const sent = entry.localData?.company || {};
  const saved = entry.row.data.company;
  const merged = window.CrmRecordWrites.mergeRecordData(sent, state.company, saved, [], []);
  applyingCloudState = true;
  try {
    applySharedState({
      company: merged,
      contacts: state.contacts,
      estimates: state.estimates,
      calendarTasks: state.calendarTasks,
      companyDocuments: state.companyDocuments,
    });
  } finally {
    applyingCloudState = false;
  }
  renderDurableUpdateWhenIdle();
}

async function flushCloudSave() {
  if (durableWriteBlocked) return false;
  if (canUseCloudSync() && !durableRecordsReady) return false;
  if (!cloudReady || !cloudClient || !authSession?.user?.id || cloudSaveInFlight) return false;
  const rows = cloudRowsForSave();
  const snapshot = sharedStateSnapshot();
  if (snapshot === lastCloudSnapshot) return true;
  if (!rows.length) { lastCloudSnapshot = snapshot; return true; }

  cloudSaveInFlight = true;
  checkpointPendingDraft();
  rows.forEach(markRecentCloudWrite);
  try {
    const { error } = durableBusinessStateAuthoritative
      ? await getCompanySettingsWriter().commit(rows[0].data)
      : await cloudClient.from(SUPABASE_CRM_TABLE).upsert(rows, { onConflict: "id" });
    if (error) throw error;
  } catch (error) {
    rows.forEach(clearRecentCloudWrite);
    console.warn("Supabase CRM sync failed", error);
    if (!durableWriteBlocked) showToast("Company settings could not be saved. Keep this page open and try again.");
    return false;
  } finally {
    cloudSaveInFlight = false;
  }

  lastCloudSnapshot = snapshot;
  checkpointPendingDraft();
  if (sharedStateSnapshot() !== lastCloudSnapshot) queueCloudSave();
  return true;
}

async function promoteSignedInSession() {
  if (!window.RooflineAuth?.hasConfig()) return authSession;
  const trusted = await window.RooflineAuth.getTrustedUser();
  if (!trusted.user || !window.RooflineAuth.isAllowedUser(trusted.user)) return authSession;
  return trusted;
}

