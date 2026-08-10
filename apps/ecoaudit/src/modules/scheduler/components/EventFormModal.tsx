'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ErrorBanner } from '@/components/ui/Card';
import { FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { cloudConnectionErrorMessage } from '@/api/client';
import {
  useCancelScheduleEvent,
  useCreateScheduleEvent,
  useJobOptions,
  usePortalAssignees,
  useUpdateScheduleEvent,
} from '@/modules/scheduler/hooks/useScheduler';
import {
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from '@/modules/scheduler/lib/deadline';
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
};

const appOptions: Array<{ value: ScheduleSourceApp; label: string }> = [
  { value: 'custom', label: 'Custom job' },
  { value: 'ecoaudit', label: 'Eco Audit' },
  { value: 'solarsense', label: 'Solar Sense' },
  { value: 'installhub', label: 'Field App installation' },
];

function defaultTypeForApp(app: ScheduleSourceApp): ScheduleSourceType {
  if (app === 'ecoaudit') return 'audit';
  if (app === 'installhub') return 'installation';
  if (app === 'solarsense') return 'site';
  return 'custom';
}

export function EventFormModal({ open, onClose, initialDay, event, isAdmin }: Props) {
  const create = useCreateScheduleEvent();
  const update = useUpdateScheduleEvent();
  const cancel = useCancelScheduleEvent();
  const assignees = usePortalAssignees(open && isAdmin);
  const editing = Boolean(event);

  const [sourceApp, setSourceApp] = useState<ScheduleSourceApp>('custom');
  const [sourceType, setSourceType] = useState<ScheduleSourceType>('custom');
  const [sourceId, setSourceId] = useState('');
  const [jobQuery, setJobQuery] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeFieldUserId, setAssigneeFieldUserId] = useState('');
  const [startLocal, setStartLocal] = useState('');
  const [endLocal, setEndLocal] = useState('');
  const [deadlineLocal, setDeadlineLocal] = useState('');
  const [status, setStatus] = useState<ScheduleStatus>('planned');
  const [error, setError] = useState<string | null>(null);

  const jobs = useJobOptions(
    jobQuery,
    sourceApp === 'custom' ? undefined : sourceApp,
    open && isAdmin && sourceApp !== 'custom',
  );

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (event) {
      setSourceApp(event.sourceApp);
      setSourceType(event.sourceType);
      setSourceId(event.sourceId ?? '');
      setTitle(event.title);
      setDescription(event.description ?? '');
      setAssigneeFieldUserId(event.assigneeFieldUserId);
      setStartLocal(toDatetimeLocalValue(event.scheduledStartAt));
      setEndLocal(event.scheduledEndAt ? toDatetimeLocalValue(event.scheduledEndAt) : '');
      setDeadlineLocal(toDatetimeLocalValue(event.deadlineAt));
      setStatus(event.status);
      setJobQuery('');
      return;
    }
    const day = initialDay ?? new Date();
    const start = new Date(day);
    if (!initialDay) start.setMinutes(0, 0, 0);
    else start.setHours(9, 0, 0, 0);
    const deadline = new Date(start);
    deadline.setDate(deadline.getDate() + 2);
    deadline.setHours(17, 0, 0, 0);
    setSourceApp('custom');
    setSourceType('custom');
    setSourceId('');
    setTitle('');
    setDescription('');
    setAssigneeFieldUserId('');
    setStartLocal(toDatetimeLocalValue(start.toISOString()));
    setEndLocal('');
    setDeadlineLocal(toDatetimeLocalValue(deadline.toISOString()));
    setStatus('planned');
    setJobQuery('');
  }, [open, event, initialDay]);

  const canSubmit = useMemo(() => {
    if (!isAdmin) return false;
    if (!assigneeFieldUserId || !startLocal || !deadlineLocal) return false;
    if (sourceApp === 'custom') return Boolean(title.trim());
    return Boolean(sourceId);
  }, [isAdmin, assigneeFieldUserId, startLocal, deadlineLocal, sourceApp, title, sourceId]);

  if (!open) return null;

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

  const busy = create.isPending || update.isPending || cancel.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheduler-event-title"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl sm:p-6"
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
                <FieldLabel>App / type</FieldLabel>
                <Select
                  value={sourceApp}
                  onChange={(e) => {
                    const app = e.target.value as ScheduleSourceApp;
                    setSourceApp(app);
                    setSourceType(defaultTypeForApp(app));
                    setSourceId('');
                    setTitle('');
                  }}
                >
                  {appOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>

                {sourceApp === 'solarsense' ? (
                  <>
                    <FieldLabel>Solar item type</FieldLabel>
                    <Select
                      value={sourceType}
                      onChange={(e) => {
                        setSourceType(e.target.value as ScheduleSourceType);
                        setSourceId('');
                      }}
                    >
                      <option value="site">Site</option>
                      <option value="assessment">Rooftop assessment</option>
                    </Select>
                  </>
                ) : null}

                {sourceApp !== 'custom' ? (
                  <>
                    <FieldLabel>Search linked job</FieldLabel>
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
                          className={`block w-full rounded-lg px-2.5 py-2 text-left text-sm ${
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
                        <p className="px-2 py-1 text-xs text-[var(--text-sub)]">Searching…</p>
                      ) : null}
                      {!jobs.isLoading && (jobs.data?.length ?? 0) === 0 ? (
                        <p className="px-2 py-1 text-xs text-[var(--text-sub)]">No matching jobs.</p>
                      ) : null}
                    </div>
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
            >
              <option value="">Select user…</option>
              {(assignees.data ?? []).map((u) => (
                <option key={u.fieldUserId} value={u.fieldUserId}>
                  {u.label} ({u.email})
                </option>
              ))}
            </Select>
            {assignees.error ? (
              <p className="mt-1 text-xs text-[var(--red)]">
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
          </div>
        )}

        {error ? <div className="mt-4"><ErrorBanner message={error} /></div> : null}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
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
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create'}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
