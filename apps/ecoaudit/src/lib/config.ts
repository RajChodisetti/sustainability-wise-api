const configured = (process.env.NEXT_PUBLIC_API_URL ?? 'https://api.sustainabilitywise.com.au').replace(/\/$/, '');

export const API_URL = process.env.NODE_ENV === 'development' ? '' : configured;

export const API_DISPLAY_URL = configured;

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
    // keep original
  }
  return url;
}
