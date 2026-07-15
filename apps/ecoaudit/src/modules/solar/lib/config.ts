/**
 * In Next.js, same-origin `/v1` + `/health` are rewritten to the API (see next.config.ts).
 */
const configured = (process.env.NEXT_PUBLIC_API_URL ?? 'https://api.sustainabilitywise.com.au').replace(/\/$/, '');

export const API_URL = '';

/** Shown in UI — always the real API host */
export const API_DISPLAY_URL = configured;

/** Route absolute API URLs through the Next rewrite (same-origin) to avoid CORS. */
export function resolveApiRequestUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('/')) return `${API_URL}${url}`;
  try {
    const parsed = new URL(url);
    const apiHost = new URL(API_DISPLAY_URL).host;
    if (parsed.host === apiHost) {
      return `${API_URL}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // keep original url
  }
  return url;
}
