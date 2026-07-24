import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { unauthorized } from '../utils/errors.js';

export type UploadCapabilityApp = 'ecoaudit' | 'solarsense' | 'installhub';

type UploadCapabilitySettings = {
  secret: string;
  ttlSeconds: number;
};

type UploadCapabilityVerification = {
  app: UploadCapabilityApp;
  sessionId: string;
  expires: unknown;
  signature: unknown;
  secret: string;
  allowLegacyUnsigned: boolean;
  nowMs?: number;
};

const CAPABILITY_DOMAIN = 'sustainability-wise:raw-upload';
const CAPABILITY_VERSION = 'v1';
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;

function capabilityPayload(
  app: UploadCapabilityApp,
  sessionId: string,
  expires: number,
): string {
  return [
    CAPABILITY_DOMAIN,
    CAPABILITY_VERSION,
    app,
    sessionId,
    String(expires),
  ].join('\n');
}

function capabilitySignature(args: {
  app: UploadCapabilityApp;
  sessionId: string;
  expires: number;
  secret: string;
}): string {
  return createHmac('sha256', args.secret)
    .update(capabilityPayload(args.app, args.sessionId, args.expires))
    .digest('hex');
}

export function signUploadCapability(args: {
  app: UploadCapabilityApp;
  sessionId: string;
  secret: string;
  ttlSeconds: number;
  nowMs?: number;
}): { expires: string; signature: string } {
  if (!args.secret) throw new Error('Upload capability secret must not be empty');
  if (!Number.isSafeInteger(args.ttlSeconds) || args.ttlSeconds <= 0) {
    throw new Error('Upload capability TTL must be a positive integer');
  }

  const expires = Math.floor((args.nowMs ?? Date.now()) / 1000) + args.ttlSeconds;
  return {
    expires: String(expires),
    signature: capabilitySignature({
      app: args.app,
      sessionId: args.sessionId,
      expires,
      secret: args.secret,
    }),
  };
}

export function verifyUploadCapability(args: UploadCapabilityVerification): boolean {
  const hasExpires = args.expires !== undefined;
  const hasSignature = args.signature !== undefined;

  // This is deliberately absence-only. A malformed or tampered signed URL must
  // never be downgraded to the temporary legacy path.
  if (!hasExpires && !hasSignature) return args.allowLegacyUnsigned;
  if (
    typeof args.expires !== 'string'
    || typeof args.signature !== 'string'
    || !/^\d+$/.test(args.expires)
    || !SIGNATURE_PATTERN.test(args.signature)
  ) {
    return false;
  }

  const expires = Number(args.expires);
  const nowSeconds = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (!Number.isSafeInteger(expires) || expires <= nowSeconds || !args.secret) {
    return false;
  }

  const expected = capabilitySignature({
    app: args.app,
    sessionId: args.sessionId,
    expires,
    secret: args.secret,
  });
  return timingSafeEqual(
    Buffer.from(expected, 'ascii'),
    Buffer.from(args.signature, 'ascii'),
  );
}

export function createSignedUploadUrl(args: {
  url: string;
  app: UploadCapabilityApp;
  sessionId: string;
} & UploadCapabilitySettings & { nowMs?: number }): string {
  const capability = signUploadCapability(args);
  const url = new URL(args.url);
  url.searchParams.set('expires', capability.expires);
  url.searchParams.set('signature', capability.signature);
  return url.toString();
}

export function createConfiguredUploadUrl(
  url: string,
  app: UploadCapabilityApp,
  sessionId: string,
): string {
  return createSignedUploadUrl({
    url,
    app,
    sessionId,
    secret: config.uploadCapability.secret,
    ttlSeconds: config.uploadCapability.ttlSeconds,
  });
}

export function requireUploadCapability(app: UploadCapabilityApp) {
  return async (request: FastifyRequest): Promise<void> => {
    const params = request.params as { sessionId?: unknown };
    const query = request.query as { expires?: unknown; signature?: unknown };
    if (
      typeof params.sessionId !== 'string'
      || !verifyUploadCapability({
        app,
        sessionId: params.sessionId,
        expires: query?.expires,
        signature: query?.signature,
        secret: config.uploadCapability.secret,
        allowLegacyUnsigned: config.uploadCapability.allowLegacyUnsigned,
      })
    ) {
      throw unauthorized('Invalid or expired upload capability');
    }
  };
}
