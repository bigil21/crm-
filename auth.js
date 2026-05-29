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
  const config = window.ROOFLINE_SUPABASE_CONFIG || {};

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
})();
