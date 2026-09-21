const STORAGE_KEY = "roofline-crm-v1";
const SUPABASE_CRM_TABLE = "crm_state";
const SUPABASE_RECORDS_TABLE = "crm_records";
const SUPABASE_AUDIT_TABLE = "crm_audit_events";
const SUPABASE_DOCUMENT_BUCKET = "crm-documents";
const CLOUD_SAVE_DELAY = 700;
const COMPANY_STATE_SUFFIX = "company";
const COMPANY_DOCUMENT_LEAD_ID = "company";
const JOB_PHOTO_CATEGORY_ID = "job_photos";
const MAX_DOCUMENT_FILE_SIZE = 250 * 1024 * 1024;

const todayISO = () => new Date().toISOString().slice(0, 10);

const addDaysISO = (days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
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
const soldJobStatuses = ["Won", "Scheduled", "Materials Ordered", "In Progress", "Completed", "Paid"];
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
    actions: [...sharedCrmActions],
  },
  sales: {
    views: [...sharedCrmViews],
    actions: [...sharedCrmActions],
  },
  production: {
    views: [...sharedCrmViews],
    actions: [...sharedCrmActions],
  },
  viewer: {
    views: [...sharedCrmViews],
    actions: [...sharedCrmActions],
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

const documentCategoryIcons = ["folder", "file", "check", "dollar", "invoice", "upload"];

const estimateTemplates = [
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
  leadStageFilter: "",
  leaderboardRange: "month",
  leadDetailTab: "overview",
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
});

const createEmptyState = () => ({
  ...createInitialState(),
  selectedContactId: null,
  selectedEstimateId: null,
  contacts: [],
  estimates: [],
  calendarTasks: [],
});

let state = normalizeState(createEmptyState());
let deferredInstallPrompt = null;
let toastTimer = null;
let authSession = null;
let cloudClient = null;
let cloudReady = false;
let cloudSaveTimer = null;
let cloudSaveInFlight = false;
let companySettingsWriter = null;
let salesNumbering = null;
let durableUnmappedRows = [];
const recentCloudWrites = new Map();
let localStateSaveTimer = null;
let localEditRevision = 0;
let lastCloudSnapshot = "";
let cloudSubscription = null;
let applyingCloudState = false;
let cloudKnownOwners = new Map();
let durableRecordsReady = false;
let durableSaveTimer = null;
let durableSaveInFlight = false;
let durableReloadTimer = null;
let durableReloadInFlight = false;
let durableReloadQueued = false;
let durableRecordFingerprints = new Map();
let durableCommitWriter = null;
let durableWriteBlocked = false;
const durableFinancialBaseline = new Map();
const protectedPaymentFields = ["manualPayments", "paidAmount", "squarePaidAmount", "square_paid_amount", "squareInvoiceId", "squareOrderId", "paidAt", "lastPaymentAt", "squareLastPaymentAt", "square_last_payment_at", "squareStatus", "paymentRequests", "paymentUpdatedAt"];
let durableAuditIds = new Set();
let durableRecordsSubscription = null;
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
  leadJobForm: document.querySelector("#leadJobForm"),
  jobSaveButton: document.querySelector("#jobSaveButton"),
  jobSaveStatus: document.querySelector("#jobSaveStatus"),
  clearJobFormButton: document.querySelector("#clearJobFormButton"),
  leadJobsList: document.querySelector("#leadJobsList"),
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
  leadEmailHistory: document.querySelector("#leadEmailHistory"),
  leadEmailSaveStatus: document.querySelector("#leadEmailSaveStatus"),
  copyLeadEmailButton: document.querySelector("#copyLeadEmailButton"),
  leadDocumentsPanel: document.querySelector("#leadDocumentsPanel"),
  leadDocumentHeading: document.querySelector("#leadDocumentHeading"),
  leadDocumentJobSelect: document.querySelector("#leadDocumentJobSelect"),
  leadDocumentsList: document.querySelector("#leadDocumentsList"),
  leadDocumentCategory: document.querySelector("#leadDocumentCategory"),
  uploadLeadDocumentButton: document.querySelector("#uploadLeadDocumentButton"),
  leadDocumentInput: document.querySelector("#leadDocumentInput"),
  leadDocumentUploadStatus: document.querySelector("#leadDocumentUploadStatus"),
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
  newEstimateContact: document.querySelector("#newEstimateContact"),
  newEstimateJob: document.querySelector("#newEstimateJob"),
  estimateContact: document.querySelector("#estimateContact"),
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
  reviewsList: document.querySelector("#reviewsList"),
  reportsContent: document.querySelector("#reportsContent"),
  companyDocumentCategory: document.querySelector("#companyDocumentCategory"),
  uploadCompanyDocumentButton: document.querySelector("#uploadCompanyDocumentButton"),
  companyDocumentInput: document.querySelector("#companyDocumentInput"),
  companyDocumentUploadStatus: document.querySelector("#companyDocumentUploadStatus"),
  companyDocumentsList: document.querySelector("#companyDocumentsList"),
  calendarTaskForm: document.querySelector("#calendarTaskForm"),
  salesRepOptions: document.querySelector("#salesRepOptions"),
  calendarTaskContact: document.querySelector("#calendarTaskContact"),
  calendarTasksList: document.querySelector("#calendarTasksList"),
  calMonthGrid: document.querySelector("#calMonthGrid"),
  calMonthTitle: document.querySelector("#calMonthTitle"),
  calPrevMonth: document.querySelector("#calPrevMonth"),
  calNextMonth: document.querySelector("#calNextMonth"),
  calDayDetail: document.querySelector("#calDayDetail"),
  calDayDetailTitle: document.querySelector("#calDayDetailTitle"),
  calDayDetailTasks: document.querySelector("#calDayDetailTasks"),
  companyForm: document.querySelector("#companyForm"),
  companyLogoInput: document.querySelector("#companyLogoInput"),
  uploadCompanyLogoButton: document.querySelector("#uploadCompanyLogoButton"),
  removeCompanyLogoButton: document.querySelector("#removeCompanyLogoButton"),
  companyLogoPreview: document.querySelector("#companyLogoPreview"),
  documentCategoryCreateForm: document.querySelector("#documentCategoryCreateForm"),
  documentCategoriesList: document.querySelector("#documentCategoriesList"),
  toast: document.querySelector("#toast"),
};

function activeStorageKey() {
  return authSession?.user?.id ? `${STORAGE_KEY}:${authSession.user.id}` : STORAGE_KEY;
}

function loadState(storageKey = activeStorageKey()) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw && authSession?.user?.id && canManageTeamData()) {
      const legacyRaw = localStorage.getItem(STORAGE_KEY);
      if (legacyRaw) {
        const legacyParsed = JSON.parse(legacyRaw);
        return normalizeState({
          ...createEmptyState(),
          ...legacyParsed,
          company: normalizeCompany(legacyParsed.company),
          currentUser: { ...defaultCurrentUser, ...(legacyParsed.currentUser || {}) },
        });
      }
    }
    if (!raw) return normalizeState(authSession?.user?.id ? createEmptyState() : createInitialState());
    const parsed = JSON.parse(raw);
    return normalizeState({
      ...(authSession?.user?.id ? createEmptyState() : createInitialState()),
      ...parsed,
      company: normalizeCompany(parsed.company),
      currentUser: { ...defaultCurrentUser, ...(parsed.currentUser || {}) },
    });
  } catch {
    return normalizeState(authSession?.user?.id ? createEmptyState() : createInitialState());
  }
}

function normalizeState(nextState) {
  const company = normalizeCompany(nextState.company);
  company.documentCategories = categoriesWithLegacyDocuments(company.documentCategories, nextState.contacts || []);
  const contacts = (nextState.contacts || []).map((contact) => normalizeContact(contact, company.documentCategories));
  return {
    ...nextState,
    leaderboardRange: nextState.leaderboardRange || "month",
    leadStageFilter: statuses.includes(nextState.leadStageFilter) ? nextState.leadStageFilter : "",
    leadDetailTab: nextState.leadDetailTab || "overview",
    newEstimateContactId: nextState.newEstimateContactId || "",
    newEstimateJobId: nextState.newEstimateJobId || "",
    selectedLeadJobId: nextState.selectedLeadJobId || "",
    selectedProfitJobId: nextState.selectedProfitJobId || "",
    company,
    currentUser: { ...defaultCurrentUser, ...(nextState.currentUser || {}) },
    contacts,
    companyDocuments: (nextState.companyDocuments || []).map((document) => normalizeDocument(document)),
    calendarTasks: (nextState.calendarTasks || []).map(normalizeCalendarTask),
    estimates: (nextState.estimates || []).map((estimate) => normalizeEstimate(estimate, contacts)),
  };
}

function normalizeCompany(company = {}) {
  const merged = { ...defaultCompany, ...(company || {}) };
  const officeAddress = merged.officeAddress || merged.address || defaultCompany.officeAddress;
  return {
    ...merged,
    address: merged.address || officeAddress,
    officeAddress,
    logoDataUrl: merged.logoDataUrl || "",
    documentCategories: normalizeDocumentCategories(merged.documentCategories),
  };
}

function normalizeDocumentCategory(category = {}, index = 0) {
  const now = new Date().toISOString();
  return {
    id: category.id || uid("doccat"),
    name: String(category.name || `Category ${index + 1}`).trim(),
    displayOrder: Number.isFinite(Number(category.displayOrder)) ? Number(category.displayOrder) : index,
    icon: documentCategoryIcons.includes(category.icon) ? category.icon : "folder",
    color: /^#[0-9a-f]{6}$/i.test(String(category.color || "")) ? category.color : "#64748b",
    active: category.active !== false,
    createdAt: category.createdAt || now,
    updatedAt: category.updatedAt || category.lastModifiedAt || category.createdAt || now,
  };
}

function normalizeDocumentCategories(categories) {
  const source = Array.isArray(categories) ? categories : defaultDocumentCategories;
  return source
    .map(normalizeDocumentCategory)
    .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name))
    .map((category, displayOrder) => ({ ...category, displayOrder }));
}

function documentCategoryNameKey(name = "") {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/s$/, "");
}

function categoriesWithLegacyDocuments(categories, contacts) {
  const migrated = [...categories];
  contacts.forEach((contact) => {
    (contact.documents || []).forEach((document) => {
      const name = String(document.category || "").trim();
      if (!name) return;
      const nameKey = documentCategoryNameKey(name);
      const exists = migrated.some(
        (category) => category.id === document.categoryId || documentCategoryNameKey(category.name) === nameKey,
      );
      if (exists) return;
      const slug = nameKey || Math.random().toString(36).slice(2, 8);
      const createdAt = document.uploadedAt || DOCUMENT_CATEGORY_CREATED_AT;
      migrated.push(
        normalizeDocumentCategory({
          id: document.categoryId || `doccat_${slug}`,
          name,
          displayOrder: migrated.length,
          icon: "folder",
          color: "#64748b",
          active: true,
          createdAt,
          updatedAt: createdAt,
        }),
      );
    });
  });
  return normalizeDocumentCategories(migrated);
}

function categoryForLegacyName(name, categories = defaultDocumentCategories) {
  const normalizedName = documentCategoryNameKey(name || "Other");
  return (
    categories.find((category) => documentCategoryNameKey(category.name) === normalizedName) ||
    categories.find((category) => category.name.toLowerCase() === "other") ||
    categories[0]
  );
}

function normalizeContact(contact, categories = defaultDocumentCategories) {
  const status = contact.status || "New";
  const seeded = seedContacts.find((seed) => seed.id === contact.id);
  const savedRep = contact.salesRep && contact.salesRep !== "Unassigned" ? contact.salesRep : "";
  const closedDate =
    contact.closedDate ||
    seeded?.closedDate ||
    (status === "Won" ? contact.lastContact || contact.createdAt || todayISO() : "");
  const baseContact = {
    ...contact,
    type: contact.type || (status === "Won" ? "Customer" : "Lead"),
    status,
    ownerUserId: contact.ownerUserId || contact.owner_id || "",
    ownerEmail: contact.ownerEmail || contact.owner_email || "",
    ownerName: contact.ownerName || contact.owner_name || "",
    salesRep: savedRep || contact.rep || contact.owner || seeded?.salesRep || "Unassigned",
    value: number(contact.value),
    createdAt: contact.createdAt || todayISO(),
    lastContact: contact.lastContact || todayISO(),
    closedDate,
    documents: (contact.documents || []).map((document) =>
      normalizeDocument(document, { leadId: contact.id, categories }),
    ),
    updates: (contact.updates || contact.activity || []).map(normalizeUpdate),
  };
  const jobs = contact.jobs?.length
    ? contact.jobs.map((job) => normalizeJob(job, baseContact))
    : [normalizeJob({}, baseContact)];
  const primaryJobId = jobs[0]?.id || "";
  return {
    ...baseContact,
    jobs,
    documents: baseContact.documents.map((document) => ({
      ...document,
      jobId: document.jobId || primaryJobId,
    })),
  };
}

function normalizeJob(job, contact = {}) {
  const status = job.status || contact.status || "New";
  const closedDate =
    job.closedDate || (soldJobStatuses.includes(status) ? contact.closedDate || contact.lastContact || todayISO() : "");
  const manualPayments = (job.manualPayments || []).map(normalizeManualPayment);
  const manualPaidAmount = manualPayments.reduce((sum, payment) => sum + number(payment.amount), 0);
  const legacyPaidAmount = number(job.paidAmount);
  const squarePaidAmount = Math.max(
    0,
    number(
      job.squarePaidAmount ??
        job.square_paid_amount ??
        Math.max(legacyPaidAmount - manualPaidAmount, 0),
    ),
  );
  const paidAmount = Math.round((squarePaidAmount + manualPaidAmount) * 100) / 100;
  const contractValue = number(job.contractValue ?? job.value ?? contact.value);
  const squareLastPaymentAt = job.squareLastPaymentAt || job.square_last_payment_at || (!manualPayments.length ? job.lastPaymentAt || "" : "");
  const lastPaymentAt = [
    squareLastPaymentAt,
    ...manualPayments.map((payment) => payment.date || payment.createdAt || ""),
  ]
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  return {
    ...job,
    id: job.id || uid("job"),
    projectNumber: job.projectNumber || "",
    name: job.name || job.title || `${contact.name || "Client"} Job`,
    address: job.address || contact.address || "",
    status,
    value: number(job.value ?? contact.value),
    contractValue,
    squarePaidAmount,
    manualPayments,
    paidAmount,
    paymentPercent: contractValue ? Math.min(100, (paidAmount / contractValue) * 100) : 0,
    squareLastPaymentAt,
    lastPaymentAt,
    ownerUserId: job.ownerUserId || contact.ownerUserId || "",
    ownerEmail: job.ownerEmail || contact.ownerEmail || "",
    ownerName: job.ownerName || contact.ownerName || "",
    salesRep: job.salesRep || contact.salesRep || "Unassigned",
    lastContact: job.lastContact || contact.lastContact || todayISO(),
    closedDate,
    notes: job.notes || "",
    costItems: (job.costItems || job.costs || []).map(normalizeCostItem),
    emails: (job.emails || []).map(normalizeJobEmail),
    profitNotes: job.profitNotes || "",
    createdAt: job.createdAt || contact.createdAt || todayISO(),
  };
}

function normalizeCostItem(item = {}) {
  return {
    id: item.id || uid("cost"),
    date: item.date || todayISO(),
    category: costCategories.includes(item.category) ? item.category : "Other",
    vendor: item.vendor || "",
    description: item.description || item.memo || "",
    amount: number(item.amount),
    paid: Boolean(item.paid),
    reference: item.reference || item.invoice || "",
    createdAt: item.createdAt || new Date().toISOString(),
    createdBy: item.createdBy || "",
  };
}

function normalizeDocument(document, { leadId = "", categoryId = "", categories = defaultDocumentCategories } = {}) {
  const resolvedLeadId = document.leadId || document.contactId || leadId;
  const isLeadDocument = Boolean(resolvedLeadId);
  const category =
    isLeadDocument
      ? categories?.find((item) => item.id === (document.categoryId || categoryId)) ||
        categoryForLegacyName(document.category, categories || defaultDocumentCategories)
      : null;
  return {
    id: document.id || uid("doc"),
    name: document.name || "Document",
    leadId: resolvedLeadId,
    categoryId: isLeadDocument ? document.categoryId || categoryId || category?.id || "" : document.categoryId || "",
    category: isLeadDocument ? category?.name || document.category || "Other" : document.category || "Other",
    type: document.type || "application/octet-stream",
    size: number(document.size),
    dataUrl: document.dataUrl || "",
    storagePath: document.storagePath || document.storage_path || "",
    previousVersions: Array.isArray(document.previousVersions) ? document.previousVersions : [],
    uploadedAt: document.uploadedAt || new Date().toISOString(),
    uploadedBy: document.uploadedBy || "Local user",
    versionNumber: Math.max(1, number(document.versionNumber || document.version) || 1),
    source: document.source || "",
    estimateId: document.estimateId || "",
    contactId: document.contactId || resolvedLeadId,
    jobId: document.jobId || "",
    kind:
      document.kind || document.recordKind ||
      ((document.categoryId || categoryId) === JOB_PHOTO_CATEGORY_ID ? "photo" : "document"),
  };
}

function normalizeManualPayment(payment = {}) {
  return {
    id: payment.id || uid("payment"),
    date: payment.date || todayISO(),
    method: payment.method || "Check",
    amount: Math.round(Math.max(0, number(payment.amount)) * 100) / 100,
    reference: payment.reference || "",
    note: payment.note || payment.memo || "",
    createdAt: payment.createdAt || new Date().toISOString(),
    updatedAt: payment.updatedAt || payment.createdAt || new Date().toISOString(),
    createdBy: payment.createdBy || "CRM admin",
  };
}

function normalizeJobEmail(email = {}) {
  return {
    id: email.id || uid("job_email"),
    fromEmail: email.fromEmail || "",
    toEmail: email.toEmail || "",
    subject: email.subject || "",
    message: email.message || "",
    createdAt: email.createdAt || new Date().toISOString(),
    createdBy: email.createdBy || "CRM user",
  };
}

function normalizeCalendarTask(task) {
  return {
    id: task.id || uid("task"),
    title: task.title || "Calendar task",
    rep: task.rep || "Unassigned",
    ownerUserId: task.ownerUserId || "",
    ownerEmail: task.ownerEmail || "",
    ownerName: task.ownerName || "",
    contactId: task.contactId || "",
    dueAt: task.dueAt || new Date().toISOString(),
    duration: Math.max(number(task.duration) || 30, 5),
    reminder: task.reminder || "popup",
    notes: task.notes || "",
    createdAt: task.createdAt || new Date().toISOString(),
    completed: Boolean(task.completed),
  };
}

function normalizeUpdate(update) {
  return {
    id: update.id || uid("update"),
    author: update.author || "Local user",
    message: update.message || "",
    status: update.status || "",
    jobId: update.jobId || "",
    createdAt: update.createdAt || new Date().toISOString(),
  };
}

function normalizeEstimate(estimate, contacts = []) {
  const contact = contacts.find((item) => item.id === estimate.contactId);
  const jobs = contact ? contactJobs(contact) : [];
  const job = jobs.find((item) => item.id === estimate.jobId) || jobs[0];
  const normalized = {
    ...estimate,
    status: estimate.status === "Approved" ? "Won" : estimate.status || "Draft",
    jobId: estimate.jobId || job?.id || "",
    projectTitle:
      estimate.projectTitle ||
      estimate.title ||
      `${job?.name || contact?.name || "Customer"} Exterior Estimate`,
    projectManager: estimate.projectManager || job?.salesRep || contact?.salesRep || "",
    ownerUserId: estimate.ownerUserId || contact?.ownerUserId || "",
    ownerEmail: estimate.ownerEmail || contact?.ownerEmail || "",
    ownerName: estimate.ownerName || contact?.ownerName || "",
    salesRepEmail: estimate.salesRepEmail || estimate.repEmail || "",
    salesRepPhone: estimate.salesRepPhone || estimate.repPhone || "",
    items: (estimate.items || []).map(normalizeLineItem),
    leadNumber: estimate.leadNumber || contact?.leadNumber || "",
    projectNumber: estimate.projectNumber || job?.projectNumber || "",
    squareInvoiceId: estimate.squareInvoiceId || "",
    squareOrderId: estimate.squareOrderId || "",
    squareInvoiceUrl: estimate.squareInvoiceUrl || "",
    squareStatus: estimate.squareStatus || "",
    paidAt: estimate.paidAt || "",
    contractValue: number(estimate.contractValue),
    paidAmount: number(estimate.paidAmount),
    paymentPercent: number(estimate.paymentPercent),
    paymentRequests: Array.isArray(estimate.paymentRequests) ? estimate.paymentRequests : [],
    paymentUpdatedAt: estimate.paymentUpdatedAt || "",
  };
  if (normalized.paidAt && !normalized.paidAmount) {
    const legacyPaidTotal = totalsFor(normalized).total;
    normalized.contractValue = normalized.contractValue || legacyPaidTotal;
    normalized.paidAmount = normalized.contractValue;
    normalized.paymentPercent = normalized.contractValue ? 100 : 0;
  }
  normalized.paymentPercent = normalized.contractValue ? Math.min(100, normalized.paidAmount / normalized.contractValue * 100) : 0;
  return normalized;
}

function normalizeLineItem(item) {
  const title = item.title || item.name || item.product || item.description || "Line item";
  return {
    ...item,
    title,
    description: item.title ? item.description || "" : item.details || "",
    quantity: number(item.quantity),
    unit: item.unit || "ea",
    rate: number(item.rate),
  };
}

let draftRecoveryStore = null;

function hasPendingCompanyChanges() {
  return canAction("manageCompany") && (Boolean(state.companyFormDraft) ||
    (cloudReady && durableBusinessStateAuthoritative && sharedStateSnapshot() !== lastCloudSnapshot));
}

function checkpointPendingDraft(serializedState) {
  if (!draftRecoveryStore || !durableRecordsReady || applyingCloudState) return;
  if (durableWriteBlocked || hasPendingDurableChanges() || hasPendingCompanyChanges()) {
    const stored = typeof serializedState === "string" ? draftRecoveryStore.captureSerialized(serializedState) : draftRecoveryStore.capture(state);
    if (!stored) showDraftStorageWarning();
  } else if (!durableSaveInFlight && !cloudSaveInFlight) draftRecoveryStore.settle();
}

function showDraftStorageWarning() {
  if (document.getElementById("crmDraftStorageWarning")) return;
  const notice = document.createElement("aside");
  notice.id = "crmDraftStorageWarning";
  notice.setAttribute("role", "alert");
  notice.style.cssText = "position:fixed;top:12px;left:16px;right:16px;z-index:100001;background:#fff4de;color:#34250b;padding:16px;border:2px solid #b87912;border-radius:12px";
  notice.textContent = "This browser cannot keep a recovery copy. Shared saving will still be attempted. Keep this tab open until your changes are saved; closing it during a connection problem could lose unsaved work.";
  document.body.appendChild(notice);
}

function showPreviousDraftRecovery(entries) {
  if (!entries.length) return;
  const panel = document.createElement("aside");
  panel.id = "crmPreviousDraftRecovery";
  panel.setAttribute("role", "alert");
  panel.style.cssText = "position:fixed;top:16px;left:16px;right:16px;z-index:100002;background:#fff4de;color:#34250b;border:2px solid #b87912;border-radius:12px;padding:16px";
  const message = document.createElement("p");
  message.textContent = "Unfinished work from an earlier session is available. The shared CRM has not been overwritten. Download the recovery copy and compare it with the current records before reapplying missing edits. The file contains private customer data.";
  const download = document.createElement("button");
  download.type = "button";
  download.textContent = "Download earlier work";
  let downloaded = false;
  download.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 1, entries }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "jobcrest-earlier-unsaved-work.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    downloaded = true;
  });
  const reviewed = document.createElement("button");
  reviewed.type = "button";
  reviewed.textContent = "I have kept the recovery file";
  reviewed.addEventListener("click", () => {
    if (!downloaded) { message.textContent = "Download the recovery file first, then confirm it is safely saved. No earlier edits will be reapplied automatically."; return; }
    if (!window.confirm("Has the recovery file finished downloading and been saved securely? Remove only these exported device copies?")) return;
    if (draftRecoveryStore.acknowledge(entries)) panel.remove();
    else message.textContent = "The browser could not remove the device copies. Keep your downloaded file secure.";
  });
  panel.append(message, download, reviewed);
  document.body.appendChild(panel);
}

function writeStateToLocalStorage() {
  try {
    const serializedState = JSON.stringify(state);
    checkpointPendingDraft(serializedState);
    localStorage.setItem(activeStorageKey(), serializedState);
    return true;
  } catch {
    console.warn("Local recovery cache is unavailable. Cloud saving will still be attempted; keep this tab open until saving completes.");
    return false;
  }
}

function flushQueuedLocalStateSave() {
  window.clearTimeout(localStateSaveTimer);
  localStateSaveTimer = null;
  writeStateToLocalStorage();
}

function queueLocalStateSave(delay = 200) {
  localEditRevision += 1;
  window.clearTimeout(localStateSaveTimer);
  localStateSaveTimer = window.setTimeout(flushQueuedLocalStateSave, delay);
}

function saveState(options = {}) {
  if (!options.localOnly && !applyingCloudState) localEditRevision += 1;
  window.clearTimeout(localStateSaveTimer);
  localStateSaveTimer = null;
  const localSaved = writeStateToLocalStorage();
  if (!options.localOnly && !applyingCloudState) {
    queueCloudSave();
    queueDurableRecordsSave();
  }
  return localSaved;
}

function supabaseConfig() {
  return window.RooflineAuth?.config || {};
}

function supabaseStateId() {
  return supabaseConfig().stateId || "coastal-crest";
}

function cloudCompanyStateId() {
  return `${supabaseStateId()}:${COMPANY_STATE_SUFFIX}`;
}

function cloudUserStateId(userId = authSession?.user?.id) {
  return `${supabaseStateId()}:user:${userId || "anonymous"}`;
}

function canUseCloudSync() {
  return Boolean(supabaseConfig().syncEnabled && window.RooflineAuth?.hasConfig());
}

function currentOwner() {
  return {
    userId: authSession?.user?.id || "",
    email: authSession?.user?.email || state.currentUser.email || "",
    name: state.currentUser.name || authSession?.user?.email?.split("@")[0] || "CRM User",
    role: currentRole(),
  };
}

function ownerFromRow(row = {}) {
  const dataOwner = row.data?.owner || {};
  const owner = {
    userId: dataOwner.userId || row.owner_id || row.updated_by || "",
    email: dataOwner.email || row.owner_email || "",
    name: dataOwner.name || row.owner_email || "CRM User",
    role: dataOwner.role || "sales",
  };
  if (owner.userId) cloudKnownOwners.set(owner.userId, owner);
  return owner;
}

function ownerForUserId(ownerId) {
  if (ownerId && cloudKnownOwners.has(ownerId)) return cloudKnownOwners.get(ownerId);
  const owner = currentOwner();
  return ownerId === owner.userId ? owner : { userId: ownerId || "", email: "", name: "CRM User", role: "sales" };
}

function withOwner(record = {}, owner = currentOwner()) {
  return {
    ...record,
    ownerUserId: record.ownerUserId || owner.userId,
    ownerEmail: record.ownerEmail || owner.email,
    ownerName: record.ownerName || owner.name,
  };
}

function tagContactOwner(contact, owner) {
  const tagged = withOwner(contact, owner);
  const jobs = (tagged.jobs || []).map((job) => withOwner(job, owner));
  return normalizeContact({ ...tagged, jobs });
}

function tagEstimateOwner(estimate, owner, contacts = state.contacts) {
  const contact = contacts.find((item) => item.id === estimate.contactId);
  const inferredOwner = contact?.ownerUserId
    ? { userId: contact.ownerUserId, email: contact.ownerEmail, name: contact.ownerName, role: owner.role }
    : owner;
  return normalizeEstimate(withOwner(estimate, inferredOwner), contacts);
}

function tagCalendarTaskOwner(task, owner, contacts = state.contacts) {
  const contact = contacts.find((item) => item.id === task.contactId);
  const inferredOwner = contact?.ownerUserId
    ? { userId: contact.ownerUserId, email: contact.ownerEmail, name: contact.ownerName, role: owner.role }
    : owner;
  return normalizeCalendarTask(withOwner(task, inferredOwner));
}

function ensureStateOwnership() {
  const owner = currentOwner();
  state.contacts = state.contacts.map((contact) => (contact.ownerUserId ? normalizeContact(contact) : tagContactOwner(contact, owner)));
  state.estimates = state.estimates.map((estimate) =>
    estimate.ownerUserId ? normalizeEstimate(estimate, state.contacts) : tagEstimateOwner(estimate, owner),
  );
  state.calendarTasks = state.calendarTasks.map((task) =>
    task.ownerUserId ? normalizeCalendarTask(task) : tagCalendarTaskOwner(task, owner),
  );
}

function contactOwnerId(contact) {
  return contact?.ownerUserId || currentOwner().userId;
}

function estimateOwnerId(estimate) {
  const contact = getContact(estimate?.contactId);
  return estimate?.ownerUserId || contact?.ownerUserId || currentOwner().userId;
}

function calendarTaskOwnerId(task) {
  const contact = getContact(task?.contactId);
  return task?.ownerUserId || contact?.ownerUserId || currentOwner().userId;
}

function ownerIdsInState() {
  const ids = new Set([currentOwner().userId]);
  state.contacts.forEach((contact) => ids.add(contactOwnerId(contact)));
  state.estimates.forEach((estimate) => ids.add(estimateOwnerId(estimate)));
  state.calendarTasks.forEach((task) => ids.add(calendarTaskOwnerId(task)));
  return [...ids].filter(Boolean);
}

function companyStatePayload() {
  return {
    company: state.company,
    ...(durableBusinessStateAuthoritative ? {} : { companyDocuments: state.companyDocuments }),
  };
}

function privateStatePayload(ownerId = currentOwner().userId) {
  const owner = ownerForUserId(ownerId);
  return {
    owner,
    contacts: state.contacts.filter((contact) => contactOwnerId(contact) === ownerId),
    estimates: state.estimates.filter((estimate) => estimateOwnerId(estimate) === ownerId),
    calendarTasks: state.calendarTasks.filter((task) => calendarTaskOwnerId(task) === ownerId),
  };
}

function cloudRowsForSave() {
  if (durableBusinessStateAuthoritative) {
    // Business objects already use versioned record transactions. Never send a
    // second, unversioned copy of every lead/job when one field changes.
    if (!canAction("manageCompany")) return [];
    return [{ id: cloudCompanyStateId(), data: companyStatePayload(), owner_id: null,
      owner_email: "", updated_by: authSession.user.id, updated_at: new Date().toISOString() }];
  }
  ensureStateOwnership();
  const now = new Date().toISOString();
  const ownerIds = canManageTeamData() ? ownerIdsInState() : [currentOwner().userId];
  const privateRows = ownerIds.map((ownerId) => {
    const owner = ownerForUserId(ownerId);
    return {
      id: cloudUserStateId(ownerId),
      data: privateStatePayload(ownerId),
      owner_id: ownerId,
      owner_email: owner.email || "",
      updated_by: authSession.user.id,
      updated_at: now,
    };
  });

  return [
    {
      id: cloudCompanyStateId(),
      data: companyStatePayload(),
      owner_id: null,
      owner_email: "",
      updated_by: authSession.user.id,
      updated_at: now,
    },
    ...privateRows,
  ];
}

function cloudSnapshotPayload() {
  if (durableBusinessStateAuthoritative) return canAction("manageCompany") ? { company: companyStatePayload() } : {};
  ensureStateOwnership();
  const ownerIds = canManageTeamData() ? ownerIdsInState() : [currentOwner().userId];
  return {
    company: companyStatePayload(),
    privateRows: ownerIds.map((ownerId) => ({
      id: cloudUserStateId(ownerId),
      ownerId,
      data: privateStatePayload(ownerId),
    })),
  };
}

function sharedStateSnapshot(payload = cloudSnapshotPayload()) {
  return JSON.stringify(payload);
}

function applySharedState(data = {}) {
  const personalState = {
    view: state.view,
    search: state.search,
    pipelineFilter: state.pipelineFilter,
    leadStageFilter: state.leadStageFilter,
    leaderboardRange: state.leaderboardRange,
    leadDetailTab: state.leadDetailTab,
    selectedContactId: state.selectedContactId,
    selectedEstimateId: state.selectedEstimateId,
    currentUser: state.currentUser,
  };
  state = normalizeState({
    ...createEmptyState(),
    ...state,
    ...data,
    ...personalState,
  });
}

function isCompanyCloudRow(row = {}) {
  return row.id === cloudCompanyStateId();
}

function isRelevantCloudRow(row = {}) {
  if (!row?.id) return false;
  if (canManageTeamData()) return row.id === supabaseStateId() || row.id.startsWith(`${supabaseStateId()}:`);
  return row.id === cloudCompanyStateId() || row.id === cloudUserStateId();
}

function cloudRowFingerprint(row = {}) {
  return JSON.stringify(canonicalRecordValue({ id: row.id || "", data: row.data || {} }));
}

function markRecentCloudWrite(row) {
  if (!row?.id) return;
  recentCloudWrites.set(row.id, {
    fingerprint: cloudRowFingerprint(row),
    expiresAt: Date.now() + 10000,
  });
}

function clearRecentCloudWrite(row) {
  if (!row?.id) return;
  const recent = recentCloudWrites.get(row.id);
  if (recent?.fingerprint === cloudRowFingerprint(row)) recentCloudWrites.delete(row.id);
}

function consumeRecentCloudEcho(row) {
  if (!row?.id) return false;
  const recent = recentCloudWrites.get(row.id);
  if (!recent) return false;
  if (recent.expiresAt < Date.now()) {
    recentCloudWrites.delete(row.id);
    return false;
  }
  if (recent.fingerprint !== cloudRowFingerprint(row)) return false;
  recentCloudWrites.delete(row.id);
  return true;
}

function mergeCloudRows(rows = []) {
  const companyRow = rows.find(isCompanyCloudRow);
  const fallbackCompanyRow = rows.find((row) => row.data?.company || row.data?.companyDocuments);
  const companyData = companyRow?.data || (durableBusinessStateAuthoritative ? {} : fallbackCompanyRow?.data) || {};
  const contactMap = new Map();
  const estimateMap = new Map();
  const taskMap = new Map();

  rows
    .filter((row) => !isCompanyCloudRow(row))
    .forEach((row) => {
      const owner = ownerFromRow(row);
      const rowContacts = (row.data?.contacts || []).map((contact) => tagContactOwner(contact, owner));
      rowContacts.forEach((contact) => contactMap.set(contact.id, contact));
      const mergedContacts = [...contactMap.values()];

      (row.data?.estimates || [])
        .map((estimate) => tagEstimateOwner(estimate, owner, mergedContacts))
        .forEach((estimate) => estimateMap.set(estimate.id, estimate));

      (row.data?.calendarTasks || [])
        .map((task) => tagCalendarTaskOwner(task, owner, mergedContacts))
        .forEach((task) => taskMap.set(task.id, task));
    });

  const durableBusinessState = durableBusinessStateAuthoritative
    ? {
        contacts: state.contacts,
        estimates: state.estimates,
        calendarTasks: state.calendarTasks,
        companyDocuments: state.companyDocuments,
      }
    : {
        contacts: [...contactMap.values()],
        estimates: [...estimateMap.values()],
        calendarTasks: [...taskMap.values()],
        companyDocuments: companyData.companyDocuments || state.companyDocuments,
      };

  applySharedState({
    company: companyData.company || state.company,
    ...durableBusinessState,
  });
  ensureStateOwnership();
}

async function fetchCloudRows() {
  const selectColumns = "*";
  if (durableBusinessStateAuthoritative) return cloudClient.from(SUPABASE_CRM_TABLE).select(selectColumns).eq("id", cloudCompanyStateId());
  const query =
    canManageTeamData()
      ? cloudClient.from(SUPABASE_CRM_TABLE).select(selectColumns).order("updated_at", { ascending: true })
      : cloudClient
          .from(SUPABASE_CRM_TABLE)
          .select(selectColumns)
          .in("id", [cloudCompanyStateId(), cloudUserStateId()])
          .order("updated_at", { ascending: true });
  return query;
}

async function reloadCloudState({ showUpdateToast = false } = {}) {
  if (durableWriteBlocked) return false;
  if (cloudSaveInFlight || hasPendingCompanyChanges()) return false;
  const revision = localEditRevision;
  const { data, error } = await fetchCloudRows();
  if (error) {
    console.warn("Supabase CRM state could not be loaded", error);
    showToast("Supabase is connected, but the CRM table needs the latest setup.");
    return false;
  }
  if (durableWriteBlocked || revision !== localEditRevision || cloudSaveInFlight || hasPendingCompanyChanges() || durableSaveInFlight || hasPendingDurableChanges()) return false;
  if (durableBusinessStateAuthoritative) {
    try { getCompanySettingsWriter().remember((data || []).find(isCompanyCloudRow)); }
    catch (error) {
      preserveBlockedDurableWrite({ error, payload: { p_request_id: crypto.randomUUID(), rpc: 'crm_commit_company_settings' } });
      return false;
    }
  }
  applyingCloudState = true;
  mergeCloudRows(data || []);
  applyingCloudState = false;
  lastCloudSnapshot = sharedStateSnapshot();
  saveState({ localOnly: true });
  return true;
}

function queueCloudSave() {
  if (durableWriteBlocked) return;
  if (canUseCloudSync() && !durableRecordsReady) return;
  if (!cloudReady || !cloudClient || !authSession?.user?.id) return;
  const snapshot = sharedStateSnapshot();
  if (snapshot === lastCloudSnapshot) return;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(flushCloudSave, CLOUD_SAVE_DELAY);
}

function getCompanySettingsWriter() {
  if (!companySettingsWriter) companySettingsWriter = window.CrmCompanySettingsWrites.create({
    companyId: supabaseStateId(), requestId: () => crypto.randomUUID(),
    rpc: (name, payload) => cloudClient.rpc(name, payload),
    onBlocked: preserveBlockedDurableWrite,
  });
  return companySettingsWriter;
}

async function flushCloudSave() {
  if (durableWriteBlocked) return false;
  if (canUseCloudSync() && !durableRecordsReady) return false;
  if (!cloudReady || !cloudClient || !authSession?.user?.id || cloudSaveInFlight) return false;
  const rows = cloudRowsForSave();
  const snapshot = sharedStateSnapshot();
  if (snapshot === lastCloudSnapshot) return true;
  if (!rows.length) { lastCloudSnapshot = snapshot; return true; }

  cloudSaveInFlight = true;
  checkpointPendingDraft();
  rows.forEach(markRecentCloudWrite);
  try {
    const { error } = durableBusinessStateAuthoritative
      ? await getCompanySettingsWriter().commit(rows[0].data)
      : await cloudClient.from(SUPABASE_CRM_TABLE).upsert(rows, { onConflict: "id" });
    if (error) throw error;
  } catch (error) {
    rows.forEach(clearRecentCloudWrite);
    console.warn("Supabase CRM sync failed", error);
    if (!durableWriteBlocked) showToast("Company settings could not be saved. Keep this page open and try again.");
    return false;
  } finally {
    cloudSaveInFlight = false;
  }

  lastCloudSnapshot = snapshot;
  checkpointPendingDraft();
  if (sharedStateSnapshot() !== lastCloudSnapshot) queueCloudSave();
  return true;
}

async function promoteSignedInSession() {
  if (!window.RooflineAuth?.hasConfig()) return authSession;
  const trusted = await window.RooflineAuth.getTrustedUser();
  if (!trusted.user || !window.RooflineAuth.isAllowedUser(trusted.user)) return authSession;
  return trusted;
}

async function initializeCloudSync() {
  if (!canUseCloudSync()) return;
  cloudClient = window.RooflineAuth.createClient();
  if (!cloudClient) return;

  const trusted = await window.RooflineAuth.getTrustedUser();
  if (!trusted.user || !window.RooflineAuth.isAllowedUser(trusted.user)) {
    console.info("Supabase sync is waiting for a signed-in company user.");
    return;
  }
  authSession = trusted;
  state.currentUser = currentUserFromAuthSession(trusted);

  applyingCloudState = true;
  const loaded = await reloadCloudState();
  applyingCloudState = false;
  if (!loaded) return;

  cloudReady = true;
  queueCloudSave();
  subscribeToCloudState();
}

function subscribeToCloudState() {
  if (!cloudClient?.channel || cloudSubscription) return;
  cloudSubscription = cloudClient
    .channel(`crm-state-${supabaseStateId()}-${authSession?.user?.id || "user"}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: SUPABASE_CRM_TABLE,
      },
      async (payload) => {
        const row = payload.new || payload.old;
        if (!isRelevantCloudRow(row) || cloudSaveInFlight || consumeRecentCloudEcho(row)) return;
        if (hasPendingDurableChanges()) {
          queueDurableRecordsSave();
          return;
        }
        const applied = await reloadCloudState({ showUpdateToast: false });
        if (applied) render();
      },
    )
    .subscribe();
}

function durableRecordKey(record = {}) {
  return `${record.record_type}:${record.id}`;
}

function durableRecordData(record = {}) {
  const { jobs, documents, updates, dataUrl, downloadUrl, ...data } = record;
  if (record.storagePath) return data;
  return dataUrl ? { ...data, dataUrl } : data;
}

function durableRowsFromState() {
  const companyStateId = supabaseStateId();
  const updatedBy = authSession?.user?.id || null;
  const rows = [];
  state.contacts.forEach((contact) => {
    const ownerId = contactOwnerId(contact) || updatedBy;
    rows.push({
      company_state_id: companyStateId,
      record_type: "contact",
      id: contact.id,
      lead_id: contact.id,
      job_id: null,
      owner_id: ownerId,
      data: durableRecordData(contact),
      updated_by: updatedBy,
      deleted_at: null,
    });
    contactJobs(contact).forEach((job) => rows.push({
      company_state_id: companyStateId,
      record_type: "job",
      id: job.id,
      lead_id: contact.id,
      job_id: job.id,
      owner_id: job.ownerUserId || ownerId,
      data: durableRecordData(job),
      updated_by: updatedBy,
      deleted_at: null,
    }));
    (contact.documents || []).forEach((document) => rows.push({
      company_state_id: companyStateId,
      record_type: "document",
      id: document.id,
      lead_id: contact.id,
      job_id: document.jobId || null,
      owner_id: ownerId,
      data: durableRecordData(document),
      updated_by: updatedBy,
      deleted_at: null,
    }));
  });
  state.estimates.forEach((estimate) => rows.push({
    company_state_id: companyStateId,
    record_type: "estimate",
    id: estimate.id,
    lead_id: estimate.contactId,
    job_id: estimate.jobId || null,
    owner_id: estimateOwnerId(estimate) || updatedBy,
    data: durableRecordData(estimate),
    updated_by: updatedBy,
    deleted_at: null,
  }));
  state.calendarTasks.forEach((task) => rows.push({
    company_state_id: companyStateId,
    record_type: "task",
    id: task.id,
    lead_id: task.contactId || null,
    job_id: null,
    owner_id: calendarTaskOwnerId(task) || updatedBy,
    data: durableRecordData(task),
    updated_by: updatedBy,
    deleted_at: null,
  }));
  state.companyDocuments.forEach((document) => rows.push({
    company_state_id: companyStateId,
    record_type: "document",
    id: document.id,
    lead_id: COMPANY_DOCUMENT_LEAD_ID,
    job_id: null,
    owner_id: document.ownerUserId || updatedBy,
    data: durableRecordData(document),
    updated_by: updatedBy,
    deleted_at: null,
  }));
  // A missing parent is a data-review issue, never an implicit request to delete
  // the saved child. Keep unmapped rows untouched until a reviewed relationship
  // repair is loaded from the server, even if a local import reuses their IDs.
  const unmappedKeys = new Set(durableUnmappedRows.map(durableRecordKey));
  return preserveReadOnlyPaymentFields([
    ...rows.filter(row => !unmappedKeys.has(durableRecordKey(row))),
    ...durableUnmappedRows.map(row => JSON.parse(JSON.stringify(row))),
  ]);
}

function durableAuditRowsFromState() {
  const actorUserId = authSession?.user?.id || null;
  return state.contacts.flatMap((contact) => (contact.updates || []).map((update) => ({
    id: update.id,
    company_state_id: supabaseStateId(),
    lead_id: contact.id,
    job_id: update.jobId || null,
    event_type: update.status ? "status_change" : "note",
    actor_user_id: actorUserId,
    actor_name: update.author || state.currentUser.name || "CRM User",
    message: update.message || "",
    status: update.status || "",
    metadata: {},
    created_at: update.createdAt || new Date().toISOString(),
  })));
}

function durableFingerprint(row) {
  return JSON.stringify({
    lead_id: row.lead_id || null,
    job_id: row.job_id || null,
    owner_id: row.owner_id || null,
    data: row.data,
    deleted_at: row.deleted_at || null,
  });
}

function markRecentLocalDurableWrite(row) {
  if (!row) return;
  recentLocalDurableWrites.set(durableRecordKey(row), {
    fingerprint: durableFingerprint(row),
    expiresAt: Date.now() + 10000,
  });
}

function clearRecentLocalDurableWrite(row) {
  if (!row) return;
  const key = durableRecordKey(row);
  const recent = recentLocalDurableWrites.get(key);
  if (recent?.fingerprint === durableFingerprint(row)) recentLocalDurableWrites.delete(key);
}

function consumeRecentLocalDurableEcho(row) {
  if (!row?.record_type || !row?.id) return false;
  const key = durableRecordKey(row);
  const recent = recentLocalDurableWrites.get(key);
  if (!recent) return false;
  if (recent.expiresAt < Date.now()) {
    recentLocalDurableWrites.delete(key);
    return false;
  }
  if (recent.fingerprint !== durableFingerprint(row)) return false;
  recentLocalDurableWrites.delete(key);
  return true;
}

function hasPendingDurableChanges() {
  if (!durableRecordsReady) return false;
  const rows = durableRowsFromState();
  const currentKeys = new Set(rows.map(durableRecordKey));
  if (rows.some((row) => durableRecordFingerprints.get(durableRecordKey(row)) !== durableFingerprint(row))) {
    return true;
  }
  if ([...durableRecordFingerprints.keys()].some((key) => !currentKeys.has(key))) return true;
  return durableAuditRowsFromState().some((row) => !durableAuditIds.has(row.id));
}

function rememberDurableRows(rows = [], auditRows = []) {
  durableRecordFingerprints = new Map(rows.filter(row => !row.deleted_at).map((row) => [durableRecordKey(row), durableFingerprint(row)]));
  durableAuditIds = new Set(auditRows.map((row) => row.id));
  getDurableCommitWriter().remember(rows);
  rows.forEach(row => durableFinancialBaseline.set(durableRecordKey(row), row.data));
}

function getDurableCommitWriter() {
  if (!durableCommitWriter) durableCommitWriter = window.CrmRecordWrites.create({
    rpc: (name, payload) => cloudClient.rpc(name, payload),
    requestId: () => crypto.randomUUID(),
    onAcknowledged: (changes, auditIds) => {
      changes.forEach(row => {
        if (row.data) durableFinancialBaseline.set(durableRecordKey(row), row.data);
        if (row.operation === "delete") durableRecordFingerprints.delete(durableRecordKey(row));
        else durableRecordFingerprints.set(durableRecordKey(row), durableFingerprint(row));
      });
      auditIds.forEach(id => durableAuditIds.add(id));
    },
    onBlocked: preserveBlockedDurableWrite,
  });
  return durableCommitWriter;
}

function preserveBlockedDurableWrite({ error, payload }) {
  durableWriteBlocked = true;
  window.clearTimeout(durableSaveTimer);
  window.clearTimeout(cloudSaveTimer);
  const recoveryKey = `jobcrest-unsaved-recovery:${authSession?.user?.id || "local"}:${payload.p_request_id}`;
  const recovery = { createdAt: new Date().toISOString(), request: payload, state: JSON.parse(JSON.stringify(state)) };
  try { localStorage.setItem(recoveryKey, JSON.stringify(recovery)); } catch { /* Keep the in-memory download available. */ }
  if (document.getElementById("crmSaveRecovery")) return;
  const panel = document.createElement("aside");
  panel.id = "crmSaveRecovery";
  panel.setAttribute("role", "alert");
  panel.style.cssText = "position:fixed;bottom:16px;left:16px;right:16px;z-index:100000;background:#fff4de;color:#34250b;border:2px solid #b87912;border-radius:12px;padding:16px;box-shadow:0 5px 25px #0003";
  const message = document.createElement("p");
  message.textContent = error?.code === "40001"
    ? "Someone else saved a newer version. Your changes have not overwritten theirs. Shared saving is paused; download your unsaved work, then reload and review it."
    : "Shared saving could not be confirmed and is paused. Keep this page open. Download your unsaved work before reloading; an administrator may need to check the connection or database update.";
  const download = document.createElement("button");
  download.type = "button";
  download.textContent = "Download unsaved work";
  let downloaded = false;
  download.addEventListener("click", () => {
    // Include edits made after the failed request as well as the original intent.
    const contents = JSON.stringify({ ...recovery, currentState: state }, null, 2);
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `jobcrest-unsaved-${payload.p_request_id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    downloaded = true;
  });
  const reload = document.createElement("button");
  reload.type = "button";
  reload.textContent = "Reload shared data";
  reload.addEventListener("click", () => {
    if (!downloaded) { message.textContent = "Download your unsaved work first. It contains customer data: keep it secure. Then reload shared data and review which edits need to be reapplied."; return; }
    if (window.confirm("Confirm the recovery file finished downloading. Reload shared data now? Unsaved edits will need to be reviewed and reapplied from that file.")) location.reload();
  });
  panel.append(message, download, reload);
  document.body.appendChild(panel);
}

async function commitDurableChanges(rows, auditRows = [], removals = []) {
  if (durableWriteBlocked) return { data: null, error: new Error("Shared saving is paused. Review the recovery notice.") };
  checkpointPendingDraft();
  const result = await getDurableCommitWriter().commit(rows, auditRows, removals);
  // Callers may still hold the in-flight flag; defer cleanup until their
  // completion handlers run, and check CURRENT edits rather than sent data.
  window.setTimeout(checkpointPendingDraft, 0);
  return result;
}

function preserveReadOnlyPaymentFields(rows) {
  if (currentRole() === "admin") return rows;
  // Normalizers add display defaults to old data. Sales edits must retain the
  // original payment fields verbatim, not inadvertently rewrite that history.
  for (const row of rows) {
    if (!["job", "estimate"].includes(row.record_type)) continue;
    const baseline = durableFinancialBaseline.get(durableRecordKey(row)) || {};
    for (const field of protectedPaymentFields) {
      if (Object.prototype.hasOwnProperty.call(baseline, field)) row.data[field] = JSON.parse(JSON.stringify(baseline[field]));
      else delete row.data[field];
    }
  }
  return rows;
}

function applyDurableRows(rows = [], auditRows = []) {
  const activeRows = rows.filter((row) => !row.deleted_at);
  const byType = (type) => activeRows.filter((row) => row.record_type === type);
  const activeLeadIds = new Set(byType('contact').map(row => row.id));
  durableUnmappedRows = activeRows.filter(row =>
    (row.record_type === 'job' || (row.record_type === 'document' && row.lead_id !== COMPANY_DOCUMENT_LEAD_ID))
    && !activeLeadIds.has(row.lead_id)
  ).map(row => JSON.parse(JSON.stringify(row)));
  showUnmappedRecordNotice(durableUnmappedRows.length);
  const jobsByLead = new Map();
  const documentsByLead = new Map();
  const updatesByLead = new Map();
  byType("job").forEach((row) => {
    if (!jobsByLead.has(row.lead_id)) jobsByLead.set(row.lead_id, []);
    jobsByLead.get(row.lead_id).push({ ...row.data, id: row.id });
  });
  byType("document").filter((row) => row.lead_id !== COMPANY_DOCUMENT_LEAD_ID).forEach((row) => {
    if (!documentsByLead.has(row.lead_id)) documentsByLead.set(row.lead_id, []);
    documentsByLead.get(row.lead_id).push({ ...row.data, id: row.id, leadId: row.lead_id, jobId: row.job_id || row.data?.jobId || "" });
  });
  auditRows.filter(row => row.event_type !== "record_commit").forEach((row) => {
    if (!updatesByLead.has(row.lead_id)) updatesByLead.set(row.lead_id, []);
    updatesByLead.get(row.lead_id).push({
      id: row.id,
      author: row.actor_name,
      message: row.message,
      status: row.status,
      createdAt: row.created_at,
      jobId: row.job_id || "",
    });
  });
  const contacts = byType("contact").map((row) => normalizeContact({
    ...row.data,
    id: row.id,
    ownerUserId: row.owner_id || row.data?.ownerUserId || "",
    jobs: jobsByLead.get(row.id) || [],
    documents: documentsByLead.get(row.id) || [],
    updates: (updatesByLead.get(row.id) || []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  }, state.company.documentCategories));
  const estimates = byType("estimate").map((row) => ({ ...row.data, id: row.id, contactId: row.lead_id, jobId: row.job_id || row.data?.jobId || "", ownerUserId: row.owner_id || "" }));
  const calendarTasks = byType("task").map((row) => ({ ...row.data, id: row.id, contactId: row.lead_id || "", ownerUserId: row.owner_id || "" }));
  const companyDocumentRows = byType("document").filter((row) => row.lead_id === COMPANY_DOCUMENT_LEAD_ID);
  const companyDocuments = companyDocumentRows.map((row) => normalizeDocument({
    ...row.data,
    id: row.id,
    ownerUserId: row.owner_id || row.data?.ownerUserId || "",
  }));
  applySharedState({
    contacts,
    estimates,
    calendarTasks,
    companyDocuments,
  });
}

function showUnmappedRecordNotice(count) {
  const existing = document.getElementById('crmUnmappedRecords');
  if (!count) { existing?.remove(); return; }
  if (existing) return;
  const notice = document.createElement('aside');
  notice.id = 'crmUnmappedRecords';
  notice.setAttribute('role', 'alert');
  notice.style.cssText = 'background:#fff4de;color:#34250b;padding:12px;border-bottom:2px solid #b87912';
  notice.textContent = 'Some saved jobs or documents have a missing lead link. They have been retained without changes. An administrator needs to review the links; no files were deleted or assigned to another lead.';
  document.body.prepend(notice);
}

async function fetchDurableRows() {
  const [rows, auditRows] = await Promise.all([
    fetchAllCompanyRows(SUPABASE_RECORDS_TABLE, ["record_type", "id"]),
    fetchAllCompanyRows(SUPABASE_AUDIT_TABLE, ["created_at", "id"]),
  ]);
  return { rows, auditRows };
}

async function fetchAllCompanyRows(table, orderColumns = ["id"]) {
  const rows = [];
  const seen = new Set();
  let expectedCount = null;
  do {
    let query = cloudClient.from(table).select("*", { count: "exact" }).eq("company_state_id", supabaseStateId());
    for (const column of orderColumns) query = query.order(column, { ascending: true });
    const { data, error, count } = await query.range(rows.length, rows.length + 499);
    if (error) throw error;
    if (!Number.isSafeInteger(count) || count < 0 || (expectedCount !== null && count !== expectedCount)) {
      throw new Error("CRM records changed during loading. Retrying is required before applying this snapshot.");
    }
    expectedCount = count;
    if (!Array.isArray(data) || (!data.length && rows.length < count)) throw new Error("Incomplete CRM response; existing data was preserved.");
    for (const row of data) {
      const key = JSON.stringify(orderColumns.map((column) => row[column]));
      if (seen.has(key)) throw new Error("CRM page overlap detected; existing data was preserved.");
      seen.add(key);
      rows.push(row);
    }
    if (rows.length > expectedCount) throw new Error("CRM response count mismatch; existing data was preserved.");
  } while (rows.length < expectedCount);
  return rows;
}

async function reloadDurableRecords({ showUpdateToast = false } = {}) {
  if (durableWriteBlocked) return null;
  try {
    const revision = localEditRevision;
    if (durableSaveInFlight || hasPendingDurableChanges()) return null;
    const { rows, auditRows } = await fetchDurableRows();
    if (durableWriteBlocked || revision !== localEditRevision || durableSaveInFlight || hasPendingDurableChanges()) {
      // Do not advance fingerprints for a response we did not apply.
      queueDurableRecordsReload({ showUpdateToast: false });
      return null;
    }
    applyingCloudState = true;
    applyDurableRows(rows, auditRows);
    rememberDurableRows(rows, auditRows);
    applyingCloudState = false;
    saveState({ localOnly: true });
    return rows;
  } catch (error) {
    applyingCloudState = false;
    console.warn("Durable CRM records are not ready. Run the latest Supabase schema.", error);
    return null;
  }
}

function queueDurableRecordsSave() {
  if (durableWriteBlocked) return;
  if (!durableWritesEnabled || !durableRecordsReady || !cloudClient || !authSession?.user?.id) return;
  window.clearTimeout(durableSaveTimer);
  durableSaveTimer = window.setTimeout(flushDurableRecordsSave, CLOUD_SAVE_DELAY);
}

function queueDurableRecordsReload({ showUpdateToast = true } = {}) {
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) return;
  if (durableSaveInFlight || hasPendingDurableChanges()) {
    queueDurableRecordsSave();
    return;
  }
  window.clearTimeout(durableReloadTimer);
  durableReloadTimer = window.setTimeout(async () => {
    durableReloadTimer = null;
    if (durableSaveInFlight || hasPendingDurableChanges()) {
      queueDurableRecordsSave();
      return;
    }
    if (durableReloadInFlight) {
      durableReloadQueued = true;
      return;
    }
    durableReloadInFlight = true;
    try {
      const appliedRows = await reloadDurableRecords({ showUpdateToast });
      if (appliedRows !== null) renderDurableUpdateWhenIdle();
    } finally {
      durableReloadInFlight = false;
      if (durableReloadQueued) {
        durableReloadQueued = false;
        queueDurableRecordsReload({ showUpdateToast: false });
      }
    }
  }, 500);
}

function activeTextEditor() {
  const element = document.activeElement;
  if (!element) return null;
  if (element.matches?.("textarea, select, [contenteditable='true']")) return element;
  if (!element.matches?.("input")) return null;
  return ["button", "checkbox", "file", "hidden", "radio", "reset", "submit"].includes(element.type)
    ? null
    : element;
}

function renderDurableUpdateWhenIdle() {
  if (activeTextEditor()) {
    pendingDurableRender = true;
    return false;
  }
  pendingDurableRender = false;
  render();
  return true;
}

async function flushDurableRecordsSave() {
  if (durableWriteBlocked) return false;
  if (!durableRecordsReady || durableSaveInFlight || !authSession?.user?.id) return false;
  const rows = durableRowsFromState();
  const currentKeys = new Set(rows.map(durableRecordKey));
  const changedRows = rows.filter((row) => durableRecordFingerprints.get(durableRecordKey(row)) !== durableFingerprint(row));
  const removedByType = new Map();
  durableRecordFingerprints.forEach((_value, key) => {
    if (currentKeys.has(key)) return;
    const separator = key.indexOf(":");
    const type = key.slice(0, separator);
    const id = key.slice(separator + 1);
    if (!removedByType.has(type)) removedByType.set(type, []);
    removedByType.get(type).push(id);
  });
  const auditRows = durableAuditRowsFromState();
  const newAuditRows = auditRows.filter((row) => !durableAuditIds.has(row.id));
  if (!changedRows.length && !removedByType.size && !newAuditRows.length) return true;

  durableSaveInFlight = true;
  try {
    const removals = [...removedByType].flatMap(([record_type, ids]) => ids.map(id => ({ company_state_id: supabaseStateId(), record_type, id })));
    changedRows.forEach(markRecentLocalDurableWrite);
    const { error } = await commitDurableChanges(changedRows, newAuditRows, removals);
    if (error) { changedRows.forEach(clearRecentLocalDurableWrite); throw error; }
    return true;
  } catch (error) {
    console.warn("Durable CRM record sync failed", error);
    return false;
  } finally {
    durableSaveInFlight = false;
    // Includes removals made while this request was in flight, not only updates.
    if (hasPendingDurableChanges()) queueDurableRecordsSave();
  }
}

function setSaveState(element, message, tone = "", options = {}) {
  if (!element) return;
  const visibleMessage = tone === "success" && !options.showSuccess ? "" : message;
  element.textContent = visibleMessage;
  element.dataset.tone = visibleMessage ? tone : "";
}

async function waitForDurableSaveSlot() {
  const startedAt = Date.now();
  while (durableSaveInFlight && Date.now() - startedAt < 10000) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  return !durableSaveInFlight;
}

async function persistCriticalLeadChange({ statusElement, button, successMessage }) {
  if (criticalSaveInFlight) {
    setSaveState(statusElement, "Another save is finishing. Please try again in a moment.", "error");
    return false;
  }

  criticalSaveInFlight = true;
  if (button) button.disabled = true;
  setSaveState(statusElement, "Saving securely to the shared CRM...", "saving");
  saveState({ localOnly: true });
  window.clearTimeout(durableSaveTimer);

  try {
    if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) {
      if (!canUseCloudSync()) {
        setSaveState(statusElement, `${successMessage} on this device.`, "success");
        return true;
      }
      throw new Error("Shared cloud storage is not connected");
    }
    if (!(await waitForDurableSaveSlot())) throw new Error("The prior cloud save did not finish");
    const saved = await flushDurableRecordsSave();
    if (!saved) throw new Error("The cloud rejected the record update");

    queueCloudSave();
    setSaveState(statusElement, `${successMessage} to the shared CRM.`, "success");
    return true;
  } catch (error) {
    console.warn("Critical lead change could not be confirmed", error);
    setSaveState(statusElement, "Not saved to the shared CRM. Keep this page open and try again.", "error");
    showToast("Save failed—your entry is still on this page, but it is not in the shared CRM yet.");
    return false;
  } finally {
    criticalSaveInFlight = false;
    if (button) button.disabled = false;
  }
}

async function persistProfitCostRecord(jobId, costId, updateId) {
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) return false;
  if (!(await waitForDurableSaveSlot())) return false;
  const jobRow = durableRowsFromState().find((row) => row.record_type === "job" && row.id === jobId);
  const auditRow = durableAuditRowsFromState().find((row) => row.id === updateId);
  if (!jobRow) return false;

  const { data: commitResult, error: writeError } = await commitDurableChanges([jobRow], auditRow ? [auditRow] : []);
  if (writeError) throw writeError;

  const confirmed = commitResult.rows.find(saved => saved.record_type === "job" && saved.id === jobId);
  if (!(confirmed?.data?.costItems || []).some((item) => item.id === costId)) return false;
  // The writer acknowledged its detached request, never this still-editable row.
  return true;
}

async function persistManualPaymentRecord(jobId, paymentId, shouldExist, updateId) {
  if (!canUseCloudSync()) return true;
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) return false;
  if (!(await waitForDurableSaveSlot())) return false;
  const jobRow = durableRowsFromState().find((row) => row.record_type === "job" && row.id === jobId);
  const auditRow = durableAuditRowsFromState().find((row) => row.id === updateId);
  if (!jobRow) return false;

  const expectedData = JSON.parse(JSON.stringify(jobRow.data));
  durableSaveInFlight = true;
  try {
    const { data: commitResult, error: writeError } = await commitDurableChanges([jobRow], auditRow ? [auditRow] : []);
    if (writeError) throw writeError;

    const confirmed = commitResult.rows.find(saved => saved.record_type === "job" && saved.id === jobId);
    const exists = (confirmed?.data?.manualPayments || []).some((payment) => payment.id === paymentId);
    if (exists !== shouldExist) return false;
    if (!durableRecordDataMatches(confirmed?.data || {}, expectedData)) return false;
    queueCloudSave();
    return true;
  } finally {
    durableSaveInFlight = false;
    queueDurableRecordsSave();
  }
}

async function persistLeadJobRecord(jobId, updateId, { skipContact = false } = {}) {
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) return false;
  if (!(await waitForDurableSaveSlot())) return false;
  const durableRows = durableRowsFromState();
  const jobRow = durableRows.find((row) => row.record_type === "job" && row.id === jobId);
  const auditRow = durableAuditRowsFromState().find((row) => row.id === updateId);
  if (!jobRow) return false;
  const contactRow = durableRows.find(
    (row) => row.record_type === "contact" && row.id === jobRow.lead_id,
  );
  const rowsToWrite = contactRow && !skipContact ? [contactRow, jobRow] : [jobRow];

  durableSaveInFlight = true;
  try {
    rowsToWrite.forEach(markRecentLocalDurableWrite);
    const { data: commitResult, error: writeError } = await commitDurableChanges(rowsToWrite, auditRow ? [auditRow] : []);
    if (writeError) throw writeError;

    const confirmed = commitResult.rows.find(saved => saved.record_type === "job" && saved.id === jobId);
    if (confirmed?.data?.status !== jobRow.data.status) return false;
    // Only getDurableCommitWriter.onAcknowledged advances confirmed fingerprints.
    return true;
  } catch (error) {
    rowsToWrite.forEach(clearRecentLocalDurableWrite);
    throw error;
  } finally {
    durableSaveInFlight = false;
    queueDurableRecordsSave();
  }
}

function canonicalRecordValue(value) {
  if (Array.isArray(value)) return value.map(canonicalRecordValue);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalRecordValue(value[key]);
        return result;
      }, {});
  }
  return value;
}

function durableRecordDataMatches(left, right) {
  return JSON.stringify(canonicalRecordValue(left)) === JSON.stringify(canonicalRecordValue(right));
}

async function persistDurableRecordNow(recordType, recordId, verify, { syncLegacy = true } = {}) {
  if (!canUseCloudSync()) return true;
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) return false;

  window.clearTimeout(durableSaveTimer);
  if (!(await waitForDurableSaveSlot())) return false;
  const row = durableRowsFromState().find(
    (candidate) => candidate.record_type === recordType && candidate.id === recordId,
  );
  if (!row) return false;

  const expectedData = JSON.parse(JSON.stringify(row.data));
  durableSaveInFlight = true;
  try {
    markRecentLocalDurableWrite(row);
    const { data: commitResult, error: writeError } = await commitDurableChanges([row]);
    if (writeError) {
      clearRecentLocalDurableWrite(row);
      throw writeError;
    }

    const confirmed = commitResult.rows.find(saved => saved.record_type === recordType && saved.id === recordId);
    if (!verify(confirmed?.data || {}, expectedData)) return false;

    // Later nested edits must remain dirty until a subsequent acknowledgement.
    if (syncLegacy) queueCloudSave();
    return true;
  } catch (error) {
    console.warn(`${recordType} record could not be verified in the shared CRM`, error);
    return false;
  } finally {
    durableSaveInFlight = false;
    queueDurableRecordsSave();
  }
}

async function persistChecklistRecord(contactId, jobId, stage, itemId, expectedValue) {
  return persistDurableRecordNow("contact", contactId, (confirmedData) =>
    confirmedData?.workflowChecklists?.[jobId]?.[stage]?.[itemId] === Boolean(expectedValue),
    { syncLegacy: false },
  );
}

async function persistChecklistStageRecord(contactId, jobId, stage, expectedStageData = {}) {
  return persistDurableRecordNow("contact", contactId, (confirmedData) => {
    const confirmedStage = confirmedData?.workflowChecklists?.[jobId]?.[stage] || {};
    return Object.entries(expectedStageData).every(
      ([itemId, expectedValue]) => confirmedStage[itemId] === Boolean(expectedValue),
    );
  }, { syncLegacy: false });
}

async function persistEstimateRecord(estimateId) {
  return persistDurableRecordNow("estimate", estimateId, (confirmedData, expectedData) =>
    durableRecordDataMatches(confirmedData, expectedData),
    { syncLegacy: false },
  );
}

async function persistLeadDocumentRecords(documentIds, updateId) {
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) return false;
  if (!(await waitForDurableSaveSlot())) return false;
  const wantedIds = new Set(documentIds);
  const documentRows = durableRowsFromState().filter(
    (row) => row.record_type === "document" && wantedIds.has(row.id),
  );
  const auditRow = durableAuditRowsFromState().find((row) => row.id === updateId);
  if (documentRows.length !== wantedIds.size) return false;

  durableSaveInFlight = true;
  documentRows.forEach(markRecentLocalDurableWrite);
  try {
    const { data: commitResult, error: writeError } = await commitDurableChanges(documentRows, auditRow ? [auditRow] : []);
    if (writeError) {
      documentRows.forEach(clearRecentLocalDurableWrite);
      throw writeError;
    }

    const confirmed = commitResult.rows;
    if (new Set((confirmed || []).map((row) => row.id)).size !== wantedIds.size) return false;
    // Preserve the writer's immutable acknowledgement when uploads overlap edits.
    return true;
  } finally {
    durableSaveInFlight = false;
    queueDurableRecordsSave();
  }
}

async function persistCompanyDocumentRecords(documentIds) {
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id) return false;
  if (!(await waitForDurableSaveSlot())) return false;
  const wantedIds = new Set(documentIds);
  const documentRows = durableRowsFromState().filter(
    (row) => row.record_type === "document" && row.lead_id === COMPANY_DOCUMENT_LEAD_ID && wantedIds.has(row.id),
  );
  if (documentRows.length !== wantedIds.size) return false;

  const { data: commitResult, error: writeError } = await commitDurableChanges(documentRows);
  if (writeError) throw writeError;

  const confirmed = commitResult.rows;
  if (new Set((confirmed || []).map((row) => row.id)).size !== wantedIds.size) return false;
  // Preserve the writer's immutable acknowledgement when uploads overlap edits.
  return true;
}

async function initializeDurableRecords() {
  if (!cloudReady || !cloudClient || !authSession?.user?.id) return;
  const rows = await reloadDurableRecords();
  if (rows === null) {
    // A failed authoritative read is not permission to display an old snapshot.
    durableBusinessStateAuthoritative = true;
    return;
  }
  // An empty authoritative table is not permission to resurrect old snapshots.
  // Legacy import must be an explicit, separately reviewed maintenance operation.
  durableRecordsReady = true;
  durableBusinessStateAuthoritative = true;
  void createDailyRecoveryBackup();
  if (!cloudClient.channel || durableRecordsSubscription) return;
  durableRecordsSubscription = cloudClient
    .channel(`crm-records-${supabaseStateId()}-${authSession.user.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_RECORDS_TABLE, filter: `company_state_id=eq.${supabaseStateId()}` }, async (payload) => {
      const row = payload.new || payload.old;
      if (consumeRecentLocalDurableEcho(row)) return;
      if (durableSaveInFlight || hasPendingDurableChanges()) {
        queueDurableRecordsSave();
        return;
      }
      queueDurableRecordsReload();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: SUPABASE_AUDIT_TABLE, filter: `company_state_id=eq.${supabaseStateId()}` }, async (payload) => {
      const row = payload.new || payload.old;
      if (row?.actor_user_id && row.actor_user_id === authSession?.user?.id) {
        if (row.id) durableAuditIds.add(row.id);
        return;
      }
      if (durableSaveInFlight || hasPendingDurableChanges()) {
        queueDurableRecordsSave();
        return;
      }
      queueDurableRecordsReload();
    })
    .subscribe();
}

async function createDailyRecoveryBackup() {
  if (!canManageTeamData() || !durableRecordsReady || !authSession?.user?.id) return;
  try {
    const { rows, auditRows } = await fetchDurableRows();
    const conversationMessages = await fetchAllCompanyRows("crm_conversation_messages", ["created_at", "id"]);
    const payload = {
      schemaVersion: 2,
      createdAt: new Date().toISOString(),
      company: companyStatePayload(),
      records: rows,
      auditEvents: auditRows,
      conversationMessages,
      // File bytes still require a separately scheduled storage backup.
      storagePaths: [...new Set(rows.filter((row) => row.record_type === "document")
        .flatMap((row) => [row.data?.storagePath, ...(row.data?.previousVersions || []).map((version) => version.storagePath)])
        .filter(Boolean))],
    };
    const { error } = await cloudClient.from("crm_backups").insert({
      company_state_id: supabaseStateId(),
      backup_date: todayISO(),
      record_count: rows.filter((row) => !row.deleted_at).length,
      payload,
      created_by: authSession.user.id,
    });
    if (error && error.code !== "23505") throw error;
  } catch (error) {
    console.warn("Daily CRM recovery backup could not be created", error);
  }
}

function currentRole() {
  return window.RooflineAuth?.normalizeRole(authSession?.role || state.currentUser.role) || "viewer";
}

function canManageTeamData() {
  return ["admin", "office_manager", "sales_manager", "operations_manager"].includes(currentRole());
}

function canManageJobFinancials() {
  return Boolean(rolePolicies[currentRole()]);
}

function canManageManualPayments() {
  return currentRole() === "admin";
}

function currentUserFromAuthSession(session) {
  return {
    name:
      session.user?.user_metadata?.name ||
      session.user?.user_metadata?.full_name ||
      session.user?.email?.split("@")[0] ||
      "CRM User",
    email: session.user?.email || "",
    role: window.RooflineAuth?.normalizeRole(session.role || session.user?.app_metadata?.role) || "viewer",
  };
}

function rolePolicy() {
  return rolePolicies[currentRole()] || rolePolicies.viewer;
}

function canView(view) {
  const views = rolePolicy().views;
  return views === "all" || views.includes(view);
}

function canAction(action) {
  if (action === "manageJobFinancials") return canManageJobFinancials();
  const actions = rolePolicy().actions;
  return actions === "all" || actions.includes(action);
}

function requireAction(action) {
  if (canAction(action)) return true;
  showToast(`Your ${roleLabel()} role does not allow that action`);
  return false;
}

function companyOfficeAddress() {
  return state.company.officeAddress || state.company.address || defaultCompany.officeAddress;
}

function estimateSalesRep(estimate = {}) {
  return {
    name: estimate.projectManager || state.currentUser.name || "Unassigned",
    email: estimate.salesRepEmail || state.currentUser.email || state.company.email || "",
    phone: estimate.salesRepPhone || state.currentUser.phone || state.company.phone || "",
    officeAddress: companyOfficeAddress(),
  };
}

function companyLogoTag(className = "doc-logo") {
  if (state.company.logoDataUrl) {
    return `<img class="${className}" src="${escapeHtml(state.company.logoDataUrl)}" alt="${escapeHtml(
      state.company.name || "Company",
    )} logo" />`;
  }
  return `<div class="doc-mark">${escapeHtml((state.company.name || "R").slice(0, 1))}</div>`;
}

function firstAllowedView() {
  return ["dashboard", "leads", "contacts", "jobs", "projects", "estimates", "companyDocuments"].find(canView) || "dashboard";
}

function setView(view) {
  if (!canView(view)) {
    showToast(`Your ${roleLabel()} role cannot access that section`);
    state.view = firstAllowedView();
    saveState();
    render();
    return;
  }
  state.view = view;
  saveState();
  render();
}

function openLeadDetail(contactId, tab = "overview", jobId = "") {
  if (!canView("leadDetail")) {
    showToast(`Your ${roleLabel()} role cannot open client records`);
    return;
  }
  const changingContact = state.selectedContactId !== contactId;
  state.selectedContactId = contactId;
  const contact = getContact(contactId);
  const jobs = contactJobs(contact);
  if (jobId && jobs.some((job) => job.id === jobId)) {
    state.selectedLeadJobId = jobId;
  } else if (changingContact || !jobs.some((job) => job.id === state.selectedLeadJobId)) {
    state.selectedLeadJobId = jobs[0]?.id || "";
  }
  state.selectedProfitJobId = state.selectedLeadJobId;
  state.leadDetailTab = tab;
  state.view = "leadDetail";
  saveState();
  render();
}

function openLeadJob(contactId, jobId) {
  openLeadDetail(contactId, "jobs", jobId);
  const contact = getContact(contactId);
  const job = contactJobs(contact).find((item) => item.id === jobId);
  if (job) fillJobForm({ ...job, jobId: job.id });
}

function openLeadJobPhotos(contactId, jobId) {
  openLeadDetail(contactId, "photos", jobId);
}

function setSelectedEstimate(id) {
  state.selectedEstimateId = id;
  const estimate = getSelectedEstimate();
  if (estimate) state.selectedContactId = estimate.contactId;
  saveState();
  renderEstimates();
}

function getSelectedContact() {
  return state.contacts.find((contact) => contact.id === state.selectedContactId) || state.contacts[0];
}

function getSelectedEstimate() {
  return state.estimates.find((estimate) => estimate.id === state.selectedEstimateId) || state.estimates[0];
}

function getContact(id) {
  return state.contacts.find((contact) => contact.id === id);
}

function contactJobs(contact) {
  return contact?.jobs?.length ? contact.jobs : [normalizeJob({}, contact)];
}

function allJobs() {
  return state.contacts.flatMap((contact) =>
    contactJobs(contact).map((job) => ({
      ...job,
      contactId: contact.id,
      contactName: contact.name,
      contactType: contact.type,
    })),
  );
}

function primaryJob(contact) {
  return contactJobs(contact)[0];
}

function updateContact(contactId, updater) {
  let updatedContact = null;
  state.contacts = state.contacts.map((contact) => {
    if (contact.id !== contactId) return contact;
    updatedContact = normalizeContact(updater({ ...contact }));
    return updatedContact;
  });
  return updatedContact;
}

function getEstimateContact(estimate) {
  return getContact(estimate?.contactId) || null;
}

function getEstimateJob(estimate) {
  const contact = getEstimateContact(estimate);
  if (!contact) return null;
  const jobs = contactJobs(contact);
  return jobs.find((job) => job.id === estimate?.jobId) || null;
}

function numericHash(value = "") {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 1000000;
}

function leadNumberFor(contact = {}) {
  const date = String(contact.createdAt || todayISO()).slice(0, 10).replace(/\D/g, "") || "00000000";
  return `LD-${date}-${String(numericHash(contact.id || contact.name)).padStart(6, "0")}`;
}

function uniqueLeadNumberFor(contact = {}) {
  const base = leadNumberFor(contact);
  const prefix = base.slice(0, -6);
  const start = Number(base.slice(-6));
  const used = new Set(
    state.contacts
      .filter((item) => item.id !== contact.id && item.leadNumber)
      .map((item) => item.leadNumber),
  );
  for (let offset = 0; offset < 1000000; offset += 1) {
    const suffix = String((start + offset) % 1000000).padStart(6, "0");
    const candidate = `${prefix}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error("Unable to assign a unique lead number.");
}

function nextProjectNumber(contact = {}) {
  const leadNumber = contact.leadNumber || leadNumberFor(contact);
  const used = contactJobs(contact)
    .map((job) => Number(String(job.projectNumber || "").match(/-P(\d+)$/)?.[1] || 0))
    .filter(Boolean);
  return `${leadNumber}-P${String((used.length ? Math.max(...used) : 0) + 1).padStart(2, "0")}`;
}

function ensureLeadProjectNumbers(contactId, preferredJobId = "") {
  let numberedContact = null;
  state.contacts = state.contacts.map((contact) => {
    if (contact.id !== contactId) return contact;
    const leadNumber = contact.leadNumber || uniqueLeadNumberFor(contact);
    let nextSequence = 1;
    const existingSequences = contactJobs(contact)
      .map((job) => Number(String(job.projectNumber || "").match(/-P(\d+)$/)?.[1] || 0))
      .filter(Boolean);
    if (existingSequences.length) nextSequence = Math.max(...existingSequences) + 1;
    const jobs = contactJobs(contact).map((job) => {
      if (job.projectNumber) return job;
      const projectNumber = `${leadNumber}-P${String(nextSequence).padStart(2, "0")}`;
      nextSequence += 1;
      return { ...job, projectNumber };
    });
    numberedContact = { ...contact, leadNumber, jobs };
    return numberedContact;
  });
  if (!numberedContact) return null;
  const job = contactJobs(numberedContact).find((item) => item.id === preferredJobId) || primaryJob(numberedContact);
  return { contact: numberedContact, job };
}

function ensureExistingSalesNumbers() {
  let changed = false;
  state.estimates.forEach((estimate) => {
    const numbered = ensureLeadProjectNumbers(estimate.contactId, estimate.jobId);
    if (!numbered) return;
    if (estimate.leadNumber !== numbered.contact.leadNumber || estimate.projectNumber !== numbered.job?.projectNumber) {
      estimate.leadNumber = numbered.contact.leadNumber;
      estimate.projectNumber = numbered.job?.projectNumber || "";
      changed = true;
    }
  });
  return changed;
}

function filteredContacts() {
  const query = state.search.trim().toLowerCase();
  if (!query) return state.contacts;
  return state.contacts.filter((contact) =>
    [
      contact.name,
      contact.leadNumber,
      contact.type,
      contact.status,
      contact.source,
      contact.salesRep,
      contact.email,
      contact.phone,
      contact.address,
      contact.notes,
      ...contactJobs(contact).flatMap((job) => [
        job.name,
        job.projectNumber,
        job.address,
        job.status,
        job.salesRep,
        job.notes,
        money.format(number(job.value)),
      ]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

async function ensureExistingSharedSalesNumbers() {
  for (const estimate of state.estimates) {
    const contact = getEstimateContact(estimate);
    const job = getEstimateJob(estimate);
    if (!contact || !job) continue;
    if (contact.leadNumber && job.projectNumber && estimate.leadNumber === contact.leadNumber &&
        estimate.projectNumber === job.projectNumber && estimate.estimateNumber) continue;
    await reserveSharedSalesNumbers(contact.id, job.id, estimate.id);
  }
}

function getSalesNumbering() {
  if (!salesNumbering) salesNumbering = window.CrmSalesNumbering.create({
    companyId: supabaseStateId(), rpc: (name, payload) => cloudClient.rpc(name, payload),
  });
  return salesNumbering;
}

async function reserveSharedSalesNumbers(leadId, jobId = "", estimateId = "") {
  if (!canUseCloudSync()) return null;
  if (!cloudReady || !cloudClient || !durableRecordsReady || durableWriteBlocked || !window.RooflineAuth.isEditorSessionCurrent()) {
    throw new Error("Shared numbering is not ready. Keep this page open and try again.");
  }
  const identity = squareSendIdentity();
  const result = await getSalesNumbering().reserve({ leadId, jobId, estimateId });
  if (identity !== squareSendIdentity() || !window.RooflineAuth.isEditorSessionCurrent()) throw new Error("The signed-in account changed.");
  state.contacts = state.contacts.map(contact => contact.id !== leadId ? contact : {
    ...contact, leadNumber: result.leadNumber,
    jobs: contactJobs(contact).map(job => job.id === jobId ? { ...job, projectNumber: result.projectNumber } : job),
  });
  const estimate = estimateId && state.estimates.find(item => item.id === estimateId);
  if (estimate) {
    estimate.leadNumber = result.leadNumber;
    estimate.projectNumber = result.projectNumber;
    estimate.estimateNumber = result.estimateNumber;
  }
  saveState({ localOnly: true });
  return result;
}

function sortLeadIntakeChronologically(contacts = []) {
  return contacts
    .map((contact, index) => ({ contact, index }))
    .sort((left, right) => {
      const leftTime = Date.parse(left.contact.createdAt || "");
      const rightTime = Date.parse(right.contact.createdAt || "");
      const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY;
      const safeRight = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY;
      return safeLeft - safeRight || left.index - right.index;
    })
    .map(({ contact }) => contact);
}

function liveLeadSearchMatches(query = state.search, limit = 8) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) return { matches: [], total: 0 };
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const scored = state.contacts
    .map((contact) => {
      const jobs = contactJobs(contact);
      const name = String(contact.name || "").toLowerCase();
      const leadNumber = String(contact.leadNumber || "").toLowerCase();
      const email = String(contact.email || "").toLowerCase();
      const phone = String(contact.phone || "").toLowerCase();
      const phoneDigits = phone.replace(/\D/g, "");
      const searchable = [
        name,
        leadNumber,
        contact.type,
        contact.status,
        contact.source,
        contact.salesRep,
        email,
        phone,
        phoneDigits,
        contact.address,
        ...jobs.flatMap((job) => [job.name, job.projectNumber, job.address, job.status, job.salesRep]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!terms.every((term) => searchable.includes(term))) return null;
      let score = 50;
      if (name === normalizedQuery || leadNumber === normalizedQuery) score = 0;
      else if (name.startsWith(normalizedQuery)) score = 5;
      else if (leadNumber.startsWith(normalizedQuery)) score = 8;
      else if (name.split(/\s+/).some((part) => part.startsWith(normalizedQuery))) score = 10;
      else if (email.startsWith(normalizedQuery)) score = 15;
      else if (normalizedQuery.replace(/\D/g, "") && phoneDigits.startsWith(normalizedQuery.replace(/\D/g, ""))) score = 15;
      else if (name.includes(normalizedQuery)) score = 20;
      return { contact, score };
    })
    .filter(Boolean)
    .sort((a, b) => a.score - b.score || String(a.contact.name).localeCompare(String(b.contact.name)));
  return { matches: scored.slice(0, limit).map((item) => item.contact), total: scored.length };
}

function hideLiveSearchResults() {
  els.globalSearchResults?.classList.add("hidden");
  els.globalSearch?.setAttribute("aria-expanded", "false");
  els.globalSearch?.removeAttribute("aria-activedescendant");
}

function renderLiveSearchResults() {
  if (!els.globalSearchResults || !els.globalSearch) return;
  const query = state.search.trim();
  if (!query || document.activeElement !== els.globalSearch) {
    hideLiveSearchResults();
    return;
  }
  const { matches, total } = liveLeadSearchMatches(query);
  liveSearchActiveIndex = matches.length
    ? Math.min(Math.max(liveSearchActiveIndex, -1), matches.length - 1)
    : -1;
  els.globalSearchResults.innerHTML = matches.length
    ? `${matches
        .map((contact, index) => {
          const job = primaryJob(contact);
          const meta = [contact.leadNumber, contact.phone, contact.email].filter(Boolean).join(" · ");
          return `
            <button
              class="live-search-result ${index === liveSearchActiveIndex ? "is-active" : ""}"
              id="liveSearchResult${index}"
              type="button"
              role="option"
              aria-selected="${index === liveSearchActiveIndex}"
              data-live-search-contact="${escapeHtml(contact.id)}"
            >
              <span class="live-search-result-avatar">${escapeHtml(contactInitials(contact.name))}</span>
              <span class="live-search-result-copy">
                <strong>${escapeHtml(contact.name || "Unnamed lead")}</strong>
                <span>${escapeHtml(meta || job?.address?.split("\n")[0] || "No contact details")}</span>
              </span>
              <span class="status-pill ${statusPillClass(job?.status || contact.status)}">${escapeHtml(job?.status || contact.status || "New")}</span>
            </button>`;
        })
        .join("")}
      <div class="live-search-count">${total > matches.length ? `Showing ${matches.length} of ${total} matches` : `${total} match${total === 1 ? "" : "es"}`}</div>`
    : '<div class="live-search-empty">No matching leads yet</div>';
  els.globalSearchResults.classList.remove("hidden");
  els.globalSearch.setAttribute("aria-expanded", "true");
  if (liveSearchActiveIndex >= 0) {
    els.globalSearch.setAttribute("aria-activedescendant", `liveSearchResult${liveSearchActiveIndex}`);
    els.globalSearchResults.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  } else {
    els.globalSearch.removeAttribute("aria-activedescendant");
  }
}

function renderSearchFilteredView() {
  const renderers = {
    leads: renderLeadsView,
    contacts: renderContacts,
    jobs: renderJobsView,
    projects: renderProjectsView,
    estimates: renderEstimates,
  };
  renderers[state.view]?.();
}

function openLiveSearchResult(contactId) {
  if (!contactId) return;
  state.search = "";
  liveSearchActiveIndex = -1;
  els.globalSearch.value = "";
  hideLiveSearchResults();
  openLeadDetail(contactId);
}

function filteredEstimates() {
  const query = state.search.trim().toLowerCase();
  if (!query) return state.estimates;
  return state.estimates.filter((estimate) => {
    const contact = getEstimateContact(estimate);
    return [
      estimate.estimateNumber,
      estimate.projectTitle,
      estimate.status,
      estimate.scopeSummary,
      contact?.name,
      contact?.email,
      ...estimate.items.flatMap((item) => [item.title, item.description]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function totalsFor(estimate) {
  // Sum rounded line cents, matching displayed line amounts and Square orders.
  const subtotalCents = estimate.items.reduce(
    (sum, item) => sum + Math.round(number(item.quantity) * Math.round(number(item.rate) * 100)),
    0,
  );
  const subtotal = subtotalCents / 100;
  const taxCents = Math.round(subtotalCents * number(estimate.taxRate) / 100);
  const tax = taxCents / 100;
  const total = (subtotalCents + taxCents) / 100;
  const balance = Math.max(subtotalCents + taxCents - Math.round(number(estimate.deposit) * 100), 0) / 100;
  return { subtotal, tax, total, balance };
}

function statusPillClass(status = "") {
  const s = status.toLowerCase().replace(/\s+/g, "-");
  if (s === "won" || s === "approved" || s === "completed") return "pill-won";
  if (s === "lost" || s === "rejected") return "pill-lost";
  if (s === "estimate-sent" || s === "sent") return "pill-sent";
  if (s === "inspection") return "pill-inspection";
  if (s === "contacted") return "pill-contacted";
  if (s === "new") return "pill-new";
  if (s === "in-progress" || s === "in_progress") return "pill-inspection";
  return "pill-default";
}

function contactInitials(name = "") {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function initialsColor(name = "") {
  const colors = ["avatar-blue", "avatar-teal", "avatar-purple", "avatar-amber", "avatar-coral"];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function staleLeadDays(contact) {
  if (!contact.lastContact) return 0;
  const last = new Date(contact.lastContact);
  const now = new Date();
  return Math.floor((now - last) / (1000 * 60 * 60 * 24));
}

function staleClass(contact) {
  if (["Won", "Lost"].includes(contact.status)) return "";
  const days = staleLeadDays(contact);
  if (days >= 14) return "stale-red";
  if (days >= 7) return "stale-amber";
  return "";
}

function telLink(phone = "") {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  return `<a class="tel-link" href="tel:${digits}">${escapeHtml(phone)}</a>`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function nl2br(value = "") {
  return escapeHtml(value).replaceAll("\n", "<br />");
}

function formatDate(value) {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatDate(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(size) {
  const bytes = number(size);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function uniqueSalesReps() {
  return [
    ...new Set([
      ...state.contacts.map((contact) => contact.salesRep).filter(Boolean),
      ...allJobs().map((job) => job.salesRep).filter(Boolean),
      ...state.calendarTasks.map((task) => task.rep).filter(Boolean),
    ]),
  ].sort((a, b) => a.localeCompare(b));
}

function taskDueTime(task) {
  const date = new Date(task.dueAt);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function googleDate(value) {
  return value.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function googleCalendarUrl(task) {
  const start = taskDueTime(task);
  const end = new Date(start.getTime() + (number(task.duration) || 30) * 60 * 1000);
  const contact = getContact(task.contactId);
  const details = [
    task.notes,
    task.rep ? `Sales Representative: ${task.rep}` : "",
    contact ? `Related Lead: ${contact.name}` : "",
    contact?.phone ? `Phone: ${contact.phone}` : "",
    contact?.email ? `Email: ${contact.email}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: task.title,
    dates: `${googleDate(start)}/${googleDate(end)}`,
    details,
  });
  if (contact?.address) params.set("location", contact.address.replaceAll("\n", ", "));
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function upcomingTasks(limit = 6) {
  const now = new Date();
  return [...state.calendarTasks]
    .filter((task) => !task.completed && taskDueTime(task) >= now)
    .sort((a, b) => taskDueTime(a) - taskDueTime(b))
    .slice(0, limit);
}

function dateFromISO(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function rangeStart(range) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  if (range === "week") {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    return start;
  }
  if (range === "ytd") {
    return new Date(now.getFullYear(), 0, 1);
  }
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function isInLeaderboardRange(contact, range) {
  const closedDate = dateFromISO(contact.closedDate || contact.lastContact || contact.createdAt);
  if (!closedDate) return false;
  return closedDate >= rangeStart(range);
}

function estimateTotal(estimate) {
  return totalsFor(estimate).total;
}

function dashboardMetrics() {
  const leads = state.contacts.filter((contact) => contact.type === "Lead").length;
  const jobs = allJobs();
  const openContracts = jobs.filter((job) => !["Won", "Lost"].includes(job.status));
  const closedJobs = jobs.filter((job) => job.status === "Won");
  const estimatesSent = state.estimates.filter((estimate) =>
    ["Sent", "Won"].includes(estimate.status),
  ).length;
  const pipelineValue = jobs
    .filter((job) => job.status !== "Lost")
    .reduce((sum, job) => sum + number(job.value), 0);
  return {
    leads,
    totalJobs: jobs.length,
    estimatesSent,
    openContracts: openContracts.length,
    openValue: openContracts.reduce((sum, job) => sum + number(job.value), 0),
    closedJobs: closedJobs.length,
    closedValue: closedJobs.reduce((sum, job) => sum + number(job.value), 0),
    pipelineValue,
  };
}

function aggregateCounts(items, keyGetter, valueGetter = () => 1) {
  const groups = items.reduce((acc, item) => {
    const key = keyGetter(item) || "Other";
    if (!acc.has(key)) acc.set(key, { label: key, count: 0, value: 0 });
    const group = acc.get(key);
    group.count += 1;
    group.value += number(valueGetter(item));
    return acc;
  }, new Map());
  return [...groups.values()].sort((a, b) => b.count - a.count || b.value - a.value);
}

function jobType(job) {
  const text = `${job.name || ""} ${job.notes || ""}`.toLowerCase();
  if (text.includes("repair")) return "Roof Repair";
  if (text.includes("storm") || text.includes("damage")) return "Storm Damage";
  if (text.includes("gutter")) return "Gutters";
  if (text.includes("maintenance")) return "Maintenance";
  return "Roof Replacement";
}

function dashboardActivityItems(limit = 6) {
  const updates = state.contacts.flatMap((contact) =>
    (contact.updates || []).map((update) => ({
      icon: update.status === "Won" ? "check" : "bell",
      title: update.status ? `Status: ${update.status}` : "Client update",
      meta: `${contact.name} - ${update.message || "Update posted"}`,
      value: "",
      date: update.createdAt,
      contactId: contact.id,
    })),
  );
  const estimateItems = state.estimates.map((estimate) => {
    const contact = getEstimateContact(estimate);
    return {
      icon: "file",
      title: `Estimate ${estimate.status}`,
      meta: `${contact?.name || "Unknown client"} - ${estimate.projectTitle}`,
      value: money.format(estimateTotal(estimate)),
      date: `${estimate.sentAt || estimate.issueDate || todayISO()}T12:00:00`,
      contactId: contact?.id,
    };
  });
  const jobItems = allJobs().map((job) => ({
    icon: job.status === "Won" ? "dollar" : "briefcase",
    title: job.status === "Won" ? "Job Won" : job.status,
    meta: `${job.contactName} - ${job.name}`,
    value: money.format(number(job.value)),
    date: `${job.closedDate || job.lastContact || job.createdAt || todayISO()}T12:00:00`,
    contactId: job.contactId,
  }));
  return [...updates, ...estimateItems, ...jobItems]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

function fieldKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function rowToObject(headers, row) {
  return headers.reduce((record, header, index) => {
    record[fieldKey(header)] = (row[index] || "").trim();
    return record;
  }, {});
}

function getCsvField(record, names) {
  for (const name of names) {
    const value = record[fieldKey(name)];
    if (value) return value;
  }
  return "";
}

function parseDateToISO(value) {
  if (!value) return "";
  const isoDate = String(value).match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (isoDate) return isoDate;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return "";
}

function mapZohoStatus(status) {
  const normalized = fieldKey(status);
  if (["converted", "closedwon", "won", "customer"].includes(normalized)) return "Won";
  if (["lost", "closedlost", "junklead", "notqualified", "unqualified"].includes(normalized)) return "Lost";
  if (["contacted", "attemptedtocontact", "followup", "working"].includes(normalized)) return "Contacted";
  if (["inspection", "siteinspection", "appointment", "scheduled"].includes(normalized)) return "Inspection";
  if (["estimatesent", "proposal", "quote", "quotesent"].includes(normalized)) return "Estimate Sent";
  return "New";
}

function zohoLeadToContact(record) {
  const firstName = getCsvField(record, ["First Name", "FirstName"]);
  const lastName = getCsvField(record, ["Last Name", "LastName"]);
  const fullName = getCsvField(record, ["Full Name", "Lead Name", "Name"]);
  const company = getCsvField(record, ["Company", "Account Name", "Organization"]);
  const email = getCsvField(record, ["Email", "Email Address"]);
  const phone = getCsvField(record, ["Phone", "Mobile", "Mobile Phone", "Home Phone"]);
  const status = mapZohoStatus(getCsvField(record, ["Lead Status", "Status"]));
  const street = getCsvField(record, ["Street", "Mailing Street", "Address"]);
  const city = getCsvField(record, ["City", "Mailing City"]);
  const stateName = getCsvField(record, ["State", "Province", "Mailing State"]);
  const zip = getCsvField(record, ["Zip Code", "Zip", "Postal Code", "Mailing Zip"]);
  const country = getCsvField(record, ["Country", "Mailing Country"]);
  const address = [street, [city, stateName, zip].filter(Boolean).join(", "), country]
    .filter(Boolean)
    .join("\n");
  const createdAt = parseDateToISO(getCsvField(record, ["Created Time", "Created Date", "Created At"])) || todayISO();
  const modifiedAt = parseDateToISO(getCsvField(record, ["Modified Time", "Modified Date", "Updated At"]));
  const closedDate = parseDateToISO(getCsvField(record, ["Closed Date", "Closing Date", "Converted Time"]));
  const externalId = getCsvField(record, ["Record Id", "Lead Id", "LEADID", "Id", "Lead ID"]);
  const value = number(
    getCsvField(record, [
      "Project Value",
      "Job Value",
      "Amount",
      "Deal Amount",
      "Expected Revenue",
      "Annual Revenue",
      "Lead Value",
    ]).replace(/[$,]/g, ""),
  );

  return normalizeContact({
    id: uid("contact"),
    externalSource: "Zoho CRM",
    externalId,
    type: status === "Won" ? "Customer" : "Lead",
    status,
    name: fullName || [firstName, lastName].filter(Boolean).join(" ") || company || email || "Zoho Lead",
    source: getCsvField(record, ["Lead Source", "Source"]),
    salesRep: getCsvField(record, ["Lead Owner", "Owner", "Record Owner", "Sales Representative", "Sales Rep"]),
    email,
    phone,
    address,
    value,
    lastContact: modifiedAt || createdAt,
    closedDate: closedDate || (status === "Won" ? modifiedAt || createdAt : ""),
    notes: getCsvField(record, ["Description", "Notes", "Lead Description"]),
    createdAt,
  });
}

function findExistingContact(imported) {
  if (imported.externalId) {
    const match = state.contacts.find(
      (contact) => contact.externalSource === "Zoho CRM" && contact.externalId === imported.externalId,
    );
    if (match) return match;
  }

  const email = imported.email.toLowerCase();
  if (email) {
    const match = state.contacts.find((contact) => (contact.email || "").toLowerCase() === email);
    if (match) return match;
  }

  const phone = imported.phone.replace(/\D/g, "");
  if (phone) {
    return state.contacts.find((contact) => (contact.phone || "").replace(/\D/g, "") === phone);
  }

  return null;
}

function mergeImportedContact(existing, imported) {
  return normalizeContact({
    ...existing,
    ...imported,
    id: existing.id,
    createdAt: existing.createdAt || imported.createdAt,
    notes: [existing.notes, imported.notes].filter(Boolean).join(existing.notes && imported.notes ? "\n\n" : ""),
  });
}

async function importZohoCsv(file) {
  if (!file) return;
  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) {
    showToast("No leads found in that CSV");
    return;
  }

  const headers = rows[0];
  const importedContacts = rows.slice(1).map((row) => zohoLeadToContact(rowToObject(headers, row)));
  let added = 0;
  let updated = 0;

  importedContacts.forEach((contact) => {
    const existing = findExistingContact(contact);
    if (existing) {
      const merged = mergeImportedContact(existing, contact);
      state.contacts = state.contacts.map((item) => (item.id === existing.id ? merged : item));
      updated += 1;
    } else {
      state.contacts.unshift(contact);
      added += 1;
    }
  });

  state.view = "dashboard";
  state.search = "";
  saveState();
  render();
  showToast(`Zoho import complete: ${added} added, ${updated} updated`);
}

function addContactUpdate(contactId, { author = "Local user", message, status = "", jobId = "" }) {
  if (!message?.trim() && !status) return null;
  return updateContact(contactId, (contact) => ({
    ...contact,
    updates: [
      {
        id: uid("update"),
        author: author.trim() || "Local user",
        message: message?.trim() || "",
        status,
        jobId,
        createdAt: new Date().toISOString(),
      },
      ...(contact.updates || []),
    ],
  }));
}

function applyStatusUpdate(contactId, nextStatus, author = "Local user", message = "") {
  let contact = getContact(contactId);
  const currentJobStatus = contact ? contactJobs(contact)[0]?.status || contact.status : "";
  if (!contact || !nextStatus || currentJobStatus === nextStatus) return contact;
  if (["Estimate Sent", "Won"].includes(nextStatus)) {
    contact = canUseCloudSync() ? contact : ensureLeadProjectNumbers(contactId)?.contact || contact;
  }
  return updateContact(contactId, (current) => {
    const wasStatus = current.status;
    const nextJobs = contactJobs(current).map((job, index) =>
      index === 0
        ? {
            ...job,
            status: nextStatus,
            closedDate: nextStatus === "Won" ? job.closedDate || todayISO() : job.closedDate,
          }
        : job,
    );
    return {
      ...current,
      jobs: nextJobs,
      status: nextStatus,
      type: nextStatus === "Won" ? "Customer" : current.type,
      closedDate: nextStatus === "Won" ? current.closedDate || todayISO() : current.closedDate,
      updates: [
        {
          id: uid("update"),
          author: author.trim() || "Local user",
          status: nextStatus,
          jobId: nextJobs[0]?.id || "",
          message: message || `Status changed from ${wasStatus} to ${nextStatus}.`,
          createdAt: new Date().toISOString(),
        },
        ...(current.updates || []),
      ],
    };
  });
}

function render() {
  if (!canView(state.view)) {
    state.view = firstAllowedView();
  }
  const titles = {
    dashboard: "Dashboard",
    leads: "Leads",
    pipeline: "Pipeline",
    contacts: "Contacts",
    jobs: "Jobs",
    projects: "Projects",
    leadDetail: "Lead Detail",
    estimates: "Estimates",
    companyDocuments: "Company Documents",
    calendar: "Calendar",
    tasks: "Tasks",
    invoices: "Invoices",
    reviews: "Reviews",
    reports: "Reports",
    company: "Settings",
  };

  els.viewTitle.textContent = titles[state.view];
  els.globalSearch.value = state.search;

  els.navItems.forEach((item) => {
    item.classList.toggle("hidden", !canView(item.dataset.view));
    item.classList.toggle("active", item.dataset.view === state.view);
  });

  Object.entries(els.views).forEach(([view, element]) => {
    element.classList.toggle("hidden", view !== state.view);
  });
  renderBrandLogo();
  els.summaryStrip.classList.toggle("hidden", state.view !== "dashboard");
  els.workspace?.classList.toggle("dashboard-watermark", state.view === "dashboard");
  renderTopbarProfile();

  // Each workspace previously rendered every screen on every state change.
  // With a full CRM this left thousands of hidden rows/cards in the DOM and
  // made ordinary mouse-wheel scrolling compete with needless layout work.
  // Render the current workspace only; it is rebuilt from state whenever the
  // user opens it, so its data is always current without the background cost.
  const activeRenderer = {
    dashboard: () => {
      renderSummary();
      renderDashboard();
    },
    leads: renderLeadsView,
    pipeline: renderPipeline,
    contacts: renderContacts,
    jobs: renderJobsView,
    projects: renderProjectsView,
    leadDetail: renderLeadDetail,
    estimates: renderEstimates,
    companyDocuments: renderCompanyDocuments,
    calendar: renderCalendar,
    tasks: renderTasksView,
    invoices: renderInvoicesView,
    reviews: renderReviewsView,
    reports: renderReportsView,
    company: renderCompanyForm,
  };
  activeRenderer[state.view]?.();
  renderLiveSearchResults();
  applyPermissionsToDom();
}

function renderBrandLogo() {
  const logoSource = state.company.logoDataUrl || "icon.svg";
  if (els.brandLogo) {
    els.brandLogo.src = logoSource;
    els.brandLogo.alt = state.company.logoDataUrl ? `${state.company.name || "Company"} logo` : "";
  }
  if (els.workspace) {
    const logoUrl = logoSource.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    els.workspace.style.setProperty("--dashboard-logo-watermark", `url("${logoUrl}")`);
  }
}

function renderTopbarProfile() {
  if (els.dashboardDateRange) {
    const start = rangeStart("week");
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    els.dashboardDateRange.innerHTML = `
      <span aria-hidden="true" data-icon="calendar"></span>
      <span>${formatDate(start.toISOString().slice(0, 10))} - ${formatDate(end.toISOString().slice(0, 10))}</span>
    `;
    hydrateIcons(els.dashboardDateRange);
  }

  const pendingTasks = state.calendarTasks.filter((task) => !task.completed).length;
  document.querySelectorAll(".notification-dot").forEach((node) => {
    node.textContent = pendingTasks;
    node.classList.toggle("hidden", pendingTasks === 0);
  });

  if (els.userChip) {
    const initials = (state.currentUser.name || "User")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("");
    els.userChip.innerHTML = `
      <span class="avatar">${escapeHtml(initials || "U")}</span>
      <span>
        <strong>${escapeHtml(state.currentUser.name || "User")}</strong>
        <small>${escapeHtml(roleLabel())} - <a href="/logout">Logout</a></small>
      </span>
    `;
  }
}

function applyPermissionsToDom() {
  document.querySelectorAll("[data-action]").forEach((button) => {
    const permission = actionPermissions[button.dataset.action];
    if (permission) {
      button.classList.toggle("hidden", !canAction(permission));
      button.disabled = !canAction(permission) || button.dataset.ruleDisabled === "true";
    }
  });

  [
    [els.addContactButton, "manageContacts"],
    [els.addLeadFromLeadsButton, "manageContacts"],
    [els.importZohoButton, "manageContacts"],
    [els.editLeadDetailButton, "manageContacts"],
    [els.emailLeadDetailButton, "sendEmail"],
    [els.estimateLeadDetailButton, "manageEstimates"],
    [els.uploadLeadDocumentButton, "manageDocuments"],
    [els.uploadLeadPhotoButton, "manageDocuments"],
    [els.uploadCompanyDocumentButton, "manageDocuments"],
    [els.toggleEstimateCreateButton, "manageEstimates"],
    [els.newEstimateButton, "manageEstimates"],
    [els.addLineItemButton, "manageEstimates"],
    [els.deleteEstimateButton, "manageEstimates"],
    [els.saveEstimateButton, "manageEstimates"],
    [els.sendEstimateButton, "manageEstimates"],
    [els.deleteContactButton, "manageContacts"],
    [els.estimateFromContactButton, "manageEstimates"],
  ].forEach(([element, permission]) => {
    if (!element) return;
    element.classList.toggle("hidden", !canAction(permission));
    element.disabled = !canAction(permission);
  });

  const estimateWritable = canAction("manageEstimates");
  els.estimateForm?.querySelectorAll("input, textarea, select").forEach((field) => {
    field.disabled = !estimateWritable;
  });
  const hasEstimate = Boolean(getSelectedEstimate());
  els.copyEstimateButton.disabled = !hasEstimate;
  els.printEstimateButton.disabled = !hasEstimate;

  const jobWritable = canAction("manageJobs");
  els.leadJobForm?.querySelectorAll("input, textarea, select, button").forEach((field) => {
    field.disabled = !jobWritable;
  });

  const financialWritable = canAction("manageJobFinancials");
  els.profitCostForm?.querySelectorAll("input, textarea, select, button").forEach((field) => {
    field.disabled = !financialWritable;
  });
  if (els.profitJobSelect) els.profitJobSelect.disabled = !financialWritable;

  const emailWritable = canAction("sendEmail");
  els.leadEmailForm?.querySelectorAll("input, textarea, button").forEach((field) => {
    field.disabled = !emailWritable;
  });

  const companyWritable = canAction("manageCompany");
  els.companyForm?.querySelectorAll("input, textarea, button").forEach((field) => {
    field.disabled = !companyWritable;
  });

  const taskWritable = canAction("manageTasks");
  els.calendarTaskForm?.querySelectorAll("input, textarea, select, button").forEach((field) => {
    field.disabled = !taskWritable;
  });
}

function renderSummary() {
  const metrics = dashboardMetrics();

  const cards = [
    ["New Leads", metrics.leads, "27% vs prior period", "user", "blue"],
    ["Estimates Sent", metrics.estimatesSent, "14% vs prior period", "file", "green"],
    ["Jobs Won", metrics.closedJobs, "29% vs prior period", "check", "purple"],
    ["Revenue Won", money.format(metrics.closedValue), "38% vs prior period", "dollar", "orange"],
    ["Pipeline Value", money.format(metrics.pipelineValue), "22% vs prior period", "bar-chart", "cyan"],
  ];

  els.summaryStrip.innerHTML = cards
    .map(
      ([label, value, caption, iconName, tone]) => `
        <article class="summary-card metric-card ${tone}">
          <span class="metric-icon" aria-hidden="true" data-icon="${iconName}"></span>
          <div>
            <span class="eyebrow">${label}</span>
            <strong>${value}</strong>
            <span class="trend-line">Up ${caption}</span>
          </div>
        </article>
      `,
    )
    .join("");
  hydrateIcons(els.summaryStrip);
}

function weatherCodeDetails(code) {
  const value = Number(code);
  if ([0].includes(value)) return { label: "Clear", icon: "sun" };
  if ([1, 2].includes(value)) return { label: "Partly Cloudy", icon: "partly" };
  if ([3].includes(value)) return { label: "Cloudy", icon: "cloud" };
  if ([45, 48].includes(value)) return { label: "Fog", icon: "fog" };
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(value)) {
    return { label: "Rain", icon: "rain" };
  }
  if ([71, 73, 75, 77, 85, 86].includes(value)) return { label: "Snow", icon: "snow" };
  if ([95, 96, 99].includes(value)) return { label: "Storms", icon: "storm" };
  return { label: "Weather", icon: "partly" };
}

function formatTemperature(value) {
  return Number.isFinite(Number(value)) ? `${Math.round(Number(value))}&deg;` : "--&deg;";
}

function weatherDayLabel(isoDate) {
  return new Date(`${isoDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

function weatherUpdatedLabel() {
  if (!weatherState.fetchedAt) return "Not updated yet";
  return `Updated ${new Date(weatherState.fetchedAt).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

function getBrowserWeatherLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Browser location is unavailable"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          label: "Your Location",
          note: "Using browser location",
        });
      },
      (error) => reject(error),
      {
        enableHighAccuracy: false,
        maximumAge: weatherRefreshMs,
        timeout: 10000,
      },
    );
  });
}

function weatherApiUrl(location) {
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: [
      "temperature_2m",
      "apparent_temperature",
      "relative_humidity_2m",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "is_day",
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
    ].join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    forecast_days: "4",
    timezone: "auto",
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

async function loadWeather({ force = false } = {}) {
  if (weatherState.status === "loading") return;
  const isFresh = weatherState.current && Date.now() - weatherState.fetchedAt < weatherRefreshMs;
  if (isFresh && !force) return;

  weatherState.status = "loading";
  weatherState.error = "";
  renderWeatherPanel();

  let location = fallbackWeatherLocation;
  let locationNote = "";
  try {
    location = await getBrowserWeatherLocation();
  } catch {
    locationNote = fallbackWeatherLocation.note;
  }

  try {
    const response = await fetch(weatherApiUrl(location));
    if (!response.ok) throw new Error("Weather service unavailable");
    const data = await response.json();
    const current = data.current || {};
    const daily = data.daily || {};
    const condition = weatherCodeDetails(current.weather_code);

    weatherState.status = "ready";
    weatherState.fetchedAt = Date.now();
    weatherState.location = {
      ...location,
      note: locationNote || location.note || "Live local weather",
    };
    weatherState.current = {
      temperature: current.temperature_2m,
      apparentTemperature: current.apparent_temperature,
      humidity: current.relative_humidity_2m,
      precipitation: current.precipitation,
      windSpeed: current.wind_speed_10m,
      condition,
    };
    weatherState.daily = (daily.time || []).slice(0, 4).map((day, index) => ({
      day,
      condition: weatherCodeDetails(daily.weather_code?.[index]),
      high: daily.temperature_2m_max?.[index],
      low: daily.temperature_2m_min?.[index],
      rainChance: daily.precipitation_probability_max?.[index],
    }));
    weatherState.error = locationNote;
  } catch {
    weatherState.status = weatherState.current ? "ready" : "error";
    weatherState.error = "Live weather is temporarily unavailable";
  }
  renderWeatherPanel();
}

function ensureWeatherData() {
  if (state.view !== "dashboard") return;
  if (!weatherState.current || Date.now() - weatherState.fetchedAt >= weatherRefreshMs) {
    loadWeather();
  }
}

function renderDashboard() {
  if (!els.views.dashboard) return;

  document.querySelectorAll("[data-leaderboard-range]").forEach((button) => {
    button.classList.toggle("active", button.dataset.leaderboardRange === state.leaderboardRange);
  });

  const closedJobs = allJobs().filter(
    (job) => job.status === "Won" && isInLeaderboardRange(job, state.leaderboardRange),
  );
  const reps = closedJobs.reduce((acc, job) => {
    const name = job.salesRep || "Unassigned";
    if (!acc.has(name)) {
      acc.set(name, { name, closedJobs: 0, value: 0 });
    }
    const rep = acc.get(name);
    rep.closedJobs += 1;
    rep.value += number(job.value);
    return acc;
  }, new Map());

  const rows = [...reps.values()].sort((a, b) => b.value - a.value || b.closedJobs - a.closedJobs);
  const rangeStartDate = rangeStart(state.leaderboardRange);
  if (els.leaderboardRangeLabel) {
    els.leaderboardRangeLabel.textContent = `${leaderboardRanges[state.leaderboardRange]} results since ${formatDate(
      rangeStartDate.toISOString().slice(0, 10),
    )}`;
  }

  if (els.leaderboardTableBody) {
    els.leaderboardTableBody.innerHTML = rows.length
      ? rows
          .map(
            (rep, index) => `
          <tr>
            <td><span class="rank-pill">#${index + 1}</span></td>
            <td class="person-cell">
              <strong>${escapeHtml(rep.name)}</strong>
              <span>${rep.closedJobs === 1 ? "1 closed job" : `${rep.closedJobs} closed jobs`}</span>
            </td>
            <td>${rep.closedJobs}</td>
            <td>${money.format(rep.value)}</td>
            <td>${money.format(rep.closedJobs ? rep.value / rep.closedJobs : 0)}</td>
          </tr>
        `,
          )
          .join("")
      : '<tr><td colspan="5"><div class="empty-state">No closed jobs in this period</div></td></tr>';
  }

  renderPipelineOverview();
  renderRevenueOverview();
  renderDashboardTasks();
  renderDashboardDonuts();
  renderRecentActivity();
  renderTodaySchedule();
  renderWeatherPanel();
  ensureWeatherData();
}

function renderDashboardTasks() {
  if (!els.dashboardTasksList) return;
  const tasks = upcomingTasks(5);
  els.dashboardTasksList.innerHTML = tasks.length
    ? tasks.map((task) => renderTaskCard(task, { compact: true })).join("")
    : '<div class="empty-state">No upcoming calendar tasks</div>';
  hydrateIcons(els.dashboardTasksList);
}

function renderPipelineOverview() {
  if (!els.pipelineOverview) return;
  const jobs = allJobs();
  const totalValue = jobs.reduce((sum, job) => sum + number(job.value), 0);
  const stages = statuses.map((status) => {
    const stageJobs = jobs.filter((job) => job.status === status);
    const stageLeadIds = new Set(stageJobs.map((job) => job.contactId));
    return {
      status,
      count: stageLeadIds.size,
      value: stageJobs.reduce((sum, job) => sum + number(job.value), 0),
    };
  });

  els.pipelineOverview.innerHTML = `
    <div class="pipeline-ribbon">
      ${stages
        .map(
          (stage, index) => `
            <button class="pipeline-stage stage-${index}" type="button" data-dashboard-stage="${escapeHtml(stage.status)}" aria-label="View ${stage.count} ${escapeHtml(stage.status)} lead${stage.count === 1 ? "" : "s"}">
              <span>${escapeHtml(stage.status)}</span>
              <strong>${stage.count}</strong>
              <small>${stage.count === 1 ? "1 lead" : `${stage.count} leads`} · ${money.format(stage.value)}</small>
            </button>
          `,
        )
        .join("")}
    </div>
    <div class="pipeline-total">Total Pipeline Value: <strong>${money.format(totalValue)}</strong></div>
  `;
}

function renderRevenueOverview() {
  if (!els.revenueChart) return;

  // Build last 6 months of real closed revenue
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
    return {
      label: d.toLocaleString("en-US", { month: "short" }),
      year: d.getFullYear(),
      month: d.getMonth(),
      value: 0,
    };
  });

  allJobs().filter((job) => job.status === "Won" && job.closedDate).forEach((job) => {
    const d = new Date(job.closedDate);
    const bucket = months.find((m) => m.year === d.getFullYear() && m.month === d.getMonth());
    if (bucket) bucket.value += number(job.value);
  });

  const max = Math.max(...months.map((m) => m.value), 1);
  const W = 390, H = 180, padL = 48, padR = 16, padT = 16, padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barW = Math.floor(chartW / months.length * 0.55);
  const gap = chartW / months.length;

  const bars = months.map((m, i) => {
    const x = padL + i * gap + (gap - barW) / 2;
    const barH = Math.max(2, (m.value / max) * chartH);
    const y = padT + chartH - barH;
    return { x, y, barH, barW, label: m.label, value: m.value };
  });

  const totalClosed = months.reduce((s, m) => s + m.value, 0);

  els.revenueChart.innerHTML = `
    <div class="chart-legend" style="margin-bottom:8px">
      <span style="font-size:12px;color:var(--muted)">Closed revenue — last 6 months</span>
      <strong style="font-size:13px">${money.format(totalClosed)}</strong>
    </div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Closed revenue by month bar chart" style="width:100%;display:block">
      <g class="chart-grid">
        <line x1="${padL}" y1="${padT}" x2="${W - padR}" y2="${padT}" stroke="var(--line)" stroke-width="0.5"/>
        <line x1="${padL}" y1="${padT + chartH / 2}" x2="${W - padR}" y2="${padT + chartH / 2}" stroke="var(--line)" stroke-width="0.5"/>
        <line x1="${padL}" y1="${padT + chartH}" x2="${W - padR}" y2="${padT + chartH}" stroke="var(--line)" stroke-width="1"/>
      </g>
      <text x="${padL - 4}" y="${padT + 4}" text-anchor="end" font-size="9" fill="var(--muted)">${money.format(max).replace(/\.00$/, "")}</text>
      <text x="${padL - 4}" y="${padT + chartH / 2 + 4}" text-anchor="end" font-size="9" fill="var(--muted)">${money.format(max / 2).replace(/\.00$/, "")}</text>
      <text x="${padL - 4}" y="${padT + chartH + 4}" text-anchor="end" font-size="9" fill="var(--muted)">$0</text>
      ${bars.map((b, i) => {
        const isLatest = i === bars.length - 1;
        return `
          <rect x="${b.x}" y="${b.y}" width="${b.barW}" height="${b.barH}"
            rx="3" fill="${isLatest ? "var(--accent)" : "var(--accent-soft)"}"
            stroke="${isLatest ? "var(--accent)" : "var(--line)"}" stroke-width="1"/>
          <text x="${b.x + b.barW / 2}" y="${H - 6}" text-anchor="middle" font-size="9" fill="var(--muted)">${b.label}</text>
          ${b.value > 0 ? `<text x="${b.x + b.barW / 2}" y="${b.y - 4}" text-anchor="middle" font-size="8" fill="${isLatest ? "var(--accent-strong)" : "var(--muted)"}">${money.format(b.value).replace(/\.00$/, "")}</text>` : ""}
        `;
      }).join("")}
    </svg>
  `;
}

function renderDashboardDonuts() {
  const leadContacts = state.contacts.filter((contact) => contact.type === "Lead");
  const sources = aggregateCounts(leadContacts, (contact) => contact.source || "Other");
  const jobsByType = aggregateCounts(allJobs(), jobType);
  const productionJobs = allJobs().filter((job) => soldJobStatuses.includes(job.status));
  const projectStatus = aggregateCounts(productionJobs, (job) => job.status);
  renderDonutWidget(els.leadSourcesChart, sources, leadContacts.length, "Total Leads");
  renderDonutWidget(els.jobsByTypeChart, jobsByType, dashboardMetrics().totalJobs, "Total Jobs");
  renderDonutWidget(
    els.projectStatusChart,
    projectStatus,
    productionJobs.length,
    "Active Projects",
  );
}

function renderDonutWidget(container, items, total, label) {
  if (!container) return;
  const colors = ["#1d5ed8", "#0f9f98", "#f59e0b", "#7651d1", "#1f9d55", "#9fb7da"];
  const sum = Math.max(items.reduce((value, item) => value + item.count, 0), 1);
  let cursor = 0;
  const gradient = items.length
    ? items
        .map((item, index) => {
          const start = cursor;
          cursor += (item.count / sum) * 100;
          return `${colors[index % colors.length]} ${start}% ${cursor}%`;
        })
        .join(", ")
    : `${colors[5]} 0% 100%`;
  container.innerHTML = `
    <div class="donut" style="--donut:${gradient}">
      <strong>${total}</strong>
      <span>${escapeHtml(label)}</span>
    </div>
    <div class="donut-legend">
      ${(items.length ? items : [{ label: "No data", count: 0 }])
        .slice(0, 5)
        .map(
          (item, index) => `
            <span><i style="background:${colors[index % colors.length]}"></i>${escapeHtml(item.label)} <small>${item.count}</small></span>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderRecentActivity() {
  if (!els.recentActivityList) return;
  const activity = dashboardActivityItems(5);
  els.recentActivityList.innerHTML = activity.length
    ? activity
        .map(
          (item) => `
          <article class="activity-item">
            <span class="activity-icon" aria-hidden="true" data-icon="${item.icon}"></span>
            <button class="link-button" type="button" data-action="open-contact" data-contact-id="${item.contactId || ""}">
              ${escapeHtml(item.title)}
            </button>
            <span>${escapeHtml(item.value)}</span>
            <small>${escapeHtml(item.meta)}</small>
          </article>
        `,
        )
        .join("")
    : '<div class="empty-state">No recent activity yet</div>';
  hydrateIcons(els.recentActivityList);
}

function renderTodaySchedule() {
  if (!els.todayScheduleList) return;
  const today = todayISO();
  const tasks = state.calendarTasks
    .filter((task) => !task.completed && String(task.dueAt).startsWith(today))
    .sort((a, b) => taskDueTime(a) - taskDueTime(b));
  const schedule = tasks.length
    ? tasks
    : [
        { title: "Follow Up Call", rep: "Sales team", dueAt: `${today}T09:00`, contactId: state.contacts[0]?.id },
        { title: "Site Inspection", rep: "Sales team", dueAt: `${today}T11:00`, contactId: state.contacts[1]?.id },
        { title: "Send Proposal", rep: "Sales team", dueAt: `${today}T13:00`, contactId: state.contacts[0]?.id },
        { title: "Team Meeting", rep: "Office", dueAt: `${today}T16:30`, contactId: "" },
      ];
  els.todayScheduleList.innerHTML = schedule
    .slice(0, 5)
    .map((task) => {
      const date = taskDueTime(task);
      const contact = getContact(task.contactId);
      const taskAction = task.id
        ? `data-action="open-calendar-task" data-task-id="${escapeHtml(task.id)}"`
        : `data-view="calendar"`;
      return `
        <button class="schedule-card" type="button" ${taskAction} aria-label="Open ${escapeHtml(
          task.title,
        )} in calendar">
          <span>${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
          <strong>${escapeHtml(task.title)}</strong>
          <small>${escapeHtml(contact?.name || task.rep || "Internal")}</small>
        </button>
      `;
    })
    .join("");
}

function renderWeatherPanel() {
  if (!els.weatherPanel) return;
  const isLoading = weatherState.status === "loading";
  const current = weatherState.current;
  const condition = current?.condition || { label: "Loading", icon: "partly" };
  const statusNote = weatherState.error || weatherState.location.note || weatherUpdatedLabel();
  els.weatherPanel.innerHTML = `
    <div class="weather-card ${isLoading ? "is-loading" : ""}">
      <header class="weather-head">
        <div>
          <p class="eyebrow">Live weather</p>
          <strong>${escapeHtml(weatherState.location.label)}</strong>
          <span>${escapeHtml(statusNote)}</span>
        </div>
        <button class="mini-button weather-refresh" type="button" title="Refresh weather" aria-label="Refresh weather" data-action="refresh-weather">
          <span aria-hidden="true" data-icon="refresh"></span>
        </button>
      </header>
      <div class="weather-main">
        <span class="weather-icon weather-${escapeHtml(condition.icon)}"></span>
        <div>
          <strong>${current ? formatTemperature(current.temperature) : "--&deg;"}</strong>
          <span>${escapeHtml(condition.label)}</span>
        </div>
      </div>
      <div class="weather-stats">
        <span><strong>${current ? formatTemperature(current.apparentTemperature) : "--&deg;"}</strong>Feels</span>
        <span><strong>${current?.windSpeed ? `${Math.round(Number(current.windSpeed))} mph` : "--"}</strong>Wind</span>
        <span><strong>${Number.isFinite(Number(current?.humidity)) ? `${Math.round(Number(current.humidity))}%` : "--"}</strong>Humidity</span>
        <span><strong>${Number.isFinite(Number(current?.precipitation)) ? `${Number(current.precipitation).toFixed(2)} in` : "--"}</strong>Rain</span>
      </div>
      <div class="weather-days">
        ${
          weatherState.daily.length
            ? weatherState.daily
                .slice(1, 4)
                .map(
                  (day) => `
                    <span>
                      ${escapeHtml(weatherDayLabel(day.day))}
                      <i class="weather-dot weather-${escapeHtml(day.condition.icon)}"></i>
                      <strong>${
                        Number.isFinite(Number(day.high)) ? Math.round(Number(day.high)) : "--"
                      }/${Number.isFinite(Number(day.low)) ? Math.round(Number(day.low)) : "--"}</strong>
                      <small>${Number.isFinite(Number(day.rainChance)) ? `${Math.round(Number(day.rainChance))}% rain` : "Forecast"}</small>
                    </span>
                  `,
                )
                .join("")
            : "<span>Forecast loading</span><span>Forecast loading</span><span>Forecast loading</span>"
        }
      </div>
    </div>
  `;
  hydrateIcons(els.weatherPanel);
}

function renderPipeline() {
  if (!els.views.pipeline) return;
  const opportunities = allJobs();
  const activeLeads = opportunities.filter((job) => !["Won", "Lost"].includes(job.status));
  const followUpsDue = state.contacts.filter((contact) => {
    const status = primaryJob(contact).status || contact.status;
    return !["Won", "Lost"].includes(status) && staleLeadDays(contact) >= 3;
  }).length;
  const metrics = dashboardMetrics();
  const statusCount = (status) => opportunities.filter((job) => job.status === status).length;

  els.pipelineBoard.innerHTML = `
    <section class="pipeline-command-center" aria-label="Pipeline pulse">
      <div class="pipeline-command-copy">
        <span class="pipeline-live-dot" aria-hidden="true"></span>
        <span>Pipeline pulse</span>
        <strong>${activeLeads.length} active opportunities moving toward a decision</strong>
      </div>
      <div class="pipeline-command-stats">
        <span><strong>${followUpsDue}</strong> need attention</span>
        <span><strong>${money.format(metrics.pipelineValue)}</strong> potential value</span>
        <span><strong>${statusCount("Won")}</strong> won</span>
      </div>
    </section>

    <div class="pipeline-journey" role="list" aria-label="Sales pipeline stages">
      ${pipelinePlaybook
        .map((stage, index) => {
          const count = statusCount(stage.status);
          return `
            <article class="pipeline-playbook-stage pipeline-playbook-stage-${index + 1}" role="listitem">
              <div class="pipeline-stage-marker" aria-hidden="true">
                <span>${index + 1}</span>
                <i data-icon="${stage.icon}"></i>
              </div>
              <div class="pipeline-stage-card">
                <header class="pipeline-stage-heading">
                  <div>
                    <p>Stage ${index + 1} &middot; ${escapeHtml(stage.phase)}</p>
                    <h3>${escapeHtml(stage.title)}</h3>
                  </div>
                  <span class="pipeline-stage-count">${count} ${count === 1 ? "lead" : "leads"}</span>
                </header>
                <p class="pipeline-stage-mission">${escapeHtml(stage.mission)}</p>
                <div class="pipeline-stage-body">
                  <div>
                    <h4>Rep actions</h4>
                    <ul class="pipeline-action-list">
                      ${stage.actions
                        .map(
                          (action) => `
                            <li>
                              <span aria-hidden="true" data-icon="check"></span>
                              ${escapeHtml(action)}
                            </li>
                          `,
                        )
                        .join("")}
                    </ul>
                  </div>
                  <aside class="pipeline-stage-gate">
                    <span>Ready to advance when</span>
                    <strong>${escapeHtml(stage.gate)}</strong>
                    <button class="pipeline-workspace-link" type="button" data-view="${stage.workspace}">
                      ${escapeHtml(stage.workspaceLabel)}
                      <span aria-hidden="true">&rarr;</span>
                    </button>
                  </aside>
                </div>
              </div>
              ${index < pipelinePlaybook.length - 1 ? '<div class="pipeline-connector" aria-hidden="true"><span></span></div>' : ""}
            </article>
          `;
        })
        .join("")}
    </div>

    <section class="pipeline-recovery-lane">
      <div class="pipeline-recovery-icon" aria-hidden="true" data-icon="refresh"></div>
      <div>
        <p class="eyebrow">Not ready is not the end</p>
        <h3>Recover, nurture, or close the loop</h3>
        <p>Record the real objection, agree on a follow-up date, and keep the lead in Contacted. Mark a lead Lost only after the rep records why the opportunity ended.</p>
      </div>
      <div class="pipeline-recovery-steps" aria-label="Lead recovery steps">
        <span><b>1</b> Name the objection</span>
        <span><b>2</b> Set the next date</span>
        <span><b>3</b> Return to the path</span>
        <span class="pipeline-lost-count"><b>${statusCount("Lost")}</b> closed as lost</span>
      </div>
    </section>
  `;
  hydrateIcons(els.pipelineBoard);
}

function renderLeadCard(contact) {
  const job = primaryJob(contact);
  const nextStatus = statuses[Math.min(statuses.indexOf(contact.status) + 1, statuses.length - 1)];
  const days = staleLeadDays(contact);
  const sc = staleClass(contact);
  const staleTag = sc ? `<span class="stale-badge ${sc}">${days}d no contact</span>` : "";
  const initials = contactInitials(contact.name);
  const avatarClass = initialsColor(contact.name);
  return `
    <article class="lead-card ${sc}">
      <header>
        <div class="lead-card-avatar ${avatarClass}">${initials}</div>
        <div class="lead-card-header-text">
          <h4>
            <button class="link-button" type="button" data-action="open-contact" data-contact-id="${contact.id}">
              ${escapeHtml(contact.name)}
            </button>
          </h4>
          <p>${escapeHtml(contact.source || "No source")} &middot; ${money.format(
            contactJobs(contact).reduce((sum, item) => sum + number(item.value), 0),
          )}</p>
        </div>
        <span class="status-pill ${statusPillClass(contact.status)}">${escapeHtml(contact.status)}</span>
      </header>
      ${staleTag}
      <p>${telLink(contact.phone) || "No phone"}<br />${escapeHtml(contact.email || "No email")}</p>
      <p>${escapeHtml(job.name)}<br />${escapeHtml((job.address || contact.address || "").split("\n")[0] || "No job address")}</p>
      <div class="card-actions">
        <button class="secondary-button" type="button" data-action="open-contact" data-contact-id="${contact.id}">
          <span aria-hidden="true" data-icon="open"></span>
          Open
        </button>
        <button class="mini-button" type="button" title="Edit contact" aria-label="Edit ${escapeHtml(
          contact.name,
        )}" data-action="edit-contact" data-contact-id="${contact.id}">
          <span aria-hidden="true" data-icon="edit"></span>
        </button>
        <button class="mini-button" type="button" title="Create estimate" aria-label="Create estimate for ${escapeHtml(
          contact.name,
        )}" data-action="estimate-contact" data-contact-id="${contact.id}">
          <span aria-hidden="true" data-icon="file"></span>
        </button>
        ${
          contact.status !== "Lost" && contact.status !== "Won"
            ? `<button class="ghost-button" type="button" data-action="advance-contact" data-contact-id="${contact.id}" data-next-status="${nextStatus}">${nextStatus}</button>`
            : ""
        }
      </div>
    </article>
  `;
}

function renderContacts() {
  const contacts = filteredContacts();
  const query = state.search.trim().toLowerCase();
  els.contactsTableBody.innerHTML = contacts.length
    ? contacts
        .map((contact) => {
          const jobs = contactJobs(contact);
          const matchingJobs = query
            ? jobs.filter((job) =>
                [job.name, job.address, job.status, job.salesRep, job.notes]
                  .filter(Boolean)
                  .join(" ")
                  .toLowerCase()
                  .includes(query),
              )
            : jobs;
          const visibleJobs = matchingJobs.length ? matchingJobs : jobs;
          const totalValue = jobs.reduce((sum, job) => sum + number(job.value), 0);
          return `
        <tr>
          <td class="person-cell">
            <button class="link-button" type="button" data-action="open-contact" data-contact-id="${contact.id}">
              ${escapeHtml(contact.name)}
            </button>
            <span>${jobs.length} job${jobs.length === 1 ? "" : "s"}</span>
            <span>${visibleJobs
              .slice(0, 2)
              .map((job) => `${escapeHtml(job.name)} - ${escapeHtml((job.address || "").split("\n")[0] || "No address")}`)
              .join("<br />")}</span>
          </td>
          <td><span class="type-pill">${escapeHtml(contact.type)}</span></td>
          <td><span class="status-pill">${escapeHtml(contact.status)}</span></td>
          <td>${escapeHtml(contact.salesRep || "Unassigned")}</td>
          <td class="contact-lines">
            <span>${escapeHtml(contact.phone || "No phone")}</span>
            <span>${escapeHtml(contact.email || "No email")}</span>
          </td>
          <td>${money.format(totalValue)}</td>
          <td>
            <div class="row-actions">
              <button class="mini-button" type="button" title="Edit contact" aria-label="Edit ${escapeHtml(
                contact.name,
              )}" data-action="edit-contact" data-contact-id="${contact.id}">
                <span aria-hidden="true" data-icon="edit"></span>
              </button>
              <button class="mini-button" type="button" title="Create estimate" aria-label="Create estimate for ${escapeHtml(
                contact.name,
              )}" data-action="estimate-contact" data-contact-id="${contact.id}">
                <span aria-hidden="true" data-icon="file"></span>
              </button>
            </div>
          </td>
        </tr>
      `;
        })
        .join("")
    : '<tr><td colspan="7"><div class="empty-state">No matching contacts</div></td></tr>';
  hydrateIcons(els.contactsTableBody);
}

function renderLeadsView() {
  if (!els.leadsList) return;
  const stage = statuses.includes(state.leadStageFilter) ? state.leadStageFilter : "";
  if (els.leadStageFilter) {
    const openLeadCount = state.contacts.filter((contact) => contact.type === "Lead").length;
    els.leadStageFilter.innerHTML = [
      `<option value="">All open leads (${openLeadCount})</option>`,
      ...statuses.map((pipelineStage) => {
        const count = state.contacts.filter((contact) =>
          contactJobs(contact).some((job) => job.status === pipelineStage),
        ).length;
        return `<option value="${escapeHtml(pipelineStage)}">${escapeHtml(pipelineStage)} (${count})</option>`;
      }),
    ].join("");
    els.leadStageFilter.value = stage;
  }
  const leads = sortLeadIntakeChronologically(filteredContacts().filter((contact) =>
    stage ? contactJobs(contact).some((job) => job.status === stage) : contact.type === "Lead",
  ));
  const filterSummary = stage
    ? `
      <div class="lead-stage-filter-banner">
        <div>
          <span class="status-pill">${escapeHtml(stage)}</span>
          <strong>${leads.length} ${leads.length === 1 ? "lead" : "leads"} in this pipeline stage</strong>
          <small>Showing every lead with a job currently in ${escapeHtml(stage)}.</small>
        </div>
        <button class="secondary-button" type="button" data-action="clear-lead-stage-filter">Show all leads</button>
      </div>
    `
    : "";
  els.leadsList.innerHTML = filterSummary + (leads.length
    ? leads.map((contact) => renderRecordCard(contact)).join("")
    : `<div class="empty-state">No leads are currently in ${escapeHtml(stage || "this view")}</div>`);
  hydrateIcons(els.leadsList);
}

function renderJobsView() {
  if (!els.jobsTableBody) return;
  const query = state.search.trim().toLowerCase();
  const jobs = allJobs().filter((job) =>
    query
      ? [job.projectNumber, job.name, job.address, job.status, job.salesRep, job.contactName]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query)
      : true,
  );
  els.jobsTableBody.innerHTML = jobs.length
    ? jobs
        .map(
          (job) => `
          <tr>
            <td class="person-cell">
              <button class="link-button job-name-link" type="button" data-action="open-job" data-contact-id="${job.contactId}" data-job-id="${job.id}">
                ${escapeHtml(job.name)}
              </button>
              ${job.projectNumber ? `<span>${escapeHtml(job.projectNumber)}</span>` : ""}
              <span>${escapeHtml(job.contactType)}</span>
            </td>
            <td>
              <button class="link-button" type="button" data-action="open-contact" data-contact-id="${job.contactId}">
                ${escapeHtml(job.contactName)}
              </button>
            </td>
            <td><span class="status-pill">${escapeHtml(job.status)}</span></td>
            <td>${escapeHtml(job.salesRep || "Unassigned")}</td>
            <td>${money.format(number(job.value))}</td>
            <td>${escapeHtml((job.address || "No address").split("\n")[0])}</td>
            <td>
              <button class="secondary-button" type="button" data-action="open-job" data-contact-id="${job.contactId}" data-job-id="${job.id}">
                <span aria-hidden="true" data-icon="open"></span>
                Open Job
              </button>
            </td>
          </tr>
        `,
        )
        .join("")
    : '<tr><td colspan="7"><div class="empty-state">No matching jobs</div></td></tr>';
  hydrateIcons(els.jobsTableBody);
}

function renderProjectsView() {
  if (!els.projectsGrid) return;
  const projects = allJobs().filter((job) => !["New", "Contacted", "Lost"].includes(job.status));
  els.projectsGrid.innerHTML = projects.length
    ? projects
        .map(
          (job) => `
          <article class="record-card">
            <span class="status-pill">${escapeHtml(job.status)}</span>
            ${job.projectNumber ? `<span class="project-number-pill">${escapeHtml(job.projectNumber)}</span>` : ""}
            <strong>${escapeHtml(job.name)}</strong>
            <span>${escapeHtml(job.contactName)} - Contract ${money.format(number(job.contractValue) || number(job.value))}</span>
            <p>${escapeHtml((job.address || "No address").split("\n")[0])}</p>
            ${(number(job.contractValue) || number(job.paidAmount)) ? paymentProgressMarkup(jobPaymentMetrics(job), { compact: true }) : ""}
            <div class="row-actions">
              <button class="secondary-button" type="button" data-action="open-job" data-contact-id="${job.contactId}" data-job-id="${job.id}">
                <span aria-hidden="true" data-icon="open"></span>
                Open Job
              </button>
            </div>
          </article>
        `,
        )
        .join("")
    : '<div class="empty-state">Projects will appear here when jobs move past contacted status</div>';
  hydrateIcons(els.projectsGrid);
}

function renderRecordCard(contact) {
  const jobs = contactJobs(contact);
  const value = jobs.reduce((sum, job) => sum + number(job.value), 0);
  const sc = staleClass(contact);
  const days = staleLeadDays(contact);
  const staleTag = sc ? `<span class="stale-badge ${sc}">${days}d no contact</span>` : "";
  const initials = contactInitials(contact.name);
  const avatarClass = initialsColor(contact.name);
  return `
    <article class="record-card ${sc}">
      <div class="record-card-top">
        <div class="lead-card-avatar ${avatarClass}" style="width:36px;height:36px;font-size:13px;flex-shrink:0">${initials}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong>${escapeHtml(contact.name)}</strong>
            <span class="status-pill ${statusPillClass(contact.status)}">${escapeHtml(contact.status)}</span>
          </div>
          <span>${escapeHtml(contact.salesRep || "Unassigned")} &middot; ${jobs.length} job${jobs.length === 1 ? "" : "s"} &middot; ${money.format(value)}</span>
        </div>
      </div>
      ${staleTag}
      <p>${telLink(contact.phone) || "No phone"}<br />${escapeHtml(contact.email || "No email")}</p>
      <div class="row-actions">
        <button class="secondary-button" type="button" data-action="open-contact" data-contact-id="${contact.id}">
          <span aria-hidden="true" data-icon="open"></span>
          Open
        </button>
        <button class="mini-button" type="button" title="Email client" aria-label="Email ${escapeHtml(
          contact.name,
        )}" data-action="open-contact-tab" data-contact-id="${contact.id}" data-tab="email">
          <span aria-hidden="true" data-icon="mail"></span>
        </button>
      </div>
    </article>
  `;
}

function jobPaymentMetrics(job = {}) {
  const contractValue = number(job.contractValue) || number(job.value);
  const paidAmount = number(job.paidAmount);
  return {
    contractValue,
    paidAmount,
    balance: Math.max(contractValue - paidAmount, 0),
    percentage: contractValue ? Math.min(100, (paidAmount / contractValue) * 100) : 0,
  };
}

function contactPaymentMetrics(contact) {
  return contactJobs(contact).reduce(
    (summary, job) => {
      const metrics = jobPaymentMetrics(job);
      summary.contractValue += metrics.contractValue;
      summary.paidAmount += metrics.paidAmount;
      return summary;
    },
    { contractValue: 0, paidAmount: 0 },
  );
}

function paymentProgressMarkup(metrics, { compact = false } = {}) {
  const percentage = metrics.contractValue ? Math.min(100, (metrics.paidAmount / metrics.contractValue) * 100) : 0;
  const rounded = Math.round(percentage);
  return `
    <div class="payment-progress ${compact ? "payment-progress-compact" : ""}">
      <div class="payment-progress-ring" style="--payment-progress:${rounded * 3.6}deg">
        <span>${rounded}%</span>
      </div>
      <div class="payment-progress-copy">
        <strong>${money.format(metrics.paidAmount)} paid</strong>
        <span>${money.format(Math.max(metrics.contractValue - metrics.paidAmount, 0))} remaining</span>
      </div>
    </div>
  `;
}

function renderLeadDetail() {
  if (!els.views.leadDetail) return;
  const contact = getSelectedContact();
  if (!contact) {
    els.leadDetailTitle.textContent = "Lead Detail";
    els.leadOverviewPanel.innerHTML = '<div class="empty-state">No lead selected</div>';
    return;
  }

  els.leadDetailTitle.textContent = contact.name;
  els.leadDetailMeta.textContent = `${contact.leadNumber ? `${contact.leadNumber} - ` : ""}${contact.type} - ${contact.status} - ${contact.salesRep || "Unassigned"}`;

  if (
    (state.leadDetailTab === "profit" && !canManageJobFinancials()) ||
    (state.leadDetailTab === "payments" && !canManageManualPayments())
  ) {
    state.leadDetailTab = "overview";
  }

  document.querySelectorAll("[data-lead-tab]").forEach((button) => {
    if (button.dataset.leadTab === "profit") {
      button.classList.toggle("hidden", !canManageJobFinancials());
    }
    if (button.dataset.leadTab === "payments") {
      button.classList.toggle("hidden", !canManageManualPayments());
    }
    button.classList.toggle("active", button.dataset.leadTab === state.leadDetailTab);
  });

  const panels = {
    overview: els.leadOverviewPanel,
    jobs: els.leadJobsPanel,
    profit: els.leadProfitPanel,
    payments: els.leadPaymentsPanel,
    email: els.leadEmailPanel,
    documents: els.leadDocumentsPanel,
    photos: els.leadPhotosPanel,
    conversation: els.leadConversationPanel,
  };
  Object.entries(panels).forEach(([tab, panel]) => {
    if (!panel) return;
    panel.classList.toggle("hidden", tab !== state.leadDetailTab);
  });

  const jobs = contactJobs(contact);
  const jobValue = jobs.reduce((sum, job) => sum + number(job.value), 0);
  const openJobs = jobs.filter((job) => !["Won", "Lost"].includes(job.status)).length;
  const payments = contactPaymentMetrics(contact);
  const paidPercentage = payments.contractValue ? (payments.paidAmount / payments.contractValue) * 100 : 0;
  els.leadDetailStats.innerHTML = [
    ["Status", contact.status, "Current job stage"],
    ["Sales Rep", contact.salesRep || "Unassigned", "Owner"],
    ["Jobs", jobs.length, `${openJobs} open`],
    ["Contract Value", money.format(payments.contractValue || jobValue), contact.leadNumber || "Assigned at estimate"],
    ["Payments", money.format(payments.paidAmount), `${paidPercentage.toFixed(0)}% paid`],
  ]
    .map(
      ([label, value, caption]) => `
        <article class="summary-card">
          <span class="eyebrow">${label}</span>
          <strong>${escapeHtml(value)}</strong>
          <span>${escapeHtml(caption)}</span>
        </article>
      `,
    )
    .join("");

  const initials = contactInitials(contact.name);
  const avatarClass = initialsColor(contact.name);
  const sc = staleClass(contact);
  const days = staleLeadDays(contact);
  els.leadOverviewPanel.innerHTML = `
    <div class="overview-hero">
      <div class="lead-card-avatar ${avatarClass}" style="width:52px;height:52px;font-size:19px;flex-shrink:0">${initials}</div>
      <div class="overview-hero-text">
        <h2 style="margin:0;font-size:20px">${escapeHtml(contact.name)}</h2>
        <p style="margin:4px 0 0;color:var(--muted);font-size:13px">${escapeHtml(contact.source || "No source")} &middot; ${escapeHtml(contact.salesRep || "Unassigned")}</p>
      </div>
      <span class="status-pill ${statusPillClass(contact.status)}" style="align-self:flex-start">${escapeHtml(contact.status)}</span>
    </div>
    ${sc ? `<div class="overview-stale-banner ${sc}"><span data-icon="alert-triangle" aria-hidden="true"></span> No contact in ${days} days — follow up soon</div>` : ""}
    <div class="overview-quick-actions">
      ${contact.phone ? `<a class="secondary-button" href="tel:${contact.phone.replace(/\D/g, "")}"><span aria-hidden="true" data-icon="phone"></span> Call</a>` : ""}
      ${contact.email ? `<button class="secondary-button" type="button" data-action="open-contact-tab" data-contact-id="${contact.id}" data-tab="email"><span aria-hidden="true" data-icon="mail"></span> Email</button>` : ""}
      <button class="secondary-button" type="button" data-action="estimate-contact" data-contact-id="${contact.id}"><span aria-hidden="true" data-icon="file"></span> Estimate</button>
      <button class="secondary-button" type="button" data-action="open-contact-tab" data-contact-id="${contact.id}" data-tab="conversation"><span aria-hidden="true" data-icon="message"></span> Log Note</button>
    </div>
    <div class="overview-info-grid">
      <div class="overview-info-box">
        <p class="overview-info-label">Contact</p>
        ${contact.phone ? `<p class="overview-info-row"><span>Phone</span>${telLink(contact.phone)}</p>` : ""}
        ${contact.email ? `<p class="overview-info-row"><span>Email</span><a href="mailto:${escapeHtml(contact.email)}" class="tel-link">${escapeHtml(contact.email)}</a></p>` : ""}
        <p class="overview-info-row"><span>Source</span>${escapeHtml(contact.source || "—")}</p>
        <p class="overview-info-row"><span>Created</span>${formatDate(contact.createdAt)}</p>
        <p class="overview-info-row"><span>Last contact</span>${formatDate(contact.lastContact)}</p>
        ${contact.closedDate ? `<p class="overview-info-row"><span>Closed</span>${formatDate(contact.closedDate)}</p>` : ""}
      </div>
      <div class="overview-info-box">
        <p class="overview-info-label">Job address${jobs.length > 1 ? "es" : ""}</p>
        ${jobs.map((job) => `
          <div class="overview-project-payment">
            <button class="overview-job-link" type="button" data-action="open-job" data-contact-id="${contact.id}" data-job-id="${job.id}">
              <span class="overview-job-link-heading">
                <strong>${escapeHtml(job.name)}</strong>
                <span class="status-pill ${statusPillClass(job.status)}">${escapeHtml(job.status)}</span>
              </span>
              ${job.projectNumber ? `<span class="project-number-inline">${escapeHtml(job.projectNumber)}</span>` : ""}
              <span class="overview-job-address">${nl2br(job.address || "No address saved")}</span>
              <span class="overview-job-open">Open this job <span aria-hidden="true">→</span></span>
            </button>
            ${(number(job.contractValue) || number(job.paidAmount)) ? paymentProgressMarkup(jobPaymentMetrics(job), { compact: true }) : ""}
          </div>
        `).join("")}
      </div>
    </div>
    ${contact.notes ? `
    <div class="overview-notes">
      <p class="overview-info-label">Notes</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:var(--ink)">${nl2br(contact.notes)}</p>
    </div>` : ""}
  `;
  hydrateIcons(els.leadOverviewPanel);

  renderLeadJobs(contact);
  renderLeadProfit(contact);
  renderLeadPayments(contact);
  renderLeadEmail(contact);
  renderLeadDocuments(contact);
  renderLeadPhotos(contact);
  renderLeadConversation(contact);
}

function renderLeadJobs(contact) {
  const jobs = contactJobs(contact);
  if (!jobs.some((job) => job.id === state.selectedLeadJobId)) {
    state.selectedLeadJobId = jobs[0]?.id || "";
  }
  els.leadJobsList.innerHTML = contactJobs(contact)
    .map(
      (job) => `
      <article class="job-card ${job.id === state.selectedLeadJobId ? "selected" : ""}" data-job-card-id="${job.id}">
        <div>
          <button class="job-select-button" type="button" data-action="open-job" data-contact-id="${contact.id}" data-job-id="${job.id}">
            <span class="job-status-row">
              <span class="status-pill ${statusPillClass(job.status)}">${escapeHtml(job.status)}</span>
              ${job.projectNumber ? `<span class="project-number-pill">${escapeHtml(job.projectNumber)}</span>` : ""}
            </span>
            <strong>${escapeHtml(job.name)}</strong>
            <span>${escapeHtml(job.salesRep || "Unassigned")} - Contract ${money.format(number(job.contractValue) || number(job.value))}</span>
            <span class="job-select-address">${nl2br(job.address || "No address saved")}</span>
          </button>
          ${job.notes ? `<p>${nl2br(job.notes)}</p>` : ""}
          ${(number(job.contractValue) || number(job.paidAmount)) ? paymentProgressMarkup(jobPaymentMetrics(job), { compact: true }) : ""}
        </div>
        <div class="row-actions">
          <button class="secondary-button" type="button" data-action="open-job-photos" data-contact-id="${contact.id}" data-job-id="${job.id}">
            <span aria-hidden="true" data-icon="image"></span>
            Photos (${contact.documents.filter((document) => document.kind === "photo" && document.jobId === job.id).length})
          </button>
          <button class="secondary-button" type="button" data-action="estimate-job" data-contact-id="${contact.id}" data-job-id="${
            job.id
          }">
            <span aria-hidden="true" data-icon="file"></span>
            Estimate
          </button>
          <button class="secondary-button" type="button" data-action="edit-job" data-job-id="${job.id}">
            <span aria-hidden="true" data-icon="edit"></span>
            Edit
          </button>
          ${
            canManageJobFinancials()
              ? `<button class="secondary-button" type="button" data-action="open-job-profit" data-contact-id="${contact.id}" data-job-id="${job.id}">
                  <span aria-hidden="true" data-icon="dollar"></span>
                  Profit & Cost
                </button>`
              : ""
          }
          ${
            canManageManualPayments()
              ? `<button class="secondary-button" type="button" data-action="open-contact-tab" data-contact-id="${contact.id}" data-job-id="${job.id}" data-tab="payments">
                  <span aria-hidden="true" data-icon="dollar"></span>
                  Payments
                </button>`
              : ""
          }
          ${
            contactJobs(contact).length > 1
              ? `<button class="mini-button" type="button" title="Remove job" aria-label="Remove ${escapeHtml(
                  job.name,
                )}" data-action="delete-job" data-job-id="${job.id}">
                  <span aria-hidden="true" data-icon="trash"></span>
                </button>`
              : ""
          }
        </div>
      </article>
    `,
    )
    .join("");
  hydrateIcons(els.leadJobsList);
}

function selectedLeadJob(contact) {
  const jobs = contactJobs(contact);
  const selected = jobs.find((job) => job.id === state.selectedLeadJobId) || jobs[0];
  state.selectedLeadJobId = selected?.id || "";
  state.selectedProfitJobId = selected?.id || "";
  return selected;
}

function selectedProfitJob(contact) {
  return selectedLeadJob(contact);
}

function jobContextOptions(contact, selectedId = state.selectedLeadJobId) {
  return contactJobs(contact)
    .map(
      (job) =>
        `<option value="${escapeHtml(job.id)}" ${job.id === selectedId ? "selected" : ""}>${escapeHtml(job.name)} - ${escapeHtml(
          (job.address || "No address").split("\n")[0],
        )}</option>`,
    )
    .join("");
}

function jobCostTotal(job) {
  return (job?.costItems || []).reduce((sum, item) => sum + number(item.amount), 0);
}

function jobProfitMetrics(job) {
  const contractValue = number(job?.value);
  const totalCost = jobCostTotal(job);
  const profit = contractValue - totalCost;
  const margin = contractValue ? (profit / contractValue) * 100 : 0;
  return { contractValue, totalCost, profit, margin };
}

function renderLeadProfit(contact) {
  if (!els.leadProfitPanel) return;
  if (!canManageJobFinancials()) {
    els.leadProfitPanel.innerHTML = '<div class="empty-state">Profit and cost is restricted to upper admin.</div>';
    return;
  }

  const selected = selectedProfitJob(contact);

  if (els.profitJobSelect) {
    els.profitJobSelect.innerHTML = jobContextOptions(contact, selected?.id);
  }

  const metrics = jobProfitMetrics(selected);
  if (els.profitSummary) {
    els.profitSummary.innerHTML = [
      ["Contract Value", money.format(metrics.contractValue), "Customer/job value"],
      ["Total Cost", money.format(metrics.totalCost), `${selected.costItems.length} cost line${selected.costItems.length === 1 ? "" : "s"}`],
      ["Projected Profit", money.format(metrics.profit), `${metrics.margin.toFixed(1)}% gross margin`],
    ]
      .map(
        ([label, value, caption]) => `
          <article class="summary-card">
            <span class="eyebrow">${label}</span>
            <strong>${escapeHtml(value)}</strong>
            <span>${escapeHtml(caption)}</span>
          </article>
        `,
      )
      .join("");
  }

  if (els.profitCostList) {
    const rows = [...(selected.costItems || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    els.profitCostList.innerHTML = rows.length
      ? rows
          .map(
            (item) => `
              <article class="cost-card">
                <div>
                  <span class="status-pill">${escapeHtml(item.category)}</span>
                  <strong>${money.format(number(item.amount))}</strong>
                  <span>${escapeHtml(item.vendor || "No vendor")} - ${escapeHtml(formatDate(item.date))}</span>
                  <p>${nl2br(item.description || "No description")}</p>
                  <small>${escapeHtml(item.reference || "No reference")} ${item.paid ? "- Paid" : "- Unpaid"}</small>
                </div>
                <div class="row-actions">
                  <button class="mini-button" type="button" title="Edit cost" aria-label="Edit cost" data-action="edit-cost-item" data-cost-id="${item.id}">
                    <span aria-hidden="true" data-icon="edit"></span>
                  </button>
                  <button class="mini-button" type="button" title="Delete cost" aria-label="Delete cost" data-action="delete-cost-item" data-cost-id="${item.id}">
                    <span aria-hidden="true" data-icon="trash"></span>
                  </button>
                </div>
              </article>
            `,
          )
          .join("")
      : '<div class="empty-state">No costs have been entered for this job yet.</div>';
    hydrateIcons(els.profitCostList);
  }
}

function renderLeadPayments(contact) {
  if (!els.leadPaymentsPanel) return;
  if (!canManageManualPayments()) {
    els.leadPaymentsPanel.innerHTML = '<div class="empty-state">Payments are restricted to administrators.</div>';
    return;
  }

  const job = selectedLeadJob(contact);
  if (!job) return;
  if (els.paymentJobSelect) els.paymentJobSelect.innerHTML = jobContextOptions(contact, job.id);
  if (els.manualPaymentForm && !els.manualPaymentForm.elements.date.value) fillManualPaymentForm();

  const metrics = jobPaymentMetrics(job);
  const manualPaidAmount = (job.manualPayments || []).reduce((sum, payment) => sum + number(payment.amount), 0);
  const squarePaidAmount = number(job.squarePaidAmount);
  const overpayment = Math.max(metrics.paidAmount - metrics.contractValue, 0);
  const balanceLabel = overpayment ? "Customer Credit" : "Balance Due";
  const balanceAmount = overpayment || metrics.balance;
  const roundedPercent = Math.round(metrics.percentage);

  if (els.paymentSummary) {
    els.paymentSummary.innerHTML = [
      ["Contract Value", money.format(metrics.contractValue), job.projectNumber || job.name],
      ["Total Collected", money.format(metrics.paidAmount), `${roundedPercent}% paid`],
      [balanceLabel, money.format(balanceAmount), overpayment ? "Collected above contract value" : "Still owed on this job"],
      ["Payment Sources", `${money.format(squarePaidAmount)} Square`, `${money.format(manualPaidAmount)} recorded manually`],
    ]
      .map(
        ([label, value, caption]) => `
          <article class="summary-card">
            <span class="eyebrow">${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
            <span>${escapeHtml(caption)}</span>
          </article>
        `,
      )
      .join("");
  }

  if (els.manualPaymentList) {
    const manualRows = [...(job.manualPayments || [])].sort((a, b) =>
      `${b.date}|${b.createdAt}`.localeCompare(`${a.date}|${a.createdAt}`),
    );
    const squareRow = squarePaidAmount
      ? `
          <article class="cost-card payment-ledger-card payment-ledger-square">
            <div>
              <span class="status-pill pill-won">Square · Automatic</span>
              <strong>${money.format(squarePaidAmount)}</strong>
              <span>${job.squareLastPaymentAt ? `Updated ${escapeHtml(formatDate(job.squareLastPaymentAt))}` : "Synced from Square invoices"}</span>
              <p>Square payments are refreshed automatically and cannot be edited here.</p>
            </div>
          </article>
        `
      : "";
    const manualMarkup = manualRows
      .map(
        (payment) => `
          <article class="cost-card payment-ledger-card">
            <div>
              <span class="status-pill">${escapeHtml(payment.method)}</span>
              <strong>${money.format(number(payment.amount))}</strong>
              <span>${escapeHtml(formatDate(payment.date))}${payment.reference ? ` · ${escapeHtml(payment.reference)}` : ""}</span>
              <p>${nl2br(payment.note || "No note")}</p>
              <small>Recorded by ${escapeHtml(payment.createdBy || "CRM admin")}</small>
            </div>
            <div class="row-actions">
              <button class="mini-button" type="button" title="Edit payment" aria-label="Edit payment" data-action="edit-manual-payment" data-payment-id="${payment.id}">
                <span aria-hidden="true" data-icon="edit"></span>
              </button>
              <button class="mini-button" type="button" title="Delete payment" aria-label="Delete payment" data-action="delete-manual-payment" data-payment-id="${payment.id}">
                <span aria-hidden="true" data-icon="trash"></span>
              </button>
            </div>
          </article>
        `,
      )
      .join("");
    els.manualPaymentList.innerHTML = squareRow || manualMarkup
      ? `${squareRow}${manualMarkup}`
      : '<div class="empty-state">No payments have been collected for this job yet.</div>';
    hydrateIcons(els.manualPaymentList);
  }
}

function fillManualPaymentForm(payment = {}) {
  if (!els.manualPaymentForm) return;
  const data = {
    paymentId: "",
    date: todayISO(),
    method: "Check",
    amount: "",
    reference: "",
    note: "",
    ...payment,
  };
  Object.entries(data).forEach(([key, value]) => {
    const field = els.manualPaymentForm.elements[key];
    if (field) field.value = value ?? "";
  });
  if (els.manualPaymentSaveButton) {
    els.manualPaymentSaveButton.lastChild.textContent = payment.id ? " Update Payment" : " Record Payment";
  }
}

async function saveManualPayment(event) {
  event.preventDefault();
  if (!canManageManualPayments()) {
    showToast("Only an administrator can record payments");
    return;
  }
  const contact = getSelectedContact();
  const job = selectedLeadJob(contact);
  if (!contact || !job) return;
  const formData = new FormData(els.manualPaymentForm);
  const amount = Math.round(number(formData.get("amount")) * 100) / 100;
  if (amount <= 0) {
    setSaveState(els.manualPaymentSaveStatus, "Enter a payment amount greater than $0.00.", "error");
    return;
  }

  const paymentId = formData.get("paymentId") || uid("payment");
  const previousPayments = [...(job.manualPayments || [])];
  const existing = previousPayments.find((payment) => payment.id === paymentId);
  const now = new Date().toISOString();
  const payment = normalizeManualPayment({
    ...(existing || { id: paymentId, createdAt: now }),
    id: paymentId,
    date: formData.get("date") || todayISO(),
    method: formData.get("method") || "Other",
    amount,
    reference: String(formData.get("reference") || "").trim(),
    note: String(formData.get("note") || "").trim(),
    updatedAt: now,
    createdBy: existing?.createdBy || state.currentUser.name || state.currentUser.email || "CRM admin",
  });

  updateSelectedProfitJob((currentJob) => ({
    ...currentJob,
    manualPayments: existing
      ? (currentJob.manualPayments || []).map((item) => (item.id === paymentId ? payment : item))
      : [payment, ...(currentJob.manualPayments || [])],
  }));
  const updatedContact = addContactUpdate(contact.id, {
    author: state.currentUser.name || "CRM admin",
    jobId: job.id,
    message: `${existing ? "Updated" : "Recorded"} ${payment.method} payment on ${job.name}: ${money.format(payment.amount)}.`,
  });
  const updateId = updatedContact?.updates?.[0]?.id || "";

  state.leadDetailTab = "payments";
  saveState({ localOnly: true });
  renderLeadDetail();
  setSaveState(els.manualPaymentSaveStatus, "Saving securely to the shared CRM...", "saving");
  els.manualPaymentSaveButton.disabled = true;
  let saved = false;
  try {
    saved = await persistManualPaymentRecord(job.id, paymentId, true, updateId);
  } catch (error) {
    console.warn("Payment write could not be confirmed", error);
  } finally {
    els.manualPaymentSaveButton.disabled = false;
  }

  if (!saved) {
    updateContact(contact.id, (current) => ({
      ...current,
      jobs: contactJobs(current).map((item) =>
        item.id === job.id ? { ...item, manualPayments: previousPayments } : item,
      ),
      updates: (current.updates || []).filter((update) => update.id !== updateId),
    }));
    saveState({ localOnly: true });
    renderLeadDetail();
    setSaveState(els.manualPaymentSaveStatus, "Payment was not saved to the shared CRM. Please try again.", "error");
    return;
  }

  fillManualPaymentForm();
  setSaveState(els.manualPaymentSaveStatus, "Payment saved to the shared CRM.", "success");
  saveState();
  render();
  showToast(`${payment.method} payment recorded`);
}

function editManualPayment(paymentId) {
  if (!canManageManualPayments()) return;
  const contact = getSelectedContact();
  const job = selectedLeadJob(contact);
  const payment = (job?.manualPayments || []).find((item) => item.id === paymentId);
  if (!payment) return;
  state.leadDetailTab = "payments";
  renderLeadDetail();
  fillManualPaymentForm({ ...payment, paymentId: payment.id });
  els.manualPaymentForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function deleteManualPayment(paymentId) {
  if (!canManageManualPayments()) return;
  const contact = getSelectedContact();
  const job = selectedLeadJob(contact);
  const payment = (job?.manualPayments || []).find((item) => item.id === paymentId);
  if (!contact || !job || !payment) return;
  if (!window.confirm(`Delete the ${money.format(payment.amount)} ${payment.method} payment from ${job.name}?`)) return;

  const previousPayments = [...(job.manualPayments || [])];
  updateSelectedProfitJob((currentJob) => ({
    ...currentJob,
    manualPayments: (currentJob.manualPayments || []).filter((item) => item.id !== paymentId),
  }));
  const updatedContact = addContactUpdate(contact.id, {
    author: state.currentUser.name || "CRM admin",
    jobId: job.id,
    message: `Removed ${payment.method} payment from ${job.name}: ${money.format(payment.amount)}.`,
  });
  const updateId = updatedContact?.updates?.[0]?.id || "";
  saveState({ localOnly: true });
  renderLeadDetail();
  let saved = false;
  try {
    saved = await persistManualPaymentRecord(job.id, paymentId, false, updateId);
  } catch (error) {
    console.warn("Payment deletion could not be confirmed", error);
  }
  if (!saved) {
    updateContact(contact.id, (current) => ({
      ...current,
      jobs: contactJobs(current).map((item) =>
        item.id === job.id ? { ...item, manualPayments: previousPayments } : item,
      ),
      updates: (current.updates || []).filter((update) => update.id !== updateId),
    }));
    saveState({ localOnly: true });
    renderLeadDetail();
    showToast("Payment was not deleted because the shared CRM did not confirm the change");
    return;
  }
  fillManualPaymentForm();
  saveState();
  render();
  showToast("Payment deleted");
}

function fillProfitCostForm(item = {}) {
  if (!els.profitCostForm) return;
  const data = {
    costId: "",
    date: todayISO(),
    category: "Materials",
    vendor: "",
    amount: "",
    description: "",
    reference: "",
    paid: false,
    ...item,
  };
  Object.entries(data).forEach(([key, value]) => {
    const field = els.profitCostForm.elements[key];
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value ?? "";
  });
}

function updateSelectedProfitJob(updater) {
  const contact = getSelectedContact();
  if (!contact || !state.selectedLeadJobId) return null;
  let updatedJob = null;
  updateContact(contact.id, (current) => {
    const jobs = contactJobs(current).map((job) => {
      if (job.id !== state.selectedLeadJobId) return job;
      updatedJob = normalizeJob(updater({ ...job }), current);
      return updatedJob;
    });
    const primary = jobs[0];
    return {
      ...current,
      jobs,
      status: primary.status,
      value: primary.value,
      salesRep: primary.salesRep,
      address: primary.address,
      closedDate: primary.closedDate,
    };
  });
  return updatedJob;
}

async function saveProfitCost(event) {
  event.preventDefault();
  if (!requireAction("manageJobFinancials")) return;
  const contact = getSelectedContact();
  const job = selectedProfitJob(contact);
  if (!contact || !job) return;
  state.selectedLeadJobId = job.id;
  state.selectedProfitJobId = job.id;
  const formData = new FormData(els.profitCostForm);
  const costId = formData.get("costId") || uid("cost");
  els.profitCostForm.elements.costId.value = costId;
  const existing = (job.costItems || []).find((item) => item.id === costId);
  const nextItem = normalizeCostItem({
    ...(existing || { id: costId }),
    id: costId,
    date: formData.get("date") || todayISO(),
    category: formData.get("category"),
    vendor: formData.get("vendor").trim(),
    amount: number(formData.get("amount")),
    description: formData.get("description").trim(),
    reference: formData.get("reference").trim(),
    paid: formData.get("paid") === "on",
    createdBy: state.currentUser.name || state.currentUser.email || "Upper admin",
  });

  updateSelectedProfitJob((currentJob) => ({
    ...currentJob,
    costItems: existing
      ? (currentJob.costItems || []).map((item) => (item.id === costId ? nextItem : item))
      : [nextItem, ...(currentJob.costItems || [])],
  }));

  const costUpdateContact = addContactUpdate(contact.id, {
    author: state.currentUser.name || "Upper admin",
    jobId: job.id,
    message: `${existing ? "Updated" : "Added"} cost on ${job.name}: ${money.format(nextItem.amount)} ${nextItem.category}.`,
  });

  state.leadDetailTab = "profit";
  saveState({ localOnly: true });
  render();
  setSaveState(els.profitSaveStatus, "Saving securely to the shared CRM...", "saving");
  els.profitSaveButton.disabled = true;
  let saved = false;
  try {
    saved = await persistProfitCostRecord(job.id, costId, costUpdateContact?.updates?.[0]?.id || "");
  } catch (error) {
    console.warn("Profit and Cost write could not be confirmed", error);
  } finally {
    els.profitSaveButton.disabled = false;
  }
  setSaveState(
    els.profitSaveStatus,
    saved ? "Cost saved to the shared CRM." : "Not saved to the shared CRM. Keep this page open and try again.",
    saved ? "success" : "error",
  );
  if (!saved) return;
  fillProfitCostForm();
  showToast("Cost saved to the shared CRM");
}

function editCostItem(costId) {
  if (!requireAction("manageJobFinancials")) return;
  const contact = getSelectedContact();
  const job = selectedProfitJob(contact);
  const item = (job?.costItems || []).find((cost) => cost.id === costId);
  if (!item) return;
  state.leadDetailTab = "profit";
  renderLeadDetail();
  fillProfitCostForm({ ...item, costId: item.id });
}

function deleteCostItem(costId) {
  if (!requireAction("manageJobFinancials")) return;
  const contact = getSelectedContact();
  const job = selectedProfitJob(contact);
  if (!contact || !job) return;
  const item = (job.costItems || []).find((cost) => cost.id === costId);
  updateSelectedProfitJob((currentJob) => ({
    ...currentJob,
    costItems: (currentJob.costItems || []).filter((cost) => cost.id !== costId),
  }));
  addContactUpdate(contact.id, {
    author: state.currentUser.name || "Upper admin",
    jobId: job.id,
    message: `Removed cost on ${job.name}: ${item ? money.format(item.amount) : "cost item"}.`,
  });
  fillProfitCostForm();
  saveState();
  render();
  showToast("Cost removed");
}

function fillJobForm(job = {}) {
  const contact = getSelectedContact();
  const data = {
    jobId: "",
    name: "",
    status: "New",
    value: "",
    salesRep: contact?.salesRep || "",
    lastContact: todayISO(),
    closedDate: "",
    address: "",
    notes: "",
    ...job,
  };
  Object.entries(data).forEach(([key, value]) => {
    const field = els.leadJobForm.elements[key];
    if (field) field.value = key === "value" ? formatCurrencyInput(value) : value ?? "";
  });
}

async function saveLeadJob(event) {
  event.preventDefault();
  if (!requireAction("manageJobs")) return;
  let contact = getSelectedContact();
  if (!contact) return;
  const formData = new FormData(els.leadJobForm);
  const jobId = formData.get("jobId") || uid("job");
  const existing = contactJobs(contact).find((job) => job.id === jobId);
  let reservedProjectNumber = existing?.projectNumber || "";
  if (!existing && contact.leadNumber && canUseCloudSync()) {
    try {
      const reservation = await reserveSharedSalesNumbers(contact.id, jobId);
      reservedProjectNumber = reservation.projectNumber;
      contact = getSelectedContact();
    } catch (error) {
      setSaveState(els.jobSaveStatus, error.message || "A shared project number could not be reserved.", "error");
      return;
    }
  }
  const job = normalizeJob(
    {
      ...(existing || { id: jobId, createdAt: todayISO() }),
      id: jobId,
      projectNumber: existing?.projectNumber || reservedProjectNumber || (contact.leadNumber ? nextProjectNumber(contact) : ""),
      name: formData.get("name").trim(),
      status: formData.get("status"),
      value: number(formData.get("value")),
      contractValue: number(formData.get("value")),
      salesRep: formData.get("salesRep").trim() || contact.salesRep || "Unassigned",
      lastContact: formData.get("lastContact"),
      closedDate:
        formData.get("closedDate") ||
        (soldJobStatuses.includes(formData.get("status")) ? existing?.closedDate || todayISO() : ""),
      address: formData.get("address").trim(),
      notes: formData.get("notes").trim(),
    },
    contact,
  );

  const jobUpdate = {
    id: uid("update"),
    author: job.salesRep || "Local user",
    status: job.status,
    jobId: job.id,
    message: `${existing ? "Updated" : "Added"} job: ${job.name}. Status: ${job.status}.`,
    createdAt: new Date().toISOString(),
  };
  updateContact(contact.id, (current) => {
    const jobs = contactJobs(current);
    const nextJobs = existing ? jobs.map((item) => (item.id === jobId ? job : item)) : [job, ...jobs];
    const primary = nextJobs[0];
    return {
      ...current,
      jobs: nextJobs,
      status: primary.status,
      type: soldJobStatuses.includes(primary.status) ? "Customer" : current.type,
      value: primary.value,
      salesRep: primary.salesRep,
      address: primary.address,
      closedDate: primary.closedDate,
      updates: [jobUpdate, ...(current.updates || [])],
    };
  });

  state.selectedLeadJobId = job.id;
  state.leadDetailTab = "jobs";
  saveState({ localOnly: true });
  window.clearTimeout(durableSaveTimer);
  render();
  setSaveState(els.jobSaveStatus, "Saving job to the shared CRM...", "saving");
  if (els.jobSaveButton) els.jobSaveButton.disabled = true;
  let saved = !canUseCloudSync();
  try {
    if (canUseCloudSync()) saved = await persistLeadJobRecord(job.id, jobUpdate.id);
  } catch (error) {
    console.warn("Job write could not be confirmed", error);
    saved = false;
  } finally {
    if (els.jobSaveButton) els.jobSaveButton.disabled = false;
  }
  setSaveState(
    els.jobSaveStatus,
    saved ? "Job saved to the shared CRM." : "Not saved to the shared CRM. Keep this page open and try again.",
    saved ? "success" : "error",
  );
  if (!saved) {
    showToast("Job was not confirmed in the shared CRM");
    return;
  }
  queueCloudSave();
  fillJobForm({ ...job, jobId: job.id });
  showToast(`${job.name} saved to the shared CRM`);
}

function editLeadJob(jobId) {
  const contact = getSelectedContact();
  const job = contactJobs(contact).find((item) => item.id === jobId);
  if (!job) return;
  state.selectedLeadJobId = jobId;
  state.selectedProfitJobId = jobId;
  state.leadDetailTab = "jobs";
  renderLeadDetail();
  fillJobForm({ ...job, jobId: job.id });
}

function deleteLeadJob(jobId) {
  if (!requireAction("manageJobs")) return;
  const contact = getSelectedContact();
  if (!contact || contactJobs(contact).length <= 1) return;
  const job = contactJobs(contact).find((item) => item.id === jobId);
  if (!job) return;
  const hasHistory = state.estimates.some((estimate) => estimate.contactId === contact.id && estimate.jobId === jobId) ||
    (job.manualPayments || []).length || number(job.paidAmount) > 0 || (job.costItems || []).length ||
    (job.emails || []).length || (contact.updates || []).some((update) => update.jobId === jobId) ||
    Object.values(state.company.jobConversations || {}).some((entry) => entry.jobId === jobId && (entry.messages || []).length);
  if (hasHistory) {
    showToast("This job has estimates, payments, costs, or history. Keep it for your records instead of deleting it.");
    return;
  }
  const linkedDocumentCount = (contact.documents || []).filter((document) => document.jobId === jobId).length;
  if (linkedDocumentCount) {
    showToast(
      `Remove the ${linkedDocumentCount} file${linkedDocumentCount === 1 ? "" : "s"} from ${job?.name || "this job"} before deleting it.`,
    );
    return;
  }
  updateContact(contact.id, (current) => {
    const nextJobs = contactJobs(current).filter((item) => item.id !== jobId);
    const primary = nextJobs[0];
    return {
      ...current,
      jobs: nextJobs,
      status: primary.status,
      value: primary.value,
      salesRep: primary.salesRep,
      address: primary.address,
      closedDate: primary.closedDate,
      updates: [
        {
          id: uid("update"),
          author: primary.salesRep || "Local user",
          message: `Removed job: ${job?.name || "job"}.`,
          createdAt: new Date().toISOString(),
        },
        ...(current.updates || []),
      ],
    };
  });
  state.selectedLeadJobId = contactJobs(getContact(contact.id))[0]?.id || "";
  saveState();
  render();
  showToast("Job removed");
}

function defaultLeadEmail(contact, job = selectedLeadJob(contact)) {
  const projectLabel = job?.projectNumber ? `${job.projectNumber} - ${job.name}` : job?.name || "your project";
  return {
    fromEmail: state.currentUser.email || state.company.email || "",
    toEmail: contact.email || "",
    subject: `${state.company.name} follow-up for ${projectLabel}`,
    message: `Hi ${contact.name},\n\nI wanted to follow up on ${projectLabel}.\n\nPlease let me know if you have any questions or if there is a good time to connect.\n\nThank you,\n${state.currentUser.name || state.company.name}`,
  };
}

function renderLeadEmail(contact) {
  if (!els.leadEmailForm) return;
  const job = selectedLeadJob(contact);
  if (els.leadEmailJobSelect) {
    els.leadEmailJobSelect.innerHTML = jobContextOptions(contact, job?.id);
    els.leadEmailJobSelect.disabled = !job;
  }
  if (els.leadEmailHeading) els.leadEmailHeading.textContent = job ? `${job.name} Email` : "Email for this job";
  const data = defaultLeadEmail(contact, job);
  Object.entries(data).forEach(([key, value]) => {
    const field = els.leadEmailForm.elements[key];
    if (field && !field.matches(":focus")) field.value = value;
  });
  if (els.leadEmailHistory) {
    const emails = [...(job?.emails || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    els.leadEmailHistory.innerHTML = emails.length
      ? emails
          .map(
            (email) => `
              <article class="conversation-item">
                <div class="conversation-meta">
                  <strong>${escapeHtml(email.subject || "Client email")}</strong>
                  <span>${escapeHtml(formatDateTime(email.createdAt))}</span>
                </div>
                <span class="status-pill">${escapeHtml(email.toEmail || "No recipient")}</span>
                <p>${nl2br(email.message || "No message saved")}</p>
                <small>Prepared by ${escapeHtml(email.createdBy || "CRM user")}</small>
              </article>`,
          )
          .join("")
      : `<div class="empty-state">No email activity saved for ${escapeHtml(job?.name || "this job")} yet.</div>`;
  }
}

function leadEmailPayload() {
  const contact = getSelectedContact();
  if (!contact || !els.leadEmailForm) return null;
  const job = selectedLeadJob(contact);
  if (!job) return null;
  const formData = new FormData(els.leadEmailForm);
  return {
    contact,
    job,
    fromEmail: formData.get("fromEmail").trim(),
    toEmail: formData.get("toEmail").trim(),
    subject: formData.get("subject").trim(),
    message: formData.get("message").trim(),
  };
}

function mailtoUrl(toEmail, subject, message) {
  return `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    message,
  )}`;
}

function submitLeadEmail(event) {
  event.preventDefault();
  if (!requireAction("sendEmail")) return;
  const payload = leadEmailPayload();
  if (!payload) return;
  if (!payload.toEmail) {
    showToast("Add a client email address first");
    return;
  }
  if (payload.fromEmail) {
    state.currentUser.email = payload.fromEmail;
  }
  const emailRecord = normalizeJobEmail({
    id: uid("job_email"),
    fromEmail: payload.fromEmail,
    toEmail: payload.toEmail,
    subject: payload.subject,
    message: payload.message,
    createdBy: state.currentUser.name || state.currentUser.email || "CRM user",
  });
  updateContact(payload.contact.id, (current) => ({
    ...current,
    jobs: contactJobs(current).map((job) =>
      job.id === payload.job.id ? { ...job, emails: [emailRecord, ...(job.emails || [])] } : job,
    ),
  }));
  const emailUpdateContact = addContactUpdate(payload.contact.id, {
    author: state.currentUser.name || "Local user",
    jobId: payload.job.id,
    message: `Opened email draft: ${payload.subject || "Client email"}.`,
  });
  saveState({ localOnly: true });
  renderLeadEmail(getSelectedContact());
  setSaveState(els.leadEmailSaveStatus, "Email saved to this job. Syncing in the background...", "saving");
  const emailSave = canUseCloudSync()
    ? persistLeadJobRecord(payload.job.id, emailUpdateContact?.updates?.[0]?.id || "")
    : Promise.resolve(true);
  void emailSave
    .then((saved) => {
      if (!saved) {
        queueDurableRecordsSave();
        setSaveState(els.leadEmailSaveStatus, "Email is saved locally and will retry shared CRM sync.", "error");
        return;
      }
      queueCloudSave();
      setSaveState(els.leadEmailSaveStatus, "Email activity saved to this job.", "success");
    })
    .catch((error) => {
      console.warn("Job email sync failed", error);
      queueDurableRecordsSave();
      setSaveState(els.leadEmailSaveStatus, "Email is saved locally and will retry shared CRM sync.", "error");
    });
  window.location.href = mailtoUrl(payload.toEmail, payload.subject, payload.message);
  showToast(`Email draft opened and saved to ${payload.job.name}`);
}

async function copyLeadEmail() {
  if (!requireAction("sendEmail")) return;
  const payload = leadEmailPayload();
  if (!payload) return;
  const text = `To: ${payload.toEmail}\nFrom: ${payload.fromEmail}\nSubject: ${payload.subject}\n\n${payload.message}`;
  try {
    await navigator.clipboard.writeText(text);
    showToast("Email copied to clipboard");
  } catch {
    showToast("Clipboard access was blocked");
  }
}

function renderLeadDocuments(contact) {
  const selectedJob = selectedLeadJob(contact);
  const configuredCategories = state.company.documentCategories || [];
  const visibleCategories = configuredCategories.filter(
    (category) =>
      category.active ||
      contact.documents.some(
        (document) =>
          document.kind !== "photo" && document.jobId === selectedJob?.id && document.categoryId === category.id,
      ),
  );
  const activeCategories = configuredCategories.filter((category) => category.active);
  const selectedCategoryId = activeCategories.some((category) => category.id === els.leadDocumentCategory?.value)
    ? els.leadDocumentCategory.value
    : activeCategories[0]?.id || "";

  if (els.leadDocumentJobSelect) {
    els.leadDocumentJobSelect.innerHTML = jobContextOptions(contact, selectedJob?.id);
    els.leadDocumentJobSelect.disabled = !selectedJob;
  }
  if (els.leadDocumentHeading) {
    els.leadDocumentHeading.textContent = selectedJob ? `${selectedJob.name} Documents` : "Files for this job";
  }
  if (els.leadDocumentCategory) {
    els.leadDocumentCategory.innerHTML = activeCategories
      .map(
        (category) =>
          `<option value="${escapeHtml(category.id)}" ${category.id === selectedCategoryId ? "selected" : ""}>${escapeHtml(category.name)}</option>`,
      )
      .join("");
    els.leadDocumentCategory.disabled = !activeCategories.length;
  }
  if (els.uploadLeadDocumentButton) {
    els.uploadLeadDocumentButton.disabled = !selectedJob || !activeCategories.length || !canAction("manageDocuments");
  }

  els.leadDocumentsList.innerHTML = visibleCategories.length
    ? visibleCategories
        .map((category) => {
          const documents = contact.documents
            .filter(
              (document) =>
                document.kind !== "photo" &&
                document.jobId === selectedJob?.id &&
                document.categoryId === category.id,
            )
            .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
          return `
            <section class="document-folder ${category.active ? "" : "is-inactive"}" style="--category-color:${escapeHtml(category.color)}">
              <div class="document-folder-header">
                <div class="document-folder-title">
                  <span class="document-folder-icon" aria-hidden="true" data-icon="${escapeHtml(category.icon)}"></span>
                  <div>
                    <h3>${escapeHtml(category.name)}</h3>
                    <span>${documents.length} document${documents.length === 1 ? "" : "s"}${category.active ? "" : " · Inactive"}</span>
                  </div>
                </div>
                ${
                  category.active
                    ? `<button class="mini-button" type="button" title="Upload to ${escapeHtml(category.name)}" data-action="upload-to-category" data-category-id="${escapeHtml(category.id)}"><span aria-hidden="true" data-icon="upload"></span></button>`
                    : ""
                }
              </div>
              <div class="document-folder-files">
                ${
                  documents.length
                    ? documents
                        .map(
                          (document) => `
                            <article class="document-card">
                              <div>
                                <strong>${escapeHtml(document.name)}</strong>
                                <span>${escapeHtml(formatBytes(document.size))} · ${escapeHtml(document.type)} · Version ${escapeHtml(document.versionNumber)} · ${escapeHtml(formatDateTime(document.uploadedAt))}</span>
                                <span>Uploaded by ${escapeHtml(document.uploadedBy)}</span>
                              </div>
                              <div class="row-actions">
                                <button class="secondary-button" type="button" data-action="download-document" data-document-id="${escapeHtml(document.id)}"><span aria-hidden="true" data-icon="download"></span>Download</button>
                                <button class="mini-button" type="button" title="Rename document" aria-label="Rename ${escapeHtml(document.name)}" data-action="rename-document" data-document-id="${escapeHtml(document.id)}"><span aria-hidden="true" data-icon="edit"></span></button>
                                <button class="mini-button" type="button" title="Remove document" aria-label="Remove ${escapeHtml(document.name)}" data-action="remove-document" data-document-id="${escapeHtml(document.id)}"><span aria-hidden="true" data-icon="trash"></span></button>
                              </div>
                            </article>`,
                        )
                        .join("")
                    : '<div class="document-folder-empty">No documents in this category</div>'
                }
              </div>
            </section>`;
        })
        .join("")
    : selectedJob
      ? '<div class="empty-state">No active document categories. An administrator can add one in CRM Settings.</div>'
      : '<div class="empty-state">Add or select a job before managing documents.</div>';
  hydrateIcons(els.leadDocumentsList);
}

function photosForJob(contact, jobId) {
  return (contact?.documents || [])
    .filter((document) => document.kind === "photo" && document.jobId === jobId)
    .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}

async function managedPhotoPreviewUrl(photo) {
  if (photo.dataUrl) return photo.dataUrl;
  if (!photo.storagePath || !cloudClient?.storage) return "";
  const cached = photoPreviewCache.get(photo.id);
  if (cached?.url && cached.expiresAt > Date.now()) return cached.url;
  const { data, error } = await cloudClient.storage
    .from(SUPABASE_DOCUMENT_BUCKET)
    .createSignedUrl(photo.storagePath, 300);
  if (error) throw error;
  const url = data?.signedUrl || "";
  if (url) photoPreviewCache.set(photo.id, { url, expiresAt: Date.now() + 240000 });
  return url;
}

async function hydrateLeadPhotoPreviews(contactId, jobId) {
  const contact = getContact(contactId);
  if (!contact || state.selectedContactId !== contactId || state.selectedLeadJobId !== jobId) return;
  const photos = photosForJob(contact, jobId);
  await Promise.all(
    photos.map(async (photo) => {
      try {
        const url = await managedPhotoPreviewUrl(photo);
        if (!url || state.selectedContactId !== contactId || state.selectedLeadJobId !== jobId) return;
        const image = [...document.querySelectorAll("[data-photo-preview]")].find(
          (element) => element.dataset.photoPreview === photo.id,
        );
        if (!image) return;
        const placeholder = image.closest(".job-photo-preview")?.querySelector("[data-photo-placeholder]");
        image.addEventListener(
          "load",
          () => {
            image.classList.remove("hidden");
            placeholder?.classList.add("hidden");
          },
          { once: true },
        );
        image.addEventListener(
          "error",
          () => {
            image.classList.add("hidden");
            placeholder?.classList.remove("hidden");
          },
          { once: true },
        );
        image.src = url;
      } catch (error) {
        console.warn(`Photo ${photo.id} preview could not be loaded`, error);
      }
    }),
  );
}

function renderLeadPhotos(contact) {
  if (!els.leadPhotosGrid || !els.leadPhotoJobSelect) return;
  const jobs = contactJobs(contact);
  if (!jobs.some((job) => job.id === state.selectedLeadJobId)) {
    state.selectedLeadJobId = jobs[0]?.id || "";
  }
  const selectedJob = jobs.find((job) => job.id === state.selectedLeadJobId) || jobs[0];
  const photos = selectedJob ? photosForJob(contact, selectedJob.id) : [];

  els.leadPhotoJobSelect.innerHTML = jobs
    .map(
      (job) =>
        `<option value="${escapeHtml(job.id)}" ${job.id === selectedJob?.id ? "selected" : ""}>${escapeHtml(job.name)} - ${escapeHtml(
          (job.address || "No address saved").split("\n")[0],
        )}</option>`,
    )
    .join("");
  els.leadPhotoJobSelect.disabled = !selectedJob;
  els.uploadLeadPhotoButton.disabled = !selectedJob || !canAction("manageDocuments");
  els.leadPhotoHeading.textContent = selectedJob ? `${selectedJob.name} Photos` : "Photos for this job";

  els.leadPhotosGrid.innerHTML = selectedJob
    ? photos.length
      ? photos
          .map(
            (photo) => `
              <article class="job-photo-card">
                <button class="job-photo-preview" type="button" data-action="download-document" data-document-id="${escapeHtml(photo.id)}" aria-label="Open ${escapeHtml(photo.name)}">
                  <img class="hidden" data-photo-preview="${escapeHtml(photo.id)}" alt="${escapeHtml(photo.name)}" />
                  <span class="job-photo-placeholder" data-photo-placeholder>
                    <span aria-hidden="true" data-icon="image"></span>
                    <strong>Open photo</strong>
                  </span>
                </button>
                <div class="job-photo-details">
                  <div>
                    <strong>${escapeHtml(photo.name)}</strong>
                    <span>${escapeHtml(formatBytes(photo.size))} · ${escapeHtml(formatDateTime(photo.uploadedAt))}</span>
                    <span>Uploaded by ${escapeHtml(photo.uploadedBy)}</span>
                  </div>
                  <div class="row-actions">
                    <button class="mini-button" type="button" title="Rename photo" aria-label="Rename ${escapeHtml(photo.name)}" data-action="rename-document" data-document-id="${escapeHtml(photo.id)}"><span aria-hidden="true" data-icon="edit"></span></button>
                    <button class="mini-button" type="button" title="Remove photo" aria-label="Remove ${escapeHtml(photo.name)}" data-action="remove-document" data-document-id="${escapeHtml(photo.id)}"><span aria-hidden="true" data-icon="trash"></span></button>
                  </div>
                </div>
              </article>`,
          )
          .join("")
      : `<div class="job-photo-empty"><span aria-hidden="true" data-icon="image"></span><strong>No photos for ${escapeHtml(
          selectedJob.name,
        )} yet</strong><span>Upload inspection, damage, progress, and completion photos here.</span></div>`
    : '<div class="empty-state">Add a job before uploading photos.</div>';
  hydrateIcons(els.leadPhotosGrid);
  if (selectedJob) void hydrateLeadPhotoPreviews(contact.id, selectedJob.id);
}

function renderLeadConversation(contact) {
  const job = selectedLeadJob(contact);
  const primary = primaryJob(contact);
  const updates = (contact.updates || []).filter((update) =>
    update.jobId ? update.jobId === job?.id : primary?.id === job?.id,
  );
  els.leadConversationList.innerHTML = updates.length
    ? updates
        .map(
          (update) => `
        <article class="conversation-item">
          <div class="conversation-meta">
            <strong>${escapeHtml(update.author || "Local user")}</strong>
            <span>${escapeHtml(formatDateTime(update.createdAt))}</span>
          </div>
          ${update.status ? `<span class="status-pill">${escapeHtml(update.status)}</span>` : ""}
          <p>${nl2br(update.message || "Status update")}</p>
        </article>
      `,
        )
        .join("")
    : '<div class="empty-state">No updates yet. Post the first note for this job.</div>';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function syncEstimatePipelineStage(estimate, estimateStatus = estimate?.status) {
  if (!estimate) return;
  const nextStage = estimateStatus === "Won" || estimateStatus === "Approved"
    ? "Won"
    : estimateStatus === "Sent"
      ? "Estimate Sent"
      : "";
  if (!nextStage) return;
  const linkedContact = getEstimateContact(estimate);
  const linkedJob = getEstimateJob(estimate);
  const numbered = canUseCloudSync() ? { contact: linkedContact, job: linkedJob } : ensureLeadProjectNumbers(estimate.contactId, estimate.jobId);
  if (!numbered) return;
  estimate.leadNumber = numbered.contact.leadNumber;
  estimate.projectNumber = numbered.job?.projectNumber || estimate.projectNumber || "";
  const linkedJobId = estimate.jobId || numbered.job?.id || "";
  updateContact(estimate.contactId, (current) => {
    const linkedJob = contactJobs(current).find((job) => job.id === linkedJobId);
    const previousStage = linkedJob?.status || current.status;
    const jobs = contactJobs(current).map((job) =>
      job.id === linkedJobId
        ? {
            ...job,
            status: nextStage,
            closedDate: nextStage === "Won" ? job.closedDate || todayISO() : job.closedDate,
          }
        : job,
    );
    return {
      ...current,
      leadNumber: numbered.contact.leadNumber,
      jobs,
      status: nextStage === "Won" || current.status !== "Won" ? nextStage : current.status,
      type: nextStage === "Won" ? "Customer" : current.type,
      closedDate: nextStage === "Won" ? current.closedDate || todayISO() : current.closedDate,
      updates: previousStage === nextStage
        ? current.updates || []
        : [
            {
              id: uid("update"),
              author: state.currentUser.name || "CRM",
              status: nextStage,
              message: `${estimate.estimateNumber} moved ${estimate.projectNumber || "the project"} to ${nextStage}.`,
              createdAt: new Date().toISOString(),
            },
            ...(current.updates || []),
          ],
    };
  });
}

function safeStorageFileName(name = "document") {
  return String(name || "document").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "document";
}

function validateDocumentFiles(files) {
  const selectedFiles = [...(files || [])];
  const oversized = selectedFiles.find((file) => file.size > MAX_DOCUMENT_FILE_SIZE);
  if (oversized) throw new Error(`${oversized.name} is larger than the 250 MB upload limit`);
  return selectedFiles;
}

function validatePhotoFiles(files) {
  const selectedFiles = validateDocumentFiles(files);
  const acceptedPhotoName = /\.(avif|gif|heic|heif|jpe?g|png|webp)$/i;
  const invalid = selectedFiles.find(
    (file) => !String(file.type || "").toLowerCase().startsWith("image/") && !acceptedPhotoName.test(file.name || ""),
  );
  if (invalid) throw new Error(`${invalid.name} is not a supported photo file`);
  return selectedFiles;
}

function documentUploadErrorMessage(error) {
  const message = String(error?.message || error || "The upload could not be completed");
  const normalized = message.toLowerCase();
  if (normalized.includes("larger than the 250 mb") || normalized.includes("payload too large") || normalized.includes("413")) {
    return "Upload failed: each file must be 250 MB or smaller.";
  }
  if (normalized.includes("not a supported photo file")) {
    return "Upload failed: choose JPG, PNG, WebP, GIF, AVIF, HEIC, or HEIF photos.";
  }
  if (normalized.includes("row-level security") || normalized.includes("unauthorized") || normalized.includes("forbidden")) {
    return "Upload failed: shared file storage denied access. Ask an administrator to apply the latest storage setup.";
  }
  if (normalized.includes("bucket") && normalized.includes("not found")) {
    return "Upload failed: shared file storage is not configured yet.";
  }
  if (normalized.includes("network") || normalized.includes("fetch") || normalized.includes("offline")) {
    return "Upload failed because the connection was interrupted. Please try again.";
  }
  return `Upload failed: ${message}`;
}

async function storeDocumentFile(file, { documentId, leadId = "company", jobId = "", categoryId = "other" } = {}) {
  if (!documentId || !leadId || !categoryId) throw new Error("Document, lead and category identifiers are required");
  if (!cloudReady || !cloudClient?.storage || !authSession?.user?.id) {
    if (canUseCloudSync()) throw new Error("Shared file storage is not ready. Reconnect before uploading.");
    if (file.size > 5 * 1024 * 1024) throw new Error("Files larger than 5 MB require connected cloud storage; the signed-in CRM supports up to 250 MB.");
    return { dataUrl: await readFileAsDataUrl(file), storagePath: "" };
  }
  const recordScope = jobId ? `${leadId}/jobs/${jobId}` : leadId;
  const storagePath = `${supabaseStateId()}/${recordScope}/${categoryId}/${documentId}/${uid("version")}/${safeStorageFileName(file.name)}`;
  const { error } = await cloudClient.storage.from(SUPABASE_DOCUMENT_BUCKET).upload(storagePath, file, {
    cacheControl: "3600",
    contentType: file.type || "application/octet-stream",
    // Immutable revisions preserve prior bytes until new metadata is confirmed.
    upsert: false,
  });
  if (error) throw error;
  return { dataUrl: "", storagePath };
}

async function uploadDocumentBatch(files, uploadOne) {
  const documents = [];
  const failures = [];
  // Bound parallel reads/uploads so multiple large files do not exhaust memory.
  for (let offset = 0; offset < files.length; offset += 3) {
    const batch = files.slice(offset, offset + 3);
    const results = await Promise.allSettled(batch.map(uploadOne));
    results.forEach((result, index) => {
      if (result.status === "fulfilled") documents.push(result.value);
      else failures.push({ name: batch[index].name, error: result.reason });
    });
  }
  if (!documents.length && failures.length) throw failures[0].error;
  return { documents, failures };
}

function reportUploadFailures(failures, element) {
  if (!failures.length) return true;
  const message = `Other files were saved. Retry only these failed uploads: ${failures.map((failure) => failure.name).join(", ")}`;
  setSaveState(element, message, "error");
  showToast(message);
  return false;
}

async function archiveDocumentRecord(record) {
  if (!record || durableWriteBlocked) return false;
  if (!canUseCloudSync()) {
    try {
      localStorage.setItem(`jobcrest-archived-document:${record.id}`, JSON.stringify({ ...record, archivedAt: new Date().toISOString() }));
      return true;
    } catch { showToast("Document was not removed: a recovery copy could not be saved."); return false; }
  }
  if (!durableRecordsReady || !cloudClient || !authSession?.user?.id || !(await waitForDurableSaveSlot())) return false;
  const row = durableRowsFromState().find(item => item.record_type === "document" && item.id === record.id);
  if (!row) return false;
  // Archive metadata first. Keep the immutable current and prior file bytes so
  // a rejected/uncertain save can never destroy a still-visible document.
  const { error } = await commitDurableChanges([], [], [row]);
  return !error;
}

async function downloadManagedDocument(documentId) {
  const leadDocument = state.contacts.flatMap((contact) => contact.documents || []).find((item) => item.id === documentId);
  const record = leadDocument || state.companyDocuments.find((item) => item.id === documentId);
  if (!record) return showToast("Document not found");
  const previewWindow = window.open("about:blank", "_blank");
  if (previewWindow) previewWindow.opener = null;
  let url = record.dataUrl || "";
  if (record.storagePath && cloudClient?.storage) {
    const { data, error } = await cloudClient.storage.from(SUPABASE_DOCUMENT_BUCKET).createSignedUrl(record.storagePath, 300);
    if (error) {
      console.warn("Document download link failed", error);
      previewWindow?.close();
      return showToast("The document download could not be opened");
    }
    url = data?.signedUrl || "";
  }
  if (!url) {
    previewWindow?.close();
    return showToast("This document needs to be migrated to cloud storage");
  }
  let objectUrl = "";
  if (url.startsWith("data:")) {
    const blob = await fetch(url).then((response) => response.blob());
    objectUrl = URL.createObjectURL(blob);
    url = objectUrl;
  }
  if (previewWindow) {
    previewWindow.location.replace(url);
    if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return true;
  }
  const link = window.document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  window.document.body.appendChild(link);
  link.click();
  link.remove();
  if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return true;
}

async function migrateInlineDocumentsToStorage() {
  if (!cloudReady || !cloudClient?.storage || !authSession?.user?.id) return;
  let migrated = 0;
  const candidates = [];
  state.contacts.forEach((contact) => (contact.documents || []).forEach((record) => {
    if (!record.storagePath && String(record.dataUrl || "").startsWith("data:")) {
      candidates.push({ record, leadId: contact.id, jobId: record.jobId || "", categoryId: record.categoryId || "other" });
    }
  }));
  state.companyDocuments.forEach((record) => {
    if (!record.storagePath && String(record.dataUrl || "").startsWith("data:")) {
      candidates.push({ record, leadId: "company", categoryId: record.category || "other" });
    }
  });
  for (const candidate of candidates) {
    try {
      const blob = await fetch(candidate.record.dataUrl).then((response) => response.blob());
      const file = new File([blob], candidate.record.name || "document", { type: candidate.record.type || blob.type });
      const stored = await storeDocumentFile(file, {
        documentId: candidate.record.id,
        leadId: candidate.leadId,
        jobId: candidate.jobId || "",
        categoryId: candidate.categoryId,
      });
      candidate.record.storagePath = stored.storagePath;
      candidate.record.dataUrl = "";
      migrated += 1;
    } catch (error) {
      console.warn(`Document ${candidate.record.id} could not be migrated to Storage`, error);
    }
  }
  if (migrated) {
    saveState();
    render();
    showToast(`${migrated} existing document${migrated === 1 ? "" : "s"} moved to secure storage`);
  }
}

function rasterizeLogoDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const maxWidth = 640;
      const maxHeight = 320;
      const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(Math.round(image.width * scale), 1);
      canvas.height = Math.max(Math.round(image.height * scale), 1);
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function uploadLeadDocuments(files) {
  if (!requireAction("manageDocuments")) return;
  const contact = getSelectedContact();
  if (!contact || !files?.length) return;
  const job = selectedLeadJob(contact);
  if (!job) {
    showToast("Select a job before uploading documents");
    return;
  }
  const selectedFiles = validateDocumentFiles(files);
  const categoryId = els.leadDocumentCategory?.value || "";
  const category = state.company.documentCategories.find((item) => item.id === categoryId && item.active);
  if (!category) {
    showToast("Choose an active document category");
    return;
  }

  els.uploadLeadDocumentButton.disabled = true;
  setSaveState(
    els.leadDocumentUploadStatus,
    `Uploading ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} to secure storage...`,
    "saving",
  );

  try {
    const { documents, failures } = await uploadDocumentBatch(
      selectedFiles, async (file) => {
        const id = uid("doc");
        const stored = await storeDocumentFile(file, {
          documentId: id,
          leadId: contact.id,
          jobId: job.id,
          categoryId: category.id,
        });
        return normalizeDocument({
          id,
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          ...stored,
          uploadedAt: new Date().toISOString(),
          leadId: contact.id,
          contactId: contact.id,
          jobId: job.id,
          categoryId: category.id,
          category: category.name,
          uploadedBy: state.currentUser.name || state.currentUser.email || "Local user",
          versionNumber: 1,
        }, { leadId: contact.id, categoryId: category.id, categories: state.company.documentCategories });
      },
    );

    updateContact(contact.id, (current) => ({
      ...current,
      documents: [...documents, ...(current.documents || [])],
    }));
    const documentUpdateContact = addContactUpdate(contact.id, {
      jobId: job.id,
      message: `Uploaded ${documents.length === 1 ? documents[0].name : `${documents.length} documents`} to ${job.name} / ${category.name}.`,
    });
    const localSaved = saveState({ localOnly: true });
    if (!canUseCloudSync() && !localSaved) {
      state.contacts = state.contacts.map((item) => (item.id === contact.id ? contact : item));
      render();
      setSaveState(els.leadDocumentUploadStatus, "Upload was not saved because this device is out of offline storage. Connect shared storage and retry.", "error");
      showToast("Upload was not saved. This device is out of offline storage.");
      return false;
    }
    window.clearTimeout(durableSaveTimer);
    render();
    setSaveState(els.leadDocumentUploadStatus, "File stored. Confirming the shared CRM record...", "saving");
    let saved = !canUseCloudSync();
    if (canUseCloudSync()) {
      saved = await persistLeadDocumentRecords(
        documents.map((document) => document.id),
        documentUpdateContact?.updates?.[0]?.id || "",
      );
    }
    if (!saved) {
      queueDurableRecordsSave();
      queueCloudSave();
      setSaveState(
        els.leadDocumentUploadStatus,
        "File stored, but its shared CRM record is still retrying. Keep this page open.",
        "error",
      );
      showToast("Document stored, but its CRM record was not confirmed. Keep this page open while it retries.");
      return false;
    }
    queueCloudSave();
    setSaveState(
      els.leadDocumentUploadStatus,
      canUseCloudSync()
        ? `${documents.length} document${documents.length === 1 ? "" : "s"} saved to ${job.name} and shared with the team.`
        : `${documents.length} document${documents.length === 1 ? "" : "s"} saved to ${job.name} on this device.`,
      "success",
    );
    showToast(`${documents.length} document${documents.length === 1 ? "" : "s"} saved to the shared CRM`);
    return reportUploadFailures(failures, els.leadDocumentUploadStatus);
  } finally {
    els.uploadLeadDocumentButton.disabled = false;
  }
}

async function uploadLeadPhotos(files) {
  if (!requireAction("manageDocuments")) return false;
  const contact = getSelectedContact();
  if (!contact || !files?.length) return false;
  const job = contactJobs(contact).find((item) => item.id === state.selectedLeadJobId);
  if (!job) return false;
  const selectedFiles = validatePhotoFiles(files);

  els.uploadLeadPhotoButton.disabled = true;
  setSaveState(
    els.leadPhotoUploadStatus,
    `Uploading ${selectedFiles.length} photo${selectedFiles.length === 1 ? "" : "s"} to ${job.name}...`,
    "saving",
  );

  try {
    const { documents: photos, failures } = await uploadDocumentBatch(
      selectedFiles, async (file) => {
        const id = uid("photo");
        const stored = await storeDocumentFile(file, {
          documentId: id,
          leadId: contact.id,
          jobId: job.id,
          categoryId: JOB_PHOTO_CATEGORY_ID,
        });
        return normalizeDocument(
          {
            id,
            name: file.name,
            type: file.type || "image/jpeg",
            size: file.size,
            ...stored,
            uploadedAt: new Date().toISOString(),
            leadId: contact.id,
            contactId: contact.id,
            jobId: job.id,
            categoryId: JOB_PHOTO_CATEGORY_ID,
            category: "Photos",
            kind: "photo",
            uploadedBy: state.currentUser.name || state.currentUser.email || "CRM user",
            versionNumber: 1,
          },
          { leadId: contact.id, categoryId: JOB_PHOTO_CATEGORY_ID, categories: state.company.documentCategories },
        );
      },
    );

    updateContact(contact.id, (current) => ({
      ...current,
      documents: [...photos, ...(current.documents || [])],
    }));
    const photoUpdateContact = addContactUpdate(contact.id, {
      jobId: job.id,
      message: `Uploaded ${photos.length} job photo${photos.length === 1 ? "" : "s"} to ${job.name}.`,
    });
    state.leadDetailTab = "photos";
    const localSaved = saveState({ localOnly: true });
    if (!canUseCloudSync() && !localSaved) {
      state.contacts = state.contacts.map((item) => (item.id === contact.id ? contact : item));
      render();
      setSaveState(els.leadPhotoUploadStatus, "Photos were not saved because this device is out of offline storage. Connect shared storage and retry.", "error");
      showToast("Photos were not saved. This device is out of offline storage.");
      return false;
    }
    window.clearTimeout(durableSaveTimer);
    render();
    setSaveState(els.leadPhotoUploadStatus, "Photos stored. Confirming their shared CRM records...", "saving");

    let saved = !canUseCloudSync();
    if (canUseCloudSync()) {
      saved = await persistLeadDocumentRecords(
        photos.map((photo) => photo.id),
        photoUpdateContact?.updates?.[0]?.id || "",
      );
    }
    if (!saved) {
      queueDurableRecordsSave();
      queueCloudSave();
      setSaveState(
        els.leadPhotoUploadStatus,
        "Photos uploaded, but their shared CRM records are still retrying. Keep this page open.",
        "error",
      );
      showToast("Photos uploaded, but their CRM records were not confirmed yet.");
      return false;
    }

    queueCloudSave();
    setSaveState(
      els.leadPhotoUploadStatus,
      `${photos.length} photo${photos.length === 1 ? "" : "s"} saved only to ${job.name}.`,
      "success",
    );
    showToast(`${photos.length} job photo${photos.length === 1 ? "" : "s"} saved to ${job.name}`);
    return reportUploadFailures(failures, els.leadPhotoUploadStatus);
  } finally {
    els.uploadLeadPhotoButton.disabled = !canAction("manageDocuments");
  }
}

async function removeLeadDocument(documentId) {
  if (!requireAction("manageDocuments")) return;
  const contact = getSelectedContact();
  if (!contact) return;
  const document = contact.documents.find((item) => item.id === documentId);
  if (!(await archiveDocumentRecord(document))) {
    showToast("Document was not removed. Check the shared-saving status and try again.");
    return;
  }
  photoPreviewCache.delete(documentId);
  updateContact(contact.id, (current) => ({
    ...current,
    documents: current.documents.filter((item) => item.id !== documentId),
  }));
  addContactUpdate(contact.id, {
    jobId: document?.jobId || "",
    message: `Removed ${document?.kind === "photo" ? "photo" : "document"} ${document?.name || "from lead record"}.`,
  });
  saveState();
  render();
  showToast(document?.kind === "photo" ? "Photo removed" : "Document removed");
}

function documentExtension(name = "") {
  const match = String(name).match(/(\.[A-Za-z0-9]{1,10})$/);
  return match ? match[1] : "";
}

function normalizeDocumentRename(value = "", originalName = "") {
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  const extension = documentExtension(originalName);
  return extension && !documentExtension(trimmed) ? `${trimmed}${extension}` : trimmed;
}

function renameLeadDocument(documentId) {
  if (!requireAction("manageDocuments")) return;
  const contact = getSelectedContact();
  if (!contact) return;
  const document = contact.documents.find((item) => item.id === documentId);
  if (!document) return;
  const nextName = normalizeDocumentRename(window.prompt("Rename document", document.name), document.name);
  if (!nextName || nextName === document.name) return;
  updateContact(contact.id, (current) => ({
    ...current,
    documents: current.documents.map((item) => (item.id === documentId ? { ...item, name: nextName } : item)),
  }));
  addContactUpdate(contact.id, {
    jobId: document.jobId || "",
    message: `Renamed ${document.kind === "photo" ? "photo" : "document"} ${document.name} to ${nextName}.`,
  });
  saveState();
  render();
  showToast(document.kind === "photo" ? "Photo renamed" : "Document renamed");
}

async function submitLeadConversation(event) {
  event.preventDefault();
  if (!requireAction("manageJobs")) return;
  const contact = getSelectedContact();
  if (!contact) return;
  const job = selectedLeadJob(contact);
  if (!job) return;
  const formData = new FormData(els.leadConversationForm);
  const author = formData.get("author") || "Local user";
  const status = formData.get("status");
  const message = formData.get("message").trim();

  if (status && status !== job.status && primaryJob(contact)?.id === job.id) {
    applyStatusUpdate(contact.id, status, author, message || `Status changed to ${status}.`);
  } else {
    addContactUpdate(contact.id, { author, message, status, jobId: job.id });
  }

  state.leadDetailTab = "conversation";
  saveState({ localOnly: true });
  render();
  const saved = await persistCriticalLeadChange({
    statusElement: els.conversationSaveStatus,
    button: els.conversationSaveButton,
    successMessage: "Update posted",
  });
  if (!saved) return;
  els.leadConversationForm.reset();
  showToast("Update posted to the shared CRM");
}

function renderCompanyDocuments() {
  if (!els.companyDocumentsList) return;
  const documents = [...state.companyDocuments].sort(
    (a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime(),
  );
  els.companyDocumentsList.innerHTML = documents.length
    ? documents
        .map(
          (document) => `
        <article class="document-card">
          <div>
            <span class="document-category">${escapeHtml(document.category || "Other")}</span>
            <strong>${escapeHtml(document.name)}</strong>
            <span>${escapeHtml(formatBytes(document.size))} - ${escapeHtml(formatDateTime(document.uploadedAt))}</span>
          </div>
          <div class="row-actions">
            <button class="secondary-button" type="button" data-action="download-document" data-document-id="${escapeHtml(document.id)}">
              <span aria-hidden="true" data-icon="download"></span>
              Download
            </button>
            <button class="mini-button" type="button" title="Rename document" aria-label="Rename ${escapeHtml(
              document.name,
            )}" data-action="rename-company-document" data-document-id="${document.id}">
              <span aria-hidden="true" data-icon="edit"></span>
            </button>
            <button class="mini-button" type="button" title="Remove document" aria-label="Remove ${escapeHtml(
              document.name,
            )}" data-action="remove-company-document" data-document-id="${document.id}">
              <span aria-hidden="true" data-icon="trash"></span>
            </button>
          </div>
        </article>
      `,
        )
        .join("")
    : '<div class="empty-state">Upload blank contracts, sample estimates, and sales reference files here</div>';
  hydrateIcons(els.companyDocumentsList);
}

async function uploadCompanyDocuments(files) {
  if (!requireAction("manageDocuments")) return;
  if (!files?.length) return;
  const selectedFiles = validateDocumentFiles(files);
  const category = els.companyDocumentCategory.value || "Other";
  els.uploadCompanyDocumentButton.disabled = true;
  setSaveState(
    els.companyDocumentUploadStatus,
    `Uploading ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} to secure storage...`,
    "saving",
  );

  const previousDocuments = state.companyDocuments;
  try {
    const { documents, failures } = await uploadDocumentBatch(
      selectedFiles, async (file) => {
        const id = uid("doc");
        const stored = await storeDocumentFile(file, { documentId: id, leadId: "company", categoryId: category });
        return normalizeDocument({
          id,
          name: file.name,
          category,
          type: file.type || "application/octet-stream",
          size: file.size,
          ...stored,
          uploadedAt: new Date().toISOString(),
          uploadedBy: state.currentUser.name || state.currentUser.email || "Local user",
          ownerUserId: authSession?.user?.id || "",
          versionNumber: 1,
        });
      },
    );
    state.companyDocuments = [...documents, ...state.companyDocuments];
    const localSaved = saveState({ localOnly: true });
    if (!canUseCloudSync() && !localSaved) {
      state.companyDocuments = previousDocuments;
      renderCompanyDocuments();
      setSaveState(els.companyDocumentUploadStatus, "Upload was not saved because this device is out of offline storage. Connect shared storage and retry.", "error");
      showToast("Company document was not saved. This device is out of offline storage.");
      return false;
    }
    window.clearTimeout(durableSaveTimer);
    renderCompanyDocuments();
    setSaveState(els.companyDocumentUploadStatus, "File stored. Confirming the shared company library...", "saving");

    let saved = !canUseCloudSync();
    if (canUseCloudSync()) {
      saved = await persistCompanyDocumentRecords(documents.map((document) => document.id));
    }
    if (!saved) {
      queueDurableRecordsSave();
      queueCloudSave();
      setSaveState(
        els.companyDocumentUploadStatus,
        "File stored, but its shared library record is still retrying. Keep this page open.",
        "error",
      );
      showToast("Company document stored, but its shared record was not confirmed. Keep this page open while it retries.");
      return false;
    }

    queueCloudSave();
    setSaveState(
      els.companyDocumentUploadStatus,
      canUseCloudSync()
        ? `${documents.length} company document${documents.length === 1 ? "" : "s"} saved and shared with the team.`
        : `${documents.length} company document${documents.length === 1 ? "" : "s"} saved on this device.`,
      "success",
    );
    showToast(`${documents.length} company document${documents.length === 1 ? "" : "s"} saved`);
    return reportUploadFailures(failures, els.companyDocumentUploadStatus);
  } finally {
    els.uploadCompanyDocumentButton.disabled = false;
  }
}

async function removeCompanyDocument(documentId) {
  if (!requireAction("manageDocuments")) return;
  const document = state.companyDocuments.find((item) => item.id === documentId);
  if (!(await archiveDocumentRecord(document))) {
    showToast("Document was not removed. Check the shared-saving status and try again.");
    return;
  }
  state.companyDocuments = state.companyDocuments.filter((document) => document.id !== documentId);
  saveState();
  renderCompanyDocuments();
  showToast("Company document removed");
}

function renameCompanyDocument(documentId) {
  if (!requireAction("manageDocuments")) return;
  const document = state.companyDocuments.find((item) => item.id === documentId);
  if (!document) return;
  const nextName = normalizeDocumentRename(window.prompt("Rename company document", document.name), document.name);
  if (!nextName || nextName === document.name) return;
  state.companyDocuments = state.companyDocuments.map((item) =>
    item.id === documentId ? { ...item, name: nextName } : item,
  );
  saveState();
  renderCompanyDocuments();
  showToast("Company document renamed");
}

async function uploadCompanyLogo(file) {
  if (!requireAction("manageCompany")) return;
  if (!file) return;
  if (!String(file.type || "").startsWith("image/")) {
    showToast("Choose an image file for the company logo");
    return;
  }
  let logoDataUrl = await readFileAsDataUrl(file);
  try {
    logoDataUrl = await rasterizeLogoDataUrl(logoDataUrl);
  } catch {
    // Keep the original image for the CRM if the browser cannot rasterize it.
  }
  state.company = normalizeCompany({
    ...state.company,
    logoDataUrl,
  });
  saveState();
  renderBrandLogo();
  renderCompanyForm();
  renderEstimatePreview(getSelectedEstimate());
  showToast("Company logo updated");
}

function removeCompanyLogo() {
  if (!requireAction("manageCompany")) return;
  state.company = normalizeCompany({
    ...state.company,
    logoDataUrl: "",
  });
  saveState();
  renderBrandLogo();
  renderCompanyForm();
  renderEstimatePreview(getSelectedEstimate());
  showToast("Company logo removed");
}

let calendarMonthOffset = 0;

function renderCalendarMonth() {
  if (!els.calMonthGrid) return;
  const now = new Date();
  const viewDate = new Date(now.getFullYear(), now.getMonth() + calendarMonthOffset, 1);
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const monthName = viewDate.toLocaleString("en-US", { month: "long", year: "numeric" });
  els.calMonthTitle.textContent = monthName;

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayStr = now.toISOString().slice(0, 10);

  // Group tasks by date string YYYY-MM-DD
  const tasksByDay = {};
  state.calendarTasks.forEach((task) => {
    const d = new Date(task.dueAt);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const key = d.toISOString().slice(0, 10);
      if (!tasksByDay[key]) tasksByDay[key] = [];
      tasksByDay[key].push(task);
    }
  });

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let html = `<div class="cal-day-labels">${dayLabels.map((d) => `<div class="cal-day-label">${d}</div>`).join("")}</div><div class="cal-days">`;

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += `<div class="cal-day cal-day-empty"></div>`;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const tasks = tasksByDay[dateStr] || [];
    const isToday = dateStr === todayStr;
    const hasCompleted = tasks.some((t) => t.completed);
    const hasPending = tasks.some((t) => !t.completed);

    html += `
      <div class="cal-day${isToday ? " cal-today" : ""}${tasks.length ? " cal-has-tasks" : ""}" data-date="${dateStr}">
        <span class="cal-day-num">${day}</span>
        ${tasks.length ? `
          <div class="cal-task-dots">
            ${hasPending ? `<span class="cal-dot cal-dot-pending"></span>` : ""}
            ${hasCompleted ? `<span class="cal-dot cal-dot-done"></span>` : ""}
          </div>
          <div class="cal-task-count">${tasks.length} task${tasks.length > 1 ? "s" : ""}</div>
        ` : ""}
      </div>`;
  }

  html += `</div>`;
  els.calMonthGrid.innerHTML = html;

  // Click a day to see its tasks
  els.calMonthGrid.querySelectorAll(".cal-day[data-date]").forEach((cell) => {
    cell.addEventListener("click", () => {
      const dateStr = cell.dataset.date;
      const tasks = tasksByDay[dateStr] || [];
      if (!tasks.length) { els.calDayDetail.classList.add("hidden"); return; }
      const label = new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      els.calDayDetailTitle.textContent = label;
      els.calDayDetailTasks.innerHTML = tasks.map((t) => renderTaskCard(t, { compact: true })).join("");
      hydrateIcons(els.calDayDetailTasks);
      els.calDayDetail.classList.remove("hidden");
      els.calDayDetail.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  });
}

function renderCalendar() {
  if (!els.calendarTasksList) return;
  renderCalendarFormOptions();
  renderCalendarMonth();
  const tasks = [...state.calendarTasks].sort((a, b) => taskDueTime(a) - taskDueTime(b));
  els.calendarTasksList.innerHTML = tasks.length
    ? tasks.map((task) => renderTaskCard(task)).join("")
    : '<div class="empty-state">No tasks yet. Create a rep reminder to send it to Google Calendar.</div>';
  hydrateIcons(els.calendarTasksList);
}

function renderCalendarFormOptions() {
  if (!els.salesRepOptions || !els.calendarTaskContact) return;
  els.salesRepOptions.innerHTML = uniqueSalesReps()
    .map((rep) => `<option value="${escapeHtml(rep)}"></option>`)
    .join("");
  els.calendarTaskContact.innerHTML = [
    '<option value="">No related lead</option>',
    ...state.contacts.map(
      (contact) => `<option value="${contact.id}">${escapeHtml(contact.name)} (${escapeHtml(contact.status)})</option>`,
    ),
  ].join("");
}

function renderTaskCard(task, options = {}) {
  const contact = getContact(task.contactId);
  const calendarUrl = googleCalendarUrl(task);
  return `
    <article class="task-card">
      <div>
        <strong>${escapeHtml(task.title)}</strong>
        <span>${escapeHtml(task.rep)} - ${escapeHtml(formatDateTime(task.dueAt))}</span>
        ${contact ? `<span>Related lead: ${escapeHtml(contact.name)}</span>` : ""}
        ${task.notes && !options.compact ? `<p>${nl2br(task.notes)}</p>` : ""}
      </div>
      <div class="row-actions">
        <a class="secondary-button" href="${escapeHtml(calendarUrl)}" target="_blank" rel="noopener">
          <span aria-hidden="true" data-icon="calendar"></span>
          Google Calendar
        </a>
        ${
          options.compact
            ? ""
            : `<button class="mini-button" type="button" title="Edit task" aria-label="Edit task" data-action="edit-calendar-task" data-task-id="${task.id}">
                <span aria-hidden="true" data-icon="edit"></span>
              </button>
              <button class="mini-button" type="button" title="Mark complete" aria-label="Mark task complete" data-action="complete-calendar-task" data-task-id="${task.id}">
                <span aria-hidden="true" data-icon="check"></span>
              </button>
              <button class="mini-button" type="button" title="Delete task" aria-label="Delete task" data-action="delete-calendar-task" data-task-id="${task.id}">
                <span aria-hidden="true" data-icon="trash"></span>
              </button>`
        }
      </div>
    </article>
  `;
}

function saveCalendarTask(event) {
  event.preventDefault();
  if (!requireAction("manageTasks")) return;
  const formData = new FormData(els.calendarTaskForm);
  const taskId = formData.get("taskId");
  const existingTask = state.calendarTasks.find((task) => task.id === taskId);
  const task = normalizeCalendarTask({
    id: taskId || uid("task"),
    title: formData.get("title").trim(),
    rep: formData.get("rep").trim(),
    contactId: formData.get("contactId"),
    dueAt: formData.get("dueAt"),
    duration: number(formData.get("duration")),
    reminder: formData.get("reminder"),
    notes: formData.get("notes").trim(),
    createdAt: existingTask?.createdAt || new Date().toISOString(),
    completed: existingTask?.completed || false,
  });
  if (existingTask) {
    state.calendarTasks = state.calendarTasks.map((item) => (item.id === task.id ? task : item));
  } else {
    state.calendarTasks.unshift(task);
  }
  saveState();
  els.calendarTaskForm.reset();
  render();
  showToast(
    existingTask
      ? "Task updated. Use Google Calendar to update the rep calendar."
      : "Task saved. Use Google Calendar to add it to the rep calendar.",
  );
}

function editCalendarTask(taskId) {
  if (!requireAction("manageTasks")) return;
  const task = state.calendarTasks.find((item) => item.id === taskId);
  if (!task) {
    showToast("That reminder could not be found");
    return;
  }
  state.view = "calendar";
  saveState();
  render();
  fillCalendarTaskForm(task);
  els.calendarTaskForm?.scrollIntoView({ behavior: "smooth", block: "start" });
  showToast("Reminder loaded for editing");
}

function fillCalendarTaskForm(task) {
  if (!els.calendarTaskForm || !task) return;
  const form = els.calendarTaskForm;
  form.elements.taskId.value = task.id || "";
  form.elements.rep.value = task.rep || "";
  form.elements.contactId.value = task.contactId || "";
  form.elements.title.value = task.title || "";
  form.elements.dueAt.value = String(task.dueAt || "").slice(0, 16);
  form.elements.duration.value = task.duration || 30;
  form.elements.reminder.value = task.reminder || "popup";
  form.elements.notes.value = task.notes || "";
}

function completeCalendarTask(taskId) {
  if (!requireAction("manageTasks")) return;
  state.calendarTasks = state.calendarTasks.map((task) =>
    task.id === taskId ? { ...task, completed: true } : task,
  );
  saveState();
  render();
  showToast("Task marked complete");
}

function deleteCalendarTask(taskId) {
  if (!requireAction("manageTasks")) return;
  state.calendarTasks = state.calendarTasks.filter((task) => task.id !== taskId);
  saveState();
  render();
  showToast("Task deleted");
}

function renderTasksView() {
  if (!els.tasksPageList) return;
  const tasks = [...state.calendarTasks].sort((a, b) => taskDueTime(a) - taskDueTime(b));
  els.tasksPageList.innerHTML = tasks.length
    ? tasks.map((task) => renderTaskCard(task)).join("")
    : '<div class="empty-state">No tasks yet. Create one from the Calendar tab.</div>';
  hydrateIcons(els.tasksPageList);
}

function squareStatusPill(estimate) {
  const percent = Math.round(number(estimate.paymentPercent));
  if (percent >= 100 || estimate.squareStatus === "PAID") return `<span class="status-pill pill-won">Paid 100%</span>`;
  if (number(estimate.paidAmount) > 0) return `<span class="status-pill pill-inspection">${percent}% paid</span>`;
  if (estimate.squareStatus === "PAID" || estimate.paidAt) return `<span class="status-pill pill-won">Paid ✓</span>`;
  if (estimate.squareStatus === "SENT" || estimate.squareInvoiceId) return `<span class="status-pill pill-sent">Published in Square</span>`;
  if (estimate.status === "Won") return `<span class="status-pill pill-inspection">Ready to Invoice</span>`;
  return `<span class="status-pill pill-default">${escapeHtml(estimate.status)}</span>`;
}

async function squareApiHeaders() {
  const client = cloudClient || window.RooflineAuth?.createClient?.();
  const { data, error } = client?.auth ? await client.auth.getSession() : { data: {} };
  if (error) throw error;
  if (!window.RooflineAuth?.isEditorSessionCurrent?.(data?.session?.user)) throw new Error("Your login changed. Reopen the CRM before accessing payments.");
  const token = data?.session?.access_token || "";
  if (!token && supabaseConfig().authRequired) throw new Error("Your session expired. Sign in again before accessing payments.");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function squareInvoiceEmailDraft(estimate, contact) {
  const totals = totalsFor(estimate);
  const contractValue = number(estimate.contractValue) || totals.total;
  const amountDueNow = number(estimate.deposit) || contractValue;
  const firstName = String(contact?.name || "there").trim().split(/\s+/)[0] || "there";
  const invoiceLabel = estimate.squareInvoiceNumber
    ? `#${estimate.squareInvoiceNumber}`
    : estimate.estimateNumber || estimate.projectNumber || "";
  const companyName = state.company.name || "Coastal Crest Construction";

  return {
    subject: `${companyName} invoice ${invoiceLabel}`.trim(),
    message: [
      `Hi ${firstName},`,
      "",
      `Your invoice for ${estimate.projectTitle || "your project"} is ready.`,
      `Contract total: ${money.format(contractValue)}`,
      `Amount due now: ${money.format(amountDueNow)}`,
      ...(estimate.projectNumber ? [`Project: ${estimate.projectNumber}`] : []),
      "",
      "View and pay securely through Square:",
      estimate.squareInvoiceUrl || "",
      "",
      "Thank you,",
      companyName,
    ].join("\n"),
  };
}

function gmailComposeUrl(toEmail, subject, message) {
  const url = new URL("https://mail.google.com/mail/");
  url.searchParams.set("view", "cm");
  url.searchParams.set("fs", "1");
  url.searchParams.set("to", toEmail || "");
  url.searchParams.set("su", subject || "");
  url.searchParams.set("body", message || "");
  return url.toString();
}

async function copySquareInvoiceLink(estimateId) {
  const estimate = state.estimates.find((item) => item.id === estimateId);
  const link = estimate?.squareInvoiceUrl || "";
  if (!link) {
    showToast("Square payment link is not available");
    return;
  }
  try {
    await navigator.clipboard.writeText(link);
    showToast("Square payment link copied");
  } catch {
    const input = document.createElement("textarea");
    input.value = link;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    showToast("Square payment link copied");
  }
}

function updateJobPaymentSnapshot(contactId, jobId) {
  const contact = getContact(contactId);
  const job = contactJobs(contact).find((item) => item.id === jobId);
  if (!contact || !job) return;
  const linked = state.estimates.filter(
    (estimate) => estimate.contactId === contactId && estimate.jobId === jobId && estimate.squareInvoiceId,
  );
  const byInvoice = new Map();
  linked.forEach((estimate) => {
    const previous = byInvoice.get(estimate.squareInvoiceId);
    if (!previous || String(estimate.paymentUpdatedAt || "") > String(previous.paymentUpdatedAt || "")) {
      byInvoice.set(estimate.squareInvoiceId, estimate);
    }
  });
  const invoices = [...byInvoice.values()];
  const squarePaidAmount = invoices.reduce((sum, estimate) => sum + number(estimate.paidAmount), 0);
  const manualPaidAmount = (job.manualPayments || []).reduce((sum, payment) => sum + number(payment.amount), 0);
  const paidAmount = Math.round((squarePaidAmount + manualPaidAmount) * 100) / 100;
  // Invoices collect against the agreed contract; they do not redefine it.
  const contractValue = number(job.contractValue ?? job.value);
  const paymentPercent = contractValue ? Math.min(100, (paidAmount / contractValue) * 100) : 0;
  const squareLastPaymentAt = invoices
    .map((estimate) => estimate.paymentUpdatedAt || estimate.paidAt || "")
    .filter(Boolean)
    .sort()
    .at(-1) || job.squareLastPaymentAt || "";
  const lastPaymentAt = [
    squareLastPaymentAt,
    ...(job.manualPayments || []).map((payment) => payment.date || payment.createdAt || ""),
  ]
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  updateContact(contactId, (current) => ({
    ...current,
    jobs: contactJobs(current).map((item) =>
      item.id === jobId
        ? {
            ...item,
            value: contractValue,
            contractValue,
            squarePaidAmount,
            paidAmount,
            paymentPercent,
            squareLastPaymentAt,
            lastPaymentAt,
          }
        : item,
    ),
  }));
}

const squareInvoiceSends = new Map();

function squareSendIdentity() {
  return JSON.stringify([authSession?.user?.id || "", String(authSession?.user?.email || "").toLowerCase(),
    authSession?.user?.app_metadata?.role || "", currentRole()]);
}

function showSquareSendNotice(estimateId, message) {
  const id = `square-send-notice-${encodeURIComponent(estimateId)}`;
  let notice = document.getElementById(id);
  if (!notice) {
    notice = document.createElement("aside");
    notice.id = id;
    notice.setAttribute("role", "alert");
    notice.style.cssText = "position:fixed;top:16px;left:16px;right:16px;z-index:100003;background:#fff4de;color:#34250b;border:2px solid #b87912;border-radius:12px;padding:16px";
    document.body.appendChild(notice);
  }
  notice.textContent = message;
}

function preserveSquareSendOutcome(attempt, result, message, sessionIsCurrent) {
  squareInvoiceSends.set(attempt.estimateId, { ...attempt, status: "review" });
  const payload = {
    p_request_id: attempt.requestId, rpc: "square_create_invoice", estimateId: attempt.estimateId,
    leadId: attempt.leadId, jobId: attempt.jobId, expectedVersion: attempt.expectedVersion,
    result: result && typeof result === "object" ? {
      durable: result.durable === true, estimateId: result.estimateId, leadId: result.leadId, jobId: result.jobId,
      squareInvoiceId: result.squareInvoiceId, squareOrderId: result.squareOrderId, status: result.status,
    } : null,
  };
  if (sessionIsCurrent) {
    // The server may already have committed a new estimate version. Do not
    // advance this editor's version or silently retry its older draft.
    preserveBlockedDurableWrite({ error: new Error(message), payload });
    showSquareSendNotice(attempt.estimateId, message);
  } else {
    // Keep late receipts under the initiating identity, never show private
    // financial details in a tab whose account changed while sending.
    try {
      localStorage.setItem(`jobcrest-square-send-recovery:${attempt.userId}:${attempt.requestId}`,
        JSON.stringify({ createdAt: new Date().toISOString(), request: payload }));
    } catch { /* The server's durable send intent remains the recovery authority. */ }
  }
}

function squareSendPreProviderRefusal(response, result) {
  // A generic failure can follow an accepted provider request. Only this
  // explicit server allowlist proves that this attempt never reached Square.
  if (response.ok || !result || result.noProviderAction !== true || result.durable === true
      || result.squareInvoiceId || result.squareOrderId || result.intentId) return "";
  const beginErrors = {
    legacy_invoice_review_required: "An administrator must check Square for an earlier invoice attempt before sending this older estimate.",
    estimate_changed_before_invoice: "The estimate changed. Reload and review the saved estimate before sending.",
    won_estimate_required: "Save the estimate as Won before sending an invoice.",
    invoice_already_linked: "This estimate already has a linked Square invoice. Reload its invoice status.",
    saved_customer_email_and_numbers_required: "Save the customer email, lead number and project number before sending.",
  };
  if (response.status === 409 && result.stage === "begin" && Object.hasOwn(beginErrors, result.code)) {
    return beginErrors[result.code];
  }
  if (response.status === 400 && result.error === "Send only the saved estimate ID and its current version.") return result.error;
  if (response.status === 503 && result.error === "Reliable Square invoice storage is not configured. No invoice was sent.") return result.error;
  return "";
}

async function sendToSquare(estimateId) {
  if (currentRole() !== "admin") {
    showToast("Only an administrator can send Square invoices");
    return false;
  }
  if (squareInvoiceSends.has(estimateId)) return false;
  if (!canUseCloudSync() || !durableRecordsReady || !cloudClient || !authSession?.user?.id || durableWriteBlocked) {
    showSquareSendNotice(estimateId, "Invoice sending was not started. Connect to the shared CRM and resolve any save recovery notice first.");
    return false;
  }
  const original = state.estimates.find((item) => item.id === estimateId);
  const originalContact = getEstimateContact(original);
  const originalJob = getEstimateJob(original);
  if (!original || !originalContact || !originalJob || original.status !== "Won" || original.squareInvoiceId || !originalContact.email) {
    showSquareSendNotice(estimateId, "Invoice sending was not started. Choose a saved Won estimate with a valid lead, job, and customer email, and no existing Square invoice.");
    return false;
  }

  const identity = squareSendIdentity();
  const sessionIsCurrent = () => identity === squareSendIdentity() && currentRole() === "admin"
    && Boolean(window.RooflineAuth?.isEditorSessionCurrent?.(authSession?.user));
  const attempt = { requestId: crypto.randomUUID(), estimateId, leadId: original.contactId,
    jobId: original.jobId, userId: authSession.user.id, expectedVersion: 0, status: "sending" };
  squareInvoiceSends.set(estimateId, attempt);
  const currentTarget = (confirmedInvoiceId = "") => {
    const estimate = state.estimates.find((item) => item.id === estimateId);
    if (!estimate || estimate.contactId !== attempt.leadId || estimate.jobId !== attempt.jobId
        || (estimate.squareInvoiceId && estimate.squareInvoiceId !== confirmedInvoiceId)) return null;
    const contact = getEstimateContact(estimate);
    const job = getEstimateJob(estimate);
    return contact?.id === attempt.leadId && job?.id === attempt.jobId ? estimate : null;
  };
  const buttons = [...document.querySelectorAll("[data-square-send]")].filter((button) => button.dataset.squareSend === estimateId);
  buttons.forEach((button) => { button.disabled = true; button.textContent = "Sending…"; });
  let requested = false;
  let result = null;
  let confirmed = false;
  try {
    if (!sessionIsCurrent()) throw new Error("The signed-in account changed before sending.");
    const numbered = canUseCloudSync()
      ? { contact: getContact(attempt.leadId), job: contactJobs(getContact(attempt.leadId)).find(job => job.id === attempt.jobId) }
      : ensureLeadProjectNumbers(attempt.leadId, attempt.jobId);
    const target = currentTarget();
    if (!target || numbered?.contact?.id !== attempt.leadId || numbered?.job?.id !== attempt.jobId) {
      throw new Error("The estimate's lead or job changed before sending.");
    }
    target.leadNumber = numbered.contact.leadNumber;
    target.projectNumber = numbered.job.projectNumber;
    saveState({ localOnly: true });
    if (!(await waitForDurableSaveSlot()) || !sessionIsCurrent() || !(await flushDurableRecordsSave())) {
      throw new Error("The lead, job and estimate could not all be confirmed saved.");
    }
    const saved = currentTarget();
    if (!sessionIsCurrent() || !saved || saved.status !== "Won" || durableWriteBlocked || durableSaveInFlight || hasPendingDurableChanges()) {
      throw new Error("Finish saving the latest lead, job and estimate edits before sending.");
    }
    const snapshot = JSON.parse(JSON.stringify(saved));
    attempt.expectedVersion = getDurableCommitWriter().getVersion({ record_type: "estimate", id: estimateId });
    if (!Number.isSafeInteger(attempt.expectedVersion) || attempt.expectedVersion < 1) {
      throw new Error("The saved estimate version could not be confirmed.");
    }
    const headers = await squareApiHeaders();
    // Refreshing auth can yield while the rep edits. Billing must start from
    // the exact acknowledged version, not a newly typed browser-only amount.
    if (!sessionIsCurrent() || !currentTarget() || durableWriteBlocked || durableSaveInFlight || hasPendingDurableChanges()
        || !durableRecordDataMatches(currentTarget(), snapshot)
        || getDurableCommitWriter().getVersion({ record_type: "estimate", id: estimateId }) !== attempt.expectedVersion) {
      throw new Error("The estimate changed before sending. Save the latest edits and send again.");
    }
    requested = true;
    const response = await fetch("/api/square/create-invoice", {
      method: "POST", headers, signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ estimateId, expectedVersion: attempt.expectedVersion }),
    });
    result = await response.json();
    const preProviderRefusal = squareSendPreProviderRefusal(response, result);
    if (preProviderRefusal) {
      requested = false;
      throw new Error(preProviderRefusal);
    }
    if (!response.ok || result?.error || result?.durable !== true || result.estimateId !== estimateId
        || result.leadId !== attempt.leadId || result.jobId !== attempt.jobId
        || typeof result.squareInvoiceId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,199}$/.test(result.squareInvoiceId)
        || !Number.isFinite(result.contractValue) || result.contractValue <= 0) {
      throw new Error("Square invoice creation and its shared CRM association could not both be confirmed.");
    }
    if (!sessionIsCurrent()) throw new Error("The signed-in account changed while the invoice was being sent.");
    if (!currentTarget(result.squareInvoiceId) || durableWriteBlocked || durableSaveInFlight || hasPendingDurableChanges()) {
      throw new Error("The invoice is attached in the shared CRM, but this page has newer or changed records to review.");
    }
    // The server has already attached the invoice. Only guarded hydration may
    // adopt its version; never repeat the association as a browser money write.
    const rows = await reloadDurableRecords({ showUpdateToast: false });
    if (!sessionIsCurrent()) throw new Error("The signed-in account changed while confirming the shared invoice.");
    const refreshed = currentTarget(result.squareInvoiceId);
    if (rows === null || !refreshed || refreshed.squareInvoiceId !== result.squareInvoiceId) {
      throw new Error("The invoice was attached in the shared CRM, but this page could not safely reload the confirmation.");
    }
    document.getElementById(`square-send-notice-${encodeURIComponent(estimateId)}`)?.remove();
    if (state.view === "invoices" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) renderInvoicesView();
    confirmed = true;
    showToast("Invoice published in Square and attached to the shared CRM. Email delivery is not yet confirmed.");
    return true;
  } catch (error) {
    if (requested) {
      const message = result?.durable === true
        ? "Square reports the invoice is attached to the shared CRM, but this page could not safely adopt it. Do not send another invoice. Download unsaved work, then reload and review the shared record."
        : "The invoice outcome could not be confirmed. Do not create a separate invoice. Download unsaved work and have an administrator review Square and this saved estimate. After reloading and resolving save recovery, retry only this same saved estimate to resume its existing attempt.";
      preserveSquareSendOutcome(attempt, result, message, sessionIsCurrent());
    } else if (sessionIsCurrent()) {
      showSquareSendNotice(estimateId, `Invoice sending was not started. ${error.message}`);
    }
    return false;
  } finally {
    const review = squareInvoiceSends.get(estimateId)?.status === "review";
    if (!review) squareInvoiceSends.delete(estimateId);
    if (sessionIsCurrent()) buttons.forEach((button) => {
      button.disabled = review || confirmed;
      button.textContent = review ? "Review invoice outcome" : confirmed ? "Published in Square" : "Send to Square";
    });
  }
}

function setPaymentRefreshStatus(message) {
  let notice = document.getElementById("crmPaymentRefreshStatus");
  if (!notice && message) {
    notice = document.createElement("aside");
    notice.id = "crmPaymentRefreshStatus";
    notice.setAttribute("role", "status");
    notice.style.cssText = "position:fixed;bottom:12px;right:16px;max-width:420px;z-index:900;background:#fff4de;color:#34250b;padding:10px 14px;border:1px solid #b87912;border-radius:8px;font-size:13px";
    document.body.appendChild(notice);
  }
  if (notice) {
    notice.textContent = message;
    notice.hidden = !message;
  }
}

async function pollSquarePayments() {
  // Sales reps receive confirmed shared balances through record subscriptions.
  // Once enabled, the server worker alone reconciles provider payment fields.
  const currentIdentity = () => JSON.stringify([authSession?.user?.id || "", authSession?.user?.email || "",
    authSession?.user?.app_metadata?.role || ""]);
  const initiatingIdentity = currentIdentity();
  const sessionIsCurrent = () => currentRole() === "admin" && !durableWriteBlocked
    && currentIdentity() === initiatingIdentity && window.RooflineAuth.isEditorSessionCurrent();
  if (!sessionIsCurrent()) return;
  if (squarePollInFlight) return;
  squarePollInFlight = true;
  try {
    if (window.ROOFLINE_SUPABASE_CONFIG?.squarePaymentWorkerEnabled === true) {
      const headers = await squareApiHeaders();
      if (!sessionIsCurrent()) return;
      const response = await fetch("/api/square/sync-status", {
        method: "GET", headers, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Shared payment sync status is unavailable.");
      const status = await response.json();
      if (!sessionIsCurrent()) return;
      const validTime = (value) => typeof value === "string" && Boolean(value.trim()) && Number.isFinite(Date.parse(value));
      if (!status || Array.isArray(status) || status.enabled !== true
          || !Number.isSafeInteger(status.pending) || status.pending < 0
          || !Number.isSafeInteger(status.review) || status.review < 0
          || (status.lastProcessedAt !== null && !validTime(status.lastProcessedAt))
          || (status.oldestPendingAt != null && !validTime(status.oldestPendingAt))) {
        throw new Error("Shared payment sync status could not be confirmed.");
      }
      const delayedQueue = status.pending > 0 && validTime(status.oldestPendingAt)
        && Date.now() - Date.parse(status.oldestPendingAt) > 5 * 60 * 1000;
      setPaymentRefreshStatus(status.review > 0
        ? `${status.review} payment updates need administrator review; last confirmed balances are shown.`
        : delayedQueue ? `${status.pending} payment updates are queued; last confirmed balances are shown.` : "");
      // Realtime adopts confirmed database balances when safe. Never refresh
      // provider totals, save patches, or redraw the active editor here.
      return;
    }
    const snapshot = window.CrmPaymentRefresh.capture(state.estimates, {
      contractValue: (estimate) => number(estimate.contractValue) || totalsFor(estimate).total,
    });
    if (!snapshot.invoiceIds.length) { setPaymentRefreshStatus(""); return; }
    const collected = await window.CrmPaymentRefresh.collect(snapshot, async (invoiceIds, { signal }) => {
      if (!sessionIsCurrent()) throw new Error("The signed-in session changed.");
      const res = await fetch("/api/square/payment-status", {
        method: "POST",
        headers: await squareApiHeaders(),
        body: JSON.stringify({ invoiceIds }),
        signal,
      });
      if (!res.ok) throw new Error("Payment refresh failed. Last known balances are displayed.");
      return res.json();
    });
    // No await between checking identity/current drafts and applying payment-only
    // patches. A late reply must not mutate a new session or overwrite typing.
    if (!sessionIsCurrent()) return;
    const plan = window.CrmPaymentRefresh.reconcile(snapshot, collected, state.estimates, {
      isJobCurrent: (contactId, jobId) => {
        const contact = getContact(contactId);
        return Boolean(contact && contactJobs(contact).some((job) => job.id === jobId));
      },
    });
    if (plan.changed) {
      plan.patches.forEach((patch) => {
        const estimate = state.estimates.find((item) => item.id === patch.estimateId);
        Object.assign(estimate, JSON.parse(JSON.stringify(patch.fields)));
      });
      plan.touchedJobs.forEach(({ contactId, jobId }) => updateJobPaymentSnapshot(contactId, jobId));
      saveState();
      if (!["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) render();
    }
    setPaymentRefreshStatus(plan.message);
  } catch (error) {
    if (sessionIsCurrent()) setPaymentRefreshStatus(window.CrmPaymentRefresh.STALE_MESSAGE);
    console.warn("Square balances could not be refreshed", error.message);
  } finally {
    squarePollInFlight = false;
  }
}

// Keep Square payment progress current throughout the signed-in CRM session.
let squarePollInterval = null;
let squarePollInFlight = false;
function startSquarePoll() {
  if (squarePollInterval) return;
  pollSquarePayments();
  squarePollInterval = setInterval(pollSquarePayments, 30000);
}

function renderInvoicesView() {
  if (!els.invoicesList) return;
  startSquarePoll();

  const estimates = [...state.estimates].sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate));
  const financialInvoices = [...new Map([...estimates]
    .filter((estimate) => estimate.squareInvoiceId)
    .sort((a, b) => String(a.paymentUpdatedAt || "").localeCompare(String(b.paymentUpdatedAt || "")))
    .map((estimate) => [estimate.squareInvoiceId, estimate])).values()];
  const totalPaid = financialInvoices.reduce((sum, estimate) => sum + number(estimate.paidAmount), 0);
  const totalPending = financialInvoices
    .reduce((sum, estimate) => sum + Math.max((number(estimate.contractValue) || totalsFor(estimate).total) - number(estimate.paidAmount), 0), 0);

  const summaryBar = `
    <div class="invoice-summary-bar">
      <div class="invoice-summary-stat">
        <span class="invoice-summary-label">Paid</span>
        <span class="invoice-summary-value" style="color:var(--green)">${money.format(totalPaid)}</span>
      </div>
      <div class="invoice-summary-stat">
        <span class="invoice-summary-label">Awaiting Payment</span>
        <span class="invoice-summary-value" style="color:var(--gold)">${money.format(totalPending)}</span>
      </div>
      <div class="invoice-summary-stat">
        <span class="invoice-summary-label">Total Invoices</span>
        <span class="invoice-summary-value">${estimates.length}</span>
      </div>
      <span class="invoice-poll-indicator" id="squarePollIndicator" title="Checking Square for payments every 30s">⟳ Live</span>
    </div>
  `;

  els.invoicesList.innerHTML = summaryBar + (estimates.length
    ? estimates.map((estimate) => {
        const contact = getEstimateContact(estimate);
        const totals = totalsFor(estimate);
        const contractValue = number(estimate.contractValue) || totals.total;
        const paidAmount = number(estimate.paidAmount);
        const paymentPercent = contractValue ? Math.min(100, (paidAmount / contractValue) * 100) : 0;
        const isPaid = paymentPercent >= 100 || estimate.squareStatus === "PAID";
        const isSent = !!estimate.squareInvoiceId && !isPaid;
        const canSend = currentRole() === "admin" && !estimate.squareInvoiceId && estimate.status === "Won" && Boolean(contact?.email);
        const emailDraft = estimate.squareInvoiceUrl
          ? squareInvoiceEmailDraft(estimate, contact)
          : null;
        const emailPaymentUrl = emailDraft
          ? gmailComposeUrl(contact?.email || estimate.squareRecipientEmail || "", emailDraft.subject, emailDraft.message)
          : "";
        const initials = contactInitials(contact?.name || "?");
        const avatarClass = initialsColor(contact?.name || "");

        return `
          <article class="record-card ${isPaid ? "invoice-paid" : ""}">
            <div class="record-card-top">
              <div class="lead-card-avatar ${avatarClass}" style="width:36px;height:36px;font-size:13px;flex-shrink:0">${initials}</div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <strong>${escapeHtml(estimate.projectNumber || estimate.leadNumber || estimate.estimateNumber)}</strong>
                  ${squareStatusPill(estimate)}
                </div>
                <span style="font-size:12px;color:var(--muted)">${escapeHtml(estimate.estimateNumber)}</span>
                ${estimate.status === "Won" ? `<span style="display:block;font-size:12px;color:var(--muted);margin-top:3px">Square recipient: ${escapeHtml(contact?.email || "No customer email on file")}</span>` : ""}
                <span style="font-size:12px;color:var(--muted)">${escapeHtml(contact?.name || "Unknown")} · ${escapeHtml(estimate.projectTitle || "")}</span>
              </div>
              <strong style="font-size:15px;white-space:nowrap">${money.format(contractValue)}</strong>
            </div>
            ${estimate.squareInvoiceId ? paymentProgressMarkup({ contractValue, paidAmount }, { compact: true }) : ""}
            ${isPaid ? `<p style="font-size:12px;color:var(--green);margin:4px 0 0">Paid ${estimate.paidAt ? formatDate(estimate.paidAt) : ""} via Square</p>` : ""}
            ${isSent && estimate.squareInvoiceUrl ? `
              <div class="invoice-delivery-note">
                <strong>Published in Square</strong>
                <span>Square email delivery is not confirmed. If the customer does not receive it, email the secure payment link below.</span>
              </div>
              <p style="font-size:12px;color:var(--muted);margin:4px 0 0">Awaiting payment · <a href="${escapeHtml(estimate.squareInvoiceUrl)}" target="_blank" rel="noopener" class="tel-link">View payment page ↗</a></p>
            ` : ""}
            <div class="row-actions" style="margin-top:8px">
              ${canSend ? `
                <button class="primary-button" type="button" data-square-send="${estimate.id}">
                  <span aria-hidden="true" data-icon="send"></span>
                  Send to Square
                </button>
              ` : ""}
              ${emailPaymentUrl ? `
                <a class="primary-button" href="${escapeHtml(emailPaymentUrl)}" target="_blank" rel="noopener">
                  <span aria-hidden="true" data-icon="send"></span>
                  Email payment link
                </a>
                <button class="secondary-button" type="button" data-square-copy="${estimate.id}">
                  Copy payment link
                </button>
              ` : ""}
              <button class="secondary-button" type="button" data-action="select-estimate" data-estimate-id="${estimate.id}">
                <span aria-hidden="true" data-icon="file"></span>
                Open Estimate
              </button>
            </div>
          </article>
        `;
      }).join("")
    : '<div class="empty-state">Won estimates will appear here for an administrator to send through Square</div>');

  hydrateIcons(els.invoicesList);

  // Wire up send/mark-paid buttons
  els.invoicesList.querySelectorAll("[data-square-send]").forEach((btn) => {
    btn.addEventListener("click", () => sendToSquare(btn.dataset.squareSend));
  });
  els.invoicesList.querySelectorAll("[data-square-copy]").forEach((btn) => {
    btn.addEventListener("click", () => copySquareInvoiceLink(btn.dataset.squareCopy));
  });
  els.invoicesList.querySelectorAll("[data-square-mark-paid]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const estimate = state.estimates.find((e) => e.id === btn.dataset.squareMarkPaid);
      if (!estimate) return;
      const contractValue = number(estimate.contractValue) || totalsFor(estimate).total;
      estimate.squareStatus = "PAID";
      estimate.paidAt = new Date().toISOString();
      estimate.paymentUpdatedAt = estimate.paidAt;
      estimate.contractValue = contractValue;
      estimate.paidAmount = contractValue;
      estimate.paymentPercent = 100;
      updateJobPaymentSnapshot(estimate.contactId, estimate.jobId);
      saveState();
      renderInvoicesView();
      showToast("Invoice marked as paid");
    });
  });
}

function reviewRequestEmail(contact) {
  const reviewUrl = state.company.googleReviewUrl || "";
  const repName = state.currentUser.name || state.company.name;
  const reviewLine = reviewUrl
    ? `We'd love to hear about your experience! It would mean a lot if you could take a moment to leave us a review:\n\n${reviewUrl}\n\nIt only takes a minute and helps us continue doing great work for homeowners like you.`
    : `We'd love to hear about your experience! If you have a moment, please leave us a review on Google — it helps us continue doing great work for homeowners like you.`;
  return {
    toEmail: contact.email || "",
    subject: `How did we do, ${contact.name.split(" ")[0]}? — ${state.company.name}`,
    message: `Hi ${contact.name.split(" ")[0]},\n\nThank you so much for choosing ${state.company.name}! It was a pleasure working on your project and we hope you're thrilled with the results.\n\n${reviewLine}\n\nThank you again for your trust and business. Please don't hesitate to reach out if there's anything else we can help with.\n\nWarm regards,\n${repName}\n${state.company.name}\n${state.currentUser.phone || state.company.phone || ""}`,
  };
}

function renderReviewsView() {
  if (!els.reviewsList) return;
  const customers = state.contacts.filter((c) => c.type === "Customer" || c.status === "Won");
  const hasReviewUrl = !!state.company.googleReviewUrl;

  const warningBanner = !hasReviewUrl ? `
    <div class="review-warning">
      <span data-icon="alert-triangle" aria-hidden="true"></span>
      No Google Review link saved yet — <button class="link-button" type="button" data-action="go-to-settings">add it in Settings</button> so it's included in every request.
    </div>
  ` : "";

  els.reviewsList.innerHTML = warningBanner + (customers.length
    ? customers.map((contact) => {
        const initials = contactInitials(contact.name);
        const avatarClass = initialsColor(contact.name);
        const job = primaryJob(contact);
        const email = contact.email || "";
        return `
          <article class="record-card">
            <div class="record-card-top">
              <div class="lead-card-avatar ${avatarClass}" style="width:36px;height:36px;font-size:13px;flex-shrink:0">${initials}</div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                  <strong>${escapeHtml(contact.name)}</strong>
                  <span class="status-pill pill-won">Won</span>
                </div>
                <span style="font-size:12px;color:var(--muted)">${escapeHtml(job.name || "Completed job")} &middot; ${escapeHtml(email || "No email saved")}</span>
              </div>
            </div>
            <div class="row-actions" style="margin-top:8px">
              ${email ? `
                <a class="primary-button"
                  href="${mailtoUrl(email, reviewRequestEmail(contact).subject, reviewRequestEmail(contact).message)}"
                  data-action="log-review-request"
                  data-contact-id="${contact.id}"
                  data-job-id="${job.id}">
                  <span aria-hidden="true" data-icon="star"></span>
                  Send Review Request
                </a>
              ` : `<span style="font-size:12px;color:var(--muted)">No email address on file</span>`}
              <button class="secondary-button" type="button" data-action="open-contact" data-contact-id="${contact.id}">
                <span aria-hidden="true" data-icon="open"></span>
                Open
              </button>
            </div>
          </article>
        `;
      }).join("")
    : '<div class="empty-state">Won customers will appear here for review follow-up</div>');

  hydrateIcons(els.reviewsList);
}

function renderReportsView() {
  if (!els.reportsContent) return;
  const metrics = dashboardMetrics();
  const repRows = aggregateCounts(allJobs(), (job) => job.salesRep || "Unassigned", (job) => job.value);
  els.reportsContent.innerHTML = `
    <article class="report-card">
      <span class="eyebrow">Pipeline</span>
      <strong>${money.format(metrics.pipelineValue)}</strong>
      <span>${metrics.openContracts} open jobs</span>
    </article>
    <article class="report-card">
      <span class="eyebrow">Closed Revenue</span>
      <strong>${money.format(metrics.closedValue)}</strong>
      <span>${metrics.closedJobs} won jobs</span>
    </article>
    <article class="report-card">
      <span class="eyebrow">Estimates Sent</span>
      <strong>${metrics.estimatesSent}</strong>
      <span>${state.estimates.length} total estimates</span>
    </article>
    <article class="report-card wide">
      <span class="eyebrow">Rep production</span>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Sales Representative</th>
              <th>Jobs</th>
              <th>Total Job Value</th>
            </tr>
          </thead>
          <tbody>
            ${
              repRows.length
                ? repRows
                    .map(
                      (rep) => `
                        <tr>
                          <td>${escapeHtml(rep.label)}</td>
                          <td>${rep.count}</td>
                          <td>${money.format(rep.value)}</td>
                        </tr>
                      `,
                    )
                    .join("")
                : '<tr><td colspan="3"><div class="empty-state">No jobs to report yet</div></td></tr>'
            }
          </tbody>
        </table>
      </div>
    </article>
  `;
}

function renderNewEstimatePickers() {
  if (!els.newEstimateContact || !els.newEstimateJob) return;
  const selectedContact = getContact(state.newEstimateContactId);
  const contactId = selectedContact ? selectedContact.id : "";
  const jobs = selectedContact ? contactJobs(selectedContact) : [];
  const selectedJob = jobs.find((job) => job.id === state.newEstimateJobId) || jobs[0];

  els.newEstimateContact.innerHTML = [
    '<option value="">Choose lead</option>',
    ...state.contacts.map(
      (contact) => `
        <option value="${contact.id}" ${contact.id === contactId ? "selected" : ""}>
          ${escapeHtml(contact.name)} (${escapeHtml(contact.type)})
        </option>
      `,
    ),
  ].join("");

  els.newEstimateJob.disabled = !selectedContact;
  els.newEstimateJob.innerHTML = selectedContact
    ? jobs
        .map(
          (job) => `
          <option value="${job.id}" ${job.id === selectedJob?.id ? "selected" : ""}>
            ${escapeHtml(job.name)} - ${escapeHtml(job.address || "No address")}
          </option>
        `,
        )
        .join("")
    : '<option value="">Choose lead first</option>';
}

function renderEstimates() {
  const estimate = getSelectedEstimate();
  const estimates = filteredEstimates();

  renderNewEstimatePickers();
  renderEstimateHistory(estimate, estimates);

  renderEstimateForm(estimate);
  renderEstimatePreview(estimate);
}

function estimateHistoryMarkup(estimate, estimates) {
  return estimates.length
    ? estimates
        .map((item) => {
          const contact = getEstimateContact(item);
          const total = totalsFor(item).total;
          return `
            <button type="button" class="${item.id === estimate?.id ? "active" : ""}" data-estimate-id="${escapeHtml(item.id)}">
              <span class="estimate-history-main">
                <strong>${escapeHtml(item.projectTitle || item.estimateNumber)}</strong>
                <small>${escapeHtml(item.estimateNumber)} · ${escapeHtml(contact?.name || "Unknown lead")}</small>
              </span>
              <span class="estimate-history-side">
                <span class="status-pill">${escapeHtml(item.status)}</span>
                <small>${money.format(total)}</small>
              </span>
            </button>`;
        })
        .join("")
    : '<div class="empty-state">No matching estimates</div>';
}

function renderEstimateHistory(estimate = getSelectedEstimate(), estimates = filteredEstimates()) {
  if (els.estimateHistoryCount) els.estimateHistoryCount.textContent = state.estimates.length;
  if (els.estimateList) els.estimateList.innerHTML = estimateHistoryMarkup(estimate, estimates);
}

function renderEstimateActiveSummary(estimate) {
  if (!els.estimateActiveSummary) return;
  if (!estimate) {
    els.estimateActiveSummary.innerHTML = `
      <div><p class="eyebrow">No estimate selected</p><h3>Create an estimate to begin</h3></div>
      <span>Use the New Estimate button above.</span>`;
    return;
  }
  const contact = getEstimateContact(estimate);
  const total = totalsFor(estimate).total;
  els.estimateActiveSummary.innerHTML = `
    <div>
      <p class="eyebrow">Editing ${escapeHtml(estimate.estimateNumber)}</p>
      <h3>${escapeHtml(estimate.projectTitle || "Untitled estimate")}</h3>
      <span>
        ${contact ? `<button class="estimate-lead-link" type="button" data-action="open-estimate-lead" data-contact-id="${escapeHtml(contact.id)}">${escapeHtml(contact.name)}</button>` : "Unknown lead"}
        · Select the lead to save and open its overview
      </span>
    </div>
    <div class="estimate-active-meta">
      <span class="status-pill">${escapeHtml(estimate.status)}</span>
      <strong>${money.format(total)}</strong>
    </div>`;
}

function estimateLineItemMarkup(item, index) {
  return `
    <div class="line-item" data-line-index="${index}">
      <label class="line-item-title">
        Product Title
        <input data-line-field="title" value="${escapeHtml(item.title)}" />
      </label>
      <label class="line-item-description">
        Description
        <textarea data-line-field="description" rows="2">${escapeHtml(item.description)}</textarea>
      </label>
      <label>
        Qty
        <input data-line-field="quantity" type="text" inputmode="decimal" autocomplete="off" value="${number(
          item.quantity,
        )}" />
      </label>
      <label>
        Unit
        <input data-line-field="unit" value="${escapeHtml(item.unit)}" />
      </label>
      <label>
        Rate
        <input data-line-field="rate" type="text" inputmode="decimal" autocomplete="off" value="${number(item.rate)}" />
      </label>
      <div class="remove-cell">
        <button class="mini-button" type="button" title="Remove line item" aria-label="Remove line item" data-action="remove-line" data-line-index="${index}">
          <span aria-hidden="true" data-icon="trash"></span>
        </button>
      </div>
    </div>
  `;
}

function renderEstimateLineItems(estimate) {
  els.lineItems.innerHTML = estimate.items.map(estimateLineItemMarkup).join("");
  hydrateIcons(els.lineItems);
}

function appendEstimateLineItem(estimate, index) {
  els.lineItems.insertAdjacentHTML("beforeend", estimateLineItemMarkup(estimate.items[index], index));
  const row = els.lineItems.lastElementChild;
  hydrateIcons(row);
  row?.querySelector('[data-line-field="title"]')?.focus();
}

function renderEstimateForm(estimate) {
  const disabled = !estimate;
  renderEstimateActiveSummary(estimate);
  els.estimateForm.classList.toggle("hidden", disabled);
  els.deleteEstimateButton.disabled = disabled;
  els.copyEstimateButton.disabled = disabled;
  els.printEstimateButton.disabled = disabled;
  els.sendEstimateButton.disabled = disabled;

  if (!estimate) {
    setSaveState(els.estimateSaveStatus, "", "");
    return;
  }
  renderEstimateSaveState(estimate.id);

  els.estimateContact.innerHTML = state.contacts
    .map(
      (contact) => `
      <option value="${contact.id}" ${contact.id === estimate.contactId ? "selected" : ""}>
        ${escapeHtml(contact.name)} (${escapeHtml(contact.type)})
      </option>
    `,
    )
    .join("");

  const estimateContact = getEstimateContact(estimate);
  const estimateJobs = contactJobs(estimateContact);
  const estimateJob = getEstimateJob(estimate);
  els.estimateJob.innerHTML = estimateJobs
    .map(
      (job) => `
      <option value="${job.id}" ${job.id === estimateJob?.id ? "selected" : ""}>
        ${escapeHtml(job.name)} - ${escapeHtml(job.address || "No address")}
      </option>
    `,
    )
    .join("");

  els.estimateNumber.value = estimate.estimateNumber;
  els.estimateTitle.value = estimate.projectTitle;
  els.estimateStatus.value = estimate.status;
  els.projectManager.value = estimate.projectManager;
  const rep = estimateSalesRep(estimate);
  els.salesRepEmail.value = estimate.salesRepEmail || rep.email;
  els.salesRepPhone.value = formatPhoneNumber(estimate.salesRepPhone || rep.phone);
  els.issueDate.value = estimate.issueDate;
  els.validUntil.value = estimate.validUntil;
  els.scopeSummary.value = estimate.scopeSummary;
  els.taxRate.value = estimate.taxRate;
  els.deposit.value = estimate.deposit;
  els.estimateNotes.value = estimate.notes;

  renderEstimateLineItems(estimate);
}

function renderEstimatePreview(estimate) {
  if (!estimate) {
    els.estimatePreview.innerHTML = '<div class="empty-state">Create an estimate to preview it</div>';
    return;
  }

  const contact = getEstimateContact(estimate);
  const job = getEstimateJob(estimate);
  const totals = totalsFor(estimate);
  const company = state.company;
  const rep = estimateSalesRep(estimate);
  const officeAddress = companyOfficeAddress();

  const statusColors = {
    Draft: "est-status-draft",
    Sent: "est-status-sent",
    Won: "est-status-approved",
    Rejected: "est-status-rejected",
    Invoiced: "est-status-invoiced",
  };
  const statusClass = statusColors[estimate.status] || "est-status-draft";

  els.estimatePreview.innerHTML = `
    <div class="est-preview">
      <div class="est-header">
        <div class="est-header-brand">
          ${companyLogoTag("est-logo")}
          <div>
            <p class="est-company-name">${escapeHtml(company.name)}</p>
            <p class="est-company-sub">${nl2br(officeAddress)}</p>
            <p class="est-company-sub">${escapeHtml(company.phone)}${company.phone && company.email ? " &middot; " : ""}${escapeHtml(company.email)}</p>
            ${company.license ? `<p class="est-company-sub">${escapeHtml(company.license)}</p>` : ""}
          </div>
        </div>
        <div class="est-header-meta">
          <p class="est-doc-label">ESTIMATE</p>
          <p class="est-doc-num">${escapeHtml(estimate.estimateNumber)}</p>
          <p class="est-doc-date">${escapeHtml([estimate.leadNumber, estimate.projectNumber].filter(Boolean).join(" · "))}</p>
          <p class="est-doc-date">Issued: ${formatDate(estimate.issueDate)}</p>
          <p class="est-doc-date">Valid through: ${formatDate(estimate.validUntil)}</p>
          <span class="est-status-chip ${statusClass}">${escapeHtml(estimate.status)}</span>
        </div>
      </div>
      <div class="est-accent-bar"></div>

      <div class="est-body">
        <div class="est-info-grid">
          <div class="est-info-box">
            <p class="est-info-label">Customer</p>
            ${contact
              ? `<button class="est-info-name estimate-lead-link estimate-lead-link-preview" type="button" data-action="open-estimate-lead" data-contact-id="${escapeHtml(contact.id)}">${escapeHtml(contact.name)}</button>`
              : '<p class="est-info-name">No customer selected</p>'}
            ${contact?.address ? `<p class="est-info-sub">${nl2br(contact.address)}</p>` : ""}
            ${contact?.phone ? `<p class="est-info-sub">${escapeHtml(contact.phone)}</p>` : ""}
            ${contact?.email ? `<p class="est-info-sub">${escapeHtml(contact.email)}</p>` : ""}
          </div>
          <div class="est-info-box">
            <p class="est-info-label">Project &amp; Representative</p>
            <p class="est-info-name">${escapeHtml(estimate.projectTitle || "Project estimate")}</p>
            <p class="est-info-sub">${escapeHtml((job?.address || contact?.address || "").split("\n")[0] || "")}</p>
            <p class="est-info-rep">${escapeHtml(rep.name || "Unassigned")}</p>
            ${rep.email ? `<p class="est-info-sub">${escapeHtml(rep.email)}</p>` : ""}
            ${rep.phone ? `<p class="est-info-sub">${escapeHtml(rep.phone)}</p>` : ""}
          </div>
        </div>

        ${estimate.scopeSummary ? `
        <div class="est-scope-block">
          <p class="est-info-label">Project scope</p>
          <p class="est-scope-text">${nl2br(estimate.scopeSummary)}</p>
        </div>
        ` : ""}

        <table class="est-table">
          <thead>
            <tr>
              <th>Product / work item</th>
              <th class="est-th-r">Qty</th>
              <th>Unit</th>
              <th class="est-th-r">Rate</th>
              <th class="est-th-r">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${estimate.items.map((item) => `
              <tr>
                <td>
                  <span class="est-item-title">${escapeHtml(item.title || "Line item")}</span>
                  ${item.description ? `<span class="est-item-desc">${nl2br(item.description)}</span>` : ""}
                </td>
                <td class="est-td-r est-td-muted">${number(item.quantity).toLocaleString("en-US")}</td>
                <td class="est-td-muted">${escapeHtml(item.unit || "ea")}</td>
                <td class="est-td-r est-td-muted">${money.format(number(item.rate))}</td>
                <td class="est-td-r est-td-amt">${money.format(number(item.quantity) * number(item.rate))}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>

        <div class="est-totals-block">
          <div class="est-totals-inner">
            <div class="est-total-row">
              <span>Subtotal</span><span>${money.format(totals.subtotal)}</span>
            </div>
            <div class="est-total-row">
              <span>Tax (${number(estimate.taxRate)}%)</span><span>${money.format(totals.tax)}</span>
            </div>
            <div class="est-total-row">
              <span>Deposit</span><span>&minus;${money.format(number(estimate.deposit))}</span>
            </div>
            <div class="est-total-row est-total-grand">
              <span>Total</span><span>${money.format(totals.total)}</span>
            </div>
            <div class="est-total-row est-total-balance">
              <span>Balance due on completion</span><span>${money.format(totals.balance)}</span>
            </div>
          </div>
        </div>

        ${(estimate.notes || company.defaultTerms) ? `
        <div class="est-notes-block">
          <p class="est-info-label">Notes &amp; Terms</p>
          <p class="est-notes-text">${nl2br(estimate.notes || company.defaultTerms)}</p>
        </div>
        ` : ""}

        <div class="est-sig-grid">
          <div class="est-sig-line">Customer signature</div>
          <div class="est-sig-line">Date</div>
        </div>
      </div>

      <div class="est-footer">
        <span>${escapeHtml(company.name)}${company.website ? ` &middot; ${escapeHtml(company.website)}` : ""}</span>
        <span>${escapeHtml(company.license || "")}</span>
      </div>
    </div>
  `;
}

function companyFormValues() {
  return {
    ...state.company,
    phone: formatPhoneNumber(state.company.phone),
    userName: state.currentUser.name,
    userEmail: state.currentUser.email,
    userPhone: formatPhoneNumber(state.currentUser.phone || ""),
    userRole: state.currentUser.role,
  };
}

function trackCompanyFormDraft(event) {
  const field = event.target;
  if (!canAction("manageCompany") || !field.name || field.type === "file") return;
  const baseline = companyFormValues();
  if (!Object.hasOwn(baseline, field.name)) return;
  const draft = { ...state.companyFormDraft };
  if (field.value === String(baseline[field.name] ?? "")) delete draft[field.name];
  else draft[field.name] = field.value;
  state.companyFormDraft = Object.keys(draft).length ? draft : null;
  // A form draft is local until explicit Save; it still guards remote hydration.
  queueLocalStateSave();
}

function renderCompanyForm() {
  const form = els.companyForm;
  state.company = normalizeCompany(state.company);
  Object.entries({ ...companyFormValues(), ...state.companyFormDraft }).forEach(([key, value]) => {
    const field = form.elements[key];
    const nextValue = String(value ?? "");
    if (field && field.type !== "file" && field.value !== nextValue) field.value = nextValue;
  });
  if (els.companyLogoPreview) {
    els.companyLogoPreview.src = state.company.logoDataUrl || "icon.svg";
    els.companyLogoPreview.classList.toggle("logo-placeholder", !state.company.logoDataUrl);
  }
  renderDocumentCategoriesSettings();
}

function documentCategoryDocumentCount(categoryId) {
  return state.contacts.reduce(
    (total, contact) => total + (contact.documents || []).filter((document) => document.categoryId === categoryId).length,
    0,
  );
}

function renderDocumentCategoriesSettings() {
  if (!els.documentCategoriesList) return;
  const categories = state.company.documentCategories || [];
  const writable = canAction("manageCompany");
  els.documentCategoryCreateForm?.querySelectorAll("input, select, button").forEach((control) => {
    control.disabled = !writable;
  });
  els.documentCategoriesList.innerHTML = categories
    .map((category, index) => {
      const documentCount = documentCategoryDocumentCount(category.id);
      const mergeOptions = categories
        .filter((target) => target.id !== category.id)
        .map((target) => `<option value="${escapeHtml(target.id)}">${escapeHtml(target.name)}</option>`)
        .join("");
      return `
        <article class="document-category-admin-row ${category.active ? "" : "is-inactive"}" draggable="${writable}" data-category-id="${escapeHtml(category.id)}">
          <div class="document-category-drag" title="Drag to reorder" aria-label="Drag ${escapeHtml(category.name)} to reorder">⋮⋮</div>
          <span class="document-category-color" style="--category-color:${escapeHtml(category.color)}" aria-hidden="true" data-icon="${escapeHtml(category.icon)}"></span>
          <div class="document-category-fields">
            <label>Name<input data-category-field="name" value="${escapeHtml(category.name)}" maxlength="80" ${writable ? "" : "disabled"} /></label>
            <label>Icon<select data-category-field="icon" ${writable ? "" : "disabled"}>${documentCategoryIcons
              .map((icon) => `<option value="${icon}" ${icon === category.icon ? "selected" : ""}>${icon.replace(/^./, (letter) => letter.toUpperCase())}</option>`)
              .join("")}</select></label>
            <label>Color<input data-category-field="color" type="color" value="${escapeHtml(category.color)}" ${writable ? "" : "disabled"} /></label>
          </div>
          <div class="document-category-meta">
            <strong>${category.active ? "Active" : "Inactive"}</strong>
            <span>${documentCount} document${documentCount === 1 ? "" : "s"}</span>
            <span>Created ${escapeHtml(formatDateTime(category.createdAt))}</span>
            <span>Modified ${escapeHtml(formatDateTime(category.updatedAt))}</span>
          </div>
          <div class="document-category-actions">
            <button class="secondary-button" type="button" data-action="edit-document-category" data-category-id="${escapeHtml(category.id)}" ${writable ? "" : "disabled"}>Save</button>
            <button class="ghost-button" type="button" data-action="toggle-document-category" data-category-id="${escapeHtml(category.id)}" ${writable ? "" : "disabled"}>${category.active ? "Disable" : "Enable"}</button>
            <div class="category-order-buttons" aria-label="Reorder ${escapeHtml(category.name)}">
              <button class="mini-button" type="button" title="Move up" data-action="move-document-category-up" data-category-id="${escapeHtml(category.id)}" data-rule-disabled="${index === 0}" ${writable && index > 0 ? "" : "disabled"}>↑</button>
              <button class="mini-button" type="button" title="Move down" data-action="move-document-category-down" data-category-id="${escapeHtml(category.id)}" data-rule-disabled="${index === categories.length - 1}" ${writable && index < categories.length - 1 ? "" : "disabled"}>↓</button>
            </div>
            <div class="document-category-merge">
              <select aria-label="Merge ${escapeHtml(category.name)} into" data-merge-target ${writable && mergeOptions ? "" : "disabled"}>${mergeOptions}</select>
              <button class="ghost-button" type="button" data-action="merge-document-category" data-category-id="${escapeHtml(category.id)}" data-rule-disabled="${!mergeOptions}" ${writable && mergeOptions ? "" : "disabled"}>Merge</button>
            </div>
            <button class="ghost-button danger" type="button" data-action="delete-document-category" data-category-id="${escapeHtml(category.id)}" data-rule-disabled="${documentCount > 0}" ${writable && documentCount === 0 ? "" : "disabled"} title="${documentCount ? "Merge or move documents before deleting" : "Delete empty category"}">Delete</button>
          </div>
        </article>`;
    })
    .join("");
  hydrateIcons(els.documentCategoriesList);
}

function saveDocumentCategories(categories, message = "Document categories updated") {
  const previousCategories = new Map(
    (state.company.documentCategories || []).map((category) => [category.id, category]),
  );
  const now = new Date().toISOString();
  state.company.documentCategories = normalizeDocumentCategories(
    categories.map((category, displayOrder) => ({
      ...category,
      displayOrder,
      updatedAt:
        previousCategories.get(category.id)?.displayOrder !== displayOrder ? now : category.updatedAt,
    })),
  );
  const categoryById = new Map(state.company.documentCategories.map((category) => [category.id, category]));
  state.contacts = state.contacts.map((contact) => ({
    ...contact,
    documents: (contact.documents || []).map((document) => ({
      ...document,
      leadId: contact.id,
      contactId: contact.id,
      category: categoryById.get(document.categoryId)?.name || document.category,
    })),
  }));
  saveState();
  renderDocumentCategoriesSettings();
  const selectedContact = getSelectedContact();
  if (selectedContact) renderLeadDocuments(selectedContact);
  showToast(message);
}

function createDocumentCategory(event) {
  event.preventDefault();
  if (!requireAction("manageCompany")) return;
  const formData = new FormData(els.documentCategoryCreateForm);
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  if (state.company.documentCategories.some((category) => category.name.toLowerCase() === name.toLowerCase())) {
    showToast("Category names must be unique");
    return;
  }
  const now = new Date().toISOString();
  const category = normalizeDocumentCategory({
    id: uid("doccat"),
    name,
    displayOrder: state.company.documentCategories.length,
    icon: formData.get("icon"),
    color: formData.get("color"),
    active: true,
    createdAt: now,
    updatedAt: now,
  });
  els.documentCategoryCreateForm.reset();
  els.documentCategoryCreateForm.elements.color.value = "#2563eb";
  saveDocumentCategories([...state.company.documentCategories, category], `${name} category created`);
}

function editDocumentCategory(categoryId, row) {
  const category = state.company.documentCategories.find((item) => item.id === categoryId);
  if (!category || !row) return;
  const name = String(row.querySelector('[data-category-field="name"]')?.value || "").trim();
  if (!name) {
    showToast("Category name is required");
    return;
  }
  if (state.company.documentCategories.some((item) => item.id !== categoryId && item.name.toLowerCase() === name.toLowerCase())) {
    showToast("Category names must be unique");
    return;
  }
  const updated = {
    ...category,
    name,
    icon: row.querySelector('[data-category-field="icon"]')?.value,
    color: row.querySelector('[data-category-field="color"]')?.value,
    updatedAt: new Date().toISOString(),
  };
  saveDocumentCategories(
    state.company.documentCategories.map((item) => (item.id === categoryId ? updated : item)),
    `${name} category saved`,
  );
}

function toggleDocumentCategory(categoryId) {
  const now = new Date().toISOString();
  saveDocumentCategories(
    state.company.documentCategories.map((category) =>
      category.id === categoryId ? { ...category, active: !category.active, updatedAt: now } : category,
    ),
  );
}

function deleteDocumentCategory(categoryId) {
  const category = state.company.documentCategories.find((item) => item.id === categoryId);
  if (!category) return;
  if (documentCategoryDocumentCount(categoryId)) {
    showToast("Only empty categories can be deleted");
    return;
  }
  if (!window.confirm(`Delete the empty ${category.name} category?`)) return;
  saveDocumentCategories(
    state.company.documentCategories.filter((item) => item.id !== categoryId),
    `${category.name} category deleted`,
  );
}

function mergeDocumentCategory(sourceId, targetId) {
  const source = state.company.documentCategories.find((category) => category.id === sourceId);
  const target = state.company.documentCategories.find((category) => category.id === targetId);
  if (!source || !target || source.id === target.id) return;
  if (!window.confirm(`Merge ${source.name} into ${target.name}? All documents will move and ${source.name} will be removed.`)) return;
  state.contacts = state.contacts.map((contact) => ({
    ...contact,
    documents: (contact.documents || []).map((document) =>
      document.categoryId === sourceId
        ? { ...document, leadId: contact.id, contactId: contact.id, categoryId: targetId, category: target.name }
        : document,
    ),
  }));
  saveDocumentCategories(
    state.company.documentCategories
      .filter((category) => category.id !== sourceId)
      .map((category) =>
        category.id === targetId ? { ...category, updatedAt: new Date().toISOString() } : category,
      ),
    `${source.name} merged into ${target.name}`,
  );
}

function moveDocumentCategory(categoryId, offset) {
  const categories = [...state.company.documentCategories];
  const index = categories.findIndex((category) => category.id === categoryId);
  const targetIndex = index + offset;
  if (index < 0 || targetIndex < 0 || targetIndex >= categories.length) return;
  [categories[index], categories[targetIndex]] = [categories[targetIndex], categories[index]];
  saveDocumentCategories(categories, "Category order updated");
}

function reorderDocumentCategory(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) return;
  const categories = [...state.company.documentCategories];
  const sourceIndex = categories.findIndex((category) => category.id === sourceId);
  const targetIndex = categories.findIndex((category) => category.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0) return;
  const [moved] = categories.splice(sourceIndex, 1);
  categories.splice(targetIndex, 0, moved);
  saveDocumentCategories(categories, "Category order updated");
}

function openContactDialog(contactId, defaults = {}) {
  const contact = contactId ? getContact(contactId) : null;
  els.contactDialogTitle.textContent = contact ? "Edit Contact" : `Add ${defaults.type || "Lead"}`;
  els.deleteContactButton.classList.toggle("hidden", !contact);
  els.estimateFromContactButton.classList.toggle("hidden", !contact);

  const data = {
    id: "",
    type: defaults.type || "Lead",
    status: "New",
    name: "",
    source: "",
    salesRep: "",
    email: "",
    phone: "",
    address: "",
    value: "",
    lastContact: todayISO(),
    closedDate: "",
    notes: "",
    ...contact,
  };

  Object.entries(data).forEach(([key, value]) => {
    const field = els.contactForm.elements[key];
    if (field) {
      field.value = key === "phone" ? formatPhoneNumber(value) : key === "value" ? formatCurrencyInput(value) : value ?? "";
    }
  });

  els.contactDialog.showModal();
}

function saveContactFromForm(event) {
  event.preventDefault();
  if (!requireAction("manageContacts")) return;
  const formData = new FormData(els.contactForm);
  const id = formData.get("id") || uid("contact");
  const existing = getContact(id);
  const contact = {
    ...(existing || { createdAt: todayISO() }),
    id,
    type: formData.get("type"),
    status: formData.get("status"),
    name: formData.get("name").trim(),
    source: formData.get("source").trim(),
    email: formData.get("email").trim(),
    phone: formatPhoneNumber(formData.get("phone")),
    address: formData.get("address").trim(),
    value: number(formData.get("value")),
    salesRep: formData.get("salesRep").trim() || "Unassigned",
    lastContact: formData.get("lastContact"),
    closedDate:
      formData.get("closedDate") ||
      (formData.get("status") === "Won" ? existing?.closedDate || todayISO() : ""),
    documents: existing?.documents || [],
    updates: existing?.updates || [],
    notes: formData.get("notes").trim(),
  };
  const currentJobs = existing?.jobs?.length ? existing.jobs : [normalizeJob({}, contact)];
  const primary = normalizeJob(
    {
      ...currentJobs[0],
      name: currentJobs[0]?.name || `${contact.name} Job`,
      status: contact.status,
      value: contact.value,
      salesRep: contact.salesRep,
      address: contact.address,
      lastContact: contact.lastContact,
      closedDate: contact.closedDate,
    },
    contact,
  );
  contact.jobs = [primary, ...currentJobs.slice(1)];

  if (existing && existing.status !== contact.status) {
    contact.updates = [
      {
        id: uid("update"),
        author: contact.salesRep || "Local user",
        status: contact.status,
        message: `Status changed from ${existing.status} to ${contact.status}.`,
        createdAt: new Date().toISOString(),
      },
      ...(existing.updates || []),
    ];
  }

  if (existing) {
    state.contacts = state.contacts.map((item) => (item.id === id ? contact : item));
  } else {
    state.contacts.unshift(contact);
  }

  state.selectedContactId = id;
  saveState();
  els.contactDialog.close();
  render();
  showToast(`${contact.name} saved`);
}

function deleteContact(contactId) {
  if (!requireAction("manageContacts")) return;
  const contact = getContact(contactId);
  if (!contact) return;
  const hasEstimates = state.estimates.some((estimate) => estimate.contactId === contactId);
  const message = hasEstimates
    ? "This contact has estimates. Delete the contact and those estimates?"
    : `Delete ${contact.name}?`;
  if (!window.confirm(message)) return;

  state.contacts = state.contacts.filter((item) => item.id !== contactId);
  state.estimates = state.estimates.filter((estimate) => estimate.contactId !== contactId);
  state.selectedContactId = state.contacts[0]?.id || null;
  state.selectedEstimateId = state.estimates[0]?.id || null;
  saveState();
  els.contactDialog.close();
  render();
  showToast("Contact deleted");
}

async function createEstimate(contactId, shouldRender = true, jobId = "") {
  if (!requireAction("manageEstimates")) return null;
  if (!contactId) {
    showToast("Choose a lead before creating an estimate");
    return null;
  }
  let contact = getContact(contactId);
  if (!contact) {
    showToast("Choose a valid lead before creating an estimate");
    return null;
  }
  const initialJob = contactJobs(contact).find((item) => item.id === jobId) || primaryJob(contact);
  const estimateId = uid("estimate");
  let reservation = null;
  if (canUseCloudSync()) {
    try { reservation = await reserveSharedSalesNumbers(contactId, initialJob?.id || jobId, estimateId); }
    catch (error) { showToast(error.message || "A shared estimate number could not be reserved."); return null; }
  }
  const numbered = reservation ? null : ensureLeadProjectNumbers(contactId, initialJob?.id || jobId);
  contact = getContact(contactId) || numbered?.contact || contact;
  const job = contactJobs(contact).find((item) => item.id === (initialJob?.id || jobId)) || numbered?.job || initialJob;

  const estimate = {
    id: estimateId,
    contactId,
    jobId: job?.id || "",
    leadNumber: reservation?.leadNumber || contact.leadNumber,
    projectNumber: reservation?.projectNumber || job?.projectNumber || "",
    estimateNumber: reservation?.estimateNumber || nextEstimateNumber(),
    projectTitle: job?.name || "Exterior Restoration Estimate",
    status: "Draft",
    projectManager: job?.salesRep || contact.salesRep || state.currentUser.name || "",
    salesRepEmail: state.currentUser.email || state.company.email || "",
    salesRepPhone: state.currentUser.phone || state.company.phone || "",
    issueDate: todayISO(),
    validUntil: addDaysISO(14),
    scopeSummary:
      "Provide labor, materials, project supervision, debris removal, and final cleanup for the approved exterior restoration scope.",
    taxRate: 0,
    deposit: 0,
    contractValue: 0,
    paidAmount: 0,
    paymentPercent: 0,
    paymentRequests: [],
    notes: state.company.defaultTerms,
    sentAt: "",
    items: [
      {
        title: "Exterior restoration scope",
        description:
          "Add product details, material notes, manufacturer/color selections, and installation scope for this item.",
        quantity: 1,
        unit: "job",
        rate: 0,
      },
    ],
  };

  state.estimates.unshift(estimate);
  state.selectedEstimateId = estimate.id;
  state.selectedContactId = contactId;
  state.newEstimateContactId = "";
  state.newEstimateJobId = "";
  state.view = "estimates";
  saveState();
  queueEstimateVerifiedSave(estimate.id, { immediate: true });
  if (shouldRender) render();
  return estimate;
}

function nextEstimateNumber() {
  const values = state.estimates
    .map((estimate) => Number(String(estimate.estimateNumber).replace(/\D/g, "")))
    .filter(Number.isFinite);
  const next = values.length ? Math.max(...values) + 1 : 1001;
  return `EST-${next}`;
}

function renderEstimateSaveState(estimateId = getSelectedEstimate()?.id) {
  if (!els.estimateSaveStatus) return;
  const stateForEstimate = estimateSaveStates.get(estimateId) || {
    message: "",
    tone: "",
  };
  setSaveState(
    els.estimateSaveStatus,
    stateForEstimate.message,
    stateForEstimate.tone,
    { showSuccess: true },
  );
}

function setEstimateSaveState(estimateId, message, tone = "") {
  estimateSaveStates.set(estimateId, { message, tone });
  if (getSelectedEstimate()?.id === estimateId) renderEstimateSaveState(estimateId);
}

async function flushEstimateVerifiedSave(estimateId, revision = estimateSaveRevisions.get(estimateId) || 0) {
  if (durableWriteBlocked) {
    setEstimateSaveState(estimateId, "Not saved. Shared saving is paused; review the recovery notice.", "error");
    return false;
  }
  if (!estimateId || !state.estimates.some((estimate) => estimate.id === estimateId)) return false;
  window.clearTimeout(estimateSaveTimers.get(estimateId));
  estimateSaveTimers.delete(estimateId);
  const isExplicitSave = estimateExplicitSaves.has(estimateId);
  if (!isExplicitSave) setEstimateSaveState(estimateId, "", "");

  const saved = await persistEstimateRecord(estimateId);
  const latestRevision = estimateSaveRevisions.get(estimateId) || 0;
  if (saved && revision === latestRevision) {
    if (!isExplicitSave) setEstimateSaveState(estimateId, "", "");
  } else if (!saved && revision === latestRevision) {
    setEstimateSaveState(estimateId, "Not saved to the shared CRM. Use Save Estimate to retry.", "error");
    showToast("Estimate save failed—your values are still on this page. Please retry.");
  }
  return saved;
}

function queueEstimateVerifiedSave(estimateId, { immediate = false } = {}) {
  if (durableWriteBlocked) return;
  if (!estimateId) return;
  const revision = (estimateSaveRevisions.get(estimateId) || 0) + 1;
  estimateSaveRevisions.set(estimateId, revision);
  estimateCompletedSaveRevisions.delete(estimateId);
  window.clearTimeout(estimateSaveTimers.get(estimateId));
  setEstimateSaveState(estimateId, "", "");
  const timer = window.setTimeout(
    () => void flushEstimateVerifiedSave(estimateId, revision),
    immediate ? 0 : 2000,
  );
  estimateSaveTimers.set(estimateId, timer);
}

function scheduleEstimateVisualRefresh(estimateId) {
  window.clearTimeout(estimateVisualRefreshTimer);
  estimateVisualRefreshTimer = window.setTimeout(() => {
    const estimate = state.estimates.find((item) => item.id === estimateId);
    if (!estimate || getSelectedEstimate()?.id !== estimateId) return;
    renderEstimatePreview(estimate);
    renderSummary();
    renderEstimateActiveSummary(estimate);
  }, 80);
}

function updateSelectedEstimateFromField(fieldName, value) {
  if (!canAction("manageEstimates")) return;
  const estimate = getSelectedEstimate();
  if (!estimate) return;
  if (canUseCloudSync() && estimate.estimateNumber && ["contactId", "jobId"].includes(fieldName) && value !== estimate[fieldName]) {
    showToast("A numbered estimate stays with its original lead and job. Create a new estimate for a different project.");
    renderEstimateForm(estimate);
    return;
  }
  if (["contactId", "jobId"].includes(fieldName) && value !== estimate[fieldName]) {
    const hasDocument = state.contacts.some((contact) => (contact.documents || []).some((document) => document.estimateId === estimate.id));
    if (estimate.squareInvoiceId || number(estimate.paidAmount) > 0 || hasDocument) {
      showToast("This estimate already has a saved PDF or invoice. Create a new estimate for a different lead or job.");
      renderEstimateForm(estimate);
      return;
    }
    const contact = getContact(fieldName === "contactId" ? value : estimate.contactId);
    if (!contact || (fieldName === "jobId" && !contactJobs(contact).some((job) => job.id === value))) {
      showToast("Select an existing lead and a job belonging to that lead.");
      renderEstimateForm(estimate);
      return;
    }
  }

  if (["taxRate", "deposit"].includes(fieldName)) {
    estimate[fieldName] = number(value);
  } else {
    estimate[fieldName] = value;
  }

  if (fieldName === "status") {
    syncEstimatePipelineStage(estimate, value);
  }

  if (fieldName === "contactId") {
    const numbered = ensureLeadProjectNumbers(value);
    const contact = numbered?.contact || getContact(value);
    estimate.jobId = numbered?.job?.id || primaryJob(contact)?.id || "";
    estimate.leadNumber = contact?.leadNumber || "";
    estimate.projectNumber = numbered?.job?.projectNumber || "";
    estimate.projectManager = contact?.salesRep || estimate.projectManager;
    state.selectedContactId = value;
    renderEstimateForm(estimate);
  }
  if (fieldName === "jobId") {
    const numbered = ensureLeadProjectNumbers(estimate.contactId, value);
    estimate.leadNumber = numbered?.contact?.leadNumber || estimate.leadNumber || "";
    estimate.projectNumber = numbered?.job?.projectNumber || "";
    estimate.projectTitle = numbered?.job?.name || estimate.projectTitle;
  }
  queueLocalStateSave();
  queueEstimateVerifiedSave(estimate.id);
  scheduleEstimateVisualRefresh(estimate.id);
}

function updateLineItem(input) {
  if (!canAction("manageEstimates")) return;
  const estimate = getSelectedEstimate();
  if (!estimate) return;
  const row = input.closest("[data-line-index]");
  const index = Number(row?.dataset.lineIndex);
  const field = input.dataset.lineField;
  if (!estimate.items[index] || !field) return;

  estimate.items[index][field] = ["quantity", "rate"].includes(field) ? number(input.value) : input.value;
  queueLocalStateSave();
  queueEstimateVerifiedSave(estimate.id);
  scheduleEstimateVisualRefresh(estimate.id);
}

function deleteEstimate() {
  if (!requireAction("manageEstimates")) return;
  const estimate = getSelectedEstimate();
  if (!estimate) return;
  if (estimate.squareInvoiceId || number(estimate.paidAmount) > 0 || state.contacts.some((contact) =>
    (contact.documents || []).some((document) => document.estimateId === estimate.id))) {
    showToast("This estimate has an invoice, payment, or saved PDF and must be retained for your records.");
    return;
  }

  if (!window.confirm(`Delete estimate ${estimate.estimateNumber}?`)) return;
  state.estimates = state.estimates.filter((item) => item.id !== estimate.id);
  state.selectedEstimateId = state.estimates[0]?.id || null;
  saveState();
  render();
  showToast("Estimate deleted");
}

function estimateText(estimate = getSelectedEstimate()) {
  if (!estimate) return "";
  const contact = getEstimateContact(estimate);
  const job = getEstimateJob(estimate);
  const totals = totalsFor(estimate);
  const rep = estimateSalesRep(estimate);
  const lines = estimate.items
    .map(
      (item) =>
        `- ${item.title || "Line item"}: ${number(item.quantity)} ${item.unit} x ${money.format(
          number(item.rate),
        )} = ${money.format(number(item.quantity) * number(item.rate))}${
          item.description ? `\n  ${item.description}` : ""
        }`,
    )
    .join("\n");

  return `${state.company.name}
Estimate ${estimate.estimateNumber}
Title: ${estimate.projectTitle || ""}

Job:
${job?.name || ""}
${job?.address || contact?.address || ""}

Customer:
${contact?.name || ""}
${contact?.address || ""}
${contact?.phone || ""}
${contact?.email || ""}

Sales Representative:
${rep.name || ""}
${rep.email || ""}
${rep.phone || ""}
${rep.officeAddress || ""}

Scope:
${estimate.scopeSummary}

Items:
${lines}

Subtotal: ${money.format(totals.subtotal)}
Tax: ${money.format(totals.tax)}
Deposit: ${money.format(number(estimate.deposit))}
Total: ${money.format(totals.total)}
Balance Due: ${money.format(totals.balance)}

Notes:
${estimate.notes || state.company.defaultTerms}`;
}

function estimateFileName(estimate = getSelectedEstimate()) {
  const contact = getEstimateContact(estimate);
  return `${estimate?.estimateNumber || "estimate"}-${contact?.name || "customer"}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .concat(".pdf");
}

async function saveEstimatePdfDocument(estimate, contact, doc) {
  if (!canAction("manageDocuments")) return null;
  const job = getEstimateJob(estimate);
  if (!contact || !job || estimate.contactId !== contact.id) throw new Error("Choose a valid lead and its job before saving the PDF");
  const targetIsCurrent = () => state.estimates.some((current) => current.id === estimate.id
    && current.contactId === contact.id && current.jobId === job.id)
    && Boolean(getContact(contact.id)) && getEstimateJob(estimate)?.id === job.id;
  if (!targetIsCurrent()) throw new Error("The estimate's lead or job changed. Review it before saving the PDF.");
  const categories = state.company.documentCategories || defaultDocumentCategories;
  const category = categories.find((item) => item.id === "doccat_estimates") || categoryForLegacyName("Estimates", categories);
  if (!category) throw new Error("The Estimates document category is unavailable");
  const fileName = estimateFileName(estimate);
  const documents = getContact(contact.id)?.documents || [];
  const existing = documents.find((document) => document.source === "Estimate PDF" && document.estimateId === estimate.id);
  const id = existing?.id || uid("doc");
  const blob = doc.output("blob");
  const file = new File([blob], fileName, { type: "application/pdf" });
  const stored = await storeDocumentFile(file, {
    documentId: id,
    leadId: contact.id,
    jobId: estimate.jobId || job?.id || "",
    categoryId: category.id,
  });
  // Uploading may take long enough for this estimate or its parent to be
  // removed/reassigned. Never attach the completed file to a changed target.
  if (!targetIsCurrent()) throw new Error("The estimate's lead or job changed during upload. Review it before saving the PDF.");
  const savedDocument = normalizeDocument({
    ...(existing || {}),
    id,
    name: fileName,
    categoryId: category.id,
    category: category.name,
    type: "application/pdf",
    size: file.size,
    ...stored,
    uploadedAt: new Date().toISOString(),
    uploadedBy: state.currentUser.name || state.currentUser.email || "Local user",
    versionNumber: existing ? Math.max(1, number(existing.versionNumber)) + 1 : 1,
    previousVersions: existing ? [...(existing.previousVersions || []), {
      versionNumber: existing.versionNumber,
      storagePath: existing.storagePath || "",
      dataUrl: existing.dataUrl || "",
      name: existing.name,
      size: existing.size,
      uploadedAt: existing.uploadedAt,
      uploadedBy: existing.uploadedBy,
    }] : [],
    source: "Estimate PDF",
    estimateId: estimate.id,
    leadId: contact.id,
    contactId: contact.id,
    jobId: estimate.jobId || job?.id || "",
  }, { leadId: contact.id, categoryId: category.id, categories });

  updateContact(contact.id, (current) => {
    const currentDocuments = current.documents || [];
    return {
      ...current,
      documents: existing
        ? currentDocuments.map((document) => (document.id === existing.id ? savedDocument : document))
        : [savedDocument, ...currentDocuments],
    };
  });

  const documentUpdateContact = !existing
    ? addContactUpdate(contact.id, {
      author: state.currentUser.name || "CRM",
      jobId: estimate.jobId || job?.id || "",
      message: `Saved estimate PDF ${estimate.estimateNumber} to documents.`,
    })
    : null;
  saveState({ localOnly: true });

  let saved = !canUseCloudSync();
  if (canUseCloudSync()) {
    saved = await persistLeadDocumentRecords([savedDocument.id], documentUpdateContact?.updates?.[0]?.id || "");
  }
  if (!saved) {
    queueDurableRecordsSave();
    queueCloudSave();
    throw new Error("The estimate PDF record could not be confirmed in the shared CRM");
  }
  queueCloudSave();

  return savedDocument;
}

const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_TOP_MARGIN = 54;
const PDF_BOTTOM_MARGIN = 54;
const PDF_CONTENT_BOTTOM = PDF_PAGE_HEIGHT - PDF_BOTTOM_MARGIN;

function pdfAddPageIfNeeded(doc, cursor, needed = 24) {
  if (cursor.y + needed <= PDF_CONTENT_BOTTOM) return false;
  doc.addPage();
  pdfDrawPageTopRule(doc);
  cursor.y = PDF_TOP_MARGIN;
  return true;
}

function pdfTextBlock(doc, text, x, cursor, width, options = {}) {
  const lines = doc.splitTextToSize(String(text || ""), width);
  const lineHeight = options.lineHeight || 12;
  pdfAddPageIfNeeded(doc, cursor, lines.length * lineHeight + 8);
  doc.text(lines, x, cursor.y);
  cursor.y += lines.length * lineHeight + (options.after || 0);
}

function pdfImageFormat(dataUrl = "") {
  if (dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg")) return "JPEG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "PNG";
}

function pdfDrawPageTopRule(doc) {
  doc.setFillColor(17, 17, 17);
  doc.rect(0, 0, PDF_PAGE_WIDTH, 14, "F");
}

function pdfDrawEstimateTableHeader(doc, cursor, left, right, options = {}) {
  const tableWidth = right - left;
  if (options.continued) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text("ESTIMATE DETAIL (CONTINUED)", left, cursor.y);
    cursor.y += 12;
  }
  // Bottom border only (clean minimal header)
  doc.setDrawColor(12, 23, 48);
  doc.setLineWidth(1.5);
  doc.line(left, cursor.y + 20, right, cursor.y + 20);
  doc.setLineWidth(0.5);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("PRODUCT / WORK ITEM", left + 8, cursor.y + 14);
  doc.text("QTY", 352, cursor.y + 14, { align: "right" });
  doc.text("UNIT", 362, cursor.y + 14);
  doc.text("RATE", 468, cursor.y + 14, { align: "right" });
  doc.text("AMOUNT", right - 8, cursor.y + 14, { align: "right" });
  cursor.y += 22;
}

async function downloadEstimatePdf(options = {}) {
  // An explicit save owns its estimate even if the user opens another one
  // while the shared save finishes. Keep PDF input detached from later edits.
  const sourceEstimate = options.estimateSnapshot || getSelectedEstimate();
  const estimate = sourceEstimate ? JSON.parse(JSON.stringify(sourceEstimate)) : null;
  const contact = getEstimateContact(estimate);
  const job = getEstimateJob(estimate);
  if (!estimate || !contact) {
    showToast("Create an estimate before downloading");
    return false;
  }

  const JsPdf = window.jspdf?.jsPDF;
  if (!JsPdf) {
    showToast("PDF generator is loading. Opening print instead.");
    window.print();
    return false;
  }

  const company = state.company;
  const rep = estimateSalesRep(estimate);
  const officeAddress = companyOfficeAddress();
  const totals = totalsFor(estimate);
  const doc = new JsPdf({ unit: "pt", format: "letter" });
  const cursor = { y: 0 };
  const left = 48;
  const right = PDF_PAGE_WIDTH - 48;
  const tableWidth = right - left;
  const midX = left + tableWidth / 2 + 12;

  doc.setProperties({
    title: `${estimate.estimateNumber} - ${estimate.projectTitle || "Estimate"}`,
    subject: "Roofing estimate",
    author: company.name,
  });

  // ── Dark header band ──────────────────────────────────────
  doc.setFillColor(12, 23, 48);
  doc.rect(0, 0, PDF_PAGE_WIDTH, 90, "F");

  // Logo or initial mark
  let brandTextX = left;
  if (company.logoDataUrl) {
    try {
      doc.addImage(company.logoDataUrl, pdfImageFormat(company.logoDataUrl), left, 18, 48, 38);
      brandTextX = left + 60;
    } catch { brandTextX = left; }
  } else {
    doc.setFillColor(15, 95, 232);
    doc.roundedRect(left, 20, 36, 36, 4, 4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(255, 255, 255);
    doc.text((company.name || "R").slice(0, 1).toUpperCase(), left + 18, 44, { align: "center" });
    brandTextX = left + 48;
  }

  // Company name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(255, 255, 255);
  doc.text(company.name || "Company", brandTextX, 34);

  // Company sub-info
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  const companySubLines = [
    officeAddress ? officeAddress.split("\n")[0] : "",
    [company.phone, company.email].filter(Boolean).join("  ·  "),
    company.license || "",
  ].filter(Boolean);
  companySubLines.forEach((line, i) => {
    doc.text(line, brandTextX, 46 + i * 10);
  });

  // ESTIMATE label (right side)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.setTextColor(255, 255, 255);
  doc.text("ESTIMATE", right, 34, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(148, 163, 184);
  doc.text([estimate.estimateNumber, estimate.projectNumber].filter(Boolean).join("  |  "), right, 48, { align: "right" });
  doc.text(`Issued: ${formatDate(estimate.issueDate)}`, right, 59, { align: "right" });
  doc.text(`Valid through: ${formatDate(estimate.validUntil)}`, right, 70, { align: "right" });

  // Status pill
  const statusPillColors = {
    Draft: [51, 65, 85], Sent: [29, 158, 117], Won: [31, 157, 85],
    Rejected: [184, 67, 61], Invoiced: [15, 95, 232],
  };
  const pillRgb = statusPillColors[estimate.status] || statusPillColors.Draft;
  doc.setFillColor(...pillRgb);
  const statusText = estimate.status || "Draft";
  doc.setFontSize(8);
  const pillW = doc.getTextWidth(statusText) + 14;
  doc.roundedRect(right - pillW, 76, pillW, 12, 3, 3, "F");
  doc.setTextColor(220, 240, 255);
  doc.text(statusText, right - pillW / 2, 84.5, { align: "center" });

  // Accent bar
  doc.setFillColor(15, 95, 232);
  doc.rect(0, 90, PDF_PAGE_WIDTH * 0.55, 3, "F");
  doc.setFillColor(15, 159, 152);
  doc.rect(PDF_PAGE_WIDTH * 0.55, 90, PDF_PAGE_WIDTH * 0.45, 3, "F");

  cursor.y = 108;

  // ── Customer & Job info boxes ─────────────────────────────
  const boxTop = cursor.y;
  const boxH = 88;
  const col2X = midX;

  doc.setFillColor(246, 250, 255);
  doc.setDrawColor(214, 227, 243);
  doc.roundedRect(left, boxTop, tableWidth / 2 - 8, boxH, 3, 3, "FD");
  doc.roundedRect(col2X, boxTop, tableWidth / 2 - 8, boxH, 3, 3, "FD");

  // Customer label
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("CUSTOMER", left + 10, boxTop + 14);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(12, 23, 48);
  doc.text(contact.name || "No customer", left + 10, boxTop + 27);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  const customerLines = [
    (contact.address || "").split("\n")[0],
    contact.phone || "",
    contact.email || "",
  ].filter(Boolean);
  customerLines.forEach((line, i) => {
    doc.text(line, left + 10, boxTop + 39 + i * 11);
  });

  // Job / rep label
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139);
  doc.text("PROJECT & REPRESENTATIVE", col2X + 10, boxTop + 14);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(12, 23, 48);
  doc.text(estimate.projectTitle || "Project estimate", col2X + 10, boxTop + 27);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  const jobLines = [
    (job?.address || contact.address || "").split("\n")[0],
    rep.name ? `Rep: ${rep.name}` : "",
    rep.email || "",
    rep.phone || "",
  ].filter(Boolean);
  jobLines.forEach((line, i) => {
    doc.text(line, col2X + 10, boxTop + 39 + i * 11);
  });

  cursor.y = boxTop + boxH + 16;

  // ── Scope summary ─────────────────────────────────────────
  if (estimate.scopeSummary) {
    pdfAddPageIfNeeded(doc, cursor, 48);
    doc.setFillColor(232, 242, 255);
    doc.setDrawColor(15, 95, 232);
    const scopeLines = doc.splitTextToSize(estimate.scopeSummary, tableWidth - 28);
    const scopeH = scopeLines.length * 11 + 20;
    doc.rect(left, cursor.y, 3, scopeH, "F");
    doc.setFillColor(232, 242, 255);
    doc.rect(left + 3, cursor.y, tableWidth - 3, scopeH, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text("PROJECT SCOPE", left + 12, cursor.y + 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(12, 23, 48);
    doc.text(scopeLines, left + 12, cursor.y + 23);
    cursor.y += scopeH + 14;
  }

  // ── Line items table ──────────────────────────────────────
  pdfAddPageIfNeeded(doc, cursor, 48);
  pdfDrawEstimateTableHeader(doc, cursor, left, right);

  estimate.items.forEach((item) => {
    const titleLines = doc.splitTextToSize(item.title || "Line item", 235);
    const descLines = item.description ? doc.splitTextToSize(item.description, 235) : [];
    const textLines = titleLines.length + descLines.length;
    const rowH = Math.max(32, textLines * 11 + 16);

    const addedPage = pdfAddPageIfNeeded(doc, cursor, rowH + 52);
    if (addedPage) pdfDrawEstimateTableHeader(doc, cursor, left, right, { continued: true });

    doc.setDrawColor(214, 227, 243);
    doc.setFillColor(255, 255, 255);
    doc.rect(left, cursor.y, tableWidth, rowH, "FD");

    // Subtle zebra on alternating rows handled via fill above
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(12, 23, 48);
    doc.text(titleLines, left + 8, cursor.y + 13);

    if (descLines.length) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(100, 116, 139);
      doc.text(descLines, left + 8, cursor.y + 13 + titleLines.length * 11);
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(number(item.quantity).toLocaleString("en-US"), 352, cursor.y + 13, { align: "right" });
    doc.text(item.unit || "ea", 362, cursor.y + 13);
    doc.setTextColor(12, 23, 48);
    doc.text(money.format(number(item.rate)), 468, cursor.y + 13, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.text(money.format(number(item.quantity) * number(item.rate)), right - 8, cursor.y + 13, { align: "right" });
    cursor.y += rowH;
  });

  // ── Totals ────────────────────────────────────────────────
  cursor.y += 16;
  pdfAddPageIfNeeded(doc, cursor, 110);
  const tlX = 360;
  const tvX = right;

  const totalRows = [
    ["Subtotal", money.format(totals.subtotal), false],
    [`Tax (${number(estimate.taxRate)}%)`, money.format(totals.tax), false],
    ["Deposit", `\u2212${money.format(number(estimate.deposit))}`, false],
    ["Total", money.format(totals.total), true],
    ["Balance due on completion", money.format(totals.balance), false],
  ];

  totalRows.forEach(([label, value, isGrand], i) => {
    if (isGrand) {
      doc.setDrawColor(12, 23, 48);
      doc.setLineWidth(1.5);
      doc.line(tlX, cursor.y - 4, tvX, cursor.y - 4);
      doc.setLineWidth(0.5);
    }
    doc.setFont("helvetica", isGrand ? "bold" : "normal");
    doc.setFontSize(isGrand ? 12 : 9);
    doc.setTextColor(isGrand ? 12 : 100, isGrand ? 23 : 116, isGrand ? 48 : 139);
    doc.text(label, tlX, cursor.y);
    doc.setTextColor(isGrand ? 12 : 12, isGrand ? 23 : 23, isGrand ? 48 : 48);
    doc.text(value, tvX, cursor.y, { align: "right" });
    cursor.y += isGrand ? 20 : 14;
  });

  // ── Notes & Terms ─────────────────────────────────────────
  const termsText = estimate.notes || company.defaultTerms || "";
  if (termsText) {
    cursor.y += 10;
    pdfAddPageIfNeeded(doc, cursor, 72);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text("NOTES & TERMS", left, cursor.y);
    cursor.y += 11;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(31, 41, 55);
    pdfTextBlock(doc, termsText, left, cursor, tableWidth, { lineHeight: 10, after: 18 });
  }

  // ── Signature lines ───────────────────────────────────────
  pdfAddPageIfNeeded(doc, cursor, 60);
  cursor.y += 10;
  doc.setDrawColor(31, 41, 55);
  doc.setLineWidth(0.75);
  doc.line(left, cursor.y + 32, left + 200, cursor.y + 32);
  doc.line(left + 240, cursor.y + 32, left + 380, cursor.y + 32);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text("Customer signature", left, cursor.y + 44);
  doc.text("Date", left + 240, cursor.y + 44);

  // ── Footer bar ────────────────────────────────────────────
  doc.setFillColor(246, 250, 255);
  doc.setDrawColor(214, 227, 243);
  doc.rect(0, PDF_PAGE_HEIGHT - 24, PDF_PAGE_WIDTH, 24, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  const footerLeft = [company.name, company.website].filter(Boolean).join("  ·  ");
  const footerRight = company.license || "";
  doc.text(footerLeft, left, PDF_PAGE_HEIGHT - 9);
  if (footerRight) doc.text(footerRight, right, PDF_PAGE_HEIGHT - 9, { align: "right" });

  let savedDocument = null;
  if (options.saveToDocuments !== false) {
    try {
      savedDocument = await saveEstimatePdfDocument(estimate, contact, doc);
    } catch (error) {
      console.warn("Estimate PDF could not be saved to lead documents", error);
      setEstimateSaveState(estimate.id, "The estimate was saved, but its PDF could not be attached to the lead. Please retry.", "error");
      showToast("Estimate PDF was not saved to the lead documents. Please retry.");
      if (options.download === false) return false;
    }
  }
  if (options.download !== false) {
    doc.save(estimateFileName(estimate));
  }
  if (!options.silent && options.download !== false) {
    showToast(savedDocument ? "Estimate PDF downloaded and saved to the lead" : "Estimate PDF downloaded");
  }
  return options.saveToDocuments === false || Boolean(savedDocument);
}

async function copyEstimate() {
  const text = estimateText();
  try {
    await navigator.clipboard.writeText(text);
    showToast("Estimate copied to clipboard");
  } catch {
    showToast("Clipboard access was blocked");
  }
}

async function sendEstimate() {
  if (!requireAction("manageEstimates")) return;
  const estimate = getSelectedEstimate();
  const contact = getEstimateContact(estimate);
  if (!estimate || !contact) return;
  if (!contact.email) {
    showToast("Add an email address before sending");
    return;
  }

  estimate.status = "Sent";
  estimate.sentAt = todayISO();
  syncEstimatePipelineStage(estimate, "Sent");
  const job = getEstimateJob(estimate);
  const rawSubject = `${estimate.estimateNumber} from ${state.company.name}`;
  const rawMessage = `Hi ${contact.name},\n\nPlease review the estimate below. I also downloaded the PDF so it can be attached to this email.\n\n${estimateText(
    estimate,
  )}`;
  if (job) {
    updateContact(contact.id, (current) => ({
      ...current,
      jobs: contactJobs(current).map((item) =>
        item.id === job.id
          ? {
              ...item,
              emails: [
                normalizeJobEmail({
                  fromEmail: state.currentUser.email || state.company.email || "",
                  toEmail: contact.email,
                  subject: rawSubject,
                  message: rawMessage,
                  createdBy: state.currentUser.name || "CRM user",
                }),
                ...(item.emails || []),
              ],
            }
          : item,
      ),
    }));
    addContactUpdate(contact.id, {
      author: state.currentUser.name || "CRM user",
      jobId: job.id,
      message: `Opened estimate email draft: ${rawSubject}.`,
    });
  }
  saveState();
  render();
  await downloadEstimatePdf({ silent: true });

  const subject = encodeURIComponent(rawSubject);
  const body = encodeURIComponent(rawMessage);
  window.location.href = `mailto:${encodeURIComponent(contact.email)}?subject=${subject}&body=${body}`;
  showToast("Email draft opened");
}

function printEstimate() {
  downloadEstimatePdf();
}

async function saveCurrentEstimateAndPdf() {
  const estimate = getSelectedEstimate();
  if (!estimate || estimateExplicitSaves.has(estimate.id)) return false;
  const snapshot = JSON.parse(JSON.stringify(estimate));
  estimateExplicitSaves.add(estimate.id);
  flushQueuedLocalStateSave();
  const revision = (estimateSaveRevisions.get(estimate.id) || 0) + 1;
  estimateSaveRevisions.set(estimate.id, revision);
  estimateCompletedSaveRevisions.delete(estimate.id);
  setEstimateSaveState(estimate.id, "Saving estimate and PDF...", "saving");
  if (els.saveEstimateButton) els.saveEstimateButton.disabled = true;
  const snapshotIsCurrent = () => {
    const current = state.estimates.find((item) => item.id === snapshot.id);
    return current && estimateSaveRevisions.get(snapshot.id) === revision
      && durableRecordDataMatches(current, snapshot);
  };
  const keepNewerChanges = () => {
    setEstimateSaveState(snapshot.id, "Newer changes still need an estimate PDF. Select Save Estimate again when you finish editing.", "error");
    return false;
  };

  try {
    const estimateSaved = await flushEstimateVerifiedSave(estimate.id, revision);
    if (!estimateSaved) {
      if (!estimateSaveStates.get(estimate.id)?.message) {
        setEstimateSaveState(estimate.id, "The estimate could not be confirmed. Your entries remain on this page; select Save Estimate to retry.", "error");
      }
      return false;
    }
    // Do not generate a newer unsaved draft, or mark edits made during either
    // network request as fully saved. The rep can keep typing without a lock.
    if (!snapshotIsCurrent()) return keepNewerChanges();
    const pdfSaved = await downloadEstimatePdf({ silent: true, download: false, estimateSnapshot: snapshot });
    if (!pdfSaved) {
      setEstimateSaveState(estimate.id, "The estimate was saved, but its PDF was not attached. Select Save Estimate to retry.", "error");
      return false;
    }
    if (!snapshotIsCurrent()) return keepNewerChanges();
    estimateCompletedSaveRevisions.set(estimate.id, revision);
    setEstimateSaveState(estimate.id, "Saved with PDF in this lead's documents.", "success");
    return true;
  } catch (error) {
    console.warn("Estimate and PDF save failed", error);
    setEstimateSaveState(estimate.id, "The estimate and PDF could not be saved. Your entries remain on this page; select Save Estimate to retry.", "error");
    return false;
  } finally {
    estimateExplicitSaves.delete(estimate.id);
    if (els.saveEstimateButton) els.saveEstimateButton.disabled = !canAction("manageEstimates");
  }
}

async function openEstimateLeadOverview(contactId) {
  const estimate = getSelectedEstimate();
  const contact = getContact(contactId || estimate?.contactId);
  if (!estimate || !contact || contact.id !== estimate.contactId) return false;
  const estimateId = estimate.id;
  const jobId = estimate.jobId || "";
  const initialView = state.view;
  const revision = estimateSaveRevisions.get(estimateId) || 0;
  if (estimateCompletedSaveRevisions.get(estimateId) === revision) {
    openLeadDetail(contact.id, "overview", jobId);
    return true;
  }
  const confirmed = window.confirm(
    `Save the latest changes and estimate PDF before opening ${contact.name}? Select Cancel to stay on this estimate.`,
  );
  if (!confirmed) return false;
  const saved = await saveCurrentEstimateAndPdf();
  // A delayed save must not pull the rep away from another estimate or view
  // they deliberately opened in the meantime.
  if (getSelectedEstimate()?.id !== estimateId || state.view !== initialView) return false;
  if (!saved) {
    showToast("The estimate and its latest PDF are not both confirmed. You are still on the estimate page; review the save status before continuing.");
    return false;
  }
  openLeadDetail(contact.id, "overview", jobId);
  return true;
}

function saveCompany(event) {
  event.preventDefault();
  if (!requireAction("manageCompany")) return;
  const formData = new FormData(els.companyForm);
  state.currentUser = {
    name: formData.get("userName").trim() || defaultCurrentUser.name,
    email: formData.get("userEmail").trim() || state.company.email || defaultCurrentUser.email,
    phone: formatPhoneNumber(formData.get("userPhone")) || state.currentUser.phone || "",
    role: formData.get("userRole").trim() || defaultCurrentUser.role,
  };
  state.company = {
    ...state.company,
    name: formData.get("name").trim(),
    license: formData.get("license").trim(),
    phone: formatPhoneNumber(formData.get("phone")),
    email: formData.get("email").trim(),
    address: formData.get("officeAddress").trim(),
    officeAddress: formData.get("officeAddress").trim(),
    logoDataUrl: state.company.logoDataUrl || "",
    googleReviewUrl: formData.get("googleReviewUrl").trim(),
    defaultTerms: formData.get("defaultTerms").trim(),
  };
  state.companyFormDraft = null;
  saveState();
  renderCompanyForm();
  renderBrandLogo();
  renderTopbarProfile();
  renderEstimatePreview(getSelectedEstimate());
  showToast("Settings saved");
}

function showToast(message) {
  const text = String(message || "");
  const isFailure = /\b(?:not saved|failed|failure|error|retry|unavailable|still retrying|cloud sync is off)\b/i.test(text);
  const isRoutineSaveNotice = /\b(?:saved|uploaded|stored)\b/i.test(text) || /\bupdated from (?:the )?(?:cloud|supabase|crm)\b/i.test(text);
  const isWorkflowBlocker = /^Complete before moving\b/i.test(text);
  if (isRoutineSaveNotice && !isFailure && !isWorkflowBlocker && !/\bdownloaded\b/i.test(text)) return;
  window.clearTimeout(toastTimer);
  els.toast.textContent = text;
  els.toast.classList.add("show");
  toastTimer = window.setTimeout(() => els.toast.classList.remove("show"), 2400);
}

function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((node) => {
    const iconName = node.dataset.icon;
    node.innerHTML = icons[iconName] || "";
  });
}

const icons = {
  home:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>',
  "arrow-left":
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>',
  open:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  pipeline:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16"/><path d="M4 12h10"/><path d="M4 18h6"/></svg>',
  users:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  user:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>',
  briefcase:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 6V5a2 2 0 0 1 2-2h0a2 2 0 0 1 2 2v1"/><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 12h18"/><path d="M12 12v2"/></svg>',
  hammer:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 12-8.5 8.5a2.1 2.1 0 0 1-3-3L12 9"/><path d="m14 4 6 6"/><path d="m13 5 2-2 6 6-2 2"/></svg>',
  clipboard:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 4a3 3 0 0 1 6 0"/><path d="M9 12h6"/><path d="M9 16h6"/></svg>',
  invoice:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h12v20l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6"/><path d="M9 12h6"/><path d="M9 16h3"/></svg>',
  star:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.3L5.8 21 7 14.2 2 9.3l6.9-1Z"/></svg>',
  "bar-chart":
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5"/><path d="M4 19h16"/><rect x="7" y="11" width="3" height="5"/><rect x="12" y="7" width="3" height="9"/><rect x="17" y="9" width="3" height="7"/></svg>',
  bell:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  menu:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>',
  file:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>',
  image:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  folder:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>',
  calendar:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/></svg>',
  refresh:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.9-4"/><path d="M4 5v6h6"/><path d="M4 13a8 8 0 0 0 14.9 4"/><path d="M20 19v-6h-6"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.23.38.6.64 1 .7.2.03.4.04.6.04a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z"/></svg>',
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>',
  plus:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>',
  download:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>',
  upload:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/></svg>',
  dollar:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  edit:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
  copy:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  printer:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>',
  mail:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg>',
  send:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
  x:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
};

function bindEvents() {
  document.addEventListener("focusout", () => {
    if (!pendingDurableRender) return;
    window.setTimeout(() => {
      if (pendingDurableRender) renderDurableUpdateWhenIdle();
    }, 0);
  });

  document.addEventListener(
    "blur",
    (event) => {
      if (event.target instanceof HTMLInputElement) {
        if (event.target.matches("[data-phone-input]")) event.target.value = formatPhoneNumber(event.target.value);
        if (event.target.matches("[data-currency-input]")) event.target.value = formatCurrencyInput(event.target.value);
      }
    },
    true,
  );

  document.addEventListener("click", async (event) => {
    if (!event.target.closest(".global-search")) hideLiveSearchResults();

    const dashboardStage = event.target.closest("[data-dashboard-stage]");
    if (dashboardStage) {
      state.leadStageFilter = dashboardStage.dataset.dashboardStage || "";
      state.search = "";
      state.view = "leads";
      saveState();
      render();
      return;
    }

    const navButton = event.target.closest("[data-view]");
    if (navButton) {
      if (navButton.dataset.view === "leads") state.leadStageFilter = "";
      setView(navButton.dataset.view);
    }

    const filterButton = event.target.closest("[data-pipeline-filter]");
    if (filterButton) {
      state.pipelineFilter = filterButton.dataset.pipelineFilter;
      saveState();
      renderPipeline();
    }

    const leaderboardButton = event.target.closest("[data-leaderboard-range]");
    if (leaderboardButton) {
      state.leaderboardRange = leaderboardButton.dataset.leaderboardRange;
      saveState();
      renderDashboard();
    }

    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;

    const { action, contactId, nextStatus, lineIndex } = actionButton.dataset;
    const permission = actionPermissions[action];
    if (permission && !requireAction(permission)) return;
    if (action === "download-document") await downloadManagedDocument(actionButton.dataset.documentId);
    if (action === "open-estimate-lead") {
      await openEstimateLeadOverview(contactId);
      return;
    }
    if (action === "add-customer") openContactDialog(null, { type: "Customer" });
    if (action === "open-contact") openLeadDetail(contactId);
    if (action === "open-contact-tab") openLeadDetail(contactId, actionButton.dataset.tab || "overview", actionButton.dataset.jobId || "");
    if (action === "open-job") openLeadJob(contactId, actionButton.dataset.jobId);
    if (action === "open-job-photos") openLeadJobPhotos(contactId, actionButton.dataset.jobId);
    if (action === "refresh-weather") loadWeather({ force: true });
    if (action === "edit-contact") openContactDialog(contactId);
    if (action === "estimate-contact") await createEstimate(contactId);
    if (action === "estimate-job") await createEstimate(contactId, true, actionButton.dataset.jobId);
    if (action === "go-to-settings") { state.view = "company"; render(); }
    if (action === "clear-lead-stage-filter") {
      state.leadStageFilter = "";
      saveState();
      renderLeadsView();
    }
    if (action === "log-review-request") {
      if (contactId) {
        const contact = getContact(contactId);
        const job = contactJobs(contact).find((item) => item.id === actionButton.dataset.jobId) || primaryJob(contact);
        const draft = reviewRequestEmail(contact);
        if (job) {
          updateContact(contactId, (current) => ({
            ...current,
            jobs: contactJobs(current).map((item) =>
              item.id === job.id
                ? {
                    ...item,
                    emails: [
                      normalizeJobEmail({
                        toEmail: contact.email,
                        fromEmail: state.currentUser.email || state.company.email || "",
                        subject: draft.subject,
                        message: draft.message,
                        createdBy: state.currentUser.name || "CRM",
                      }),
                      ...(item.emails || []),
                    ],
                  }
                : item,
            ),
          }));
        }
        addContactUpdate(contactId, {
          author: state.currentUser.name || "CRM",
          jobId: job?.id || "",
          message: "Sent review request email.",
        });
        saveState();
        showToast("Review request logged");
      }
    }
    if (action === "select-estimate") {
      state.view = "estimates";
      setSelectedEstimate(actionButton.dataset.estimateId);
      render();
    }
    if (action === "advance-contact") {
      if (getContact(contactId)) {
        applyStatusUpdate(contactId, nextStatus);
        saveState();
        render();
      }
    }
    if (action === "remove-line") {
      const estimate = getSelectedEstimate();
      if (estimate && estimate.items.length > 1) {
        estimate.items.splice(Number(lineIndex), 1);
        queueLocalStateSave();
        renderEstimateLineItems(estimate);
        queueEstimateVerifiedSave(estimate.id);
        scheduleEstimateVisualRefresh(estimate.id);
      }
    }
    if (action === "remove-document") {
      removeLeadDocument(actionButton.dataset.documentId);
    }
    if (action === "rename-document") {
      renameLeadDocument(actionButton.dataset.documentId);
    }
    if (action === "upload-to-category") {
      if (els.leadDocumentCategory) els.leadDocumentCategory.value = actionButton.dataset.categoryId;
      els.leadDocumentInput.value = "";
      els.leadDocumentInput.click();
    }
    if (action === "remove-company-document") {
      removeCompanyDocument(actionButton.dataset.documentId);
    }
    if (action === "rename-company-document") {
      renameCompanyDocument(actionButton.dataset.documentId);
    }
    if (action === "edit-document-category") {
      editDocumentCategory(actionButton.dataset.categoryId, actionButton.closest(".document-category-admin-row"));
    }
    if (action === "toggle-document-category") {
      toggleDocumentCategory(actionButton.dataset.categoryId);
    }
    if (action === "delete-document-category") {
      deleteDocumentCategory(actionButton.dataset.categoryId);
    }
    if (action === "merge-document-category") {
      const row = actionButton.closest(".document-category-admin-row");
      mergeDocumentCategory(actionButton.dataset.categoryId, row?.querySelector("[data-merge-target]")?.value);
    }
    if (action === "move-document-category-up") {
      moveDocumentCategory(actionButton.dataset.categoryId, -1);
    }
    if (action === "move-document-category-down") {
      moveDocumentCategory(actionButton.dataset.categoryId, 1);
    }
    if (action === "edit-job") {
      editLeadJob(actionButton.dataset.jobId);
    }
    if (action === "delete-job") {
      deleteLeadJob(actionButton.dataset.jobId);
    }
    if (action === "open-job-profit") {
      state.selectedProfitJobId = actionButton.dataset.jobId;
      openLeadDetail(contactId, "profit");
    }
    if (action === "edit-cost-item") {
      editCostItem(actionButton.dataset.costId);
    }
    if (action === "delete-cost-item") {
      deleteCostItem(actionButton.dataset.costId);
    }
    if (action === "edit-manual-payment") {
      editManualPayment(actionButton.dataset.paymentId);
    }
    if (action === "delete-manual-payment") {
      await deleteManualPayment(actionButton.dataset.paymentId);
    }
    if (action === "open-calendar-task") {
      editCalendarTask(actionButton.dataset.taskId);
    }
    if (action === "edit-calendar-task") {
      editCalendarTask(actionButton.dataset.taskId);
    }
    if (action === "complete-calendar-task") {
      completeCalendarTask(actionButton.dataset.taskId);
    }
    if (action === "delete-calendar-task") {
      deleteCalendarTask(actionButton.dataset.taskId);
    }
  });

  document.addEventListener("click", (event) => {
    const tabButton = event.target.closest("[data-lead-tab]");
    if (!tabButton) return;
    if (tabButton.dataset.leadTab === "payments" && !canManageManualPayments()) {
      showToast("Only an administrator can view payments");
      return;
    }
    state.leadDetailTab = tabButton.dataset.leadTab;
    saveState();
    renderLeadDetail();
  });

  const selectLiveSearchResult = (event) => {
    const result = event.target.closest("[data-live-search-contact]");
    if (!result) return;
    event.preventDefault();
    event.stopPropagation();
    openLiveSearchResult(result.dataset.liveSearchContact);
  };
  els.globalSearchResults.addEventListener("pointerdown", selectLiveSearchResult);
  els.globalSearchResults.addEventListener("click", selectLiveSearchResult);

  els.globalSearch.addEventListener("input", (event) => {
    state.search = event.target.value;
    liveSearchActiveIndex = -1;
    renderSearchFilteredView();
    renderLiveSearchResults();
  });
  els.globalSearch.addEventListener("focus", renderLiveSearchResults);
  els.globalSearch.addEventListener("keydown", (event) => {
    const { matches } = liveLeadSearchMatches();
    if (event.key === "Escape") {
      hideLiveSearchResults();
      els.globalSearch.blur();
      return;
    }
    if (!matches.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      liveSearchActiveIndex = (liveSearchActiveIndex + 1) % matches.length;
      renderLiveSearchResults();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      liveSearchActiveIndex = liveSearchActiveIndex <= 0 ? matches.length - 1 : liveSearchActiveIndex - 1;
      renderLiveSearchResults();
    } else if (event.key === "Enter") {
      event.preventDefault();
      openLiveSearchResult(matches[Math.max(liveSearchActiveIndex, 0)]?.id);
    }
  });

  els.importZohoButton.addEventListener("click", () => {
    if (!requireAction("manageContacts")) return;
    els.zohoCsvInput.value = "";
    els.zohoCsvInput.click();
  });
  els.zohoCsvInput.addEventListener("change", async (event) => {
    if (!requireAction("manageContacts")) return;
    try {
      await importZohoCsv(event.target.files?.[0]);
    } catch {
      showToast("Zoho import failed. Check that the file is a CSV export.");
    }
  });

  els.addContactButton.addEventListener("click", () => {
    if (requireAction("manageContacts")) openContactDialog(null, { type: "Lead" });
  });
  els.addLeadFromLeadsButton.addEventListener("click", () => {
    if (requireAction("manageContacts")) openContactDialog(null, { type: "Lead" });
  });
  els.backToContactsButton.addEventListener("click", () => setView("contacts"));
  els.editLeadDetailButton.addEventListener("click", () => {
    const contact = getSelectedContact();
    if (contact && requireAction("manageContacts")) openContactDialog(contact.id);
  });
  els.emailLeadDetailButton.addEventListener("click", () => {
    const contact = getSelectedContact();
    if (contact && requireAction("sendEmail")) openLeadDetail(contact.id, "email");
  });
  els.estimateLeadDetailButton.addEventListener("click", async () => {
    const contact = getSelectedContact();
    if (contact && requireAction("manageEstimates")) await createEstimate(contact.id);
  });
  els.uploadLeadDocumentButton.addEventListener("click", () => {
    if (!requireAction("manageDocuments")) return;
    els.leadDocumentInput.value = "";
    els.leadDocumentInput.click();
  });
  els.leadDocumentInput.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    try {
      await uploadLeadDocuments(files);
    } catch (error) {
      console.warn("Lead document upload failed", error);
      const message = documentUploadErrorMessage(error);
      setSaveState(els.leadDocumentUploadStatus, message, "error");
      showToast(message);
      els.uploadLeadDocumentButton.disabled = false;
    } finally {
      event.target.value = "";
    }
  });
  els.leadDocumentJobSelect?.addEventListener("change", (event) => {
    const contact = getSelectedContact();
    if (!contact || !contactJobs(contact).some((job) => job.id === event.target.value)) return;
    state.selectedLeadJobId = event.target.value;
    state.selectedProfitJobId = event.target.value;
    saveState({ localOnly: true });
    renderLeadDetail();
  });
  els.leadPhotoJobSelect?.addEventListener("change", (event) => {
    const contact = getSelectedContact();
    if (!contact) return;
    if (!contactJobs(contact).some((job) => job.id === event.target.value)) return;
    state.selectedLeadJobId = event.target.value;
    state.selectedProfitJobId = event.target.value;
    saveState({ localOnly: true });
    renderLeadDetail();
  });
  els.uploadLeadPhotoButton?.addEventListener("click", () => {
    if (!requireAction("manageDocuments")) return;
    els.leadPhotoInput.value = "";
    els.leadPhotoInput.click();
  });
  els.leadPhotoInput?.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    try {
      await uploadLeadPhotos(files);
    } catch (error) {
      console.warn("Job photo upload failed", error);
      const message = documentUploadErrorMessage(error);
      setSaveState(els.leadPhotoUploadStatus, message, "error");
      showToast(message);
      els.uploadLeadPhotoButton.disabled = !canAction("manageDocuments");
    } finally {
      event.target.value = "";
    }
  });
  els.leadConversationForm.addEventListener("submit", submitLeadConversation);
  els.leadJobForm.addEventListener("submit", saveLeadJob);
  els.clearJobFormButton.addEventListener("click", () => fillJobForm());
  els.profitJobSelect?.addEventListener("change", (event) => {
    if (!requireAction("manageJobFinancials")) return;
    state.selectedLeadJobId = event.target.value;
    state.selectedProfitJobId = event.target.value;
    saveState({ localOnly: true });
    renderLeadDetail();
  });
  els.profitCostForm?.addEventListener("submit", saveProfitCost);
  els.clearProfitCostForm?.addEventListener("click", () => fillProfitCostForm());
  els.paymentJobSelect?.addEventListener("change", (event) => {
    if (!canManageManualPayments()) return;
    const contact = getSelectedContact();
    if (!contact || !contactJobs(contact).some((job) => job.id === event.target.value)) return;
    state.selectedLeadJobId = event.target.value;
    state.selectedProfitJobId = event.target.value;
    fillManualPaymentForm();
    setSaveState(els.manualPaymentSaveStatus, "", "");
    saveState({ localOnly: true });
    renderLeadDetail();
  });
  els.manualPaymentForm?.addEventListener("submit", saveManualPayment);
  els.clearManualPaymentForm?.addEventListener("click", () => fillManualPaymentForm());
  els.leadEmailForm.addEventListener("submit", submitLeadEmail);
  els.leadEmailJobSelect?.addEventListener("change", (event) => {
    const contact = getSelectedContact();
    if (!contact || !contactJobs(contact).some((job) => job.id === event.target.value)) return;
    state.selectedLeadJobId = event.target.value;
    state.selectedProfitJobId = event.target.value;
    saveState({ localOnly: true });
    renderLeadDetail();
  });
  els.copyLeadEmailButton.addEventListener("click", copyLeadEmail);
  els.uploadCompanyDocumentButton.addEventListener("click", () => {
    if (!requireAction("manageDocuments")) return;
    els.companyDocumentInput.value = "";
    els.companyDocumentInput.click();
  });
  els.companyDocumentInput.addEventListener("change", async (event) => {
    const files = [...(event.target.files || [])];
    try {
      await uploadCompanyDocuments(files);
    } catch (error) {
      console.warn("Company document upload failed", error);
      const message = documentUploadErrorMessage(error);
      setSaveState(els.companyDocumentUploadStatus, message, "error");
      showToast(message);
      els.uploadCompanyDocumentButton.disabled = false;
    } finally {
      event.target.value = "";
    }
  });
  els.uploadCompanyLogoButton.addEventListener("click", () => {
    if (!requireAction("manageCompany")) return;
    els.companyLogoInput.value = "";
    els.companyLogoInput.click();
  });
  els.companyLogoInput.addEventListener("change", async (event) => {
    try {
      await uploadCompanyLogo(event.target.files?.[0]);
    } catch {
      showToast("Logo upload failed");
    }
  });
  els.removeCompanyLogoButton.addEventListener("click", removeCompanyLogo);
  els.calendarTaskForm.addEventListener("submit", saveCalendarTask);

  els.calPrevMonth?.addEventListener("click", () => {
    calendarMonthOffset--;
    renderCalendarMonth();
  });
  els.calNextMonth?.addEventListener("click", () => {
    calendarMonthOffset++;
    renderCalendarMonth();
  });
  els.closeContactDialog.addEventListener("click", () => els.contactDialog.close());
  els.contactForm.addEventListener("submit", saveContactFromForm);
  els.deleteContactButton.addEventListener("click", () => {
    if (!requireAction("manageContacts")) return;
    const id = els.contactForm.elements.id.value;
    if (id) deleteContact(id);
  });
  els.estimateFromContactButton.addEventListener("click", async () => {
    if (!requireAction("manageEstimates")) return;
    const id = els.contactForm.elements.id.value;
    if (id) {
      els.contactDialog.close();
      await createEstimate(id);
    }
  });

  els.estimateList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-estimate-id]");
    if (button) {
      setSelectedEstimate(button.dataset.estimateId);
      els.estimateHistoryPanel?.classList.add("hidden");
      els.toggleEstimateHistoryButton?.setAttribute("aria-expanded", "false");
    }
  });

  els.leadStageFilter?.addEventListener("change", (event) => {
    state.leadStageFilter = statuses.includes(event.target.value) ? event.target.value : "";
    saveState();
    renderLeadsView();
  });

  els.toggleEstimateHistoryButton?.addEventListener("click", () => {
    const willOpen = els.estimateHistoryPanel.classList.contains("hidden");
    els.estimateHistoryPanel.classList.toggle("hidden", !willOpen);
    els.toggleEstimateHistoryButton.setAttribute("aria-expanded", String(willOpen));
    els.estimateCreatePanel?.classList.add("hidden");
    els.toggleEstimateCreateButton?.setAttribute("aria-expanded", "false");
  });

  els.toggleEstimateCreateButton?.addEventListener("click", () => {
    const willOpen = els.estimateCreatePanel.classList.contains("hidden");
    els.estimateCreatePanel.classList.toggle("hidden", !willOpen);
    els.toggleEstimateCreateButton.setAttribute("aria-expanded", String(willOpen));
    els.estimateHistoryPanel?.classList.add("hidden");
    els.toggleEstimateHistoryButton?.setAttribute("aria-expanded", "false");
  });

  els.newEstimateContact?.addEventListener("change", (event) => {
    const contact = getContact(event.target.value);
    state.newEstimateContactId = contact?.id || "";
    state.newEstimateJobId = primaryJob(contact)?.id || "";
    saveState();
    renderNewEstimatePickers();
  });
  els.newEstimateJob?.addEventListener("change", (event) => {
    state.newEstimateJobId = event.target.value;
    saveState();
  });
  els.newEstimateButton.addEventListener("click", async () => {
    if (!requireAction("manageEstimates")) return;
    const estimate = await createEstimate(els.newEstimateContact?.value, true, els.newEstimateJob?.value);
    if (estimate) {
      els.estimateCreatePanel?.classList.add("hidden");
      els.toggleEstimateCreateButton?.setAttribute("aria-expanded", "false");
    }
  });
  els.addLineItemButton.addEventListener("click", () => {
    if (!requireAction("manageEstimates")) return;
    const estimate = getSelectedEstimate();
    if (!estimate) return;
    const index = estimate.items.length;
    estimate.items.push({ title: "", description: "", quantity: 1, unit: "ea", rate: 0 });
    queueLocalStateSave();
    appendEstimateLineItem(estimate, index);
    queueEstimateVerifiedSave(estimate.id);
    scheduleEstimateVisualRefresh(estimate.id);
  });

  els.lineItemTemplatesButton?.addEventListener("click", () => {
    if (!requireAction("manageEstimates")) return;
    const picker = els.templatePicker;
    if (!picker) return;
    const isOpen = !picker.classList.contains("hidden");
    if (isOpen) { picker.classList.add("hidden"); return; }
    picker.innerHTML = estimateTemplates.map((tpl, i) => `
      <button class="template-chip" type="button" data-template-index="${i}">
        <span aria-hidden="true" data-icon="template"></span>
        ${escapeHtml(tpl.name)}
      </button>
    `).join("");
    hydrateIcons(picker);
    picker.classList.remove("hidden");
  });

  els.templatePicker?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-template-index]");
    if (!btn) return;
    if (!requireAction("manageEstimates")) return;
    const estimate = getSelectedEstimate();
    if (!estimate) return;
    const tpl = estimateTemplates[Number(btn.dataset.templateIndex)];
    if (!tpl) return;
    estimate.items = [...estimate.items, ...tpl.items.map((item) => ({ ...item }))];
    queueLocalStateSave();
    renderEstimateLineItems(estimate);
    queueEstimateVerifiedSave(estimate.id);
    scheduleEstimateVisualRefresh(estimate.id);
    els.templatePicker.classList.add("hidden");
    showToast(`${tpl.name} template added`);
  });

  els.estimateForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!requireAction("manageEstimates")) return;
    void saveCurrentEstimateAndPdf();
  });
  // Keep the primary save action deterministic even when another enhancement
  // intercepts the form's native submit event. Keyboard submits still use the
  // form handler above; button clicks use this direct path exactly once.
  els.saveEstimateButton?.addEventListener("click", (event) => {
    event.preventDefault();
    if (!requireAction("manageEstimates")) return;
    void saveCurrentEstimateAndPdf();
  });

  els.estimateForm.addEventListener("input", (event) => {
    if (!canAction("manageEstimates")) return;
    if (event.target.matches("select")) return;
    if (event.target.matches("[data-line-field]")) {
      updateLineItem(event.target);
      return;
    }
    if (event.target.name) updateSelectedEstimateFromField(event.target.name, event.target.value);
  });

  els.estimateForm.addEventListener("change", (event) => {
    if (!canAction("manageEstimates")) return;
    if (event.target.matches("select") && event.target.name) {
      updateSelectedEstimateFromField(event.target.name, event.target.value);
      if (["contactId", "jobId"].includes(event.target.name)) {
        renderEstimates();
      } else {
        const estimate = getSelectedEstimate();
        renderEstimateActiveSummary(estimate);
        renderEstimatePreview(estimate);
        renderSummary();
      }
    }
  });

  els.deleteEstimateButton.addEventListener("click", deleteEstimate);
  els.copyEstimateButton.addEventListener("click", copyEstimate);
  els.printEstimateButton.addEventListener("click", printEstimate);
  els.sendEstimateButton.addEventListener("click", sendEstimate);
  window.addEventListener("pagehide", flushQueuedLocalStateSave);
  window.addEventListener("beforeunload", (event) => {
    flushQueuedLocalStateSave();
    if (window.RooflineAuth.isEditorSessionCurrent() && (state.companyFormDraft || (canUseCloudSync() && durableRecordsReady && (durableWriteBlocked || durableSaveInFlight || cloudSaveInFlight || hasPendingDurableChanges() || hasPendingCompanyChanges())))) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  els.companyForm.addEventListener("submit", saveCompany);
  els.companyForm.addEventListener("input", trackCompanyFormDraft);
  els.companyForm.addEventListener("change", trackCompanyFormDraft);
  els.documentCategoryCreateForm?.addEventListener("submit", createDocumentCategory);
  let draggedDocumentCategoryId = "";
  els.documentCategoriesList?.addEventListener("dragstart", (event) => {
    if (!canAction("manageCompany")) return;
    const row = event.target.closest("[data-category-id]");
    if (!row) return;
    draggedDocumentCategoryId = row.dataset.categoryId;
    row.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedDocumentCategoryId);
  });
  els.documentCategoriesList?.addEventListener("dragover", (event) => {
    if (!draggedDocumentCategoryId) return;
    const row = event.target.closest("[data-category-id]");
    if (!row || row.dataset.categoryId === draggedDocumentCategoryId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  });
  els.documentCategoriesList?.addEventListener("drop", (event) => {
    const row = event.target.closest("[data-category-id]");
    if (!row || !draggedDocumentCategoryId) return;
    event.preventDefault();
    reorderDocumentCategory(draggedDocumentCategoryId, row.dataset.categoryId);
    draggedDocumentCategoryId = "";
  });
  els.documentCategoriesList?.addEventListener("dragend", () => {
    els.documentCategoriesList.querySelectorAll(".is-dragging").forEach((row) => row.classList.remove("is-dragging"));
    draggedDocumentCategoryId = "";
  });

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    els.installAppButton.classList.remove("hidden");
  });

  els.installAppButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    els.installAppButton.classList.add("hidden");
  });

}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    if (["localhost", "127.0.0.1"].includes(location.hostname)) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      return;
    }
    await navigator.serviceWorker.register("sw.js");
  } catch {
    console.info("Service worker registration failed");
  }
}

async function purgeLegacyJobCrestCaches() {
  if (!("caches" in window)) return;
  try {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => {
          if (!key.startsWith("jobcrest-crm-")) return false;
          if (["localhost", "127.0.0.1"].includes(location.hostname)) return true;
          const version = Number(key.match(/^jobcrest-crm-v(\d+)$/)?.[1] || Number.POSITIVE_INFINITY);
          return version <= 103;
        })
        .map((key) => caches.delete(key)),
    );
  } catch (error) {
    console.warn("Legacy JobCrest caches could not be cleared", error);
  }
}

const SIGN_IN_UNLOCK_KEY = "jobcrest.crm.sign-in-unlock";

async function playSignInUnlockTransition() {
  const root = document.documentElement;
  if (!root.classList.contains("vault-entry-pending")) return;

  try {
    sessionStorage.removeItem(SIGN_IN_UNLOCK_KEY);
  } catch {
    // Removing the marker is optional when browser storage is unavailable.
  }

  const overlay = document.querySelector("#vaultUnlock");
  if (!overlay) {
    root.classList.remove("vault-entry-pending");
    return;
  }

  overlay.setAttribute("aria-hidden", "false");
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  overlay.classList.add("is-active");

  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  await new Promise((resolve) => window.setTimeout(resolve, reducedMotion ? 500 : 2850));

  root.classList.add("vault-entry-revealing");
  overlay.classList.add("is-complete");
  await new Promise((resolve) => window.setTimeout(resolve, reducedMotion ? 120 : 450));

  root.classList.remove("vault-entry-pending", "vault-entry-revealing");
  overlay.classList.remove("is-active", "is-complete");
  overlay.setAttribute("aria-hidden", "true");
}

function showStartupDataError() {
  document.documentElement.classList.remove("vault-entry-pending");
  const panel = document.createElement("main");
  panel.setAttribute("role", "alert");
  panel.style.cssText = "position:fixed;inset:0;z-index:100000;background:#f7f9fc;color:#17243a;display:grid;place-content:center;gap:16px;padding:32px;text-align:center";
  const title = document.createElement("h1");
  title.textContent = "Shared CRM data could not be loaded";
  const message = document.createElement("p");
  message.textContent = "No records were deleted. Editing is paused so an old device copy cannot replace shared information. Check your connection and try again.";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Try loading again";
  retry.addEventListener("click", () => location.reload());
  panel.append(title, message, retry);
  document.body.appendChild(panel);
}

function pauseForSessionChange() {
  checkpointPendingDraft();
  durableWriteBlocked = true;
  durableWritesEnabled = false;
  cloudReady = false;
  window.clearTimeout(durableSaveTimer);
  window.clearTimeout(durableReloadTimer);
  window.clearTimeout(cloudSaveTimer);
  window.clearInterval(squarePollInterval);
  estimateSaveTimers.forEach(timer => window.clearTimeout(timer));
  // Retain recovery copies under the original user, never a newly signed-in
  // identity. Do not expose an old user's draft download on the signed-out view.
  document.querySelectorAll("body > *").forEach(element => {
    if (!["SCRIPT", "STYLE"].includes(element.tagName)) { element.inert = true; element.hidden = true; }
  });
  const panel = document.createElement("main");
  panel.setAttribute("role", "alert");
  panel.style.cssText = "position:fixed;inset:0;z-index:100010;background:#f7f9fc;color:#17243a;display:grid;place-content:center;gap:16px;padding:32px;text-align:center";
  const title = document.createElement("h1");
  title.textContent = "Your CRM session changed";
  const message = document.createElement("p");
  message.textContent = "This tab has stopped saving because you signed out, changed accounts, or your access changed. Sign in again to load shared records and review any recovery copy for your account.";
  const login = document.createElement("a");
  login.href = "/login?reason=session-changed";
  login.textContent = "Return to sign in";
  panel.append(title, message, login);
  document.body.appendChild(panel);
}

async function startApp() {
  if (!window.RooflineAuth) {
    location.replace("/login?reason=auth-loader");
    return;
  }

  authSession = await window.RooflineAuth.requireAuth();
  if (!authSession) return;
  authSession = await promoteSignedInSession();
  window.addEventListener("jobcrest:session-invalidated", pauseForSessionChange, { once: true });
  window.RooflineAuth.bindEditorSession(authSession.user);

  // Discover earlier drafts BEFORE replacing the disposable business cache.
  // Each page owns a separate slot so simultaneous tabs cannot erase drafts.
  if (canUseCloudSync() && authSession?.user?.id) {
    let recoveryStorage;
    try { recoveryStorage = localStorage; } catch { /* Browser may deny storage. */ }
    draftRecoveryStore = window.CrmDraftRecovery.create({ storage: recoveryStorage, companyId: supabaseStateId(), userId: authSession.user.id, sessionId: crypto.randomUUID() });
    const earlier = draftRecoveryStore.list();
    showPreviousDraftRecovery(earlier.entries);
    if (!earlier.available) showDraftStorageWarning();
  }
  state = loadState(activeStorageKey());
  state.currentUser = currentUserFromAuthSession(authSession);
  if (canUseCloudSync() && authSession?.user?.id) {
    // Local storage is only an offline cache. Starting an authenticated cloud
    // session with cached business records can resurrect an older job/cost
    // version before Supabase finishes loading, so hydrate these collections
    // exclusively from the durable per-record tables below.
    state.contacts = [];
    state.estimates = [];
    state.calendarTasks = [];
    state.companyDocuments = [];
    // Older unsubmitted settings remain in the recovery export, never replayed
    // against a fresh server version without review.
    state.companyFormDraft = null;
  }
  saveState({ localOnly: true });
  // Durable per-record rows are authoritative for leads, jobs, costs, notes,
  // estimates, and tasks. Never let the older JSON snapshot roll them back
  // while the durable rows are loading during startup.
  durableBusinessStateAuthoritative = true;
  await purgeLegacyJobCrestCaches();
  await initializeCloudSync();
  await initializeDurableRecords();
  if (canUseCloudSync() && !durableRecordsReady) {
    showStartupDataError();
    return;
  }
  if (canUseCloudSync()) {
    try { await ensureExistingSharedSalesNumbers(); }
    catch (error) { console.warn("Shared sales numbering is unavailable", error); showStartupDataError(); return; }
  } else if (ensureExistingSalesNumbers()) saveState();
  void migrateInlineDocumentsToStorage();
  hydrateIcons();
  bindEvents();
  render();
  // Add-on modules can finish downloading long before durable CRM records have
  // hydrated. Give them a deterministic startup signal instead of making them
  // guess when the core application is ready from a short polling window.
  window.dispatchEvent(new CustomEvent("jobcrest:app-ready"));
  durableWritesEnabled = durableRecordsReady;
  if (durableWritesEnabled) queueDurableRecordsSave();
  await playSignInUnlockTransition();
  startSquarePoll();
  registerServiceWorker();
}

startApp();
