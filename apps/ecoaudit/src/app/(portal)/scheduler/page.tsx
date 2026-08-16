import SchedulerPage, { type SchedulerTab } from '@/modules/scheduler/pages/SchedulerPage';
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
  const tabValue = value(params.tab);
  const initialTab: SchedulerTab = tabValue === 'overview'
    || tabValue === 'deadlines'
    || tabValue === 'finance'
    ? tabValue
    : 'calendar';
  const sourceAppValue = value(params.sourceApp);
  const sourceApp: FinanceSourceApp | undefined = sourceAppValue === 'ecoaudit'
    || sourceAppValue === 'solarsense'
    || sourceAppValue === 'installhub'
    ? sourceAppValue
    : undefined;

  return (
    <SchedulerPage
      initialTab={initialTab}
      initialFinanceTarget={initialTab === 'finance' ? {
        financeId: value(params.financeId),
        eventId: value(params.eventId),
        sourceApp,
        sourceId: value(params.sourceId),
        invoiceId: value(params.invoiceId),
      } : undefined}
    />
  );
}
