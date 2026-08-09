'use client';

import { useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { StatusBadge } from '@/components/ui/Badges';
import { Button, LinkButton } from '@/components/ui/Button';
import {
  Card,
  ErrorBanner,
  PageHeader,
  Spinner,
  StatCard,
} from '@/components/ui/Card';
import { Checkbox, FieldLabel, Select } from '@/components/ui/FormFields';
import { ExportJobStatus } from '@/components/exports/ExportJobStatus';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import { useExportJob } from '@/hooks/useExportJob';
import { slugify } from '@/lib/download';
import {
  downloadExportJob,
  findRecordVersionContainingForms,
  getAuthoritativeReportProvenance,
  getExportJobStatus,
  getLatestInstallationReportJob,
  installHubReportVariantKey,
  matchesInstallHubInstallationReport,
  requireRecordVersionNumber,
  startInstallationPdfJob,
} from '@/modules/installhub/api/installhub';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import {
  Breadcrumbs,
  DefinitionList,
  InlineNotice,
} from '@/modules/installhub/components/InstallHubUi';
import { FORM_DEFINITION_BY_TYPE } from '@/modules/installhub/forms/catalog';
import { useInstallationTree } from '@/modules/installhub/hooks/useInstallationTree';
import type {
  InstallHubReportDetailMode,
  InstallHubReportProvenance,
} from '@/modules/installhub/types/domain';

export function InstallHubReportPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);
  const toast = useToast();
  const [selectedOverride, setSelectedOverride] = useState<string[] | null>(null);
  const [detailMode, setDetailMode] = useState<InstallHubReportDetailMode>(
    'by-electrical-hierarchy',
  );
  const completedForms = query.data?.formSubmissions.filter(
    (form) => form.status === 'Completed',
  ) ?? [];
  const draftForms = query.data?.formSubmissions.filter(
    (form) => form.status === 'Draft',
  ) ?? [];
  const selectedIds = selectedOverride ?? completedForms.map((form) => form.id);
  const selectedIncludesHistoricalForm = completedForms.some(
    (form) => selectedIds.includes(form.id) && form.historicalMeterRemoved,
  );
  const selectedScope = [...selectedIds].sort().join(',') || 'no-forms';
  const reportVariantKey = installHubReportVariantKey({
    detailMode,
    formIds: selectedIds,
    sourceKey: query.data?.installation.status === 'Draft'
      ? `tree-revision-${query.data.treeRevision ?? 0}`
      : 'canonical',
  });
  const isLiveDiagnostic = query.data?.installation.status === 'Draft';
  const expectedReport = useRef<
    InstallHubReportProvenance | { reportSource: 'diagnostic-live' } | null
  >(null);
  const report = useExportJob({
    scopeKey: [
      'installhub-installation',
      installationId,
      String(query.data?.recordVersionNumber ?? 'unversioned'),
      isLiveDiagnostic ? String(query.data?.treeRevision ?? 'live') : 'canonical',
      detailMode,
      selectedScope,
    ],
    loadLatest: async () => {
      if (isLiveDiagnostic) {
        const expected = { reportSource: 'diagnostic-live' as const };
        expectedReport.current = expected;
        return getLatestInstallationReportJob(
          installationId,
          expected,
          reportVariantKey,
        );
      }
      const versionNumber = query.data?.recordVersionNumber;
      if (!Number.isInteger(versionNumber) || (versionNumber ?? 0) < 1) return null;
      const reportVersion = selectedIncludesHistoricalForm
        ? await findRecordVersionContainingForms(
            installationId,
            selectedIds,
            versionNumber!,
          )
        : versionNumber!;
      const expected = await getAuthoritativeReportProvenance(
        installationId,
        reportVersion,
      );
      expectedReport.current = expected;
      return getLatestInstallationReportJob(
        installationId,
        expected,
        reportVariantKey,
      );
    },
    getStatus: getExportJobStatus,
    downloadJob: (job) => downloadExportJob(job.id),
    fallbackFilename: `${slugify(query.data?.installation.siteName ?? 'installation')}-field-app-complete-pack.pdf`,
    matchesJob: (job) => matchesInstallHubInstallationReport(
      job,
      expectedReport.current,
      reportVariantKey,
      detailMode,
    ),
  });

  if (query.isLoading) return <Spinner />;
  if (query.error) {
    return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  }
  if (!query.data) return <ErrorBanner message="Installation not found." />;
  const tree = query.data;
  const hasPinnedVersion = Number.isInteger(tree.recordVersionNumber)
    && (tree.recordVersionNumber ?? 0) > 0;
  const meterCount = tree.electricalAssets.reduce(
    (total, board) => total + board.meters.length,
    0,
  );

  function toggleForm(formId: string, selected: boolean) {
    const current = selectedIds;
    setSelectedOverride(
      selected
        ? [...new Set([...current, formId])]
        : current.filter((id) => id !== formId),
    );
  }

  async function generate() {
    try {
      const reportVersion = tree.installation.status === 'Draft'
        ? { liveMode: true as const }
        : (() => {
            const preferredVersion = requireRecordVersionNumber(tree.recordVersionNumber);
            return { recordVersionNumber: preferredVersion };
          })();
      if ('liveMode' in reportVersion) {
        expectedReport.current = { reportSource: 'diagnostic-live' };
      } else {
        const recordVersionNumber = selectedIncludesHistoricalForm
          ? await findRecordVersionContainingForms(
              installationId,
              selectedIds,
              reportVersion.recordVersionNumber,
            )
          : reportVersion.recordVersionNumber;
        reportVersion.recordVersionNumber = recordVersionNumber;
        expectedReport.current = await getAuthoritativeReportProvenance(
          installationId,
          recordVersionNumber,
        );
      }
      await report.start(() =>
        startInstallationPdfJob(
          installationId,
          {
            ...reportVersion,
            formSubmissionIds: completedForms.length ? selectedIds : undefined,
            detailMode,
          },
        ),
      );
      toast.success('Installation pack queued on the API server.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  async function download() {
    try {
      await report.download();
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: 'Installations', href: '/installhub/installations' },
          {
            label: tree.installation.siteName,
            href: `/installhub/installations/${installationId}`,
          },
          { label: 'Report pack' },
        ]}
      />
      <PageHeader
        title="Installation report"
        subtitle="Generate the formal Field App Complete PDF pack from the current cloud record and original evidence."
        actions={
          <LinkButton
            href={`/installhub/installations/${installationId}/client-report`}
            variant="secondary"
          >
            <Icon name="eye" size={17} />
            Client preview
          </LinkButton>
        }
      />

      <Card className="mb-5 border-t-4 !border-t-[var(--primary)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.16em] text-[var(--primary)]">
              Field App Complete
            </p>
            <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.035em] text-[var(--text)]">
              {tree.installation.siteName}
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
              {tree.installation.clientName}
              <br />
              {tree.installation.siteAddress}
            </p>
          </div>
          <StatusBadge status={tree.installation.status} />
        </div>
        <div className="mt-6 border-t border-[var(--border)] pt-5">
          <DefinitionList
            items={[
              {
                label: 'Installer',
                value: tree.installation.inspectorName,
              },
              { label: 'Date', value: tree.installation.auditDate },
              { label: 'Zones', value: tree.zones.length },
              { label: 'Switchboards', value: tree.electricalAssets.length },
              { label: 'Meters', value: meterCount },
              { label: 'Site assets', value: tree.siteAssets.length },
            ]}
          />
        </div>
      </Card>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Completed forms"
          value={completedForms.length}
          icon="check"
          tone="success"
        />
        <StatCard
          label="Draft forms"
          value={draftForms.length}
          icon="clipboard"
          tone={draftForms.length ? 'warning' : 'success'}
        />
        <StatCard
          label="Selected for pack"
          value={selectedIds.length}
          icon="file-text"
        />
      </div>

      {draftForms.length ? (
        <InlineNotice tone="warning">
          {draftForms.length} draft form{draftForms.length === 1 ? '' : 's'}{' '}
          will not be included. Mark a form complete when you want it included;
          every answer and evidence field is optional.
        </InlineNotice>
      ) : (
        <InlineNotice tone="success">
          All recorded field forms are complete and eligible for the report
          pack.
        </InlineNotice>
      )}

      {tree.installation.status === 'Draft' ? (
        <div className="mt-5">
          <InlineNotice tone="warning">
            This Draft report uses the current cloud tree and is clearly marked
            non-authoritative. Complete the installation to create an immutable,
            pinned report source.
          </InlineNotice>
        </div>
      ) : !hasPinnedVersion ? (
        <div className="mt-5">
          <InlineNotice tone="warning">
            This Completed installation has no eligible pinned record version,
            so an authoritative PDF cannot be generated.
          </InlineNotice>
        </div>
      ) : null}

      <Card className="mt-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(260px,360px)] md:items-end">
          <div>
            <h2 className="text-lg font-extrabold text-[var(--text)]">
              Report organisation
            </h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
              The electrical map is always included. Choose how the supporting
              switchboard, device and load details are grouped.
            </p>
          </div>
          <div>
            <FieldLabel htmlFor="installhub-report-detail-mode">
              Detail grouping
            </FieldLabel>
            <Select
              id="installhub-report-detail-mode"
              value={detailMode}
              disabled={report.active || report.starting}
              onChange={(event) => setDetailMode(
                event.target.value as InstallHubReportDetailMode,
              )}
            >
              <option value="by-electrical-hierarchy">By electrical hierarchy</option>
              <option value="by-zone">By physical zone</option>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="my-5">
        <div className="mb-4">
          <h2 className="text-lg font-extrabold text-[var(--text)]">
            Completed form selection
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
            Select the completed commissioning forms that should be appended to
            this generated installation pack.
          </p>
        </div>
        {completedForms.length ? (
          <div className="grid gap-x-6 sm:grid-cols-2">
            {completedForms.map((form) => {
              const definition = FORM_DEFINITION_BY_TYPE[form.formType];
              return (
                <Checkbox
                  key={form.id}
                  label={`${definition?.shortTitle ?? form.formType} · ${new Date(form.completedAt ?? form.updatedAt).toLocaleDateString()}`}
                  checked={selectedIds.includes(form.id)}
                  disabled={report.active || report.starting}
                  onChange={(checked) => toggleForm(form.id, checked)}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-sm leading-6 text-[var(--text-sub)]">
            No completed forms are available. The pack can still include the
            installation hierarchy, metering registry, and asset evidence.
          </p>
        )}
      </Card>

      {report.error ? (
        <ErrorBanner message={installHubConnectionErrorMessage(report.error)} />
      ) : null}

      <ExportJobStatus
        className="mb-5"
        job={report.job}
        artifactName="installation pack"
        starting={report.starting}
        downloading={report.downloading}
        onDownload={() => void download()}
      />

      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-extrabold text-[var(--text)]">
              API server PDF
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--text-sub)]">
              {tree.installation.status === 'Draft'
                ? 'The server renders the current cloud tree as a non-authoritative diagnostic, including its electrical map.'
                : `The server reads pinned record version ${tree.recordVersionNumber ?? '—'} and its original evidence.`}
              {' '}The finished PDF remains available in cloud file history.
            </p>
          </div>
          <Button
            className="w-full shrink-0 sm:w-auto"
            disabled={
              report.active ||
              report.starting ||
              (tree.installation.status === 'Completed' && !hasPinnedVersion) ||
              (completedForms.length > 0 && selectedIds.length === 0)
            }
            onClick={() => void generate()}
          >
            {report.active || report.starting ? (
              'Preparing PDF…'
            ) : (
              <>
                <Icon name="file-text" size={17} />
                Generate report pack
              </>
            )}
          </Button>
        </div>
      </Card>
    </div>
  );
}
