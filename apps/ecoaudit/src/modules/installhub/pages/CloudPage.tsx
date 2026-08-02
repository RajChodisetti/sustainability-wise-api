'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import {
  Card,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Spinner,
} from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import { downloadBlob, slugify } from '@/lib/download';
import {
  downloadStoredFile,
  getInstallationVersion,
  listInstallationFiles,
  listInstallationVersions,
} from '@/modules/installhub/api/installhub';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import {
  Breadcrumbs,
  DefinitionList,
  InlineNotice,
} from '@/modules/installhub/components/InstallHubUi';
import type {
  CloudStoredFile,
  InstallationVersionRecord,
  InstallationVersionSummary,
} from '@/modules/installhub/types/domain';

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function fileTitle(file: CloudStoredFile): string {
  return (
    file.originalFilename ||
    file.fieldName ||
    file.storageKey.split('/').pop() ||
    'Stored file'
  );
}

function fileDownloadName(file: CloudStoredFile): string {
  const title = fileTitle(file);
  if (title.includes('.')) return title;
  const extension = file.contentType.includes('pdf')
    ? 'pdf'
    : file.contentType.includes('png')
      ? 'png'
      : file.contentType.includes('webp')
        ? 'webp'
        : 'jpg';
  return `${slugify(title)}.${extension}`;
}

export function InstallHubCloudPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const toast = useToast();
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<InstallationVersionRecord | null>(
    null,
  );
  const query = useQuery({
    queryKey: ['installhub', 'cloud-files', installationId],
    queryFn: async () => {
      const [files, versions] = await Promise.all([
        listInstallationFiles(installationId),
        listInstallationVersions(installationId),
      ]);
      return { files, versions };
    },
  });

  async function download(file: CloudStoredFile) {
    setDownloadingKey(file.storageKey);
    try {
      downloadBlob(await downloadStoredFile(file), fileDownloadName(file));
      toast.success('Cloud file downloaded.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setDownloadingKey(null);
    }
  }

  async function inspect(version: InstallationVersionSummary) {
    setInspecting(version.versionNumber);
    try {
      setSnapshot(
        await getInstallationVersion(installationId, version.versionNumber),
      );
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setInspecting(null);
    }
  }

  if (query.isLoading) return <Spinner label="Loading cloud history…" />;
  if (query.error) {
    return (
      <div>
        <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />
        <Button
          className="mt-4"
          variant="secondary"
          onClick={() => void query.refetch()}
        >
          Try again
        </Button>
      </div>
    );
  }
  const filesResponse = query.data?.files;
  const versions = query.data?.versions.versions ?? [];
  const files = filesResponse?.files ?? [];

  return (
    <div>
      <Breadcrumbs
        items={[
          { label: 'Installations', href: '/installhub/installations' },
          {
            label: filesResponse?.installationName || 'Installation',
            href: `/installhub/installations/${installationId}`,
          },
          { label: 'Cloud files & history' },
        ]}
      />
      <PageHeader
        title="Cloud files & history"
        subtitle={`${filesResponse?.installationName || 'Field App Complete installation'} · Server originals and finalized versions are read-only.`}
        actions={
          <Button
            variant="secondary"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <Icon name="refresh" size={17} />
            {query.isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        }
      />

      <InlineNotice>
        Downloading creates a temporary browser copy. Original evidence,
        generated reports, and version snapshots remain protected in Field App Complete
        cloud storage.
      </InlineNotice>

      <section className="mt-7" aria-labelledby="stored-files-heading">
        <h2
          id="stored-files-heading"
          className="mb-3 text-lg font-extrabold text-[var(--text)]"
        >
          Stored files ({files.length})
        </h2>
        {files.length === 0 ? (
          <EmptyState
            title="No stored files"
            description="Backed-up evidence and API-generated reports will appear here."
            icon="cloud"
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {files.map((file) => {
              const isPdf =
                file.source === 'report_pdf' ||
                file.contentType.includes('pdf');
              return (
                <Card key={file.storageKey} className="!p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="break-words font-extrabold text-[var(--text)]">
                        {fileTitle(file)}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
                        {formatBytes(file.sizeBytes)} ·{' '}
                        {formatTimestamp(
                          file.uploadedAt ||
                            file.lastModified ||
                            file.createdAt,
                        )}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-xs font-bold ${
                        isPdf
                          ? 'border-[var(--primary)]/25 bg-[var(--primary-soft)] text-[var(--primary)]'
                          : 'border-[var(--green)]/25 bg-[var(--green-soft)] text-[var(--green)]'
                      }`}
                    >
                      {isPdf ? 'PDF' : 'Evidence'}
                    </span>
                  </div>
                  <p className="mt-3 break-all text-xs leading-5 text-[var(--muted)]">
                    {file.fieldName || file.storageKey}
                  </p>
                  <Button
                    className="mt-4 w-full sm:w-auto"
                    variant="secondary"
                    disabled={Boolean(downloadingKey)}
                    onClick={() => void download(file)}
                  >
                    <Icon name="download" size={17} />
                    {downloadingKey === file.storageKey
                      ? 'Downloading…'
                      : 'Download'}
                  </Button>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="mt-8" aria-labelledby="version-history-heading">
        <h2
          id="version-history-heading"
          className="mb-3 text-lg font-extrabold text-[var(--text)]"
        >
          Backup versions ({versions.length})
        </h2>
        {versions.length === 0 ? (
          <EmptyState
            title="No finalized versions"
            description="A version is created after a Field App Complete cloud save finishes."
            icon="file-text"
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {versions.map((version) => (
              <Card key={version.id} className="!p-4">
                <p className="font-extrabold text-[var(--text)]">
                  Version {version.versionNumber}
                </p>
                <p className="mt-1 text-sm text-[var(--text-sub)]">
                  {formatTimestamp(version.createdAt)}
                </p>
                <Button
                  className="mt-4 w-full"
                  variant="secondary"
                  disabled={inspecting !== null}
                  onClick={() => void inspect(version)}
                >
                  <Icon name="eye" size={17} />
                  {inspecting === version.versionNumber
                    ? 'Loading snapshot…'
                    : 'Inspect snapshot'}
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>

      {snapshot ? (
        <Card className="mt-5 border-[var(--primary)]/30">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-extrabold text-[var(--text)]">
                Version {snapshot.versionNumber} snapshot
              </h2>
              <p className="mt-1 text-sm text-[var(--text-sub)]">
                Saved {formatTimestamp(snapshot.createdAt)}
              </p>
            </div>
            <Button variant="ghost" onClick={() => setSnapshot(null)}>
              Close
            </Button>
          </div>
          <div className="mt-5 border-t border-[var(--border)] pt-5">
            <DefinitionList
              items={[
                {
                  label: 'Site',
                  value: snapshot.snapshot.installationTree.installation.siteName,
                },
                { label: 'Zones', value: snapshot.snapshot.installationTree.zones.length },
                {
                  label: 'Switchboards',
                  value: snapshot.snapshot.installationTree.electricalAssets.length,
                },
                {
                  label: 'Site assets',
                  value: snapshot.snapshot.installationTree.siteAssets.length,
                },
                {
                  label: 'Forms',
                  value: snapshot.snapshot.installationTree.formSubmissions.length,
                },
                {
                  label: 'Report eligibility',
                  value: snapshot.snapshot.readiness.eligibility.authoritativeReport
                    ? 'Authoritative'
                    : 'Diagnostic only',
                },
              ]}
            />
          </div>
          <p className="mt-5 text-xs leading-5 text-[var(--text-sub)]">
            Snapshots are read-only. Continue editing the current installation
            record to create a newer cloud version.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
