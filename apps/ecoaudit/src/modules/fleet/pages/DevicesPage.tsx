'use client';

import { useDeferredValue, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import { FleetStatusBadge } from '@/modules/fleet/components/FleetStatusBadge';
import { tableCellClass, tableClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { useFleetClients, useFleetDevices } from '@/modules/fleet/hooks/useFleet';
import { formatDate, formatDateTime, formatDuration, formatNumber } from '@/modules/fleet/lib/format';
import { FLEET_STATUSES, type FleetStatus } from '@/modules/fleet/types/domain';

const pageSize = 50;

export default function DevicesPage() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState(searchParams.get('q') ?? '');
  const deferredSearch = useDeferredValue(search.trim());
  const [status, setStatus] = useState(searchParams.get('status') ?? '');
  const [clientId, setClientId] = useState(searchParams.get('clientId') ?? '');
  const initialMaas = searchParams.get('maas');
  const [maas, setMaas] = useState<'' | 'true' | 'false'>(
    initialMaas === 'true' || initialMaas === 'false' ? initialMaas : '',
  );
  const [model, setModel] = useState(searchParams.get('model') ?? '');
  const [reportOffline, setReportOffline] = useState<'' | 'true' | 'false'>(
    searchParams.get('reportOffline') === 'true' ? 'true' : '',
  );
  const [sort, setSort] = useState<'lastHeardAt' | 'communicationAge' | 'label'>('communicationAge');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [offset, setOffset] = useState(0);

  const clientsQuery = useFleetClients();
  const devicesQuery = useFleetDevices({
    q: deferredSearch,
    status,
    clientId,
    maas,
    model: model.trim(),
    reportOffline,
    limit: pageSize,
    offset,
    sort,
    direction,
  });
  const clients = clientsQuery.data?.data ?? [];
  const devices = devicesQuery.data?.data ?? [];
  const total = devicesQuery.data?.meta?.total ?? 0;
  const run = devicesQuery.data?.run;
  const firstItem = total === 0 ? 0 : offset + 1;
  const lastItem = Math.min(offset + pageSize, total);

  function resetPage() {
    setOffset(0);
  }

  function clearFilters() {
    setSearch('');
    setStatus('');
    setClientId('');
    setMaas('');
    setModel('');
    setReportOffline('');
    setSort('communicationAge');
    setDirection('desc');
    setOffset(0);
  }

  if (devicesQuery.isLoading && !devicesQuery.data) {
    return <Spinner label="Loading fleet devices…" />;
  }

  return (
    <div>
      <PageHeader
        title="Devices"
        subtitle="Search the latest published fleet snapshot and distinguish current connectivity from the 24-hour report cohort."
        actions={(
          <Button variant="secondary" disabled={devicesQuery.isFetching} onClick={() => void devicesQuery.refetch()}>
            <Icon name="activity" size={17} />
            {devicesQuery.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        )}
      />

      {devicesQuery.error ? (
        <div className="mb-5"><ErrorBanner message={fleetConnectionErrorMessage(devicesQuery.error)} /></div>
      ) : null}

      <Card className="mb-5 !p-4 sm:!p-5">
        <fieldset className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <legend className="sr-only">Device filters</legend>
          <label className="block text-xs font-bold text-[var(--text-sub)]">
            Search device
            <div className="relative mt-1.5">
              <Icon name="search" size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
              <Input
                value={search}
                onChange={(event) => { setSearch(event.target.value); resetPage(); }}
                placeholder="Label or device ID"
                className="pl-10"
              />
            </div>
          </label>
          <label className="block text-xs font-bold text-[var(--text-sub)]">
            Connectivity status
            <Select className="mt-1.5" value={status} onChange={(event) => { setStatus(event.target.value); resetPage(); }}>
              <option value="">All statuses</option>
              {FLEET_STATUSES.map((value) => (
                <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>
              ))}
            </Select>
          </label>
          <label className="block text-xs font-bold text-[var(--text-sub)]">
            Client
            <Select className="mt-1.5" value={clientId} onChange={(event) => { setClientId(event.target.value); resetPage(); }}>
              <option value="">All clients</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>{client.name}{client.isMaas ? ' · MaaS' : ''}</option>
              ))}
            </Select>
          </label>
          <label className="block text-xs font-bold text-[var(--text-sub)]">
            MaaS classification
            <Select className="mt-1.5" value={maas} onChange={(event) => { setMaas(event.target.value as typeof maas); resetPage(); }}>
              <option value="">All devices</option>
              <option value="true">MaaS only</option>
              <option value="false">Non-MaaS only</option>
            </Select>
          </label>
          <label className="block text-xs font-bold text-[var(--text-sub)]">
            Model (exact)
            <Input
              className="mt-1.5"
              value={model}
              onChange={(event) => { setModel(event.target.value); resetPage(); }}
              placeholder="Exact model name"
            />
          </label>
          <label className="block text-xs font-bold text-[var(--text-sub)]">
            Email report cohort
            <Select className="mt-1.5" value={reportOffline} onChange={(event) => { setReportOffline(event.target.value as typeof reportOffline); resetPage(); }}>
              <option value="">All devices</option>
              <option value="true">Report offline only</option>
            </Select>
          </label>
          <label className="block text-xs font-bold text-[var(--text-sub)]">
            Sort by
            <Select className="mt-1.5" value={sort} onChange={(event) => { setSort(event.target.value as typeof sort); resetPage(); }}>
              <option value="communicationAge">Communication age</option>
              <option value="lastHeardAt">Last heard</option>
              <option value="label">Device label</option>
            </Select>
          </label>
          <div className="flex items-end gap-2">
            <label className="min-w-0 flex-1 text-xs font-bold text-[var(--text-sub)]">
              Direction
              <Select className="mt-1.5" value={direction} onChange={(event) => { setDirection(event.target.value as typeof direction); resetPage(); }}>
                <option value="desc">Descending</option>
                <option value="asc">Ascending</option>
              </Select>
            </label>
            <Button variant="ghost" className="shrink-0" onClick={clearFilters}>Clear</Button>
          </div>
        </fieldset>
      </Card>

      <div className="mb-4 flex flex-col gap-2 text-sm text-[var(--text-sub)] sm:flex-row sm:items-center sm:justify-between">
        <p aria-live="polite">
          <span className="font-bold text-[var(--text)]">{formatNumber(total)}</span> devices
          {run ? ` in the ${formatDate(run.reportingDate)} snapshot` : ''}
        </p>
        <p>“Last-known signal” is retained telemetry, not a live signal test.</p>
      </div>

      {devices.length === 0 && !devicesQuery.error ? (
        <EmptyState
          icon="wifi"
          title="No devices match these filters"
          description="Clear one or more filters, or wait for a complete fleet snapshot to be published."
          actions={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
        />
      ) : devices.length > 0 ? (
        <Card className="min-w-0 !p-0">
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Wattwatchers devices in the latest published snapshot</caption>
              <thead>
                <tr>
                  <th className={tableHeadClass} scope="col">Device</th>
                  <th className={tableHeadClass} scope="col">Client</th>
                  <th className={tableHeadClass} scope="col">Status</th>
                  <th className={tableHeadClass} scope="col">Last heard</th>
                  <th className={tableHeadClass} scope="col">Communication age</th>
                  <th className={tableHeadClass} scope="col">Model / firmware</th>
                  <th className={tableHeadClass} scope="col">Last-known signal</th>
                  <th className={tableHeadClass} scope="col">Report cohort</th>
                </tr>
              </thead>
              <tbody>
                {devices.map((device) => (
                  <tr key={`${device.deviceId}-${device.client?.id ?? 'none'}`} className="hover:bg-[var(--surface2)]/70">
                    <td className={tableCellClass}>
                      <Link
                        href={`/fleet/devices/${encodeURIComponent(device.deviceId)}`}
                        className="font-bold text-[var(--primary)] hover:underline"
                      >
                        {device.label || device.deviceId}
                      </Link>
                      {device.label ? <p className="mt-1 max-w-52 break-all text-xs text-[var(--muted)]">{device.deviceId}</p> : null}
                    </td>
                    <td className={tableCellClass}>
                      <p className="font-semibold">{device.client?.name ?? 'Unassigned'}</p>
                      {device.client?.isMaas ? <p className="mt-1 text-xs font-bold text-[var(--primary)]">MaaS</p> : null}
                    </td>
                    <td className={tableCellClass}><FleetStatusBadge status={device.status as FleetStatus} /></td>
                    <td className={`${tableCellClass} whitespace-nowrap`}>{formatDateTime(device.lastHeardAt)}</td>
                    <td className={`${tableCellClass} whitespace-nowrap font-semibold`}>{formatDuration(device.communicationAgeSeconds)}</td>
                    <td className={tableCellClass}>
                      <p>{device.model || '—'}</p>
                      <p className="mt-1 text-xs text-[var(--text-sub)]">{device.firmwareVersion || 'Firmware unknown'}</p>
                    </td>
                    <td className={`${tableCellClass} whitespace-nowrap`}>
                      {typeof device.signalQualityDbm === 'number' ? `${device.signalQualityDbm} dBm` : '—'}
                    </td>
                    <td className={tableCellClass}>
                      {device.reportOffline ? (
                        <span className="inline-flex rounded-full bg-[var(--red-soft)] px-2.5 py-1 text-xs font-bold text-[var(--red)]">Report offline</span>
                      ) : (
                        <span className="text-xs text-[var(--text-sub)]">Not in cohort</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-[var(--text-sub)]">Showing {formatNumber(firstItem)}–{formatNumber(lastItem)} of {formatNumber(total)}</p>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={offset === 0 || devicesQuery.isFetching} onClick={() => setOffset(Math.max(0, offset - pageSize))}>
                Previous
              </Button>
              <Button variant="secondary" disabled={offset + pageSize >= total || devicesQuery.isFetching} onClick={() => setOffset(offset + pageSize)}>
                Next
              </Button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
