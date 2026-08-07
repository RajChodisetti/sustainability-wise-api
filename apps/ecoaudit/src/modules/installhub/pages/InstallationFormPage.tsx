'use client';
/* eslint-disable react-hooks/set-state-in-effect -- hydrates the editor once its installation query resolves */

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input, Textarea } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import {
  InstallHubApiError,
  installHubConnectionErrorMessage,
} from '@/modules/installhub/api/client';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import { getInstallationTree } from '@/modules/installhub/api/installhub';
import {
  installationTreeKey,
  installationTreesKey,
  submitAndConfirmInstallationTree,
  useInstallationTree,
  useTreeWriter,
} from '@/modules/installhub/hooks/useInstallationTree';
import {
  canonicalSiteCodeForWrite,
  clearInstallationCreateAttempt,
  installationCreateFailureDisposition,
  installationCreateAttempt,
  persistInstallationCreateAttempt,
  restoreInstallationCreateAttempt,
  todayIso,
} from '@/modules/installhub/lib/model';
import type { InstallationTree } from '@/modules/installhub/types/domain';
import { Breadcrumbs } from '@/modules/installhub/components/InstallHubUi';
import {
  SaveStateNotice,
  TreeDraftNavigationGuard,
  requestTreeNavigation,
} from '@/modules/installhub/components/WorkflowUi';

type FormState = {
  clientName: string;
  siteName: string;
  siteAddress: string;
  inspectorName: string;
  auditDate: string;
  siteCode: string;
  timezone: string;
};

const emptyForm: FormState = {
  clientName: '',
  siteName: '',
  siteAddress: '',
  inspectorName: '',
  auditDate: todayIso(),
  siteCode: '',
  timezone: '',
};

export function InstallHubInstallationFormPage({ mode }: { mode: 'new' | 'edit' }) {
  const params = useParams<{ installationId?: string }>();
  const installationId = params.installationId;
  const treeQuery = useInstallationTree(mode === 'edit' ? installationId : undefined);
  const writer = useTreeWriter(installationId ?? '');
  const queryClient = useQueryClient();
  const { user } = useInstallHubAuth();
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [createRetryLocked, setCreateRetryLocked] = useState(false);
  const [acknowledgedCreateId, setAcknowledgedCreateId] = useState<string | null>(null);
  const [hydratedCreateOwnerId, setHydratedCreateOwnerId] = useState<string | null>(null);
  const pendingCreateRef = useRef<InstallationTree | null>(null);
  const createAttemptRestoredForUserRef = useRef<string | null>(null);
  const currentCreateOwnerIdRef = useRef<string | null>(null);
  const createOperationGenerationRef = useRef(0);
  const componentMountedRef = useRef(false);

  useLayoutEffect(() => {
    componentMountedRef.current = true;
    return () => {
      componentMountedRef.current = false;
      createOperationGenerationRef.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    currentCreateOwnerIdRef.current = user?.id ?? null;
    createOperationGenerationRef.current += 1;
  }, [user?.id]);

  useEffect(() => {
    if (
      mode !== 'new'
      || !user
      || createAttemptRestoredForUserRef.current === user.id
    ) return;
    createAttemptRestoredForUserRef.current = user.id;
    pendingCreateRef.current = null;
    setBusy(false);
    setCreateRetryLocked(false);
    setAcknowledgedCreateId(null);
    setDirty(false);
    const restored = restoreInstallationCreateAttempt(user.id);
    if (restored) {
      const installation = restored.installation;
      pendingCreateRef.current = restored;
      setForm({
        clientName: installation.clientName,
        siteName: installation.siteName,
        siteAddress: installation.siteAddress,
        inspectorName: installation.inspectorName,
        auditDate: installation.auditDate,
        siteCode: installation.siteCode || '',
        timezone: installation.timezone || '',
      });
      setDirty(true);
      setCreateRetryLocked(true);
      setHydratedCreateOwnerId(user.id);
      return;
    }
    setForm({
      ...emptyForm,
      auditDate: todayIso(),
      inspectorName: user.fullName || user.email,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    setHydratedCreateOwnerId(user.id);
  }, [mode, user]);

  useEffect(() => {
    if (mode !== 'new') return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!pendingCreateRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [mode]);

  useEffect(() => {
    if (mode !== 'edit' || !treeQuery.data) return;
    const installation = treeQuery.data.installation;
    setForm({
      clientName: installation.clientName,
      siteName: installation.siteName,
      siteAddress: installation.siteAddress,
      inspectorName: installation.inspectorName,
      auditDate: installation.auditDate,
      siteCode: installation.siteCode || '',
      timezone: installation.timezone || '',
    });
    setDirty(false);
  }, [mode, treeQuery.data]);

  if (!user) return <Spinner />;
  const activeUser = user;
  if (mode === 'new' && hydratedCreateOwnerId !== activeUser.id) return <Spinner />;
  if (mode === 'edit' && treeQuery.isLoading) return <Spinner />;
  if (mode === 'edit' && treeQuery.error) {
    return <ErrorBanner message={installHubConnectionErrorMessage(treeQuery.error)} />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'new' && acknowledgedCreateId) {
      router.replace(`/installhub/installations/${acknowledgedCreateId}`);
      return;
    }
    const normalizedForm: FormState = {
      clientName: form.clientName.trim(),
      siteName: form.siteName.trim() || 'Untitled installation',
      siteAddress: form.siteAddress.trim(),
      inspectorName: form.inspectorName.trim(),
      auditDate: form.auditDate || todayIso(),
      timezone: form.timezone.trim() || 'UTC',
      siteCode: form.siteCode,
    };
    let normalizedSiteCode: string;
    try {
      normalizedSiteCode = canonicalSiteCodeForWrite(
        normalizedForm.siteName,
        normalizedForm.siteCode,
        mode === 'edit' ? treeQuery.data?.installation.siteCode : undefined,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Enter a valid site code.');
      return;
    }
    setBusy(true);
    if (mode === 'new') {
      const submittedOwnerId = activeUser.id;
      const operationGeneration = ++createOperationGenerationRef.current;
      try {
        const tree = installationCreateAttempt(pendingCreateRef.current, normalizedForm, activeUser);
        pendingCreateRef.current = tree;
        if (!persistInstallationCreateAttempt(tree, submittedOwnerId)) {
          setCreateRetryLocked(true);
          toast.error('This tab could not safely preserve the installation reference. No data was sent; enable session storage and retry this exact installation.');
          return;
        }

        let outcome;
        try {
          outcome = await submitAndConfirmInstallationTree(
            tree.installation.id,
            tree,
            'metadata',
          );
        } catch (error) {
          if (
            !isCurrentCreateOperation(operationGeneration, submittedOwnerId)
            || pendingCreateRef.current?.installation.id !== tree.installation.id
          ) return;
          const status = error instanceof InstallHubApiError ? error.status : null;
          const disposition = installationCreateFailureDisposition(status);
          if (disposition === 'RECONCILE') {
            try {
              const serverTree = await getInstallationTree(tree.installation.id);
              await finishAcknowledgedCreate(
                tree.installation.id,
                submittedOwnerId,
                operationGeneration,
                serverTree,
                'Installation already exists with newer cloud changes. Opening it for review.',
              );
              return;
            } catch (reconciliationError) {
              if (
                !isCurrentCreateOperation(operationGeneration, submittedOwnerId)
                || pendingCreateRef.current?.installation.id !== tree.installation.id
              ) return;
              setCreateRetryLocked(true);
              toast.error(
                reconciliationError instanceof InstallHubApiError
                  && reconciliationError.status === 404
                  ? 'No current server record was found, but an earlier create still cannot be disproved. This exact reference has been kept; discard it only deliberately.'
                  : 'The server result is still uncertain. This exact installation reference has been kept for safe retry.',
              );
              return;
            }
          } else {
            setCreateRetryLocked(true);
          }
          toast.error(installHubConnectionErrorMessage(error));
          return;
        }

        await finishAcknowledgedCreate(
          tree.installation.id,
          submittedOwnerId,
          operationGeneration,
          outcome.kind === 'CONFIRMED' ? outcome.tree : null,
          outcome.kind === 'CONFIRMED'
            ? 'Installation created.'
            : 'Installation created. Cloud confirmation will refresh automatically.',
        );
      } finally {
        if (isCurrentCreateOperation(operationGeneration, submittedOwnerId)) {
          setBusy(false);
        }
      }
      return;
    }

    try {
      if (mode === 'edit') {
        await writer.mutate((tree) => {
          Object.assign(tree.installation, normalizedForm, { siteCode: normalizedSiteCode });
        });
        setDirty(false);
        toast.success('Installation details saved.');
        router.replace(`/installhub/installations/${installationId}`);
      }
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function isCurrentCreateOperation(generation: number, ownerUserId: string): boolean {
    return componentMountedRef.current
      && createOperationGenerationRef.current === generation
      && currentCreateOwnerIdRef.current === ownerUserId;
  }

  function clearPendingCreate(ownerUserId: string, pendingInstallationId?: string): boolean {
    if (currentCreateOwnerIdRef.current !== ownerUserId) return false;
    if (
      pendingInstallationId
      && pendingCreateRef.current?.installation.id !== pendingInstallationId
    ) return false;
    if (!clearInstallationCreateAttempt(ownerUserId, pendingInstallationId)) return false;
    pendingCreateRef.current = null;
    setCreateRetryLocked(false);
    return true;
  }

  async function finishAcknowledgedCreate(
    installationIdToOpen: string,
    ownerUserId: string,
    operationGeneration: number,
    confirmedTree: InstallationTree | null,
    message: string,
  ) {
    if (
      !isCurrentCreateOperation(operationGeneration, ownerUserId)
      || pendingCreateRef.current?.installation.id !== installationIdToOpen
    ) return;
    // Keep the exact durable attempt until the destination screen confirms it
    // loaded. A reload or failed navigation can therefore only replay this ID.
    pendingCreateRef.current = null;
    setCreateRetryLocked(false);
    setDirty(false);
    setAcknowledgedCreateId(installationIdToOpen);
    try {
      if (confirmedTree) {
        queryClient.setQueryData(installationTreeKey(installationIdToOpen), confirmedTree);
      } else {
        queryClient.removeQueries({ queryKey: installationTreeKey(installationIdToOpen) });
      }
    } catch {
      // The acknowledged server record remains authoritative if local cache work fails.
    }
    await queryClient.invalidateQueries({ queryKey: installationTreesKey }).catch(() => undefined);
    if (!isCurrentCreateOperation(operationGeneration, ownerUserId)) return;
    toast.success(message);
    try {
      router.replace(`/installhub/installations/${installationIdToOpen}`);
    } catch {
      toast.error('The installation was saved. Open it from the Installations list.');
    }
  }

  function updateForm(change: Partial<FormState>) {
    setForm((current) => ({ ...current, ...change }));
    setDirty(true);
  }

  async function discardAndLeave() {
    if (mode === 'new') {
      createOperationGenerationRef.current += 1;
      const pendingInstallationId = pendingCreateRef.current?.installation.id;
      if (
        pendingInstallationId
        && !clearPendingCreate(activeUser.id, pendingInstallationId)
      ) {
        toast.error('Tab recovery could not be cleared safely. Stay on this page and try again.');
        throw new Error('installation_create_recovery_clear_failed');
      }
      setBusy(false);
      setAcknowledgedCreateId(null);
    }
    setDirty(false);
    await writer.discard();
  }

  const formLocked = busy || createRetryLocked || Boolean(acknowledgedCreateId);

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        ...(mode === 'edit' && installationId
          ? [{ label: treeQuery.data?.installation.siteName ?? 'Installation', href: `/installhub/installations/${installationId}` }]
          : []),
        { label: mode === 'new' ? 'New' : 'Edit' },
      ]} />
      <PageHeader
        title={mode === 'new' ? 'New installation' : 'Edit installation'}
        subtitle="These details prefill field forms and identify the installation in cloud storage and reports."
      />
      {mode === 'new' && createRetryLocked ? (
        <ErrorBanner message="This installation reference is locked for safe retry. Retry reuses the exact same details so another installation is not created." />
      ) : null}
      {mode === 'new' && acknowledgedCreateId ? (
        <ErrorBanner message="This installation is saved. Use Open installation to continue; this form cannot create it again." />
      ) : null}
      {mode === 'edit' ? (
        <div className="mb-5 flex justify-end">
          <SaveStateNotice
            state={writer.writeState}
            onRetry={() => void writer.retry().catch((error) => toast.error(installHubConnectionErrorMessage(error)))}
            onDiscard={() => void writer.discard()}
          />
        </div>
      ) : null}
      <TreeDraftNavigationGuard active={!busy && (dirty || writer.hasPendingTree)} onDiscard={discardAndLeave} />
      <form onSubmit={(event) => void submit(event)}>
        <Card className="max-w-3xl">
          <FieldLabel>Client name</FieldLabel>
          <Input value={form.clientName} disabled={formLocked} onChange={(event) => updateForm({ clientName: event.target.value })} />
          <FieldLabel>Site name</FieldLabel>
          <Input value={form.siteName} disabled={formLocked} placeholder="Defaults to Untitled installation" onChange={(event) => updateForm({ siteName: event.target.value })} />
          <FieldLabel>Site address</FieldLabel>
          <Textarea value={form.siteAddress} disabled={formLocked} onChange={(event) => updateForm({ siteAddress: event.target.value })} />
          <div className="grid gap-x-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Installer / inspector</FieldLabel>
              <Input value={form.inspectorName} disabled={formLocked} onChange={(event) => updateForm({ inspectorName: event.target.value })} />
            </div>
            <div>
              <FieldLabel>Installation date</FieldLabel>
              <Input type="date" value={form.auditDate} disabled={formLocked} onChange={(event) => updateForm({ auditDate: event.target.value })} />
            </div>
          </div>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Site code (optional)</FieldLabel>
              <Input value={form.siteCode} disabled={formLocked} placeholder="e.g. SYD-WH1" onChange={(event) => updateForm({ siteCode: event.target.value })} />
              <p className="mt-1 text-xs text-[var(--muted-foreground)]">Existing codes are preserved. New or changed codes use letters and digits, single hyphens between groups, and a 16-character maximum.</p>
            </div>
            <div>
              <FieldLabel>Site timezone</FieldLabel>
              <Input id="installation-timezone" value={form.timezone} disabled={formLocked} placeholder="Defaults to UTC" onChange={(event) => updateForm({ timezone: event.target.value })} />
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
            <Button type="submit" disabled={busy}>
              {busy
                ? 'Saving…'
                : acknowledgedCreateId
                  ? 'Open installation'
                  : createRetryLocked
                    ? 'Retry installation'
                    : 'Save installation'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const href = acknowledgedCreateId
                  ? `/installhub/installations/${acknowledgedCreateId}`
                  : mode === 'edit' && installationId
                    ? `/installhub/installations/${installationId}`
                    : '/installhub/installations';
                requestTreeNavigation(() => router.replace(href), 'the installations workspace');
              }}
              disabled={busy}
            >Cancel</Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
