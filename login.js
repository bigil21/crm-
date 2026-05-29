(async function () {
  const form = document.querySelector("#loginForm");
  const emailField = document.querySelector("#loginEmail");
  const passwordField = document.querySelector("#loginPassword");
  const createAccountButton = document.querySelector("#createAccountButton");
  const magicLinkButton = document.querySelector("#magicLinkButton");
  const status = document.querySelector("#loginStatus");
  const domainHint = document.querySelector("#domainHint");
  const config = window.RooflineAuth?.config || {};
  const redirect = new URLSearchParams(location.search).get("redirect") || "/";

  function setStatus(message, tone = "") {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function sanitizeRedirect(value) {
    return value.startsWith("/") && !value.startsWith("//") ? value : "/";
  }

  function validateEmailDomain(email) {
    if (window.RooflineAuth.isAllowedEmail(email)) return true;
    setStatus(`Use your @${config.allowedEmailDomain} email address.`, "error");
    return false;
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
  const existing = await window.RooflineAuth.getTrustedUser();
  if (existing.user && window.RooflineAuth.isAllowedEmail(existing.user.email)) {
    location.replace(sanitizeRedirect(redirect));
    return;
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
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      setStatus(error.message, "error");
      return;
    }
    if (!window.RooflineAuth.isAllowedEmail(data.user?.email)) {
      await client.auth.signOut();
      setStatus(`This CRM only allows @${config.allowedEmailDomain} users.`, "error");
      return;
    }
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
      options: {
        emailRedirectTo: `${location.origin}/login?redirect=${encodeURIComponent(sanitizeRedirect(redirect))}`,
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
      location.replace(sanitizeRedirect(redirect));
      return;
    }
    setStatus("Account created. Check your email if confirmation is required, then sign in.", "success");
  });

  magicLinkButton.addEventListener("click", async () => {
    const email = emailField.value.trim().toLowerCase();
    if (!validateEmailDomain(email)) return;

    setStatus("Sending magic link...");
    const { error } = await client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${location.origin}/login?redirect=${encodeURIComponent(sanitizeRedirect(redirect))}`,
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
