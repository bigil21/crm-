(function () {
  const panel = document.querySelector("#teamInviteSettings");
  const form = document.querySelector("#teamInviteForm");
  const emailField = document.querySelector("#teamInviteEmail");
  const submitButton = document.querySelector("#teamInviteSubmit");
  const status = document.querySelector("#teamInviteStatus");
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
        body: JSON.stringify({ email }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result?.error || "The invitation could not be sent.");
      emailField.value = "";
      setStatus(`Invitation sent to ${result.email}. The link opens Create Password and activates Sales access.`, "success");
    } catch (error) {
      setStatus(String(error?.message || "The invitation could not be sent."), "error");
    } finally {
      submitButton.disabled = false;
    }
  });

  initialize().catch(() => {});
})();
