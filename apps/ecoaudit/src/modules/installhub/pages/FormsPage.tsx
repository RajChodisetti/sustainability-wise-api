'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useRef, useState } from 'react';
import { ExportJobStatus } from '@/components/exports/ExportJobStatus';
import { StatusBadge } from '@/components/ui/Badges';
import { Button, LinkButton } from '@/components/ui/Button';
import {
  Card,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Spinner,
} from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { FieldHint, FieldLabel } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import { useExportJob } from '@/hooks/useExportJob';
import { slugify } from '@/lib/download';
import {
  downloadExportJob,
  findRecordVersionContainingForms,
  getAuthoritativeReportProvenance,
  getExportJobStatus,
  getLatestExportJob,
  matchesInstallHubReportProvenance,
  requireRecordVersionNumber,
  startFormPdfJob,
} from '@/modules/installhub/api/installhub';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { Breadcrumbs } from '@/modules/installhub/components/InstallHubUi';
import { SearchableSelect } from '@/modules/installhub/components/SearchableSelect';
import { ConfirmDialog } from '@/modules/installhub/components/WorkflowUi';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import { FORM_DEFINITION_BY_TYPE } from '@/modules/installhub/forms/catalog';
import {
  useInstallationTree,
  useTreeWriter,
} from '@/modules/installhub/hooks/useInstallationTree';
import {
  allowedFormDefinitions,
  createAmendment,
  createFormSubmission,
  deleteDraftForm,
  type FormContext,
} from '@/modules/installhub/lib/model';
import type {
  FormSubmission,
  FormType,
  InstallHubReportProvenance,
} from '@/modules/installhub/types/domain';

export function InstallHubFormsPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);

  if (query.isLoading) return <Spinner label="Loading field forms…" />;
  if (query.error) {
    return (
      <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />
    );
  }
  const tree = query.data;
  if (!tree) return <ErrorBanner message="Installation not found." />;
  const forms = [...tree.formSubmissions].sort(
    (left, right) =>
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  );

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: 'Installations', href: '/installhub/installations' },
          {
            label: tree.installation.siteName,
            href: `/installhub/installations/${installationId}`,
          },
          { label: 'Field forms' },
        ]}
      />
      <PageHeader
        title="Field forms"
        subtitle="Draft, complete, export, and amend the same installation records available in the iOS app."
        actions={
          <LinkButton
            href={`/installhub/installations/${installationId}/forms/new`}
          >
            <Icon name="plus" size={17} />
            Start new form
          </LinkButton>
        }
      />
      {forms.length === 0 ? (
        <EmptyState
          title="No field forms yet"
          description="Start an installation, switchboard, water-meter, or logger workflow. Device replacements start from Find devices so the correct device is retained."
          icon="clipboard"
          actions={
            <LinkButton
              href={`/installhub/installations/${installationId}/forms/new`}
            >
              Start first form
            </LinkButton>
          }
        />
      ) : (
        <div className="space-y-4">
          {forms.map((form) => (
            <FormSummaryCard
              key={form.id}
              installationId={installationId}
              form={form}
              recordVersionNumber={tree.recordVersionNumber}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FormSummaryCard({
  installationId,
  form,
  recordVersionNumber,
}: {
  installationId: string;
  form: FormSubmission;
  recordVersionNumber?: number;
}) {
  const writer = useTreeWriter(installationId);
  const router = useRouter();
  const toast = useToast();
  const definition = FORM_DEFINITION_BY_TYPE[form.formType];
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const hasPinnedVersion = Number.isInteger(recordVersionNumber)
    && (recordVersionNumber ?? 0) > 0;
  const expectedReport = useRef<InstallHubReportProvenance | null>(null);

  async function selectReportProvenance(): Promise<InstallHubReportProvenance> {
    const preferredVersion = requireRecordVersionNumber(recordVersionNumber);
    const reportVersion = form.historicalMeterRemoved
      ? await findRecordVersionContainingForms(
          installationId,
          [form.id],
          preferredVersion,
        )
      : preferredVersion;
    const expected = await getAuthoritativeReportProvenance(
      installationId,
      reportVersion,
    );
    expectedReport.current = expected;
    return expected;
  }

  const pdf = useExportJob({
    scopeKey: ['installhub', installationId, 'form', form.id, String(recordVersionNumber ?? 'unversioned')],
    loadLatest: async () => (
      hasPinnedVersion
        ? getLatestExportJob(form.id, await selectReportProvenance())
        : null
    ),
    getStatus: getExportJobStatus,
    downloadJob: (job) => downloadExportJob(job.id),
    fallbackFilename: `${slugify(definition.shortTitle)}.pdf`,
    matchesJob: (job) => matchesInstallHubReportProvenance(job, expectedReport.current),
  });

  async function createFormAmendment() {
    try {
      let amendmentId = '';
      await writer.mutate((tree) => {
        const source = tree.formSubmissions.find(
          (item) => item.id === form.id,
        );
        if (!source) throw new Error('Form not found.');
        const amendment = createAmendment(source);
        tree.formSubmissions.push(amendment);
        amendmentId = amendment.id;
      });
      toast.success('Amendment created with the original evidence.');
      router.push(
        `/installhub/installations/${installationId}/forms/${amendmentId}`,
      );
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  async function removeDraft() {
    setDeleteBusy(true);
    try {
      await writer.mutate((tree) => {
        deleteDraftForm(tree, form.id);
      }, 'metadata');
      setDeleteOpen(false);
      toast.success('Draft deleted.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <>
    <Card>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-extrabold text-[var(--text)]">
              {definition.shortTitle}
            </h2>
            <StatusBadge status={form.status} />
            {form.supersedesId ? (
              <span className="rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--primary)]">
                Amendment
              </span>
            ) : null}
            {form.historicalMeterRemoved ? (
              <span className="rounded-full bg-[var(--amber-soft)] px-2.5 py-1 text-xs font-bold text-[var(--amber)]">
                Historical commissioning evidence
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
            Updated {new Date(form.updatedAt).toLocaleString()} ·{' '}
            {form.attachments.length} evidence photo
            {form.attachments.length === 1 ? '' : 's'}
          </p>
          {form.historicalMeterRemoved ? (
            <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
              The commissioned meter is no longer active. This completed form,
              its original meter ID, and its evidence remain immutable in pinned
              version history.
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton
            variant="secondary"
            href={`/installhub/installations/${installationId}/forms/${form.id}`}
          >
            {form.status === 'Completed' ? 'View record' : 'Continue draft'}
          </LinkButton>
          {form.status === 'Draft' ? (
            <Button
              variant="danger"
              onClick={() => setDeleteOpen(true)}
            >
              <Icon name="trash" size={17} />
              Delete draft
            </Button>
          ) : null}
          {form.status === 'Completed' ? (
            <>
              <Button
                  disabled={pdf.starting || pdf.active || !hasPinnedVersion}
                  onClick={async () => {
                    try {
                    const expected = await selectReportProvenance();
                    await pdf.start(() =>
                      startFormPdfJob(
                        installationId,
                        form.id,
                        expected.recordVersionNumber,
                      ),
                    );
                    toast.success('Form PDF generation started.');
                  } catch (error) {
                    toast.error(installHubConnectionErrorMessage(error));
                  }
                }}
              >
                <Icon name="file-text" size={17} />
                {pdf.active ? 'Preparing PDF…' : 'Generate PDF'}
              </Button>
              {!form.historicalMeterRemoved ? (
                <Button
                  variant="ghost"
                  onClick={() => void createFormAmendment()}
                >
                  Create amendment
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
      {form.status === 'Completed' && !hasPinnedVersion ? (
        <p className="mt-3 text-xs font-semibold text-[var(--amber)]">
          A pinned record version is required before generating this authoritative PDF.
        </p>
      ) : null}
      <ExportJobStatus
        job={pdf.job}
        artifactName="form PDF"
        starting={pdf.starting}
        downloading={pdf.downloading}
        onDownload={() => {
          void pdf
            .download()
            .then(() => toast.success('PDF download started.'))
            .catch((error) =>
              toast.error(installHubConnectionErrorMessage(error)),
            );
        }}
        className="mt-4"
      />
      {pdf.error ? (
        <div className="mt-4">
          <ErrorBanner
            message={installHubConnectionErrorMessage(pdf.error)}
          />
        </div>
      ) : null}
    </Card>
    <ConfirmDialog
      open={deleteOpen}
      title={`Delete ${definition.shortTitle} draft?`}
      description="This removes the unfinished form and its evidence references from the installation."
      consequences={[
        `${form.attachments.length} evidence photo reference${form.attachments.length === 1 ? '' : 's'} will be removed`,
        'Completed forms and operational records are unchanged',
      ]}
      confirmLabel="Delete draft"
      busy={deleteBusy}
      onConfirm={() => void removeDraft()}
      onCancel={() => setDeleteOpen(false)}
    />
    </>
  );
}

export function InstallHubFormTypePickerPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const search = useSearchParams();
  const query = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const { user } = useInstallHubAuth();
  const router = useRouter();
  const toast = useToast();
  const [busyType, setBusyType] = useState<FormType | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState(search.get('boardId') || '');
  const context: FormContext = {
    zoneId: search.get('zoneId'),
    boardId: search.get('boardId'),
    meterId: search.get('meterId'),
    siteAssetId: search.get('siteAssetId'),
  };

  if (query.isLoading) return <Spinner />;
  if (query.error) {
    return (
      <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />
    );
  }
  const tree = query.data;
  if (!tree || !user) return <ErrorBanner message="Installation not found." />;
  const currentUser = user;
  const definitions = allowedFormDefinitions(context, tree.installation.serviceType);
  const boardOptions = tree.electricalAssets.map((board) => {
    const zone = tree.zones.find((item) => item.id === board.zoneId);
    return {
      value: board.id,
      label: `${board.assetName} · ${board.assetType} · ${zone?.zoneName || 'Unknown zone'}`,
      keywords: `${board.displayCodeMeta?.value || board.displayCode} ${board.typeCode || ''} ${board.id}`,
    };
  });

  async function start(type: FormType) {
    setBusyType(type);
    try {
      let formId = '';
      await writer.mutate((next) => {
        const effectiveContext = type === 'ww-installation'
          ? {
              ...context,
              boardId: selectedBoardId || null,
              zoneId: next.electricalAssets.find((board) => board.id === selectedBoardId)?.zoneId || context.zoneId,
            }
          : context;
        const form = createFormSubmission(next, type, currentUser, effectiveContext);
        next.formSubmissions.push(form);
        formId = form.id;
      }, 'metadata');
      toast.success('Draft form created.');
      router.replace(
        `/installhub/installations/${installationId}/forms/${formId}`,
      );
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
      setBusyType(null);
    }
  }

  return (
    <div>
      <Breadcrumbs
        items={[
          {
            label: tree.installation.siteName,
            href: `/installhub/installations/${installationId}`,
          },
          {
            label: 'Field forms',
            href: `/installhub/installations/${installationId}/forms`,
          },
          { label: 'New form' },
        ]}
      />
      <PageHeader
        title="New field form"
        subtitle="Choose the work record. Site, installer, switchboard, device, and asset details are prefilled when available."
      />
      {definitions.some((definition) => definition.type === 'ww-installation') ? (
        <Card className="mb-5">
          <h2 className="font-extrabold text-[var(--text)]">Installation Form (WW) switchboard</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">Optional. Choose a switchboard to prefill canonical context; leave it blank when no board is available.</p>
          <div className="mt-2 max-w-2xl">
            <FieldLabel htmlFor="new-form-board">Switchboard</FieldLabel>
            <SearchableSelect
              id="new-form-board"
              value={selectedBoardId}
              options={boardOptions}
              placeholder="Search name, type, physical zone, or ID"
              emptyMessage="No switchboards match this search."
              onChange={setSelectedBoardId}
            />
            <FieldHint>Search and choose in one field, or leave blank. Up to 100 matching switchboards are shown at once.</FieldHint>
          </div>
          {tree.electricalAssets.length === 0 ? (
            <div className="mt-3"><LinkButton href={`/installhub/installations/${installationId}/zones`} variant="secondary"><Icon name="plus" size={16} />Add a switchboard</LinkButton></div>
          ) : null}
        </Card>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {definitions.map((definition) => (
          <Card
            key={definition.type}
            id={`new-form-${definition.type}`}
            tabIndex={-1}
            className="flex h-full scroll-mt-4 flex-col"
          >
            <div className="flex-1">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-extrabold text-[var(--text)]">
                  {definition.shortTitle}
                </h2>
                <span className="rounded-full bg-[var(--surface2)] px-2.5 py-1 text-xs font-bold text-[var(--text-sub)]">
                  {definition.sections.length} sections
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
                {definition.description}
              </p>
            </div>
            <Button
              className="mt-5 w-full"
              disabled={busyType !== null}
              onClick={() => void start(definition.type)}
            >
              {busyType === definition.type ? 'Creating…' : 'Start form'}
            </Button>
          </Card>
        ))}
      </div>
      {definitions.length === 0 ? (
        <EmptyState
          title="No form matches this context"
          description="Return to the installation and start a general field form."
        />
      ) : null}
    </div>
  );
}

export function RelatedFormLink({
  installationId,
  form,
}: {
  installationId: string;
  form: FormSubmission;
}) {
  const definition = FORM_DEFINITION_BY_TYPE[form.formType];
  return (
    <Link
      href={`/installhub/installations/${installationId}/forms/${form.id}`}
      className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold text-[var(--text)] hover:border-[var(--primary)] hover:text-[var(--primary)]"
    >
      <span>
        {definition.shortTitle} · {form.status}
      </span>
      <Icon name="chevron-right" size={16} />
    </Link>
  );
}

export const InstallHubNewFormPage = InstallHubFormTypePickerPage;
export { InstallHubFormEditorPage } from '@/modules/installhub/pages/FormEditorPage';
