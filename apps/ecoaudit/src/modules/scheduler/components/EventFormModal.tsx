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
import {
  useCancelScheduleEvent,
  useCreateScheduleEvent,
  useCreateSchedulerDispatch,
  useJobOptions,
  usePortalAssignees,
  useSendScheduleEventReminder,
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
import { scheduledStartUpdate } from '@/modules/scheduler/lib/eventUpdate';
import {
  schedulerDefaultSourceApp,
  schedulerEventSupportsMobileNotifications,
} from '@/modules/scheduler/lib/visibility';
import {
  EMPTY_SCHEDULER_JOB_ADDRESS,
  schedulerAddressDisplay,
  schedulerAddressIsComplete,
  schedulerAddressPayload,
} from '@/modules/scheduler/lib/routing';
import type {
  ScheduleEvent,
  ScheduleSourceApp,
  ScheduleSourceType,
  ScheduleStatus,
} from '@/modules/scheduler/types/domain';
import type { SchedulerJobAddressInput } from '@/modules/scheduler/types/routing';

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

type InstallHubJobDetails = {
  electricityNmi: string;
  customerName: string;
  maas: boolean | null;
  serviceType: string;
  meteringSolutionType: string;
  plannedMeterType: string;
  siteContactName: string;
  siteContactPhone: string;
  siteContactEmail: string;
  fergusJobNumber: string;
  quoteNumber: string;
  jobComments: string;
  accessInformation: string;
  warrantyDevice: boolean | null;
  monitoringInstalled: boolean | null;
  hardwareInstalled: boolean | null;
  solarCapacityKw: string;
  additionalMonitoringRequired: boolean | null;
  additionalMonitoringHardware: string;
};

const EMPTY_INSTALLHUB_JOB_DETAILS: InstallHubJobDetails = {
  electricityNmi: '',
  customerName: '',
  maas: null,
  serviceType: '',
  meteringSolutionType: '',
  plannedMeterType: '',
  siteContactName: '',
  siteContactPhone: '',
  siteContactEmail: '',
  fergusJobNumber: '',
  quoteNumber: '',
  jobComments: '',
  accessInformation: '',
  warrantyDevice: null,
  monitoringInstalled: null,
  hardwareInstalled: null,
  solarCapacityKw: '',
  additionalMonitoringRequired: null,
  additionalMonitoringHardware: '',
};
const MAX_SOLAR_CAPACITY_KW = 1_000_000;

function optionalJobText(value: string): string | null {
  return value.trim() || null;
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
    customerName: optionalJobText(details.customerName),
    maas: details.maas,
    serviceType: optionalJobText(details.serviceType),
    meteringSolutionType: optionalJobText(details.meteringSolutionType),
    plannedMeterType: optionalJobText(details.plannedMeterType),
    siteContactName: optionalJobText(details.siteContactName),
    siteContactPhone: optionalJobText(details.siteContactPhone),
    siteContactEmail: optionalJobText(details.siteContactEmail),
    fergusJobNumber: optionalJobText(details.fergusJobNumber),
    quoteNumber: optionalJobText(details.quoteNumber),
    jobComments: optionalJobText(details.jobComments),
    accessInformation: optionalJobText(details.accessInformation),
    warrantyDevice: details.warrantyDevice,
    monitoringInstalled: details.monitoringInstalled,
    hardwareInstalled: details.hardwareInstalled,
    solarCapacityKw: details.solarCapacityKw.trim()
      ? Number(details.solarCapacityKw)
      : null,
    additionalMonitoringRequired: details.additionalMonitoringRequired,
    additionalMonitoringHardware: optionalJobText(details.additionalMonitoringHardware),
  };
}

const appOptions: Array<{ value: ScheduleSourceApp; label: string }> = [
  { value: 'ecoaudit', label: 'EcoAudit' },
  { value: 'solarsense', label: 'SolarSense' },
  { value: 'installhub', label: 'Field App installation' },
  { value: 'custom', label: 'Custom job' },
];

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
  const [jobSiteName, setJobSiteName] = useState(initial.jobSiteName);
  const [jobAddress, setJobAddress] = useState<SchedulerJobAddressInput>(initial.jobAddress);
  const [jobBuildingName, setJobBuildingName] = useState(initial.jobBuildingName);
  const [jobClientName, setJobClientName] = useState(initial.jobClientName);
  const [installHubJobDetails, setInstallHubJobDetails] = useState<InstallHubJobDetails>(initial.installHubJobDetails);
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
  const sourceCanCreateNew = sourceApp !== 'custom'
    && creatableSourceApps.includes(sourceApp);

  const jobs = useJobOptions(
    jobQuery,
    sourceApp === 'custom' ? undefined : sourceApp,
    open && isAdmin && sourceApp !== 'custom' && creationMode === 'existing',
  );

  const eligibleAssignees = useMemo(() => (assignees.data ?? []).filter((assignee) => (
    sourceApp === 'custom' || assignee.appMemberships.includes(sourceApp)
  )), [assignees.data, sourceApp]);
  const parsedEstimatedDurationMinutes = parseEstimatedDurationMinutes(estimatedDurationMinutes);
  const durationError = estimatedDurationError(estimatedDurationMinutes);

  const canSubmit = useMemo(() => {
    if (!isAdmin) return false;
    if (!assigneeFieldUserId || !startLocal || !deadlineLocal) return false;
    if (parsedEstimatedDurationMinutes === undefined) return false;
    if (sourceApp === 'custom') return Boolean(title.trim());
    if (creationMode === 'existing') return Boolean(sourceId);
    if (!sourceCanCreateNew) return false;
    if (sourceApp === 'ecoaudit') return Boolean(
      jobSiteName.trim() && schedulerAddressIsComplete(jobAddress),
    );
    if (sourceApp === 'solarsense') {
      return Boolean(
        jobSiteName.trim()
        && schedulerAddressIsComplete(jobAddress)
        && jobBuildingName.trim(),
      );
    }
    const solarCapacityKw = installHubJobDetails.solarCapacityKw.trim()
      ? Number(installHubJobDetails.solarCapacityKw)
      : null;
    return Boolean(
      jobClientName.trim()
      && jobSiteName.trim()
      && schedulerAddressIsComplete(jobAddress)
      && (
        solarCapacityKw === null
        || (
          Number.isFinite(solarCapacityKw)
          && solarCapacityKw >= 0
          && solarCapacityKw <= MAX_SOLAR_CAPACITY_KW
        )
      )
    );
  }, [
    isAdmin,
    assigneeFieldUserId,
    startLocal,
    deadlineLocal,
    parsedEstimatedDurationMinutes,
    sourceApp,
    title,
    creationMode,
    sourceCanCreateNew,
    sourceId,
    jobSiteName,
    jobAddress,
    jobBuildingName,
    jobClientName,
    installHubJobDetails,
  ]);

  const saving = create.isPending || dispatch.isPending || update.isPending || cancel.isPending;
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

  async function handleSubmit() {
    const submittedEstimatedDurationMinutes = parseEstimatedDurationMinutes(
      estimatedDurationMinutes,
    );
    if (!canSubmit || submittedEstimatedDurationMinutes === undefined) return;
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
            status,
          },
        });
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
                  clientName: jobClientName.trim(),
                  siteAddress: schedulerAddressDisplay(jobAddress),
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
                        <p className="text-xs font-bold text-[var(--text-sub)]">
                          A Draft product record will be created and assigned with this planned event.
                        </p>
                        {sourceApp === 'installhub' ? (
                          <>
                            <FieldLabel>Client name</FieldLabel>
                            <Input value={jobClientName} onChange={(e) => setJobClientName(e.target.value)} />
                          </>
                        ) : null}
                        <FieldLabel>Site name</FieldLabel>
                        <Input value={jobSiteName} onChange={(e) => setJobSiteName(e.target.value)} />
                        <AustralianAddressFields value={jobAddress} onChange={setJobAddress} />
                        {sourceApp === 'installhub' ? (
                          <div className="mt-4 space-y-4 border-t border-[var(--border)] pt-4">
                            <section aria-labelledby="scheduler-field-job-planning">
                              <h3 id="scheduler-field-job-planning" className="text-sm font-extrabold text-[var(--text)]">Field App job planning</h3>
                              <div className="grid gap-x-3 sm:grid-cols-2">
                                <div>
                                  <FieldLabel htmlFor="scheduler-customer-name">Customer name</FieldLabel>
                                  <Input id="scheduler-customer-name" value={installHubJobDetails.customerName} maxLength={300} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, customerName: event.target.value }))} />
                                </div>
                                <div>
                                  <FieldLabel htmlFor="scheduler-electricity-nmi">Electricity NMI</FieldLabel>
                                  <Input id="scheduler-electricity-nmi" value={installHubJobDetails.electricityNmi} maxLength={100} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, electricityNmi: event.target.value }))} />
                                  <FieldHint>Saved on the canonical incoming grid supply, not as duplicate installation metadata.</FieldHint>
                                </div>
                                <div>
                                  <FieldLabel htmlFor="scheduler-service-type">Service type</FieldLabel>
                                  <Input id="scheduler-service-type" value={installHubJobDetails.serviceType} maxLength={120} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, serviceType: event.target.value }))} />
                                </div>
                                <div>
                                  <FieldLabel htmlFor="scheduler-metering-solution">Metering solution type</FieldLabel>
                                  <Input id="scheduler-metering-solution" value={installHubJobDetails.meteringSolutionType} maxLength={120} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, meteringSolutionType: event.target.value }))} />
                                </div>
                                <div>
                                  <FieldLabel htmlFor="scheduler-planned-meter-type">Planned meter type (planning only)</FieldLabel>
                                  <Input id="scheduler-planned-meter-type" value={installHubJobDetails.plannedMeterType} maxLength={120} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, plannedMeterType: event.target.value }))} />
                                  <FieldHint>Installed device records remain authoritative in Field App Complete.</FieldHint>
                                </div>
                                <NullableBooleanSelect id="scheduler-maas" label="MaaS" value={installHubJobDetails.maas} onChange={(maas) => setInstallHubJobDetails((current) => ({ ...current, maas }))} />
                                <div>
                                  <FieldLabel htmlFor="scheduler-fergus-job">Fergus job number</FieldLabel>
                                  <Input id="scheduler-fergus-job" value={installHubJobDetails.fergusJobNumber} maxLength={100} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, fergusJobNumber: event.target.value }))} />
                                </div>
                                <div>
                                  <FieldLabel htmlFor="scheduler-quote-number">Quote number</FieldLabel>
                                  <Input id="scheduler-quote-number" value={installHubJobDetails.quoteNumber} maxLength={100} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, quoteNumber: event.target.value }))} />
                                </div>
                              </div>
                            </section>

                            <section className="border-t border-[var(--border)] pt-4" aria-labelledby="scheduler-field-job-contact">
                              <h3 id="scheduler-field-job-contact" className="text-sm font-extrabold text-[var(--text)]">Site contact and access</h3>
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
                                  <FieldLabel htmlFor="scheduler-access-information">Access information (sensitive)</FieldLabel>
                                  <Textarea id="scheduler-access-information" rows={3} value={installHubJobDetails.accessInformation} maxLength={5000} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, accessInformation: event.target.value }))} />
                                  <FieldHint>Stored on the new Field App job and excluded from broad job-option labels.</FieldHint>
                                </div>
                              </div>
                            </section>

                            <section className="border-t border-[var(--border)] pt-4" aria-labelledby="scheduler-field-job-state">
                              <h3 id="scheduler-field-job-state" className="text-sm font-extrabold text-[var(--text)]">Recorded installation state</h3>
                              <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">Leave a selection as Not recorded when the answer is unknown.</p>
                              <div className="grid gap-x-3 sm:grid-cols-2 lg:grid-cols-3">
                                <NullableBooleanSelect id="scheduler-warranty-device" label="Warranty device" value={installHubJobDetails.warrantyDevice} onChange={(warrantyDevice) => setInstallHubJobDetails((current) => ({ ...current, warrantyDevice }))} />
                                <NullableBooleanSelect id="scheduler-monitoring-installed" label="Monitoring installed" value={installHubJobDetails.monitoringInstalled} onChange={(monitoringInstalled) => setInstallHubJobDetails((current) => ({ ...current, monitoringInstalled }))} />
                                <NullableBooleanSelect id="scheduler-hardware-installed" label="Hardware installed" value={installHubJobDetails.hardwareInstalled} onChange={(hardwareInstalled) => setInstallHubJobDetails((current) => ({ ...current, hardwareInstalled }))} />
                                <div>
                                  <FieldLabel htmlFor="scheduler-solar-capacity">Solar capacity (kW)</FieldLabel>
                                  <Input id="scheduler-solar-capacity" type="number" min="0" max={MAX_SOLAR_CAPACITY_KW} step="any" inputMode="decimal" value={installHubJobDetails.solarCapacityKw} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, solarCapacityKw: event.target.value }))} />
                                  <FieldHint>Maximum {MAX_SOLAR_CAPACITY_KW.toLocaleString('en-AU')} kW.</FieldHint>
                                </div>
                                <NullableBooleanSelect id="scheduler-additional-monitoring" label="Additional monitoring required" value={installHubJobDetails.additionalMonitoringRequired} onChange={(additionalMonitoringRequired) => setInstallHubJobDetails((current) => ({ ...current, additionalMonitoringRequired }))} />
                                <div>
                                  <FieldLabel htmlFor="scheduler-additional-hardware">Additional monitoring hardware</FieldLabel>
                                  <Input id="scheduler-additional-hardware" value={installHubJobDetails.additionalMonitoringHardware} maxLength={5000} onChange={(event) => setInstallHubJobDetails((current) => ({ ...current, additionalMonitoringHardware: event.target.value }))} />
                                </div>
                                <div className="sm:col-span-2 lg:col-span-3">
                                  <FieldLabel htmlFor="scheduler-job-comments">Job comments</FieldLabel>
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

            <FieldLabel>Title</FieldLabel>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={sourceApp === 'custom' ? 'Custom visit or task' : 'Optional override'}
            />

            <FieldLabel>Description</FieldLabel>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />

            <FieldLabel>Assignee</FieldLabel>
            <Select
              value={assigneeFieldUserId}
              onChange={(e) => setAssigneeFieldUserId(e.target.value)}
              disabled={assignees.isLoading}
              aria-busy={assignees.isLoading}
            >
              <option value="">{assignees.isLoading ? 'Loading users…' : 'Select user…'}</option>
              {eligibleAssignees.map((u) => (
                <option key={u.fieldUserId} value={u.fieldUserId}>
                  {u.label} ({u.email})
                </option>
              ))}
            </Select>
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
                  <option value="done">Done</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
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
