(async function () {
  const status = document.querySelector("#logoutStatus");
  try {
    if (window.RooflineAuth?.hasConfig()) {
      await window.RooflineAuth.createClient()?.auth.signOut();
    }
    status.textContent = "You are signed out.";
  } catch {
    status.textContent = "You are signed out locally.";
  }
  window.setTimeout(() => {
    location.replace("/login?reason=logout");
  }, 900);
})();
