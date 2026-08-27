'use client';
/* eslint-disable react-hooks/set-state-in-effect -- hydrates the editor once its installation query resolves */

import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldHint, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
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
import type { Installation, InstallationTree } from '@/modules/installhub/types/domain';
import { Breadcrumbs } from '@/modules/installhub/components/InstallHubUi';
import {
  SaveStateNotice,
  TreeDraftNavigationGuard,
  requestTreeNavigation,
} from '@/modules/installhub/components/WorkflowUi';

type FormState = {
  clientName: string;
  maas: boolean | null;
  serviceType: string;
  meteringSolutionType: string;
  customJobNumber: string;
  siteName: string;
  siteAddress: string;
  siteLocality: string;
  siteState: string;
  sitePostcode: string;
  siteCountryCode: string;
  siteContactName: string;
  siteContactPhone: string;
  siteContactEmail: string;
  jobComments: string;
  accessInformation: string;
  warrantyDevice: boolean | null;
  monitoringInstalled: boolean | null;
  hardwareInstalled: boolean | null;
  solarCapacityKw: string;
  additionalMonitoringRequired: boolean | null;
  additionalMonitoringHardware: string;
  inspectorName: string;
  auditDate: string;
  siteCode: string;
  timezone: string;
};

const emptyForm: FormState = {
  clientName: '',
  maas: null,
  serviceType: '',
  meteringSolutionType: '',
  customJobNumber: '',
  siteName: '',
  siteAddress: '',
  siteLocality: '',
  siteState: '',
  sitePostcode: '',
  siteCountryCode: 'AU',
  siteContactName: '',
  siteContactPhone: '',
  siteContactEmail: '',
  jobComments: '',
  accessInformation: '',
  warrantyDevice: null,
  monitoringInstalled: null,
  hardwareInstalled: null,
  solarCapacityKw: '',
  additionalMonitoringRequired: null,
  additionalMonitoringHardware: '',
  inspectorName: '',
  auditDate: todayIso(),
  siteCode: '',
  timezone: 'Australia/Sydney',
};

const AUSTRALIAN_STATES = ['ACT', 'NSW', 'NT', 'QLD', 'SA', 'TAS', 'VIC', 'WA'] as const;
const FIELD_WORK_TYPES = [
  ['M1 - New install', 'M1 — New install'],
  ['M2 - Faults / COMMS fault', 'M2 — Faults / COMMS fault'],
  ['M3 - Inspection', 'M3 — Inspection'],
  ['M4 - BD/Upselling', 'M4 — BD/Upselling'],
] as const;
const OTHER_WORK_TYPE = 'M5 - ';
const METERING_TYPES = ['NEM meter', 'Revenue metering', 'Monitoring / sub-meter', 'Water meter'] as const;
const OTHER_METERING_TYPE = '__other_metering_type__';
const MAX_SOLAR_CAPACITY_KW = 1_000_000;
const DEFAULT_INSTALLATION_TIMEZONE = 'Australia/Sydney';

function nullableBooleanValue(value: boolean | null): string {
  return value === null ? '' : value ? 'yes' : 'no';
}

function nullableBooleanFromValue(value: string): boolean | null {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

function NullableBooleanField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: boolean | null;
  disabled: boolean;
  onChange: (value: boolean | null) => void;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        id={id}
        value={nullableBooleanValue(value)}
        disabled={disabled}
        onChange={(event) => onChange(nullableBooleanFromValue(event.target.value))}
      >
        <option value="">Not recorded</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </Select>
    </div>
  );
}

function formStateFromInstallation(installation: Installation): FormState {
  return {
    clientName: installation.clientName,
    maas: installation.maas ?? null,
    serviceType: installation.serviceType ?? '',
    meteringSolutionType: installation.meteringSolutionType ?? '',
    customJobNumber: installation.customJobNumber ?? '',
    siteName: installation.siteName,
    siteAddress: installation.siteAddress,
    siteLocality: installation.siteLocality ?? '',
    siteState: installation.siteState?.trim().toUpperCase() ?? '',
    sitePostcode: installation.sitePostcode ?? '',
    siteCountryCode: installation.siteCountryCode?.trim().toUpperCase() || 'AU',
    siteContactName: installation.siteContactName ?? '',
    siteContactPhone: installation.siteContactPhone ?? '',
    siteContactEmail: installation.siteContactEmail ?? '',
    jobComments: installation.jobComments ?? '',
    accessInformation: installation.accessInformation ?? '',
    warrantyDevice: installation.warrantyDevice ?? null,
    monitoringInstalled: installation.monitoringInstalled ?? null,
    hardwareInstalled: installation.hardwareInstalled ?? null,
    solarCapacityKw: installation.solarCapacityKw == null
      ? ''
      : String(installation.solarCapacityKw),
    additionalMonitoringRequired: installation.additionalMonitoringRequired ?? null,
    additionalMonitoringHardware: installation.additionalMonitoringHardware ?? '',
    inspectorName: installation.inspectorName,
    auditDate: installation.auditDate,
    siteCode: installation.siteCode || '',
    timezone: installation.timezone?.trim() || DEFAULT_INSTALLATION_TIMEZONE,
  };
}

function optionalText(value: string): string | null {
  return value.trim() || null;
}

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
      setForm(formStateFromInstallation(installation));
      setDirty(true);
      setCreateRetryLocked(true);
      setHydratedCreateOwnerId(user.id);
      return;
    }
    setForm({
      ...emptyForm,
      auditDate: todayIso(),
      inspectorName: user.fullName || user.email,
      timezone: DEFAULT_INSTALLATION_TIMEZONE,
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
    setForm(formStateFromInstallation(installation));
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
    if (mode === 'edit' && treeQuery.data?.installation.status === 'Completed') {
      toast.error('Reopen this completed installation before editing its details.');
      return;
    }
    if (mode === 'new' && acknowledgedCreateId) {
      router.replace(`/installhub/installations/${acknowledgedCreateId}`);
      return;
    }
    if (mode === 'new' && (!form.serviceType || form.serviceType === OTHER_WORK_TYPE)) {
      toast.error('Select the scope category and enter the Other scope when applicable.');
      return;
    }
    if (form.meteringSolutionType === OTHER_METERING_TYPE) {
      toast.error('Enter the Other metering type.');
      return;
    }
    const solarCapacityKw = form.solarCapacityKw.trim()
      ? Number(form.solarCapacityKw)
      : null;
    if (
      solarCapacityKw !== null
      && (
        !Number.isFinite(solarCapacityKw)
        || solarCapacityKw < 0
        || solarCapacityKw > MAX_SOLAR_CAPACITY_KW
      )
    ) {
      toast.error(`Solar capacity must be between 0 and ${MAX_SOLAR_CAPACITY_KW.toLocaleString('en-AU')} kW.`);
      return;
    }
    const normalizedForm = {
      clientName: form.clientName.trim(),
      maas: form.maas,
      serviceType: optionalText(form.serviceType),
      meteringSolutionType: optionalText(form.meteringSolutionType),
      customJobNumber: optionalText(form.customJobNumber),
      siteName: form.siteName.trim() || 'Untitled installation',
      siteAddress: form.siteAddress.trim(),
      siteLocality: optionalText(form.siteLocality),
      siteState: optionalText(form.siteState),
      sitePostcode: optionalText(form.sitePostcode),
      siteCountryCode: form.siteCountryCode.trim().toUpperCase() || 'AU',
      siteContactName: optionalText(form.siteContactName),
      siteContactPhone: optionalText(form.siteContactPhone),
      siteContactEmail: optionalText(form.siteContactEmail),
      jobComments: optionalText(form.jobComments),
      accessInformation: optionalText(form.accessInformation),
      warrantyDevice: form.warrantyDevice,
      monitoringInstalled: form.monitoringInstalled,
      hardwareInstalled: form.hardwareInstalled,
      solarCapacityKw,
      additionalMonitoringRequired: form.additionalMonitoringRequired,
      additionalMonitoringHardware: optionalText(form.additionalMonitoringHardware),
      inspectorName: form.inspectorName.trim(),
      auditDate: form.auditDate || todayIso(),
      timezone: form.timezone.trim() || DEFAULT_INSTALLATION_TIMEZONE,
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

  const completedLocked = mode === 'edit' && treeQuery.data?.installation.status === 'Completed';
  const formLocked = busy || createRetryLocked || Boolean(acknowledgedCreateId) || completedLocked;

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
      {completedLocked ? (
        <ErrorBanner message="This completed installation is read-only. Reopen it from the installation page before editing details." />
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
        <Card className="max-w-5xl">
          <section aria-labelledby="installation-job-identity">
            <h2 id="installation-job-identity" className="text-base font-extrabold text-[var(--text)]">Job identity</h2>
            <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">Keep the delivery client and end customer separate when they are different organisations.</p>
            <div className="mt-2 grid gap-x-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="installation-client-name">Client name</FieldLabel>
                <Input id="installation-client-name" value={form.clientName} disabled={formLocked} onChange={(event) => updateForm({ clientName: event.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="installation-site-name">Site name</FieldLabel>
                <Input id="installation-site-name" value={form.siteName} disabled={formLocked} placeholder="Defaults to Untitled installation" onChange={(event) => updateForm({ siteName: event.target.value })} />
              </div>
            </div>
          </section>

          <section className="mt-6 border-t border-[var(--border)] pt-5" aria-labelledby="installation-site-address">
            <h2 id="installation-site-address" className="text-base font-extrabold text-[var(--text)]">Australian site address</h2>
            <div className="mt-2">
              <FieldLabel htmlFor="installation-address-line">Street address</FieldLabel>
              <Textarea id="installation-address-line" rows={2} value={form.siteAddress} disabled={formLocked} onChange={(event) => updateForm({ siteAddress: event.target.value })} />
            </div>
            <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="lg:col-span-2">
                <FieldLabel htmlFor="installation-locality">Suburb / locality</FieldLabel>
                <Input id="installation-locality" value={form.siteLocality} maxLength={120} disabled={formLocked} onChange={(event) => updateForm({ siteLocality: event.target.value })} />
              </div>
              <div>
                <FieldLabel htmlFor="installation-state">State / territory</FieldLabel>
                <Select id="installation-state" value={form.siteState} disabled={formLocked} onChange={(event) => updateForm({ siteState: event.target.value })}>
                  <option value="">Not recorded</option>
                  {form.siteState && !AUSTRALIAN_STATES.some((state) => state === form.siteState) ? <option value={form.siteState}>{form.siteState} (existing)</option> : null}
                  {AUSTRALIAN_STATES.map((state) => <option key={state} value={state}>{state}</option>)}
                </Select>
              </div>
              <div>
                <FieldLabel htmlFor="installation-postcode">Postcode</FieldLabel>
                <Input id="installation-postcode" value={form.sitePostcode} inputMode="numeric" maxLength={4} disabled={formLocked} onChange={(event) => updateForm({ sitePostcode: event.target.value })} />
              </div>
              <div className="lg:col-span-2">
                <FieldLabel htmlFor="installation-country">Country</FieldLabel>
                <Input id="installation-country" value={form.siteCountryCode === 'AU' ? 'Australia (AU)' : form.siteCountryCode} readOnly disabled={formLocked} />
              </div>
            </div>
          </section>

          <section className="mt-6 border-t border-[var(--border)] pt-5" aria-labelledby="installation-contact-access">
            <h2 id="installation-contact-access" className="text-base font-extrabold text-[var(--text)]">Site contact and access</h2>
            <div className="mt-2 grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <FieldLabel htmlFor="installation-contact-name">Contact name</FieldLabel>
                <Input id="installation-contact-name" value={form.siteContactName} maxLength={300} disabled={formLocked} onChange={(event) => updateForm({ siteContactName: event.target.value })} />
              </div>
              <div>
                <FieldLabel htmlFor="installation-contact-phone">Contact phone</FieldLabel>
                <Input id="installation-contact-phone" type="tel" value={form.siteContactPhone} maxLength={50} disabled={formLocked} onChange={(event) => updateForm({ siteContactPhone: event.target.value })} />
              </div>
              <div>
                <FieldLabel htmlFor="installation-contact-email">Contact email</FieldLabel>
                <Input id="installation-contact-email" type="email" value={form.siteContactEmail} maxLength={320} disabled={formLocked} onChange={(event) => updateForm({ siteContactEmail: event.target.value })} />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <FieldLabel htmlFor="installation-access-information">Access information (sensitive)</FieldLabel>
                <Textarea id="installation-access-information" rows={3} value={form.accessInformation} maxLength={5000} disabled={formLocked} onChange={(event) => updateForm({ accessInformation: event.target.value })} />
                <FieldHint>Visible only inside this authorised installation workspace; it is not included in broad Scheduler job labels.</FieldHint>
              </div>
            </div>
          </section>

          <section className="mt-6 border-t border-[var(--border)] pt-5" aria-labelledby="installation-planning">
            <h2 id="installation-planning" className="text-base font-extrabold text-[var(--text)]">Service and metering plan</h2>
            <div className="mt-2 grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <FieldLabel htmlFor="installation-service-type">Scope categorization</FieldLabel>
                <Select id="installation-service-type" value={form.serviceType.startsWith(OTHER_WORK_TYPE) || (form.serviceType && !FIELD_WORK_TYPES.some(([value]) => value === form.serviceType)) ? OTHER_WORK_TYPE : form.serviceType} disabled={formLocked} onChange={(event) => updateForm({ serviceType: event.target.value })}>
                  <option value="">Select scope</option>
                  {FIELD_WORK_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  <option value={OTHER_WORK_TYPE}>M5 — Other</option>
                </Select>
                {form.serviceType.startsWith(OTHER_WORK_TYPE) || (form.serviceType && !FIELD_WORK_TYPES.some(([value]) => value === form.serviceType)) ? (
                  <Input aria-label="Other scope" placeholder="Enter other scope" value={form.serviceType.startsWith(OTHER_WORK_TYPE) ? form.serviceType.slice(OTHER_WORK_TYPE.length) : form.serviceType} maxLength={115} disabled={formLocked} onChange={(event) => updateForm({ serviceType: `${OTHER_WORK_TYPE}${event.target.value}` })} />
                ) : null}
              </div>
              <div>
                <FieldLabel htmlFor="installation-metering-solution">Metering type selection</FieldLabel>
                <Select id="installation-metering-solution" value={METERING_TYPES.some((value) => value === form.meteringSolutionType) ? form.meteringSolutionType : form.meteringSolutionType ? OTHER_METERING_TYPE : ''} disabled={formLocked} onChange={(event) => updateForm({ meteringSolutionType: event.target.value })}>
                  <option value="">Select metering type</option>
                  {METERING_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
                  <option value={OTHER_METERING_TYPE}>Other</option>
                </Select>
                {form.meteringSolutionType === OTHER_METERING_TYPE || (form.meteringSolutionType && !METERING_TYPES.some((value) => value === form.meteringSolutionType)) ? (
                  <Input aria-label="Other metering type" placeholder="Enter other metering type" value={form.meteringSolutionType === OTHER_METERING_TYPE ? '' : form.meteringSolutionType} maxLength={120} disabled={formLocked} onChange={(event) => updateForm({ meteringSolutionType: event.target.value || OTHER_METERING_TYPE })} />
                ) : null}
              </div>
              <div>
                <FieldLabel htmlFor="installation-custom-job-number">Custom job number</FieldLabel>
                <Input id="installation-custom-job-number" value={form.customJobNumber} maxLength={100} disabled={formLocked} onChange={(event) => updateForm({ customJobNumber: event.target.value })} />
              </div>
              <NullableBooleanField id="installation-maas" label="MaaS" value={form.maas} disabled={formLocked} onChange={(maas) => updateForm({ maas })} />
              <div className="sm:col-span-2 lg:col-span-3">
                <FieldLabel htmlFor="installation-job-comments">Job comments</FieldLabel>
                <Textarea id="installation-job-comments" rows={3} value={form.jobComments} maxLength={5000} disabled={formLocked} onChange={(event) => updateForm({ jobComments: event.target.value })} />
              </div>
            </div>
          </section>

          {mode === 'edit' ? (
            <section className="mt-6 border-t border-[var(--border)] pt-5" aria-labelledby="installation-recorded-state">
              <h2 id="installation-recorded-state" className="text-base font-extrabold text-[var(--text)]">Recorded installation state</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">Use “Not recorded” when the answer is unknown; unknown is not treated as No.</p>
              <div className="mt-2 grid gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
                <NullableBooleanField id="installation-warranty-device" label="Warranty device" value={form.warrantyDevice} disabled={formLocked} onChange={(warrantyDevice) => updateForm({ warrantyDevice })} />
                <NullableBooleanField id="installation-monitoring-installed" label="Monitoring installed" value={form.monitoringInstalled} disabled={formLocked} onChange={(monitoringInstalled) => updateForm({ monitoringInstalled })} />
                <NullableBooleanField id="installation-hardware-installed" label="Hardware installed" value={form.hardwareInstalled} disabled={formLocked} onChange={(hardwareInstalled) => updateForm({ hardwareInstalled })} />
                <div>
                  <FieldLabel htmlFor="installation-solar-capacity">Solar capacity (kW)</FieldLabel>
                  <Input id="installation-solar-capacity" type="number" min="0" max={MAX_SOLAR_CAPACITY_KW} step="any" inputMode="decimal" value={form.solarCapacityKw} disabled={formLocked} onChange={(event) => updateForm({ solarCapacityKw: event.target.value })} />
                </div>
                <NullableBooleanField id="installation-additional-monitoring" label="Additional monitoring required" value={form.additionalMonitoringRequired} disabled={formLocked} onChange={(additionalMonitoringRequired) => updateForm({ additionalMonitoringRequired })} />
                <div>
                  <FieldLabel htmlFor="installation-additional-hardware">Additional monitoring hardware</FieldLabel>
                  <Input id="installation-additional-hardware" value={form.additionalMonitoringHardware} maxLength={5000} disabled={formLocked} onChange={(event) => updateForm({ additionalMonitoringHardware: event.target.value })} />
                </div>
              </div>
            </section>
          ) : null}

          <section className="mt-6 border-t border-[var(--border)] pt-5" aria-labelledby="installation-portal-context">
            <h2 id="installation-portal-context" className="text-base font-extrabold text-[var(--text)]">Field App context</h2>
            <div className="mt-2 grid gap-x-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="installation-inspector">Installer / inspector</FieldLabel>
                <Input id="installation-inspector" value={form.inspectorName} disabled={formLocked} onChange={(event) => updateForm({ inspectorName: event.target.value })} />
              </div>
              <div>
                <FieldLabel htmlFor="installation-date">Scheduled / audit date</FieldLabel>
                <Input id="installation-date" type="date" value={form.auditDate} disabled={formLocked} onChange={(event) => updateForm({ auditDate: event.target.value })} />
              </div>
              <div>
                <FieldLabel htmlFor="installation-site-code">Site code (optional)</FieldLabel>
                <Input id="installation-site-code" value={form.siteCode} disabled={formLocked} placeholder="e.g. SYD-WH1" onChange={(event) => updateForm({ siteCode: event.target.value })} />
                <FieldHint>Existing codes are preserved. New or changed codes use letters and digits, single hyphens between groups, and a 16-character maximum.</FieldHint>
              </div>
              <div>
                <FieldLabel htmlFor="installation-timezone">Site timezone</FieldLabel>
                <Input id="installation-timezone" value={form.timezone} disabled={formLocked} placeholder={`Defaults to ${DEFAULT_INSTALLATION_TIMEZONE}`} onChange={(event) => updateForm({ timezone: event.target.value })} />
              </div>
            </div>
          </section>
          <div className="mt-6 flex flex-wrap gap-2 border-t border-[var(--border)] pt-5">
            <Button type="submit" disabled={busy || completedLocked}>
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
