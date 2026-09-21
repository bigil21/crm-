/* An open editor belongs to one authenticated identity for its entire lifetime. */
(function (root) {
  "use strict";
  function identity(user) {
    return JSON.stringify([user?.id || "", String(user?.email || "").toLowerCase(), user?.app_metadata?.role || ""]);
  }
  function create({ user, onInvalidated = () => {} }) {
    if (!user?.id) throw new Error("A verified user is required to bind an editor session.");
    const expected = identity(user);
    let valid = true;
    return {
      isCurrent: () => valid,
      observe(event, session) {
        if (!valid) return false;
        if (event === "SIGNED_OUT" || !session?.user || identity(session.user) !== expected) {
          valid = false;
          onInvalidated();
        }
        return valid;
      },
      allows(user) { return valid && identity(user) === expected; },
    };
  }
  root.CrmSessionGuard = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = { create };
})(typeof window !== "undefined" ? window : globalThis);
