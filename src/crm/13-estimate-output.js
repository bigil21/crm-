function retryWaitingEstimatePdfFilings() {
  [...estimatePdfFilingRetries.keys()].forEach((estimateId) => { void retryEstimatePdfFiling(estimateId); });
}

// Identifies a PDF by what is in it. The same estimate always produces the
// same file apart from the moment it was made and a random file id, so those
// two are left out. Blank when it cannot be worked out, which only means the
// PDF is filed again.
async function estimatePdfContentKey(doc) {
  try {
    if (!globalThis.crypto?.subtle) return "";
    const content = doc.output()
      .replace(/\/CreationDate \(D:[^)]*\)/g, "")
      .replace(/\/ID \[\s*<[0-9A-Fa-f]*>\s*<[0-9A-Fa-f]*>\s*\]/g, "");
    const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(content, (character) => character.charCodeAt(0) & 255));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return "";
  }
}

async function estimatePdfDocumentId(contactId, jobId, estimateId) {
  // Stable across tabs/devices, bounded, and safe as a storage path segment.
  const bytes = new TextEncoder().encode(JSON.stringify([contactId, jobId, estimateId]));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return "doc-estpdf-" + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
}

// How many times an estimate's PDF can be filed afresh after being removed
// from its lead. See the series of ids in commitSharedEstimatePdf.
const ESTIMATE_PDF_ID_SERIES_LIMIT = 25;

async function commitSharedEstimatePdf(estimate, contact, saved, previousRow, targetIsCurrent) {
  const actor = authSession.user.id;
  const company = supabaseStateId();
  const firstId = saved.id;
  const note = previousRow ? null : { id: uid("update"), company_state_id: company, lead_id: contact.id,
    job_id: saved.jobId, event_type: "note", actor_user_id: actor, actor_name: currentActorName(),
    message: `Saved estimate PDF ${estimate.estimateNumber} to documents.`, status: "", metadata: {}, created_at: saved.uploadedAt };
  let confirmed = null;
  for (let turn = 1; ; turn += 1) {
    const row = { company_state_id: company, record_type: "document", id: saved.id, lead_id: contact.id,
      job_id: saved.jobId, owner_id: previousRow?.owner_id || contactOwnerId(contact) || actor,
      data: durableRecordData(saved), updated_by: actor, deleted_at: null };
    // Independent optimistic write: never publish a speculative document to the
    // main save queue, which could otherwise reapply it over the other rep's version.
    const writer = window.CrmRecordWrites.create({ rpc: (name, args) => cloudClient.rpc(name, args),
      requestId: () => crypto.randomUUID(), transientRetries: 1 });
    if (previousRow) writer.remember([previousRow]);
    const result = await writer.commit([row], note ? [note] : []);
    confirmed = result.data?.rows?.[0];
    if (!targetIsCurrent()) throw new Error("The estimate's lead or job changed while filing its PDF.");
    if (!result.error && confirmed && confirmed.lead_id === contact.id && confirmed.job_id === saved.jobId) break;
    const latest = await findFiledEstimatePdf(contact.id, estimate.id, saved.jobId);
    // The copy now filed for this estimate is this very PDF: someone else filed
    // it a moment ago, or this save went through and only its answer was lost.
    // It is judged by what is in it, not by its id, which the other person's
    // filing may have moved along the series first.
    if (saved.pdfContentKey && latest.known && latest.document?.pdfContentKey === saved.pdfContentKey && latest.document.storagePath) return latest.document;
    if (!latest.known) throw Object.assign(new Error("Could not confirm the shared PDF."), { code: "estimate_pdf_lookup_unavailable" });
    // No copy is filed under the lead, and still the database refused this id.
    // That is a PDF of this estimate that was filed before and then removed
    // from the lead: a removed record keeps its id, and the database never
    // writes to a removed record again. Without this, an estimate whose PDF had
    // once been removed could never have a PDF filed again. The filing takes
    // the next id in the same series instead. The series is the same in every
    // tab, so two people filing at once still make one record.
    const idHeldByRemovedRecord = !previousRow && !latest.document && ["PT409", "40001"].includes(result.error?.code);
    if (!idHeldByRemovedRecord || turn >= ESTIMATE_PDF_ID_SERIES_LIMIT) throw new Error("The shared estimate PDF was not confirmed. Retry from the current estimate.");
    saved = { ...saved, id: `${firstId}-${turn + 1}` };
  }
  const current = getContact(contact.id);
  current.documents = [saved, ...(current.documents || []).filter(d => d.id !== saved.id)];
  if (note && !(current.updates || []).some(u => u.id === note.id)) {
    current.updates = [{ id: note.id, jobId: note.job_id, author: note.actor_name, message: note.message, status: "", createdAt: note.created_at }, ...(current.updates || [])];
  }
  durableChangeCounter += 1;
  rememberAdditionalDurableRows([confirmed], note ? [note] : []);
  saveState({ localOnly: true });
  return saved;
}

async function saveEstimatePdfDocument(estimate, contact, doc) {
  if (!canAction("manageDocuments")) return null;
  const job = getEstimateJob(estimate);
  if (!contact || !job || estimate.contactId !== contact.id) throw new Error("Choose a valid lead and its job before saving the PDF");
  const targetIsCurrent = () => state.estimates.some((current) => current.id === estimate.id
    && current.contactId === contact.id && current.jobId === job.id)
    && Boolean(getContact(contact.id)) && getEstimateJob(estimate)?.id === job.id;
  if (!targetIsCurrent()) throw new Error("The estimate's lead or job changed. Review it before saving the PDF.");
  const categories = state.company.documentCategories || defaultDocumentCategories;
  const category = categories.find((item) => item.id === "doccat_estimates") || categoryForLegacyName("Estimates", categories);
  if (!category) throw new Error("The Estimates document category is unavailable");
  const fileName = estimateFileName(estimate);
  const lookup = await findFiledEstimatePdf(contact.id, estimate.id, job.id);
  // Not being able to look for the filed copy is not the same as there being
  // none. Filing now could put a second copy of this PDF under the lead, so
  // nothing is filed; whoever called decides when to try again.
  if (!lookup.known) throw Object.assign(new Error("The PDF already filed for this estimate could not be looked for"), { code: "estimate_pdf_lookup_unavailable" });
  const existing = lookup.document;
  const pdfContentKey = await estimatePdfContentKey(doc);
  // Downloading an estimate that has not changed since its PDF was filed:
  // the filed copy is this PDF. Nothing is uploaded, no new version is added
  // and the lead is not saved again.
  if (existing && pdfContentKey && existing.pdfContentKey === pdfContentKey && (existing.storagePath || existing.dataUrl) && targetIsCurrent()) return existing;
  const id = existing?.id || await estimatePdfDocumentId(contact.id, job.id, estimate.id);
  const blob = doc.output("blob");
  const file = new File([blob], fileName, { type: "application/pdf" });
  const stored = await storeDocumentFile(file, {
    documentId: id,
    estimatePdfKey: pdfContentKey,
    leadId: contact.id,
    jobId: estimate.jobId || job?.id || "",
    categoryId: category.id,
  });
  // Uploading may take long enough for this estimate or its parent to be
  // removed/reassigned. Never attach the completed file to a changed target.
  if (!targetIsCurrent()) throw new Error("The estimate's lead or job changed during upload. Review it before saving the PDF.");
  const savedDocument = normalizeDocument({
    ...(existing || {}),
    id,
    name: fileName,
    categoryId: category.id,
    category: category.name,
    type: "application/pdf",
    size: file.size,
    ...stored,
    uploadedAt: new Date().toISOString(),
    uploadedBy: currentActorName(),
    versionNumber: existing ? Math.max(1, number(existing.versionNumber)) + 1 : 1,
    previousVersions: existing ? [...(existing.previousVersions || []), {
      versionNumber: existing.versionNumber,
      storagePath: existing.storagePath || "",
      dataUrl: existing.dataUrl || "",
      name: existing.name,
      size: existing.size,
      uploadedAt: existing.uploadedAt,
      uploadedBy: existing.uploadedBy,
    }] : [],
    source: "Estimate PDF",
    estimateId: estimate.id,
    pdfContentKey,
    leadId: contact.id,
    contactId: contact.id,
    jobId: estimate.jobId || job?.id || "",
  }, { leadId: contact.id, categoryId: category.id, categories });

  if (canUseCloudSync()) return commitSharedEstimatePdf(estimate, contact, savedDocument, lookup.row, targetIsCurrent);
  updateContact(contact.id, (current) => {
    const currentDocuments = current.documents || [];
    return {
      ...current,
      documents: [savedDocument, ...currentDocuments.filter(document => document.id !== savedDocument.id)],
    };
  });

  if (!existing) addContactUpdate(contact.id, {
      author: state.currentUser.name || "CRM",
      jobId: estimate.jobId || job?.id || "",
      message: `Saved estimate PDF ${estimate.estimateNumber} to documents.`,
    });
  saveState({ localOnly: true });

  return savedDocument;
}

const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_TOP_MARGIN = 54;
const PDF_BOTTOM_MARGIN = 54;
const PDF_CONTENT_BOTTOM = PDF_PAGE_HEIGHT - PDF_BOTTOM_MARGIN;

function pdfAddPageIfNeeded(doc, cursor, needed = 24) {
  if (cursor.y + needed <= PDF_CONTENT_BOTTOM) return false;
  doc.addPage();
  pdfDrawPageTopRule(doc);
  cursor.y = PDF_TOP_MARGIN;
  return true;
}

function pdfTextBlock(doc, text, x, cursor, width, options = {}) {
  const lines = doc.splitTextToSize(String(text || ""), width);
  const lineHeight = options.lineHeight || 12;
  pdfAddPageIfNeeded(doc, cursor, lines.length * lineHeight + 8);
  doc.text(lines, x, cursor.y);
  cursor.y += lines.length * lineHeight + (options.after || 0);
}

// The logo is printed about an inch wide. Embedding the full-size original
// (stored uncompressed, which is how jsPDF keeps a PNG unless told otherwise)
// made every saved one-page estimate about 2 MB. Scale it to print size first.
async function downscaleImageDataUrl(dataUrl, maxSide = 360) {
  if (!String(dataUrl || "").startsWith("data:image/") || typeof Image === "undefined" || typeof document === "undefined") return dataUrl;
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = reject;
      element.src = dataUrl;
    });
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
    if (scale >= 1) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } catch {
    return dataUrl;
  }
}

function pdfImageFormat(dataUrl = "") {
  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) return "JPEG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "PNG";
}

function pdfDrawPageTopRule(doc) {
  doc.setFillColor(166, 105, 119);
  doc.rect(0, 0, PDF_PAGE_WIDTH, 8, "F");
}

function pdfDrawEstimateTableHeader(doc, cursor, left, right, options = {}) {
  const tableWidth = right - left;
  if (options.continued) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text("ESTIMATE DETAIL (CONTINUED)", left, cursor.y);
    cursor.y += 12;
  }
  doc.setFillColor(55, 55, 60);
  doc.rect(left, cursor.y, tableWidth, 22, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text("PRODUCT / WORK ITEM", left + 8, cursor.y + 14);
  doc.text("QTY", 352, cursor.y + 14, { align: "right" });
  doc.text("UNIT", 362, cursor.y + 14);
  doc.text("RATE", 468, cursor.y + 14, { align: "right" });
  doc.text("AMOUNT", right - 8, cursor.y + 14, { align: "right" });
  cursor.y += 22;
}

let estimatePdfGeneratorPromise = null;
function loadEstimatePdfGenerator() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (estimatePdfGeneratorPromise) return estimatePdfGeneratorPromise;
  estimatePdfGeneratorPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "/vendor/jspdf.umd.min.js?v=23";
    script.async = true;
    script.onload = () => window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error("PDF generator did not initialize"));
    script.onerror = () => reject(new Error("PDF generator could not be loaded"));
    document.head.appendChild(script);
  }).catch((error) => {
    estimatePdfGeneratorPromise = null;
    throw error;
  });
  return estimatePdfGeneratorPromise;
}

async function downloadEstimatePdf(options = {}) {
  // An explicit save owns its estimate even if the user opens another one
  // while the shared save finishes. Keep PDF input detached from later edits.
  const sourceEstimate = options.estimateSnapshot || getSelectedEstimate();
  const estimate = sourceEstimate ? JSON.parse(JSON.stringify(sourceEstimate)) : null;
  const contact = getEstimateContact(estimate);
  const job = getEstimateJob(estimate);
  if (!estimate || !contact) {
    showToast("Create an estimate before downloading");
    return false;
  }

  let JsPdf;
  try {
    JsPdf = window.jspdf?.jsPDF || (typeof loadEstimatePdfGenerator === "function" ? await loadEstimatePdfGenerator() : null);
    if (!JsPdf) throw new Error("PDF generator is unavailable");
  } catch {
    showToast("PDF generator could not be loaded. Opening print instead.");
    window.print();
    return false;
  }

  const company = state.company;
  const rep = estimateSalesRep(estimate);
  const officeAddress = companyOfficeAddress();
  const totals = totalsFor(estimate);
  const doc = new JsPdf({ unit: "pt", format: "letter", compress: true });
  const pdfLogoDataUrl = await downscaleImageDataUrl(await companyLogoDataUrlForPdf(company));
  const estimateWording = estimateWordingFor(job?.division || contact?.division || "roofing");
  const cursor = { y: 0 };
  const left = 48;
  const right = PDF_PAGE_WIDTH - 48;
  const tableWidth = right - left;
  const midX = left + tableWidth / 2 + 12;

  doc.setProperties({
    title: `${estimate.estimateNumber} - ${estimate.projectTitle || "Estimate"}`,
    subject: estimateWording.title,
    author: company.name,
  });

  // ── Refined proposal header ───────────────────────────────
  doc.setFillColor(166, 105, 119);
  doc.rect(0, 0, PDF_PAGE_WIDTH, 8, "F");

  // Logo or initial mark
  let brandTextX = left;
  if (pdfLogoDataUrl) {
    try {
      doc.addImage(pdfLogoDataUrl, pdfImageFormat(pdfLogoDataUrl), left, 12, 76, 70, undefined, "FAST");
      brandTextX = left + 86;
    } catch { brandTextX = left; }
  } else {
    doc.setFillColor(166, 105, 119);
    doc.roundedRect(left, 20, 36, 36, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text((company.name || "R").slice(0, 1).toUpperCase(), left + 18, 44, { align: "center" });
    brandTextX = left + 48;
  }

  // Company name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(55, 55, 60);
  doc.text(company.name || "Company", brandTextX, 34);

  // Company sub-info
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100, 100, 105);
  const companySubLines = [
    officeAddress ? officeAddress.split("\n")[0] : "",
    [company.phone, company.email].filter(Boolean).join("  ·  "),
    company.license || "",
  ].filter(Boolean);
  companySubLines.forEach((line, i) => {
    doc.text(line, brandTextX, 46 + i * 10);
  });

  // Proposal title and metadata (right side)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.setTextColor(55, 55, 60);
  doc.text(estimateWording.label, right, 31, { align: "right" });
  doc.setFontSize(9);
  doc.setTextColor(166, 105, 119);
  doc.text("PROPOSAL & SCOPE OF WORK", right, 44, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 105);
  doc.text([estimate.estimateNumber, estimate.projectNumber].filter(Boolean).join("  |  "), right, 57, { align: "right" });
  doc.text(`Issued ${formatDate(estimate.issueDate)}  |  Valid through ${formatDate(estimate.validUntil)}`, right, 69, { align: "right" });
  doc.text(`Status: ${estimate.status || "Draft"}`, right, 81, { align: "right" });

  doc.setDrawColor(166, 105, 119);
  doc.setLineWidth(1.2);
  doc.line(left, 92, right, 92);
  doc.setLineWidth(0.5);

  cursor.y = 108;

  // ── Customer & Job info boxes ─────────────────────────────
  const boxTop = cursor.y;
  const boxH = 88;
  const col2X = midX;

  doc.setFillColor(250, 247, 248);
  doc.setDrawColor(224, 208, 212);
  doc.roundedRect(left, boxTop, tableWidth / 2 - 8, boxH, 3, 3, "FD");
  doc.roundedRect(col2X, boxTop, tableWidth / 2 - 8, boxH, 3, 3, "FD");

  // Customer label
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("CUSTOMER", left + 10, boxTop + 14);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(55, 55, 60);
  doc.text(contact.name || "No customer", left + 10, boxTop + 27);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  const customerLines = [
    (contact.address || "").split("\n")[0],
    contact.phone || "",
    contact.email || "",
  ].filter(Boolean);
  customerLines.forEach((line, i) => {
    doc.text(line, left + 10, boxTop + 39 + i * 11);
  });

  // Job / rep label
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("PROJECT & REPRESENTATIVE", col2X + 10, boxTop + 14);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(55, 55, 60);
  doc.text(estimate.projectTitle || "Project estimate", col2X + 10, boxTop + 27);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  const jobLines = [
    (job?.address || contact.address || "").split("\n")[0],
    rep.name ? `Rep: ${rep.name}` : "",
    rep.email || "",
    rep.phone || "",
  ].filter(Boolean);
  jobLines.forEach((line, i) => {
    doc.text(line, col2X + 10, boxTop + 39 + i * 11);
  });

  cursor.y = boxTop + boxH + 16;

  // ── Investment highlight ─────────────────────────────────
  doc.setFillColor(166, 105, 119);
  doc.roundedRect(left, cursor.y, tableWidth, 44, 3, 3, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(255, 255, 255);
  doc.text("TOTAL ESTIMATED INVESTMENT", left + 14, cursor.y + 18);
  doc.setFontSize(18);
  doc.text(money.format(totals.total), right - 14, cursor.y + 27, { align: "right" });
  cursor.y += 58;

  // ── Scope summary ─────────────────────────────────────────
  if (estimate.scopeSummary) {
    pdfAddPageIfNeeded(doc, cursor, 48);
    doc.setFillColor(250, 247, 248);
    doc.setDrawColor(166, 105, 119);
    const scopeLines = doc.splitTextToSize(estimate.scopeSummary, tableWidth - 28);
    const scopeH = scopeLines.length * 11 + 20;
    doc.rect(left, cursor.y, 3, scopeH, "F");
    doc.setFillColor(250, 247, 248);
    doc.rect(left + 3, cursor.y, tableWidth - 3, scopeH, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text("PROJECT SCOPE", left + 12, cursor.y + 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(55, 55, 60);
    doc.text(scopeLines, left + 12, cursor.y + 23);
    cursor.y += scopeH + 14;
  }

  // ── Line items table ──────────────────────────────────────
  pdfAddPageIfNeeded(doc, cursor, 48);
  pdfDrawEstimateTableHeader(doc, cursor, left, right);

  printableEstimateItems(estimate).forEach((item) => {
    const titleLines = doc.splitTextToSize(item.title || "Line item", 235);
    const descLines = item.description ? doc.splitTextToSize(item.description, 235) : [];
    const textLines = titleLines.length + descLines.length;
    const rowH = Math.max(32, textLines * 11 + 16);

    const addedPage = pdfAddPageIfNeeded(doc, cursor, rowH + 52);
    if (addedPage) pdfDrawEstimateTableHeader(doc, cursor, left, right, { continued: true });

    doc.setDrawColor(224, 208, 212);
    doc.setFillColor(255, 255, 255);
    doc.rect(left, cursor.y, tableWidth, rowH, "FD");

    // Subtle zebra on alternating rows handled via fill above
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(55, 55, 60);
    doc.text(titleLines, left + 8, cursor.y + 13);

    if (descLines.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(descLines, left + 8, cursor.y + 13 + titleLines.length * 11);
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(number(item.quantity).toLocaleString("en-US"), 352, cursor.y + 13, { align: "right" });
    doc.text(item.unit || "ea", 362, cursor.y + 13);
    doc.setTextColor(55, 55, 60);
    doc.text(money.format(number(item.rate)), 468, cursor.y + 13, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(money.format(estimateLineAmount(item)), right - 8, cursor.y + 13, { align: "right" });
    cursor.y += rowH;
  });

  // ── Totals ────────────────────────────────────────────────
  cursor.y += 16;
  pdfAddPageIfNeeded(doc, cursor, 110);
  const tlX = 360;
  const tvX = right;

  const totalRows = [
    ["Subtotal", money.format(totals.subtotal), false],
    [`Tax (${number(estimate.taxRate)}%)`, money.format(totals.tax), false],
    ["Total", money.format(totals.total), true],
    // The deposit comes off the total, so it is listed after it.
    ...(number(estimate.deposit) > 0 ? [["Deposit due at signing", `-${money.format(number(estimate.deposit))}`, false]] : []),
    ["Balance due on completion", money.format(totals.balance), false],
  ];

  totalRows.forEach(([label, value, isGrand], i) => {
    if (isGrand) {
      doc.setDrawColor(12, 23, 48);
      doc.setLineWidth(1.5);
      doc.line(tlX, cursor.y - 10, tvX, cursor.y - 10);
      doc.setLineWidth(0.5);
    }
    doc.setFont("helvetica", isGrand ? "bold" : "normal");
    doc.setFontSize(isGrand ? 12 : 9);
    doc.setTextColor(isGrand ? 12 : 100, isGrand ? 23 : 116, isGrand ? 48 : 139);
    doc.text(label, tlX, cursor.y);
    doc.setTextColor(isGrand ? 12 : 12, isGrand ? 23 : 23, isGrand ? 48 : 48);
    doc.text(value, tvX, cursor.y, { align: "right" });
    cursor.y += isGrand ? 20 : 14;
  });

  // ── Payment schedule ─────────────────────────────────────
  cursor.y += 12;
  pdfAddPageIfNeeded(doc, cursor, 96);
  const depositAmount = Math.max(0, Math.min(number(estimate.deposit), totals.total));
  const remainingAmount = Math.max(totals.total - depositAmount, 0);
  const depositPercent = totals.total > 0 ? Math.round((depositAmount / totals.total) * 100) : 0;
  const remainingPercent = Math.max(100 - depositPercent, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(55, 55, 60);
  doc.text("PAYMENT SCHEDULE", left, cursor.y);
  cursor.y += 10;
  doc.setFillColor(55, 55, 60);
  doc.rect(left, cursor.y, tableWidth, 20, "F");
  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.text("MILESTONE", left + 8, cursor.y + 13);
  doc.text("PERCENT", 398, cursor.y + 13, { align: "right" });
  doc.text("AMOUNT", right - 8, cursor.y + 13, { align: "right" });
  cursor.y += 20;
  const paymentRows = depositAmount > 0
    ? [["Initial deposit upon acceptance", `${depositPercent}%`, money.format(depositAmount)], ["Remaining balance due on completion", `${remainingPercent}%`, money.format(remainingAmount)]]
    : [["Full balance due according to the terms below", "100%", money.format(totals.total)]];
  paymentRows.forEach(([label, percent, amount], index) => {
    doc.setFillColor(index % 2 ? 255 : 250, index % 2 ? 255 : 247, index % 2 ? 255 : 248);
    doc.setDrawColor(224, 208, 212);
    doc.rect(left, cursor.y, tableWidth, 24, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(55, 55, 60);
    doc.text(label, left + 8, cursor.y + 15);
    doc.text(percent, 398, cursor.y + 15, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(amount, right - 8, cursor.y + 15, { align: "right" });
    cursor.y += 24;
  });

  // ── Notes & Terms ─────────────────────────────────────────
  const termsText = estimate.notes || company.defaultTerms || "";
  if (termsText) {
    cursor.y += 10;
    pdfAddPageIfNeeded(doc, cursor, 72);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text("NOTES & TERMS", left, cursor.y);
    cursor.y += 11;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(31, 41, 55);
    pdfTextBlock(doc, termsText, left, cursor, tableWidth, { lineHeight: 10, after: 18 });
  }

  // ── Acceptance ────────────────────────────────────────────
  pdfAddPageIfNeeded(doc, cursor, 104);
  cursor.y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(55, 55, 60);
  doc.text("ACCEPTANCE OF PROPOSAL", left, cursor.y);
  cursor.y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(70, 70, 75);
  const acceptance = "I authorize the work described in this proposal and agree to the pricing, payment schedule, and terms shown above. Changes to this scope require written approval.";
  const acceptanceLines = doc.splitTextToSize(acceptance, tableWidth);
  doc.text(acceptanceLines, left, cursor.y);
  cursor.y += acceptanceLines.length * 10 + 12;
  doc.setDrawColor(31, 41, 55);
  doc.setLineWidth(0.75);
  doc.line(left, cursor.y + 32, left + 200, cursor.y + 32);
  doc.line(left + 240, cursor.y + 32, left + 380, cursor.y + 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text("Customer signature", left, cursor.y + 44);
  doc.text("Date", left + 240, cursor.y + 44);

  // ── Footer bar ────────────────────────────────────────────
  doc.setFillColor(246, 250, 255);
  doc.setDrawColor(214, 227, 243);
  doc.rect(0, PDF_PAGE_HEIGHT - 24, PDF_PAGE_WIDTH, 24, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  const footerLeft = [company.name, company.website].filter(Boolean).join("  ·  ");
  const footerRight = company.license || "";
  doc.text(footerLeft, left, PDF_PAGE_HEIGHT - 9);
  if (footerRight) doc.text(footerRight, right, PDF_PAGE_HEIGHT - 9, { align: "right" });

  let savedDocument = null;
  let filingWaits = false;
  if (options.saveToDocuments !== false) {
    try {
      savedDocument = await saveEstimatePdfDocument(estimate, contact, doc);
    } catch (error) {
      console.warn("Estimate PDF could not be saved to lead documents", error);
      if (error?.code === "estimate_pdf_lookup_unavailable") {
        // The CRM could not say whether a copy is already filed. The rep still
        // gets the PDF; it is filed afterwards, against the original if there is one.
        filingWaits = queueEstimatePdfFiling(estimate, doc);
        setEstimateSaveState(estimate.id, "The PDF is not filed under the lead yet: the CRM could not be reached to check for the copy already there. It will be filed when the connection is back.", "error");
        if (options.download === false) showToast("The estimate's PDF is not filed under the lead yet. The CRM will try again by itself.");
      } else {
        setEstimateSaveState(estimate.id, "The estimate was saved, but its PDF could not be attached to the lead. Please retry.", "error");
        showToast("Estimate PDF was not saved to the lead documents. Please retry.");
      }
      if (options.download === false) return false;
    }
    // This PDF is filed: an earlier one of the same estimate still waiting to be filed is out of date.
    if (savedDocument) clearEstimatePdfFilingRetry(estimate.id);
  }
  if (options.download !== false) {
    doc.save(estimateFileName(estimate));
  }
  if (!options.silent && options.download !== false) {
    showToast(savedDocument ? "Estimate PDF downloaded and saved to the lead"
      : filingWaits ? "Estimate PDF downloaded. It will be filed under the lead when the CRM can be reached."
        : "Estimate PDF downloaded");
  }
  return options.saveToDocuments === false || Boolean(savedDocument);
}

async function copyEstimate() {
  const text = estimateText();
  try {
    await navigator.clipboard.writeText(text);
    showToast("Estimate copied to clipboard");
  } catch {
    showToast("Clipboard access was blocked");
  }
}

async function sendEstimate() {
  if (!requireAction("manageEstimates")) return;
  const estimate = getSelectedEstimate();
  const contact = getEstimateContact(estimate);
  if (!estimate || !contact) return;
  const invalidItems = invalidEstimateLineItems(estimate);
  if (invalidItems.length) {
    showToast("Every estimate line needs a description, a quantity greater than zero, and a valid rate before sending.");
    return;
  }
  if (!contact.email) {
    showToast("Add an email address before sending");
    return;
  }

  const rawSubject = `${estimate.estimateNumber} from ${state.company.name}`;
  const rawMessage = `Hi ${contact.name},\n\nPlease review the estimate below. I also downloaded the PDF so it can be attached to this email.\n\n${estimateText(
    estimate,
  )}`;
  await downloadEstimatePdf({ silent: true });

  const subject = encodeURIComponent(rawSubject);
  const body = encodeURIComponent(rawMessage);
  window.location.href = `mailto:${encodeURIComponent(contact.email)}?subject=${subject}&body=${body}`;
  showToast("Email draft opened. Mark the estimate Sent only after the email is actually sent.");
}

function printEstimate() {
  downloadEstimatePdf();
}

async function saveCurrentEstimateAndPdf() {
  const estimate = getSelectedEstimate();
  if (!estimate || estimateExplicitSaves.has(estimate.id)) return false;
  if (restoreEstimateSalesNumbersFromBaseline(estimate)) queueLocalStateSave(0);
  const snapshot = JSON.parse(JSON.stringify(estimate));
  if (flushQueuedLocalStateSave() === false) {
    window.clearTimeout(estimateSaveTimers.get(estimate.id));
    estimateSaveTimers.delete(estimate.id);
    setEstimateSaveState(estimate.id, "Not saved. Another CRM tab saved newer work; reload this tab before editing again.", "error");
    return false;
  }
  estimateExplicitSaves.add(estimate.id);
  const revision = (estimateSaveRevisions.get(estimate.id) || 0) + 1;
  estimateSaveRevisions.set(estimate.id, revision);
  estimateCompletedSaveRevisions.delete(estimate.id);
  setEstimateSaveState(estimate.id, "Saving estimate and PDF...", "saving");
  if (els.saveEstimateButton) els.saveEstimateButton.disabled = true;
  const snapshotIsCurrent = () => {
    const current = state.estimates.find((item) => item.id === snapshot.id);
    return current && estimateSaveRevisions.get(snapshot.id) === revision
      && durableRecordDataMatches(current, snapshot);
  };
  const keepNewerChanges = () => {
    setEstimateSaveState(snapshot.id, "Newer changes still need an estimate PDF. Select Save Estimate again when you finish editing.", "error");
    return false;
  };

  try {
    const estimateSaved = await flushEstimateVerifiedSave(estimate.id, revision);
    if (!estimateSaved) {
      if (!estimateSaveStates.get(estimate.id)?.message) {
        setEstimateSaveState(estimate.id, "The estimate could not be confirmed. Your entries remain on this page; select Save Estimate to retry.", "error");
      }
      return false;
    }
    // Do not generate a newer unsaved draft, or mark edits made during either
    // network request as fully saved. The rep can keep typing without a lock.
    if (!snapshotIsCurrent()) return keepNewerChanges();
    const pdfSaved = await downloadEstimatePdf({ silent: true, download: false, estimateSnapshot: snapshot });
    if (!pdfSaved) {
      setEstimateSaveState(estimate.id, "The estimate was saved, but its PDF was not attached. Select Save Estimate to retry.", "error");
      return false;
    }
    if (!snapshotIsCurrent()) return keepNewerChanges();
    estimateCompletedSaveRevisions.set(estimate.id, revision);
    setEstimateSaveState(estimate.id, "Saved with PDF in this lead's documents.", "success");
    return true;
  } catch (error) {
    console.warn("Estimate and PDF save failed", error);
    setEstimateSaveState(estimate.id, "The estimate and PDF could not be saved. Your entries remain on this page; select Save Estimate to retry.", "error");
    return false;
  } finally {
    estimateExplicitSaves.delete(estimate.id);
    if (els.saveEstimateButton) els.saveEstimateButton.disabled = !canAction("manageEstimates");
  }
}

async function openEstimateLeadOverview(contactId) {
  const estimate = getSelectedEstimate();
  const contact = getContact(contactId || estimate?.contactId);
  if (!estimate || !contact || contact.id !== estimate.contactId) return false;
  const estimateId = estimate.id;
  const jobId = estimate.jobId || "";
  const initialView = state.view;
  const revision = estimateSaveRevisions.get(estimateId) || 0;
  if (estimateCompletedSaveRevisions.get(estimateId) === revision) {
    openLeadDetail(contact.id, "overview", jobId);
    return true;
  }
  const confirmed = await appConfirm(
    `Save the latest changes and estimate PDF before opening ${contact.name}? Select Stay here to keep working on this estimate.`,
    { title: "Save estimate first", confirmLabel: "Save and open lead", cancelLabel: "Stay here" },
  );
  if (!confirmed) return false;
  // The question is asked without freezing the page, so make sure the same
  // estimate is still the one on screen before saving it.
  if (getSelectedEstimate()?.id !== estimateId || state.view !== initialView) return false;
  const saved = await saveCurrentEstimateAndPdf();
  // A delayed save must not pull the rep away from another estimate or view
  // they deliberately opened in the meantime.
  if (getSelectedEstimate()?.id !== estimateId || state.view !== initialView) return false;
  if (!saved) {
    showToast("The estimate and its latest PDF are not both confirmed. You are still on the estimate page; review the save status before continuing.");
    return false;
  }
  openLeadDetail(contact.id, "overview", jobId);
  return true;
}

function saveCompany(event) {
  event.preventDefault();
  if (!requireAction("manageCompany")) return;
  const formData = new FormData(els.companyForm);
  state.currentUser = {
    name: normalizePersonName(formData.get("userName").trim() || defaultCurrentUser.name),
    email: formData.get("userEmail").trim() || state.company.email || defaultCurrentUser.email,
    phone: formatPhoneNumber(formData.get("userPhone")) || state.currentUser.phone || "",
    role: formData.get("userRole").trim() || defaultCurrentUser.role,
  };
  state.company = {
    ...state.company,
    name: formData.get("name").trim(),
    license: formData.get("license").trim(),
    phone: formatPhoneNumber(formData.get("phone")),
    email: formData.get("email").trim(),
    address: formData.get("officeAddress").trim(),
    officeAddress: formData.get("officeAddress").trim(),
    logoDataUrl: state.company.logoDataUrl || "",
    googleReviewUrl: formData.get("googleReviewUrl").trim(),
    defaultTerms: formData.get("defaultTerms").trim(),
  };
  state.companyFormDraft = null;
  saveState();
  renderCompanyForm();
  renderBrandLogo();
  renderTopbarProfile();
  renderEstimatePreview(getSelectedEstimate());
  showToast("Settings saved");
}

function showToast(message) {
  const text = String(message || "");
  const isFailure = /\b(?:not saved|not confirmed|failed|failure|error|retry|retries|retrying|unavailable|needs attention|must connect|cloud sync is off)\b/i.test(text);
  const isRoutineSaveNotice = /\b(?:saved|uploaded|stored)\b/i.test(text) || /\bupdated from (?:the )?(?:cloud|supabase|crm)\b/i.test(text);
  const isWorkflowBlocker = /^Complete before moving\b/i.test(text);
  if (isRoutineSaveNotice && !isFailure && !isWorkflowBlocker && !/\bdownloaded\b/i.test(text)) return;
  window.clearTimeout(toastTimer);
  els.toast.textContent = text;
  // Shown in the browser's top layer so a message raised while a dialog is
  // open (a blocked status change, a failed save) is not hidden behind it.
  if (typeof els.toast.showPopover === "function") {
    try {
      if (els.toast.getAttribute("popover") !== "manual") els.toast.setAttribute("popover", "manual");
      if (els.toast.matches(":popover-open")) els.toast.hidePopover();
      els.toast.showPopover();
    } catch { /* The plain fixed-position toast below still works. */ }
  }
  els.toast.classList.add("show");
  // Long or blocking messages need reading time; a flat 2.4 seconds hid
  // explanations such as why a record could not be deleted.
  const visibleFor = Math.min(10000, Math.max(isFailure || isWorkflowBlocker ? 5000 : 2800, text.length * 60));
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("show");
    try { if (els.toast.matches?.(":popover-open")) els.toast.hidePopover(); } catch { /* already hidden */ }
  }, visibleFor);
}

// In-app replacements for window.confirm() and window.prompt(). They match the
// CRM's styling, never freeze the page, and open above any other dialog.
// Resolves true/false for a confirmation, or the entered text/null for a prompt.
// With extraLabel a third button is shown, and choosing it resolves "extra".
function openAppDialog({ title = "", message = "", confirmLabel = "OK", cancelLabel = "Cancel", extraLabel = "", danger = false, input = null } = {}) {
  const nativeFallback = () => (input
    ? (typeof window.prompt === "function" ? window.prompt(title, input.value || "") : null)
    : (typeof window.confirm === "function" ? Boolean(window.confirm([title, message].filter(Boolean).join("\n\n"))) : false));
  let dialog;
  try {
    dialog = document.createElement("dialog");
    if (typeof dialog.showModal !== "function" || !document.body) return Promise.resolve(nativeFallback());
  } catch {
    return Promise.resolve(nativeFallback());
  }
  return new Promise((resolve) => {
    dialog.className = "contact-dialog app-dialog";
    dialog.innerHTML = `<form method="dialog" novalidate>
      <h2 class="app-dialog-title"></h2>
      <p class="app-dialog-message"></p>
      ${input ? '<label class="app-dialog-field"><span></span><input type="text" name="value" autocomplete="off" /></label>' : ""}
      <div class="dialog-actions app-dialog-actions">
        <button class="secondary-button" type="button" data-app-dialog-cancel></button>
        ${extraLabel ? '<button class="secondary-button" type="button" data-app-dialog-extra></button>' : ""}
        <button class="primary-button${danger ? " danger-button" : ""}" type="submit"></button>
      </div>
    </form>`;
    const form = dialog.querySelector("form");
    const field = dialog.querySelector("input");
    const cancelButton = dialog.querySelector("[data-app-dialog-cancel]");
    const confirmButton = dialog.querySelector('button[type="submit"]');
    dialog.querySelector(".app-dialog-title").textContent = title;
    const messageNode = dialog.querySelector(".app-dialog-message");
    messageNode.textContent = message;
    messageNode.hidden = !message;
    cancelButton.textContent = cancelLabel;
    confirmButton.textContent = confirmLabel;
    if (field) {
      dialog.querySelector(".app-dialog-field span").textContent = input.label || "";
      field.value = input.value || "";
      field.maxLength = Number(input.maxLength) || 200;
      if (input.placeholder) field.placeholder = input.placeholder;
    }
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      try { dialog.close(); } catch { /* already closed */ }
      dialog.remove();
      resolve(value);
    };
    const cancelled = input ? null : false;
    const extraButton = dialog.querySelector("[data-app-dialog-extra]");
    if (extraButton) {
      extraButton.textContent = extraLabel;
      extraButton.addEventListener("click", () => finish("extra"));
    }
    cancelButton.addEventListener("click", () => finish(cancelled));
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(cancelled); });
    dialog.addEventListener("close", () => finish(cancelled));
    form.addEventListener("submit", (event) => { event.preventDefault(); finish(field ? field.value : true); });
    document.body.append(dialog);
    dialog.showModal();
    if (field) { field.focus(); field.select(); }
    else (danger ? cancelButton : confirmButton).focus();
  });
}

function appConfirm(message, options = {}) {
  return openAppDialog({ title: options.title || "Please confirm", message, confirmLabel: options.confirmLabel || "Confirm", cancelLabel: options.cancelLabel || "Cancel", danger: Boolean(options.danger) });
}

function appPrompt(title, value = "", options = {}) {
  return openAppDialog({ title, message: options.message || "", confirmLabel: options.confirmLabel || "Save", cancelLabel: options.cancelLabel || "Cancel", input: { value, label: options.label || "", maxLength: options.maxLength, placeholder: options.placeholder } });
}

function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    const iconName = node.dataset.icon;
    node.innerHTML = icons[iconName] || "";
  });
}

const icons = {
  "chevron-left":
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  "chevron-right":
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  phone:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  message:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  "message-circle":
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9.6 9.6 0 0 1-4-.9L3 21l1.9-5a9 9 0 1 1 16.1-4.5z"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  template:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>',
  "alert-triangle":
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>',
  home:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
  "arrow-left":
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>',
  open:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  pipeline:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h6"/></svg>',
  users:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  user:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>',
  briefcase:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v1"/><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 12h18"/><path d="M12 12v2"/></svg>',
  hammer:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 12-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9"/><path d="m14 4 6 6"/><path d="m13 5 2-2 6 6-2 2"/></svg>',
  clipboard:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4a3 3 0 0 1 6 0"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>',
  invoice:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h3"/></svg>',
  star:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3L5.8 21 7 14.2 2 9.3l6.9-1Z"/></svg>',
  "bar-chart":
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5"/><path d="M4 19h16"/><rect x="7" y="11" width="3" height="5"/><rect x="12" y="7" width="3" height="9"/><rect x="17" y="9" width="3" height="7"/></svg>',
  bell:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  menu:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>',
  file:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>',
  image:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  folder:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  calendar:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/></svg>',
  refresh:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.9-4"/><path d="M4 5v6h6"/><path d="M4 13a8 8 0 0 0 14.9 4"/><path d="M20 19v-6h-6"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.23.38.6.64 1 .7.2.03.4.04.6.04a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
  plus:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  download:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
  upload:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>',
  dollar:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  edit:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  copy:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  printer:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>',
  mail:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
  send:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
  x:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
};

