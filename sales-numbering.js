/* Atomic shared sales-number reservations. The database is authoritative; local
 * fallbacks are handled by app.js only when cloud sync is intentionally off. */
(function (root) {
  "use strict";
  const id = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(value);
  const number = (value, pattern) => typeof value === "string" && pattern.test(value);
  function create({ rpc, companyId, timeoutMs = 15000 }) {
    if (typeof rpc !== "function" || !id(companyId)) throw new TypeError("A shared numbering service is required");
    return {
      async reserve({ leadId, jobId = "", estimateId = "" }) {
        if (!id(leadId) || (jobId && !id(jobId)) || (estimateId && (!jobId || !id(estimateId)))) {
          throw new TypeError("Valid lead, job and estimate IDs are required");
        }
        let timer;
        try {
          const response = await Promise.race([
            rpc("crm_reserve_sales_numbers", { p_company: companyId, p_lead_id: leadId, p_job_id: jobId || null, p_estimate_id: estimateId || null }),
            new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error("Number reservation timed out.")), timeoutMs); }),
          ]);
          if (response?.error) throw response.error;
          const data = response?.data;
          if (!data || data.leadId !== leadId || data.jobId !== (jobId || null) || data.estimateId !== (estimateId || null) ||
              !number(data.leadNumber, /^LD-\d{8}-\d{6}$/) ||
              (jobId && !number(data.projectNumber, /^LD-\d{8}-\d{6}-P\d{2,}$/)) ||
              (estimateId && !number(data.estimateNumber, /^EST-\d{4,}$/))) {
            throw new Error("The shared CRM returned an invalid number reservation.");
          }
          return JSON.parse(JSON.stringify(data));
        } finally { clearTimeout(timer); }
      },
    };
  }
  root.CrmSalesNumbering = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = { create };
})(typeof window !== "undefined" ? window : globalThis);
