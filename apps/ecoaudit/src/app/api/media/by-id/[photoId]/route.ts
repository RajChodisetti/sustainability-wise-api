import { NextRequest, NextResponse } from 'next/server';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'https://api.sustainabilitywise.com.au').replace(/\/$/, '');

function encodeStorageKey(storageKey: string): string {
  return storageKey.split('/').map(encodeURIComponent).join('/');
}

function keyFromRemoteUrl(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) return null;
  try {
    const parsed = new URL(remoteUrl);
    const marker = '/v1/files/';
    const idx = parsed.pathname.indexOf(marker);
    if (idx === -1) return null;
    const raw = parsed.pathname.slice(idx + marker.length);
    return raw
      .split('/')
      .map((s) => {
        try {
          return decodeURIComponent(s);
        } catch {
          return s;
        }
      })
      .join('/');
  } catch {
    return null;
  }
}

async function fetchFile(storageKey: string): Promise<Response | null> {
  const url = `${API_BASE}/v1/files/${encodeStorageKey(storageKey)}`;
  const res = await fetch(url, { headers: { Accept: 'image/*,*/*' }, cache: 'no-store' });
  return res.ok ? res : null;
}

/**
 * Authenticated photo loader:
 * 1) Load photo registry metadata
 * 2) Try current storageKey, then legacy remoteUrl path
 * Strips CORP so <img>/blob can display the image.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ photoId: string }> },
) {
  const { photoId } = await ctx.params;
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const metaRes = await fetch(`${API_BASE}/v1/ecoaudit/photos/${encodeURIComponent(photoId)}`, {
    headers: { Authorization: auth, Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!metaRes.ok) {
    return NextResponse.json({ error: 'Photo not found' }, { status: metaRes.status });
  }

  const meta = (await metaRes.json()) as {
    storageKey?: string | null;
    remoteUrl?: string | null;
    contentType?: string | null;
  };

  const keys = [
    meta.storageKey,
    keyFromRemoteUrl(meta.remoteUrl),
  ].filter((k): k is string => Boolean(k));

  // unique
  const tried = new Set<string>();
  for (const key of keys) {
    if (tried.has(key)) continue;
    tried.add(key);
    const fileRes = await fetchFile(key);
    if (!fileRes) continue;

    const headers = new Headers();
    headers.set('Content-Type', meta.contentType || fileRes.headers.get('content-type') || 'image/jpeg');
    headers.set('Cache-Control', 'private, max-age=86400');
    return new NextResponse(fileRes.body, { status: 200, headers });
  }

  return NextResponse.json(
    {
      error: 'File missing from storage',
      detail: 'Photo is registered but the file was not found. Re-upload the photo.',
      photoId,
      triedKeys: [...tried],
    },
    { status: 404 },
  );
}
