import { redirect } from 'next/navigation';
import { schedulerFinanceHref } from '@/modules/scheduler/lib/finance';

export default async function Page({ params }: { params: Promise<{ installationId: string; invoiceId: string }> }) {
  const { installationId, invoiceId } = await params;
  redirect(schedulerFinanceHref({ sourceApp: 'installhub', sourceId: installationId, invoiceId }));
}
