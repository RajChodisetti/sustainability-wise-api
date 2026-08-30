export const DEFAULT_SCHEDULER_ANALYTICS_TIMEZONE = 'Australia/Sydney';
export const MAX_SCHEDULER_ANALYTICS_DAYS = 366;

export type SchedulerAnalyticsFilters = {
  from: string;
  to: string;
  timezone: string;
};

export type SchedulerAnnualTarget = {
  year: number;
  amountExGstCents: number;
  currency: string;
  updatedAt: string;
};

export type SchedulerMoneyMetric = {
  amountExGstCents: number;
  gstAmountCents: number | null;
  totalIncGstCents: number | null;
  count: number;
};

export type SchedulerAnalyticsRevenueBasis =
  | 'invoiceCreated'
  | 'issued'
  | 'paid'
  | 'voided'
  | 'refunded'
  | 'refundReversed'
  | 'netPaid'
  | 'completedWork';

export type SchedulerAnalyticsCurrencyMetrics = {
  currency: string;
  invoiceCreated: SchedulerMoneyMetric;
  issued: SchedulerMoneyMetric;
  paid: SchedulerMoneyMetric;
  voided: SchedulerMoneyMetric;
  refunded: SchedulerMoneyMetric;
  refundReversed: SchedulerMoneyMetric;
  netPaid: SchedulerMoneyMetric;
  completedWork: SchedulerMoneyMetric;
};

export type SchedulerAnalyticsLeaderboardRow = {
  rank: number;
  userId: string;
  fieldUserId: string;
  displayName: string;
  email: string;
  timezone: string;
  workingDaysMask: number;
  scheduledWorkingDays: number;
  approvedLeaveWorkingDays: number;
  workingDays: number;
  workingHoursOnSite: number;
  workingHoursOnSiteMilliseconds: number;
  sitesWorked?: number;
  averageHoursOnSitePerSite?: number;
  averageWorkingHoursOnSitePerWorkingDay: number;
  completedJobs: number;
  averageDailyJobs: number;
  scheduledJobs: number;
  unscheduledJobs: number;
  backlogJobs: number;
  futureScheduledJobs?: number;
  pipelineJobs0To7Days: number;
  pipelineJobs8To30Days: number;
  revenue: SchedulerAnalyticsCurrencyMetrics[];
  attribution: {
    workingSessionCount: number;
    completionFactJobs: number;
    schedulerEventJobs: number;
    productAssignmentJobs: number;
  };
};

export type SchedulerAnalyticsDto = {
  complete: true;
  window: {
    from: string;
    to: string;
    timezone: string;
    startAtUtc: string;
    endAtUtcExclusive: string;
    dayCount: number;
  };
  financials: {
    currencies: SchedulerAnalyticsCurrencyMetrics[];
    daily: Array<{
      date: string;
      currencies: SchedulerAnalyticsCurrencyMetrics[];
    }>;
  };
  operations?: {
    completedJobsByType: Record<
      'installs' | 'faults' | 'upgrades' | 'audits' | 'other',
      number
    >;
    completedJobsByOperationalType?: Record<
      'newMaasInstalls' | 'otherInstalls' | 'communicationsFaults' | 'replacements' | 'other',
      number
    >;
    newMetersEstablished: number;
    newMeters?: {
      maas: number;
      general: number;
      unclassified: number;
      unattributed: number;
      byStaff: Array<{
        userId: string;
        displayName: string;
        email: string;
        total: number;
        maas: number;
        general: number;
        unclassified: number;
      }>;
    };
    staffCount: number;
    averageDailyJobsPerStaff: number;
    averageHoursOnSitePerEmployee: number;
    pipelineUpcomingWeek: number;
    totalScheduled?: number;
  };
  leaderboard: SchedulerAnalyticsLeaderboardRow[];
  quality: {
    sessions: {
      included: number;
      unattributed: number;
      unattributedActiveMilliseconds: number;
    };
    completedJobs: {
      total: number;
      completionFact: number;
      schedulerEvent: number;
      productAssignment: number;
      unattributed: number;
    };
    completedWorkRevenue: {
      snapshotCapturedJobs: number;
      snapshotIncompleteJobs: number;
      snapshotUnavailableJobs: number;
      historicalRevenueUnavailableJobs: number;
      undatedCompletedJobs: number;
    };
    financialAllocation: {
      zeroWeightDocuments: number;
      unattributedDocuments: number;
    };
    unattributed: {
      workingHoursOnSiteMilliseconds: number;
      completedJobs: number;
      scheduledJobs: number;
      unscheduledJobs: number;
      backlogJobs: number;
      pipelineJobs0To7Days: number;
      pipelineJobs8To30Days: number;
      revenue: SchedulerAnalyticsCurrencyMetrics[];
    };
  };
  definitions: {
    workingHoursOnSite: string;
    sessionWindowRule: string;
    averageDailyJobs: string;
    scheduledJobs: string;
    unscheduledJobs: string;
    completedWorkRevenue: string;
    invoiceCreated: string;
    issued: string;
    paid: string;
    voided: string;
    refunded: string;
    refundReversed: string;
    netPaid: string;
    technicianAttribution: string;
    leaderboardRanking: string;
    workingDays: string;
    backlog: string;
    pipeline0To7Days: string;
    pipeline8To30Days: string;
    currency: string;
  };
  limits: {
    maximumWindowDays: number;
    completionFinanceConcurrency: number;
  };
};
