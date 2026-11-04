(function attachRecordPages(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.JobCrestRecordPages = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function recordPagesFactory() {
  "use strict";

  const PAGE_SIZE = 50;

  function normalizePayload(value) {
    const payload = value && typeof value === "object" ? value : {};
    return {
      items: Array.isArray(payload.items) ? payload.items : [],
      totalCount: Math.max(0, Number(payload.totalCount) || 0),
      hasMore: payload.hasMore === true,
      nextCursor: payload.nextCursor && typeof payload.nextCursor === "object" ? payload.nextCursor : null,
    };
  }

  function rpcArguments({ limit = PAGE_SIZE, cursor = null, search = "", status = "" } = {}) {
    return {
      p_limit: Math.min(100, Math.max(1, Math.round(Number(limit) || PAGE_SIZE))),
      p_cursor_updated_at: cursor?.updatedAt || null,
      p_cursor_id: cursor?.id || null,
      p_search: String(search || "").trim().slice(0, 200),
      p_status: String(status || "").trim().slice(0, 100),
    };
  }

  function create(client) {
    if (!client || typeof client.rpc !== "function") throw new TypeError("A Supabase client is required");
    async function call(functionName, options) {
      const { data, error } = await client.rpc(functionName, rpcArguments(options));
      if (error) throw error;
      return normalizePayload(data);
    }
    return {
      leads(options) { return call("crm_lead_page", options); },
      jobs(options) { return call("crm_job_page", options); },
      async aggregates() {
        const { data, error } = await client.rpc("crm_dashboard_aggregates");
        if (error) throw error;
        return data && typeof data === "object" ? data : {};
      },
    };
  }

  function uniqueRows(rows = []) {
    const byKey = new Map();
    rows.filter(Boolean).forEach((row) => byKey.set(`${row.record_type}:${row.id}`, row));
    return [...byKey.values()];
  }

  function rowsFromLeadItems(items = []) {
    return uniqueRows(items.flatMap((item) => [item?.record, ...(Array.isArray(item?.jobs) ? item.jobs : [])]));
  }

  function rowsFromJobItems(items = []) {
    return uniqueRows(items.flatMap((item) => [item?.contact, item?.record]));
  }

  return { PAGE_SIZE, create, normalizePayload, rpcArguments, uniqueRows, rowsFromLeadItems, rowsFromJobItems };
});
