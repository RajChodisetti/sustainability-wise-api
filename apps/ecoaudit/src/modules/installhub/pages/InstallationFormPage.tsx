'use client';
/* eslint-disable react-hooks/set-state-in-effect -- hydrates the editor once its installation query resolves */

import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input, Textarea } from '@/components/ui/FormFields';
import { useToast } from '@/contexts/ToastContext';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { getInstallationTree, saveInstallationTree } from '@/modules/installhub/api/installhub';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import {
  installationTreeKey,
  installationTreesKey,
  useInstallationTree,
  useTreeWriter,
} from '@/modules/installhub/hooks/useInstallationTree';
import { createInstallationTree, todayIso } from '@/modules/installhub/lib/model';
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

  useEffect(() => {
    if (mode === 'new' && user) {
      setForm((current) => ({
        ...current,
        inspectorName: current.inspectorName || user.fullName || user.email,
        timezone: current.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      }));
    }
  }, [mode, user]);

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
  if (mode === 'edit' && treeQuery.isLoading) return <Spinner />;
  if (mode === 'edit' && treeQuery.error) {
    return <ErrorBanner message={installHubConnectionErrorMessage(treeQuery.error)} />;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.clientName.trim() || !form.siteName.trim() || !form.siteAddress.trim() || !form.inspectorName.trim() || !form.auditDate || !form.timezone.trim()) {
      toast.error('Complete every required installation field.');
      return;
    }
    try {
      new Intl.DateTimeFormat('en-AU', { timeZone: form.timezone.trim() }).format();
    } catch {
      toast.error('Enter a valid IANA timezone, such as Australia/Sydney.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'new') {
        const tree = createInstallationTree(form, user!);
        await saveInstallationTree(tree);
        const confirmed = await getInstallationTree(tree.installation.id);
        queryClient.setQueryData(installationTreeKey(tree.installation.id), confirmed);
        await queryClient.invalidateQueries({ queryKey: installationTreesKey });
        setDirty(false);
        toast.success('Installation created.');
        router.replace(`/installhub/installations/${tree.installation.id}`);
      } else {
        await writer.mutate((tree) => {
          Object.assign(tree.installation, form);
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

  function updateForm(change: Partial<FormState>) {
    setForm((current) => ({ ...current, ...change }));
    setDirty(true);
  }

  async function discardAndLeave() {
    setDirty(false);
    await writer.discard();
  }

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
          <FieldLabel>Client name *</FieldLabel>
          <Input value={form.clientName} required onChange={(event) => updateForm({ clientName: event.target.value })} />
          <FieldLabel>Site name *</FieldLabel>
          <Input value={form.siteName} required onChange={(event) => updateForm({ siteName: event.target.value })} />
          <FieldLabel>Site address *</FieldLabel>
          <Textarea value={form.siteAddress} required onChange={(event) => updateForm({ siteAddress: event.target.value })} />
          <div className="grid gap-x-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Installer / inspector *</FieldLabel>
              <Input value={form.inspectorName} required onChange={(event) => updateForm({ inspectorName: event.target.value })} />
            </div>
            <div>
              <FieldLabel>Installation date *</FieldLabel>
              <Input type="date" value={form.auditDate} required onChange={(event) => updateForm({ auditDate: event.target.value })} />
            </div>
          </div>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <div>
              <FieldLabel>Site code (optional)</FieldLabel>
              <Input value={form.siteCode} placeholder="e.g. SYD-WH1" onChange={(event) => updateForm({ siteCode: event.target.value })} />
            </div>
            <div>
              <FieldLabel>Site timezone *</FieldLabel>
              <Input value={form.timezone} required placeholder="e.g. Australia/Sydney" onChange={(event) => updateForm({ timezone: event.target.value })} />
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save installation'}</Button>
            <Button variant="secondary" onClick={() => requestTreeNavigation(() => router.back(), 'the previous page')} disabled={busy}>Cancel</Button>
          </div>
        </Card>
      </form>
    </div>
  );
}
