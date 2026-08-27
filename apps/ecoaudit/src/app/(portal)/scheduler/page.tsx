import SchedulerPage from '@/modules/scheduler/pages/SchedulerPage';
import { schedulerTabFromQuery } from '@/modules/scheduler/lib/navigation';
import {
  schedulerSelectableSourceApps,
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
  const visibleSourceApps = schedulerVisibleSourceApps();
  const selectableSourceApps = schedulerSelectableSourceApps();
  const visibleFinanceSourceApps = schedulerVisibleFinanceSourceApps(visibleSourceApps);
  const tabValue = value(params.tab);
  const invoiceId = value(params.invoiceId);
  const initialTab = schedulerTabFromQuery(tabValue, invoiceId);
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
      key={[
        initialTab,
        value(params.financeId) ?? '',
        value(params.eventId) ?? '',
        sourceApp ?? '',
        sourceId ?? '',
        invoiceId ?? '',
      ].join(':')}
      initialTab={initialTab}
      visibleSourceApps={visibleSourceApps}
      selectableSourceApps={selectableSourceApps}
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
