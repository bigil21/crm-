"use strict";

// Server-only. Webhooks are wake-ups, never financial authority: retrieve the
// current provider snapshot, then commit it and its receipt in one transaction.
const safeId = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(value);
const validTime = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const statuses = new Set(["DRAFT", "UNPAID", "SCHEDULED", "PARTIALLY_PAID", "PAID", "CANCELED", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED", "PAYMENT_PENDING"]);
function failure(code, retryable = false) {
  return Object.assign(new Error(code), { code, retryable });
}
function money(value, optional = false) {
  if (optional && value === undefined) return 0;
  if (!value || value.currency !== "USD" || !Number.isSafeInteger(value.amount) || value.amount < 0) throw failure("payment_snapshot_invalid");
  return value.amount;
}
function sum(values) {
  return values.reduce((total, value) => {
    const next = total + value;
    if (!Number.isSafeInteger(next)) throw failure("payment_snapshot_invalid");
    return next;
  }, 0);
}
function summarize(invoice, invoiceId, expectedOrderId) {
  if (!invoice || invoice.id !== invoiceId || !safeId(invoice.order_id) || !safeId(invoice.location_id) ||
      (expectedOrderId && invoice.order_id !== expectedOrderId) || !Number.isSafeInteger(invoice.version) || invoice.version < 0 ||
      !validTime(invoice.updated_at) || !statuses.has(invoice.status) || !Array.isArray(invoice.payment_requests) ||
      invoice.payment_requests.length < 1 || invoice.payment_requests.length > 100) throw failure("payment_snapshot_invalid");
  const requests = invoice.payment_requests.map(request => {
    if (!request || typeof request !== "object" || !["BALANCE", "DEPOSIT", "INSTALLMENT"].includes(request.request_type)) throw failure("payment_snapshot_invalid");
    return {
      type: request.request_type, requestedAmount: money(request.computed_amount_money) / 100,
      paidAmount: money(request.total_completed_amount_money, true) / 100,
      dueDate: request.due_date || "",
    };
  });
  const grossCents = sum(invoice.payment_requests.map(request => money(request.total_completed_amount_money, true)));
  const contractCents = sum(invoice.payment_requests.map(request => money(request.computed_amount_money)));
  if (!contractCents || grossCents > contractCents) throw failure("payment_snapshot_invalid");
  return { invoiceId, orderId: invoice.order_id, locationId: invoice.location_id, version: invoice.version,
    updatedAt: invoice.updated_at, status: invoice.status, contractCents, grossCents, paymentRequests: requests };
}

async function readSnapshot({ get, invoiceId, expectedOrderId, notBefore, minimumVersion }) {
  if (typeof get !== "function" || !safeId(invoiceId) || (expectedOrderId && !safeId(expectedOrderId))) throw failure("payment_snapshot_invalid");
  const retrieve = async (providerPath) => {
    try { return await get(providerPath); }
    catch { throw failure("payment_provider_unavailable", true); }
  };
  const path = `/invoices/${encodeURIComponent(invoiceId)}`;
  const first = summarize((await retrieve(path))?.invoice, invoiceId, expectedOrderId);
  if (minimumVersion !== undefined && (!Number.isSafeInteger(minimumVersion) || minimumVersion < 0 || first.version < minimumVersion)) {
    throw failure("payment_provider_not_current", true);
  }
  if (notBefore && (!validTime(notBefore) || Date.parse(first.updatedAt) < Date.parse(notBefore))) {
    throw failure("payment_provider_not_current", true);
  }
  let refundedCents = 0;
  if (["REFUNDED", "PARTIALLY_REFUNDED"].includes(first.status)) {
    // Square leaves invoice total_completed_amount_money unchanged after refunds.
    // Its invoice guide specifies retrieving the order's tenders and each payment's
    // refunded_money. Never subtract from an already-netted payment amount.
    const order = (await retrieve(`/orders/${encodeURIComponent(first.orderId)}`))?.order;
    if (!order || order.id !== first.orderId || order.location_id !== first.locationId ||
        !Array.isArray(order.tenders) || order.tenders.length < 1 || order.tenders.length > 100) throw failure("payment_refund_unconfirmed", true);
    const seen = new Set();
    let paymentTotalCents = 0;
    for (const tender of order.tenders) {
      const id = tender?.payment_id || tender?.id;
      if (!safeId(id) || seen.has(id) || (tender.payment_id && tender.id && tender.payment_id !== tender.id)) throw failure("payment_snapshot_invalid");
      seen.add(id);
      const payment = (await retrieve(`/payments/${encodeURIComponent(id)}`))?.payment;
      if (!payment || payment.id !== id || payment.order_id !== first.orderId || payment.location_id !== first.locationId ||
          payment.status !== "COMPLETED") throw failure("payment_refund_unconfirmed", true);
      const total = money(payment.total_money);
      const refunded = money(payment.refunded_money, true);
      // Tip allocation isn't known from invoice requests. Preserve last known
      // balances for review rather than subtracting a tip refund from principal.
      if (money(payment.tip_money, true) !== 0 || refunded > total) throw failure("payment_snapshot_invalid");
      paymentTotalCents = sum([paymentTotalCents, total]);
      refundedCents = sum([refundedCents, refunded]);
    }
    if (paymentTotalCents !== first.grossCents || refundedCents <= 0 || refundedCents > first.grossCents ||
        (first.status === "REFUNDED" && refundedCents !== first.grossCents) ||
        (first.status === "PARTIALLY_REFUNDED" && refundedCents === first.grossCents)) throw failure("payment_refund_unconfirmed", true);
  }
  // A refund/payment may have landed while we were reading. Never combine two
  // provider versions; the durable inbox will retry with a fresh coherent view.
  const last = summarize((await retrieve(path))?.invoice, invoiceId, expectedOrderId);
  if (JSON.stringify(first) !== JSON.stringify(last)) throw failure("payment_provider_changed", true);
  const paidAmount = (first.grossCents - refundedCents) / 100;
  return { invoiceId, orderId: first.orderId, version: first.version, updatedAt: first.updatedAt,
    status: first.status, contractAmount: first.contractCents / 100, paidAmount,
    paymentPercent: (first.grossCents - refundedCents) / first.contractCents * 100,
    paymentRequests: first.paymentRequests };
}

function create({ store, read, scope, onError = () => {} }) {
  if (!store || !["claim", "apply", "fail"].every(name => typeof store[name] === "function") || typeof read !== "function" ||
      !safeId(scope?.companyId) || !safeId(scope?.merchantId) || !["production", "sandbox"].includes(scope?.environment)) throw new TypeError("A durable payment store and scope are required");
  const fixedScope = Object.freeze({ ...scope });
  let running = false;
  return {
    async tick() {
      if (running) return { busy: true };
      running = true;
      let claim;
      try {
        claim = await store.claim(fixedScope);
        if (claim === null) return { idle: true };
        if (!claim || claim.companyId !== fixedScope.companyId || claim.environment !== fixedScope.environment ||
            claim.merchantId !== fixedScope.merchantId || !safeId(claim.eventId) || !safeId(claim.invoiceId) ||
            typeof claim.leaseId !== "string" || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(claim.leaseId) ||
            !Number.isInteger(claim.attempts) || claim.attempts < 1 || claim.attempts > 10 || !validTime(claim.eventCreatedAt)) {
          claim = null;
          throw failure("payment_claim_unconfirmed");
        }
        claim = Object.freeze({ ...claim });
        const snapshot = await read(claim);
        if (snapshot?.invoiceId !== claim.invoiceId) throw failure("payment_snapshot_invalid");
        const receipt = await store.apply(claim, snapshot);
        if (receipt?.durable !== true || receipt.eventId !== claim.eventId || typeof receipt.applied !== "boolean") throw failure("payment_commit_unconfirmed", true);
        return { eventId: claim.eventId, status: "complete" };
      } catch (error) {
        // Only allowlisted machine codes enter the persistent error field/log.
        const known = new Set(["payment_mapping_unavailable", "payment_mapping_ambiguous", "payment_history_ambiguous", "payment_snapshot_invalid", "payment_version_conflict",
          "payment_lease_lost", "payment_contract_missing", "manual_payment_invalid", "payment_refund_unconfirmed", "payment_provider_changed",
          "payment_provider_not_current", "payment_provider_unavailable", "payment_commit_unconfirmed"]);
        const code = known.has(error?.code) ? error.code : "payment_processing_unavailable";
        const retryable = error?.retryable === true || ["payment_mapping_unavailable", "payment_lease_lost", "payment_commit_unconfirmed", "payment_processing_unavailable"].includes(code);
        try { onError(code); } catch { /* Logging must not interrupt durable failure recording. */ }
        if (!claim) throw failure(code, retryable);
        let receipt;
        try { receipt = await store.fail(claim, code, retryable); }
        catch { throw failure("payment_failure_receipt_unconfirmed", true); }
        if (receipt?.durable !== true || receipt.eventId !== claim.eventId || !["pending", "review"].includes(receipt.status)) throw failure("payment_failure_receipt_unconfirmed", true);
        return { eventId: claim.eventId, status: receipt.status };
      } finally { running = false; }
    },
  };
}

module.exports = { create, readSnapshot };
