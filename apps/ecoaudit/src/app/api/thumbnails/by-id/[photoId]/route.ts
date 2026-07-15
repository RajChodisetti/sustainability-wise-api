import {
  bearerAuthorization,
  proxyThumbnail,
  unauthorizedThumbnailResponse,
} from '../../_proxy';

export async function GET(
  request: Request,
  context: { params: Promise<{ photoId: string }> },
): Promise<Response> {
  const authorization = bearerAuthorization(request);
  if (!authorization) return unauthorizedThumbnailResponse();

  const { photoId } = await context.params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(photoId)) {
    return Response.json(
      { error: 'Invalid photo id' },
      {
        status: 400,
        headers: { 'Cache-Control': 'no-store', Vary: 'Authorization' },
      },
    );
  }

  return proxyThumbnail(
    request,
    `/v1/photo-thumbnails/${encodeURIComponent(photoId.toLowerCase())}`,
    authorization,
  );
}
