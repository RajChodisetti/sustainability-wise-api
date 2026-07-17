export type PortalApp = 'ecoaudit' | 'solarsense' | 'wattwatchers';

const PORTAL_ORIGIN = 'https://portal.local';
const UNSAFE_PATH_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\\]/;

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

export function portalAppForPath(path: string): PortalApp | null {
  const safePath = safePortalNext(path);
  const pathname = new URL(safePath, PORTAL_ORIGIN).pathname;

  if (pathname === '/ecoaudit' || pathname.startsWith('/ecoaudit/')) return 'ecoaudit';
  if (pathname === '/solar' || pathname.startsWith('/solar/')) return 'solarsense';
  if (pathname === '/fleet' || pathname.startsWith('/fleet/')) return 'wattwatchers';
  return null;
}
