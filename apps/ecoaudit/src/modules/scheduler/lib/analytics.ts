import type {
  SchedulerAnalyticsCurrencyMetrics,
  SchedulerAnalyticsRevenueBasis,
  SchedulerMoneyMetric,
} from '@/modules/scheduler/types/analytics';

export const ANALYTICS_REVENUE_BASIS_OPTIONS: ReadonlyArray<{
  value: SchedulerAnalyticsRevenueBasis;
  label: string;
}> = [
  { value: 'completedWork', label: 'Completed-work revenue' },
  { value: 'invoiceCreated', label: 'Invoiced (invoice created)' },
  { value: 'issued', label: 'Issued' },
  { value: 'paid', label: 'Paid' },
  { value: 'netPaid', label: 'Net paid after refunds' },
  { value: 'voided', label: 'Voided' },
  { value: 'refunded', label: 'Refunds posted' },
  { value: 'refundReversed', label: 'Refund reversals' },
];

export function analyticsRevenueBasisLabel(value: SchedulerAnalyticsRevenueBasis): string {
  return ANALYTICS_REVENUE_BASIS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function formatAnalyticsMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

export function findAnalyticsCurrency(
  currencies: SchedulerAnalyticsCurrencyMetrics[],
  currency: string,
): SchedulerAnalyticsCurrencyMetrics | undefined {
  return currencies.find((entry) => entry.currency === currency);
}

export function findAnalyticsMoneyMetric(
  currencies: SchedulerAnalyticsCurrencyMetrics[],
  currency: string,
  basis: SchedulerAnalyticsRevenueBasis,
): SchedulerMoneyMetric | undefined {
  return findAnalyticsCurrency(currencies, currency)?.[basis];
}

export function formatAnalyticsDate(dateKey: string): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  return new Intl.DateTimeFormat('en-AU', {
    day: 'numeric',
    month: 'short',
  }).format(date);
}
