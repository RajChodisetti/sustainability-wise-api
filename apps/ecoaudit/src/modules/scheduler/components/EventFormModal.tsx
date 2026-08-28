'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Card';
import {
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Select,
  Textarea,
} from '@/components/ui/FormFields';
import { ApiError, cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
import { AustralianAddressFields } from '@/modules/scheduler/components/AustralianAddressFields';
import { SchedulerClientCombobox } from '@/modules/scheduler/components/SchedulerClientCombobox';
import {
  useCancelScheduleEvent,
  useCompleteSchedulerJob,
  useCreateScheduleEvent,
  useCreateSchedulerDispatch,
  useJobOptions,
  usePortalAssignees,
  useSendScheduleEventReminder,
  useSchedulerSites,
  useUpdateScheduleEvent,
} from '@/modules/scheduler/hooks/useScheduler';
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from '@/modules/scheduler/lib/deadline';
import {
  estimatedDurationError,
  estimatedDurationUpdate,
  parseEstimatedDurationMinutes,
} from '@/modules/scheduler/lib/estimatedDuration';
import {
  scheduledStartUpdate,
  shouldCompleteLinkedProductJob,
} from '@/modules/scheduler/lib/eventUpdate';
import {
  schedulerDefaultSourceApp,
  schedulerEventSupportsMobileNotifications,
} from '@/modules/scheduler/lib/visibility';
import {
  clearSchedulerFieldJobPlanning,
  EMPTY_SCHEDULER_JOB_ADDRESS,
  randomSchedulerFieldJobTitleSuffix,
  schedulerAddressFromClientSuggestion,
  schedulerAddressDisplay,
  schedulerAddressIsComplete,
  schedulerAddressPayload,
  schedulerDispatchSiteSelectionPayload,
  schedulerFieldJobTitlePreview,
  schedulerSiteOptionLabel,
} from '@/modules/scheduler/lib/routing';
import type {
  ScheduleEvent,
  ScheduleSourceApp,
  ScheduleSourceType,
  ScheduleStatus,
  SchedulerSiteOption,
} from '@/modules/scheduler/types/domain';
import type {
  AustralianState,
  SchedulerClient,
  SchedulerClientAddressSuggestion,
  SchedulerJobAddressInput,
} from '@/modules/scheduler/types/routing';

type Props = {
  open: boolean;
  onClose: () => void;
  initialDay?: Date | null;
  event?: ScheduleEvent | null;
  isAdmin: boolean;
  visibleSourceApps: ScheduleSourceApp[];
  selectableSourceApps: ScheduleSourceApp[];
  creatableSourceApps: ScheduleSourceApp[];
  onOpenFinance?: (event: ScheduleEvent) => void;
};

type CreationMode = 'new' | 'existing';
type SiteSelectionMode = 'new' | 'existing';

type InstallHubJobDetails = {
  electricityNmi: string;
  clientContactName: string;
  clientContactPhone: string;
  clientContactEmail: string;
  maas: boolean | null;
  workType: string;
  meteringSolutionType: string;
  siteContactName: string;
  siteContactPhone: string;
  siteContactEmail: string;
  accessInformation: string;
  jobComments: string;
};

const EMPTY_INSTALLHUB_JOB_DETAILS: InstallHubJobDetails = {
  electricityNmi: '',
  clientContactName: '',
  clientContactPhone: '',
  clientContactEmail: '',
  maas: null,
  workType: '',
  meteringSolutionType: '',
  siteContactName: '',
  siteContactPhone: '',
  siteContactEmail: '',
  accessInformation: '',
  jobComments: '',
};

function optionalJobText(value: string): string | null {
  return value.trim() || null;
}

function addressFromSite(site: SchedulerSiteOption): SchedulerJobAddressInput {
  return {
    freeform: site.address,
    locality: site.locality ?? '',
    state: (site.state as AustralianState | null) ?? undefined,
    postcode: site.postcode ?? '',
    countryCode: 'AU',
    latitude: site.latitude ?? undefined,
    longitude: site.longitude ?? undefined,
    provider: site.geocodeProvider ?? undefined,
    placeId: site.geocodePlaceId ?? undefined,
    source: 'client_saved',
  };
}

function nullableBooleanValue(value: boolean | null): string {
  return value === null ? '' : value ? 'yes' : 'no';
}

function nullableBooleanFromValue(value: string): boolean | null {
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return null;
}

function NullableBooleanSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: boolean | null;
  onChange: (value: boolean | null) => void;
}) {
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        id={id}
        value={nullableBooleanValue(value)}
        onChange={(event) => onChange(nullableBooleanFromValue(event.target.value))}
      >
        <option value="">Not recorded</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </Select>
    </div>
  );
}

function installHubJobPayload(details: InstallHubJobDetails) {
  return {
    electricityNmi: optionalJobText(details.electricityNmi),
    clientContactName: optionalJobText(details.clientContactName),
    clientContactPhone: optionalJobText(details.clientContactPhone),
    clientContactEmail: optionalJobText(details.clientContactEmail),
    maas: details.maas,
    workType: optionalJobText(details.workType),
    meteringSolutionType: optionalJobText(details.meteringSolutionType),
    siteContactName: optionalJobText(details.siteContactName),
    siteContactPhone: optionalJobText(details.siteContactPhone),
    siteContactEmail: optionalJobText(details.siteContactEmail),
    jobComments: optionalJobText(details.jobComments),
  };
}

const appOptions: Array<{ value: ScheduleSourceApp; label: string }> = [
  { value: 'ecoaudit', label: 'EcoAudit' },
  { value: 'solarsense', label: 'SolarSense' },
  { value: 'installhub', label: 'Field App installation' },
  { value: 'custom', label: 'Custom job' },
];

const FIELD_WORK_TYPES = [
  ['M1 - New install', 'M1 — New install'],
  ['M2 - Faults / COMMS fault', 'M2 — Faults / COMMS fault'],
  ['M3 - Inspection', 'M3 — Inspection'],
  ['M4 - BD/Upselling', 'M4 — BD/Upselling'],
] as const;
const OTHER_WORK_TYPE = 'M5 - ';
const METERING_TYPES = ['NEM meter', 'Revenue metering', 'Monitoring / sub-meter', 'Water meter'] as const;
const OTHER_METERING_TYPE = '__other_metering_type__';

function defaultTypeForApp(app: ScheduleSourceApp): ScheduleSourceType {
  if (app === 'ecoaudit') return 'audit';
  if (app === 'installhub') return 'installation';
  if (app === 'solarsense') return 'assessment';
  return 'custom';
}

function initialFormValues(
  event?: ScheduleEvent | null,
  initialDay?: Date | null,
  defaultSourceApp: ScheduleSourceApp = 'installhub',
) {
  if (event) {
    return {
      sourceApp: event.sourceApp,
      sourceType: event.sourceType,
      sourceId: event.sourceId ?? '',
      creationMode: 'existing' as CreationMode,
      jobQuery: '',
      siteSelectionMode: 'new' as SiteSelectionMode,
      siteQuery: '',
      existingSiteId: '',
      selectedClientId: '',
      jobSiteName: '',
      jobAddress: { ...EMPTY_SCHEDULER_JOB_ADDRESS },
      jobBuildingName: '',
      jobClientName: '',
      installHubJobDetails: { ...EMPTY_INSTALLHUB_JOB_DETAILS },
      title: event.title,
      description: event.description ?? '',
      assigneeFieldUserId: event.assigneeFieldUserId,
      startLocal: toDatetimeLocalValue(event.scheduledStartAt),
      estimatedDurationMinutes: event.estimatedDurationMinutes === null
        ? ''
        : String(event.estimatedDurationMinutes),
      deadlineLocal: toDatetimeLocalValue(event.deadlineAt),
      status: event.status,
    };
  }

  const start = new Date(initialDay ?? new Date());
  if (!initialDay) {
    start.setMinutes(0, 0, 0);
  } else if (initialDay.getHours() === 0 && initialDay.getMinutes() === 0) {
    // Month-cell click without time → default morning.
    start.setHours(9, 0, 0, 0);
  }
  const deadline = new Date(start);
  deadline.setDate(deadline.getDate() + 2);
  deadline.setHours(17, 0, 0, 0);

  return {
    sourceApp: defaultSourceApp,
    sourceType: defaultTypeForApp(defaultSourceApp),
    sourceId: '',
    creationMode: 'new' as CreationMode,
    jobQuery: '',
    siteSelectionMode: 'new' as SiteSelectionMode,
    siteQuery: '',
    existingSiteId: '',
    selectedClientId: '',
    jobSiteName: '',
    jobAddress: { ...EMPTY_SCHEDULER_JOB_ADDRESS },
    jobBuildingName: '',
    jobClientName: '',
    installHubJobDetails: { ...EMPTY_INSTALLHUB_JOB_DETAILS },
    title: '',
    description: '',
    assigneeFieldUserId: '',
    startLocal: toDatetimeLocalValue(start.toISOString()),
    estimatedDurationMinutes: '',
    deadlineLocal: toDatetimeLocalValue(deadline.toISOString()),
    status: 'planned' as ScheduleStatus,
  };
}

export function EventFormModal({
  open,
  onClose,
  initialDay,
  event,
  isAdmin,
  visibleSourceApps,
  selectableSourceApps,
  creatableSourceApps,
  onOpenFinance,
}: Props) {
  const toast = useToast();
  const create = useCreateScheduleEvent();
  const dispatch = useCreateSchedulerDispatch();
  const update = useUpdateScheduleEvent();
  const complete = useCompleteSchedulerJob();
  const cancel = useCancelScheduleEvent();
  const remind = useSendScheduleEventReminder();
  const assignees = usePortalAssignees(open && isAdmin);
  const editing = Boolean(event);
  const initial = initialFormValues(
    event,
    initialDay,
    schedulerDefaultSourceApp(creatableSourceApps),
  );
  const selectableAppOptions = appOptions.filter((option) => (
    selectableSourceApps.includes(option.value)
  ));

  const [sourceApp, setSourceApp] = useState<ScheduleSourceApp>(initial.sourceApp);
  const [sourceType, setSourceType] = useState<ScheduleSourceType>(initial.sourceType);
  const [sourceId, setSourceId] = useState(initial.sourceId);
  const [creationMode, setCreationMode] = useState<CreationMode>(initial.creationMode);
  const [jobQuery, setJobQuery] = useState(initial.jobQuery);
  const [siteSelectionMode, setSiteSelectionMode] = useState<SiteSelectionMode>(initial.siteSelectionMode);
  const [siteQuery, setSiteQuery] = useState(initial.siteQuery);
  const [existingSiteId, setExistingSiteId] = useState(initial.existingSiteId);
  const [selectedClientId, setSelectedClientId] = useState(initial.selectedClientId);
  const [selectedClient, setSelectedClient] = useState<SchedulerClient | null>(null);
  const [jobSiteName, setJobSiteName] = useState(initial.jobSiteName);
  const [jobAddress, setJobAddress] = useState<SchedulerJobAddressInput>(initial.jobAddress);
  const [jobBuildingName, setJobBuildingName] = useState(initial.jobBuildingName);
  const [jobClientName, setJobClientName] = useState(initial.jobClientName);
  const [installHubJobDetails, setInstallHubJobDetails] = useState<InstallHubJobDetails>(initial.installHubJobDetails);
  const [fieldJobTitleSuffix] = useState(randomSchedulerFieldJobTitleSuffix);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [assigneeFieldUserId, setAssigneeFieldUserId] = useState(initial.assigneeFieldUserId);
  const [startLocal, setStartLocal] = useState(initial.startLocal);
  const [estimatedDurationMinutes, setEstimatedDurationMinutes] = useState(
    initial.estimatedDurationMinutes,
  );
  const [deadlineLocal, setDeadlineLocal] = useState(initial.deadlineLocal);
  const [status, setStatus] = useState<ScheduleStatus>(initial.status);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(false);
  const reminderIdempotencyKeyRef = useRef<string | null>(null);
  const completionIdempotencyKeyRef = useRef<string | null>(null);
  const sourceCanCreateNew = sourceApp !== 'custom'
    && creatableSourceApps.includes(sourceApp);

  const jobs = useJobOptions(
    jobQuery,
    sourceApp === 'custom' ? undefined : sourceApp,
    open && isAdmin && sourceApp !== 'custom' && creationMode === 'existing',
  );
  const sites = useSchedulerSites(
    siteQuery,
    sourceApp === 'custom' ? 'installhub' : sourceApp,
    open && isAdmin && sourceApp !== 'custom' && creationMode === 'new'
      && siteSelectionMode === 'existing',
  );
  const eligibleAssignees = useMemo(() => (assignees.data ?? []).filter((assignee) => (
    sourceApp === 'custom' || assignee.appMemberships.includes(sourceApp)
  )), [assignees.data, sourceApp]);
  const parsedEstimatedDurationMinutes = parseEstimatedDurationMinutes(estimatedDurationMinutes);
  const durationError = estimatedDurationError(estimatedDurationMinutes);

  const canSubmit = useMemo(() => {
    if (!isAdmin) return false;
    if (!startLocal || !deadlineLocal) return false;
    const canCreateUnassignedFieldJob = !editing
      && sourceApp === 'installhub'
      && creationMode === 'new';
    if (!assigneeFieldUserId && !canCreateUnassignedFieldJob) return false;
    if (parsedEstimatedDurationMinutes === undefined) return false;
    if (sourceApp === 'custom') return Boolean(title.trim());
    if (creationMode === 'existing') return Boolean(sourceId);
    if (!sourceCanCreateNew) return false;
    if (siteSelectionMode === 'existing' && !existingSiteId) return false;
    if (sourceApp === 'ecoaudit') return Boolean(
      jobClientName.trim() && jobSiteName.trim() && schedulerAddressIsComplete(jobAddress),
    );
    if (sourceApp === 'solarsense') {
      return Boolean(
        jobClientName.trim()
        && jobSiteName.trim()
        && schedulerAddressIsComplete(jobAddress)
        && jobBuildingName.trim(),
      );
    }
    return Boolean(
      jobClientName.trim()
      && jobSiteName.trim()
      && schedulerAddressIsComplete(jobAddress)
      && installHubJobDetails.workType
      && installHubJobDetails.workType !== OTHER_WORK_TYPE
      && installHubJobDetails.meteringSolutionType !== OTHER_METERING_TYPE
    );
  }, [
    isAdmin,
    editing,
    assigneeFieldUserId,
    startLocal,
    deadlineLocal,
    parsedEstimatedDurationMinutes,
    sourceApp,
    title,
    creationMode,
    sourceCanCreateNew,
    sourceId,
    siteSelectionMode,
    existingSiteId,
    jobSiteName,
    jobAddress,
    jobBuildingName,
    jobClientName,
    installHubJobDetails.workType,
    installHubJobDetails.meteringSolutionType,
  ]);

  const saving = create.isPending
    || dispatch.isPending
    || update.isPending
    || cancel.isPending
    || complete.isPending;
  const busy = saving || remind.isPending;
  const supportsMobileNotifications = event
    ? schedulerEventSupportsMobileNotifications(event)
    : sourceApp !== 'custom';

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLElement>(
      'select:not(:disabled), input:not(:disabled), textarea:not(:disabled), button:not(:disabled)',
    )?.focus();

    function onKeyDown(keyboardEvent: KeyboardEvent) {
      if (keyboardEvent.key === 'Escape' && !busyRef.current) {
        keyboardEvent.preventDefault();
        onCloseRef.current();
        return;
      }
      if (keyboardEvent.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (keyboardEvent.shiftKey && document.activeElement === first) {
        keyboardEvent.preventDefault();
        last.focus();
      } else if (!keyboardEvent.shiftKey && document.activeElement === last) {
        keyboardEvent.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  if (!open || (event && !visibleSourceApps.includes(event.sourceApp))) return null;

  function selectExistingSite(siteId: string) {
    setExistingSiteId(siteId);
    const site = sites.data?.find((option) => option.id === siteId);
    if (!site) return;
    setSelectedClientId(site.clientId);
    setSelectedClient(null);
    setJobClientName(site.clientName);
    setJobSiteName(site.siteName);
    setJobAddress(addressFromSite(site));
    setInstallHubJobDetails((current) => ({
      ...clearSchedulerFieldJobPlanning(current),
      clientContactName: site.clientContactName ?? '',
      clientContactPhone: site.clientContactPhone ?? '',
      clientContactEmail: site.clientContactEmail ?? '',
      siteContactName: site.siteContactName ?? '',
      siteContactPhone: site.siteContactPhone ?? '',
      siteContactEmail: site.siteContactEmail ?? '',
      accessInformation: site.accessInformation ?? '',
    }));
  }

  function selectClient(client: SchedulerClient) {
    const changedClient = client.id !== selectedClientId;
    setSelectedClientId(client.id);
    setSelectedClient(client);
    setJobClientName(client.name);
    setSiteQuery(client.name);
    if (changedClient) {
      setSiteSelectionMode('new');
      setExistingSiteId('');
      setJobSiteName('');
      setJobAddress({ ...EMPTY_SCHEDULER_JOB_ADDRESS });
    }
    setInstallHubJobDetails((current) => ({
      ...current,
      clientContactName: client.contactName ?? '',
      clientContactPhone: client.contactPhone ?? '',
      clientContactEmail: client.contactEmail ?? '',
      ...(changedClient
        ? {
            siteContactName: '',
            siteContactPhone: '',
            siteContactEmail: '',
            accessInformation: '',
          }
        : {}),
    }));
  }

  function changeClientName(value: string) {
    setJobClientName(value);
    if (!selectedClientId) return;
    setSelectedClientId('');
    setSelectedClient(null);
    if (siteSelectionMode === 'existing') {
      setSiteSelectionMode('new');
      setExistingSiteId('');
      setJobSiteName('');
      setJobAddress({ ...EMPTY_SCHEDULER_JOB_ADDRESS });
    }
    setInstallHubJobDetails((current) => ({
      ...current,
      clientContactName: '',
      clientContactPhone: '',
      clientContactEmail: '',
      ...(siteSelectionMode === 'existing'
        ? {
            siteContactName: '',
            siteContactPhone: '',
            siteContactEmail: '',
            accessInformation: '',
          }
        : {}),
    }));
  }

  function selectClientAddress(suggestion: SchedulerClientAddressSuggestion) {
    if (suggestion.kind === 'provider') {
      setSiteSelectionMode('new');
      setExistingSiteId('');
      return;
    }
    if (!suggestion.clientId || !suggestion.clientSiteId) return;
    const client = selectedClient?.id === suggestion.clientId ? selectedClient : undefined;
    const site = client?.sites.find((candidate) => candidate.id === suggestion.clientSiteId);
    const legacySite = sites.data?.find((candidate) => candidate.id === suggestion.clientSiteId);
    setSelectedClientId(suggestion.clientId);
    setSiteSelectionMode('existing');
    setExistingSiteId(suggestion.clientSiteId);
    setSiteQuery(client?.name ?? legacySite?.clientName ?? jobClientName);
    setJobClientName(client?.name ?? legacySite?.clientName ?? jobClientName);
    setJobSiteName(site?.siteName ?? legacySite?.siteName ?? suggestion.siteName ?? 'Site');
    setJobAddress(schedulerAddressFromClientSuggestion(suggestion));
    setInstallHubJobDetails((current) => ({
      ...clearSchedulerFieldJobPlanning(current),
      clientContactName: client?.contactName
        ?? legacySite?.clientContactName
        ?? current.clientContactName,
      clientContactPhone: client?.contactPhone
        ?? legacySite?.clientContactPhone
        ?? current.clientContactPhone,
      clientContactEmail: client?.contactEmail
        ?? legacySite?.clientContactEmail
        ?? current.clientContactEmail,
      siteContactName: site?.contactName ?? legacySite?.siteContactName ?? '',
      siteContactPhone: site?.contactPhone ?? legacySite?.siteContactPhone ?? '',
      siteContactEmail: site?.contactEmail ?? legacySite?.siteContactEmail ?? '',
      accessInformation: site?.accessInformation ?? legacySite?.accessInformation ?? '',
    }));
  }

  function startNewAddress() {
    setSiteSelectionMode('new');
    setExistingSiteId('');
    setJobSiteName('');
    setJobAddress({ ...EMPTY_SCHEDULER_JOB_ADDRESS });
    setInstallHubJobDetails((current) => ({
      ...current,
      siteContactName: '',
      siteContactPhone: '',
      siteContactEmail: '',
      accessInformation: '',
    }));
  }

  function markAddressAsNew() {
    setSiteSelectionMode('new');
    setExistingSiteId('');
  }

  async function handleSubmit() {
    const submittedEstimatedDurationMinutes = parseEstimatedDurationMinutes(
      estimatedDurationMinutes,
    );
    if (!canSubmit || submittedEstimatedDurationMinutes === undefined) return;
    const completeLinkedJob = Boolean(event && shouldCompleteLinkedProductJob({
      currentStatus: event.status,
      nextStatus: status,
      sourceApp: event.sourceApp,
      sourceType: event.sourceType,
      sourceId: event.sourceId,
    }));
    if (completeLinkedJob && event && !window.confirm(
      `Mark ${event.title} complete? This also completes the linked product job.`,
    )) return;
    setError(null);
    try {
      if (editing && event) {
        await update.mutateAsync({
          id: event.id,
          input: {
            title: title.trim() || event.title,
            description: description.trim() || null,
            assigneeFieldUserId,
            ...scheduledStartUpdate(
              initial.startLocal,
              startLocal,
              fromDatetimeLocalValue(startLocal),
            ),
            ...estimatedDurationUpdate(
              event.estimatedDurationMinutes,
              submittedEstimatedDurationMinutes,
            ),
            deadlineAt: fromDatetimeLocalValue(deadlineLocal),
            // The product-completion endpoint closes every linked Scheduler
            // event transactionally. Do not claim calendar completion first.
            status: completeLinkedJob ? event.status : status,
          },
        });
        if (
          completeLinkedJob
          && event.sourceId
          && event.sourceApp !== 'custom'
          && event.sourceType !== 'custom'
        ) {
          const idempotencyKey = completionIdempotencyKeyRef.current ?? crypto.randomUUID();
          completionIdempotencyKeyRef.current = idempotencyKey;
          await complete.mutateAsync({
            sourceApp: event.sourceApp,
            sourceType: event.sourceType,
            sourceId: event.sourceId,
            idempotencyKey,
          });
          completionIdempotencyKeyRef.current = null;
          toast.success('The product job and linked Scheduler work are complete.');
        }
      } else if (sourceApp !== 'custom' && creationMode === 'new') {
        await dispatch.mutateAsync({
          sourceApp,
          title: title.trim() || undefined,
          description: description.trim() || null,
          assigneeFieldUserId,
          scheduledStartAt: fromDatetimeLocalValue(startLocal),
          ...(submittedEstimatedDurationMinutes === null
            ? {}
            : { estimatedDurationMinutes: submittedEstimatedDurationMinutes }),
          deadlineAt: fromDatetimeLocalValue(deadlineLocal),
          job: {
            ...schedulerDispatchSiteSelectionPayload({
              address: jobAddress,
              existingSiteId,
              clientId: selectedClientId,
            }),
            clientName: jobClientName.trim(),
            clientContactName: optionalJobText(installHubJobDetails.clientContactName),
            clientContactPhone: optionalJobText(installHubJobDetails.clientContactPhone),
            clientContactEmail: optionalJobText(installHubJobDetails.clientContactEmail),
            siteContactName: optionalJobText(installHubJobDetails.siteContactName),
            siteContactPhone: optionalJobText(installHubJobDetails.siteContactPhone),
            siteContactEmail: optionalJobText(installHubJobDetails.siteContactEmail),
            accessInformation: optionalJobText(installHubJobDetails.accessInformation),
            siteName: jobSiteName.trim(),
            address: schedulerAddressPayload(jobAddress),
            // Preserve the date selected in the site's scheduling UI instead
            // of deriving it from a UTC-converted instant on the server.
            auditDate: startLocal.slice(0, 10),
            ...(sourceApp === 'ecoaudit'
              ? { siteAddress: schedulerAddressDisplay(jobAddress) }
              : {}),
            ...(sourceApp === 'solarsense'
              ? {
                  location: schedulerAddressDisplay(jobAddress),
                  buildingIdName: jobBuildingName.trim(),
                }
              : {}),
            ...(sourceApp === 'installhub'
              ? {
                  siteAddress: schedulerAddressDisplay(jobAddress),
                  titleSuffix: fieldJobTitleSuffix,
                  ...installHubJobPayload(installHubJobDetails),
                }
              : {}),
          },
        });
      } else {
        await create.mutateAsync({
          title: title.trim() || undefined,
          description: description.trim() || null,
          sourceApp,
          sourceType: sourceApp === 'custom' ? 'custom' : sourceType,
          sourceId: sourceApp === 'custom' ? null : sourceId,
          assigneeFieldUserId,
          scheduledStartAt: fromDatetimeLocalValue(startLocal),
          ...(submittedEstimatedDurationMinutes === null
            ? {}
            : { estimatedDurationMinutes: submittedEstimatedDurationMinutes }),
          deadlineAt: fromDatetimeLocalValue(deadlineLocal),
          status: 'planned',
        });
      }
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          && err.status === 409
          && (err.detail ?? err.message) === 'assignee_on_approved_leave'
          ? 'This user is on approved leave during the selected time. Choose another person or date.'
          : cloudConnectionErrorMessage(err),
      );
    }
  }

  async function handleCancel() {
    if (!event) return;
    setError(null);
    try {
      await cancel.mutateAsync(event.id);
      onClose();
    } catch (err) {
      setError(cloudConnectionErrorMessage(err));
    }
  }

  async function handleComplete() {
    if (!event || event.sourceApp === 'custom' || event.sourceType === 'custom' || !event.sourceId) {
      return;
    }
    if (!window.confirm(
      `Mark ${event.title} complete? This also completes the linked product job.`,
    )) return;
    setError(null);
    const idempotencyKey = completionIdempotencyKeyRef.current ?? crypto.randomUUID();
    completionIdempotencyKeyRef.current = idempotencyKey;
    try {
      await complete.mutateAsync({
        sourceApp: event.sourceApp,
        sourceType: event.sourceType,
        sourceId: event.sourceId,
        idempotencyKey,
      });
      completionIdempotencyKeyRef.current = null;
      toast.success('The product job and linked Scheduler work are complete.');
      onClose();
    } catch (err) {
      setError(cloudConnectionErrorMessage(err));
    }
  }

  async function handleReminder() {
    if (!event || event.sourceApp === 'custom') return;
    setError(null);
    const idempotencyKey = reminderIdempotencyKeyRef.current ?? (
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${event.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    reminderIdempotencyKeyRef.current = idempotencyKey;
    try {
      const result = await remind.mutateAsync({ id: event.id, idempotencyKey });
      reminderIdempotencyKeyRef.current = null;
      toast.success(result.queued ? 'Reminder queued for delivery.' : 'This reminder was already queued.');
    } catch (err) {
      setError(cloudConnectionErrorMessage(err));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay)] p-3 sm:items-center" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheduler-event-title"
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-md)] sm:p-6"
      >
        <h2 id="scheduler-event-title" className="text-lg font-extrabold tracking-[-0.03em] text-[var(--text)]">
          {editing ? 'Edit scheduled job' : 'Schedule a job'}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-sub)]">
          Assign work for a start time, optional duration estimate, and hard deadline.
        </p>

        {!isAdmin ? (
          <p className="mt-4 text-sm font-semibold text-[var(--text-sub)]">
            Inspectors can view assigned jobs only. Ask an admin to create or edit schedule events.
          </p>
        ) : (
          <div className="mt-2">
            {!editing ? (
              <>
                <FieldLabel>Work type</FieldLabel>
                <Select
                  value={sourceApp}
                  onChange={(e) => {
                    const app = e.target.value as ScheduleSourceApp;
                    setSourceApp(app);
                    setSourceType(defaultTypeForApp(app));
                    setSourceId('');
                    setSiteSelectionMode('new');
                    setSiteQuery('');
                    setExistingSiteId('');
                    setSelectedClientId('');
                    setSelectedClient(null);
                    setCreationMode(
                      app !== 'custom' && creatableSourceApps.includes(app)
                        ? 'new'
                        : 'existing',
                    );
                    setAssigneeFieldUserId('');
                    setTitle('');
                    setJobAddress({ ...EMPTY_SCHEDULER_JOB_ADDRESS });
                    setJobSiteName('');
                    setJobBuildingName('');
                    setJobClientName('');
                    setInstallHubJobDetails({ ...EMPTY_INSTALLHUB_JOB_DETAILS });
                  }}
                >
                  {selectableAppOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>

                {sourceApp !== 'custom' ? (
                  <>
                    <fieldset className="mt-4">
                      <legend className="mb-1.5 text-sm font-bold text-[var(--text)]">
                        Creation mode
                      </legend>
                      <div className={`grid gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-1 ${sourceCanCreateNew ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      {([
                        ...(sourceCanCreateNew ? [['new', 'Create new work'] as const] : []),
                        ['existing', 'Link existing'] as const,
                      ]).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setCreationMode(value);
                            setSourceId('');
                            setSiteSelectionMode('new');
                            setSiteQuery('');
                            setExistingSiteId('');
                            setSelectedClientId('');
                            setSelectedClient(null);
                            setJobClientName('');
                            setJobSiteName('');
                            setJobAddress({ ...EMPTY_SCHEDULER_JOB_ADDRESS });
                            setTitle('');
                          }}
                          aria-pressed={creationMode === value}
                          className={`cursor-pointer rounded-lg px-3 py-2 text-sm font-extrabold transition-colors ${
                            creationMode === value
                              ? 'bg-[var(--surface)] text-[var(--primary)] shadow-sm'
                              : 'text-[var(--text-sub)] hover:text-[var(--text)]'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                      </div>
                    </fieldset>
                    {!sourceCanCreateNew ? (
                      <p className="mt-2 text-xs font-semibold text-[var(--text-sub)]">
                        Your portal identity can link existing {appOptions.find((option) => option.value === sourceApp)?.label} work, but it needs an active account in that product to create a new record.
                      </p>
                    ) : null}

                    {creationMode === 'new' ? (
                      <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3">
                        <fieldset>
                          <legend className="mb-1.5 text-sm font-bold text-[var(--text)]">
                            Is this work for a new or existing site?
                          </legend>
                          <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-1">
                            {([
                              ['new', 'New site'],
                              ['existing', 'Existing site'],
                            ] as const).map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                aria-pressed={siteSelectionMode === value}
                                onClick={() => {
                                  if (value === 'new') {
                                    startNewAddress();
                                  } else {
                                    setSiteSelectionMode('existing');
                                    setExistingSiteId('');
                                    setSiteQuery(jobClientName);
                                    setInstallHubJobDetails((current) => (
                                      clearSchedulerFieldJobPlanning(current)
                                    ));
                                  }
                                }}
                                className={`cursor-pointer rounded-lg px-3 py-2 text-sm font-extrabold transition-colors ${
                                  siteSelectionMode === value
                                    ? 'bg-[var(--primary-soft)] text-[var(--primary)]'
                                    : 'text-[var(--text-sub)] hover:text-[var(--text)]'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </fieldset>
                        {siteSelectionMode === 'existing' ? (
                          <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
                            <FieldLabel htmlFor="scheduler-site-search">Find existing site</FieldLabel>
                            <Input
                              id="scheduler-site-search"
                              type="search"
                              value={siteQuery}
                              placeholder="Search client, site, or address"
                              onChange={(event) => setSiteQuery(event.target.value)}
                            />
                            <FieldLabel htmlFor="scheduler-existing-site">Site</FieldLabel>
                            <Select
                              id="scheduler-existing-site"
                              value={existingSiteId}
                              onChange={(event) => selectExistingSite(event.target.value)}
                            >
                              <option value="">Select an existing site</option>
                              {(sites.data ?? []).map((site) => (
                                <option key={site.id} value={site.id}>
                                  {schedulerSiteOptionLabel(site)}
                                </option>
                              ))}
                            </Select>
                            {sites.isLoading ? (
                              <FieldHint>Loading known sites…</FieldHint>
                            ) : null}
                            {sites.error ? (
                              <FieldError message={(sites.error as Error).message || 'Could not load sites'} />
                            ) : null}
                            {existingSiteId ? (
                              <FieldHint>
                                The saved client and site details are filled in below. You can edit them
                                before creating this job; previous job data is not copied.
                              </FieldHint>
                            ) : null}
                          </div>
                        ) : null}
                        <SchedulerClientCombobox
                          value={jobClientName}
                          selectedClientId={selectedClientId}
                          onInput={changeClientName}
                          onSelect={selectClient}
                        />
                        <div className="grid gap-x-3 sm:grid-cols-3">
                          <div>
                            <FieldLabel htmlFor="scheduler-client-contact-name">Client contact name</FieldLabel>
                            <Input id="scheduler-client-contact-name" value={installHubJobDetails.clientContactName} maxLength={300} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, clientContactName: event.target.value }))} />
                          </div>
                          <div>
                            <FieldLabel htmlFor="scheduler-client-contact-phone">Client contact phone</FieldLabel>
                            <Input id="scheduler-client-contact-phone" type="tel" value={installHubJobDetails.clientContactPhone} maxLength={50} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, clientContactPhone: event.target.value }))} />
                          </div>
                          <div>
                            <FieldLabel htmlFor="scheduler-client-contact-email">Client contact email</FieldLabel>
                            <Input id="scheduler-client-contact-email" type="email" value={installHubJobDetails.clientContactEmail} maxLength={320} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, clientContactEmail: event.target.value }))} />
                          </div>
                        </div>
                        <FieldLabel>Site name</FieldLabel>
                        <Input value={jobSiteName} onChange={(e) => setJobSiteName(e.target.value)} />
                        <AustralianAddressFields
                          value={jobAddress}
                          onChange={setJobAddress}
                          clientId={selectedClientId || null}
                          onSuggestionSelected={selectClientAddress}
                          onManualEdit={markAddressAsNew}
                          onAddNewAddress={startNewAddress}
                        />
                        <section className="mt-4 border-t border-[var(--border)] pt-4" aria-labelledby="scheduler-job-site-contact">
                          <h3 id="scheduler-job-site-contact" className="text-sm font-extrabold text-[var(--text)]">Site contact</h3>
                          <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-3">
                            <div>
                              <FieldLabel htmlFor="scheduler-site-contact-name">Contact name</FieldLabel>
                              <Input id="scheduler-site-contact-name" value={installHubJobDetails.siteContactName} maxLength={300} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, siteContactName: event.target.value }))} />
                            </div>
                            <div>
                              <FieldLabel htmlFor="scheduler-site-contact-phone">Contact phone</FieldLabel>
                              <Input id="scheduler-site-contact-phone" type="tel" value={installHubJobDetails.siteContactPhone} maxLength={50} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, siteContactPhone: event.target.value }))} />
                            </div>
                            <div>
                              <FieldLabel htmlFor="scheduler-site-contact-email">Contact email</FieldLabel>
                              <Input id="scheduler-site-contact-email" type="email" value={installHubJobDetails.siteContactEmail} maxLength={320} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, siteContactEmail: event.target.value }))} />
                            </div>
                            <div className="sm:col-span-2 lg:col-span-3">
                              <FieldLabel htmlFor="scheduler-site-access-information">Access information</FieldLabel>
                              <Textarea id="scheduler-site-access-information" rows={2} value={installHubJobDetails.accessInformation} maxLength={5000} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, accessInformation: event.target.value }))} />
                            </div>
                          </div>
                        </section>
                        {sourceApp === 'installhub' ? (
                          <div className="mt-4 space-y-4 border-t border-[var(--border)] pt-4">
                            <section aria-labelledby="scheduler-field-job-planning">
                              <h3 id="scheduler-field-job-planning" className="text-sm font-extrabold text-[var(--text)]">Field App job planning and scope</h3>
                              <div className="grid gap-x-3 sm:grid-cols-2">
                                <div>
                                  <FieldLabel htmlFor="scheduler-electricity-nmi">Electricity NMI</FieldLabel>
                                  <Input id="scheduler-electricity-nmi" value={installHubJobDetails.electricityNmi} maxLength={100} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, electricityNmi: event.target.value }))} />
                                </div>
                                <div>
                                  <FieldLabel htmlFor="scheduler-work-type">Scope categorization</FieldLabel>
                                  <Select id="scheduler-work-type" value={installHubJobDetails.workType.startsWith(OTHER_WORK_TYPE) ? OTHER_WORK_TYPE : installHubJobDetails.workType} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, workType: event.target.value }))}>
                                    <option value="">Select scope</option>
                                    {FIELD_WORK_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                    <option value={OTHER_WORK_TYPE}>M5 — Other</option>
                                  </Select>
                                  {installHubJobDetails.workType.startsWith(OTHER_WORK_TYPE) ? (
                                    <Input aria-label="Other scope" placeholder="Enter other scope" value={installHubJobDetails.workType.slice(OTHER_WORK_TYPE.length)} maxLength={115} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, workType: `${OTHER_WORK_TYPE}${event.target.value}` }))} />
                                  ) : null}
                                </div>
                                <div>
                                  <FieldLabel htmlFor="scheduler-metering-solution">Metering type selection</FieldLabel>
                                  <Select id="scheduler-metering-solution" value={METERING_TYPES.some((value) => value === installHubJobDetails.meteringSolutionType) ? installHubJobDetails.meteringSolutionType : installHubJobDetails.meteringSolutionType ? OTHER_METERING_TYPE : ''} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, meteringSolutionType: event.target.value }))}>
                                    <option value="">Select metering type</option>
                                    {METERING_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
                                    <option value={OTHER_METERING_TYPE}>Other</option>
                                  </Select>
                                  {installHubJobDetails.meteringSolutionType === OTHER_METERING_TYPE || (installHubJobDetails.meteringSolutionType && !METERING_TYPES.some((value) => value === installHubJobDetails.meteringSolutionType)) ? (
                                    <Input aria-label="Other metering type" placeholder="Enter other metering type" value={installHubJobDetails.meteringSolutionType === OTHER_METERING_TYPE ? '' : installHubJobDetails.meteringSolutionType} maxLength={120} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, meteringSolutionType: event.target.value || OTHER_METERING_TYPE }))} />
                                  ) : null}
                                </div>
                                <NullableBooleanSelect id="scheduler-maas" label="MaaS" value={installHubJobDetails.maas} onChange={(maas) => setInstallHubJobDetails((current) => ({ ...current, maas }))} />
                                <div className="sm:col-span-2">
                                  <FieldLabel htmlFor="scheduler-job-comments">Job comments / scope</FieldLabel>
                                  <Textarea id="scheduler-job-comments" rows={3} value={installHubJobDetails.jobComments} maxLength={5000} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, jobComments: event.target.value }))} />
                                </div>
                              </div>
                            </section>

                          </div>
                        ) : null}
                        {sourceApp === 'solarsense' ? (
                          <>
                            <FieldLabel>Building / roof name</FieldLabel>
                            <Input value={jobBuildingName} onChange={(e) => setJobBuildingName(e.target.value)} />
                          </>
                        ) : null}
                      </div>
                    ) : (
                      <>
                        <FieldLabel>Search existing Draft work</FieldLabel>
                        <Input
                          value={jobQuery}
                          onChange={(e) => setJobQuery(e.target.value)}
                          placeholder="Site name, client, address…"
                        />
                        <div className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-xl border border-[var(--border)] p-2">
                          {(jobs.data ?? []).map((opt) => (
                            <button
                              key={`${opt.sourceType}-${opt.id}`}
                              type="button"
                              onClick={() => {
                                setSourceId(opt.id);
                                setSourceType(opt.sourceType);
                                setTitle(opt.label);
                              }}
                              className={`block w-full cursor-pointer rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                                sourceId === opt.id
                                  ? 'bg-[var(--primary-soft)] font-extrabold text-[var(--primary)]'
                                  : 'hover:bg-[var(--surface2)]'
                              }`}
                            >
                              <span className="font-bold">{opt.label}</span>
                              {opt.subtitle ? (
                                <span className="mt-0.5 block text-xs text-[var(--text-sub)]">{opt.subtitle}</span>
                              ) : null}
                            </button>
                          ))}
                          {jobs.isLoading ? (
                            <p className="px-2 py-1 text-xs text-[var(--text-sub)]" role="status" aria-live="polite">
                              Searching…
                            </p>
                          ) : null}
                          {!jobs.isLoading && (jobs.data?.length ?? 0) === 0 ? (
                            <p className="px-2 py-1 text-xs text-[var(--text-sub)]" role="status" aria-live="polite">
                              No matching Draft work.
                            </p>
                          ) : null}
                        </div>
                      </>
                    )}
                  </>
                ) : null}
              </>
            ) : null}

            {sourceApp === 'installhub' && creationMode === 'new' && !editing ? (
              <>
                <FieldLabel>Title</FieldLabel>
                <Input readOnly value={schedulerFieldJobTitlePreview(
                  installHubJobDetails.workType,
                  jobClientName,
                  jobSiteName,
                  fieldJobTitleSuffix,
                )} />
              </>
            ) : (
              <>
                <FieldLabel>Title</FieldLabel>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={sourceApp === 'custom' ? 'Custom visit or task' : 'Optional override'}
                />
              </>
            )}

            {editing ? (
              <>
                <FieldLabel>Job Comments / Scope</FieldLabel>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </>
            ) : sourceApp === 'installhub' && creationMode === 'new' ? null : (
              <>
                <FieldLabel>Description</FieldLabel>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </>
            )}

            <FieldLabel>Assignee</FieldLabel>
            <Select
              value={assigneeFieldUserId}
              onChange={(e) => setAssigneeFieldUserId(e.target.value)}
              disabled={assignees.isLoading}
              aria-busy={assignees.isLoading}
            >
              <option value="">{assignees.isLoading
                ? 'Loading users…'
                : sourceApp === 'installhub' && creationMode === 'new' && !editing
                  ? 'Unassigned (leave unscheduled)'
                  : 'Select user…'}</option>
              {eligibleAssignees.map((u) => (
                <option key={u.fieldUserId} value={u.fieldUserId}>
                  {u.label} ({u.email})
                </option>
              ))}
            </Select>
            {!assigneeFieldUserId && sourceApp === 'installhub' && creationMode === 'new' && !editing ? (
              <FieldHint>The job will be created as incomplete and will appear first in the Field jobs sidebar.</FieldHint>
            ) : null}
            {assignees.isLoading ? (
              <p className="mt-1 text-xs text-[var(--text-sub)]" role="status" aria-live="polite">
                Loading eligible assignees…
              </p>
            ) : null}
            {sourceApp !== 'custom' && !assignees.isLoading && eligibleAssignees.length === 0 ? (
              <p className="mt-1 text-xs font-semibold text-[var(--red)]">
                No active users have access to this product app.
              </p>
            ) : null}
            {assignees.error ? (
              <p className="mt-1 text-xs text-[var(--red)]" role="alert">
                Could not load users (admin directory). {(assignees.error as Error).message}
              </p>
            ) : null}

            <FieldLabel>Start</FieldLabel>
            <Input
              type="datetime-local"
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
            />
            <FieldLabel htmlFor="scheduler-estimated-duration">
              Estimated time to complete (minutes, optional)
            </FieldLabel>
            <Input
              id="scheduler-estimated-duration"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              maxLength={5}
              placeholder="e.g. 90"
              value={estimatedDurationMinutes}
              onChange={(event) => setEstimatedDurationMinutes(event.target.value)}
              aria-invalid={Boolean(durationError)}
              aria-describedby={durationError
                ? 'scheduler-estimated-duration-error scheduler-estimated-duration-hint'
                : 'scheduler-estimated-duration-hint'}
            />
            <FieldHint id="scheduler-estimated-duration-hint">
              Leave blank if the duration is not known. The calendar uses this estimate only for planning.
            </FieldHint>
            <FieldError id="scheduler-estimated-duration-error" message={durationError ?? undefined} />
            <FieldLabel>Deadline</FieldLabel>
            <Input
              type="datetime-local"
              value={deadlineLocal}
              onChange={(e) => setDeadlineLocal(e.target.value)}
            />

            {editing ? (
              <>
                <FieldLabel>Status</FieldLabel>
                <Select value={status} onChange={(e) => setStatus(e.target.value as ScheduleStatus)}>
                  <option value="planned">Planned</option>
                  <option value="in_progress">In progress</option>
                  <option value="done">{sourceApp === 'custom' ? 'Done' : 'Completed'}</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
                {sourceApp !== 'custom' && status === 'done' && event?.status !== 'done' ? (
                  <FieldHint>
                    Saving this status completes the linked product job and closes its Scheduler work.
                  </FieldHint>
                ) : null}
              </>
            ) : null}

            {supportsMobileNotifications ? (
              <p className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-xs font-semibold leading-5 text-[var(--text-sub)]">
                The assignee is notified on assignment and changes, 24 hours before the start,
                one hour before the start, and again at the scheduled start time. Existing jobs
                also offer an extra reminder action.
              </p>
            ) : editing && sourceApp !== 'custom' ? (
              <p className="mt-3 text-xs font-semibold text-[var(--text-sub)]">
                Mobile reminders are available for supported product jobs. This legacy calendar
                link is planning-only.
              </p>
            ) : (
              <p className="mt-3 text-xs font-semibold text-[var(--text-sub)]">
                Custom calendar events do not target a mobile app.
              </p>
            )}
          </div>
        )}

        {error ? (
          <div ref={errorRef} className="mt-4 outline-none" tabIndex={-1}>
            <ErrorBanner message={error} />
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          {editing && event && isAdmin && event.sourceApp !== 'custom'
          && event.sourceType !== 'custom' && event.sourceId && event.status !== 'done' ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => void handleComplete()}
            >
              {complete.isPending ? 'Completing…' : 'Mark job complete'}
            </Button>
          ) : null}
          {editing && event && isAdmin && supportsMobileNotifications && onOpenFinance ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenFinance(event)}
            >
              Open finance
            </Button>
          ) : null}
          {editing && event && isAdmin && supportsMobileNotifications ? (
            <Button
              variant="secondary"
              disabled={busy || event.status === 'cancelled' || event.status === 'done'}
              onClick={() => void handleReminder()}
              title={event.status === 'cancelled' || event.status === 'done'
                ? 'Reminders are available only for active scheduled jobs.'
                : 'Send an additional notification to the assigned user now.'}
            >
              {remind.isPending ? 'Queuing reminder…' : 'Send reminder'}
            </Button>
          ) : null}
          {editing && isAdmin ? (
            <Button variant="danger" disabled={busy} onClick={() => void handleCancel()}>
              Cancel job
            </Button>
          ) : null}
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Close
          </Button>
          {isAdmin ? (
            <Button disabled={!canSubmit || busy} onClick={() => void handleSubmit()}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
