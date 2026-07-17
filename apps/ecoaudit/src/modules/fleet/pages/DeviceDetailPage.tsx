'use client';

import { useParams } from 'next/navigation';
import { LinkButton } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import { FleetStatusBadge } from '@/modules/fleet/components/FleetStatusBadge';
import { tableCellClass, tableClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { useFleetDevice } from '@/modules/fleet/hooks/useFleet';
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

  if (query.isLoading) return <Spinner label="Loading device history…" />;
  if (query.error) return <ErrorBanner message={fleetConnectionErrorMessage(query.error)} />;
  if (!query.data) {
    return <EmptyState icon="wifi" title="Device not found" description="This device is not present in the retained fleet history." />;
  }

  const { device, current, history, outages } = query.data;
  const metrics = readableMetrics(current?.metrics);

  return (
    <div>
      <PageHeader
        title={device.label || device.deviceId}
        subtitle={`Device ${device.deviceId} · first seen ${formatDate(device.firstSeenAt)}`}
        actions={<LinkButton href="/fleet/devices" variant="secondary">Back to devices</LinkButton>}
      />

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
              <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Fleet memberships</h2>
              {device.memberships.length === 0 ? (
                <p className="mt-4 text-sm text-[var(--text-sub)]">No client membership is recorded.</p>
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
