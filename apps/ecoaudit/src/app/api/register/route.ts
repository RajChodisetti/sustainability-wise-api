const DEFAULT_API_ORIGIN = 'https://api.sustainabilitywise.com.au';

function apiOrigin(): string {
  return (
    process.env.INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    DEFAULT_API_ORIGIN
  ).replace(/\/$/, '');
}

function registrationEnabled(): boolean {
  return /^(?:1|true|yes|on)$/i.test(process.env.PORTAL_REGISTRATION_ENABLED?.trim() ?? '');
}

function cloudEmailForUsername(app: 'ecoaudit' | 'solarsense', username: string): string {
  const normalized = username.toLowerCase().trim();
  if (normalized.includes('@')) return normalized;
  const safeUsername = normalized.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-');
  return `${safeUsername}@${app}.users.local`;
}

type RegistrationBody = {
  app?: unknown;
  username?: unknown;
  password?: unknown;
  fullName?: unknown;
};

const MAX_REGISTRATION_BODY_BYTES = 32_768;

class RegistrationBodyTooLargeError extends Error {}

async function readRegistrationBody(request: Request): Promise<RegistrationBody> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && /^\d+$/.test(contentLength)) {
    const declaredBytes = Number(contentLength);
    if (declaredBytes > MAX_REGISTRATION_BODY_BYTES) {
      throw new RegistrationBodyTooLargeError();
    }
  }

  if (!request.body) throw new SyntaxError('Missing request body');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REGISTRATION_BODY_BYTES) {
        await reader.cancel();
        throw new RegistrationBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SyntaxError('Registration body must be a JSON object');
  }
  return parsed as RegistrationBody;
}

export async function POST(request: Request): Promise<Response> {
  if (!registrationEnabled()) {
    return Response.json(
      { error: 'Portal registration is disabled. Contact your administrator.' },
      { status: 410, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const registrationSecret = process.env.REGISTRATION_SECRET;
  if (!registrationSecret) {
    return Response.json(
      { error: 'Portal registration is unavailable.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  let body: RegistrationBody;
  try {
    body = await readRegistrationBody(request);
  } catch (error) {
    if (error instanceof RegistrationBodyTooLargeError) {
      return Response.json(
        { error: 'Registration request is too large.' },
        { status: 413, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    return Response.json(
      { error: 'Invalid JSON request.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const app = body.app;
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : '';

  if ((app !== 'ecoaudit' && app !== 'solarsense') || !username || !password) {
    return Response.json(
      { error: 'app, username and password are required.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (username.length > 320 || password.length > 1_024 || fullName.length > 200) {
    return Response.json(
      { error: 'Registration fields exceed the allowed length.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const upstream = await fetch(`${apiOrigin()}/v1/auth/register`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Registration-Secret': registrationSecret,
      },
      body: JSON.stringify({
        app,
        email: cloudEmailForUsername(app, username),
        password,
        fullName,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    });

    const headers = new Headers({ 'Cache-Control': 'no-store' });
    const contentType = upstream.headers.get('content-type');
    const retryAfter = upstream.headers.get('retry-after');
    if (contentType) headers.set('Content-Type', contentType);
    if (retryAfter) headers.set('Retry-After', retryAfter);

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch {
    return Response.json(
      { error: 'Registration service is temporarily unavailable.' },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
