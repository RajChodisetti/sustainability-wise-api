'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badges';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
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
  InlineNotice,
  WorkspaceLink,
} from '@/modules/installhub/components/InstallHubUi';
import {
  ConfirmDialog,
  SaveStateNotice,
  TreeDraftNavigationGuard,
} from '@/modules/installhub/components/WorkflowUi';
import { GridSupplyEditor } from '@/modules/installhub/components/GridSupplyEditor';
import { idempotencyKey, meterDevices } from '@/modules/installhub/lib/workflow';
import {
  meteringInventorySummary,
  readinessCorrectionAction,
  readinessEntityDetails,
  readinessIssueKey,
} from '@/modules/installhub/lib/electricalPresentation';
import { groupReadinessIssues } from '@/modules/installhub/lib/readinessPresentation';
import { clearInstallationCreateAttempt } from '@/modules/installhub/lib/model';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';

export function InstallHubInstallationDetailPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);
  const readinessQuery = useInstallationReadiness(installationId, { limit: 250 });
  const writer = useTreeWriter(installationId);
  const router = useRouter();
  const toast = useToast();
  const { user } = useInstallHubAuth();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  useEffect(() => {
    if (!user || query.data?.installation.id !== installationId) return;
    clearInstallationCreateAttempt(user.id, installationId);
  }, [installationId, query.data, user]);

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  if (!query.data) return <ErrorBanner message="Installation not found." />;

  const tree = query.data;
  const installation = tree.installation;
  const canDelete =
    user?.role === 'admin' ||
    Boolean(user?.id && installation.createdByUserId === user.id);
  const meters = meterDevices(tree).filter((meter) => meter.lifecycleState !== 'INACTIVE').length;
  const meteringInventory = meteringInventorySummary(tree);
  const readiness = readinessQuery.data;
  const readinessAdvisory = readiness?.authority === 'LOCAL_ADVISORY';
  const readinessGroups = groupReadinessIssues(readiness?.issues || []);
  const readinessIssueCount = readiness?.issues.length ?? 0;
  const readinessIssueTotal = readiness?.issuePage?.total ?? readinessIssueCount;
  const readinessIssuesTruncated = readinessIssueTotal > readinessIssueCount;
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
                Delete installation
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-sub)]">
          <strong className="text-[var(--text)]">{tree.zones.length}</strong> zones · <strong className="text-[var(--text)]">{tree.electricalAssets.length}</strong> switchboards · <strong className="text-[var(--text)]">{tree.siteAssets.length}</strong> site assets · <strong className="text-[var(--text)]">{meters}</strong> devices
        </p>
        <SaveStateNotice
          state={writer.writeState}
          onRetry={() => void writer.retry().catch((error) => toast.error(installHubConnectionErrorMessage(error)))}
          onDiscard={() => void writer.discard()}
        />
      </div>
      <TreeDraftNavigationGuard active={writer.hasPendingTree} onDiscard={writer.discard} />

      <section className="mb-7" aria-labelledby="installhub-workspace">
        <h2 id="installhub-workspace" className="mb-3 text-lg font-extrabold text-[var(--text)]">Installation workspace</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
          <WorkspaceLink href={`/installhub/installations/${installationId}/zones`} icon="building" title="Zones & assets" description="Manage zones, switchboards, devices, and site assets." count={tree.zones.length} />
          <WorkspaceLink href={`/installhub/installations/${installationId}/data#canonical-electrical-map`} icon="zap" title="Electrical map" description="Review the supply hierarchy and exact metering links." count={tree.electricalAssets.length + tree.siteAssets.length} />
          <WorkspaceLink href={`/installhub/installations/${installationId}/forms`} icon="clipboard" title="Field forms" description="Complete installation and service workflows." count={tree.formSubmissions.length} />
          <WorkspaceLink href={`/installhub/installations/${installationId}/devices`} icon="search" title="Find devices" description="Search every zone in this installation and replace a device." />
          <WorkspaceLink href={`/installhub/installations/${installationId}/report`} icon="file-text" title="Report pack" description="Generate and download the installation report." />
        </div>
      </section>

      <details className="mb-6 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-xs)]">
        <summary className="cursor-pointer text-sm font-extrabold text-[var(--text)]">More tools</summary>
        <p className="mt-3 text-xs leading-5 text-[var(--text-sub)]">Detailed review and administration tools used when needed.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <LinkButton href={`/installhub/installations/${installationId}/data`} variant="secondary">Reconciliation</LinkButton>
          <LinkButton href={`/installhub/installations/${installationId}/metering`} variant="secondary">Metering table</LinkButton>
          <LinkButton href={`/installhub/installations/${installationId}/photos`} variant="secondary">Photo gallery</LinkButton>
          <LinkButton href={`/installhub/installations/${installationId}/cloud`} variant="secondary">Files & history</LinkButton>
          {user?.role === 'admin' ? <LinkButton href={`/installhub/installations/${installationId}/access`} variant="secondary">Access</LinkButton> : null}
        </div>
      </details>

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
            <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">Only relationships explicitly left “To be confirmed” appear here and block completion. All other captured fields are optional.</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-extrabold ${readiness?.readyToComplete ? 'bg-[var(--green-soft)] text-[var(--green)]' : 'bg-[var(--amber-soft)] text-[var(--text)]'}`}>
            {readinessQuery.isLoading
              ? 'Checking…'
              : readinessAdvisory
                ? 'Local advisory only'
                : readiness?.readyToComplete
                  ? 'Ready to complete'
                  : `${readinessIssueTotal} to confirm`}
          </span>
        </div>
        {readinessQuery.error ? <p className="mt-3 text-sm text-[var(--red)]">{installHubConnectionErrorMessage(readinessQuery.error)}</p> : null}
        {readinessAdvisory ? <div className="mt-3"><p className="text-sm font-semibold text-[var(--amber)]">Reconnect to obtain server-authoritative readiness. Local checks cannot complete or publish this installation.</p></div> : null}
        {meteringInventory.assets.confirmedUnmetered ? (
          <div className="mt-3">
            <InlineNotice tone="success">
              {meteringInventory.assets.confirmedUnmetered} confirmed unmetered asset{meteringInventory.assets.confirmedUnmetered === 1 ? '' : 's'} remain in the asset register. That metering state does not block completion; only explicit TBC relationships are listed below.
            </InlineNotice>
          </div>
        ) : null}
        {readinessGroups.length ? (
          <details className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3">
            <summary className="cursor-pointer text-sm font-extrabold text-[var(--text)]">
              Review {readinessGroups.length} TBC categor{readinessGroups.length === 1 ? 'y' : 'ies'}
              {readinessIssuesTruncated ? ` · first ${readinessIssueCount} of ${readinessIssueTotal} items shown` : ''}
            </summary>
            <div className="mt-3 space-y-2">
              {readinessGroups.map((group) => (
                <details key={group.key} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                  <summary className="cursor-pointer text-sm font-bold text-[var(--text)]">
                    {group.title} · {group.count}
                  </summary>
                  <ul className="mt-2 space-y-2 text-sm text-[var(--text-sub)]">
                    {group.issues.map((issue, issueIndex) => {
                      const entity = readinessEntityDetails(tree, issue);
                      const correction = readinessCorrectionAction(tree, issue);
                      return (
                        <li key={`${readinessIssueKey(issue)}-${issueIndex}`}>
                          <Link
                            href={correction.href}
                            className="group block rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5 transition-colors hover:border-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/30"
                          >
                            <span className="block text-xs font-extrabold text-[var(--text)]">
                              {entity.code ? `${entity.code} — ` : ''}{entity.name}
                            </span>
                            <span className="mt-1 block leading-5">{issue.message}</span>
                            <span className="mt-1 block text-xs font-bold text-[var(--primary)]">
                              {correction.label}{issue.field ? ` · ${issue.field}` : ''} <Icon name="chevron-right" size={14} className="inline" />
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </details>
              ))}
            </div>
          </details>
        ) : null}
        {readinessIssuesTruncated ? (
          <div className="mt-3">
            <InlineNotice>
              This expanded view shows the first {readinessIssueCount} of {readinessIssueTotal} TBC items. <Link className="font-semibold underline" href={`/installhub/installations/${installationId}/data`}>Open reconciliation</Link> to search and page through every item.
            </InlineNotice>
          </div>
        ) : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <LinkButton href={`/installhub/installations/${installationId}/data`} variant="secondary">Open reconciliation</LinkButton>
          <Button variant="secondary" onClick={() => void readinessQuery.refetch()}>Recheck</Button>
        </div>
      </Card>

      <ConfirmDialog
        open={completeOpen}
        title="Complete this installation?"
        description="Completion is server-authoritative and pins an immutable record version from the exact current tree revision."
        consequences={readinessIssueCount
          ? (readiness?.issues || []).slice(0, 8).map((issue) => issue.message)
          : ['Authoritative reports and canonical mapping exports become eligible.', 'Further operational changes require an explicit reopen reason.']}
        confirmLabel="Complete and pin version"
        danger={false}
        busy={lifecycleBusy}
        blockedMessage={readinessAdvisory
          ? 'Server-authoritative readiness is unavailable. Reconnect and recheck before completion.'
          : !readiness?.readyToComplete
          ? `Resolve all ${readinessIssueTotal} TBC item${readinessIssueTotal === 1 ? '' : 's'} before completion.`
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
