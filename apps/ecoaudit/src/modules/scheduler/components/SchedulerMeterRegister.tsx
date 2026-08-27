'use client';

import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { Card, EmptyState, ErrorBanner, Spinner } from '@/components/ui/Card';
import { FieldHint, FieldLabel, Input } from '@/components/ui/FormFields';
import { useSchedulerMeterRegister } from '@/modules/scheduler/hooks/useScheduler';

function installedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return 'Date unavailable';
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function SchedulerMeterRegister() {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search.trim());
  const register = useSchedulerMeterRegister(deferredSearch);

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <h2 className="font-extrabold text-[var(--text)]">Installed Meter Register</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">Meters transferred from Field inventory when an installation is completed.</p>
          </div>
          <div className="w-full lg:max-w-md">
            <FieldLabel className="!mt-0" htmlFor="meter-register-search">Search meters</FieldLabel>
            <Input
              id="meter-register-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Device, client, site, address, or job number"
            />
            <FieldHint>Searches the current installed-meter register.</FieldHint>
          </div>
        </div>
      </Card>

      {register.isLoading ? <Spinner label="Loading installed meters…" /> : null}
      {register.isError ? <ErrorBanner message="The installed meter register could not be loaded." /> : null}
      {register.data && register.data.items.length === 0 ? (
        <EmptyState
          title={deferredSearch ? 'No installed meters match this search' : 'No installed meters yet'}
          description={deferredSearch ? 'Try a device ID, client, site, address, or job number.' : 'Completed Field installations will add their meters here.'}
        />
      ) : null}
      {register.data && register.data.items.length > 0 ? (
        <Card className="!p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-5 py-4 sm:px-6">
            <div>
              <h2 className="font-extrabold text-[var(--text)]">{register.data.total} installed meter{register.data.total === 1 ? '' : 's'}</h2>
              {register.data.truncated ? <p className="mt-1 text-xs text-[var(--text-sub)]">Showing the first 500 matches. Refine the search to narrow the register.</p> : null}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-left text-sm">
              <thead className="bg-[var(--surface2)] text-xs uppercase tracking-[0.06em] text-[var(--muted)]">
                <tr>
                  <th className="px-5 py-3 font-extrabold sm:px-6">Device ID</th>
                  <th className="px-4 py-3 font-extrabold">Meter</th>
                  <th className="px-4 py-3 font-extrabold">Client</th>
                  <th className="px-4 py-3 font-extrabold">Site</th>
                  <th className="px-4 py-3 font-extrabold">Job number</th>
                  <th className="px-4 py-3 font-extrabold">Installed</th>
                  <th className="px-5 py-3 text-right font-extrabold sm:px-6">Installation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {register.data.items.map((meter) => (
                  <tr key={meter.inventoryMeterId}>
                    <td className="px-5 py-4 font-extrabold text-[var(--text)] sm:px-6">{meter.deviceId}</td>
                    <td className="px-4 py-4"><span className="block font-bold text-[var(--text)]">{meter.meterName}</span><span className="text-xs text-[var(--text-sub)]">{meter.deviceModel}</span></td>
                    <td className="px-4 py-4 text-[var(--text-sub)]">{meter.clientName}</td>
                    <td className="max-w-xs px-4 py-4"><span className="block font-bold text-[var(--text)]">{meter.siteName}</span><span className="block truncate text-xs text-[var(--text-sub)]" title={meter.siteAddress}>{meter.siteAddress}</span></td>
                    <td className="px-4 py-4 text-[var(--text-sub)]">{meter.customJobNumber || '—'}</td>
                    <td className="px-4 py-4 text-[var(--text-sub)]">{installedDate(meter.installedAt)}</td>
                    <td className="px-5 py-4 text-right sm:px-6"><Link className="font-bold text-[var(--primary)] hover:underline" href={`/installhub/installations/${encodeURIComponent(meter.installationId)}`}>Open</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
