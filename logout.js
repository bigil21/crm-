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

  try {
    if (window.RooflineAuth?.hasConfig()) {
      const client = window.RooflineAuth.createClient();
      try {
        await client?.auth.signOut({ scope: "global" });
      } catch {
        await client?.auth.signOut();
      }
    }
    clearSupabaseAuthStorage();
    status.textContent = "You are signed out.";
  } catch {
    clearSupabaseAuthStorage();
    status.textContent = "You are signed out locally.";
  }
  window.setTimeout(() => {
    location.replace("/login?v=46&reason=logout&switchAccount=1");
  }, 900);
})();