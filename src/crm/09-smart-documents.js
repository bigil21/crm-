function renderSmartDocumentEditor(fields, responses = {}) {
  const safeFields = (fields || []).slice(0, 300);
  if (selectedSmartDocumentFieldId && !safeFields.some((field) => field.id === selectedSmartDocumentFieldId)) selectedSmartDocumentFieldId = "";
  els.smartDocumentFields.innerHTML = safeFields.map((field) => `
    <div class="smart-document-field-row${field.id === selectedSmartDocumentFieldId ? " selected" : ""}" data-smart-field-id="${escapeHtml(field.id)}" data-smart-detected="${field.detected ? "true" : "false"}">
      <input name="fieldLabel" value="${escapeHtml(field.label)}" maxlength="120" aria-label="Field label" placeholder="Field label" />
      <select name="fieldType" aria-label="Field type">
        ${[["text","Text"],["textarea","Long text"],["date","Date"],["number","Number"],["email","Email"],["checkbox","Checkbox"],["radio","Radio"],["signature","Signature"],["initials","Initials"]].map(([value, label]) => `<option value="${value}" ${field.type === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
      <label class="smart-document-required"><input name="fieldRequired" type="checkbox" ${field.required ? "checked" : ""} />Required</label>
      <button class="mini-button" type="button" data-remove-smart-field="${escapeHtml(field.id)}" aria-label="Remove ${escapeHtml(field.label)}"><span aria-hidden="true" data-icon="trash"></span></button>
      <input class="smart-document-source-name" name="fieldSourceName" value="${escapeHtml(field.sourceName || "")}" maxlength="200" aria-label="Matching PDF field name" placeholder="Matching PDF field name (optional)" />
      <span class="smart-document-field-location">Page ${Math.max(1, Math.round(number(field.page) || 1))}${field.detected ? " · detected" : ""}</span>
      <div class="smart-document-formatting" aria-label="Text formatting">
        <label>Font<select name="fieldFontFamily">
          ${["Helvetica", "Times Roman", "Courier"].map((font) => `<option value="${font}" ${field.fontFamily === font ? "selected" : ""}>${font}</option>`).join("")}
        </select></label>
        <label>Size<input name="fieldFontSize" type="number" min="6" max="72" step="1" value="${Math.max(6, Math.min(72, number(field.fontSize) || 10))}" /></label>
        <div class="smart-format-buttons" aria-label="Font style">
          <label class="smart-format-toggle" title="Bold"><input name="fieldBold" type="checkbox" ${field.bold ? "checked" : ""} /><strong>B</strong></label>
          <label class="smart-format-toggle" title="Italic"><input name="fieldItalic" type="checkbox" ${field.italic ? "checked" : ""} /><em>I</em></label>
          <label class="smart-format-toggle" title="Underline"><input name="fieldUnderline" type="checkbox" ${field.underline ? "checked" : ""} /><u>U</u></label>
        </div>
        <label>Text color<input name="fieldTextColor" type="color" value="${/^#[0-9a-f]{6}$/i.test(field.textColor || "") ? field.textColor : "#071525"}" /></label>
        <label>Highlight<span class="smart-highlight-control"><input name="fieldHighlightEnabled" type="checkbox" ${field.highlightColor ? "checked" : ""} aria-label="Use highlight" /><input name="fieldHighlightColor" type="color" value="${/^#[0-9a-f]{6}$/i.test(field.highlightColor || "") ? field.highlightColor : "#fff19a"}" /></span></label>
        <label>Alignment<select name="fieldTextAlign"><option value="left" ${field.textAlign === "left" ? "selected" : ""}>Left</option><option value="center" ${field.textAlign === "center" ? "selected" : ""}>Center</option><option value="right" ${field.textAlign === "right" ? "selected" : ""}>Right</option></select></label>
      </div>
      <input name="fieldPage" type="hidden" value="${Math.max(1, Math.round(number(field.page) || 1))}" />
      <input name="fieldX" type="hidden" value="${Number.isFinite(Number(field.x)) ? escapeHtml(field.x) : ""}" />
      <input name="fieldY" type="hidden" value="${Number.isFinite(Number(field.y)) ? escapeHtml(field.y) : ""}" />
      <input name="fieldWidth" type="hidden" value="${Number.isFinite(Number(field.width)) ? escapeHtml(field.width) : ""}" />
      <input name="fieldHeight" type="hidden" value="${Number.isFinite(Number(field.height)) ? escapeHtml(field.height) : ""}" />
    </div>`).join("");
  if (!safeFields.length) els.smartDocumentFields.innerHTML = '<div class="smart-document-empty-fields">No fields yet. Analyze the document or choose a field type and click the page.</div>';
  els.smartDocumentResponses.innerHTML = safeFields.map((field) => {
    const initial = Object.prototype.hasOwnProperty.call(responses, field.id) ? responses[field.id] : field.defaultValue || (field.type === "checkbox" ? false : "");
    return `<div class="smart-document-response"><label><span>${escapeHtml(field.label)}${field.required ? " *" : ""}</span>${smartDocumentInput(field, initial)}</label></div>`;
  }).join("");
  hydrateIcons(els.smartDocumentFields);
  renderSmartDocumentOverlays(safeFields, responses);
  updateSmartDocumentSelection(selectedSmartDocumentFieldId);
}

function refreshSmartDocumentResponses() {
  const responses = smartDocumentResponseValues();
  const fields = smartDocumentFieldRows();
  renderSmartDocumentEditor(fields, responses);
}

function isPlacedSmartField(field) {
  return [field?.x, field?.y, field?.width, field?.height].every((value) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)));
}

function setSmartFieldGeometry(fieldId, geometry) {
  const row = els.smartDocumentFields?.querySelector(`[data-smart-field-id="${CSS.escape(fieldId)}"]`);
  if (!row) return;
  const values = { fieldPage: geometry.page, fieldX: geometry.x, fieldY: geometry.y, fieldWidth: geometry.width, fieldHeight: geometry.height };
  Object.entries(values).forEach(([name, value]) => { const input = row.querySelector(`[name="${name}"]`); if (input) input.value = Number(value).toFixed(name === "fieldPage" ? 0 : 6); });
  const label = row.querySelector(".smart-document-field-location");
  if (label) label.textContent = `Page ${geometry.page}${row.dataset.smartDetected === "true" ? " · detected" : ""}`;
}

function syncSmartOverlayValue(fieldId, value) {
  const response = els.smartDocumentResponses?.querySelector(`[data-smart-response-id="${CSS.escape(fieldId)}"]`);
  if (!response) return;
  if (response.type === "checkbox") response.checked = Boolean(value);
  else response.value = String(value ?? "");
}

function smartOverlayControl(field, value) {
  const common = `data-smart-overlay-input="${escapeHtml(field.id)}" aria-label="${escapeHtml(field.label)}"`;
  if (["checkbox", "radio"].includes(field.type)) return `<input ${common} type="${field.type}" ${value ? "checked" : ""} />`;
  const style = `font-family:${field.fontFamily === "Times Roman" ? "Georgia,serif" : field.fontFamily === "Courier" ? "'Courier New',monospace" : "Arial,sans-serif"};font-size:${escapeHtml(field.fontSize || 10)}px;font-weight:${field.bold ? 700 : 400};font-style:${field.italic ? "italic" : "normal"};text-decoration:${field.underline ? "underline" : "none"};color:${escapeHtml(field.textColor || "#071525")};background:${escapeHtml(field.highlightColor || "transparent")};text-align:${escapeHtml(field.textAlign || "left")}`;
  if (["text", "textarea"].includes(field.type)) return `<textarea ${common} wrap="soft" style="${style}">${escapeHtml(value || "")}</textarea>`;
  const type = ["date", "number", "email"].includes(field.type) ? field.type : "text";
  return `<input ${common} type="${type}" value="${escapeHtml(value || "")}" style="${style}" ${type === "number" ? 'step="any"' : ""} />`;
}

function updateSmartDocumentSelection(fieldId = "") {
  const exists = Boolean(fieldId && els.smartDocumentFields?.querySelector(`[data-smart-field-id="${CSS.escape(fieldId)}"]`));
  selectedSmartDocumentFieldId = exists ? fieldId : "";
  els.smartDocumentPages?.querySelectorAll("[data-smart-overlay-id]").forEach((overlay) => {
    const selected = overlay.dataset.smartOverlayId === selectedSmartDocumentFieldId;
    overlay.classList.toggle("selected", selected);
    overlay.setAttribute("aria-selected", selected ? "true" : "false");
  });
  els.smartDocumentFields?.querySelectorAll("[data-smart-field-id]").forEach((row) => row.classList.toggle("selected", row.dataset.smartFieldId === selectedSmartDocumentFieldId));
  if (els.deleteSelectedSmartField) {
    els.deleteSelectedSmartField.disabled = !selectedSmartDocumentFieldId;
    els.deleteSelectedSmartField.title = selectedSmartDocumentFieldId ? "Delete the highlighted field" : "Select a field on the document to delete it";
  }
}

function focusSmartDocumentFieldProperties(fieldId) {
  updateSmartDocumentSelection(fieldId);
  const row = els.smartDocumentFields?.querySelector(`[data-smart-field-id="${CSS.escape(fieldId)}"]`);
  row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  row?.querySelector('[name="fieldLabel"]')?.focus({ preventScroll: true });
}

function deleteSelectedSmartDocumentField() {
  if (!selectedSmartDocumentFieldId) return setSaveState(els.smartDocumentSaveStatus, "Select a field bubble on the document first.", "error");
  const fieldId = selectedSmartDocumentFieldId;
  const responses = smartDocumentResponseValues();
  delete responses[fieldId];
  const fields = smartDocumentFieldRows().filter((field) => field.id !== fieldId);
  selectedSmartDocumentFieldId = "";
  renderSmartDocumentEditor(fields, responses);
  if (els.smartDocumentCanvasHelp) els.smartDocumentCanvasHelp.textContent = "Field deleted. Select another field to move, resize, or delete it.";
}

function enableSmartOverlayManipulation(overlay, field) {
  const page = overlay.closest(".smart-document-page");
  if (!page) return;
  const applyGeometry = (geometry) => {
    Object.assign(field, geometry);
    overlay.style.left = `${geometry.x * 100}%`; overlay.style.top = `${geometry.y * 100}%`;
    overlay.style.width = `${geometry.width * 100}%`; overlay.style.height = `${geometry.height * 100}%`;
    setSmartFieldGeometry(field.id, geometry);
  };
  overlay._smartField = field;
  overlay._applySmartGeometry = applyGeometry;
  const begin = (event, resizing) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    updateSmartDocumentSelection(field.id);
    const activePage = overlay.closest(".smart-document-page") || page;
    if (!activePage?.isConnected) return;
    const bounds = activePage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const start = { x: event.clientX, y: event.clientY, left: number(field.x), top: number(field.y), width: number(field.width), height: number(field.height) };
    overlay.setPointerCapture?.(event.pointerId);
    const move = (next) => {
      const dx = (next.clientX - start.x) / bounds.width;
      const dy = (next.clientY - start.y) / bounds.height;
      const geometry = resizing
        ? { page: field.page, x: start.left, y: start.top, width: Math.max(0.035, Math.min(1 - start.left, start.width + dx)), height: Math.max(0.025, Math.min(1 - start.top, start.height + dy)) }
        : { page: field.page, x: Math.max(0, Math.min(1 - start.width, start.left + dx)), y: Math.max(0, Math.min(1 - start.height, start.top + dy)), width: start.width, height: start.height };
      applyGeometry(geometry);
    };
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, { once: true });
  };
  const moveHandle = overlay.querySelector(".smart-field-drag-handle");
  const resizeHandle = overlay.querySelector(".smart-field-resize-handle");
  moveHandle?.addEventListener("pointerdown", (event) => begin(event, false));
  resizeHandle?.addEventListener("pointerdown", (event) => begin(event, true));
  moveHandle?.addEventListener("keydown", (event) => {
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault(); updateSmartDocumentSelection(field.id);
    const step = event.shiftKey ? 0.02 : 0.005;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    applyGeometry({ page: field.page, x: Math.max(0, Math.min(1 - field.width, field.x + dx)), y: Math.max(0, Math.min(1 - field.height, field.y + dy)), width: field.width, height: field.height });
  });
  resizeHandle?.addEventListener("keydown", (event) => {
    if (!event.key.startsWith("Arrow")) return;
    event.preventDefault(); updateSmartDocumentSelection(field.id);
    const step = event.shiftKey ? 0.02 : 0.005;
    const dw = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dh = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    applyGeometry({ page: field.page, x: field.x, y: field.y, width: Math.max(0.035, Math.min(1 - field.x, field.width + dw)), height: Math.max(0.025, Math.min(1 - field.y, field.height + dh)) });
  });
}

function growSmartOverlayToContent(overlay) {
  const control = overlay?.querySelector?.("textarea[data-smart-overlay-input]");
  const page = overlay?.closest?.(".smart-document-page");
  const field = overlay?._smartField;
  const applyGeometry = overlay?._applySmartGeometry;
  if (!control || !page || !field || typeof applyGeometry !== "function") return;
  const bounds = page.getBoundingClientRect();
  if (!bounds.height) return;
  const minimumHeight = defaultSmartFieldSize(field.type).height;
  const previousInlineHeight = control.style.height;
  control.style.height = "0px";
  const contentHeight = control.scrollHeight;
  control.style.height = previousInlineHeight;
  const desiredHeight = Math.max(minimumHeight, (contentHeight + 6) / bounds.height);
  if (desiredHeight <= field.height + (2 / bounds.height)) return;
  const height = Math.min(1, desiredHeight);
  const y = Math.min(field.y, Math.max(0, 1 - height));
  applyGeometry({ page: field.page, x: field.x, y, width: field.width, height: Math.min(height, 1 - y) });
}

function renderSmartDocumentOverlays(fields = smartDocumentFieldRows(), responses = smartDocumentResponseValues()) {
  els.smartDocumentPages?.querySelectorAll(".smart-document-overlay-layer").forEach((layer) => { layer.innerHTML = ""; });
  fields.filter(isPlacedSmartField).forEach((field) => {
    const page = els.smartDocumentPages?.querySelector(`[data-smart-page="${field.page}"]`);
    const layer = page?.querySelector(".smart-document-overlay-layer");
    if (!layer) return;
    const overlay = document.createElement("div");
    overlay.className = `smart-field-overlay${field.id === selectedSmartDocumentFieldId ? " selected" : ""}`;
    overlay.dataset.smartOverlayId = field.id;
    overlay.setAttribute("role", "group");
    overlay.setAttribute("aria-label", `${field.label} field`);
    overlay.setAttribute("aria-selected", field.id === selectedSmartDocumentFieldId ? "true" : "false");
    overlay.style.cssText = `left:${field.x * 100}%;top:${field.y * 100}%;width:${field.width * 100}%;height:${field.height * 100}%`;
    overlay.innerHTML = `<button class="smart-field-drag-handle" type="button" title="Drag to move ${escapeHtml(field.label)}; use arrow keys for precise movement" aria-label="Move ${escapeHtml(field.label)}">${escapeHtml(field.label)}</button>${smartOverlayControl(field, responses[field.id])}<button class="smart-field-resize-handle" type="button" title="Drag to resize; use arrow keys for precise sizing" aria-label="Resize ${escapeHtml(field.label)}"></button>`;
    const control = overlay.querySelector("[data-smart-overlay-input]");
    overlay.addEventListener("pointerdown", () => updateSmartDocumentSelection(field.id));
    overlay.addEventListener("focusin", () => updateSmartDocumentSelection(field.id));
    overlay.addEventListener("dblclick", (event) => { event.preventDefault(); event.stopPropagation(); focusSmartDocumentFieldProperties(field.id); });
    control?.addEventListener("input", () => {
      syncSmartOverlayValue(field.id, ["checkbox", "radio"].includes(control.type) ? control.checked : control.value);
      growSmartOverlayToContent(overlay);
    });
    control?.addEventListener("change", () => syncSmartOverlayValue(field.id, ["checkbox", "radio"].includes(control.type) ? control.checked : control.value));
    layer.append(overlay);
    enableSmartOverlayManipulation(overlay, field);
    requestAnimationFrame(() => growSmartOverlayToContent(overlay));
  });
}

function defaultSmartFieldSize(type) {
  if (["checkbox", "radio"].includes(type)) return { width: 0.055, height: 0.04 };
  if (type === "signature") return { width: 0.34, height: 0.055 };
  if (type === "initials") return { width: 0.14, height: 0.05 };
  if (type === "textarea") return { width: 0.42, height: 0.1 };
  return { width: type === "date" || type === "number" ? 0.22 : 0.32, height: 0.045 };
}

function addPlacedSmartField(type, pageNumber, x, y, { label = "", sourceName = "", detected = false, width, height } = {}) {
  const responses = smartDocumentResponseValues();
  const fields = smartDocumentFieldRows();
  if (fields.length >= 300) throw new Error("This Smart Document already has the 300-field maximum.");
  const size = defaultSmartFieldSize(type);
  const finalWidth = Math.max(0.025, Math.min(1 - x, width || size.width));
  const finalHeight = Math.max(0.02, Math.min(1 - y, height || size.height));
  const field = { id: uid("smart-field"), label: label || `${type === "checkbox" ? "Checkbox" : "Field"} ${fields.length + 1}`, type, required: false, sourceName, placeholder: "", page: pageNumber, x, y, width: finalWidth, height: finalHeight, fontSize: 10, fontFamily: "Helvetica", bold: false, italic: ["signature", "initials"].includes(type), underline: false, textColor: "#071525", highlightColor: "", textAlign: "left", detected };
  fields.push(field);
  selectedSmartDocumentFieldId = field.id;
  renderSmartDocumentEditor(fields, responses);
  els.smartDocumentFields?.querySelector(`[data-smart-field-id="${CSS.escape(field.id)}"]`)?.scrollIntoView({ block: "nearest" });
  return field;
}

function updateSmartDocumentPageIndicator(pageNumber) {
  const page = Math.max(1, Math.min(Number(els.smartDocumentPageNumber?.max) || 1, Math.round(number(pageNumber) || 1)));
  if (els.smartDocumentPageNumber) els.smartDocumentPageNumber.value = page;
  els.smartDocumentThumbnails?.querySelectorAll("[data-smart-thumbnail]").forEach((item) => item.classList.toggle("active", Number(item.dataset.smartThumbnail) === page));
}

function scrollToSmartDocumentPage(pageNumber) {
  const page = els.smartDocumentPages?.querySelector(`[data-smart-page="${Math.max(1, Math.round(number(pageNumber) || 1))}"]`);
  page?.scrollIntoView({ block: "start", behavior: "smooth" });
  updateSmartDocumentPageIndicator(pageNumber);
}

function setSmartDocumentZoom(value, { fit = false } = {}) {
  let next = Math.max(0.5, Math.min(2, Number(value) || 1));
  if (fit) {
    const available = Math.max(320, (els.smartDocumentPreviewPane?.clientWidth || 900) - 36);
    const first = els.smartDocumentPages?.querySelector(".smart-document-page");
    next = Math.max(0.5, Math.min(2, available / Math.max(1, number(first?.dataset.smartBaseWidth) || 920)));
  }
  smartDocumentZoom = next;
  els.smartDocumentPages?.querySelectorAll(".smart-document-page").forEach((page) => {
    const baseWidth = Math.max(1, number(page.dataset.smartBaseWidth) || 920);
    page.style.width = `${Math.round(baseWidth * smartDocumentZoom)}px`;
  });
  if (els.smartDocumentZoomValue) els.smartDocumentZoomValue.value = `${Math.round(smartDocumentZoom * 100)}%`;
  if (els.smartDocumentZoomOut) els.smartDocumentZoomOut.disabled = smartDocumentZoom <= 0.5;
  if (els.smartDocumentZoomIn) els.smartDocumentZoomIn.disabled = smartDocumentZoom >= 2;
}

function appendSmartDocumentThumbnail(pageNumber, source) {
  if (!els.smartDocumentThumbnails) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "smart-document-thumbnail";
  button.dataset.smartThumbnail = pageNumber;
  button.innerHTML = `<img src="${escapeHtml(source)}" alt="Page ${pageNumber} preview" /><span>${pageNumber}</span>`;
  button.addEventListener("click", () => scrollToSmartDocumentPage(pageNumber));
  els.smartDocumentThumbnails.append(button);
}

function smartFieldTypeFromAnnotation(annotation) {
  if (annotation.fieldType === "Btn") return "checkbox";
  const name = `${annotation.fieldName || ""} ${annotation.alternativeText || ""}`.toLowerCase();
  if (annotation.fieldType === "Sig" || /signature|signed by|sign here/.test(name)) return "signature";
  if (/initials?/.test(name)) return "initials";
  if (/date/.test(name) && !/time/.test(name)) return "date";
  if (/email/.test(name)) return "email";
  if (/amount|price|total|quantity|number/.test(name) && !/phone|lead|job|project/.test(name)) return "number";
  return annotation.multiLine ? "textarea" : "text";
}

function smartFieldTypeFromLabel(value, { checkbox = false } = {}) {
  const label = String(value || "").toLowerCase();
  if (checkbox) return "checkbox";
  if (/signature|signed by|sign here|authorized sign/.test(label)) return "signature";
  if (/\binitials?\b/.test(label)) return "initials";
  if (/\bdate\b|mm\s*[/.-]\s*dd|dd\s*[/.-]\s*mm/.test(label)) return "date";
  if (/\bemail\b/.test(label)) return "email";
  if (/amount|price|total|qty|quantity|rate|cost|balance|deposit|payment/.test(label)) return "number";
  if (/description|scope|notes?|comments?|details?/.test(label)) return "textarea";
  return "text";
}

function cleanDetectedSmartFieldLabel(value, fallback) {
  const cleaned = String(value || "")
    .replace(/(?:_{2,}|\.{4,}|\[\s*\]|[□☐❑]|(?:_{1,4}\s*[/.-]\s*){1,2}_{1,4})/g, " ")
    .replace(/^\s*(?:please\s+)?(?:enter|provide|print|type)\s+/i, "")
    .replace(/[\s:;,.\-–—]+$/g, "")
    .trim();
  if (!cleaned) return fallback;
  const parts = cleaned.split(/\s{2,}|\|/).map((part) => part.trim()).filter(Boolean);
  return String(parts.at(-1) || cleaned).slice(-120);
}

function humanizeSmartFieldName(value, fallback) {
  const text = String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return fallback;
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 120);
}

function smartTextRunsOnLines(items, viewport) {
  const runs = items.map((item) => {
    const transform = smartDocumentPdfModule.Util.transform(viewport.transform, item.transform);
    const height = Math.max(8, Math.abs(transform[3] || item.height || 12));
    return {
      text: String(item.str || ""),
      x: transform[4],
      y: transform[5] - height,
      width: Math.max(1, Math.abs((item.width || 0) * viewport.scale)),
      height,
    };
  }).filter((run) => run.text.trim());
  const lines = [];
  runs.sort((a, b) => a.y - b.y || a.x - b.x).forEach((run) => {
    let line = lines.find((candidate) => Math.abs(candidate.y - run.y) <= Math.max(4, Math.min(candidate.height, run.height) * 0.55));
    if (!line) { line = { y: run.y, height: run.height, runs: [] }; lines.push(line); }
    line.runs.push(run);
    line.y = Math.min(line.y, run.y);
    line.height = Math.max(line.height, run.height);
  });
  lines.forEach((line) => line.runs.sort((a, b) => a.x - b.x));
  return lines;
}

function smartFieldOverlaps(fields, candidate) {
  return fields.some((field) => field.page === candidate.page && isPlacedSmartField(field) &&
    Math.abs((field.x + field.width / 2) - (candidate.x + candidate.width / 2)) < Math.max(0.025, candidate.width * 0.35) &&
    Math.abs((field.y + field.height / 2) - (candidate.y + candidate.height / 2)) < Math.max(0.018, candidate.height * 0.55));
}

async function analyzeSmartDocumentPages() {
  if (!smartDocumentPdf || !els.smartDocumentPages) return setSaveState(els.smartDocumentSaveStatus, "Open a PDF before analyzing it.", "error");
  const pdf = smartDocumentPdf;
  if (smartDocumentAnalysisPdf === pdf) return;
  smartDocumentAnalysisPdf = pdf;
  const renderToken = smartDocumentRenderToken;
  const isCurrent = () => smartDocumentPdf === pdf && smartDocumentRenderToken === renderToken;
  els.analyzeSmartDocument.disabled = true;
  setSaveState(els.smartDocumentSaveStatus, "Analyzing every page for form fields, labels, and blank lines…", "saving");
  try {
    const responses = smartDocumentResponseValues();
    const fields = smartDocumentFieldRows();
    const startingFieldCount = fields.length;
    const labelPattern = /(?:^|\b)(name|customer|company|address|city|state|zip|phone|email|date|description|item|material|quantity|qty|price|rate|amount|total|signature|initials?|notes?)\b/i;
    for (const pageElement of els.smartDocumentPages.querySelectorAll(".smart-document-page")) {
      if (!isCurrent()) return;
      const page = pageElement._pdfPage;
      const viewport = pageElement._pdfViewport;
      const pageNumber = number(pageElement.dataset.smartPage);
      const pageWidth = viewport.width; const pageHeight = viewport.height;
      if (els.smartDocumentCanvasHelp) els.smartDocumentCanvasHelp.textContent = `Analyzing page ${pageNumber} of ${pdf.numPages}…`;
      const annotations = pageElement._smartAnnotations ||= await page.getAnnotations({ intent: "display" });
      if (!isCurrent()) return;
      const widgets = annotations.filter((item) => item.subtype === "Widget" && Array.isArray(item.rect) && item.rect.length === 4 && item.rect.every(Number.isFinite));
      widgets.forEach((annotation) => {
        // PDF.js 6 removed convertToViewportRectangle. Points work in both
        // versions, including scaled, cropped and rotated page viewports.
        const start = viewport.convertToViewportPoint(annotation.rect[0], annotation.rect[1]);
        const end = viewport.convertToViewportPoint(annotation.rect[2], annotation.rect[3]);
        const left = Math.max(0, Math.min(pageWidth, start[0], end[0]));
        const top = Math.max(0, Math.min(pageHeight, start[1], end[1]));
        const right = Math.min(pageWidth, Math.max(start[0], end[0]));
        const bottom = Math.min(pageHeight, Math.max(start[1], end[1]));
        if (right <= left || bottom <= top) return;
        const candidate = { page: pageNumber, x: left / pageWidth, y: top / pageHeight, width: (right - left) / pageWidth, height: (bottom - top) / pageHeight };
        if (smartFieldOverlaps(fields, candidate)) return;
        const rawName = String(annotation.fieldName || "").slice(0, 200);
        const name = humanizeSmartFieldName(annotation.alternativeText || rawName, `Field ${fields.length + 1}`);
        fields.push({ id: uid("smart-field"), label: name, type: smartFieldTypeFromAnnotation(annotation), required: annotation.required === true, sourceName: rawName, placeholder: "", ...candidate, fontSize: 10, detected: true });
      });
      // Native fields already identify the inputs on this page precisely.
      // Avoid slower text heuristics and spurious bubbles beside their labels.
      if (widgets.length) continue;
      const text = pageElement._smartTextContent ||= await page.getTextContent();
      if (!isCurrent()) return;
      const lines = smartTextRunsOnLines(text.items, viewport);
      const blankPattern = /(?:_{1,4}\s*[/.-]\s*){1,2}_{1,4}|_{3,}|\.{5,}|\[\s*\]|[□☐❑]/g;
      lines.forEach((line) => {
        line.runs.forEach((run, runIndex) => {
          const matches = [...run.text.matchAll(blankPattern)];
          const previousText = line.runs.slice(Math.max(0, runIndex - 2), runIndex).map((item) => item.text.trim()).join(" ");
          const pixelsPerCharacter = run.width / Math.max(1, run.text.length);
          matches.forEach((match) => {
            const marker = String(match[0] || "");
            const checkbox = /\[\s*\]|[□☐❑]/.test(marker);
            const labelSource = `${previousText} ${run.text.slice(0, Number(match.index || 0))}`.trim();
            const fallback = checkbox ? `Checkbox ${fields.length + 1}` : `Field ${fields.length + 1}`;
            const cleanLabel = cleanDetectedSmartFieldLabel(labelSource, fallback);
            const type = smartFieldTypeFromLabel(`${cleanLabel} ${marker}`, { checkbox });
            const size = defaultSmartFieldSize(type);
            const markerX = run.x + Number(match.index || 0) * pixelsPerCharacter;
            const markerWidth = Math.max(checkbox ? 16 : 30, marker.length * pixelsPerCharacter);
            const x = Math.max(0, Math.min(0.97, markerX / pageWidth));
            const candidate = {
              page: pageNumber,
              x,
              y: Math.max(0, run.y / pageHeight),
              width: Math.min(checkbox ? size.width : Math.max(size.width * 0.55, markerWidth / pageWidth), 0.98 - x),
              height: Math.max(size.height, Math.min(0.08, (run.height + 6) / pageHeight)),
            };
            if (!smartFieldOverlaps(fields, candidate)) fields.push({
              id: uid("smart-field"), label: cleanLabel, type, required: false, sourceName: "", placeholder: "",
              ...candidate, fontSize: 10, detected: true,
            });
          });

          const label = run.text.trim();
          if (matches.length || !labelPattern.test(label)) return;
          const strongStandaloneLabel = /(?:[:：]\s*$)|\b(?:signature|signed by|sign here|initials?|date)\b\s*[:：]?\s*$/i.test(label);
          if (!strongStandaloneLabel) return;
          const next = line.runs[runIndex + 1];
          if (next && next.x <= run.x + run.width + 18 && /(?:_{1,4}\s*[/.-]\s*){1,2}_{1,4}|_{3,}|\.{5,}|\[\s*\]|[□☐❑]/.test(next.text)) return;
          const cleanLabel = cleanDetectedSmartFieldLabel(label, `Field ${fields.length + 1}`);
          const type = smartFieldTypeFromLabel(cleanLabel);
          const size = defaultSmartFieldSize(type);
          const x = Math.max(0, Math.min(0.92, (run.x + run.width + 6) / pageWidth));
          const candidate = {
            page: pageNumber, x, y: Math.max(0, run.y / pageHeight),
            width: Math.min(size.width, Math.max(0.06, 0.98 - x)),
            height: Math.max(size.height, Math.min(0.08, (run.height + 6) / pageHeight)),
          };
          if (!smartFieldOverlaps(fields, candidate)) fields.push({
            id: uid("smart-field"), label: cleanLabel, type, required: false, sourceName: "", placeholder: "",
            ...candidate, fontSize: 10, detected: true,
          });
        });
      });
    }
    if (!isCurrent()) return;
    renderSmartDocumentEditor(fields.slice(0, 300), responses);
    const detectedCount = Math.max(0, Math.min(300, fields.length) - startingFieldCount);
    if (els.smartDocumentCanvasHelp) els.smartDocumentCanvasHelp.textContent = detectedCount
      ? `${detectedCount} fillable area${detectedCount === 1 ? " was" : "s were"} placed automatically. Review, move, resize, or delete any field before saving.`
      : fields.length
        ? `${Math.min(300, fields.length)} fields are already mapped. Review the existing bubbles or choose a field type to add another.`
        : "No new blank areas were detected. Choose a field type and click the exact place it belongs.";
    setSaveState(els.smartDocumentSaveStatus, `${Math.min(300, fields.length)} fillable fields are mapped across the original document.`, "success");
  } catch (error) {
    if (!isCurrent()) return;
    if (els.smartDocumentCanvasHelp) els.smartDocumentCanvasHelp.textContent = "Analysis stopped. Try Analyze Document again, or place fields manually using the toolbar.";
    setSaveState(els.smartDocumentSaveStatus, error.message || "The document could not be analyzed.", "error");
  } finally {
    if (smartDocumentAnalysisPdf === pdf) smartDocumentAnalysisPdf = null;
    if (isCurrent()) els.analyzeSmartDocument.disabled = false;
  }
}

async function renderSmartDocumentCanvas(url, record) {
  const token = ++smartDocumentRenderToken;
  els.smartDocumentPages.innerHTML = "";
  if (els.smartDocumentThumbnails) els.smartDocumentThumbnails.innerHTML = "";
  smartDocumentPdf = null;
  if (!url) throw new Error("preview_unavailable");
  if (/pdf/i.test(record.type || "") || /\.pdf$/i.test(record.name || "")) {
    smartDocumentPdfModule ||= await import("/vendor/pdf.min.mjs?v=1");
    smartDocumentPdfModule.GlobalWorkerOptions.workerSrc = "/vendor/pdf.worker.min.mjs?v=1";
    const loadingTask = smartDocumentPdfModule.getDocument({ url });
    const pdf = await loadingTask.promise;
    if (token !== smartDocumentRenderToken) { await pdf.destroy(); return; }
    smartDocumentPdf = pdf;
    if (els.smartDocumentPageNumber) { els.smartDocumentPageNumber.max = pdf.numPages; els.smartDocumentPageNumber.value = 1; }
    if (els.smartDocumentPageCount) els.smartDocumentPageCount.textContent = `of ${pdf.numPages}`;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1.35 });
      const wrapper = document.createElement("div");
      wrapper.className = "smart-document-page"; wrapper.dataset.smartPage = pageNumber;
      wrapper.dataset.smartBaseWidth = Math.round(viewport.width);
      wrapper.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
      wrapper.innerHTML = `<canvas aria-label="Document page ${pageNumber}"></canvas><div class="smart-document-overlay-layer"></div><span class="smart-document-page-number">Page ${pageNumber}</span>`;
      wrapper._pdfPage = page; wrapper._pdfViewport = viewport;
      els.smartDocumentPages.append(wrapper);
      const canvas = wrapper.querySelector("canvas");
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport, transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0] }).promise;
      appendSmartDocumentThumbnail(pageNumber, canvas.toDataURL("image/jpeg", 0.72));
    }
  } else if (/^image\//i.test(record.type || "")) {
    const wrapper = document.createElement("div"); wrapper.className = "smart-document-page smart-document-image-page"; wrapper.dataset.smartPage = "1";
    wrapper.dataset.smartBaseWidth = "920";
    wrapper.innerHTML = `<img src="${escapeHtml(url)}" alt="Original document" /><div class="smart-document-overlay-layer"></div><span class="smart-document-page-number">Page 1</span>`;
    els.smartDocumentPages.append(wrapper);
    if (els.smartDocumentPageNumber) { els.smartDocumentPageNumber.max = 1; els.smartDocumentPageNumber.value = 1; }
    if (els.smartDocumentPageCount) els.smartDocumentPageCount.textContent = "of 1";
    appendSmartDocumentThumbnail(1, url);
  } else throw new Error("preview_unavailable");
  els.smartDocumentPages.querySelectorAll(".smart-document-page").forEach((page) => {
    const placeFieldAtEvent = (event, tool = smartDocumentPlacementTool, label = smartDocumentPlacementLabel) => {
      if (!tool || event.target.closest(".smart-field-overlay")) return;
      if (!(event.target.matches("canvas, img") || event.target.classList.contains("smart-document-overlay-layer"))) return;
      event.preventDefault();
      const bounds = page.getBoundingClientRect();
      const size = defaultSmartFieldSize(tool);
      const x = Math.max(0, Math.min(1 - size.width, (event.clientX - bounds.left) / bounds.width));
      const y = Math.max(0, Math.min(1 - size.height, (event.clientY - bounds.top) / bounds.height));
      addPlacedSmartField(tool, number(page.dataset.smartPage), x, y, { label });
      smartDocumentPlacementTool = "";
      smartDocumentPlacementLabel = "";
      document.querySelectorAll("[data-smart-tool]").forEach((button) => button.classList.remove("active"));
      if (els.smartDocumentCanvasHelp) els.smartDocumentCanvasHelp.textContent = "Field placed. Fill it directly, drag its blue title to move it, double-click to format it, or use the lower-right handle to resize it.";
    };
    page.addEventListener("click", (event) => placeFieldAtEvent(event));
    page.addEventListener("dragover", (event) => { if (event.dataTransfer?.types.includes("application/x-jobcrest-smart-field")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; page.classList.add("smart-drop-target"); } });
    page.addEventListener("dragleave", () => page.classList.remove("smart-drop-target"));
    page.addEventListener("drop", (event) => {
      page.classList.remove("smart-drop-target");
      const raw = event.dataTransfer?.getData("application/x-jobcrest-smart-field");
      if (!raw) return;
      let item; try { item = JSON.parse(raw); } catch { return; }
      placeFieldAtEvent(event, item.type, item.label);
    });
  });
  setSmartDocumentZoom(1, { fit: true });
  updateSmartDocumentPageIndicator(1);
  if (els.smartDocumentPreviewPane) els.smartDocumentPreviewPane.onscroll = () => {
    const paneTop = els.smartDocumentPreviewPane.getBoundingClientRect().top + 90;
    let closest = 1; let distance = Infinity;
    els.smartDocumentPages.querySelectorAll(".smart-document-page").forEach((page) => {
      const current = Math.abs(page.getBoundingClientRect().top - paneTop);
      if (current < distance) { distance = current; closest = number(page.dataset.smartPage); }
    });
    updateSmartDocumentPageIndicator(closest);
  };
}

async function smartDocumentPreviewUrl(record, { original = false } = {}) {
  const completedPath = original ? "" : record.smartDocument?.completedFile?.storagePath || "";
  const storagePath = completedPath || record.storagePath || "";
  if (storagePath && cloudClient?.storage) {
    const { data, error } = await cloudClient.storage.from(SUPABASE_DOCUMENT_BUCKET).createSignedUrl(storagePath, 900);
    if (error) throw error;
    return data?.signedUrl || "";
  }
  if (record.dataUrl && /^(?:data:application\/pdf|data:image\/|data:text\/plain)/i.test(record.dataUrl)) return record.dataUrl;
  return "";
}

async function openSmartDocumentDialog(record) {
  if (!record || !supportsNativeSmartDocument(record) || !els.smartDocumentDialog) return showToast("Finish saving this file before creating a Smart Document.");
  const { lead } = findManagedDocument(record.id);
  const job = lead ? contactJobs(lead).find((item) => item.id === record.jobId) : null;
  const smart = record.smartDocument;
  selectedSmartDocumentFieldId = "";
  els.smartDocumentForm.reset();
  els.analyzeSmartDocument.disabled = true;
  els.smartDocumentForm.elements.documentId.value = record.id;
  els.smartDocumentTitle.textContent = smart ? record.name : `Create Smart Document from ${record.name}`;
  els.smartDocumentMeta.textContent = [lead?.name, job?.name, smart ? `${smart.status} · revision ${smart.revision}` : "New Smart Document"].filter(Boolean).join(" · ");
  const fields = smart?.fields?.length ? smart.fields : [];
  const responses = smart?.responses || Object.fromEntries(fields.filter((field) => field.defaultValue !== undefined).map((field) => [field.id, field.defaultValue]));
  renderSmartDocumentEditor(fields, responses);
  els.smartDocumentForm.elements.emailTo.value = smart?.lastEmailedTo || lead?.email || "";
  els.smartDocumentForm.elements.emailSubject.value = `${state.company.name || "JobCrest"} - ${record.name.replace(/\.[^.]+$/, "")}`;
  els.smartDocumentForm.elements.emailMessage.value = `Hello ${lead?.name || ""},\n\nAttached is the completed ${record.name.replace(/\.[^.]+$/, "")} for ${job?.name || "your project"}.\n\nThank you.`;
  const completed = smart?.status === "completed" && smart.completedFile?.storagePath;
  els.smartDocumentEmailPanel.classList.toggle("hidden", !completed);
  els.emailSmartDocument.classList.toggle("hidden", !completed);
  setSaveState(els.smartDocumentSaveStatus, "", "");
  if (smartDocumentPreviewObjectUrl) URL.revokeObjectURL(smartDocumentPreviewObjectUrl);
  smartDocumentPreviewObjectUrl = "";
  els.smartDocumentPreview.removeAttribute("src");
  els.smartDocumentPreview.classList.add("hidden");
  els.smartDocumentPages.innerHTML = "";
  els.smartDocumentPreviewFallback.classList.add("hidden");
  els.smartDocumentDialog.showModal();
  try {
    const previewUrl = await smartDocumentPreviewUrl(record, { original: true });
    await renderSmartDocumentCanvas(previewUrl, record);
    renderSmartDocumentOverlays(fields, responses);
    els.analyzeSmartDocument.disabled = !smartDocumentPdf;
    els.analyzeSmartDocument.title = smartDocumentPdf ? "Detect fields, labels, and blank lines across every PDF page" : "Automatic detection is available for PDF documents; fields can still be placed manually on this image";
    els.smartDocumentCanvasHelp.textContent = fields.length
      ? "Fill values directly on the original pages. Drag the field title to move it and use the lower-right handle to resize it."
      : smartDocumentPdf
        ? "Analyzing the original document and placing likely fillable areas…"
        : "Choose a field type and click anywhere on the document to place it.";
    if (smartDocumentPdf && (!fields.length || (smart?.analysisVersion || 0) < 1)) await analyzeSmartDocumentPages();
  } catch {
    els.smartDocumentPages.innerHTML = "";
    els.smartDocumentPreviewFallback.classList.remove("hidden");
  }
}

function smartDocumentPayloadFromEditor(status) {
  const fields = smartDocumentFieldRows();
  if (!fields.length || fields.some((field) => !field.label)) throw new Error("Add a label for every Smart Document field.");
  const unplaced = fields.find((field) => !isPlacedSmartField(field));
  if (unplaced) throw new Error(`Place ${unplaced.label} on the document before saving.`);
  const ids = new Set(fields.map((field) => field.id));
  if (ids.size !== fields.length) throw new Error("Each Smart Document field must be unique.");
  const responses = smartDocumentResponseValues();
  if (status === "completed") {
    const missing = fields.find((field) => field.required && (field.type === "checkbox" ? responses[field.id] !== true : !String(responses[field.id] || "").trim()));
    if (missing) throw new Error(`Complete the required field: ${missing.label}`);
  }
  return { documentId: els.smartDocumentForm.elements.documentId.value, fields, responses, status };
}

function setSmartDocumentButtonsDisabled(disabled) {
  [els.addSmartDocumentField, els.saveSmartDocumentTemplate, els.saveSmartDocumentDraft, els.completeSmartDocument, els.emailSmartDocument]
    .forEach((button) => { if (button) button.disabled = disabled; });
  if (els.deleteSelectedSmartField) els.deleteSelectedSmartField.disabled = disabled || !selectedSmartDocumentFieldId;
}

async function saveNativeSmartDocument(status) {
  if (!requireAction("manageDocuments")) return false;
  let payload;
  try { payload = smartDocumentPayloadFromEditor(status); }
  catch (error) { setSaveState(els.smartDocumentSaveStatus, error.message, "error"); return false; }
  if (!(await settleDurableWritesBeforeTrustedMutation())) {
    setSaveState(els.smartDocumentSaveStatus, "Finish or recover the pending shared save before saving this Smart Document.", "error");
    return false;
  }
  setSmartDocumentButtonsDisabled(true);
  setSaveState(els.smartDocumentSaveStatus, status === "completed" ? "Creating and securely saving the completed PDF…" : "Saving Smart Document…", "saving");
  let reloadNeeded = false;
  try {
    // Rendering a completed PDF can take up to 90 seconds. It is a trusted,
    // document-scoped server mutation and must not hold the global CRM record
    // writer lock while unrelated checklists, costs, or lead edits are saved.
    const headers = await squareApiHeaders();
    const response = await fetch("/api/smart-documents/save", { method: "POST", headers, signal: AbortSignal.timeout(90000), body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.saved !== true) throw new Error(result.error || "The Smart Document could not be saved.");
    const appliedRows = await reloadDurableRecords({ showUpdateToast: false });
    reloadNeeded = appliedRows === null;
    const completedCopy = result.status === "completed" && result.completedDocumentId;
    if (result.status === "completed" && (!completedCopy || result.completedDocument?.id !== completedCopy)) throw new Error("The completed PDF copy could not be confirmed in its document category.");
    const current = findManagedDocument(completedCopy || payload.documentId);
    const record = current.record && result.smartDocument
      ? { ...current.record, smartDocument: result.smartDocument }
      : current.record || (completedCopy ? normalizeDocument(result.completedDocument) : null);
    if (completedCopy && appliedRows !== null) {
      if (current.lead) renderLeadDocuments(current.lead);
      else renderCompanyDocuments();
    }
    if (record) {
      if (completedCopy) {
        els.smartDocumentForm.elements.documentId.value = completedCopy;
        els.smartDocumentTitle.textContent = record.name;
      }
      els.smartDocumentMeta.textContent = `${record.name} · ${result.status} · revision ${result.revision}`;
      const completed = result.status === "completed";
      els.smartDocumentEmailPanel.classList.toggle("hidden", !completed);
      els.emailSmartDocument.classList.toggle("hidden", !completed);
      if (completed) {
        const previewUrl = await smartDocumentPreviewUrl(record).catch(() => "");
        if (previewUrl) { els.smartDocumentPreviewFallback.classList.add("hidden"); await renderSmartDocumentCanvas(previewUrl, { ...record, type: "application/pdf", name: result.completedFile?.name || record.name }); renderSmartDocumentOverlays([], {}); }
      }
    }
    setSaveState(els.smartDocumentSaveStatus, status === "completed" ? `Completed PDF saved as a new copy in ${record?.category || "the original document category"}. The original document is retained.` : status === "template" ? "Smart Document fields saved." : "Draft responses saved.", "success");
    return true;
  } catch (error) {
    setSaveState(els.smartDocumentSaveStatus, error.message || "The Smart Document could not be saved.", "error");
    return false;
  } finally {
    if (reloadNeeded) queueDurableRecordsReload({ showUpdateToast: false });
    setSmartDocumentButtonsDisabled(false);
  }
}

async function emailNativeSmartDocument() {
  if (!requireAction("sendEmail")) return;
  const documentId = els.smartDocumentForm.elements.documentId.value;
  const payload = {
    documentId,
    toEmail: els.smartDocumentForm.elements.emailTo.value.trim(),
    subject: els.smartDocumentForm.elements.emailSubject.value.trim(),
    message: els.smartDocumentForm.elements.emailMessage.value.trim(),
  };
  if (!payload.toEmail || !payload.subject || !payload.message) return setSaveState(els.smartDocumentSaveStatus, "Enter the recipient, subject, and message before sending.", "error");
  setSmartDocumentButtonsDisabled(true);
  setSaveState(els.smartDocumentSaveStatus, "Sending the completed PDF from your connected Gmail account…", "saving");
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/smart-documents/email", { method: "POST", headers, signal: AbortSignal.timeout(60000), body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.sent !== true) throw new Error(result.error || "The Smart Document could not be emailed.");
    const { record, lead } = findManagedDocument(documentId);
    if (lead && record?.jobId) {
      updateContact(lead.id, (current) => ({ ...current, jobs: contactJobs(current).map((job) => job.id === record.jobId ? { ...job, emails: [normalizeJobEmail({
        fromEmail: result.fromEmail, toEmail: payload.toEmail, subject: payload.subject, message: payload.message,
        provider: "gmail", providerMessageId: result.messageId, providerThreadId: result.threadId,
        deliveryStatus: "sent", attachmentName: record.smartDocument?.completedFile?.name || "Completed Smart Document.pdf",
        createdBy: state.currentUser.name || state.currentUser.email,
      }), ...(job.emails || [])] } : job) }));
      saveState({ localOnly: true });
      await persistDurableRecordNow("contact", lead.id, (confirmed, expected) => durableRecordDataMatches(confirmed, expected), { syncLegacy: false });
    }
    await reloadDurableRecords({ showUpdateToast: false });
    setSaveState(els.smartDocumentSaveStatus, `Completed PDF emailed to ${result.toEmail}.`, "success");
    render();
  } catch (error) {
    setSaveState(els.smartDocumentSaveStatus, error.message || "The Smart Document could not be emailed.", "error");
  } finally { setSmartDocumentButtonsDisabled(false); }
}

function closeSmartDocumentDialog() {
  smartDocumentRenderToken += 1;
  els.smartDocumentDialog?.close();
  els.smartDocumentPreview?.removeAttribute("src");
  els.smartDocumentPages && (els.smartDocumentPages.innerHTML = "");
  smartDocumentPdf?.destroy?.();
  smartDocumentPdf = null;
  smartDocumentPlacementTool = "";
  selectedSmartDocumentFieldId = "";
  if (smartDocumentPreviewObjectUrl) URL.revokeObjectURL(smartDocumentPreviewObjectUrl);
  smartDocumentPreviewObjectUrl = "";
}

function openZohoSignDialog(record) {
  if (!record || !supportsZohoSmartDocument(record)) {
    showToast("Zoho Sign supports common PDF, image, document, and spreadsheet files up to 25 MB.");
    return;
  }
  if (!els.zohoSignDialog || !els.zohoSignForm) return;
  const { lead } = findManagedDocument(record.id);
  const form = els.zohoSignForm;
  form.reset();
  form.elements.documentId.value = record.id;
  form.elements.recipientName.value = lead?.name || "";
  form.elements.recipientEmail.value = record.zohoSign?.recipientEmail || lead?.email || "";
  form.elements.expirationDays.value = "10";
  form.elements.notes.value = "Please review and sign this document.";
  if (els.zohoSignDocumentName) els.zohoSignDocumentName.textContent = `${record.name} · ${formatBytes(record.size)}`;
  if (els.prepareZohoSignButton) els.prepareZohoSignButton.textContent = record.zohoSign?.requestId ? "Continue in Zoho Sign" : "Create Smart Document";
  setSaveState(els.zohoSignSaveStatus, "", "");
  els.zohoSignDialog.showModal();
}

async function prepareZohoSmartDocument(event) {
  event.preventDefault();
  if (!requireAction("manageDocuments")) return;
  const formData = new FormData(els.zohoSignForm);
  const documentId = String(formData.get("documentId") || "");
  const { record } = findManagedDocument(documentId);
  if (!record) return showToast("That CRM document could not be found.");
  if (!canUseCloudSync() || !record.storagePath) {
    setSaveState(els.zohoSignSaveStatus, "Finish saving this file to shared storage before preparing it in Zoho Sign.", "error");
    return;
  }
  const editorWindow = window.open("about:blank", "_blank");
  if (editorWindow) editorWindow.opener = null;
  if (els.prepareZohoSignButton) els.prepareZohoSignButton.disabled = true;
  setSaveState(els.zohoSignSaveStatus, record.zohoSign?.requestId ? "Opening the saved Zoho Sign draft…" : "Creating a secure Zoho Sign draft…", "saving");
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/zoho/sign/request", {
      method: "POST", headers, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        documentId, recipientName: String(formData.get("recipientName") || "").trim(),
        recipientEmail: String(formData.get("recipientEmail") || "").trim(),
        expirationDays: number(formData.get("expirationDays")), notes: String(formData.get("notes") || "").trim(),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.prepared !== true || !/^https:\/\/(?:sign\.zoho\.(?:com|eu|in|jp|com\.au|sa|uk|sg|ae)|sign\.zohocloud\.ca)\/embedsend\?/.test(result.sendUrl || "")) {
      throw new Error(result?.error || "Zoho Sign could not prepare this document.");
    }
    await reloadDurableRecords({ showUpdateToast: false });
    render();
    els.zohoSignDialog.close();
    if (editorWindow) editorWindow.location.replace(result.sendUrl);
    else window.open(result.sendUrl, "_blank", "noopener");
    showToast(result.created ? "Smart Document created. Add fields in Zoho Sign before sending." : "Zoho Sign draft reopened.");
  } catch (error) {
    editorWindow?.close();
    setSaveState(els.zohoSignSaveStatus, error.message || "Zoho Sign could not prepare this document.", "error");
  } finally {
    if (els.prepareZohoSignButton) els.prepareZohoSignButton.disabled = false;
  }
}

async function uploadCompanyLogo(file) {
  if (!requireAction("manageCompany")) return;
  if (!file) return;
  if (!String(file.type || "").startsWith("image/")) {
    showToast("Choose an image file for the company logo");
    return;
  }
  let logoDataUrl = await readFileAsDataUrl(file);
  try {
    logoDataUrl = await rasterizeLogoDataUrl(logoDataUrl);
  } catch {
    // Keep the original image for the CRM if the browser cannot rasterize it.
  }
  state.company = normalizeCompany({
    ...state.company,
    logoDataUrl,
    logoAssetVersion: "custom",
  });
  saveState();
  renderBrandLogo();
  renderCompanyForm();
  renderEstimatePreview(getSelectedEstimate());
  showToast("Company logo updated");
}

function removeCompanyLogo() {
  if (!requireAction("manageCompany")) return;
  state.company = normalizeCompany({
    ...state.company,
    logoDataUrl: "",
    logoAssetVersion: "",
  });
  saveState();
  renderBrandLogo();
  renderCompanyForm();
  renderEstimatePreview(getSelectedEstimate());
  showToast("Company logo removed");
}

let calendarMonthOffset = 0;
let calendarAnchorDate = new Date();
let calendarViewMode = window.matchMedia?.("(max-width: 760px)").matches ? "schedule" : "week";
let calendarVisibleReps = new Set();
let calendarVisibilityOwnerId = "";
const CALENDAR_START_HOUR = 6;
const CALENDAR_END_HOUR = 21;
const CALENDAR_SLOT_HEIGHT = 56;

function calendarStartOfDay(value) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function calendarStartOfWeek(value) {
  const date = calendarStartOfDay(value);
  date.setDate(date.getDate() - date.getDay());
  return date;
}

function calendarAddDays(value, amount) {
  const date = new Date(value);
  date.setDate(date.getDate() + amount);
  return date;
}

function calendarRepKey(task) {
  const signedIn = currentOwner();
  const taskOwnerEmail = String(task.ownerEmail || "").trim().toLowerCase();
  if ((task.ownerUserId && task.ownerUserId === signedIn.userId) ||
      (taskOwnerEmail && taskOwnerEmail === String(signedIn.email || "").trim().toLowerCase())) {
    return signedInCalendarKey();
  }
  return String(task.ownerEmail || task.rep || task.ownerName || "Unassigned").trim().toLowerCase() || "unassigned";
}

function calendarRepLabel(task) {
  return canonicalRepresentativeName(task.ownerName || task.rep || task.ownerEmail || "Unassigned", task) || "Unassigned";
}

function calendarRepColor(key) {
  const colors = ["#1a73e8", "#0f9d58", "#a142f4", "#f29900", "#d93025", "#00796b", "#c2185b", "#5f6368"];
  let hash = 0;
  for (const character of String(key)) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function signedInCalendarKey() {
  const owner = currentOwner();
  return String(owner.email || owner.name || "").trim().toLowerCase();
}

function initializeCalendarVisibility() {
  const owner = currentOwner();
  const ownerIdentity = owner.userId || signedInCalendarKey();
  if (!ownerIdentity || calendarVisibilityOwnerId === ownerIdentity) return;
  calendarVisibilityOwnerId = ownerIdentity;
  calendarVisibleReps = new Set([signedInCalendarKey()].filter(Boolean));
}

function calendarTaskType(task) {
  const contact = getContact(task.contactId);
  const job = contact ? contactJobs(contact).find((item) => item.id === task.jobId) : null;
  const source = `${task.title || ""} ${task.notes || ""} ${job?.status || ""}`.toLowerCase();
  if (/inspect|site visit|walk.?through|measure/.test(source)) return "inspection";
  if (/estimate|proposal|quote|follow.?up/.test(source)) return "estimate";
  if (/payment|deposit|invoice|collect|paid/.test(source)) return "payment";
  if (/material|schedule|production|install|crew|progress|complete/.test(source)) return "production";
  return "general";
}

function calendarFilteredTasks() {
  initializeCalendarVisibility();
  const tasks = visibleCalendarTasks();
  return tasks.filter((task) => calendarVisibleReps.has(calendarRepKey(task)));
}

function calendarEventMarkup(task, options = {}) {
  const due = new Date(task.dueAt);
  const type = calendarTaskType(task);
  const color = calendarRepColor(calendarRepKey(task));
  const time = due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const sync = task.googleSyncStatus === "synced" ? "Google synced" : task.googleSyncStatus === "error" ? "Sync failed" : task.googleSyncStatus === "pending" ? "Syncing" : "CRM only";
  return `<button class="calendar-event type-${type}${task.completed ? " is-complete" : ""}" type="button" draggable="${options.draggable === false ? "false" : "true"}" data-calendar-task-id="${escapeHtml(task.id)}" style="--rep-color:${color}" aria-label="${escapeHtml(`${time} ${task.title}, ${calendarRepLabel(task)}, ${sync}`)}">
    <span class="calendar-event-time">${escapeHtml(time)}</span>
    <strong>${escapeHtml(task.title)}</strong>
    ${options.compact ? "" : `<span>${escapeHtml(calendarRepLabel(task))}</span><small>${escapeHtml(sync)}</small>`}
    ${options.resizable === false ? "" : '<i class="calendar-resize-handle" data-calendar-resize aria-hidden="true"></i>'}
  </button>`;
}

function renderCalendarRepFilters(tasks) {
  if (!els.calendarRepFilters) return;
  initializeCalendarVisibility();
  const reps = new Map();
  tasks.forEach((task) => reps.set(calendarRepKey(task), calendarRepLabel(task)));
  const owner = currentOwner();
  const signedInKey = signedInCalendarKey();
  if (signedInKey) reps.set(signedInKey, `${canonicalRepresentativeName(owner.name, owner) || "My calendar"} (me)`);
  els.calendarRepFilters.innerHTML = [...reps.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([key, label]) => `
    <label class="calendar-rep-filter">
      <input type="checkbox" data-calendar-rep="${escapeHtml(key)}" ${calendarVisibleReps.has(key) ? "checked" : ""} />
      <i style="--rep-color:${calendarRepColor(key)}"></i>
      <span>${escapeHtml(label)}</span>
    </label>`).join("");
}

function calendarRangeLabel() {
  if (calendarViewMode === "day") return calendarAnchorDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  if (calendarViewMode === "month") return calendarAnchorDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  if (calendarViewMode === "schedule") return "Upcoming schedule";
  const start = calendarStartOfWeek(calendarAnchorDate);
  const end = calendarAddDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  return sameMonth
    ? `${start.toLocaleDateString("en-US", { month: "long", day: "numeric" })} – ${end.getDate()}, ${end.getFullYear()}`
    : `${start.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;
}

function renderCalendarMonth() {
  if (!els.calMonthGrid) return;
  const year = calendarAnchorDate.getFullYear();
  const month = calendarAnchorDate.getMonth();
  const first = new Date(year, month, 1);
  const gridStart = calendarAddDays(first, -first.getDay());
  const tasks = calendarFilteredTasks();
  const tasksByDay = new Map();
  tasks.forEach((task) => {
    const key = localDateISO(new Date(task.dueAt));
    tasksByDay.set(key, [...(tasksByDay.get(key) || []), task]);
  });
  const labels = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  let html = `<div class="calendar-month-head">${labels.map((label) => `<span>${label}</span>`).join("")}</div><div class="calendar-month-grid">`;
  for (let index = 0; index < 42; index++) {
    const date = calendarAddDays(gridStart, index);
    const key = localDateISO(date);
    const dayTasks = (tasksByDay.get(key) || []).sort((a, b) => taskDueTime(a) - taskDueTime(b));
    const outside = date.getMonth() !== month;
    const today = key === localDateISO(new Date());
    html += `<div class="calendar-month-day calendar-drop-target${outside ? " is-outside" : ""}${today ? " is-today" : ""}" data-date="${key}">
      <button type="button" class="calendar-month-date" data-calendar-new-date="${key}">${date.getDate()}</button>
      <div class="calendar-month-events">${dayTasks.slice(0, 3).map((task) => calendarEventMarkup(task, { compact: true, resizable: false })).join("")}</div>
      ${dayTasks.length > 3 ? `<button class="calendar-more-events" type="button" data-calendar-day="${key}">+${dayTasks.length - 3} more</button>` : ""}
    </div>`;
  }
  els.calMonthGrid.innerHTML = `${html}</div>`;
}

function renderCalendarTimeGrid(dayCount) {
  const start = dayCount === 1 ? calendarStartOfDay(calendarAnchorDate) : calendarStartOfWeek(calendarAnchorDate);
  const tasks = calendarFilteredTasks();
  const hours = Array.from({ length: CALENDAR_END_HOUR - CALENDAR_START_HOUR }, (_, index) => CALENDAR_START_HOUR + index);
  let html = `<div class="calendar-time-view" style="--calendar-days:${dayCount};--hour-height:${CALENDAR_SLOT_HEIGHT}px">
    <div class="calendar-time-head-spacer"></div><div class="calendar-time-heads">`;
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const date = calendarAddDays(start, dayIndex);
    const today = localDateISO(date) === localDateISO(new Date());
    html += `<button type="button" class="calendar-time-head${today ? " is-today" : ""}" data-calendar-new-date="${localDateISO(date)}"><span>${date.toLocaleDateString("en-US", { weekday: "short" })}</span><strong>${date.getDate()}</strong></button>`;
  }
  html += `</div><div class="calendar-time-axis">${hours.map((hour) => `<span>${new Date(2000, 0, 1, hour).toLocaleTimeString("en-US", { hour: "numeric" })}</span>`).join("")}</div><div class="calendar-time-columns">`;
  for (let dayIndex = 0; dayIndex < dayCount; dayIndex++) {
    const date = calendarAddDays(start, dayIndex);
    const dateKey = localDateISO(date);
    const dayTasks = tasks.filter((task) => localDateISO(new Date(task.dueAt)) === dateKey);
    html += `<div class="calendar-time-day calendar-drop-target" data-date="${dateKey}" data-calendar-start-hour="${CALENDAR_START_HOUR}">
      <div class="calendar-hour-lines">${hours.map(() => "<i></i>").join("")}</div>
      ${dayTasks.map((task) => {
        const due = new Date(task.dueAt);
        const minutes = due.getHours() * 60 + due.getMinutes();
        const startMinutes = CALENDAR_START_HOUR * 60;
        const totalMinutes = (CALENDAR_END_HOUR - CALENDAR_START_HOUR) * 60;
        const top = Math.max(0, Math.min(totalMinutes - 15, minutes - startMinutes)) / 60 * CALENDAR_SLOT_HEIGHT;
        const height = Math.max(26, Math.min(180, (number(task.duration) || 30) / 60 * CALENDAR_SLOT_HEIGHT));
        return `<div class="calendar-positioned-event" style="top:${top}px;height:${height}px">${calendarEventMarkup(task)}</div>`;
      }).join("")}
    </div>`;
  }
  els.calMonthGrid.innerHTML = `${html}</div></div>`;
}

function renderCalendarSchedule() {
  const start = calendarStartOfDay(calendarAnchorDate);
  const tasks = calendarFilteredTasks()
    .filter((task) => !task.completed || new Date(task.dueAt) >= start)
    .sort((a, b) => taskDueTime(a) - taskDueTime(b));
  const groups = new Map();
  tasks.forEach((task) => {
    const key = localDateISO(new Date(task.dueAt));
    groups.set(key, [...(groups.get(key) || []), task]);
  });
  els.calMonthGrid.innerHTML = groups.size ? `<div class="calendar-agenda">${[...groups.entries()].map(([key, dayTasks]) => {
    const date = new Date(`${key}T12:00:00`);
    return `<section class="calendar-agenda-day"><header><strong>${date.toLocaleDateString("en-US", { weekday: "long" })}</strong><span>${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span></header><div>${dayTasks.map((task) => calendarEventMarkup(task, { resizable: false })).join("")}</div></section>`;
  }).join("")}</div>` : '<div class="empty-state calendar-empty-state">No upcoming tasks for the selected representatives.</div>';
}

function renderCalendarCanvas() {
  if (!els.calMonthGrid) return;
  els.calMonthTitle.textContent = calendarRangeLabel();
  if (els.calendarDatePicker) els.calendarDatePicker.value = localDateISO(calendarAnchorDate);
  els.calendarViewSwitcher?.querySelectorAll("[data-calendar-view]").forEach((button) => {
    const active = button.dataset.calendarView === calendarViewMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  els.calendarTasksList?.classList.add("hidden");
  els.calDayDetail?.classList.add("hidden");
  if (calendarViewMode === "month") renderCalendarMonth();
  else if (calendarViewMode === "schedule") renderCalendarSchedule();
  else renderCalendarTimeGrid(calendarViewMode === "day" ? 1 : 7);
  hydrateIcons(els.calMonthGrid);
  renderCalendarJobDates();
}

// Dates entered on a job's Operations tab: inspections, permit expirations and
// billing draws. They were recorded on the job but never appeared anywhere a
// person looks for "what is coming up", so they are listed under the calendar.
function calendarJobDates(now = new Date()) {
  const from = new Date(now); from.setDate(from.getDate() - 14); from.setHours(0, 0, 0, 0);
  const to = new Date(now); to.setDate(to.getDate() + 60); to.setHours(23, 59, 59, 999);
  const items = [];
  const add = (row, at, kind, title) => {
    const stamp = localTimestamp(at);
    if (!Number.isFinite(stamp) || stamp < from.getTime() || stamp > to.getTime()) return;
    const contactId = row.contactId || row.leadId || row.lead_id || "";
    const jobId = row.jobId || row.job_id || "";
    const contact = getContact(contactId);
    if (!contact || contact.archived) return;
    const job = contactJobs(contact).find((item) => item.id === jobId);
    items.push({ at, stamp, kind, title, contact, job, overdue: stamp < now.getTime() });
  };
  (state.inspections || []).forEach((row) => {
    if (["passed", "failed", "cancelled"].includes(String(row.result || ""))) return;
    add(row, operationValue(row, "scheduledAt", "scheduled_at"), "Inspection", operationValue(row, "inspectionType", "inspection_type") || "Inspection");
  });
  (state.permits || []).forEach((row) => {
    if (["closed", "expired", "void"].includes(String(row.status || ""))) return;
    add(row, operationValue(row, "expiresOn", "expires_on"), "Permit expires", `${operationValue(row, "permitType", "permit_type") || "Permit"}${operationValue(row, "permitNumber", "permit_number") ? ` #${operationValue(row, "permitNumber", "permit_number")}` : ""}`);
  });
  (state.progressBillings || []).forEach((row) => {
    if (["paid", "void"].includes(String(row.status || ""))) return;
    add(row, operationValue(row, "dueOn", "due_on"), "Billing draw due", `${row.name || "Draw"} · ${money.format(number(row.amount))}`);
  });
  return items.sort((a, b) => a.stamp - b.stamp);
}

function renderCalendarJobDates() {
  const host = els.calMonthGrid?.parentElement;
  if (!host || typeof document.createElement !== "function") return;
  let section = document.getElementById("calendarJobDates");
  const items = calendarJobDates();
  if (!items.length) { section?.remove(); return; }
  if (!section) {
    section = document.createElement("section");
    section.id = "calendarJobDates";
    section.className = "calendar-job-dates";
    host.append(section);
  }
  section.innerHTML = `
    <div class="calendar-job-dates-heading"><p class="eyebrow">From job Operations</p><h3>Inspections, permit expirations and billing draws</h3><span>Next 60 days</span></div>
    <div class="calendar-job-dates-list">${items.map((item) => `
      <button class="calendar-job-date ${item.overdue ? "is-overdue" : ""}" type="button" data-action="open-contact-tab" data-contact-id="${escapeHtml(item.contact.id)}" data-job-id="${escapeHtml(item.job?.id || "")}" data-tab="operations">
        <time>${escapeHtml(/^\d{4}-\d{2}-\d{2}$/.test(String(item.at)) ? formatDate(item.at) : formatDateTime(item.at))}</time>
        <span><strong>${escapeHtml(item.kind)}${item.overdue ? " · past due" : ""}</strong><small>${escapeHtml(item.title)}</small></span>
        <span><small>${escapeHtml(item.contact.name)}</small><small>${escapeHtml(item.job?.name || "")}</small></span>
      </button>`).join("")}</div>`;
}

