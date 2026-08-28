'use client';

import { useState } from 'react';
import { ApiError, cloudConnectionErrorMessage } from '@/api/client';
import { Button, buttonClassName } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner } from '@/components/ui/Card';
import { FieldHint, FieldLabel, Input } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { useSchedulerRouteSuggestion } from '@/modules/scheduler/hooks/useScheduler';
import {
  schedulerRouteDistance,
  schedulerRouteDuration,
  schedulerRouteJobTypeLabel,
} from '@/modules/scheduler/lib/routing';
import type {
  SchedulerCurrentLocation,
  SchedulerRouteJob,
} from '@/modules/scheduler/types/routing';

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

export function SchedulerRouteWorkspace() {
  const [date, setDate] = useState('');
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const route = useSchedulerRouteSuggestion();

  async function suggestRoute() {
    setError(null);
    route.reset();
    setLocating(true);
    try {
      const currentLocation = await currentBrowserLocation();
      await route.mutateAsync({
        date,
        currentLocation,
      });
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.detail ?? caught.message
          : cloudConnectionErrorMessage(caught),
      );
    } finally {
      setLocating(false);
    }
  }

  const result = route.data;
  const busy = locating || route.isPending;

  return (
    <div className="space-y-5">
      <Card>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <div>
            <FieldLabel htmlFor="scheduler-route-date" className="!mt-0">Work date</FieldLabel>
            <Input
              id="scheduler-route-date"
              type="date"
              value={date}
              disabled={busy}
              onChange={(event) => {
                setDate(event.target.value);
                route.reset();
                setError(null);
              }}
            />
          </div>
          <Button onClick={() => void suggestRoute()} disabled={busy || !date}>
            <Icon name="map-pin" size={18} />
            {busy ? 'Finding route…' : 'Use current location'}
          </Button>
        </div>
        <FieldHint>
          Choose the work date in your saved workforce timezone. The route includes only jobs assigned to you.
          {' '}Your current coordinates are sent only for this calculation and are not saved as attendance or location history.
          {' '}Opening the generated route shares its coordinates with Google Maps.
        </FieldHint>
      </Card>

      {error ? <ErrorBanner message={error} /> : null}

      {!result && !error ? (
        <EmptyState
          icon="map-pin"
          title="Ready to plan the day"
          description="Choose a date, then allow location access to order the day's Field App jobs from your current position."
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
              {result.googleMapsUrl ? (
                <a
                  href={result.googleMapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonClassName('primary', 'shrink-0')}
                >
                  <Icon name="map-pin" size={18} />
                  Open route in Google Maps
                </a>
              ) : null}
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
