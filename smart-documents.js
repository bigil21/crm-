const { PDFDocument, StandardFonts, rgb, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup } = require("pdf-lib");

const FIELD_TYPES = new Set(["text", "textarea", "date", "number", "email", "checkbox"]);
const MAX_FIELDS = 80;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

function safeId(value, field = "identifier") {
  const id = String(value || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(id)) throw new Error(`invalid_${field}`);
  return id;
}

function safeText(value, max, { required = false } = {}) {
  const text = String(value ?? "").trim();
  if ((required && !text) || text.length > max) throw new Error("invalid_smart_document_text");
  return text;
}

function normalizeFields(input) {
  if (!Array.isArray(input) || !input.length || input.length > MAX_FIELDS) throw new Error("invalid_smart_document_fields");
  const ids = new Set();
  return input.map((field, index) => {
    const id = safeId(field?.id || `field-${index + 1}`, "smart_field");
    if (ids.has(id)) throw new Error("duplicate_smart_document_field");
    ids.add(id);
    const type = String(field?.type || "text");
    if (!FIELD_TYPES.has(type)) throw new Error("invalid_smart_document_field_type");
    return {
      id,
      label: safeText(field?.label, 120, { required: true }),
      type,
      required: Boolean(field?.required),
      sourceName: safeText(field?.sourceName, 200),
      placeholder: safeText(field?.placeholder, 250),
    };
  });
}

function normalizeResponses(fields, input, { requireComplete = false } = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return Object.fromEntries(fields.map((field) => {
    let value = field.type === "checkbox" ? Boolean(source[field.id]) : safeText(source[field.id], 20_000);
    if (field.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("invalid_smart_document_email");
    if (field.type === "number" && value && !Number.isFinite(Number(value.replaceAll(",", "")))) throw new Error("invalid_smart_document_number");
    if (field.type === "date" && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("invalid_smart_document_date");
    if (requireComplete && field.required && (field.type === "checkbox" ? value !== true : !value)) throw new Error("smart_document_required_field_missing");
    return [field.id, value];
  }));
}

function safeSourceDocument(document) {
  const size = Number(document?.size);
  if (!Buffer.isBuffer(document?.bytes) || !Number.isSafeInteger(size) || size < 1 || size > MAX_SOURCE_BYTES || document.bytes.length !== size) {
    throw new Error("invalid_smart_document_source");
  }
  return {
    bytes: document.bytes,
    name: safeText(document.name || "document.pdf", 255, { required: true }).replace(/[\r\n"\\/]/g, "-"),
    type: safeText(document.type || "application/octet-stream", 100, { required: true }),
  };
}

function responseText(field, value) {
  if (field.type === "checkbox") return value ? "Yes" : "No";
  if (field.type === "date" && value) {
    const [year, month, day] = value.split("-");
    return `${month}/${day}/${year}`;
  }
  return String(value || "");
}

function wrapText(text, font, size, width) {
  const lines = [];
  String(text || "").split(/\r?\n/).forEach((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(""); return; }
    let line = "";
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) line = candidate;
      else { if (line) lines.push(line); line = word; }
    });
    if (line) lines.push(line);
  });
  return lines;
}

function matchingFormField(formFields, field) {
  const names = [field.sourceName, field.label, field.id].filter(Boolean).map((value) => value.toLowerCase());
  return formFields.find((candidate) => names.includes(candidate.getName().trim().toLowerCase()));
}

function applyExistingPdfFields(pdf, fields, responses) {
  const form = pdf.getForm();
  const formFields = form.getFields();
  const filled = [];
  fields.forEach((field) => {
    const target = matchingFormField(formFields, field);
    if (!target) return;
    const value = responses[field.id];
    try {
      if (target instanceof PDFTextField) target.setText(responseText(field, value));
      else if (target instanceof PDFCheckBox) value ? target.check() : target.uncheck();
      else if (target instanceof PDFDropdown || target instanceof PDFOptionList || target instanceof PDFRadioGroup) target.select(responseText(field, value));
      else return;
      filled.push(target.getName());
    } catch {
      // The response summary remains authoritative if a source PDF field rejects a value.
    }
  });
  return filled;
}

async function renderCompletedDocument(document, template, actor = {}) {
  const source = safeSourceDocument(document);
  const fields = normalizeFields(template?.fields);
  const responses = normalizeResponses(fields, template?.responses, { requireComplete: true });
  let pdf;
  let sourceEmbedded = false;
  if (source.type === "application/pdf" || source.name.toLowerCase().endsWith(".pdf") || source.bytes.subarray(0, 4).toString("ascii") === "%PDF") {
    try { pdf = await PDFDocument.load(source.bytes, { ignoreEncryption: false }); sourceEmbedded = true; }
    catch { throw new Error("smart_document_pdf_unreadable"); }
  } else {
    pdf = await PDFDocument.create();
  }
  const filledSourceFields = sourceEmbedded ? applyExistingPdfFields(pdf, fields, responses) : [];
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([612, 792]);
  let y = 738;
  const addPage = () => { page = pdf.addPage([612, 792]); y = 738; };
  page.drawText("JobCrest Smart Document", { x: 48, y, size: 19, font: bold, color: rgb(0.05, 0.16, 0.31) });
  y -= 27;
  page.drawText(source.name, { x: 48, y, size: 10, font, color: rgb(0.35, 0.4, 0.48) });
  y -= 22;
  if (!sourceEmbedded) {
    page.drawText("The original non-PDF file remains saved with this job. This PDF contains its completed Smart Document responses.", { x: 48, y, size: 9, font, color: rgb(0.45, 0.2, 0.1) });
    y -= 28;
  }
  for (const field of fields) {
    const value = responseText(field, responses[field.id]) || "—";
    const valueLines = wrapText(value, font, 10, 500);
    const height = 34 + Math.max(1, valueLines.length) * 13;
    if (y - height < 54) addPage();
    page.drawText(field.label, { x: 48, y, size: 9, font: bold, color: rgb(0.18, 0.22, 0.28) });
    y -= 15;
    valueLines.forEach((line) => { page.drawText(line || " ", { x: 48, y, size: 10, font, color: rgb(0.05, 0.07, 0.1) }); y -= 13; });
    page.drawLine({ start: { x: 48, y: y - 2 }, end: { x: 564, y: y - 2 }, thickness: 0.5, color: rgb(0.82, 0.85, 0.89) });
    y -= 17;
  }
  if (y < 100) addPage();
  const completedBy = safeText(actor.name || actor.email || "JobCrest representative", 200, { required: true });
  page.drawText(`Completed by ${completedBy}`, { x: 48, y: 72, size: 8, font, color: rgb(0.4, 0.44, 0.5) });
  page.drawText(`Completed ${new Date().toISOString()}`, { x: 48, y: 58, size: 8, font, color: rgb(0.4, 0.44, 0.5) });
  const bytes = Buffer.from(await pdf.save());
  const baseName = source.name.replace(/\.[^.]+$/, "").slice(0, 190) || "document";
  return { bytes, name: `${baseName} - Completed.pdf`, fields, responses, filledSourceFields };
}

module.exports = {
  FIELD_TYPES, MAX_FIELDS, MAX_SOURCE_BYTES, safeId, normalizeFields, normalizeResponses,
  renderCompletedDocument,
};
