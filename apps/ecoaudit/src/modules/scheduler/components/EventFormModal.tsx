'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Card';
import { FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { cloudConnectionErrorMessage } from '@/api/client';
import { useToast } from '@/contexts/ToastContext';
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
import { schedulerDefaultSourceApp } from '@/modules/scheduler/lib/visibility';
import type {
  ScheduleEvent,
  ScheduleSourceApp,
  ScheduleSourceType,
  ScheduleStatus,
} from '@/modules/scheduler/types/domain';

type Props = {
  open: boolean;
  onClose: () => void;
  initialDay?: Date | null;
  event?: ScheduleEvent | null;
  isAdmin: boolean;
  visibleSourceApps: ScheduleSourceApp[];
  onOpenFinance?: (event: ScheduleEvent) => void;
};

type CreationMode = 'new' | 'existing';

const appOptions: Array<{ value: ScheduleSourceApp; label: string }> = [
  { value: 'custom', label: 'Custom job' },
  { value: 'solarsense', label: 'Solar Sense' },
  { value: 'installhub', label: 'Field App installation' },
];

function defaultTypeForApp(app: ScheduleSourceApp): ScheduleSourceType {
  if (app === 'ecoaudit') return 'audit';
  if (app === 'installhub') return 'installation';
  if (app === 'solarsense') return 'assessment';
  return 'custom';
}

function supportsMobileSchedulerNotifications(event: ScheduleEvent): boolean {
  if (typeof event.sourceId !== 'string' || !event.sourceId.trim()) return false;
  return (event.sourceApp === 'solarsense' && event.sourceType === 'assessment')
    || (event.sourceApp === 'installhub' && event.sourceType === 'installation');
}

function initialFormValues(
  event?: ScheduleEvent | null,
  initialDay?: Date | null,
  defaultSourceApp: ScheduleSourceApp = 'ecoaudit',
) {
  if (event) {
    return {
      sourceApp: event.sourceApp,
      sourceType: event.sourceType,
      sourceId: event.sourceId ?? '',
      creationMode: 'existing' as CreationMode,
      jobQuery: '',
      jobSiteName: '',
      jobSiteAddress: '',
      jobLocation: '',
      jobBuildingName: '',
      jobClientName: '',
      title: event.title,
      description: event.description ?? '',
      assigneeFieldUserId: event.assigneeFieldUserId,
      startLocal: toDatetimeLocalValue(event.scheduledStartAt),
      endLocal: event.scheduledEndAt ? toDatetimeLocalValue(event.scheduledEndAt) : '',
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
    jobSiteAddress: '',
    jobLocation: '',
    jobBuildingName: '',
    jobClientName: '',
    title: '',
    description: '',
    assigneeFieldUserId: '',
    startLocal: toDatetimeLocalValue(start.toISOString()),
    endLocal: '',
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
    schedulerDefaultSourceApp(visibleSourceApps),
  );
  const visibleAppOptions = appOptions.filter((option) => (
    visibleSourceApps.includes(option.value)
  ));

  const [sourceApp, setSourceApp] = useState<ScheduleSourceApp>(initial.sourceApp);
  const [sourceType, setSourceType] = useState<ScheduleSourceType>(initial.sourceType);
  const [sourceId, setSourceId] = useState(initial.sourceId);
  const [creationMode, setCreationMode] = useState<CreationMode>(initial.creationMode);
  const [jobQuery, setJobQuery] = useState(initial.jobQuery);
  const [jobSiteName, setJobSiteName] = useState(initial.jobSiteName);
  const [jobSiteAddress, setJobSiteAddress] = useState(initial.jobSiteAddress);
  const [jobLocation, setJobLocation] = useState(initial.jobLocation);
  const [jobBuildingName, setJobBuildingName] = useState(initial.jobBuildingName);
  const [jobClientName, setJobClientName] = useState(initial.jobClientName);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [assigneeFieldUserId, setAssigneeFieldUserId] = useState(initial.assigneeFieldUserId);
  const [startLocal, setStartLocal] = useState(initial.startLocal);
  const [endLocal, setEndLocal] = useState(initial.endLocal);
  const [deadlineLocal, setDeadlineLocal] = useState(initial.deadlineLocal);
  const [status, setStatus] = useState<ScheduleStatus>(initial.status);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(false);
  const reminderIdempotencyKeyRef = useRef<string | null>(null);

  const jobs = useJobOptions(
    jobQuery,
    sourceApp === 'custom' ? undefined : sourceApp,
    open && isAdmin && sourceApp !== 'custom' && creationMode === 'existing',
  );

  const eligibleAssignees = useMemo(() => (assignees.data ?? []).filter((assignee) => (
    sourceApp === 'custom' || assignee.appMemberships.includes(sourceApp)
  )), [assignees.data, sourceApp]);

  const canSubmit = useMemo(() => {
    if (!isAdmin) return false;
    if (!assigneeFieldUserId || !startLocal || !deadlineLocal) return false;
    if (sourceApp === 'custom') return Boolean(title.trim());
    if (creationMode === 'existing') return Boolean(sourceId);
    if (sourceApp === 'ecoaudit') return Boolean(jobSiteName.trim() && jobSiteAddress.trim());
    if (sourceApp === 'solarsense') {
      return Boolean(jobSiteName.trim() && jobLocation.trim() && jobBuildingName.trim());
    }
    return Boolean(jobClientName.trim() && jobSiteName.trim() && jobSiteAddress.trim());
  }, [
    isAdmin,
    assigneeFieldUserId,
    startLocal,
    deadlineLocal,
    sourceApp,
    title,
    creationMode,
    sourceId,
    jobSiteName,
    jobSiteAddress,
    jobLocation,
    jobBuildingName,
    jobClientName,
  ]);

  const saving = create.isPending || dispatch.isPending || update.isPending || cancel.isPending;
  const busy = saving || remind.isPending;
  const supportsMobileNotifications = event
    ? supportsMobileSchedulerNotifications(event)
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
    if (!canSubmit) return;
    setError(null);
    try {
      if (editing && event) {
        await update.mutateAsync({
          id: event.id,
          input: {
            title: title.trim() || event.title,
            description: description.trim() || null,
            assigneeFieldUserId,
            scheduledStartAt: fromDatetimeLocalValue(startLocal),
            scheduledEndAt: endLocal ? fromDatetimeLocalValue(endLocal) : null,
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
          scheduledEndAt: endLocal ? fromDatetimeLocalValue(endLocal) : null,
          deadlineAt: fromDatetimeLocalValue(deadlineLocal),
          job: {
            siteName: jobSiteName.trim(),
            // Preserve the date selected in the site's scheduling UI instead
            // of deriving it from a UTC-converted instant on the server.
            auditDate: startLocal.slice(0, 10),
            ...(sourceApp === 'ecoaudit'
              ? { siteAddress: jobSiteAddress.trim() }
              : {}),
            ...(sourceApp === 'solarsense'
              ? {
                  location: jobLocation.trim(),
                  buildingIdName: jobBuildingName.trim(),
                }
              : {}),
            ...(sourceApp === 'installhub'
              ? {
                  clientName: jobClientName.trim(),
                  siteAddress: jobSiteAddress.trim(),
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
          scheduledEndAt: endLocal ? fromDatetimeLocalValue(endLocal) : null,
          deadlineAt: fromDatetimeLocalValue(deadlineLocal),
          status: 'planned',
        });
      }
      onClose();
    } catch (err) {
      setError(cloudConnectionErrorMessage(err));
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
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-md)] sm:p-6"
      >
        <h2 id="scheduler-event-title" className="text-lg font-extrabold tracking-[-0.03em] text-[var(--text)]">
          {editing ? 'Edit scheduled job' : 'Schedule a job'}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-sub)]">
          Assign work for a day and time with a hard deadline.
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
                    setCreationMode('new');
                    setAssigneeFieldUserId('');
                    setTitle('');
                  }}
                >
                  {visibleAppOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>

                {sourceApp !== 'custom' ? (
                  <>
                    <fieldset className="mt-4">
                      <legend className="mb-1.5 text-sm font-bold text-[var(--text)]">
                        Creation mode
                      </legend>
                      <div className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-1">
                      {([
                        ['new', 'Create new work'],
                        ['existing', 'Link existing'],
                      ] as const).map(([value, label]) => (
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
                        {sourceApp === 'solarsense' ? (
                          <>
                            <FieldLabel>Site location</FieldLabel>
                            <Input value={jobLocation} onChange={(e) => setJobLocation(e.target.value)} />
                            <FieldLabel>Building / roof name</FieldLabel>
                            <Input value={jobBuildingName} onChange={(e) => setJobBuildingName(e.target.value)} />
                          </>
                        ) : (
                          <>
                            <FieldLabel>Site address</FieldLabel>
                            <Input value={jobSiteAddress} onChange={(e) => setJobSiteAddress(e.target.value)} />
                          </>
                        )}
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
            <FieldLabel>End (optional)</FieldLabel>
            <Input
              type="datetime-local"
              value={endLocal}
              onChange={(e) => setEndLocal(e.target.value)}
            />
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
                and again at the scheduled start time. Existing jobs also offer an extra reminder action.
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
