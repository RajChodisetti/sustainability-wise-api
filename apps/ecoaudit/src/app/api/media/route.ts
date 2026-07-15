import { NextRequest, NextResponse } from 'next/server';

const API_BASE = (process.env.NEXT_PUBLIC_API_URL ?? 'https://api.sustainabilitywise.com.au').replace(/\/$/, '');

/**
 * Proxies API file/photo URLs and strips CORP headers so <img> works from localhost.
 * Usage: /api/media?url=<encoded absolute or path>
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url');
  if (!raw) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  let target: URL;
  try {
    target = raw.startsWith('http') ? new URL(raw) : new URL(raw.startsWith('/') ? raw : `/v1/files/${raw}`, API_BASE);
  } catch {
    return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
  }

  const apiHost = new URL(API_BASE).host;
  if (target.host !== apiHost) {
    return NextResponse.json({ error: 'Host not allowed' }, { status: 403 });
  }

  const upstream = await fetch(target.toString(), {
    headers: { Accept: 'image/*,*/*' },
    cache: 'force-cache',
  });

  if (!upstream.ok) {
    return NextResponse.json({ error: 'File not found' }, { status: upstream.status });
  }

  const headers = new Headers();
  const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
  headers.set('Content-Type', contentType);
  headers.set('Cache-Control', 'private, max-age=86400');
  // Do NOT forward Cross-Origin-Resource-Policy / COOP — they break <img> on localhost.

  return new NextResponse(upstream.body, { status: 200, headers });
}
