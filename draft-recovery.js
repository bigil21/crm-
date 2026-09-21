/* Recovery copies are never replayed automatically over shared records. */
(function (root) {
  "use strict";
  function create({ storage, companyId, userId, sessionId, now = () => new Date().toISOString() }) {
    if (!companyId || !userId || !sessionId) throw new Error("Recovery requires a company, user and page session.");
    const prefix = `jobcrest-pending:v1:${encodeURIComponent(companyId)}:${encodeURIComponent(userId)}:`;
    const ownKey = prefix + encodeURIComponent(sessionId);
    function captureSerialized(stateJson) {
      if (typeof stateJson !== "string") return false;
      try {
        const metadata = JSON.stringify({ format: 1, companyId, userId, sessionId, updatedAt: now() });
        // Reuse the cache's existing JSON serialization instead of serializing
        // every lead and embedded file a second time while the user is typing.
        storage.setItem(ownKey, `${metadata.slice(0, -1)},"state":${stateJson}}`);
        return true;
      } catch { return false; }
    }
    return {
      captureSerialized,
      capture(state) {
        try {
          return captureSerialized(JSON.stringify(state));
        } catch { return false; }
      },
      settle() {
        // Never remove another tab's unfinished work.
        try { storage.removeItem(ownKey); return true; } catch { return false; }
      },
      list() {
        const entries = [];
        try {
          for (let i = 0; i < storage.length; i++) {
            const key = storage.key(i);
            if (!key?.startsWith(prefix)) continue;
            const raw = storage.getItem(key);
            if (raw === null) continue;
            // Keep raw content even when malformed, so it can still be exported.
            entries.push({ key, raw });
          }
          return { entries, available: true };
        } catch { return { entries, available: false }; }
      },
      acknowledge(entries) {
        try {
          for (const entry of entries) {
            // Only retire the exact copy the user reviewed/exported. A different
            // tab may have continued typing since we opened the recovery notice.
            if (entry.key.startsWith(prefix) && storage.getItem(entry.key) === entry.raw) storage.removeItem(entry.key);
          }
          return true;
        } catch { return false; }
      },
    };
  }
  root.CrmDraftRecovery = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = { create };
})(typeof window !== "undefined" ? window : globalThis);
