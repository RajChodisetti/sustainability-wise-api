'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { LinkButton } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner, StatCard } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/Icon';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import { ProcessStatusBadge } from '@/modules/fleet/components/FleetStatusBadge';
import { tableCellClass, tableHeadClass } from '@/modules/fleet/components/Table';
import { useFleetReport } from '@/modules/fleet/hooks/useFleet';
import { formatDate, formatDateTime, formatNumber } from '@/modules/fleet/lib/format';
import { fleetReportCohorts, type FleetReportCohort } from '@/modules/fleet/lib/reportCohorts';

const cohortAppearance: Record<
  FleetReportCohort['key'],
  { icon: IconName; tone: 'danger' | 'warning' | 'success'; iconClass: string }
> = {
  offline: {
    icon: 'wifi-off',
    tone: 'danger',
    iconClass: 'bg-[var(--red-soft)] text-[var(--red)]',
  },
  newlyOffline: {
    icon: 'activity',
    tone: 'warning',
    iconClass: 'bg-[var(--amber-soft)] text-[var(--amber)]',
  },
  recovered: {
    icon: 'check',
    tone: 'success',
    iconClass: 'bg-[var(--green-soft)] text-[var(--green)]',
  },
};

function CohortSection({
  cohort,
  hasEmailDelta,
}: {
  cohort: FleetReportCohort;
  hasEmailDelta: boolean;
}) {
  const appearance = cohortAppearance[cohort.key];
  const displayedCount = cohort.archivedCount ?? cohort.deviceIds.length;
  const countMismatch = cohort.archivedCount !== null
    && cohort.archivedCount !== cohort.deviceIds.length;
  const headingId = `report-cohort-${cohort.key}`;

  return (
    <Card className="min-w-0 !p-0">
      <section aria-labelledby={headingId}>
        <div className="flex flex-col gap-4 border-b border-[var(--border)] px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${appearance.iconClass}`}>
              <Icon name={appearance.icon} size={20} />
            </span>
            <div className="min-w-0">
              <h2 id={headingId} className="text-lg font-extrabold tracking-[-0.025em] text-[var(--text)]">
                {cohort.title}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">{cohort.description}</p>
            </div>
          </div>
          <span className="inline-flex min-h-9 shrink-0 items-center self-start rounded-full border border-[var(--border-strong)] bg-[var(--surface2)] px-3 py-1 text-sm font-extrabold text-[var(--text)]">
            {formatNumber(displayedCount)} devices
          </span>
        </div>

        {!hasEmailDelta ? (
          <p className="px-5 py-6 text-sm leading-6 text-[var(--text-sub)] sm:px-6">
            No email-delta archive is available for the latest delivery.
          </p>
        ) : cohort.deviceIds.length === 0 ? (
          <p className="px-5 py-6 text-sm leading-6 text-[var(--text-sub)] sm:px-6">
            No device IDs were recorded in this cohort.
          </p>
        ) : (
          <div className="max-h-[34rem] overflow-auto subtle-scrollbar">
            <table className="w-full min-w-[320px] border-separate border-spacing-0">
              <caption className="sr-only">{cohort.title} device IDs from the latest email delivery</caption>
              <thead>
                <tr>
                  <th className={`${tableHeadClass} w-20 text-right`} scope="col">No.</th>
                  <th className={tableHeadClass} scope="col">Device ID</th>
                </tr>
              </thead>
              <tbody>
                {cohort.deviceIds.map((deviceId, index) => (
                  <tr key={`${deviceId}-${index}`} className="hover:bg-[var(--surface2)]/70">
                    <td className={`${tableCellClass} w-20 text-right text-[var(--text-sub)]`}>{formatNumber(index + 1)}</td>
                    <td className={tableCellClass}>
                      <Link
                        href={`/fleet/devices/${encodeURIComponent(deviceId)}`}
                        className="inline-flex min-h-11 items-center break-all font-bold text-[var(--primary)] underline-offset-4 hover:underline"
                      >
                        {deviceId}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {countMismatch ? (
          <p className="border-t border-[var(--border)] bg-[var(--amber-soft)] px-5 py-3 text-xs font-semibold leading-5 text-[var(--amber)] sm:px-6" role="status">
            The archived count is {formatNumber(cohort.archivedCount)}, while {formatNumber(cohort.deviceIds.length)} device IDs were retained. This table shows only the exact retained IDs.
          </p>
        ) : null}
      </section>
    </Card>
  );
}

export default function ReportDetailPage() {
  const params = useParams<{ reportId: string }>();
  const query = useFleetReport(params.reportId);

  if (query.isLoading) return <Spinner label="Loading email report…" />;
  if (query.error) return <ErrorBanner message={fleetConnectionErrorMessage(query.error)} />;
  if (!query.data) {
    return (
      <EmptyState
        icon="file-text"
        title="Email report not found"
        description="This report is not present in the retained fleet archive."
        actions={<LinkButton href="/fleet/reports" variant="secondary">Back to reports</LinkButton>}
      />
    );
  }

  const { report, deliveries } = query.data;
  const latestDelivery = deliveries[0] ?? null;
  const emailDelta = latestDelivery?.emailDelta ?? null;
  const cohorts = fleetReportCohorts(emailDelta);
  const collectionComplete = emailDelta?.collectionComplete;
  const deliveryTiming = latestDelivery?.sentAt
    ? `Sent ${formatDateTime(latestDelivery.sentAt)}`
    : latestDelivery?.attemptedAt
      ? `Attempted ${formatDateTime(latestDelivery.attemptedAt)}`
      : 'No delivery attempt recorded';

  return (
    <div>
      <PageHeader
        title={`Email report · ${formatDate(report.reportingDate)}`}
        subtitle="Review the exact device cohorts archived with the latest email delivery."
        actions={<LinkButton href="/fleet/reports" variant="secondary">Back to reports</LinkButton>}
      />

      <Card className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.07em] text-[var(--text-sub)]">Email subject</p>
        <h2 className="mt-2 break-words text-xl font-extrabold tracking-[-0.025em] text-[var(--text)]">
          {report.subject || 'Fleet status report'}
        </h2>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3">
            <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">Report date</dt>
            <dd className="mt-2 font-bold text-[var(--text)]">{formatDate(report.reportingDate)}</dd>
          </div>
          <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3">
            <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">Generation</dt>
            <dd className="mt-2"><ProcessStatusBadge status={report.status} /></dd>
            <dd className="mt-2 text-xs leading-5 text-[var(--text-sub)]">Generated {formatDateTime(report.generatedAt)}</dd>
          </div>
          <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3">
            <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">Latest delivery</dt>
            <dd className="mt-2"><ProcessStatusBadge status={latestDelivery?.status ?? 'not sent'} /></dd>
            <dd className="mt-2 text-xs leading-5 text-[var(--text-sub)]">{deliveryTiming}</dd>
          </div>
          <div className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)] px-4 py-3">
            <dt className="text-xs font-bold uppercase tracking-[0.06em] text-[var(--text-sub)]">Collection coverage</dt>
            <dd className={`mt-2 font-extrabold ${collectionComplete === true ? 'text-[var(--green)]' : 'text-[var(--amber)]'}`}>
              {collectionComplete === true ? 'Complete' : collectionComplete === false ? 'Incomplete' : 'Not recorded'}
            </dd>
            <dd className="mt-2 text-xs leading-5 text-[var(--text-sub)]">Latest email delivery snapshot</dd>
          </div>
        </dl>
      </Card>

      {latestDelivery?.error ? (
        <div className="mb-5"><ErrorBanner message={latestDelivery.error} /></div>
      ) : null}

      {emailDelta && collectionComplete !== true ? (
        <div
          className="mb-5 flex items-start gap-3 rounded-[var(--radius-sm)] border border-[var(--amber)]/35 bg-[var(--amber-soft)] px-4 py-3.5 text-sm font-semibold leading-6 text-[var(--amber)]"
          role={collectionComplete === false ? 'alert' : 'status'}
          aria-live="polite"
        >
          <Icon name="activity" size={19} className="mt-0.5 shrink-0" />
          <span>
            {collectionComplete === false
              ? 'Collection was incomplete when this email was generated. The archived cohort may not represent the full fleet.'
              : 'Collection completeness was not recorded for this email. Treat the archived cohort as unverified coverage.'}
          </span>
        </div>
      ) : null}

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        {cohorts.map((cohort) => (
          <StatCard
            key={cohort.key}
            label={cohort.title}
            value={formatNumber(cohort.archivedCount ?? cohort.deviceIds.length)}
            icon={cohortAppearance[cohort.key].icon}
            tone={cohortAppearance[cohort.key].tone}
          />
        ))}
      </div>

      <div className="grid gap-5">
        {cohorts.map((cohort) => (
          <CohortSection key={cohort.key} cohort={cohort} hasEmailDelta={Boolean(emailDelta)} />
        ))}
      </div>
    </div>
  );
}
