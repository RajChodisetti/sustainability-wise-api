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

export function shouldRetryAuthQuery(
  error: unknown,
  hasStoredToken: boolean,
): boolean {
  return hasStoredToken && isTransientAuthQueryError(error);
}

/** Retry indefinitely when allowed, while capping load and adding jitter. */
export function authQueryRetryDelayMs(
  failureCount: number,
  random = Math.random(),
): number {
  const exponent = Math.min(Math.max(0, Math.trunc(failureCount)), 16);
  const exponential = Math.min(30_000, 1_000 * 2 ** exponent);
  return Math.min(
    30_000,
    Math.round(exponential * (0.75 + Math.min(1, Math.max(0, random)) * 0.5)),
  );
}
