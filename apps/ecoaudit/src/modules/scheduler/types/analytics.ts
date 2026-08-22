export const DEFAULT_SCHEDULER_ANALYTICS_TIMEZONE = 'Australia/Sydney';
export const MAX_SCHEDULER_ANALYTICS_DAYS = 366;

export type SchedulerAnalyticsFilters = {
  from: string;
  to: string;
  timezone: string;
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
  averageWorkingHoursOnSitePerWorkingDay: number;
  completedJobs: number;
  averageDailyJobs: number;
  backlogJobs: number;
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
