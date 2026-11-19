(async function () {
  const status = document.querySelector("#logoutStatus");

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

  function clearCustomerDataStorage(signedOutUserId = "") {
    const customerDataKey = /^(?:roofline-crm-v1(?::|$)|jobcrest-(?:pending|draft|unsaved-recovery|archived-document|square-send-recovery)|jobcrest\.crm\.)/;
    const userIdPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    // Another tab may be signed in as a different user. Its cached data and
    // unsaved recovery copies are keyed by its user id and must survive this
    // tab's sign-out; only shared keys and this user's own keys are cleared.
    const belongsToAnotherUser = (key) => {
      const ids = key.match(userIdPattern) || [];
      return ids.length > 0 && !ids.some((id) => id.toLowerCase() === signedOutUserId.toLowerCase());
    };
    [localStorage, sessionStorage].forEach((store) => {
      const keys = [];
      try {
        for (let index = 0; index < store.length; index += 1) {
          const key = store.key(index) || "";
          if (customerDataKey.test(key) && !(store === localStorage && belongsToAnotherUser(key))) keys.push(key);
        }
        keys.forEach((key) => store.removeItem(key));
      } catch {
        // Continue sign-out even if the browser blocks one storage area.
      }
    });
  }

  let signedOutUserId = "";
  try {
    if (window.RooflineAuth?.hasConfig()) {
      await window.RooflineAuth.ready?.();
      const client = window.RooflineAuth.createClient();
      try {
        const { data } = await client?.auth.getSession() || {};
        signedOutUserId = String(data?.session?.user?.id || "");
      } catch {
        signedOutUserId = "";
      }
      try {
        await client?.auth.signOut({ scope: "local" });
      } catch {
        await client?.auth.signOut();
      }
    }
    clearSupabaseAuthStorage();
    clearCustomerDataStorage(signedOutUserId);
    status.textContent = "You are signed out.";
  } catch {
    clearSupabaseAuthStorage();
    clearCustomerDataStorage(signedOutUserId);
    status.textContent = "You are signed out locally.";
  }
  window.setTimeout(() => {
    location.replace("/login?v=79&reason=logout");
  }, 900);
})();
