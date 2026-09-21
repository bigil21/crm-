/* Company settings use the same immutable, fail-closed writer as records. */
(function (root) {
  'use strict';
  const recordWrites = typeof module !== 'undefined' && module.exports
    ? require('./record-writes.js') : root.CrmRecordWrites;
  function create({ companyId, rpc, requestId, onBlocked, timeoutMs }) {
    const id = `${companyId}:company`;
    const writer = recordWrites.create({
      requestId, timeoutMs,
      rpc: (_name, payload) => rpc('crm_commit_company_settings', {
        p_request_id: payload.p_request_id,
        p_expected_version: payload.p_changes[0].expected_version,
        p_data: payload.p_changes[0].data,
      }),
      onBlocked: blocked => onBlocked?.({ ...blocked,
        payload: { ...blocked.payload, rpc: 'crm_commit_company_settings' } }),
    });
    return {
      remember(row) {
        if (!row) return; // A missing settings row is created with version zero.
        if (row.id !== id || !Number.isSafeInteger(row.version) || row.version < 1) {
          throw new Error('Company settings need the versioned database update.');
        }
        writer.remember([{ ...row, record_type: 'company' }]);
      },
      commit(data) { return writer.commit([{ company_state_id: companyId, record_type: 'company', id, data }]); },
      get blocked() { return writer.blocked; },
    };
  }
  root.CrmCompanySettingsWrites = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = { create };
})(typeof window !== 'undefined' ? window : globalThis);
