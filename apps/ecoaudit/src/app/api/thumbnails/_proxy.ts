import { mergeVaryHeaderValue } from '@/lib/httpHeaders';

const DEFAULT_API_ORIGIN = 'https://api.sustainabilitywise.com.au';
const RESPONSE_HEADERS = [
  'cache-control',
  'content-disposition',
  'content-length',
  'content-type',
  'etag',
  'last-modified',
  'retry-after',
  'vary',
  'x-original-checksum',
] as const;

function apiOrigin(): string {
  return (
    process.env.INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    DEFAULT_API_ORIGIN
  ).replace(/\/$/, '');
}

export function bearerAuthorization(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  return authorization?.startsWith('Bearer ') ? authorization : null;
}

export function unauthorizedThumbnailResponse(): Response {
  return Response.json(
    { error: 'Unauthorized' },
    {
      status: 401,
      headers: { 'Cache-Control': 'no-store', Vary: 'Authorization' },
    },
  );
}

export function encodeStorageKey(storageKey: string): string {
  return storageKey.split('/').map(encodeURIComponent).join('/');
}

export async function proxyThumbnail(
  request: Request,
  upstreamPath: string,
  authorization: string,
): Promise<Response> {
  const headers = new Headers({
    Accept: 'image/avif,image/webp,image/jpeg,image/*,*/*;q=0.8',
    Authorization: authorization,
  });
  const ifNoneMatch = request.headers.get('if-none-match');
  const ifModifiedSince = request.headers.get('if-modified-since');
  if (ifNoneMatch) headers.set('If-None-Match', ifNoneMatch);
  if (ifModifiedSince) headers.set('If-Modified-Since', ifModifiedSince);

  try {
    const upstream = await fetch(`${apiOrigin()}${upstreamPath}`, {
      headers,
      // Authorization is user-specific. Never place the response in Next's
      // shared data cache; private upstream browser cache headers are retained.
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });

    const responseHeaders = new Headers();
    for (const name of RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    if (!responseHeaders.has('cache-control')) {
      responseHeaders.set('Cache-Control', 'private, no-cache');
    }
    responseHeaders.set(
      'Vary',
      mergeVaryHeaderValue(responseHeaders.get('vary'), 'Authorization'),
    );
    responseHeaders.set('X-Content-Type-Options', 'nosniff');

    return new Response(upstream.status === 304 ? null : upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { error: 'Thumbnail service is temporarily unavailable.' },
      {
        status: 502,
        headers: {
          'Cache-Control': 'no-store',
          'Retry-After': '1',
          Vary: 'Authorization',
        },
      },
    );
  }
}
