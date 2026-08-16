import { redirect } from 'next/navigation';
import { schedulerFinanceHref } from '@/modules/scheduler/lib/finance';

export default async function Page({ params }: { params: Promise<{ installationId: string }> }) {
  const { installationId } = await params;
  redirect(schedulerFinanceHref({
    view: 'invoices',
    sourceApp: 'installhub',
    sourceId: installationId,
  }));
}
