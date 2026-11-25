const STORAGE_KEY = "roofline-crm-v1";
const UI_STORAGE_KEY = `${STORAGE_KEY}:ui-v1`;
const SUPABASE_CRM_TABLE = "crm_state";
const SUPABASE_RECORDS_TABLE = "crm_records";
const SUPABASE_AUDIT_TABLE = "crm_audit_events";
const SUPABASE_DOCUMENT_BUCKET = "crm-documents";
const CLOUD_SAVE_DELAY = 700;
const COMPANY_STATE_SUFFIX = "company";
const COMPANY_DOCUMENT_LEAD_ID = "company";
const JOB_PHOTO_CATEGORY_ID = "job_photos";
const MAX_DOCUMENT_FILE_SIZE = 250 * 1024 * 1024;
const RESUMABLE_UPLOAD_THRESHOLD = 6 * 1024 * 1024;
const RESUMABLE_UPLOAD_CHUNK_SIZE = 6 * 1024 * 1024;
const PHOTO_PAGE_SIZE = 30;
const DOCUMENT_PAGE_SIZE = 50;
const SAFE_RECORD_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/;

const isSafeRecordId = (value) => SAFE_RECORD_ID_PATTERN.test(String(value || ""));

const localDateISO = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const todayISO = () => localDateISO();

const addDaysISO = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateISO(date);
};

const dateTimeLocalValue = (value) => {
  const text = String(value || "");
  if (!text) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)) return text.slice(0, 16);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return `${localDateISO(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const number = (value) => {
  const normalized = typeof value === "string" ? value.replace(/[$,%\s,]/g, "") : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

function formatPhoneNumber(value = "") {
  let digits = String(value).replace(/\D/g, "");
  let countryPrefix = "";
  if (digits.length > 10 && digits.startsWith("1")) {
    countryPrefix = "+1 ";
    digits = digits.slice(1);
  }
  digits = digits.slice(0, 10);
  if (!digits) return "";
  if (digits.length <= 3) return `${countryPrefix}(${digits}`;
  if (digits.length <= 6) return `${countryPrefix}(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `${countryPrefix}(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function formatCurrencyInput(value = "") {
  if (String(value).trim() === "") return "";
  return number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseCurrencyInput(value = "") {
  const parsed = number(value);
  return Math.round((parsed + Number.EPSILON) * 100) / 100;
}

const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const statuses = [
  "New",
  "Contacted",
  "Inspection",
  "Estimate Sent",
  "Won",
  "Scheduled",
  "Materials Ordered",
  "In Progress",
  "Completed",
  "Paid",
  "Lost",
];
const defaultDivisions = [
  { id: "roofing", name: "Roofing", displayOrder: 10, active: true },
  { id: "construction", name: "Construction", displayOrder: 20, active: true },
  { id: "services", name: "Home Services", displayOrder: 30, active: true },
];
const defaultServices = [
  ["roof-replacement", "roofing", "Roof Replacement"], ["roof-repair", "roofing", "Roof Repair"],
  ["roof-inspection", "roofing", "Roof Inspection"], ["emergency-leak-repair", "roofing", "Emergency Leak Repair"],
  ["commercial-roofing", "roofing", "Commercial Roofing"], ["preventive-maintenance", "roofing", "Preventive Maintenance"],
  ["remodel-addition", "construction", "Remodel / Addition"], ["windows-impact-openings", "construction", "Windows & Impact Openings"],
  ["pool-cages-screen-enclosures", "construction", "Pool Cages & Screen Enclosures"], ["carports", "construction", "Carports"],
  ["block-masonry", "construction", "Block & Masonry"], ["general-construction", "construction", "General Construction"],
  ["pressure-washing", "services", "Pressure Washing"], ["dump-trailer", "services", "Dump Trailer"],
  ["seasonal-checkup", "services", "Seasonal Checkup"], ["facility-maintenance", "services", "Facility Maintenance"],
  ["sealant-program", "services", "Sealant Program"], ["service-call", "services", "Service Call"],
].map(([id, divisionId, name], index) => ({ id, divisionId, name, displayOrder: (index + 1) * 10, active: true }));
const defaultPipelineStages = {
  roofing: statuses.filter((status) => status !== "Lost"),
  construction: ["Consultation", "Design & Selections", "Estimate", "Contract", "Permits", "Demo", "Rough-In", "Inspections", "Finishes", "Punch List", "Final Walkthrough", "Paid"],
  services: ["Request", "Scheduled", "Completed", "Invoiced", "Paid"],
};
const defaultSalesPipelineStages = {
  roofing: ["New", "Contacted", "Inspection Scheduled", "Inspection Complete", "Estimate Sent", "Follow-Up/Decision", "Contract & Deposit", "Production Handoff"],
  construction: ["New", "Contacted", "Consultation Scheduled", "Site Visit & Measurements", "Design & Selections", "Proposal Sent", "Revisions/Decision", "Contract & Deposit", "Production Handoff"],
  services: ["New Request", "Contacted", "Scheduled/Quoted", "Approved", "Operations Handoff"],
};
const commercialApprovalStages = ["Bid Preparation", "Bid Submitted", "Management Review", "Board Approval"];
const salesPipelineStagesFor = (divisionId = "roofing", propertyType = "all") => {
  const base = [...(defaultSalesPipelineStages[divisionId] || defaultSalesPipelineStages.roofing)];
  if (!["commercial", "hoa"].includes(propertyType) || divisionId === "services") return base;
  const contractIndex = base.indexOf("Contract & Deposit");
  if (contractIndex < 0) return base;
  return [...base.slice(0, contractIndex), ...commercialApprovalStages, ...base.slice(contractIndex)];
};
function legacySalesStageFor(division = "roofing", status = "", propertyType = "residential") {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "lost") return "Lost";
  if (division === "services") {
    if (["scheduled"].includes(normalized)) return "Scheduled/Quoted";
    if (["completed", "invoiced", "paid"].includes(normalized)) return "Operations Handoff";
    if (["approved", "won"].includes(normalized)) return "Approved";
    if (["contacted"].includes(normalized)) return "Contacted";
    return "New Request";
  }
  if (division === "construction") {
    if (["paid", "final walkthrough", "punch list", "finishes", "inspections", "rough-in", "demo", "permits", "scheduled", "materials ordered", "in progress", "completed"].includes(normalized)) return "Production Handoff";
    if (["contract", "won"].includes(normalized)) return "Contract & Deposit";
    if (["estimate", "estimate sent"].includes(normalized)) return "Proposal Sent";
    if (normalized === "design & selections") return "Design & Selections";
    if (["site visit & measurements", "inspection"].includes(normalized)) return "Site Visit & Measurements";
    if (["consultation", "consultation scheduled"].includes(normalized)) return "Consultation Scheduled";
    if (normalized === "contacted") return "Contacted";
    return "New";
  }
  if (["won"].includes(normalized)) return "Contract & Deposit";
  if (["scheduled", "materials ordered", "in progress", "completed", "paid"].includes(normalized)) return "Production Handoff";
  if (normalized === "estimate sent") return "Estimate Sent";
  if (["inspection complete"].includes(normalized)) return "Inspection Complete";
  if (["inspection", "inspection scheduled"].includes(normalized)) return "Inspection Scheduled";
  if (normalized === "contacted") return "Contacted";
  return "New";
}

function normalizeSalesStage(job = {}, contact = {}, division = "roofing", propertyType = "residential") {
  const stages = salesPipelineStagesFor(division, propertyType);
  const available = new Set([...stages, ...salesPipelineStagesFor(division, "all"), "Lost"]);
  const requested = String(job.salesStage || job.sales_stage || "").trim();
  const derived = legacySalesStageFor(division, job.status || contact.status, propertyType);
  if (!available.has(requested)) return derived;
  if (requested === "Lost" || derived === "Lost") return requested === "Lost" ? requested : derived;
  // Several board columns share one production stage (Construction's New,
  // Contacted and Consultation Scheduled are all "Consultation"). A saved
  // column that matches the job's production stage is the truth. Deriving it
  // again from the production stage pushed cards one column too far, so
  // Contacted and Site Visit & Measurements could never hold a card.
  if (stages.includes(requested) && typeof pipelineLifecycleStatusFor === "function"
    && pipelineLifecycleStatusFor(division, requested, job.status || contact.status) === (job.status || contact.status)) return requested;
  const requestedIndex = stages.indexOf(requested);
  const derivedIndex = stages.indexOf(derived);
  // Existing job-progression controls remain authoritative. If a job advances
  // outside this board, never leave its separate sales stage behind it.
  return derivedIndex > requestedIndex ? derived : requested;
}
const activeDivisions = () => (state.divisions?.length ? state.divisions : defaultDivisions).filter((item) => item.active !== false).sort((a, b) => number(a.displayOrder) - number(b.displayOrder));
const activeServices = (divisionId) => (state.services?.length ? state.services : defaultServices).filter((item) => item.active !== false && (!divisionId || item.divisionId === divisionId)).sort((a, b) => number(a.displayOrder) - number(b.displayOrder));
const pipelineStagesFor = (divisionId = "roofing") => {
  const configured = (state.pipelineStages || []).filter((item) => item.active !== false && item.divisionId === divisionId).sort((a, b) => number(a.displayOrder) - number(b.displayOrder)).map((item) => item.name);
  const stages = configured.length ? configured : (defaultPipelineStages[divisionId] || defaultPipelineStages.roofing);
  // Every division can capture a new lead before entering its delivery stages.
  return ["New", ...stages.filter((stage) => stage !== "New")];
};
const leadStatusLabel = (status) => status === "New" ? "New Lead" : status;
const allPipelineStages = () => [...new Set([...Object.values(defaultPipelineStages).flat(), ...(state.pipelineStages || []).map((item) => item.name), "Lost"])];
const soldJobStatuses = ["Won", "Scheduled", "Materials Ordered", "In Progress", "Completed", "Paid"];
// Where a job is in its life, whatever its division. soldJobStatuses above
// only knows the roofing stage names, which left Construction and Home
// Services jobs out of production lists, reports and "open job" counts.
//   sales       still being sold
//   production  sold and being delivered (or delivered and awaiting payment)
//   closed      paid in full
//   lost
const soldStageStartByDivision = { roofing: "Won", construction: "Contract", services: "Scheduled" };
function jobLifecyclePhase(job = {}) {
  const status = job.status || "New";
  if (status === "Lost") return "lost";
  if (status === "Paid") return "closed";
  const division = job.division || "roofing";
  const stages = pipelineStagesFor(division);
  const index = stages.indexOf(status);
  if (index < 0) return soldJobStatuses.includes(status) ? "production" : "sales";
  const soldFrom = stages.indexOf(soldStageStartByDivision[division] || "Won");
  return soldFrom >= 0 && index >= soldFrom ? "production" : "sales";
}
const jobIsInProduction = (job) => jobLifecyclePhase(job) === "production";
const jobIsSold = (job) => ["production", "closed"].includes(jobLifecyclePhase(job));
const jobIsOpen = (job) => !["closed", "lost"].includes(jobLifecyclePhase(job));

// Lead sources are typed by hand, so "REFERRAL", "referral" and "Refferal" all
// exist as separate sources. Charts, filters and the source list group them.
function leadSourceLabel(source) {
  const text = String(source || "").trim().replace(/\s+/g, " ");
  if (!text) return "No source";
  const key = text.toLowerCase();
  if (/^ref+er+al+s?$/.test(key)) return "Referral";
  if (text === key || (text === text.toUpperCase() && text.length > 4)) return key.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
  return text;
}
const pipelinePlaybook = [
  {
    status: "New",
    phase: "Capture",
    title: "Respond while the lead is warm",
    icon: "user",
    workspace: "leads",
    workspaceLabel: "Open Lead Intake",
    mission: "Make a fast, human first impression and establish who owns the opportunity.",
    actions: [
      "Confirm the homeowner's best phone, email, and property address",
      "Assign the sales rep and record the lead source",
      "Call or text immediately and log the first attempt",
      "Create a dated follow-up task if they do not answer",
    ],
    gate: "Two-way contact is made or a specific callback is scheduled.",
  },
  {
    status: "Contacted",
    phase: "Qualify",
    title: "Discover the need and book the visit",
    icon: "calendar",
    workspace: "calendar",
    workspaceLabel: "Open Calendar",
    mission: "Understand the problem, confirm fit, and earn the on-site appointment.",
    actions: [
      "Ask what happened, when it started, and what outcome they want",
      "Confirm property ownership and all decision-makers",
      "Identify insurance, financing, timing, and urgency",
      "Book the inspection and send a clear appointment confirmation",
    ],
    gate: "Inspection date, time, address, and attendees are confirmed.",
  },
  {
    status: "Inspection",
    phase: "Diagnose",
    title: "Inspect, document, and build trust",
    icon: "clipboard",
    workspace: "jobs",
    workspaceLabel: "Open Jobs",
    mission: "Turn field evidence into a complete scope the homeowner understands.",
    actions: [
      "Capture measurements, photos, damage, access, and safety conditions",
      "Confirm materials, ventilation, code, and permit requirements",
      "Review findings with the homeowner in plain language",
      "Set the exact time for the estimate presentation before leaving",
    ],
    gate: "A complete scope and supporting photos are saved to the lead.",
  },
  {
    status: "Estimate Sent",
    phase: "Present",
    title: "Make the decision easy",
    icon: "file",
    workspace: "estimates",
    workspaceLabel: "Open Estimates",
    mission: "Connect the recommended solution to the homeowner's priorities—not just a price.",
    actions: [
      "Build the itemized scope and verify pricing and margin",
      "Present options, warranties, timeline, and payment expectations",
      "Ask for questions and resolve the real objection",
      "Send the estimate and schedule the next decision conversation",
    ],
    gate: "The customer has reviewed the proposal and a decision date is set.",
  },
  {
    status: "Won",
    phase: "Close",
    title: "Turn the yes into a clean contract",
    icon: "check",
    workspace: "projects",
    workspaceLabel: "Open Sold Jobs",
    mission: "Protect the relationship and the margin by making every commitment explicit.",
    actions: [
      "Obtain the signed contract and required deposit",
      "Confirm final scope, colors, upgrades, exclusions, and change-order rules",
      "Collect all documents needed for permits, insurance, or financing",
      "Explain exactly what happens next and who will contact them",
    ],
    gate: "Contract, payment requirements, selections, and expectations are complete.",
  },
  {
    status: "Won",
    phase: "Handoff",
    title: "Deliver a five-star transition",
    icon: "hammer",
    workspace: "projects",
    workspaceLabel: "Open Production",
    mission: "Transfer a fully informed customer—not a pile of notes—to the production team.",
    actions: [
      "Complete the internal handoff with scope, photos, documents, and promises",
      "Confirm scheduling contact and material or permit dependencies",
      "Introduce the production point of contact to the homeowner",
      "Set expectations for updates, final walkthrough, payment, and review request",
    ],
    gate: "Production accepts the job and the homeowner knows the next milestone.",
  },
];
const leaderboardRanges = {
  week: "This Week",
  month: "This Month",
  ytd: "Year to Date",
};

const dashboardWidgetDefaults = [
  { id: "pipeline", columns: 5, rows: 28, order: 0 },
  { id: "revenue", columns: 4, rows: 28, order: 1 },
  { id: "reminders", columns: 3, rows: 28, order: 2 },
  { id: "lead-sources", columns: 3, rows: 18, order: 3 },
  { id: "job-types", columns: 3, rows: 18, order: 4 },
  { id: "project-status", columns: 3, rows: 18, order: 5 },
  { id: "activity", columns: 3, rows: 18, order: 6 },
  { id: "schedule", columns: 8, rows: 20, order: 7 },
  { id: "weather", columns: 4, rows: 20, order: 8 },
  { id: "leaderboard", columns: 12, rows: 18, order: 9 },
];

function normalizeDashboardWidgetLayout(value) {
  const provided = new Map((Array.isArray(value) ? value : []).map((item) => [String(item?.id || ""), item]));
  return dashboardWidgetDefaults.map((fallback) => {
    const item = provided.get(fallback.id) || {};
    const columns = Number(item.columns);
    const rows = Number(item.rows);
    const order = Number(item.order);
    return {
      id: fallback.id,
      columns: Math.max(3, Math.min(12, Math.round(Number.isFinite(columns) ? columns : fallback.columns))),
      rows: Math.max(12, Math.min(40, Math.round(Number.isFinite(rows) ? rows : fallback.rows))),
      order: Math.max(0, Math.min(dashboardWidgetDefaults.length - 1, Math.round(Number.isFinite(order) ? order : fallback.order))),
    };
  }).sort((left, right) => left.order - right.order).map((item, order) => ({ ...item, order }));
}

const sharedCrmViews = [
  "dashboard",
  "leads",
  "contacts",
  "jobs",
  "leadDetail",
  "estimates",
  "companyDocuments",
  "projects",
  "calendar",
  "tasks",
  "invoices",
  "reviews",
  "reports",
  "pipeline",
];

const sharedCrmActions = [
  "manageContacts",
  "manageJobs",
  "manageEstimates",
  "manageDocuments",
  "manageTasks",
  "manageJobFinancials",
  "sendEmail",
];

const rolePolicies = {
  admin: {
    views: "all",
    actions: "all",
  },
  office_manager: {
    views: [...sharedCrmViews],
    actions: [...sharedCrmActions],
  },
  sales_manager: {
    views: [...sharedCrmViews],
    actions: [...sharedCrmActions],
  },
  operations_manager: {
    views: [...sharedCrmViews],
    actions: ["manageContacts", "manageJobs", "manageDocuments", "manageTasks", "manageJobFinancials", "sendEmail"],
  },
  sales: {
    views: [...sharedCrmViews],
    actions: ["manageContacts", "manageJobs", "manageEstimates", "manageDocuments", "manageTasks", "sendEmail"],
  },
  production: {
    views: [...sharedCrmViews],
    actions: ["manageJobs", "manageDocuments", "manageTasks"],
  },
  viewer: {
    views: [...sharedCrmViews],
    actions: [],
  },
};

const actionPermissions = {
  "add-customer": "manageContacts",
  "edit-contact": "manageContacts",
  "estimate-contact": "manageEstimates",
  "advance-contact": "manageJobs",
  "remove-line": "manageEstimates",
  "estimate-job": "manageEstimates",
  "remove-document": "manageDocuments",
  "rename-document": "manageDocuments",
  "remove-company-document": "manageDocuments",
  "rename-company-document": "manageDocuments",
  "upload-to-category": "manageDocuments",
  "prepare-zoho-smart-document": "manageDocuments",
  "open-smart-document": "manageDocuments",
  "sync-google-drive-document": "manageDocuments",
  "edit-document-category": "manageCompany",
  "toggle-document-category": "manageCompany",
  "delete-document-category": "manageCompany",
  "merge-document-category": "manageCompany",
  "move-document-category-up": "manageCompany",
  "move-document-category-down": "manageCompany",
  "edit-job": "manageJobs",
  "delete-job": "manageJobs",
  "edit-cost-item": "manageJobFinancials",
  "delete-cost-item": "manageJobFinancials",
  "open-job-profit": "manageJobFinancials",
  "edit-calendar-task": "manageTasks",
  "complete-calendar-task": "manageTasks",
  "delete-calendar-task": "manageTasks",
};

const defaultCompany = {
  name: "Summit Ridge Exteriors",
  license: "Licensed and insured exterior restoration contractor",
  phone: "(555) 018-2048",
  email: "estimates@summitridge.example",
  address: "1800 Market Street\nSuite 210\nCharlotte, NC 28202",
  officeAddress: "1800 Market Street\nSuite 210\nCharlotte, NC 28202",
  logoDataUrl: "",
  logoAssetVersion: "",
  googleReviewUrl: "",
  defaultTerms:
    "This estimate is valid through the date shown above. Scope may change if concealed damage is discovered after work begins. Customer approval is required before materials are ordered.",
};

const defaultCurrentUser = {
  name: "CRM User",
  email: "",
  role: "viewer",
};

const costCategories = ["Materials", "Labor", "Subcontractor", "Permits", "Dump Fees", "Equipment", "Other"];

const DOCUMENT_CATEGORY_CREATED_AT = "2026-08-07T00:00:00.000Z";
const defaultDocumentCategories = [
  { id: "doccat_permits", name: "Permits", displayOrder: 0, icon: "file", color: "#2563eb" },
  { id: "doccat_contracts", name: "Contracts", displayOrder: 1, icon: "check", color: "#059669" },
  { id: "doccat_estimates", name: "Estimates", displayOrder: 2, icon: "dollar", color: "#7c3aed" },
  { id: "doccat_invoices", name: "Invoices", displayOrder: 3, icon: "invoice", color: "#ea580c" },
  { id: "doccat_material_orders", name: "Material Orders", displayOrder: 4, icon: "folder", color: "#ca8a04" },
  { id: "doccat_other", name: "Other", displayOrder: 5, icon: "folder", color: "#64748b" },
].map((category) => ({
  ...category,
  active: true,
  createdAt: DOCUMENT_CATEGORY_CREATED_AT,
  updatedAt: DOCUMENT_CATEGORY_CREATED_AT,
}));

const defaultCompanyDocumentFolders = [
  { id: "companyfolder_blank_contract", name: "Blank Contract" },
  { id: "companyfolder_sample_estimate", name: "Sample Estimate" },
  { id: "companyfolder_sales_reference", name: "Sales Reference" },
  { id: "companyfolder_other", name: "Other" },
].map((folder, displayOrder) => ({
  ...folder,
  displayOrder,
  createdAt: DOCUMENT_CATEGORY_CREATED_AT,
  updatedAt: DOCUMENT_CATEGORY_CREATED_AT,
}));

const documentCategoryIcons = ["folder", "file", "check", "dollar", "invoice", "upload"];

// The instruction line a new estimate starts with. It is replaced when a
// template is applied and is never printed on the customer's copy.
const ESTIMATE_PLACEHOLDER_DESCRIPTION = "Add product details, material notes, manufacturer/color selections, and installation scope for this item.";
function isPlaceholderEstimateItem(item = {}) {
  return String(item.description || "").trim() === ESTIMATE_PLACEHOLDER_DESCRIPTION && !number(item.rate);
}
// The lines that belong on the customer's copy.
function printableEstimateItems(estimate = {}) {
  return (estimate.items || []).filter((item) => !isPlaceholderEstimateItem(item));
}
// Wording that depends on the division of the job being estimated. Every
// estimate used to be titled "CONSTRUCTION ESTIMATE" and described as
// "exterior restoration", including roof repairs and pressure washing.
const estimateDivisionWording = {
  roofing: { label: "ROOFING ESTIMATE", title: "Roofing Estimate", line: "Roofing scope", scope: "Provide labor, materials, project supervision, debris removal, and final cleanup for the approved roofing scope." },
  construction: { label: "CONSTRUCTION ESTIMATE", title: "Construction Estimate", line: "Construction scope", scope: "Provide labor, materials, project supervision, debris removal, and final cleanup for the approved construction scope." },
  services: { label: "SERVICE ESTIMATE", title: "Service Estimate", line: "Service scope", scope: "Provide labor, equipment, and materials to complete the approved service scope, including cleanup." },
};
function estimateWordingFor(division = "roofing") {
  return estimateDivisionWording[division] || { label: "ESTIMATE", title: "Estimate", line: "Scope of work", scope: "Provide labor, materials, and cleanup for the approved scope of work." };
}

// Templates are offered for the division of the job being estimated. The
// Construction and Home Services templates carry no prices on purpose: enter
// the rate for each job.
const estimateTemplates = [
  {
    name: "Remodel / Addition",
    division: "construction",
    items: [
      { title: "Demolition & site preparation", description: "Protect the work area, remove existing finishes, and haul away debris.", quantity: 1, unit: "lot", rate: 0 },
      { title: "Framing & structural work", description: "", quantity: 1, unit: "lot", rate: 0 },
      { title: "Electrical, plumbing & mechanical", description: "Rough-in and trim-out by licensed trades.", quantity: 1, unit: "lot", rate: 0 },
      { title: "Finishes", description: "Drywall, flooring, trim, paint, and fixtures per approved selections.", quantity: 1, unit: "lot", rate: 0 },
      { title: "Permits & inspections", description: "", quantity: 1, unit: "lot", rate: 0 },
    ],
  },
  {
    name: "Windows & Impact Openings",
    division: "construction",
    items: [
      { title: "Impact windows - supply & install", description: "", quantity: 0, unit: "ea", rate: 0 },
      { title: "Impact doors - supply & install", description: "", quantity: 0, unit: "ea", rate: 0 },
      { title: "Removal & disposal of existing openings", description: "", quantity: 1, unit: "lot", rate: 0 },
      { title: "Permit & inspection", description: "", quantity: 1, unit: "lot", rate: 0 },
    ],
  },
  {
    name: "Screen Enclosure / Carport",
    division: "construction",
    items: [
      { title: "Structure - supply & install", description: "Aluminum framing engineered for local wind load.", quantity: 1, unit: "lot", rate: 0 },
      { title: "Screening or roof panels", description: "", quantity: 0, unit: "sf", rate: 0 },
      { title: "Concrete footers & anchoring", description: "", quantity: 1, unit: "lot", rate: 0 },
      { title: "Permit & engineering", description: "", quantity: 1, unit: "lot", rate: 0 },
    ],
  },
  {
    name: "Pressure Washing",
    division: "services",
    items: [
      { title: "Roof soft wash", description: "", quantity: 1, unit: "job", rate: 0 },
      { title: "Driveway & walkways", description: "", quantity: 1, unit: "job", rate: 0 },
      { title: "Lanai / pool deck", description: "", quantity: 1, unit: "job", rate: 0 },
    ],
  },
  {
    name: "Service Call",
    division: "services",
    items: [
      { title: "Service call & diagnosis", description: "", quantity: 1, unit: "ea", rate: 0 },
      { title: "Labor", description: "", quantity: 0, unit: "hr", rate: 0 },
      { title: "Materials", description: "", quantity: 1, unit: "lot", rate: 0 },
    ],
  },
  {
    name: "Dump Trailer",
    division: "services",
    items: [
      { title: "Dump trailer rental", description: "", quantity: 1, unit: "day", rate: 0 },
      { title: "Disposal fee", description: "", quantity: 1, unit: "load", rate: 0 },
    ],
  },
  {
    name: "Full Reroof",
    items: [
      { title: "Architectural shingle system", description: "Install architectural shingles with underlayment, starter strip, and ridge cap to manufacturer specs.", quantity: 0, unit: "sq", rate: 420 },
      { title: "Tear-off & haul-away", description: "Remove existing roofing, haul debris, perform magnetic nail sweep.", quantity: 0, unit: "sq", rate: 85 },
      { title: "Synthetic underlayment", description: "", quantity: 0, unit: "sq", rate: 30 },
      { title: "Ice & water shield (valleys)", description: "", quantity: 0, unit: "sq", rate: 95 },
      { title: "Ridge vent & accessories", description: "Install continuous ridge ventilation and matching ridge cap.", quantity: 1, unit: "lot", rate: 640 },
    ],
  },
  {
    name: "Storm Damage Repair",
    items: [
      { title: "Hail/wind damage shingle replacement", description: "Replace damaged shingles, match existing color/profile where possible.", quantity: 0, unit: "sq", rate: 390 },
      { title: "Flashing repair", description: "Re-seal and replace damaged step/counter flashing.", quantity: 1, unit: "lot", rate: 450 },
      { title: "Decking repair", description: "Replace damaged sheathing as discovered.", quantity: 0, unit: "sheet", rate: 85 },
    ],
  },
  {
    name: "Gutters",
    items: [
      { title: "5\" K-style gutter installation", description: "Install .032 aluminum seamless gutters with hidden hangers every 24\".", quantity: 0, unit: "lf", rate: 8 },
      { title: "3×4 downspouts", description: "Install downspouts with elbows and splash blocks.", quantity: 0, unit: "ea", rate: 95 },
      { title: "Gutter guard installation", description: "Micro-mesh gutter protection system.", quantity: 0, unit: "lf", rate: 12 },
      { title: "Remove & haul existing gutters", description: "", quantity: 0, unit: "lf", rate: 3 },
    ],
  },
  {
    name: "Flat Roof (TPO)",
    items: [
      { title: "TPO membrane installation", description: "60-mil TPO single-ply membrane, mechanically fastened with heat-welded seams.", quantity: 0, unit: "sq", rate: 520 },
      { title: "Insulation board", description: "2\" polyiso insulation board, tapered at drains.", quantity: 0, unit: "sq", rate: 110 },
      { title: "Tear-off & haul-away", description: "Remove existing flat roof membrane and insulation.", quantity: 0, unit: "sq", rate: 90 },
      { title: "Drain and flashing work", description: "Inspect, clean, and re-flash all roof penetrations and drains.", quantity: 1, unit: "lot", rate: 850 },
    ],
  },
  {
    name: "Roof Tune-Up",
    items: [
      { title: "Roof inspection & report", description: "Full inspection with photo documentation.", quantity: 1, unit: "ea", rate: 250 },
      { title: "Re-seal penetrations & vents", description: "Apply roofing sealant to all vents, pipes, and flashings.", quantity: 1, unit: "lot", rate: 320 },
      { title: "Minor shingle repairs", description: "Nail down loose shingles, replace up to 3 damaged shingles.", quantity: 1, unit: "lot", rate: 280 },
    ],
  },
];

const fallbackWeatherLocation = {
  latitude: 35.2271,
  longitude: -80.8431,
  label: "Office Market",
  note: "Enable location for job-site weather",
};

const weatherRefreshMs = 12 * 60 * 1000;
const weatherState = {
  status: "idle",
  fetchedAt: 0,
  location: fallbackWeatherLocation,
  current: null,
  daily: [],
  error: "",
};

const seedContacts = [
  {
    id: "contact_1001",
    type: "Lead",
    status: "Inspection",
    name: "Maya Torres",
    source: "Website",
    email: "maya.torres@example.com",
    phone: "(555) 013-8821",
    address: "421 Pineview Drive\nGreenville, SC 29607",
    value: 18600,
    salesRep: "Alex Carter",
    lastContact: todayISO(),
    closedDate: "",
    notes: "Storm damage inspection requested. Wants roof and gutter options.",
    createdAt: "2026-05-12",
  },
  {
    id: "contact_1002",
    type: "Lead",
    status: "Estimate Sent",
    name: "Jordan Blake",
    source: "Referral",
    email: "jordan.blake@example.com",
    phone: "(555) 019-3410",
    address: "89 Cedar Hollow Lane\nAsheville, NC 28801",
    value: 12200,
    salesRep: "Priya Shah",
    lastContact: todayISO(),
    closedDate: "",
    notes: "Asked for architectural shingles and a separate skylight allowance.",
    createdAt: "2026-05-15",
  },
  {
    id: "contact_1003",
    type: "Customer",
    status: "Won",
    name: "Greenfield HOA",
    source: "Repeat customer",
    email: "board@greenfieldhoa.example",
    phone: "(555) 015-9080",
    address: "1200 Greenfield Commons\nRaleigh, NC 27601",
    value: 48200,
    salesRep: "Alex Carter",
    lastContact: todayISO(),
    closedDate: addDaysISO(-3),
    notes: "Phase one approved. Use board chair as billing contact.",
    createdAt: "2026-05-01",
  },
  {
    id: "contact_1004",
    type: "Customer",
    status: "Won",
    name: "Northlake Retail Center",
    source: "Canvassing",
    email: "facilities@northlake.example",
    phone: "(555) 014-7720",
    address: "7800 Northlake Parkway\nCharlotte, NC 28216",
    value: 27800,
    salesRep: "Priya Shah",
    lastContact: todayISO(),
    closedDate: addDaysISO(-12),
    notes: "Approved metal coping and flat roof repair package.",
    createdAt: "2026-05-04",
  },
];

const seedEstimates = [
  {
    id: "estimate_2001",
    contactId: "contact_1002",
    estimateNumber: "EST-1042",
    projectTitle: "Full Roof Replacement",
    status: "Sent",
    projectManager: "Alex Carter",
    salesRepEmail: "alex@summitridge.example",
    salesRepPhone: "(555) 018-2048",
    issueDate: todayISO(),
    validUntil: addDaysISO(14),
    scopeSummary:
      "Remove and replace existing roofing system, install synthetic underlayment, starter strip, ridge ventilation, and architectural shingles. Includes jobsite cleanup and magnetic nail sweep.",
    taxRate: 0,
    deposit: 2500,
    notes: defaultCompany.defaultTerms,
    sentAt: todayISO(),
    items: [
      {
        title: "Roof replacement system",
        description:
          "Install architectural shingle roofing system with underlayment, starter strip, ridge cap, and manufacturer-compatible accessories.",
        quantity: 34,
        unit: "sq",
        rate: 315,
      },
      {
        title: "Tear off and disposal",
        description:
          "Remove existing roofing materials down to decking, haul away construction debris, and perform magnetic nail sweep.",
        quantity: 34,
        unit: "sq",
        rate: 68,
      },
      {
        title: "Ridge vent and accessories",
        description: "Install continuous ridge ventilation and matching ridge cap shingles.",
        quantity: 72,
        unit: "lf",
        rate: 12,
      },
    ],
  },
];

const createInitialState = () => ({
  view: "dashboard",
  search: "",
  pipelineFilter: "Lead",
  pipelineDivision: "roofing",
  pipelinePropertyType: "all",
  pipelineRep: "all",
  pipelineService: "all",
  pipelineSource: "all",
  pipelineUrgency: "all",
  pipelineDateRange: "all",
  pipelineStaleDays: 7,
  pipelineAttention: "all",
  pipelineWorklist: false,
  pipelineSelectedOpportunity: "",
  pipelineGuidanceStage: "",
  leadStageFilter: "",
  leadTagFilter: "",
  savedLeadFilterId: "",
  leaderboardRange: "month",
  dashboardWidgetLayout: normalizeDashboardWidgetLayout(),
  leadDetailTab: "overview",
  financeTab: "invoices",
  selectedContactId: "contact_1002",
  selectedEstimateId: "estimate_2001",
  newEstimateContactId: "",
  newEstimateJobId: "",
  selectedLeadJobId: "",
  selectedProfitJobId: "",
  company: defaultCompany,
  currentUser: defaultCurrentUser,
  companyDocuments: [],
  calendarTasks: [],
  contacts: seedContacts,
  estimates: seedEstimates,
  invoices: [],
  financialPayments: [],
  financialExpenses: [],
  creditNotes: [],
  paymentAllocations: [],
  financialRefunds: [],
  invoiceSchedules: [],
  billingNotices: [],
  projectMembers: [],
  projectDiscussions: [],
  projectNotes: [],
  jobTimeEntries: [],
  permits: [],
  inspections: [],
  jobSelections: [],
  changeOrders: [],
  progressBillings: [],
  maintenancePlans: [],
  maintenanceVisits: [],
  customerAccounts: [],
  accountProperties: [],
  accountContacts: [],
  accountRecordLinks: [],
  projectTemplates: [{ id: "roof-replacement-standard", name: "Standard Roof Replacement", description: "Reusable delivery checkpoints for a typical replacement job", active: true, milestones: ["Permit approved","Materials ordered","Materials delivered","Production scheduled","Installation complete","Final inspection","Final payment received"].map((title) => ({ title })) }],
  leadSources: [],
  leadTags: [],
  recordTags: [],
  customFields: [],
  customFieldValues: [],
  savedLeadFilters: [],
  divisions: [],
  services: [],
  pipelineStages: [],
  emailTemplates: [],
  scheduledMessages: [],
  crmReminders: [],
  crmNotifications: [],
  documentVersions: [],
  documentComments: [],
  documentAccess: [],
  documentTemplates: [],
  signatureRequests: [],
  crmGoals: [],
  reportExports: [],
  taxRates: [],
  paymentMethods: [],
  roleCapabilities: [],
  announcements: [],
  operationalSettings: [],
});

const createEmptyState = () => ({
  ...createInitialState(),
  selectedContactId: null,
  selectedEstimateId: null,
  contacts: [],
  estimates: [],
  calendarTasks: [],
  invoices: [],
  financialPayments: [],
  financialExpenses: [],
  creditNotes: [],
  paymentAllocations: [],
});

let state = normalizeState(createEmptyState());
let deferredInstallPrompt = null;
let toastTimer = null;
let authSession = null;
let cloudClient = null;
let assignableTeam = [];
let cloudReady = false;
let recordPageClient = null;
let recordPageRequestSequence = 0;
let completeCoreRecordsLoaded = false;
let completeCoreRecordsLoad = null;
let completeCoreRecordsAttempts = 0;
let completeCoreRecordsRetryTimer = null;
let serverSearchTimer = null;
let serverSearchSequence = 0;
const serverRecordPages = {
  leads: { items: [], totalCount: 0, hasMore: false, nextCursor: null, queryKey: "", loading: false, error: "" },
  jobs: { items: [], totalCount: 0, hasMore: false, nextCursor: null, queryKey: "", loading: false, error: "" },
};
let cloudSaveTimer = null;
let cloudSaveInFlight = false;
let companySettingsWriter = null;
let salesNumbering = null;
let durableUnmappedRows = [];
// Goes up every time the records held here move on: a save of this tab's is
// confirmed, or someone else's change arrives. A refresh notes it before it
// reads the records. If it has gone up by the time the read is back, what was
// read may be older than what is on screen, and it is thrown away and read
// again. Without this a refresh that began before a lead was deleted put the
// lead back on screen afterwards, with its old version number.
let durableChangeCounter = 0;
const recentCloudWrites = new Map();
let localStateSaveTimer = null;
let localEditRevision = 0;
const localStateWriterId = globalThis.crypto?.randomUUID?.() || `tab-${Date.now()}-${Math.random()}`;
let localStateBaseRevision = 0;
let localStateWriteBlocked = false;
let lastCloudSnapshot = "";
let cloudSubscription = null;
let applyingCloudState = false;
let cloudKnownOwners = new Map();
let durableRecordsReady = false;
let financialLedgerReady = false;
let durableSaveTimer = null;
let durableSaveInFlight = false;
let durableReloadTimer = null;
let durableReloadInFlight = false;
let durableReloadQueued = false;
let durableRecordFingerprints = new Map();
let durableProjectionRevision = -1;
let durableProjection = null;
let durableCommitWriter = null;
let durableWriteBlocked = false;
let durableRejectionReloadPending = false;
const durableFinancialBaseline = new Map();
const protectedPaymentFields = ["manualPayments", "paidAmount", "squarePaidAmount", "square_paid_amount", "squareInvoiceId", "squareOrderId", "paidAt", "lastPaymentAt", "squareLastPaymentAt", "square_last_payment_at", "squareStatus", "paymentRequests", "paymentUpdatedAt"];
let durableAuditIds = new Set();
let durableRecordsSubscription = null;
const durableHeavyLeadLoads = new Map();
let durableCompanyDocumentsLoad = null;
let criticalSaveInFlight = false;
let durableBusinessStateAuthoritative = false;
let durableWritesEnabled = false;
let liveSearchActiveIndex = -1;
const estimateSaveTimers = new Map();
const estimateSaveRevisions = new Map();
const estimateSaveStates = new Map();
const estimateExplicitSaves = new Set();
const estimateCompletedSaveRevisions = new Map();
const recentLocalDurableWrites = new Map();
let estimateVisualRefreshTimer = null;
let pendingDurableRender = false;
const photoPreviewCache = new Map();
const unreadablePhotoPreviews = new Set();
const photoDisplayLimits = new Map();
const leadDocumentDisplayLimits = new Map();
const companyDocumentDisplayLimits = new Map();
let googleIntegrationState = {
  loaded: false, loading: false, configured: false, connected: false, email: "", providerEmail: "",
  calendar: false, gmailSend: false, gmailRead: false, tasks: false, contacts: false,
  drive: false, docs: false, sheets: false, chat: false, gmailPush: false, groups: false,
  docTemplates: [], groupOptions: [],
};
let googleDriveState = { loaded: false, loading: false, configured: false };
let zohoIntegrationState = { loaded: false, loading: false, configured: false, connected: false, email: "", dataCenter: "" };
let smartDocumentPreviewObjectUrl = "";
let smartDocumentPdf = null;
let smartDocumentPdfModule = null;
let smartDocumentPlacementTool = "";
let smartDocumentPlacementLabel = "";
let selectedSmartDocumentFieldId = "";
let smartDocumentRenderToken = 0;
let smartDocumentAnalysisPdf = null;
let smartDocumentZoom = 1;
let selectedCompanyDocumentFolderId = "";
let dashboardCustomizeActive = false;

function roleLabel(role = currentRole()) {
  return String(role || "viewer")
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

const els = {
  brandLogo: document.querySelector("#brandLogo"),
  workspace: document.querySelector(".workspace"),
  viewTitle: document.querySelector("#viewTitle"),
  globalSearch: document.querySelector("#globalSearch"),
  globalSearchResults: document.querySelector("#globalSearchResults"),
  installAppButton: document.querySelector("#installAppButton"),
  importZohoButton: document.querySelector("#importZohoButton"),
  zohoCsvInput: document.querySelector("#zohoCsvInput"),
  addContactButton: document.querySelector("#addContactButton"),
  addLeadFromLeadsButton: document.querySelector("#addLeadFromLeadsButton"),
  leadStageFilter: document.querySelector("#leadStageFilter"),
  leadTagFilter: document.querySelector("#leadTagFilter"),
  savedLeadFilter: document.querySelector("#savedLeadFilter"),
  saveLeadFilterButton: document.querySelector("#saveLeadFilterButton"),
  dashboardDateRange: document.querySelector("#dashboardDateRange"),
  userChip: document.querySelector("#userChip"),
  navItems: [...document.querySelectorAll(".nav-item")],
  views: {
    dashboard: document.querySelector("#dashboardView"),
    leads: document.querySelector("#leadsView"),
    pipeline: document.querySelector("#pipelineView"),
    contacts: document.querySelector("#contactsView"),
    jobs: document.querySelector("#jobsView"),
    projects: document.querySelector("#projectsView"),
    leadDetail: document.querySelector("#leadDetailView"),
    estimates: document.querySelector("#estimatesView"),
    companyDocuments: document.querySelector("#companyDocumentsView"),
    calendar: document.querySelector("#calendarView"),
    tasks: document.querySelector("#tasksView"),
    invoices: document.querySelector("#invoicesView"),
    reviews: document.querySelector("#reviewsView"),
    reports: document.querySelector("#reportsView"),
    company: document.querySelector("#companyView"),
  },
  summaryStrip: document.querySelector("#summaryStrip"),
  dashboardLayout: document.querySelector("#dashboardLayout"),
  dashboardCustomizeButton: document.querySelector("#dashboardCustomizeButton"),
  dashboardResetLayoutButton: document.querySelector("#dashboardResetLayoutButton"),
  dashboardLayoutHelp: document.querySelector("#dashboardLayoutHelp"),
  leaderboardTableBody: document.querySelector("#leaderboardTableBody"),
  leaderboardRangeLabel: document.querySelector("#leaderboardRangeLabel"),
  pipelineOverview: document.querySelector("#pipelineOverview"),
  revenueChart: document.querySelector("#revenueChart"),
  leadSourcesChart: document.querySelector("#leadSourcesChart"),
  jobsByTypeChart: document.querySelector("#jobsByTypeChart"),
  projectStatusChart: document.querySelector("#projectStatusChart"),
  recentActivityList: document.querySelector("#recentActivityList"),
  todayScheduleList: document.querySelector("#todayScheduleList"),
  weatherPanel: document.querySelector("#weatherPanel"),
  pipelineBoard: document.querySelector("#pipelineBoard"),
  leadsList: document.querySelector("#leadsList"),
  contactsTableBody: document.querySelector("#contactsTableBody"),
  jobsTableBody: document.querySelector("#jobsTableBody"),
  projectsGrid: document.querySelector("#projectsGrid"),
  backToContactsButton: document.querySelector("#backToContactsButton"),
  editLeadDetailButton: document.querySelector("#editLeadDetailButton"),
  emailLeadDetailButton: document.querySelector("#emailLeadDetailButton"),
  estimateLeadDetailButton: document.querySelector("#estimateLeadDetailButton"),
  leadDetailTitle: document.querySelector("#leadDetailTitle"),
  leadDetailMeta: document.querySelector("#leadDetailMeta"),
  leadDetailStats: document.querySelector("#leadDetailStats"),
  leadOverviewPanel: document.querySelector("#leadOverviewPanel"),
  leadJobsPanel: document.querySelector("#leadJobsPanel"),
  leadOperationsPanel: document.querySelector("#leadOperationsPanel"),
  operationsJobSelect: document.querySelector("#operationsJobSelect"),
  operationsSummary: document.querySelector("#operationsSummary"),
  permitForm: document.querySelector("#permitForm"),
  inspectionForm: document.querySelector("#inspectionForm"),
  inspectionPermitSelect: document.querySelector("#inspectionPermitSelect"),
  permitsInspectionsList: document.querySelector("#permitsInspectionsList"),
  selectionForm: document.querySelector("#selectionForm"),
  changeOrderForm: document.querySelector("#changeOrderForm"),
  selectionsChangeOrdersList: document.querySelector("#selectionsChangeOrdersList"),
  progressBillingEditor: document.querySelector("#progressBillingEditor"),
  progressBillingPermission: document.querySelector("#progressBillingPermission"),
  progressBillingForm: document.querySelector("#progressBillingForm"),
  progressBillingList: document.querySelector("#progressBillingList"),
  maintenancePlanForm: document.querySelector("#maintenancePlanForm"),
  maintenancePlansList: document.querySelector("#maintenancePlansList"),
  customerAccountForm: document.querySelector("#customerAccountForm"),
  accountPropertyLinkForm: document.querySelector("#accountPropertyLinkForm"),
  operationsAccountSelect: document.querySelector("#operationsAccountSelect"),
  accountPortfolioList: document.querySelector("#accountPortfolioList"),
  operationsSaveStatus: document.querySelector("#operationsSaveStatus"),
  leadJobForm: document.querySelector("#leadJobForm"),
  jobSaveButton: document.querySelector("#jobSaveButton"),
  jobSaveStatus: document.querySelector("#jobSaveStatus"),
  clearJobFormButton: document.querySelector("#clearJobFormButton"),
  leadJobsList: document.querySelector("#leadJobsList"),
  jobMilestonesSection: document.querySelector("#jobMilestonesSection"),
  jobMilestoneForm: document.querySelector("#jobMilestoneForm"),
  jobMilestonesList: document.querySelector("#jobMilestonesList"),
  jobMilestoneProgress: document.querySelector("#jobMilestoneProgress"),
  projectDeliverySection: document.querySelector("#projectDeliverySection"),
  projectTemplateSelect: document.querySelector("#projectTemplateSelect"),
  applyProjectTemplateButton: document.querySelector("#applyProjectTemplateButton"),
  projectMembersList: document.querySelector("#projectMembersList"),
  projectMemberForm: document.querySelector("#projectMemberForm"),
  projectNoteForm: document.querySelector("#projectNoteForm"),
  projectNotesList: document.querySelector("#projectNotesList"),
  projectDiscussionForm: document.querySelector("#projectDiscussionForm"),
  projectDiscussionsList: document.querySelector("#projectDiscussionsList"),
  jobTimeSummary: document.querySelector("#jobTimeSummary"),
  jobTimerBillable: document.querySelector("#jobTimerBillable"),
  jobTimerRate: document.querySelector("#jobTimerRate"),
  toggleJobTimerButton: document.querySelector("#toggleJobTimerButton"),
  jobTimeEntriesList: document.querySelector("#jobTimeEntriesList"),
  leadProfitPanel: document.querySelector("#leadProfitPanel"),
  profitJobSelect: document.querySelector("#profitJobSelect"),
  profitSummary: document.querySelector("#profitSummary"),
  profitCostForm: document.querySelector("#profitCostForm"),
  profitSaveButton: document.querySelector("#profitSaveButton"),
  profitSaveStatus: document.querySelector("#profitSaveStatus"),
  clearProfitCostForm: document.querySelector("#clearProfitCostForm"),
  profitCostList: document.querySelector("#profitCostList"),
  leadPaymentsPanel: document.querySelector("#leadPaymentsPanel"),
  paymentJobSelect: document.querySelector("#paymentJobSelect"),
  paymentSummary: document.querySelector("#paymentSummary"),
  manualPaymentForm: document.querySelector("#manualPaymentForm"),
  manualPaymentSaveButton: document.querySelector("#manualPaymentSaveButton"),
  manualPaymentSaveStatus: document.querySelector("#manualPaymentSaveStatus"),
  clearManualPaymentForm: document.querySelector("#clearManualPaymentForm"),
  manualPaymentList: document.querySelector("#manualPaymentList"),
  leadEmailPanel: document.querySelector("#leadEmailPanel"),
  leadEmailHeading: document.querySelector("#leadEmailHeading"),
  leadEmailJobSelect: document.querySelector("#leadEmailJobSelect"),
  leadEmailForm: document.querySelector("#leadEmailForm"),
  leadEmailTemplate: document.querySelector("#leadEmailTemplate"),
  leadEmailHistory: document.querySelector("#leadEmailHistory"),
  leadEmailSaveStatus: document.querySelector("#leadEmailSaveStatus"),
  copyLeadEmailButton: document.querySelector("#copyLeadEmailButton"),
  leadEmailSubmitLabel: document.querySelector("#leadEmailSubmitLabel"),
  refreshLeadEmailThreadsButton: document.querySelector("#refreshLeadEmailThreadsButton"),
  scheduleLeadEmailButton: document.querySelector("#scheduleLeadEmailButton"),
  leadDocumentsPanel: document.querySelector("#leadDocumentsPanel"),
  leadDocumentHeading: document.querySelector("#leadDocumentHeading"),
  leadDocumentJobSelect: document.querySelector("#leadDocumentJobSelect"),
  leadDocumentsList: document.querySelector("#leadDocumentsList"),
  leadDocumentCategory: document.querySelector("#leadDocumentCategory"),
  uploadLeadDocumentButton: document.querySelector("#uploadLeadDocumentButton"),
  leadDocumentInput: document.querySelector("#leadDocumentInput"),
  leadDocumentUploadStatus: document.querySelector("#leadDocumentUploadStatus"),
  leadDocumentSmartAfterUpload: document.querySelector("#leadDocumentSmartAfterUpload"),
  googleDocTemplateControl: document.querySelector("#googleDocTemplateControl"),
  googleDocTemplateSelect: document.querySelector("#googleDocTemplateSelect"),
  generateGoogleDocButton: document.querySelector("#generateGoogleDocButton"),
  leadPhotosPanel: document.querySelector("#leadPhotosPanel"),
  leadPhotoHeading: document.querySelector("#leadPhotoHeading"),
  leadPhotoJobSelect: document.querySelector("#leadPhotoJobSelect"),
  uploadLeadPhotoButton: document.querySelector("#uploadLeadPhotoButton"),
  leadPhotoInput: document.querySelector("#leadPhotoInput"),
  leadPhotoUploadStatus: document.querySelector("#leadPhotoUploadStatus"),
  leadPhotosGrid: document.querySelector("#leadPhotosGrid"),
  leadConversationPanel: document.querySelector("#leadConversationPanel"),
  leadConversationForm: document.querySelector("#leadConversationForm"),
  conversationSaveButton: document.querySelector("#conversationSaveButton"),
  conversationSaveStatus: document.querySelector("#conversationSaveStatus"),
  leadConversationList: document.querySelector("#leadConversationList"),
  leadActivityPanel: document.querySelector("#leadActivityPanel"),
  leadActivityTimeline: document.querySelector("#leadActivityTimeline"),
  contactDialog: document.querySelector("#contactDialog"),
  contactForm: document.querySelector("#contactForm"),
  contactDialogTitle: document.querySelector("#contactDialogTitle"),
  deleteContactButton: document.querySelector("#deleteContactButton"),
  estimateFromContactButton: document.querySelector("#estimateFromContactButton"),
  closeContactDialog: document.querySelector("#closeContactDialog"),
  estimateList: document.querySelector("#estimateList"),
  estimateHistoryPanel: document.querySelector("#estimateHistoryPanel"),
  estimateHistoryCount: document.querySelector("#estimateHistoryCount"),
  toggleEstimateHistoryButton: document.querySelector("#toggleEstimateHistoryButton"),
  estimateCreatePanel: document.querySelector("#estimateCreatePanel"),
  toggleEstimateCreateButton: document.querySelector("#toggleEstimateCreateButton"),
  estimateActiveSummary: document.querySelector("#estimateActiveSummary"),
  estimateForm: document.querySelector("#estimateForm"),
  newEstimateContactSearch: document.querySelector("#newEstimateContactSearch"),
  newEstimateContact: document.querySelector("#newEstimateContact"),
  newEstimateContactResults: document.querySelector("#newEstimateContactResults"),
  newEstimateJob: document.querySelector("#newEstimateJob"),
  estimateContactSearch: document.querySelector("#estimateContactSearch"),
  estimateContact: document.querySelector("#estimateContact"),
  estimateContactResults: document.querySelector("#estimateContactResults"),
  estimateJob: document.querySelector("#estimateJob"),
  estimateNumber: document.querySelector("#estimateNumber"),
  estimateTitle: document.querySelector("#estimateTitle"),
  estimateStatus: document.querySelector("#estimateStatus"),
  projectManager: document.querySelector("#projectManager"),
  salesRepEmail: document.querySelector("#salesRepEmail"),
  salesRepPhone: document.querySelector("#salesRepPhone"),
  issueDate: document.querySelector("#issueDate"),
  validUntil: document.querySelector("#validUntil"),
  scopeSummary: document.querySelector("#scopeSummary"),
  lineItems: document.querySelector("#lineItems"),
  taxRate: document.querySelector("#taxRate"),
  deposit: document.querySelector("#deposit"),
  estimateNotes: document.querySelector("#estimateNotes"),
  estimateSaveStatus: document.querySelector("#estimateSaveStatus"),
  saveEstimateButton: document.querySelector("#saveEstimateButton"),
  newEstimateButton: document.querySelector("#newEstimateButton"),
  addLineItemButton: document.querySelector("#addLineItemButton"),
  lineItemTemplatesButton: document.querySelector("#lineItemTemplatesButton"),
  templatePicker: document.querySelector("#templatePicker"),
  deleteEstimateButton: document.querySelector("#deleteEstimateButton"),
  copyEstimateButton: document.querySelector("#copyEstimateButton"),
  printEstimateButton: document.querySelector("#printEstimateButton"),
  sendEstimateButton: document.querySelector("#sendEstimateButton"),
  estimatePreview: document.querySelector("#estimatePreview"),
  dashboardTasksList: document.querySelector("#dashboardTasksList"),
  tasksPageList: document.querySelector("#tasksPageList"),
  invoicesList: document.querySelector("#invoicesList"),
  invoicePaymentDialog: document.querySelector("#invoicePaymentDialog"),
  invoicePaymentForm: document.querySelector("#invoicePaymentForm"),
  invoicePaymentTitle: document.querySelector("#invoicePaymentTitle"),
  closeInvoicePaymentDialog: document.querySelector("#closeInvoicePaymentDialog"),
  invoiceCreditDialog: document.querySelector("#invoiceCreditDialog"),
  invoiceCreditForm: document.querySelector("#invoiceCreditForm"),
  invoiceCreditTitle: document.querySelector("#invoiceCreditTitle"),
  closeInvoiceCreditDialog: document.querySelector("#closeInvoiceCreditDialog"),
  financeExpenseDialog: document.querySelector("#financeExpenseDialog"),
  financeExpenseForm: document.querySelector("#financeExpenseForm"),
  closeFinanceExpenseDialog: document.querySelector("#closeFinanceExpenseDialog"),
  invoiceRefundDialog: document.querySelector("#invoiceRefundDialog"),
  invoiceRefundForm: document.querySelector("#invoiceRefundForm"),
  invoiceRefundTitle: document.querySelector("#invoiceRefundTitle"),
  closeInvoiceRefundDialog: document.querySelector("#closeInvoiceRefundDialog"),
  invoiceScheduleDialog: document.querySelector("#invoiceScheduleDialog"),
  invoiceScheduleForm: document.querySelector("#invoiceScheduleForm"),
  invoiceScheduleTitle: document.querySelector("#invoiceScheduleTitle"),
  closeInvoiceScheduleDialog: document.querySelector("#closeInvoiceScheduleDialog"),
  reviewsList: document.querySelector("#reviewsList"),
  reportsContent: document.querySelector("#reportsContent"),
  reportExportButton: document.querySelector("#reportExportButton"),
  googleSheetsExportButton: document.querySelector("#googleSheetsExportButton"),
  saveIndicator: document.querySelector("#saveIndicator"),
  companyDocumentCategory: document.querySelector("#companyDocumentCategory"),
  createCompanyDocumentFolderButton: document.querySelector("#createCompanyDocumentFolderButton"),
  uploadCompanyDocumentButton: document.querySelector("#uploadCompanyDocumentButton"),
  companyDocumentInput: document.querySelector("#companyDocumentInput"),
  companyDocumentUploadStatus: document.querySelector("#companyDocumentUploadStatus"),
  companyDocumentSmartAfterUpload: document.querySelector("#companyDocumentSmartAfterUpload"),
  companyDocumentsList: document.querySelector("#companyDocumentsList"),
  documentOperationsDialog: document.querySelector("#documentOperationsDialog"),
  documentOperationsForm: document.querySelector("#documentOperationsForm"),
  documentOperationsTitle: document.querySelector("#documentOperationsTitle"),
  documentVersionHistory: document.querySelector("#documentVersionHistory"),
  documentCommentList: document.querySelector("#documentCommentList"),
  documentOperationsStatus: document.querySelector("#documentOperationsStatus"),
  closeDocumentOperationsDialog: document.querySelector("#closeDocumentOperationsDialog"),
  calendarTaskForm: document.querySelector("#calendarTaskForm"),
  salesRepOptions: document.querySelector("#salesRepOptions"),
  calendarTaskContact: document.querySelector("#calendarTaskContact"),
  calendarTaskJob: document.querySelector("#calendarTaskJob"),
  calendarGoogleDestination: document.querySelector("#calendarGoogleDestination"),
  calendarTasksList: document.querySelector("#calendarTasksList"),
  calMonthGrid: document.querySelector("#calMonthGrid"),
  calMonthTitle: document.querySelector("#calMonthTitle"),
  calPrevMonth: document.querySelector("#calPrevMonth"),
  calNextMonth: document.querySelector("#calNextMonth"),
  calDayDetail: document.querySelector("#calDayDetail"),
  calDayDetailTitle: document.querySelector("#calDayDetailTitle"),
  calDayDetailTasks: document.querySelector("#calDayDetailTasks"),
  calendarViewSwitcher: document.querySelector("#calendarViewSwitcher"),
  calendarTodayButton: document.querySelector("#calendarTodayButton"),
  calendarNewTaskButton: document.querySelector("#calendarNewTaskButton"),
  calendarDatePicker: document.querySelector("#calendarDatePicker"),
  calendarRepFilters: document.querySelector("#calendarRepFilters"),
  calendarSelectAllReps: document.querySelector("#calendarSelectAllReps"),
  calendarEditorPanel: document.querySelector("#calendarEditorPanel"),
  calendarEditorTitle: document.querySelector("#calendarEditorTitle"),
  calendarEditorClose: document.querySelector("#calendarEditorClose"),
  calendarEventContext: document.querySelector("#calendarEventContext"),
  calendarDeleteTaskButton: document.querySelector("#calendarDeleteTaskButton"),
  companyForm: document.querySelector("#companyForm"),
  adminOperationsSettings: document.querySelector("#adminOperationsSettings"),
  adminTaxForm: document.querySelector("#adminTaxForm"),
  adminTaxList: document.querySelector("#adminTaxList"),
  adminAnnouncementForm: document.querySelector("#adminAnnouncementForm"),
  adminConfigurationSummary: document.querySelector("#adminConfigurationSummary"),
  customerPortalInviteForm: document.querySelector("#customerPortalInviteForm"),
  customerPortalLead: document.querySelector("#customerPortalLead"),
  customerPortalInviteStatus: document.querySelector("#customerPortalInviteStatus"),
  companyLogoInput: document.querySelector("#companyLogoInput"),
  uploadCompanyLogoButton: document.querySelector("#uploadCompanyLogoButton"),
  removeCompanyLogoButton: document.querySelector("#removeCompanyLogoButton"),
  companyLogoPreview: document.querySelector("#companyLogoPreview"),
  documentCategoryCreateForm: document.querySelector("#documentCategoryCreateForm"),
  documentCategoriesList: document.querySelector("#documentCategoriesList"),
  googleIntegrationStatus: document.querySelector("#googleIntegrationStatus"),
  googleIntegrationPill: document.querySelector("#googleIntegrationPill"),
  googleDriveIntegrationStatus: document.querySelector("#googleDriveIntegrationStatus"),
  googleProductsIntegrationStatus: document.querySelector("#googleProductsIntegrationStatus"),
  connectGoogleWorkspaceButton: document.querySelector("#connectGoogleWorkspaceButton"),
  verifyGoogleDriveButton: document.querySelector("#verifyGoogleDriveButton"),
  disconnectGoogleWorkspaceButton: document.querySelector("#disconnectGoogleWorkspaceButton"),
  calendarGoogleConnect: document.querySelector("#calendarGoogleConnect"),
  calendarGoogleConnectButton: document.querySelector("#calendarGoogleConnectButton"),
  zohoIntegrationStatus: document.querySelector("#zohoIntegrationStatus"),
  zohoIntegrationPill: document.querySelector("#zohoIntegrationPill"),
  connectZohoSignButton: document.querySelector("#connectZohoSignButton"),
  disconnectZohoSignButton: document.querySelector("#disconnectZohoSignButton"),
  zohoSignDialog: document.querySelector("#zohoSignDialog"),
  zohoSignForm: document.querySelector("#zohoSignForm"),
  zohoSignDocumentName: document.querySelector("#zohoSignDocumentName"),
  zohoSignSaveStatus: document.querySelector("#zohoSignSaveStatus"),
  prepareZohoSignButton: document.querySelector("#prepareZohoSignButton"),
  closeZohoSignDialog: document.querySelector("#closeZohoSignDialog"),
  cancelZohoSignDialog: document.querySelector("#cancelZohoSignDialog"),
  smartDocumentDialog: document.querySelector("#smartDocumentDialog"),
  smartDocumentForm: document.querySelector("#smartDocumentForm"),
  smartDocumentTitle: document.querySelector("#smartDocumentTitle"),
  smartDocumentMeta: document.querySelector("#smartDocumentMeta"),
  smartDocumentPreview: document.querySelector("#smartDocumentPreview"),
  smartDocumentPreviewFallback: document.querySelector("#smartDocumentPreviewFallback"),
  smartDocumentPages: document.querySelector("#smartDocumentPages"),
  smartDocumentThumbnails: document.querySelector("#smartDocumentThumbnails"),
  smartDocumentPreviewPane: document.querySelector("#smartDocumentPreviewPane"),
  smartDocumentPageNumber: document.querySelector("#smartDocumentPageNumber"),
  smartDocumentPageCount: document.querySelector("#smartDocumentPageCount"),
  smartDocumentZoomOut: document.querySelector("#smartDocumentZoomOut"),
  smartDocumentZoomIn: document.querySelector("#smartDocumentZoomIn"),
  smartDocumentZoomFit: document.querySelector("#smartDocumentZoomFit"),
  smartDocumentZoomValue: document.querySelector("#smartDocumentZoomValue"),
  smartDocumentEditorPanel: document.querySelector("#smartDocumentEditorPanel"),
  smartDocumentCanvasHelp: document.querySelector("#smartDocumentCanvasHelp"),
  analyzeSmartDocument: document.querySelector("#analyzeSmartDocument"),
  deleteSelectedSmartField: document.querySelector("#deleteSelectedSmartField"),
  smartDocumentFields: document.querySelector("#smartDocumentFields"),
  smartDocumentResponses: document.querySelector("#smartDocumentResponses"),
  smartDocumentEmailPanel: document.querySelector("#smartDocumentEmailPanel"),
  smartDocumentSaveStatus: document.querySelector("#smartDocumentSaveStatus"),
  addSmartDocumentField: document.querySelector("#addSmartDocumentField"),
  saveSmartDocumentTemplate: document.querySelector("#saveSmartDocumentTemplate"),
  saveSmartDocumentDraft: document.querySelector("#saveSmartDocumentDraft"),
  completeSmartDocument: document.querySelector("#completeSmartDocument"),
  emailSmartDocument: document.querySelector("#emailSmartDocument"),
  closeSmartDocumentDialog: document.querySelector("#closeSmartDocumentDialog"),
  toast: document.querySelector("#toast"),
};

function activeStorageKey() {
  return authSession?.user?.id ? `${STORAGE_KEY}:${authSession.user.id}` : STORAGE_KEY;
}

function localStateMetadataKey(storageKey = activeStorageKey()) {
  return `${storageKey}:write-metadata`;
}

function readLocalStateMetadata(storageKey = activeStorageKey()) {
  try {
    const metadata = JSON.parse(localStorage.getItem(localStateMetadataKey(storageKey)) || "null");
    return metadata && Number.isFinite(Number(metadata.revision))
      ? { revision: Number(metadata.revision), writerId: String(metadata.writerId || "") }
      : { revision: 0, writerId: "" };
  } catch {
    return { revision: 0, writerId: "" };
  }
}

function activeUiStorageKey() {
  return authSession?.user?.id ? `${UI_STORAGE_KEY}:${authSession.user.id}` : UI_STORAGE_KEY;
}

function uiStateSnapshot() {
  return {
    view: state.view,
    search: state.search,
    pipelineFilter: state.pipelineFilter,
    pipelineDivision: state.pipelineDivision,
    pipelinePropertyType: state.pipelinePropertyType,
    pipelineRep: state.pipelineRep,
    pipelineService: state.pipelineService,
    pipelineSource: state.pipelineSource,
    pipelineUrgency: state.pipelineUrgency,
    pipelineDateRange: state.pipelineDateRange,
    pipelineStaleDays: state.pipelineStaleDays,
    pipelineAttention: state.pipelineAttention,
    pipelineWorklist: Boolean(state.pipelineWorklist),
    pipelineSelectedOpportunity: state.pipelineSelectedOpportunity,
    pipelineGuidanceStage: state.pipelineGuidanceStage,
    leadStageFilter: state.leadStageFilter,
    sidebarMode: state.sidebarMode || "auto",
    reminderFilter: state.reminderFilter || "all",
    leadTagFilter: state.leadTagFilter,
    savedLeadFilterId: state.savedLeadFilterId,
    leaderboardRange: state.leaderboardRange,
    dashboardWidgetLayout: state.dashboardWidgetLayout,
    leadDetailTab: state.leadDetailTab,
    financeTab: state.financeTab,
    selectedContactId: state.selectedContactId,
    selectedEstimateId: state.selectedEstimateId,
    newEstimateContactId: state.newEstimateContactId,
    newEstimateJobId: state.newEstimateJobId,
    selectedLeadJobId: state.selectedLeadJobId,
    selectedProfitJobId: state.selectedProfitJobId,
  };
}

function loadUiState(storageKey = activeUiStorageKey()) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveUiState() {
  try {
    localStorage.setItem(activeUiStorageKey(), JSON.stringify(uiStateSnapshot()));
    return true;
  } catch {
    return false;
  }
}

function loadState(storageKey = activeStorageKey(), cachedState = null) {
  try {
    if (!canUseCloudSync()) localStateBaseRevision = readLocalStateMetadata(storageKey).revision;
    if (cachedState && typeof cachedState === "object" && !Array.isArray(cachedState)) {
      return normalizeState({
        ...(authSession?.user?.id ? createEmptyState() : createInitialState()),
        ...cachedState,
        ...loadUiState(),
        company: normalizeCompany(cachedState.company),
        currentUser: { ...defaultCurrentUser, ...(cachedState.currentUser || {}) },
      });
    }
    const raw = localStorage.getItem(storageKey);
    if (!raw && authSession?.user?.id && canManageTeamData()) {
      const legacyRaw = localStorage.getItem(STORAGE_KEY);
      if (legacyRaw) {
        const legacyParsed = JSON.parse(legacyRaw);
        return normalizeState({
          ...createEmptyState(),
          ...legacyParsed,
          ...loadUiState(),
          company: normalizeCompany(legacyParsed.company),
          currentUser: { ...defaultCurrentUser, ...(legacyParsed.currentUser || {}) },
        });
      }
    }
    if (!raw) return normalizeState({ ...(authSession?.user?.id ? createEmptyState() : createInitialState()), ...loadUiState() });
    const parsed = JSON.parse(raw);
    return normalizeState({
      ...(authSession?.user?.id ? createEmptyState() : createInitialState()),
      ...parsed,
      ...loadUiState(),
      company: normalizeCompany(parsed.company),
      currentUser: { ...defaultCurrentUser, ...(parsed.currentUser || {}) },
    });
  } catch {
    return normalizeState(authSession?.user?.id ? createEmptyState() : createInitialState());
  }
}

function normalizeState(nextState) {
  const company = normalizeCompany(nextState.company);
  company.companyDocumentFolders = companyDocumentFoldersWithLegacy(company.companyDocumentFolders, nextState.companyDocuments || []);
  company.documentCategories = categoriesWithLegacyDocuments(company.documentCategories, nextState.contacts || []);
  const contacts = (nextState.contacts || [])
    .map((contact) => normalizeContact(contact, company.documentCategories))
    .filter((contact) => isSafeRecordId(contact.id))
    .map((contact) => ({
      ...contact,
      jobs: (contact.jobs || []).filter((job) => isSafeRecordId(job.id)),
      documents: (contact.documents || []).filter((document) => isSafeRecordId(document.id)),
      updates: (contact.updates || []).filter((update) => isSafeRecordId(update.id)),
    }));
  return {
    ...nextState,
    leaderboardRange: nextState.leaderboardRange || "month",
    dashboardWidgetLayout: normalizeDashboardWidgetLayout(nextState.dashboardWidgetLayout),
    leadStageFilter: [...new Set([...Object.values(defaultPipelineStages).flat(), ...(nextState.pipelineStages || []).map((item) => item.name), "Lost"])].includes(nextState.leadStageFilter) ? nextState.leadStageFilter : "",
    pipelineDivision: ["roofing", "construction", "services"].includes(nextState.pipelineDivision) ? nextState.pipelineDivision : "roofing",
    pipelinePropertyType: ["all", "residential", "commercial", "hoa"].includes(nextState.pipelinePropertyType) ? nextState.pipelinePropertyType : "all",
    pipelineRep: nextState.pipelineRep || "all",
    pipelineService: nextState.pipelineService || "all",
    pipelineSource: nextState.pipelineSource || "all",
    pipelineUrgency: nextState.pipelineUrgency || "all",
    pipelineDateRange: ["all", "30", "90", "365"].includes(nextState.pipelineDateRange) ? nextState.pipelineDateRange : "all",
    pipelineStaleDays: Math.min(90, Math.max(1, Math.round(number(nextState.pipelineStaleDays) || 7))),
    pipelineAttention: nextState.pipelineAttention || "all",
    pipelineWorklist: nextState.pipelineWorklist === true,
    pipelineSelectedOpportunity: nextState.pipelineSelectedOpportunity || "",
    pipelineGuidanceStage: nextState.pipelineGuidanceStage || "",
    sidebarMode: ["expanded", "compact"].includes(nextState.sidebarMode) ? nextState.sidebarMode : "auto",
    reminderFilter: ["overdue", "today", "estimates", "upcoming", "completed"].includes(nextState.reminderFilter) ? nextState.reminderFilter : "all",
    leadTagFilter: nextState.leadTagFilter || "",
    savedLeadFilterId: nextState.savedLeadFilterId || "",
    leadDetailTab: nextState.leadDetailTab || "overview",
    financeTab: ["invoices", "payments", "expenses", "credits"].includes(nextState.financeTab) ? nextState.financeTab : "invoices",
    newEstimateContactId: nextState.newEstimateContactId || "",
    newEstimateJobId: nextState.newEstimateJobId || "",
    selectedLeadJobId: nextState.selectedLeadJobId || "",
    selectedProfitJobId: nextState.selectedProfitJobId || "",
    company,
    currentUser: { ...defaultCurrentUser, ...(nextState.currentUser || {}) },
    contacts,
    companyDocuments: (nextState.companyDocuments || []).map((document) => normalizeDocument(document)).filter((document) => isSafeRecordId(document.id)),
    calendarTasks: (nextState.calendarTasks || []).map(normalizeCalendarTask).filter((task) => isSafeRecordId(task.id)),
    estimates: (nextState.estimates || []).map((estimate) => normalizeEstimate(estimate, contacts)).filter((estimate) => isSafeRecordId(estimate.id)),
    invoices: (nextState.invoices || []).map(normalizeInvoice).filter((invoice) => isSafeRecordId(invoice.id)),
    financialPayments: (nextState.financialPayments || []).filter(isInvoicePaymentRow).map(normalizeFinancialPayment).filter((payment) => isSafeRecordId(payment.id)),
    financialExpenses: (nextState.financialExpenses || []).map(normalizeFinancialExpense).filter((expense) => isSafeRecordId(expense.id)),
    creditNotes: (nextState.creditNotes || []).map(normalizeCreditNote).filter((credit) => isSafeRecordId(credit.id)),
    paymentAllocations: (nextState.paymentAllocations || []).map(normalizePaymentAllocation).filter((allocation) => isSafeRecordId(allocation.id)),
    financialRefunds: (nextState.financialRefunds || []).map(normalizeFinancialRefund).filter((refund) => isSafeRecordId(refund.id)),
    invoiceSchedules: (nextState.invoiceSchedules || []).map(normalizeInvoiceSchedule).filter((schedule) => isSafeRecordId(schedule.id)),
    billingNotices: (nextState.billingNotices || []).map(normalizeBillingNotice).filter((notice) => isSafeRecordId(notice.id)),
    projectMembers: (nextState.projectMembers || []).map(normalizeProjectMember).filter((item) => isSafeRecordId(item.id)),
    projectDiscussions: (nextState.projectDiscussions || []).map(normalizeProjectDiscussion).filter((item) => isSafeRecordId(item.id)),
    projectNotes: (nextState.projectNotes || []).map(normalizeProjectNote).filter((item) => isSafeRecordId(item.id)),
    jobTimeEntries: (nextState.jobTimeEntries || []).map(normalizeJobTimeEntry).filter((item) => isSafeRecordId(item.id)),
    projectTemplates: (nextState.projectTemplates || []).map(normalizeProjectTemplate).filter((item) => isSafeRecordId(item.id)),
    permits: (nextState.permits || []).map(normalizeJobOperation).filter((item) => isSafeRecordId(item.id)),
    inspections: (nextState.inspections || []).map(normalizeJobOperation).filter((item) => isSafeRecordId(item.id)),
    jobSelections: (nextState.jobSelections || []).map(normalizeJobOperation).filter((item) => isSafeRecordId(item.id)),
    changeOrders: (nextState.changeOrders || []).map(normalizeJobOperation).filter((item) => isSafeRecordId(item.id)),
    progressBillings: (nextState.progressBillings || []).map(normalizeJobOperation).filter((item) => isSafeRecordId(item.id)),
    maintenancePlans: (nextState.maintenancePlans || []).map(normalizeJobOperation).filter((item) => isSafeRecordId(item.id)),
    maintenanceVisits: (nextState.maintenanceVisits || []).map(normalizeJobOperation).filter((item) => isSafeRecordId(item.id)),
    customerAccounts: (nextState.customerAccounts || []).map(normalizeCustomerAccount).filter((item) => isSafeRecordId(item.id)),
    accountProperties: (nextState.accountProperties || []).map(normalizeAccountProperty).filter((item) => isSafeRecordId(item.id)),
    accountContacts: (nextState.accountContacts || []).map(normalizeAccountContact).filter((item) => isSafeRecordId(item.id)),
    accountRecordLinks: (nextState.accountRecordLinks || []).map(normalizeAccountRecordLink).filter((item) => isSafeRecordId(item.id)),
    leadSources: Array.isArray(nextState.leadSources) ? nextState.leadSources : [],
    leadTags: Array.isArray(nextState.leadTags) ? nextState.leadTags : [],
    recordTags: Array.isArray(nextState.recordTags) ? nextState.recordTags : [],
    customFields: Array.isArray(nextState.customFields) ? nextState.customFields : [],
    customFieldValues: Array.isArray(nextState.customFieldValues) ? nextState.customFieldValues : [],
    savedLeadFilters: Array.isArray(nextState.savedLeadFilters) ? nextState.savedLeadFilters : [],
    divisions: Array.isArray(nextState.divisions) ? nextState.divisions : [],
    services: Array.isArray(nextState.services) ? nextState.services : [],
    pipelineStages: Array.isArray(nextState.pipelineStages) ? nextState.pipelineStages : [],
    emailTemplates: Array.isArray(nextState.emailTemplates) ? nextState.emailTemplates : [],
    scheduledMessages: Array.isArray(nextState.scheduledMessages) ? nextState.scheduledMessages : [],
    crmReminders: Array.isArray(nextState.crmReminders) ? nextState.crmReminders : [],
    crmNotifications: Array.isArray(nextState.crmNotifications) ? nextState.crmNotifications : [],
    documentVersions: Array.isArray(nextState.documentVersions) ? nextState.documentVersions : [],
    documentComments: Array.isArray(nextState.documentComments) ? nextState.documentComments : [],
    documentAccess: Array.isArray(nextState.documentAccess) ? nextState.documentAccess : [],
    documentTemplates: Array.isArray(nextState.documentTemplates) ? nextState.documentTemplates : [],
    signatureRequests: Array.isArray(nextState.signatureRequests) ? nextState.signatureRequests : [],
    crmGoals: Array.isArray(nextState.crmGoals) ? nextState.crmGoals : [],
    reportExports: Array.isArray(nextState.reportExports) ? nextState.reportExports : [],
    taxRates: Array.isArray(nextState.taxRates) ? nextState.taxRates : [],
    paymentMethods: Array.isArray(nextState.paymentMethods) ? nextState.paymentMethods : [],
    roleCapabilities: Array.isArray(nextState.roleCapabilities) ? nextState.roleCapabilities : [],
    announcements: Array.isArray(nextState.announcements) ? nextState.announcements : [],
    operationalSettings: Array.isArray(nextState.operationalSettings) ? nextState.operationalSettings : [],
  };
}

