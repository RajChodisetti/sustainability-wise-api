'use client';

import { Card, PageHeader } from '@/components/ui/Card';

export default function SchedulerPage() {
  return (
    <div className="max-w-xl">
      <PageHeader title="Scheduler" subtitle="Plan and manage audit visits" />
      <Card className="text-center">
        <p className="text-2xl font-bold text-[var(--primary)]">Coming Soon</p>
        <p className="mt-2 text-sm text-[var(--text-sub)]">
          Scheduling for energy audits is on the way. Check back later.
        </p>
      </Card>
    </div>
  );
}
