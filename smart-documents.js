const { PDFDocument, StandardFonts, rgb, PDFTextField, PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup } = require("pdf-lib");

const FIELD_TYPES = new Set(["text", "textarea", "date", "number", "email", "checkbox", "radio", "signature", "initials"]);
const MAX_FIELDS = 300;
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
    const page = Number(field?.page || 1);
    const rawPlacement = [field?.x, field?.y, field?.width, field?.height];
    const placementPresent = rawPlacement.map((value) => value !== null && value !== undefined && value !== "");
    const [x, y, width, height] = rawPlacement.map(Number);
    const fontSize = Number(field?.fontSize || 10);
    const fontFamily = ["Helvetica", "Times Roman", "Courier"].includes(field?.fontFamily) ? field.fontFamily : "Helvetica";
    const textColor = /^#[0-9a-f]{6}$/i.test(String(field?.textColor || "")) ? String(field.textColor).toLowerCase() : "#071525";
    const highlightColor = /^#[0-9a-f]{6}$/i.test(String(field?.highlightColor || "")) ? String(field.highlightColor).toLowerCase() : "";
    const textAlign = ["left", "center", "right"].includes(field?.textAlign) ? field.textAlign : "left";
    const hasPlacement = placementPresent.every(Boolean) && [x, y, width, height].every(Number.isFinite);
    if (!Number.isInteger(page) || page < 1 || page > 500 ||
        (hasPlacement && (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 1.001 || y + height > 1.001)) ||
        (!hasPlacement && placementPresent.some(Boolean)) ||
        !Number.isFinite(fontSize) || fontSize < 6 || fontSize > 72) {
      throw new Error("invalid_smart_document_field_placement");
    }
    return {
      id,
      label: safeText(field?.label, 120, { required: true }),
      type,
      required: Boolean(field?.required),
      sourceName: safeText(field?.sourceName, 200),
      placeholder: safeText(field?.placeholder, 250),
      page,
      x: hasPlacement ? Number(x.toFixed(6)) : null,
      y: hasPlacement ? Number(y.toFixed(6)) : null,
      width: hasPlacement ? Number(width.toFixed(6)) : null,
      height: hasPlacement ? Number(height.toFixed(6)) : null,
      fontSize: Number(fontSize.toFixed(2)),
      fontFamily,
      bold: Boolean(field?.bold),
      italic: Boolean(field?.italic),
      underline: Boolean(field?.underline),
      textColor,
      highlightColor,
      textAlign,
      detected: Boolean(field?.detected),
    };
  });
}

function normalizeResponses(fields, input, { requireComplete = false } = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  return Object.fromEntries(fields.map((field) => {
    let value = ["checkbox", "radio"].includes(field.type) ? Boolean(source[field.id]) : safeText(source[field.id], 20_000);
    if (field.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error("invalid_smart_document_email");
    if (field.type === "number" && value && !Number.isFinite(Number(value.replaceAll(",", "")))) throw new Error("invalid_smart_document_number");
    if (field.type === "date" && value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("invalid_smart_document_date");
    if (requireComplete && field.required && (["checkbox", "radio"].includes(field.type) ? value !== true : !value)) throw new Error("smart_document_required_field_missing");
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
  if (["checkbox", "radio"].includes(field.type)) return value ? "Yes" : "No";
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

function hexRgb(value, fallback = "#071525") {
  const hex = /^#[0-9a-f]{6}$/i.test(String(value || "")) ? String(value) : fallback;
  return rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
}

function fieldFontKey(field) {
  const family = field.fontFamily === "Times Roman" ? "times" : field.fontFamily === "Courier" ? "courier" : "helvetica";
  const style = `${field.bold ? "Bold" : ""}${field.italic || ["signature", "initials"].includes(field.type) ? "Oblique" : ""}` || "Regular";
  return `${family}${style}`;
}

function drawPlacedField(pdf, field, response, fonts) {
  if (![field.x, field.y, field.width, field.height].every(Number.isFinite)) return false;
  const page = pdf.getPages()[field.page - 1];
  if (!page) return false;
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const x = field.x * pageWidth;
  const width = Math.max(8, field.width * pageWidth);
  const height = Math.max(8, field.height * pageHeight);
  const y = pageHeight - (field.y * pageHeight) - height;
  const fontSize = Math.min(field.fontSize, Math.max(6, height * 0.64));
  page.drawRectangle({ x, y, width, height, color: field.highlightColor ? hexRgb(field.highlightColor, "#fff19a") : rgb(1, 1, 1), opacity: field.highlightColor ? 0.8 : 0.92 });
  if (field.type === "checkbox") {
    const box = Math.min(height - 2, width, 14);
    page.drawRectangle({ x: x + 1, y: y + Math.max(1, (height - box) / 2), width: box, height: box, borderWidth: 0.8, borderColor: rgb(0.12, 0.16, 0.22) });
    if (response === true) {
      const bottom = y + Math.max(1, (height - box) / 2);
      page.drawLine({ start: { x: x + 3, y: bottom + box * 0.48 }, end: { x: x + box * 0.42, y: bottom + 3 }, thickness: 1.6, color: rgb(0.03, 0.25, 0.16) });
      page.drawLine({ start: { x: x + box * 0.42, y: bottom + 3 }, end: { x: x + box - 2, y: bottom + box - 2 }, thickness: 1.6, color: rgb(0.03, 0.25, 0.16) });
    }
    return true;
  }
  if (field.type === "radio") {
    const radius = Math.max(2, Math.min((height - 2) / 2, width / 2, 7));
    const center = { x: x + radius + 1, y: y + height / 2 };
    page.drawCircle({ ...center, size: radius, borderWidth: 0.8, borderColor: rgb(0.12, 0.16, 0.22) });
    if (response === true) page.drawCircle({ ...center, size: Math.max(1.5, radius * .48), color: hexRgb(field.textColor) });
    return true;
  }
  const text = responseText(field, response);
  if (!text) return true;
  const activeFont = fonts[fieldFontKey(field)] || fonts.helveticaRegular;
  const lines = wrapText(text, activeFont, fontSize, Math.max(6, width - 4));
  const lineHeight = fontSize * 1.12;
  const maxLines = Math.max(1, Math.floor((height - 3) / lineHeight));
  lines.slice(0, maxLines).forEach((line, index) => {
    const lineWidth = Math.min(width - 4, activeFont.widthOfTextAtSize(line, fontSize));
    const lineX = field.textAlign === "center" ? x + (width - lineWidth) / 2 : field.textAlign === "right" ? x + width - lineWidth - 2 : x + 2;
    const lineY = y + height - fontSize - 2 - (index * lineHeight);
    page.drawText(line, { x: lineX, y: lineY, size: fontSize, font: activeFont, color: hexRgb(field.textColor), maxWidth: width - 4 });
    if (field.underline && lineWidth > 0) page.drawLine({ start: { x: lineX, y: lineY - 1.2 }, end: { x: lineX + lineWidth, y: lineY - 1.2 }, thickness: Math.max(0.5, fontSize / 18), color: hexRgb(field.textColor) });
  });
  return true;
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
    try {
      const image = /png/i.test(source.type) ? await pdf.embedPng(source.bytes) : /jpe?g/i.test(source.type) ? await pdf.embedJpg(source.bytes) : null;
      if (!image) throw new Error("unsupported");
      const scale = Math.min(612 / image.width, 792 / image.height, 1);
      const width = image.width * scale;
      const height = image.height * scale;
      const page = pdf.addPage([Math.max(1, width), Math.max(1, height)]);
      page.drawImage(image, { x: 0, y: 0, width, height });
      sourceEmbedded = true;
    } catch {
      throw new Error("smart_document_source_requires_pdf_or_image");
    }
  }
  const filledSourceFields = sourceEmbedded ? applyExistingPdfFields(pdf, fields, responses) : [];
  const fonts = {
    helveticaRegular: await pdf.embedFont(StandardFonts.Helvetica),
    helveticaBold: await pdf.embedFont(StandardFonts.HelveticaBold),
    helveticaOblique: await pdf.embedFont(StandardFonts.HelveticaOblique),
    helveticaBoldOblique: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    timesRegular: await pdf.embedFont(StandardFonts.TimesRoman),
    timesBold: await pdf.embedFont(StandardFonts.TimesRomanBold),
    timesOblique: await pdf.embedFont(StandardFonts.TimesRomanItalic),
    timesBoldOblique: await pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
    courierRegular: await pdf.embedFont(StandardFonts.Courier),
    courierBold: await pdf.embedFont(StandardFonts.CourierBold),
    courierOblique: await pdf.embedFont(StandardFonts.CourierOblique),
    courierBoldOblique: await pdf.embedFont(StandardFonts.CourierBoldOblique),
  };
  const filledSet = new Set(filledSourceFields.map((name) => name.trim().toLowerCase()));
  fields.forEach((field) => {
    if (field.sourceName && filledSet.has(field.sourceName.trim().toLowerCase())) return;
    drawPlacedField(pdf, field, responses[field.id], fonts);
  });
  if (sourceEmbedded && filledSourceFields.length) {
    try { pdf.getForm().flatten(); } catch { /* Placed fields still remain authoritative. */ }
  }
  safeText(actor.name || actor.email || "JobCrest representative", 200, { required: true });
  const bytes = Buffer.from(await pdf.save());
  const baseName = source.name.replace(/\.[^.]+$/, "").slice(0, 190) || "document";
  return { bytes, name: `${baseName} - Completed.pdf`, fields, responses, filledSourceFields };
}

module.exports = {
  FIELD_TYPES, MAX_FIELDS, MAX_SOURCE_BYTES, safeId, normalizeFields, normalizeResponses,
  renderCompletedDocument,
};
