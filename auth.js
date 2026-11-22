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
    supabaseUrl: "",
    supabaseAnonKey: "",
    allowedEmailDomain: "coastalcrestroofing.com",
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
  const AUTH_STORAGE_KEY_PATTERN = /^(?:sb-|.*supabase\.auth(?:\.token)?)/;
  const TAB_ID_STORAGE_KEY = "jobcrest.auth.tab-id";
  const TAB_LOCK_PREFIX = "jobcrest-auth-tab:";
  let editorSessionGuard = null;
  let authStoragePrepared = false;
  let tabId = "";

  // Each browser tab owns its own Supabase session under a tab-specific
  // storage key. supabase-js broadcasts SIGNED_IN / SIGNED_OUT /
  // TOKEN_REFRESHED to every tab that shares a storage key (BroadcastChannel)
  // and serializes auth work through a lock of the same name. With one shared
  // key, signing in as another user in tab B logged tab A out. A per-tab key
  // keeps accounts in different tabs fully independent.
  function newTabId() {
    try { if (window.crypto?.randomUUID) return window.crypto.randomUUID(); } catch { /* fall through */ }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function currentTabId() {
    if (tabId) return tabId;
    const storage = browserSessionStorage();
    let stored = "";
    try { stored = storage?.getItem(TAB_ID_STORAGE_KEY) || ""; } catch { /* Storage may be blocked. */ }
    tabId = /^[A-Za-z0-9-]{8,64}$/.test(stored) ? stored : newTabId();
    try { if (stored !== tabId) storage?.setItem(TAB_ID_STORAGE_KEY, tabId); } catch { /* Memory-only tab id. */ }
    return tabId;
  }

  function authStorageKey() {
    return `sb-jobcrest-auth-${currentTabId()}`;
  }

  function legacyAuthStorageKey() {
    try {
      return `sb-${new URL(config.supabaseUrl).hostname.split(".")[0]}-auth-token`;
    } catch {
      return "";
    }
  }

  function migrateLegacyTabSession() {
    // Keep tabs that signed in before this release signed in.
    const storage = browserSessionStorage();
    const legacyKey = legacyAuthStorageKey();
    if (!storage || !legacyKey) return;
    try {
      const legacy = storage.getItem(legacyKey);
      if (legacy && !storage.getItem(authStorageKey())) storage.setItem(authStorageKey(), legacy);
      if (legacy) storage.removeItem(legacyKey);
    } catch {
      // A blocked storage area behaves like a signed-out tab.
    }
  }

  function tryHoldTabLock(id) {
    const locks = window.navigator?.locks;
    if (!locks?.request) return Promise.resolve(true);
    return new Promise((resolve) => {
      try {
        locks.request(`${TAB_LOCK_PREFIX}${id}`, { ifAvailable: true }, (lock) => {
          if (!lock) {
            resolve(false);
            return undefined;
          }
          resolve(true);
          // Held for the lifetime of this page; released when the tab closes or navigates.
          return new Promise(() => {});
        }).catch(() => resolve(true));
      } catch {
        resolve(true);
      }
    });
  }

  // "Duplicate tab" (and some new-tab opens) copy sessionStorage, so two live
  // tabs could start with the same tab id and the same single-use refresh
  // token. The first tab to refresh would then revoke the other's session.
  // A live tab holds a Web Lock named after its id; a copy that finds the lock
  // taken starts a fresh, signed-out tab identity instead of sharing the token.
  async function claimTabIdentity() {
    const id = currentTabId();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      // A same-tab reload may briefly overlap the previous page's lock.
      if (await tryHoldTabLock(id)) return id;
      await new Promise((resolve) => window.setTimeout(resolve, 75));
    }
    removeAuthKeys(browserSessionStorage());
    tabId = newTabId();
    try { browserSessionStorage()?.setItem(TAB_ID_STORAGE_KEY, tabId); } catch { /* Memory-only tab id. */ }
    await tryHoldTabLock(tabId);
    return tabId;
  }

  let readyPromise = null;
  function ready() {
    if (!readyPromise) readyPromise = claimTabIdentity().catch(() => currentTabId());
    return readyPromise;
  }

  function removeAuthKeys(storage) {
    if (!storage) return;
    const keys = [];
    try {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index) || "";
        if (AUTH_STORAGE_KEY_PATTERN.test(key)) keys.push(key);
      }
      keys.forEach((key) => storage.removeItem(key));
    } catch {
      // A blocked storage area behaves like an empty signed-out session.
    }
  }

  function isExternalCrmEntry() {
    return false;
  }

  function prepareAuthStorage() {
    if (authStoragePrepared) return;
    authStoragePrepared = true;
    // Retire the previous cross-browser-session tokens. New credentials live
    // only in this tab's sessionStorage and disappear when the tab/session ends.
    try { removeAuthKeys(window.localStorage); } catch { /* Persistent storage may be blocked. */ }
  }

  function browserSessionStorage() {
    try { return window.sessionStorage; }
    catch { return undefined; }
  }

  function bindEditorSession(user) {
    if (editorSessionGuard || !isAuthRequired() || !user?.id) return;
    editorSessionGuard = window.CrmSessionGuard.create({ user, onInvalidated() {
      window.dispatchEvent(new CustomEvent("jobcrest:session-invalidated"));
    } });
    createClient().auth.onAuthStateChange((event, session) => {
      // Do not await another auth operation inside Supabase's auth callback.
      editorSessionGuard.observe(event, session);
    });
  }

  function isEditorSessionCurrent(user) {
    return !editorSessionGuard || (user ? editorSessionGuard.allows(user) : editorSessionGuard.isCurrent());
  }

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

  function passwordSetupCallbackType(locationValue = window.location) {
    const hash = new URLSearchParams(String(locationValue?.hash || "").replace(/^#/, ""));
    const query = new URLSearchParams(String(locationValue?.search || "").replace(/^\?/, ""));
    const type = hash.get("type") || query.get("type") || "";
    return ["recovery", "invite"].includes(type) ? type : "";
  }

  function emailDomain(email = "") {
    return String(email).split("@").pop()?.toLowerCase() || "";
  }

  function isAllowedEmail(email = "") {
    return emailDomain(email) === String(config.allowedEmailDomain || "").toLowerCase() ||
      String(email).trim().toLowerCase() === stagingTestIdentity()?.email;
  }

  function stagingTestIdentity() {
    const test = config.stagingTestIdentity;
    if (!["127.0.0.1", "localhost"].includes(window.location?.hostname) ||
        test?.projectOrigin !== "https://ixksmfiektzsunmmwejz.supabase.co" ||
        String(config.supabaseUrl || "").replace(/\/$/, "") !== test.projectOrigin ||
        !test.userId || !test.email) return null;
    return test;
  }

  function isAllowedUser(user) {
    if (emailDomain(user?.email) === String(config.allowedEmailDomain || "").toLowerCase()) return true;
    const test = stagingTestIdentity();
    return Boolean(test && user?.id === test.userId && String(user.email || "").toLowerCase() === test.email && user.app_metadata?.role === "sales");
  }

  function isAdminEmail() { return false; }

  function normalizeRole(role) {
    const value = String(role || config.defaultRole || "viewer")
      .toLowerCase()
      .trim()
      .replace(/[\s-]+/g, "_");
    return validRoles.includes(value) ? value : "viewer";
  }

  function roleForUser(user) {
    return normalizeRole(user?.app_metadata?.role || config.defaultRole);
  }

  function createClient() {
    if (!hasConfig() || !window.supabase?.createClient) return null;
    prepareAuthStorage();
    if (!window.__rooflineSupabase) {
      migrateLegacyTabSession();
      window.__rooflineSupabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
        // JobCrest owns record-version conflict recovery. supabase-js 2.102+
        // retries HTTP 409 responses by default, which delays that recovery and
        // can repeat write RPCs that must instead be merged exactly once here.
        db: {
          retry: false,
        },
        auth: {
          persistSession: true,
          storage: browserSessionStorage(),
          storageKey: authStorageKey(),
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
        global: {
          fetch: (url, options = {}) => {
            const pathname = new URL(typeof url === "string" ? url : url.url || String(url), config.supabaseUrl).pathname;
            if (!isEditorSessionCurrent() && !pathname.startsWith("/auth/v1/")) {
              return Promise.reject(new Error("This editor's login changed. Reopen the CRM before saving."));
            }
            return fetch(url, { ...options, cache: "no-store" });
          },
        },
      });
    }
    return window.__rooflineSupabase;
  }

  async function getTrustedUser() {
    await ready();
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

    // Being unable to ASK whether an account is approved (a timeout, an outage,
    // no connection) is not the same as the answer being no. Treating the two
    // alike signed approved people out and told them they were "not approved"
    // while the database was simply not responding. Try once more, then report
    // the failed check as what it is.
    const unreachable = (result) => Boolean(result.error) &&
      (!result.status || result.status >= 500 || result.status === 408 || result.status === 429);
    let accessResult = await client.rpc("crm_access_profile");
    if (unreachable(accessResult)) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      accessResult = await client.rpc("crm_access_profile");
    }
    if (unreachable(accessResult)) {
      return {
        session: sessionResult.data.session,
        user: userResult.data.user,
        accessCheckFailed: true,
        error: accessResult.error,
      };
    }
    if (accessResult.error || accessResult.data?.approved !== true) {
      return {
        session: sessionResult.data.session,
        user: userResult.data.user,
        accessDenied: true,
        error: accessResult.error || new Error("crm_access_not_approved"),
      };
    }

    return {
      session: sessionResult.data.session,
      user: userResult.data.user,
      role: normalizeRole(accessResult.data.role),
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

    // Dashboard-issued recovery emails may return to the site URL with the
    // recovery tokens in the hash. Capture that intent before supabase-js
    // consumes the hash, then continue password setup in the same tab so its
    // sessionStorage-backed recovery session remains available.
    const passwordSetupType = passwordSetupCallbackType();
    const auth = await getTrustedUser();
    if (passwordSetupType && auth.user && !auth.accessDenied) {
      const mode = passwordSetupType === "invite" ? "invite" : "recovery";
      location.replace(`/login?${mode}=1&redirect=%2F`);
      return null;
    }
    if (auth.accessCheckFailed) {
      // The session is intact; only the approval check could not be completed.
      location.replace(loginUrl("unavailable"));
      return null;
    }
    if (auth.error || !auth.user) {
      location.replace(loginUrl(auth.accessDenied ? "approval" : "auth"));
      return null;
    }

    if (!isAllowedUser(auth.user)) {
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
    ready,
    authStorageKey,
    bindEditorSession,
    isEditorSessionCurrent,
    config,
    createClient,
    emailDomain,
    getTrustedUser,
    hasConfig,
    isAdminEmail,
    isAllowedEmail,
    isAllowedUser,
    stagingTestIdentity,
    isAuthRequired,
    normalizeRole,
    requireAuth,
    roleForUser,
    validRoles,
  };

  // Claim this tab's identity immediately so its lock is held from page load.
  ready();

  // Search results are rendered from the current authoritative in-memory CRM
  // state by app.js. Never inspect stale local recovery snapshots for results.
})();
