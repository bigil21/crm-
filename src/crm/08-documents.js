function renderLeadDocuments(contact) {
  if (canUseCloudSync() && !googleDriveState.loaded && !googleDriveState.loading) void refreshGoogleDriveStatus().then(() => renderLeadDocuments(getSelectedContact() || contact));
  const selectedJob = selectedLeadJob(contact);
  const configuredCategories = state.company.documentCategories || [];
  const visibleCategories = configuredCategories.filter(
    (category) =>
      category.active ||
      contact.documents.some(
        (document) =>
          document.kind !== "photo" && document.jobId === selectedJob?.id && document.categoryId === category.id,
      ),
  );
  const activeCategories = configuredCategories.filter((category) => category.active);
  const selectedCategoryId = activeCategories.some((category) => category.id === els.leadDocumentCategory?.value)
    ? els.leadDocumentCategory.value
    : activeCategories[0]?.id || "";

  if (els.leadDocumentJobSelect) {
    els.leadDocumentJobSelect.innerHTML = jobContextOptions(contact, selectedJob?.id);
    els.leadDocumentJobSelect.disabled = !selectedJob;
  }
  if (els.leadDocumentHeading) {
    els.leadDocumentHeading.textContent = selectedJob ? `${selectedJob.name} Documents` : "Files for this job";
  }
  if (els.leadDocumentCategory) {
    els.leadDocumentCategory.innerHTML = activeCategories
      .map(
        (category) =>
          `<option value="${escapeHtml(category.id)}" ${category.id === selectedCategoryId ? "selected" : ""}>${escapeHtml(category.name)}</option>`,
      )
      .join("");
    els.leadDocumentCategory.disabled = !activeCategories.length;
  }
  if (els.uploadLeadDocumentButton) {
    els.uploadLeadDocumentButton.disabled = !selectedJob || !activeCategories.length || !canAction("manageDocuments");
  }
  const templates = Array.isArray(googleIntegrationState.docTemplates) ? googleIntegrationState.docTemplates : [];
  els.googleDocTemplateControl?.classList.toggle("hidden", !selectedJob || !templates.length);
  els.generateGoogleDocButton?.classList.toggle("hidden", !selectedJob || !templates.length);
  if (els.googleDocTemplateSelect) {
    const selectedTemplate = templates.some((item) => item.key === els.googleDocTemplateSelect.value)
      ? els.googleDocTemplateSelect.value : templates[0]?.key || "";
    els.googleDocTemplateSelect.innerHTML = templates
      .map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === selectedTemplate ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
      .join("");
  }
  if (els.generateGoogleDocButton) {
    els.generateGoogleDocButton.disabled = !selectedJob || !templates.length || !canAction("manageDocuments");
  }

  els.leadDocumentsList.innerHTML = visibleCategories.length
    ? visibleCategories
        .map((category) => {
          const documents = contact.documents
            .filter(
              (document) =>
                document.kind !== "photo" &&
                document.jobId === selectedJob?.id &&
                document.categoryId === category.id,
            )
            .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
          const displayKey = `${contact.id}:${selectedJob?.id || "none"}:${category.id}`;
          const displayLimit = leadDocumentDisplayLimits.get(displayKey) || DOCUMENT_PAGE_SIZE;
          const visibleDocuments = documents.slice(0, displayLimit);
          return `
            <section class="document-folder ${category.active ? "" : "is-inactive"}" style="--category-color:${escapeHtml(category.color)}">
              <div class="document-folder-header">
                <div class="document-folder-title">
                  <span class="document-folder-icon" aria-hidden="true" data-icon="${escapeHtml(category.icon)}"></span>
                  <div>
                    <h3>${escapeHtml(category.name)}</h3>
                    <span>${documents.length} document${documents.length === 1 ? "" : "s"}${category.active ? "" : " · Inactive"}</span>
                  </div>
                </div>
                ${
                  category.active
                    ? `<button class="mini-button" type="button" title="Upload to ${escapeHtml(category.name)}" data-action="upload-to-category" data-category-id="${escapeHtml(category.id)}"><span aria-hidden="true" data-icon="upload"></span></button>`
                    : ""
                }
              </div>
              <div class="document-folder-files">
                ${
                  documents.length
                    ? visibleDocuments
                        .map(
                          (document) => `
                            <article class="document-card">
                              <div>
                                <strong>${escapeHtml(document.name)}</strong>
                                <span>${escapeHtml(formatBytes(document.size))} · ${escapeHtml(document.type)} · Version ${escapeHtml(document.versionNumber)} · ${escapeHtml(formatDateTime(document.uploadedAt))}</span>
                                <span>Uploaded by ${escapeHtml(document.uploadedBy)}</span>
                                ${document.smartDocument ? `<span class="smart-document-meta">Smart Document · ${escapeHtml(document.smartDocument.status)}${document.smartDocument.lastEmailedTo ? ` · Emailed to ${escapeHtml(document.smartDocument.lastEmailedTo)}` : ""}</span>` : ""}
                                ${document.zohoSign?.requestId ? `<span class="zoho-smart-meta">Zoho Sign ${escapeHtml(document.zohoSign.status || "draft")} · ${escapeHtml(document.zohoSign.recipientEmail || "recipient pending")}</span>` : ""}
                                ${document.googleDrive?.fileId ? `<span class="zoho-smart-meta">Company Drive copy · Version ${escapeHtml(document.googleDrive.versionNumber)}</span>` : ""}
                              </div>
                              <div class="row-actions">
                                <button class="secondary-button" type="button" data-action="download-document" data-document-id="${escapeHtml(document.id)}"><span aria-hidden="true" data-icon="download"></span>Download</button>
                                <button class="secondary-button" type="button" data-action="document-operations" data-document-id="${escapeHtml(document.id)}"><span aria-hidden="true" data-icon="message"></span>Details</button>
                                ${nativeSmartDocumentButton(document)}
                                ${zohoSmartDocumentButton(document)}
                                ${googleDriveDocumentButton(document)}
                                <button class="mini-button" type="button" title="Rename document" aria-label="Rename ${escapeHtml(document.name)}" data-action="rename-document" data-document-id="${escapeHtml(document.id)}"><span aria-hidden="true" data-icon="edit"></span></button>
                                <button class="mini-button" type="button" title="Remove document" aria-label="Remove ${escapeHtml(document.name)}" data-action="remove-document" data-document-id="${escapeHtml(document.id)}"><span aria-hidden="true" data-icon="trash"></span></button>
                              </div>
                            </article>`,
                        )
                        .join("") + (documents.length > visibleDocuments.length
                          ? `<button class="secondary-button" type="button" data-action="show-more-lead-documents" data-display-key="${escapeHtml(displayKey)}">Show ${Math.min(DOCUMENT_PAGE_SIZE, documents.length - visibleDocuments.length)} more documents</button>`
                          : "")
                    : !durableRecordsReady && canUseCloudSync()
                      // The shared copy is still loading; "No documents" here made
                      // people think files were lost and upload them again.
                      ? '<div class="document-folder-empty">Loading documents…</div>'
                      : '<div class="document-folder-empty">No documents in this category</div>'
                }
              </div>
            </section>`;
        })
        .join("")
    : selectedJob
      ? '<div class="empty-state">No active document categories. An administrator can add one in CRM Settings.</div>'
      : '<div class="empty-state">Add or select a job before managing documents.</div>';
  hydrateIcons(els.leadDocumentsList);
  renderLeadUploads();
}

function photosForJob(contact, jobId) {
  return (contact?.documents || [])
    .filter((document) => document.kind === "photo" && document.jobId === jobId)
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

// The address of the picture shown in a photo's card: its small copy when it
// has one, the original when it does not (photos from before small copies, or
// kinds this browser could not draw) or when `original` is asked for.
async function managedPhotoPreviewUrl(photo, { original = false } = {}) {
  if (photo.dataUrl) return photo.dataUrl;
  if (!cloudClient?.storage) return "";
  const signed = async (path, cacheKey) => {
    const cached = photoPreviewCache.get(cacheKey);
    if (cached?.url && cached.expiresAt > Date.now()) return cached.url;
    const { data, error } = await cloudClient.storage
      .from(SUPABASE_DOCUMENT_BUCKET)
      .createSignedUrl(path, 300);
    if (error) throw error;
    const url = data?.signedUrl || "";
    if (url) photoPreviewCache.set(cacheKey, { url, expiresAt: Date.now() + 240000 });
    return url;
  };
  if (!original && photo.previewPath && !unreadablePhotoPreviews.has(photo.id)) {
    try {
      const url = await signed(photo.previewPath, `${photo.id}:preview`);
      if (url) return url;
    } catch {
      // This user may not read the small copy, or it is gone. The original is
      // shown instead, and the small copy is not asked for again in this tab.
    }
    unreadablePhotoPreviews.add(photo.id);
  }
  return photo.storagePath ? signed(photo.storagePath, photo.id) : "";
}

// Shows one photo's thumbnail in its card. The <img> stays hidden until it has
// loaded, so it must load eagerly: a hidden image marked loading="lazy" never
// starts loading at all, which is why no thumbnail ever appeared.
async function showLeadPhotoPreview(image, photo, stillCurrent = () => true) {
  if (!image || !photo || image.dataset.previewRequested === "true") return false;
  image.dataset.previewRequested = "true";
  try {
    const url = await managedPhotoPreviewUrl(photo);
    if (!url || !stillCurrent() || image.isConnected === false) return false;
    const placeholder = image.closest(".job-photo-preview")?.querySelector("[data-photo-placeholder]");
    image.addEventListener("load", () => {
      image.classList.remove("hidden");
      placeholder?.classList.add("hidden");
    }, { once: true });
    image.addEventListener("error", () => {
      // The small copy is missing or unreadable: show the original instead.
      if (photo.previewPath && image.dataset.previewFallback !== "true") {
        image.dataset.previewFallback = "true";
        managedPhotoPreviewUrl(photo, { original: true }).then((fallback) => {
          if (!fallback || !stillCurrent() || image.isConnected === false) return;
          image.addEventListener("error", () => { image.classList.add("hidden"); placeholder?.classList.remove("hidden"); }, { once: true });
          image.src = fallback;
        }).catch(() => {});
        return;
      }
      image.classList.add("hidden");
      placeholder?.classList.remove("hidden");
    }, { once: true });
    image.loading = "eager";
    image.src = url;
    return true;
  } catch (error) {
    console.warn(`Photo ${photo.id} preview could not be loaded`, error);
    return false;
  }
}

// Thumbnails are requested as their cards come into view, not all at once.
let photoPreviewObserver = null;
async function hydrateLeadPhotoPreviews(contactId, jobId, displayLimit = PHOTO_PAGE_SIZE) {
  const contact = getContact(contactId);
  if (!contact || state.selectedContactId !== contactId || state.selectedLeadJobId !== jobId) return;
  const photos = new Map(photosForJob(contact, jobId).slice(0, displayLimit).map((photo) => [photo.id, photo]));
  const stillCurrent = () => state.selectedContactId === contactId && state.selectedLeadJobId === jobId;
  const images = [...document.querySelectorAll("[data-photo-preview]")].filter((image) => photos.has(image.dataset.photoPreview));
  photoPreviewObserver?.disconnect();
  if (typeof IntersectionObserver !== "function") {
    for (let offset = 0; offset < images.length; offset += 6) {
      await Promise.all(images.slice(offset, offset + 6).map((image) => showLeadPhotoPreview(image, photos.get(image.dataset.photoPreview), stillCurrent)));
    }
    return;
  }
  photoPreviewObserver = new IntersectionObserver((entries, observer) => {
    entries.filter((entry) => entry.isIntersecting).forEach((entry) => {
      observer.unobserve(entry.target);
      const image = entry.target.querySelector("[data-photo-preview]");
      if (image) void showLeadPhotoPreview(image, photos.get(image.dataset.photoPreview), stillCurrent);
    });
  }, { rootMargin: "300px 0px" });
  images.forEach((image) => {
    const card = image.closest(".job-photo-preview");
    if (card) photoPreviewObserver.observe(card);
  });
}

function renderLeadPhotos(contact) {
  if (canUseCloudSync() && !googleDriveState.loaded && !googleDriveState.loading) void refreshGoogleDriveStatus().then(() => renderLeadPhotos(getSelectedContact() || contact));
  if (!els.leadPhotosGrid || !els.leadPhotoJobSelect) return;
  const jobs = contactJobs(contact);
  if (!jobs.some((job) => job.id === state.selectedLeadJobId)) {
    state.selectedLeadJobId = jobs[0]?.id || "";
  }
  const selectedJob = jobs.find((job) => job.id === state.selectedLeadJobId) || jobs[0];
  const photos = selectedJob ? photosForJob(contact, selectedJob.id) : [];
  const displayLimit = selectedJob ? (photoDisplayLimits.get(selectedJob.id) || PHOTO_PAGE_SIZE) : PHOTO_PAGE_SIZE;
  const visiblePhotos = photos.slice(0, displayLimit);

  els.leadPhotoJobSelect.innerHTML = jobs
    .map(
      (job) =>
        `<option value="${escapeHtml(job.id)}" ${job.id === selectedJob?.id ? "selected" : ""}>${escapeHtml(job.name)} - ${escapeHtml(
          (job.address || "No address saved").split("\n")[0],
        )}</option>`,
    )
    .join("");
  els.leadPhotoJobSelect.disabled = !selectedJob;
  els.uploadLeadPhotoButton.disabled = !selectedJob || !canAction("manageDocuments");
  els.leadPhotoHeading.textContent = selectedJob ? `${selectedJob.name} Photos` : "Photos for this job";

  els.leadPhotosGrid.innerHTML = selectedJob
    ? photos.length
      ? visiblePhotos
          .map(
            (photo) => `
              <article class="job-photo-card">
                <button class="job-photo-preview" type="button" data-action="download-document" data-document-id="${escapeHtml(photo.id)}" aria-label="Open ${escapeHtml(photo.name)}">
                  <img class="hidden" data-photo-preview="${escapeHtml(photo.id)}" alt="${escapeHtml(photo.name)}" decoding="async" />
                  <span class="job-photo-placeholder" data-photo-placeholder>
                    <span aria-hidden="true" data-icon="image"></span>
                    <strong>Open photo</strong>
                  </span>
                </button>
                <div class="job-photo-details">
                  <div>
                    <strong>${escapeHtml(photo.name)}</strong>
                    <span>${escapeHtml(formatBytes(photo.size))} · ${escapeHtml(formatDateTime(photo.uploadedAt))}</span>
                    <span>Uploaded by ${escapeHtml(photo.uploadedBy)}</span>
                    ${photo.googleDrive?.fileId ? `<span class="zoho-smart-meta">Company Drive copy · Version ${escapeHtml(photo.googleDrive.versionNumber)}</span>` : ""}
                  </div>
                  <div class="row-actions">
                    ${googleDriveDocumentButton(photo)}
                    <button class="mini-button" type="button" title="Rename photo" aria-label="Rename ${escapeHtml(photo.name)}" data-action="rename-document" data-document-id="${escapeHtml(photo.id)}"><span aria-hidden="true" data-icon="edit"></span></button>
                    <button class="mini-button" type="button" title="Remove photo" aria-label="Remove ${escapeHtml(photo.name)}" data-action="remove-document" data-document-id="${escapeHtml(photo.id)}"><span aria-hidden="true" data-icon="trash"></span></button>
                  </div>
                </div>
              </article>`,
          )
          .join("") + (photos.length > visiblePhotos.length
            ? `<button class="secondary-button" type="button" data-action="show-more-job-photos" data-job-id="${escapeHtml(selectedJob.id)}">Show ${Math.min(PHOTO_PAGE_SIZE, photos.length - visiblePhotos.length)} more photos</button>`
            : "")
      : `<div class="job-photo-empty"><span aria-hidden="true" data-icon="image"></span><strong>No photos for ${escapeHtml(
          selectedJob.name,
        )} yet</strong><span>Upload inspection, damage, progress, and completion photos here.</span></div>`
    : '<div class="empty-state">Add a job before uploading photos.</div>';
  hydrateIcons(els.leadPhotosGrid);
  if (selectedJob) void hydrateLeadPhotoPreviews(contact.id, selectedJob.id, displayLimit);
  renderLeadUploads();
}

function renderLeadConversation(contact) {
  const job = selectedLeadJob(contact);
  const primary = primaryJob(contact);
  const updates = (contact.updates || []).filter((update) =>
    update.jobId ? update.jobId === job?.id : primary?.id === job?.id,
  );
  els.leadConversationList.innerHTML = updates.length
    ? updates
        .map(
          (update) => `
        <article class="conversation-item">
          <div class="conversation-meta">
            <strong>${escapeHtml(actorDisplayName(update.author) || "CRM user")}</strong>
            <span>${escapeHtml(formatDateTime(update.createdAt))}</span>
          </div>
          ${update.status ? `<span class="status-pill">${escapeHtml(update.status)}</span>` : ""}
          <p>${nl2br(update.message || "Status update")}</p>
        </article>
      `,
        )
        .join("")
    : '<div class="empty-state">No updates yet. Post the first note for this job.</div>';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// When a job is sold, its contract value should be what the customer accepted.
// The job often still carries the rough figure typed when the lead came in and
// the accepted estimate stayed "Sent", so the balance due was worked out from
// the wrong number. Ask rather than guess when the two figures differ.
async function reconcileSoldJobWithEstimate(contactId, jobId) {
  const contact = getContact(contactId);
  const job = contact && contactJobs(contact).find((item) => item.id === jobId);
  if (!contact || !job || !canAction("manageJobs")) return false;
  const candidates = state.estimates.filter((estimate) => estimate.contactId === contactId
    && (estimate.jobId === jobId || (!estimate.jobId && primaryJob(contact)?.id === jobId))
    && ["Sent", "Won", "Approved"].includes(estimate.status));
  const accepted = candidates.filter((estimate) => estimate.status !== "Sent");
  const estimate = accepted.length === 1 ? accepted[0] : candidates.length === 1 ? candidates[0] : null;
  if (!estimate) {
    if (candidates.length > 1) showToast(`${job.name} has ${candidates.length} sent estimates. Mark the accepted one as Won on the Estimates page so the contract value follows it.`);
    return false;
  }
  const total = Math.round(totalsFor(estimate).total * 100) / 100;
  const contractValue = number(job.contractValue) || number(job.value);
  let useEstimateTotal = false;
  if (total > 0 && Math.abs(total - contractValue) >= 0.01) {
    useEstimateTotal = await appConfirm(
      `${estimate.estimateNumber} totals ${money.format(total)}, but ${job.name} has a contract value of ${money.format(contractValue)}. Which is the agreed contract value?`,
      { title: "Contract value", confirmLabel: `Use ${money.format(total)}`, cancelLabel: `Keep ${money.format(contractValue)}` },
    );
  }
  const markWon = estimate.status === "Sent" && canAction("manageEstimates");
  if (!useEstimateTotal && !markWon) return false;
  if (markWon) {
    estimate.status = "Won";
    queueEstimateVerifiedSave(estimate.id, { immediate: true });
  }
  if (useEstimateTotal) {
    const updateId = uid("update");
    updateContact(contactId, (current) => {
      const jobs = contactJobs(current).map((item) => item.id === jobId ? { ...item, value: total, contractValue: total } : item);
      return {
        ...current,
        ...summarizeContactJobs(current, jobs),
        updates: [{ id: updateId, author: currentActorName(), jobId, message: `Contract value set to ${money.format(total)} from ${estimate.estimateNumber}.`, createdAt: new Date().toISOString() }, ...(current.updates || [])],
      };
    });
    saveState({ localOnly: true });
    let saved = !canUseCloudSync();
    try { if (canUseCloudSync()) saved = await persistLeadJobRecord(jobId, updateId); } catch (error) { console.warn("Contract value could not be confirmed", error); }
    if (!saved) queueDurableRecordsSave();
    showToast(`Contract value updated to ${money.format(total)}.`);
  }
  if (state.view === "leadDetail") renderLeadDetail();
  return true;
}

// Why a job was lost, kept on the job so lost work can be reported by reason.
const lostReasonOptions = ["Price", "Chose another contractor", "Insurance claim denied", "Financing", "Timing", "No response", "Not a fit", "Duplicate or test"];
async function recordLostReason(contactId, jobId) {
  const job = contactJobs(getContact(contactId) || {}).find((item) => item.id === jobId);
  if (!job || job.lostReason || !canAction("manageJobs")) return false;
  const reason = String((await appPrompt("Why was this job lost?", "", {
    label: `Reason (for example: ${lostReasonOptions.slice(0, 4).join(", ")})`,
    confirmLabel: "Save reason",
    cancelLabel: "Skip",
    maxLength: 200,
  })) || "").trim();
  if (!reason) return false;
  const updateId = uid("update");
  updateContact(contactId, (current) => {
    const jobs = contactJobs(current).map((item) => item.id === jobId ? { ...item, lostReason: reason, lostAt: item.lostAt || new Date().toISOString() } : item);
    return { ...current, jobs, updates: [{ id: updateId, author: currentActorName(), jobId, message: `Lost reason for ${job.name}: ${reason}.`, createdAt: new Date().toISOString() }, ...(current.updates || [])] };
  });
  saveState({ localOnly: true });
  let saved = !canUseCloudSync();
  try { if (canUseCloudSync()) saved = await persistLeadJobRecord(jobId, updateId); } catch (error) { console.warn("Lost reason could not be confirmed", error); }
  if (!saved) queueDurableRecordsSave();
  if (state.view === "leadDetail") renderLeadDetail();
  return true;
}

// A lead and its jobs get their numbers with the first estimate. A job sold
// without one (common for Home Services) went all the way to Paid showing
// "not numbered". Number it at the moment it is sold.
async function ensureSoldJobNumbered(contactId, jobId) {
  const contact = getContact(contactId);
  const job = contact && contactJobs(contact).find((item) => item.id === jobId);
  if (!contact || !job || (contact.leadNumber && job.projectNumber)) return false;
  try {
    if (canUseCloudSync()) await reserveSharedSalesNumbers(contactId, jobId);
    else if (!ensureLeadProjectNumbers(contactId, jobId)) return false;
  } catch (error) {
    console.warn("A sold job could not be numbered", error);
    return false;
  }
  saveState({ localOnly: true });
  if (canUseCloudSync()) queueDurableRecordsSave();
  else saveState();
  if (state.view === "leadDetail") renderLeadDetail();
  return true;
}

// Called after a job's stage change has been saved.
async function afterJobStageChange(contactId, jobId, previousStatus, nextStatus) {
  if (previousStatus === nextStatus) return;
  const job = contactJobs(getContact(contactId) || {}).find((item) => item.id === jobId);
  if (!job) return;
  if (nextStatus === "Lost") { await recordLostReason(contactId, jobId); return; }
  if (nextStatus === (soldStageStartByDivision[job.division || "roofing"] || "Won")) {
    await ensureSoldJobNumbered(contactId, jobId);
    await reconcileSoldJobWithEstimate(contactId, jobId);
  }
}

function syncEstimatePipelineStage(estimate, estimateStatus = estimate?.status) {
  if (!estimate) return;
  const nextStage = estimateStatus === "Won" || estimateStatus === "Approved"
    ? "Won"
    : estimateStatus === "Sent"
      ? "Estimate Sent"
      : "";
  if (!nextStage) return;
  const linkedContact = getEstimateContact(estimate);
  const linkedJob = getEstimateJob(estimate);
  if (!linkedContact || !linkedJob || linkedJob.status === nextStage) return true;
  const stages = window.RooflineWorkflowChecklist?.stages || [];
  const currentIndex = stages.indexOf(linkedJob.status);
  const targetIndex = stages.indexOf(nextStage);
  // An estimate can never move a completed job backward or skip the workflow
  // checklist. The workflow module owns the transition rules used by the UI.
  if (!stages.length || currentIndex < 0 || targetIndex !== currentIndex + 1) return false;
  const transition = window.RooflineWorkflowChecklist.transitionCheck(linkedContact, linkedJob, nextStage);
  if (!transition.allowed) {
    showToast(transition.reason || `Complete the ${linkedJob.status} checklist before moving to ${nextStage}.`);
    return false;
  }
  const numbered = canUseCloudSync() ? { contact: linkedContact, job: linkedJob } : ensureLeadProjectNumbers(estimate.contactId, estimate.jobId);
  if (!numbered) return false;
  estimate.leadNumber = numbered.contact.leadNumber;
  estimate.projectNumber = numbered.job?.projectNumber || estimate.projectNumber || "";
  const linkedJobId = estimate.jobId || numbered.job?.id || "";
  updateContact(estimate.contactId, (current) => {
    const linkedJob = contactJobs(current).find((job) => job.id === linkedJobId);
    const previousStage = linkedJob?.status || current.status;
    const jobs = contactJobs(current).map((job) =>
      job.id === linkedJobId
        ? {
            ...job,
            status: nextStage,
            closedDate: nextStage === "Won" ? job.closedDate || todayISO() : job.closedDate,
          }
        : job,
    );
    return {
      ...current,
      leadNumber: numbered.contact.leadNumber,
      jobs,
      status: nextStage === "Won" || current.status !== "Won" ? nextStage : current.status,
      type: nextStage === "Won" ? "Customer" : current.type,
      closedDate: nextStage === "Won" ? current.closedDate || todayISO() : current.closedDate,
      updates: previousStage === nextStage
        ? current.updates || []
        : [
            {
              id: uid("update"),
              author: state.currentUser.name || "CRM",
              status: nextStage,
              message: `${estimate.estimateNumber} moved ${estimate.projectNumber || "the project"} to ${nextStage}.`,
              createdAt: new Date().toISOString(),
            },
            ...(current.updates || []),
          ],
    };
  });
  return true;
}

function safeStorageFileName(name = "document") {
  return String(name || "document").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function safeStoragePathSegment(value, fallback) {
  return String(value || fallback || "item").replace(/[^A-Za-z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "") || fallback || "item";
}

function validateDocumentFiles(files) {
  const selectedFiles = [...(files || [])];
  const oversized = selectedFiles.find((file) => file.size > MAX_DOCUMENT_FILE_SIZE);
  if (oversized) throw new Error(`${oversized.name} is larger than the 250 MB upload limit`);
  return selectedFiles;
}

function validatePhotoFiles(files) {
  const selectedFiles = validateDocumentFiles(files);
  const acceptedPhotoName = /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i;
  const invalid = selectedFiles.find(
    (file) => !String(file.type || "").toLowerCase().startsWith("image/") && !acceptedPhotoName.test(file.name || ""),
  );
  if (invalid) throw new Error(`${invalid.name} is not a supported photo file`);
  return selectedFiles;
}

function documentUploadErrorMessage(error) {
  const message = String(error?.message || error || "The upload could not be completed");
  const normalized = message.toLowerCase();
  if (normalized.includes("larger than the 250 mb") || normalized.includes("payload too large") || normalized.includes("413")) {
    return "Upload failed: each file must be 250 MB or smaller.";
  }
  if (normalized.includes("not a supported photo file")) {
    return "Upload failed: choose JPG, PNG, WebP, GIF, AVIF, HEIC, or HEIF photos.";
  }
  if (normalized.includes("row-level security") || normalized.includes("unauthorized") || normalized.includes("forbidden")) {
    return "Upload failed: shared file storage denied access. Ask an administrator to apply the latest storage setup.";
  }
  if (normalized.includes("bucket") && normalized.includes("not found")) {
    return "Upload failed: shared file storage is not configured yet.";
  }
  if (normalized.includes("network") || normalized.includes("fetch") || normalized.includes("offline")) {
    return "Upload failed because the connection was interrupted. Please try again.";
  }
  return `Upload failed: ${message}`;
}

async function uploadDocumentFileResumable(file, storagePath) {
  const config = supabaseConfig();
  const TusUpload = window.tus?.Upload;
  if (!TusUpload || !config.url) throw new Error("Resumable file upload is not available. Reload JobCrest and try again.");
  const { data, error } = await cloudClient.auth.getSession();
  if (error) throw error;
  const accessToken = data?.session?.access_token || authSession?.access_token || "";
  if (!accessToken) throw new Error("Your session expired. Sign in again before uploading files.");
  const endpoint = `${String(config.url).replace(/\/$/, "")}/storage/v1/upload/resumable`;
  return new Promise((resolve, reject) => {
    const upload = new TusUpload(file, {
      endpoint,
      chunkSize: RESUMABLE_UPLOAD_CHUNK_SIZE,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: { authorization: `Bearer ${accessToken}`, "x-upsert": "false" },
      metadata: {
        bucketName: SUPABASE_DOCUMENT_BUCKET,
        objectName: storagePath,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      // A file with the same name can legitimately belong to different jobs.
      // Scope the resume fingerprint to the immutable JobCrest storage path.
      fingerprint: () => Promise.resolve(`jobcrest-upload-${storagePath}`),
      onError: reject,
      onSuccess: () => resolve({ path: storagePath }),
    });
    upload.findPreviousUploads()
      .then((previousUploads) => {
        if (previousUploads.length) upload.resumeFromPreviousUpload(previousUploads[0]);
        upload.start();
      })
      .catch(reject);
  });
}

async function storeDocumentFile(file, { documentId, leadId = "company", jobId = "", categoryId = "other", estimatePdfKey = "" } = {}) {
  if (!documentId || !leadId || !categoryId) throw new Error("Document, lead and category identifiers are required");
  if (!cloudReady || !cloudClient?.storage || !authSession?.user?.id) {
    if (canUseCloudSync()) throw new Error("Shared file storage is not ready. Reconnect before uploading.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Files larger than 5 MB require connected cloud storage; the signed-in CRM supports up to 250 MB.");
    return { dataUrl: await readFileAsDataUrl(file), storagePath: "" };
  }
  const companySegment = safeStoragePathSegment(supabaseStateId(), "company");
  const leadSegment = safeStoragePathSegment(leadId, "company");
  const jobSegment = safeStoragePathSegment(jobId, "job");
  const categorySegment = safeStoragePathSegment(categoryId, "other");
  const documentSegment = safeStoragePathSegment(documentId, "document");
  const contentAddressed = /^[a-f0-9]{64}$/.test(estimatePdfKey);
  const versionSegment = contentAddressed ? estimatePdfKey : safeStoragePathSegment(uid("version"), "version");
  const recordScope = jobId ? `${leadSegment}/jobs/${jobSegment}` : leadSegment;
  // The file keeps its own name either way: it is what a browser offers when
  // someone opens the filed PDF and saves it.
  const storagePath = `${companySegment}/${recordScope}/${categorySegment}/${documentSegment}/${versionSegment}/${safeStorageFileName(file.name)}`;
  const uploadFileSize = Number.isFinite(Number(file.size)) ? Number(file.size) : 0;
  if (uploadFileSize >= RESUMABLE_UPLOAD_THRESHOLD) {
    await uploadDocumentFileResumable(file, storagePath);
    return { dataUrl: "", storagePath };
  }
  const uploadTimeoutMs = Math.max(45000, Math.min(180000, 45000 + Math.ceil(uploadFileSize / (5 * 1024 * 1024)) * 5000));
  let uploadTimeout;
  const upload = cloudClient.storage.from(SUPABASE_DOCUMENT_BUCKET).upload(storagePath, file, {
    cacheControl: "3600",
    contentType: file.type || "application/octet-stream",
    // Immutable revisions preserve prior bytes until new metadata is confirmed.
    upsert: false,
  });
  const { error } = await Promise.race([
    upload,
    new Promise((_resolve, reject) => {
      uploadTimeout = setTimeout(() => reject(new Error("File upload timed out. Check the connection and retry.")), uploadTimeoutMs);
    }),
  ]).finally(() => clearTimeout(uploadTimeout));
  // Only a duplicate-object response for this exact content address is success.
  if (error && !(contentAddressed && /^(Duplicate|ResourceAlreadyExists|The resource already exists\.?|Asset Already Exists)$/i.test(String(error.error || error.message || "")))) throw error;
  return { dataUrl: "", storagePath };
}

async function uploadDocumentBatch(files, uploadOne) {
  const documents = [];
  const failures = [];
  // Keep small files responsive while ensuring large photo/document batches do
  // not saturate the browser, connection, or storage service.
  const concurrency = files.some((file) => Number(file?.size || 0) >= RESUMABLE_UPLOAD_THRESHOLD) ? 1 : 2;
  for (let offset = 0; offset < files.length; offset += concurrency) {
    const batch = files.slice(offset, offset + concurrency);
    const results = await Promise.allSettled(batch.map(uploadOne));
    results.forEach((result, index) => {
      if (result.status === "fulfilled") documents.push(result.value);
      else failures.push({ name: batch[index].name, error: result.reason });
    });
  }
  if (!documents.length && failures.length) throw failures[0].error;
  return { documents, failures };
}

function reportUploadFailures(failures, element) {
  if (!failures.length) return true;
  const message = `Other files were saved. Retry only these failed uploads: ${failures.map((failure) => failure.name).join(", ")}`;
  setSaveState(element, message, "error");
  showToast(message);
  return false;
}

function rollbackUnconfirmedLeadUploads(contactId, documentIds = [], updateId = "") {
  const rejectedIds = new Set(documentIds.filter(Boolean));
  if (!contactId || !rejectedIds.size) return;
  updateContact(contactId, (current) => ({
    ...current,
    documents: (current.documents || []).filter((document) => !rejectedIds.has(document.id)),
    updates: updateId
      ? (current.updates || []).filter((update) => update.id !== updateId)
      : current.updates || [],
  }));
  rejectedIds.forEach((id) => photoPreviewCache.delete(id));
  saveState({ localOnly: true });
  render();
}

function rollbackUnconfirmedCompanyUploads(documentIds = []) {
  const rejectedIds = new Set(documentIds.filter(Boolean));
  if (!rejectedIds.size) return;
  state.companyDocuments = state.companyDocuments.filter((document) => !rejectedIds.has(document.id));
  saveState({ localOnly: true });
  renderCompanyDocuments();
}

async function archiveDocumentRecord(record) {
  if (!record || durableWriteBlocked) return false;
  if (!canUseCloudSync()) {
    try {
      localStorage.setItem(`jobcrest-archived-document:${record.id}`, JSON.stringify({ ...record, archivedAt: new Date().toISOString() }));
      return true;
    } catch { showToast("Document was not removed: a recovery copy could not be saved."); return false; }
  }
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id || !(await waitForDurableSaveSlot())) return false;
  if (typeof invalidateDurableProjection === "function") invalidateDurableProjection();
  const row = typeof durableProjectedRow === "function" ? durableProjectedRow("document", record.id) : durableRowsFromState().find((item) => item.record_type === "document" && item.id === record.id);
  if (!row) return false;
  // Archive metadata first. Keep the immutable current and prior file bytes so
  // a rejected/uncertain save can never destroy a still-visible document.
  const { error } = await commitDurableChanges([], [], [row]);
  return !error;
}

async function downloadManagedDocument(documentId) {
  const leadDocument = state.contacts.flatMap((contact) => contact.documents || []).find((item) => item.id === documentId);
  const record = leadDocument || state.companyDocuments.find((item) => item.id === documentId);
  if (!record) return showToast("Document not found");
  if (record.externalUrl) {
    const opened = window.open(record.externalUrl, "_blank", "noopener,noreferrer");
    if (!opened) showToast("Allow pop-ups to open the Google document");
    return Boolean(opened);
  }
  const previewWindow = window.open("about:blank", "_blank");
  if (previewWindow) previewWindow.opener = null;
  let url = record.dataUrl || "";
  if (record.storagePath && cloudClient?.storage) {
    const { data, error } = await cloudClient.storage.from(SUPABASE_DOCUMENT_BUCKET).createSignedUrl(record.storagePath, 300);
    if (error) {
      console.warn("Document download link failed", error);
      previewWindow?.close();
      return showToast("The document download could not be opened");
    }
    url = data?.signedUrl || "";
  }
  if (!url) {
    previewWindow?.close();
    return showToast("This document needs to be migrated to cloud storage");
  }
  let objectUrl = "";
  if (url.startsWith("data:")) {
    const mime = String(url.match(/^data:([^;,]+)/i)?.[1] || "").toLowerCase();
    const safeMime = ["application/pdf", "text/plain", "image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime)
      ? mime
      : "";
    if (!safeMime) {
      previewWindow?.close();
      showToast("This legacy document type cannot be opened safely. Upload it again as a PDF or supported image.");
      return false;
    }
    const bytes = await fetch(url).then((response) => response.arrayBuffer());
    const blob = new Blob([bytes], { type: safeMime });
    objectUrl = URL.createObjectURL(blob);
    url = objectUrl;
  }
  if (previewWindow) {
    previewWindow.location.replace(url);
    if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return true;
  }
  const link = window.document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return true;
}

async function generateLeadGoogleDocument() {
  if (!requireAction("manageDocuments")) return;
  const contact = getSelectedContact();
  const job = contact && selectedLeadJob(contact);
  const templateKey = els.googleDocTemplateSelect?.value || "";
  if (!contact || !job || !templateKey) return showToast("Choose a job and Google Docs template");
  const template = googleIntegrationState.docTemplates.find((item) => item.key === templateKey);
  setSaveState(els.leadDocumentUploadStatus, "Creating and filling the Google document…", "saving");
  if (els.generateGoogleDocButton) els.generateGoogleDocButton.disabled = true;
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/docs/generate", {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, signal: AbortSignal.timeout(30000),
      body: JSON.stringify({ leadId: contact.id, jobId: job.id, templateKey, name: `${job.name || contact.name} - ${template?.label || "Document"}` }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.generated || !result.document?.webViewLink) throw new Error(result.error || "Google document generation failed.");
    const category = (state.company.documentCategories || []).find((item) => item.active && /contract|other|document/i.test(item.name))
      || (state.company.documentCategories || []).find((item) => item.active);
    const record = normalizeDocument({
      id: uid("doc"), name: result.document.name || `${job.name} Google Document`, leadId: contact.id, jobId: job.id,
      categoryId: category?.id || "", category: category?.name || "Other", type: "application/vnd.google-apps.document",
      source: "google_docs", externalUrl: result.document.webViewLink, googleDocumentId: result.document.id,
      uploadedAt: new Date().toISOString(), uploadedBy: state.currentUser.name || state.currentUser.email || "CRM user",
    }, { leadId: contact.id, categoryId: category?.id || "", categories: state.company.documentCategories });
    updateContact(contact.id, (current) => ({ ...current, documents: [record, ...(current.documents || [])] }));
    const update = addContactUpdate(contact.id, {
      author: state.currentUser.name || "CRM user", jobId: job.id, message: `Created Google Doc: ${record.name}.`,
    });
    saveState({ localOnly: true });
    const saved = canUseCloudSync() ? await persistLeadJobRecord(job.id, update?.updates?.[0]?.id || "") : true;
    if (!saved) queueDurableRecordsSave();
    renderLeadDocuments(getSelectedContact());
    setSaveState(els.leadDocumentUploadStatus, "Google document created, filled, and attached to this job.", "success");
    window.open(record.externalUrl, "_blank", "noopener,noreferrer");
  } catch (error) {
    setSaveState(els.leadDocumentUploadStatus, error.message || "Google document generation failed.", "error");
  } finally {
    if (els.generateGoogleDocButton) els.generateGoogleDocButton.disabled = false;
  }
}

async function migrateInlineDocumentsToStorage() {
  if (!cloudReady || !cloudClient?.storage || !authSession?.user?.id) return;
  let migrated = 0;
  const candidates = [];
  state.contacts.forEach((contact) => (contact.documents || []).forEach((record) => {
    if (!record.storagePath && String(record.dataUrl || "").startsWith("data:")) {
      candidates.push({ record, leadId: contact.id, jobId: record.jobId || "", categoryId: record.categoryId || "other" });
    }
  }));
  state.companyDocuments.forEach((record) => {
    if (!record.storagePath && String(record.dataUrl || "").startsWith("data:")) {
      candidates.push({ record, leadId: "company", categoryId: record.category || "other" });
    }
  });
  for (const candidate of candidates) {
    try {
      const blob = await fetch(candidate.record.dataUrl).then((response) => response.blob());
      const file = new File([blob], candidate.record.name || "document", { type: candidate.record.type || blob.type });
      const stored = await storeDocumentFile(file, {
        documentId: candidate.record.id,
        leadId: candidate.leadId,
        jobId: candidate.jobId || "",
        categoryId: candidate.categoryId,
      });
      candidate.record.storagePath = stored.storagePath;
      candidate.record.dataUrl = "";
      migrated += 1;
    } catch (error) {
      console.warn(`Document ${candidate.record.id} could not be migrated to Storage`, error);
    }
  }
  if (migrated) {
    saveState();
    render();
    showToast(`${migrated} existing document${migrated === 1 ? "" : "s"} moved to secure storage`);
  }
}

function rasterizeLogoDataUrl(dataUrl) {
  if (window.Worker && window.OffscreenCanvas && window.createImageBitmap) {
    return fetch(dataUrl)
      .then((response) => response.blob())
      .then((blob) => new Promise((resolve, reject) => {
        const worker = new window.Worker("/image-worker.js?v=1");
        const id = crypto.randomUUID();
        const timeout = window.setTimeout(() => {
          worker.terminate();
          reject(new Error("Image processing timed out"));
        }, 15000);
        worker.onmessage = (event) => {
          if (event.data?.id !== id) return;
          window.clearTimeout(timeout);
          worker.terminate();
          if (event.data.error) return reject(new Error(event.data.error));
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error || new Error("Processed image could not be read"));
          reader.readAsDataURL(new Blob([event.data.buffer], { type: event.data.type || "image/png" }));
        };
        worker.onerror = (event) => {
          window.clearTimeout(timeout);
          worker.terminate();
          reject(event.error || new Error("Image worker failed"));
        };
        worker.postMessage({ id, blob, maxWidth: 640, maxHeight: 320, type: "image/png" });
      }))
      .catch(() => rasterizeLogoDataUrlOnMainThread(dataUrl));
  }
  return rasterizeLogoDataUrlOnMainThread(dataUrl);
}

function rasterizeLogoDataUrlOnMainThread(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const maxWidth = 640;
      const maxHeight = 320;
      const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(Math.round(image.width * scale), 1);
      canvas.height = Math.max(Math.round(image.height * scale), 1);
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = reject;
    image.src = dataUrl;
  });
}

// ---- Uploads to a lead: one status per file ---------------------------------
// Every file a person picks gets its own line: Waiting, Sending, then either
// "Saved to <job>" or the reason it failed with "Retry this file". A file is
// called saved only when two things are confirmed: the file is in storage,
// and its record came back from the database under the right lead and job.
// One file failing does not hold up or undo the others, and retrying it sends
// that one file again, not the batch. It used to be one line for the whole
// batch, and a failed file had to be found and picked again by hand.
const leadUploads = [];
const LEAD_UPLOAD_ACTIVE = ["waiting", "sending", "confirming"];
const PHOTO_PREVIEW_SIDE = 480;
let leadUploadsRunning = null;
let leadUploadConfirmTail = Promise.resolve();
let leadUploadRefreshTimer = null;

// A small copy of a photo for the gallery, made in the browser as it is sent.
// The gallery used to load every full-size original as its own thumbnail.
async function makePhotoPreview(file) {
  try {
    if (typeof createImageBitmap !== "function") return null;
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, PHOTO_PREVIEW_SIDE / Math.max(bitmap.width, bitmap.height, 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.72));
    return blob?.size ? blob : null;
  } catch {
    return null; // A kind of photo this browser cannot draw: the gallery uses the original.
  }
}

// Stores the small copy beside the original. Never a reason for an upload to
// fail: without one the gallery simply shows the original, as before.
async function storePhotoPreview(file, storagePath) {
  if (!storagePath || !cloudClient?.storage) return "";
  const blob = await makePhotoPreview(file);
  if (!blob || blob.size >= Number(file.size || 0)) return "";
  const previewPath = `${storagePath.slice(0, storagePath.lastIndexOf("/"))}/preview.jpg`;
  try {
    const { error } = await cloudClient.storage.from(SUPABASE_DOCUMENT_BUCKET)
      .upload(previewPath, blob, { cacheControl: "31536000", contentType: "image/jpeg", upsert: false });
    return error ? "" : previewPath;
  } catch {
    return "";
  }
}

function leadUploadFailureMessage(error) {
  const message = String(error?.message || error || "");
  if (message === "record_not_confirmed") return "The file was sent, but saving it to this job could not be confirmed.";
  if (message === "target_removed") return "The lead or job was removed before this file was saved.";
  if (message === "device_storage_full") return "Not saved: this device is out of offline storage. Connect shared storage and retry.";
  return documentUploadErrorMessage(error);
}

// Files the record under its lead and job, and waits for the database to say
// so. If that cannot be confirmed the record is taken off the lead again, so
// nothing is shown as saved that is not.
async function fileLeadUpload(item) {
  const contact = getContact(item.contactId);
  const job = contact ? contactJobs(contact).find((entry) => entry.id === item.jobId) : null;
  if (!contact || !job) throw new Error("target_removed");
  const isPhoto = item.kind === "photo";
  const record = normalizeDocument({
    id: item.documentId,
    name: item.name,
    type: item.type,
    size: item.size,
    ...item.stored,
    ...(item.previewPath ? { previewPath: item.previewPath } : {}),
    uploadedAt: new Date().toISOString(),
    leadId: contact.id,
    contactId: contact.id,
    jobId: job.id,
    categoryId: item.categoryId,
    category: item.categoryName,
    ...(isPhoto ? { kind: "photo" } : {}),
    uploadedBy: isPhoto ? state.currentUser.name || state.currentUser.email || "CRM user" : currentActorName(),
    versionNumber: 1,
  }, { leadId: contact.id, categoryId: item.categoryId, categories: state.company.documentCategories });
  const takeBack = () => {
    const current = getContact(item.contactId);
    if (current) current.documents = (current.documents || []).filter((document) => document.id !== record.id);
    photoPreviewCache.delete(record.id);
    saveState({ localOnly: true });
  };
  // Added straight to the lead's files, as loading them does. Going through
  // updateContact would re-save the lead itself once for every file.
  contact.documents = [record, ...(contact.documents || []).filter((document) => document.id !== record.id)];
  const localSaved = saveState({ localOnly: true });
  if (!canUseCloudSync()) {
    if (!localSaved) {
      takeBack();
      throw new Error("device_storage_full");
    }
    return record;
  }
  window.clearTimeout(durableSaveTimer);
  let saved = false;
  try {
    saved = await persistLeadDocumentRecords([record.id], "");
  } catch (error) {
    console.warn("Upload record could not be confirmed", error);
  }
  if (!saved) {
    takeBack();
    throw new Error("record_not_confirmed");
  }
  return record;
}

async function sendLeadUpload(item) {
  item.status = "sending";
  item.message = "";
  renderLeadUploads();
  try {
    // A retry after the file itself went through does not send it twice.
    if (!item.stored) {
      item.stored = await storeDocumentFile(item.file, { documentId: item.documentId, leadId: item.contactId, jobId: item.jobId, categoryId: item.categoryId });
    }
    if (item.kind === "photo" && item.stored.storagePath && item.previewPath === undefined) {
      item.previewPath = await storePhotoPreview(item.file, item.stored.storagePath);
    }
    item.status = "confirming";
    renderLeadUploads();
    // Records are confirmed one at a time, in the order the files finish.
    const filed = leadUploadConfirmTail.then(() => fileLeadUpload(item));
    leadUploadConfirmTail = filed.catch(() => {});
    item.record = await filed;
    item.status = "saved";
    item.file = null;
    return true;
  } catch (error) {
    console.warn(`Upload of ${item.name} failed`, error);
    item.status = "failed";
    item.message = leadUploadFailureMessage(error);
    return false;
  } finally {
    renderLeadUploads();
    scheduleLeadUploadRefresh(item.contactId);
  }
}

// One line in the lead's history for what a run saved, not one per file.
function noteLeadUploads(items) {
  const groups = new Map();
  items.forEach((item) => {
    const key = `${item.contactId}|${item.jobId}|${item.kind}|${item.categoryId}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  groups.forEach((group) => {
    const [first] = group;
    if (!getContact(first.contactId)) return;
    addContactUpdate(first.contactId, {
      jobId: first.jobId,
      message: first.kind === "photo"
        ? `Uploaded ${group.length} job photo${group.length === 1 ? "" : "s"} to ${first.jobName}.`
        : `Uploaded ${group.length === 1 ? first.name : `${group.length} documents`} to ${first.jobName} / ${first.categoryName}.`,
    });
  });
  if (!groups.size) return;
  saveState({ localOnly: true });
  queueDurableRecordsSave();
  queueCloudSave();
}

// Sends what is waiting, two files at a time (one at a time when any is large).
function runLeadUploads() {
  if (leadUploadsRunning) return leadUploadsRunning;
  leadUploadsRunning = (async () => {
    const saved = [];
    try {
      for (;;) {
        const waiting = leadUploads.filter((item) => item.status === "waiting");
        if (!waiting.length) break;
        const group = waiting.slice(0, waiting.some((item) => item.size >= RESUMABLE_UPLOAD_THRESHOLD) ? 1 : 2);
        await Promise.all(group.map(async (item) => { if (await sendLeadUpload(item)) saved.push(item); }));
      }
    } finally {
      leadUploadsRunning = null;
      noteLeadUploads(saved);
      renderLeadUploads();
      if (saved.length) showToast(`${saved.length} file${saved.length === 1 ? "" : "s"} saved to ${saved[0].jobName}`);
    }
  })();
  return leadUploadsRunning;
}

function queueLeadUploads(kind, files, target) {
  const items = files.map((file) => ({
    id: uid("upload"),
    kind,
    file,
    name: file.name || "file",
    size: Number(file.size) || 0,
    type: file.type || (kind === "photo" ? "image/jpeg" : "application/octet-stream"),
    documentId: uid(kind === "photo" ? "photo" : "doc"),
    ...target,
    stored: null,
    previewPath: undefined,
    record: null,
    status: "waiting",
    message: "",
  }));
  leadUploads.push(...items);
  renderLeadUploads();
  return items;
}

// The lists of files and photos are redrawn shortly after a file lands, not
// once per file while twenty are arriving.
function scheduleLeadUploadRefresh(contactId) {
  window.clearTimeout(leadUploadRefreshTimer);
  leadUploadRefreshTimer = window.setTimeout(() => {
    if (state.view === "leadDetail" && state.selectedContactId === contactId && !activeTextEditor()) renderLeadDetail();
  }, leadUploads.some((item) => LEAD_UPLOAD_ACTIVE.includes(item.status)) ? 1200 : 0);
}

function leadUploadSummary(items, noun) {
  const count = (status) => items.filter((item) => item.status === status).length;
  const saved = count("saved");
  const failed = count("failed");
  const active = items.length - saved - failed;
  const plural = `${noun}${items.length === 1 ? "" : "s"}`;
  if (active) return { tone: "saving", message: `Sending ${items.length} ${plural}: ${saved} saved${failed ? `, ${failed} failed` : ""}, ${active} to go.` };
  if (failed) return { tone: "error", message: `${saved} of ${items.length} ${plural} saved. ${failed} did not go through: use "Retry this file" below. The saved ones do not need sending again.` };
  return { tone: "success", message: `${items.length} ${plural} saved to ${items[0].jobName}.` };
}

function leadUploadListMarkup(items) {
  const failed = items.filter((item) => item.status === "failed").length;
  const finished = items.filter((item) => item.status === "saved").length;
  const label = (item) => ({
    waiting: "Waiting",
    sending: "Sending…",
    confirming: "Saving to the job…",
    saved: `Saved to ${item.jobName}`,
    failed: item.message || "Not saved",
  })[item.status];
  return `
    <ul class="upload-status-list">${items.map((item) => `
      <li class="upload-status-row is-${item.status}" data-upload-row="${escapeHtml(item.id)}">
        <span class="upload-status-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <span class="upload-status-size">${escapeHtml(formatBytes(item.size))}</span>
        <span class="upload-status-state">${escapeHtml(label(item))}</span>
        ${item.status === "failed" ? `<span class="upload-status-actions"><button class="secondary-button" type="button" data-upload-retry="${escapeHtml(item.id)}">Retry this file</button><button class="link-button" type="button" data-upload-remove="${escapeHtml(item.id)}">Remove</button></span>` : ""}
      </li>`).join("")}
    </ul>
    <div class="upload-status-footer">
      ${failed > 1 ? `<button class="secondary-button" type="button" data-upload-retry-all>Retry all ${failed} failed</button>` : ""}
      ${finished ? '<button class="link-button" type="button" data-upload-clear>Clear the saved ones from this list</button>' : ""}
    </div>`;
}

function renderLeadUploads() {
  [["photo", els.leadPhotoUploadStatus, "leadPhotoUploadList", "photo"], ["document", els.leadDocumentUploadStatus, "leadDocumentUploadList", "file"]].forEach(([kind, statusElement, listId, noun]) => {
    if (!statusElement?.insertAdjacentElement) return;
    const items = leadUploads.filter((item) => item.kind === kind && item.contactId === state.selectedContactId);
    let list = document.getElementById(listId);
    if (!items.length) {
      list?.remove();
      return;
    }
    if (!list) {
      list = document.createElement("div");
      list.id = listId;
      list.className = "upload-status";
      list.dataset.uploadKind = kind;
      statusElement.insertAdjacentElement("afterend", list);
    }
    list.innerHTML = leadUploadListMarkup(items);
    const summary = leadUploadSummary(items, noun);
    setSaveState(statusElement, summary.message, summary.tone, { showSuccess: true });
  });
}

function retryLeadUploads(ids) {
  const wanted = new Set(ids);
  leadUploads.forEach((item) => {
    if (wanted.has(item.id) && item.status === "failed" && (item.file || item.stored)) {
      item.status = "waiting";
      item.message = "";
    }
  });
  renderLeadUploads();
  return runLeadUploads();
}

function clearLeadUploads(predicate) {
  for (let index = leadUploads.length - 1; index >= 0; index -= 1) {
    if (predicate(leadUploads[index])) leadUploads.splice(index, 1);
  }
  renderLeadUploads();
}

async function uploadLeadDocuments(files) {
  if (!requireAction("manageDocuments")) return;
  const contact = getSelectedContact();
  if (!contact || !files?.length) return;
  const job = selectedLeadJob(contact);
  if (!job) {
    showToast("Select a job before uploading documents");
    return;
  }
  const selectedFiles = validateDocumentFiles(files);
  const categoryId = els.leadDocumentCategory?.value || "";
  const category = state.company.documentCategories.find((item) => item.id === categoryId && item.active);
  if (!category) {
    showToast("Choose an active document category");
    return;
  }
  const items = queueLeadUploads("document", selectedFiles, {
    contactId: contact.id, jobId: job.id, jobName: job.name, categoryId: category.id, categoryName: category.name,
  });
  await runLeadUploads();
  const saved = items.filter((item) => item.status === "saved");
  if (els.leadDocumentSmartAfterUpload?.checked && saved.length) {
    els.leadDocumentSmartAfterUpload.checked = false;
    if (items.length === 1) openZohoSignDialog(saved[0].record);
    else showToast("Use the Smart Doc button beside each saved file when uploading multiple documents.");
  }
  return saved.length === items.length;
}

async function uploadLeadPhotos(files) {
  if (!requireAction("manageDocuments")) return false;
  const contact = getSelectedContact();
  if (!contact || !files?.length) return false;
  const job = contactJobs(contact).find((item) => item.id === state.selectedLeadJobId);
  if (!job) return false;
  const selectedFiles = validatePhotoFiles(files);
  state.leadDetailTab = "photos";
  const items = queueLeadUploads("photo", selectedFiles, {
    contactId: contact.id, jobId: job.id, jobName: job.name, categoryId: JOB_PHOTO_CATEGORY_ID, categoryName: "Photos",
  });
  await runLeadUploads();
  return items.every((item) => item.status === "saved");
}

async function removeLeadDocument(documentId) {
  if (!requireAction("manageDocuments")) return;
  const contact = getSelectedContact();
  if (!contact) return;
  const document = contact.documents.find((item) => item.id === documentId);
  if (!(await archiveDocumentRecord(document))) {
    showToast("Document was not removed. Check the shared-saving status and try again.");
    return;
  }
  photoPreviewCache.delete(documentId);
  updateContact(contact.id, (current) => ({
    ...current,
    documents: current.documents.filter((item) => item.id !== documentId),
  }));
  addContactUpdate(contact.id, {
    jobId: document?.jobId || "",
    message: `Removed ${document?.kind === "photo" ? "photo" : "document"} ${document?.name || "from lead record"}.`,
  });
  saveState();
  render();
  showToast(document?.kind === "photo" ? "Photo removed" : "Document removed");
}

function documentExtension(name = "") {
  const match = String(name).match(/(\.[A-Za-z0-9]{1,10})$/);
  return match ? match[1] : "";
}

function normalizeDocumentRename(value = "", originalName = "") {
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  const extension = documentExtension(originalName);
  return extension && !documentExtension(trimmed) ? `${trimmed}${extension}` : trimmed;
}

async function renameLeadDocument(documentId) {
  if (!requireAction("manageDocuments")) return;
  const contact = getSelectedContact();
  if (!contact) return;
  const document = contact.documents.find((item) => item.id === documentId);
  if (!document) return;
  const nextName = normalizeDocumentRename(await appPrompt("Rename document", document.name, { label: "Document name", confirmLabel: "Rename" }), document.name);
  if (!nextName || nextName === document.name) return;
  updateContact(contact.id, (current) => ({
    ...current,
    documents: current.documents.map((item) => (item.id === documentId ? { ...item, name: nextName } : item)),
  }));
  addContactUpdate(contact.id, {
    jobId: document.jobId || "",
    message: `Renamed ${document.kind === "photo" ? "photo" : "document"} ${document.name} to ${nextName}.`,
  });
  saveState();
  render();
  showToast(document.kind === "photo" ? "Photo renamed" : "Document renamed");
}

async function submitLeadConversation(event) {
  event.preventDefault();
  if (!requireAction("manageJobs")) return;
  const contact = getSelectedContact();
  if (!contact) return;
  const job = selectedLeadJob(contact);
  if (!job) return;
  const formData = new FormData(els.leadConversationForm);
  const author = formData.get("author") || currentActorName();
  const status = formData.get("status");
  const message = formData.get("message").trim();

  if (status && status !== job.status && primaryJob(contact)?.id === job.id) {
    applyStatusUpdate(contact.id, status, author, message || `Status changed to ${status}.`);
  } else {
    addContactUpdate(contact.id, { author, message, status, jobId: job.id });
  }

  state.leadDetailTab = "conversation";
  saveState({ localOnly: true });
  render();
  const saved = await persistCriticalLeadChange({
    statusElement: els.conversationSaveStatus,
    button: els.conversationSaveButton,
    successMessage: "Update posted",
  });
  if (!saved) return;
  els.leadConversationForm.reset();
  showToast("Update posted to the shared CRM");
}

function companyDocumentFolders() {
  return companyDocumentFoldersWithLegacy(state.company.companyDocumentFolders, state.companyDocuments);
}

function companyDocumentFolderFor(document, folders = companyDocumentFolders()) {
  return folders.find((folder) => folder.id === document.folderId) ||
    folders.find((folder) => documentCategoryNameKey(folder.name) === documentCategoryNameKey(document.category || "Other")) ||
    folders.find((folder) => documentCategoryNameKey(folder.name) === "other") || folders[0];
}

function refreshCompanyDocumentFolderOptions(folders = companyDocumentFolders()) {
  if (!els.companyDocumentCategory) return;
  const current = selectedCompanyDocumentFolderId || els.companyDocumentCategory.value;
  els.companyDocumentCategory.innerHTML = folders.map((folder) => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</option>`).join("");
  els.companyDocumentCategory.value = folders.some((folder) => folder.id === current) ? current : folders[0]?.id || "";
}

function companyDocumentStatus(document) {
  if (document.smartDocument?.status) return `Smart Doc · ${document.smartDocument.status}`;
  if (document.zohoSign?.requestId) return `Zoho Sign · ${document.zohoSign.status || "draft"}`;
  if (document.googleDrive?.fileId) return `Drive · Version ${document.googleDrive.versionNumber}`;
  return `Version ${document.versionNumber || 1}`;
}

// Mirrors crm_commit_records and the server's canAccessTrustedRecord: reps can
// open every company file but may only change the ones they uploaded.
function canChangeCompanyDocument(document = {}) {
  if (!authSession?.user?.id || canManageTeamData()) return true;
  return Boolean(document.ownerUserId) && document.ownerUserId === authSession.user.id;
}

function renderCompanyDocumentRow(document, folders = companyDocumentFolders()) {
  const extension = String(document.name || "").split(".").pop()?.toUpperCase().slice(0, 5) || "FILE";
  const currentFolder = companyDocumentFolderFor(document, folders);
  const changeable = canChangeCompanyDocument(document);
  return `<article class="company-document-row">
    <div class="company-document-file-mark ${extension === "PDF" ? "pdf" : ""}" aria-hidden="true"><span data-icon="file"></span><small>${escapeHtml(extension)}</small></div>
    <div class="company-document-file-info"><strong>${escapeHtml(document.name)}</strong><span>${escapeHtml(companyDocumentStatus(document))}</span></div>
    <span class="company-document-date">${escapeHtml(formatDateTime(document.uploadedAt))}</span>
    <span class="company-document-size">${escapeHtml(formatBytes(document.size))}</span>
    <div class="row-actions company-document-row-actions">
      ${changeable ? `<select class="company-document-move-select" data-company-document-folder="${escapeHtml(document.id)}" aria-label="Move ${escapeHtml(document.name)} to folder" title="Move to another folder">${folders.map((folder) => `<option value="${escapeHtml(folder.id)}" ${folder.id === currentFolder?.id ? "selected" : ""}>${escapeHtml(folder.name)}</option>`).join("")}</select>` : ""}
      <button class="mini-button" type="button" data-action="download-document" data-document-id="${escapeHtml(document.id)}" title="Open ${escapeHtml(document.name)}" aria-label="Open ${escapeHtml(document.name)}"><span aria-hidden="true" data-icon="open"></span></button>
      <button class="mini-button" type="button" data-action="document-operations" data-document-id="${escapeHtml(document.id)}" title="Document access, versions, and comments" aria-label="Document details for ${escapeHtml(document.name)}"><span aria-hidden="true" data-icon="message"></span></button>
      ${changeable ? `${nativeSmartDocumentButton(document)}
      ${zohoSmartDocumentButton(document)}
      ${googleDriveDocumentButton(document)}
      <button class="mini-button" type="button" title="Rename document" aria-label="Rename ${escapeHtml(document.name)}" data-action="rename-company-document" data-document-id="${escapeHtml(document.id)}"><span aria-hidden="true" data-icon="edit"></span></button>
      <button class="mini-button" type="button" title="Remove document" aria-label="Remove ${escapeHtml(document.name)}" data-action="remove-company-document" data-document-id="${escapeHtml(document.id)}"><span aria-hidden="true" data-icon="trash"></span></button>` : ""}
    </div>
  </article>`;
}

function renderCompanyDocuments() {
  if (!els.companyDocumentsList) return;
  if (canUseCloudSync() && durableRecordsReady && !durableCompanyDocumentsLoad) void loadDurableCompanyDocuments();
  if (canUseCloudSync() && !googleDriveState.loaded && !googleDriveState.loading) void refreshGoogleDriveStatus().then(renderCompanyDocuments);
  const folders = companyDocumentFolders();
  state.company.companyDocumentFolders = folders;
  refreshCompanyDocumentFolderOptions(folders);
  if (els.createCompanyDocumentFolderButton) els.createCompanyDocumentFolderButton.hidden = !canAction("manageCompany");
  const documents = [...state.companyDocuments].sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  const activeFolder = folders.find((folder) => folder.id === selectedCompanyDocumentFolderId);
  if (!activeFolder) {
    selectedCompanyDocumentFolderId = "";
    els.companyDocumentsList.innerHTML = `<div class="company-folder-list-header"><span>Name</span><span>Files</span><span>Last updated</span><span></span></div>${folders.map((folder) => {
      const folderDocuments = documents.filter((document) => companyDocumentFolderFor(document, folders)?.id === folder.id);
      const updatedAt = folderDocuments[0]?.uploadedAt || folder.updatedAt;
      return `<article class="company-folder-row" data-action="open-company-document-folder" data-folder-id="${escapeHtml(folder.id)}" tabindex="0" role="button" aria-label="Open ${escapeHtml(folder.name)} folder">
        <span class="company-folder-icon" aria-hidden="true" data-icon="folder"></span>
        <div><strong>${escapeHtml(folder.name)}</strong><span>${folderDocuments.length ? `${folderDocuments.length} document${folderDocuments.length === 1 ? "" : "s"}` : "Empty folder"}</span></div>
        <span>${folderDocuments.length}</span><span>${escapeHtml(formatDateTime(updatedAt))}</span><span class="company-folder-chevron" aria-hidden="true">›</span>
      </article>`;
    }).join("") || '<div class="empty-state">Create a folder to organize company documents.</div>'}`;
  } else {
    const folderDocuments = documents.filter((document) => companyDocumentFolderFor(document, folders)?.id === activeFolder.id);
    const displayLimit = companyDocumentDisplayLimits.get(activeFolder.id) || DOCUMENT_PAGE_SIZE;
    const visibleDocuments = folderDocuments.slice(0, displayLimit);
    if (els.companyDocumentCategory) els.companyDocumentCategory.value = activeFolder.id;
    els.companyDocumentsList.innerHTML = `<div class="company-document-folder-toolbar">
      <button class="ghost-button" type="button" data-action="close-company-document-folder"><span aria-hidden="true" data-icon="arrow-left"></span>All folders</button>
      <div><span class="company-folder-icon" aria-hidden="true" data-icon="folder"></span><div><strong>${escapeHtml(activeFolder.name)}</strong><span>${folderDocuments.length} document${folderDocuments.length === 1 ? "" : "s"}</span></div></div>
      ${canAction("manageCompany") ? `<div class="row-actions company-folder-actions">
        <button class="secondary-button" type="button" data-action="rename-company-document-folder" data-folder-id="${escapeHtml(activeFolder.id)}"><span aria-hidden="true" data-icon="edit"></span>Rename folder</button>
        <button class="secondary-button" type="button" data-action="delete-company-document-folder" data-folder-id="${escapeHtml(activeFolder.id)}" ${folderDocuments.length ? 'title="Move or remove the documents in this folder first"' : ""}><span aria-hidden="true" data-icon="trash"></span>Delete folder</button>
      </div>` : ""}
    </div><div class="company-document-list-header"><span>Document</span><span>Uploaded</span><span>Size</span><span>Actions</span></div>
    <div class="company-document-file-list">${visibleDocuments.map((document) => renderCompanyDocumentRow(document, folders)).join("") || '<div class="empty-state">This folder is empty. Choose it above and upload documents.</div>'}</div>
    ${folderDocuments.length > visibleDocuments.length ? `<button class="secondary-button" type="button" data-action="show-more-company-documents" data-folder-id="${escapeHtml(activeFolder.id)}">Show ${Math.min(DOCUMENT_PAGE_SIZE, folderDocuments.length - visibleDocuments.length)} more documents</button>` : ""}`;
  }
  hydrateIcons(els.companyDocumentsList);
}

async function createCompanyDocumentFolder() {
  if (!requireAction("manageCompany")) return;
  const name = String((await appPrompt("New folder", "", { label: "Folder name", confirmLabel: "Create folder", maxLength: 120 })) || "").trim().slice(0, 120);
  if (!name) return;
  const folders = companyDocumentFolders();
  if (folders.some((folder) => documentCategoryNameKey(folder.name) === documentCategoryNameKey(name))) return showToast("A folder with that name already exists");
  const now = new Date().toISOString();
  const folder = { id: uid("companyfolder"), name, displayOrder: folders.length, createdAt: now, updatedAt: now };
  state.company.companyDocumentFolders = [...folders, folder];
  selectedCompanyDocumentFolderId = folder.id;
  saveState();
  renderCompanyDocuments();
}

function companyDocumentsInFolder(folderId, folders = companyDocumentFolders()) {
  return state.companyDocuments.filter((document) => companyDocumentFolderFor(document, folders)?.id === folderId);
}

async function renameCompanyDocumentFolder(folderId) {
  if (!requireAction("manageCompany")) return;
  const folders = companyDocumentFolders();
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return;
  const name = String((await appPrompt("Rename folder", folder.name, { label: "Folder name", confirmLabel: "Rename", maxLength: 120 })) || "").trim().slice(0, 120);
  if (!name || name === folder.name) return;
  if (folders.some((item) => item.id !== folder.id && documentCategoryNameKey(item.name) === documentCategoryNameKey(name))) return showToast("A folder with that name already exists");
  // Files matched to this folder only by its old name must carry the folder id
  // and the new name, or they would reappear in a folder with the old name.
  const memberIds = new Set(companyDocumentsInFolder(folder.id, folders).map((document) => document.id));
  state.company.companyDocumentFolders = folders.map((item) => item.id === folder.id ? { ...item, name, updatedAt: new Date().toISOString() } : item);
  state.companyDocuments = state.companyDocuments.map((document) => memberIds.has(document.id) ? { ...document, folderId: folder.id, category: name } : document);
  saveState();
  renderCompanyDocuments();
  if (memberIds.size && canUseCloudSync() && !(await persistCompanyDocumentRecords([...memberIds]))) queueDurableRecordsSave();
  showToast(`Folder renamed to ${name}`);
}

async function deleteCompanyDocumentFolder(folderId) {
  if (!requireAction("manageCompany")) return;
  const folders = companyDocumentFolders();
  const folder = folders.find((item) => item.id === folderId);
  if (!folder) return;
  const count = companyDocumentsInFolder(folder.id, folders).length;
  if (count) {
    return showToast(`${folder.name} still holds ${count} document${count === 1 ? "" : "s"}. Move or remove ${count === 1 ? "it" : "them"} before deleting the folder.`);
  }
  if (!(await appConfirm(`Delete the empty folder "${folder.name}"?`, { title: "Delete folder", confirmLabel: "Delete folder", danger: true }))) return;
  state.company.companyDocumentFolders = folders.filter((item) => item.id !== folder.id);
  if (selectedCompanyDocumentFolderId === folder.id) selectedCompanyDocumentFolderId = "";
  companyDocumentDisplayLimits.delete(folder.id);
  saveState();
  renderCompanyDocuments();
  showToast(`Folder ${folder.name} deleted`);
}

async function moveCompanyDocumentToFolder(documentId, folderId) {
  if (!requireAction("manageDocuments")) return false;
  const folders = companyDocumentFolders();
  const folder = folders.find((item) => item.id === folderId);
  const document = state.companyDocuments.find((item) => item.id === documentId);
  if (document && !canChangeCompanyDocument(document)) {
    showToast("Only the person who uploaded this company file, or a manager, can change it.");
    return false;
  }
  if (!folder || !document) return false;
  if (companyDocumentFolderFor(document, folders)?.id === folder.id) return true;
  state.companyDocuments = state.companyDocuments.map((item) => item.id === documentId ? { ...item, folderId: folder.id, category: folder.name } : item);
  saveState({ localOnly: true });
  renderCompanyDocuments();
  const saved = !canUseCloudSync() || await persistCompanyDocumentRecords([documentId]);
  if (!saved) {
    queueDurableRecordsSave();
    setSaveState(els.companyDocumentUploadStatus, "The document moved locally, but the shared folder change is still retrying.", "error");
    return false;
  }
  queueCloudSave();
  return true;
}

async function uploadCompanyDocuments(files) {
  if (!requireAction("manageDocuments")) return;
  if (!files?.length) return;
  const selectedFiles = validateDocumentFiles(files);
  const folders = companyDocumentFolders();
  const folder = folders.find((item) => item.id === els.companyDocumentCategory.value) || folders[0];
  if (!folder) return showToast("Create or select a folder first");
  els.uploadCompanyDocumentButton.disabled = true;
  setSaveState(
    els.companyDocumentUploadStatus,
    `Uploading ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} to secure storage...`,
    "saving",
  );

  const previousDocuments = state.companyDocuments;
  try {
    const { documents, failures } = await uploadDocumentBatch(
      selectedFiles, async (file) => {
        const id = uid("doc");
        const stored = await storeDocumentFile(file, { documentId: id, leadId: "company", categoryId: folder.id });
        return normalizeDocument({
          id,
          name: file.name,
          folderId: folder.id,
          category: folder.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          ...stored,
          uploadedAt: new Date().toISOString(),
          uploadedBy: currentActorName(),
          ownerUserId: authSession?.user?.id || "",
          versionNumber: 1,
        });
      },
    );
    state.companyDocuments = [...documents, ...state.companyDocuments];
    const localSaved = saveState({ localOnly: true });
    if (!canUseCloudSync() && !localSaved) {
      state.companyDocuments = previousDocuments;
      renderCompanyDocuments();
      setSaveState(els.companyDocumentUploadStatus, "Upload was not saved because this device is out of offline storage. Connect shared storage and retry.", "error");
      showToast("Company document was not saved. This device is out of offline storage.");
      return false;
    }
    window.clearTimeout(durableSaveTimer);
    renderCompanyDocuments();
    setSaveState(els.companyDocumentUploadStatus, "File stored. Confirming the shared company library...", "saving");

    let saved = !canUseCloudSync();
    if (canUseCloudSync()) {
      saved = await persistCompanyDocumentRecords(documents.map((document) => document.id));
    }
    if (!saved) {
      rollbackUnconfirmedCompanyUploads(documents.map((document) => document.id));
      setSaveState(
        els.companyDocumentUploadStatus,
        "Upload could not be confirmed. The unconfirmed file was removed; select it again to retry.",
        "error",
      );
      showToast("Company document was not confirmed and was removed. Please retry.");
      return false;
    }

    queueCloudSave();
    setSaveState(
      els.companyDocumentUploadStatus,
      canUseCloudSync()
        ? `${documents.length} company document${documents.length === 1 ? "" : "s"} saved and shared with the team.`
        : `${documents.length} company document${documents.length === 1 ? "" : "s"} saved on this device.`,
      "success",
    );
    showToast(`${documents.length} company document${documents.length === 1 ? "" : "s"} saved`);
    const allSaved = reportUploadFailures(failures, els.companyDocumentUploadStatus);
    if (els.companyDocumentSmartAfterUpload?.checked) {
      els.companyDocumentSmartAfterUpload.checked = false;
      if (documents.length === 1) openZohoSignDialog(documents[0]);
      else showToast("Use the Smart Doc button beside each saved file when uploading multiple documents.");
    }
    return allSaved;
  } finally {
    els.uploadCompanyDocumentButton.disabled = false;
  }
}

async function removeCompanyDocument(documentId) {
  if (!requireAction("manageDocuments")) return;
  const document = state.companyDocuments.find((item) => item.id === documentId);
  if (document && !canChangeCompanyDocument(document)) {
    showToast("Only the person who uploaded this company file, or a manager, can change it.");
    return;
  }
  if (!document) return;
  if (!(await appConfirm(`Remove "${document.name}" from the company library? Everyone on the team loses access to it.`, { title: "Remove document", confirmLabel: "Remove document", danger: true }))) return;
  if (!(await archiveDocumentRecord(document))) {
    showToast("Document was not removed. Check the shared-saving status and try again.");
    return;
  }
  state.companyDocuments = state.companyDocuments.filter((document) => document.id !== documentId);
  saveState();
  renderCompanyDocuments();
  showToast("Company document removed");
}

async function renameCompanyDocument(documentId) {
  if (!requireAction("manageDocuments")) return;
  const document = state.companyDocuments.find((item) => item.id === documentId);
  if (document && !canChangeCompanyDocument(document)) {
    showToast("Only the person who uploaded this company file, or a manager, can change it.");
    return;
  }
  if (!document) return;
  const nextName = normalizeDocumentRename(await appPrompt("Rename company document", document.name, { label: "Document name", confirmLabel: "Rename" }), document.name);
  if (!nextName || nextName === document.name) return;
  state.companyDocuments = state.companyDocuments.map((item) =>
    item.id === documentId ? { ...item, name: nextName } : item,
  );
  saveState();
  renderCompanyDocuments();
  showToast("Company document renamed");
}

function findManagedDocument(documentId) {
  const lead = state.contacts.find((contact) => (contact.documents || []).some((record) => record.id === documentId));
  const record = lead?.documents?.find((item) => item.id === documentId) || state.companyDocuments.find((item) => item.id === documentId);
  return { record, lead };
}

function renderDocumentOperations(document) {
  if(!document||!els.documentOperationsForm)return;
  const {lead}=findManagedDocument(document.id);const jobId=document.jobId||"";const access=state.documentAccess.find((item)=>item.documentId===document.id)||{customerVisible:false,downloadAllowed:true};
  els.documentOperationsTitle.textContent=document.name||"Document details";els.documentOperationsForm.elements.documentId.value=document.id;els.documentOperationsForm.elements.customerVisible.value=String(Boolean(access.customerVisible));els.documentOperationsForm.elements.downloadAllowed.value=String(access.downloadAllowed!==false);els.documentOperationsForm.elements.comment.value="";els.documentOperationsForm.elements.commentCustomerVisible.checked=false;
  const versions=(state.documentVersions||[]).filter((item)=>item.documentId===document.id).sort((a,b)=>b.versionNumber-a.versionNumber);els.documentVersionHistory.innerHTML=versions.length?versions.map((item)=>`<article><strong>Version ${item.versionNumber}</strong><span>${escapeHtml(item.fileName)} · ${escapeHtml(formatDateTime(item.createdAt))}</span></article>`).join(""):`<article><strong>Version ${document.versionNumber||1}</strong><span>${escapeHtml(document.name||"")} · current CRM file</span></article>`;
  const comments=(state.documentComments||[]).filter((item)=>item.documentId===document.id).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));els.documentCommentList.innerHTML=comments.length?comments.map((item)=>`<article><strong>${item.customerVisible?"Customer-visible":"Internal"}</strong><span>${nl2br(item.body)} · ${escapeHtml(formatDateTime(item.createdAt))}</span></article>`).join(""):'<div class="empty-state">No comments yet.</div>';
  els.documentOperationsForm.dataset.leadId=lead?.id||"";els.documentOperationsForm.dataset.jobId=jobId;setSaveState(els.documentOperationsStatus,"","");hydrateIcons(els.documentOperationsDialog);els.documentOperationsDialog.showModal();
}

async function saveDocumentOperations(event){event.preventDefault();const form=els.documentOperationsForm;const documentId=form.elements.documentId.value;const {record,lead}=findManagedDocument(documentId);if(!record)return;const leadId=lead?.id||"";const jobId=form.dataset.jobId||record.jobId||"";const access={documentId,contactId:leadId,jobId,customerVisible:form.elements.customerVisible.value==="true",downloadAllowed:form.elements.downloadAllowed.value==="true",updatedAt:new Date().toISOString()};const body=form.elements.comment.value.trim();const comment=body?{id:uid("doccomment"),documentId,contactId:leadId,jobId,body,customerVisible:form.elements.commentCustomerVisible.checked,createdAt:new Date().toISOString()}:null;
  try{if(canUseCloudSync()){const accessRow={company_state_id:supabaseStateId(),document_id:documentId,lead_id:leadId,job_id:jobId,customer_visible:access.customerVisible,download_allowed:access.downloadAllowed,updated_by:authSession.user.id};const {error:accessError}=await cloudClient.from("crm_document_access").upsert(accessRow,{onConflict:"company_state_id,document_id"});if(accessError)throw accessError;if(comment){const {error}=await cloudClient.from("crm_document_comments").insert({company_state_id:supabaseStateId(),id:comment.id,document_id:documentId,lead_id:leadId,job_id:jobId,body,customer_visible:comment.customerVisible,created_by:authSession.user.id});if(error)throw error;}await initializeDocumentOperations();}else{state.documentAccess=[access,...state.documentAccess.filter((item)=>item.documentId!==documentId)];if(comment)state.documentComments.unshift(comment);saveState({localOnly:true});}setSaveState(els.documentOperationsStatus,"Document settings saved","success");renderDocumentOperations(record);}catch(error){console.error(error);setSaveState(els.documentOperationsStatus,error?.message||"Document settings could not be saved","error");}}

function defaultSmartDocumentFields(lead) {
  return [
    { id: uid("smart-customer"), label: "Customer Name", type: "text", required: true, sourceName: "Customer Name", placeholder: "Customer name" },
    { id: uid("smart-date"), label: "Date", type: "date", required: true, sourceName: "Date", placeholder: "" },
    { id: uid("smart-notes"), label: "Representative Notes", type: "textarea", required: false, sourceName: "Notes", placeholder: "Enter document details" },
  ].map((field, index) => ({ ...field, defaultValue: index === 0 ? lead?.name || "" : index === 1 ? todayISO() : "" }));
}

function smartDocumentFieldRows() {
  return [...(els.smartDocumentFields?.querySelectorAll("[data-smart-field-id]") || [])].map((row) => ({
    id: row.dataset.smartFieldId,
    label: row.querySelector('[name="fieldLabel"]')?.value.trim() || "",
    type: row.querySelector('[name="fieldType"]')?.value || "text",
    required: Boolean(row.querySelector('[name="fieldRequired"]')?.checked),
    sourceName: row.querySelector('[name="fieldSourceName"]')?.value.trim() || "",
    placeholder: "",
    page: Math.max(1, Math.round(number(row.querySelector('[name="fieldPage"]')?.value) || 1)),
    x: row.querySelector('[name="fieldX"]')?.value === "" ? null : number(row.querySelector('[name="fieldX"]')?.value),
    y: row.querySelector('[name="fieldY"]')?.value === "" ? null : number(row.querySelector('[name="fieldY"]')?.value),
    width: row.querySelector('[name="fieldWidth"]')?.value === "" ? null : number(row.querySelector('[name="fieldWidth"]')?.value),
    height: row.querySelector('[name="fieldHeight"]')?.value === "" ? null : number(row.querySelector('[name="fieldHeight"]')?.value),
    fontSize: Math.max(6, Math.min(72, number(row.querySelector('[name="fieldFontSize"]')?.value) || 10)),
    fontFamily: row.querySelector('[name="fieldFontFamily"]')?.value || "Helvetica",
    bold: Boolean(row.querySelector('[name="fieldBold"]')?.checked),
    italic: Boolean(row.querySelector('[name="fieldItalic"]')?.checked),
    underline: Boolean(row.querySelector('[name="fieldUnderline"]')?.checked),
    textColor: row.querySelector('[name="fieldTextColor"]')?.value || "#071525",
    highlightColor: row.querySelector('[name="fieldHighlightEnabled"]')?.checked ? row.querySelector('[name="fieldHighlightColor"]')?.value || "#fff19a" : "",
    textAlign: row.querySelector('[name="fieldTextAlign"]')?.value || "left",
    detected: row.dataset.smartDetected === "true",
  }));
}

function smartDocumentResponseValues() {
  return Object.fromEntries([...(els.smartDocumentResponses?.querySelectorAll("[data-smart-response-id]") || [])].map((control) => [
    control.dataset.smartResponseId,
    ["checkbox", "radio"].includes(control.type) ? control.checked : control.value,
  ]));
}

function smartDocumentInput(field, value) {
  const common = `data-smart-response-id="${escapeHtml(field.id)}" ${field.required ? "required" : ""}`;
  if (["text", "textarea"].includes(field.type)) return `<textarea ${common} rows="${field.type === "textarea" ? 4 : 2}" wrap="soft" maxlength="20000" placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(value || "")}</textarea>`;
  if (["checkbox", "radio"].includes(field.type)) return `<span class="checkbox-input"><input ${common} type="${field.type}" ${value ? "checked" : ""} /><span>${field.type === "radio" ? "Selected" : "Yes, confirmed"}</span></span>`;
  const inputType = ["date", "number", "email"].includes(field.type) ? field.type : "text";
  return `<input ${common} type="${inputType}" value="${escapeHtml(value || "")}" maxlength="20000" placeholder="${escapeHtml(field.placeholder || "")}" ${inputType === "number" ? 'step="any"' : ""} />`;
}

