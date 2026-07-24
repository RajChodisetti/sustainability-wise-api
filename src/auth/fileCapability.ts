import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';

const CAPABILITY_DOMAIN = 'sustainability-wise:file-download';
const CAPABILITY_VERSION = 'v1';
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;

function payload(storageKey: string, expires: number): string {
  return [
    CAPABILITY_DOMAIN,
    CAPABILITY_VERSION,
    storageKey,
    String(expires),
  ].join('\n');
}

function signature(storageKey: string, expires: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(payload(storageKey, expires))
    .digest('hex');
}

export function signFileCapability(args: {
  storageKey: string;
  secret: string;
  ttlSeconds: number;
  nowMs?: number;
}): { expires: string; signature: string } {
  if (!args.secret) throw new Error('File capability secret must not be empty');
  if (
    !Number.isSafeInteger(args.ttlSeconds)
    || args.ttlSeconds < 1
    || args.ttlSeconds > 3600
  ) {
    throw new Error('File capability TTL must be an integer between 1 and 3600');
  }
  const expires = Math.floor((args.nowMs ?? Date.now()) / 1000) + args.ttlSeconds;
  return {
    expires: String(expires),
    signature: signature(args.storageKey, expires, args.secret),
  };
}

export function verifyFileCapability(args: {
  storageKey: string;
  expires: unknown;
  signature: unknown;
  secret: string;
  nowMs?: number;
}): boolean {
  if (
    typeof args.expires !== 'string'
    || typeof args.signature !== 'string'
    || !/^\d+$/.test(args.expires)
    || !SIGNATURE_PATTERN.test(args.signature)
    || !args.secret
  ) {
    return false;
  }
  const expires = Number(args.expires);
  const nowSeconds = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (!Number.isSafeInteger(expires) || expires <= nowSeconds) return false;
  const expected = signature(args.storageKey, expires, args.secret);
  return timingSafeEqual(
    Buffer.from(expected, 'ascii'),
    Buffer.from(args.signature, 'ascii'),
  );
}

export function createSignedFileUrl(args: {
  url: string;
  storageKey: string;
  secret: string;
  ttlSeconds: number;
  nowMs?: number;
}): string {
  const capability = signFileCapability(args);
  const url = new URL(args.url);
  url.searchParams.set('expires', capability.expires);
  url.searchParams.set('signature', capability.signature);
  return url.toString();
}

export function createConfiguredFileUrl(url: string, storageKey: string): string {
  return createSignedFileUrl({
    url,
    storageKey,
    secret: config.fileCapability.secret,
    ttlSeconds: config.fileCapability.ttlSeconds,
  });
}
