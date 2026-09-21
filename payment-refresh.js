/* Read-only Square refresh planning. Apply returned patches synchronously, then
 * schedule the normal conflict-safe save; a refresh is never a save receipt. */
(function (root) {
  "use strict";
  const BATCH_SIZE = 20;
  const STALE_MESSAGE = "Payment updates are delayed. Last known balances are displayed; your edits have been kept.";
  const clone = value => JSON.parse(JSON.stringify(value));
  const canonical = value => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  const fingerprint = value => JSON.stringify(canonical(value));
  function freeze(value) {
    if (value && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
    return value;
  }
  const identifier = value => typeof value === "string" && value.length > 0 && value.trim() === value;
  const cents = value => typeof value === "number" && Number.isFinite(value) && value >= 0 &&
    Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
  const time = value => typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value));
  const association = estimate => [estimate.id, estimate.contactId, estimate.jobId, estimate.squareInvoiceId];
  function groupBy(values, getKey) {
    const groups = new Map();
    for (const value of values) {
      const key = getKey(value);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(value);
    }
    return groups;
  }

  // Snapshot before the first await. Full fingerprints intentionally defer an
  // edited estimate instead of merging a provider reply into unfinished input.
  function capture(estimates, { contractValue = estimate => estimate.contractValue } = {}) {
    const entries = estimates.filter(estimate => estimate.squareInvoiceId).map(estimate => {
      const data = clone(estimate);
      return { data, fingerprint: fingerprint(data), contractValue: contractValue(data) };
    });
    return freeze({ entries, invoiceIds: [...new Set(entries.map(entry => entry.data.squareInvoiceId))] });
  }

  async function requestWithDeadline(requestBatch, ids, timeoutMs, signal) {
    const controller = new AbortController();
    let timer, rejectPending;
    const cancel = () => {
      controller.abort();
      rejectPending(new Error("Payment refresh interrupted."));
    };
    try {
      const interrupted = new Promise((_resolve, reject) => {
        rejectPending = reject;
        timer = setTimeout(cancel, timeoutMs);
        if (signal?.aborted) cancel();
        else signal?.addEventListener("abort", cancel, { once: true });
      });
      // The callback receives detached IDs and a signal. Promise.race also
      // releases the caller when an adapter fails to honor cancellation.
      return await Promise.race([
        interrupted,
        Promise.resolve().then(() => {
          if (controller.signal.aborted) throw new Error("Payment refresh interrupted.");
          return requestBatch([...ids], { signal: controller.signal });
        }),
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }

  // One batch in flight at a time, at most 20 unique IDs per request. The server
  // can bound individual provider lookups separately. A failed batch does not
  // erase successful batches or manufacture zero balances for missing replies.
  async function collect(snapshot, requestBatch, { timeoutMs = 60000, signal } = {}) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError("A positive refresh timeout is required.");
    const payments = Object.create(null);
    const failures = [];
    for (let offset = 0; offset < snapshot.invoiceIds.length; offset += BATCH_SIZE) {
      const ids = snapshot.invoiceIds.slice(offset, offset + BATCH_SIZE);
      try {
        if (signal?.aborted) throw new Error("Payment refresh interrupted.");
        const reply = await requestWithDeadline(requestBatch, ids, timeoutMs, signal);
        if (!reply || reply.error || !reply.payments || typeof reply.payments !== "object" || Array.isArray(reply.payments)) {
          throw new Error("Incomplete payment refresh.");
        }
        for (const invoiceId of ids) {
          if (!Object.hasOwn(reply.payments, invoiceId) || !reply.payments[invoiceId] || reply.payments[invoiceId].error) {
            failures.push({ invoiceId, reason: "unavailable" });
          } else payments[invoiceId] = clone(reply.payments[invoiceId]);
        }
      } catch (_error) {
        failures.push(...ids.map(invoiceId => ({ invoiceId, reason: "unavailable" })));
      }
    }
    return freeze({ payments, failures });
  }

  function validRecord(record, invoiceId, entries) {
    if (!record || record.error || record.invoiceId !== invoiceId || !cents(record.paidAmount) ||
        (record.contractAmount !== undefined && !cents(record.contractAmount)) ||
        typeof record.status !== "string" || !record.status.trim() || record.status.length > 80 ||
        (record.updatedAt !== undefined && !time(record.updatedAt))) return false;
    if (record.paymentRequests !== undefined && (!Array.isArray(record.paymentRequests) || record.paymentRequests.some(request =>
      !request || typeof request !== "object" || !cents(request.paidAmount) || !cents(request.requestedAmount)))) return false;
    return entries.every(({ data }) =>
      (record.leadId === undefined || record.leadId === data.contactId) &&
      (record.jobId === undefined || record.jobId === data.jobId) &&
      (record.estimateId === undefined || record.estimateId === data.id));
  }

  // This returns payment fields ONLY, never complete estimate replacements.
  // isJobCurrent must check the selected lead/job still exists. The caller must
  // re-check its session/write gate and apply without any intervening await.
  function reconcile(snapshot, collected, currentEstimates, { isJobCurrent = () => true } = {}) {
    const patches = [];
    const failures = [...collected.failures];
    const touched = new Map();
    const capturedInvoices = groupBy(snapshot.entries, entry => entry.data.squareInvoiceId);
    const currentInvoices = groupBy(currentEstimates, estimate => estimate.squareInvoiceId);
    const capturedIds = groupBy(snapshot.entries, entry => entry.data.id);
    const currentIds = groupBy(currentEstimates, estimate => estimate.id);
    for (const invoiceId of snapshot.invoiceIds) {
      const entries = capturedInvoices.get(invoiceId) || [];
      const current = currentInvoices.get(invoiceId) || [];
      const reject = reason => failures.push({ invoiceId, reason });
      const record = collected.payments[invoiceId];
      if (!record) continue;
      const first = entries[0]?.data;
      const uniqueIds = new Set(entries.map(entry => entry.data.id));
      // A reused invoice cannot move money to an unrelated job. Adding/removing
      // an association mid-request also requires a fresh snapshot next time.
      if (!first || uniqueIds.size !== entries.length || entries.some(({ data, contractValue }) =>
        !association(data).every(identifier) || !cents(contractValue) ||
        capturedIds.get(data.id)?.length !== 1 || currentIds.get(data.id)?.length !== 1 ||
        data.contactId !== first.contactId || data.jobId !== first.jobId) ||
        current.length !== entries.length || new Set(current.map(estimate => estimate.id)).size !== entries.length ||
        current.some(estimate => !uniqueIds.has(estimate.id))) {
        reject("association_changed"); continue;
      }
      if (entries.some(entry => {
        const estimate = current.find(item => item.id === entry.data.id);
        return !estimate || fingerprint(estimate) !== entry.fingerprint || !isJobCurrent(entry.data.contactId, entry.data.jobId);
      })) { reject("edited"); continue; }
      if (!validRecord(record, invoiceId, entries)) { reject("invalid_response"); continue; }
      if (entries.some(({ data }) => time(data.paymentUpdatedAt) &&
        (!time(record.updatedAt) || Date.parse(record.updatedAt) < Date.parse(data.paymentUpdatedAt)))) {
        reject("older_response"); continue;
      }
      for (const { data, contractValue } of entries) {
        const paidAmount = Math.round(record.paidAmount * 100) / 100;
        const paymentPercent = contractValue > 0 ? Math.min(100, paidAmount / contractValue * 100) : 0;
        const fields = {
          squareStatus: record.status,
          paidAmount,
          paymentPercent,
          paymentRequests: record.paymentRequests === undefined ? clone(data.paymentRequests || []) : clone(record.paymentRequests),
          paymentUpdatedAt: record.updatedAt || data.paymentUpdatedAt || "",
          paidAt: paymentPercent >= 100 ? data.paidAt || record.updatedAt || data.paymentUpdatedAt || "" : "",
        };
        if (!Object.keys(fields).some(key => fingerprint(data[key]) !== fingerprint(fields[key]))) continue;
        patches.push({ estimateId: data.id, contactId: data.contactId, jobId: data.jobId, invoiceId, fields });
        touched.set(JSON.stringify([data.contactId, data.jobId]), { contactId: data.contactId, jobId: data.jobId });
      }
    }
    return freeze({ patches, touchedJobs: [...touched.values()], failures, stale: failures.length > 0,
      message: failures.length ? STALE_MESSAGE : "", changed: patches.length > 0 });
  }

  const api = { capture, collect, reconcile, BATCH_SIZE, STALE_MESSAGE };
  root.CrmPaymentRefresh = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
