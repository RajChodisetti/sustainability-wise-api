type AuthLikeError = {
  type?: unknown;
  status?: unknown;
};

function authLikeError(error: unknown): AuthLikeError {
  return typeof error === 'object' && error !== null ? (error as AuthLikeError) : {};
}

export function isDefinitiveAuthError(error: unknown): boolean {
  const candidate = authLikeError(error);
  return candidate.type === 'auth' || candidate.status === 401 || candidate.status === 403;
}

export function isTransientAuthQueryError(error: unknown): boolean {
  const candidate = authLikeError(error);
  return (
    candidate.type === 'network' ||
    candidate.status === 429 ||
    (typeof candidate.status === 'number' && candidate.status >= 500)
  );
}

/** Transient /me failures — keep small so login never sticks on "Preparing…". */
export const AUTH_QUERY_MAX_RETRIES = 2;

export function shouldRetryAuthQuery(
  error: unknown,
  hasStoredToken: boolean,
  failureCount = 0,
): boolean {
  if (!hasStoredToken) return false;
  if (failureCount >= AUTH_QUERY_MAX_RETRIES) return false;
  return isTransientAuthQueryError(error);
}

/** Backoff while retrying, capped so workspace UI unblocks quickly. */
export function authQueryRetryDelayMs(
  failureCount: number,
  random = Math.random(),
): number {
  const exponent = Math.min(Math.max(0, Math.trunc(failureCount)), 4);
  const exponential = Math.min(4_000, 500 * 2 ** exponent);
  return Math.min(
    4_000,
    Math.round(exponential * (0.75 + Math.min(1, Math.max(0, random)) * 0.5)),
  );
}

/**
 * True only while a stored token session is still being verified.
 * Settled errors / missing user must NOT keep "Preparing your workspace…" forever.
 */
export function isSessionCheckLoading(options: {
  isClient: boolean;
  hasToken: boolean;
  hasUser: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
}): boolean {
  if (!options.isClient) return true;
  if (!options.hasToken || options.hasUser) return false;
  if (options.isError && !options.isFetching) return false;
  return options.isPending || options.isFetching;
}
