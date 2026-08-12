const fs = require("fs");
const http = require("http");
const path = require("path");

const root = __dirname;
const envPaths = [path.join(root, ".env"), path.join(root, ".env.local")];

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
  const authConfig = supabaseConfig();
  const config = {
    supabaseUrl: authConfig.url,
    supabaseAnonKey: authConfig.anonKey,
    allowedEmailDomain,
    adminEmails: process.env.ADMIN_EMAILS || process.env.OWNER_EMAIL || process.env.ADMIN_EMAIL || "",
    defaultRole: process.env.DEFAULT_AUTH_ROLE || "viewer",
    authRequired: process.env.AUTH_REQUIRED === "true",
    syncEnabled: process.env.SUPABASE_SYNC_ENABLED === "true",
    stateId: process.env.SUPABASE_STATE_ID || "coastal-crest",
  };
  return `window.ROOFLINE_SUPABASE_CONFIG = ${JSON.stringify(config)};`;
}

const SQUARE_BASE = "https://connect.squareup.com/v2";
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
  if (process.env.AUTH_REQUIRED !== "true") {
    return { email: `local@${allowedEmailDomain}`, app_metadata: { role: "admin" }, local: true };
  }
  const config = supabaseConfig();
  const authorization = req.headers.authorization || "";
  if (!config.url || !config.anonKey || !authorization.startsWith("Bearer ")) return null;
  const response = await fetch(`${config.url.replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: config.anonKey, Authorization: authorization },
  });
  if (!response.ok) return null;
  const user = await response.json();
  return String(user.email || "").toLowerCase().endsWith(`@${allowedEmailDomain.toLowerCase()}`) ? user : null;
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
    if (payload) req.write(payload);
    req.end();
  });
}

async function handleSquareCreateInvoice(req, res) {
  try {
      if (!squareToken()) {
        send(res, 503, JSON.stringify({ error: "SQUARE_ACCESS_TOKEN not configured" }), "application/json");
        return;
      }
      const body = JSON.parse(await readRequestBody(req));
      const {
        estimateId, leadId, leadNumber, jobId, projectNumber, projectTitle, jobAddress,
        contactName, contactEmail, lineItems, taxRate, deposit, dueDate, estimateNumber,
      } = body;
      if (!estimateId || !leadId || !leadNumber || !jobId || !projectNumber || !estimateNumber || !contactEmail) {
        sendJson(res, 400, { error: "Lead, project, estimate, and customer email are required" });
        return;
      }

      // 1. Get or create customer in Square
      const searchRes = contactEmail
        ? await squareRequest("POST", "/customers/search", {
            query: { filter: { email_address: { exact: contactEmail } } },
          })
        : { body: {} };
      let customerId = searchRes.body?.customers?.[0]?.id;
      if (!customerId && contactEmail) {
        const createRes = await squareRequest("POST", "/customers", {
          given_name: contactName?.split(" ")[0] || contactName,
          family_name: contactName?.split(" ").slice(1).join(" ") || "",
          email_address: contactEmail,
          reference_id: leadNumber,
        });
        customerId = createRes.body?.customer?.id;
      }

      // 2. Get locations to pick primary
      const locRes = await squareRequest("GET", "/locations", null);
      const locationId = locRes.body?.locations?.[0]?.id;
      if (!locationId) {
        send(res, 503, JSON.stringify({ error: "No Square location found" }), "application/json");
        return;
      }

      // 3. Create the invoice
      const idempotencyKey = `crm-${estimateId}`.slice(0, 45);
      const squareReference = `${projectNumber}|${estimateNumber}`.slice(0, 40);
      // 3. Create an order with the line items first
      const orderRes = await squareRequest("POST", "/orders", {
        idempotency_key: `${idempotencyKey}-order`,
        order: {
          location_id: locationId,
          ...(customerId ? { customer_id: customerId } : {}),
          reference_id: squareReference,
          line_items: lineItems.map((item) => ({
            name: item.title || "Line item",
            quantity: String(Math.max(Number(item.quantity) || 1, 1)),
            base_price_money: {
              amount: Math.round((Number(item.rate) || 0) * 100),
              currency: "USD",
            },
            note: item.description || "",
          })),
          ...(taxRate > 0 ? {
            taxes: [{
              name: `Tax (${taxRate}%)`,
              percentage: String(taxRate),
              scope: "ORDER",
            }],
          } : {}),
        },
      });

      const orderId = orderRes.body?.order?.id;
      if (!orderId) {
        send(res, 500, JSON.stringify({ error: "Square order creation failed", detail: orderRes.body }), "application/json");
        return;
      }

      // 4. Build payment requests — deposit first if provided, then balance
      const scheduledDate = new Date();
      scheduledDate.setDate(scheduledDate.getDate() + 1); // tomorrow at earliest
      const scheduledStr = scheduledDate.toISOString().slice(0, 10);

      const dueStr = dueDate && new Date(dueDate) > scheduledDate
        ? dueDate
        : new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

      const paymentRequests = [];
      if (deposit > 0) {
        paymentRequests.push({
          request_type: "DEPOSIT",
          due_date: scheduledStr,
          fixed_amount_requested_money: {
            amount: Math.round(Number(deposit) * 100),
            currency: "USD",
          },
        });
      }
      paymentRequests.push({
        request_type: "BALANCE",
        due_date: dueStr,
      });

      // 5. Create the invoice referencing the order
      const invoiceBody = {
        idempotency_key: idempotencyKey,
        invoice: {
          location_id: locationId,
          order_id: orderId,
          ...(customerId ? { primary_recipient: { customer_id: customerId } } : {}),
          payment_requests: paymentRequests,
          delivery_method: customerId ? "EMAIL" : "SHARE_MANUALLY",
          accepted_payment_methods: {
            card: true,
            square_gift_card: false,
            bank_account: true,
            buy_now_pay_later: false,
          },
          title: `${projectNumber} | ${estimateNumber} — ${contactName}`,
          description: [
            `Lead: ${leadNumber}`,
            `Project: ${projectNumber}`,
            `Job: ${projectTitle || "Untitled project"}`,
            `Address: ${jobAddress || "No address"}`,
          ].join("\n"),
        },
      };

      const invRes = await squareRequest("POST", "/invoices", invoiceBody);
      if (invRes.status !== 200 || !invRes.body?.invoice?.id) {
        send(res, 500, JSON.stringify({ error: "Square invoice creation failed", detail: invRes.body }), "application/json");
        return;
      }

      const squareInvoiceId = invRes.body.invoice.id;

      // 4. Publish invoice so it's sent to customer
      const pubRes = await squareRequest("POST", `/invoices/${squareInvoiceId}/publish`, {
        idempotency_key: `${idempotencyKey}-pub`,
        version: invRes.body.invoice.version,
      });

      const publishedInvoice = pubRes.body?.invoice;
      if (pubRes.status !== 200 || !publishedInvoice?.id) {
        send(res, 502, JSON.stringify({
          error: "Square created the invoice but could not publish it",
          squareInvoiceId,
          detail: pubRes.body,
        }), "application/json");
        return;
      }

      send(res, 200, JSON.stringify({
        squareInvoiceId,
        squareOrderId: orderId,
        squareInvoiceNumber: publishedInvoice.invoice_number || "",
        squareInvoiceUrl: publishedInvoice.public_url || "",
        squareDeliveryMethod: publishedInvoice.delivery_method || "EMAIL",
        squarePublishedAt: publishedInvoice.updated_at || new Date().toISOString(),
        status: publishedInvoice.status || "DRAFT",
      }), "application/json");

    } catch (err) {
      send(res, 500, JSON.stringify({ error: err.message }), "application/json");
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

async function handleSquarePaymentStatus(req, res) {
  if (!squareToken()) {
    sendJson(res, 503, { error: "SQUARE_ACCESS_TOKEN not configured" });
    return;
  }
  const body = JSON.parse(await readRequestBody(req));
  const invoiceIds = [...new Set((body.invoiceIds || []).filter(Boolean))].slice(0, 100);
  const payments = {};
  for (const invoiceId of invoiceIds) {
    const result = await squareRequest("GET", `/invoices/${encodeURIComponent(invoiceId)}`, null);
    payments[invoiceId] =
      result.status === 200 && result.body?.invoice
        ? squareInvoicePaymentSummary(result.body.invoice)
        : { invoiceId, error: "Square invoice could not be retrieved" };
  }
  sendJson(res, 200, { payments });
}

async function handleSquareWebhook(req, res) {
  try {
      const rawBody = await readRequestBody(req);
      const event = JSON.parse(rawBody);

      // Verify signature if key is configured
      const sigKey = squareWebhookKey();
      if (sigKey) {
        const crypto = require("crypto");
        const sigHeader = req.headers["x-square-hmacsha256-signature"] || "";
        const webhookUrl = `https://${req.headers.host}/webhooks/square`;
        const expected = crypto.createHmac("sha256", sigKey).update(webhookUrl + rawBody).digest("base64");
        if (sigHeader !== expected) {
          send(res, 401, "Invalid signature");
          return;
        }
      }

      // Handle payment completion events
      const type = event.type || "";
      const paidEvents = ["invoice.payment_made", "invoice.paid", "invoice.updated"];
      if (paidEvents.includes(type)) {
        const invoice = event.data?.object?.invoice;
        const invoiceId = invoice?.id || "";
        if (invoiceId) {
          const paidFile = path.join(__dirname, "square-payments.json");
          let existing = {};
          try { existing = JSON.parse(fs.readFileSync(paidFile, "utf8")); } catch {}
          existing[invoiceId] = { ...squareInvoicePaymentSummary(invoice), event: type };
          fs.writeFileSync(paidFile, JSON.stringify(existing));
        }
      }

      send(res, 200, JSON.stringify({ received: true }), "application/json");
    } catch (err) {
      send(res, 500, JSON.stringify({ error: err.message }), "application/json");
    }
}

async function handleSquarePollPayments(req, res) {
  try {
    const paidFile = path.join(__dirname, "square-payments.json");
    let data = {};
    try { data = JSON.parse(fs.readFileSync(paidFile, "utf8")); } catch {}
    send(res, 200, JSON.stringify(data), "application/json");
  } catch (err) {
    send(res, 500, JSON.stringify({ error: err.message }), "application/json");
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/health" && req.method === "GET") {
    const config = supabaseConfig();
    sendJson(res, 200, {
      ok: true,
      service: "jobcrest-crm",
      timestamp: new Date().toISOString(),
      authRequired: process.env.AUTH_REQUIRED === "true",
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

  // If hitting root without a version param, redirect to force fresh load
  if (url.pathname === "/" && !url.searchParams.has("v")) {
    res.writeHead(302, {
      Location: "/?v=90",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
    });
    res.end();
    return;
  }
  const requested = routes[url.pathname] || decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(root, requested));
  const relativePath = path.relative(root, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (!path.extname(requested)) {
        fs.readFile(path.join(root, "index.html"), (indexError, indexContent) => {
          if (indexError) {
            send(res, 404, "Not found");
            return;
          }
          send(res, 200, indexContent, types[".html"]);
        });
        return;
      }
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
      res.end(content);
    } else {
      send(res, 200, content, mimeType);
    }
  });
});

if (require.main === module) {
  server.listen(port, () => {
    console.log(`JobCrest CRM running at http://localhost:${port}`);
  });
}

module.exports = { isApiAdmin, squareInvoicePaymentSummary };
