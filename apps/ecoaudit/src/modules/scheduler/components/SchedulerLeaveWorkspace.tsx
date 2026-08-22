'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { ApiError, cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, Spinner, StatCard } from '@/components/ui/Card';
import { FieldHint, FieldLabel, Input, Select, Textarea } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import {
  useCancelSchedulerLeaveRequest,
  useCreateSchedulerLeaveRequest,
  useReviewSchedulerLeaveRequest,
  useSchedulerLeaveRequests,
} from '@/modules/scheduler/hooks/useScheduler';
import type {
  SchedulerLeaveRequest,
  SchedulerLeaveStatus,
  SchedulerLeaveType,
} from '@/modules/scheduler/types/workforce';

const LEAVE_LABELS: Record<SchedulerLeaveType, string> = {
  annual: 'Annual leave',
  personal: 'Personal leave',
  unpaid: 'Unpaid leave',
  other: 'Other leave',
};

function todayKey(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function statusClass(status: SchedulerLeaveStatus): string {
  if (status === 'approved') return 'bg-[var(--green-soft)] text-[var(--green)]';
  if (status === 'rejected') return 'bg-[var(--red-soft)] text-[var(--red)]';
  if (status === 'cancelled') return 'bg-[var(--surface3)] text-[var(--muted)]';
  return 'bg-[var(--amber-soft)] text-[var(--amber)]';
}

function dateRangeLabel(request: SchedulerLeaveRequest): string {
  return request.startDate === request.endDate
    ? request.startDate
    : `${request.startDate} – ${request.endDate}`;
}

function leaveErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    const detail = error.detail ?? error.message;
    if (detail === 'leave_approval_schedule_conflict') {
      return 'This leave overlaps planned or in-progress work. Move or reassign those jobs before approving it.';
    }
    if (detail === 'leave_request_overlap') {
      return 'This user already has a pending or approved leave request that overlaps those dates.';
    }
    if (detail === 'leave_request_version_conflict') {
      return 'This request changed while you were viewing it. Refresh the list and try again.';
    }
  }
  if (
    error instanceof ApiError
    && error.status === 403
    && (error.detail ?? error.message) === 'leave_self_review_forbidden'
  ) {
    return 'Another administrator must approve or reject your leave request.';
  }
  return cloudConnectionErrorMessage(error);
}

export function SchedulerLeaveWorkspace({ isAdmin }: { isAdmin: boolean }) {
  const [leaveType, setLeaveType] = useState<SchedulerLeaveType>('annual');
  const [startDate, setStartDate] = useState(todayKey);
  const [endDate, setEndDate] = useState(todayKey);
  const [employeeNote, setEmployeeNote] = useState('');
  const [statusFilter, setStatusFilter] = useState<SchedulerLeaveStatus | ''>('');
  const [formError, setFormError] = useState<string | null>(null);
  const filters = useMemo(
    () => (statusFilter ? { status: statusFilter } : {}),
    [statusFilter],
  );
  const query = useSchedulerLeaveRequests(filters, isAdmin);
  const createLeave = useCreateSchedulerLeaveRequest();
  const reviewLeave = useReviewSchedulerLeaveRequest();
  const cancelLeave = useCancelSchedulerLeaveRequest();
  const requests = query.data ?? [];
  const pending = requests.filter((request) => request.status === 'pending').length;
  const approved = requests.filter((request) => request.status === 'approved').length;
  const actionPending = createLeave.isPending || reviewLeave.isPending || cancelLeave.isPending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    if (!startDate || !endDate || startDate > endDate) {
      setFormError('Choose a valid date range with the end date on or after the start date.');
      return;
    }
    try {
      await createLeave.mutateAsync({
        leaveType,
        startDate,
        endDate,
        employeeNote: employeeNote.trim() || null,
      });
      setEmployeeNote('');
    } catch (error) {
      setFormError(leaveErrorMessage(error));
    }
  }

  async function decide(request: SchedulerLeaveRequest, decision: 'approve' | 'reject') {
    setFormError(null);
    try {
      await reviewLeave.mutateAsync({
        id: request.id,
        input: { decision, expectedUpdatedAt: request.updatedAt },
      });
    } catch (error) {
      setFormError(leaveErrorMessage(error));
    }
  }

  async function cancel(request: SchedulerLeaveRequest) {
    setFormError(null);
    try {
      await cancelLeave.mutateAsync({
        id: request.id,
        expectedUpdatedAt: request.updatedAt,
        adminAction: isAdmin,
      });
    } catch (error) {
      setFormError(leaveErrorMessage(error));
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label={isAdmin ? 'Team requests' : 'My requests'} value={requests.length} icon="calendar" />
        <StatCard label="Awaiting approval" value={pending} icon="clipboard" tone="warning" />
        <StatCard label="Approved leave" value={approved} icon="check" tone="success" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(19rem,0.8fr)_minmax(0,1.7fr)]">
        <Card className="h-fit !p-4 sm:!p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="section-title">Apply for leave</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
                Approved dates block new Scheduler assignments automatically.
              </p>
            </div>
            <Icon name="calendar" size={20} className="shrink-0 text-[var(--primary)]" />
          </div>
          <form className="mt-3" onSubmit={submit}>
            <FieldLabel htmlFor="leave-type">Leave type</FieldLabel>
            <Select
              id="leave-type"
              value={leaveType}
              disabled={actionPending}
              onChange={(event) => setLeaveType(event.target.value as SchedulerLeaveType)}
            >
              {Object.entries(LEAVE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
            <div className="grid gap-x-3 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="leave-start">First day</FieldLabel>
                <Input id="leave-start" type="date" value={startDate} disabled={actionPending} onChange={(event) => setStartDate(event.target.value)} />
              </div>
              <div>
                <FieldLabel htmlFor="leave-end">Last day</FieldLabel>
                <Input id="leave-end" type="date" value={endDate} min={startDate} disabled={actionPending} onChange={(event) => setEndDate(event.target.value)} />
              </div>
            </div>
            <FieldLabel htmlFor="leave-note">Note (optional)</FieldLabel>
            <Textarea
              id="leave-note"
              value={employeeNote}
              maxLength={2000}
              disabled={actionPending}
              placeholder="Add context for the approver"
              onChange={(event) => setEmployeeNote(event.target.value)}
            />
            <FieldHint>The request uses your saved timezone and inclusive calendar dates.</FieldHint>
            <Button type="submit" className="mt-4 w-full" disabled={actionPending}>
              <Icon name="plus" size={17} />
              {createLeave.isPending ? 'Submitting…' : 'Submit request'}
            </Button>
          </form>
        </Card>

        <section aria-labelledby="leave-history-title">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 id="leave-history-title" className="section-title">
                {isAdmin ? 'Team leave requests' : 'My leave requests'}
              </h2>
              <p className="mt-1 text-sm text-[var(--text-sub)]">
                Dates are evaluated in the timezone captured when each request was made.
              </p>
            </div>
            <div className="w-full sm:w-52">
              <FieldLabel htmlFor="leave-status-filter" className="!mt-0">Status</FieldLabel>
              <Select id="leave-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as SchedulerLeaveStatus | '')}>
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </div>
          </div>

          {formError ? <div className="mb-3"><ErrorBanner message={formError} /></div> : null}
          {query.isLoading ? <Spinner label="Loading leave requests…" /> : null}
          {query.isError ? <ErrorBanner message={cloudConnectionErrorMessage(query.error)} /> : null}
          {!query.isLoading && !query.isError && requests.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="No leave requests in this view"
              description="New requests and approval decisions will appear here."
            />
          ) : null}
          <div className="space-y-3">
            {requests.map((request) => (
              <Card key={request.id} className="!p-4 sm:!p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-extrabold text-[var(--text)]">{request.userDisplayName}</h3>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.07em] ${statusClass(request.status)}`}>
                        {request.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-bold text-[var(--text)]">
                      {LEAVE_LABELS[request.leaveType]} · {dateRangeLabel(request)}
                    </p>
                    <p className="mt-1 text-xs text-[var(--text-sub)]">
                      {request.timezone}{isAdmin ? ` · ${request.userEmail}` : ''}
                    </p>
                    {request.employeeNote ? (
                      <p className="mt-3 rounded-[var(--radius-sm)] bg-[var(--surface2)] px-3 py-2 text-sm leading-6 text-[var(--text-sub)]">
                        {request.employeeNote}
                      </p>
                    ) : null}
                    {request.reviewerNote ? (
                      <p className="mt-2 text-xs leading-5 text-[var(--text-sub)]">Reviewer note: {request.reviewerNote}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 sm:max-w-56 sm:justify-end">
                    {isAdmin && request.status === 'pending' ? (
                      <>
                        <Button variant="secondary" disabled={actionPending} onClick={() => void decide(request, 'approve')}>Approve</Button>
                        <Button variant="ghost" disabled={actionPending} onClick={() => void decide(request, 'reject')}>Reject</Button>
                      </>
                    ) : null}
                    {request.status === 'pending' || request.status === 'approved' ? (
                      <Button variant="ghost" disabled={actionPending} onClick={() => void cancel(request)}>Cancel</Button>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
