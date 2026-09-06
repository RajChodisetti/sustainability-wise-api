'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader } from '@/components/ui/Card';
import { FieldHint, FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import {
  InstallHubApiError,
  installHubConnectionErrorMessage,
} from '@/modules/installhub/api/client';
import {
  useInstallHubRouteAddressSuggestions,
  useInstallHubRouteSuggestion,
} from '@/modules/installhub/hooks/useRoute';
import {
  installHubRouteDistance,
  installHubRouteDuration,
  installHubRouteLocationIsAustralian,
  installHubRouteOriginFromAddress,
} from '@/modules/installhub/lib/routing';
import type {
  InstallHubRouteAddressSuggestion,
  InstallHubRouteCurrentLocation,
  InstallHubRouteJob,
} from '@/modules/installhub/types/routing';

const EMPTY_START_SUGGESTIONS: InstallHubRouteAddressSuggestion[] = [];

function useDebouncedValue(value: string, delayMs = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

function currentDeviceLocation(): Promise<InstallHubRouteCurrentLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This browser does not provide location access. Choose an Australian starting address instead.'));
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
          ? 'Location permission was denied. Choose an Australian starting address or allow location access and try again.'
          : 'Your current location could not be read. Choose an Australian starting address or check location services and try again.',
      )),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}

function scheduledTimeLabel(job: InstallHubRouteJob, timezone: string): string {
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

function routeErrorMessage(error: unknown): string {
  if (error instanceof InstallHubApiError) {
    const detail = error.detail ?? error.message;
    if (/^Scheduler user not found$/i.test(detail)) {
      return 'Your account is not linked to an active Field user. Ask an administrator to review your Field account.';
    }
    if (/^Assignee not found$/i.test(detail)) {
      return 'Your Field user is inactive or unavailable. Ask an administrator to review your account.';
    }
  }
  return installHubConnectionErrorMessage(error);
}

export function InstallHubRoutePage() {
  const generatedId = useId().replaceAll(':', '');
  const [date, setDate] = useState('');
  const [originMode, setOriginMode] = useState<'current' | 'address'>('current');
  const [originQuery, setOriginQuery] = useState('');
  const [originOpen, setOriginOpen] = useState(false);
  const [selectedOrigin, setSelectedOrigin] = useState<InstallHubRouteAddressSuggestion | null>(null);
  const [submittedOriginLabel, setSubmittedOriginLabel] = useState('');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const route = useInstallHubRouteSuggestion();
  const debouncedOriginQuery = useDebouncedValue(originQuery.trim());
  const originSuggestions = useInstallHubRouteAddressSuggestions(
    debouncedOriginQuery,
    originMode === 'address',
  );
  const startSuggestions = originSuggestions.data?.suggestions ?? EMPTY_START_SUGGESTIONS;

  function resetResult() {
    route.reset();
    setError(null);
    setSubmittedOriginLabel('');
  }

  async function planRoute() {
    setError(null);
    route.reset();
    setLocating(true);
    try {
      let routeOrigin:
        | { currentLocation: InstallHubRouteCurrentLocation }
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
        routeOrigin = installHubRouteOriginFromAddress(startingAddress, selectedOrigin)!;
        originLabel = selectedOrigin?.label === startingAddress
          ? selectedOrigin.label
          : startingAddress;
      } else {
        let currentLocation: InstallHubRouteCurrentLocation;
        try {
          currentLocation = await currentDeviceLocation();
        } catch (caught) {
          setOriginMode('address');
          throw caught;
        }
        if (!installHubRouteLocationIsAustralian(currentLocation)) {
          setOriginMode('address');
          throw new Error(
            'Your current location is outside Australia. Choose an Australian starting address to plan the route.',
          );
        }
        routeOrigin = { currentLocation };
        originLabel = 'Current device location';
      }
      await route.mutateAsync({ date, ...routeOrigin });
      setSubmittedOriginLabel(originLabel);
    } catch (caught) {
      setError(routeErrorMessage(caught));
    } finally {
      setLocating(false);
    }
  }

  const result = route.data;
  const busy = locating || route.isPending;
  const originInputId = `installhub-route-origin-${generatedId}`;
  const originListboxId = `${originInputId}-suggestions`;

  return (
    <div className="mx-auto w-full max-w-[96rem]">
      <PageHeader
        title="Route planner"
        subtitle="Order your assigned Australian Field jobs for the day with travel-time estimates."
      />

      <div className="space-y-5">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="installhub-route-date" className="!mt-0">Work date</FieldLabel>
              <Input
                id="installhub-route-date"
                type="date"
                value={date}
                disabled={busy}
                onChange={(event) => {
                  setDate(event.target.value);
                  resetResult();
                }}
              />
            </div>
            <div>
              <FieldLabel htmlFor="installhub-route-origin-mode" className="!mt-0">Starting point</FieldLabel>
              <Select
                id="installhub-route-origin-mode"
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
                <FieldHint>Suggestions are temporarily unavailable. You can still enter a complete Australian address.</FieldHint>
              ) : null}
              {originSuggestions.data?.available === false ? (
                <FieldHint>Address geocoding is not configured, so an administrator must enable it before entered addresses can be planned.</FieldHint>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 flex justify-end">
            <Button
              onClick={() => void planRoute()}
              disabled={
                busy
                || !date
                || (
                  originMode === 'address'
                  && (originQuery.trim().length < 3 || originQuery.trim().length > 300)
                )
              }
            >
              <Icon name="map-pin" size={18} />
              {busy ? 'Planning route…' : 'Plan route'}
            </Button>
          </div>
          <FieldHint>
            Your saved timezone defines the work date.
            {' '}The entered address or starting coordinates are used only for this calculation and are not saved as attendance, location, or route history.
            {' '}This planner returns stop order and travel estimates only; it does not provide maps or navigation.
          </FieldHint>
        </Card>

        {error ? <ErrorBanner message={error} /> : null}

        {!result && !error ? (
          <EmptyState
            icon="map-pin"
            title="Ready to plan your day"
            description="Choose a date and starting point to order your assigned Field App jobs."
          />
        ) : null}

        {result ? (
          <>
            <Card>
              <p className="text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--text-sub)]">
                Suggested route · {result.date}
              </p>
              <h2 className="mt-1 text-xl font-extrabold tracking-[-0.025em] text-[var(--text)]">
                {result.jobs.length} routable job{result.jobs.length === 1 ? '' : 's'}
              </h2>
              <p className="mt-1 text-sm text-[var(--text-sub)]">
                {installHubRouteDistance(result.totalDistanceMeters)} · approximately {installHubRouteDuration(result.totalDurationSeconds)} driving
              </p>
              <p className="mt-1 text-xs font-bold text-[var(--text-sub)]">
                Starting from {submittedOriginLabel || 'the selected point'}
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Times use {result.timezone}.{' '}
                {!result.jobs.length
                  ? 'No travel estimates are needed for an empty route.'
                  : result.optimization === 'road_duration'
                  ? 'Ordered using road travel-time estimates.'
                  : 'Road routing is unavailable, so this order uses straight-line estimates.'}
                {' '}These suggestions do not change your schedule.
              </p>
              {result.optimization === 'road_duration' ? (
                <p className="mt-1 text-[10px] text-[var(--muted)]">
                  Routing data: <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
                </p>
              ) : null}
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
                          <h3 className="font-extrabold text-[var(--text)]">{job.title}</h3>
                          <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">{job.address}</p>
                          <p className="mt-1 text-xs font-bold text-[var(--text-sub)]">
                            Scheduled {scheduledTimeLabel(job, result.timezone)}
                          </p>
                          <p className="mt-2 text-xs font-bold text-[var(--muted)]">
                            From previous stop: {installHubRouteDistance(job.travelDistanceMeters)} · {installHubRouteDuration(job.travelDurationSeconds)}
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
    </div>
  );
}
