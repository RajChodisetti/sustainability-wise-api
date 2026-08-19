export type ScheduleSourceApp = 'ecoaudit' | 'solarsense' | 'installhub' | 'custom';
export type ScheduleSourceType = 'audit' | 'site' | 'assessment' | 'installation' | 'custom';
export type ScheduleStatus = 'planned' | 'in_progress' | 'done' | 'cancelled';

export type ScheduleEvent = {
  id: string;
  title: string;
  description: string | null;
  sourceApp: ScheduleSourceApp;
  sourceType: ScheduleSourceType;
  sourceId: string | null;
  assigneeFieldUserId: string;
  assigneeDisplayName: string | null;
  assigneeEmail: string | null;
  scheduledStartAt: string;
  scheduledEndAt: string | null;
  deadlineAt: string;
  status: ScheduleStatus;
  createdByUserId: string;
  createdByApp: string;
  createdAt: string;
  updatedAt: string;
  cancelledAt: string | null;
};

export type ScheduleSummary = {
  today: number;
  thisWeek: number;
  overdue: number;
  planned: number;
  inProgress: number;
  byApp: Partial<Record<ScheduleSourceApp, number>>;
};

export type JobOption = {
  id: string;
  label: string;
  sourceApp: Exclude<ScheduleSourceApp, 'custom'>;
  sourceType: Exclude<ScheduleSourceType, 'custom'>;
  subtitle?: string | null;
};

export type CreateScheduleEventInput = {
  title?: string;
  description?: string | null;
  sourceApp: ScheduleSourceApp;
  sourceType: ScheduleSourceType;
  sourceId?: string | null;
  assigneeFieldUserId: string;
  scheduledStartAt: string;
  scheduledEndAt?: string | null;
  deadlineAt: string;
  status?: ScheduleStatus;
};

export type CreateSchedulerDispatchInput = {
  sourceApp: Exclude<ScheduleSourceApp, 'custom'>;
  title?: string;
  description?: string | null;
  assigneeFieldUserId: string;
  scheduledStartAt: string;
  scheduledEndAt?: string | null;
  deadlineAt: string;
  job: {
    siteName: string;
    siteAddress?: string;
    location?: string;
    buildingIdName?: string;
    clientName?: string;
    auditDate?: string;
    timezone?: string;
  };
};

export type UpdateScheduleEventInput = {
  title?: string;
  description?: string | null;
  assigneeFieldUserId?: string;
  scheduledStartAt?: string;
  scheduledEndAt?: string | null;
  deadlineAt?: string;
  status?: ScheduleStatus;
};

export type ScheduleReminderResponse = {
  queued: boolean;
  notificationId: string;
};

export type PortalDirectoryUser = {
  /** Canonical global user id shared across product memberships. */
  key: string;
  fieldUserId: string;
  label: string;
  email: string;
  role: string;
  billingRate: number | null;
  appMemberships: Array<'ecoaudit' | 'solarsense' | 'installhub'>;
};

export type FinanceSourceApp = Exclude<ScheduleSourceApp, 'custom'>;
export type FinanceSourceType = 'audit' | 'assessment' | 'installation';
export type FinancePricingMode = 'quoted' | 'charge_up';
export type FinanceExpenseKind = 'expense' | 'supplier_bill';
export type FinanceExpenseCategory =
  | 'materials'
  | 'travel'
  | 'subcontractor'
  | 'equipment'
  | 'other';
export type SchedulerInvoiceStatus = 'draft' | 'issued' | 'paid' | 'void';
export type SchedulerInvoiceLineKind = 'labour' | 'quoted' | 'expense' | 'other';
export type SchedulerInvoiceEmailStatus =
  | 'queued'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'delivery_unknown';

export type SchedulerInvoiceEmailDelivery = {
  id: string;
  invoiceId: string;
  pdfJobId: string;
  sourceUpdatedAt: string;
  attachmentFilename: string;
  recipient: string;
  subject: string;
  message: string;
  status: SchedulerInvoiceEmailStatus;
  attempts: number;
  maxAttempts: number;
  provider: 'gmail_api';
  providerMessageId: string | null;
  lastErrorCode: string | null;
  requestedByGlobalUserId: string;
  requestedByDisplayName: string | null;
  requestedByApp: FinanceSourceApp;
  sentAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SendSchedulerInvoiceEmailInput = {
  expectedUpdatedAt: string;
  idempotencyKey: string;
  to?: string;
  subject?: string;
  message?: string;
};

export type SendSchedulerInvoiceEmailResponse = {
  delivery: SchedulerInvoiceEmailDelivery;
  reused: boolean;
};

export type FinanceOverviewItem = {
  financeId: string;
  sourceApp: FinanceSourceApp;
  sourceType: FinanceSourceType;
  sourceId: string;
  eventId: string | null;
  jobName: string;
  siteName: string;
  jobDate: string;
  jobStatus: string;
  eventStatus: string | null;
  currency: string;
  actualHours: number;
  billableHours: number;
  costHours: number;
  billableAmount: number;
  totalCost: number;
  invoicedAmount: number;
  unbilledAmount: number;
  grossProfit: number;
  marginPct: number | null;
  invoiceCount: number;
  hasOverdueInvoice: boolean;
  /** True when recorded time is absent or sourced from a migrated estimate. */
  needsHoursReview: boolean;
  invoiceReadiness: {
    completionSatisfied: boolean;
    completionBasis: 'job' | null;
    hoursSatisfied: boolean;
    hoursBasis: 'app_time' | 'admin_override' | null;
    ready: boolean;
  };
};

export type FinanceOverviewPage = {
  items: FinanceOverviewItem[];
  nextCursor: string | null;
};

export type FinanceExpense = {
  id: string;
  financeId: string;
  eventId: string | null;
  kind: FinanceExpenseKind;
  category: FinanceExpenseCategory;
  description: string;
  vendor: string | null;
  reference: string | null;
  costAmount: number;
  billableAmount: number | null;
  billable: boolean;
  effectiveBillableAmount: number;
  incurredAt: string | null;
  invoiced: boolean;
  invoiceId: string | null;
  reserved: boolean;
  markupPct: number | null;
  attachments: FinanceExpenseAttachment[];
  createdAt: string;
  updatedAt: string;
};

export type FinanceExpenseAttachment = {
  id: string;
  expenseId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  downloadUrl: string;
};

export type SchedulerGlobalExpense = FinanceExpense & {
  currency: string;
  source: {
    sourceApp: FinanceSourceApp;
    sourceType: FinanceSourceType;
    sourceId: string;
  };
  job: {
    jobName: string;
    jobDate: string;
    clientName: string | null;
    siteName: string;
    siteAddress: string | null;
    status: string;
  };
};

export type SchedulerExpensePage = {
  items: SchedulerGlobalExpense[];
  nextCursor: string | null;
};

export type FinanceExpenseInput = {
  kind: FinanceExpenseKind;
  category: FinanceExpenseCategory;
  description: string;
  vendor?: string | null;
  reference?: string | null;
  costAmount: number;
  billableAmount?: number | null;
  billable: boolean;
  incurredAt?: string | null;
};

export type SchedulerInvoiceListItem = {
  id: string;
  financeId: string;
  invoiceNumber: string;
  status: SchedulerInvoiceStatus;
  currency: string;
  issueDate: string | null;
  dueDate: string | null;
  subtotalExGst: number;
  gstAmount: number;
  totalIncGst: number;
  gstRate: number;
  overdue: boolean;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SchedulerInvoiceLine = {
  id: string;
  invoiceId: string;
  sortOrder: number;
  description: string;
  quantity: number;
  unitAmountExGst: number;
  lineTotalExGst: number;
  showQuantityAndRate: boolean;
  expenseId: string | null;
  kind: SchedulerInvoiceLineKind;
  category: FinanceExpenseCategory | null;
  financeId: string;
};

export type SchedulerInvoiceJob = {
  financeId: string;
  sortOrder: number;
  source: {
    sourceApp: FinanceSourceApp;
    sourceType: FinanceSourceType;
    sourceId: string;
  };
  job: {
    jobName: string;
    jobDate: string;
    clientName: string | null;
    siteName: string;
    siteAddress: string | null;
    status: string;
  };
  currentStatus: string;
  billingReference: string | null;
  subtotalExGst: number;
  lines: SchedulerInvoiceLine[];
};

export type SchedulerGlobalInvoiceListItem = SchedulerInvoiceListItem & {
  financeIds: string[];
  jobCount: number;
  jobNames: string[];
  sourceApps: FinanceSourceApp[];
  billToName: string;
};

export type SchedulerInvoicePage = {
  items: SchedulerGlobalInvoiceListItem[];
  nextCursor: string | null;
};

export type SchedulerInvoice = SchedulerInvoiceListItem & {
  notes: string | null;
  sellerName: string;
  sellerAbn: string | null;
  sellerAddress: string | null;
  sellerEmail: string | null;
  createdByUserId: string | null;
  createdByDisplayName: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  billToName: string;
  billToAddress: string | null;
  billToEmail: string | null;
  billToAbn: string | null;
  purchaseOrderReference: string | null;
  financeIds: string[];
  jobCount: number;
  jobNames: string[];
  sourceApps: FinanceSourceApp[];
  jobs: SchedulerInvoiceJob[];
  job: {
    jobName: string;
    jobDate: string;
    sourceApp: FinanceSourceApp;
    sourceType: FinanceSourceType;
    sourceId: string;
    clientName: string | null;
    siteName: string;
    siteAddress: string | null;
    status: string;
  };
  lines: SchedulerInvoiceLine[];
};

export type SchedulerFinancialSummary = {
  financeId: string;
  source: {
    sourceApp: FinanceSourceApp;
    sourceType: FinanceSourceType;
    sourceId: string;
  };
  event: {
    id: string;
    title: string;
    sourceApp: FinanceSourceApp;
    sourceType: FinanceSourceType;
    sourceId: string;
    status: string;
  } | null;
  job: {
    jobName: string;
    jobDate: string;
    clientName: string | null;
    siteName: string;
    siteAddress: string | null;
    status: string;
  };
  amountBasis: 'ex_gst';
  currency: string;
  pricing: {
    mode: FinancePricingMode;
    quotedAmount: number | null;
    notes: string | null;
  };
  billing: {
    name: string | null;
    address: string | null;
    email: string | null;
    abn: string | null;
    reference: string | null;
  };
  invoiceReadiness: {
    completionSatisfied: boolean;
    completionBasis: 'job' | null;
    hoursSatisfied: boolean;
    hoursBasis: 'app_time' | 'admin_override' | null;
    ready: boolean;
  };
  time: {
    scheduledHours: number;
    actualHours: number;
    actualMilliseconds: number;
    restingHours: number;
    restingMilliseconds: number;
    actualSource: 'active_sessions';
    billableHours: number;
    billableHoursOverride: number | null;
    billableHoursSource: 'default_zero' | 'override';
    costHours: number;
    costHoursOverride: number | null;
    costHoursSource: 'default_zero' | 'override';
    overrideSource: 'admin' | 'legacy_estimate' | null;
    needsHoursReview: boolean;
    billableRate: number | null;
    costRate: number;
    labourRevenue: number;
    labourCost: number;
    hoursVariance: number;
    commercialHoursVariance: number;
    overrideReason: string | null;
    overriddenAt: string | null;
    overriddenBy: { userId: string; displayName: string | null } | null;
    actors: Array<{
      userId: string;
      displayName: string | null;
      activeMilliseconds: number;
      restingMilliseconds: number;
      hours: number;
      restingHours: number;
      billingRate: number | null;
      labourAmount: number | null;
      billingRateEditable: boolean;
    }>;
    missingBillingRateUsers: Array<{
      userId: string;
      displayName: string | null;
    }>;
  };
  expenses: FinanceExpense[];
  invoices: SchedulerInvoiceListItem[];
  totals: {
    billableAmount: number;
    totalCost: number;
    invoicedAmount: number;
    reservedAmount: number;
    uninvoicedAmount: number;
    grossProfit: number;
    marginPct: number | null;
    labourRevenue: number;
    labourCost: number;
    expenseRevenue: number;
    expenseCost: number;
    unbilledAmount: number;
    unbilledQuoteBalance: number;
  };
};

export type UpdateSchedulerFinanceInput = {
  pricingMode?: FinancePricingMode;
  quotedAmount?: number | null;
  currency?: string;
  notes?: string | null;
  billableHoursOverride?: number | null;
  costHoursOverride?: number | null;
  costRate?: number;
  overrideReason?: string | null;
  billingName?: string | null;
  billingAddress?: string | null;
  billingEmail?: string | null;
  billingAbn?: string | null;
  billingReference?: string | null;
};

export type QuickSchedulerInvoiceInput = {
  expenseIds?: string[];
  includeLabour?: boolean;
  notes?: string | null;
};

export type UpdateSchedulerInvoiceInput = {
  expectedUpdatedAt: string;
  notes?: string | null;
  dueDate?: string | null;
  billToName?: string;
  billToAddress?: string | null;
  billToEmail?: string | null;
  billToAbn?: string | null;
  purchaseOrderReference?: string | null;
  lines?: Array<{
    id?: string;
    description: string;
    quantity: number;
    unitAmountExGst: number;
    showQuantityAndRate?: boolean;
    expenseId?: string | null;
    kind?: SchedulerInvoiceLineKind;
    financeId?: string;
  }>;
};

export type SchedulerInvoiceEligibilityIssue = {
  code:
    | 'mixed_currency'
    | 'billing_name_missing'
    | 'bill_to_override_required'
    | 'job_not_completed'
    | 'hours_entry_required'
    | 'billing_rate_missing'
    | 'no_available_charges';
  message: string;
  financeId: string | null;
};

export type SchedulerInvoiceEligibilityJob = {
  financeId: string;
  source: {
    sourceApp: FinanceSourceApp;
    sourceType: FinanceSourceType;
    sourceId: string;
  };
  job: {
    jobName: string;
    jobDate: string;
    clientName: string | null;
    siteName: string;
    siteAddress: string | null;
    status: string;
  };
  currency: string;
  billing: {
    name: string | null;
    address: string | null;
    email: string | null;
    abn: string | null;
    reference: string | null;
  };
  pricingMode: FinancePricingMode;
  invoiceReadiness: SchedulerFinancialSummary['invoiceReadiness'];
  availableLabourHours: number;
  billableRate: number | null;
  availableLabourAmount: number;
  availableQuotedAmount: number;
  availableExpenses: FinanceExpense[];
};

export type SchedulerInvoiceEligibility = {
  eligible: boolean;
  commonCurrency: string | null;
  gstRate: number;
  requiresExplicitBillTo: boolean;
  issues: SchedulerInvoiceEligibilityIssue[];
  jobs: SchedulerInvoiceEligibilityJob[];
};

export type ConsolidatedSchedulerInvoiceInput = {
  jobs: Array<{
    financeId: string;
    includeLabour: boolean;
    expenseIds: string[];
  }>;
  billTo?: {
    name: string;
    address?: string | null;
    email?: string | null;
    abn?: string | null;
    purchaseOrderReference?: string | null;
  };
  notes?: string | null;
};

export type SchedulerPortfolioCurrencySummary = {
  currency: string;
  billableAmount: number;
  totalCost: number;
  invoicedAmount: number;
  reservedAmount: number;
  unbilledAmount: number;
  grossProfit: number;
  marginPct: number | null;
  actualHours: number;
  billableHours: number;
  costHours: number;
};

export type SchedulerPortfolioSummary = {
  complete: true;
  jobCount: number;
  statusCounts: Record<SchedulerInvoiceStatus | 'overdue', number>;
  currencies: SchedulerPortfolioCurrencySummary[];
};

export type SchedulerFinanceView = 'financial-summary' | 'bills' | 'invoices';

export type SchedulerFinanceTarget = {
  financeId?: string;
  eventId?: string;
  sourceApp?: FinanceSourceApp;
  sourceId?: string;
  invoiceId?: string;
  view?: SchedulerFinanceView;
};
