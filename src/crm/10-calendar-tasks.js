function renderCalendar() {
  if (canUseCloudSync() && typeof refreshGoogleIntegrationStatus === "function") void refreshGoogleIntegrationStatus();
  if (!els.calendarTasksList) return;
  renderCalendarFormOptions();
  renderCalendarRepFilters(visibleCalendarTasks());
  renderCalendarCanvas();
}

function openCalendarEditor(task = null, dateValue = null) {
  if (!els.calendarEditorPanel || !els.calendarTaskForm) return;
  els.calendarEditorPanel.classList.remove("hidden");
  els.calendarEditorTitle.textContent = task ? "Edit task" : "Create task";
  els.calendarDeleteTaskButton?.classList.toggle("hidden", !task);
  if (task) {
    fillCalendarTaskForm(task);
    const contact = getContact(task.contactId);
    const job = contact ? contactJobs(contact).find((item) => item.id === task.jobId) : null;
    if (els.calendarEventContext) {
      els.calendarEventContext.classList.toggle("hidden", !contact);
      els.calendarEventContext.innerHTML = contact ? `
        <button class="calendar-context-link" type="button" data-action="open-contact-tab" data-contact-id="${escapeHtml(contact.id)}" data-tab="overview" data-job-id="${escapeHtml(job?.id || "")}">
          <span aria-hidden="true" data-icon="user"></span><span><small>Lead</small><strong>${escapeHtml(contact.name)}</strong></span>
        </button>
        ${job ? `<button class="calendar-context-link" type="button" data-action="open-job" data-contact-id="${escapeHtml(contact.id)}" data-job-id="${escapeHtml(job.id)}"><span aria-hidden="true" data-icon="briefcase"></span><span><small>Job</small><strong>${escapeHtml(job.name)}</strong></span></button>` : ""}` : "";
      hydrateIcons(els.calendarEventContext);
    }
  } else {
    els.calendarTaskForm.reset();
    renderCalendarFormOptions();
    const due = dateValue ? new Date(`${dateValue}T09:00:00`) : new Date();
    if (!dateValue) {
      due.setMinutes(due.getMinutes() < 30 ? 30 : 0, 0, 0);
      if (due.getMinutes() === 0) due.setHours(due.getHours() + 1);
    }
    els.calendarTaskForm.elements.dueAt.value = dateTimeLocalValue(due.toISOString());
    els.calendarTaskForm.elements.duration.value = 30;
    els.calendarTaskForm.elements.priority.value = "normal";
    els.calendarTaskForm.elements.workflowStatus.value = "not_started";
    els.calendarTaskForm.elements.recurrence.value = "none";
    if (els.calendarEventContext) {
      els.calendarEventContext.classList.add("hidden");
      els.calendarEventContext.innerHTML = "";
    }
  }
  els.calendarEditorPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  window.setTimeout(() => els.calendarTaskForm?.elements?.title?.focus(), 80);
}

function closeCalendarEditor() {
  els.calendarEditorPanel?.classList.add("hidden");
  els.calendarTaskForm?.reset();
  if (els.calendarTaskForm?.elements?.taskId) els.calendarTaskForm.elements.taskId.value = "";
  els.calendarEventContext?.classList.add("hidden");
}

async function rescheduleCalendarTask(taskId, dueAt, duration = null) {
  if (!requireAction("manageTasks")) return false;
  const existing = state.calendarTasks.find((task) => task.id === taskId);
  if (!existing) return false;
  const next = normalizeCalendarTask({
    ...existing,
    dueAt: dueAt || existing.dueAt,
    duration: duration == null ? existing.duration : Math.max(5, Math.round(duration / 5) * 5),
    updatedAt: new Date().toISOString(),
    googleSyncStatus: "pending",
    googleSyncError: "",
    googleTaskSyncStatus: "pending",
    googleTaskSyncError: "",
  });
  state.calendarTasks = state.calendarTasks.map((task) => task.id === taskId ? next : task);
  saveState({ localOnly: true });
  renderCalendar();
  let saved = !canUseCloudSync();
  try {
    if (canUseCloudSync()) saved = await persistDurableRecordNow("task", taskId, (data) => data.id === taskId && data.dueAt === next.dueAt);
  } catch { saved = false; }
  if (!saved) queueDurableRecordsSave();
  else queueCloudSave();
  const synced = await syncCalendarTaskToGoogle(next);
  showToast(synced ? "Task rescheduled in JobCrest and Google Calendar" : "Task rescheduled in JobCrest; Google sync needs attention");
  return synced;
}

function calendarNavigate(direction) {
  if (calendarViewMode === "day") calendarAnchorDate = calendarAddDays(calendarAnchorDate, direction);
  else if (calendarViewMode === "week") calendarAnchorDate = calendarAddDays(calendarAnchorDate, direction * 7);
  else if (calendarViewMode === "month") calendarAnchorDate = new Date(calendarAnchorDate.getFullYear(), calendarAnchorDate.getMonth() + direction, 1);
  else calendarAnchorDate = calendarAddDays(calendarAnchorDate, direction * 14);
  calendarMonthOffset = 0;
  renderCalendarCanvas();
}

function calendarDropDate(event, target) {
  const date = target.dataset.date;
  const current = new Date(event.dataTransfer.getData("application/x-jobcrest-calendar-due") || `${date}T09:00:00`);
  if (!target.classList.contains("calendar-time-day")) {
    return new Date(`${date}T${String(current.getHours()).padStart(2, "0")}:${String(current.getMinutes()).padStart(2, "0")}:00`);
  }
  const rect = target.getBoundingClientRect();
  const minutes = Math.max(0, Math.min((CALENDAR_END_HOUR - CALENDAR_START_HOUR) * 60 - 15,
    Math.round(((event.clientY - rect.top) / CALENDAR_SLOT_HEIGHT * 60) / 15) * 15));
  const due = new Date(`${date}T00:00:00`);
  due.setMinutes(CALENDAR_START_HOUR * 60 + minutes);
  return due;
}

function bindCalendarCanvasEvents() {
  els.calendarViewSwitcher?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-calendar-view]");
    if (!button) return;
    calendarViewMode = button.dataset.calendarView;
    renderCalendarCanvas();
  });
  els.calendarTodayButton?.addEventListener("click", () => {
    calendarAnchorDate = new Date();
    renderCalendarCanvas();
  });
  els.calendarDatePicker?.addEventListener("change", (event) => {
    if (!event.target.value) return;
    calendarAnchorDate = new Date(`${event.target.value}T12:00:00`);
    renderCalendarCanvas();
  });
  els.calendarNewTaskButton?.addEventListener("click", () => openCalendarEditor());
  els.calendarEditorClose?.addEventListener("click", closeCalendarEditor);
  els.calendarDeleteTaskButton?.addEventListener("click", async () => {
    const taskId = els.calendarTaskForm?.elements?.taskId?.value;
    if (taskId) await deleteCalendarTask(taskId);
    closeCalendarEditor();
  });
  els.calendarSelectAllReps?.addEventListener("click", () => {
    visibleCalendarTasks().forEach((task) => calendarVisibleReps.add(calendarRepKey(task)));
    renderCalendar();
  });
  els.calendarRepFilters?.addEventListener("change", (event) => {
    const checkbox = event.target.closest("[data-calendar-rep]");
    if (!checkbox) return;
    if (checkbox.checked) calendarVisibleReps.add(checkbox.dataset.calendarRep);
    else calendarVisibleReps.delete(checkbox.dataset.calendarRep);
    renderCalendarCanvas();
  });
  els.calMonthGrid?.addEventListener("click", (event) => {
    const taskButton = event.target.closest("[data-calendar-task-id]");
    if (taskButton && !event.target.closest("[data-calendar-resize]")) {
      const task = state.calendarTasks.find((item) => item.id === taskButton.dataset.calendarTaskId);
      if (task) openCalendarEditor(task);
      return;
    }
    const dateButton = event.target.closest("[data-calendar-new-date]");
    if (dateButton) openCalendarEditor(null, dateButton.dataset.calendarNewDate);
    const moreButton = event.target.closest("[data-calendar-day]");
    if (moreButton) {
      calendarAnchorDate = new Date(`${moreButton.dataset.calendarDay}T12:00:00`);
      calendarViewMode = "day";
      renderCalendarCanvas();
    }
  });
  els.calMonthGrid?.addEventListener("dragstart", (event) => {
    const taskButton = event.target.closest("[data-calendar-task-id]");
    const task = taskButton && state.calendarTasks.find((item) => item.id === taskButton.dataset.calendarTaskId);
    if (!task) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.setData("application/x-jobcrest-calendar-due", task.dueAt);
    taskButton.classList.add("is-dragging");
  });
  els.calMonthGrid?.addEventListener("dragend", (event) => event.target.closest("[data-calendar-task-id]")?.classList.remove("is-dragging"));
  els.calMonthGrid?.addEventListener("dragover", (event) => {
    const target = event.target.closest(".calendar-drop-target");
    if (!target) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });
  els.calMonthGrid?.addEventListener("drop", (event) => {
    const target = event.target.closest(".calendar-drop-target");
    const taskId = event.dataTransfer.getData("text/plain");
    if (!target || !taskId) return;
    event.preventDefault();
    void rescheduleCalendarTask(taskId, calendarDropDate(event, target).toISOString());
  });
  els.calMonthGrid?.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-calendar-resize]");
    const taskButton = handle?.closest("[data-calendar-task-id]");
    const task = taskButton && state.calendarTasks.find((item) => item.id === taskButton.dataset.calendarTaskId);
    if (!handle || !task) return;
    event.preventDefault();
    const startY = event.clientY;
    const startDuration = number(task.duration) || 30;
    const positioned = taskButton.closest(".calendar-positioned-event");
    const move = (moveEvent) => {
      const duration = Math.max(15, Math.round((startDuration + (moveEvent.clientY - startY) / CALENDAR_SLOT_HEIGHT * 60) / 15) * 15);
      if (positioned) positioned.style.height = `${Math.max(26, duration / 60 * CALENDAR_SLOT_HEIGHT)}px`;
      taskButton.dataset.pendingDuration = String(duration);
    };
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      const duration = number(taskButton.dataset.pendingDuration) || startDuration;
      delete taskButton.dataset.pendingDuration;
      if (duration !== startDuration) void rescheduleCalendarTask(task.id, task.dueAt, duration);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  });
}

function renderCalendarFormOptions() {
  if (!els.salesRepOptions || !els.calendarTaskContact) return;
  els.calendarTaskContact.innerHTML = [
    '<option value="">No related lead</option>',
    ...visibleContacts().map(
      (contact) => `<option value="${contact.id}">${escapeHtml(contact.name)} (${escapeHtml(contact.status)})</option>`,
    ),
  ].join("");
  renderCalendarTaskJobOptions(els.calendarTaskContact.value, els.calendarTaskForm?.elements?.jobId?.value || "");
  const repField = els.calendarTaskForm?.elements?.rep;
  const taskIdField = els.calendarTaskForm?.elements?.taskId;
  if (repField && !taskIdField?.value && !repField.value.trim()) {
    const owner = currentOwner();
    repField.value = canonicalRepresentativeName(owner.name, owner);
  }
  renderCalendarGoogleDestination();
}

function renderCalendarGoogleDestination() {
  if (!els.calendarGoogleDestination || !els.calendarTaskForm) return;
  const rep = String(els.calendarTaskForm.elements.rep?.value || "").trim();
  const repKey = normalizePersonName(rep).toLowerCase();
  const owner = [...cloudKnownOwners.values(), currentOwner()].find((candidate) =>
    normalizePersonName(candidate.name).toLowerCase() === repKey || String(candidate.email || "").toLowerCase() === rep.toLowerCase()
  );
  const email = owner?.email || "";
  const mine = Boolean(email && email === String(currentOwner().email || "").toLowerCase());
  els.calendarGoogleDestination.textContent = email
    ? `Google destination: ${email}${mine ? " (your signed-in account)" : ""}`
    : "Choose a connected representative to sync this event to Google Calendar.";
}

function renderCalendarTaskJobOptions(contactId = "", selectedJobId = "") {
  if (!els.calendarTaskJob) return;
  const contact = getContact(contactId);
  const jobs = contact ? contactJobs(contact) : [];
  els.calendarTaskJob.innerHTML = [
    '<option value="">No related job</option>',
    ...jobs.map((job) => `<option value="${escapeHtml(job.id)}" ${job.id === selectedJobId ? "selected" : ""}>${escapeHtml(job.name)}</option>`),
  ].join("");
  els.calendarTaskJob.disabled = !jobs.length;
}

function taskChecklistProgress(task) {
  const total = (task.checklist || []).length;
  const completed = (task.checklist || []).filter((item) => item.completed).length;
  return { total, completed, percent: total ? Math.round(completed / total * 100) : 0 };
}

function taskTrackedMinutes(task) {
  return Math.round((task.timeEntries || []).reduce((total, entry) => {
    const start = activityTimestamp(entry.startedAt);
    const stop = activityTimestamp(entry.stoppedAt) || Date.now();
    return total + Math.max(0, stop - start);
  }, 0) / 60000);
}

function renderTaskCard(task, options = {}) {
  const contact = getContact(task.contactId);
  const job = contact ? contactJobs(contact).find((item) => item.id === task.jobId) : null;
  const calendarUrl = task.googleEventUrl || googleCalendarUrl(task);
  const due = localTimestamp(task.dueAt);
  const overdue = !task.completed && Number.isFinite(due) && due < Date.now();
  const progress = taskChecklistProgress(task);
  const activeTimer = (task.timeEntries || []).some((entry) => !entry.stoppedAt);
  const statusLabel = ({ not_started: "Not started", in_progress: "In progress", blocked: "Blocked", completed: "Completed", cancelled: "Cancelled" })[task.workflowStatus] || "Not started";
  return `
    <article class="task-card task-priority-${escapeHtml(task.priority)} ${task.completed ? "is-complete" : ""} ${overdue ? "task-overdue" : ""}">
      <div>
        <div class="task-title-row">
          <strong>${escapeHtml(task.title)}</strong>
          <span class="status-pill">${escapeHtml(task.priority)} priority</span>
          <span class="status-pill">${escapeHtml(statusLabel)}</span>
          ${task.completed ? '<span class="task-state">Completed</span>' : overdue ? '<span class="task-state task-state-overdue">Overdue</span>' : ""}
        </div>
        <span>${escapeHtml(task.rep)} - ${escapeHtml(formatDateTime(task.dueAt))}</span>
        ${contact ? `<span>Related lead: ${escapeHtml(contact.name)}</span>` : ""}
        ${job ? `<span>Related job: ${escapeHtml(job.name)}</span>` : ""}
        ${task.recurrence !== "none" ? `<span>Repeats ${escapeHtml(task.recurrence)}</span>` : ""}
        ${task.followers?.length ? `<span>Followers: ${escapeHtml(task.followers.join(", "))}</span>` : ""}
        ${taskGoogleSyncLabel(task)}
        ${taskGoogleTasksSyncLabel(task)}
        ${task.notes && !options.compact ? `<p>${nl2br(task.notes)}</p>` : ""}
        ${!options.compact && progress.total ? `
          <div class="task-progress"><span style="width:${progress.percent}%"></span></div>
          <small>${progress.completed} of ${progress.total} checklist items complete</small>
          <div class="task-checklist">
            ${(task.checklist || []).map((item) => `
              <label class="task-checklist-item ${item.completed ? "is-complete" : ""}">
                <input type="checkbox" data-action="toggle-task-checklist" data-task-id="${task.id}" data-checklist-id="${item.id}" ${item.completed ? "checked" : ""} />
                <span>${escapeHtml(item.label)}</span>
              </label>
            `).join("")}
          </div>
        ` : ""}
        ${!options.compact && task.comments?.length ? `
          <div class="task-comments">
            ${task.comments.slice(-3).map((comment) => `<p><strong>${escapeHtml(comment.author)}</strong> ${escapeHtml(comment.body)} <small>${escapeHtml(formatDateTime(comment.createdAt))}</small></p>`).join("")}
          </div>
        ` : ""}
        ${!options.compact ? `
          <form class="task-comment-form" data-task-comment-form data-task-id="${task.id}">
            <input name="comment" required maxlength="10000" autocomplete="off" placeholder="Add a comment" aria-label="Comment on ${escapeHtml(task.title)}" />
            <button class="mini-button" type="submit" aria-label="Post comment"><span aria-hidden="true" data-icon="send"></span></button>
          </form>
          <small>${taskTrackedMinutes(task)} minute${taskTrackedMinutes(task) === 1 ? "" : "s"} tracked</small>
        ` : ""}
        ${task.googleSyncError && !options.compact ? `<p class="field-error">${escapeHtml(task.googleSyncError)}</p>` : ""}
        ${task.googleTaskSyncError && !options.compact ? `<p class="field-error">${escapeHtml(task.googleTaskSyncError)}</p>` : ""}
      </div>
      <div class="row-actions">
        <a class="secondary-button" href="${escapeHtml(calendarUrl)}" target="_blank" rel="noopener">
          <span aria-hidden="true" data-icon="calendar"></span>
          ${task.googleEventUrl ? "Open in Google Calendar" : "Google Calendar"}
        </a>
        ${task.googleMeetLink ? `<a class="secondary-button" href="${escapeHtml(task.googleMeetLink)}" target="_blank" rel="noopener"><span aria-hidden="true" data-icon="calendar"></span>Join Google Meet</a>` : ""}
        ${
          options.compact
            ? ""
            : `<button class="secondary-button" type="button" data-action="toggle-task-timer" data-task-id="${task.id}">
                <span aria-hidden="true" data-icon="${activeTimer ? "x" : "calendar"}"></span>
                ${activeTimer ? "Stop timer" : "Start timer"}
              </button>
              <button class="mini-button" type="button" title="Edit task" aria-label="Edit task" data-action="edit-calendar-task" data-task-id="${task.id}">
                <span aria-hidden="true" data-icon="edit"></span>
              </button>
              ${task.completed
                ? `<button class="secondary-button" type="button" title="Reopen task" data-action="reopen-calendar-task" data-task-id="${task.id}">Reopen</button>`
                : `<button class="mini-button" type="button" title="Mark complete" aria-label="Mark task complete" data-action="complete-calendar-task" data-task-id="${task.id}">
                <span aria-hidden="true" data-icon="check"></span>
              </button>`}
              <button class="mini-button" type="button" title="Delete task" aria-label="Delete task" data-action="delete-calendar-task" data-task-id="${task.id}">
                <span aria-hidden="true" data-icon="trash"></span>
              </button>`
        }
      </div>
    </article>
  `;
}

async function saveCalendarTask(event) {
  event.preventDefault();
  if (!requireAction("manageTasks")) return;
  const formData = new FormData(els.calendarTaskForm);
  const taskId = formData.get("taskId");
  const existingTask = state.calendarTasks.find((task) => task.id === taskId);
  const contact = getContact(formData.get("contactId"));
  const rep = formData.get("rep").trim();
  const knownOwners = [...cloudKnownOwners.values(), currentOwner()];
  const repKey = normalizePersonName(rep).toLowerCase();
  const matchedOwner = knownOwners.find((candidate) =>
    normalizePersonName(candidate.name).toLowerCase() === repKey || String(candidate.email || "").toLowerCase() === rep.toLowerCase()
  );
  const contactOwner = contact?.ownerUserId
    ? { userId: contact.ownerUserId, email: contact.ownerEmail, name: contact.ownerName }
    : null;
  const owner = matchedOwner || (!rep || normalizePersonName(contactOwner?.name).toLowerCase() === repKey ? contactOwner : null) ||
    { userId: "", email: "", name: rep || "Unassigned" };
  const ownerChanged = Boolean(existingTask?.googleEventId && existingTask.ownerEmail && existingTask.ownerEmail !== owner.email);
  if (ownerChanged && !(await removeCalendarTaskFromGoogle(existingTask))) return;
  const task = normalizeCalendarTask({
    ...(existingTask || {}),
    id: taskId || uid("task"),
    title: formData.get("title").trim(),
    rep,
    contactId: formData.get("contactId"),
    jobId: formData.get("jobId"),
    dueAt: formData.get("dueAt"),
    duration: number(formData.get("duration")),
    reminder: formData.get("reminder"),
    addGoogleMeet: formData.get("addGoogleMeet") === "on",
    notes: formData.get("notes").trim(),
    priority: formData.get("priority"),
    workflowStatus: formData.get("workflowStatus"),
    recurrence: formData.get("recurrence"),
    followers: String(formData.get("followers") || "").split(","),
    checklist: String(formData.get("checklistText") || "").split(/\r?\n/).map((label, index) => {
      const cleanLabel = label.trim();
      const previous = (existingTask?.checklist || []).find((item) => item.label.toLowerCase() === cleanLabel.toLowerCase());
      return cleanLabel ? { ...(previous || {}), id: previous?.id || uid("check"), label: cleanLabel, position: index } : null;
    }).filter(Boolean),
    createdAt: existingTask?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completed: formData.get("workflowStatus") === "completed",
    ownerUserId: owner.userId || "",
    ownerEmail: owner.email || "",
    ownerName: owner.name || "",
    googleSyncStatus: "pending",
    googleSyncError: "",
    googleTaskSyncStatus: "pending",
    googleTaskSyncError: "",
    ...(ownerChanged ? {
      googleEventId: "", googleEventUrl: "", googleMeetLink: "", googleSyncedAt: "",
      googleTaskId: "", googleTaskListId: "", googleTaskSyncedAt: "",
    } : {}),
  });
  if (existingTask) {
    state.calendarTasks = state.calendarTasks.map((item) => (item.id === task.id ? task : item));
  } else {
    state.calendarTasks.unshift(task);
  }
  saveState({ localOnly: true });
  closeCalendarEditor();
  render();
  showToast(existingTask ? "Task updated. Syncing Google Calendar…" : "Task saved. Syncing Google Calendar…");
  let saved = !canUseCloudSync();
  try {
    if (canUseCloudSync()) saved = await persistDurableRecordNow("task", task.id, (data) => data.id === task.id);
  } catch {
    saved = false;
  }
  if (!saved) {
    queueDurableRecordsSave();
    showToast("Task is saved on this screen while shared CRM sync retries.");
  } else {
    queueCloudSave();
  }
  const synced = await syncCalendarTaskToGoogle(task);
  if (synced) showToast(existingTask ? "Task and Google Calendar event updated" : "Task added to the CRM and Google Calendar");
  else if (state.calendarTasks.find((item) => item.id === task.id)?.googleSyncStatus === "not_connected") {
    showToast(task.ownerUserId && task.ownerUserId === currentOwner().userId
      ? "Task saved in the CRM. Use Connect Google Calendar on this page to sync your tasks."
      : "Task saved in the CRM. The assigned rep must connect Google Calendar.");
  } else if (googleIntegrationState.loaded && !googleIntegrationState.configured) {
    showToast(existingTask ? "Task updated in the CRM" : "Task saved in the CRM");
  } else showToast("Task saved in the CRM. Google Calendar sync needs attention.");
}

function editCalendarTask(taskId) {
  if (!requireAction("manageTasks")) return;
  const task = state.calendarTasks.find((item) => item.id === taskId);
  if (!task) {
    showToast("That reminder could not be found");
    return;
  }
  state.view = "calendar";
  saveUiState();
  render();
  openCalendarEditor(task);
  showToast("Reminder loaded for editing");
}

function fillCalendarTaskForm(task) {
  if (!els.calendarTaskForm || !task) return;
  const form = els.calendarTaskForm;
  form.elements.taskId.value = task.id || "";
  form.elements.rep.value = task.rep || "";
  form.elements.contactId.value = task.contactId || "";
  renderCalendarTaskJobOptions(task.contactId, task.jobId);
  form.elements.jobId.value = task.jobId || "";
  form.elements.title.value = task.title || "";
  form.elements.dueAt.value = dateTimeLocalValue(task.dueAt);
  form.elements.duration.value = task.duration || 30;
  form.elements.reminder.value = task.reminder || "popup";
  if (form.elements.addGoogleMeet) form.elements.addGoogleMeet.checked = Boolean(task.addGoogleMeet);
  form.elements.notes.value = task.notes || "";
  form.elements.priority.value = task.priority || "normal";
  form.elements.workflowStatus.value = task.workflowStatus || "not_started";
  form.elements.recurrence.value = task.recurrence || "none";
  form.elements.followers.value = (task.followers || []).join(", ");
  form.elements.checklistText.value = (task.checklist || []).map((item) => item.label).join("\n");
}

async function persistTaskWorkflowUpdate(taskId) {
  saveState({ localOnly: true });
  render();
  if (!canUseCloudSync()) return true;
  try {
    const saved = await persistDurableRecordNow("task", taskId, (data) => data.id === taskId);
    if (!saved) queueDurableRecordsSave();
    else queueCloudSave();
    return saved;
  } catch (error) {
    console.warn("Task workflow update could not be confirmed", error);
    queueDurableRecordsSave();
    return false;
  }
}

async function toggleTaskChecklist(taskId, checklistId) {
  if (!requireAction("manageTasks")) return;
  state.calendarTasks = state.calendarTasks.map((task) => {
    if (task.id !== taskId) return task;
    const checklist = (task.checklist || []).map((item) => item.id === checklistId
      ? { ...item, completed: !item.completed, completedAt: !item.completed ? new Date().toISOString() : "" }
      : item);
    const progress = taskChecklistProgress({ checklist });
    return normalizeCalendarTask({
      ...task,
      checklist,
      workflowStatus: progress.total && progress.completed === progress.total ? "completed" : task.workflowStatus === "completed" ? "in_progress" : task.workflowStatus,
      completed: progress.total && progress.completed === progress.total,
      updatedAt: new Date().toISOString(),
    });
  });
  await persistTaskWorkflowUpdate(taskId);
}

async function addTaskComment(taskId, body) {
  if (!requireAction("manageTasks")) return;
  const cleanBody = String(body || "").trim();
  if (!cleanBody) return;
  state.calendarTasks = state.calendarTasks.map((task) => task.id === taskId
    ? normalizeCalendarTask({
        ...task,
        comments: [...(task.comments || []), {
          id: uid("comment"),
          body: cleanBody,
          author: state.currentUser.name || state.currentUser.email || "CRM user",
          createdAt: new Date().toISOString(),
        }],
        updatedAt: new Date().toISOString(),
      })
    : task);
  await persistTaskWorkflowUpdate(taskId);
}

async function toggleTaskTimer(taskId) {
  if (!requireAction("manageTasks")) return;
  const now = new Date().toISOString();
  state.calendarTasks = state.calendarTasks.map((task) => {
    if (task.id !== taskId) return task;
    const active = (task.timeEntries || []).find((entry) => !entry.stoppedAt);
    const timeEntries = active
      ? (task.timeEntries || []).map((entry) => entry.id === active.id ? { ...entry, stoppedAt: now } : entry)
      : [...(task.timeEntries || []), { id: uid("time"), startedAt: now, stoppedAt: "", userEmail: state.currentUser.email || "" }];
    return normalizeCalendarTask({
      ...task,
      timeEntries,
      workflowStatus: active ? task.workflowStatus : task.workflowStatus === "not_started" ? "in_progress" : task.workflowStatus,
      updatedAt: now,
    });
  });
  await persistTaskWorkflowUpdate(taskId);
}

// The next due date of a repeating task: the first occurrence after now. A
// daily task finished three weeks late used to create the day after its old
// due date, which was already overdue, and so on one day at a time.
function nextRecurrenceDate(dueAt, recurrence, now = new Date()) {
  const next = new Date(dueAt);
  if (Number.isNaN(next.getTime())) return new Date(now);
  const step = () => {
    if (recurrence === "daily") next.setDate(next.getDate() + 1);
    else if (recurrence === "weekly") next.setDate(next.getDate() + 7);
    else if (recurrence === "monthly") next.setMonth(next.getMonth() + 1);
    else if (recurrence === "yearly") next.setFullYear(next.getFullYear() + 1);
    else return false;
    return true;
  };
  if (!step()) return next;
  for (let guard = 0; next <= now && guard < 5000; guard += 1) step();
  return next;
}

async function reopenCalendarTask(taskId) {
  if (!requireAction("manageTasks")) return;
  const existing = state.calendarTasks.find((task) => task.id === taskId);
  if (!existing?.completed) return;
  state.calendarTasks = state.calendarTasks.map((task) => task.id === taskId
    ? normalizeCalendarTask({ ...task, completed: false, workflowStatus: "in_progress", updatedAt: new Date().toISOString(), googleSyncStatus: "pending" })
    : task);
  await persistTaskWorkflowUpdate(taskId);
  showToast("Task reopened");
}

async function completeCalendarTask(taskId) {
  if (!requireAction("manageTasks")) return;
  const existing = state.calendarTasks.find((task) => task.id === taskId);
  if (!existing) return;
  if (!(await removeCalendarTaskFromGoogle(existing))) return;
  const completedAt = new Date().toISOString();
  state.calendarTasks = state.calendarTasks.map((task) =>
    task.id === taskId ? normalizeCalendarTask({
      ...task,
      completed: true,
      workflowStatus: "completed",
      updatedAt: completedAt,
      googleEventId: "",
      googleEventUrl: "",
      googleSyncStatus: "synced",
      googleSyncedAt: completedAt,
      googleSyncError: "",
    }) : task,
  );
  let nextTask = null;
  if (existing.recurrence && existing.recurrence !== "none") {
    const nextDue = nextRecurrenceDate(existing.dueAt, existing.recurrence);
    nextTask = normalizeCalendarTask({
      ...existing,
      id: uid("task"),
      dueAt: nextDue.toISOString(),
      workflowStatus: "not_started",
      completed: false,
      checklist: (existing.checklist || []).map((item) => ({ ...item, id: uid("check"), completed: false, completedAt: "" })),
      comments: [],
      timeEntries: [],
      createdAt: completedAt,
      updatedAt: completedAt,
      googleEventId: "",
      googleEventUrl: "",
      googleSyncStatus: "pending",
      googleSyncedAt: "",
      googleSyncError: "",
    });
    state.calendarTasks.unshift(nextTask);
  }
  await persistTaskWorkflowUpdate(taskId);
  const completedTask = state.calendarTasks.find((task) => task.id === taskId);
  if (completedTask?.googleTaskId) await syncCalendarTaskToGoogleTasks(completedTask);
  if (nextTask) {
    if (canUseCloudSync()) await persistDurableRecordNow("task", nextTask.id, (data) => data.id === nextTask.id);
    await syncCalendarTaskToGoogle(nextTask);
  }
  showToast(nextTask ? "Task completed and the next recurring task was created" : "Task marked complete");
}

async function deleteCalendarTask(taskId) {
  if (!requireAction("manageTasks")) return;
  const task = state.calendarTasks.find((item) => item.id === taskId);
  if (!task) return;
  if (!(await appConfirm(`Delete the task "${task.title}"?${task.googleEventId || task.googleTaskId ? " It is also removed from Google." : ""}`, { title: "Delete task", confirmLabel: "Delete task", danger: true }))) return;
  if (!(await removeCalendarTaskFromGoogle(task))) return;
  if (!(await removeTaskFromGoogleTasks(task))) return;
  state.calendarTasks = state.calendarTasks.filter((task) => task.id !== taskId);
  saveState({ localOnly: true });
  queueDurableRecordsSave();
  queueCloudSave();
  render();
  showToast("Task deleted");
}

function followUpSummary(now = new Date()) {
  const tomorrow = new Date(now);
  tomorrow.setHours(24, 0, 0, 0);
  const result = { overdue: [], today: [], upcoming: [], completed: [], undated: [], estimates: [] };
  for (const task of visibleCalendarTasks()) {
    if (task.completed) { result.completed.push(task); continue; }
    const due = localTimestamp(task.dueAt);
    if (!Number.isFinite(due)) result.undated.push(task);
    else if (due < now.getTime()) result.overdue.push(task);
    else if (due < tomorrow.getTime()) result.today.push(task);
    else result.upcoming.push(task);
  }
  for (const key of ["overdue", "today", "upcoming", "completed"]) {
    result[key].sort((a, b) => localTimestamp(a.dueAt) - localTimestamp(b.dueAt));
  }
  if (canView("estimates")) {
    const day = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    const closed = ["Won", "Scheduled", "Materials Ordered", "In Progress", "Completed", "Paid", "Lost"];
    result.estimates = visibleEstimates().filter((estimate) => {
      if (estimate.status !== "Sent") return false;
      const job = getEstimateJob(estimate);
      if (closed.includes(job?.status)) return false;
      const sent = localTimestamp(estimate.sentAt || estimate.issueDate || estimate.createdAt);
      return Number.isFinite(sent) && day(now) - day(new Date(sent)) >= 3 * 86400000;
    }).sort((a, b) => localTimestamp(a.sentAt || a.issueDate || a.createdAt) - localTimestamp(b.sentAt || b.issueDate || b.createdAt));
  }
  return result;
}

function renderFollowUpSummary(elementId) {
  const panel = document.getElementById(elementId);
  if (!panel) return;
  const summary = followUpSummary();
  const groups = [
    ["overdue", "Overdue tasks", "alert-triangle", summary.overdue.length],
    ["today", "Due today", "calendar", summary.today.length],
    ["estimates", "Estimates awaiting response", "file", summary.estimates.length],
    ["upcoming", "Upcoming tasks", "clipboard", summary.upcoming.length],
  ];
  panel.innerHTML = groups.map(([filter, label, icon, count]) => `
    <button class="follow-up-card ${filter === "overdue" && count ? "needs-attention" : ""}" type="button"
      data-reminder-filter="${filter}" aria-pressed="${state.view === "tasks" && state.reminderFilter === filter}">
      <span aria-hidden="true" data-icon="${icon}"></span><span>${label}<strong>${count}</strong></span>
    </button>`).join("");
  hydrateIcons(panel);
}

function estimateFollowUpCard(estimate) {
  const contact = getEstimateContact(estimate);
  return `<article class="task-card follow-up-estimate">
    <div><strong>${escapeHtml(estimate.projectTitle || estimate.estimateNumber || "Estimate")}</strong>
      <span>${escapeHtml(contact?.name || "Customer")} · ${escapeHtml(estimate.estimateNumber || "")}</span>
      <span>Sent ${escapeHtml(formatDate(estimate.sentAt || estimate.issueDate || estimate.createdAt))} · Awaiting response</span>
    </div>
    <button class="secondary-button" type="button" data-action="review-follow-up-estimate" data-estimate-id="${escapeHtml(estimate.id)}">Review estimate</button>
  </article>`;
}

function renderTasksView() {
  if (!els.tasksPageList) return;
  renderFollowUpSummary("followUpTasks");
  const summary = followUpSummary();
  const selected = state.reminderFilter || "all";
  const groups = [["overdue", "Overdue"], ["today", "Due today"], ["estimates", "Estimates awaiting response"],
    ["upcoming", "Upcoming"], ["undated", "No due date"], ["completed", "Completed"]];
  const sections = groups.filter(([key]) => selected === "all" || selected === key).map(([key, title]) => {
    const items = summary[key];
    if (!items.length && selected === "all") return "";
    const cards = items.map((item) => key === "estimates" ? estimateFollowUpCard(item) : renderTaskCard(item)).join("");
    const body = cards || '<div class="empty-state">Nothing in this group</div>';
    return key === "completed" && selected === "all"
      ? `<details class="reminder-group"><summary>Completed (${items.length})</summary>${body}</details>`
      : `<section class="reminder-group"><h3>${title} <span>${items.length}</span></h3>${body}</section>`;
  }).join("");
  els.tasksPageList.innerHTML = `<div class="reminder-filters"><button class="secondary-button" type="button" data-reminder-filter="all" aria-pressed="${selected === "all"}">All reminders</button>
    <button class="secondary-button" type="button" data-reminder-filter="completed" aria-pressed="${selected === "completed"}">Completed</button></div>` +
    (sections || '<div class="empty-state">You’re caught up. Create a task from Calendar when you need a reminder.</div>');
  hydrateIcons(els.tasksPageList);
}

function renderSidebar() {
  const shell = document.querySelector(".app-shell");
  const button = document.querySelector(".menu-button");
  if (!shell || !button) return;
  const mode = state.sidebarMode || "auto";
  const expanded = mode === "expanded" || (mode === "auto" && window.matchMedia("(min-width: 1441px)").matches);
  shell.dataset.sidebar = mode;
  button.setAttribute("aria-expanded", String(expanded));
  button.setAttribute("aria-label", expanded ? "Collapse navigation" : "Expand navigation");
  button.title = expanded ? "Collapse navigation" : "Expand navigation";
  const overlay = expanded && window.matchMedia("(max-width: 820px)").matches;
  const backdrop = document.getElementById("sidebarBackdrop");
  if (backdrop) backdrop.hidden = !overlay;
  const workspace = document.querySelector(".workspace");
  if (workspace) workspace.inert = overlay;
}

function setSidebarMode(mode) {
  const wasOverlay = document.querySelector(".workspace")?.inert;
  state.sidebarMode = mode;
  saveUiState();
  renderSidebar();
  if (mode === "expanded" && window.matchMedia("(max-width: 820px)").matches) document.getElementById("sidebarClose")?.focus();
  else if (wasOverlay) document.querySelector(".menu-button")?.focus();
}

function refreshReminderDisplays() {
  // Refresh time-sensitive labels without rebuilding forms or disturbing drafts.
  if (document.hidden) return;
  renderTopbarProfile();
  if (state.view === "dashboard") renderDashboardTasks();
  if (state.view === "tasks") renderTasksView();
}

function squareStatusPill(estimate) {
  const percent = floorPercent(number(estimate.paymentPercent));
  if (percent >= 100 || estimate.squareStatus === "PAID") return `<span class="status-pill pill-won">Paid 100%</span>`;
  if (number(estimate.paidAmount) > 0) return `<span class="status-pill pill-inspection">${percent}% paid</span>`;
  if (estimate.squareStatus === "PAID" || estimate.paidAt) return `<span class="status-pill pill-won">Paid ✓</span>`;
  if (estimate.squareStatus === "SENT" || estimate.squareInvoiceId) return `<span class="status-pill pill-sent">Published in Square</span>`;
  if (estimate.status === "Won") return `<span class="status-pill pill-inspection">Ready to Invoice</span>`;
  return `<span class="status-pill pill-default">${escapeHtml(estimate.status)}</span>`;
}

