(function () {
  const validRoles = [
    "admin",
    "office_manager",
    "sales_manager",
    "operations_manager",
    "sales",
    "production",
    "viewer",
  ];
  const fallbackConfig = {
    supabaseUrl: "https://vtiespnuwtxwiegruzrx.supabase.co",
    supabaseAnonKey: "sb_publishable_D6_QuivTwcPFoyE0ANiG0g_s2lYPE4_",
    allowedEmailDomain: "coastalcrestroofing.com",
    adminEmails: "gil@coastalcrestroofing.com,devon@coastalcrestroofing.com",
    defaultRole: "viewer",
    authRequired: true,
    syncEnabled: true,
    stateId: "coastal-crest",
  };
  const runtimeConfig = window.ROOFLINE_SUPABASE_CONFIG || {};
  const cleanRuntimeConfig = Object.fromEntries(
    Object.entries(runtimeConfig).filter(([, value]) => value !== "" && value !== null && value !== undefined),
  );
  const config = { ...fallbackConfig, ...cleanRuntimeConfig };
  const CRM_STORAGE_KEY = "roofline-crm-v1";

  function hasConfig() {
    return Boolean(config.supabaseUrl && config.supabaseAnonKey);
  }

  function isAuthRequired() {
    return config.authRequired === true || config.authRequired === "true";
  }

  function loginUrl(reason = "auth") {
    const params = new URLSearchParams({
      reason,
      redirect: `${location.pathname}${location.search}${location.hash}`,
    });
    return `/login?${params.toString()}`;
  }

  function emailDomain(email = "") {
    return String(email).split("@").pop()?.toLowerCase() || "";
  }

  function isAllowedEmail(email = "") {
    return emailDomain(email) === String(config.allowedEmailDomain || "").toLowerCase();
  }

  function adminEmails() {
    return String(config.adminEmails || "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
  }

  function isAdminEmail(email = "") {
    return adminEmails().includes(String(email || "").toLowerCase());
  }

  function normalizeRole(role) {
    const value = String(role || config.defaultRole || "viewer")
      .toLowerCase()
      .trim()
      .replace(/[\s-]+/g, "_");
    return validRoles.includes(value) ? value : "viewer";
  }

  function roleForUser(user) {
    if (isAdminEmail(user?.email)) return "admin";
    return normalizeRole(user?.app_metadata?.role || config.defaultRole);
  }

  function createClient() {
    if (!hasConfig() || !window.supabase?.createClient) return null;
    if (!window.__rooflineSupabase) {
      window.__rooflineSupabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      });
    }
    return window.__rooflineSupabase;
  }

  async function getTrustedUser() {
    const client = createClient();
    if (!client) return { error: new Error("Supabase is not configured") };

    const sessionResult = await client.auth.getSession();
    if (sessionResult.error || !sessionResult.data?.session) {
      return { session: null, user: null };
    }

    const userResult = await client.auth.getUser();
    if (userResult.error || !userResult.data?.user) {
      return { error: userResult.error || new Error("Unable to verify user") };
    }

    return {
      session: sessionResult.data.session,
      user: userResult.data.user,
      role: roleForUser(userResult.data.user),
    };
  }

  async function requireAuth() {
    if (!isAuthRequired()) {
      return {
        session: null,
        localBypass: true,
        role: "admin",
        user: {
          email: `local@${config.allowedEmailDomain || "coastalcrestroofing.com"}`,
          user_metadata: {
            name: "Local Admin",
            role: "admin",
          },
        },
      };
    }

    if (!hasConfig()) {
      location.replace(loginUrl("missing-config"));
      return null;
    }

    const auth = await getTrustedUser();
    if (auth.error || !auth.user) {
      location.replace(loginUrl("auth"));
      return null;
    }

    if (!isAllowedEmail(auth.user.email)) {
      await createClient()?.auth.signOut();
      location.replace(loginUrl("domain"));
      return null;
    }

    return auth;
  }

  function escapeText(value = "") {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function installDashboardSearchEnhancement() {
    if (window.__rooflineDashboardSearchEnhancement) return;
    window.__rooflineDashboardSearchEnhancement = true;

    const style = document.createElement("style");
    style.id = "dashboard-search-enhancement-styles";
    style.textContent = `
      .dashboard-search-results {
        grid-column: 1 / -1;
        display: grid;
        gap: 14px;
      }
      .dashboard-search-results.hidden {
        display: none !important;
      }
      .dashboard-search-list {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 12px;
      }
      .dashboard-search-card {
        display: grid;
        gap: 8px;
        padding: 12px;
        border: 1px solid var(--line, #d6e3f3);
        border-radius: var(--radius, 8px);
        background: var(--surface-soft, #f6faff);
        min-width: 0;
      }
      .dashboard-search-card header {
        display: flex;
        justify-content: space-between;
        gap: 10px;
        align-items: center;
      }
      .dashboard-search-card strong,
      .dashboard-search-card span,
      .dashboard-search-card small {
        min-width: 0;
        overflow-wrap: anywhere;
      }
      .dashboard-search-card small,
      .dashboard-search-meta {
        color: var(--muted, #64748b);
        font-size: 12px;
      }
      .dashboard-search-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
    `;
    document.head.appendChild(style);

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
      if (!isAuthRequired()) return [CRM_STORAGE_KEY];
      try {
        const trusted = await getTrustedUser();
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
          // Ignore unrelated or malformed local storage records.
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

    async function renderDashboardSearchResults() {
      const search = document.querySelector("#globalSearch");
      const dashboard = document.querySelector("#dashboardView");
      const panel = ensurePanel();
      if (!search || !dashboard || !panel) return;

      const query = search.value.trim().toLowerCase();
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
            <h2>${matches.length ? `${matches.length} result${matches.length === 1 ? "" : "s"} for "${escapeText(search.value.trim())}"` : `No results for "${escapeText(search.value.trim())}"`}</h2>
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
              : '<div class="empty-state">No matching leads, contacts, jobs, or documents were found in your signed-in CRM data. Try opening Contacts or syncing again.</div>'
          }
        </div>
      `;
    }

    document.addEventListener("input", (event) => {
      if (event.target?.id === "globalSearch") window.setTimeout(renderDashboardSearchResults, 0);
    });

    document.addEventListener("click", (event) => {
      const clearButton = event.target.closest?.('[data-action="clear-dashboard-search"]');
      if (!clearButton) return;
      const search = document.querySelector("#globalSearch");
      if (!search) return;
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    window.addEventListener("storage", renderDashboardSearchResults);
    window.setTimeout(renderDashboardSearchResults, 1200);
  }

  window.RooflineAuth = {
    config,
    createClient,
    emailDomain,
    getTrustedUser,
    hasConfig,
    isAdminEmail,
    isAllowedEmail,
    isAuthRequired,
    normalizeRole,
    requireAuth,
    roleForUser,
    validRoles,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installDashboardSearchEnhancement, { once: true });
  } else {
    installDashboardSearchEnhancement();
  }
})();
