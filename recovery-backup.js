"use strict";

const DEFAULT_PAGE_SIZE = 1000;

function serviceHeaders(key, extra = {}) {
  return {
    apikey: key,
    ...(!key.startsWith("sb_secret_") ? { Authorization: `Bearer ${key}` } : {}),
    ...extra,
  };
}

function backupDate(date = new Date(), timeZone = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function readJson(response, message) {
  if (!response.ok) throw new Error(message);
  return response.json();
}

async function fetchRows(config, table, query = {}) {
  const rows = [];
  const pageSize = config.pageSize || DEFAULT_PAGE_SIZE;
  for (let offset = 0; ; offset += pageSize) {
    const url = new URL(`${config.origin}/rest/v1/${table}`);
    url.searchParams.set("select", "*");
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await config.fetch(url, {
      signal: AbortSignal.timeout(config.timeoutMs || 30000),
      headers: serviceHeaders(config.key, { Range: `${offset}-${offset + pageSize - 1}` }),
    });
    const page = await readJson(response, `Recovery backup could not read ${table}.`);
    if (!Array.isArray(page)) throw new Error(`Recovery backup received invalid ${table} data.`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

function storagePaths(records) {
  return [...new Set(records
    .filter((row) => row.record_type === "document" && !row.deleted_at)
    .flatMap((row) => [
      row.data?.storagePath,
      ...(Array.isArray(row.data?.previousVersions) ? row.data.previousVersions.map((version) => version?.storagePath) : []),
    ])
    .filter(Boolean))];
}

async function createDailyBackup(config, date = new Date()) {
  const day = backupDate(date, config.timeZone);
  const companyFilter = `eq.${config.companyId}`;
  const [companyRows, records, auditEvents, conversationMessages] = await Promise.all([
    fetchRows(config, "crm_state", { id: `eq.${config.companyId}:company` }),
    fetchRows(config, "crm_records", { company_state_id: companyFilter, order: "record_type.asc,id.asc" }),
    fetchRows(config, "crm_audit_events", { company_state_id: companyFilter, order: "created_at.asc,id.asc" }),
    fetchRows(config, "crm_conversation_messages", { company_state_id: companyFilter, order: "created_at.asc,id.asc" }),
  ]);
  const payload = {
    schemaVersion: 3,
    createdAt: date.toISOString(),
    source: "server",
    company: companyRows[0]?.data || {},
    records,
    auditEvents,
    conversationMessages,
    // Storage object bytes require a separate provider/storage backup.
    storagePaths: storagePaths(records),
  };
  const url = new URL(`${config.origin}/rest/v1/crm_backups`);
  url.searchParams.set("on_conflict", "company_state_id,backup_date");
  const response = await config.fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(config.timeoutMs || 30000),
    headers: serviceHeaders(config.key, {
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    }),
    body: JSON.stringify({
      company_state_id: config.companyId,
      backup_date: day,
      record_count: records.filter((row) => !row.deleted_at).length,
      payload,
      created_by: null,
    }),
  });
  if (!response.ok) throw new Error("Recovery backup could not be stored.");
  return { backupDate: day, recordCount: records.filter((row) => !row.deleted_at).length };
}

function start(config) {
  const intervalMs = config.intervalMs || 60 * 60 * 1000;
  let stopped = false;
  let running = false;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try { await createDailyBackup(config); }
    catch (error) { config.onError?.(error); }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  void run();
  return () => { stopped = true; clearInterval(timer); };
}

module.exports = { backupDate, createDailyBackup, fetchRows, start, storagePaths };
