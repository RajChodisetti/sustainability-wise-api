'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badges';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { FieldHint, FieldLabel, Textarea } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import {
  completeInstallation,
  deleteCloudInstallation,
  reopenInstallation,
  type CompleteInstallationInput,
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
import {
  clearPersistedInstallationCompletionAttempt,
  INSTALLATION_COMPLETION_NOTES_MAX_LENGTH,
  installationCompletionAttemptMayHaveSucceeded,
  installationCompletionExactRetryIsDefinitive,
  installationCompletionIdempotencyKey,
  installationCompletionNotesForDialog,
  installationCompletionNotesIssue,
  installationCompletionRefreshError,
  installationCompletionRefreshState,
  normalizeInstallationCompletionNotes,
  persistInstallationCompletionAttempt,
  restoreInstallationCompletionAttempt,
  reuseInstallationCompletionAttempt,
} from '@/modules/installhub/lib/completion';

export function InstallHubInstallationDetailPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);
  const readinessQuery = useInstallationReadiness(installationId, { limit: 250 });
  const writer = useTreeWriter(installationId);
  const router = useRouter();
  const toast = useToast();
  const { user } = useInstallHubAuth();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completionNotes, setCompletionNotes] = useState('');
  const completionAttemptRef = useRef<CompleteInstallationInput | null>(null);
  const [completionRefreshRequired, setCompletionRefreshRequired] = useState(false);
  const [completionStateScope, setCompletionStateScope] = useState<string | null>(null);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  useEffect(() => {
    if (!user || query.data?.installation.id !== installationId) return;
    clearInstallationCreateAttempt(user.id, installationId);
  }, [installationId, query.data, user]);

  const currentCompletionStateScope = user
    ? `${user.id}\0${installationId}`
    : null;
  const completionStateReady = currentCompletionStateScope !== null
    && completionStateScope === currentCompletionStateScope;
  const loadedCompletionInstallationId = query.data?.installation.id;
  const loadedCompletionInstallationStatus = query.data?.installation.status;

  useEffect(() => {
    const actorUserId = user?.id;
    const hydrateTimer = window.setTimeout(() => {
      if (!actorUserId || loadedCompletionInstallationId !== installationId) {
        if (completionStateScope !== null) {
          completionAttemptRef.current = null;
          setCompletionRefreshRequired(false);
          setCompletionNotes('');
          setCompleteOpen(false);
          setCompletionStateScope(null);
        }
        return;
      }

      const scope = `${actorUserId}\0${installationId}`;
      if (completionStateScope !== scope) {
        completionAttemptRef.current = null;
        setCompletionRefreshRequired(false);
        setCompletionNotes('');
        setCompleteOpen(false);
        setCompletionStateScope(scope);
        if (loadedCompletionInstallationStatus === 'Completed') {
          clearPersistedInstallationCompletionAttempt(actorUserId, installationId);
          return;
        }
        const restored = restoreInstallationCompletionAttempt(
          actorUserId,
          installationId,
        );
        if (restored) {
          completionAttemptRef.current = restored;
          setCompletionNotes(restored.completionNotes ?? '');
          setCompletionRefreshRequired(true);
        }
        return;
      }

      if (loadedCompletionInstallationStatus === 'Completed') {
        clearPersistedInstallationCompletionAttempt(actorUserId, installationId);
        completionAttemptRef.current = null;
        setCompletionRefreshRequired(false);
        setCompletionNotes('');
        setCompleteOpen(false);
      }
    }, 0);
    return () => window.clearTimeout(hydrateTimer);
  }, [
    completionStateScope,
    installationId,
    loadedCompletionInstallationId,
    loadedCompletionInstallationStatus,
    user?.id,
  ]);

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
  const completionNotesError = installationCompletionNotesIssue(completionNotes);

  function clearCompletionAttempt(clearNotes: boolean) {
    if (user?.id) {
      clearPersistedInstallationCompletionAttempt(user.id, installationId);
    }
    completionAttemptRef.current = null;
    setCompletionRefreshRequired(false);
    if (clearNotes) setCompletionNotes('');
  }

  async function refreshCompletionState() {
    const results = await Promise.allSettled([
      writer.refresh(),
      readinessQuery.refetch({ throwOnError: true }),
    ]);
    const treeState = installationCompletionRefreshState(results[0]);
    if (treeState === 'COMPLETED') {
      clearCompletionAttempt(true);
    }
    return {
      treeRefresh: results[0],
      readinessRefresh: results[1],
      treeState,
    };
  }

  async function refreshCurrentInstallation() {
    const wasCompletionUncertain = completionRefreshRequired;
    setLifecycleBusy(true);
    try {
      const { treeRefresh, readinessRefresh, treeState } = await refreshCompletionState();
      const treeRefreshError = installationCompletionRefreshError(treeRefresh);
      const readinessRefreshError = installationCompletionRefreshError(readinessRefresh);
      if (treeState === 'FAILED') {
        toast.error(installHubConnectionErrorMessage(treeRefreshError));
      } else if (wasCompletionUncertain && treeState === 'DRAFT') {
        toast.error(
          'The latest cloud state is still Draft, so the earlier completion outcome remains uncertain. Retry the exact retained completion request to resolve it safely.',
        );
      } else if (readinessRefreshError) {
        toast.error('The latest installation was loaded, but completion readiness could not be rechecked.');
      } else if (wasCompletionUncertain) {
        toast.success('The latest cloud state confirms that the installation completed.');
      } else {
        toast.success('Latest cloud state loaded.');
      }
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function completeCurrentInstallation() {
    if (
      !user
      || !completionStateReady
      || completionRefreshRequired
      || !readiness?.readyToComplete
      || completionNotesError
    ) return;
    const normalizedCompletionNotes = normalizeInstallationCompletionNotes(completionNotes);
    const baseTreeRevision = tree.treeRevision || 0;
    const proposedInput = {
      baseTreeRevision,
      completionNotes: normalizedCompletionNotes,
      idempotencyKey: installationCompletionIdempotencyKey(
        installationId,
        baseTreeRevision,
        normalizedCompletionNotes,
      ),
    };
    const completionInput = reuseInstallationCompletionAttempt(
      completionAttemptRef.current,
      proposedInput,
    );
    completionAttemptRef.current = completionInput;
    if (!persistInstallationCompletionAttempt(user.id, installationId, completionInput)) {
      completionAttemptRef.current = null;
      toast.error(
        'This tab could not retain the exact completion request, so nothing was submitted. Enable session storage or use another supported browser and try again.',
      );
      return;
    }
    setLifecycleBusy(true);
    try {
      try {
        await completeInstallation(installationId, completionInput);
      } catch (error) {
        if (installationCompletionAttemptMayHaveSucceeded(error)) {
          setCompletionRefreshRequired(true);
          setCompleteOpen(false);
          const { treeState } = await refreshCompletionState();
          if (treeState === 'COMPLETED') {
            toast.success(
              'The completion response was interrupted, but the latest cloud state confirms that the installation completed.',
            );
          } else if (treeState === 'DRAFT') {
            toast.error(
              `${installHubConnectionErrorMessage(error)} The latest cloud state is still Draft, so the exact completion request remains locked for a safe retry.`,
            );
          } else {
            toast.error(
              `${installHubConnectionErrorMessage(error)} The completion outcome is uncertain, and the latest cloud state could not be verified. Retry the exact request or check again.`,
            );
          }
        } else {
          clearCompletionAttempt(false);
          toast.error(installHubConnectionErrorMessage(error));
        }
        return;
      }

      setCompleteOpen(false);
      setCompletionRefreshRequired(true);
      const { treeRefresh, readinessRefresh, treeState } = await refreshCompletionState();
      const treeRefreshError = installationCompletionRefreshError(treeRefresh);
      const readinessRefreshError = installationCompletionRefreshError(readinessRefresh);
      if (treeState === 'COMPLETED' && !readinessRefreshError) {
        toast.success('Installation completed and authoritative version pinned.');
      } else if (treeState === 'DRAFT') {
        toast.error(
          'Installation completion was accepted, but the latest cloud read still reports Draft. The exact accepted request remains locked until completion is visible.',
        );
      } else if (treeState === 'FAILED') {
        toast.error(
          `Installation completion was accepted, but the latest installation could not be verified. ${installHubConnectionErrorMessage(treeRefreshError)} Any retry will reuse the exact accepted request.`,
        );
      } else {
        toast.error(
          'Installation completed and the latest installation was loaded, but readiness could not be rechecked. Use Recheck before continuing.',
        );
      }
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function retryUncertainCompletion() {
    const completionInput = completionAttemptRef.current;
    if (!completionStateReady || !completionRefreshRequired || !completionInput) {
      toast.error('There is no retained completion request to retry. Check the latest cloud state first.');
      return;
    }
    setLifecycleBusy(true);
    try {
      try {
        const result = await completeInstallation(installationId, completionInput);
        if (result.status !== 'Completed') {
          toast.error('The exact completion retry returned an unexpected state. The retained request remains locked.');
          return;
        }
      } catch (error) {
        if (installationCompletionExactRetryIsDefinitive(error)) {
          clearCompletionAttempt(false);
          const { treeState } = await refreshCompletionState();
          if (treeState === 'COMPLETED') {
            toast.success(
              'The retained request was rejected, but the latest cloud state confirms that the installation is already completed.',
            );
          } else if (treeState === 'DRAFT') {
            toast.error(
              `${installHubConnectionErrorMessage(error)} The exact retained completion request was definitively rejected, so you can review the latest Draft and try again if appropriate.`,
            );
          } else {
            toast.error(
              `${installHubConnectionErrorMessage(error)} The exact retained completion request was definitively rejected, but the latest cloud state could not be loaded.`,
            );
          }
          return;
        }

        setCompletionRefreshRequired(true);
        const { treeState } = await refreshCompletionState();
        if (treeState === 'COMPLETED') {
          toast.success('The latest cloud state confirms that the retained completion request completed.');
        } else if (treeState === 'DRAFT') {
          toast.error(
            `${installHubConnectionErrorMessage(error)} The exact retry is still ambiguous and the cloud state remains Draft. The original request and notes remain locked.`,
          );
        } else {
          toast.error(
            `${installHubConnectionErrorMessage(error)} The exact retry is still ambiguous and the latest cloud state could not be verified.`,
          );
        }
        return;
      }

      setCompletionRefreshRequired(true);
      const { treeState, readinessRefresh } = await refreshCompletionState();
      const readinessRefreshError = installationCompletionRefreshError(readinessRefresh);
      if (treeState === 'COMPLETED' && !readinessRefreshError) {
        toast.success('The exact retained completion request completed and the authoritative version is pinned.');
      } else if (treeState === 'COMPLETED') {
        toast.error('Completion is confirmed, but readiness could not be rechecked. Use Recheck before continuing.');
      } else if (treeState === 'DRAFT') {
        toast.error(
          'The exact completion retry was accepted, but the latest cloud read still reports Draft. The same request remains locked while completion becomes visible.',
        );
      } else {
        toast.error(
          'The exact completion retry was accepted, but the latest cloud state could not be verified. The same request remains locked.',
        );
      }
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
            <Button variant="secondary" disabled={lifecycleBusy} onClick={() => void refreshCurrentInstallation()}><Icon name="refresh" size={17} />Refresh</Button>
            <Button disabled={lifecycleBusy || completionRefreshRequired || !completionStateReady} onClick={() => {
              if (installation.status === 'Completed') {
                setReopenOpen(true);
                return;
              }
              const previousAttempt = completionAttemptRef.current;
              if (previousAttempt && previousAttempt.baseTreeRevision !== (tree.treeRevision || 0)) {
                completionAttemptRef.current = null;
              }
              setCompletionNotes(installationCompletionNotesForDialog({
                previousAttempt,
                treeRevision: tree.treeRevision || 0,
                retainedNotes: completionNotes,
                serverNotes: installation.completionNotes,
              }));
              setCompleteOpen(true);
            }}>
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

      {completionStateReady && completionRefreshRequired ? (
        <div className="mb-6">
          <InlineNotice tone="warning">
            <div className="space-y-3">
              <p>
                The last completion outcome is uncertain. A cloud refresh that still shows Draft does not prove the original request has stopped; its revision, idempotency key, and technician notes remain locked.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={lifecycleBusy}
                  onClick={() => void refreshCurrentInstallation()}
                >
                  Check latest state
                </Button>
                <Button
                  disabled={lifecycleBusy}
                  onClick={() => void retryUncertainCompletion()}
                >
                  Retry exact completion
                </Button>
              </div>
            </div>
          </InlineNotice>
        </div>
      ) : null}

      {installation.status === 'Completed' ? (
        <Card className="mb-6 border-l-4 border-l-[var(--green)]">
          <h2 className="font-extrabold text-[var(--text)]">Technician completion notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-sub)]">
            {installation.completionNotes?.trim() || 'No technician completion notes were recorded.'}
          </p>
        </Card>
      ) : null}

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
          : completionRefreshRequired
            ? 'Resolve the retained completion request before starting another attempt.'
          : !readiness?.readyToComplete
          ? `Resolve all ${readinessIssueTotal} TBC item${readinessIssueTotal === 1 ? '' : 's'} before completion.`
          : completionNotesError ?? undefined}
        onConfirm={() => void completeCurrentInstallation()}
        onCancel={() => {
          clearCompletionAttempt(true);
          setCompleteOpen(false);
        }}
      >
        <FieldLabel htmlFor="installation-completion-notes" className="mt-0">
          Technician completion notes (optional)
        </FieldLabel>
        <Textarea
          id="installation-completion-notes"
          value={completionNotes}
          maxLength={INSTALLATION_COMPLETION_NOTES_MAX_LENGTH}
          rows={5}
          placeholder="Record final handover, access, labelling, or follow-up context for the completed installation."
          onChange={(event) => setCompletionNotes(event.target.value)}
        />
        <FieldHint>
          {completionNotes.length.toLocaleString('en-AU')} of{' '}
          {INSTALLATION_COMPLETION_NOTES_MAX_LENGTH.toLocaleString('en-AU')} characters. Blank notes are saved as none.
        </FieldHint>
        {!readiness?.readyToComplete ? (
          <div className="mt-4">
            <LinkButton href={`/installhub/installations/${installationId}/data`} variant="secondary">Open reconciliation</LinkButton>
          </div>
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
