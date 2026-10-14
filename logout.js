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

  function clearCustomerDataStorage() {
    const customerDataKey = /^(?:roofline-crm-v1(?::|$)|jobcrest-(?:pending|draft|unsaved-recovery|archived-document|square-send-recovery)|jobcrest\.crm\.)/;
    [localStorage, sessionStorage].forEach((store) => {
      const keys = [];
      try {
        for (let index = 0; index < store.length; index += 1) {
          const key = store.key(index) || "";
          if (customerDataKey.test(key)) keys.push(key);
        }
        keys.forEach((key) => store.removeItem(key));
      } catch {
        // Continue sign-out even if the browser blocks one storage area.
      }
    });
  }

  try {
    if (window.RooflineAuth?.hasConfig()) {
      const client = window.RooflineAuth.createClient();
      try {
        await client?.auth.signOut({ scope: "local" });
      } catch {
        await client?.auth.signOut();
      }
    }
    clearSupabaseAuthStorage();
    clearCustomerDataStorage();
    status.textContent = "You are signed out.";
  } catch {
    clearSupabaseAuthStorage();
    clearCustomerDataStorage();
    status.textContent = "You are signed out locally.";
  }
  window.setTimeout(() => {
    location.replace("/login?v=79&reason=logout");
  }, 900);
})();
