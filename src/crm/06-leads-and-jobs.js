function renderLeadCard(contact) {
  if (globalThis.window?.RooflineProductionFlow?.renderLeadCard) return window.RooflineProductionFlow.renderLeadCard(contact);
  const job = primaryJob(contact);
  const nextStatus = statuses[Math.min(statuses.indexOf(contact.status) + 1, statuses.length - 1)];
  const days = staleLeadDays(contact);
  const sc = staleClass(contact);
  const staleTag = sc ? `<span class="stale-badge ${sc}">${days}d no contact</span>` : "";
  const initials = contactInitials(contact.name);
  const avatarClass = initialsColor(contact.name);
  return `
    <article class="lead-card ${sc}">
      <header>
        <div class="lead-card-avatar ${avatarClass}">${escapeHtml(initials)}</div>
        <div class="lead-card-header-text">
          <h4>
            <button class="link-button" type="button" data-action="open-contact" data-contact-id="${contact.id}">
              ${escapeHtml(contact.name)}
            </button>
          </h4>
          <p>${escapeHtml(contact.source || "No source")} &middot; ${money.format(
            contactJobs(contact).reduce((sum, item) => sum + number(item.value), 0),
          )}</p>
        </div>
        <span class="status-pill ${statusPillClass(contact.status)}">${escapeHtml(leadStatusLabel(contact.status))}</span>
      </header>
      ${staleTag}
      <p>${telLink(contact.phone) || "No phone"}<br />${escapeHtml(contact.email || "No email")}</p>
      <p>${escapeHtml(job.name)}<br />${escapeHtml((job.address || contact.address || "").split("\n")[0] || "No job address")}</p>
      <div class="card-actions">
        <button class="secondary-button" type="button" data-action="open-contact" data-contact-id="${contact.id}">
          <span aria-hidden="true" data-icon="open"></span>
          Open
        </button>
        <button class="mini-button" type="button" title="Edit contact" aria-label="Edit ${escapeHtml(
          contact.name,
        )}" data-action="edit-contact" data-contact-id="${contact.id}">
          <span aria-hidden="true" data-icon="edit"></span>
        </button>
        <button class="mini-button" type="button" title="Create estimate" aria-label="Create estimate for ${escapeHtml(
          contact.name,
        )}" data-action="estimate-contact" data-contact-id="${contact.id}">
          <span aria-hidden="true" data-icon="file"></span>
        </button>
        ${
          contact.status !== "Lost" && contact.status !== "Won"
            ? `<button class="ghost-button" type="button" data-action="advance-contact" data-contact-id="${contact.id}" data-next-status="${nextStatus}">${nextStatus}</button>`
            : ""
        }
      </div>
    </article>
  `;
}

// Contacts page controls. The page used to be one unsorted, unpaged list of
// every record with no way to narrow it.
let contactsSort = "name";
let contactsTypeFilter = "all";
let contactsDisplayLimit = 50;
const CONTACTS_PAGE_SIZE = 50;
const contactsSorters = {
  name: (a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }),
  newest: (a, b) => activityTimestamp(createdMoment(b)) - activityTimestamp(createdMoment(a)),
  updated: (a, b) => leadActivityTimestamp(b) - leadActivityTimestamp(a),
  value: (a, b) => contactJobs(b).reduce((sum, job) => sum + number(job.value), 0) - contactJobs(a).reduce((sum, job) => sum + number(job.value), 0),
};

function contactsForCurrentFilters() {
  const archived = contactsTypeFilter === "archived";
  const pool = archived ? archivedContacts() : visibleContacts();
  const searched = !state.search.trim() ? pool : pool.filter((contact) => contactMatchesSearch(contact, state.search));
  const duplicateIds = contactsTypeFilter === "duplicates" ? duplicateContactIds(visibleContacts()) : null;
  const filtered = searched.filter((contact) => {
    if (contactsTypeFilter === "leads") return contact.type !== "Customer";
    if (contactsTypeFilter === "customers") return contact.type === "Customer";
    if (duplicateIds) return duplicateIds.has(contact.id);
    return true;
  });
  // Possible duplicates are listed side by side.
  const sorter = duplicateIds
    ? (a, b) => String(contactIdentityKeys(a)[0] || "").localeCompare(String(contactIdentityKeys(b)[0] || "")) || contactsSorters.name(a, b)
    : contactsSorters[contactsSort] || contactsSorters.name;
  return [...filtered].sort(sorter);
}

function renderContactsControls(total, shown) {
  const table = els.contactsTableBody.closest?.(".table-wrap");
  if (!table?.parentElement) return;
  let controls = table.parentElement.querySelector(":scope > .contacts-controls");
  if (!controls) {
    controls = document.createElement("div");
    controls.className = "contacts-controls";
    table.before(controls);
    controls.addEventListener("change", (event) => {
      if (event.target.matches("[data-contacts-sort]")) contactsSort = event.target.value;
      if (event.target.matches("[data-contacts-filter]")) contactsTypeFilter = event.target.value;
      contactsDisplayLimit = CONTACTS_PAGE_SIZE;
      renderContacts();
    });
  }
  const archivedCount = archivedContacts().length;
  const duplicateCount = duplicateContactIds(visibleContacts()).size;
  const option = (value, label, selected) => `<option value="${value}" ${selected === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
  controls.innerHTML = `
    <label>Show
      <select data-contacts-filter aria-label="Filter contacts">
        ${option("all", "Leads and customers", contactsTypeFilter)}
        ${option("leads", "Leads only", contactsTypeFilter)}
        ${option("customers", "Customers only", contactsTypeFilter)}
        ${option("duplicates", `Possible duplicates (${duplicateCount})`, contactsTypeFilter)}
        ${archivedCount || contactsTypeFilter === "archived" ? option("archived", `Archived (${archivedCount})`, contactsTypeFilter) : ""}
      </select>
    </label>
    <label>Sort by
      <select data-contacts-sort aria-label="Sort contacts" ${contactsTypeFilter === "duplicates" ? "disabled" : ""}>
        ${option("name", "Name A–Z", contactsSort)}
        ${option("newest", "Newest first", contactsSort)}
        ${option("updated", "Recently updated", contactsSort)}
        ${option("value", "Highest job value", contactsSort)}
      </select>
    </label>
    <span class="contacts-count" role="status">${coreRecordsArePartial() ? "Loading all records…" : `Showing ${shown} of ${total}`}</span>`;
}

function renderContacts() {
  const allMatching = contactsForCurrentFilters();
  const contacts = allMatching.slice(0, contactsDisplayLimit);
  renderContactsControls(allMatching.length, contacts.length);
  const query = state.search.trim().toLowerCase();
  els.contactsTableBody.innerHTML = contacts.length
    ? contacts
        .map((contact) => {
          const jobs = contactJobs(contact);
          const matchingJobs = query
            ? jobs.filter((job) =>
                [job.name, job.address, job.status, job.salesRep, job.notes]
                  .filter(Boolean)
                  .join(" ")
                  .toLowerCase()
                  .includes(query),
              )
            : jobs;
          const visibleJobs = matchingJobs.length ? matchingJobs : jobs;
          const totalValue = jobs.reduce((sum, job) => sum + number(job.value), 0);
          return `
        <tr>
          <td class="person-cell">
            <button class="link-button" type="button" data-action="open-contact" data-contact-id="${contact.id}">
              ${escapeHtml(contact.name)}
            </button>
            <span>${jobs.length} job${jobs.length === 1 ? "" : "s"}</span>
            <span>${visibleJobs
              .slice(0, 2)
              .map((job) => `${escapeHtml(job.name)} - ${escapeHtml((job.address || "").split("\n")[0] || "No address")}`)
              .join("<br />")}</span>
          </td>
          <td><span class="type-pill">${escapeHtml(contact.type)}</span></td>
          <td><span class="status-pill">${escapeHtml(leadStatusLabel(contact.status))}</span></td>
          <td>${escapeHtml(contact.salesRep || "Unassigned")}</td>
          <td class="contact-lines">
            <span>${escapeHtml(displayPhone(contact.phone) || "No phone")}</span>
            <span>${escapeHtml(contact.email || "No email")}</span>
          </td>
          <td>${money.format(totalValue)}</td>
          <td>
            <div class="row-actions">
              ${contact.archived ? `<button class="secondary-button" type="button" data-contact-restore="${escapeHtml(contact.id)}">Restore</button>` : `
              <button class="mini-button" type="button" title="Edit contact" aria-label="Edit ${escapeHtml(
                contact.name,
              )}" data-action="edit-contact" data-contact-id="${contact.id}">
                <span aria-hidden="true" data-icon="edit"></span>
              </button>
              <button class="mini-button" type="button" title="Create estimate" aria-label="Create estimate for ${escapeHtml(
                contact.name,
              )}" data-action="estimate-contact" data-contact-id="${contact.id}">
                <span aria-hidden="true" data-icon="file"></span>
              </button>
              ${canManageTeamData() ? `<button class="mini-button" type="button" title="Archive lead" aria-label="Archive ${escapeHtml(contact.name)}" data-contact-archive="${escapeHtml(contact.id)}"><span aria-hidden="true" data-icon="folder"></span></button>` : ""}`}
            </div>
          </td>
        </tr>
      `;
        })
        .join("")
    : `<tr><td colspan="7"><div class="empty-state">${contactsTypeFilter === "duplicates" ? "No possible duplicates found" : contactsTypeFilter === "archived" ? "No archived leads" : "No matching contacts"}</div></td></tr>`;
  if (allMatching.length > contacts.length) {
    els.contactsTableBody.insertAdjacentHTML("beforeend", `<tr><td colspan="7"><div class="server-page-footer"><span>Showing ${contacts.length} of ${allMatching.length}</span><button class="secondary-button" type="button" data-contacts-more>Show ${Math.min(CONTACTS_PAGE_SIZE, allMatching.length - contacts.length)} more</button></div></td></tr>`);
  }
  els.contactsTableBody.querySelector("[data-contacts-more]")?.addEventListener("click", () => { contactsDisplayLimit += CONTACTS_PAGE_SIZE; renderContacts(); });
  els.contactsTableBody.querySelectorAll("[data-contact-archive]").forEach((button) => button.addEventListener("click", () => void setContactArchived(button.dataset.contactArchive, true)));
  els.contactsTableBody.querySelectorAll("[data-contact-restore]").forEach((button) => button.addEventListener("click", () => void setContactArchived(button.dataset.contactRestore, false)));
  hydrateIcons(els.contactsTableBody);
}

function renderLeadsView() {
  if (!els.leadsList) return;
  ensureServerRecordPage("leads");
  const stageOptions = allPipelineStages();
  const stage = stageOptions.includes(state.leadStageFilter) ? state.leadStageFilter : "";
  const activeTag = (state.leadTags || []).some((tag) => tag.id === state.leadTagFilter) ? state.leadTagFilter : "";
  if (els.leadStageFilter) {
    // Counts are only shown once every lead is in memory. Counting the first
    // page gave "117 open" on one visit and "207" on the next.
    const countsReady = !coreRecordsArePartial();
    const openLeadCount = visibleContacts().filter((contact) =>
      contactJobs(contact).some((job) => !["Paid", "Lost"].includes(job.status)),
    ).length;
    els.leadStageFilter.innerHTML = [
      `<option value="">All open leads${countsReady ? ` (${openLeadCount})` : ""}</option>`,
      ...stageOptions.map((pipelineStage) => {
        const count = visibleContacts().filter((contact) =>
          contactJobs(contact).some((job) => job.status === pipelineStage),
        ).length;
        return `<option value="${escapeHtml(pipelineStage)}">${escapeHtml(leadStatusLabel(pipelineStage))}${countsReady ? ` (${count})` : ""}</option>`;
      }),
    ].join("");
    els.leadStageFilter.value = stage;
  }
  if (els.leadTagFilter) {
    els.leadTagFilter.innerHTML = '<option value="">All tags</option>' + (state.leadTags || []).filter((tag) => tag.active !== false).map((tag) => `<option value="${escapeHtml(tag.id)}">${escapeHtml(tag.name)}</option>`).join("");
    els.leadTagFilter.value = activeTag;
  }
  if (els.savedLeadFilter) {
    els.savedLeadFilter.innerHTML = '<option value="">Current view</option>' + (state.savedLeadFilters || []).map((filter) => `<option value="${escapeHtml(filter.id)}">${escapeHtml(filter.name)}</option>`).join("");
    els.savedLeadFilter.value = state.savedLeadFilterId || "";
  }
  const serverPage = serverRecordPages.leads;
  const useServerPage = Boolean(recordPageClient && serverPage.queryKey === serverPageQueryKey("leads") && !serverPage.error && !activeTag);
  const leads = useServerPage
    ? serverPage.items.map(normalizeServerLeadItem).filter((contact) => !contact.archived && !getContact(contact.id)?.archived)
    : sortLeadIntakeChronologically(filteredContacts().filter((contact) =>
      (stage
        ? contactJobs(contact).some((job) => job.status === stage)
        : contactJobs(contact).some((job) => !["Paid", "Lost"].includes(job.status)))
        && (!activeTag || (state.recordTags || []).some((item) => item.recordType === "lead" && item.recordId === contact.id && item.tagId === activeTag)),
    ));
  const matchingLeadCount = useServerPage ? serverPage.totalCount : leads.length;
  const filterSummary = stage
    ? `
      <div class="lead-stage-filter-banner">
        <div>
          <span class="status-pill">${escapeHtml(leadStatusLabel(stage))}</span>
          <strong>${matchingLeadCount} ${matchingLeadCount === 1 ? "lead" : "leads"} in this pipeline stage</strong>
          <small>Showing every lead with a job currently in ${escapeHtml(stage)}.</small>
        </div>
        <button class="secondary-button" type="button" data-action="clear-lead-stage-filter">Show all leads</button>
      </div>
    `
    : "";
  const pageFooter = useServerPage
    ? `<div class="server-page-footer"><span>Showing ${leads.length} of ${serverPage.totalCount} leads</span>${serverPage.hasMore ? `<button class="secondary-button" type="button" data-action="load-more-leads" ${serverPage.loading ? "disabled" : ""}>${serverPage.loading ? "Loading…" : "Load 50 more"}</button>` : ""}</div>`
    : "";
  els.leadsList.innerHTML = filterSummary + (leads.length
    ? leads.map((contact) => renderRecordCard(contact)).join("")
    : `<div class="empty-state">${serverPage.loading ? "Loading leads…" : `No leads are currently in ${escapeHtml(stage || "this view")}`}</div>`) + pageFooter;
  hydrateIcons(els.leadsList);
}

async function saveCurrentLeadFilter() {
  const name = String((await appPrompt("Save this lead view", "My lead view", { label: "View name", confirmLabel: "Save view", maxLength: 120 })) || "").trim().slice(0,120);
  if (!name) return;
  const filter={id:uid("filter"),name,viewName:"leads",criteria:{stage:state.leadStageFilter||"",tagId:state.leadTagFilter||"",search:state.search||""}};
  try {
    if(canUseCloudSync()){
      const {error}=await cloudClient.from("crm_saved_filters").insert({company_state_id:supabaseStateId(),id:filter.id,owner_user_id:authSession.user.id,name:filter.name,view_name:"leads",criteria:filter.criteria});
      if(error)throw error;await initializeLeadOrganization();
    } else state.savedLeadFilters.push(filter);
    state.savedLeadFilterId=filter.id;saveUiState();saveState({localOnly:true});renderLeadsView();showToast(`Saved view: ${name}`);
  }catch(error){console.error(error);showToast(error?.message||"The view could not be saved");}
}

function applySavedLeadFilter(filterId) {
  const filter=(state.savedLeadFilters||[]).find((item)=>item.id===filterId);
  state.savedLeadFilterId=filter?.id||"";
  if(filter){state.leadStageFilter=allPipelineStages().includes(filter.criteria?.stage)?filter.criteria.stage:"";state.leadTagFilter=filter.criteria?.tagId||"";state.search=String(filter.criteria?.search||"");if(els.globalSearch)els.globalSearch.value=state.search;}
  saveUiState();renderLeadsView();
}

function renderJobsView() {
  if (!els.jobsTableBody) return;
  ensureServerRecordPage("jobs");
  const query = state.search.trim().toLowerCase();
  const serverPage = serverRecordPages.jobs;
  const useServerPage = Boolean(recordPageClient && serverPage.queryKey === serverPageQueryKey("jobs") && !serverPage.error);
  const jobs = useServerPage ? serverPage.items.map(normalizeServerJobItem).filter((job) => !getContact(job.contactId)?.archived) : allJobs().filter((job) =>
    query
      ? [job.projectNumber, job.name, job.address, job.status, job.salesRep, job.contactName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query)
      : true,
  );
  els.jobsTableBody.innerHTML = jobs.length
    ? jobs
        .map(
          (job) => `
          <tr>
            <td class="person-cell">
              <button class="link-button job-name-link" type="button" data-action="open-job" data-contact-id="${job.contactId}" data-job-id="${job.id}">
                ${escapeHtml(job.name)}
              </button>
              ${job.projectNumber ? `<span>${escapeHtml(job.projectNumber)}</span>` : ""}
              <span>${escapeHtml(job.contactType)}</span>
            </td>
            <td>
              <button class="link-button" type="button" data-action="open-contact" data-contact-id="${job.contactId}">
                ${escapeHtml(job.contactName)}
              </button>
            </td>
            <td><span class="status-pill">${escapeHtml(leadStatusLabel(job.status))}</span></td>
            <td>${escapeHtml(job.salesRep || "Unassigned")}</td>
            <td>${money.format(number(job.value))}</td>
            <td>${escapeHtml((job.address || "No address").split("\n")[0])}</td>
            <td>
              <button class="secondary-button" type="button" data-action="open-job" data-contact-id="${job.contactId}" data-job-id="${job.id}">
                <span aria-hidden="true" data-icon="open"></span>
                Open Job
              </button>
            </td>
          </tr>
        `,
        )
        .join("")
    : `<tr><td colspan="7"><div class="empty-state">${serverPage.loading ? "Loading jobs…" : "No matching jobs"}</div></td></tr>`;
  if (useServerPage) {
    els.jobsTableBody.insertAdjacentHTML("beforeend", `<tr><td colspan="7"><div class="server-page-footer"><span>Showing ${jobs.length} of ${serverPage.totalCount} jobs</span>${serverPage.hasMore ? `<button class="secondary-button" type="button" data-action="load-more-jobs" ${serverPage.loading ? "disabled" : ""}>${serverPage.loading ? "Loading…" : "Load 50 more"}</button>` : ""}</div></td></tr>`);
  }
  hydrateIcons(els.jobsTableBody);
}

// Sold Jobs & Production. A job belongs here from the moment it is sold in its
// own division (Won, Contract, Scheduled) until it is paid in full. Jobs still
// being delivered and jobs already paid are separate lists, so "production"
// never shows finished work and no division is left out.
let projectsPhaseFilter = "production";
let projectsDivisionFilter = "all";
function renderProjectsView() {
  if (!els.projectsGrid) return;
  const soldJobs = allJobs().filter(jobIsSold);
  const divisions = activeDivisions();
  if (projectsDivisionFilter !== "all" && !divisions.some((item) => item.id === projectsDivisionFilter)) projectsDivisionFilter = "all";
  const inDivision = soldJobs.filter((job) => projectsDivisionFilter === "all" || (job.division || "roofing") === projectsDivisionFilter);
  const production = inDivision.filter(jobIsInProduction);
  const closed = inDivision.filter((job) => !jobIsInProduction(job));
  const projects = projectsPhaseFilter === "closed" ? closed : projectsPhaseFilter === "all" ? inDivision : production;
  const phases = [["production", "In production", production.length], ["closed", "Paid in full", closed.length], ["all", "All sold jobs", inDivision.length]];
  const toolbar = `
    <div class="projects-filter-bar">
      <div class="finance-tabs" role="tablist" aria-label="Sold job lists">
        ${phases.map(([key, label, count]) => `<button type="button" role="tab" class="finance-tab ${projectsPhaseFilter === key ? "active" : ""}" aria-selected="${projectsPhaseFilter === key}" data-projects-phase="${key}">${label} (${count})</button>`).join("")}
      </div>
      <label class="projects-division-filter">Division
        <select data-projects-division>
          <option value="all">All divisions</option>
          ${divisions.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === projectsDivisionFilter ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
        </select>
      </label>
    </div>`;
  const emptyMessage = projectsPhaseFilter === "closed"
    ? "Jobs appear here once they are paid in full."
    : "Sold jobs appear here from the moment they are won until they are paid in full.";
  els.projectsGrid.innerHTML = toolbar + (projects.length
    ? projects
        .map(
          (job) => `
          <article class="record-card">
            <span class="status-pill ${statusPillClass(job.status)}">${escapeHtml(leadStatusLabel(job.status))}</span>
            ${job.projectNumber ? `<span class="project-number-pill">${escapeHtml(job.projectNumber)}</span>` : ""}
            <strong>${escapeHtml(job.name)}</strong>
            <span>${escapeHtml(job.contactName)} - Contract ${money.format(number(job.contractValue) || number(job.value))}</span>
            <span class="record-card-meta">${escapeHtml(divisions.find((item) => item.id === (job.division || "roofing"))?.name || "Roofing")} · ${escapeHtml(jobType(job))}</span>
            <p>${escapeHtml((job.address || "No address").split("\n")[0])}</p>
            ${(number(job.contractValue) || number(job.paidAmount)) ? paymentProgressMarkup(jobPaymentMetrics(job), { compact: true }) : ""}
            <div class="row-actions">
              <button class="secondary-button" type="button" data-action="open-job" data-contact-id="${job.contactId}" data-job-id="${job.id}">
                <span aria-hidden="true" data-icon="open"></span>
                Open Job
              </button>
            </div>
          </article>
        `,
        )
        .join("")
    : `<div class="empty-state">${emptyMessage}</div>`);
  els.projectsGrid.querySelectorAll("[data-projects-phase]").forEach((button) => {
    button.addEventListener("click", () => { projectsPhaseFilter = button.dataset.projectsPhase; renderProjectsView(); });
  });
  els.projectsGrid.querySelector("[data-projects-division]")?.addEventListener("change", (event) => {
    projectsDivisionFilter = event.target.value || "all";
    renderProjectsView();
  });
  hydrateIcons(els.projectsGrid);
}

function renderRecordCard(contact) {
  const jobs = contactJobs(contact);
  const value = jobs.reduce((sum, job) => sum + number(job.value), 0);
  const sc = staleClass(contact);
  const days = staleLeadDays(contact);
  const staleTag = sc ? `<span class="stale-badge ${sc}">${days}d no contact</span>` : "";
  const initials = contactInitials(contact.name);
  const avatarClass = initialsColor(contact.name);
  const activityTimestamp = leadActivityTimestamp(contact);
  const createdTimestamp = localTimestamp(contact.createdAt) || 0;
  const activityLabel = activityTimestamp > createdTimestamp ? "Updated" : "Added";
  const activityDate = activityTimestamp ? formatDateTime(new Date(activityTimestamp).toISOString()) : "Date unavailable";
  const tags = (state.recordTags || []).filter((item) => item.recordType === "lead" && item.recordId === contact.id)
    .map((item) => (state.leadTags || []).find((tag) => tag.id === item.tagId)).filter(Boolean);
  return `
    <article class="lead-intake-row ${sc}">
      <div class="lead-intake-person">
        <div class="lead-card-avatar ${avatarClass}">${escapeHtml(initials)}</div>
        <div class="lead-intake-person-copy">
          <button class="link-button lead-intake-name" type="button" data-action="open-contact" data-contact-id="${contact.id}">${escapeHtml(contact.name)}</button>
          <span>${escapeHtml(contact.leadNumber || "Numbered at its first estimate or sale")}</span>
          <small>${activityLabel} ${escapeHtml(activityDate)}</small>
          ${tags.length ? `<span class="lead-tag-row">${tags.map((tag) => `<span class="lead-tag" style="--tag-color:${escapeHtml(tag.color || "#2563eb")}">${escapeHtml(tag.name)}</span>`).join("")}</span>` : ""}
        </div>
      </div>
      <div class="lead-intake-stage">
        <span class="status-pill ${statusPillClass(contact.status)}">${escapeHtml(leadStatusLabel(contact.status))}</span>
        ${staleTag}
      </div>
      <div class="lead-intake-contact">
        <span>${telLink(contact.phone) || "No phone"}</span>
        <span>${escapeHtml(contact.email || "No email")}</span>
      </div>
      <div class="lead-intake-summary">
        <strong>${money.format(value)}</strong>
        <span>${escapeHtml(contact.salesRep || "Unassigned")} &middot; ${jobs.length} job${jobs.length === 1 ? "" : "s"}</span>
      </div>
      <div class="row-actions lead-intake-row-actions">
        <button class="secondary-button" type="button" data-action="open-contact" data-contact-id="${contact.id}">
          <span aria-hidden="true" data-icon="open"></span>
          Open Lead
        </button>
        <button class="mini-button" type="button" title="Email client" aria-label="Email ${escapeHtml(
          contact.name,
        )}" data-action="open-contact-tab" data-contact-id="${contact.id}" data-tab="email">
          <span aria-hidden="true" data-icon="mail"></span>
        </button>
      </div>
    </article>
  `;
}

function jobPaymentMetrics(job = {}) {
  const contractValue = number(job.contractValue) || number(job.value);
  const paidAmount = number(job.paidAmount);
  return {
    contractValue,
    paidAmount,
    balance: Math.max(contractValue - paidAmount, 0),
    percentage: contractValue ? Math.min(100, (paidAmount / contractValue) * 100) : 0,
  };
}

function contactPaymentMetrics(contact) {
  return contactJobs(contact).reduce(
    (summary, job) => {
      const metrics = jobPaymentMetrics(job);
      summary.contractValue += metrics.contractValue;
      summary.paidAmount += metrics.paidAmount;
      return summary;
    },
    { contractValue: 0, paidAmount: 0 },
  );
}

// Round down so "100%" only appears when the balance is actually paid.
function floorPercent(value) {
  return Math.floor(Number(value || 0) + 1e-6);
}

function paymentProgressMarkup(metrics, { compact = false } = {}) {
  const percentage = metrics.contractValue ? Math.min(100, (metrics.paidAmount / metrics.contractValue) * 100) : 0;
  const rounded = floorPercent(percentage);
  return `
    <div class="payment-progress ${compact ? "payment-progress-compact" : ""}">
      <div class="payment-progress-ring" style="--payment-progress:${rounded * 3.6}deg">
        <span>${rounded}%</span>
      </div>
      <div class="payment-progress-copy">
        <strong>${money.format(metrics.paidAmount)} paid</strong>
        <span>${money.format(Math.max(metrics.contractValue - metrics.paidAmount, 0))} remaining</span>
      </div>
    </div>
  `;
}

function renderLeadDetail() {
  renderLeadDetailContent();
  globalThis.window?.RooflineWorkflowChecklist?.afterLeadDetail?.();
  globalThis.window?.RooflineProjectConversations?.afterLeadDetail?.();
}

function renderLeadDetailContent() {
  if (!els.views.leadDetail) return;
  const contact = getSelectedContact();
  if (!contact) {
    els.leadDetailTitle.textContent = "Lead Detail";
    els.leadOverviewPanel.innerHTML = '<div class="empty-state">No lead selected</div>';
    return;
  }

  if (["documents", "photos", "conversation", "activity"].includes(state.leadDetailTab) && !durableHeavyLeadLoads.has(contact.id)) {
    void loadDurableLeadHeavyRecords(contact.id);
  }

  els.leadDetailTitle.textContent = contact.name;
  els.leadDetailMeta.textContent = `${contact.leadNumber ? `${contact.leadNumber} - ` : ""}${contact.type} - ${leadStatusLabel(contact.status)}`;

  if (
    (state.leadDetailTab === "profit" && !canManageJobFinancials()) ||
    (state.leadDetailTab === "payments" && !canManageManualPayments())
  ) {
    state.leadDetailTab = "overview";
  }

  document.querySelectorAll("[data-lead-tab]").forEach((button) => {
    if (button.dataset.leadTab === "profit") {
      button.classList.toggle("hidden", !canManageJobFinancials());
    }
    if (button.dataset.leadTab === "payments") {
      button.classList.toggle("hidden", !canManageManualPayments());
    }
    button.classList.toggle("active", button.dataset.leadTab === state.leadDetailTab);
  });

  const panels = {
    overview: els.leadOverviewPanel,
    jobs: els.leadJobsPanel,
    operations: els.leadOperationsPanel,
    profit: els.leadProfitPanel,
    payments: els.leadPaymentsPanel,
    email: els.leadEmailPanel,
    documents: els.leadDocumentsPanel,
    photos: els.leadPhotosPanel,
    conversation: els.leadConversationPanel,
    activity: els.leadActivityPanel,
  };
  Object.entries(panels).forEach(([tab, panel]) => {
    if (!panel) return;
    panel.classList.toggle("hidden", tab !== state.leadDetailTab);
  });

  const jobs = contactJobs(contact);
  const jobValue = jobs.reduce((sum, job) => sum + number(job.value), 0);
  // Open = not paid in full and not lost. (This excluded Won jobs, so a job in
  // production counted as closed while a Paid job counted as open.)
  const openJobs = jobs.filter(jobIsOpen).length;
  const payments = contactPaymentMetrics(contact);
  const paidPercentage = payments.contractValue ? (payments.paidAmount / payments.contractValue) * 100 : 0;
  // The header follows the job that is selected on this page, not always the
  // lead's first job.
  const headerJob = jobs.find((job) => job.id === state.selectedLeadJobId) || jobs[0];
  els.leadDetailStats.innerHTML = [
    ["Stage", leadStatusLabel(headerJob?.status || contact.status), jobs.length > 1 ? `Stage of ${headerJob?.name || "the selected job"}` : "Current job stage"],
    ["Sales Rep", headerJob?.salesRep || contact.salesRep || "Unassigned", "Owner"],
    ["Jobs", jobs.length, `${openJobs} open · ${jobs.length - openJobs} closed or lost`],
    ["Contract Value", money.format(payments.contractValue || jobValue), contact.leadNumber || "Assigned at estimate"],
    ["Payments", money.format(payments.paidAmount), `${paidPercentage.toFixed(0)}% paid`],
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

  const initials = contactInitials(contact.name);
  const avatarClass = initialsColor(contact.name);
  const sc = staleClass(contact);
  const days = staleLeadDays(contact);
  els.leadOverviewPanel.innerHTML = `
    <div class="overview-hero">
      <div class="lead-card-avatar ${avatarClass}" style="width:52px;height:52px;font-size:19px;flex-shrink:0">${escapeHtml(initials)}</div>
      <div class="overview-hero-text">
        <h2 style="margin:0;font-size:20px">${escapeHtml(contact.name)}</h2>
        <p style="margin:4px 0 0;color:var(--muted);font-size:13px">${escapeHtml(contact.source || "No source")}</p>
      </div>
      <span class="status-pill ${statusPillClass(contact.status)}" style="align-self:flex-start">${escapeHtml(leadStatusLabel(contact.status))}</span>
    </div>
    ${sc ? `<div class="overview-stale-banner ${sc}"><span data-icon="alert-triangle" aria-hidden="true"></span> No contact in ${days} days — follow up soon</div>` : ""}
    <div class="overview-quick-actions">
      ${contact.phone ? `<a class="secondary-button" href="tel:${contact.phone.replace(/\D/g, "")}"><span aria-hidden="true" data-icon="phone"></span> Call</a>` : ""}
      ${contact.email ? `<button class="secondary-button" type="button" data-action="open-contact-tab" data-contact-id="${contact.id}" data-tab="email"><span aria-hidden="true" data-icon="mail"></span> Email</button>` : ""}
      ${(contact.email || contact.phone) ? `<button class="secondary-button" type="button" data-action="sync-google-contact" data-contact-id="${contact.id}"><span aria-hidden="true" data-icon="user"></span>${contact.googleContactResourceName ? "Update Google Contact" : "Save to Google Contacts"}</button>` : ""}
      <button class="secondary-button" type="button" data-action="estimate-contact" data-contact-id="${contact.id}"><span aria-hidden="true" data-icon="file"></span> Estimate</button>
      <button class="secondary-button" type="button" data-action="open-contact-tab" data-contact-id="${contact.id}" data-tab="conversation"><span aria-hidden="true" data-icon="message"></span> Post Update</button>
    </div>
    <div class="overview-info-grid">
      <div class="overview-info-box">
        <p class="overview-info-label">Contact</p>
        ${contact.phone ? `<p class="overview-info-row"><span>Phone</span>${telLink(contact.phone)}</p>` : ""}
        ${contact.email ? `<p class="overview-info-row"><span>Email</span><a href="mailto:${escapeHtml(contact.email)}" class="tel-link">${escapeHtml(contact.email)}</a></p>` : ""}
        <p class="overview-info-row"><span>Source</span>${escapeHtml(contact.source || "—")}</p>
        <p class="overview-info-row"><span>Created</span>${formatDate(contact.createdAt)}</p>
        <p class="overview-info-row"><span>Last contact</span>${formatDate(contact.lastContact)}</p>
        ${contact.closedDate ? `<p class="overview-info-row"><span>Closed</span>${formatDate(contact.closedDate)}</p>` : ""}
      </div>
      <div class="overview-info-box">
        <p class="overview-info-label">Job address${jobs.length > 1 ? "es" : ""}</p>
        ${jobs.map((job) => `
          <div class="overview-project-payment">
            <button class="overview-job-link" type="button" data-action="open-job" data-contact-id="${contact.id}" data-job-id="${job.id}">
              <span class="overview-job-link-heading">
                <strong>${escapeHtml(job.name)}</strong>
                <span class="status-pill ${statusPillClass(job.status)}">${escapeHtml(leadStatusLabel(job.status))}</span>
              </span>
              ${jobDisplayNumber(job) ? `<span class="project-number-inline">${escapeHtml(jobDisplayNumber(job))}</span>` : ""}
              <span class="overview-job-address">${nl2br(job.address || "No address saved")}</span>
              <span class="overview-job-open">Open this job <span aria-hidden="true">→</span></span>
            </button>
            ${(number(job.contractValue) || number(job.paidAmount)) ? paymentProgressMarkup(jobPaymentMetrics(job), { compact: true }) : ""}
          </div>
        `).join("")}
      </div>
    </div>
    ${contact.notes ? `
    <div class="overview-notes">
      <p class="overview-info-label">Notes</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:var(--ink)">${nl2br(contact.notes)}</p>
    </div>` : ""}
  `;
  hydrateIcons(els.leadOverviewPanel);

  renderLeadJobs(contact);
  renderLeadOperations(contact);
  renderLeadProfit(contact);
  renderLeadPayments(contact);
  renderLeadEmail(contact);
  renderLeadDocuments(contact);
  renderLeadPhotos(contact);
  renderLeadConversation(contact);
  renderLeadActivity(contact);
}

async function syncLeadToGoogleContacts(contactId) {
  const contact = getContact(contactId);
  if (!contact) return;
  try {
    const headers = await squareApiHeaders();
    const response = await fetch("/api/integrations/google/contacts/contact", {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, signal: AbortSignal.timeout(20000),
      body: JSON.stringify({ contactId: contact.id, googleContactResourceName: contact.googleContactResourceName || "", etag: contact.googleContactEtag || "" }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result?.synced !== true) throw new Error(result.error || "Google Contacts could not be updated.");
    updateContact(contact.id, (current) => ({ ...current, googleContactResourceName: result.resourceName, googleContactEtag: result.etag || current.googleContactEtag || "", googleContactSyncedAt: new Date().toISOString() }));
    const saved = canUseCloudSync()
      ? await persistDurableRecordNow("contact", contact.id, (confirmed) => confirmed.googleContactResourceName === result.resourceName)
      : true;
    if (!saved) queueDurableRecordsSave();
    else queueCloudSave();
    renderLeadDetail();
    showToast(contact.googleContactResourceName ? "Google Contact updated" : "Lead saved to Google Contacts");
  } catch (error) {
    showToast(error.message || "Google Contacts could not be updated");
  }
}

// The number to show for a job. A lead's first job is often numbered through
// its first estimate, and the number then lived only on the estimate, so that
// job's card showed no number while the lead's later jobs did.
function jobDisplayNumber(job = {}) {
  return job.projectNumber
    || (state.estimates || []).find((estimate) => estimate.jobId === job.id && estimate.projectNumber)?.projectNumber
    || "";
}

function renderLeadJobs(contact) {
  const jobs = contactJobs(contact);
  if (!jobs.some((job) => job.id === state.selectedLeadJobId)) {
    state.selectedLeadJobId = jobs[0]?.id || "";
  }
  // The job form is static markup. Fill it the first time a lead is shown and
  // whenever the lead changes, so Division and Service are never empty and a
  // half-entered job (or its hidden job id) never carries over to another lead.
  // A form already filled for this lead is left alone: re-renders must not
  // discard what the user is typing.
  if (els.leadJobForm?.elements && (els.leadJobForm.dataset.contactId !== contact.id || !els.leadJobForm.elements.division?.options?.length)) {
    fillJobForm();
  }
  els.leadJobsList.innerHTML = contactJobs(contact)
    .map(
      (job) => `
      <article class="job-card ${job.id === state.selectedLeadJobId ? "selected" : ""}" data-job-card-id="${job.id}">
        <div>
          <button class="job-select-button" type="button" data-action="open-job" data-contact-id="${contact.id}" data-job-id="${job.id}">
            <span class="job-status-row">
              <span class="status-pill ${statusPillClass(job.status)}">${escapeHtml(leadStatusLabel(job.status))}</span>
              ${jobDisplayNumber(job) ? `<span class="project-number-pill">${escapeHtml(jobDisplayNumber(job))}</span>` : ""}
            </span>
            <strong>${escapeHtml(job.name)}</strong>
            <span>${escapeHtml(job.salesRep || "Unassigned")} - Contract ${money.format(number(job.contractValue) || number(job.value))}</span>
            <span class="job-select-address">${nl2br(job.address || "No address saved")}</span>
          </button>
          ${job.notes ? `<p>${nl2br(job.notes)}</p>` : ""}
          ${(number(job.contractValue) || number(job.paidAmount)) ? paymentProgressMarkup(jobPaymentMetrics(job), { compact: true }) : ""}
        </div>
        <div class="row-actions">
          <button class="secondary-button" type="button" data-action="open-job-photos" data-contact-id="${contact.id}" data-job-id="${job.id}">
            <span aria-hidden="true" data-icon="image"></span>
            Photos (${contact.documents.filter((document) => document.kind === "photo" && document.jobId === job.id).length})
          </button>
          <button class="secondary-button" type="button" data-action="estimate-job" data-contact-id="${contact.id}" data-job-id="${
            job.id
          }">
            <span aria-hidden="true" data-icon="file"></span>
            Estimate
          </button>
          <button class="secondary-button" type="button" data-action="edit-job" data-job-id="${job.id}">
            <span aria-hidden="true" data-icon="edit"></span>
            Edit
          </button>
          ${
            canManageJobFinancials()
              ? `<button class="secondary-button" type="button" data-action="open-job-profit" data-contact-id="${contact.id}" data-job-id="${job.id}">
                  <span aria-hidden="true" data-icon="dollar"></span>
                  Profit & Cost
                </button>`
              : ""
          }
          ${
            canManageManualPayments()
              ? `<button class="secondary-button" type="button" data-action="open-contact-tab" data-contact-id="${contact.id}" data-job-id="${job.id}" data-tab="payments">
                  <span aria-hidden="true" data-icon="dollar"></span>
                  Payments
                </button>`
              : ""
          }
          ${
            contactJobs(contact).length > 1
              ? `<button class="mini-button" type="button" title="Remove job" aria-label="Remove ${escapeHtml(
                  job.name,
                )}" data-action="delete-job" data-job-id="${job.id}">
                  <span aria-hidden="true" data-icon="trash"></span>
                </button>`
              : ""
          }
        </div>
      </article>
    `,
    )
    .join("");
  hydrateIcons(els.leadJobsList);
  renderJobMilestones(contact);
  renderProjectDelivery(contact);
}

function operationValue(row, camelKey, snakeKey = camelKey) {
  return row?.[camelKey] ?? row?.[snakeKey] ?? "";
}

function operationsForJob(key, contactId, jobId) {
  return (state[key] || []).filter((item) => (item.contactId || item.leadId || item.lead_id) === contactId && (item.jobId || item.job_id) === jobId);
}

function operationEmpty(message) {
  return `<div class="empty-state compact-empty-state">${escapeHtml(message)}</div>`;
}

function operationStatusControl(table, id, field, value, options, { disabled = false } = {}) {
  return `<select class="operation-status-select" aria-label="Update status" data-operation-update="${escapeHtml(table)}" data-operation-id="${escapeHtml(id)}" data-operation-field="${escapeHtml(field)}" ${disabled ? "disabled" : ""}>${options.map(([optionValue, label]) => `<option value="${escapeHtml(optionValue)}" ${String(value) === String(optionValue) ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
}

function renderLeadOperations(contact) {
  if (!els.leadOperationsPanel || !els.operationsJobSelect) return;
  const jobs = contactJobs(contact);
  if (!jobs.some((job) => job.id === state.selectedLeadJobId)) state.selectedLeadJobId = jobs[0]?.id || "";
  const job = jobs.find((item) => item.id === state.selectedLeadJobId);
  els.operationsJobSelect.innerHTML = jobs.length
    ? jobs.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === state.selectedLeadJobId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")
    : '<option value="">No jobs available</option>';
  [els.permitForm, els.inspectionForm, els.selectionForm, els.changeOrderForm, els.progressBillingForm, els.maintenancePlanForm, els.accountPropertyLinkForm].forEach((form) => {
    if (!form) return;
    [...form.elements].forEach((control) => { if ("disabled" in control) control.disabled = !job; });
  });
  if (!job) {
    els.operationsSummary.innerHTML = "";
    els.permitsInspectionsList.innerHTML = operationEmpty("Add a job before creating operational records.");
    els.selectionsChangeOrdersList.innerHTML = "";
    els.progressBillingList.innerHTML = "";
    els.maintenancePlansList.innerHTML = "";
    els.accountPortfolioList.innerHTML = "";
    return;
  }

  const permits = operationsForJob("permits", contact.id, job.id);
  const inspections = operationsForJob("inspections", contact.id, job.id);
  const selections = operationsForJob("jobSelections", contact.id, job.id);
  const changeOrders = operationsForJob("changeOrders", contact.id, job.id);
  const draws = operationsForJob("progressBillings", contact.id, job.id).sort((a, b) => number(operationValue(a, "drawNumber", "draw_number")) - number(operationValue(b, "drawNumber", "draw_number")));
  const plans = operationsForJob("maintenancePlans", contact.id, job.id);
  const openPermits = permits.filter((item) => !["closed","not_required"].includes(String(item.status))).length;
  const failedInspections = inspections.filter((item) => item.result === "failed").length;
  const allowanceVariance = selections.reduce((sum, item) => sum + number(operationValue(item, "selectedAmount", "selected_amount")) - number(operationValue(item, "allowanceAmount", "allowance_amount")), 0);
  const signedChanges = changeOrders.filter((item) => ["approved","signed"].includes(item.status)).reduce((sum, item) => sum + number(item.amount), 0);
  const billed = draws.reduce((sum, item) => sum + number(item.amount), 0);
  const contract = number(job.contractValue) || number(job.value);
  els.operationsSummary.innerHTML = [
    ["Open permits", openPermits, failedInspections ? `${failedInspections} inspection issue${failedInspections === 1 ? "" : "s"}` : "No failed inspections"],
    ["Allowance variance", money.format(allowanceVariance), allowanceVariance > 0 ? "Over allowance" : allowanceVariance < 0 ? "Under allowance" : "On allowance"],
    ["Approved changes", money.format(signedChanges), `${changeOrders.length} change order${changeOrders.length === 1 ? "" : "s"}`],
    ["Billing schedule", money.format(billed), contract ? `${Math.round((billed / contract) * 100)}% of contract` : `${draws.length} draws`],
    ["Maintenance", plans.filter((item) => item.active !== false).length, plans.length ? `Next ${formatDate(plans.map((item) => operationValue(item, "nextServiceOn", "next_service_on")).filter(Boolean).sort()[0])}` : "No active plan"],
  ].map(([label, value, note]) => `<article class="summary-card"><span class="eyebrow">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><span>${escapeHtml(note)}</span></article>`).join("");

  els.inspectionPermitSelect.innerHTML = '<option value="">No linked permit</option>' + permits.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(operationValue(item, "permitNumber", "permit_number") || item.permit_type || "Permit")}</option>`).join("");
  const complianceRows = [
    ...permits.map((item) => `<article class="workflow-item"><div><span class="status-pill ${statusPillClass(item.status)}">${escapeHtml(item.status)}</span><strong>${escapeHtml(operationValue(item, "permitType", "permit_type"))}</strong><span>${escapeHtml(operationValue(item, "permitNumber", "permit_number") || "Number pending")} · ${escapeHtml(item.authority || "Authority not set")}</span></div><div class="workflow-meta"><span>${item.expires_on ? `Expires ${formatDate(item.expires_on)}` : item.submitted_on ? `Submitted ${formatDate(item.submitted_on)}` : "Not submitted"}</span>${operationStatusControl("crm_permits", item.id, "status", item.status, [["planned","Planned"],["submitted","Submitted"],["corrections","Corrections"],["approved","Approved"],["issued","Issued"],["closed","Closed"],["expired","Expired"]])}${operationDeleteButton("crm_permits", item.id, operationValue(item, "permitType", "permit_type"))}</div></article>`),
    ...inspections.map((item) => `<article class="workflow-item"><div><span class="status-pill ${statusPillClass(item.result)}">${escapeHtml(item.result)}</span><strong>${escapeHtml(operationValue(item, "inspectionType", "inspection_type"))}</strong><span>${item.scheduled_at ? formatDateTime(item.scheduled_at) : "Date pending"}${item.reinspection_required ? " · Reinspection required" : ""}</span></div><div class="workflow-meta">${operationStatusControl("crm_inspections", item.id, "result", item.result, [["scheduled","Scheduled"],["passed","Passed"],["failed","Failed"],["reschedule","Reschedule"],["cancelled","Cancelled"]])}${operationDeleteButton("crm_inspections", item.id, operationValue(item, "inspectionType", "inspection_type"))}</div></article>`),
  ];
  els.permitsInspectionsList.innerHTML = complianceRows.length ? complianceRows.join("") : operationEmpty("No permits or inspections recorded for this job.");

  const contractRows = [
    ...selections.map((item) => { const variance = number(operationValue(item, "selectedAmount", "selected_amount")) - number(operationValue(item, "allowanceAmount", "allowance_amount")); return `<article class="workflow-item"><div><span class="status-pill ${statusPillClass(item.status)}">${escapeHtml(item.status)}</span><strong>${escapeHtml(operationValue(item, "itemName", "item_name"))}</strong><span>${escapeHtml(operationValue(item, "selectedProduct", "selected_product") || "Selection pending")}</span></div><div class="workflow-meta"><span>Allowance ${money.format(number(operationValue(item, "allowanceAmount", "allowance_amount")))}</span><strong class="${variance > 0 ? "negative-value" : "positive-value"}">${variance >= 0 ? "+" : ""}${money.format(variance)}</strong>${operationStatusControl("crm_job_selections", item.id, "status", item.status, [["pending","Pending"],["selected","Selected"],["approved","Approved"],["ordered","Ordered"],["installed","Installed"],["declined","Declined"]])}${operationDeleteButton("crm_job_selections", item.id, operationValue(item, "itemName", "item_name"))}</div></article>`; }),
    ...changeOrders.map((item) => `<article class="workflow-item"><div><span class="status-pill ${statusPillClass(item.status)}">${escapeHtml(item.status)}</span><strong>${escapeHtml(operationValue(item, "changeOrderNumber", "change_order_number"))} · ${escapeHtml(item.title)}</strong><span>${escapeHtml(item.description || "No description")}</span></div><div class="workflow-meta"><strong>${money.format(number(item.amount))}</strong><span>${number(operationValue(item, "scheduleDays", "schedule_days"))} schedule days${(job.appliedChangeOrders || []).some((applied) => applied.id === item.id) ? " · in contract value" : ""}</span>${operationStatusControl("crm_change_orders", item.id, "status", item.status, [["draft","Draft"],["pending","Pending"],["approved","Approved"],["signed","Signed"],["rejected","Rejected"],["void","Void"]])}</div></article>`),
  ];
  els.selectionsChangeOrdersList.innerHTML = contractRows.length ? contractRows.join("") : operationEmpty("No selections, allowances, or change orders yet.");

  els.progressBillingEditor.classList.toggle("hidden", !canManageManualPayments());
  els.progressBillingPermission.classList.toggle("hidden", canManageManualPayments());
  els.progressBillingList.innerHTML = draws.length ? draws.map((item) => `<article class="workflow-item"><div><span class="status-pill ${statusPillClass(item.status)}">${escapeHtml(item.status)}</span><strong>Draw ${escapeHtml(operationValue(item, "drawNumber", "draw_number"))}: ${escapeHtml(item.name)}</strong><span>${number(operationValue(item, "scheduledPercent", "scheduled_percent")).toFixed(2)}% · ${item.due_on ? `Due ${formatDate(item.due_on)}` : "No due date"}</span></div><div class="workflow-meta"><strong>${money.format(number(item.amount))}</strong><span>${money.format(number(operationValue(item, "paidAmount", "paid_amount")))} paid</span>${operationStatusControl("crm_progress_billings", item.id, "status", item.status, [["planned","Planned"],["ready","Ready"],["invoiced","Invoiced"],["partially_paid","Partial"],["paid","Paid"],["void","Void"]], { disabled: !canManageManualPayments() })}${canManageManualPayments() && !operationValue(item, "invoiceId", "invoice_id") && item.status !== "void" ? `<button class="secondary-button" type="button" data-create-progress-invoice="${escapeHtml(item.id)}">Create invoice</button>` : operationValue(item, "invoiceId", "invoice_id") ? '<span>Invoice created</span>' : ""}</div></article>`).join("") : operationEmpty("No billing draws scheduled for this job.");

  els.maintenancePlansList.innerHTML = plans.length ? plans.map((item) => `<article class="workflow-item"><div><span class="status-pill ${item.active === false ? "status-muted" : "status-success"}">${item.active === false ? "inactive" : "active"}</span><strong>${escapeHtml(operationValue(item, "planName", "plan_name"))}</strong><span>${escapeHtml(operationValue(item, "serviceName", "service_name"))} · ${escapeHtml(item.frequency)}</span></div><div class="workflow-meta"><strong>${money.format(number(item.amount))}</strong><span>Next ${formatDate(operationValue(item, "nextServiceOn", "next_service_on"))}${item.auto_invoice ? " · Auto invoice" : ""}</span>${operationStatusControl("crm_maintenance_plans", item.id, "active", item.active !== false, [["true","Active"],["false","Paused"]])}</div></article>`).join("") : operationEmpty("No recurring maintenance plan is connected to this job.");

  els.operationsAccountSelect.innerHTML = '<option value="">Choose account</option>' + (state.customerAccounts || []).filter((item) => item.active !== false).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  const link = (state.accountRecordLinks || []).find((item) => (item.jobId || item.job_id) === job.id);
  const account = link && (state.customerAccounts || []).find((item) => item.id === link.accountId);
  const property = link && (state.accountProperties || []).find((item) => item.id === link.propertyId);
  const contacts = account ? (state.accountContacts || []).filter((item) => item.accountId === account.id && (!property || !item.propertyId || item.propertyId === property.id)) : [];
  els.accountPortfolioList.innerHTML = account ? `<article class="workflow-item account-portfolio-item"><div><span class="status-pill status-success">${escapeHtml(account.accountType.replaceAll("_", " "))}</span><strong>${escapeHtml(account.name)}</strong><span>${escapeHtml(property?.name || "Account-level job")} · ${escapeHtml(property?.address || job.address || "No address")}</span>${contacts.map((item) => `<span>${escapeHtml(item.name)}${item.roleName ? ` · ${escapeHtml(item.roleName)}` : ""}${item.email ? ` · ${escapeHtml(item.email)}` : ""}</span>`).join("")}</div></article>` : operationEmpty("This job is not linked to a commercial or HOA property account.");
  hydrateIcons(els.leadOperationsPanel);
}

function currentOperationsContext() {
  const contact = getSelectedContact();
  const job = contact && contactJobs(contact).find((item) => item.id === state.selectedLeadJobId);
  return { contact, job };
}

function operationBaseRow(prefix, contact, job) {
  return { id: uid(prefix), lead_id: contact.id, job_id: job.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
}

function setOperationsStatus(message, kind = "success") {
  if (els.operationsSaveStatus) setSaveState(els.operationsSaveStatus, message, kind);
}

// Wraps an async form handler. The browser clears event.currentTarget once the
// handler awaits, so handlers keep their own reference to the form; this guard
// also holds the form while a save is in flight, so a second click or Enter
// cannot create a duplicate row.
function guardedSubmit(handler) {
  return async function guardedSubmitHandler(event) {
    const form = event.currentTarget;
    if (!form || form.dataset.submitting === "true") { event.preventDefault(); return; }
    form.dataset.submitting = "true";
    const buttons = [...form.querySelectorAll('button[type="submit"], button:not([type])')].filter((button) => !button.disabled);
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await handler.call(this, event);
    } finally {
      delete form.dataset.submitting;
      buttons.forEach((button) => { button.disabled = false; });
    }
  };
}

async function savePermit(event) {
  event.preventDefault();const form=event.currentTarget;
  const { contact, job } = currentOperationsContext();
  if (!contact || !job) return showToast("Choose a job first");
  const data = new FormData(form);
  const permitType = String(data.get("permitType") || "").trim();
  if (!permitType) return;
  const row = { ...operationBaseRow("permit", contact, job), permit_type: permitType, permit_number: String(data.get("permitNumber") || "").trim(), authority: String(data.get("authority") || "").trim(), status: String(data.get("status") || "planned"), submitted_on: data.get("submittedOn") || null, expires_on: data.get("expiresOn") || null, notes: String(data.get("notes") || "").trim() };
  try { await insertJobOperation("crm_permits", row); form.reset(); renderLeadOperations(contact); setOperationsStatus("Permit saved to this job"); } catch (error) { setOperationsStatus(error.message || "Permit could not be saved", "error"); }
}

async function saveInspection(event) {
  event.preventDefault();const form=event.currentTarget;
  const { contact, job } = currentOperationsContext();
  if (!contact || !job) return showToast("Choose a job first");
  const data = new FormData(form);
  const inspectionType = String(data.get("inspectionType") || "").trim();
  if (!inspectionType || !data.get("scheduledAt")) return;
  const row = { ...operationBaseRow("inspection", contact, job), permit_id: String(data.get("permitId") || ""), inspection_type: inspectionType, scheduled_at: new Date(String(data.get("scheduledAt"))).toISOString(), result: String(data.get("result") || "scheduled"), notes: String(data.get("notes") || "").trim() };
  try { await insertJobOperation("crm_inspections", row); form.reset(); renderLeadOperations(contact); setOperationsStatus("Inspection saved to this job"); } catch (error) { setOperationsStatus(error.message || "Inspection could not be saved", "error"); }
}

async function saveSelection(event) {
  event.preventDefault();const form=event.currentTarget;
  const { contact, job } = currentOperationsContext();
  if (!contact || !job) return showToast("Choose a job first");
  const data = new FormData(form);
  const itemName = String(data.get("itemName") || "").trim();
  if (!itemName) return;
  const row = { ...operationBaseRow("selection", contact, job), item_name: itemName, category: String(data.get("category") || "Finish").trim(), allowance_amount: number(data.get("allowanceAmount")), selected_amount: number(data.get("selectedAmount")), selected_product: String(data.get("selectedProduct") || "").trim(), selected_vendor: String(data.get("selectedVendor") || "").trim(), status: String(data.get("status") || "pending") };
  try { await insertJobOperation("crm_job_selections", row); form.reset(); renderLeadOperations(contact); setOperationsStatus("Selection and allowance saved"); } catch (error) { setOperationsStatus(error.message || "Selection could not be saved", "error"); }
}

async function saveChangeOrder(event) {
  event.preventDefault();const form=event.currentTarget;
  const { contact, job } = currentOperationsContext();
  if (!contact || !job) return showToast("Choose a job first");
  const data = new FormData(form);
  const numberValue = String(data.get("changeOrderNumber") || "").trim();
  const title = String(data.get("title") || "").trim();
  if (!numberValue || !title) return;
  const row = { ...operationBaseRow("change", contact, job), change_order_number: numberValue, title, description: String(data.get("description") || "").trim(), amount: number(data.get("amount")), schedule_days: Math.round(number(data.get("scheduleDays"))), status: String(data.get("status") || "draft"), requested_by_name: state.currentUser?.name || "" };
  try { await insertJobOperation("crm_change_orders", row); form.reset(); renderLeadOperations(contact); setOperationsStatus("Change order saved"); } catch (error) { setOperationsStatus(error.message || "Change order could not be saved", "error"); }
}

async function saveProgressBilling(event) {
  event.preventDefault();const form=event.currentTarget;
  if (!canManageManualPayments()) return showToast("Only an administrator can create billing draws");
  const { contact, job } = currentOperationsContext();
  if (!contact || !job) return showToast("Choose a job first");
  const data = new FormData(form);
  const row = { ...operationBaseRow("draw", contact, job), draw_number: Math.round(number(data.get("drawNumber"))), name: String(data.get("name") || "").trim(), scheduled_percent: number(data.get("scheduledPercent")), amount: number(data.get("amount")), paid_amount: 0, due_on: data.get("dueOn") || null, status: String(data.get("status") || "planned"), invoice_id: "" };
  if (!row.draw_number || !row.name || row.amount < 0) return;
  try { await insertJobOperation("crm_progress_billings", row); form.reset(); renderLeadOperations(contact); setOperationsStatus("Progress billing draw saved"); } catch (error) { setOperationsStatus(error.message || "Billing draw could not be saved", "error"); }
}

async function createOperationalInvoice(contact, job, { id, invoiceNumber, description, amount, issueDate = todayISO(), dueDate = "", notes = "" }) {
  const invoice = normalizeInvoice({ id, invoiceNumber, contactId: contact.id, jobId: job.id, status: "draft", currency: "USD", subtotal: amount, taxAmount: 0, totalAmount: amount, amountPaid: 0, issueDate, dueDate, terms: state.company?.defaultTerms || "", notes, provider: "internal", ownerUserId: authSession?.user?.id || "", ownerEmail: contact.email || "", ownerName: contact.name, items: [{ id: `${id}_1`, description, quantity: 1, unitPrice: amount, amount, position: 0 }] });
  if (canUseCloudSync()) {
    const invoiceRow = { company_state_id: supabaseStateId(), id: invoice.id, invoice_number: invoice.invoiceNumber, lead_id: contact.id, job_id: job.id, estimate_id: "", status: "draft", currency: "USD", subtotal: amount, tax_amount: 0, tax_rate: 0, total_amount: amount, amount_paid: 0, issue_date: issueDate, due_date: dueDate || null, terms: invoice.terms, notes, provider: "internal", owner_user_id: authSession.user.id, owner_email: contact.email || "", owner_name: contact.name, created_by: authSession.user.id, updated_by: authSession.user.id };
    const { error: invoiceError } = await cloudClient.from("crm_invoices").insert(invoiceRow);
    if (invoiceError) throw invoiceError;
    const { error: itemError } = await cloudClient.from("crm_invoice_items").insert({ company_state_id: supabaseStateId(), id: `${id}_1`, invoice_id: id, lead_id: contact.id, job_id: job.id, description, quantity: 1, unit_price: amount, amount, position: 0, created_by: authSession.user.id, updated_by: authSession.user.id });
    if (itemError) throw itemError;
    await initializeFinancialLedger();
  } else {
    state.invoices.unshift(invoice);
    saveState({ localOnly: true });
  }
  return invoice;
}

async function createProgressDrawInvoice(drawId) {
  if (!canManageManualPayments()) return showToast("Only an administrator can create invoices");
  const draw = (state.progressBillings || []).find((item) => item.id === drawId);
  const contact = draw && getContact(draw.contactId || draw.leadId || draw.lead_id);
  const job = contact && contactJobs(contact).find((item) => item.id === (draw.jobId || draw.job_id));
  if (!draw || !contact || !job) return showToast("The billing draw is no longer connected to a job");
  if (operationValue(draw, "invoiceId", "invoice_id")) return showToast("This draw already has an invoice");
  try {
    if (canUseCloudSync()) {
      const { data: invoiceId, error } = await cloudClient.rpc("crm_invoice_progress_draw", {
        p_draw_id: draw.id, p_generation: draw.billing_generation ?? 0, p_terms: state.company?.defaultTerms || "",
      });
      if (error) throw error;
      if (!invoiceId) throw new Error("No invoice confirmation received. Refresh before retrying.");
      const refreshed = await Promise.all([initializeFinancialLedger(), initializeJobOperations()]);
      if (!refreshed.every(Boolean)) throw new Error("Draw invoiced, but the view could not be refreshed. Reload to see the invoice.");
      renderLeadDetail();
      return showToast("Billing draw converted to a draft invoice");
    }
    // A draw whose first invoice was voided needs a new invoice id: the voided
    // invoice keeps its own.
    const baseInvoiceId = `draw_invoice_${draw.id}`;
    const invoiceId = (state.invoices || []).some((item) => item.id === baseInvoiceId) ? `${baseInvoiceId}_${Date.now().toString(36)}` : baseInvoiceId;
    const invoice = await createOperationalInvoice(contact, job, {
      id: invoiceId,
      invoiceNumber: `DRAW-${Date.now().toString().slice(-8)}`,
      description: `${draw.name} · ${job.name}`,
      amount: number(draw.amount),
      issueDate: todayISO(),
      dueDate: draw.due_on || "",
      notes: `Progress billing draw ${operationValue(draw, "drawNumber", "draw_number")}`,
    });
    await updateJobOperation("crm_progress_billings", draw.id, { status: "invoiced", invoice_id: invoice.id });
    renderLeadDetail();
    showToast("Billing draw converted to a draft invoice");
  } catch (error) {
    showToast(error.message || "The billing draw could not be invoiced");
  }
}

async function saveMaintenancePlan(event) {
  event.preventDefault();const form=event.currentTarget;
  const { contact, job } = currentOperationsContext();
  if (!contact || !job) return showToast("Choose a job first");
  const data = new FormData(form);
  const autoInvoice = data.get("autoInvoice") === "on";
  if (autoInvoice && !canManageManualPayments()) return showToast("Only an administrator can enable recurring invoices");
  const planId = uid("maintenance");
  const row = { ...operationBaseRow("maintenance", contact, job), id: planId, plan_name: String(data.get("planName") || "").trim(), service_name: String(data.get("serviceName") || "").trim(), frequency: String(data.get("frequency") || "annual"), interval_months: Math.max(1, Math.round(number(data.get("intervalMonths")) || 12)), start_on: data.get("startOn"), next_service_on: data.get("nextServiceOn"), amount: number(data.get("amount")), auto_invoice: autoInvoice, active: true, notes: "" };
  if (!row.plan_name || !row.service_name || !row.start_on || !row.next_service_on) return;
  try {
    const taskId = `maintenance_task_${planId}`;
    const visit = { ...operationBaseRow("visit", contact, job), plan_id: planId, scheduled_for: `${row.next_service_on}T09:00:00`, status: "scheduled", task_id: taskId, invoice_id: "", notes: row.service_name };
    if (canUseCloudSync()) {
      const { error } = await cloudClient.rpc("crm_create_maintenance_plan", { p_plan: row, p_visit: visit });
      if (error) throw error;
      if (!(await initializeJobOperations())) throw new Error("The maintenance plan was saved, but the operations view could not be refreshed");
    } else {
      await insertJobOperation("crm_maintenance_plans", row);
      await insertJobOperation("crm_maintenance_visits", visit);
    }
    const maintenanceTask = normalizeCalendarTask({
      id: taskId,
      title: `${row.plan_name}: ${row.service_name}`,
      rep: job.salesRep || contact.salesRep || "Unassigned",
      ownerUserId: job.ownerUserId || contact.ownerUserId || "",
      ownerEmail: job.ownerEmail || contact.ownerEmail || "",
      ownerName: job.ownerName || contact.ownerName || job.salesRep || contact.salesRep || "",
      contactId: contact.id,
      jobId: job.id,
      dueAt: `${row.next_service_on}T09:00:00`,
      duration: 60,
      notes: `Maintenance plan: ${row.plan_name}`,
      priority: "normal",
      workflowStatus: "not_started",
      recurrence: ({ monthly: "monthly", annual: "yearly" })[row.frequency] || "none",
      googleSyncStatus: "pending",
    });
    state.calendarTasks = [maintenanceTask, ...state.calendarTasks.filter((item) => item.id !== taskId)];
    saveState({ localOnly: true });
    if (canUseCloudSync()) {
      const taskSaved = await persistDurableRecordNow("task", maintenanceTask.id, (confirmed) => confirmed.id === maintenanceTask.id);
      if (!taskSaved) queueDurableRecordsSave();
    }
    if (autoInvoice) {
      const cadence = ({ monthly: "monthly", quarterly: "quarterly", annual: "yearly" })[row.frequency];
      if (cadence) {
        const templateId = `maint_invoice_${planId}`;
        const invoice = await createOperationalInvoice(contact, job, { id: templateId, invoiceNumber: `MAINT-${Date.now().toString().slice(-8)}`, description: `${row.plan_name}: ${row.service_name}`, amount: row.amount, issueDate: row.start_on, dueDate: row.start_on, notes: `Recurring maintenance template for ${row.plan_name}` });
        const scheduleRow = { id: `maint_schedule_${planId}`, template_invoice_id: invoice.id, lead_id: contact.id, job_id: job.id, cadence, next_issue_date: row.next_service_on, due_days: 14, remaining_count: null, active: true };
        if (canUseCloudSync()) {
          const { error } = await cloudClient.from("crm_invoice_schedules").insert({ company_state_id: supabaseStateId(), ...scheduleRow, created_by: authSession.user.id, updated_by: authSession.user.id });
          if (error) throw error;
          await initializeFinancialLedger();
        } else state.invoiceSchedules.unshift(normalizeInvoiceSchedule(scheduleRow));
      } else showToast("The plan was saved. Automatic invoices support monthly, quarterly, or annual plans; this frequency remains scheduled without auto-billing.");
    }
    form.reset(); renderLeadOperations(contact); setOperationsStatus("Maintenance plan saved");
  } catch (error) { setOperationsStatus(error.message || "Maintenance plan could not be saved", "error"); }
}

async function saveCustomerAccount(event) {
  event.preventDefault();const form=event.currentTarget;
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  if (!name) return;
  const row = { id: uid("account"), name, account_type: String(data.get("accountType") || "commercial"), owner_user_id: authSession?.user?.id || "00000000-0000-4000-8000-000000000000", billing_email: String(data.get("billingEmail") || "").trim(), billing_phone: String(data.get("billingPhone") || "").trim(), billing_address: String(data.get("billingAddress") || "").trim(), payment_terms: String(data.get("paymentTerms") || "Due on receipt").trim(), active: true, notes: "" };
  try { await insertJobOperation("crm_organization_accounts", row); form.reset(); renderLeadOperations(getSelectedContact()); setOperationsStatus("Customer account created"); } catch (error) { setOperationsStatus(error.message || "Account could not be created", "error"); }
}

async function saveAccountPropertyLink(event) {
  event.preventDefault();const form=event.currentTarget;
  const { contact, job } = currentOperationsContext();
  if (!contact || !job) return showToast("Choose a job first");
  const data = new FormData(form);
  const accountId = String(data.get("accountId") || "");
  const propertyName = String(data.get("propertyName") || "").trim();
  const address = String(data.get("address") || "").trim();
  if (!accountId || !propertyName || !address) return;
  const propertyId = uid("property");
  try {
    const contactName = String(data.get("contactName") || "").trim();
    const propertyRow = { id: propertyId, account_id: accountId, name: propertyName, address, property_type: job.propertyType || "commercial", units: 1, annual_budget: 0, roof_system: "", notes: "" };
    const contactRow = { id: uid("accountcontact"), account_id: accountId, property_id: propertyId, name: contactName, email: String(data.get("contactEmail") || "").trim(), phone: "", role_name: "Property contact", is_primary: true };
    const linkRow = { ...operationBaseRow("accountlink", contact, job), account_id: accountId, property_id: propertyId, relationship: "service_location" };
    if (canUseCloudSync()) {
      const { error } = await cloudClient.rpc("crm_link_account_property", { p_property: propertyRow, p_contact: contactRow, p_link: linkRow });
      if (error) throw error;
      if (!(await initializeJobOperations())) throw new Error("The property was linked, but the account view could not be refreshed");
    } else {
      await insertJobOperation("crm_account_properties", propertyRow);
      if (contactName) await insertJobOperation("crm_account_contacts", contactRow);
      await insertJobOperation("crm_account_record_links", linkRow);
    }
    form.reset(); renderLeadOperations(contact); setOperationsStatus("Property and job linked to the account");
  } catch (error) { setOperationsStatus(error.message || "Property could not be linked", "error"); }
}

function milestoneStatusLabel(status) {
  return ({
    not_started: "Not started",
    in_progress: "In progress",
    blocked: "Blocked",
    completed: "Completed",
  })[status] || "Not started";
}

function renderJobMilestones(contact) {
  if (!els.jobMilestonesList || !els.jobMilestoneForm) return;
  const job = selectedLeadJob(contact);
  if (!job) {
    els.jobMilestonesList.innerHTML = '<div class="empty-state">Create a job before adding milestones.</div>';
    els.jobMilestoneForm.classList.add("hidden");
    if (els.jobMilestoneProgress) els.jobMilestoneProgress.textContent = "";
    return;
  }
  els.jobMilestoneForm.classList.remove("hidden");
  const milestones = [...(job.milestones || [])].sort((a, b) => number(a.position) - number(b.position));
  const completed = milestones.filter((item) => item.status === "completed").length;
  if (els.jobMilestoneProgress) {
    els.jobMilestoneProgress.textContent = milestones.length
      ? `${completed} of ${milestones.length} complete`
      : `Add the first milestone for ${job.name}`;
  }
  els.jobMilestonesList.innerHTML = milestones.length
    ? milestones.map((milestone) => `
        <article class="workflow-row ${milestone.status === "completed" ? "is-complete" : ""}">
          <button class="workflow-check" type="button" data-action="toggle-job-milestone" data-milestone-id="${milestone.id}" aria-label="${milestone.status === "completed" ? "Reopen" : "Complete"} ${escapeHtml(milestone.title)}">
            <span aria-hidden="true" data-icon="${milestone.status === "completed" ? "check" : "calendar"}"></span>
          </button>
          <div class="workflow-row-copy">
            <strong>${escapeHtml(milestone.title)}</strong>
            <span>${escapeHtml(milestoneStatusLabel(milestone.status))}${milestone.dueDate ? ` · Due ${escapeHtml(formatDate(milestone.dueDate))}` : ""}</span>
          </div>
          <button class="mini-button" type="button" data-action="delete-job-milestone" data-milestone-id="${milestone.id}" aria-label="Delete ${escapeHtml(milestone.title)}">
            <span aria-hidden="true" data-icon="trash"></span>
          </button>
        </article>
      `).join("")
    : '<div class="empty-state">No milestones yet. Add the major checkpoints for this job.</div>';
  hydrateIcons(els.jobMilestonesList);
}

async function persistSelectedJobWorkflow(jobId, updateId = "") {
  saveState({ localOnly: true });
  render();
  if (!canUseCloudSync()) return true;
  try {
    const saved = await persistLeadJobRecord(jobId, updateId);
    if (saved) queueCloudSave();
    else queueDurableRecordsSave();
    return saved;
  } catch (error) {
    console.warn("Job workflow update could not be confirmed", error);
    queueDurableRecordsSave();
    return false;
  }
}

async function saveJobMilestone(event) {
  event.preventDefault();
  if (!requireAction("manageJobs")) return;
  const contact = getSelectedContact();
  const job = selectedLeadJob(contact);
  if (!contact || !job) return;
  const formData = new FormData(els.jobMilestoneForm);
  const title = String(formData.get("title") || "").trim();
  if (!title) return;
  const milestoneId = String(formData.get("milestoneId") || "") || uid("milestone");
  const existing = (job.milestones || []).find((item) => item.id === milestoneId);
  const milestone = normalizeJobMilestone({
    ...(existing || {}),
    id: milestoneId,
    title,
    dueDate: formData.get("dueDate") || "",
    status: formData.get("status") || "not_started",
    position: existing?.position ?? (job.milestones || []).length,
    completedAt: formData.get("status") === "completed" ? existing?.completedAt || new Date().toISOString() : "",
    updatedAt: new Date().toISOString(),
  });
  updateSelectedProfitJob((currentJob) => ({
    ...currentJob,
    milestones: existing
      ? (currentJob.milestones || []).map((item) => item.id === milestoneId ? milestone : item)
      : [...(currentJob.milestones || []), milestone],
  }));
  const updated = addContactUpdate(contact.id, {
    author: state.currentUser.name || "CRM user",
    jobId: job.id,
    message: `${existing ? "Updated" : "Added"} milestone on ${job.name}: ${milestone.title}.`,
  });
  els.jobMilestoneForm.reset();
  const saved = await persistSelectedJobWorkflow(job.id, updated?.updates?.[0]?.id || "");
  showToast(saved ? "Milestone saved" : "Milestone is local while shared CRM sync retries");
}

async function toggleJobMilestone(milestoneId) {
  if (!requireAction("manageJobs")) return;
  const contact = getSelectedContact();
  const job = selectedLeadJob(contact);
  const milestone = (job?.milestones || []).find((item) => item.id === milestoneId);
  if (!contact || !job || !milestone) return;
  const completed = milestone.status !== "completed";
  updateSelectedProfitJob((currentJob) => ({
    ...currentJob,
    milestones: (currentJob.milestones || []).map((item) => item.id === milestoneId
      ? { ...item, status: completed ? "completed" : "not_started", completedAt: completed ? new Date().toISOString() : "", updatedAt: new Date().toISOString() }
      : item),
  }));
  const updated = addContactUpdate(contact.id, {
    author: state.currentUser.name || "CRM user",
    jobId: job.id,
    message: `${completed ? "Completed" : "Reopened"} milestone on ${job.name}: ${milestone.title}.`,
  });
  await persistSelectedJobWorkflow(job.id, updated?.updates?.[0]?.id || "");
}

async function deleteJobMilestone(milestoneId) {
  if (!requireAction("manageJobs")) return;
  const contact = getSelectedContact();
  const job = selectedLeadJob(contact);
  const milestone = (job?.milestones || []).find((item) => item.id === milestoneId);
  if (!contact || !job || !milestone) return;
  updateSelectedProfitJob((currentJob) => ({
    ...currentJob,
    milestones: (currentJob.milestones || []).filter((item) => item.id !== milestoneId),
  }));
  const updated = addContactUpdate(contact.id, {
    author: state.currentUser.name || "CRM user",
    jobId: job.id,
    message: `Removed milestone from ${job.name}: ${milestone.title}.`,
  });
  await persistSelectedJobWorkflow(job.id, updated?.updates?.[0]?.id || "");
}

function projectDeliveryContext() {
  const contact = getContact(state.selectedContactId);
  const job = contact ? selectedLeadJob(contact) : null;
  return { contact, job };
}

function jobTimeHours(entry, now = Date.now()) {
  const start = new Date(entry.startedAt).getTime();
  const stop = entry.stoppedAt ? new Date(entry.stoppedAt).getTime() : now;
  return Number.isFinite(start) && Number.isFinite(stop) ? Math.max((stop-start)/3600000,0) : 0;
}

function renderProjectDelivery(contact) {
  if (!els.projectDeliverySection) return;
  const job = selectedLeadJob(contact);
  els.projectDeliverySection.classList.toggle("hidden",!job);
  if (!job) return;
  const jobFilter = (item) => item.contactId === contact.id && item.jobId === job.id;
  const members = (state.projectMembers || []).filter(jobFilter).filter((item) => item.active);
  const notes = (state.projectNotes || []).filter(jobFilter).sort((a,b) => Number(b.pinned)-Number(a.pinned) || activityTimestamp(b.createdAt)-activityTimestamp(a.createdAt));
  const discussions = (state.projectDiscussions || []).filter(jobFilter).sort((a,b) => activityTimestamp(b.createdAt)-activityTimestamp(a.createdAt));
  const times = (state.jobTimeEntries || []).filter(jobFilter).sort((a,b) => activityTimestamp(b.startedAt)-activityTimestamp(a.startedAt));
  const active = times.find((item) => !item.stoppedAt && (!item.userId || item.userId === authSession?.user?.id));
  const totalHours = times.reduce((sum,item) => sum+jobTimeHours(item),0);
  const billableValue = times.filter((item) => item.billable).reduce((sum,item) => sum+jobTimeHours(item)*number(item.hourlyRate),0);
  els.projectMembersList.innerHTML = members.length ? members.map((item) => `<span class="project-member-chip"><strong>${escapeHtml(item.memberName)}</strong><small>${escapeHtml(item.roleName)}</small></span>`).join("") : '<span class="muted-copy">No project members assigned.</span>';
  els.projectNotesList.innerHTML = notes.length ? notes.slice(0,20).map((item) => `<article class="workflow-row"><span data-icon="${item.pinned ? "star" : "file"}" aria-hidden="true"></span><div><strong>${item.pinned ? "Pinned note" : "Internal note"}</strong><span>${escapeHtml(item.body)}</span></div></article>`).join("") : '<div class="empty-state compact-empty">No internal notes.</div>';
  els.projectDiscussionsList.innerHTML = discussions.length ? discussions.slice(0,20).map((item) => `<article class="workflow-row"><span data-icon="message-circle" aria-hidden="true"></span><div><strong>${item.visibility === "customer" ? "Customer-visible update" : "Internal update"}</strong><span>${escapeHtml(item.body)}</span></div></article>`).join("") : '<div class="empty-state compact-empty">No project discussion yet.</div>';
  els.jobTimeSummary.textContent = `${totalHours.toFixed(2)} hours tracked · ${money.format(billableValue)} billable`;
  els.toggleJobTimerButton.textContent = active ? "Stop timer" : "Start timer";
  els.jobTimerBillable.disabled = Boolean(active);
  els.jobTimerRate.disabled = Boolean(active);
  els.jobTimeEntriesList.innerHTML = times.length ? times.slice(0,20).map((item) => `<article class="workflow-row"><span data-icon="clock" aria-hidden="true"></span><div><strong>${jobTimeHours(item).toFixed(2)} hours${item.billable ? ` · ${money.format(item.hourlyRate)}/hr` : ""}</strong><span>${escapeHtml(formatDate(item.startedAt))}${item.stoppedAt ? "" : " · Running"}</span></div></article>`).join("") : '<div class="empty-state compact-empty">No time recorded.</div>';
  const templates = (state.projectTemplates || []).filter((item) => item.active);
  els.projectTemplateSelect.innerHTML = '<option value="">Choose template</option>'+templates.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
  els.applyProjectTemplateButton.disabled = !templates.length;
  hydrateIcons(els.projectDeliverySection);
}

async function saveProjectMember(event) {
  event.preventDefault();const form=event.currentTarget;
  const { contact,job } = projectDeliveryContext(); if(!contact||!job)return;
  const data=new FormData(form);
  const item=normalizeProjectMember({id:uid("member"),contactId:contact.id,jobId:job.id,memberName:data.get("memberName"),memberEmail:data.get("memberEmail"),roleName:data.get("roleName"),active:true});
  try { await insertProjectDeliveryRow("crm_project_members",{id:item.id,lead_id:contact.id,job_id:job.id,member_name:item.memberName,member_email:item.memberEmail,role_name:item.roleName,active:true}); if(!canUseCloudSync())state.projectMembers.unshift(item); form.reset(); saveState({localOnly:true}); renderProjectDelivery(contact); showToast("Project member added"); } catch(error){console.error(error);showToast(error?.message||"Project member could not be added");}
}

async function saveProjectNote(event) {
  event.preventDefault();const form=event.currentTarget; const {contact,job}=projectDeliveryContext(); if(!contact||!job)return;
  const data=new FormData(form); const item=normalizeProjectNote({id:uid("projectnote"),contactId:contact.id,jobId:job.id,body:data.get("body"),pinned:data.get("pinned")==="on"});
  try { await insertProjectDeliveryRow("crm_project_notes",{id:item.id,lead_id:contact.id,job_id:job.id,body:item.body,pinned:item.pinned}); if(!canUseCloudSync())state.projectNotes.unshift(item); form.reset(); saveState({localOnly:true}); renderProjectDelivery(contact); showToast("Internal note added"); } catch(error){console.error(error);showToast(error?.message||"Note could not be added");}
}

async function saveProjectDiscussion(event) {
  event.preventDefault();const form=event.currentTarget; const {contact,job}=projectDeliveryContext(); if(!contact||!job)return;
  const data=new FormData(form); const item=normalizeProjectDiscussion({id:uid("discussion"),contactId:contact.id,jobId:job.id,body:data.get("body"),visibility:data.get("visibility")});
  try { await insertProjectDeliveryRow("crm_project_discussions",{id:item.id,lead_id:contact.id,job_id:job.id,body:item.body,visibility:item.visibility}); if(!canUseCloudSync())state.projectDiscussions.unshift(item); form.reset(); saveState({localOnly:true}); renderProjectDelivery(contact); showToast("Project update posted"); } catch(error){console.error(error);showToast(error?.message||"Update could not be posted");}
}

async function toggleJobDeliveryTimer() {
  const {contact,job}=projectDeliveryContext(); if(!contact||!job)return;
  const active=(state.jobTimeEntries||[]).find((item)=>item.contactId===contact.id&&item.jobId===job.id&&!item.stoppedAt&&(!item.userId||item.userId===authSession?.user?.id));
  try {
    if(active){ const stoppedAt=new Date().toISOString(); if(canUseCloudSync()){const {error}=await cloudClient.from("crm_job_time_entries").update({stopped_at:stoppedAt}).eq("company_state_id",supabaseStateId()).eq("id",active.id);if(error)throw error;await initializeProjectDelivery();}else active.stoppedAt=stoppedAt; }
    else { const item=normalizeJobTimeEntry({id:uid("time"),contactId:contact.id,jobId:job.id,startedAt:new Date().toISOString(),billable:els.jobTimerBillable.checked,hourlyRate:parseCurrencyInput(els.jobTimerRate.value),userId:authSession?.user?.id||""}); await insertProjectDeliveryRow("crm_job_time_entries",{id:item.id,lead_id:contact.id,job_id:job.id,started_at:item.startedAt,billable:item.billable,hourly_rate:item.hourlyRate,note:""}); if(!canUseCloudSync())state.jobTimeEntries.unshift(item); }
    saveState({localOnly:true}); renderProjectDelivery(contact); showToast(active?"Job timer stopped":"Job timer started");
  } catch(error){console.error(error);showToast(error?.message||"Timer could not be updated");}
}

async function applySelectedProjectTemplate() {
  const {contact,job}=projectDeliveryContext(); const template=(state.projectTemplates||[]).find((item)=>item.id===els.projectTemplateSelect.value); if(!contact||!job||!template)return showToast("Choose a project template");
  try {
    if(canUseCloudSync()){const {error}=await cloudClient.rpc("crm_apply_project_template",{p_template_id:template.id,p_lead_id:contact.id,p_job_id:job.id});if(error)throw error;await initializeProjectDelivery();}
    else { job.milestones=[...(job.milestones||[]),...template.milestones.map((item,index)=>normalizeJobMilestone({id:uid("milestone"),title:item.title,description:item.description||"",position:(job.milestones||[]).length+index}))]; saveState({localOnly:true}); }
    renderJobMilestones(contact); showToast(`${template.name} applied`);
  } catch(error){console.error(error);showToast(error?.message||"Template could not be applied");}
}

function activityTimestamp(value) {
  // Date-only values are local calendar days (see formatDateTime).
  const time = localTimestamp(value || 0);
  return Number.isFinite(time) ? time : 0;
}

// When something was created, to the minute where that is known. Records store
// createdAt as a calendar day; createdTimestamp (added for new records) keeps
// the exact moment so the activity timeline can sort and label it correctly.
function createdMoment(record = {}) {
  return record.createdTimestamp || record.createdAt;
}

function renderLeadActivity(contact) {
  if (!els.leadActivityTimeline) return;
  const jobs = contactJobs(contact);
  const jobName = (jobId) => jobs.find((job) => job.id === jobId)?.name || "";
  const events = [];
  events.push({
    id: `lead-${contact.id}`,
    at: createdMoment(contact),
    type: "lead",
    title: "Lead created",
    detail: `${contact.name} entered the CRM${contact.source ? ` from ${contact.source}` : ""}.`,
  });
  (contact.updates || []).forEach((update) => events.push({
    id: update.id,
    at: update.createdAt,
    type: update.status ? "status" : "note",
    title: update.status ? `Status: ${update.status}` : "Lead update",
    detail: `${update.message || "Update recorded"}${update.jobId && jobName(update.jobId) ? ` · ${jobName(update.jobId)}` : ""}`,
    actor: update.author,
  }));
  jobs.forEach((job) => {
    events.push({ id: `job-${job.id}`, at: createdMoment(job), type: "job", title: `Job created: ${job.name}`, detail: job.address || "No address saved" });
    (job.paymentLedgerVersion === 2 ? manualPaymentRows(job) : job.manualPayments || []).forEach((payment) => events.push({
      id: payment.id,
      at: payment.createdAt || payment.date,
      type: "payment",
      title: `Payment recorded · ${money.format(number(payment.amount))}`,
      detail: `${job.name} · ${payment.method}${payment.reference ? ` · ${payment.reference}` : ""}`,
      actor: payment.createdBy,
    }));
    (job.emails || []).forEach((email) => events.push({
      id: email.id,
      at: email.createdAt,
      type: "email",
      title: `${email.direction === "inbound" ? "Email received" : "Email sent"}: ${email.subject || "No subject"}`,
      detail: `${job.name} · ${email.direction === "inbound" ? email.fromEmail : email.toEmail}`,
      actor: email.createdBy,
    }));
    (job.milestones || []).filter((milestone) => milestone.completedAt).forEach((milestone) => events.push({
      id: `milestone-${milestone.id}`,
      at: milestone.completedAt,
      type: "milestone",
      title: `Milestone completed: ${milestone.title}`,
      detail: job.name,
    }));
  });
  (contact.documents || []).forEach((document) => events.push({
    id: document.id,
    at: document.uploadedAt,
    type: document.kind === "photo" ? "photo" : "document",
    title: `${document.kind === "photo" ? "Photo" : "Document"} uploaded: ${document.name}`,
    detail: `${jobName(document.jobId) || "Lead file"} · ${document.category || "Other"}`,
    actor: document.uploadedBy,
  }));
  state.estimates.filter((estimate) => estimate.contactId === contact.id).forEach((estimate) => events.push({
    id: estimate.id,
    at: estimate.updatedAt || estimate.createdAt || estimate.issueDate,
    type: "estimate",
    title: `Estimate ${estimate.status || "Draft"}: ${estimate.estimateNumber || estimate.projectTitle}`,
    detail: `${jobName(estimate.jobId) || contact.name} · ${money.format(totalsFor(estimate).total)}`,
  }));
  (state.invoices || []).filter((invoice) => invoice.contactId === contact.id).forEach((invoice) => events.push({
    id: `invoice-${invoice.id}`,
    at: invoice.updatedAt || invoice.createdAt || invoice.issueDate,
    type: "invoice",
    title: `Invoice ${invoice.status}: ${invoice.invoiceNumber}`,
    detail: `${jobName(invoice.jobId) || contact.name} · ${money.format(invoice.totalAmount)}`,
  }));
  (state.financialPayments || []).filter((payment) => payment.contactId === contact.id).forEach((payment) => events.push({
    id: `ledger-payment-${payment.id}`,
    at: payment.receivedAt || payment.createdAt,
    type: "payment",
    title: `Invoice payment recorded · ${money.format(payment.amount)}`,
    detail: `${jobName(payment.jobId) || contact.name} · ${payment.method}${payment.reference ? ` · ${payment.reference}` : ""}`,
  }));
  (state.creditNotes || []).filter((credit) => credit.contactId === contact.id).forEach((credit) => events.push({
    id: `ledger-credit-${credit.id}`,
    at: credit.issuedAt || credit.createdAt,
    type: "payment",
    title: `Invoice credit applied · ${money.format(credit.amount)}`,
    detail: `${jobName(credit.jobId) || contact.name} · ${credit.creditNumber} · ${credit.reason}`,
  }));
  (state.financialExpenses || []).filter((expense) => expense.contactId === contact.id).forEach((expense) => events.push({
    id: `ledger-expense-${expense.id}`,
    at: expense.expenseDate || expense.createdAt,
    type: "payment",
    title: `Job expense recorded · ${money.format(expense.amount)}`,
    detail: `${jobName(expense.jobId) || contact.name} · ${expense.category}${expense.vendor ? ` · ${expense.vendor}` : ""}`,
  }));
  (state.financialRefunds || []).filter((refund) => refund.contactId === contact.id).forEach((refund) => events.push({
    id: `ledger-refund-${refund.id}`,
    at: refund.refundedAt || refund.createdAt,
    type: "payment",
    title: `Payment refund recorded · ${money.format(refund.amount)}`,
    detail: `${jobName(refund.jobId) || contact.name} · ${refund.reason}`,
  }));
  (state.projectDiscussions || []).filter((item) => item.contactId === contact.id).forEach((item) => events.push({ id:`project-discussion-${item.id}`,at:item.createdAt,type:"note",title:item.visibility === "customer" ? "Customer-visible project update" : "Project discussion",detail:`${jobName(item.jobId)||contact.name} · ${item.body}` }));
  (state.projectNotes || []).filter((item) => item.contactId === contact.id).forEach((item) => events.push({ id:`project-note-${item.id}`,at:item.createdAt,type:"note",title:item.pinned ? "Pinned internal note" : "Internal project note",detail:`${jobName(item.jobId)||contact.name} · ${item.body}` }));
  (state.jobTimeEntries || []).filter((item) => item.contactId === contact.id && item.stoppedAt).forEach((item) => events.push({ id:`job-time-${item.id}`,at:item.stoppedAt,type:"task",title:`Job time recorded · ${jobTimeHours(item).toFixed(2)} hours`,detail:`${jobName(item.jobId)||contact.name}${item.billable ? ` · ${money.format(item.hourlyRate)}/hr` : ""}` }));
  state.calendarTasks.filter((task) => task.contactId === contact.id).forEach((task) => events.push({
    id: task.id,
    at: task.createdAt || task.dueAt,
    type: "task",
    title: `${task.completed ? "Task completed" : "Task created"}: ${task.title}`,
    detail: `Due ${formatDateTime(task.dueAt)} · ${task.rep}`,
  }));
  events.sort((a, b) => activityTimestamp(b.at) - activityTimestamp(a.at));
  els.leadActivityTimeline.innerHTML = events.length
    ? events.map((event) => `
        <article class="activity-timeline-item">
          <span class="activity-timeline-dot activity-type-${escapeHtml(event.type)}" aria-hidden="true"></span>
          <div>
            <div class="activity-timeline-heading">
              <strong>${escapeHtml(event.title)}</strong>
              <time>${escapeHtml(formatDateTime(event.at))}</time>
            </div>
            <p>${escapeHtml(event.detail || "")}</p>
            ${event.actor ? `<small>${escapeHtml(actorDisplayName(event.actor))}</small>` : ""}
          </div>
        </article>
      `).join("")
    : '<div class="empty-state">No activity has been recorded for this lead.</div>';
}

function selectedLeadJob(contact) {
  const jobs = contactJobs(contact);
  const selected = jobs.find((job) => job.id === state.selectedLeadJobId) || jobs[0];
  state.selectedLeadJobId = selected?.id || "";
  state.selectedProfitJobId = selected?.id || "";
  return selected;
}

function selectedProfitJob(contact) {
  return selectedLeadJob(contact);
}

function jobContextOptions(contact, selectedId = state.selectedLeadJobId) {
  return contactJobs(contact)
    .map(
      (job) =>
        `<option value="${escapeHtml(job.id)}" ${job.id === selectedId ? "selected" : ""}>${escapeHtml(job.name)} - ${escapeHtml(
          (job.address || "No address").split("\n")[0],
        )}</option>`,
    )
    .join("");
}

function jobCostTotal(job) {
  return (job?.costItems || []).reduce((sum, item) => sum + number(item.amount), 0);
}

function jobProfitMetrics(job) {
  const contractValue = number(job?.value);
  const totalCost = jobCostTotal(job);
  const profit = contractValue - totalCost;
  const margin = contractValue ? (profit / contractValue) * 100 : 0;
  return { contractValue, totalCost, profit, margin };
}

