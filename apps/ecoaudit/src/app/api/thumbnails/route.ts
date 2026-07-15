import { extractPhotoStorageKey } from '@/lib/photoReferences';
import {
  bearerAuthorization,
  encodeStorageKey,
  proxyThumbnail,
  unauthorizedThumbnailResponse,
} from './_proxy';

/**
 * Safely proxy the existing authenticated reference-based thumbnail endpoint.
 * Absolute caller-provided hosts are discarded; only a validated storage key
 * is appended to the configured API origin.
 */
export async function GET(request: Request): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (!authorization) return unauthorizedThumbnailResponse();

  const reference = new URL(request.url).searchParams.get('reference');
  const storageKey = extractPhotoStorageKey(reference);
  if (!storageKey) {
    return Response.json(
      { error: 'Invalid photo reference' },
      {
        status: 400,
        headers: { 'Cache-Control': 'no-store', Vary: 'Authorization' },
      },
    );
  }

  return proxyThumbnail(
    request,
    `/v1/thumbnails/${encodeStorageKey(storageKey)}`,
    authorization,
  );
}
