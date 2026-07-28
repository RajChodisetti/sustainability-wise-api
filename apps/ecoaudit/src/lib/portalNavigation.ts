export type PortalApp = 'ecoaudit' | 'solarsense' | 'installhub' | 'wattwatchers';
export type PortalNavigationScope =
  | 'portal'
  | 'ecoaudit'
  | 'solar'
  | 'field'
  | 'fleet';

const PORTAL_ORIGIN = 'https://portal.local';
const UNSAFE_PATH_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\\]/;
const PORTAL_AUTH_PATHS = new Set([
  '/login',
  '/signup',
  '/ecoaudit/login',
  '/ecoaudit/signup',
  '/solar/login',
  '/solar/signup',
  '/installhub/login',
]);

function hasUnsafePathSyntax(value: string): boolean {
  return !value.startsWith('/') || value.startsWith('//') || UNSAFE_PATH_CHARACTERS.test(value);
}

function isUnsafeLocalPath(value: string): boolean {
  // Validate every encoded form too. This rejects paths such as /%5cevil or
  // /%252f%252fevil before a browser/router gets a chance to decode them.
  let decoded = value;
  for (let remaining = value.length; remaining > 0; remaining -= 1) {
    if (hasUnsafePathSyntax(decoded)) return true;

    const resolved = new URL(decoded, PORTAL_ORIGIN);
    const normalized = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    if (resolved.origin !== PORTAL_ORIGIN || hasUnsafePathSyntax(normalized)) return true;

    const next = decodeURIComponent(decoded);
    if (next === decoded) break;
    decoded = next;
  }

  return false;
}

/**
 * Return a same-origin portal path suitable for Next's router, or a known-safe
 * fallback. Absolute URLs, network paths, controls and backslashes are rejected.
 */
export function safePortalNext(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || raw.length > 2048) return fallback;

  try {
    if (isUnsafeLocalPath(raw)) return fallback;

    const resolved = new URL(raw, PORTAL_ORIGIN);
    if (resolved.origin !== PORTAL_ORIGIN) return fallback;

    const normalized = `${resolved.pathname}${resolved.search}${resolved.hash}`;
    if (isUnsafeLocalPath(normalized)) return fallback;
    return normalized;
  } catch {
    return fallback;
  }
}

function isPortalAuthPath(path: string): boolean {
  const pathname = new URL(path, PORTAL_ORIGIN).pathname;
  return PORTAL_AUTH_PATHS.has(pathname);
}

/**
 * Resolve the post-login destination without allowing an external redirect or
 * sending the user back into a login/signup route.
 */
export function safePortalLoginNext(
  raw: string | string[] | null | undefined,
  fallback = '/',
): string {
  const normalizedFallback = safePortalNext(fallback);
  const safeFallback = isPortalAuthPath(normalizedFallback) ? '/' : normalizedFallback;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const next = safePortalNext(requested, safeFallback);
  return isPortalAuthPath(next) ? safeFallback : next;
}

/** Build the canonical URL for the portal's only sign-in page. */
export function portalLoginRedirectPath(
  rawNext: string | string[] | null | undefined,
  fallback = '/',
): string {
  return `/login?next=${encodeURIComponent(safePortalLoginNext(rawNext, fallback))}`;
}

export function portalAppForPath(path: string): PortalApp | null {
  const safePath = safePortalNext(path);
  const pathname = new URL(safePath, PORTAL_ORIGIN).pathname;

  if (pathname === '/ecoaudit' || pathname.startsWith('/ecoaudit/')) return 'ecoaudit';
  if (pathname === '/solar' || pathname.startsWith('/solar/')) return 'solarsense';
  if (pathname === '/installhub' || pathname.startsWith('/installhub/')) return 'installhub';
  if (pathname === '/fleet' || pathname.startsWith('/fleet/')) return 'wattwatchers';
  return null;
}

export function portalNavigationScopeForPath(path: string): PortalNavigationScope {
  const safePath = safePortalNext(path);
  const pathname = new URL(safePath, PORTAL_ORIGIN).pathname;

  if (pathname === '/ecoaudit' || pathname.startsWith('/ecoaudit/')) return 'ecoaudit';
  if (pathname === '/solar' || pathname.startsWith('/solar/')) return 'solar';
  if (
    pathname === '/field' ||
    pathname.startsWith('/field/') ||
    pathname === '/installhub' ||
    pathname.startsWith('/installhub/')
  ) {
    return 'field';
  }
  if (pathname === '/fleet' || pathname.startsWith('/fleet/')) return 'fleet';
  return 'portal';
}
