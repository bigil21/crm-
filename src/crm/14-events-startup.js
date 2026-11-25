function bindEvents() {
  bindDashboardWidgetEvents();
  document.querySelector(".menu-button")?.addEventListener("click", () => {
    const expanded = document.querySelector(".menu-button").getAttribute("aria-expanded") === "true";
    setSidebarMode(expanded ? "compact" : "expanded");
  });
  document.getElementById("sidebarBackdrop")?.addEventListener("click", () => setSidebarMode("compact"));
  document.getElementById("sidebarClose")?.addEventListener("click", () => {
    setSidebarMode("compact");
    document.querySelector(".menu-button")?.focus();
  });
  window.matchMedia("(min-width: 1441px)").addEventListener("change", renderSidebar);
  window.matchMedia("(max-width: 820px)").addEventListener("change", renderSidebar);
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      els.globalSearch.focus();
      els.globalSearch.select();
    }
    if (event.key === "Escape" && state.view === "pipeline" && state.pipelineSelectedOpportunity && !document.querySelector("dialog[open]")) {
      state.pipelineSelectedOpportunity = "";
      saveUiState();
      renderPipeline();
      return;
    }
    if (event.key === "Escape" && state.sidebarMode === "expanded" && window.matchMedia("(max-width: 820px)").matches) {
      setSidebarMode("compact");
      document.querySelector(".menu-button")?.focus();
    }
  });
  window.setInterval(refreshReminderDisplays, 60000);
  document.addEventListener("visibilitychange", refreshReminderDisplays);
  document.addEventListener("focusout", () => {
    if (!pendingDurableRender) return;
    window.setTimeout(() => {
      if (pendingDurableRender) renderDurableUpdateWhenIdle();
    }, 0);
  });

  document.addEventListener(
    "blur",
    (event) => {
      if (event.target instanceof HTMLInputElement) {
        if (event.target.matches("[data-phone-input]")) event.target.value = formatPhoneNumber(event.target.value);
        if (event.target.matches("[data-currency-input]")) event.target.value = formatCurrencyInput(event.target.value);
      }
    },
    true,
  );

  document.addEventListener("click", async (event) => {
    if (!event.target.closest(".global-search")) hideLiveSearchResults();

    const pipelineDivisionTab = event.target.closest("[data-pipeline-division-tab]");
    if (pipelineDivisionTab) {
      state.pipelineDivision = pipelineDivisionTab.dataset.pipelineDivisionTab;
      state.pipelineService = "all";
      state.pipelineAttention = "all";
      state.pipelineSelectedOpportunity = "";
      saveUiState();
      renderPipeline();
      return;
    }

    const pipelineAttention = event.target.closest("[data-pipeline-attention]");
    if (pipelineAttention) {
      state.pipelineAttention = pipelineAttention.dataset.pipelineAttention || "all";
      saveUiState();
      renderPipeline();
      return;
    }

    const uploadRetry = event.target.closest("[data-upload-retry]");
    if (uploadRetry) {
      void retryLeadUploads([uploadRetry.dataset.uploadRetry]);
      return;
    }
    const uploadList = event.target.closest("[data-upload-kind]");
    if (uploadList && event.target.closest("[data-upload-retry-all]")) {
      void retryLeadUploads(leadUploads.filter((item) => item.kind === uploadList.dataset.uploadKind && item.contactId === state.selectedContactId && item.status === "failed").map((item) => item.id));
      return;
    }
    const uploadRemove = event.target.closest("[data-upload-remove]");
    if (uploadRemove) {
      clearLeadUploads((item) => item.id === uploadRemove.dataset.uploadRemove && item.status === "failed");
      return;
    }
    if (uploadList && event.target.closest("[data-upload-clear]")) {
      clearLeadUploads((item) => item.kind === uploadList.dataset.uploadKind && item.contactId === state.selectedContactId && item.status === "saved");
      return;
    }

    if (event.target.closest("[data-recover-toggle]")) {
      const estimate = getSelectedEstimate();
      estimateRecoveryPanelFor = estimate && estimateRecoveryPanelFor !== estimate.id ? estimate.id : "";
      renderEstimateRecovery(estimate);
      return;
    }
    const recoverLine = event.target.closest("[data-recover-line]");
    if (recoverLine) {
      recoverEstimateLines([Number(recoverLine.dataset.recoverLine)], recoverLine.dataset.recoverMode, recoverLine.dataset.recoverTarget || "");
      return;
    }
    if (event.target.closest("[data-recover-all]")) {
      const estimate = getSelectedEstimate();
      recoverEstimateLines(estimateLinesToRecover(estimate, estimateRecoveryCopies.get(estimate?.id)).map((_line, index) => index));
      return;
    }
    if (event.target.closest("[data-recover-dismiss]")) {
      if (await appConfirm("These unsaved lines will not be offered again on this device.", { title: "Discard unsaved lines", confirmLabel: "Discard them" })) dismissEstimateRecovery();
      return;
    }

    if (event.target.closest("[data-pipeline-worklist-toggle]")) {
      state.pipelineWorklist = !state.pipelineWorklist;
      pipelineWorklistFormKey = "";
      saveUiState();
      renderPipeline();
      return;
    }

    const pipelineLogCall = event.target.closest("[data-pipeline-log-call]");
    if (pipelineLogCall) {
      pipelineWorklistFormKey = pipelineWorklistFormKey === pipelineLogCall.dataset.pipelineLogCall ? "" : pipelineLogCall.dataset.pipelineLogCall;
      renderPipeline();
      document.querySelector("[data-pipeline-call-form] select")?.focus();
      return;
    }

    if (event.target.closest("[data-pipeline-call-cancel]")) {
      pipelineWorklistFormKey = "";
      renderPipeline();
      return;
    }

    const pipelineGuidance = event.target.closest("[data-pipeline-guidance]");
    if (pipelineGuidance) {
      const stage = pipelineGuidance.dataset.pipelineGuidance;
      state.pipelineGuidanceStage = state.pipelineGuidanceStage === stage ? "" : stage;
      saveUiState();
      renderPipeline();
      return;
    }

    const pipelineOpen = event.target.closest("[data-pipeline-open]");
    if (pipelineOpen) {
      state.pipelineSelectedOpportunity = pipelineOpen.dataset.pipelineOpen;
      saveUiState();
      renderPipeline();
      return;
    }

    if (event.target.closest("[data-pipeline-close]")) {
      state.pipelineSelectedOpportunity = "";
      saveUiState();
      renderPipeline();
      return;
    }

    const pipelineMove = event.target.closest("[data-pipeline-move]");
    if (pipelineMove) {
      await movePipelineOpportunity(pipelineMove.dataset.contactId, pipelineMove.dataset.jobId, pipelineMove.dataset.pipelineMove);
      return;
    }

    const reminderFilter = event.target.closest("[data-reminder-filter]");
    if (reminderFilter) {
      state.reminderFilter = reminderFilter.dataset.reminderFilter;
      setView("tasks");
      return;
    }

    const dashboardStage = event.target.closest("[data-dashboard-stage]");
    if (dashboardStage) {
      state.leadStageFilter = dashboardStage.dataset.dashboardStage || "";
      state.search = "";
      state.view = "leads";
      saveUiState();
      render();
      return;
    }

    const navButton = event.target.closest("[data-view]");
    if (navButton) {
      if (state.sidebarMode === "expanded" && window.matchMedia("(max-width: 820px)").matches) setSidebarMode("compact");
      if (navButton.dataset.view === "tasks") state.reminderFilter = "all";
      if (navButton.dataset.view === "leads") state.leadStageFilter = "";
      setView(navButton.dataset.view);
    }

    const filterButton = event.target.closest("[data-pipeline-filter]");
    if (filterButton) {
      state.pipelineFilter = filterButton.dataset.pipelineFilter;
      saveUiState();
      renderPipeline();
    }

    const leaderboardButton = event.target.closest("[data-leaderboard-range]");
    if (leaderboardButton) {
      state.leaderboardRange = leaderboardButton.dataset.leaderboardRange;
      saveUiState();
      renderDashboard();
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    const { action, contactId, nextStatus, lineIndex } = actionButton.dataset;
    const permission = actionPermissions[action];
    if (permission && !requireAction(permission)) return;
    if (action === "load-more-leads") {
      await loadServerRecordPage("leads", { append: true });
      return;
    }
    if (action === "load-more-jobs") {
      await loadServerRecordPage("jobs", { append: true });
      return;
    }
    if (action === "show-more-job-photos") {
      const jobId = actionButton.dataset.jobId || "";
      photoDisplayLimits.set(jobId, (photoDisplayLimits.get(jobId) || PHOTO_PAGE_SIZE) + PHOTO_PAGE_SIZE);
      const contact = getSelectedContact();
      if (contact) renderLeadPhotos(contact);
      return;
    }
    if (action === "show-more-lead-documents") {
      const displayKey = actionButton.dataset.displayKey || "";
      leadDocumentDisplayLimits.set(displayKey, (leadDocumentDisplayLimits.get(displayKey) || DOCUMENT_PAGE_SIZE) + DOCUMENT_PAGE_SIZE);
      const contact = getSelectedContact();
      if (contact) renderLeadDocuments(contact);
      return;
    }
    if (action === "show-more-company-documents") {
      const folderId = actionButton.dataset.folderId || "";
      companyDocumentDisplayLimits.set(folderId, (companyDocumentDisplayLimits.get(folderId) || DOCUMENT_PAGE_SIZE) + DOCUMENT_PAGE_SIZE);
      renderCompanyDocuments();
      return;
    }
    if (action === "review-follow-up-estimate") {
      const estimate = visibleEstimates().find((item) => item.id === actionButton.dataset.estimateId);
      if (estimate && canView("estimates")) {
        state.search = "";
        state.selectedEstimateId = estimate.id;
        state.selectedContactId = estimate.contactId;
        setView("estimates");
      }
      return;
    }
    if (action === "download-document") await downloadManagedDocument(actionButton.dataset.documentId);
    if (action === "document-operations") { const {record}=findManagedDocument(actionButton.dataset.documentId); if(record) renderDocumentOperations(record); }
    if (action === "sync-google-drive-document") {
      const outcome = await syncDocumentsToGoogleDrive([actionButton.dataset.documentId], { force: true });
      showToast(outcome.synced ? "Drive copy completed" : outcome.skipped ? "Company Drive is not configured yet" : "Drive copy needs attention");
    }
    if (action === "prepare-zoho-smart-document") {
      const { record } = findManagedDocument(actionButton.dataset.documentId);
      if (record) openZohoSignDialog(record);
    }
    if (action === "open-smart-document") {
      const { record } = findManagedDocument(actionButton.dataset.documentId);
      if (record) await openSmartDocumentDialog(record);
    }
    if (action === "open-estimate-lead") {
      await openEstimateLeadOverview(contactId);
      return;
    }
    if (action === "add-customer") openContactDialog(null, { type: "Customer" });
    if (action === "open-contact") openLeadDetail(contactId);
    if (action === "open-contact-tab") openLeadDetail(contactId, actionButton.dataset.tab || "overview", actionButton.dataset.jobId || "");
    if (action === "sync-google-contact") await syncLeadToGoogleContacts(contactId);
    if (action === "open-job") openLeadJob(contactId, actionButton.dataset.jobId);
    if (action === "open-job-photos") openLeadJobPhotos(contactId, actionButton.dataset.jobId);
    if (action === "refresh-weather") loadWeather({ force: true });
    if (action === "edit-contact") openContactDialog(contactId);
    if (action === "estimate-contact") await createEstimate(contactId);
    if (action === "estimate-job") await createEstimate(contactId, true, actionButton.dataset.jobId);
    if (action === "go-to-settings") { state.view = "company"; saveUiState(); render(); }
    if (action === "clear-lead-stage-filter") {
      state.leadStageFilter = "";
      saveUiState();
      void loadServerRecordPage("leads");
      renderLeadsView();
    }
    if (action === "select-estimate") {
      state.view = "estimates";
      setSelectedEstimate(actionButton.dataset.estimateId);
      render();
    }
    if (action === "advance-contact") {
      const before = getContact(contactId);
      const beforeJob = before ? primaryJob(before) : null;
      if (beforeJob) {
        const updated = applyStatusUpdate(contactId, nextStatus);
        const updatedJob = updated ? contactJobs(updated).find((job) => job.id === beforeJob.id) : null;
        if (updatedJob?.status !== beforeJob.status) {
          saveState({ localOnly: true });
          render();
          const updateId = updated?.updates?.[0]?.id || "";
          if (canUseCloudSync()) {
            try {
              const saved = await persistLeadJobRecord(updatedJob.id, updateId);
              if (saved) queueCloudSave();
              else queueDurableRecordsSave();
              if (saved && ["Won", "Scheduled", "Materials Ordered", "In Progress", "Completed", "Paid"].includes(updatedJob.status)) {
                void notifyGoogleChat(updatedJob.status === "Won" ? "estimate_won" : "production_stage", `${updated.name} — ${updatedJob.name}: ${updatedJob.status}`);
              }
            } catch {
              queueDurableRecordsSave();
            }
          }
        } else {
          render();
        }
      }
    }
    if (action === "remove-line") {
      const estimate = getSelectedEstimate();
      const removeIndex = estimate ? estimateLineIndex(estimate, actionButton.closest(".line-item") || { dataset: { lineIndex } }) : -1;
      if (estimate && estimate.items.length > 1 && estimate.items[removeIndex]) {
        estimate.items.splice(removeIndex, 1);
        queueLocalStateSave();
        renderEstimateLineItems(estimate);
        queueEstimateVerifiedSave(estimate.id);
        scheduleEstimateVisualRefresh(estimate.id);
      }
    }
    if (action === "remove-document") {
      removeLeadDocument(actionButton.dataset.documentId);
    }
    if (action === "rename-document") {
      renameLeadDocument(actionButton.dataset.documentId);
    }
    if (action === "upload-to-category") {
      if (els.leadDocumentCategory) els.leadDocumentCategory.value = actionButton.dataset.categoryId;
      els.leadDocumentInput.value = "";
      els.leadDocumentInput.click();
    }
    if (action === "remove-company-document") {
      removeCompanyDocument(actionButton.dataset.documentId);
    }
    if (action === "rename-company-document") {
      renameCompanyDocument(actionButton.dataset.documentId);
    }
    if (action === "open-company-document-folder") {
      selectedCompanyDocumentFolderId = actionButton.dataset.folderId || "";
      renderCompanyDocuments();
    }
    if (action === "close-company-document-folder") {
      selectedCompanyDocumentFolderId = "";
      renderCompanyDocuments();
    }
    if (action === "rename-company-document-folder") {
      void renameCompanyDocumentFolder(actionButton.dataset.folderId || "");
    }
    if (action === "delete-company-document-folder") {
      void deleteCompanyDocumentFolder(actionButton.dataset.folderId || "");
    }
    if (action === "edit-document-category") {
      editDocumentCategory(actionButton.dataset.categoryId, actionButton.closest(".document-category-admin-row"));
    }
    if (action === "toggle-document-category") {
      toggleDocumentCategory(actionButton.dataset.categoryId);
    }
    if (action === "delete-document-category") {
      deleteDocumentCategory(actionButton.dataset.categoryId);
    }
    if (action === "merge-document-category") {
      const row = actionButton.closest(".document-category-admin-row");
      mergeDocumentCategory(actionButton.dataset.categoryId, row?.querySelector("[data-merge-target]")?.value);
    }
    if (action === "move-document-category-up") {
      moveDocumentCategory(actionButton.dataset.categoryId, -1);
    }
    if (action === "move-document-category-down") {
      moveDocumentCategory(actionButton.dataset.categoryId, 1);
    }
    if (action === "edit-job") {
      editLeadJob(actionButton.dataset.jobId);
    }
    if (action === "delete-job") {
      deleteLeadJob(actionButton.dataset.jobId);
    }
    if (action === "toggle-job-milestone") {
      await toggleJobMilestone(actionButton.dataset.milestoneId);
    }
    if (action === "delete-job-milestone") {
      await deleteJobMilestone(actionButton.dataset.milestoneId);
    }
    if (action === "open-job-profit") {
      state.selectedProfitJobId = actionButton.dataset.jobId;
      openLeadDetail(contactId, "profit");
    }
    if (action === "edit-cost-item") {
      editCostItem(actionButton.dataset.costId);
    }
    if (action === "delete-cost-item") {
      deleteCostItem(actionButton.dataset.costId);
    }
    if (action === "edit-manual-payment") {
      editManualPayment(actionButton.dataset.paymentId);
    }
    if (action === "delete-manual-payment") {
      await deleteManualPayment(actionButton.dataset.paymentId);
    }
    if (action === "open-calendar-task") {
      editCalendarTask(actionButton.dataset.taskId);
    }
    if (action === "edit-calendar-task") {
      editCalendarTask(actionButton.dataset.taskId);
    }
    if (action === "complete-calendar-task") {
      completeCalendarTask(actionButton.dataset.taskId);
    }
    if (action === "reopen-calendar-task") {
      void reopenCalendarTask(actionButton.dataset.taskId);
    }
    if (action === "delete-calendar-task") {
      deleteCalendarTask(actionButton.dataset.taskId);
    }
    if (action === "toggle-task-checklist") {
      event.preventDefault();
      await toggleTaskChecklist(actionButton.dataset.taskId, actionButton.dataset.checklistId);
    }
    if (action === "toggle-task-timer") {
      await toggleTaskTimer(actionButton.dataset.taskId);
    }
  });

  document.addEventListener("submit", async (event) => {
    const callForm = event.target.closest?.("[data-pipeline-call-form]");
    if (callForm) {
      event.preventDefault();
      const data = new FormData(callForm);
      const button = callForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      const saved = await logPipelineCall(callForm.dataset.contactId, callForm.dataset.jobId, {
        outcome: data.get("outcome"), note: data.get("note"), nextAt: data.get("nextAt"),
        noFollowUp: data.get("noFollowUp") === "on", decisionDate: data.get("decisionDate"), completeTask: data.get("completeTask") === "on",
      });
      // A refused entry leaves the form as the rep filled it in.
      if (!saved && button?.isConnected) button.disabled = false;
      return;
    }
    const form = event.target.closest?.("[data-task-comment-form]");
    if (!form) return;
    event.preventDefault();
    const body = new FormData(form).get("comment");
    form.reset();
    await addTaskComment(form.dataset.taskId, body);
  });

  document.addEventListener("click", (event) => {
    const tabButton = event.target.closest("[data-lead-tab]");
    if (!tabButton) return;
    if (tabButton.dataset.leadTab === "payments" && !canManageManualPayments()) {
      showToast("Only an administrator can view payments");
      return;
    }
    state.leadDetailTab = tabButton.dataset.leadTab;
    saveUiState();
    renderLeadDetail();
  });

  const selectLiveSearchResult = (event) => {
    const result = event.target.closest("[data-live-search-contact]");
    if (!result) return;
    event.preventDefault();
    event.stopPropagation();
    openLiveSearchResult(result.dataset.liveSearchContact, result.dataset.liveSearchJob);
  };
  els.globalSearchResults.addEventListener("pointerdown", selectLiveSearchResult);
  els.globalSearchResults.addEventListener("click", selectLiveSearchResult);

  els.globalSearch.addEventListener("input", (event) => {
    state.search = event.target.value;
    liveSearchActiveIndex = -1;
    renderSearchFilteredView();
    renderLiveSearchResults();
    window.clearTimeout(serverSearchTimer);
    if (recordPageClient && state.search.trim()) {
      const query = state.search;
      serverSearchTimer = window.setTimeout(() => void loadServerSearchResults(query), 180);
    }
  });
  els.globalSearch.addEventListener("focus", renderLiveSearchResults);
  els.globalSearch.addEventListener("keydown", (event) => {
    const { matches } = liveLeadSearchMatches();
    if (event.key === "Escape") {
      hideLiveSearchResults();
      els.globalSearch.blur();
      return;
    }
    if (!matches.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      liveSearchActiveIndex = (liveSearchActiveIndex + 1) % matches.length;
      renderLiveSearchResults();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      liveSearchActiveIndex = liveSearchActiveIndex <= 0 ? matches.length - 1 : liveSearchActiveIndex - 1;
      renderLiveSearchResults();
    } else if (event.key === "Enter") {
      event.preventDefault();
      const contact = matches[Math.max(liveSearchActiveIndex, 0)];
      openLiveSearchResult(contact?.id, contact && searchResultJob(contact, state.search)?.id);
    }
  });

  els.importZohoButton.addEventListener("click", () => {
    if (!requireAction("manageContacts")) return;
    els.zohoCsvInput.value = "";
    els.zohoCsvInput.click();
  });
  els.zohoCsvInput.addEventListener("change", async (event) => {
    if (!requireAction("manageContacts")) return;
    try {
      await importZohoCsv(event.target.files?.[0]);
    } catch {
      showToast("Zoho import failed. Check that the file is a CSV export.");
    }
  });

  els.addContactButton.addEventListener("click", () => {
    if (requireAction("manageContacts")) openContactDialog(null, { type: "Lead" });
  });
  els.addLeadFromLeadsButton.addEventListener("click", () => {
    if (requireAction("manageContacts")) openContactDialog(null, { type: "Lead" });
  });
  els.backToContactsButton.addEventListener("click", () => setView("contacts"));
  els.editLeadDetailButton.addEventListener("click", () => {
    const contact = getSelectedContact();
    if (contact && requireAction("manageContacts")) openContactDialog(contact.id);
  });
  els.emailLeadDetailButton.addEventListener("click", () => {
    const contact = getSelectedContact();
    if (contact && requireAction("sendEmail")) openLeadDetail(contact.id, "email");
  });
  els.estimateLeadDetailButton.addEventListener("click", async () => {
    const contact = getSelectedContact();
    // The estimate is for the job selected on this lead, not always its first job.
    if (contact && requireAction("manageEstimates")) await createEstimate(contact.id, true, state.selectedLeadJobId || "");
  });
  els.uploadLeadDocumentButton.addEventListener("click", () => {
    if (!requireAction("manageDocuments")) return;
    els.leadDocumentInput.value = "";
    els.leadDocumentInput.click();
  });
  els.generateGoogleDocButton?.addEventListener("click", generateLeadGoogleDocument);
  els.leadDocumentInput.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    try {
      await uploadLeadDocuments(files);
    } catch (error) {
      console.warn("Lead document upload failed", error);
      const message = documentUploadErrorMessage(error);
      setSaveState(els.leadDocumentUploadStatus, message, "error");
      showToast(message);
      els.uploadLeadDocumentButton.disabled = false;
    } finally {
      event.target.value = "";
    }
  });
  els.leadDocumentJobSelect?.addEventListener("change", (event) => {
    const contact = getSelectedContact();
    if (!contact || !contactJobs(contact).some((job) => job.id === event.target.value)) return;
    state.selectedLeadJobId = event.target.value;
    state.selectedProfitJobId = event.target.value;
    saveUiState();
    renderLeadDetail();
  });
  els.leadPhotoJobSelect?.addEventListener("change", (event) => {
    const contact = getSelectedContact();
    if (!contact) return;
    if (!contactJobs(contact).some((job) => job.id === event.target.value)) return;
    state.selectedLeadJobId = event.target.value;
    state.selectedProfitJobId = event.target.value;
    saveUiState();
    renderLeadDetail();
  });
  els.uploadLeadPhotoButton?.addEventListener("click", () => {
    if (!requireAction("manageDocuments")) return;
    els.leadPhotoInput.value = "";
    els.leadPhotoInput.click();
  });
  els.leadPhotoInput?.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    try {
      await uploadLeadPhotos(files);
    } catch (error) {
      console.warn("Job photo upload failed", error);
      const message = documentUploadErrorMessage(error);
      setSaveState(els.leadPhotoUploadStatus, message, "error");
      showToast(message);
      els.uploadLeadPhotoButton.disabled = !canAction("manageDocuments");
    } finally {
      event.target.value = "";
    }
  });
  els.leadConversationForm.addEventListener("submit", submitLeadConversation);
  els.leadJobForm.addEventListener("submit", saveLeadJob);
  els.operationsJobSelect?.addEventListener("change", (event) => {
    const contact = getSelectedContact();
    if (!contact || !contactJobs(contact).some((job) => job.id === event.target.value)) return;
    state.selectedLeadJobId = event.target.value;
    state.selectedProfitJobId = event.target.value;
    saveUiState();
    renderLeadOperations(contact);
  });
  els.permitForm?.addEventListener("submit", guardedSubmit(savePermit));
  els.inspectionForm?.addEventListener("submit", guardedSubmit(saveInspection));
  els.selectionForm?.addEventListener("submit", guardedSubmit(saveSelection));
  els.changeOrderForm?.addEventListener("submit", guardedSubmit(saveChangeOrder));
  els.progressBillingForm?.addEventListener("submit", guardedSubmit(saveProgressBilling));
  els.maintenancePlanForm?.addEventListener("submit", guardedSubmit(saveMaintenancePlan));
  els.customerAccountForm?.addEventListener("submit", guardedSubmit(saveCustomerAccount));
  els.accountPropertyLinkForm?.addEventListener("submit", guardedSubmit(saveAccountPropertyLink));
  els.leadOperationsPanel?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-create-progress-invoice]");
    if (button) void createProgressDrawInvoice(button.dataset.createProgressInvoice);
    const removal = event.target.closest("[data-operation-delete]");
    if (removal) void confirmDeleteJobOperation(removal.dataset.operationDelete, removal.dataset.operationId);
  });
  els.leadOperationsPanel?.addEventListener("change", async (event) => {
    const select = event.target.closest("[data-operation-update]");
    if (!select) return;
    const table = select.dataset.operationUpdate;
    const field = select.dataset.operationField;
    if (!operationsTableStateMap[table] || !["status", "result", "active"].includes(field)) return;
    const value = field === "active" ? select.value === "true" : select.value;
    select.disabled = true;
    const previousValue = (state[operationsTableStateMap[table]] || []).find((item) => item.id === select.dataset.operationId)?.[field];
    try {
      await updateJobOperation(table, select.dataset.operationId, { [field]: value });
      renderLeadOperations(getSelectedContact());
      setOperationsStatus("Status updated");
      if (table === "crm_change_orders" && field === "status" && await reconcileChangeOrderWithContract(select.dataset.operationId, previousValue, value)) renderLeadDetail();
    } catch (error) {
      renderLeadOperations(getSelectedContact());
      setOperationsStatus(error.message || "Status could not be updated", "error");
    }
  });
  els.jobMilestoneForm?.addEventListener("submit", saveJobMilestone);
  els.projectMemberForm?.addEventListener("submit", guardedSubmit(saveProjectMember));
  els.projectNoteForm?.addEventListener("submit", guardedSubmit(saveProjectNote));
  els.projectDiscussionForm?.addEventListener("submit", guardedSubmit(saveProjectDiscussion));
  els.toggleJobTimerButton?.addEventListener("click", toggleJobDeliveryTimer);
  els.applyProjectTemplateButton?.addEventListener("click", applySelectedProjectTemplate);
  els.clearJobFormButton.addEventListener("click", () => fillJobForm());
  els.profitJobSelect?.addEventListener("change", (event) => {
    if (!requireAction("manageJobFinancials")) return;
    state.selectedLeadJobId = event.target.value;
    state.selectedProfitJobId = event.target.value;
    saveUiState();
    renderLeadDetail();
  });
  els.profitCostForm?.addEventListener("submit", saveProfitCost);
  els.clearProfitCostForm?.addEventListener("click", () => fillProfitCostForm());
  els.paymentJobSelect?.addEventListener("change", (event) => {
    if (!canManageManualPayments()) return;
    const contact = getSelectedContact();
    if (!contact || !contactJobs(contact).some((job) => job.id === event.target.value)) return;
    state.selectedLeadJobId = event.target.value;
    state.selectedProfitJobId = event.target.value;
    fillManualPaymentForm();
    setSaveState(els.manualPaymentSaveStatus, "", "");
    saveUiState();
    renderLeadDetail();
  });
  els.manualPaymentForm?.addEventListener("submit", saveManualPayment);
  els.clearManualPaymentForm?.addEventListener("click", () => fillManualPaymentForm());
  els.leadEmailForm.addEventListener("submit", submitLeadEmail);
  els.scheduleLeadEmailButton?.addEventListener("click", scheduleLeadEmail);
  els.leadEmailTemplate?.addEventListener("change", (event) => {
    const contact = getSelectedContact();
    if (contact) applyLeadEmailTemplate(contact, selectedLeadJob(contact), event.target.value);
  });
  els.leadEmailJobSelect?.addEventListener("change", (event) => {
    const contact = getSelectedContact();
    if (!contact || !contactJobs(contact).some((job) => job.id === event.target.value)) return;
    state.selectedLeadJobId = event.target.value;
    state.selectedProfitJobId = event.target.value;
    saveUiState();
    renderLeadDetail();
  });
  els.copyLeadEmailButton.addEventListener("click", copyLeadEmail);
  els.refreshLeadEmailThreadsButton?.addEventListener("click", refreshLeadEmailThreads);
  els.reportExportButton?.addEventListener("click",()=>void exportPerformanceReport());
  els.googleSheetsExportButton?.addEventListener("click",()=>void exportPerformanceReportToGoogleSheets());
  els.adminTaxForm?.addEventListener("submit", guardedSubmit(saveAdminTax));
  els.adminAnnouncementForm?.addEventListener("submit", guardedSubmit(saveAdminAnnouncement));
  els.customerPortalInviteForm?.addEventListener("submit", guardedSubmit(inviteCustomerPortal));
  els.documentOperationsForm?.addEventListener("submit", saveDocumentOperations);
  els.closeDocumentOperationsDialog?.addEventListener("click",()=>els.documentOperationsDialog?.close());
  els.uploadCompanyDocumentButton.addEventListener("click", () => {
    if (!requireAction("manageDocuments")) return;
    els.companyDocumentInput.value = "";
    els.companyDocumentInput.click();
  });
  els.createCompanyDocumentFolderButton?.addEventListener("click", createCompanyDocumentFolder);
  els.companyDocumentsList?.addEventListener("keydown", (event) => {
    const folder = event.target.closest('[data-action="open-company-document-folder"]');
    if (!folder || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    selectedCompanyDocumentFolderId = folder.dataset.folderId || "";
    renderCompanyDocuments();
  });
  els.companyDocumentsList?.addEventListener("change", (event) => {
    const selector = event.target.closest("[data-company-document-folder]");
    if (selector) void moveCompanyDocumentToFolder(selector.dataset.companyDocumentFolder, selector.value);
  });
  els.companyDocumentInput.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    try {
      await uploadCompanyDocuments(files);
    } catch (error) {
      console.warn("Company document upload failed", error);
      const message = documentUploadErrorMessage(error);
      setSaveState(els.companyDocumentUploadStatus, message, "error");
      showToast(message);
      els.uploadCompanyDocumentButton.disabled = false;
    } finally {
      event.target.value = "";
    }
  });
  els.uploadCompanyLogoButton.addEventListener("click", () => {
    if (!requireAction("manageCompany")) return;
    els.companyLogoInput.value = "";
    els.companyLogoInput.click();
  });
  els.companyLogoInput.addEventListener("change", async (event) => {
    try {
      await uploadCompanyLogo(event.target.files?.[0]);
    } catch {
      showToast("Logo upload failed");
    }
  });
  els.removeCompanyLogoButton.addEventListener("click", removeCompanyLogo);
  els.calendarTaskForm.addEventListener("submit", saveCalendarTask);
  els.calendarTaskForm.elements.rep?.addEventListener("input", renderCalendarGoogleDestination);
  els.calendarTaskForm.elements.rep?.addEventListener("change", renderCalendarGoogleDestination);
  els.calendarTaskContact?.addEventListener("change", (event) => renderCalendarTaskJobOptions(event.target.value, ""));
  bindCalendarCanvasEvents();
  els.connectGoogleWorkspaceButton?.addEventListener("click", connectGoogleWorkspace);
  els.verifyGoogleDriveButton?.addEventListener("click", verifyGoogleDriveConnection);
  els.calendarGoogleConnectButton?.addEventListener("click", connectGoogleWorkspace);
  els.disconnectGoogleWorkspaceButton?.addEventListener("click", disconnectGoogleWorkspace);
  els.connectZohoSignButton?.addEventListener("click", connectZohoSign);
  els.disconnectZohoSignButton?.addEventListener("click", disconnectZohoSign);
  els.zohoSignForm?.addEventListener("submit", prepareZohoSmartDocument);
  els.closeZohoSignDialog?.addEventListener("click", () => els.zohoSignDialog.close());
  els.cancelZohoSignDialog?.addEventListener("click", () => els.zohoSignDialog.close());
  els.addSmartDocumentField?.addEventListener("click", () => {
    smartDocumentPlacementTool = "text";
    smartDocumentPlacementLabel = "";
    document.querySelectorAll("[data-smart-tool]").forEach((button) => button.classList.toggle("active", button.dataset.smartTool === "text"));
    if (els.smartDocumentCanvasHelp) els.smartDocumentCanvasHelp.textContent = "Click the exact location on a document page where the new text field should appear.";
  });
  els.analyzeSmartDocument?.addEventListener("click", analyzeSmartDocumentPages);
  els.deleteSelectedSmartField?.addEventListener("click", deleteSelectedSmartDocumentField);
  document.querySelectorAll("[data-smart-tool]").forEach((button) => button.addEventListener("click", () => {
    smartDocumentPlacementTool = button.dataset.smartTool;
    smartDocumentPlacementLabel = button.dataset.smartLabel || "";
    document.querySelectorAll("[data-smart-tool]").forEach((item) => item.classList.toggle("active", item === button));
    if (els.smartDocumentCanvasHelp) els.smartDocumentCanvasHelp.textContent = `Click the exact location on a page for the new ${button.textContent.trim().toLowerCase()} field.`;
  }));
  document.querySelectorAll("[data-smart-tool]").forEach((button) => button.addEventListener("dragstart", (event) => {
    const payload = JSON.stringify({ type: button.dataset.smartTool, label: button.dataset.smartLabel || button.textContent.trim() });
    event.dataTransfer?.setData("application/x-jobcrest-smart-field", payload);
    event.dataTransfer?.setData("text/plain", button.textContent.trim());
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
  }));
  els.smartDocumentZoomOut?.addEventListener("click", () => setSmartDocumentZoom(smartDocumentZoom - 0.1));
  els.smartDocumentZoomIn?.addEventListener("click", () => setSmartDocumentZoom(smartDocumentZoom + 0.1));
  els.smartDocumentZoomFit?.addEventListener("click", () => setSmartDocumentZoom(1, { fit: true }));
  els.smartDocumentPageNumber?.addEventListener("change", (event) => scrollToSmartDocumentPage(event.target.value));
  els.smartDocumentFields?.addEventListener("change", refreshSmartDocumentResponses);
  els.smartDocumentFields?.addEventListener("input", (event) => {
    const row = event.target.closest("[data-smart-field-id]");
    if (!row) return;
    const fieldId = row.dataset.smartFieldId;
    if (event.target.name === "fieldLabel") {
      const label = event.target.value || "Untitled field";
      const overlayHandle = els.smartDocumentPages?.querySelector(`[data-smart-overlay-id="${CSS.escape(fieldId)}"] .smart-field-drag-handle`);
      if (overlayHandle) { overlayHandle.textContent = label; overlayHandle.title = `Drag to move ${label}; use arrow keys for precise movement`; overlayHandle.setAttribute("aria-label", `Move ${label}`); }
      const responseLabel = els.smartDocumentResponses?.querySelector(`[data-smart-response-id="${CSS.escape(fieldId)}"]`)?.closest("label")?.querySelector("span");
      if (responseLabel) responseLabel.textContent = `${label}${row.querySelector('[name="fieldRequired"]')?.checked ? " *" : ""}`;
    }
    if (event.target.name === "fieldFontSize") {
      const control = els.smartDocumentPages?.querySelector(`[data-smart-overlay-id="${CSS.escape(fieldId)}"] [data-smart-overlay-input]`);
      if (control) control.style.fontSize = `${Math.max(6, Math.min(72, number(event.target.value) || 10))}px`;
    }
    if (["fieldFontFamily", "fieldBold", "fieldItalic", "fieldUnderline", "fieldTextColor", "fieldHighlightEnabled", "fieldHighlightColor", "fieldTextAlign"].includes(event.target.name)) {
      renderSmartDocumentOverlays(smartDocumentFieldRows(), smartDocumentResponseValues());
    }
  });
  els.smartDocumentFields?.addEventListener("click", (event) => {
    const selectedRow = event.target.closest("[data-smart-field-id]");
    if (selectedRow) updateSmartDocumentSelection(selectedRow.dataset.smartFieldId);
    const remove = event.target.closest("[data-remove-smart-field]");
    if (!remove) return;
    const responses = smartDocumentResponseValues();
    const fields = smartDocumentFieldRows().filter((field) => field.id !== remove.dataset.removeSmartField);
    if (selectedSmartDocumentFieldId === remove.dataset.removeSmartField) selectedSmartDocumentFieldId = "";
    renderSmartDocumentEditor(fields, responses);
  });
  els.smartDocumentResponses?.addEventListener("input", (event) => {
    const control = event.target.closest("[data-smart-response-id]");
    if (!control) return;
    const overlay = els.smartDocumentPages?.querySelector(`[data-smart-overlay-id="${CSS.escape(control.dataset.smartResponseId)}"] [data-smart-overlay-input]`);
    if (!overlay) return;
    if (["checkbox", "radio"].includes(overlay.type)) overlay.checked = control.checked;
    else overlay.value = control.value;
    growSmartOverlayToContent(overlay.closest("[data-smart-overlay-id]"));
  });
  els.saveSmartDocumentTemplate?.addEventListener("click", () => saveNativeSmartDocument("template"));
  els.saveSmartDocumentDraft?.addEventListener("click", () => saveNativeSmartDocument("draft"));
  els.completeSmartDocument?.addEventListener("click", () => saveNativeSmartDocument("completed"));
  els.emailSmartDocument?.addEventListener("click", emailNativeSmartDocument);
  els.closeSmartDocumentDialog?.addEventListener("click", closeSmartDocumentDialog);
  els.smartDocumentDialog?.addEventListener("cancel", (event) => { event.preventDefault(); closeSmartDocumentDialog(); });

  els.calPrevMonth?.addEventListener("click", () => calendarNavigate(-1));
  els.calNextMonth?.addEventListener("click", () => calendarNavigate(1));
  els.closeContactDialog.addEventListener("click", () => els.contactDialog.close());
  els.closeInvoicePaymentDialog?.addEventListener("click", () => els.invoicePaymentDialog.close());
  els.closeInvoiceCreditDialog?.addEventListener("click", () => els.invoiceCreditDialog.close());
  els.closeFinanceExpenseDialog?.addEventListener("click", () => els.financeExpenseDialog.close());
  els.closeInvoiceRefundDialog?.addEventListener("click", () => els.invoiceRefundDialog.close());
  els.closeInvoiceScheduleDialog?.addEventListener("click", () => els.invoiceScheduleDialog.close());
  els.invoicePaymentForm?.addEventListener("submit", recordInvoicePayment);
  els.invoiceCreditForm?.addEventListener("submit", applyInvoiceCredit);
  els.financeExpenseForm?.addEventListener("submit", recordFinanceExpense);
  els.financeExpenseForm?.elements.leadId?.addEventListener("change", populateExpenseJobOptions);
  els.invoiceRefundForm?.addEventListener("submit", recordInvoiceRefund);
  els.invoiceScheduleForm?.addEventListener("submit", saveInvoiceSchedule);
  els.contactForm.addEventListener("submit", saveContactFromForm);
  els.contactForm.elements.division?.addEventListener("change", () => refreshDivisionForm(els.contactForm));
  els.leadJobForm.elements.division?.addEventListener("change", () => refreshDivisionForm(els.leadJobForm));
  els.deleteContactButton.addEventListener("click", () => {
    if (!requireAction("manageContacts")) return;
    const id = els.contactForm.elements.id.value;
    if (id) deleteContact(id);
  });
  els.estimateFromContactButton.addEventListener("click", async () => {
    if (!requireAction("manageEstimates")) return;
    const id = els.contactForm.elements.id.value;
    if (id) {
      els.contactDialog.close();
      await createEstimate(id);
    }
  });

  els.estimateList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-estimate-id]");
    if (button) {
      setSelectedEstimate(button.dataset.estimateId);
      els.estimateHistoryPanel?.classList.add("hidden");
      els.toggleEstimateHistoryButton?.setAttribute("aria-expanded", "false");
    }
  });

  els.leadStageFilter?.addEventListener("change", (event) => {
    state.leadStageFilter = allPipelineStages().includes(event.target.value) ? event.target.value : "";
    state.savedLeadFilterId = "";
    saveUiState();
    void loadServerRecordPage("leads");
    renderLeadsView();
  });
  document.addEventListener("change", (event) => {
    if (event.target.matches("[data-pipeline-division]")) {
      state.pipelineDivision = event.target.value;
      saveUiState();
      renderPipeline();
      return;
    }
    if (event.target.matches("[data-pipeline-control]")) {
      const key = event.target.dataset.pipelineControl;
      if (["pipelinePropertyType", "pipelineRep", "pipelineService", "pipelineSource", "pipelineUrgency", "pipelineDateRange"].includes(key)) {
        state[key] = event.target.value || "all";
        state.pipelineSelectedOpportunity = "";
        saveUiState();
        renderPipeline();
      }
      return;
    }
    if (event.target.matches('[data-pipeline-call-form] [name="noFollowUp"]')) {
      const nextAt = event.target.form?.elements?.nextAt;
      if (nextAt) nextAt.disabled = event.target.checked;
      return;
    }
    if (event.target.matches("[data-pipeline-stale-days]")) {
      state.pipelineStaleDays = Math.min(90, Math.max(1, Math.round(number(event.target.value) || 7)));
      saveUiState();
      renderPipeline();
      return;
    }
    if (event.target.matches("[data-pipeline-checklist]")) {
      window.RooflineWorkflowChecklist?.updateChecklistItem?.(
        event.target.dataset.contactId,
        event.target.dataset.jobId,
        event.target.dataset.stage,
        event.target.dataset.itemId,
        event.target.checked,
      );
      window.setTimeout(renderPipeline, 0);
    }
  });

  let pipelineDraggedOpportunity = "";
  document.addEventListener("dragstart", (event) => {
    const card = event.target.closest("[data-pipeline-card]");
    if (!card) return;
    pipelineDraggedOpportunity = card.dataset.pipelineCard;
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", pipelineDraggedOpportunity);
  });
  document.addEventListener("dragover", (event) => {
    const column = event.target.closest("[data-pipeline-drop-stage]");
    if (!column || !pipelineDraggedOpportunity) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    column.classList.add("is-drag-over");
  });
  document.addEventListener("dragleave", (event) => {
    const column = event.target.closest("[data-pipeline-drop-stage]");
    if (column && !column.contains(event.relatedTarget)) column.classList.remove("is-drag-over");
  });
  document.addEventListener("drop", async (event) => {
    const column = event.target.closest("[data-pipeline-drop-stage]");
    if (!column) return;
    event.preventDefault();
    document.querySelectorAll(".sales-pipeline-column.is-drag-over").forEach((item) => item.classList.remove("is-drag-over"));
    const key = pipelineDraggedOpportunity || event.dataTransfer.getData("text/plain");
    pipelineDraggedOpportunity = "";
    const [contactId, jobId] = key.split(":");
    if (contactId && jobId) await movePipelineOpportunity(contactId, jobId, column.dataset.pipelineDropStage);
  });
  document.addEventListener("dragend", () => {
    pipelineDraggedOpportunity = "";
    document.querySelectorAll(".sales-pipeline-card.is-dragging,.sales-pipeline-column.is-drag-over").forEach((item) => item.classList.remove("is-dragging", "is-drag-over"));
  });
  els.leadTagFilter?.addEventListener("change",(event)=>{state.leadTagFilter=event.target.value||"";state.savedLeadFilterId="";saveUiState();renderLeadsView();});
  els.savedLeadFilter?.addEventListener("change",(event)=>applySavedLeadFilter(event.target.value));
  els.saveLeadFilterButton?.addEventListener("click",saveCurrentLeadFilter);

  els.toggleEstimateHistoryButton?.addEventListener("click", () => {
    const willOpen = els.estimateHistoryPanel.classList.contains("hidden");
    els.estimateHistoryPanel.classList.toggle("hidden", !willOpen);
    els.toggleEstimateHistoryButton.setAttribute("aria-expanded", String(willOpen));
    els.estimateCreatePanel?.classList.add("hidden");
    els.toggleEstimateCreateButton?.setAttribute("aria-expanded", "false");
  });

  els.toggleEstimateCreateButton?.addEventListener("click", () => {
    const willOpen = els.estimateCreatePanel.classList.contains("hidden");
    els.estimateCreatePanel.classList.toggle("hidden", !willOpen);
    els.toggleEstimateCreateButton.setAttribute("aria-expanded", String(willOpen));
    els.estimateHistoryPanel?.classList.add("hidden");
    els.toggleEstimateHistoryButton?.setAttribute("aria-expanded", "false");
  });

  const estimateLeadSearches = [
    { target: "new", input: els.newEstimateContactSearch, results: els.newEstimateContactResults },
    { target: "editor", input: els.estimateContactSearch, results: els.estimateContactResults },
  ];
  estimateLeadSearches.forEach(({ target, input, results }) => {
    if (!input || !results) return;
    input.addEventListener("focus", () => showEstimateLeadResults(target, input.value));
    input.addEventListener("input", () => {
      if (target === "new") {
        const selected = getContact(state.newEstimateContactId);
        if (!selected || normalizeLeadSearch(input.value) !== normalizeLeadSearch(selected.name)) {
          state.newEstimateContactId = "";
          state.newEstimateJobId = "";
          renderNewEstimatePickers();
        }
      }
      showEstimateLeadResults(target, input.value);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        hideEstimateLeadResults(target);
        return;
      }
      if (event.key !== "Enter") return;
      const first = results.querySelector("[data-estimate-lead-id]");
      if (!first) return;
      event.preventDefault();
      selectEstimateLead(first.dataset.estimateLeadId, target);
    });
    results.addEventListener("mousedown", (event) => event.preventDefault());
    results.addEventListener("click", (event) => {
      const option = event.target.closest("[data-estimate-lead-id]");
      if (option) selectEstimateLead(option.dataset.estimateLeadId, target);
    });
  });
  document.addEventListener("click", (event) => {
    estimateLeadSearches.forEach(({ target, input, results }) => {
      if (!input || !results || input.contains(event.target) || results.contains(event.target)) return;
      hideEstimateLeadResults(target);
    });
  });
  els.newEstimateJob?.addEventListener("change", (event) => {
    state.newEstimateJobId = event.target.value;
    saveUiState();
  });
  els.newEstimateButton.addEventListener("click", async () => {
    if (!requireAction("manageEstimates")) return;
    // "New Estimate" on the Estimates page is an explicit request for a new one.
    const estimate = await createEstimate(state.newEstimateContactId || els.newEstimateContact?.value, true, els.newEstimateJob?.value, { forceNew: true });
    if (estimate) {
      els.estimateCreatePanel?.classList.add("hidden");
      els.toggleEstimateCreateButton?.setAttribute("aria-expanded", "false");
    }
  });
  els.addLineItemButton.addEventListener("click", () => {
    if (!requireAction("manageEstimates")) return;
    const estimate = getSelectedEstimate();
    if (!estimate) return;
    const index = estimate.items.length;
    estimate.items.push({ id: uid("line"), title: "", description: "", quantity: 1, unit: "ea", rate: 0 });
    queueLocalStateSave();
    appendEstimateLineItem(estimate, index);
    queueEstimateVerifiedSave(estimate.id);
    scheduleEstimateVisualRefresh(estimate.id);
  });

  els.lineItemTemplatesButton?.addEventListener("click", () => {
    if (!requireAction("manageEstimates")) return;
    const picker = els.templatePicker;
    if (!picker) return;
    const isOpen = !picker.classList.contains("hidden");
    if (isOpen) { picker.classList.add("hidden"); return; }
    // Only the templates for this job's division (templates with no division
    // are the roofing ones the CRM started with).
    const templateDivision = getEstimateJob(getSelectedEstimate())?.division || "roofing";
    picker.innerHTML = estimateTemplates.map((tpl, i) => (tpl.division || "roofing") !== templateDivision ? "" : `
      <button class="template-chip" type="button" data-template-index="${i}">
        <span aria-hidden="true" data-icon="template"></span>
        ${escapeHtml(tpl.name)}
      </button>
    `).join("") || '<span class="muted-copy">No templates for this division yet. Add line items below.</span>';
    hydrateIcons(picker);
    picker.classList.remove("hidden");
  });

  els.templatePicker?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-template-index]");
    if (!btn) return;
    if (!requireAction("manageEstimates")) return;
    const estimate = getSelectedEstimate();
    if (!estimate) return;
    const tpl = estimateTemplates[Number(btn.dataset.templateIndex)];
    if (!tpl) return;
    // The template replaces the untouched instruction line a new estimate
    // starts with; lines the user has written are kept.
    estimate.items = [...estimate.items.filter((item) => !isPlaceholderEstimateItem(item)), ...tpl.items.map((item) => ({ ...item, id: uid("line") }))];
    queueLocalStateSave();
    renderEstimateLineItems(estimate);
    queueEstimateVerifiedSave(estimate.id);
    scheduleEstimateVisualRefresh(estimate.id);
    els.templatePicker.classList.add("hidden");
    showToast(`${tpl.name} template added`);
  });

  els.estimateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requireAction("manageEstimates")) return;
    void saveCurrentEstimateAndPdf();
  });
  // Keep the primary save action deterministic even when another enhancement
  // intercepts the form's native submit event. Keyboard submits still use the
  // form handler above; button clicks use this direct path exactly once.
  els.saveEstimateButton?.addEventListener("click", (event) => {
    event.preventDefault();
    if (!requireAction("manageEstimates")) return;
    void saveCurrentEstimateAndPdf();
  });

  els.estimateForm.addEventListener("input", (event) => {
    if (!canAction("manageEstimates")) return;
    if (event.target.matches("select")) return;
    if (event.target.matches("[data-line-field]")) {
      updateLineItem(event.target);
      return;
    }
    if (event.target.name) updateSelectedEstimateFromField(event.target.name, event.target.value);
  });

  els.estimateForm.addEventListener("change", (event) => {
    if (!canAction("manageEstimates")) return;
    if (event.target.matches("select") && event.target.name) {
      updateSelectedEstimateFromField(event.target.name, event.target.value);
      if (["contactId", "jobId"].includes(event.target.name)) {
        renderEstimates();
      } else {
        const estimate = getSelectedEstimate();
        renderEstimateActiveSummary(estimate);
        renderEstimatePreview(estimate);
        renderSummary();
      }
    }
  });

  els.deleteEstimateButton.addEventListener("click", deleteEstimate);
  els.copyEstimateButton.addEventListener("click", copyEstimate);
  els.printEstimateButton.addEventListener("click", printEstimate);
  els.sendEstimateButton.addEventListener("click", sendEstimate);
  window.addEventListener("pagehide", flushQueuedLocalStateSave);
  window.addEventListener("beforeunload", (event) => {
    flushQueuedLocalStateSave();
    // The banner's reload is the way out of a paused tab, and the unconfirmed
    // change is already in the recovery copy, so do not stand in its way.
    if (savePausedReloadRequested || (durableWriteBlocked && durableRecoveryStored && !durableSaveInFlight && !cloudSaveInFlight)) return;
    // Files still being sent are lost if the page is left now.
    const uploadsUnderWay = leadUploads.some((item) => LEAD_UPLOAD_ACTIVE.includes(item.status));
    if (window.RooflineAuth.isEditorSessionCurrent() && (state.companyFormDraft || uploadsUnderWay || (canUseCloudSync() && durableRecordsReady && (durableWriteBlocked || durableSaveInFlight || cloudSaveInFlight || hasPendingDurableChanges() || hasPendingCompanyChanges())))) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  els.companyForm.addEventListener("submit", saveCompany);
  els.companyForm.addEventListener("input", trackCompanyFormDraft);
  els.companyForm.addEventListener("change", trackCompanyFormDraft);
  els.documentCategoryCreateForm?.addEventListener("submit", createDocumentCategory);
  let draggedDocumentCategoryId = "";
  els.documentCategoriesList?.addEventListener("dragstart", (event) => {
    if (!canAction("manageCompany")) return;
    const row = event.target.closest("[data-category-id]");
    if (!row) return;
    draggedDocumentCategoryId = row.dataset.categoryId;
    row.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedDocumentCategoryId);
  });
  els.documentCategoriesList?.addEventListener("dragover", (event) => {
    if (!draggedDocumentCategoryId) return;
    const row = event.target.closest("[data-category-id]");
    if (!row || row.dataset.categoryId === draggedDocumentCategoryId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });
  els.documentCategoriesList?.addEventListener("drop", (event) => {
    const row = event.target.closest("[data-category-id]");
    if (!row || !draggedDocumentCategoryId) return;
    event.preventDefault();
    reorderDocumentCategory(draggedDocumentCategoryId, row.dataset.categoryId);
    draggedDocumentCategoryId = "";
  });
  els.documentCategoriesList?.addEventListener("dragend", () => {
    els.documentCategoriesList.querySelectorAll(".is-dragging").forEach((row) => row.classList.remove("is-dragging"));
    draggedDocumentCategoryId = "";
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installAppButton.classList.remove("hidden");
  });

  els.installAppButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    els.installAppButton.classList.add("hidden");
  });

}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    if (["localhost", "127.0.0.1"].includes(location.hostname)) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      return;
    }
    await navigator.serviceWorker.register("sw.js");
  } catch {
    console.info("Service worker registration failed");
  }
}

async function purgeLegacyJobCrestCaches() {
  if (!("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => {
          if (!key.startsWith("jobcrest-crm-")) return false;
          if (["localhost", "127.0.0.1"].includes(location.hostname)) return true;
          const version = Number(key.match(/^jobcrest-crm-v(\d+)$/)?.[1] || Number.POSITIVE_INFINITY);
          return version <= 103;
        })
        .map((key) => caches.delete(key)),
    );
  } catch (error) {
    console.warn("Legacy JobCrest caches could not be cleared", error);
  }
}

const SIGN_IN_UNLOCK_KEY = "jobcrest.crm.sign-in-unlock";

async function playSignInUnlockTransition() {
  const root = document.documentElement;
  if (!root.classList.contains("vault-entry-pending")) return;

  try {
    sessionStorage.removeItem(SIGN_IN_UNLOCK_KEY);
  } catch {
    // Removing the marker is optional when browser storage is unavailable.
  }

  const overlay = document.querySelector("#vaultUnlock");
  if (!overlay) {
    root.classList.remove("vault-entry-pending");
    return;
  }

  const email = String(authSession?.user?.email || state.currentUser?.email || "").trim().toLowerCase();
  const identityName = String(
    state.currentUser?.name
      || authSession?.user?.user_metadata?.full_name
      || authSession?.user?.user_metadata?.name
      || email.split("@")[0]
      || "team",
  ).trim().split(/\s+/)[0];
  const welcomeName = identityName
    ? `${identityName.charAt(0).toUpperCase()}${identityName.slice(1)}`
    : "team";
  const welcomeNameElement = document.querySelector("#signInWelcomeName");
  const welcomeEmailElement = document.querySelector("#signInWelcomeEmail");
  if (welcomeNameElement) welcomeNameElement.textContent = welcomeName;
  if (welcomeEmailElement) welcomeEmailElement.textContent = email ? `Signed in as ${email}` : "Secure company workspace";

  overlay.setAttribute("aria-hidden", "false");
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  overlay.classList.add("is-active");

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const openButton = document.querySelector("#signInOpenDashboard");
  let openImmediately;
  const openRequest = new Promise((resolve) => { openImmediately = resolve; });
  openButton?.addEventListener("click", openImmediately, { once: true });
  await Promise.race([
    openRequest,
    new Promise((resolve) => window.setTimeout(resolve, reducedMotion ? 500 : 4300)),
  ]);
  openButton?.removeEventListener("click", openImmediately);

  root.classList.add("vault-entry-revealing");
  overlay.classList.add("is-complete");
  await new Promise((resolve) => window.setTimeout(resolve, reducedMotion ? 120 : 450));

  root.classList.remove("vault-entry-pending", "vault-entry-revealing");
  overlay.classList.remove("is-active", "is-complete");
  overlay.setAttribute("aria-hidden", "true");
}

function showStartupDataError() {
  document.documentElement.classList.remove("vault-entry-pending");
  const panel = document.createElement("main");
  panel.setAttribute("role", "alert");
  panel.style.cssText = "position:fixed;inset:0;z-index:100000;background:#f7f9fc;color:#17243a;display:grid;place-content:center;gap:16px;padding:32px;text-align:center";
  const title = document.createElement("h1");
  title.textContent = "Shared CRM data could not be loaded";
  const message = document.createElement("p");
  message.textContent = "No records were deleted. Editing is paused so an old device copy cannot replace shared information. Check your connection and try again.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Try loading again";
  retry.addEventListener("click", () => location.reload());
  panel.append(title, message, retry);
  document.body.appendChild(panel);
}

function pauseForSessionChange() {
  checkpointPendingDraft();
  durableWriteBlocked = true;
  durableWritesEnabled = false;
  cloudReady = false;
  window.clearTimeout(durableSaveTimer);
  window.clearTimeout(durableReloadTimer);
  window.clearTimeout(cloudSaveTimer);
  window.clearInterval(squarePollInterval);
  estimateSaveTimers.forEach(timer => window.clearTimeout(timer));
  // Retain recovery copies under the original user, never a newly signed-in
  // identity. Do not expose an old user's draft download on the signed-out view.
  document.querySelectorAll("body > *").forEach(element => {
    if (!["SCRIPT", "STYLE"].includes(element.tagName)) { element.inert = true; element.hidden = true; }
  });
  const panel = document.createElement("main");
  panel.setAttribute("role", "alert");
  panel.style.cssText = "position:fixed;inset:0;z-index:100010;background:#f7f9fc;color:#17243a;display:grid;place-content:center;gap:16px;padding:32px;text-align:center";
  const title = document.createElement("h1");
  title.textContent = "Your CRM session changed";
  const message = document.createElement("p");
  message.textContent = "This tab has stopped saving because you signed out, changed accounts, or your access changed. Sign in again to load shared records and review any recovery copy for your account.";
  const login = document.createElement("a");
  login.href = "/login?reason=session-changed";
  login.textContent = "Return to sign in";
  panel.append(title, message, login);
  document.body.appendChild(panel);
}

// Explicit extension boundary for the three legacy feature modules. This keeps
// replacement names allowlisted and removes eval-style global mutation and
// timing polls while the features are progressively moved into the core app.
window.JobCrestApp = { ready: false };

async function startApp() {
  if (!window.RooflineAuth) {
    location.replace("/login?reason=auth-loader");
    return;
  }

  authSession = await window.RooflineAuth.requireAuth();
  if (!authSession) return;
  authSession = await promoteSignedInSession();
  window.addEventListener("jobcrest:session-invalidated", pauseForSessionChange, { once: true });
  window.RooflineAuth.bindEditorSession(authSession.user);

  // Discover earlier drafts BEFORE replacing the disposable business cache.
  // Each page owns a separate slot so simultaneous tabs cannot erase drafts.
  let cachedRecoveryState = null;
  if (canUseCloudSync() && authSession?.user?.id) {
    try {
      recoveryCache = window.CrmRecoveryCache?.create();
      if (!recoveryCache) throw new Error("Asynchronous recovery cache is unavailable");
      await recoveryCache.ready;
      cachedRecoveryState = await recoveryCache.get(activeStorageKey());
      draftRecoveryStore = recoveryCache.createDraftStore({ companyId: supabaseStateId(), userId: authSession.user.id, sessionId: crypto.randomUUID() });
      const earlier = await draftRecoveryStore.list();
      estimateRecoverySources = earlier.entries || [];
      if (!earlier.available) showDraftStorageWarning();
    } catch {
      recoveryCache = null;
      let recoveryStorage;
      try { recoveryStorage = localStorage; } catch { /* Browser may deny storage. */ }
      draftRecoveryStore = window.CrmDraftRecovery.create({ storage: recoveryStorage, companyId: supabaseStateId(), userId: authSession.user.id, sessionId: crypto.randomUUID() });
      const earlier = draftRecoveryStore.list();
      estimateRecoverySources = earlier.entries || [];
      if (!earlier.available) showDraftStorageWarning();
    }
  }
  try { pruneBlockedSaveRecoveries(localStorage); } catch { /* The browser may deny storage. */ }
  state = loadState(activeStorageKey(), cachedRecoveryState);
  state.currentUser = currentUserFromAuthSession(authSession);
  if (canUseCloudSync() && authSession?.user?.id) {
    // Local storage is only an offline cache. Starting an authenticated cloud
    // session with cached business records can resurrect an older job/cost
    // version before Supabase finishes loading, so hydrate these collections
    // exclusively from the durable per-record tables below.
    state.contacts = [];
    state.estimates = [];
    state.calendarTasks = [];
    state.companyDocuments = [];
    state.invoices = [];
    state.financialPayments = [];
    state.jobLedgerPayments = [];
    state.financialExpenses = [];
    state.creditNotes = [];
    state.paymentAllocations = [];
    state.financialRefunds = [];
    state.invoiceSchedules = [];
    state.billingNotices = [];
    state.projectMembers = [];
    state.projectDiscussions = [];
    state.projectNotes = [];
    state.jobTimeEntries = [];
    state.projectTemplates = [];
    state.permits = [];
    state.inspections = [];
    state.jobSelections = [];
    state.changeOrders = [];
    state.progressBillings = [];
    state.maintenancePlans = [];
    state.maintenanceVisits = [];
    state.customerAccounts = [];
    state.accountProperties = [];
    state.accountContacts = [];
    state.accountRecordLinks = [];
    state.leadSources = [];
    state.leadTags = [];
    state.recordTags = [];
    state.customFields = [];
    state.customFieldValues = [];
    state.savedLeadFilters = [];
    state.emailTemplates = [];
    state.scheduledMessages = [];
    state.crmReminders = [];
    state.crmNotifications = [];
    state.documentVersions = [];
    state.documentComments = [];
    state.documentAccess = [];
    state.documentTemplates = [];
    state.signatureRequests = [];
    state.crmGoals = [];
    state.reportExports = [];
    state.taxRates = [];
    state.paymentMethods = [];
    state.roleCapabilities = [];
    state.announcements = [];
    state.operationalSettings = [];
    // Older unsubmitted settings remain in the recovery export, never replayed
    // against a fresh server version without review.
    state.companyFormDraft = null;
  }
  saveState({ localOnly: true });
  // Durable per-record rows are authoritative for leads, jobs, costs, notes,
  // estimates, and tasks. Never let the older JSON snapshot roll them back
  // while the durable rows are loading during startup.
  durableBusinessStateAuthoritative = true;
  await purgeLegacyJobCrestCaches();
  await initializeCloudSync();
  configureRecordPages();
  await initializeDurableRecords();
  if (canUseCloudSync() && !durableRecordsReady) {
    showStartupDataError();
    return;
  }
  // These loads each fill their own part of the CRM and do not depend on one
  // another. Running them one after another made startup wait for ~10
  // database round trips in a row; together they take about as long as the
  // slowest one.
  await Promise.all([
    initializeRecordPages(),
    initializeFinancialLedger(),
    initializeProjectDelivery(),
    initializeJobOperations(),
    initializeLeadOrganization(),
    initializeCommunications(),
    initializeDocumentOperations(),
    initializeReportsAndGoals(),
    initializeAdministration(),
  ]);
  // Record numbers are no longer checked (and written) here. In the shared
  // CRM they are given out as part of a user's own save: see
  // queueNumberingAfterSave. The copy that runs without a database still
  // numbers its own records on this device.
  if (!canUseCloudSync() && ensureExistingSalesNumbers()) saveState();
  void migrateInlineDocumentsToStorage();
  hydrateIcons();
  bindEvents();
  render();
  startSaveIndicator();
  // Startup shows the first page of leads and jobs for speed. Finish loading
  // the rest right away, whichever screen the session opened on, so no screen
  // is left totalling a partial set of records.
  if (canUseCloudSync()) void ensureCompleteCoreRecordsLoaded();
  if (canUseCloudSync()) watchForCompleteLoadRetry();
  // The menu is hidden until the grouped menu replaces it (see styles.css). If
  // that add-on never loads, show the built-in menu rather than none at all.
  window.setTimeout(() => {
    const nav = document.querySelector(".nav-list");
    if (nav && !nav.dataset.workflowNavigation) nav.dataset.workflowNavigation = "built-in";
  }, 2500);
  const integrationResult = new URLSearchParams(window.location.search).get("google");
  if (integrationResult) {
    googleIntegrationState.loaded = false;
    if (integrationResult === "connected") showToast("Google Calendar connected successfully");
    else if (integrationResult === "google_email_mismatch") showToast("Connect the Google account that matches your CRM email");
    else if (integrationResult === "google_consent_denied") showToast("Google Calendar connection was cancelled");
    else showToast("Google Calendar connection could not be completed");
    const cleaned = new URL(window.location.href);
    cleaned.searchParams.delete("google");
    window.history.replaceState({}, "", `${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
  }
  const zohoIntegrationResult = new URLSearchParams(window.location.search).get("zoho");
  if (zohoIntegrationResult) {
    zohoIntegrationState.loaded = false;
    if (zohoIntegrationResult === "connected") showToast("Zoho Sign connected successfully");
    else if (zohoIntegrationResult === "zoho_consent_denied") showToast("Zoho Sign connection was cancelled");
    else showToast("Zoho Sign connection could not be completed");
    const cleaned = new URL(window.location.href);
    cleaned.searchParams.delete("zoho");
    window.history.replaceState({}, "", `${cleaned.pathname}${cleaned.search}${cleaned.hash}`);
  }
  // Add-on modules can finish downloading long before durable CRM records have
  // hydrated. Give them a deterministic startup signal instead of making them
  // guess when the core application is ready from a short polling window.
  window.JobCrestApp.ready = true;
  window.dispatchEvent(new CustomEvent("jobcrest:app-ready"));
  // Unsaved estimate lines from an earlier session, if any, are offered back.
  if (durableRecordsReady && estimateRecoverySources.length) void indexEstimateRecoveryCopies().catch(() => {});
  durableWritesEnabled = durableRecordsReady;
  if (durableWritesEnabled) queueDurableRecordsSave();
  await playSignInUnlockTransition();
  startSquarePoll();
  registerServiceWorker();
}

startApp();
