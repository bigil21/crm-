(async function () {
  const form = document.querySelector("#loginForm");
  const emailField = document.querySelector("#loginEmail");
  const passwordField = document.querySelector("#loginPassword");
  const confirmPasswordField = document.querySelector("#confirmPassword");
  const confirmPasswordLabel = document.querySelector("#confirmPasswordLabel");
  const createAccountButton = document.querySelector("#createAccountButton");
  const magicLinkButton = document.querySelector("#magicLinkButton");
  const resetPasswordButton = document.querySelector("#resetPasswordButton");
  const clearSessionButton = document.querySelector("#clearSessionButton");
  const status = document.querySelector("#loginStatus");
  const domainHint = document.querySelector("#domainHint");
  const config = window.RooflineAuth?.config || {};
  const params = new URLSearchParams(location.search);
  const CRM_ENTRY_URL = "/?v=101";
  const SIGN_IN_UNLOCK_KEY = "jobcrest.crm.sign-in-unlock";
  const redirect = params.get("redirect") || CRM_ENTRY_URL;
  const forceAccountSwitch = params.get("switchAccount") === "1" || params.get("reason") === "session-reset";
  const isPasswordSetup = params.get("recovery") === "1" || params.get("invite") === "1";
  const isInvitation = params.get("invite") === "1";

  function setStatus(message, tone = "") {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function authErrorMessage(error, action = "sign-in") {
    const message = String(error?.message || error || "Authentication failed");
    if (/email not confirmed/i.test(message)) {
      return "This account exists, but the email is not confirmed yet. In Supabase, go to Authentication > Users, open this email, click Confirm email, then sign in again.";
    }
    if (/invalid login credentials/i.test(message)) {
      return "Sign-in failed. Check the password. If this account was just created, confirm the email in Supabase first, or use Magic Link.";
    }
    if (/user already registered|already registered|already exists/i.test(message)) {
      return "That account already exists. Use Sign In or Magic Link instead of Create Account.";
    }
    if (/rate limit|too many|security purposes/i.test(message)) {
      return "Supabase is temporarily rate-limiting this email. Wait a few minutes, then try again.";
    }
    if (/signup.*disabled|signups not allowed/i.test(message)) {
      return "New account creation is disabled in Supabase. Create or invite the user from Supabase Authentication > Users.";
    }
    if (/otp|magic link/i.test(message) && action === "magic-link") {
      return "Magic link could not be sent. Confirm the user exists in Supabase and that email sending is enabled.";
    }
    if (/failed to fetch|network|load failed/i.test(message)) {
      return "The authentication service could not be reached. Check your connection and try again.";
    }
    return message;
  }

  function sanitizeRedirect(value) {
    try {
      if (typeof value !== "string" || !value.startsWith("/") || /[\\\x00-\x20]/.test(decodeURIComponent(value))) return CRM_ENTRY_URL;
      const target = new URL(value, location.origin);
      if (target.origin !== location.origin || !["/", "/index.html"].includes(target.pathname)) return CRM_ENTRY_URL;
      return value === "/" ? CRM_ENTRY_URL : target.pathname + target.search + target.hash;
    } catch {
      return CRM_ENTRY_URL;
    }
  }

  function queueSignInUnlock() {
    try {
      sessionStorage.setItem(SIGN_IN_UNLOCK_KEY, "pending");
    } catch {
      // Authentication still succeeds when browser storage is unavailable.
    }
  }

  function confirmationRedirectUrl() {
    return `${location.origin}/login`;
  }

  function recoveryRedirectUrl() {
    return `${location.origin}/login?recovery=1&redirect=${encodeURIComponent(sanitizeRedirect(redirect))}`;
  }

  function validateEmailDomain(email) {
    if (window.RooflineAuth.isAllowedEmail(email)) return true;
    setStatus(window.RooflineAuth.stagingTestIdentity() ? "Use a company account or the approved staging test account." : `Use your @${config.allowedEmailDomain} email address.`, "error");
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
    try {
      sessionStorage.removeItem(SIGN_IN_UNLOCK_KEY);
    } catch {
      // The auth storage cleanup above is still sufficient.
    }
  }

  async function signOutCurrentSession() {
    try {
      await client.auth.signOut({ scope: "local" });
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
    if (error || signedInEmail !== expectedEmail || !window.RooflineAuth.isAllowedUser(data?.user)) {
      await signOutCurrentSession();
      setStatus(
        signedInEmail
          ? `Still signed in as ${signedInEmail}. Click Clear Saved Session, then try again.`
          : "Sign-in did not create a verified CRM session. Click Clear Saved Session, then try again.",
        "error",
      );
      return false;
    }
    const trusted = await window.RooflineAuth.getTrustedUser();
    if (trusted.error || trusted.accessDenied) {
      await signOutCurrentSession();
      setStatus("Your account exists but has not been approved for CRM access. Ask an administrator to approve it.", "error");
      return false;
    }
    return true;
  }

  if (domainHint) domainHint.textContent = window.RooflineAuth.stagingTestIdentity()
    ? "ISOLATED TEST CRM — company accounts and the approved sales-test account only. No live customer data."
    : `Only @${config.allowedEmailDomain} accounts can sign in.`;

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
  if (isPasswordSetup) {
    setStatus(isInvitation
      ? "Welcome to JobCrest. Create and confirm your password to activate your Sales access."
      : "Enter and confirm your new password. It must be at least 8 characters.");
    emailField.closest("label")?.classList.add("hidden");
    emailField.required = false;
    passwordField.autocomplete = "new-password";
    confirmPasswordLabel?.classList.remove("hidden");
    if (confirmPasswordField) confirmPasswordField.required = true;
    form.querySelector('button[type="submit"]').textContent = isInvitation ? "Create Password & Open CRM" : "Save New Password";
    [createAccountButton, magicLinkButton, resetPasswordButton, clearSessionButton].forEach((button) => button?.classList.add("hidden"));
  } else if (existing.accessDenied || params.get("reason") === "approval") {
    await signOutCurrentSession();
    setStatus("Your account exists but has not been approved for CRM access. Ask an administrator to approve it.", "error");
  } else if (existing.user && window.RooflineAuth.isAllowedUser(existing.user)) {
    setStatus(`Currently signed in as ${existing.user.email}. Enter another email/password below to switch accounts, or click Clear Saved Session first.`);
  } else if (forceAccountSwitch) {
    setStatus("Prior CRM session cleared. Sign in with the account you want to use.", "success");
  }

  clearSessionButton?.addEventListener("click", async () => {
    setStatus("Clearing saved browser session...");
    await signOutCurrentSession();
    setStatus("Saved session cleared. Enter the email and password for the account you want to use.", "success");
    passwordField.value = "";
    passwordField.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailField.value.trim().toLowerCase();
    const password = passwordField.value;
    if (isPasswordSetup) {
      if (!password || password.length < 8) {
        setStatus("Enter a new password with at least 8 characters.", "error");
        return;
      }
      if (password !== confirmPasswordField?.value) {
        setStatus("The two passwords do not match.", "error");
        confirmPasswordField?.focus();
        return;
      }
      setStatus("Saving new password...");
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        setStatus(authErrorMessage(error, "password-recovery"), "error");
        return;
      }
      setStatus(isInvitation ? "Password created. Opening your CRM…" : "Password updated. Opening the CRM...", "success");
      queueSignInUnlock();
      window.setTimeout(() => location.replace(sanitizeRedirect(redirect)), 500);
      return;
    }
    if (!validateEmailDomain(email)) return;
    if (!password) {
      setStatus("Enter your password, or use the magic link button.", "error");
      return;
    }

    setStatus("Signing in...");
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus(authErrorMessage(error, "sign-in"), "error");
      return;
    }
    if (!window.RooflineAuth.isAllowedUser(data.user)) {
      await signOutCurrentSession();
      setStatus(`This CRM only allows @${config.allowedEmailDomain} users.`, "error");
      return;
    }
    if (!(await verifySignedInEmail(email))) return;
    queueSignInUnlock();
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
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: confirmationRedirectUrl() },
    });
    if (error) {
      setStatus(authErrorMessage(error, "create-account"), "error");
      return;
    }
    if (data.session) {
      await signOutCurrentSession();
      setStatus("Account created. An administrator must approve access before you can sign in.", "success");
      return;
    }
    setStatus("Account created. Confirm your email, then ask an administrator to approve CRM access.", "success");
  });

  magicLinkButton.addEventListener("click", async () => {
    const email = emailField.value.trim().toLowerCase();
    if (!validateEmailDomain(email)) return;

    setStatus("Sending magic link...");
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: confirmationRedirectUrl(),
        shouldCreateUser: false,
      },
    });
    if (error) {
      setStatus(authErrorMessage(error, "magic-link"), "error");
      return;
    }
    setStatus("Magic link sent. Check your email.", "success");
  });

  resetPasswordButton?.addEventListener("click", async () => {
    const email = emailField.value.trim().toLowerCase();
    if (!validateEmailDomain(email)) return;
    setStatus("Sending password reset email...");
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: recoveryRedirectUrl() });
    if (error) {
      setStatus(authErrorMessage(error, "password-recovery"), "error");
      return;
    }
    setStatus("Password reset email sent. Open its link to choose a new password.", "success");
  });
})();
