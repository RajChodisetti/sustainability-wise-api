import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSignedUploadUrl,
  signUploadCapability,
  verifyUploadCapability,
} from './uploadCapability.js';
import { parseUploadCapabilityTtlSeconds } from '../config.js';

const secret = 'test-upload-capability-secret';
const sessionId = '11111111-2222-4333-8444-555555555555';
const nowMs = Date.parse('2026-07-23T12:00:00.000Z');

test('signed upload URLs carry a short-lived capability bound to app and session', () => {
  const signedUrl = createSignedUploadUrl({
    url: `https://api.example.test/v1/ecoaudit/sync/upload/${sessionId}`,
    app: 'ecoaudit',
    sessionId,
    secret,
    ttlSeconds: 900,
    nowMs,
  });
  const parsed = new URL(signedUrl);

  assert.equal(parsed.searchParams.get('expires'), String(nowMs / 1000 + 900));
  assert.match(parsed.searchParams.get('signature') ?? '', /^[a-f0-9]{64}$/);
  assert.equal(verifyUploadCapability({
    app: 'ecoaudit',
    sessionId,
    expires: parsed.searchParams.get('expires'),
    signature: parsed.searchParams.get('signature'),
    secret,
    allowLegacyUnsigned: false,
    nowMs,
  }), true);
});

test('upload capabilities reject changed sessions, apps, expiry, and signatures', () => {
  const capability = signUploadCapability({
    app: 'ecoaudit',
    sessionId,
    secret,
    ttlSeconds: 900,
    nowMs,
  });
  const verify = (overrides: Partial<Parameters<typeof verifyUploadCapability>[0]> = {}) =>
    verifyUploadCapability({
      app: 'ecoaudit',
      sessionId,
      ...capability,
      secret,
      allowLegacyUnsigned: false,
      nowMs,
      ...overrides,
    });

  assert.equal(verify({ sessionId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }), false);
  assert.equal(verify({ app: 'solarsense' }), false);
  assert.equal(verify({ expires: String(Number(capability.expires) + 1) }), false);
  assert.equal(verify({ signature: `${capability.signature.slice(0, -1)}0` }), false);
  assert.equal(verify({ nowMs: Number(capability.expires) * 1000 }), false);
});

test('legacy unsigned uploads require the explicit rollback toggle', () => {
  const base = {
    app: 'installhub' as const,
    sessionId,
    expires: undefined,
    signature: undefined,
    secret,
    nowMs,
  };

  assert.equal(verifyUploadCapability({
    ...base,
    allowLegacyUnsigned: false,
  }), false);
  assert.equal(verifyUploadCapability({
    ...base,
    allowLegacyUnsigned: true,
  }), true);
});

test('legacy mode does not downgrade partial or invalid signed capabilities', () => {
  const capability = signUploadCapability({
    app: 'solarsense',
    sessionId,
    secret,
    ttlSeconds: 900,
    nowMs,
  });
  const base = {
    app: 'solarsense' as const,
    sessionId,
    secret,
    allowLegacyUnsigned: true,
    nowMs,
  };

  assert.equal(verifyUploadCapability({
    ...base,
    expires: capability.expires,
    signature: undefined,
  }), false);
  assert.equal(verifyUploadCapability({
    ...base,
    expires: capability.expires,
    signature: '0'.repeat(64),
  }), false);
});

test('upload capability TTL config is strict and stays short-lived', () => {
  assert.equal(parseUploadCapabilityTtlSeconds(undefined), 900);
  assert.equal(parseUploadCapabilityTtlSeconds('1'), 1);
  assert.equal(parseUploadCapabilityTtlSeconds('3600'), 3600);

  for (const value of ['0', '1.5', '900junk', '3601', '999999999999999999999']) {
    assert.throws(
      () => parseUploadCapabilityTtlSeconds(value),
      /must be an integer between 1 and 3600/,
      value,
    );
  }
});
