/* Conflict-safe record writes. No direct-table or last-write-wins fallback. */
(function (root) {
  "use strict";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const key = (row) => `${row.record_type}:${row.id}`;
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  function create({ rpc, requestId, onAcknowledged = () => {}, onBlocked = () => {}, timeoutMs = 15000 }) {
    const versions = new Map();
    const ownCommits = new Map();
    let tail = Promise.resolve();
    let blocked = null;
    return {
      remember(rows) {
        // Only snapshots actually applied to the UI may advance the baseline.
        for (const row of rows) if (Number.isSafeInteger(row.version) && row.version > 0) versions.set(key(row), row.version);
      },
      getVersion(row) { return versions.get(key(row)) || 0; },
      get blocked() { return blocked; },
      commit(rows, events = [], removals = []) {
        // Capture data AND its version before waiting behind another request.
        const changes = [...rows.map(row => ({ ...row, operation: 'upsert' })),
          ...removals.map(row => ({ ...row, operation: 'delete' }))]
          .map(row => ({ ...clone(row), expected_version: versions.get(key(row)) || 0 }));
        const payload = { p_request_id: requestId(), p_changes: changes, p_events: clone(events) };
        const queuedAt = new Map(changes.map(row => [key(row), ownCommits.get(key(row)) || 0]));
        const operation = tail.then(async () => {
          if (blocked) return { data: null, error: blocked.error };
          // Later local edits already contain our optimistic earlier edits.
          // Advance only by this writer's acknowledgements, NEVER by another
          // client's version fetched while this request was queued.
          for (const row of changes) row.expected_version += (ownCommits.get(key(row)) || 0) - queuedAt.get(key(row));
          let timeout;
          try {
            const response = await Promise.race([
              rpc('crm_commit_records', payload),
              new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Save confirmation timed out.')), timeoutMs); }),
            ]);
            if (response.error) throw response.error;
            const returned = response.data?.rows;
            if (!Array.isArray(returned) || returned.length !== changes.length || changes.some(change =>
              !returned.some(row => key(row) === key(change) && row.company_state_id === change.company_state_id &&
                row.version === change.expected_version + 1 && Boolean(row.deleted_at) === (change.operation === 'delete') &&
                (change.operation === 'delete' || JSON.stringify(canonical(row.data)) === JSON.stringify(canonical(change.data))))) ||
                !Array.isArray(response.data?.audit_ids) || payload.p_events.some(event => !response.data.audit_ids.includes(event.id))) {
              throw new Error('The shared CRM returned an incomplete save confirmation.');
            }
            for (const row of returned) {
              versions.set(key(row), row.version);
              ownCommits.set(key(row), (ownCommits.get(key(row)) || 0) + 1);
            }
            onAcknowledged(clone(changes), response.data.audit_ids || []);
            return response;
          } catch (error) {
            // Retain the immutable request, including its idempotency key. A
            // transport error may mean the server committed but the reply was lost.
            blocked = { error, payload };
            onBlocked(blocked);
            return { data: null, error };
          } finally {
            clearTimeout(timeout);
          }
        });
        tail = operation.catch(() => {});
        return operation;
      },
    };
  }
  root.CrmRecordWrites = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
})(typeof window !== 'undefined' ? window : globalThis);
