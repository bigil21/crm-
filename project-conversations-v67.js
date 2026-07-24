(() => {
  const VERSION = "67";
  const soldStatuses = ["Won", "Scheduled", "Materials Ordered", "In Progress", "Completed", "Paid"];
  let selectedConversationJobId = "";
  let selectedMentionKeys = new Set();
  let mentionSuggestionQuery = "";
  let previousRender = null;
  let previousRenderLeadDetail = null;

  function hasAppGlobals() {
    try {
      return Boolean(
        state &&
          els &&
          typeof render === "function" &&
          typeof renderLeadDetail === "function" &&
          typeof contactJobs === "function" &&
          typeof saveState === "function" &&
          window.RooflineProductionFlow &&
          window.RooflineWorkflowChecklist,
      );
    } catch {
      return false;
    }
  }

  function assignGlobal(name, value) {
    try {
      window[name] = value;
    } catch {}
    try {
      Function("value", `${name} = value;`)(value);
    } catch {}
  }

  function isSoldJob(job) {
    try {
      return window.RooflineProductionFlow.isSoldStatus(job?.status);
    } catch {
      return soldStatuses.includes(job?.status);
    }
  }

  function currentIdentity() {
    try {
      const owner = currentOwner();
      return normalizeMember({
        userId: owner.userId,
        email: owner.email,
        name: owner.name,
        role: owner.role,
      });
    } catch {
      return normalizeMember({
        userId: authSession?.user?.id || "",
        email: authSession?.user?.email || state.currentUser?.email || "",
        name: state.currentUser?.name || "CRM User",
        role: state.currentUser?.role || "viewer",
      });
    }
  }

  function titleCase(value = "") {
    return String(value)
      .replace(/[._-]+/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
      .join(" ");
  }

  function roleName(role = "") {
    return titleCase(String(role || "CRM user").replaceAll("_", " "));
  }

  function mentionHandle(member) {
    const emailName = String(member?.email || "").split("@")[0];
    const fallback = String(member?.name || "teammate").replace(/[^A-Za-z0-9._-]+/g, "");
    return (emailName || fallback || "teammate").toLowerCase();
  }

  function normalizeMember(member = {}) {
    const email = String(member.email || "").trim().toLowerCase();
    const userId = String(member.userId || member.id || "").trim();
    const emailName = email.split("@")[0];
    const name = String(member.name || titleCase(emailName) || "CRM User").trim();
    const key = email || userId || name.toLowerCase();
    return {
      key,
      userId,
      email,
      name,
      role: String(member.role || "sales"),
      handle: mentionHandle({ email, name }),
    };
  }

  function strongerRole(first = "", second = "") {
    const rank = {
      viewer: 0,
      sales: 1,
      production: 2,
      office_manager: 3,
      sales_manager: 4,
      operations_manager: 5,
      admin: 6,
    };
    const left = String(first || "sales");
    const right = String(second || "sales");
    return (rank[right] ?? 1) > (rank[left] ?? 1) ? right : left;
  }

  function mergeMember(directory, member) {
    const normalized = normalizeMember(member);
    if (!normalized.email && !normalized.userId) return;
    const existingKey =
      [...directory.keys()].find((key) => {
        const current = directory.get(key);
        return (
          key === normalized.key ||
          (current.email && normalized.email && current.email === normalized.email) ||
          (current.userId && normalized.userId && current.userId === normalized.userId)
        );
      }) || normalized.key;
    const existing = directory.get(existingKey) || {};
    directory.set(existingKey, normalizeMember({
      ...existing,
      ...normalized,
      userId: normalized.userId || existing.userId || "",
      email: normalized.email || existing.email || "",
      name:
        normalized.name && normalized.name !== "CRM User"
          ? normalized.name
          : existing.name || normalized.name,
      role: strongerRole(existing.role, normalized.role),
    }));
  }

  function configuredAdminMembers() {
    try {
      return String(window.RooflineAuth?.config?.adminEmails || "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
        .map((email) => ({
          email,
          name: titleCase(email.split("@")[0]),
          role: "admin",
        }));
    } catch {
      return [];
    }
  }

  function collectTeamDirectory() {
    const directory = new Map();
    (state.company?.teamDirectory || []).forEach((member) => mergeMember(directory, member));
    mergeMember(directory, currentIdentity());
    configuredAdminMembers().forEach((member) => mergeMember(directory, member));

    try {
      cloudKnownOwners.forEach((owner) => mergeMember(directory, owner));
    } catch {}

    (state.contacts || []).forEach((contact) => {
      if (contact.ownerEmail || contact.ownerUserId) {
        mergeMember(directory, {
          userId: contact.ownerUserId,
          email: contact.ownerEmail,
          name: contact.ownerName || contact.salesRep,
          role: "sales",
        });
      }
    });

    return [...directory.values()].sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
  }

  function ensureTeamDirectory() {
    const next = collectTeamDirectory();
    const current = (state.company?.teamDirectory || []).map(normalizeMember);
    if (JSON.stringify(current) === JSON.stringify(next)) return false;
    state.company = {
      ...state.company,
      teamDirectory: next,
    };
    saveState();
    return true;
  }

  function teamDirectory() {
    const current = currentIdentity();
    return (state.company?.teamDirectory || [])
      .map(normalizeMember)
      .filter((member) => member.key && member.key !== current.key)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function conversationKey(contactId, jobId) {
    return `${contactId}::${jobId}`;
  }

  function conversationStore() {
    return state.company?.jobConversations || {};
  }

  function sharedConversation(contact, job) {
    const key = conversationKey(contact.id, job.id);
    const existing = conversationStore()[key] || {};
    return {
      key,
      contactId: contact.id,
      jobId: job.id,
      contactName: contact.name || existing.contactName || "Client",
      jobName: job.name || existing.jobName || "Project",
      status: job.status || existing.status || "Won",
      ownerUserId: job.ownerUserId || contact.ownerUserId || existing.ownerUserId || "",
      updatedAt: existing.updatedAt || "",
      messages: Array.isArray(existing.messages) ? existing.messages : [],
    };
  }

  function saveSharedConversation(entry) {
    state.company = {
      ...state.company,
      jobConversations: {
        ...conversationStore(),
        [entry.key]: entry,
      },
    };
    saveState();
  }

  function currentConversationJob(contact) {
    const jobs = contactJobs(contact);
    const selected = jobs.find((job) => job.id === selectedConversationJobId);
    const fallback = jobs.find(isSoldJob) || jobs[0];
    const job = selected || fallback;
    selectedConversationJobId = job?.id || "";
    return job;
  }

  function selectedMentionsFromMessage(message = "") {
    const lower = String(message).toLowerCase();
    const members = teamDirectory();
    const selected = new Map();
    members.forEach((member) => {
      if (
        selectedMentionKeys.has(member.key) ||
        lower.includes(`@${member.handle.toLowerCase()}`) ||
        (member.email && lower.includes(`@${member.email.toLowerCase()}`))
      ) {
        selected.set(member.key, member);
      }
    });
    return [...selected.values()].map((member) => ({
      key: member.key,
      userId: member.userId,
      email: member.email,
      name: member.name,
      handle: member.handle,
    }));
  }

  function appendMessage(contact, job, text) {
    const author = currentIdentity();
    const entry = sharedConversation(contact, job);
    const message = {
      id: uid("project_message"),
      authorUserId: author.userId,
      authorEmail: author.email,
      authorName: author.name,
      authorRole: author.role,
      text: String(text || "").trim().slice(0, 4000),
      mentions: selectedMentionsFromMessage(text),
      readBy: [author.key],
      createdAt: new Date().toISOString(),
    };
    const next = {
      ...entry,
      contactName: contact.name || entry.contactName,
      jobName: job.name || entry.jobName,
      status: job.status || entry.status,
      updatedAt: message.createdAt,
      messages: [...entry.messages, message].slice(-500),
    };
    saveSharedConversation(next);
    return message;
  }

  function safeText(value = "") {
    return escapeHtml(String(value)).replace(/\r?\n/g, "<br />");
  }

  function highlightedMessage(message) {
    let html = safeText(message.text || message.message || "");
    const mentions = Array.isArray(message.mentions) ? message.mentions : [];
    mentions.forEach((mention) => {
      const handle = escapeHtml(mention.handle || mentionHandle(mention));
      const email = escapeHtml(mention.email || "");
      if (handle) html = html.replaceAll(`@${handle}`, `<mark class="collab-mention">@${handle}</mark>`);
      if (email) html = html.replaceAll(`@${email}`, `<mark class="collab-mention">@${email}</mark>`);
    });
    return html || "Project update";
  }

  function initials(value = "") {
    const parts = String(value).trim().split(/\s+/).filter(Boolean);
    return `${parts[0]?.[0] || "U"}${parts[1]?.[0] || ""}`.toUpperCase();
  }

  function projectMessages(contact, job) {
    const shared = sharedConversation(contact, job).messages.map((message) => ({
      ...message,
      source: "project",
    }));
    const primary = primaryJob(contact);
    const legacy =
      primary?.id === job.id
        ? (contact.updates || []).map((update) => ({
            id: update.id,
            authorName: update.author || "CRM user",
            authorRole: "",
            text: update.message || "Status update",
            status: update.status || "",
            mentions: [],
            createdAt: update.createdAt,
            source: "lead",
          }))
        : [];
    return [...legacy, ...shared].sort(
      (a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime(),
    );
  }

  function messageMarkup(message, current) {
    const authorName = message.authorName || message.authorEmail || "CRM user";
    const own =
      (message.authorUserId && message.authorUserId === current.userId) ||
      (message.authorEmail && message.authorEmail.toLowerCase() === current.email);
    return `
      <article class="project-message ${own ? "own" : ""}">
        <div class="project-message-avatar" aria-hidden="true">${escapeHtml(initials(authorName))}</div>
        <div class="project-message-body">
          <div class="project-message-meta">
            <div>
              <strong>${escapeHtml(authorName)}</strong>
              ${
                message.authorRole
                  ? `<span>${escapeHtml(roleName(message.authorRole))}</span>`
                  : message.source === "lead"
                    ? "<span>Lead history</span>"
                    : ""
              }
            </div>
            <time datetime="${escapeHtml(message.createdAt || "")}">${escapeHtml(
              formatDateTime(message.createdAt),
            )}</time>
          </div>
          ${message.status ? `<span class="status-pill">${escapeHtml(message.status)}</span>` : ""}
          <p>${highlightedMessage(message)}</p>
        </div>
      </article>
    `;
  }

  function jobOptions(contact, selectedJobId) {
    return contactJobs(contact)
      .map(
        (job) => `
          <option value="${escapeHtml(job.id)}" ${job.id === selectedJobId ? "selected" : ""}>
            ${escapeHtml(job.name)} - ${escapeHtml(job.status)}
          </option>
        `,
      )
      .join("");
  }

  function mentionChipsMarkup() {
    const members = teamDirectory().filter((member) => selectedMentionKeys.has(member.key));
    if (!members.length) return "";
    return members
      .map(
        (member) => `
          <button class="mention-chip" type="button" data-collab-action="remove-mention" data-member-key="${escapeHtml(
            member.key,
          )}" aria-label="Remove ${escapeHtml(member.name)}">
            @${escapeHtml(member.handle)}
            <span aria-hidden="true">x</span>
          </button>
        `,
      )
      .join("");
  }

  function matchingMembers(query = "") {
    const clean = String(query).trim().replace(/^@/, "").toLowerCase();
    return teamDirectory()
      .filter((member) =>
        clean
          ? [member.name, member.email, member.handle, member.role]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(clean)
          : true,
      )
      .slice(0, 8);
  }

  function mentionSuggestionsMarkup(query = "") {
    const members = matchingMembers(query);
    if (!members.length) return '<div class="mention-empty">No matching teammates</div>';
    return members
      .map(
        (member) => `
          <button class="mention-suggestion" type="button" data-collab-action="add-mention" data-member-key="${escapeHtml(
            member.key,
          )}">
            <span class="mention-avatar" aria-hidden="true">${escapeHtml(initials(member.name))}</span>
            <span>
              <strong>${escapeHtml(member.name)}</strong>
              <small>@${escapeHtml(member.handle)}${member.email ? ` - ${escapeHtml(member.email)}` : ""}</small>
            </span>
            <span class="mention-role">${escapeHtml(roleName(member.role))}</span>
          </button>
        `,
      )
      .join("");
  }

  function enhancedConversationFormMarkup(contact, job, editable, draft = "") {
    const directory = teamDirectory();
    return `
      <div class="project-conversation-form-head">
        <div>
          <p class="eyebrow">Project conversation</p>
          <h3>${escapeHtml(job.name)}</h3>
        </div>
        <span class="status-pill">${escapeHtml(job.status)}</span>
      </div>
      <label>
        Job
        <select id="jobConversationSelect" name="jobId">
          ${jobOptions(contact, job.id)}
        </select>
      </label>
      ${
        editable
          ? `
            <label>
              Update
              <textarea id="jobConversationMessage" name="message" rows="5" required placeholder="Add a project update">${escapeHtml(
                draft,
              )}</textarea>
            </label>
            <div class="mention-picker ${directory.length ? "" : "hidden"}">
              <label>
                Mention teammates
                <input id="jobMentionSearch" type="search" autocomplete="off" placeholder="Search teammates" value="${escapeHtml(
                  mentionSuggestionQuery,
                )}" />
              </label>
              <div class="mention-chips" id="jobMentionChips">${mentionChipsMarkup()}</div>
              <div class="mention-suggestions hidden" id="jobMentionSuggestions">
                ${mentionSuggestionsMarkup(mentionSuggestionQuery)}
              </div>
            </div>
            <div class="builder-actions end">
              <button class="primary-button" type="submit">
                <span aria-hidden="true" data-icon="send"></span>
                Post Update
              </button>
            </div>
          `
          : '<div class="empty-state compact">This role can read project updates but cannot post them.</div>'
      }
    `;
  }

  function renderJobConversation() {
    if (!els.leadConversationPanel || !els.leadConversationForm || !els.leadConversationList) return;
    const contact = getSelectedContact();
    if (!contact) return;
    const job = currentConversationJob(contact);
    if (!job) return;

    const draftNode = document.querySelector("#jobConversationMessage");
    const currentDraft =
      draftNode && draftNode.dataset.contactId === contact.id && draftNode.dataset.jobId === job.id
        ? draftNode.value
        : "";
    const editable = canAction("manageJobs");

    els.leadConversationForm.dataset.jobConversationEnhanced = VERSION;
    els.leadConversationForm.innerHTML = enhancedConversationFormMarkup(contact, job, editable, currentDraft);
    const nextDraft = document.querySelector("#jobConversationMessage");
    if (nextDraft) {
      nextDraft.dataset.contactId = contact.id;
      nextDraft.dataset.jobId = job.id;
    }

    const messages = projectMessages(contact, job);
    const current = currentIdentity();
    els.leadConversationList.classList.add("job-conversation-feed");
    els.leadConversationList.innerHTML = messages.length
      ? messages.map((message) => messageMarkup(message, current)).join("")
      : '<div class="empty-state">No project updates yet</div>';
    hydrateIcons(els.leadConversationPanel);

    window.requestAnimationFrame(() => {
      els.leadConversationList.scrollTop = els.leadConversationList.scrollHeight;
    });
  }

  function submitJobConversation(event) {
    const form = event.target;
    if (form?.id !== "leadConversationForm" || form.dataset.jobConversationEnhanced !== VERSION) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!requireAction("manageJobs")) return;

    const contact = getSelectedContact();
    const job = contact ? currentConversationJob(contact) : null;
    const message = String(form.querySelector('[name="message"]')?.value || "").trim();
    if (!contact || !job || !message) {
      showToast("Add a project update before posting");
      return;
    }

    const posted = appendMessage(contact, job, message);
    selectedMentionKeys = new Set();
    mentionSuggestionQuery = "";
    state.leadDetailTab = "conversation";
    render();
    const mentionCount = posted.mentions.length;
    showToast(
      mentionCount
        ? `Update posted and ${mentionCount} teammate${mentionCount === 1 ? "" : "s"} mentioned`
        : "Project update posted",
    );
  }

  function addMentionToDraft(memberKey) {
    const member = teamDirectory().find((item) => item.key === memberKey);
    if (!member) return;
    selectedMentionKeys.add(member.key);
    const textarea = document.querySelector("#jobConversationMessage");
    if (textarea) {
      const handle = `@${member.handle}`;
      const before = textarea.value.slice(0, textarea.selectionStart ?? textarea.value.length);
      const after = textarea.value.slice(textarea.selectionEnd ?? textarea.value.length);
      const replaced = before.match(/(?:^|\s)@[^\s@]*$/)
        ? before.replace(/@[^\s@]*$/, handle)
        : `${before}${before && !/\s$/.test(before) ? " " : ""}${handle}`;
      textarea.value = `${replaced} ${after}`.trimStart();
      textarea.focus();
      const cursor = replaced.length + 1;
      textarea.setSelectionRange(cursor, cursor);
    }
    mentionSuggestionQuery = "";
    refreshMentionPicker();
  }

  function removeMentionFromDraft(memberKey) {
    const member = teamDirectory().find((item) => item.key === memberKey);
    selectedMentionKeys.delete(memberKey);
    const textarea = document.querySelector("#jobConversationMessage");
    if (textarea && member) {
      textarea.value = textarea.value
        .replace(new RegExp(`(^|\\s)@${member.handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "gi"), " ")
        .replace(/\s{2,}/g, " ")
        .trim();
    }
    refreshMentionPicker();
  }

  function refreshMentionPicker({ showSuggestions = false } = {}) {
    const chips = document.querySelector("#jobMentionChips");
    const suggestions = document.querySelector("#jobMentionSuggestions");
    const search = document.querySelector("#jobMentionSearch");
    if (chips) chips.innerHTML = mentionChipsMarkup();
    if (suggestions) {
      suggestions.innerHTML = mentionSuggestionsMarkup(mentionSuggestionQuery);
      suggestions.classList.toggle("hidden", !showSuggestions);
    }
    if (search && search.value !== mentionSuggestionQuery) search.value = mentionSuggestionQuery;
  }

  function trailingMentionQuery(textarea) {
    const cursor = textarea.selectionStart ?? textarea.value.length;
    const before = textarea.value.slice(0, cursor);
    const match = before.match(/(?:^|\s)@([A-Za-z0-9._-]*)$/);
    return match ? match[1] : null;
  }

  function handleMentionInput(event) {
    if (event.target?.id === "jobMentionSearch") {
      mentionSuggestionQuery = event.target.value;
      refreshMentionPicker({ showSuggestions: true });
      return;
    }
    if (event.target?.id === "jobConversationMessage") {
      const query = trailingMentionQuery(event.target);
      if (query === null) return;
      mentionSuggestionQuery = query;
      refreshMentionPicker({ showSuggestions: true });
    }
  }

  function handleMentionFocus(event) {
    if (event.target?.id !== "jobMentionSearch") return;
    mentionSuggestionQuery = event.target.value;
    refreshMentionPicker({ showSuggestions: true });
  }

  function filteredJobsForTable() {
    const query = String(state.search || "").trim().toLowerCase();
    return allJobs().filter((job) =>
      query
        ? [job.name, job.address, job.status, job.salesRep, job.contactName]
            .filter(Boolean)
            .join(" ")
            .toLowerCase()
            .includes(query)
        : true,
    );
  }

  function soldProjects() {
    return allJobs().filter(isSoldJob);
  }

  function conversationButton(contactId, jobId, compact = false) {
    return `
      <button class="${compact ? "mini-button" : "secondary-button"}" type="button" ${
        compact ? 'title="Project conversation" aria-label="Open project conversation"' : ""
      } data-collab-action="open-job-conversation" data-contact-id="${escapeHtml(
        contactId,
      )}" data-job-id="${escapeHtml(jobId)}">
        <span aria-hidden="true" data-icon="send"></span>
        ${compact ? "" : "Conversation"}
      </button>
    `;
  }

  function augmentProjectsView() {
    if (!els.projectsGrid) return;
    const jobs = soldProjects();
    [...els.projectsGrid.querySelectorAll(".record-card")].forEach((card, index) => {
      const job = jobs[index];
      const actions = card.querySelector(".row-actions");
      if (!job || !actions || actions.querySelector("[data-collab-action='open-job-conversation']")) return;
      actions.insertAdjacentHTML("beforeend", conversationButton(job.contactId, job.id));
    });
    hydrateIcons(els.projectsGrid);
  }

  function augmentJobsView() {
    if (!els.jobsTableBody) return;
    const jobs = filteredJobsForTable();
    [...els.jobsTableBody.querySelectorAll("tr")].forEach((row, index) => {
      const job = jobs[index];
      const cell = row.lastElementChild;
      if (!job || !cell || !isSoldJob(job) || cell.querySelector("[data-collab-action='open-job-conversation']")) return;
      cell.insertAdjacentHTML("beforeend", conversationButton(job.contactId, job.id, true));
    });
    hydrateIcons(els.jobsTableBody);
  }

  function augmentLeadJobCards() {
    if (!els.leadJobsList || state.view !== "leadDetail") return;
    const contact = getSelectedContact();
    if (!contact) return;
    const jobs = contactJobs(contact);
    [...els.leadJobsList.querySelectorAll(".job-card")].forEach((card, index) => {
      const job = jobs[index];
      const actions = card.querySelector(".row-actions");
      if (!job || !actions || !isSoldJob(job) || actions.querySelector("[data-collab-action='open-job-conversation']")) {
        return;
      }
      actions.prepend(htmlToElement(conversationButton(contact.id, job.id)));
    });
    hydrateIcons(els.leadJobsList);
  }

  function htmlToElement(html) {
    const template = document.createElement("template");
    template.innerHTML = html.trim();
    return template.content.firstElementChild;
  }

  function openJobConversation(contactId, jobId) {
    const contact = getContact(contactId);
    if (!contact) {
      showToast("This project conversation is shared, but its lead record remains private");
      return false;
    }
    selectedConversationJobId = jobId;
    selectedMentionKeys = new Set();
    mentionSuggestionQuery = "";
    state.selectedContactId = contactId;
    state.leadDetailTab = "conversation";
    state.view = "leadDetail";
    saveState();
    render();
    return true;
  }

  function allMentionedMessages() {
    const current = currentIdentity();
    const entries = Object.values(conversationStore());
    const items = [];
    entries.forEach((entry) => {
      (entry.messages || []).forEach((message) => {
        const mentioned = (message.mentions || []).some(
          (mention) =>
            mention.key === current.key ||
            (mention.email && mention.email.toLowerCase() === current.email) ||
            (mention.userId && mention.userId === current.userId),
        );
        if (!mentioned) return;
        items.push({
          entry,
          message,
          read: (message.readBy || []).includes(current.key),
        });
      });
    });
    return items.sort(
      (a, b) => new Date(b.message.createdAt || 0).getTime() - new Date(a.message.createdAt || 0).getTime(),
    );
  }

  function unreadMentionCount() {
    return allMentionedMessages().filter((item) => !item.read).length;
  }

  function installMentionButton() {
    const taskButton = document.querySelector(".notification-button");
    if (!taskButton || document.querySelector("#mentionNotificationsButton")) return;
    taskButton.insertAdjacentHTML(
      "afterend",
      `
        <button class="icon-button mention-notification-button" type="button" id="mentionNotificationsButton" data-collab-action="open-mentions" aria-label="Open mentions">
          <span class="mention-at-symbol" aria-hidden="true">@</span>
          <span class="notification-dot hidden" id="mentionNotificationCount">0</span>
        </button>
      `,
    );
    hydrateIcons(taskButton.parentElement);
  }

  function installMentionDialog() {
    if (document.querySelector("#mentionNotificationsDialog")) return;
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <dialog class="mention-dialog" id="mentionNotificationsDialog" aria-labelledby="mentionDialogTitle">
          <div class="mention-dialog-head">
            <div>
              <p class="eyebrow">Team activity</p>
              <h2 id="mentionDialogTitle">Mentions</h2>
            </div>
            <button class="icon-button" type="button" data-collab-action="close-mentions" aria-label="Close mentions">
              <span aria-hidden="true" data-icon="x"></span>
            </button>
          </div>
          <div class="mention-dialog-list" id="mentionDialogList"></div>
        </dialog>
      `,
    );
    hydrateIcons(document.querySelector("#mentionNotificationsDialog"));
  }

  function updateMentionButton() {
    installMentionButton();
    const badge = document.querySelector("#mentionNotificationCount");
    if (!badge) return;
    const count = unreadMentionCount();
    badge.textContent = String(count);
    badge.classList.toggle("hidden", count === 0);
    document.querySelector("#mentionNotificationsButton")?.setAttribute(
      "aria-label",
      count ? `Open mentions, ${count} unread` : "Open mentions",
    );
  }

  function markMentionsRead() {
    const current = currentIdentity();
    const nextStore = {};
    let changed = false;
    Object.entries(conversationStore()).forEach(([key, entry]) => {
      const messages = (entry.messages || []).map((message) => {
        const isForCurrent = (message.mentions || []).some(
          (mention) =>
            mention.key === current.key ||
            (mention.email && mention.email.toLowerCase() === current.email) ||
            (mention.userId && mention.userId === current.userId),
        );
        if (!isForCurrent || (message.readBy || []).includes(current.key)) return message;
        changed = true;
        return {
          ...message,
          readBy: [...new Set([...(message.readBy || []), current.key])],
        };
      });
      nextStore[key] = { ...entry, messages };
    });
    if (!changed) return;
    state.company = { ...state.company, jobConversations: nextStore };
    saveState();
  }

  function mentionsDialogMarkup() {
    const items = allMentionedMessages();
    if (!items.length) return '<div class="empty-state">No mentions yet</div>';
    return items
      .map(
        ({ entry, message }) => `
          <article class="mention-notification-item">
            <div class="mention-notification-meta">
              <div>
                <strong>${escapeHtml(entry.jobName || "Project")}</strong>
                <span>${escapeHtml(entry.contactName || "Client")}</span>
              </div>
              <time datetime="${escapeHtml(message.createdAt || "")}">${escapeHtml(
                formatDateTime(message.createdAt),
              )}</time>
            </div>
            <p class="mention-notification-author">${escapeHtml(
              message.authorName || message.authorEmail || "CRM user",
            )}</p>
            <p>${highlightedMessage(message)}</p>
            <div class="row-actions">
              ${
                getContact(entry.contactId)
                  ? `<button class="secondary-button" type="button" data-collab-action="open-mentioned-conversation" data-contact-id="${escapeHtml(
                      entry.contactId,
                    )}" data-job-id="${escapeHtml(entry.jobId)}">
                      <span aria-hidden="true" data-icon="send"></span>
                      Open Conversation
                    </button>`
                  : '<span class="mention-private-note">Shared project update</span>'
              }
            </div>
          </article>
        `,
      )
      .join("");
  }

  function openMentionsDialog() {
    installMentionDialog();
    markMentionsRead();
    const dialog = document.querySelector("#mentionNotificationsDialog");
    const list = document.querySelector("#mentionDialogList");
    if (list) list.innerHTML = mentionsDialogMarkup();
    updateMentionButton();
    hydrateIcons(dialog);
    if (dialog?.showModal) dialog.showModal();
    else dialog?.setAttribute("open", "");
  }

  function closeMentionsDialog() {
    const dialog = document.querySelector("#mentionNotificationsDialog");
    if (dialog?.close) dialog.close();
    else dialog?.removeAttribute("open");
  }

  function handleCollaborationClick(event) {
    const button = event.target.closest("[data-collab-action]");
    if (!button) return;
    const action = button.dataset.collabAction;
    event.preventDefault();
    event.stopImmediatePropagation();

    if (action === "open-job-conversation") {
      openJobConversation(button.dataset.contactId, button.dataset.jobId);
      return;
    }
    if (action === "add-mention") {
      addMentionToDraft(button.dataset.memberKey);
      return;
    }
    if (action === "remove-mention") {
      removeMentionFromDraft(button.dataset.memberKey);
      return;
    }
    if (action === "open-mentions") {
      openMentionsDialog();
      return;
    }
    if (action === "close-mentions") {
      closeMentionsDialog();
      return;
    }
    if (action === "open-mentioned-conversation") {
      closeMentionsDialog();
      openJobConversation(button.dataset.contactId, button.dataset.jobId);
    }
  }

  function handleConversationJobChange(event) {
    if (event.target?.id !== "jobConversationSelect") return;
    selectedConversationJobId = event.target.value;
    selectedMentionKeys = new Set();
    mentionSuggestionQuery = "";
    renderLeadDetail();
  }

  function installStyles() {
    if (document.querySelector("#projectConversationStylesV67")) return;
    const style = document.createElement("style");
    style.id = "projectConversationStylesV67";
    style.textContent = `
      #leadConversationPanel .conversation-layout {
        grid-template-columns: minmax(280px, .72fr) minmax(0, 1.28fr);
        align-items: start;
      }
      .project-conversation-form-head,
      .project-message-meta,
      .mention-dialog-head,
      .mention-notification-meta {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 14px;
      }
      .project-conversation-form-head h3,
      .mention-dialog-head h2 {
        margin: 3px 0 0;
        font-size: 17px;
      }
      .mention-picker {
        position: relative;
        display: grid;
        gap: 8px;
      }
      .mention-chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
      }
      .mention-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 30px;
        padding: 0 9px;
        border: 1px solid #93c5fd;
        border-radius: 6px;
        background: #eff6ff;
        color: #1d4ed8;
        font-size: 11px;
        font-weight: 800;
      }
      .mention-suggestions {
        max-height: 250px;
        overflow-y: auto;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #fff;
        box-shadow: 0 12px 28px rgba(15,23,42,.12);
      }
      .mention-suggestion {
        width: 100%;
        min-height: 54px;
        display: grid;
        grid-template-columns: 34px minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        padding: 8px 10px;
        border: 0;
        border-bottom: 1px solid var(--line);
        background: #fff;
        color: var(--ink);
        text-align: left;
      }
      .mention-suggestion:last-child { border-bottom: 0; }
      .mention-suggestion:hover { background: #f8fafc; }
      .mention-suggestion > span:nth-child(2) {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .mention-suggestion small {
        overflow-wrap: anywhere;
        color: var(--muted);
        font-size: 10px;
      }
      .mention-avatar,
      .project-message-avatar {
        display: grid;
        place-items: center;
        border-radius: 50%;
        background: #dbeafe;
        color: #1d4ed8;
        font-size: 11px;
        font-weight: 900;
      }
      .mention-avatar {
        width: 34px;
        height: 34px;
      }
      .mention-role {
        color: var(--muted);
        font-size: 10px;
        font-weight: 700;
      }
      .mention-empty {
        padding: 14px;
        color: var(--muted);
        font-size: 12px;
        text-align: center;
      }
      .job-conversation-feed {
        max-height: 560px;
        min-height: 320px;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 10px;
        padding: 4px 6px 4px 0;
        scroll-behavior: smooth;
      }
      .project-message {
        display: grid;
        grid-template-columns: 38px minmax(0, 1fr);
        gap: 10px;
      }
      .project-message-avatar {
        width: 38px;
        height: 38px;
        background: #e2e8f0;
        color: #334155;
      }
      .project-message.own .project-message-avatar {
        background: #dbeafe;
        color: #1d4ed8;
      }
      .project-message-body {
        min-width: 0;
        padding: 11px 12px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #fff;
      }
      .project-message.own .project-message-body {
        border-left: 3px solid #2563eb;
        background: #f8fbff;
      }
      .project-message-meta > div {
        min-width: 0;
        display: flex;
        align-items: baseline;
        gap: 7px;
        flex-wrap: wrap;
      }
      .project-message-meta strong {
        color: var(--ink);
        font-size: 12px;
      }
      .project-message-meta span,
      .project-message-meta time {
        color: var(--muted);
        font-size: 10px;
      }
      .project-message-body > p {
        margin: 8px 0 0;
        overflow-wrap: anywhere;
        color: var(--ink);
        font-size: 12px;
        line-height: 1.55;
      }
      .project-message-body > .status-pill {
        margin-top: 8px;
      }
      .collab-mention {
        padding: 1px 3px;
        border-radius: 3px;
        background: #dbeafe;
        color: #1d4ed8;
        font-weight: 800;
      }
      .mention-notification-button {
        position: relative;
      }
      .mention-at-symbol {
        font-size: 18px;
        font-weight: 800;
        line-height: 1;
      }
      .mention-notification-button .notification-dot {
        position: absolute;
        top: -4px;
        right: -4px;
        min-width: 18px;
        height: 18px;
        display: grid;
        place-items: center;
        padding: 0 4px;
        border: 2px solid #fff;
        border-radius: 9px;
        background: #dc2626;
        color: #fff;
        font-size: 9px;
        font-weight: 900;
      }
      .mention-dialog {
        width: min(680px, calc(100vw - 32px));
        max-height: min(760px, calc(100vh - 32px));
        padding: 0;
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: #fff;
        color: var(--ink);
        box-shadow: 0 24px 64px rgba(15,23,42,.24);
      }
      .mention-dialog::backdrop {
        background: rgba(15,23,42,.46);
      }
      .mention-dialog-head {
        padding: 17px 18px;
        border-bottom: 1px solid var(--line);
      }
      .mention-dialog-list {
        max-height: calc(100vh - 150px);
        overflow-y: auto;
        display: grid;
      }
      .mention-notification-item {
        display: grid;
        gap: 8px;
        padding: 15px 18px;
        border-bottom: 1px solid var(--line);
      }
      .mention-notification-item:last-child { border-bottom: 0; }
      .mention-notification-meta > div {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      .mention-notification-meta span,
      .mention-notification-meta time,
      .mention-notification-author,
      .mention-private-note {
        color: var(--muted);
        font-size: 10px;
      }
      .mention-notification-item > p {
        margin: 0;
        overflow-wrap: anywhere;
        font-size: 12px;
        line-height: 1.5;
      }
      .mention-notification-author {
        font-weight: 800;
      }
      @media (max-width: 900px) {
        #leadConversationPanel .conversation-layout {
          grid-template-columns: 1fr;
        }
        .job-conversation-feed {
          min-height: 260px;
          max-height: 480px;
        }
      }
      @media (max-width: 520px) {
        .project-message-meta,
        .mention-notification-meta {
          flex-direction: column;
          gap: 3px;
        }
        .mention-suggestion {
          grid-template-columns: 34px minmax(0, 1fr);
        }
        .mention-role {
          grid-column: 2;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function installProjectConversations() {
    if (!hasAppGlobals() || window.__rooflineProjectConversationsV67Installed) return false;
    window.__rooflineProjectConversationsV67Installed = true;
    installStyles();
    installMentionButton();
    installMentionDialog();
    ensureTeamDirectory();

    previousRenderLeadDetail = renderLeadDetail;
    assignGlobal("renderLeadDetail", function projectConversationLeadDetailWrapper() {
      previousRenderLeadDetail();
      renderJobConversation();
      augmentLeadJobCards();
      updateMentionButton();
    });

    previousRender = render;
    assignGlobal("render", function projectConversationRenderWrapper() {
      previousRender();
      ensureTeamDirectory();
      renderJobConversation();
      augmentProjectsView();
      augmentJobsView();
      augmentLeadJobCards();
      updateMentionButton();
    });

    document.addEventListener("submit", submitJobConversation, true);
    document.addEventListener("click", handleCollaborationClick, true);
    document.addEventListener("change", handleConversationJobChange, true);
    document.addEventListener("input", handleMentionInput, true);
    document.addEventListener("focusin", handleMentionFocus, true);

    window.RooflineProjectConversations = {
      version: VERSION,
      teamDirectory,
      sharedConversation,
      unreadMentionCount,
      openJobConversation,
    };

    try {
      render();
    } catch {
      renderJobConversation();
      updateMentionButton();
    }
    return true;
  }

  const timer = window.setInterval(() => {
    if (installProjectConversations()) window.clearInterval(timer);
  }, 200);
  window.setTimeout(() => window.clearInterval(timer), 20000);
})();
