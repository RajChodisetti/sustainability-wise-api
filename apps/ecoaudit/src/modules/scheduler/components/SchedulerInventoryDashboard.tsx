'use client';

import { Card, EmptyState, ErrorBanner, Spinner, StatCard } from '@/components/ui/Card';
import { useSchedulerInventory } from '@/modules/scheduler/hooks/useScheduler';

export function SchedulerInventoryDashboard() {
  const inventory = useSchedulerInventory();
  if (inventory.isLoading) return <Spinner label="Loading meter inventory…" />;
  if (inventory.isError || !inventory.data) {
    return <ErrorBanner message="Meter inventory could not be loaded." />;
  }
  const summary = inventory.data;
  const installedMeters = summary.installedMeters ?? 0;
  const totalTrackedMeters = summary.totalTrackedMeters ?? (
    summary.totalMetersInInventory + installedMeters
  );
  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total tracked meters" value={totalTrackedMeters} icon="gauge" />
        <StatCard label="Available inventory" value={summary.totalMetersInInventory} icon="grid" />
        <StatCard label="Company stock" value={summary.companyMeters} icon="clipboard" tone="success" />
        <StatCard label="Meters with users" value={summary.userMeters} icon="users" tone="warning" />
      </div>
      <Card className="!p-4 sm:!p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-extrabold text-[var(--text)]">Meter custody lifecycle</h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">
              Available inventory excludes meters already transferred to an installation.
            </p>
          </div>
          <div className="rounded-[var(--radius-sm)] bg-[var(--primary-soft)] px-4 py-3 text-right">
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">Installed from register</p>
            <p className="mt-1 text-2xl font-extrabold text-[var(--primary)]">{installedMeters}</p>
          </div>
        </div>
      </Card>
      {summary.users.length === 0 ? (
        <EmptyState
          title="No meters are assigned to users"
          description="Meters registered in company stock or assigned from the Field App will appear here."
        />
      ) : (
        <Card className="!p-0">
          <div className="border-b border-[var(--border)] px-5 py-4 sm:px-6">
            <h2 className="font-extrabold text-[var(--text)]">User inventory</h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">Current meter custody before installation.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="bg-[var(--surface2)] text-xs uppercase tracking-[0.06em] text-[var(--muted)]">
                <tr>
                  <th className="px-5 py-3 font-extrabold sm:px-6">User</th>
                  <th className="px-5 py-3 font-extrabold">Email</th>
                  <th className="px-5 py-3 text-right font-extrabold sm:px-6">Meters</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {summary.users.map((user) => (
                  <tr key={user.userId}>
                    <td className="px-5 py-4 font-bold text-[var(--text)] sm:px-6">{user.name}</td>
                    <td className="px-5 py-4 text-[var(--text-sub)]">{user.email}</td>
                    <td className="px-5 py-4 text-right text-lg font-extrabold text-[var(--primary)] sm:px-6">
                      {user.meterCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
