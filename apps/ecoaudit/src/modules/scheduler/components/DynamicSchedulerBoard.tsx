'use client';

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorBanner, Spinner } from '@/components/ui/Card';
import { FieldLabel, Select } from '@/components/ui/FormFields';
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
  dayKey,
  defaultDeadlineFromStart,
  defaultEndFromStart,
  durationMs,
  slotDateTime,
  startOfWeekMonday,
  weekDays,
} from '@/modules/scheduler/lib/weekGrid';
import type { JobOption, ScheduleEvent } from '@/modules/scheduler/types/domain';

type PendingAssign = {
  job: JobOption;
  day: Date;
  hour: number;
};

export function DynamicSchedulerBoard({
  isAdmin,
  onSlotCreate,
  onEventEdit,
}: {
  isAdmin: boolean;
  onSlotCreate: (day: Date) => void;
  onEventEdit: (event: ScheduleEvent) => void;
}) {
  const [cursor, setCursor] = useState(() => startOfWeekMonday(new Date()));
  const [staffFilter, setStaffFilter] = useState<string[]>([]);
  const [activeDrag, setActiveDrag] = useState<JobDragData | EventDragData | null>(null);
  const [pendingAssign, setPendingAssign] = useState<PendingAssign | null>(null);
  const [pickAssignee, setPickAssignee] = useState('');
  const [boardError, setBoardError] = useState<string | null>(null);

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
  );

  const staff = useMemo(() => assignees.data ?? [], [assignees.data]);
  const allEvents = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const visibleEvents = useMemo(() => {
    if (staffFilter.length === 0) return allEvents;
    return allEvents.filter((e) => staffFilter.includes(e.assigneeFieldUserId));
  }, [allEvents, staffFilter]);

  const filteredStaff = useMemo(() => {
    if (staffFilter.length === 0) return staff;
    return staff.filter((s) => staffFilter.includes(s.fieldUserId));
  }, [staff, staffFilter]);

  async function createFromJob(job: JobOption, day: Date, hour: number, assigneeFieldUserId: string) {
    const start = slotDateTime(day, hour);
    const end = defaultEndFromStart(start);
    const deadline = defaultDeadlineFromStart(start);
    await create.mutateAsync({
      sourceApp: job.sourceApp,
      sourceType: job.sourceType,
      sourceId: job.id,
      title: job.label,
      assigneeFieldUserId,
      scheduledStartAt: start.toISOString(),
      scheduledEndAt: end.toISOString(),
      deadlineAt: deadline.toISOString(),
      status: 'planned',
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveDrag(null);
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
        if (staffFilter.length === 1) {
          await createFromJob(job, overData.day, overData.hour, staffFilter[0]);
          return;
        }
        setPendingAssign({ job, day: overData.day, hour: overData.hour });
        setPickAssignee(staffFilter[0] ?? staff[0]?.fieldUserId ?? '');
        return;
      }

      if (activeData.type === 'event' && overData.type === 'slot') {
        const ev = activeData.event;
        const start = slotDateTime(overData.day, overData.hour);
        const dur = durationMs(ev.scheduledStartAt, ev.scheduledEndAt);
        const end = new Date(start.getTime() + dur);
        await update.mutateAsync({
          id: ev.id,
          input: {
            scheduledStartAt: start.toISOString(),
            scheduledEndAt: end.toISOString(),
          },
        });
        return;
      }

      if (activeData.type === 'event' && overData.type === 'staff') {
        await update.mutateAsync({
          id: activeData.event.id,
          input: { assigneeFieldUserId: overData.fieldUserId },
        });
      }
    } catch (err) {
      setBoardError(err instanceof Error ? err.message : 'Calendar update failed');
    }
  }

  function onDragStart(e: DragStartEvent) {
    const data = e.active.data.current as JobDragData | EventDragData | undefined;
    setActiveDrag(data ?? null);
  }

  async function confirmPendingAssign() {
    if (!pendingAssign || !pickAssignee) return;
    setBoardError(null);
    try {
      await createFromJob(
        pendingAssign.job,
        pendingAssign.day,
        pendingAssign.hour,
        pickAssignee,
      );
      setPendingAssign(null);
    } catch (err) {
      setBoardError(err instanceof Error ? err.message : 'Could not assign job');
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

  const rangeLabel = `${days[0].toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })} – ${days[6].toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setCursor((c) => {
                const n = new Date(c);
                n.setDate(n.getDate() - 7);
                return startOfWeekMonday(n);
              })
            }
          >
            ‹
          </Button>
          <p className="min-w-[14rem] text-center text-sm font-extrabold text-[var(--text)]">
            {rangeLabel}
          </p>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setCursor((c) => {
                const n = new Date(c);
                n.setDate(n.getDate() + 7);
                return startOfWeekMonday(n);
              })
            }
          >
            ›
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setCursor(startOfWeekMonday(new Date()))}
          >
            Today
          </Button>
        </div>
        <p className="text-xs font-semibold text-[var(--text-sub)]">
          Week · drag jobs onto hours{isAdmin ? '' : ' (view only)'}
        </p>
      </div>

      {boardError ? <ErrorBanner message={boardError} /> : null}

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={(e) => {
          void handleDragEnd(e);
        }}
        onDragCancel={() => setActiveDrag(null)}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
          {isAdmin ? (
            <StaffFilterPanel
              enabled={isAdmin}
              selectedIds={staffFilter}
              onChange={setStaffFilter}
            />
          ) : null}

          <WeekTimeGrid
            days={days}
            events={visibleEvents}
            staff={filteredStaff.length > 0 ? filteredStaff : staff}
            canDrag={isAdmin}
            onSlotClick={(day, hour) => {
              const d = slotDateTime(day, hour);
              onSlotCreate(d);
            }}
            onEventClick={onEventEdit}
          />

          {isAdmin ? <JobsPoolPanel enabled={isAdmin} /> : null}
        </div>

        <DragOverlay>
          {activeDrag?.type === 'job' ? (
            <div className="max-w-xs rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
              <p className="text-xs font-extrabold text-[var(--text)]">{activeDrag.job.label}</p>
              <span
                className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-extrabold ${appChipClass(activeDrag.job.sourceApp)}`}
              >
                {SOURCE_APP_LABEL[activeDrag.job.sourceApp]}
              </span>
            </div>
          ) : null}
          {activeDrag?.type === 'event' ? (
            <div className="max-w-xs rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
              <p className="text-xs font-extrabold text-[var(--text)]">{activeDrag.event.title}</p>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {pendingAssign ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl">
            <h3 className="text-base font-extrabold text-[var(--text)]">Assign staff</h3>
            <p className="mt-1 text-sm text-[var(--text-sub)]">
              Schedule <span className="font-bold text-[var(--text)]">{pendingAssign.job.label}</span>{' '}
              on {dayKey(pendingAssign.day)} at {pendingAssign.hour}:00
            </p>
            <div className="mt-4">
              <FieldLabel>Assignee</FieldLabel>
              <Select
                value={pickAssignee}
                onChange={(e) => setPickAssignee(e.target.value)}
              >
                <option value="">Select…</option>
                {staff.map((u) => (
                  <option key={u.fieldUserId} value={u.fieldUserId}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPendingAssign(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={!pickAssignee || create.isPending}
                onClick={() => {
                  void confirmPendingAssign();
                }}
              >
                {create.isPending ? 'Scheduling…' : 'Schedule'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
