/* Asynchronous browser recovery storage for large CRM snapshots. */
(function (root) {
  "use strict";

  const DATABASE = "jobcrest-recovery";
  const STORE = "entries";

  function openDatabase(indexedDb = root.indexedDB) {
    if (!indexedDb?.open) return Promise.reject(new Error("IndexedDB is unavailable"));
    return new Promise((resolve, reject) => {
      const request = indexedDb.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Recovery database could not be opened"));
      request.onblocked = () => reject(new Error("Recovery database upgrade is blocked"));
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Recovery storage request failed"));
    });
  }

  function create(options = {}) {
    let database = null;
    const ready = openDatabase(options.indexedDB).then((value) => { database = value; return value; });
    const store = (mode) => database.transaction(STORE, mode).objectStore(STORE);
    const api = {
      ready,
      async get(key) {
        await ready;
        return requestResult(store("readonly").get(key));
      },
      async put(key, value) {
        await ready;
        await requestResult(store("readwrite").put(value, key));
        return true;
      },
      async remove(key) {
        await ready;
        await requestResult(store("readwrite").delete(key));
        return true;
      },
      async entries(prefix) {
        await ready;
        return new Promise((resolve, reject) => {
          const entries = [];
          const request = store("readonly").openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return resolve(entries);
            if (String(cursor.key).startsWith(prefix)) entries.push({ key: cursor.key, value: cursor.value });
            cursor.continue();
          };
          request.onerror = () => reject(request.error || new Error("Recovery entries could not be read"));
        });
      },
      createDraftStore({ companyId, userId, sessionId, now = () => new Date().toISOString() }) {
        const prefix = `jobcrest-pending:v2:${encodeURIComponent(companyId)}:${encodeURIComponent(userId)}:`;
        const ownKey = prefix + encodeURIComponent(sessionId);
        return {
          captureSerialized(stateJson) {
            let state;
            try { state = JSON.parse(stateJson); } catch { return Promise.resolve(false); }
            return this.capture(state);
          },
          async capture(state) {
            try {
              await api.put(ownKey, { format: 2, companyId, userId, sessionId, updatedAt: now(), state });
              return true;
            } catch { return false; }
          },
          async settle() {
            try { await api.remove(ownKey); return true; } catch { return false; }
          },
          async list() {
            try {
              const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
              const ranked = (await api.entries(prefix)).map(({ key, value }) => ({
                key,
                raw: JSON.stringify(value),
                updatedAt: new Date(value?.updatedAt || 0).getTime() || 0,
              })).sort((a, b) => b.updatedAt - a.updatedAt);
              const retained = ranked.filter((entry, index) => entry.updatedAt >= cutoff && index < 10);
              const retainedKeys = new Set(retained.map((entry) => entry.key));
              await Promise.all(ranked.filter((entry) => !retainedKeys.has(entry.key)).map((entry) => api.remove(entry.key)));
              return { entries: retained.map(({ key, raw }) => ({ key, raw })), available: true };
            } catch { return { entries: [], available: false }; }
          },
          async acknowledge(entries) {
            try {
              for (const entry of entries) {
                if (!entry.key.startsWith(prefix)) continue;
                const current = await api.get(entry.key);
                if (JSON.stringify(current) === entry.raw) await api.remove(entry.key);
              }
              return true;
            } catch { return false; }
          },
        };
      },
    };
    return api;
  }

  root.CrmRecoveryCache = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = { create };
})(typeof window !== "undefined" ? window : globalThis);
