'use client';

import { useEffect, useState } from 'react';
import { extractPhotoIdFromUri, isLocalDeviceUri, resolvePhotoUrl } from '@/api/photos';
import { getStoredJwt } from '@/api/client';

export function PhotoThumb({
  uri,
  label,
  className = 'max-h-64 w-full rounded-lg object-cover',
}: {
  uri: string;
  label: string;
  className?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'local'>('loading');

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function load() {
      if (isLocalDeviceUri(uri)) {
        if (!cancelled) setStatus('local');
        return;
      }

      const photoId = extractPhotoIdFromUri(uri);
      const jwt = getStoredJwt();

      // Prefer authenticated registry lookup (fixes stale/legacy remoteUrl paths)
      if (photoId && jwt) {
        try {
          const res = await fetch(`/api/media/by-id/${encodeURIComponent(photoId)}`, {
            headers: { Authorization: `Bearer ${jwt}` },
          });
          if (res.ok) {
            const blob = await res.blob();
            objectUrl = URL.createObjectURL(blob);
            if (!cancelled) {
              setSrc(objectUrl);
              setStatus('ready');
            }
            return;
          }
        } catch {
          // fall through
        }
      }

      // Fallback: media proxy of the stored URI
      const proxied = resolvePhotoUrl(uri);
      if (!proxied) {
        if (!cancelled) setStatus('missing');
        return;
      }
      try {
        const res = await fetch(proxied);
        if (!res.ok) {
          if (!cancelled) setStatus('missing');
          return;
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setSrc(objectUrl);
          setStatus('ready');
        }
      } catch {
        if (!cancelled) setStatus('missing');
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri]);

  if (status === 'local') {
    return (
      <div className="flex h-40 items-center justify-center rounded-lg bg-[var(--surface2)] px-3 text-center text-xs text-[var(--text-sub)]">
        Local mobile photo — open Edit and re-upload to view on web.
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
        Photo file missing on server. Open Edit and re-upload.
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={label} className={className} />;
}
