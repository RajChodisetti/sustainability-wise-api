'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { isLocalDeviceUri } from '@/api/photos';
import { getStoredJwt as getEcoJwt, tryRefreshToken as refreshEcoToken } from '@/api/client';
import {
  getStoredJwt as getSolarJwt,
  tryRefreshToken as refreshSolarToken,
} from '@solar/api/client';
import { extractPhotoIdFromUri, extractPhotoStorageKey } from '@/lib/photoReferences';
import {
  isRetryableThumbnailStatus,
  thumbnailRetryDelayMs,
} from '@/lib/thumbnailRetry';

type AppName = 'ecoaudit' | 'solarsense';
type PreviewStatus = 'loading' | 'ready' | 'missing' | 'local';
type PhotoThumbProps = {
  uri: string;
  label: string;
  app?: AppName;
  className?: string;
};

const THUMBNAIL_ATTEMPT_TIMEOUT_MS = 25_000;

function tokenFor(app: AppName): string | null {
  return app === 'ecoaudit' ? getEcoJwt() : getSolarJwt();
}

function refreshFor(app: AppName): Promise<string | null> {
  return app === 'ecoaudit' ? refreshEcoToken() : refreshSolarToken();
}

async function fetchWithToken(
  url: string,
  token: string,
  componentSignal: AbortSignal,
): Promise<{ response: Response; blob: Blob | null }> {
  const attemptController = new AbortController();
  const abortFromComponent = () => attemptController.abort(componentSignal.reason);
  if (componentSignal.aborted) {
    abortFromComponent();
  } else {
    componentSignal.addEventListener('abort', abortFromComponent, { once: true });
  }
  const timeout = window.setTimeout(
    () => attemptController.abort('Thumbnail request timed out'),
    THUMBNAIL_ATTEMPT_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: attemptController.signal,
    });
    // Keep the attempt timeout active through body consumption. A server can
    // send headers and then leave an image stream half-open indefinitely.
    const blob = response.ok ? await response.blob() : null;
    return { response, blob };
  } finally {
    window.clearTimeout(timeout);
    componentSignal.removeEventListener('abort', abortFromComponent);
  }
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(true);
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timeout);
      resolve(false);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function PhotoThumb(props: PhotoThumbProps) {
  const app = props.app ?? 'ecoaudit';
  return <PhotoThumbLoader key={`${app}:${props.uri}`} {...props} />;
}

function PhotoThumbLoader({
  uri,
  label,
  app = 'ecoaudit',
  className = 'max-h-64 w-full rounded-lg object-cover',
}: PhotoThumbProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<PreviewStatus>('loading');

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    const { signal } = controller;

    function applyImageResponse(response: Response, blob: Blob | null): boolean {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType && !contentType.toLowerCase().startsWith('image/')) return false;
      if (signal.aborted || !blob || blob.size === 0) return false;
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
      setStatus('ready');
      return true;
    }

    async function load() {
      if (isLocalDeviceUri(uri)) {
        if (!signal.aborted) setStatus('local');
        return;
      }

      const photoId = extractPhotoIdFromUri(uri);
      const storageKey = extractPhotoStorageKey(uri, app);
      const thumbnailUrls: string[] = [];
      if (photoId) {
        thumbnailUrls.push(`/api/thumbnails/by-id/${encodeURIComponent(photoId)}`);
      }
      if (storageKey) {
        thumbnailUrls.push(`/api/thumbnails?reference=${encodeURIComponent(storageKey)}`);
      }
      if (thumbnailUrls.length === 0) {
        if (!signal.aborted) setStatus('missing');
        return;
      }

      let endpointIndex = 0;
      let retryAttempt = 0;
      let refreshAttempted = false;

      while (!signal.aborted && endpointIndex < thumbnailUrls.length) {
        const jwt = tokenFor(app);
        if (!jwt) {
          setStatus('missing');
          return;
        }

        let response: Response;
        let imageBlob: Blob | null;
        try {
          const attempt = await fetchWithToken(thumbnailUrls[endpointIndex], jwt, signal);
          response = attempt.response;
          imageBlob = attempt.blob;
        } catch {
          if (signal.aborted) return;
          const continued = await waitForRetry(
            thumbnailRetryDelayMs(retryAttempt, null),
            signal,
          );
          retryAttempt += 1;
          if (!continued) return;
          continue;
        }

        if (response.status === 401) {
          // Another preview may already have completed the shared, single-flight
          // refresh. Retry with that rotated token instead of refreshing again.
          const currentJwt = tokenFor(app);
          if (currentJwt && currentJwt !== jwt) {
            retryAttempt = 0;
            continue;
          }
          if (refreshAttempted) {
            setStatus('missing');
            return;
          }
          refreshAttempted = true;
          try {
            const fresh = await refreshFor(app);
            if (!fresh) {
              if (!signal.aborted) setStatus('missing');
              return;
            }
            retryAttempt = 0;
            continue;
          } catch {
            if (signal.aborted) return;
            const continued = await waitForRetry(
              thumbnailRetryDelayMs(retryAttempt, null),
              signal,
            );
            retryAttempt += 1;
            if (!continued) return;
            // The refresh client only throws for transient network, rate-limit,
            // or server failures. Allow one new refresh attempt after the delay;
            // a definitive 400/401/403 is returned as null above.
            refreshAttempted = false;
            continue;
          }
        }

        if (response.ok) {
          try {
            if (applyImageResponse(response, imageBlob)) return;
          } catch {
            if (signal.aborted) return;
            const continued = await waitForRetry(
              thumbnailRetryDelayMs(retryAttempt, null),
              signal,
            );
            retryAttempt += 1;
            if (!continued) return;
            continue;
          }
          if (!signal.aborted) setStatus('missing');
          return;
        }

        if (response.status === 404 || response.status === 410) {
          endpointIndex += 1;
          retryAttempt = 0;
          if (endpointIndex >= thumbnailUrls.length && !signal.aborted) {
            setStatus('missing');
          }
          continue;
        }

        if (isRetryableThumbnailStatus(response.status)) {
          const continued = await waitForRetry(
            thumbnailRetryDelayMs(retryAttempt, response.headers.get('retry-after')),
            signal,
          );
          retryAttempt += 1;
          if (!continued) return;
          continue;
        }

        if (!signal.aborted) setStatus('missing');
        return;
      }
    }

    void load();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [app, uri]);

  if (status === 'local') {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg bg-[var(--surface2)] px-3 text-center text-xs text-[var(--text-sub)]">
        Local mobile photo — sync it to view the preview on the web.
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg bg-[var(--surface2)] text-xs text-[var(--muted)]">
        Loading photo…
      </div>
    );
  }

  if (status === 'missing' || !src) {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface2)] px-3 text-center text-xs text-[var(--text-sub)]">
        Photo preview unavailable. The original reference is preserved.
      </div>
    );
  }

  return <Image unoptimized src={src} alt={label} width={400} height={400} className={className} />;
}
