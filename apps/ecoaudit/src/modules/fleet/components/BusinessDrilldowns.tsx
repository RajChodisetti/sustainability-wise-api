'use client';

import Link from 'next/link';
import { LinkButton } from '@/components/ui/Button';
import { Card, StatCard } from '@/components/ui/Card';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { FleetStatusBadge, ProcessStatusBadge } from '@/modules/fleet/components/FleetStatusBadge';
import { tableCellClass, tableClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { installHubDrilldownHref } from '@/modules/fleet/lib/drilldowns';
import { formatDateTime, formatNumber, humanize } from '@/modules/fleet/lib/format';
import type {
  FleetBusinessClient,
  FleetBusinessSite,
  FleetDeviceStatusSummary,
  FleetRelatedDevice,
  FleetRelatedInstallation,
  FleetRelatedJob,
} from '@/modules/fleet/types/domain';

export function FleetStatusSummaryCards({ summary }: { summary: FleetDeviceStatusSummary }) {
  return (
    <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Devices" value={formatNumber(summary.totalDevices)} icon="gauge" />
      <StatCard label="Communicating" value={formatNumber(summary.communicating)} icon="wifi" tone="success" />
      <StatCard label="Delayed" value={formatNumber(summary.delayed)} icon="activity" tone={summary.delayed ? 'warning' : 'success'} />
      <StatCard label="Offline" value={formatNumber(summary.offline)} icon="wifi-off" tone={summary.offline ? 'danger' : 'success'} />
      <StatCard label="Inactive" value={formatNumber(summary.inactive)} icon="activity" tone={summary.inactive ? 'warning' : 'success'} />
      <StatCard label="Unknown" value={formatNumber(summary.unknown)} icon="gauge" tone={summary.unknown ? 'warning' : 'success'} />
      <StatCard label="Not collected" value={formatNumber(summary.notCollected)} icon="activity" tone={summary.notCollected ? 'warning' : 'primary'} />
      <StatCard label="24h report offline" value={formatNumber(summary.reportOffline)} icon="wifi-off" tone={summary.reportOffline ? 'danger' : 'success'} />
    </div>
  );
}

function DetailValue({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm font-semibold text-[var(--text)]">{value?.trim() || 'Not recorded'}</dd>
    </div>
  );
}

export function BusinessClientContactCard({ client }: { client: FleetBusinessClient }) {
  return (
    <Card>
      <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Client contact</h2>
      <dl className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <DetailValue label="Contact name" value={client.contactName} />
        <DetailValue label="Phone" value={client.contactPhone} />
        <DetailValue label="Email" value={client.contactEmail} />
        <DetailValue label="Client ID" value={client.id} />
      </dl>
    </Card>
  );
}

export function BusinessSiteDetailsCard({ site }: { site: FleetBusinessSite }) {
  const locality = [site.locality, site.state, site.postcode].filter(Boolean).join(' ');
  return (
    <Card>
      <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Site details</h2>
      <dl className="mt-5 grid gap-x-5 gap-y-4 sm:grid-cols-2">
        <DetailValue label="Site ID" value={site.id} />
        <DetailValue label="Address" value={[site.address, locality].filter(Boolean).join('\n')} />
        <DetailValue label="Contact name" value={site.contactName} />
        <DetailValue label="Phone" value={site.contactPhone} />
        <DetailValue label="Email" value={site.contactEmail} />
        <DetailValue label="Timezone" value={site.timezone} />
        <div className="sm:col-span-2">
          <DetailValue label="Access information" value={site.accessInformation} />
        </div>
      </dl>
    </Card>
  );
}

export function RelatedDevicesTable({ devices }: { devices: FleetRelatedDevice[] }) {
  return (
    <Card className="min-w-0 !p-0">
      <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
        <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Devices</h2>
        <p className="mt-1 text-sm text-[var(--text-sub)]">Current placement and condition from the latest published Fleet scan.</p>
      </div>
      {devices.length === 0 ? (
        <p className="p-5 text-sm text-[var(--text-sub)]">No devices are linked to this record.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <caption className="sr-only">Devices linked to this business record</caption>
            <thead>
              <tr>
                <th className={tableHeadClass} scope="col">Device</th>
                <th className={tableHeadClass} scope="col">Model</th>
                <th className={tableHeadClass} scope="col">Condition at last scan</th>
                <th className={tableHeadClass} scope="col">Last heard</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.deviceId} className="hover:bg-[var(--surface2)]/70">
                  <td className={tableCellClass}>
                    <Link href={`/fleet/devices/${encodeURIComponent(device.deviceId)}`} className="font-bold text-[var(--primary)] hover:underline">
                      {device.label || device.deviceId}
                    </Link>
                    {device.label ? <p className="mt-1 break-all text-xs text-[var(--muted)]">{device.deviceId}</p> : null}
                    {device.placementConflict ? <p className="mt-1 text-xs font-bold text-[var(--amber)]">Placement conflict</p> : null}
                  </td>
                  <td className={`${tableCellClass} font-semibold`}>{device.model || 'N/A'}</td>
                  <td className={tableCellClass}>
                    {device.fetchStatus === 'not_collected'
                      ? <ProcessStatusBadge status="Not collected" />
                      : <FleetStatusBadge status={device.status} />}
                  </td>
                  <td className={`${tableCellClass} whitespace-nowrap`}>{formatDateTime(device.lastHeardAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RelatedJobAction({
  job,
  installation,
}: {
  job: FleetRelatedJob;
  installation?: FleetRelatedInstallation;
}) {
  const { isInstallHubAuthenticated, isInstallHubLoading } = usePortalAuth();
  if (!installation || job.sourceApp !== 'installhub' || job.sourceType !== 'installation') {
    return <span className="text-sm text-[var(--text-sub)]">No direct link</span>;
  }
  if (isInstallHubLoading) {
    return <span className="text-sm text-[var(--text-sub)]" role="status">Checking access…</span>;
  }
  const href = installHubDrilldownHref(
    installation.paths.overview,
    isInstallHubAuthenticated,
  );
  return href ? (
    <LinkButton
      href={href}
      variant="secondary"
      className="!min-h-9 !px-3 !py-1.5 !text-xs"
      aria-label={`Open Field installation for ${job.title}`}
    >
      Open Field installation
    </LinkButton>
  ) : <span className="text-sm text-[var(--text-sub)]">Unavailable</span>;
}

export function RelatedJobsTable({
  jobs,
  installations = [],
}: {
  jobs: FleetRelatedJob[];
  installations?: FleetRelatedInstallation[];
}) {
  return (
    <Card className="min-w-0 !p-0">
      <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
        <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Jobs</h2>
        <p className="mt-1 text-sm text-[var(--text-sub)]">Work linked through the canonical business site.</p>
      </div>
      {jobs.length === 0 ? (
        <p className="p-5 text-sm text-[var(--text-sub)]">No jobs are linked to this record.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <caption className="sr-only">Jobs linked to this business record</caption>
            <thead>
              <tr>
                <th className={tableHeadClass} scope="col">Job</th>
                <th className={tableHeadClass} scope="col">Status</th>
                <th className={tableHeadClass} scope="col">Product</th>
                <th className={tableHeadClass} scope="col">Updated</th>
                <th className={tableHeadClass} scope="col">Open</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => {
                const installation = installations.find((item) => item.id === job.sourceId);
                return (
                  <tr key={job.id}>
                  <td className={tableCellClass}>
                    <p className="font-bold text-[var(--text)]">{job.title}</p>
                    <p className="mt-1 break-all text-xs text-[var(--muted)]">{job.id}</p>
                  </td>
                  <td className={tableCellClass}><ProcessStatusBadge status={job.status} /></td>
                  <td className={`${tableCellClass} whitespace-nowrap`}>{humanize(job.sourceApp)}</td>
                  <td className={`${tableCellClass} whitespace-nowrap`}>{formatDateTime(job.updatedAt)}</td>
                  <td className={tableCellClass}><RelatedJobAction job={job} installation={installation} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function InstallationActions({ installation }: { installation: FleetRelatedInstallation }) {
  const { isInstallHubAuthenticated, isInstallHubLoading } = usePortalAuth();
  const links = [
    ['Installation', installation.paths.overview],
    ['Electrical map', installation.paths.electricalMap],
    ['Report', installation.paths.report],
    ['Client report', installation.paths.clientReport],
  ] as const;
  return (
    <div>
      <div className="flex min-w-64 flex-wrap gap-2">
        {links.map(([label, path]) => {
          if (isInstallHubLoading) {
            return <span key={label} className="text-xs text-[var(--text-sub)]" role="status">Checking access…</span>;
          }
          const href = installHubDrilldownHref(path, isInstallHubAuthenticated);
          return href ? (
            <LinkButton
              key={label}
              href={href}
              variant="secondary"
              className="!min-h-9 !px-3 !py-1.5 !text-xs"
              aria-label={`${label} for ${installation.siteName}`}
            >
              {label}
            </LinkButton>
          ) : null;
        })}
      </div>
      {!isInstallHubLoading && !isInstallHubAuthenticated ? (
        <p className="mt-2 text-xs leading-5 text-[var(--text-sub)]">Field App Complete sign-in is required to open these protected records.</p>
      ) : null}
    </div>
  );
}

export function RelatedInstallationsTable({ installations }: { installations: FleetRelatedInstallation[] }) {
  return (
    <Card className="min-w-0 !p-0">
      <div className="border-b border-[var(--border)] px-5 py-5 sm:px-6">
        <h2 className="text-lg font-extrabold tracking-[-0.02em] text-[var(--text)]">Field installations and reports</h2>
        <p className="mt-1 text-sm text-[var(--text-sub)]">Links open the separately protected Field App Complete workspace.</p>
      </div>
      {installations.length === 0 ? (
        <p className="p-5 text-sm text-[var(--text-sub)]">No Field installations are linked to this record.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <caption className="sr-only">Field installations and related report links</caption>
            <thead>
              <tr>
                <th className={tableHeadClass} scope="col">Installation</th>
                <th className={tableHeadClass} scope="col">Status</th>
                <th className={tableHeadClass} scope="col">Completed</th>
                <th className={tableHeadClass} scope="col">Electrical map</th>
                <th className={tableHeadClass} scope="col">Open</th>
              </tr>
            </thead>
            <tbody>
              {installations.map((installation) => (
                <tr key={installation.id}>
                  <td className={tableCellClass}>
                    <p className="font-bold text-[var(--text)]">{installation.siteName}</p>
                    <p className="mt-1 break-all text-xs text-[var(--muted)]">{installation.siteCode || installation.id}</p>
                  </td>
                  <td className={tableCellClass}><ProcessStatusBadge status={installation.status} /></td>
                  <td className={`${tableCellClass} whitespace-nowrap`}>{formatDateTime(installation.completedAt)}</td>
                  <td className={tableCellClass}>{installation.electricalMapLayoutConfigured ? 'Saved layout' : 'Canonical map available'}</td>
                  <td className={tableCellClass}><InstallationActions installation={installation} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
