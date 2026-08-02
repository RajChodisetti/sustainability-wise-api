'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badges';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { FieldLabel, Textarea } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import {
  completeInstallation,
  deleteCloudInstallation,
  reopenInstallation,
} from '@/modules/installhub/api/installhub';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import {
  useInstallationReadiness,
  useInstallationTree,
  useTreeWriter,
} from '@/modules/installhub/hooks/useInstallationTree';
import {
  Breadcrumbs,
  DefinitionList,
  WorkspaceLink,
} from '@/modules/installhub/components/InstallHubUi';
import {
  ConfirmDialog,
  SaveStateNotice,
  TreeDraftNavigationGuard,
} from '@/modules/installhub/components/WorkflowUi';
import { GridSupplyEditor } from '@/modules/installhub/components/GridSupplyEditor';
import { idempotencyKey, meterDevices } from '@/modules/installhub/lib/workflow';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';

export function InstallHubInstallationDetailPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);
  const readinessQuery = useInstallationReadiness(installationId);
  const writer = useTreeWriter(installationId);
  const router = useRouter();
  const toast = useToast();
  const { user } = useInstallHubAuth();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  if (!query.data) return <ErrorBanner message="Installation not found." />;

  const tree = query.data;
  const installation = tree.installation;
  const canDelete =
    user?.role === 'admin' ||
    Boolean(user?.id && installation.createdByUserId === user.id);
  const meters = meterDevices(tree).filter((meter) => meter.lifecycleState !== 'INACTIVE').length;
  const readiness = readinessQuery.data;
  const readinessAdvisory = readiness?.authority === 'LOCAL_ADVISORY';
  const evidenceCount =
    tree.zones.reduce((total, zone) => total + zone.photos.length, 0) +
    tree.electricalAssets.reduce(
      (total, board) =>
        total +
        (board.photo ? 1 : 0) +
        board.extraPhotos.length +
        board.meters.reduce(
          (meterTotal, meter) =>
            meterTotal +
            (meter.wwPhotos?.deviceInstalled ? 1 : 0) +
            (meter.wwPhotos?.switchboardOverview ? 1 : 0) +
            (meter.wwPhotos?.labeling ? 1 : 0) +
            (meter.wwPhotos?.extra?.length ?? 0),
          0,
        ),
      0,
    ) +
    tree.siteAssets.reduce(
      (total, asset) => total + (asset.locationPhoto ? 1 : 0) + asset.extraPhotos.length,
      0,
    ) +
    tree.formSubmissions.reduce((total, form) => total + form.attachments.length, 0);

  async function completeCurrentInstallation() {
    if (!readiness?.readyToComplete) return;
    setLifecycleBusy(true);
    try {
      await completeInstallation(installationId, {
        baseTreeRevision: tree.treeRevision || 0,
        idempotencyKey: idempotencyKey(`complete-${installationId}`, tree.treeRevision || 0),
      });
      setCompleteOpen(false);
      await writer.refresh();
      await readinessQuery.refetch();
      toast.success('Installation completed and authoritative version pinned.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function reopenCurrentInstallation() {
    if (!reopenReason.trim()) {
      toast.error('Enter a reason for reopening this installation.');
      return;
    }
    setLifecycleBusy(true);
    try {
      await reopenInstallation(installationId, {
        baseTreeRevision: tree.treeRevision || 0,
        reason: reopenReason.trim(),
        idempotencyKey: idempotencyKey(`reopen-${installationId}`, tree.treeRevision || 0),
      });
      setReopenOpen(false);
      setReopenReason('');
      await writer.refresh();
      await readinessQuery.refetch();
      toast.success('Installation reopened as a new draft revision.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function removeInstallation() {
    const confirmation = window.prompt(
      `Permanently delete ${installation.siteName} from Field App Complete Cloud Backup?\n\nThis removes its forms, unshared originals, generated reports, and version history. Existing iOS cpN copies remain on their devices but lose this server source.\n\nType the site name to confirm.`,
    );
    if (confirmation !== installation.siteName) {
      if (confirmation !== null) {
        toast.info('Site name did not match. Nothing was deleted.');
      }
      return;
    }
    try {
      await deleteCloudInstallation(installationId, true);
      toast.success('Cloud installation permanently deleted.');
      router.replace('/installhub/installations');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: installation.siteName },
      ]} />
      <PageHeader
        title={installation.siteName}
        subtitle={`${installation.clientName} · ${installation.siteAddress}`}
        actions={
          <>
            <StatusBadge status={installation.status} />
            <LinkButton href={`/installhub/installations/${installationId}/edit`} variant="secondary">Edit</LinkButton>
            <Button variant="secondary" onClick={() => void writer.refresh()}><Icon name="refresh" size={17} />Refresh</Button>
            <Button onClick={() => installation.status === 'Completed' ? setReopenOpen(true) : setCompleteOpen(true)}>
              {installation.status === 'Completed' ? 'Reopen' : 'Complete'}
            </Button>
            {canDelete ? (
              <Button variant="danger" onClick={() => void removeInstallation()}>
                Delete from cloud
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-sub)]">
          Tree revision <strong className="text-[var(--text)]">{tree.treeRevision || 0}</strong>
          {tree.recordVersionNumber !== undefined ? <> · Pinned version <strong className="text-[var(--text)]">{tree.recordVersionNumber}</strong></> : null}
        </p>
        <SaveStateNotice
          state={writer.writeState}
          onRetry={() => void writer.retry().catch((error) => toast.error(installHubConnectionErrorMessage(error)))}
          onDiscard={() => void writer.discard()}
        />
      </div>
      <TreeDraftNavigationGuard active={writer.hasPendingTree} onDiscard={writer.discard} />

      <Card className="mb-6">
        <DefinitionList items={[
          { label: 'Installer', value: installation.inspectorName },
          { label: 'Date', value: installation.auditDate },
          { label: 'Zones', value: tree.zones.length },
          { label: 'Switchboards', value: tree.electricalAssets.length },
          { label: 'Site assets', value: tree.siteAssets.length },
          { label: 'Meters', value: meters },
        ]} />
      </Card>

      <GridSupplyEditor
        tree={tree}
        mutate={writer.mutate}
        onError={(error) => toast.error(installHubConnectionErrorMessage(error))}
        onSuccess={(message) => toast.success(message)}
      />

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-extrabold text-[var(--text)]">Completion readiness</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">Server-authoritative checks cover unresolved supply, measurement, form, code, and dependency rules.</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${readiness?.readyToComplete ? 'bg-[var(--green-soft)] text-[var(--green)]' : 'bg-[var(--amber-soft)] text-[var(--text)]'}`}>
            {readinessQuery.isLoading
              ? 'Checking…'
              : readinessAdvisory
                ? 'Local advisory only'
                : readiness?.readyToComplete
                  ? 'Ready to complete'
                  : `${readiness?.issues.length || 0} issue${readiness?.issues.length === 1 ? '' : 's'}`}
          </span>
        </div>
        {readinessQuery.error ? <p className="mt-3 text-sm text-[var(--red)]">{installHubConnectionErrorMessage(readinessQuery.error)}</p> : null}
        {readinessAdvisory ? <div className="mt-3"><p className="text-sm font-semibold text-[var(--amber)]">Reconnect to obtain server-authoritative readiness. Local checks cannot complete or publish this installation.</p></div> : null}
        {readiness?.issues.length ? (
          <ul className="mt-4 space-y-2">
            {readiness.issues.slice(0, 6).map((issue) => (
              <li key={`${issue.code}-${issue.entityId}`} className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3 text-sm">
                <p className="font-bold text-[var(--text)]">{issue.message}</p>
                <p className="mt-1 text-xs text-[var(--text-sub)]">{issue.code} · {issue.entityType.replaceAll('_', ' ')}</p>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <LinkButton href={`/installhub/installations/${installationId}/data`} variant="secondary">Open reconciliation</LinkButton>
          <Button variant="secondary" onClick={() => void readinessQuery.refetch()}>Recheck</Button>
        </div>
      </Card>

      <section className="mb-7" aria-labelledby="installhub-workspace">
        <h2 id="installhub-workspace" className="mb-3 text-lg font-extrabold text-[var(--text)]">Installation workspace</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <WorkspaceLink href={`/installhub/installations/${installationId}/zones`} icon="building" title="Zones & assets" description="Zones, switchboards, meters, and site assets." count={tree.zones.length} />
          <WorkspaceLink href={`/installhub/installations/${installationId}/forms`} icon="clipboard" title="Field forms" description="Six current workflows plus legacy form history." count={tree.formSubmissions.length} />
          <WorkspaceLink href={`/installhub/installations/${installationId}/data`} icon="grid" title="Data view" description="Review hierarchy and resolve TBC relationships." />
          <WorkspaceLink href={`/installhub/installations/${installationId}/metering`} icon="gauge" title="Metering table" description="Meter devices, channels, and coverage." count={meters} />
          <WorkspaceLink href={`/installhub/installations/${installationId}/photos`} icon="camera" title="Photo gallery" description="All installation and form evidence." count={evidenceCount} />
          <WorkspaceLink href={`/installhub/installations/${installationId}/report`} icon="file-text" title="Report pack" description="Generate and download server PDF packs." />
          <WorkspaceLink href={`/installhub/installations/${installationId}/client-report`} icon="eye" title="Client report" description="Client-facing installation summary and readiness." />
          <WorkspaceLink href={`/installhub/installations/${installationId}/cloud`} icon="cloud" title="Cloud files & history" description="Stored originals, PDFs, and version snapshots." />
          {user?.role === 'admin' ? (
            <WorkspaceLink href={`/installhub/installations/${installationId}/access`} icon="users" title="Access" description="View or manage inspector assignment." />
          ) : null}
        </div>
      </section>

      <section aria-labelledby="installation-zones">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="installation-zones" className="text-lg font-extrabold text-[var(--text)]">Zones</h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">Open a zone to manage its boards, meters, and assets.</p>
          </div>
          <LinkButton href={`/installhub/installations/${installationId}/zones/new`}>
            <Icon name="plus" size={17} />Add zone
          </LinkButton>
        </div>
        {tree.zones.length === 0 ? (
          <EmptyState title="No zones yet" description="Add a zone to start mapping the installation." icon="building" />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {tree.zones.map((zone) => {
              const boards = tree.electricalAssets.filter((item) => item.zoneId === zone.id).length;
              const assets = tree.siteAssets.filter((item) => item.zoneId === zone.id).length;
              return (
                <Link key={zone.id} href={`/installhub/installations/${installationId}/zones/${zone.id}`} className="block">
                  <Card className="interactive-card h-full">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-extrabold text-[var(--text)]">{zone.zoneName}</p>
                        <p className="mt-1 text-sm text-[var(--text-sub)]">{zone.zoneDescription || 'No description'}</p>
                        <p className="mt-3 text-xs font-semibold text-[var(--muted)]">{boards} boards · {assets} assets · {zone.photos.length} photos</p>
                      </div>
                      <Icon name="chevron-right" size={18} className="text-[var(--muted)]" />
                    </div>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      <ConfirmDialog
        open={completeOpen}
        title="Complete this installation?"
        description="Completion is server-authoritative and pins an immutable record version from the exact current tree revision."
        consequences={readiness?.issues.length
          ? readiness.issues.slice(0, 8).map((issue) => issue.message)
          : ['Authoritative reports and canonical mapping exports become eligible.', 'Further operational changes require an explicit reopen reason.']}
        confirmLabel="Complete and pin version"
        danger={false}
        busy={lifecycleBusy}
        blockedMessage={readinessAdvisory
          ? 'Server-authoritative readiness is unavailable. Reconnect and recheck before completion.'
          : !readiness?.readyToComplete
          ? `Resolve all ${readiness?.issues.length || 0} readiness issue${readiness?.issues.length === 1 ? '' : 's'} before completion.`
          : undefined}
        onConfirm={() => void completeCurrentInstallation()}
        onCancel={() => setCompleteOpen(false)}
      >
        {!readiness?.readyToComplete ? (
          <LinkButton href={`/installhub/installations/${installationId}/data`} variant="secondary">Open reconciliation</LinkButton>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={reopenOpen}
        title="Reopen this completed installation?"
        description="The pinned record remains immutable. A new draft tree revision will record who reopened it and why."
        consequences={['Authoritative exports continue to reference the pinned version.', 'New changes remain draft-only until the installation is completed again.']}
        confirmLabel="Reopen as draft"
        danger={false}
        busy={lifecycleBusy}
        blockedMessage={!reopenReason.trim() ? 'Enter a reopen reason to continue.' : undefined}
        onConfirm={() => void reopenCurrentInstallation()}
        onCancel={() => { setReopenOpen(false); setReopenReason(''); }}
      >
        <FieldLabel htmlFor="installation-reopen-reason" className="mt-0">Reason for reopening *</FieldLabel>
        <Textarea id="installation-reopen-reason" value={reopenReason} onChange={(event) => setReopenReason(event.target.value)} />
      </ConfirmDialog>
    </div>
  );
}
