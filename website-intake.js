const crypto = require("node:crypto");

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,119}$/;
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function bool(value) {
  return value === true || value === 1 || /^(true|yes|1)$/i.test(String(value || ""));
}

function slug(value) {
  return text(value, 80).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stable(value[key]);
      return out;
    }, {});
  }
  return value;
}

function payloadHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function safeEqualHex(left, right) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function verifyWebsiteIntakeSignature({ secret, timestamp, signature, rawBody, now = Date.now() }) {
  if (typeof secret !== "string" || secret.length < 32) return false;
  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(Math.floor(now / 1000) - seconds) > 300) return false;
  const provided = String(signature || "").replace(/^sha256=/i, "");
  const expected = crypto.createHmac("sha256", secret).update(`${seconds}.${rawBody}`).digest("hex");
  return safeEqualHex(provided, expected);
}

function normalizeWebsiteLead(input = {}, now = new Date()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid_payload");
  const requestId = text(input.requestId || input.submissionId, 120);
  const name = text(input.name || [input.firstName, input.lastName].filter(Boolean).join(" "), 200);
  const email = text(input.email, 254).toLowerCase();
  const phone = text(input.phone, 30);
  const address = text(input.address || input.propertyAddress, 500);
  const divisionAliases = { roof: "roofing", construction: "construction", remodel: "construction", service: "services", "home-services": "services" };
  const division = divisionAliases[slug(input.division)] || slug(input.division || "roofing");
  const service = slug(input.service || input.serviceType);
  const propertyType = slug(input.propertyType || "residential");
  const activeLeak = bool(input.activeLeak);
  const urgency = activeLeak ? "emergency" : slug(input.urgency || "normal");
  const photos = Array.isArray(input.photos) ? input.photos.slice(0, 20).map((item) => text(item?.url || item, 2000)) : [];

  if (!SAFE_ID.test(requestId) || !name || (!email && !phone) || (email && !EMAIL.test(email)) || !address) throw new Error("invalid_contact");
  if (!SAFE_SLUG.test(division) || !SAFE_SLUG.test(service)) throw new Error("invalid_service");
  if (!["residential", "commercial", "hoa", "multi-family"].includes(propertyType)) throw new Error("invalid_property_type");
  if (!["normal", "priority", "emergency"].includes(urgency)) throw new Error("invalid_urgency");
  if (photos.some((url) => !/^https:\/\/[^\s]+$/i.test(url))) throw new Error("invalid_photo_url");

  return {
    requestId,
    name,
    email,
    phone,
    address,
    propertyType,
    division,
    service,
    urgency,
    activeLeak,
    insuranceClaim: bool(input.insuranceClaim),
    photos,
    notes: text(input.notes || input.message, 4000),
    receivedAt: now.toISOString(),
  };
}

function websiteIntakeIds(requestId) {
  const digest = crypto.createHash("sha256").update(requestId).digest("hex").slice(0, 24);
  return { leadId: `web_lead_${digest}`, jobId: `web_job_${digest}` };
}

function quoteServiceId(division, services = [], urgency = "") {
  const label = `${Array.isArray(services) ? services.join(" ") : services} ${urgency}`.toLowerCase();
  if (division === "construction") {
    if (/window|impact opening/.test(label)) return "windows-impact-openings";
    if (/pool cage|screen enclosure|rescreen/.test(label)) return "pool-cages-screen-enclosures";
    if (/carport/.test(label)) return "carports";
    if (/block|masonry/.test(label)) return "block-masonry";
    if (/remodel|renovation|addition|interior|tenant|build-out/.test(label)) return "remodel-addition";
    return "general-construction";
  }
  if (division === "services") {
    if (/pressure|roof cleaning/.test(label)) return "pressure-washing";
    if (/trailer|hauling/.test(label)) return "dump-trailer";
    if (/season|checkup/.test(label)) return "seasonal-checkup";
    if (/sealant/.test(label)) return "sealant-program";
    if (/facility|maintenance|preventive/.test(label)) return "facility-maintenance";
    return "service-call";
  }
  if (/emergency|active leak/.test(label)) return "emergency-leak-repair";
  if (/inspection/.test(label)) return "roof-inspection";
  if (/repair|leak/.test(label)) return "roof-repair";
  if (/maintenance/.test(label)) return "preventive-maintenance";
  if (/commercial/.test(label)) return "commercial-roofing";
  return "roof-replacement";
}

function normalizeStoredQuote(row = {}) {
  const division = ["roofing", "construction", "services"].includes(slug(row.division)) ? slug(row.division) : "roofing";
  const services = Array.isArray(row.services) ? row.services.map((item) => text(item, 200)).filter(Boolean) : [];
  const urgencyLabel = text(row.urgency, 100);
  const emergency = /emergency|active leak|right away|immediate/i.test(urgencyLabel);
  const address = [row.street, row.city, row.state || "FL", row.zip].map((item) => text(item, 200)).filter(Boolean).join(", ");
  const notes = [
    text(row.details?.description || row.details?.notes || row.details?.message, 3000),
    services.length ? `Requested services: ${services.join(", ")}` : "",
    urgencyLabel ? `Requested timing: ${urgencyLabel}` : "",
    text(row.contact_pref, 80) ? `Preferred contact: ${text(row.contact_pref, 80)}` : "",
    text(row.best_time, 80) ? `Best time: ${text(row.best_time, 80)}` : "",
    text(row.company, 200) ? `Company: ${text(row.company, 200)}` : "",
  ].filter(Boolean).join("\n");
  const normalized = normalizeWebsiteLead({
    requestId: `quote:${text(row.id, 100)}`,
    name: [row.first_name, row.last_name].map((item) => text(item, 100)).filter(Boolean).join(" "),
    email: row.email,
    phone: row.phone,
    address,
    propertyType: slug(row.segment || "residential"),
    division,
    service: quoteServiceId(division, services, urgencyLabel),
    urgency: emergency ? "emergency" : /within 2 weeks|soon|priority/i.test(urgencyLabel) ? "priority" : "normal",
    activeLeak: emergency,
    insuranceClaim: /^(yes|true|1)$/i.test(text(row.insurance_claim, 20)),
    notes,
  }, row.created_at ? new Date(row.created_at) : new Date());
  normalized.photoStoragePaths = Array.isArray(row.photo_paths)
    ? row.photo_paths.map((item) => text(item, 500)).filter((item) => /^[A-Za-z0-9][A-Za-z0-9._/-]{0,499}$/.test(item)).slice(0, 20)
    : [];
  return normalized;
}

async function fetchStoredQuote({ fetchImpl, store, quoteRequestId }) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(quoteRequestId || ""))) {
    throw new Error("invalid_quote_request_id");
  }
  const headers = {
    apikey: store.key,
    ...(!store.key.startsWith("sb_secret_") ? { Authorization: `Bearer ${store.key}` } : {}),
  };
  const select = "id,created_at,status,segment,division,services,urgency,insurance_claim,details,first_name,last_name,phone,email,company,street,city,zip,contact_pref,best_time,photo_paths";
  const response = await fetchImpl(`${store.origin}/rest/v1/quote_requests?id=eq.${encodeURIComponent(quoteRequestId)}&select=${select}`, { headers, signal: AbortSignal.timeout(15000) });
  const rows = await response.json().catch(() => []);
  if (!response.ok) throw new Error("quote_request_lookup_failed");
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("quote_request_not_found");
  return rows[0];
}

async function fetchPendingStoredQuotes({ fetchImpl, store, limit = 25 }) {
  const headers = {
    apikey: store.key,
    ...(!store.key.startsWith("sb_secret_") ? { Authorization: `Bearer ${store.key}` } : {}),
  };
  const select = "id,created_at,status,segment,division,services,urgency,insurance_claim,details,first_name,last_name,phone,email,company,street,city,zip,contact_pref,best_time,photo_paths";
  const response = await fetchImpl(`${store.origin}/rest/v1/quote_requests?status=in.(new,pending)&select=${select}&order=created_at.asc&limit=${Math.max(1, Math.min(100, Number(limit) || 25))}`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(rows)) throw new Error("quote_request_lookup_failed");
  return rows;
}

async function fetchWebsiteIntakeReceipt({ fetchImpl, store, requestId }) {
  const headers = {
    apikey: store.key,
    ...(!store.key.startsWith("sb_secret_") ? { Authorization: `Bearer ${store.key}` } : {}),
  };
  const response = await fetchImpl(`${store.origin}/rest/v1/crm_website_intake_requests?company_state_id=eq.${encodeURIComponent(store.companyId)}&request_id=eq.${encodeURIComponent(requestId)}&select=lead_id,job_id&limit=1`, {
    headers,
    signal: AbortSignal.timeout(15000),
  });
  const rows = await response.json().catch(() => []);
  if (!response.ok || !Array.isArray(rows)) throw new Error("website_intake_receipt_lookup_failed");
  return rows[0] || null;
}

async function markStoredQuoteImported({ fetchImpl, store, quoteRequestId, leadId, jobId }) {
  const response = await fetchImpl(`${store.origin}/rest/v1/quote_requests?id=eq.${encodeURIComponent(quoteRequestId)}`, {
    method: "PATCH",
    signal: AbortSignal.timeout(15000),
    headers: {
      apikey: store.key,
      ...(!store.key.startsWith("sb_secret_") ? { Authorization: `Bearer ${store.key}` } : {}),
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ status: "imported", office_notes: `Imported to JobCrest CRM lead ${leadId}, job ${jobId}.` }),
  });
  if (!response.ok) throw new Error("quote_request_status_update_failed");
}

async function submitWebsiteLead({ fetchImpl, store, payload, onCallUserId = "" }) {
  const ids = websiteIntakeIds(payload.requestId);
  const response = await fetchImpl(`${store.origin}/rest/v1/rpc/crm_ingest_website_request`, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      apikey: store.key,
      ...(!store.key.startsWith("sb_secret_") ? { Authorization: `Bearer ${store.key}` } : {}),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_company: store.companyId,
      p_request_id: payload.requestId,
      p_payload_hash: payloadHash(payload),
      p_lead_id: ids.leadId,
      p_job_id: ids.jobId,
      p_owner_id: onCallUserId || null,
      p_request: payload,
    }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error("website_intake_store_unavailable");
  if (payload.photoStoragePaths?.length) {
    const attached = await fetchImpl(`${store.origin}/rest/v1/rpc/crm_attach_website_photo_paths`, {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        apikey: store.key,
        ...(!store.key.startsWith("sb_secret_") ? { Authorization: `Bearer ${store.key}` } : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_company: store.companyId,
        p_request_id: payload.requestId,
        p_paths: payload.photoStoragePaths,
      }),
    });
    if (!attached.ok) throw new Error("website_photo_attachment_failed");
  }
  return result;
}

module.exports = {
  fetchPendingStoredQuotes,
  fetchStoredQuote,
  fetchWebsiteIntakeReceipt,
  markStoredQuoteImported,
  normalizeStoredQuote,
  normalizeWebsiteLead,
  payloadHash,
  quoteServiceId,
  submitWebsiteLead,
  verifyWebsiteIntakeSignature,
  websiteIntakeIds,
};
