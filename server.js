const fs = require("fs");
const http = require("http");
const path = require("path");

const root = __dirname;
const envPaths = process.env.CRM_SKIP_ENV_FILES === "true" ? [] : [path.join(root, ".env"), path.join(root, ".env.local")];

envPaths.forEach((envPath) => {
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
});

const port = Number(process.env.PORT || 4173);
const allowedEmailDomain = process.env.ALLOWED_EMAIL_DOMAIN || "coastalcrestroofing.com";
// Only these shipped browser assets are public. Never serve the repository itself.
const publicAssets = new Set([
  "/index.html", "/login.html", "/logout.html", "/reset-session.html",
  "/styles.css", "/app.js", "/record-writes.js", "/company-settings-writes.js", "/sales-numbering.js", "/payment-refresh.js", "/draft-recovery.js", "/session-guard.js", "/auth.js", "/login.js", "/logout.js", "/sw.js",
  "/production-flow-v64.js", "/workflow-checklists-v65.js", "/project-conversations-v67.js",
  "/vendor/jspdf.umd.min.js", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png",
]);

function authenticationRequired() {
  return !(process.env.NODE_ENV === "development" && process.env.ALLOW_LOCAL_DEMO === "true" && process.env.AUTH_REQUIRED === "false");
}

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, JSON.stringify(payload), "application/json; charset=utf-8");
}

function sendRedirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function supabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    anonKey:
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "",
  };
}

function authConfigScript() {
  const authConfig = squareStatusPublicConfig();
  const config = {
    supabaseUrl: authConfig?.origin || "",
    supabaseAnonKey: authConfig?.anonKey || "",
    allowedEmailDomain,
    adminEmails: process.env.ADMIN_EMAILS || process.env.OWNER_EMAIL || process.env.ADMIN_EMAIL || "",
    defaultRole: process.env.DEFAULT_AUTH_ROLE || "viewer",
    authRequired: authenticationRequired(),
    syncEnabled: process.env.SUPABASE_SYNC_ENABLED === "true",
    stateId: process.env.SUPABASE_STATE_ID || "coastal-crest",
    stagingTestIdentity: stagingTestIdentity(),
    squarePaymentWorkerEnabled: process.env.SQUARE_PAYMENT_WORKER_ENABLED === "true" && Boolean(squareWorkerConfig() && squareToken() && squareStatusSafeId(process.env.SQUARE_MERCHANT_ID)),
  };
  return `window.ROOFLINE_SUPABASE_CONFIG = ${JSON.stringify(config)};`;
}

function stagingTestIdentity() {
  // This exception cannot be enabled by a live Render deployment or a different
  // Supabase project, even if staging flags are accidentally copied there.
  if (process.env.CRM_STAGING_ACCESS !== "true" || process.env.NODE_ENV !== "development" ||
      process.env.CRM_SKIP_ENV_FILES !== "true" || !authenticationRequired() ||
      process.env.SUPABASE_SYNC_ENABLED !== "true" || process.env.SQUARE_ACCESS_TOKEN) return null;
  const projectOrigin = "https://ixksmfiektzsunmmwejz.supabase.co";
  if (supabaseConfig().url.replace(/\/$/, "") !== projectOrigin) return null;
  const email = String(process.env.CRM_STAGING_TEST_EMAIL || "").trim().toLowerCase();
  const userId = process.env.CRM_STAGING_TEST_USER_ID || "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(userId)) return null;
  return { email, userId, projectOrigin };
}

function isAllowedApiUser(user) {
  if (String(user?.email || "").toLowerCase().endsWith(`@${allowedEmailDomain.toLowerCase()}`)) return true;
  const test = stagingTestIdentity();
  return Boolean(test && user?.id === test.userId && String(user.email || "").toLowerCase() === test.email && user.app_metadata?.role === "sales");
}

const SQUARE_BASE = process.env.SQUARE_ENVIRONMENT === "sandbox"
  ? "https://connect.squareupsandbox.com/v2" : "https://connect.squareup.com/v2";
const SQUARE_VERSION = "2024-01-18";

function squareToken() {
  return process.env.SQUARE_ACCESS_TOKEN || "";
}

function squareWebhookKey() {
  return process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || "";
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("Request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

async function verifyApiUser(req) {
  if (!authenticationRequired()) {
    return { email: `local@${allowedEmailDomain}`, app_metadata: { role: "admin" }, local: true };
  }
  const config = squareStatusPublicConfig();
  const authorization = req.headers.authorization || "";
  if (!config || !/^Bearer \S+$/.test(authorization)) return null;
  const response = await fetch(`${config.origin}/auth/v1/user`, {
    signal: AbortSignal.timeout(15000),
    headers: { apikey: config.anonKey, Authorization: authorization },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return isAllowedApiUser(user) ? user : null;
}

async function requireApiUser(req, res, handler) {
  try {
    const user = await verifyApiUser(req);
    if (!user) {
      sendJson(res, 401, { error: "authentication_required" });
      return;
    }
    await handler(req, res, user);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "request_failed" });
  }
}

function configuredAdminEmails() {
  return String(process.env.ADMIN_EMAILS || process.env.OWNER_EMAIL || process.env.ADMIN_EMAIL || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

function isApiAdmin(user = {}) {
  return Boolean(
    user.local ||
      String(user.app_metadata?.role || "").toLowerCase() === "admin" ||
      configuredAdminEmails().includes(String(user.email || "").toLowerCase()),
  );
}

async function requireApiAdmin(req, res, handler) {
  try {
    const user = await verifyApiUser(req);
    if (!user) {
      sendJson(res, 401, { error: "authentication_required" });
      return;
    }
    if (!isApiAdmin(user)) {
      sendJson(res, 403, { error: "admin_required" });
      return;
    }
    await handler(req, res, user);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "request_failed" });
  }
}

async function squareRequest(method, path, body) {
  const https = require("https");
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const url = new URL(SQUARE_BASE + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        "Authorization": `Bearer ${squareToken()}`,
        "Square-Version": SQUARE_VERSION,
        "Content-Type": "application/json",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("Square request timed out; check invoice status before retrying")));
    if (payload) req.write(payload);
    req.end();
  });
}

function squareLineItem(item = {}) {
  const quantity = Number(item.quantity);
  const rate = Number(item.rate);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1000000 ||
      !Number.isFinite(rate) || rate < 0 || !Number.isSafeInteger(Math.round(rate * 100))) {
    throw new Error("Line items require a positive quantity and a valid non-negative price");
  }
  return {
    name: String(item.title || "Line item").slice(0, 500),
    quantity: String(quantity),
    base_price_money: { amount: Math.round(rate * 100), currency: "USD" },
    note: String(item.description || "").slice(0, 2000),
  };
}

function squareWorkerConfig() {
  const publicConfig = squareStatusPublicConfig();
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  let serverKey = /^sb_secret_[A-Za-z0-9_-]+$/.test(key);
  if (!serverKey) {
    try {
      const parts = key.split(".");
      serverKey = parts.length === 3 && JSON.parse(Buffer.from(parts[1], "base64url").toString()).role === "service_role";
    } catch { serverKey = false; }
  }
  if (!publicConfig || !serverKey) return null;
  return { origin: publicConfig.origin, companyId: publicConfig.companyId, key };
}

async function squareWorkerRpc(config, name, payload) {
  const response = await fetch(`${config.origin}/rest/v1/rpc/${name}`, {
    method: "POST", signal: AbortSignal.timeout(15000),
    headers: {
      apikey: config.key, "Content-Type": "application/json",
      ...(!config.key.startsWith("sb_secret_") ? { Authorization: `Bearer ${config.key}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();
  if (!response.ok) {
    // Do not expose database details, provider payloads or credentials.
    const error = new Error("The invoice database step could not be confirmed.");
    error.code = typeof result?.message === "string" ? result.message : "invoice_database_unavailable";
    throw error;
  }
  return result;
}

function createSquareInvoiceStore(config, user) {
  return {
    begin: (estimateId, expectedVersion) => squareWorkerRpc(config, "crm_square_begin_invoice", {
      p_company: config.companyId, p_actor: user.id, p_estimate_id: estimateId,
      p_expected_version: expectedVersion, p_environment: process.env.SQUARE_ENVIRONMENT === "sandbox" ? "sandbox" : "production",
    }),
    checkpoint: (intent, stage, receipt) => squareWorkerRpc(config, "crm_square_checkpoint_invoice", {
      p_company: config.companyId, p_intent: intent.id, p_stage: stage, p_receipt: receipt,
    }),
    complete: (intent, result) => squareWorkerRpc(config, "crm_square_complete_invoice", {
      p_company: config.companyId, p_intent: intent.id, p_result: result,
    }),
  };
}

async function handleSquareCreateInvoice(req, res, user) {
  if (!user?.id || user.local || !isApiAdmin(user)) {
    sendJson(res, 403, { error: "A signed-in company administrator is required." }); return;
  }
  let body;
  try {
    body = JSON.parse(await readRequestBody(req));
    if (!body || Array.isArray(body) || !squareStatusSafeId(body.estimateId) ||
        !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1 ||
        Object.keys(body).some(key => !["estimateId", "expectedVersion"].includes(key))) throw Error();
  } catch {
    sendJson(res, 400, { error: "Send only the saved estimate ID and its current version.", noProviderAction: true }); return;
  }
  const config = squareWorkerConfig();
  if (!config || !squareToken()) {
    sendJson(res, 503, { error: "Reliable Square invoice storage is not configured. No invoice was sent.", noProviderAction: true }); return;
  }
  try {
    const workflow = require(path.join(__dirname, "square-invoice-workflow.js")).create({
      store: createSquareInvoiceStore(config, user), request: squareRequest,
    });
    const result = await workflow.send(body.estimateId, body.expectedVersion);
    if (result?.durable !== true) throw new Error("Missing durable invoice confirmation");
    sendJson(res, 200, result);
  } catch (error) {
    const known = {
      legacy_invoice_review_required: "An administrator must check Square for an earlier invoice attempt before sending this older estimate.",
      estimate_changed_before_invoice: "The estimate changed. Reload and review the saved estimate before sending.",
      won_estimate_required: "Save the estimate as Won before sending an invoice.",
      invoice_already_linked: "This estimate already has a linked Square invoice. Reload its invoice status.",
      saved_customer_email_and_numbers_required: "Save the customer email, lead number and project number before sending.",
    };
    const code = error.storeCode || error.code;
    const message = known[code] || "Invoice sending could not be fully confirmed. Review the saved attempt and invoice status before retrying. Do not create a separate invoice.";
    sendJson(res, known[code] ? 409 : 503, {
      error: message, reviewRequired: true,
      ...(known[code] && error.storeCode ? { code, stage: "begin", noProviderAction: true } : {}),
    });
  }
}

function squareInvoicePaymentSummary(invoice = {}) {
  const requests = invoice.payment_requests || [];
  const paidCents = requests.reduce(
    (sum, request) => sum + Number(request.total_completed_amount_money?.amount || 0),
    0,
  );
  const contractCents = requests.reduce(
    (sum, request) => sum + Number(request.computed_amount_money?.amount || 0),
    0,
  );
  return {
    invoiceId: invoice.id || "",
    orderId: invoice.order_id || "",
    status: invoice.status || "",
    contractAmount: contractCents / 100,
    paidAmount: paidCents / 100,
    paymentPercent: contractCents ? Math.min(100, (paidCents / contractCents) * 100) : 0,
    updatedAt: invoice.updated_at || new Date().toISOString(),
    paymentRequests: requests.map((request) => ({
      type: request.request_type || "",
      requestedAmount: Number(request.computed_amount_money?.amount || 0) / 100,
      paidAmount: Number(request.total_completed_amount_money?.amount || 0) / 100,
      dueDate: request.due_date || "",
    })),
  };
}

function squareStatusSafeId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(value);
}

function squareStatusPublicConfig() {
  const config = supabaseConfig();
  let origin;
  try {
    const url = new URL(config.url);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) return null;
    origin = url.origin;
  } catch { return null; }
  // Never send a service/secret key, including a misconfigured legacy JWT, to
  // these reads. The verified user's bearer preserves PostgREST/RLS scope.
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(config.anonKey);
  if (!publicKey) {
    try {
      const parts = config.anonKey.split(".");
      publicKey = parts.length === 3 && JSON.parse(Buffer.from(parts[1], "base64url").toString()).role === "anon";
    } catch { publicKey = false; }
  }
  if (!publicKey) return null;
  return { origin, anonKey: config.anonKey, companyId: process.env.SUPABASE_STATE_ID || "coastal-crest" };
}

async function squareStatusReadRecords(config, authorization, recordType, filterField, ids, signal) {
  const rows = [], seen = new Set();
  let expectedCount = null;
  // These are targeted reference reads, never whole-company snapshots. Both
  // total rows and page count are bounded; exceeding either fails closed.
  for (let page = 0; page < 20; page++) {
    signal?.throwIfAborted();
    const url = new URL(`${config.origin}/rest/v1/crm_records`);
    url.searchParams.set("select", "id,record_type,company_state_id,lead_id,job_id,data,version,deleted_at");
    url.searchParams.set("company_state_id", `eq.${config.companyId}`);
    url.searchParams.set("record_type", `eq.${recordType}`);
    url.searchParams.set("deleted_at", "is.null");
    url.searchParams.set(filterField, `in.(${ids.map(id => `"${id}"`).join(",")})`);
    url.searchParams.set("order", "id.asc");
    url.searchParams.set("offset", String(rows.length));
    url.searchParams.set("limit", "100");
    const response = await fetch(url, {
      method: "GET", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      headers: { apikey: config.anonKey, Authorization: authorization, Prefer: "count=exact" },
    });
    if (!response.ok) throw new Error("payment_reference_lookup_failed");
    const chunk = await response.json();
    const range = /^(?:(\d+)-(\d+)|\*)\/(\d+)$/.exec(response.headers.get("content-range") || "");
    const count = range ? Number(range[3]) : NaN;
    if (!Array.isArray(chunk) || !Number.isSafeInteger(count) || count > 2000 ||
        (expectedCount !== null && count !== expectedCount) ||
        (chunk.length > 0 && (Number(range[1]) !== rows.length || Number(range[2]) - Number(range[1]) + 1 !== chunk.length)) ||
        chunk.length > 100 || rows.length + chunk.length > count || (chunk.length === 0 && rows.length !== count)) {
      throw new Error("payment_reference_snapshot_incomplete");
    }
    expectedCount = count;
    for (const row of chunk) {
      if (!row || !squareStatusSafeId(row.id) || row.record_type !== recordType || row.company_state_id !== config.companyId ||
          row.deleted_at !== null || !row.data || typeof row.data !== "object" || Array.isArray(row.data) ||
          seen.has(row.id) || (rows.length > 0 && rows[rows.length - 1].id >= row.id) ||
          (filterField === "id" && !ids.includes(row.id)) ||
          (filterField === "data->>squareInvoiceId" && !ids.includes(row.data.squareInvoiceId))) {
        throw new Error("payment_reference_snapshot_invalid");
      }
      seen.add(row.id); rows.push(row);
    }
    if (rows.length === count) return rows;
  }
  throw new Error("payment_reference_snapshot_incomplete");
}

async function squareStatusResolveReferences(config, authorization, invoiceIds, signal) {
  const estimates = await squareStatusReadRecords(config, authorization, "estimate", "data->>squareInvoiceId", invoiceIds, signal);
  const references = new Map();
  for (const estimate of estimates) {
    if (!squareStatusSafeId(estimate.lead_id) || !squareStatusSafeId(estimate.job_id) || estimate.data.id !== estimate.id ||
        estimate.data.contactId !== estimate.lead_id || estimate.data.jobId !== estimate.job_id ||
        (estimate.data.squareOrderId && !squareStatusSafeId(estimate.data.squareOrderId))) throw new Error("payment_reference_invalid");
    const invoiceId = estimate.data.squareInvoiceId;
    const previous = references.get(invoiceId);
    const orderId = estimate.data.squareOrderId || "";
    if (previous && (previous.leadId !== estimate.lead_id || previous.jobId !== estimate.job_id ||
        (previous.orderId && orderId && previous.orderId !== orderId))) throw new Error("payment_reference_ambiguous");
    references.set(invoiceId, { leadId: estimate.lead_id, jobId: estimate.job_id, orderId: orderId || previous?.orderId || "" });
  }
  if (references.size !== invoiceIds.length) throw new Error("payment_reference_unavailable");
  const leadIds = [...new Set([...references.values()].map(reference => reference.leadId))];
  const jobIds = [...new Set([...references.values()].map(reference => reference.jobId))];
  const contacts = await squareStatusReadRecords(config, authorization, "contact", "id", leadIds, signal);
  const jobs = await squareStatusReadRecords(config, authorization, "job", "id", jobIds, signal);
  const contactsById = new Map(contacts.map(contact => [contact.id, contact]));
  const jobsById = new Map(jobs.map(job => [job.id, job]));
  for (const reference of references.values()) {
    const contact = contactsById.get(reference.leadId), job = jobsById.get(reference.jobId);
    if (!contact || !job || contact.data.id !== contact.id || contact.lead_id !== contact.id || contact.job_id !== null ||
        job.data.id !== job.id || job.lead_id !== contact.id || job.job_id !== job.id ||
        (job.data.contactId !== undefined && job.data.contactId !== contact.id) ||
        (job.data.leadId !== undefined && job.data.leadId !== contact.id)) throw new Error("payment_reference_invalid");
  }
  return references;
}

async function squareStatusReadInvoice(invoiceId, reference, signal) {
  signal?.throwIfAborted();
  const response = await fetch(`${SQUARE_BASE}/invoices/${encodeURIComponent(invoiceId)}`, {
    method: "GET", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${squareToken()}`, "Square-Version": SQUARE_VERSION, "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error("Square invoice could not be retrieved");
  const result = await response.json();
  if (result.invoice?.id !== invoiceId || (reference.orderId && result.invoice.order_id !== reference.orderId)) {
    throw new Error("Square invoice association could not be confirmed");
  }
  if (["REFUNDED", "PARTIALLY_REFUNDED"].includes(result.invoice.status)) {
    const snapshot = await require(path.join(__dirname, "square-payment-worker.js")).readSnapshot({
      get: squareProviderReader(signal), invoiceId, expectedOrderId: reference.orderId,
      minimumVersion: result.invoice.version,
    });
    return { ...snapshot, leadId: reference.leadId, jobId: reference.jobId };
  }
  const requests = result.invoice.payment_requests;
  if (!Array.isArray(requests) || requests.length > 100 || typeof result.invoice.status !== "string" || !result.invoice.status ||
      !Number.isFinite(Date.parse(result.invoice.updated_at || ""))) throw new Error("Incomplete Square invoice response");
  let paidCents = 0, contractCents = 0;
  for (const request of requests) {
    if (!request || typeof request !== "object") throw new Error("Invalid Square payment request");
    for (const money of [request.total_completed_amount_money, request.computed_amount_money]) {
      if (money !== undefined && (!money || !Number.isSafeInteger(money.amount) || money.amount < 0 ||
          (money.currency !== undefined && money.currency !== "USD"))) throw new Error("Invalid Square money amount");
    }
    paidCents += request.total_completed_amount_money?.amount || 0;
    contractCents += request.computed_amount_money?.amount || 0;
    if (!Number.isSafeInteger(paidCents) || !Number.isSafeInteger(contractCents)) throw new Error("Square money amount exceeds supported precision");
  }
  return { ...squareInvoicePaymentSummary(result.invoice), leadId: reference.leadId, jobId: reference.jobId };
}

async function handleSquarePaymentStatus(req, res, user) {
  const authorization = req.headers.authorization || "";
  if (!user?.id || user.local || !/^Bearer \S+$/.test(authorization)) {
    sendJson(res, 401, { error: "authenticated_cloud_user_required" }); return;
  }
  let invoiceIds;
  try {
    const body = JSON.parse(await readRequestBody(req));
    invoiceIds = body?.invoiceIds;
    if (!body || Array.isArray(body) || !Array.isArray(invoiceIds) || invoiceIds.length < 1 || invoiceIds.length > 20 ||
        !invoiceIds.every(squareStatusSafeId) || new Set(invoiceIds).size !== invoiceIds.length) throw new Error("invalid_invoice_ids");
  } catch {
    sendJson(res, 400, { error: "Provide 1 to 20 unique valid invoice IDs." }); return;
  }
  const config = squareStatusPublicConfig();
  if (!config || !squareToken()) {
    sendJson(res, 503, { error: "Payment lookup is not configured for authenticated shared records." }); return;
  }
  let references;
  // Bound the entire reference/provider phase below the browser's 60s deadline,
  // including four-worker batches and unusually small database page caps.
  const signal = AbortSignal.timeout(40000);
  try {
    // Complete every association check before revealing anything from Square.
    references = await squareStatusResolveReferences(config, authorization, invoiceIds, signal);
  } catch {
    sendJson(res, 409, { error: "Invoice references could not be confirmed against the current shared CRM. Refresh the CRM and retry." }); return;
  }
  const payments = Object.create(null);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, invoiceIds.length) }, async () => {
    while (next < invoiceIds.length) {
      const invoiceId = invoiceIds[next++];
      try { payments[invoiceId] = await squareStatusReadInvoice(invoiceId, references.get(invoiceId), signal); }
      catch { payments[invoiceId] = { invoiceId, error: "Square invoice could not be retrieved or its association could not be confirmed" }; }
    }
  }));
  sendJson(res, 200, { payments });
}

async function handleSquareWebhook(req, res) {
  const key = squareWebhookKey();
  const webhookUrl = process.env.SQUARE_WEBHOOK_URL;
  const config = squareWorkerConfig();
  const merchantId = process.env.SQUARE_MERCHANT_ID || "";
  if (!key || !webhookUrl || !config || !squareStatusSafeId(merchantId)) {
    sendJson(res, 503, { error: "Durable webhook verification/storage is not configured." }); return;
  }
  try {
    const rawBody = await readRequestBody(req);
    const crypto = require("crypto");
    const expected = Buffer.from(crypto.createHmac("sha256", key).update(webhookUrl + rawBody).digest("base64"));
    const received = Buffer.from(String(req.headers["x-square-hmacsha256-signature"] || ""));
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      sendJson(res, 401, { error: "Invalid signature" }); return;
    }
    let event;
    try { event = JSON.parse(rawBody); } catch { sendJson(res, 400, { error: "Invalid webhook JSON" }); return; }
    const environment = process.env.SQUARE_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
    if (event?.merchant_id !== merchantId || (req.headers["square-environment"] && req.headers["square-environment"] !== environment)) {
      sendJson(res, 403, { error: "Webhook merchant or environment mismatch" }); return;
    }
    const events = ["invoice.created", "invoice.published", "invoice.updated", "invoice.payment_made",
      "invoice.scheduled_charge_failed", "invoice.canceled", "invoice.refunded", "invoice.deleted"];
    if (!events.includes(event.type)) {
      sendJson(res, 200, { received: true, ignored: true }); return;
    }
    if (!squareStatusSafeId(event.event_id) || !squareStatusSafeId(event.data?.object?.invoice?.id) ||
        !Number.isFinite(Date.parse(event.created_at || ""))) {
      sendJson(res, 400, { error: "Incomplete invoice webhook" }); return;
    }
    const receipt = await squareWorkerRpc(config, "crm_square_enqueue_webhook", {
      p_company: config.companyId, p_environment: environment, p_event: event,
    });
    if (receipt?.durable !== true || receipt.eventId !== event.event_id) throw new Error("Unconfirmed webhook receipt");
    // This acknowledges durable receipt, not a completed payment reconciliation.
    sendJson(res, 200, { received: true, queued: true });
  } catch {
    sendJson(res, 503, { error: "Webhook storage was not confirmed; retry delivery." });
  }
}

function squareProviderReader(signal = AbortSignal.timeout(60000)) {
  return async (providerPath) => {
    if (!/^\/(invoices|orders|payments)\/[A-Za-z0-9_%:-]+$/.test(providerPath)) throw new Error("Invalid provider read path");
    const response = await fetch(`${SQUARE_BASE}${providerPath}`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
      headers: { Authorization: `Bearer ${squareToken()}`, "Square-Version": SQUARE_VERSION, "Content-Type": "application/json" },
    });
    if (!response.ok) throw new Error("Provider payment read unavailable");
    return response.json();
  };
}

function startSquarePaymentWorker() {
  // Enabled only after all worker migrations and secret settings are verified.
  // No browser/tab is needed; database leases coordinate multiple server instances.
  if (process.env.SQUARE_PAYMENT_WORKER_ENABLED !== "true") return null;
  const config = squareWorkerConfig();
  const merchantId = process.env.SQUARE_MERCHANT_ID || "";
  if (!config || !squareToken() || !squareStatusSafeId(merchantId)) {
    throw new Error("Square payment worker requires its server-only database key, token and merchant ID.");
  }
  const environment = process.env.SQUARE_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
  const scope = { companyId: config.companyId, environment, merchantId };
  const base = { p_company: config.companyId, p_environment: environment, p_merchant: merchantId };
  const workerModule = require(path.join(__dirname, "square-payment-worker.js"));
  const worker = workerModule.create({
    scope,
    store: {
      claim: () => squareWorkerRpc(config, "crm_square_claim_webhook", base),
      apply: (claim, snapshot) => squareWorkerRpc(config, "crm_square_apply_payment", {
        ...base, p_event_id: claim.eventId, p_lease_id: claim.leaseId, p_snapshot: snapshot,
      }),
      fail: (claim, code, retryable) => squareWorkerRpc(config, "crm_square_fail_webhook", {
        ...base, p_event_id: claim.eventId, p_lease_id: claim.leaseId, p_code: code, p_retryable: retryable,
      }),
    },
    read: (claim) => workerModule.readSnapshot({
      get: squareProviderReader(), invoiceId: claim.invoiceId,
      notBefore: claim.invoiceUpdatedAt || undefined, minimumVersion: claim.invoiceVersion ?? undefined,
    }),
    onError: (code) => console.warn(`Square payment processing deferred: ${code}`),
  });
  const run = () => worker.tick().catch(() => console.warn("Square payment worker could not confirm its queue state; retained for retry."));
  const timer = setInterval(run, 5000);
  timer.unref();
  run();
  return () => clearInterval(timer);
}

async function handleSquareSyncStatus(req, res, user) {
  if (!user?.id || user.local || !isApiAdmin(user)) {
    sendJson(res, 403, { error: "A signed-in company administrator is required." }); return;
  }
  const config = squareWorkerConfig();
  const merchantId = process.env.SQUARE_MERCHANT_ID || "";
  if (!config || !squareStatusSafeId(merchantId)) {
    sendJson(res, 503, { error: "Payment synchronization is not configured." }); return;
  }
  try {
    const status = await squareWorkerRpc(config, "crm_square_sync_status", {
      p_company: config.companyId, p_environment: process.env.SQUARE_ENVIRONMENT === "sandbox" ? "sandbox" : "production", p_merchant: merchantId,
    });
    if (!status || ![status.pending, status.review].every(n => Number.isSafeInteger(n) && n >= 0) ||
        [status.lastProcessedAt, status.oldestPendingAt].some(date => date !== null && (typeof date !== "string" || !Number.isFinite(Date.parse(date))))) {
      throw new Error("Invalid synchronization status");
    }
    sendJson(res, 200, { enabled: process.env.SQUARE_PAYMENT_WORKER_ENABLED === "true" && Boolean(squareToken()),
      pending: status.pending, review: status.review, lastProcessedAt: status.lastProcessedAt, oldestPendingAt: status.oldestPendingAt });
  } catch {
    sendJson(res, 503, { error: "Payment synchronization could not be confirmed." });
  }
}

const server = http.createServer((req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(), geolocation=(self)");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
  let url;
  let decodedPath;
  try {
    url = new URL(req.url, "http://localhost");
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    send(res, 400, "Invalid request URL");
    return;
  }
  if (url.pathname === "/api/health" && req.method === "GET") {
    const config = supabaseConfig();
    sendJson(res, 200, {
      ok: true,
      service: "jobcrest-crm",
      release: process.env.RENDER_GIT_COMMIT || "full-audit-repairs-20260921",
      timestamp: new Date().toISOString(),
      authRequired: authenticationRequired(),
      cloudSyncConfigured: Boolean(config.url && config.anonKey && process.env.SUPABASE_SYNC_ENABLED === "true"),
      storageMode: config.url ? "supabase" : "local",
      squareConfigured: Boolean(squareToken() && squareWebhookKey()),
    });
    return;
  }
  if (url.pathname === "/api/square/create-invoice" && req.method === "POST") {
    requireApiAdmin(req, res, handleSquareCreateInvoice);
    return;
  }

  if (url.pathname === "/api/square/payment-status" && req.method === "POST") {
    requireApiUser(req, res, handleSquarePaymentStatus);
    return;
  }

  if (url.pathname === "/api/square/sync-status" && req.method === "GET") {
    requireApiAdmin(req, res, handleSquareSyncStatus);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  if (url.pathname === "/webhooks/square" && req.method === "POST") {
    handleSquareWebhook(req, res);
    return;
  }

  if (url.pathname === "/auth-config.js") {
    send(res, 200, authConfigScript(), "text/javascript; charset=utf-8");
    return;
  }

  if (url.pathname === "/login/") {
    sendRedirect(res, "/login");
    return;
  }

  if (url.pathname === "/logout/") {
    sendRedirect(res, "/logout");
    return;
  }

  const routes = {
    "/": "/index.html",
    "/login": "/login.html",
    "/logout": "/logout.html",
  };

  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method not allowed");
    return;
  }
  const requested = routes[decodedPath] || decodedPath;
  if (!publicAssets.has(requested)) {
    send(res, 404, "Not found");
    return;
  }
  const filePath = path.normalize(path.join(root, requested));
  const relativePath = path.relative(root, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }
    const ext = path.extname(filePath);
    const mimeType = types[ext] || "application/octet-stream";
    // Never cache HTML — always serve fresh so version-bumped assets load immediately
    if (ext === ".html" || ext === "") {
      res.writeHead(200, {
        "Content-Type": mimeType,
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
        "Surrogate-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } else {
      send(res, 200, req.method === "HEAD" ? undefined : content, mimeType);
    }
  });
});

if (require.main === module) {
  if (process.env.CRM_STAGING_ACCESS === "true" && !stagingTestIdentity()) {
    throw new Error("Staging safety checks failed. Use the approved test project, require sign-in, skip environment files, and remove Square credentials.");
  }
  server.listen(port, authenticationRequired() && !stagingTestIdentity() ? "0.0.0.0" : "127.0.0.1", () => {
    console.log(`JobCrest CRM running at http://localhost:${port}`);
  });
  const stopWorker = startSquarePaymentWorker();
  if (stopWorker) server.once("close", stopWorker);
}

module.exports = { isApiAdmin, squareInvoicePaymentSummary };
