const INVITE_ROLE = "sales";

function normalizeInviteEmail(value, allowedDomain) {
  const email = String(value || "").trim().toLowerCase();
  const domain = String(allowedDomain || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw Object.assign(new Error("Enter a valid work email address."), { code: "invalid_email", status: 400 });
  }
  if (!domain || !email.endsWith(`@${domain}`)) {
    throw Object.assign(new Error(`Invitations are limited to @${domain || "company"} email addresses.`), { code: "invalid_email_domain", status: 400 });
  }
  return email;
}

function adminHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

async function jsonResponse(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(body?.msg || body?.message || body?.error || "Invitation service unavailable."));
    error.status = response.status;
    error.code = String(body?.code || body?.error_code || "provider_error");
    throw error;
  }
  return body;
}

function createTeamInviteService({ fetchImpl = fetch, origin, key, companyId, allowedEmailDomain, appOrigin }) {
  if (!origin || !key || !companyId || !appOrigin) throw new Error("Team invitations are not configured.");
  const setupUrl = `${String(appOrigin).replace(/\/$/, "")}/login?invite=1&redirect=%2F`;
  const contentHeaders = adminHeaders(key, { "Content-Type": "application/json" });

  async function findUser(email) {
    for (let page = 1; page <= 100; page += 1) {
      const url = new URL(`${origin}/auth/v1/admin/users`);
      url.searchParams.set("page", String(page));
      url.searchParams.set("per_page", "1000");
      const body = await jsonResponse(await fetchImpl(url, {
        signal: AbortSignal.timeout(15000),
        headers: adminHeaders(key),
      }));
      const users = Array.isArray(body?.users) ? body.users : [];
      const match = users.find((user) => String(user?.email || "").trim().toLowerCase() === email);
      if (match) return match;
      if (users.length < 1000) return null;
    }
    throw Object.assign(new Error("The user directory is too large to search safely."), { code: "user_directory_limit", status: 503 });
  }

  async function provisionAccess(userId, email) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(userId || ""))) {
      throw Object.assign(new Error("The invited account did not return a valid user ID."), { code: "invalid_invited_user", status: 502 });
    }
    const url = new URL(`${origin}/rest/v1/crm_user_access`);
    url.searchParams.set("on_conflict", "user_id");
    const response = await fetchImpl(url, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        apikey: key,
        ...(!key.startsWith("sb_secret_") ? { Authorization: `Bearer ${key}` } : {}),
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        user_id: userId,
        email,
        role: INVITE_ROLE,
        approved: true,
        approved_at: new Date().toISOString(),
      }),
    });
    if (!response.ok) {
      throw Object.assign(new Error("The account was created, but CRM access could not be confirmed. Send the invitation again."), {
        code: "access_provision_failed", status: 503,
      });
    }
  }

  async function sendExistingUserSetup(email) {
    const url = new URL(`${origin}/auth/v1/recover`);
    url.searchParams.set("redirect_to", setupUrl);
    await jsonResponse(await fetchImpl(url, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: contentHeaders,
      body: JSON.stringify({ email }),
    }));
  }

  async function invite(emailValue) {
    const email = normalizeInviteEmail(emailValue, allowedEmailDomain);
    const existing = await findUser(email);
    if (existing) {
      await provisionAccess(existing.id, email);
      await sendExistingUserSetup(email);
      return { email, role: INVITE_ROLE, sent: true, existing: true };
    }

    const url = new URL(`${origin}/auth/v1/invite`);
    url.searchParams.set("redirect_to", setupUrl);
    const invited = await jsonResponse(await fetchImpl(url, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: contentHeaders,
      body: JSON.stringify({ email, data: { invited_to: companyId } }),
    }));
    const user = invited?.user || invited;
    await provisionAccess(user?.id, email);
    return { email, role: INVITE_ROLE, sent: true, existing: false };
  }

  return { invite };
}

module.exports = { INVITE_ROLE, normalizeInviteEmail, createTeamInviteService };
