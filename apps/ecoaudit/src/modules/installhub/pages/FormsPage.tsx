'use client';

import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
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
import { useToast } from '@/contexts/ToastContext';
import { useExportJob } from '@/hooks/useExportJob';
import { slugify } from '@/lib/download';
import {
  downloadExportJob,
  getExportJobStatus,
  getLatestExportJob,
  startFormPdfJob,
} from '@/modules/installhub/api/installhub';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { Breadcrumbs } from '@/modules/installhub/components/InstallHubUi';
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
  type FormContext,
} from '@/modules/installhub/lib/model';
import type {
  FormSubmission,
  FormType,
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
          description="Start an installation, comms-fault, switchboard, water-meter, or logger workflow."
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
}: {
  installationId: string;
  form: FormSubmission;
}) {
  const writer = useTreeWriter(installationId);
  const router = useRouter();
  const toast = useToast();
  const definition = FORM_DEFINITION_BY_TYPE[form.formType];
  const pdf = useExportJob({
    scopeKey: ['installhub', installationId, 'form', form.id],
    loadLatest: () => getLatestExportJob(form.id),
    getStatus: getExportJobStatus,
    downloadJob: (job) => downloadExportJob(job.id),
    fallbackFilename: `${slugify(definition.shortTitle)}.pdf`,
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

  return (
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
          </div>
          <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
            Updated {new Date(form.updatedAt).toLocaleString()} ·{' '}
            {form.attachments.length} evidence photo
            {form.attachments.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton
            variant="secondary"
            href={`/installhub/installations/${installationId}/forms/${form.id}`}
          >
            {form.status === 'Completed' ? 'View record' : 'Continue draft'}
          </LinkButton>
          {form.status === 'Completed' ? (
            <>
              <Button
                disabled={pdf.starting || pdf.active}
                onClick={async () => {
                  try {
                    await pdf.start(() =>
                      startFormPdfJob(installationId, form.id),
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
              <Button
                variant="ghost"
                onClick={() => void createFormAmendment()}
              >
                Create amendment
              </Button>
            </>
          ) : null}
        </div>
      </div>
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
  const definitions = allowedFormDefinitions(context);

  async function start(type: FormType) {
    setBusyType(type);
    try {
      let formId = '';
      await writer.mutate((next) => {
        const form = createFormSubmission(next, type, currentUser, context);
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
      <div className="grid gap-4 lg:grid-cols-2">
        {definitions.map((definition) => (
          <Card key={definition.type} className="flex h-full flex-col">
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
