'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LinkButton } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import { FleetStatusBadge, ProcessStatusBadge } from '@/modules/fleet/components/FleetStatusBadge';
import { tableCellClass, tableClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { useFleetDevice } from '@/modules/fleet/hooks/useFleet';
import { installHubDrilldownHref, placementSourceLabel } from '@/modules/fleet/lib/drilldowns';
import { formatDate, formatDateTime, formatDuration, humanize } from '@/modules/fleet/lib/format';

const sensitiveMetricPattern = /ssid|imsi|^sim$|sim.?id|mac|^ip$|ip.?address|gateway|subnet|apn|token|secret|api.?key|credential/i;

type ReadableMetric = { key: string; label: string; value: string };

function metricUnit(path: string): string {
  const key = path.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  if (/kwh|kilowatt.?hour/.test(key)) return 'kWh';
  if (/\bkw\b|kilowatt/.test(key)) return 'kW';
  if (/frequency|\bhz\b/.test(key)) return 'Hz';
  if (/voltage|\bvolts?\b/.test(key)) return 'V';
  if (/current|\bamps?\b/.test(key)) return 'A';
  if (/signal.*dbm|\bdbm\b/.test(key)) return 'dBm';
  if (/percent|percentage/.test(key)) return '%';
  return '';
}

function formatMetricValue(path: string, value: string | number | boolean | number[]): string {
  const normalizedPath = path.toLowerCase();
  if (/timestamp|recordedat|sampledat|occurredat|\bat$/.test(normalizedPath)) {
    if (typeof value === 'string') return formatDateTime(value);
    if (typeof value === 'number') {
      // Mercury energy records use Unix seconds while some derived metrics use
      // JavaScript milliseconds. Normalise both before showing the timestamp.
      const epochMilliseconds = value < 100_000_000_000 ? value * 1_000 : value;
      return formatDateTime(new Date(epochMilliseconds).toISOString());
    }
  }
  if (typeof value === 'number' && /duration.*seconds|seconds.*duration|age.*seconds/.test(normalizedPath)) {
    return formatDuration(value);
  }
  const unit = metricUnit(path);
  if (Array.isArray(value)) {
    const formatted = value.map((item) => new Intl.NumberFormat('en-AU', { maximumFractionDigits: 3 }).format(item));
    return `${formatted.join(', ')}${unit ? ` ${unit}` : ''}`;
  }
  if (typeof value === 'number') {
    return `${new Intl.NumberFormat('en-AU', { maximumFractionDigits: 3 }).format(value)}${unit ? ` ${unit}` : ''}`;
  }
  return typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value;
}

function readableMetrics(metrics?: Record<string, unknown> | null): ReadableMetric[] {
  if (!metrics) return [];
  const rows: ReadableMetric[] = [];

  function visit(value: unknown, path: string[], depth: number) {
    if (rows.length >= 24 || path.some((part) => sensitiveMetricPattern.test(part))) return;
    const key = path.join('.');
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      rows.push({ key, label: path.map((part) => humanize(part)).join(' · '), value: formatMetricValue(key, value) });
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 0 && value.length <= 16 && value.every((item) => typeof item === 'number')) {
        rows.push({ key, label: path.map((part) => humanize(part)).join(' · '), value: formatMetricValue(key, value as number[]) });
      }
      return;
    }
    if (depth >= 2 || !value || typeof value !== 'object') return;
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      visit(childValue, [...path, childKey], depth + 1);
    }
  }

  for (const [key, value] of Object.entries(metrics)) visit(value, [key], 0);
  return rows;
}

export default function DeviceDetailPage() {
  const params = useParams<{ deviceId: string }>();
  const deviceId = params.deviceId;
  const query = useFleetDevice(deviceId);
  const { isInstallHubAuthenticated, isInstallHubLoading } = usePortalAuth();

  if (query.isLoading) return <Spinner label="Loading device history…" />;
  if (query.error) return <ErrorBanner message={fleetConnectionErrorMessage(query.error)} />;
  if (!query.data) {
    return <EmptyState icon="wifi" title="Device not found" description="This device is not present in the retained fleet history." />;
  }

  const {
    device,
    current,
    history,
    outages,
    fleetAccounts = [],
    currentPlacement = null,
    placementConflict = false,
    placements = [],
    inventory = null,
    fieldMeter = null,
    fieldInstallation = null,
    registerEvidence = [],
    fieldForms = [],
    meterHistory = [],
  } = query.data;
  const metrics = readableMetrics(current?.metrics);
  const installationLinks = fieldInstallation ? [
    ['Installation', fieldInstallation.paths.overview],
    ['Electrical map', fieldInstallation.paths.electricalMap],
    ['Report', fieldInstallation.paths.report],
    ['Client report', fieldInstallation.paths.clientReport],
    ['Field meter', fieldInstallation.paths.meter],
  ] as const : [];

  return (
    <div>
      <PageHeader
        title={device.label || device.deviceId}
        subtitle={`Device ${device.deviceId} · first seen ${formatDate(device.firstSeenAt)}`}
        actions={<LinkButton href="/fleet/devices" variant="secondary">Back to devices</LinkButton>}
      />

      {placementConflict ? (
        <div className="mb-5 rounded-[var(--radius-sm)] border border-[var(--amber)]/35 bg-[var(--amber-soft)] px-4 py-3.5 text-sm font-semibold leading-6 text-[var(--amber)]" role="status">
          More than one current customer or site placement is retained for this device. The Field installation placement is shown first; review the placement history below before relying on it.
        </div>
      ) : null}

      <section className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Client and site</h2>
          {currentPlacement ? (
            <dl className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">Client</dt>
                <dd className="mt-1">
                  <Link href={`/fleet/clients/${encodeURIComponent(currentPlacement.businessClient.id)}`} className="font-bold text-[var(--primary)] hover:underline">
                    {currentPlacement.businessClient.name}
                  </Link>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">Site ID</dt>
                <dd className="mt-1 break-all">
                  {currentPlacement.site ? (
                    <Link href={`/fleet/sites/${encodeURIComponent(currentPlacement.site.id)}`} className="font-bold text-[var(--primary)] hover:underline">
                      {currentPlacement.site.id}
                    </Link>
                  ) : <span className="font-semibold text-[var(--text-sub)]">Not recorded</span>}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">Site address</dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--text)]">{currentPlacement.site?.address || 'Not recorded'}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">Placement source</dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--text)]">{placementSourceLabel(currentPlacement.source)}</dd>
              </div>
              <div>
                <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">Effective date</dt>
                <dd className="mt-1 text-sm font-semibold text-[var(--text)]">{formatDate(currentPlacement.effectiveDate)}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-4 text-sm leading-6 text-[var(--text-sub)]">No exact customer/site placement is available. Register snapshots remain visible below but are not promoted into canonical links.</p>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Fleet accounts / API keys</h2>
          {fleetAccounts.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--text-sub)]">No current Fleet-account membership is recorded.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {fleetAccounts.map((account) => (
                <li key={account.id} className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <span>
                      <span className="block text-sm font-bold text-[var(--text)]">{account.name}</span>
                      <span className="block text-xs text-[var(--text-sub)]">{account.code}{account.isMaas ? ' · MaaS' : ''}</span>
                    </span>
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${
                      account.apiKeyConfigured
                        ? 'bg-[var(--green-soft)] text-[var(--green)]'
                        : 'bg-[var(--amber-soft)] text-[var(--amber)]'
                    }`}>
                      {account.apiKeyConfigured ? 'API key configured' : 'API key not added'}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[var(--text-sub)]">API-key presence enables collection; it does not determine whether this device is online.</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {!current ? (
        <EmptyState
          icon="wifi-off"
          title="No current observation"
          description="The device is known to the fleet but has not been observed in a published run. Collection failures never imply recovery."
        />
      ) : (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card className="!p-5">
              <p className="text-xs font-bold uppercase tracking-[0.07em] text-[var(--text-sub)]">Current status</p>
              <div className="mt-3"><FleetStatusBadge status={current.status} /></div>
              <p className="mt-3 text-xs text-[var(--text-sub)]">Observed {formatDateTime(current.observedAt)}</p>
            </Card>
            <StatCard label="Communication age" value={formatDuration(current.communicationAgeSeconds)} icon="activity" tone={current.status === 'offline' ? 'danger' : 'primary'} />
            <StatCard label="Last-known signal" value={typeof current.signalQualityDbm === 'number' ? `${current.signalQualityDbm} dBm` : '—'} icon="wifi" />
            <StatCard label="Open outages" value={outages.filter((outage) => outage.open).length} icon="wifi-off" tone="danger" />
          </div>

          <section className="mb-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Device details</h2>
              <dl className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-2">
                {[
                  ['Model', device.model],
                  ['Firmware', device.firmwareVersion],
                  ['Installed', formatDate(device.installDate)],
                  ['Device timezone', device.deviceTimezone],
                  ['Last heard', formatDateTime(current.lastHeardAt)],
                  ['Latest status payload', formatDateTime(current.latestStatusAt)],
                  ['Comms type', current.commsType],
                  ['Last heard via', current.lastHeardVia],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">{label}</dt>
                    <dd className="mt-1 break-words text-sm font-semibold text-[var(--text)]">{value || '—'}</dd>
                  </div>
                ))}
              </dl>
              {current.reportOffline ? (
                <p className="mt-5 rounded-[var(--radius-sm)] border border-[var(--red)]/25 bg-[var(--red-soft)] px-4 py-3 text-sm font-semibold text-[var(--red)]">
                  This device is in the 24-hour email report offline cohort.
                </p>
              ) : null}
            </Card>

            <Card>
              <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Fleet account memberships</h2>
              {device.memberships.length === 0 ? (
                <p className="mt-4 text-sm text-[var(--text-sub)]">No Fleet account membership is recorded.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {device.memberships.map((client) => (
                    <li key={client.id} className="flex items-center justify-between gap-4 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3">
                      <span>
                        <span className="block text-sm font-bold text-[var(--text)]">{client.name}</span>
                        <span className="block text-xs text-[var(--text-sub)]">{client.code}</span>
                      </span>
                      {client.isMaas ? <span className="rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--primary)]">MaaS</span> : null}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-xs leading-5 text-[var(--text-sub)]">A device can belong to more than one API fleet; memberships are retained rather than overwritten.</p>
            </Card>
          </section>

          <Card className="mb-5 min-w-0 !p-0">
            <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
              <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Latest retained metrics</h2>
              <p className="mt-1 text-sm text-[var(--text-sub)]">Sanitised status and energy metrics from the most recent observation.</p>
            </div>
            {metrics.length > 0 ? (
              <div className="overflow-x-auto">
                <table className={tableClass}>
                  <caption className="sr-only">Latest retained device metrics</caption>
                  <thead><tr><th className={tableHeadClass} scope="col">Metric</th><th className={tableHeadClass} scope="col">Value</th></tr></thead>
                  <tbody>
                    {metrics.map((metric) => (
                      <tr key={metric.key}><td className={`${tableCellClass} font-semibold`}>{metric.label}</td><td className={tableCellClass}>{metric.value}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-5 text-sm text-[var(--text-sub)]">Energy and status metrics are unavailable for this observation.</p>
            )}
          </Card>
        </>
      )}

      <section className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Field installation and meter</h2>
          {fieldInstallation || fieldMeter ? (
            <>
              <dl className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-2">
                {[
                  ['Installation ID', fieldInstallation?.id],
                  ['Installation', fieldInstallation?.siteName],
                  ['Installation site code', fieldInstallation?.siteCode],
                  ['Installation job ID', fieldInstallation?.jobId],
                  ['Installation status', fieldInstallation?.status],
                  ['Completed', formatDateTime(fieldInstallation?.completedAt)],
                  ['Meter ID', fieldMeter?.id],
                  ['Meter name', fieldMeter?.customName],
                  ['Meter serial number', fieldMeter?.serialNumber],
                  ['Device family', fieldMeter?.deviceFamily],
                  ['Meter model', fieldMeter?.deviceModel],
                  ['Device number', fieldMeter?.deviceNumber],
                  ['Display code', fieldMeter?.displayCode],
                  ['Switchboard', fieldMeter?.boardName],
                  ['Switchboard ID', fieldMeter?.installedOnBoardId],
                  ['Zone', fieldMeter?.zoneName],
                  ['Zone ID', fieldMeter?.zoneId],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">{label}</dt>
                    <dd className="mt-1 break-words text-sm font-semibold text-[var(--text)]">{value || 'Not recorded'}</dd>
                  </div>
                ))}
              </dl>
              {fieldInstallation?.siteId ? (
                <p className="mt-4 text-sm text-[var(--text-sub)]">
                  Site ID:{' '}
                  <Link
                    href={`/fleet/sites/${encodeURIComponent(fieldInstallation.siteId)}`}
                    className="break-all font-bold text-[var(--primary)] hover:underline"
                  >
                    {fieldInstallation.siteId}
                  </Link>
                </p>
              ) : null}
              {installationLinks.length ? (
                <div className="mt-5 border-t border-[var(--border)] pt-4">
                  {isInstallHubLoading ? (
                    <p className="text-sm text-[var(--text-sub)]" role="status">Checking Field App Complete access…</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {installationLinks.map(([label, path]) => {
                        const href = installHubDrilldownHref(path, isInstallHubAuthenticated);
                        return href ? (
                          <LinkButton
                            key={label}
                            href={href}
                            variant="secondary"
                            className="!min-h-9 !px-3 !py-1.5 !text-xs"
                            aria-label={`${label} for ${fieldInstallation?.siteName ?? device.deviceId}`}
                          >
                            {label}
                          </LinkButton>
                        ) : null;
                      })}
                    </div>
                  )}
                  {!isInstallHubLoading && !isInstallHubAuthenticated ? (
                    <p className="mt-2 text-xs leading-5 text-[var(--text-sub)]">Field App Complete sign-in is required to open these protected records.</p>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-4 text-sm leading-6 text-[var(--text-sub)]">No exact Field installation or Field meter is linked to this Fleet device.</p>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Inventory record</h2>
          {inventory ? (
            <>
              <dl className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-2">
              {[
                ['Inventory ID', inventory.id],
                ['Inventory device ID', inventory.deviceId],
                ['Status', humanize(inventory.status)],
                ['Device model', inventory.deviceModel],
                ['Manufacturer', inventory.customManufacturerName],
                ['Custom model', inventory.customModelName],
                ['Installed installation ID', inventory.installedInstallationId],
                ['Installed meter ID', inventory.installedMeterId],
                ['Business job ID', inventory.businessJobId],
                ['Revision', inventory.revision === undefined ? null : String(inventory.revision)],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">{label}</dt>
                  <dd className="mt-1 break-words text-sm font-semibold text-[var(--text)]">{value || 'Not recorded'}</dd>
                </div>
              ))}
              </dl>
              <dl className="mt-4 grid gap-x-5 gap-y-4 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">Business client ID</dt>
                  <dd className="mt-1 break-all text-sm font-semibold">
                    {inventory.businessClientId ? (
                      <Link href={`/fleet/clients/${encodeURIComponent(inventory.businessClientId)}`} className="text-[var(--primary)] hover:underline">
                        {inventory.businessClientId}
                      </Link>
                    ) : <span className="text-[var(--text)]">Not recorded</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">Business site ID</dt>
                  <dd className="mt-1 break-all text-sm font-semibold">
                    {inventory.businessSiteId ? (
                      <Link href={`/fleet/sites/${encodeURIComponent(inventory.businessSiteId)}`} className="text-[var(--primary)] hover:underline">
                        {inventory.businessSiteId}
                      </Link>
                    ) : <span className="text-[var(--text)]">Not recorded</span>}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p className="mt-4 text-sm leading-6 text-[var(--text-sub)]">No Field inventory record is linked to this device.</p>
          )}
        </Card>
      </section>

      <section className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card className="min-w-0 !p-0">
          <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
            <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Field meter forms</h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">Form metadata only. Opening a form requires a Field App Complete session.</p>
          </div>
          {fieldForms.length === 0 ? (
            <p className="p-5 text-sm text-[var(--text-sub)]">No Field forms are linked to this meter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <caption className="sr-only">Field forms linked to this meter</caption>
                <thead>
                  <tr>
                    <th className={tableHeadClass} scope="col">Form</th>
                    <th className={tableHeadClass} scope="col">Status</th>
                    <th className={tableHeadClass} scope="col">Completed</th>
                    <th className={tableHeadClass} scope="col">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {fieldForms.map((form) => {
                    const href = isInstallHubLoading
                      ? null
                      : installHubDrilldownHref(form.path, isInstallHubAuthenticated);
                    return (
                      <tr key={form.id}>
                        <td className={`${tableCellClass} font-semibold`}>{humanize(form.formType)}</td>
                        <td className={tableCellClass}><ProcessStatusBadge status={form.status} /></td>
                        <td className={`${tableCellClass} whitespace-nowrap`}>{formatDateTime(form.completedAt)}</td>
                        <td className={tableCellClass}>
                          {isInstallHubLoading ? (
                            <span className="text-sm text-[var(--text-sub)]" role="status">Checking access…</span>
                          ) : href ? (
                            <LinkButton
                              href={href}
                              variant="secondary"
                              className="!min-h-9 !px-3 !py-1.5 !text-xs"
                              aria-label={`Open ${humanize(form.formType)} form for ${fieldInstallation?.siteName ?? device.deviceId}`}
                            >
                              Open form
                            </LinkButton>
                          ) : <span className="text-sm text-[var(--text-sub)]">Unavailable</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="min-w-0 !p-0">
          <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
            <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Meter record history</h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">Non-sensitive record actions and version transitions; newest first.</p>
          </div>
          {meterHistory.length === 0 ? (
            <p className="p-5 text-sm text-[var(--text-sub)]">No meter record history is linked to this device.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className={tableClass}>
                <caption className="sr-only">Meter record version history</caption>
                <thead>
                  <tr>
                    <th className={tableHeadClass} scope="col">When</th>
                    <th className={tableHeadClass} scope="col">Action</th>
                    <th className={tableHeadClass} scope="col">Version change</th>
                  </tr>
                </thead>
                <tbody>
                  {meterHistory.map((event) => (
                    <tr key={event.id}>
                      <td className={`${tableCellClass} whitespace-nowrap`}>{formatDateTime(event.createdAt)}</td>
                      <td className={`${tableCellClass} font-semibold`}>{humanize(event.operation)}</td>
                      <td className={`${tableCellClass} whitespace-nowrap`}>
                        {event.fromRecordVersionNumber ?? '—'} → {event.toRecordVersionNumber ?? '—'}
                        {event.restoredFromRecordVersionNumber !== null && event.restoredFromRecordVersionNumber !== undefined
                          ? <span className="mt-1 block text-xs text-[var(--text-sub)]">Restored from v{event.restoredFromRecordVersionNumber}</span>
                          : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </section>

      <Card className="mb-5 min-w-0 !p-0">
        <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Placement history</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Exact Field and imported MaaS relationships; current, replacement-existing and replacement-new roles remain separate.</p>
        </div>
        {placements.length === 0 ? (
          <p className="p-5 text-sm text-[var(--text-sub)]">No exact placement history is available.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Device customer and site placement history</caption>
              <thead><tr><th className={tableHeadClass} scope="col">Role</th><th className={tableHeadClass} scope="col">Client</th><th className={tableHeadClass} scope="col">Site</th><th className={tableHeadClass} scope="col">Source</th><th className={tableHeadClass} scope="col">Effective</th><th className={tableHeadClass} scope="col">Provenance</th></tr></thead>
              <tbody>
                {placements.map((placement, index) => (
                  <tr key={`${placement.source}-${placement.provenance?.assignmentId ?? index}-${placement.deviceRole}`}>
                    <td className={`${tableCellClass} font-bold`}>{humanize(placement.deviceRole)}</td>
                    <td className={tableCellClass}>
                      <Link href={`/fleet/clients/${encodeURIComponent(placement.businessClient.id)}`} className="font-bold text-[var(--primary)] hover:underline">
                        {placement.businessClient.name}
                      </Link>
                    </td>
                    <td className={`${tableCellClass} min-w-64`}>
                      {placement.site ? (
                        <>
                          <Link href={`/fleet/sites/${encodeURIComponent(placement.site.id)}`} className="break-all font-bold text-[var(--primary)] hover:underline">
                            {placement.site.id}
                          </Link>
                          <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">{placement.site.address}</p>
                        </>
                      ) : 'Not recorded'}
                    </td>
                    <td className={`${tableCellClass} whitespace-nowrap`}>{placementSourceLabel(placement.source)}</td>
                    <td className={`${tableCellClass} whitespace-nowrap`}>{formatDate(placement.effectiveDate)}</td>
                    <td className={`${tableCellClass} min-w-52 text-xs leading-5`}>
                      {placement.provenance
                        ? `${placement.provenance.sourceWorkbook} · ${placement.provenance.sourceSheet} · row ${placement.provenance.sourceRow}`
                        : 'Canonical Field completion'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mb-5 min-w-0 !p-0">
        <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Inventory movement history</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Append-only custody and installation transitions. User and actor identifiers are not exposed in Fleet.</p>
        </div>
        {!inventory?.movements?.length ? (
          <p className="p-5 text-sm text-[var(--text-sub)]">No inventory movement history is linked to this device.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Field inventory movement history</caption>
              <thead><tr><th className={tableHeadClass} scope="col">When</th><th className={tableHeadClass} scope="col">Action</th><th className={tableHeadClass} scope="col">From</th><th className={tableHeadClass} scope="col">To</th><th className={tableHeadClass} scope="col">Installation</th><th className={tableHeadClass} scope="col">Meter</th></tr></thead>
              <tbody>
                {inventory.movements.map((movement) => (
                  <tr key={movement.id}>
                    <td className={`${tableCellClass} whitespace-nowrap`}>{formatDateTime(movement.occurredAt)}</td>
                    <td className={`${tableCellClass} font-bold`}>{humanize(movement.action)}</td>
                    <td className={tableCellClass}>{humanize(movement.fromStatus ?? 'Not applicable')}</td>
                    <td className={tableCellClass}>{humanize(movement.toStatus)}</td>
                    <td className={`${tableCellClass} break-all`}>{movement.installationId || '—'}</td>
                    <td className={`${tableCellClass} break-all`}>{movement.meterId || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mb-5 min-w-0 !p-0">
        <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Meter Register evidence</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Imported source snapshots joined by exact Wattwatchers device identity; they do not create canonical client or site links.</p>
        </div>
        {registerEvidence.length === 0 ? (
          <p className="p-5 text-sm text-[var(--text-sub)]">No Master Register evidence is linked to this device.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Imported Meter Register evidence for this device</caption>
              <thead><tr><th className={tableHeadClass} scope="col">Source row / role</th><th className={tableHeadClass} scope="col">Customer</th><th className={tableHeadClass} scope="col">Site address</th><th className={tableHeadClass} scope="col">Job</th><th className={tableHeadClass} scope="col">MaaS / data</th><th className={tableHeadClass} scope="col">Device identifiers</th></tr></thead>
              <tbody>
                {registerEvidence.map((evidence) => (
                  <tr key={evidence.id}>
                    <td className={`${tableCellClass} min-w-40`}>
                      <p className="font-bold">
                        {[evidence.sourceWorkbook, evidence.sourceSheet].filter(Boolean).join(' · ') || 'Imported register'}
                      </p>
                      <p className="mt-1 text-xs text-[var(--text-sub)]">Row {evidence.sourceRow ?? '—'}</p>
                      <p className="mt-1 text-xs text-[var(--text-sub)]">{evidence.matchedRoles?.map(humanize).join(', ') || 'Matched device'}</p>
                    </td>
                    <td className={`${tableCellClass} min-w-44`}>
                      <p className="font-semibold">{evidence.customerName || 'Not recorded'}</p>
                      {evidence.fleetAccountName ? <p className="mt-1 text-xs text-[var(--text-sub)]">Fleet account: {evidence.fleetAccountName}</p> : null}
                    </td>
                    <td className={`${tableCellClass} min-w-64 whitespace-normal`}>{evidence.siteAddress || 'Not recorded'}</td>
                    <td className={`${tableCellClass} min-w-44`}>
                      <p>{evidence.jobNumber || 'Not recorded'}</p>
                      <p className="mt-1 text-xs text-[var(--text-sub)]">Completed {formatDate(evidence.jobCompletionDate)}{evidence.jobCompletedBy ? ` · ${evidence.jobCompletedBy}` : ''}</p>
                    </td>
                    <td className={`${tableCellClass} whitespace-nowrap`}>
                      MaaS: {evidence.maas === null || evidence.maas === undefined ? '—' : evidence.maas ? 'Yes' : 'No'}<br />
                      Data: {evidence.dataEnabled === null || evidence.dataEnabled === undefined ? '—' : evidence.dataEnabled ? 'Yes' : 'No'}
                    </td>
                    <td className={`${tableCellClass} min-w-56 break-all text-xs leading-5`}>
                      Existing: {evidence.existingDeviceIdentifier || '—'}<br />
                      New: {evidence.newDeviceIdentifier || '—'}<br />
                      Current: {evidence.currentDeviceIdentifier || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="mb-5 min-w-0 !p-0">
        <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Connectivity history</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Published observations only; newest first.</p>
        </div>
        {history.length === 0 ? (
          <p className="p-5 text-sm text-[var(--text-sub)]">No published history is available.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Historical connectivity observations</caption>
              <thead><tr><th className={tableHeadClass} scope="col">Date</th><th className={tableHeadClass} scope="col">Status</th><th className={tableHeadClass} scope="col">Last heard</th><th className={tableHeadClass} scope="col">Age at scan</th><th className={tableHeadClass} scope="col">Report transition</th></tr></thead>
              <tbody>
                {history.map((point) => (
                  <tr key={point.runId}>
                    <td className={`${tableCellClass} whitespace-nowrap font-semibold`}>{formatDate(point.reportingDate)}</td>
                    <td className={tableCellClass}><FleetStatusBadge status={point.status} /></td>
                    <td className={`${tableCellClass} whitespace-nowrap`}>{formatDateTime(point.lastHeardAt)}</td>
                    <td className={`${tableCellClass} whitespace-nowrap`}>{formatDuration(point.communicationAgeSeconds)}</td>
                    <td className={tableCellClass}>{humanize(point.reportTransition)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="min-w-0 !p-0">
        <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
          <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Outage history</h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">Transitions are created from complete published runs only. With daily scans, recovery time and observed duration are bounded by scan times rather than exact uptime.</p>
        </div>
        {outages.length === 0 ? (
          <p className="p-5 text-sm text-[var(--text-sub)]">No retained outages for this device.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <caption className="sr-only">Device outage history</caption>
              <thead><tr><th className={tableHeadClass} scope="col">Opened</th><th className={tableHeadClass} scope="col">Last confirmed</th><th className={tableHeadClass} scope="col">Recovered</th><th className={tableHeadClass} scope="col">Observed duration</th><th className={tableHeadClass} scope="col">State</th></tr></thead>
              <tbody>
                {outages.map((outage) => (
                  <tr key={outage.id}>
                    <td className={`${tableCellClass} whitespace-nowrap`}>{formatDateTime(outage.openedAt)}</td>
                    <td className={`${tableCellClass} whitespace-nowrap`}>{formatDateTime(outage.lastConfirmedAt)}</td>
                    <td className={`${tableCellClass} whitespace-nowrap`}>{formatDateTime(outage.recoveredAt)}</td>
                    <td className={`${tableCellClass} whitespace-nowrap`}>{formatDuration(outage.durationSeconds)}</td>
                    <td className={tableCellClass}><span className={`font-bold ${outage.open ? 'text-[var(--red)]' : 'text-[var(--green)]'}`}>{outage.open ? 'Open' : 'Recovered'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
