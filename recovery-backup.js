"use strict";

const DEFAULT_PAGE_SIZE = 1000;
// 6: the five Square tables are in the backup too. A stored backup in an older
// format is not counted as whole, so the day's is made again once after an update.
const BACKUP_FORMAT = 6;
// The database function that hands over the Square tables, and the most rows it
// gives at a time.
const SQUARE_BACKUP_FUNCTION = "crm_square_backup_page";
const FUNCTION_PAGE_SIZE = 500;

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
  if (!response.ok) throw Object.assign(new Error(message), { status: response.status });
  return response.json();
}

async function fetchRows(config, table, query = {}) {
  const rows = [];
  const pageSize = config.pageSize || DEFAULT_PAGE_SIZE;
  let total;
  for (let offset = 0; ; offset = rows.length) {
    const url = new URL(`${config.origin}/rest/v1/${table}`);
    url.searchParams.set("select", "*");
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await config.fetch(url, {
      signal: AbortSignal.timeout(config.timeoutMs || 30000),
      headers: serviceHeaders(config.key, { Range: `${offset}-${offset + pageSize - 1}`, ...(offset === 0 ? { Prefer: "count=exact" } : {}) }),
    });
    const page = await readJson(response, `Recovery backup could not read ${table}.`);
    if (!Array.isArray(page)) throw new Error(`Recovery backup received invalid ${table} data.`);
    const count = response.headers?.get?.("content-range")?.match(/\/(\d+)$/);
    if (offset === 0 && count) total = Number(count[1]);
    rows.push(...page);
    if (total !== undefined) {
      if (rows.length === total) return rows;
      if (!page.length || rows.length > total) throw new Error(`Recovery backup received an inconsistent page of ${table}.`);
    } else if (page.length < pageSize) return rows;
  }
}

// ---- What a backup holds -----------------------------------------------------
// Every table in the database is in exactly one of three lists: the four that
// have always made up a backup (CORE_TABLES), the others it holds
// (EXTRA_TABLES), or the few left out on purpose, each with its reason
// (EXCLUDED_TABLES). A test holds these lists against the real schema, so a
// table added to the CRM later cannot be left out of the backup by forgetting:
// the release check fails until it is put in one list or the other.
// (An earlier version of this list named the tables its author thought of. It
// missed 47, permits and inspections among them.)
const CORE_TABLES = ["crm_state", "crm_records", "crm_audit_events", "crm_conversation_messages"];

const EXCLUDED_TABLES = {
  crm_backups: "The backups themselves.",
  crm_oauth_connections: "Sign-in tokens for Google and other connected services. A backup can be read by managers, and these are secrets. After a restore the services are connected again.",
  crm_oauth_states: "Half-finished sign-ins to connected services. Secrets, and of no use minutes later.",
  crm_write_receipts: "Receipts of saves that have already finished. They exist so a repeated request does nothing twice; they hold no business data.",
  crm_company_settings_receipts: "Receipts of settings saves that have already finished. No business data.",
};

// order: the table's own key, so pages of rows never overlap or skip.
// everyCompany: the table has no company column.
// via: the table is closed to the server's key and is read through this
//   database function instead, which gives the same rows a page at a time.
// optional: a table that not every copy of the database has. Where it is
//   absent that is recorded, and is not a failure. No table is optional now:
//   the one that was, quote_requests, is made by the repo's own migrations.
const EXTRA_TABLES = [
  // Money kept in its own tables, and the numbers already given out.
  { table: "crm_sales_numbers", order: "number_kind.asc,entity_id.asc" },
  { table: "crm_invoices", order: "id.asc" },
  { table: "crm_invoice_items", order: "id.asc" },
  { table: "crm_invoice_schedules", order: "id.asc" },
  { table: "crm_billing_notices", order: "id.asc" },
  { table: "crm_payments", order: "id.asc" },
  { table: "crm_payment_allocations", order: "id.asc" },
  { table: "crm_refunds", order: "id.asc" },
  { table: "crm_credit_notes", order: "id.asc" },
  { table: "crm_expenses", order: "id.asc" },
  { table: "crm_change_orders", order: "id.asc" },
  { table: "crm_progress_billings", order: "id.asc" },
  // Square. These five are closed to every role, the server's key included, so
  // they are read through a function of the database's own. The first holds
  // when Square invoicing was switched on: without that date, a rebuilt
  // database treats every existing estimate as needing a review before it can
  // be invoiced.
  { table: "crm_square_invoice_policy", order: "environment.asc", via: SQUARE_BACKUP_FUNCTION },
  { table: "crm_square_invoice_reviews", order: "environment.asc,estimate_id.asc", via: SQUARE_BACKUP_FUNCTION },
  { table: "crm_square_invoice_intents", order: "id.asc", via: SQUARE_BACKUP_FUNCTION },
  { table: "crm_square_invoice_watermarks", order: "environment.asc,merchant_id.asc,invoice_id.asc", via: SQUARE_BACKUP_FUNCTION },
  { table: "crm_square_webhook_events", order: "environment.asc,merchant_id.asc,event_id.asc", via: SQUARE_BACKUP_FUNCTION },
  // Work on a job.
  { table: "crm_permits", order: "id.asc" },
  { table: "crm_inspections", order: "id.asc" },
  { table: "crm_job_selections", order: "id.asc" },
  { table: "crm_job_milestones", order: "id.asc" },
  { table: "crm_job_time_entries", order: "id.asc" },
  { table: "crm_maintenance_plans", order: "id.asc" },
  { table: "crm_maintenance_visits", order: "id.asc" },
  { table: "crm_project_discussions", order: "id.asc" },
  { table: "crm_project_notes", order: "id.asc" },
  { table: "crm_project_members", order: "id.asc" },
  // Tasks.
  { table: "crm_task_workflows", order: "task_id.asc" },
  { table: "crm_task_checklist_items", order: "id.asc" },
  { table: "crm_task_comments", order: "id.asc" },
  { table: "crm_task_participants", order: "id.asc" },
  { table: "crm_task_time_entries", order: "id.asc" },
  { table: "crm_reminders", order: "id.asc" },
  // Commercial accounts, and customers' own sign-ins and messages.
  { table: "crm_organization_accounts", order: "id.asc" },
  { table: "crm_account_contacts", order: "id.asc" },
  { table: "crm_account_properties", order: "id.asc" },
  { table: "crm_account_record_links", order: "id.asc" },
  { table: "crm_customer_accounts", order: "user_id.asc" },
  { table: "crm_customer_messages", order: "id.asc" },
  // Documents (the files themselves are in storage, not in any table).
  { table: "crm_document_versions", order: "id.asc" },
  { table: "crm_document_comments", order: "id.asc" },
  { table: "crm_document_access", order: "document_id.asc" },
  { table: "crm_signature_requests", order: "id.asc" },
  // What came in from the website.
  { table: "crm_web_lead_forms", order: "id.asc" },
  { table: "crm_website_intake_requests", order: "request_id.asc" },
  { table: "quote_requests", order: "id.asc", everyCompany: true },
  // History, notices and messages waiting to go out.
  { table: "crm_activity_events", order: "id.asc" },
  { table: "crm_notifications", order: "id.asc" },
  { table: "crm_assignment_alerts", order: "id.asc" },
  { table: "crm_announcements", order: "id.asc" },
  { table: "crm_scheduled_messages", order: "id.asc" },
  // The company's set-up lists.
  { table: "crm_divisions", order: "id.asc" },
  { table: "crm_services", order: "id.asc" },
  { table: "crm_pipeline_stages", order: "division_id.asc,id.asc" },
  { table: "crm_payment_methods", order: "id.asc" },
  { table: "crm_tax_rates", order: "id.asc" },
  { table: "crm_lead_sources", order: "id.asc" },
  { table: "crm_tags", order: "id.asc" },
  { table: "crm_record_tags", order: "id.asc" },
  { table: "crm_custom_fields", order: "id.asc" },
  { table: "crm_custom_field_values", order: "id.asc" },
  { table: "crm_email_templates", order: "id.asc" },
  { table: "crm_document_templates", order: "id.asc" },
  { table: "crm_project_templates", order: "id.asc" },
  { table: "crm_operational_settings", order: "setting_key.asc" },
  { table: "crm_saved_filters", order: "id.asc" },
  { table: "crm_goals", order: "id.asc" },
  { table: "crm_report_exports", order: "id.asc" },
  // Who has which role.
  { table: "crm_role_capabilities", order: "role_name.asc,capability.asc" },
  { table: "crm_user_access", order: "user_id.asc", everyCompany: true },
  { table: "crm_admins", order: "email.asc", everyCompany: true },
];

// A table the server's key may not read, asked of the database function that
// may. Each answer is one page of rows and the table's whole row count. The
// rows are kept only when every page gave the same count, the pages add up to
// it, and no row came twice: a table that changed between two pages is read
// again on the next run instead of being stored with a row doubled or missing.
async function fetchFunctionRows(config, name, table, order) {
  const rows = [];
  const pageSize = Math.min(config.pageSize || FUNCTION_PAGE_SIZE, FUNCTION_PAGE_SIZE);
  const inconsistent = () => new Error(`Recovery backup received an inconsistent page of ${table}.`);
  let total;
  for (;;) {
    const response = await config.fetch(new URL(`${config.origin}/rest/v1/rpc/${name}`), {
      method: "POST",
      signal: AbortSignal.timeout(config.timeoutMs || 30000),
      headers: serviceHeaders(config.key, { "Content-Type": "application/json" }),
      body: JSON.stringify({ p_company: config.companyId, p_table: table, p_offset: rows.length, p_limit: pageSize }),
    });
    const page = await readJson(response, `Recovery backup could not read ${table}.`);
    if (!page || !Array.isArray(page.rows) || !Number.isSafeInteger(page.total) || page.total < 0
      || !page.rows.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
      throw new Error(`Recovery backup received invalid ${table} data.`);
    }
    if (total === undefined) total = page.total;
    else if (page.total !== total) throw inconsistent();
    rows.push(...page.rows);
    if (rows.length > total || (!page.rows.length && rows.length < total)) throw inconsistent();
    if (rows.length === total) break;
  }
  const keyColumns = ["company_state_id", ...order.split(",").map((part) => part.split(".")[0])];
  if (new Set(rows.map((row) => JSON.stringify(keyColumns.map((column) => row[column])))).size !== rows.length) throw inconsistent();
  return rows;
}

// These are read one at a time, and a table that cannot be read is named in
// the backup instead of stopping it: the records must be backed up regardless.
async function fetchExtraTables(config) {
  const tables = {};
  const skippedTables = [];
  const absentTables = [];
  for (const { table, order, everyCompany, optional, via } of EXTRA_TABLES) {
    try {
      tables[table] = via
        ? await fetchFunctionRows(config, via, table, order)
        : await fetchRows(config, table, { ...(everyCompany ? {} : { company_state_id: `eq.${config.companyId}` }), order });
    } catch (error) {
      // "This database has no such table" is an answer, for a table marked
      // optional. Any other failure is a table that could not be read.
      if (optional && error?.status === 404) absentTables.push(table);
      else skippedTables.push(table);
    }
  }
  return { tables, skippedTables, absentTables };
}

// The tables above a backup is meant to hold and does not. A table that could
// not be read when the backup was made is one; so is every one of them in a
// backup from before they were included. A backup with any of these missing
// cannot rebuild the CRM by itself, and nothing may call it complete.
function missingTables(payload) {
  const tables = payload?.tables;
  if (!tables || typeof tables !== "object") return EXTRA_TABLES.map(({ table }) => table);
  const skipped = Array.isArray(payload.skippedTables) ? payload.skippedTables : [];
  const absent = Array.isArray(payload.absentTables) ? payload.absentTables : [];
  return EXTRA_TABLES
    // An optional table the backup says the database did not have is not missing from it.
    .filter(({ table, optional }) => !(optional && absent.includes(table) && !skipped.includes(table)))
    .map(({ table }) => table)
    .filter((table) => skipped.includes(table) || !Array.isArray(tables[table]));
}

async function storedBackupFound(config, day, { completeOnly = false } = {}) {
  const url = new URL(`${config.origin}/rest/v1/crm_backups`);
  url.searchParams.set("select", "backup_date");
  url.searchParams.set("company_state_id", `eq.${config.companyId}`);
  url.searchParams.set("backup_date", `eq.${day}`);
  // A backup that read every table says so itself: its list of skipped tables
  // is empty. One made before backups kept that list has none, and is not complete.
  if (completeOnly) {
    url.searchParams.set("payload->>skippedTables", "eq.[]");
    url.searchParams.set("payload->>schemaVersion", `eq.${BACKUP_FORMAT}`);
    url.searchParams.set("payload->>privateSquareSnapshot", "not.is.null");
  }
  const response = await config.fetch(url, {
    signal: AbortSignal.timeout(config.timeoutMs || 30000),
    headers: serviceHeaders(config.key, { Range: "0-0" }),
  });
  if (!response.ok) throw new Error("Recovery backup could not read the stored backups.");
  const rows = await response.json();
  return Array.isArray(rows) && rows.length > 0;
}

// One backup is kept per day.
//   "complete"   today's is there and whole: nothing to do, and no record is
//                read again only to have it ignored;
//   "incomplete" today's is there but a table is missing from it: it is made
//                again on the next run, until one comes out whole;
//   "none"       there is none yet;
//   "unknown"    the question could not be asked. Not knowing is not a reason
//                to skip a backup, nor to replace one.
async function storedBackupState(config, day) {
  try {
    if (await storedBackupFound(config, day, { completeOnly: true })) return "complete";
    return (await storedBackupFound(config, day)) ? "incomplete" : "none";
  } catch {
    return "unknown";
  }
}

async function backupExists(config, day) {
  try {
    return await storedBackupFound(config, day);
  } catch {
    return false;
  }
}

function storagePaths(records, tables = {}) {
  const paths = records
    .filter((row) => row.record_type === "document" && !row.deleted_at)
    .flatMap((row) => [
      row.data?.storagePath,
      // A photo's small gallery copy is a stored file too.
      row.data?.previewPath,
      ...(Array.isArray(row.data?.previousVersions) ? row.data.previousVersions.map((version) => version?.storagePath) : []),
    ])
    .filter(Boolean);
  for (const row of tables.crm_document_versions || []) {
    const path = row.storage_path;
    if (!path) continue;
    paths.push(path);
  }
  return [...new Set(paths)];
}

// Files kept in a bucket of their own: the photos a visitor attaches to a
// website quote request. Each request names its photos; the files are in the
// "quote-photos" bucket, not with the CRM's documents.
const QUOTE_PHOTO_BUCKET = "quote-photos";
function quotePhotoPaths(tables = {}) {
  return [...new Set((Array.isArray(tables.quote_requests) ? tables.quote_requests : [])
    .flatMap((row) => (Array.isArray(row?.photo_paths) ? row.photo_paths : []))
    .filter((item) => typeof item === "string" && item))];
}

async function createDailyBackup(config, date = new Date()) {
  const day = backupDate(date, config.timeZone);
  const stored = await storedBackupState(config, day);
  if (stored === "complete") return { backupDate: day, alreadyStored: true };
  const companyFilter = `eq.${config.companyId}`;
  const [allStateRows, records, auditEvents, conversationMessages] = await Promise.all([
    // Every settings row of this company: the company's own, and the older
    // rows kept per user and for the company as a whole.
    fetchRows(config, "crm_state", { id: `like.${config.companyId}*`, order: "id.asc" }),
    fetchRows(config, "crm_records", { company_state_id: companyFilter, order: "record_type.asc,id.asc" }),
    fetchRows(config, "crm_audit_events", { company_state_id: companyFilter, order: "created_at.asc,id.asc" }),
    fetchRows(config, "crm_conversation_messages", { company_state_id: companyFilter, order: "created_at.asc,id.asc" }),
  ]);
  const stateRows = allStateRows.filter((row) => row?.id === config.companyId || String(row?.id || "").startsWith(`${config.companyId}:`));
  const { tables, skippedTables, absentTables } = await fetchExtraTables(config);
  const payload = {
    schemaVersion: BACKUP_FORMAT,
    createdAt: date.toISOString(),
    source: "server",
    company: stateRows.find((row) => row.id === `${config.companyId}:company`)?.data || {},
    stateRows,
    records,
    auditEvents,
    conversationMessages,
    tables,
    skippedTables,
    absentTables,
    // The files themselves are not in here, only where each one is kept.
    // `npm run backup:export` copies them, with this backup, to a folder.
    storagePaths: storagePaths(records, tables),
    // The same for the photos sent in with website quote requests, which are
    // kept in their own bucket.
    quotePhotoPaths: quotePhotoPaths(tables),
  };
  const incomplete = missingTables(payload);
  const recordCount = records.filter((row) => !row.deleted_at).length;
  // Today's backup is there already, with a table missing, and this attempt is
  // missing one too. The earlier one is kept: a second partial copy is no
  // better than the first. The next run tries again.
  if (stored === "incomplete" && incomplete.length) return { backupDate: day, alreadyStored: true, incomplete };
  // Only the server-only RPC accepts raw provider records. Never fall back to
  // posting the combined payload to the manager-readable table.
  const url = new URL(`${config.origin}/rest/v1/rpc/crm_store_split_backup`);
  const response = await config.fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(config.timeoutMs || 30000),
    headers: serviceHeaders(config.key, { "Content-Type": "application/json" }),
    body: JSON.stringify({ p_replace: stored === "incomplete", p_backup: {
      company_state_id: config.companyId,
      backup_date: day,
      record_count: recordCount,
      payload,
      created_by: null,
    } }),
  });
  if (!response.ok) throw new Error("Recovery backup could not be stored.");
  const changed = await response.json();
  if (changed === false) return { backupDate: day, alreadyStored: true };
  if (changed !== true) throw new Error("Recovery backup storage was not confirmed.");
  return { backupDate: day, recordCount, ...(stored === "incomplete" ? { replacedIncomplete: true } : {}), ...(incomplete.length ? { incomplete } : {}) };
}

function start(config) {
  const intervalMs = config.intervalMs || 60 * 60 * 1000;
  let stopped = false;
  let running = false;
  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await createDailyBackup(config);
      // Stored, but not whole: said out loud, and made again on the next run.
      if (result.incomplete?.length) config.onError?.(new Error(`Recovery backup is incomplete: ${result.incomplete.join(", ")} could not be read.`));
    }
    catch (error) { config.onError?.(error); }
    finally { running = false; }
  };
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  void run();
  return () => { stopped = true; clearInterval(timer); };
}

module.exports = { BACKUP_FORMAT, CORE_TABLES, EXCLUDED_TABLES, EXTRA_TABLES, QUOTE_PHOTO_BUCKET, SQUARE_BACKUP_FUNCTION, quotePhotoPaths, backupDate, backupExists, createDailyBackup, fetchRows, missingTables, serviceHeaders, start, storagePaths, storedBackupState };
