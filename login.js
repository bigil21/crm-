(async function () {
  const form = document.querySelector("#loginForm");
  const emailField = document.querySelector("#loginEmail");
  const passwordField = document.querySelector("#loginPassword");
  const createAccountButton = document.querySelector("#createAccountButton");
  const magicLinkButton = document.querySelector("#magicLinkButton");
  const status = document.querySelector("#loginStatus");
  const domainHint = document.querySelector("#domainHint");
  const config = window.RooflineAuth?.config || {};
  const params = new URLSearchParams(location.search);
  const redirect = params.get("redirect") || "/";
  const forceAccountSwitch = params.get("switchAccount") === "1" || params.get("reason") === "session-reset";

  function setStatus(message, tone = "") {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function sanitizeRedirect(value) {
    return value.startsWith("/") && !value.startsWith("//") ? value : "/";
  }

  function confirmationRedirectUrl() {
    return `${location.origin}/login`;
  }

  function validateEmailDomain(email) {
    if (window.RooflineAuth.isAllowedEmail(email)) return true;
    setStatus(`Use your @${config.allowedEmailDomain} email address.`, "error");
    return false;
  }

  function clearSupabaseAuthStorage() {
    [localStorage, sessionStorage].forEach((store) => {
      const keys = [];
      for (let index = 0; index < store.length; index += 1) {
        const key = store.key(index) || "";
        if (key.startsWith("sb-") || key.includes("supabase.auth.token") || key.includes("supabase.auth")) keys.push(key);
      }
      keys.forEach((key) => store.removeItem(key));
    });
  }

  async function signOutCurrentSession() {
    try {
      await client.auth.signOut({ scope: "global" });
    } catch {
      try {
        await client.auth.signOut();
      } catch {
        // Local cleanup below still removes stale browser session data.
      }
    }
    clearSupabaseAuthStorage();
  }

  async function verifySignedInEmail(expectedEmail) {
    const { data, error } = await client.auth.getUser();
    const signedInEmail = String(data?.user?.email || "").toLowerCase();
    if (error || signedInEmail !== expectedEmail) {
      await signOutCurrentSession();
      setStatus(
        signedInEmail
          ? `Still signed in as ${signedInEmail}. Open /reset-session.html?v=46, then try again.`
          : "Sign-in did not create a verified CRM session. Please try again.",
        "error",
      );
      return false;
    }
    return true;
  }

  if (domainHint) domainHint.textContent = `Only @${config.allowedEmailDomain} accounts can sign in.`;

  if (!window.RooflineAuth.hasConfig()) {
    setStatus("Supabase is not configured. Add SUPABASE_URL and SUPABASE_ANON_KEY to your environment.", "error");
    form.querySelectorAll("input, button").forEach((element) => {
      element.disabled = true;
    });
    return;
  }

  const client = window.RooflineAuth.createClient();
  if (forceAccountSwitch) {
    setStatus("Clearing the prior CRM session. Sign in with the account you want to use.");
    await signOutCurrentSession();
  }

  const existing = await window.RooflineAuth.getTrustedUser();
  if (existing.user && window.RooflineAuth.isAllowedEmail(existing.user.email)) {
    setStatus(`Currently signed in as ${existing.user.email}. Enter another email/password below to switch accounts.`);
  } else if (forceAccountSwitch) {
    setStatus("Prior CRM session cleared. Sign in with the account you want to use.", "success");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailField.value.trim().toLowerCase();
    const password = passwordField.value;
    if (!validateEmailDomain(email)) return;
    if (!password) {
      setStatus("Enter your password, or use the magic link button.", "error");
      return;
    }

    setStatus("Signing in...");
    await signOutCurrentSession();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus(error.message, "error");
      return;
    }
    if (!window.RooflineAuth.isAllowedEmail(data.user?.email)) {
      await signOutCurrentSession();
      setStatus(`This CRM only allows @${config.allowedEmailDomain} users.`, "error");
      return;
    }
    if (!(await verifySignedInEmail(email))) return;
    location.replace(sanitizeRedirect(redirect));
  });

  createAccountButton.addEventListener("click", async () => {
    const email = emailField.value.trim().toLowerCase();
    const password = passwordField.value;
    if (!validateEmailDomain(email)) return;
    if (!password || password.length < 8) {
      setStatus("Enter a password with at least 8 characters.", "error");
      return;
    }

    setStatus("Creating account...");
    await signOutCurrentSession();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: confirmationRedirectUrl(),
        data: {
          role: config.defaultRole || "viewer",
        },
      },
    });
    if (error) {
      setStatus(error.message, "error");
      return;
    }
    if (data.session) {
      if (!(await verifySignedInEmail(email))) return;
      location.replace(sanitizeRedirect(redirect));
      return;
    }
    setStatus("Account created. Check your email to confirm it, then come back here and sign in.", "success");
  });

  magicLinkButton.addEventListener("click", async () => {
    const email = emailField.value.trim().toLowerCase();
    if (!validateEmailDomain(email)) return;

    setStatus("Sending magic link...");
    await signOutCurrentSession();
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: confirmationRedirectUrl(),
        shouldCreateUser: false,
      },
    });
    if (error) {
      setStatus(error.message, "error");
      return;
    }
    setStatus("Magic link sent. Check your email.", "success");
  });
})();