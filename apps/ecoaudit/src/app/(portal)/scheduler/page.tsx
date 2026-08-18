import SchedulerPage, { type SchedulerTab } from '@/modules/scheduler/pages/SchedulerPage';
import {
  schedulerFlagEnabled,
  schedulerVisibleFinanceSourceApps,
  schedulerVisibleSourceApps,
} from '@/modules/scheduler/lib/visibility';
import type { FinanceSourceApp } from '@/modules/scheduler/types/domain';

function value(input: string | string[] | undefined): string | undefined {
  return Array.isArray(input) ? input[0] : input;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const visibleSourceApps = schedulerVisibleSourceApps(schedulerFlagEnabled(
    process.env.SCHEDULER_HIDE_ECOAUDIT_SOLARSENSE_JOBS,
  ));
  const visibleFinanceSourceApps = schedulerVisibleFinanceSourceApps(visibleSourceApps);
  const tabValue = value(params.tab);
  const invoiceId = value(params.invoiceId);
  const initialTab: SchedulerTab = tabValue === 'overview'
    || tabValue === 'deadlines'
    || tabValue === 'financial-summary'
    || tabValue === 'bills'
    || tabValue === 'invoices'
    ? tabValue
    : tabValue === 'finance'
      ? invoiceId
        ? 'invoices'
        : 'financial-summary'
    : 'calendar';
  const sourceAppValue = value(params.sourceApp);
  const parsedSourceApp: FinanceSourceApp | undefined = sourceAppValue === 'ecoaudit'
    || sourceAppValue === 'solarsense'
    || sourceAppValue === 'installhub'
    ? sourceAppValue
    : undefined;
  const sourceApp = parsedSourceApp && visibleFinanceSourceApps.includes(parsedSourceApp)
    ? parsedSourceApp
    : undefined;
  const sourceId = sourceApp ? value(params.sourceId) : undefined;

  return (
    <SchedulerPage
      initialTab={initialTab}
      visibleSourceApps={visibleSourceApps}
      initialFinanceTarget={initialTab === 'financial-summary' || initialTab === 'bills' || initialTab === 'invoices' ? {
        financeId: value(params.financeId),
        eventId: value(params.eventId),
        sourceApp,
        sourceId,
        invoiceId,
        view: initialTab,
      } : undefined}
    />
  );
}
