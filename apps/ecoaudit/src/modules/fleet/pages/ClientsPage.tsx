'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import { ProcessStatusBadge } from '@/modules/fleet/components/FleetStatusBadge';
import { tableCellClass, tableClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { useFleetClients } from '@/modules/fleet/hooks/useFleet';
import { formatDate, formatNumber, formatPercent } from '@/modules/fleet/lib/format';

export default function ClientsPage() {
  const query = useFleetClients();
  const [search, setSearch] = useState('');
  const [maas, setMaas] = useState<'all' | 'true' | 'false'>('all');
  const [quality, setQuality] = useState<'all' | 'healthy' | 'issues'>('all');
  const clients = useMemo(() => query.data?.data ?? [], [query.data?.data]);
  const run = query.data?.run;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return clients.filter((client) => {
      const matchesSearch = !needle || client.name.toLowerCase().includes(needle) || client.code.toLowerCase().includes(needle);
      const matchesMaas = maas === 'all' || client.isMaas === (maas === 'true');
      const healthy = ['complete', 'completed', 'success', 'successful', 'published'].includes(client.collectionStatus?.toLowerCase() ?? '');
      const matchesQuality = quality === 'all' || (quality === 'healthy' ? healthy : !healthy || Boolean(client.collectionError));
      return matchesSearch && matchesMaas && matchesQuality;
    });
  }, [clients, maas, quality, search]);

  const totals = useMemo(() => clients.reduce(
    (acc, client) => ({
      devices: acc.devices + client.totalDevices,
      offline: acc.offline + client.offline,
      reportOffline: acc.reportOffline + client.reportOffline,
      collectionIssues: acc.collectionIssues + (client.collectionError ? 1 : 0),
    }),
    { devices: 0, offline: 0, reportOffline: 0, collectionIssues: 0 },
  ), [clients]);

  if (query.isLoading) return <Spinner label="Loading fleet clients…" />;

  return (
    <div>
      <PageHeader
        title="Clients"
        subtitle="Compare client and MaaS fleets using the same latest published snapshot."
        actions={(
          <Button variant="secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>
            <Icon name="activity" size={17} />
            {query.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
      />

      {query.error ? <ErrorBanner message={fleetConnectionErrorMessage(query.error)} /> : null}

      {!query.error && clients.length === 0 ? (
        <EmptyState icon="users" title="No fleet clients yet" description="Client results will appear after a complete collection run is published." />
      ) : clients.length > 0 ? (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard label="Clients" value={formatNumber(clients.length)} icon="users" />
            <StatCard label="Client memberships" value={formatNumber(totals.devices)} icon="gauge" />
            <StatCard label="Offline memberships" value={formatNumber(totals.offline)} icon="wifi-off" tone="danger" />
            <StatCard label="Collection issues" value={formatNumber(totals.collectionIssues)} icon="activity" tone={totals.collectionIssues > 0 ? 'danger' : 'success'} />
          </div>

          <Card className="mb-5 !p-4 sm:!p-5">
            <fieldset className="grid min-w-0 gap-3 sm:grid-cols-3">
              <legend className="sr-only">Client filters</legend>
              <label className="block text-xs font-bold text-[var(--text-sub)]">
                Search client
                <div className="relative mt-1.5">
                  <Icon name="search" size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
                  <Input className="pl-10" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name or code" />
                </div>
              </label>
              <label className="block text-xs font-bold text-[var(--text-sub)]">
                MaaS classification
                <Select className="mt-1.5" value={maas} onChange={(event) => setMaas(event.target.value as typeof maas)}>
                  <option value="all">All clients</option>
                  <option value="true">MaaS clients</option>
                  <option value="false">Non-MaaS clients</option>
                </Select>
              </label>
              <label className="block text-xs font-bold text-[var(--text-sub)]">
                Collection quality
                <Select className="mt-1.5" value={quality} onChange={(event) => setQuality(event.target.value as typeof quality)}>
                  <option value="all">All collection results</option>
                  <option value="healthy">Healthy only</option>
                  <option value="issues">Issues only</option>
                </Select>
              </label>
            </fieldset>
          </Card>

          <div className="mb-4 flex flex-col gap-1 text-sm text-[var(--text-sub)] sm:flex-row sm:items-center sm:justify-between">
            <p aria-live="polite"><span className="font-bold text-[var(--text)]">{formatNumber(filtered.length)}</span> clients shown</p>
            {run ? <p>Snapshot {formatDate(run.reportingDate)}</p> : null}
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon="search" title="No clients match these filters" description="Change the search, MaaS, or collection-quality filter." />
          ) : (
            <Card className="min-w-0 !p-0">
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <caption className="sr-only">Fleet connectivity and collection quality by client</caption>
                  <thead>
                    <tr>
                      <th className={tableHeadClass} scope="col">Client</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Devices</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Availability at scan</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Communicating</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Delayed</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Offline</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Inactive / unknown</th>
                      <th className={`${tableHeadClass} text-right`} scope="col">Report offline</th>
                      <th className={tableHeadClass} scope="col">Collection</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((client) => (
                      <tr key={client.id} className="hover:bg-[var(--surface2)]/70">
                        <td className={tableCellClass}>
                          <Link href={`/fleet/devices?clientId=${encodeURIComponent(client.id)}`} className="font-bold text-[var(--primary)] hover:underline">{client.name}</Link>
                          <p className="mt-1 text-xs text-[var(--text-sub)]">{client.code}</p>
                          {client.isMaas ? <span className="mt-2 inline-flex rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--primary)]">MaaS</span> : null}
                        </td>
                        <td className={`${tableCellClass} text-right font-bold`}>{formatNumber(client.totalDevices)}</td>
                        <td className={`${tableCellClass} min-w-44 text-right`}>
                          <span className="font-bold">{formatPercent(client.availabilityPercent)}</span>
                          <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-[var(--surface2)]" aria-hidden="true">
                            <span className="block h-full bg-[var(--primary)]" style={{ width: `${Math.max(0, Math.min(100, client.availabilityPercent ?? 0))}%` }} />
                          </span>
                        </td>
                        <td className={`${tableCellClass} text-right text-[var(--green)]`}>{formatNumber(client.communicating)}</td>
                        <td className={`${tableCellClass} text-right text-[var(--amber)]`}>{formatNumber(client.delayed)}</td>
                        <td className={`${tableCellClass} text-right font-bold text-[var(--red)]`}>{formatNumber(client.offline)}</td>
                        <td className={`${tableCellClass} text-right`}>{formatNumber(client.inactive + client.unknown)}</td>
                        <td className={`${tableCellClass} text-right`}>{formatNumber(client.reportOffline)}</td>
                        <td className={tableCellClass}>
                          <ProcessStatusBadge status={client.collectionStatus} />
                          {client.collectionError ? <p className="mt-2 max-w-64 text-xs leading-5 text-[var(--red)]">{client.collectionError}</p> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
