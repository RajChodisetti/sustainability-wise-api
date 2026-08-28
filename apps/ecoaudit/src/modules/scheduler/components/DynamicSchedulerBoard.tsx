'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorBanner, Spinner } from '@/components/ui/Card';
import {
  FieldError,
  FieldHint,
  FieldLabel,
  Input,
  Select,
} from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { JobsPoolPanel, type JobDragData } from '@/modules/scheduler/components/JobsPoolPanel';
import { StaffFilterPanel } from '@/modules/scheduler/components/StaffFilterPanel';
import type { EventDragData } from '@/modules/scheduler/components/ScheduleEventBlock';
import { WeekTimeGrid, type SlotDropData, type StaffDropData } from '@/modules/scheduler/components/WeekTimeGrid';
import {
  useCreateScheduleEvent,
  usePortalAssignees,
  useScheduleEvents,
  useUpdateScheduleEvent,
} from '@/modules/scheduler/hooks/useScheduler';
import { appChipClass, SOURCE_APP_LABEL } from '@/modules/scheduler/lib/colors';
import {
  estimatedDurationError,
  parseEstimatedDurationMinutes,
} from '@/modules/scheduler/lib/estimatedDuration';
import { scheduledJobWeek } from '@/modules/scheduler/lib/jobsPool';
import { schedulerSourceAppIsSelectable } from '@/modules/scheduler/lib/visibility';
import {
  defaultDeadlineFromStart,
  slotDateTime,
  startOfWeekMonday,
  weekDays,
} from '@/modules/scheduler/lib/weekGrid';
import type {
  JobOption,
  PortalDirectoryUser,
  ScheduleEvent,
  ScheduleSourceApp,
} from '@/modules/scheduler/types/domain';

type PendingAssign = ({
  type: 'job';
  job: JobOption;
} | {
  type: 'event';
  event: ScheduleEvent;
}) & {
  day: Date;
  hour: number;
};

export function DynamicSchedulerBoard({
  isAdmin,
  visibleSourceApps,
  selectableSourceApps,
  onSlotCreate,
  onEventEdit,
}: {
  isAdmin: boolean;
  visibleSourceApps: ScheduleSourceApp[];
  selectableSourceApps: ScheduleSourceApp[];
  onSlotCreate: (day: Date) => void;
  onEventEdit: (event: ScheduleEvent) => void;
}) {
  const [cursor, setCursor] = useState(() => startOfWeekMonday(new Date()));
  const [staffFilter, setStaffFilter] = useState<string[]>([]);
  const [activeDrag, setActiveDrag] = useState<JobDragData | EventDragData | null>(null);
  const [expandedDayKey, setExpandedDayKey] = useState<string | null>(null);
  const [pendingAssign, setPendingAssign] = useState<PendingAssign | null>(null);
  const [pickAssignee, setPickAssignee] = useState('');
  const [boardError, setBoardError] = useState<string | null>(null);
  const [staffPanelOpen, setStaffPanelOpen] = useState(false);
  const [jobsPanelOpen, setJobsPanelOpen] = useState(isAdmin);

  const days = useMemo(() => weekDays(cursor), [cursor]);
  const range = useMemo(() => {
    const from = days[0];
    const to = new Date(days[6]);
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [days]);

  const eventsQuery = useScheduleEvents({ from: range.from, to: range.to });
  const assignees = usePortalAssignees(isAdmin);
  const create = useCreateScheduleEvent();
  const update = useUpdateScheduleEvent();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: {
        start: ['Space'],
        cancel: ['Escape'],
        end: ['Space', 'Enter', 'Tab'],
      },
    }),
  );

  const staff = useMemo(() => assignees.data ?? [], [assignees.data]);
  const allEvents = useMemo(() => (
    (eventsQuery.data ?? []).filter((event) => (
      event.status !== 'done' && visibleSourceApps.includes(event.sourceApp)
    ))
  ), [eventsQuery.data, visibleSourceApps]);
  const visibleEvents = useMemo(() => {
    if (staffFilter.length === 0) return allEvents;
    return allEvents.filter((event) => staffFilter.includes(event.assigneeFieldUserId));
  }, [allEvents, staffFilter]);

  const filteredStaff = useMemo(() => {
    if (staffFilter.length === 0) return staff;
    return staff.filter((person) => staffFilter.includes(person.fieldUserId));
  }, [staff, staffFilter]);

  async function createFromJob(
    job: JobOption,
    day: Date,
    hour: number,
    assigneeFieldUserId: string,
    estimatedDurationMinutes: number | null,
  ) {
    const start = slotDateTime(day, hour);
    const deadline = defaultDeadlineFromStart(start);
    await create.mutateAsync({
      sourceApp: job.sourceApp,
      sourceType: job.sourceType,
      sourceId: job.id,
      title: job.label,
      assigneeFieldUserId,
      scheduledStartAt: start.toISOString(),
      ...(estimatedDurationMinutes === null ? {} : { estimatedDurationMinutes }),
      deadlineAt: deadline.toISOString(),
      status: 'planned',
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
    setExpandedDayKey(null);
    setBoardError(null);
    if (!isAdmin) return;

    const over = event.over;
    if (!over) return;

    const activeData = event.active.data.current as JobDragData | EventDragData | undefined;
    const overData = over.data.current as SlotDropData | StaffDropData | undefined;
    if (!activeData || !overData) return;

    try {
      if (activeData.type === 'job' && overData.type === 'slot') {
        const job = activeData.job;
        if (!schedulerSourceAppIsSelectable(selectableSourceApps, job.sourceApp)) return;
        setPendingAssign({ type: 'job', job, day: overData.day, hour: overData.hour });
        setPickAssignee(
          overData.assigneeFieldUserId
            ?? job.assigneeFieldUserId
            ?? staffFilter[0]
            ?? staff[0]?.fieldUserId
            ?? '',
        );
        return;
      }

      if (activeData.type === 'event' && overData.type === 'slot') {
        const scheduledEvent = activeData.event;
        setPendingAssign({
          type: 'event',
          event: scheduledEvent,
          day: overData.day,
          hour: overData.hour,
        });
        setPickAssignee(
          overData.assigneeFieldUserId
            ?? scheduledEvent.assigneeFieldUserId
            ?? staffFilter[0]
            ?? staff[0]?.fieldUserId
            ?? '',
        );
        return;
      }

      if (activeData.type === 'event' && overData.type === 'staff') {
        await update.mutateAsync({
          id: activeData.event.id,
          input: { assigneeFieldUserId: overData.fieldUserId },
        });
      }
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : 'Calendar update failed');
    }
  }

  function onDragStart(event: DragStartEvent) {
    const data = event.active.data.current as JobDragData | EventDragData | undefined;
    setActiveDrag(data ?? null);
  }

  function onDragOver(event: DragOverEvent) {
    const activeData = event.active.data.current as JobDragData | EventDragData | undefined;
    const overData = event.over?.data.current as SlotDropData | StaffDropData | undefined;
    if ((activeData?.type === 'job' || activeData?.type === 'event') && overData?.type === 'slot') {
      setExpandedDayKey(overData.dayKey);
    }
  }

  function showScheduledJob(job: JobOption) {
    const week = scheduledJobWeek(job);
    if (!week) return;
    setCursor(week);
    if (job.assigneeFieldUserId) setStaffFilter([job.assigneeFieldUserId]);
  }

  async function confirmPendingAssign(estimatedDurationMinutes: number | null) {
    if (!pendingAssign || !pickAssignee) return;
    setBoardError(null);
    try {
      if (pendingAssign.type === 'job') {
        await createFromJob(
          pendingAssign.job,
          pendingAssign.day,
          pendingAssign.hour,
          pickAssignee,
          estimatedDurationMinutes,
        );
      } else {
        const start = slotDateTime(pendingAssign.day, pendingAssign.hour);
        await update.mutateAsync({
          id: pendingAssign.event.id,
          input: {
            scheduledStartAt: start.toISOString(),
            assigneeFieldUserId: pickAssignee,
          },
        });
      }
      setPendingAssign(null);
    } catch (error) {
      setBoardError(error instanceof Error ? error.message : 'Could not assign job');
    }
  }

  if (eventsQuery.isLoading) return <Spinner label="Loading calendar…" />;
  if (eventsQuery.error) {
    return (
      <ErrorBanner
        message={(eventsQuery.error as Error).message || 'Calendar failed to load'}
      />
    );
  }

  const rangeLabel = `${days[0].toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })} – ${days[6].toLocaleDateString('en-AU', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;

  return (
    <div className="space-y-4">
      <section
        className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-xs)] sm:p-4"
        aria-label="Calendar controls"
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--primary-soft)] text-[var(--primary)]">
                <Icon name="calendar" size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">
                  Weekly schedule
                </p>
                <p className="truncate text-sm font-extrabold text-[var(--text)]" aria-live="polite">
                  {rangeLabel}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 sm:ml-2">
              <Button
                type="button"
                variant="secondary"
                className="!min-h-11 !px-3"
                aria-label="Previous week"
                onClick={() =>
                  setCursor((value) => {
                    const next = new Date(value);
                    next.setDate(next.getDate() - 7);
                    return startOfWeekMonday(next);
                  })
                }
              >
                <Icon name="chevron-right" size={17} className="rotate-180" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCursor(startOfWeekMonday(new Date()))}
              >
                Today
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="!min-h-11 !px-3"
                aria-label="Next week"
                onClick={() =>
                  setCursor((value) => {
                    const next = new Date(value);
                    next.setDate(next.getDate() + 7);
                    return startOfWeekMonday(next);
                  })
                }
              >
                <Icon name="chevron-right" size={17} />
              </Button>
            </div>
          </div>

          {isAdmin ? (
            <div className="flex flex-wrap items-center gap-2" aria-label="Calendar tools">
              <Button
                type="button"
                variant={staffPanelOpen ? 'primary' : 'secondary'}
                aria-expanded={staffPanelOpen}
                aria-controls="scheduler-staff-filter-panel"
                onClick={() => setStaffPanelOpen((open) => !open)}
              >
                <Icon name="users" size={17} />
                Staff{staffFilter.length > 0 ? ` (${staffFilter.length})` : ''}
                <Icon name="chevron-down" size={15} className={staffPanelOpen ? 'rotate-180' : ''} />
              </Button>
              <Button
                type="button"
                variant={jobsPanelOpen ? 'primary' : 'secondary'}
                aria-expanded={jobsPanelOpen}
                aria-controls="scheduler-jobs-pool-panel"
                onClick={() => setJobsPanelOpen((open) => !open)}
              >
                <Icon name="clipboard" size={17} />
                Jobs
                <Icon name="chevron-down" size={15} className={jobsPanelOpen ? 'rotate-180' : ''} />
              </Button>
            </div>
          ) : null}
        </div>

        <div className="mt-3 flex items-start gap-2 border-t border-[var(--border)] pt-3 text-xs leading-5 text-[var(--text-sub)]">
          <Icon name="lightbulb" size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <p>
            {isAdmin
              ? 'Open Jobs and drag work across the calendar. Hover a day to expand its technician lanes, then drop on the right person and time.'
              : 'View your scheduled work for the week. Select an event to review its full details.'}
          </p>
        </div>
      </section>

      {boardError ? <ErrorBanner message={boardError} /> : null}

      <DndContext
        id="scheduler-week-board"
        sensors={sensors}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={(event) => {
          void handleDragEnd(event);
        }}
        onDragCancel={() => {
          setActiveDrag(null);
          setExpandedDayKey(null);
        }}
      >
        {isAdmin && staffPanelOpen ? (
          <StaffFilterPanel
            enabled={isAdmin}
            selectedIds={staffFilter}
            onChange={setStaffFilter}
          />
        ) : null}

        <div className={`grid min-w-0 gap-3 ${jobsPanelOpen ? '2xl:grid-cols-[minmax(0,1fr)_18rem]' : ''}`}>
          {isAdmin && jobsPanelOpen ? (
            <JobsPoolPanel
              enabled={isAdmin}
              onScheduledJobClick={showScheduledJob}
              className="order-1 max-h-[30rem] 2xl:order-2 2xl:max-h-[calc(100vh-8rem)] 2xl:self-start"
            />
          ) : null}

          <WeekTimeGrid
            className="order-2 2xl:order-1"
            days={days}
            events={visibleEvents}
            staff={filteredStaff.length > 0 ? filteredStaff : staff}
            canDrag={isAdmin}
            expandedDayKey={expandedDayKey}
            onSlotClick={(day, hour) => {
              onSlotCreate(slotDateTime(day, hour));
            }}
            onEventClick={onEventEdit}
          />
        </div>

        <DragOverlay>
          {activeDrag?.type === 'job' ? (
            <div className="max-w-xs rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-md)]">
              <p className="text-xs font-extrabold text-[var(--text)]">{activeDrag.job.label}</p>
              <span
                className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-extrabold ${appChipClass(activeDrag.job.sourceApp)}`}
              >
                {SOURCE_APP_LABEL[activeDrag.job.sourceApp]}
              </span>
            </div>
          ) : null}
          {activeDrag?.type === 'event' ? (
            <div className="max-w-xs rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow-md)]">
              <p className="text-xs font-extrabold text-[var(--text)]">{activeDrag.event.title}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {pendingAssign ? (
        <AssignStaffDialog
          pendingAssign={pendingAssign}
          pickAssignee={pickAssignee}
          staff={staff}
          busy={create.isPending || update.isPending}
          onPickAssignee={setPickAssignee}
          onCancel={() => setPendingAssign(null)}
          onConfirm={(estimatedDurationMinutes) => {
            void confirmPendingAssign(estimatedDurationMinutes);
          }}
        />
      ) : null}
    </div>
  );
}

function AssignStaffDialog({
  pendingAssign,
  pickAssignee,
  staff,
  busy,
  onPickAssignee,
  onCancel,
  onConfirm,
}: {
  pendingAssign: PendingAssign;
  pickAssignee: string;
  staff: PortalDirectoryUser[];
  busy: boolean;
  onPickAssignee: (value: string) => void;
  onCancel: () => void;
  onConfirm: (estimatedDurationMinutes: number | null) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  const busyRef = useRef(busy);
  const [estimatedDurationMinutes, setEstimatedDurationMinutes] = useState('');
  const parsedEstimatedDurationMinutes = parseEstimatedDurationMinutes(estimatedDurationMinutes);
  const durationError = estimatedDurationError(estimatedDurationMinutes);
  const jobName = pendingAssign.type === 'job'
    ? pendingAssign.job.label
    : pendingAssign.event.title;
  const selectedPerson = staff.find((person) => person.fieldUserId === pickAssignee);
  const scheduledAt = slotDateTime(pendingAssign.day, pendingAssign.hour);
  const scheduledAtLabel = scheduledAt.toLocaleString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

  useEffect(() => {
    cancelRef.current = onCancel;
    busyRef.current = busy;
  }, [busy, onCancel]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLSelectElement>('select:not(:disabled)')?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) {
        event.preventDefault();
        cancelRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--overlay)] p-3 sm:items-center" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheduler-assign-title"
        aria-describedby="scheduler-assign-description"
        aria-busy={busy}
        className="w-full max-w-md rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-md)] sm:p-6"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--primary-soft)] text-[var(--primary)]">
            <Icon name="user" size={19} />
          </span>
          <div>
            <h3 id="scheduler-assign-title" className="text-base font-extrabold text-[var(--text)]">
              Confirm job assignment
            </h3>
            <p id="scheduler-assign-description" className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
              Check the technician, job, and date before this calendar change is saved.
            </p>
          </div>
        </div>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (parsedEstimatedDurationMinutes === undefined) return;
            onConfirm(parsedEstimatedDurationMinutes);
          }}
        >
          <div className="mt-4">
            <div className="mb-4 overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)]">
              <AssignmentSummaryRow label="Technician" value={selectedPerson?.label || 'Select a technician'} />
              <AssignmentSummaryRow label="Job" value={jobName} />
              <AssignmentSummaryRow label="Date & time" value={scheduledAtLabel} />
            </div>
            <FieldLabel htmlFor="scheduler-pending-assignee">Technician</FieldLabel>
            <Select
              id="scheduler-pending-assignee"
              value={pickAssignee}
              onChange={(event) => onPickAssignee(event.target.value)}
            >
              <option value="">Select…</option>
              {staff.map((person) => (
                <option key={person.fieldUserId} value={person.fieldUserId}>
                  {person.label}
                </option>
              ))}
            </Select>
            {pendingAssign.type === 'job' ? (
              <>
                <FieldLabel htmlFor="scheduler-pending-estimated-duration">
                  Estimated time to complete (minutes, optional)
                </FieldLabel>
                <Input
                  id="scheduler-pending-estimated-duration"
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
                    ? 'scheduler-pending-estimated-duration-error scheduler-pending-estimated-duration-hint'
                    : 'scheduler-pending-estimated-duration-hint'}
                />
                <FieldHint id="scheduler-pending-estimated-duration-hint">
                  Leave blank if the duration is not known. The calendar uses this estimate only for planning.
                </FieldHint>
                <FieldError
                  id="scheduler-pending-estimated-duration-error"
                  message={durationError ?? undefined}
                />
              </>
            ) : null}
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" disabled={busy} onClick={onCancel}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!pickAssignee || (pendingAssign.type === 'job' && parsedEstimatedDurationMinutes === undefined) || busy}
            >
              {busy ? 'Saving assignment…' : 'Confirm assignment'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AssignmentSummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-t border-[var(--border)] px-3 py-2.5 first:border-t-0 sm:grid-cols-[6.5rem_1fr] sm:items-start">
      <span className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">{label}</span>
      <span className="text-sm font-bold text-[var(--text)]">{value}</span>
    </div>
  );
}
