export type OneDriveCredentials = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
};

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
};

type GraphErrorBody = {
  error?: {
    code?: string;
    message?: string;
  };
};

const graphRoot = 'https://graph.microsoft.com/v1.0';
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

export class GraphRequestError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly responseBody?: unknown;

  constructor(args: { status: number; code?: string; message: string; responseBody?: unknown }) {
    super(args.message);
    this.name = 'GraphRequestError';
    this.status = args.status;
    this.code = args.code;
    this.responseBody = args.responseBody;
  }
}

function credentialCacheKey(credentials: OneDriveCredentials): string {
  return `${credentials.tenantId}:${credentials.clientId}`;
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 1000);
  }
}

function graphErrorMessage(status: number, body: unknown): { code?: string; message: string } {
  const parsed = body as GraphErrorBody | null;
  const code = parsed?.error?.code;
  const message = parsed?.error?.message;
  return {
    code,
    message: message
      ? `Microsoft Graph request failed (${status} ${code ?? 'error'}): ${message}`
      : `Microsoft Graph request failed (${status})`,
  };
}

async function fetchAccessToken(credentials: OneDriveCredentials): Promise<string> {
  const cacheKey = credentialCacheKey(credentials);
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.accessToken;
  }

  const form = new URLSearchParams({
    client_id: credentials.clientId,
    client_secret: credentials.clientSecret,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(credentials.tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    },
  );
  const body = await responseBody(response);
  if (!response.ok) {
    const { code, message } = graphErrorMessage(response.status, body);
    throw new GraphRequestError({ status: response.status, code, message, responseBody: body });
  }

  const token = body as TokenResponse | null;
  if (!token?.access_token) {
    throw new Error('Microsoft identity token response did not include an access token');
  }

  tokenCache.set(cacheKey, {
    accessToken: token.access_token,
    expiresAt: Date.now() + Math.max((token.expires_in ?? 3600) - 120, 60) * 1000,
  });
  return token.access_token;
}

export async function graphJson<T>(
  credentials: OneDriveCredentials,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const accessToken = await fetchAccessToken(credentials);
  const response = await fetch(`${graphRoot}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...init.headers,
    },
  });
  const body = await responseBody(response);
  if (!response.ok) {
    const { code, message } = graphErrorMessage(response.status, body);
    throw new GraphRequestError({ status: response.status, code, message, responseBody: body });
  }
  return body as T;
}

export async function graphBuffer(
  credentials: OneDriveCredentials,
  path: string,
  init: RequestInit = {},
): Promise<Buffer> {
  const accessToken = await fetchAccessToken(credentials);
  const response = await fetch(`${graphRoot}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await responseBody(response);
    const { code, message } = graphErrorMessage(response.status, body);
    throw new GraphRequestError({ status: response.status, code, message, responseBody: body });
  }

  return Buffer.from(await response.arrayBuffer());
}
