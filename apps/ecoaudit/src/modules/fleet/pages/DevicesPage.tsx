'use client';

import { useDeferredValue, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import { FleetStatusBadge, ProcessStatusBadge } from '@/modules/fleet/components/FleetStatusBadge';
import { tableCellClass, tableClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { useFleetClients, useFleetDevices } from '@/modules/fleet/hooks/useFleet';
import { groupFleetDevices, type DeviceGroupBy } from '@/modules/fleet/lib/deviceList';
import { formatDate, formatDateTime, formatNumber } from '@/modules/fleet/lib/format';
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
  const initialMeterRegister = searchParams.get('meterRegister');
  const [meterRegister, setMeterRegister] = useState<'' | 'true' | 'false'>(
    initialMeterRegister === 'true' || initialMeterRegister === 'false' ? initialMeterRegister : '',
  );
  const initialGroupBy = searchParams.get('groupBy');
  const [groupBy, setGroupBy] = useState<DeviceGroupBy>(
    initialGroupBy === 'client' || initialGroupBy === 'site' ? initialGroupBy : '',
  );
  const [offset, setOffset] = useState(0);

  const clientsQuery = useFleetClients();
  const devicesQuery = useFleetDevices({
    q: deferredSearch,
    status,
    clientId,
    maas,
    model: model.trim(),
    meterRegister,
    groupBy,
    limit: pageSize,
    offset,
    sort: 'label',
    direction: 'asc',
  });
  const clients = clientsQuery.data?.data ?? [];
  const devices = devicesQuery.data?.data ?? [];
  const total = devicesQuery.data?.meta?.total ?? 0;
  const run = devicesQuery.data?.run;
  const firstItem = total === 0 ? 0 : offset + 1;
  const lastItem = Math.min(offset + pageSize, total);
  const deviceGroups = groupFleetDevices(devices, groupBy);

  function resetPage() {
    setOffset(0);
  }

  function clearFilters() {
    setSearch('');
    setStatus('');
    setClientId('');
    setMaas('');
    setModel('');
    setMeterRegister('');
    setGroupBy('');
    setOffset(0);
  }

  if (devicesQuery.isLoading && !devicesQuery.data) {
    return <Spinner label="Loading fleet devices…" />;
  }

  return (
    <div>
      <PageHeader
        title="Devices"
        subtitle="Browse registered Wattwatchers devices and their latest published condition."
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
            Condition
            <Select className="mt-1.5" value={status} onChange={(event) => { setStatus(event.target.value); resetPage(); }}>
              <option value="">All statuses</option>
              {FLEET_STATUSES.map((value) => (
                <option key={value} value={value}>{value.charAt(0).toUpperCase() + value.slice(1)}</option>
              ))}
            </Select>
          </label>
          <label className="block text-xs font-bold text-[var(--text-sub)]">
            Fleet account
            <Select className="mt-1.5" value={clientId} onChange={(event) => { setClientId(event.target.value); resetPage(); }}>
              <option value="">All Fleet accounts</option>
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
            Excel Meter Register
            <Select className="mt-1.5" value={meterRegister} onChange={(event) => { setMeterRegister(event.target.value as typeof meterRegister); resetPage(); }}>
              <option value="">All devices</option>
              <option value="true">Excel devices only</option>
              <option value="false">Not in Excel</option>
            </Select>
          </label>
          <label className="block text-xs font-bold text-[var(--text-sub)]">
            Group devices by
            <Select className="mt-1.5" value={groupBy} onChange={(event) => { setGroupBy(event.target.value as DeviceGroupBy); resetPage(); }}>
              <option value="">No grouping</option>
              <option value="client">Client</option>
              <option value="site">Site</option>
            </Select>
          </label>
          <div className="flex items-end">
            <Button variant="ghost" className="shrink-0" onClick={clearFilters}>Clear</Button>
          </div>
        </fieldset>
      </Card>

      <div className="mb-4 text-sm text-[var(--text-sub)]">
        <p aria-live="polite">
          <span className="font-bold text-[var(--text)]">{formatNumber(total)}</span> devices
          {run ? ` in the ${formatDate(run.reportingDate)} snapshot` : ''}
        </p>
      </div>

      {devices.length === 0 && !devicesQuery.error ? (
        <EmptyState
          icon="gauge"
          title="No devices match these filters"
          description="Clear one or more filters, or wait for a complete fleet snapshot to be published."
          actions={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
        />
      ) : devices.length > 0 ? (
        <Card className="min-w-0 !p-0">
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Registered Wattwatchers devices with customer, site, Fleet account, model and latest published condition</caption>
              <thead>
                <tr>
                  <th className={tableHeadClass} scope="col">Device</th>
                  <th className={tableHeadClass} scope="col">Client</th>
                  <th className={tableHeadClass} scope="col">Site ID</th>
                  <th className={tableHeadClass} scope="col">Site address</th>
                  <th className={tableHeadClass} scope="col">Fleet account / API key</th>
                  <th className={tableHeadClass} scope="col">Model</th>
                  <th className={tableHeadClass} scope="col">Condition at last scan</th>
                </tr>
              </thead>
              <tbody>
                {deviceGroups.flatMap((group) => [
                  ...(groupBy ? [(
                    <tr key={`group-${group.key}`} className="bg-[var(--surface2)]">
                      <th colSpan={7} scope="rowgroup" className="px-4 py-3 text-left text-sm font-extrabold text-[var(--text)]">
                        {group.label} <span className="ml-1 font-semibold text-[var(--text-sub)]">({formatNumber(group.devices.length)} on this page)</span>
                      </th>
                    </tr>
                  )] : []),
                  ...group.devices.map((device) => {
                  const placement = device.currentPlacement;
                  const accounts = device.fleetAccounts ?? [];
                  return (
                  <tr key={device.deviceId} className="hover:bg-[var(--surface2)]/70">
                    <td className={tableCellClass}>
                      <Link
                        href={`/fleet/devices/${encodeURIComponent(device.deviceId)}`}
                        className="font-bold text-[var(--primary)] hover:underline"
                      >
                        {device.label || device.deviceId}
                      </Link>
                      {device.label ? <p className="mt-1 max-w-52 break-all text-xs text-[var(--muted)]">{device.deviceId}</p> : null}
                      {device.inMeterRegister ? (
                        <span className="mt-2 inline-flex rounded-full bg-[var(--primary-soft)] px-2 py-0.5 text-xs font-bold text-[var(--primary)]">
                          Excel · {formatNumber(device.meterRegisterEntryCount ?? 1)} {device.meterRegisterEntryCount === 1 ? 'row' : 'rows'}
                        </span>
                      ) : null}
                    </td>
                    <td className={`${tableCellClass} min-w-44`}>
                      {placement ? (
                        <Link
                          href={`/fleet/clients/${encodeURIComponent(placement.businessClient.id)}`}
                          className="font-bold text-[var(--primary)] hover:underline"
                        >
                          {placement.businessClient.name}
                        </Link>
                      ) : (
                        <span className="text-[var(--text-sub)]">Not linked</span>
                      )}
                      {device.placementConflict ? (
                        <p className="mt-1 text-xs font-bold text-[var(--amber)]">Placement conflict</p>
                      ) : null}
                    </td>
                    <td className={`${tableCellClass} min-w-40`}>
                      {placement?.site ? (
                        <Link
                          href={`/fleet/sites/${encodeURIComponent(placement.site.id)}`}
                          className="break-all font-bold text-[var(--primary)] hover:underline"
                        >
                          {placement.site.id}
                        </Link>
                      ) : <span className="text-[var(--text-sub)]">—</span>}
                    </td>
                    <td className={`${tableCellClass} min-w-64 max-w-80 whitespace-normal`}>
                      {placement?.site?.address || 'Not recorded'}
                    </td>
                    <td className={`${tableCellClass} min-w-56`}>
                      {accounts.length ? (
                        <ul className="space-y-2">
                          {accounts.map((account) => (
                            <li key={account.id}>
                              <span className="block font-semibold text-[var(--text)]">{account.name}</span>
                              <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${
                                account.apiKeyConfigured
                                  ? 'bg-[var(--green-soft)] text-[var(--green)]'
                                  : 'bg-[var(--amber-soft)] text-[var(--amber)]'
                              }`}>
                                {account.apiKeyConfigured ? 'API key configured' : 'API key not added'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : <span className="text-[var(--text-sub)]">No Fleet account</span>}
                    </td>
                    <td className={`${tableCellClass} font-semibold`}>{device.model || 'N/A'}</td>
                    <td className={`${tableCellClass} min-w-44`}>
                      {device.fetchStatus === 'not_collected' ? (
                        <>
                          <ProcessStatusBadge status="Not collected" />
                          <p className="mt-1 text-xs text-[var(--text-sub)]">Awaiting a published collection</p>
                        </>
                      ) : (
                        <>
                          <FleetStatusBadge status={device.status as FleetStatus} />
                          <p className="mt-1 whitespace-nowrap text-xs text-[var(--text-sub)]">
                            Observed {formatDateTime(device.observedAt)}
                          </p>
                        </>
                      )}
                    </td>
                  </tr>
                  );
                  }),
                ])}
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
