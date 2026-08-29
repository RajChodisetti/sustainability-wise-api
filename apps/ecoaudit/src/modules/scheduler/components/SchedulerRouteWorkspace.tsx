'use client';

import { useEffect, useId, useState } from 'react';
import { ApiError, cloudConnectionErrorMessage } from '@/api/client';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner } from '@/components/ui/Card';
import { FieldHint, FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import {
  usePortalAssignees,
  useSchedulerAddressSuggestions,
  useSchedulerRouteSuggestion,
} from '@/modules/scheduler/hooks/useScheduler';
import {
  schedulerRouteDistance,
  schedulerRouteDuration,
  schedulerRouteJobTypeLabel,
  schedulerRouteLocationIsAustralian,
  schedulerRouteOriginFromAddress,
} from '@/modules/scheduler/lib/routing';
import type {
  SchedulerAddressSuggestion,
  SchedulerCurrentLocation,
  SchedulerRouteJob,
} from '@/modules/scheduler/types/routing';

const EMPTY_START_SUGGESTIONS: SchedulerAddressSuggestion[] = [];

function useDebouncedValue(value: string, delayMs = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

function currentBrowserLocation(): Promise<SchedulerCurrentLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser does not provide location access.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        capturedAt: new Date(position.timestamp).toISOString(),
      }),
      (error) => reject(new Error(
        error.code === error.PERMISSION_DENIED
          ? 'Location permission was denied. Allow location access and try again.'
          : 'Your current location could not be read. Check location services and try again.',
      )),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}

function scheduledTimeLabel(job: SchedulerRouteJob, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  });
  const start = formatter.format(new Date(job.scheduledStartAt));
  const end = job.scheduledEndAt
    ? formatter.format(new Date(job.scheduledEndAt))
    : null;
  return end ? `${start}–${end}` : start;
}

export function SchedulerRouteWorkspace({ isAdmin }: { isAdmin: boolean }) {
  const generatedId = useId().replaceAll(':', '');
  const [date, setDate] = useState('');
  const [assigneeFieldUserId, setAssigneeFieldUserId] = useState('');
  const [originMode, setOriginMode] = useState<'current' | 'address'>('current');
  const [originQuery, setOriginQuery] = useState('');
  const [originOpen, setOriginOpen] = useState(false);
  const [selectedOrigin, setSelectedOrigin] = useState<SchedulerAddressSuggestion | null>(null);
  const [submittedOriginLabel, setSubmittedOriginLabel] = useState('');
  const [submittedAssigneeLabel, setSubmittedAssigneeLabel] = useState('');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const route = useSchedulerRouteSuggestion();
  const assignees = usePortalAssignees(isAdmin);
  const debouncedOriginQuery = useDebouncedValue(originQuery.trim());
  const originSuggestions = useSchedulerAddressSuggestions(
    { query: debouncedOriginQuery },
    originMode === 'address',
  );
  const startSuggestions = originSuggestions.data?.suggestions ?? EMPTY_START_SUGGESTIONS;

  function resetResult() {
    route.reset();
    setError(null);
    setSubmittedOriginLabel('');
    setSubmittedAssigneeLabel('');
  }

  async function suggestRoute() {
    setError(null);
    route.reset();
    setLocating(true);
    try {
      let routeOrigin:
        | { currentLocation: SchedulerCurrentLocation }
        | { startingAddress: string };
      let originLabel: string;
      if (originMode === 'address') {
        const startingAddress = originQuery.trim();
        if (startingAddress.length < 3) {
          throw new Error('Enter an Australian starting address before planning the route.');
        }
        if (startingAddress.length > 300) {
          throw new Error('The Australian starting address must be 300 characters or fewer.');
        }
        routeOrigin = schedulerRouteOriginFromAddress(startingAddress, selectedOrigin)!;
        originLabel = selectedOrigin?.label === startingAddress
          ? selectedOrigin.label
          : startingAddress;
      } else {
        let currentLocation: SchedulerCurrentLocation;
        try {
          currentLocation = await currentBrowserLocation();
        } catch (caught) {
          setOriginMode('address');
          throw caught;
        }
        if (!schedulerRouteLocationIsAustralian(currentLocation)) {
          setOriginMode('address');
          throw new Error(
            'Your current location is outside Australia. Choose an Australian starting address to preview the route.',
          );
        }
        routeOrigin = { currentLocation };
        originLabel = 'Current device location';
      }
      if (isAdmin && !assigneeFieldUserId) {
        throw new Error('Choose a technician before planning the route.');
      }
      await route.mutateAsync({
        date,
        ...routeOrigin,
        assigneeFieldUserId: isAdmin ? assigneeFieldUserId : undefined,
      });
      setSubmittedOriginLabel(originLabel);
      setSubmittedAssigneeLabel(
        isAdmin
          ? assignees.data?.find((user) => user.fieldUserId === assigneeFieldUserId)?.label ?? ''
          : '',
      );
    } catch (caught) {
      const apiDetail = caught instanceof ApiError ? caught.detail ?? caught.message : '';
      if (caught instanceof ApiError && /^Scheduler user not found$/i.test(apiDetail)) {
        setError(
          'This account is not linked to an active Field user. Ask an administrator to review the Scheduler user record.',
        );
      } else if (caught instanceof ApiError && /^Assignee not found$/i.test(apiDetail)) {
        setError(
          'The selected technician is not linked to an active Field user. Choose another technician or review that user record.',
        );
      } else {
        setError(caught instanceof ApiError ? apiDetail : cloudConnectionErrorMessage(caught));
      }
    } finally {
      setLocating(false);
    }
  }

  const result = route.data;
  const busy = locating || route.isPending;
  const originInputId = `scheduler-route-origin-${generatedId}`;
  const originListboxId = `${originInputId}-suggestions`;

  return (
    <div className="space-y-5">
      <Card>
        <div className={`grid gap-4 ${isAdmin ? 'lg:grid-cols-3' : 'sm:grid-cols-2'}`}>
          <div>
            <FieldLabel htmlFor="scheduler-route-date" className="!mt-0">Work date</FieldLabel>
            <Input
              id="scheduler-route-date"
              type="date"
              value={date}
              disabled={busy}
              onChange={(event) => {
                setDate(event.target.value);
                resetResult();
              }}
            />
          </div>
          {isAdmin ? (
            <div>
              <FieldLabel htmlFor="scheduler-route-assignee" className="!mt-0">Technician</FieldLabel>
              <Select
                id="scheduler-route-assignee"
                value={assigneeFieldUserId}
                disabled={busy || assignees.isLoading}
                onChange={(event) => {
                  setAssigneeFieldUserId(event.target.value);
                  resetResult();
                }}
              >
                <option value="">Select technician</option>
                {(assignees.data ?? []).map((user) => (
                  <option key={user.key} value={user.fieldUserId}>
                    {user.label}{user.email ? ` · ${user.email}` : ''}
                  </option>
                ))}
              </Select>
              {assignees.isError ? (
                <FieldHint>Technicians could not be loaded. Refresh the page and try again.</FieldHint>
              ) : null}
            </div>
          ) : null}
          <div>
            <FieldLabel htmlFor="scheduler-route-origin-mode" className="!mt-0">Starting point</FieldLabel>
            <Select
              id="scheduler-route-origin-mode"
              value={originMode}
              disabled={busy}
              onChange={(event) => {
                setOriginMode(event.target.value as 'current' | 'address');
                resetResult();
              }}
            >
              <option value="current">Current device location</option>
              <option value="address">Australian address</option>
            </Select>
          </div>
        </div>

        {originMode === 'address' ? (
          <div className="mt-4">
            <FieldLabel htmlFor={originInputId}>Australian starting address</FieldLabel>
            <div className="relative">
              <Input
                id={originInputId}
                value={originQuery}
                disabled={busy}
                maxLength={300}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={originOpen && startSuggestions.length > 0}
                aria-controls={originListboxId}
                aria-busy={originSuggestions.isFetching}
                autoComplete="street-address"
                placeholder="Start typing an Australian address"
                onFocus={() => setOriginOpen(true)}
                onBlur={() => window.setTimeout(() => setOriginOpen(false), 120)}
                onChange={(event) => {
                  setOriginQuery(event.target.value);
                  setSelectedOrigin(null);
                  setOriginOpen(true);
                  resetResult();
                }}
              />
              {originOpen && startSuggestions.length > 0 ? (
                <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-[var(--border-strong)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-md)]">
                  <div id={originListboxId} role="listbox" aria-label="Australian starting-address suggestions">
                    {startSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.id}
                        type="button"
                        role="option"
                        aria-selected={selectedOrigin?.id === suggestion.id}
                        className="block w-full rounded-lg px-3 py-2.5 text-left text-sm leading-5 text-[var(--text)] hover:bg-[var(--surface2)]"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setSelectedOrigin(suggestion);
                          setOriginQuery(suggestion.label);
                          setOriginOpen(false);
                          resetResult();
                        }}
                      >
                        {suggestion.label}
                      </button>
                    ))}
                  </div>
                  {originSuggestions.data?.attribution ? (
                    <p className="px-3 py-1 text-[10px] text-[var(--muted)]">
                      {originSuggestions.data.attribution}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            {originSuggestions.isFetching ? <FieldHint>Searching Australian addresses…</FieldHint> : null}
            {originSuggestions.isError ? (
              <FieldHint>
                Suggestions are temporarily unavailable. You can still enter a complete Australian address.
              </FieldHint>
            ) : null}
            {originSuggestions.data?.available === false ? (
              <FieldHint>
                Address geocoding is not configured, so an administrator must enable it before entered addresses can be planned.
              </FieldHint>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex justify-end">
          <Button
            onClick={() => void suggestRoute()}
            disabled={
              busy
              || !date
              || (isAdmin && !assigneeFieldUserId)
              || (
                originMode === 'address'
                && (originQuery.trim().length < 3 || originQuery.trim().length > 300)
              )
            }
          >
            <Icon name="map-pin" size={18} />
            {busy ? 'Finding route…' : 'Plan route'}
          </Button>
        </div>
        <FieldHint>
          The selected technician’s saved timezone defines the work date.
          {' '}The entered address or starting coordinates are used only for this calculation and are not saved as attendance, location, or route history.
          {' '}This planner returns stop order and travel estimates only; it does not provide maps or navigation.
        </FieldHint>
      </Card>

      {error ? <ErrorBanner message={error} /> : null}

      {!result && !error ? (
        <EmptyState
          icon="map-pin"
          title="Ready to plan the day"
          description="Choose a date and starting point to order the day's Field App jobs. Administrators also choose the technician."
        />
      ) : null}

      {result ? (
        <>
          <Card>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--text-sub)]">
                  Suggested route · {result.date}
                </p>
                <h2 className="mt-1 text-xl font-extrabold tracking-[-0.025em] text-[var(--text)]">
                  {result.jobs.length} routable job{result.jobs.length === 1 ? '' : 's'}
                </h2>
                <p className="mt-1 text-sm text-[var(--text-sub)]">
                  {schedulerRouteDistance(result.totalDistanceMeters)} · approximately {schedulerRouteDuration(result.totalDurationSeconds)} driving
                </p>
                <p className="mt-1 text-xs font-bold text-[var(--text-sub)]">
                  {submittedAssigneeLabel ? `${submittedAssigneeLabel} · ` : ''}Starting from {submittedOriginLabel || 'the selected point'}
                </p>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Times use {result.timezone}.{' '}
                  {result.optimization === 'road_duration'
                    ? 'Ordered using road travel-time estimates.'
                    : 'Road routing is unavailable, so this order uses straight-line estimates.'}
                  {' '}Times remain suggestions and do not change the schedule.
                </p>
                {result.optimization === 'road_duration' ? (
                  <p className="mt-1 text-[10px] text-[var(--muted)]">
                    Routing data: <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
                  </p>
                ) : null}
              </div>
            </div>
          </Card>

          {result.warnings.length > 0 ? (
            <div className="rounded-xl border border-[var(--amber)]/30 bg-[var(--amber-soft)] px-4 py-3 text-sm leading-6 text-[var(--text)]" role="status">
              <p className="font-extrabold">Route checks</p>
              <ul className="mt-1 list-disc pl-5">
                {result.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          ) : null}

          {result.jobs.length > 0 ? (
            <ol className="space-y-3" aria-label="Suggested job order">
              {result.jobs.map((job) => (
                <li key={job.eventId}>
                  <Card className="!p-4 sm:!p-5">
                    <div className="flex items-start gap-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--primary)] text-sm font-extrabold text-[var(--primary-fg)]">
                        {job.sequence}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <h3 className="font-extrabold text-[var(--text)]">{job.title}</h3>
                          <span className="rounded-full bg-[var(--surface2)] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] text-[var(--text-sub)]">
                            {schedulerRouteJobTypeLabel(job.sourceApp)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">{job.address}</p>
                        <p className="mt-1 text-xs font-bold text-[var(--text-sub)]">
                          Scheduled {scheduledTimeLabel(job, result.timezone)}
                        </p>
                        <p className="mt-2 text-xs font-bold text-[var(--muted)]">
                          From previous stop: {schedulerRouteDistance(job.travelDistanceMeters)} · {schedulerRouteDuration(job.travelDurationSeconds)}
                        </p>
                      </div>
                    </div>
                  </Card>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState
              icon="map-pin"
              title="No routable jobs for this date"
              description="Only active assigned jobs with an Australian destination can be included."
            />
          )}

          {result.unroutableJobs.length > 0 ? (
            <Card>
              <h2 className="font-extrabold text-[var(--text)]">Jobs needing an address check</h2>
              <p className="mt-1 text-sm text-[var(--text-sub)]">
                These jobs are never silently omitted from the result.
              </p>
              <ul className="mt-3 divide-y divide-[var(--border)]">
                {result.unroutableJobs.map((job) => (
                  <li key={job.eventId} className="py-3 first:pt-0 last:pb-0">
                    <p className="text-sm font-bold text-[var(--text)]">{job.title}</p>
                    <p className="mt-0.5 text-xs text-[var(--text-sub)]">
                      {job.address || 'No destination saved'} · {job.reason}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
