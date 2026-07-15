import { ApiError, NetworkError } from '@/api/client';

type PortalRegistrationInput = {
  app: 'ecoaudit' | 'solarsense';
  username: string;
  password: string;
  fullName: string;
};

function parseError(text: string): string {
  try {
    const json = JSON.parse(text) as { detail?: string; error?: string; message?: string };
    return json.detail ?? json.message ?? json.error ?? text;
  } catch {
    return text;
  }
}

export async function registerThroughPortal<T>(input: PortalRegistrationInput): Promise<T> {
  try {
    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      cache: 'no-store',
    });
    const text = await response.text();
    if (!response.ok) {
      const message = parseError(text) || response.statusText;
      throw new ApiError(message, response.status, message);
    }
    return JSON.parse(text) as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new NetworkError(error instanceof Error ? error.message : String(error));
  }
}
