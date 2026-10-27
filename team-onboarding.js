(function () {
  const panel = document.querySelector("#teamInviteSettings");
  const form = document.querySelector("#teamInviteForm");
  const emailField = document.querySelector("#teamInviteEmail");
  const submitButton = document.querySelector("#teamInviteSubmit");
  const status = document.querySelector("#teamInviteStatus");
  const groupsFieldset = document.querySelector("#teamGoogleGroupsFieldset");
  const groupsOptions = document.querySelector("#teamGoogleGroupsOptions");
  if (!panel || !form || !emailField || !submitButton || !status || !window.RooflineAuth) return;

  function setStatus(message, tone = "") {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  async function initialize() {
    if (!window.RooflineAuth.isAuthRequired()) {
      panel.classList.remove("hidden");
      return;
    }
    const trusted = await window.RooflineAuth.getTrustedUser();
    if (trusted?.role !== "admin") return;
    panel.classList.remove("hidden");
    const client = window.RooflineAuth.createClient();
    const session = await client?.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token || !groupsFieldset || !groupsOptions) return;
    const response = await fetch("/api/integrations/google/status", { cache: "no-store", headers: { Authorization: `Bearer ${token}` } });
    const result = await response.json().catch(() => ({}));
    const groups = Array.isArray(result.groupOptions) ? result.groupOptions : [];
    if (response.ok && groups.length) {
      groupsOptions.innerHTML = groups.map((group) => `<label><input type="checkbox" name="googleGroups" value="${group.replace(/[&<>\"']/g, "")}" checked /> ${group.replace(/[&<>\"']/g, "")}</label>`).join("");
      groupsFieldset.classList.remove("hidden");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailField.value.trim().toLowerCase();
    if (!window.RooflineAuth.isAllowedEmail(email)) {
      setStatus(`Enter a valid @${window.RooflineAuth.config.allowedEmailDomain} email address.`, "error");
      return;
    }
    const sessionResult = await window.RooflineAuth.createClient()?.auth.getSession();
    const token = sessionResult?.data?.session?.access_token;
    if (!token) {
      setStatus("Your admin session expired. Sign in again before sending an invitation.", "error");
      return;
    }

    submitButton.disabled = true;
    setStatus("Sending invitation…");
    try {
      const response = await fetch("/api/admin/team-invitations", {
        method: "POST",
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email, groups: [...form.querySelectorAll('input[name="googleGroups"]:checked')].map((input) => input.value) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "The invitation could not be sent.");
      emailField.value = "";
      const groupNote = result.groupWarning ? ` ${result.groupWarning}` : result.groupsAdded?.length ? " Google Groups access was also added." : "";
      setStatus(`Invitation sent to ${result.email}. The link opens Create Password and activates Sales access.${groupNote}`, result.groupWarning ? "warning" : "success");
    } catch (error) {
      setStatus(String(error?.message || "The invitation could not be sent."), "error");
    } finally {
      submitButton.disabled = false;
    }
  });

  initialize().catch(() => {});
})();
