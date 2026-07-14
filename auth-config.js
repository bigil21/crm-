window.ROOFLINE_SUPABASE_CONFIG = {
  supabaseUrl: "https://vtiespnuwtxwiegruzrx.supabase.co",
  supabaseAnonKey: "sb_publishable_D6_QuivTwcPFoyE0ANiG0g_s2lYPE4_",
  allowedEmailDomain: "coastalcrestroofing.com",
  adminEmails: "gil@coastalcrestroofing.com,devon@coastalcrestroofing.com",
  defaultRole: "viewer",
  authRequired: true,
  syncEnabled: true,
  stateId: "coastal-crest",
};

window.ROOFLINE_AUTH_CONFIG_VERSION = "scoped-search-v43";

(function installScopedDashboardSearchOverride() {
  const CRM_STORAGE_KEY = "roofline-crm-v1";

  function escapeText(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function adminEmails() {
    return String(window.ROOFLINE_SUPABASE_CONFIG?.adminEmails || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
  }

  function isAdminEmail(email = "") {
    return adminEmails().includes(String(email || "").toLowerCase());
  }

  function normalizeJob(job = {}, contact = {}) {
    return {
      id: job.id || "",
      name: job.name || job.title || `${contact.name || "Client"} Job`,
      address: job.address || contact.address || "",
      status: job.status || contact.status || "New",
      salesRep: job.salesRep || contact.salesRep || "Unassigned",
      notes: job.notes || "",
      value: Number(job.value ?? contact.value) || 0,
    };
  }

  async function storageKeysForCurrentUser() {
    try {
      const trusted = await window.RooflineAuth?.getTrustedUser?.();
      const userId = trusted?.user?.id || "";
      if (!userId) return [];
      const keys = [`${CRM_STORAGE_KEY}:${userId}`];
      if (isAdminEmail(trusted.user.email)) keys.push(CRM_STORAGE_KEY);
      return keys;
    } catch {
      return [];
    }
  }

  async function contactsFromStorage() {
    const contacts = [];
    const seen = new Set();
    const keys = await storageKeysForCurrentUser();
    keys.forEach((key) => {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || "{}");
        if (!Array.isArray(parsed.contacts)) return;
        parsed.contacts.forEach((contact) => {
          if (!contact?.id || seen.has(contact.id)) return;
          seen.add(contact.id);
          const jobs = Array.isArray(contact.jobs) && contact.jobs.length
            ? contact.jobs.map((job) => normalizeJob(job, contact))
            : [normalizeJob({}, contact)];
          contacts.push({ ...contact, jobs });
        });
      } catch {
        // Ignore malformed local CRM records.
      }
    });
    return contacts;
  }

  function contactSearchText(contact) {
    return [
      contact.name,
      contact.type,
      contact.status,
      contact.source,
      contact.salesRep,
      contact.email,
      contact.phone,
      contact.address,
      contact.notes,
      ...(contact.jobs || []).flatMap((job) => [job.name, job.address, job.status, job.salesRep, job.notes]),
      ...(contact.documents || []).flatMap((document) => [document.name, document.category, document.source]),
      ...(contact.updates || []).flatMap((update) => [update.author, update.status, update.message]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function ensurePanel() {
    const layout = document.querySelector("#dashboardView .dashboard-layout");
    if (!layout) return null;
    let panel = document.querySelector("#dashboardSearchResults");
    if (panel) return panel;
    panel = document.createElement("section");
    panel.id = "dashboardSearchResults";
    panel.className = "surface dashboard-panel dashboard-search-results hidden";
    layout.prepend(panel);
    return panel;
  }

  async function renderScopedDashboardSearch() {
    const search = document.querySelector("#globalSearch");
    const panel = ensurePanel();
    if (!search || !panel) return;
    const rawQuery = search.value.trim();
    const query = rawQuery.toLowerCase();
    if (!query) {
      panel.classList.add("hidden");
      panel.innerHTML = "";
      return;
    }

    const contacts = await contactsFromStorage();
    const matches = contacts.filter((contact) => contactSearchText(contact).includes(query)).slice(0, 12);
    panel.classList.remove("hidden");
    panel.innerHTML = `
      <div class="view-toolbar compact">
        <div>
          <p class="eyebrow">Search results</p>
          <h2>${matches.length ? `${matches.length} result${matches.length === 1 ? "" : "s"} for "${escapeText(rawQuery)}"` : `No results for "${escapeText(rawQuery)}"`}</h2>
        </div>
        <button class="link-button" type="button" data-action="clear-dashboard-search">Clear</button>
      </div>
      <div class="dashboard-search-list">
        ${
          matches.length
            ? matches
                .map((contact) => {
                  const job = contact.jobs?.[0] || {};
                  return `
                    <article class="dashboard-search-card">
                      <header>
                        <strong>${escapeText(contact.name || "Unnamed lead")}</strong>
                        <span class="status-pill">${escapeText(contact.status || "New")}</span>
                      </header>
                      <span class="dashboard-search-meta">${escapeText(contact.type || "Lead")} - ${escapeText(contact.salesRep || "Unassigned")}</span>
                      <small>${escapeText(contact.phone || "No phone")} ${contact.email ? `- ${escapeText(contact.email)}` : ""}</small>
                      <small>${escapeText(job.name || "No job name")} - ${escapeText((job.address || contact.address || "No address").split("\n")[0])}</small>
                      <div class="dashboard-search-actions">
                        <button class="secondary-button" type="button" data-action="open-contact" data-contact-id="${escapeText(contact.id)}">Open Lead</button>
                        <button class="ghost-button" type="button" data-view="contacts">View Contacts</button>
                        <button class="ghost-button" type="button" data-view="jobs">View Jobs</button>
                      </div>
                    </article>
                  `;
                })
                .join("")
            : '<div class="empty-state">No matching leads, contacts, jobs, or documents were found in your signed-in CRM data.</div>'
        }
      </div>
    `;
  }

  function install() {
    if (window.__rooflineScopedDashboardSearchOverride) return;
    window.__rooflineScopedDashboardSearchOverride = true;
    document.addEventListener("input", (event) => {
      if (event.target?.id === "globalSearch") window.setTimeout(renderScopedDashboardSearch, 80);
    });
    document.addEventListener("click", (event) => {
      const clearButton = event.target.closest?.('[data-action="clear-dashboard-search"]');
      if (!clearButton) return;
      const search = document.querySelector("#globalSearch");
      if (!search) return;
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    window.addEventListener("storage", () => window.setTimeout(renderScopedDashboardSearch, 80));
    window.setTimeout(renderScopedDashboardSearch, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})();
