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
  byApp: Record<ScheduleSourceApp, number>;
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
  key: string;
  fieldUserId: string;
  label: string;
  email: string;
  role: string;
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

export type FinanceOverviewItem = {
  financeId: string;
  sourceApp: FinanceSourceApp;
  sourceType: FinanceSourceType;
  sourceId: string;
  eventId: string | null;
  jobName: string;
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
  createdAt: string;
  updatedAt: string;
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
  expenseId: string | null;
  kind: SchedulerInvoiceLineKind;
  category: FinanceExpenseCategory | null;
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
  purchaseOrderReference: string | null;
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
    reference: string | null;
  };
  time: {
    scheduledHours: number;
    actualHours: number;
    actualMilliseconds: number;
    actualSource: 'active_sessions';
    billableHours: number;
    billableHoursOverride: number | null;
    billableHoursSource: 'actual' | 'override';
    costHours: number;
    costHoursOverride: number | null;
    costHoursSource: 'actual' | 'override';
    overrideSource: 'admin' | 'legacy_estimate' | null;
    needsHoursReview: boolean;
    billableRate: number;
    costRate: number;
    labourRevenue: number;
    labourCost: number;
    hoursVariance: number;
    commercialHoursVariance: number;
    overbilledHours: number;
    overrideReason: string | null;
    overriddenAt: string | null;
    overriddenBy: { userId: string; displayName: string | null } | null;
    actors: Array<{
      userId: string;
      displayName: string | null;
      activeMilliseconds: number;
      hours: number;
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
  pricingMode: FinancePricingMode;
  quotedAmount: number | null;
  currency: string;
  notes?: string | null;
  billableHoursOverride: number | null;
  costHoursOverride: number | null;
  billableRate: number;
  costRate: number;
  overrideReason?: string | null;
  billingName: string | null;
  billingAddress: string | null;
  billingEmail: string | null;
  billingReference: string | null;
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
  purchaseOrderReference?: string | null;
  lines?: Array<{
    id?: string;
    description: string;
    quantity: number;
    unitAmountExGst: number;
    expenseId?: string | null;
    kind?: SchedulerInvoiceLineKind;
  }>;
};

export type SchedulerFinanceTarget = {
  financeId?: string;
  eventId?: string;
  sourceApp?: FinanceSourceApp;
  sourceId?: string;
  invoiceId?: string;
};
