/* Server-only coordinator. The store must persist an immutable trusted intent
 * before returning from begin, and acknowledge each checkpoint atomically.
 * No database credentials, transport, or browser-state fallback lives here. */
"use strict";
const { createHash } = require("node:crypto");
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const safeId = value => typeof value === "string" && /^[A-Za-z0-9_:-]{1,200}$/.test(value);
const validEmail = value => typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const cents = value => typeof value === "number" && Number.isFinite(value) && value >= 0 &&
  Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
const isoDate = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const immutable = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
};
class WorkflowError extends Error {
  constructor(code, stage, message) { super(message); this.name = "SquareWorkflowError"; this.code = code; this.stage = stage; }
}
function requireValue(condition, code, stage, message) {
  if (!condition) throw new WorkflowError(code, stage, message);
}
function payloadDetails(payload) {
  const stage = "begin";
  requireValue(payload && typeof payload === "object" && !Array.isArray(payload) &&
    [payload.estimateId, payload.leadId, payload.jobId].every(safeId) &&
    [payload.leadNumber, payload.projectNumber, payload.estimateNumber].every(value => typeof value === "string" && value.trim().length > 0) &&
    validEmail(payload.contactEmail) && typeof payload.contactName === "string" &&
    Array.isArray(payload.lineItems) && payload.lineItems.length > 0 && payload.lineItems.length <= 500 &&
    typeof payload.taxRate === "number" && Number.isFinite(payload.taxRate) && payload.taxRate >= 0 && payload.taxRate <= 100 &&
    cents(payload.deposit) && cents(payload.total) && payload.total > 0 && isoDate(payload.dueDate) &&
    (payload.deposit === 0 || (isoDate(payload.depositDueDate) && payload.depositDueDate <= payload.dueDate)),
  "invalid_intent", stage, "The saved invoice intent is incomplete or invalid.");
  let subtotalCents = 0;
  const lineItems = payload.lineItems.map(item => {
    requireValue(item && typeof item.title === "string" && typeof item.quantity === "number" && Number.isFinite(item.quantity) &&
      item.quantity > 0 && item.quantity <= 1000000 && cents(item.rate) &&
      (item.description === undefined || typeof item.description === "string"),
    "invalid_intent", stage, "The saved invoice contains an invalid line item.");
    const rateCents = Math.round(item.rate * 100);
    subtotalCents += Math.round(item.quantity * rateCents);
    requireValue(Number.isSafeInteger(subtotalCents), "invalid_intent", stage, "Invoice value exceeds supported precision.");
    return { name: (item.title || "Line item").slice(0, 500), quantity: String(item.quantity),
      base_price_money: { amount: rateCents, currency: "USD" }, note: (item.description || "").slice(0, 2000) };
  });
  const totalCents = subtotalCents + Math.round(subtotalCents * payload.taxRate / 100);
  requireValue(Number.isSafeInteger(totalCents) && totalCents > 0 && totalCents === Math.round(payload.total * 100) &&
    Math.round(payload.deposit * 100) <= totalCents,
  "invalid_intent", stage, "The saved invoice total does not match its line items, tax, and deposit.");
  return { lineItems, totalCents };
}
function identity(intent) {
  return { id: intent.id, companyId: intent.companyId, environment: intent.environment, payload: intent.payload };
}
function idempotencyKey(intent, stage) {
  return `j_${createHash("sha256").update(JSON.stringify(["jobcrest-square-intent-v1", intent.companyId,
    intent.environment, intent.id, stage])).digest("base64url")}`;
}
function providerSucceeded(response) {
  return Number.isInteger(response?.status) && response.status >= 200 && response.status < 300 && response.body &&
    typeof response.body === "object" && !Array.isArray(response.body) &&
    (response.body.errors === undefined || (Array.isArray(response.body.errors) && response.body.errors.length === 0));
}
function validatedReceipt(stage, receipt, intent, details) {
  const previous = intent.receipts;
  let valid = receipt && typeof receipt === "object" && !Array.isArray(receipt) && safeId(receipt.id);
  if (stage === "customer") valid &&= typeof receipt.email_address === "string" &&
    receipt.email_address.trim().toLowerCase() === intent.payload.contactEmail.toLowerCase();
  if (stage === "location") valid &&= receipt.status === "ACTIVE" && receipt.currency === "USD";
  if (stage === "order") valid &&= receipt.location_id === previous.location?.id && receipt.customer_id === previous.customer?.id &&
    receipt.total_money?.currency === "USD" && receipt.total_money.amount === details.totalCents;
  if (stage === "invoice" || stage === "published") valid &&= Number.isSafeInteger(receipt.version) && receipt.version >= 0 &&
    receipt.location_id === previous.location?.id && receipt.order_id === previous.order?.id &&
    receipt.primary_recipient?.customer_id === previous.customer?.id && receipt.delivery_method === "EMAIL";
  if (stage === "published") valid &&= receipt.id === previous.invoice?.id && receipt.version >= previous.invoice.version &&
    ["SCHEDULED", "UNPAID", "PARTIALLY_PAID", "PAID", "PAYMENT_PENDING"].includes(receipt.status) &&
    typeof receipt.updated_at === "string" && Number.isFinite(Date.parse(receipt.updated_at)) &&
    (receipt.invoice_number === undefined || typeof receipt.invoice_number === "string");
  requireValue(valid, "invalid_receipt", stage, `The ${stage} receipt could not be verified. No further provider action was taken.`);
  return immutable(clone(receipt));
}
function validateIntent(raw, estimateId) {
  requireValue(raw && safeId(raw.id) && safeId(raw.companyId) && ["production", "sandbox"].includes(raw.environment) &&
    ["pending", "complete"].includes(raw.status) && raw.receipts && typeof raw.receipts === "object" && !Array.isArray(raw.receipts),
  "invalid_intent", "begin", "The invoice store did not return a valid saved intent.");
  const intent = immutable(clone(raw));
  const details = payloadDetails(intent.payload);
  requireValue(intent.payload.estimateId === estimateId, "invalid_intent", "begin", "The saved intent belongs to another estimate.");
  const stages = ["customer", "location", "order", "invoice", "published"];
  requireValue(Object.keys(intent.receipts).every(stage => stages.includes(stage)), "invalid_intent", "begin", "The invoice intent has an unknown receipt stage.");
  for (const stage of stages) {
    if (!intent.receipts[stage]) continue;
    const required = stage === "order" ? ["customer", "location"] : stage === "invoice" ? ["customer", "location", "order"]
      : stage === "published" ? ["customer", "location", "order", "invoice"] : [];
    requireValue(required.every(key => intent.receipts[key]), "invalid_intent", "begin", "The saved invoice intent has incomplete earlier checkpoints.");
    validatedReceipt(stage, intent.receipts[stage], intent, details);
  }
  return { intent, details };
}
function publishedResult(intent) {
  const receipt = intent.receipts.published;
  requireValue(Boolean(receipt), "invalid_intent", "complete", "A confirmed published invoice is required before completion.");
  let invoiceUrl = "";
  if (receipt.public_url) {
    let url;
    try { url = new URL(receipt.public_url); } catch { /* rejected below */ }
    requireValue(url?.protocol === "https:" && !url.username && !url.password, "invalid_receipt", "published", "Invalid Square payment URL.");
    invoiceUrl = receipt.public_url;
  }
  return { intentId: intent.id, estimateId: intent.payload.estimateId, leadId: intent.payload.leadId, jobId: intent.payload.jobId,
    squareInvoiceId: receipt.id, squareOrderId: intent.receipts.order.id, squareInvoiceNumber: receipt.invoice_number || "",
    squareInvoiceUrl: invoiceUrl, squareDeliveryMethod: "EMAIL", squarePublishedAt: receipt.updated_at,
    status: receipt.status, contractValue: intent.payload.total };
}
function confirmedResult(result, expected) {
  return result && typeof result === "object" && !Array.isArray(result) &&
    Object.keys(expected).every(key => key === "intentId" && result[key] === undefined ? true : same(result[key], expected[key])) &&
    (result.durable === undefined || result.durable === true);
}

function create({ store, request }) {
  requireValue(store && ["begin", "checkpoint", "complete"].every(method => typeof store[method] === "function") && typeof request === "function",
    "invalid_adapter", "begin", "Invoice store and provider adapters are required.");
  return {
    async send(estimateId, expectedVersion) {
      requireValue(safeId(estimateId) && Number.isSafeInteger(expectedVersion) && expectedVersion > 0,
        "invalid_request", "begin", "A saved estimate ID and positive version are required.");
      let begun;
      try { begun = await store.begin(estimateId, expectedVersion); }
      catch (cause) {
        const error = new WorkflowError("store_unconfirmed", "begin", "The invoice intent could not be saved. No provider action was taken.");
        const safeCodes = ["legacy_invoice_review_required", "estimate_changed_before_invoice", "won_estimate_required",
          "invoice_already_linked", "saved_customer_email_and_numbers_required", "company_admin_required", "server_worker_required"];
        if (safeCodes.includes(cause?.code)) error.storeCode = cause.code;
        throw error;
      }
      let { intent, details } = validateIntent(begun, estimateId);
      const originalIdentity = identity(intent);
      if (intent.status === "complete") {
        requireValue(confirmedResult(intent.result, publishedResult(intent)), "store_unconfirmed", "complete", "The completed invoice receipt is inconsistent.");
        return immutable(clone(intent.result));
      }
      async function provider(stage, method, path, body) {
        let response;
        try { response = await request(method, path, body === null ? null : clone(body)); }
        catch { throw new WorkflowError("provider_unconfirmed", stage, `Square ${stage} could not be confirmed. Resume the same saved intent to recover.`); }
        requireValue(providerSucceeded(response), "provider_unconfirmed", stage, `Square ${stage} could not be confirmed. Resume the same saved intent to recover.`);
        return response.body;
      }
      async function checkpoint(stage, receipt) {
        const confirmed = validatedReceipt(stage, receipt, intent, details);
        let acknowledgement;
        try { acknowledgement = await store.checkpoint(intent, stage, confirmed); }
        catch { throw new WorkflowError("store_unconfirmed", stage, `The ${stage} checkpoint could not be confirmed. No next provider action was taken.`); }
        requireValue(acknowledgement && same(identity(acknowledgement), originalIdentity) && acknowledgement.status === "pending" &&
          same(acknowledgement.receipts, { ...intent.receipts, [stage]: confirmed }),
        "store_unconfirmed", stage, `The ${stage} checkpoint acknowledgement is incomplete or inconsistent.`);
        intent = validateIntent(acknowledgement, estimateId).intent;
      }
      const payload = intent.payload;
      if (!intent.receipts.customer) {
        const search = await provider("customer", "POST", "/customers/search", { query: { filter: { email_address: { exact: payload.contactEmail } } } });
        requireValue((search.customers === undefined || Array.isArray(search.customers)) && !search.cursor,
          "provider_unconfirmed", "customer", "Square customer search was incomplete; no customer was selected.");
        const customers = search.customers || [];
        for (const customer of customers) validatedReceipt("customer", customer, intent, details);
        requireValue(new Set(customers.map(customer => customer.id)).size <= 1, "ambiguous_customer", "customer", "More than one Square customer matches this email.");
        let customer = customers[0];
        if (!customer) {
          const name = payload.contactName.trim().split(/\s+/);
          const created = await provider("customer", "POST", "/customers", { idempotency_key: idempotencyKey(intent, "customer"),
            given_name: name[0] || "", family_name: name.slice(1).join(" "), email_address: payload.contactEmail, reference_id: payload.leadNumber });
          customer = created.customer;
        }
        await checkpoint("customer", customer);
      }
      if (!intent.receipts.location) {
        const locations = await provider("location", "GET", "/locations", null);
        requireValue(Array.isArray(locations.locations) && !locations.cursor, "provider_unconfirmed", "location", "Square locations could not be fully confirmed.");
        const eligible = locations.locations.filter(location => safeId(location?.id) && location.status === "ACTIVE" && location.currency === "USD")
          .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        requireValue(eligible.length > 0, "invalid_location", "location", "An active USD Square location is required.");
        await checkpoint("location", eligible[0]);
      }
      if (!intent.receipts.order) {
        const created = await provider("order", "POST", "/orders", { idempotency_key: idempotencyKey(intent, "order"), order: {
          location_id: intent.receipts.location.id, customer_id: intent.receipts.customer.id,
          reference_id: `${payload.projectNumber}|${payload.estimateNumber}`.slice(0, 40), line_items: details.lineItems,
          ...(payload.taxRate > 0 ? { taxes: [{ name: `Tax (${payload.taxRate}%)`, percentage: String(payload.taxRate), scope: "ORDER" }] } : {}),
        } });
        await checkpoint("order", created.order);
      }
      if (!intent.receipts.invoice) {
        const paymentRequests = payload.deposit > 0 ? [{ request_type: "DEPOSIT", due_date: payload.depositDueDate,
          fixed_amount_requested_money: { amount: Math.round(payload.deposit * 100), currency: "USD" } }] : [];
        paymentRequests.push({ request_type: "BALANCE", due_date: payload.dueDate });
        const created = await provider("invoice", "POST", "/invoices", { idempotency_key: idempotencyKey(intent, "invoice"), invoice: {
          location_id: intent.receipts.location.id, order_id: intent.receipts.order.id,
          primary_recipient: { customer_id: intent.receipts.customer.id }, payment_requests: paymentRequests, delivery_method: "EMAIL",
          accepted_payment_methods: { card: true, square_gift_card: false, bank_account: true, buy_now_pay_later: false },
          title: `${payload.projectNumber} | ${payload.estimateNumber} — ${payload.contactName}`,
          description: [`Lead: ${payload.leadNumber}`, `Project: ${payload.projectNumber}`, `Job: ${payload.projectTitle || "Untitled project"}`,
            `Address: ${payload.jobAddress || "No address"}`].join("\n"),
        } });
        await checkpoint("invoice", created.invoice);
      }
      if (!intent.receipts.published) {
        const published = await provider("published", "POST", `/invoices/${encodeURIComponent(intent.receipts.invoice.id)}/publish`, {
          idempotency_key: idempotencyKey(intent, "publish"), version: intent.receipts.invoice.version,
        });
        await checkpoint("published", published.invoice);
      }
      const result = publishedResult(intent);
      let completed;
      try { completed = await store.complete(intent, immutable(clone(result))); }
      catch { throw new WorkflowError("store_unconfirmed", "complete", "Square publication is confirmed, but shared CRM completion is not. Resume the same intent; do not create another invoice."); }
      requireValue(completed && same(identity(completed), originalIdentity) && completed.status === "complete" &&
        same(completed.receipts, intent.receipts) && confirmedResult(completed.result, result),
      "store_unconfirmed", "complete", "Shared invoice completion was not fully acknowledged. Resume the same intent.");
      return immutable(clone(completed.result));
    },
  };
}
module.exports = { create, idempotencyKey, WorkflowError };
