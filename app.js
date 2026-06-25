const STORAGE_KEY = "roofline-crm-v1";
const SUPABASE_CRM_TABLE = "crm_state";
const CLOUD_SAVE_DELAY = 700;
const COMPANY_STATE_SUFFIX = "company";

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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const statuses = ["New", "Contacted", "Inspection", "Estimate Sent", "Won", "Lost"];
const leaderboardRanges = {
  week: "This Week",
  month: "This Month",
  ytd: "Year to Date",
};

const rolePolicies = {
  admin: {
    views: "all",
    actions: "all",
  },
  office_manager: {
    views: [
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
      "company",
    ],
    actions: [
      "manageContacts",
      "manageJobs",
      "manageEstimates",
      "manageDocuments",
      "manageTasks",
      "manageCompany",
      "sendEmail",
    ],
  },
  sales_manager: {
    views: [
      "dashboard",
      "leads",
      "contacts",
      "jobs",
      "leadDetail",
      "estimates",
      "companyDocuments",
      "calendar",
      "tasks",
      "invoices",
      "reviews",
      "reports",
    ],
    actions: ["manageContacts", "manageJobs", "manageEstimates", "manageDocuments", "manageTasks", "sendEmail"],
  },
  operations_manager: {
    views: [
      "dashboard",
      "contacts",
      "jobs",
      "leadDetail",
      "companyDocuments",
      "projects",
      "calendar",
      "tasks",
      "invoices",
      "reviews",
      "reports",
    ],
    actions: ["manageJobs", "manageDocuments", "manageTasks", "sendEmail"],
  },
  sales: {
    views: [
      "dashboard",
      "leads",
      "contacts",
      "jobs",
      "leadDetail",
      "estimates",
      "companyDocuments",
      "calendar",
      "tasks",
      "reviews",
      "reports",
    ],
    actions: ["manageContacts", "manageJobs", "manageEstimates", "manageDocuments", "manageTasks", "sendEmail"],
  },
  production: {
    views: ["dashboard", "jobs", "projects", "leadDetail", "companyDocuments", "calendar", "tasks", "reports"],
    actions: ["manageJobs", "manageDocuments", "manageTasks", "sendEmail"],
  },
  viewer: {
    views: [
      "dashboard",
      "leads",
      "contacts",
      "jobs",
      "projects",
      "leadDetail",
      "estimates",
      "companyDocuments",
      "calendar",
      "tasks",
      "reports",
    ],
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
  defaultTerms:
    "This estimate is valid through the date shown above. Scope may change if concealed damage is discovered after work begins. Customer approval is required before materials are ordered.",
};

const defaultCurrentUser = {
  name: "CRM User",
  email: "",
  role: "viewer",
};

const privilegedFinancialEmails = ["gil@coastalcrestroofing.com", "devon@coastalcrestroofing.com"];

const costCategories = ["Materials", "Labor", "Subcontractor", "Permits", "Dump Fees", "Equipment", "Other"];

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

const assistantSuggestions = [
  "What is 1500 x 25?",
  "Create a detailed tear off process for shingle roofs",
  "Find lead Aakritie",
  "Open company documents",
];

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
  leaderboardRange: "month",
  leadDetailTab: "overview",
  selectedContactId: "contact_1002",
  selectedEstimateId: "estimate_2001",
  newEstimateContactId: "",
  newEstimateJobId: "",
  selectedProfitJobId: "",
  assistantOpen: false,
  assistantMessages: [],
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
let lastCloudSnapshot = "";
let cloudSubscription = null;
let applyingCloudState = false;
let cloudKnownOwners = new Map();

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
  installAppButton: document.querySelector("#installAppButton"),
  importZohoButton: document.querySelector("#importZohoButton"),
  zohoCsvInput: document.querySelector("#zohoCsvInput"),
  addContactButton: document.querySelector("#addContactButton"),
  addLeadFromLeadsButton: document.querySelector("#addLeadFromLeadsButton"),
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
  clearJobFormButton: document.querySelector("#clearJobFormButton"),
  leadJobsList: document.querySelector("#leadJobsList"),
  leadProfitPanel: document.querySelector("#leadProfitPanel"),
  profitJobSelect: document.querySelector("#profitJobSelect"),
  profitSummary: document.querySelector("#profitSummary"),
  profitCostForm: document.querySelector("#profitCostForm"),
  clearProfitCostForm: document.querySelector("#clearProfitCostForm"),
  profitCostList: document.querySelector("#profitCostList"),
  leadEmailPanel: document.querySelector("#leadEmailPanel"),
  leadEmailForm: document.querySelector("#leadEmailForm"),
  copyLeadEmailButton: document.querySelector("#copyLeadEmailButton"),
  leadDocumentsPanel: document.querySelector("#leadDocumentsPanel"),
  leadDocumentsList: document.querySelector("#leadDocumentsList"),
  uploadLeadDocumentButton: document.querySelector("#uploadLeadDocumentButton"),
  leadDocumentInput: document.querySelector("#leadDocumentInput"),
  leadConversationPanel: document.querySelector("#leadConversationPanel"),
  leadConversationForm: document.querySelector("#leadConversationForm"),
  leadConversationList: document.querySelector("#leadConversationList"),
  contactDialog: document.querySelector("#contactDialog"),
  contactForm: document.querySelector("#contactForm"),
  contactDialogTitle: document.querySelector("#contactDialogTitle"),
  deleteContactButton: document.querySelector("#deleteContactButton"),
  estimateFromContactButton: document.querySelector("#estimateFromContactButton"),
  closeContactDialog: document.querySelector("#closeContactDialog"),
  estimateList: document.querySelector("#estimateList"),
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
  companyDocumentsList: document.querySelector("#companyDocumentsList"),
  calendarTaskForm: document.querySelector("#calendarTaskForm"),
  salesRepOptions: document.querySelector("#salesRepOptions"),
  calendarTaskContact: document.querySelector("#calendarTaskContact"),
  calendarTasksList: document.querySelector("#calendarTasksList"),
  companyForm: document.querySelector("#companyForm"),
  companyLogoInput: document.querySelector("#companyLogoInput"),
  uploadCompanyLogoButton: document.querySelector("#uploadCompanyLogoButton"),
  removeCompanyLogoButton: document.querySelector("#removeCompanyLogoButton"),
  companyLogoPreview: document.querySelector("#companyLogoPreview"),
  aiAssistant: document.querySelector("#aiAssistant"),
  aiToggle: document.querySelector("#aiToggle"),
  aiPanel: document.querySelector("#aiPanel"),
  aiClear: document.querySelector("#aiClear"),
  aiSuggestions: document.querySelector("#aiSuggestions"),
  aiMessages: document.querySelector("#aiMessages"),
  aiForm: document.querySelector("#aiForm"),
  aiInput: document.querySelector("#aiInput"),
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
  const contacts = (nextState.contacts || []).map(normalizeContact);
  return {
    ...nextState,
    leaderboardRange: nextState.leaderboardRange || "month",
    leadDetailTab: nextState.leadDetailTab || "overview",
    newEstimateContactId: nextState.newEstimateContactId || "",
    newEstimateJobId: nextState.newEstimateJobId || "",
    selectedProfitJobId: nextState.selectedProfitJobId || "",
    assistantOpen: Boolean(nextState.assistantOpen),
    assistantMessages: (nextState.assistantMessages || []).slice(-12).map(normalizeAssistantMessage),
    company: normalizeCompany(nextState.company),
    currentUser: { ...defaultCurrentUser, ...(nextState.currentUser || {}) },
    contacts,
    companyDocuments: (nextState.companyDocuments || []).map(normalizeDocument),
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
  };
}

function normalizeContact(contact) {
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
    documents: (contact.documents || []).map(normalizeDocument),
    updates: (contact.updates || contact.activity || []).map(normalizeUpdate),
  };
  const jobs = contact.jobs?.length
    ? contact.jobs.map((job) => normalizeJob(job, baseContact))
    : [normalizeJob({}, baseContact)];
  return {
    ...baseContact,
    jobs,
  };
}

function normalizeJob(job, contact = {}) {
  const status = job.status || contact.status || "New";
  const closedDate =
    job.closedDate || (status === "Won" ? contact.closedDate || contact.lastContact || todayISO() : "");
  return {
    id: job.id || uid("job"),
    name: job.name || job.title || `${contact.name || "Client"} Job`,
    address: job.address || contact.address || "",
    status,
    value: number(job.value ?? contact.value),
    ownerUserId: job.ownerUserId || contact.ownerUserId || "",
    ownerEmail: job.ownerEmail || contact.ownerEmail || "",
    ownerName: job.ownerName || contact.ownerName || "",
    salesRep: job.salesRep || contact.salesRep || "Unassigned",
    lastContact: job.lastContact || contact.lastContact || todayISO(),
    closedDate,
    notes: job.notes || "",
    costItems: (job.costItems || job.costs || []).map(normalizeCostItem),
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

function normalizeAssistantMessage(message = {}) {
  return {
    id: message.id || uid("chat"),
    role: message.role === "user" ? "user" : "assistant",
    text: String(message.text || "").slice(0, 4000),
    createdAt: message.createdAt || new Date().toISOString(),
  };
}

function normalizeDocument(document) {
  return {
    id: document.id || uid("doc"),
    name: document.name || "Document",
    category: document.category || "Other",
    type: document.type || "application/octet-stream",
    size: number(document.size),
    dataUrl: document.dataUrl || "",
    uploadedAt: document.uploadedAt || new Date().toISOString(),
    uploadedBy: document.uploadedBy || "Local user",
    source: document.source || "",
    estimateId: document.estimateId || "",
    contactId: document.contactId || "",
    jobId: document.jobId || "",
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
    createdAt: update.createdAt || new Date().toISOString(),
  };
}

function normalizeEstimate(estimate, contacts = []) {
  const contact = contacts.find((item) => item.id === estimate.contactId);
  const jobs = contact ? contactJobs(contact) : [];
  const job = jobs.find((item) => item.id === estimate.jobId) || jobs[0];
  return {
    ...estimate,
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
  };
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

function saveState(options = {}) {
  localStorage.setItem(activeStorageKey(), JSON.stringify(state));
  if (!options.localOnly && !applyingCloudState) queueCloudSave();
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
    companyDocuments: state.companyDocuments,
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

function mergeCloudRows(rows = []) {
  const companyRow = rows.find(isCompanyCloudRow);
  const fallbackCompanyRow = rows.find((row) => row.data?.company || row.data?.companyDocuments);
  const companyData = companyRow?.data || fallbackCompanyRow?.data || {};
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

  applySharedState({
    company: companyData.company || state.company,
    companyDocuments: companyData.companyDocuments || state.companyDocuments,
    contacts: [...contactMap.values()],
    estimates: [...estimateMap.values()],
    calendarTasks: [...taskMap.values()],
  });
  ensureStateOwnership();
}

async function fetchCloudRows() {
  const selectColumns = "*";
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
  const { data, error } = await fetchCloudRows();
  if (error) {
    console.warn("Supabase CRM state could not be loaded", error);
    showToast("Supabase is connected, but the CRM table needs the latest setup.");
    return false;
  }

  mergeCloudRows(data || []);
  lastCloudSnapshot = sharedStateSnapshot();
  saveState({ localOnly: true });
  if (showUpdateToast) showToast("CRM updated from Supabase");
  return true;
}

function queueCloudSave() {
  if (!cloudReady || !cloudClient || !authSession?.user?.id) return;
  const snapshot = sharedStateSnapshot();
  if (snapshot === lastCloudSnapshot) return;
  window.clearTimeout(cloudSaveTimer);
  cloudSaveTimer = window.setTimeout(flushCloudSave, CLOUD_SAVE_DELAY);
}

async function flushCloudSave() {
  if (!cloudReady || !cloudClient || !authSession?.user?.id || cloudSaveInFlight) return;
  const rows = cloudRowsForSave();
  const snapshot = sharedStateSnapshot();
  if (snapshot === lastCloudSnapshot) return;

  cloudSaveInFlight = true;
  const { error } = await cloudClient.from(SUPABASE_CRM_TABLE).upsert(rows, { onConflict: "id" });
  cloudSaveInFlight = false;

  if (error) {
    console.warn("Supabase CRM sync failed", error);
    showToast("Supabase sync failed. Local changes are still saved.");
    return;
  }

  lastCloudSnapshot = snapshot;
  if (sharedStateSnapshot() !== lastCloudSnapshot) queueCloudSave();
}

async function promoteSignedInSession() {
  if (!window.RooflineAuth?.hasConfig()) return authSession;
  const trusted = await window.RooflineAuth.getTrustedUser();
  if (!trusted.user || !window.RooflineAuth.isAllowedEmail(trusted.user.email)) return authSession;
  return trusted;
}

async function initializeCloudSync() {
  if (!canUseCloudSync()) return;
  cloudClient = window.RooflineAuth.createClient();
  if (!cloudClient) return;

  const trusted = await window.RooflineAuth.getTrustedUser();
  if (!trusted.user || !window.RooflineAuth.isAllowedEmail(trusted.user.email)) {
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
        if (!isRelevantCloudRow(row) || row?.updated_by === authSession?.user?.id) return;
        applyingCloudState = true;
        await reloadCloudState({ showUpdateToast: true });
        applyingCloudState = false;
        render();
      },
    )
    .subscribe();
}

function currentRole() {
  return window.RooflineAuth?.normalizeRole(authSession?.role || state.currentUser.role) || "viewer";
}

function canManageTeamData() {
  return ["admin", "office_manager", "sales_manager", "operations_manager"].includes(currentRole());
}

function currentUserEmail() {
  return String(authSession?.user?.email || state.currentUser.email || "").toLowerCase();
}

function canManageJobFinancials() {
  return currentRole() === "admin" || privilegedFinancialEmails.includes(currentUserEmail());
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

function openLeadDetail(contactId, tab = "overview") {
  if (!canView("leadDetail")) {
    showToast(`Your ${roleLabel()} role cannot open client records`);
    return;
  }
  state.selectedContactId = contactId;
  state.leadDetailTab = tab;
  state.view = "leadDetail";
  saveState();
  render();
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
  return getContact(estimate?.contactId) || state.contacts[0];
}

function getEstimateJob(estimate) {
  const contact = getEstimateContact(estimate);
  const jobs = contactJobs(contact);
  return jobs.find((job) => job.id === estimate?.jobId) || jobs[0];
}

function filteredContacts() {
  const query = state.search.trim().toLowerCase();
  if (!query) return state.contacts;
  return state.contacts.filter((contact) =>
    [
      contact.name,
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
  const subtotal = estimate.items.reduce(
    (sum, item) => sum + number(item.quantity) * number(item.rate),
    0,
  );
  const tax = subtotal * (number(estimate.taxRate) / 100);
  const total = subtotal + tax;
  const balance = Math.max(total - number(estimate.deposit), 0);
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
    ["Sent", "Approved"].includes(estimate.status),
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

function addContactUpdate(contactId, { author = "Local user", message, status = "" }) {
  if (!message?.trim() && !status) return null;
  return updateContact(contactId, (contact) => ({
    ...contact,
    updates: [
      {
        id: uid("update"),
        author: author.trim() || "Local user",
        message: message?.trim() || "",
        status,
        createdAt: new Date().toISOString(),
      },
      ...(contact.updates || []),
    ],
  }));
}

function applyStatusUpdate(contactId, nextStatus, author = "Local user", message = "") {
  const contact = getContact(contactId);
  if (!contact || !nextStatus || contact.status === nextStatus) return contact;
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
          message: message || `Status changed from ${wasStatus} to ${nextStatus}.`,
          createdAt: new Date().toISOString(),
        },
        ...(current.updates || []),
      ],
    };
  });
}

function assistantWelcomeMessage() {
  return {
    id: "assistant_welcome",
    role: "assistant",
    text:
      "Ask me real questions, have me draft roofing or sales language, or use me to open CRM sections and find records.",
    createdAt: new Date().toISOString(),
  };
}

function assistantMessages() {
  return state.assistantMessages.length ? state.assistantMessages : [assistantWelcomeMessage()];
}

function addAssistantMessage(role, text) {
  state.assistantMessages = [
    ...state.assistantMessages,
    normalizeAssistantMessage({
      role,
      text,
      createdAt: new Date().toISOString(),
    }),
  ].slice(-12);
}

function assistantCleanQuery(prompt) {
  return String(prompt || "")
    .replace(/\b(take me to|go to|open|show|find|search for|search|look up|locate)\b/gi, " ")
    .replace(/\b(the|a|an|lead|leads|client|clients|customer|customers|job|jobs|document|documents|file|files|estimate|estimates|specific)\b/gi, " ")
    .replace(/[^\w\s@.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textIncludesAll(text, terms) {
  const normalized = String(text || "").toLowerCase();
  return terms.every((term) => normalized.includes(term));
}

function contactSearchText(contact) {
  return [
    contact.name,
    contact.email,
    contact.phone,
    contact.type,
    contact.status,
    contact.source,
    contact.salesRep,
    contact.address,
    contact.notes,
    ...contactJobs(contact).flatMap((job) => [job.name, job.address, job.status, job.salesRep, job.notes]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function findContactsByPrompt(prompt) {
  const query = assistantCleanQuery(prompt).toLowerCase();
  if (!query) return [];
  const terms = query.split(/\s+/).filter((term) => term.length > 1);
  return state.contacts.filter((contact) => textIncludesAll(contactSearchText(contact), terms));
}

function findJobByPrompt(prompt) {
  const query = assistantCleanQuery(prompt).toLowerCase();
  if (!query) return null;
  const terms = query.split(/\s+/).filter((term) => term.length > 1);
  return allJobs().find((job) =>
    textIncludesAll([job.name, job.address, job.status, job.salesRep, job.contactName, job.notes].join(" "), terms),
  );
}

function findDocumentByPrompt(prompt) {
  const query = assistantCleanQuery(prompt).toLowerCase();
  if (!query) return null;
  const terms = query.split(/\s+/).filter((term) => term.length > 1);
  const companyDocument = state.companyDocuments.find((document) =>
    textIncludesAll([document.name, document.category, document.source].join(" "), terms),
  );
  if (companyDocument) return { type: "company", document: companyDocument };

  for (const contact of state.contacts) {
    const document = (contact.documents || []).find((item) =>
      textIncludesAll([item.name, item.category, item.source].join(" "), terms),
    );
    if (document) return { type: "lead", contact, document };
  }
  return null;
}

function findEstimateByPrompt(prompt) {
  const query = assistantCleanQuery(prompt).toLowerCase();
  if (!query) return null;
  const terms = query.split(/\s+/).filter((term) => term.length > 1);
  return state.estimates.find((estimate) => {
    const contact = getEstimateContact(estimate);
    return textIncludesAll([estimate.estimateNumber, estimate.projectTitle, estimate.status, contact?.name].join(" "), terms);
  });
}

function roofingTearOffDraft() {
  return `Tear Off Process for Shingle Roofs

Our tear off process begins with protecting the property before any roofing material is removed. The crew stages tarps, protects landscaping, covers vulnerable areas, and establishes a controlled debris path so the work area stays organized and safe.

Once protection is in place, the existing shingles are removed down to the roof decking. This includes stripping shingles, starter courses, hip and ridge caps, old underlayment, drip edge where required, pipe boot flashings, and other worn roof accessories that need replacement. Debris is moved directly into the designated disposal area to keep the job site clean throughout the day.

After the roof is opened, the decking is inspected carefully for soft, rotted, delaminated, or damaged sheathing. Any compromised decking is documented and replaced as needed so the new roofing system has a solid, code-compliant surface to attach to.

The crew then prepares the roof for installation by sweeping the deck, removing loose fasteners, checking roof penetrations, and making sure valleys, eaves, rakes, and wall transitions are ready for the new system. Ice and water shield, synthetic underlayment, drip edge, starter shingles, flashing components, ventilation, and architectural shingles can then be installed according to manufacturer specifications.

At completion, the crew performs a full cleanup that includes removing debris, blowing off work areas, cleaning gutters when applicable, and using magnetic rollers to collect loose nails around the property. The goal is to leave the property protected, clean, and ready for final inspection.`;
}

function genericRoofingDraft(prompt) {
  if (/tear\s*off|remove|removal/i.test(prompt) && /shingle|roof/i.test(prompt)) return roofingTearOffDraft();
  return `Roofing Scope Explanation

This work includes a professional review of the existing roof condition, preparation of the work area, protection of surrounding property, and completion of the roofing scope using materials and installation practices appropriate for the project. The crew will document visible concerns, communicate any concealed damage discovered during production, and maintain a clean job site throughout the work.

The final scope should identify the roofing system being installed, the areas included, the materials required, any ventilation or flashing work, and any exclusions or conditions that may affect pricing. Once the work is complete, the crew should perform cleanup, remove project debris, and complete a final quality review before closing the job.`;
}

function assistantViewFromPrompt(prompt) {
  const lower = prompt.toLowerCase();
  const matches = [
    ["dashboard", ["dashboard", "home"]],
    ["leads", ["leads"]],
    ["contacts", ["contacts", "clients", "customers"]],
    ["jobs", ["jobs", "projects list"]],
    ["projects", ["projects", "production"]],
    ["estimates", ["estimates", "estimate center"]],
    ["companyDocuments", ["company documents", "documents", "samples", "contracts"]],
    ["calendar", ["calendar", "schedule"]],
    ["tasks", ["tasks", "reminders"]],
    ["reports", ["reports", "leaderboard"]],
    ["company", ["settings", "company settings"]],
  ];
  return matches.find(([, aliases]) => aliases.some((alias) => lower.includes(alias)))?.[0] || "";
}

function assistantViewLabel(view) {
  return (
    {
      dashboard: "Dashboard",
      leads: "Leads",
      contacts: "Contacts",
      jobs: "Jobs",
      projects: "Projects",
      estimates: "Estimates",
      companyDocuments: "Company Documents",
      calendar: "Calendar",
      tasks: "Tasks",
      reports: "Reports",
      company: "Settings",
    }[view] || "that section"
  );
}

function normalizeMathExpression(prompt) {
  const normalized = String(prompt || "")
    .toLowerCase()
    .replaceAll(",", "")
    .replace(/\$/g, "")
    .replace(/\b(what is|what's|calculate|solve|how much is|answer|equals|equal to)\b/g, " ")
    .replace(/\bmultiplied by\b/g, "*")
    .replace(/\btimes\b/g, "*")
    .replace(/\bdivided by\b/g, "/")
    .replace(/\bover\b/g, "/")
    .replace(/\bplus\b/g, "+")
    .replace(/\bminus\b/g, "-")
    .replace(/(\d)\s*\u00d7\s*(\d)/g, "$1*$2")
    .replace(/(\d)\s*[x×]\s*(\d)/g, "$1*$2");
  const candidates = normalized.match(/[0-9+\-*/().\s]+/g) || [];
  return candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => /\d/.test(candidate) && /[+\-*/]/.test(candidate))
    .sort((a, b) => b.length - a.length)[0] || "";
}

function evaluateMathExpression(expression) {
  const text = String(expression || "").replace(/\s+/g, "");
  if (!text || text.length > 100 || /[^0-9+\-*/().]/.test(text)) return null;
  let index = 0;

  const parseNumber = () => {
    const match = text.slice(index).match(/^\d*\.?\d+/);
    if (!match) return null;
    index += match[0].length;
    return Number(match[0]);
  };

  const parseFactor = () => {
    if (text[index] === "+") {
      index += 1;
      return parseFactor();
    }
    if (text[index] === "-") {
      index += 1;
      const value = parseFactor();
      return value === null ? null : -value;
    }
    if (text[index] === "(") {
      index += 1;
      const value = parseExpression();
      if (text[index] !== ")") return null;
      index += 1;
      return value;
    }
    return parseNumber();
  };

  const parseTerm = () => {
    let value = parseFactor();
    if (value === null) return null;
    while (text[index] === "*" || text[index] === "/") {
      const operator = text[index];
      index += 1;
      const next = parseFactor();
      if (next === null) return null;
      value = operator === "*" ? value * next : value / next;
    }
    return value;
  };

  var parseExpression = () => {
    let value = parseTerm();
    if (value === null) return null;
    while (text[index] === "+" || text[index] === "-") {
      const operator = text[index];
      index += 1;
      const next = parseTerm();
      if (next === null) return null;
      value = operator === "+" ? value + next : value - next;
    }
    return value;
  };

  const result = parseExpression();
  if (index !== text.length || !Number.isFinite(result)) return null;
  return result;
}

function formatMathNumber(value) {
  const rounded = Math.abs(value) < 1e-10 ? 0 : value;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Number.isInteger(rounded) ? 0 : 4,
  }).format(rounded);
}

function assistantMathAnswer(prompt) {
  const expression = normalizeMathExpression(prompt);
  if (!expression) return "";
  const result = evaluateMathExpression(expression);
  if (result === null) return "";
  return `${expression.replaceAll("*", " x ")} = ${formatMathNumber(result)}`;
}

function assistantRuntimeContext() {
  return {
    companyName: state.company?.name || "",
    currentView: assistantViewLabel(state.view),
    userRole: currentRole(),
    counts: {
      leads: state.contacts.filter((contact) => contact.type === "Lead").length,
      customers: state.contacts.filter((contact) => contact.type === "Customer").length,
      jobs: allJobs().length,
      estimates: state.estimates.length,
      companyDocuments: state.companyDocuments.length,
    },
  };
}

function assistantApiHistory() {
  return state.assistantMessages
    .slice(-8)
    .map((message) => ({
      role: message.role,
      text: message.text,
    }))
    .filter((message) => message.text);
}

async function assistantAccessToken() {
  if (authSession?.access_token) return authSession.access_token;
  if (authSession?.session?.access_token) return authSession.session.access_token;
  if (!window.RooflineAuth?.getTrustedUser) return "";

  const trusted = await window.RooflineAuth.getTrustedUser();
  if (trusted?.session?.access_token) {
    authSession = { ...authSession, ...trusted };
    return trusted.session.access_token;
  }
  return "";
}

async function assistantRealtimeAnswer(prompt) {
  try {
    const headers = { "Content-Type": "application/json" };
    const accessToken = await assistantAccessToken();
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const response = await fetch("/api/assistant", {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt,
        context: assistantRuntimeContext(),
        history: assistantApiHistory(),
      }),
    });
    const data = await response.json().catch(() => ({}));
    return (
      data.reply ||
      (response.ok
        ? "I could not generate an answer for that. Try asking it a different way."
        : "The live AI service could not answer right now. Try again in a moment.")
    );
  } catch {
    return "I could not reach the live AI service. I can still open CRM sections, find leads, and answer simple math.";
  }
}

function assistantLocalResponse(prompt) {
  const lower = prompt.toLowerCase();
  const query = assistantCleanQuery(prompt);
  const mathAnswer = assistantMathAnswer(prompt);

  if (mathAnswer) return mathAnswer;

  if (lower.includes("document") || lower.includes("file") || lower.includes("contract") || lower.includes("sample")) {
    const found = findDocumentByPrompt(prompt);
    if (found?.type === "lead") {
      state.selectedContactId = found.contact.id;
      state.leadDetailTab = "documents";
      state.view = "leadDetail";
      state.search = "";
      return `I found "${found.document.name}" under ${found.contact.name} and opened that lead's Documents tab.`;
    }
    if (found?.type === "company") {
      state.view = "companyDocuments";
      state.search = query;
      return `I found "${found.document.name}" in Company Documents and filtered the document list for you.`;
    }
  }

  if (lower.includes("estimate")) {
    const estimate = findEstimateByPrompt(prompt);
    if (estimate) {
      state.view = "estimates";
      state.selectedEstimateId = estimate.id;
      state.selectedContactId = estimate.contactId;
      state.search = "";
      return `I opened ${estimate.estimateNumber || "that estimate"} for ${getEstimateContact(estimate)?.name || "the selected client"}.`;
    }
  }

  if (lower.includes("job")) {
    const job = findJobByPrompt(prompt);
    if (job) {
      state.selectedContactId = job.contactId;
      state.selectedProfitJobId = job.id;
      state.leadDetailTab = canManageJobFinancials() && lower.includes("profit") ? "profit" : "jobs";
      state.view = "leadDetail";
      state.search = "";
      return `I found ${job.name} for ${job.contactName} and opened the job page.`;
    }
  }

  if (/\b(find|search|open|show|locate)\b/i.test(prompt) && query) {
    const matches = findContactsByPrompt(prompt);
    if (matches.length === 1) {
      state.selectedContactId = matches[0].id;
      state.leadDetailTab = "overview";
      state.view = "leadDetail";
      state.search = "";
      return `I found ${matches[0].name} and opened the lead page.`;
    }
    if (matches.length > 1) {
      state.view = "contacts";
      state.search = query;
      return `I found ${matches.length} matching records and filtered Contacts for "${query}".`;
    }
  }

  const view = assistantViewFromPrompt(prompt);
  if (view && canView(view)) {
    state.view = view;
    state.search = "";
    return `I opened ${assistantViewLabel(view)} for you.`;
  }

  if (/help|what can you do|examples/i.test(prompt)) {
    return "I can answer general questions in real time, draft roofing and sales language, do simple math, open CRM sections, find leads or jobs by name/address, locate documents, and open estimates.";
  }

  return "";
}

async function assistantRespond(prompt) {
  const localResponse = assistantLocalResponse(prompt);
  if (localResponse) return localResponse;
  return assistantRealtimeAnswer(prompt);
}

async function submitAssistantPrompt(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return;
  addAssistantMessage("user", text);
  state.assistantOpen = true;
  saveState();
  render();
  const response = await assistantRespond(text);
  addAssistantMessage("assistant", response);
  state.assistantOpen = true;
  saveState();
  render();
}

function renderAssistant() {
  if (!els.aiAssistant) return;
  els.aiAssistant.classList.toggle("open", state.assistantOpen);
  els.aiToggle?.setAttribute("aria-expanded", String(Boolean(state.assistantOpen)));

  if (els.aiSuggestions) {
    els.aiSuggestions.innerHTML = assistantSuggestions
      .map((suggestion) => `<button type="button" data-assistant-prompt="${escapeHtml(suggestion)}">${escapeHtml(suggestion)}</button>`)
      .join("");
  }

  if (els.aiMessages) {
    els.aiMessages.innerHTML = assistantMessages()
      .map(
        (message) => `
          <article class="ai-message ${message.role}">
            <span>${message.role === "user" ? "You" : "CRM AI"}</span>
            <p>${nl2br(message.text)}</p>
          </article>
        `,
      )
      .join("");
    window.requestAnimationFrame(() => {
      els.aiMessages.scrollTop = els.aiMessages.scrollHeight;
    });
  }
  hydrateIcons(els.aiAssistant);
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

  renderSummary();
  renderDashboard();
  renderLeadsView();
  renderPipeline();
  renderContacts();
  renderJobsView();
  renderProjectsView();
  renderLeadDetail();
  renderEstimates();
  renderCompanyDocuments();
  renderCalendar();
  renderTasksView();
  renderInvoicesView();
  renderReviewsView();
  renderReportsView();
  renderCompanyForm();
  applyPermissionsToDom();
  renderAssistant();
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
      button.disabled = !canAction(permission);
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
    [els.uploadCompanyDocumentButton, "manageDocuments"],
    [els.newEstimateButton, "manageEstimates"],
    [els.addLineItemButton, "manageEstimates"],
    [els.deleteEstimateButton, "manageEstimates"],
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
    return {
      status,
      count: stageJobs.length,
      value: stageJobs.reduce((sum, job) => sum + number(job.value), 0),
    };
  });

  els.pipelineOverview.innerHTML = `
    <div class="pipeline-ribbon">
      ${stages
        .map(
          (stage, index) => `
            <article class="pipeline-stage stage-${index}">
              <span>${escapeHtml(stage.status)}</span>
              <strong>${stage.count}</strong>
              <small>${money.format(stage.value)}</small>
            </article>
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
  const projectStatus = aggregateCounts(allJobs(), (job) =>
    ["Won", "Lost"].includes(job.status) ? job.status : "In Progress",
  );
  renderDonutWidget(els.leadSourcesChart, sources, leadContacts.length, "Total Leads");
  renderDonutWidget(els.jobsByTypeChart, jobsByType, dashboardMetrics().totalJobs, "Total Jobs");
  renderDonutWidget(
    els.projectStatusChart,
    projectStatus,
    allJobs().filter((job) => job.status !== "Lost").length,
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
  document.querySelectorAll("[data-pipeline-filter]").forEach((button) => {
    button.classList.toggle("active", button.dataset.pipelineFilter === state.pipelineFilter);
  });

  const contacts = filteredContacts().filter((contact) => {
    if (state.pipelineFilter === "All") return true;
    return contact.type === state.pipelineFilter;
  });

  els.pipelineBoard.innerHTML = statuses
    .map((status) => {
      const cards = contacts.filter((contact) => contact.status === status);
      return `
        <section class="pipeline-column">
          <div class="column-head">
            <h3>${status}</h3>
            <span class="count-pill">${cards.length}</span>
          </div>
          ${
            cards.length
              ? cards.map((contact) => renderLeadCard(contact)).join("")
              : '<div class="empty-state">No records here</div>'
          }
        </section>
      `;
    })
    .join("");
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
  const leads = filteredContacts().filter((contact) => contact.type === "Lead");
  els.leadsList.innerHTML = leads.length
    ? leads.map((contact) => renderRecordCard(contact)).join("")
    : '<div class="empty-state">No matching leads</div>';
  hydrateIcons(els.leadsList);
}

function renderJobsView() {
  if (!els.jobsTableBody) return;
  const query = state.search.trim().toLowerCase();
  const jobs = allJobs().filter((job) =>
    query
      ? [job.name, job.address, job.status, job.salesRep, job.contactName]
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
              <strong>${escapeHtml(job.name)}</strong>
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
              <button class="secondary-button" type="button" data-action="open-contact-tab" data-contact-id="${job.contactId}" data-tab="jobs">
                <span aria-hidden="true" data-icon="open"></span>
                Open
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
            <strong>${escapeHtml(job.name)}</strong>
            <span>${escapeHtml(job.contactName)} - ${money.format(number(job.value))}</span>
            <p>${escapeHtml((job.address || "No address").split("\n")[0])}</p>
            <div class="row-actions">
              <button class="secondary-button" type="button" data-action="open-contact-tab" data-contact-id="${job.contactId}" data-tab="jobs">
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

function renderLeadDetail() {
  if (!els.views.leadDetail) return;
  const contact = getSelectedContact();
  if (!contact) {
    els.leadDetailTitle.textContent = "Lead Detail";
    els.leadOverviewPanel.innerHTML = '<div class="empty-state">No lead selected</div>';
    return;
  }

  els.leadDetailTitle.textContent = contact.name;
  els.leadDetailMeta.textContent = `${contact.type} - ${contact.status} - ${contact.salesRep || "Unassigned"}`;

  if (state.leadDetailTab === "profit" && !canManageJobFinancials()) {
    state.leadDetailTab = "overview";
  }

  document.querySelectorAll("[data-lead-tab]").forEach((button) => {
    if (button.dataset.leadTab === "profit") {
      button.classList.toggle("hidden", !canManageJobFinancials());
    }
    button.classList.toggle("active", button.dataset.leadTab === state.leadDetailTab);
  });

  const panels = {
    overview: els.leadOverviewPanel,
    jobs: els.leadJobsPanel,
    profit: els.leadProfitPanel,
    email: els.leadEmailPanel,
    documents: els.leadDocumentsPanel,
    conversation: els.leadConversationPanel,
  };
  Object.entries(panels).forEach(([tab, panel]) => {
    if (!panel) return;
    panel.classList.toggle("hidden", tab !== state.leadDetailTab);
  });

  const jobs = contactJobs(contact);
  const jobValue = jobs.reduce((sum, job) => sum + number(job.value), 0);
  const openJobs = jobs.filter((job) => !["Won", "Lost"].includes(job.status)).length;
  els.leadDetailStats.innerHTML = [
    ["Status", contact.status, "Current job stage"],
    ["Sales Rep", contact.salesRep || "Unassigned", "Owner"],
    ["Jobs", jobs.length, `${openJobs} open`],
    ["Job Value", money.format(jobValue), "Total value"],
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
          <p style="margin:0 0 8px"><strong style="font-size:13px">${escapeHtml(job.name)}</strong><br /><span style="color:var(--muted);font-size:12px">${nl2br(job.address || "No address saved")}</span></p>
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
  renderLeadEmail(contact);
  renderLeadDocuments(contact);
  renderLeadConversation(contact);
}

function renderLeadJobs(contact) {
  els.leadJobsList.innerHTML = contactJobs(contact)
    .map(
      (job) => `
      <article class="job-card">
        <div>
          <span class="status-pill">${escapeHtml(job.status)}</span>
          <strong>${escapeHtml(job.name)}</strong>
          <span>${escapeHtml(job.salesRep || "Unassigned")} - ${money.format(number(job.value))}</span>
          <p>${nl2br(job.address || "No address saved")}</p>
          ${job.notes ? `<p>${nl2br(job.notes)}</p>` : ""}
        </div>
        <div class="row-actions">
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

function selectedProfitJob(contact) {
  const jobs = contactJobs(contact);
  return jobs.find((job) => job.id === state.selectedProfitJobId) || jobs[0];
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

  const jobs = contactJobs(contact);
  const selected = selectedProfitJob(contact);
  state.selectedProfitJobId = selected?.id || "";

  if (els.profitJobSelect) {
    els.profitJobSelect.innerHTML = jobs
      .map(
        (job) => `
          <option value="${job.id}" ${job.id === selected?.id ? "selected" : ""}>
            ${escapeHtml(job.name)} - ${escapeHtml((job.address || "No address").split("\n")[0])}
          </option>
        `,
      )
      .join("");
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
  if (!contact || !state.selectedProfitJobId) return null;
  let updatedJob = null;
  updateContact(contact.id, (current) => {
    const jobs = contactJobs(current).map((job) => {
      if (job.id !== state.selectedProfitJobId) return job;
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

function saveProfitCost(event) {
  event.preventDefault();
  if (!requireAction("manageJobFinancials")) return;
  const contact = getSelectedContact();
  const job = selectedProfitJob(contact);
  if (!contact || !job) return;
  state.selectedProfitJobId = job.id;
  const formData = new FormData(els.profitCostForm);
  const costId = formData.get("costId") || uid("cost");
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

  addContactUpdate(contact.id, {
    author: state.currentUser.name || "Upper admin",
    message: `${existing ? "Updated" : "Added"} cost on ${job.name}: ${money.format(nextItem.amount)} ${nextItem.category}.`,
  });

  fillProfitCostForm();
  state.leadDetailTab = "profit";
  saveState();
  render();
  showToast("Cost saved");
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
    if (field) field.value = value ?? "";
  });
}

function saveLeadJob(event) {
  event.preventDefault();
  if (!requireAction("manageJobs")) return;
  const contact = getSelectedContact();
  if (!contact) return;
  const formData = new FormData(els.leadJobForm);
  const jobId = formData.get("jobId") || uid("job");
  const existing = contactJobs(contact).find((job) => job.id === jobId);
  const job = normalizeJob(
    {
      ...(existing || { id: jobId, createdAt: todayISO() }),
      id: jobId,
      name: formData.get("name").trim(),
      status: formData.get("status"),
      value: number(formData.get("value")),
      salesRep: formData.get("salesRep").trim() || contact.salesRep || "Unassigned",
      lastContact: formData.get("lastContact"),
      closedDate:
        formData.get("closedDate") ||
        (formData.get("status") === "Won" ? existing?.closedDate || todayISO() : ""),
      address: formData.get("address").trim(),
      notes: formData.get("notes").trim(),
    },
    contact,
  );

  updateContact(contact.id, (current) => {
    const jobs = contactJobs(current);
    const nextJobs = existing ? jobs.map((item) => (item.id === jobId ? job : item)) : [job, ...jobs];
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
          author: job.salesRep || "Local user",
          status: job.status,
          message: `${existing ? "Updated" : "Added"} job: ${job.name}.`,
          createdAt: new Date().toISOString(),
        },
        ...(current.updates || []),
      ],
    };
  });

  els.leadJobForm.reset();
  state.leadDetailTab = "jobs";
  saveState();
  render();
  showToast(`${job.name} saved`);
}

function editLeadJob(jobId) {
  const contact = getSelectedContact();
  const job = contactJobs(contact).find((item) => item.id === jobId);
  if (!job) return;
  state.leadDetailTab = "jobs";
  renderLeadDetail();
  fillJobForm({ ...job, jobId: job.id });
}

function deleteLeadJob(jobId) {
  const contact = getSelectedContact();
  if (!contact || contactJobs(contact).length <= 1) return;
  const job = contactJobs(contact).find((item) => item.id === jobId);
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
  saveState();
  render();
  showToast("Job removed");
}

function defaultLeadEmail(contact) {
  const primary = primaryJob(contact);
  return {
    fromEmail: state.currentUser.email || state.company.email || "",
    toEmail: contact.email || "",
    subject: `${state.company.name} follow-up for ${primary?.name || "your project"}`,
    message: `Hi ${contact.name},\n\nI wanted to follow up on ${primary?.name || "your project"}.\n\nPlease let me know if you have any questions or if there is a good time to connect.\n\nThank you,\n${state.currentUser.name || state.company.name}`,
  };
}

function renderLeadEmail(contact) {
  if (!els.leadEmailForm) return;
  const data = defaultLeadEmail(contact);
  Object.entries(data).forEach(([key, value]) => {
    const field = els.leadEmailForm.elements[key];
    if (field && !field.matches(":focus")) field.value = value;
  });
}

function leadEmailPayload() {
  const contact = getSelectedContact();
  if (!contact || !els.leadEmailForm) return null;
  const formData = new FormData(els.leadEmailForm);
  return {
    contact,
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
  addContactUpdate(payload.contact.id, {
    author: state.currentUser.name || "Local user",
    message: `Opened email draft: ${payload.subject || "Client email"}.`,
  });
  saveState();
  window.location.href = mailtoUrl(payload.toEmail, payload.subject, payload.message);
  showToast("Email draft opened");
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
  els.leadDocumentsList.innerHTML = contact.documents.length
    ? contact.documents
        .map(
          (document) => `
        <article class="document-card">
          <div>
            <strong>${escapeHtml(document.name)}</strong>
            <span>${escapeHtml(formatBytes(document.size))} - ${escapeHtml(formatDateTime(document.uploadedAt))}</span>
          </div>
          <div class="row-actions">
            <a class="secondary-button" href="${escapeHtml(document.dataUrl)}" download="${escapeHtml(
              document.name,
            )}">
              <span aria-hidden="true" data-icon="download"></span>
              Download
            </a>
            <button class="mini-button" type="button" title="Rename document" aria-label="Rename ${escapeHtml(
              document.name,
            )}" data-action="rename-document" data-document-id="${document.id}">
              <span aria-hidden="true" data-icon="edit"></span>
            </button>
            <button class="mini-button" type="button" title="Remove document" aria-label="Remove ${escapeHtml(
              document.name,
            )}" data-action="remove-document" data-document-id="${document.id}">
              <span aria-hidden="true" data-icon="trash"></span>
            </button>
          </div>
        </article>
      `,
        )
        .join("")
    : '<div class="empty-state">No documents saved for this lead yet</div>';
  hydrateIcons(els.leadDocumentsList);
}

function renderLeadConversation(contact) {
  els.leadConversationList.innerHTML = contact.updates.length
    ? contact.updates
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

  const documents = await Promise.all(
    [...files].map(async (file) =>
      normalizeDocument({
        id: uid("doc"),
        name: file.name,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: await readFileAsDataUrl(file),
        uploadedAt: new Date().toISOString(),
        uploadedBy: "Local user",
      }),
    ),
  );

  updateContact(contact.id, (current) => ({
    ...current,
    documents: [...documents, ...(current.documents || [])],
  }));
  addContactUpdate(contact.id, {
    message: `Uploaded ${documents.length === 1 ? documents[0].name : `${documents.length} documents`}.`,
  });
  saveState();
  render();
  showToast(`${documents.length} document${documents.length === 1 ? "" : "s"} saved to ${contact.name}`);
}

function removeLeadDocument(documentId) {
  if (!requireAction("manageDocuments")) return;
  const contact = getSelectedContact();
  if (!contact) return;
  const document = contact.documents.find((item) => item.id === documentId);
  updateContact(contact.id, (current) => ({
    ...current,
    documents: current.documents.filter((item) => item.id !== documentId),
  }));
  addContactUpdate(contact.id, {
    message: `Removed document ${document?.name || "from lead record"}.`,
  });
  saveState();
  render();
  showToast("Document removed");
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
    message: `Renamed document ${document.name} to ${nextName}.`,
  });
  saveState();
  render();
  showToast("Document renamed");
}

function submitLeadConversation(event) {
  event.preventDefault();
  if (!requireAction("manageJobs")) return;
  const contact = getSelectedContact();
  if (!contact) return;
  const formData = new FormData(els.leadConversationForm);
  const author = formData.get("author") || "Local user";
  const status = formData.get("status");
  const message = formData.get("message").trim();

  if (status && status !== contact.status) {
    applyStatusUpdate(contact.id, status, author, message || `Status changed to ${status}.`);
  } else {
    addContactUpdate(contact.id, { author, message, status });
  }

  els.leadConversationForm.reset();
  state.leadDetailTab = "conversation";
  saveState();
  render();
  showToast("Update posted");
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
            <a class="secondary-button" href="${escapeHtml(document.dataUrl)}" download="${escapeHtml(
              document.name,
            )}">
              <span aria-hidden="true" data-icon="download"></span>
              Download
            </a>
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
  const category = els.companyDocumentCategory.value || "Other";
  const documents = await Promise.all(
    [...files].map(async (file) =>
      normalizeDocument({
        id: uid("doc"),
        name: file.name,
        category,
        type: file.type || "application/octet-stream",
        size: file.size,
        dataUrl: await readFileAsDataUrl(file),
        uploadedAt: new Date().toISOString(),
        uploadedBy: "Local user",
      }),
    ),
  );
  state.companyDocuments = [...documents, ...state.companyDocuments];
  saveState();
  renderCompanyDocuments();
  showToast(`${documents.length} company document${documents.length === 1 ? "" : "s"} saved`);
}

function removeCompanyDocument(documentId) {
  if (!requireAction("manageDocuments")) return;
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

function renderCalendar() {
  if (!els.calendarTasksList) return;
  renderCalendarFormOptions();
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

function renderInvoicesView() {
  if (!els.invoicesList) return;
  const estimates = [...state.estimates].sort((a, b) => new Date(b.issueDate) - new Date(a.issueDate));
  els.invoicesList.innerHTML = estimates.length
    ? estimates
        .map((estimate) => {
          const contact = getEstimateContact(estimate);
          const total = estimateTotal(estimate);
          return `
            <article class="record-card">
              <span class="status-pill">${escapeHtml(estimate.status)}</span>
              <strong>${escapeHtml(estimate.estimateNumber)}</strong>
              <span>${escapeHtml(contact?.name || "Unknown client")} - ${money.format(total)}</span>
              <p>${escapeHtml(estimate.projectTitle || "Untitled estimate")}</p>
              <div class="row-actions">
                <button class="secondary-button" type="button" data-action="select-estimate" data-estimate-id="${estimate.id}">
                  <span aria-hidden="true" data-icon="file"></span>
                  Open
                </button>
              </div>
            </article>
          `;
        })
        .join("")
    : '<div class="empty-state">Invoices will use approved estimates when they are ready for billing</div>';
  hydrateIcons(els.invoicesList);
}

function renderReviewsView() {
  if (!els.reviewsList) return;
  const customers = state.contacts.filter((contact) => contact.type === "Customer" || contact.status === "Won");
  els.reviewsList.innerHTML = customers.length
    ? customers
        .map(
          (contact) => `
            <article class="record-card">
              <span class="status-pill">Review Request</span>
              <strong>${escapeHtml(contact.name)}</strong>
              <span>${escapeHtml(contact.email || "No email saved")}</span>
              <p>${escapeHtml(contact.notes || "Customer is ready for post-job follow-up.")}</p>
              <div class="row-actions">
                <button class="secondary-button" type="button" data-action="open-contact-tab" data-contact-id="${contact.id}" data-tab="email">
                  <span aria-hidden="true" data-icon="mail"></span>
                  Email
                </button>
              </div>
            </article>
          `,
        )
        .join("")
    : '<div class="empty-state">Won customers will appear here for review follow-up</div>';
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

  els.estimateList.innerHTML = estimates.length
    ? estimates
        .map((item) => {
          const contact = getEstimateContact(item);
          const job = getEstimateJob(item);
          const total = totalsFor(item).total;
          return `
            <button type="button" class="${item.id === estimate?.id ? "active" : ""}" data-estimate-id="${
              item.id
            }">
              <strong>${escapeHtml(item.projectTitle || item.estimateNumber)}</strong>
              <span class="status-pill">${escapeHtml(item.status)}</span>
              <small>${escapeHtml(item.estimateNumber)} - ${escapeHtml(contact?.name || "Unknown lead")}</small>
              <small>${escapeHtml(job?.name || "Primary job")}</small>
              <small>${money.format(total)}</small>
            </button>
          `;
        })
        .join("")
    : '<div class="empty-state">No matching estimates</div>';

  renderEstimateForm(estimate);
  renderEstimatePreview(estimate);
}

function renderEstimateForm(estimate) {
  const disabled = !estimate;
  els.estimateForm.classList.toggle("hidden", disabled);
  els.deleteEstimateButton.disabled = disabled;
  els.copyEstimateButton.disabled = disabled;
  els.printEstimateButton.disabled = disabled;
  els.sendEstimateButton.disabled = disabled;

  if (!estimate) return;

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
  els.salesRepPhone.value = estimate.salesRepPhone || rep.phone;
  els.issueDate.value = estimate.issueDate;
  els.validUntil.value = estimate.validUntil;
  els.scopeSummary.value = estimate.scopeSummary;
  els.taxRate.value = estimate.taxRate;
  els.deposit.value = estimate.deposit;
  els.estimateNotes.value = estimate.notes;

  els.lineItems.innerHTML = estimate.items
    .map(
      (item, index) => `
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
            <input data-line-field="quantity" type="number" min="0" step="0.01" value="${number(
              item.quantity,
            )}" />
          </label>
          <label>
            Unit
            <input data-line-field="unit" value="${escapeHtml(item.unit)}" />
          </label>
          <label>
            Rate
            <input data-line-field="rate" type="number" min="0" step="0.01" value="${number(item.rate)}" />
          </label>
          <div class="remove-cell">
            <button class="mini-button" type="button" title="Remove line item" aria-label="Remove line item" data-action="remove-line" data-line-index="${index}">
              <span aria-hidden="true" data-icon="trash"></span>
            </button>
          </div>
        </div>
      `,
    )
    .join("");
  hydrateIcons(els.lineItems);
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
    Approved: "est-status-approved",
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
            <p class="est-info-name">${escapeHtml(contact?.name || "No customer selected")}</p>
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

function renderCompanyForm() {
  const form = els.companyForm;
  state.company = normalizeCompany(state.company);
  Object.entries(state.company).forEach(([key, value]) => {
    const field = form.elements[key];
    if (field) field.value = value;
  });
  if (els.companyLogoPreview) {
    els.companyLogoPreview.src = state.company.logoDataUrl || "icon.svg";
    els.companyLogoPreview.classList.toggle("logo-placeholder", !state.company.logoDataUrl);
  }
  const userFields = {
    userName: state.currentUser.name,
    userEmail: state.currentUser.email,
    userPhone: state.currentUser.phone || "",
    userRole: state.currentUser.role,
  };
  Object.entries(userFields).forEach(([key, value]) => {
    const field = form.elements[key];
    if (field) field.value = value || "";
  });
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
    if (field) field.value = value ?? "";
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
    phone: formData.get("phone").trim(),
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

function createEstimate(contactId, shouldRender = true, jobId = "") {
  if (!requireAction("manageEstimates")) return null;
  if (!contactId) {
    showToast("Choose a lead before creating an estimate");
    return null;
  }
  const contact = getContact(contactId);
  if (!contact) {
    showToast("Choose a valid lead before creating an estimate");
    return null;
  }
  const job = contactJobs(contact).find((item) => item.id === jobId) || primaryJob(contact);

  const estimate = {
    id: uid("estimate"),
    contactId,
    jobId: job?.id || "",
    estimateNumber: nextEstimateNumber(),
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

function updateSelectedEstimateFromField(fieldName, value) {
  if (!canAction("manageEstimates")) return;
  const estimate = getSelectedEstimate();
  if (!estimate) return;

  if (["taxRate", "deposit"].includes(fieldName)) {
    estimate[fieldName] = number(value);
  } else {
    estimate[fieldName] = value;
  }

  if (fieldName === "contactId") {
    const contact = getContact(value);
    estimate.jobId = primaryJob(contact)?.id || "";
    estimate.projectManager = contact?.salesRep || estimate.projectManager;
    state.selectedContactId = value;
    renderEstimateForm(estimate);
  }
  saveState();
  renderEstimatePreview(estimate);
  renderSummary();
  renderEstimateListOnly();
}

function renderEstimateListOnly() {
  const currentFormState = document.activeElement;
  const estimate = getSelectedEstimate();
  const estimates = filteredEstimates();
  els.estimateList.innerHTML = estimates
    .map((item) => {
      const contact = getEstimateContact(item);
      const job = getEstimateJob(item);
      const total = totalsFor(item).total;
      return `
        <button type="button" class="${item.id === estimate?.id ? "active" : ""}" data-estimate-id="${item.id}">
          <strong>${escapeHtml(item.projectTitle || item.estimateNumber)}</strong>
          <span class="status-pill">${escapeHtml(item.status)}</span>
          <small>${escapeHtml(item.estimateNumber)} - ${escapeHtml(contact?.name || "Unknown contact")}</small>
          <small>${escapeHtml(job?.name || "Primary job")}</small>
          <small>${money.format(total)}</small>
        </button>
      `;
    })
    .join("");
  if (currentFormState?.id) {
    document.getElementById(currentFormState.id)?.focus();
  }
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
  saveState();
  renderEstimatePreview(estimate);
  renderEstimateListOnly();
}

function deleteEstimate() {
  if (!requireAction("manageEstimates")) return;
  const estimate = getSelectedEstimate();
  if (!estimate) return;
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

function dataUrlSize(dataUrl = "") {
  const base64 = String(dataUrl).split(",")[1] || "";
  return Math.round((base64.length * 3) / 4);
}

function saveEstimatePdfDocument(estimate, contact, doc) {
  if (!canAction("manageDocuments")) return null;
  const job = getEstimateJob(estimate);
  const dataUrl = doc.output("datauristring");
  const fileName = estimateFileName(estimate);
  let savedDocument = null;
  let createdDocument = false;

  updateContact(contact.id, (current) => {
    const documents = current.documents || [];
    const existing = documents.find((document) => document.source === "Estimate PDF" && document.estimateId === estimate.id);
    savedDocument = normalizeDocument({
      ...(existing || {}),
      id: existing?.id || uid("doc"),
      name: fileName,
      category: "Estimates",
      type: "application/pdf",
      size: dataUrlSize(dataUrl),
      dataUrl,
      uploadedAt: new Date().toISOString(),
      uploadedBy: state.currentUser.name || state.currentUser.email || "Local user",
      source: "Estimate PDF",
      estimateId: estimate.id,
      contactId: contact.id,
      jobId: estimate.jobId || job?.id || "",
    });
    createdDocument = !existing;
    return {
      ...current,
      documents: existing
        ? documents.map((document) => (document.id === existing.id ? savedDocument : document))
        : [savedDocument, ...documents],
    };
  });

  if (createdDocument) {
    addContactUpdate(contact.id, {
      author: state.currentUser.name || "CRM",
      message: `Saved estimate PDF ${estimate.estimateNumber} to documents.`,
    });
  }

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
  const estimate = getSelectedEstimate();
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
  doc.text(estimate.estimateNumber || "", right, 48, { align: "right" });
  doc.text(`Issued: ${formatDate(estimate.issueDate)}`, right, 59, { align: "right" });
  doc.text(`Valid through: ${formatDate(estimate.validUntil)}`, right, 70, { align: "right" });

  // Status pill
  const statusPillColors = {
    Draft: [51, 65, 85], Sent: [29, 158, 117], Approved: [31, 157, 85],
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

  const savedDocument = saveEstimatePdfDocument(estimate, contact, doc);
  saveState();
  doc.save(estimateFileName(estimate));
  if (!options.silent) {
    showToast(savedDocument ? "Estimate PDF downloaded and saved to the lead" : "Estimate PDF downloaded");
  }
  return true;
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
  const contactRecord = getContact(contact.id);
  if (contactRecord && contactRecord.status !== "Won") contactRecord.status = "Estimate Sent";
  saveState();
  render();
  await downloadEstimatePdf({ silent: true });

  const subject = encodeURIComponent(`${estimate.estimateNumber} from ${state.company.name}`);
  const body = encodeURIComponent(
    `Hi ${contact.name},\n\nPlease review the estimate below. I also downloaded the PDF so it can be attached to this email.\n\n${estimateText(
      estimate,
    )}`,
  );
  window.location.href = `mailto:${encodeURIComponent(contact.email)}?subject=${subject}&body=${body}`;
  showToast("Email draft opened");
}

function printEstimate() {
  downloadEstimatePdf();
}

function saveCompany(event) {
  event.preventDefault();
  if (!requireAction("manageCompany")) return;
  const formData = new FormData(els.companyForm);
  state.currentUser = {
    name: formData.get("userName").trim() || defaultCurrentUser.name,
    email: formData.get("userEmail").trim() || state.company.email || defaultCurrentUser.email,
    phone: formData.get("userPhone").trim() || state.currentUser.phone || "",
    role: formData.get("userRole").trim() || defaultCurrentUser.role,
  };
  state.company = {
    name: formData.get("name").trim(),
    license: formData.get("license").trim(),
    phone: formData.get("phone").trim(),
    email: formData.get("email").trim(),
    address: formData.get("officeAddress").trim(),
    officeAddress: formData.get("officeAddress").trim(),
    logoDataUrl: state.company.logoDataUrl || "",
    defaultTerms: formData.get("defaultTerms").trim(),
  };
  saveState();
  renderBrandLogo();
  renderTopbarProfile();
  renderEstimatePreview(getSelectedEstimate());
  showToast("Settings saved");
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
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
  sparkles:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7Z"/><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9Z"/><path d="m5 14 .9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9Z"/></svg>',
  bell:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  menu:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round"><path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/></svg>',
  file:
    '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/></svg>',
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
  document.addEventListener("click", (event) => {
    const navButton = event.target.closest("[data-view]");
    if (navButton) setView(navButton.dataset.view);

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
    if (action === "add-customer") openContactDialog(null, { type: "Customer" });
    if (action === "open-contact") openLeadDetail(contactId);
    if (action === "open-contact-tab") openLeadDetail(contactId, actionButton.dataset.tab || "overview");
    if (action === "refresh-weather") loadWeather({ force: true });
    if (action === "edit-contact") openContactDialog(contactId);
    if (action === "estimate-contact") createEstimate(contactId);
    if (action === "estimate-job") createEstimate(contactId, true, actionButton.dataset.jobId);
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
        saveState();
        renderEstimates();
      }
    }
    if (action === "remove-document") {
      removeLeadDocument(actionButton.dataset.documentId);
    }
    if (action === "rename-document") {
      renameLeadDocument(actionButton.dataset.documentId);
    }
    if (action === "remove-company-document") {
      removeCompanyDocument(actionButton.dataset.documentId);
    }
    if (action === "rename-company-document") {
      renameCompanyDocument(actionButton.dataset.documentId);
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
    state.leadDetailTab = tabButton.dataset.leadTab;
    saveState();
    renderLeadDetail();
  });

  els.globalSearch.addEventListener("input", (event) => {
    state.search = event.target.value;
    saveState();
    render();
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
  els.estimateLeadDetailButton.addEventListener("click", () => {
    const contact = getSelectedContact();
    if (contact && requireAction("manageEstimates")) createEstimate(contact.id);
  });
  els.uploadLeadDocumentButton.addEventListener("click", () => {
    if (!requireAction("manageDocuments")) return;
    els.leadDocumentInput.value = "";
    els.leadDocumentInput.click();
  });
  els.leadDocumentInput.addEventListener("change", async (event) => {
    try {
      await uploadLeadDocuments(event.target.files);
    } catch {
      showToast("Document upload failed");
    }
  });
  els.leadConversationForm.addEventListener("submit", submitLeadConversation);
  els.leadJobForm.addEventListener("submit", saveLeadJob);
  els.clearJobFormButton.addEventListener("click", () => fillJobForm());
  els.profitJobSelect?.addEventListener("change", (event) => {
    if (!requireAction("manageJobFinancials")) return;
    state.selectedProfitJobId = event.target.value;
    saveState();
    renderLeadDetail();
  });
  els.profitCostForm?.addEventListener("submit", saveProfitCost);
  els.clearProfitCostForm?.addEventListener("click", () => fillProfitCostForm());
  els.leadEmailForm.addEventListener("submit", submitLeadEmail);
  els.copyLeadEmailButton.addEventListener("click", copyLeadEmail);
  els.uploadCompanyDocumentButton.addEventListener("click", () => {
    if (!requireAction("manageDocuments")) return;
    els.companyDocumentInput.value = "";
    els.companyDocumentInput.click();
  });
  els.companyDocumentInput.addEventListener("change", async (event) => {
    try {
      await uploadCompanyDocuments(event.target.files);
    } catch {
      showToast("Company document upload failed");
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
  els.closeContactDialog.addEventListener("click", () => els.contactDialog.close());
  els.contactForm.addEventListener("submit", saveContactFromForm);
  els.deleteContactButton.addEventListener("click", () => {
    if (!requireAction("manageContacts")) return;
    const id = els.contactForm.elements.id.value;
    if (id) deleteContact(id);
  });
  els.estimateFromContactButton.addEventListener("click", () => {
    if (!requireAction("manageEstimates")) return;
    const id = els.contactForm.elements.id.value;
    if (id) {
      els.contactDialog.close();
      createEstimate(id);
    }
  });

  els.estimateList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-estimate-id]");
    if (button) setSelectedEstimate(button.dataset.estimateId);
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
  els.newEstimateButton.addEventListener("click", () => {
    if (!requireAction("manageEstimates")) return;
    createEstimate(els.newEstimateContact?.value, true, els.newEstimateJob?.value);
  });
  els.addLineItemButton.addEventListener("click", () => {
    if (!requireAction("manageEstimates")) return;
    const estimate = getSelectedEstimate();
    if (!estimate) return;
    estimate.items.push({ title: "", description: "", quantity: 1, unit: "ea", rate: 0 });
    saveState();
    renderEstimates();
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
    saveState();
    renderEstimates();
    els.templatePicker.classList.add("hidden");
    showToast(`${tpl.name} template added`);
  });

  els.estimateForm.addEventListener("input", (event) => {
    if (!canAction("manageEstimates")) return;
    if (event.target.matches("[data-line-field]")) {
      updateLineItem(event.target);
      return;
    }
    if (event.target.name) updateSelectedEstimateFromField(event.target.name, event.target.value);
  });

  els.estimateForm.addEventListener("change", (event) => {
    if (!canAction("manageEstimates")) return;
    if (event.target.name) {
      updateSelectedEstimateFromField(event.target.name, event.target.value);
      renderEstimates();
    }
  });

  els.deleteEstimateButton.addEventListener("click", deleteEstimate);
  els.copyEstimateButton.addEventListener("click", copyEstimate);
  els.printEstimateButton.addEventListener("click", printEstimate);
  els.sendEstimateButton.addEventListener("click", sendEstimate);
  els.companyForm.addEventListener("submit", saveCompany);

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

  els.aiToggle?.addEventListener("click", () => {
    state.assistantOpen = !state.assistantOpen;
    saveState();
    renderAssistant();
  });
  els.aiClear?.addEventListener("click", () => {
    state.assistantMessages = [];
    saveState();
    renderAssistant();
  });
  els.aiSuggestions?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-assistant-prompt]");
    if (!button) return;
    submitAssistantPrompt(button.dataset.assistantPrompt);
  });
  els.aiForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = els.aiInput?.value || "";
    if (els.aiInput) els.aiInput.value = "";
    submitAssistantPrompt(value);
  });
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    await navigator.serviceWorker.register("sw.js");
  } catch {
    console.info("Service worker registration failed");
  }
}

async function startApp() {
  if (!window.RooflineAuth) {
    location.replace("/login?reason=auth-loader");
    return;
  }

  authSession = await window.RooflineAuth.requireAuth();
  if (!authSession) return;
  authSession = await promoteSignedInSession();

  state = loadState(activeStorageKey());
  state.currentUser = currentUserFromAuthSession(authSession);
  saveState({ localOnly: true });
  await initializeCloudSync();
  hydrateIcons();
  bindEvents();
  render();
  registerServiceWorker();
}

startApp();
