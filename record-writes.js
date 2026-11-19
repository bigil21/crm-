/* Conflict-safe record writes. No direct-table or last-write-wins fallback. */
(function (root) {
  "use strict";
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const key = (row) => `${row.record_type}:${row.id}`;
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  const TIMESTAMP_FIELD = /^(?:updated_?at|modified_?at|last_?modified_?at)$/i;
  const idList = (value) => Array.isArray(value) && value.every(item => isPlainObject(item) &&
    ['string', 'number'].includes(typeof item.id) && item.id !== '') &&
    new Set(value.map(item => String(item.id))).size === value.length;

  // Three-way merge of one record. base = the copy this editor last loaded,
  // local = this editor's version, server = what is saved now. A field only
  // one side changed keeps that side's value. Lists of items with ids merge
  // item by item. When both sides changed the same value, the editor who is
  // saving now wins and the path is reported; an edit beats a deletion.
  function mergeRecordData(base, local, server, path = [], conflicts = []) {
    if (same(local, server)) return local;
    if (same(local, base)) return server;
    if (same(server, base)) return local;
    if (isPlainObject(local) && isPlainObject(server)) {
      const baseObject = isPlainObject(base) ? base : {};
      const merged = {};
      for (const field of new Set([...Object.keys(server), ...Object.keys(local)])) {
        const value = mergeRecordData(baseObject[field], local[field], server[field], [...path, field], conflicts);
        if (value !== undefined) merged[field] = value;
      }
      return merged;
    }
    if (idList(local) && idList(server) && (base === undefined || idList(base))) {
      const byId = list => new Map((list || []).map(item => [String(item.id), item]));
      const baseItems = byId(base), localItems = byId(local), serverItems = byId(server);
      const order = [...new Set([...server.map(item => String(item.id)), ...local.map(item => String(item.id))])];
      const merged = [];
      for (const id of order) {
        const value = mergeRecordData(baseItems.get(id), localItems.get(id), serverItems.get(id), [...path, id], conflicts);
        if (value !== undefined) merged.push(value);
      }
      return merged;
    }
    const field = String(path[path.length - 1] || '');
    if (TIMESTAMP_FIELD.test(field) && typeof local === 'string' && typeof server === 'string') {
      return local > server ? local : server;
    }
    conflicts.push(path.join('.'));
    return local === undefined ? server : local;
  }

  const isConflict = (error) => String(error?.code || '') === '40001' ||
    /record_conflict/.test(`${error?.message || ''} ${error?.details || ''}`);

  function create({
    rpc,
    requestId,
    onAcknowledged = () => {},
    onBlocked = () => {},
    onRejected = () => {},
    isExpectedRejection = () => false,
    timeoutMs = 15000,
    transientRetries = 0,
    // Optional conflict recovery: baseFor(row) returns the record data this
    // editor last loaded; fetchCurrent(changes) returns the saved rows now.
    baseFor = null,
    fetchCurrent = null,
    onMerged = () => {},
    conflictRetries = 2,
  }) {
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
        // Capture the merge base with the data: a later save of the same record
        // must merge against what THIS edit started from.
        const bases = new Map(changes.map(row => {
          let base;
          try { base = typeof baseFor === 'function' ? baseFor(row) : undefined; } catch { base = undefined; }
          return [key(row), base === undefined || base === null ? undefined : clone(base)];
        }));
        const rebase = async (sent) => {
          if (typeof fetchCurrent !== 'function') return null;
          let current;
          try { current = await fetchCurrent(clone(sent)); } catch { return null; }
          if (!Array.isArray(current)) return null;
          const saved = new Map(current.map(row => [key(row), row]));
          const merged = [];
          const rebased = [];
          for (const change of sent) {
            const now = saved.get(key(change));
            if (change.operation === 'delete') {
              if (!now || now.deleted_at || !Number.isSafeInteger(now.version)) return null;
              rebased.push({ ...change, expected_version: now.version });
              continue;
            }
            if (!now) {
              if (change.expected_version !== 0) return null;
              rebased.push(change);
              continue;
            }
            const base = bases.get(key(change));
            if (now.deleted_at || base === undefined || !Number.isSafeInteger(now.version) || !isPlainObject(now.data)) return null;
            const conflicts = [];
            const data = mergeRecordData(base, change.data, now.data, [], conflicts);
            rebased.push({ ...change, data, expected_version: now.version });
            // A further conflict merges against the copy this merge was built on.
            bases.set(key(change), clone(now.data));
            merged.push({ key: key(change), localData: change.data, conflicts });
          }
          return { changes: rebased, merged };
        };
        const operation = tail.then(async () => {
          if (blocked) return { data: null, error: blocked.error };
          // Later local edits already contain our optimistic earlier edits.
          // Advance only by this writer's acknowledgements, NEVER by another
          // client's version fetched while this request was queued.
          for (const row of changes) row.expected_version += (ownCommits.get(key(row)) || 0) - queuedAt.get(key(row));
          let timeout;
          try {
            const requestOnce = async () => {
              try {
                return await Promise.race([
                  rpc('crm_commit_records', payload),
                  new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Save confirmation timed out.')), timeoutMs); }),
                ]);
              } finally {
                clearTimeout(timeout);
                timeout = undefined;
              }
            };
            let response;
            const merges = new Map();
            for (let conflictAttempt = 0; ; conflictAttempt += 1) {
              try {
                for (let attempt = 0; attempt <= transientRetries; attempt += 1) {
                  try {
                    response = await requestOnce();
                    if (response.error) throw response.error;
                    break;
                  } catch (error) {
                    const status = Number(error?.status || error?.statusCode || error?.code);
                    const message = String(error?.message || error || '').toLowerCase();
                    const retryable = status === 408 || status === 429 || (status >= 500 && status <= 599) ||
                      /timed out|timeout|network|fetch|gateway/.test(message);
                    if (attempt >= transientRetries || !retryable) throw error;
                  }
                }
                break;
              } catch (error) {
                // Someone else saved one of these records first. The database
                // rolled this request back, so merge onto their copy and retry.
                if (!isConflict(error) || conflictAttempt >= conflictRetries) throw error;
                const rebased = await rebase(payload.p_changes);
                if (!rebased) throw error;
                payload.p_changes = rebased.changes;
                payload.p_request_id = requestId();
                rebased.merged.forEach(entry => {
                  const earlier = merges.get(entry.key);
                  merges.set(entry.key, earlier
                    ? { ...entry, localData: earlier.localData, conflicts: [...new Set([...earlier.conflicts, ...entry.conflicts])] }
                    : entry);
                });
              }
            }
            const sentChanges = payload.p_changes;
            const returned = response.data?.rows;
            if (!Array.isArray(returned) || returned.length !== sentChanges.length || sentChanges.some(change =>
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
            onAcknowledged(clone(sentChanges), response.data.audit_ids || []);
            if (merges.size) {
              try {
                onMerged([...merges.values()].map(entry => ({
                  ...entry,
                  row: clone(returned.find(row => key(row) === entry.key)),
                })));
              } catch { /* The save itself is confirmed. */ }
            }
            return response;
          } catch (error) {
            // Business-rule rejections are confirmed rollbacks, not uncertain
            // transport failures. Let the caller restore server truth without
            // permanently blocking every later save in this browser tab.
            if (isExpectedRejection(error)) {
              onRejected({ error, payload });
              return { data: null, error };
            }
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
  root.CrmRecordWrites = { create, mergeRecordData };
  if (typeof module !== 'undefined' && module.exports) module.exports = { create, mergeRecordData };
})(typeof window !== 'undefined' ? window : globalThis);
