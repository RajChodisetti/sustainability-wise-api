'use client';

import { useState } from 'react';
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
import { Checkbox } from '@/components/ui/FormFields';
import { ExportJobStatus } from '@/components/exports/ExportJobStatus';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import { useExportJob } from '@/hooks/useExportJob';
import { slugify } from '@/lib/download';
import {
  downloadExportJob,
  getExportJobStatus,
  getLatestExportJob,
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

export function InstallHubReportPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);
  const toast = useToast();
  const [selectedOverride, setSelectedOverride] = useState<string[] | null>(null);
  const report = useExportJob({
    scopeKey: ['installhub-installation', installationId],
    loadLatest: () => getLatestExportJob(installationId),
    getStatus: getExportJobStatus,
    downloadJob: (job) => downloadExportJob(job.id),
    fallbackFilename: `${slugify(query.data?.installation.siteName ?? 'installation')}-installhub-pack.pdf`,
  });

  if (query.isLoading) return <Spinner />;
  if (query.error) {
    return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  }
  if (!query.data) return <ErrorBanner message="Installation not found." />;
  const tree = query.data;
  const completedForms = tree.formSubmissions.filter(
    (form) => form.status === 'Completed',
  );
  const draftForms = tree.formSubmissions.filter(
    (form) => form.status === 'Draft',
  );
  const selectedIds =
    selectedOverride ?? completedForms.map((form) => form.id);
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
      await report.start(() =>
        startInstallationPdfJob(
          installationId,
          completedForms.length ? selectedIds : undefined,
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
        subtitle="Generate the formal InstallHub PDF pack from the current cloud record and original evidence."
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
              InstallHub
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
          will not be included. Complete the required fields and evidence before
          generating the final pack.
        </InlineNotice>
      ) : (
        <InlineNotice tone="success">
          All recorded field forms are complete and eligible for the report
          pack.
        </InlineNotice>
      )}

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
              The server reads the current backed-up hierarchy and original
              evidence, then keeps the finished PDF in cloud file history.
            </p>
          </div>
          <Button
            className="w-full shrink-0 sm:w-auto"
            disabled={
              report.active ||
              report.starting ||
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
