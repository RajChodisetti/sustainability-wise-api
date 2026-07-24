import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSignedFileUrl,
  signFileCapability,
  verifyFileCapability,
} from './fileCapability.js';
import { parseFileCapabilityTtlSeconds } from '../config.js';

const secret = 'test-file-capability-secret';
const storageKey = 'installhub/example-site/pdfs/report-123.pdf';
const nowMs = Date.parse('2026-07-23T12:00:00.000Z');

test('file capability is short-lived and bound to the exact storage key', () => {
  const url = createSignedFileUrl({
    url: `https://api.example.test/v1/files/${storageKey}`,
    storageKey,
    secret,
    ttlSeconds: 300,
    nowMs,
  });
  const parsed = new URL(url);
  assert.equal(verifyFileCapability({
    storageKey,
    expires: parsed.searchParams.get('expires'),
    signature: parsed.searchParams.get('signature'),
    secret,
    nowMs,
  }), true);
  assert.equal(verifyFileCapability({
    storageKey: storageKey.replace('report-123', 'report-456'),
    expires: parsed.searchParams.get('expires'),
    signature: parsed.searchParams.get('signature'),
    secret,
    nowMs,
  }), false);
});

test('file capability rejects expiry and tampering', () => {
  const capability = signFileCapability({
    storageKey,
    secret,
    ttlSeconds: 300,
    nowMs,
  });
  assert.equal(verifyFileCapability({
    storageKey,
    ...capability,
    secret,
    nowMs: Number(capability.expires) * 1000,
  }), false);
  assert.equal(verifyFileCapability({
    storageKey,
    ...capability,
    signature: `0${capability.signature.slice(1)}`,
    secret,
    nowMs,
  }), false);
});

test('file capability TTL config is strict and bounded', () => {
  assert.equal(parseFileCapabilityTtlSeconds(undefined), 300);
  assert.equal(parseFileCapabilityTtlSeconds('1'), 1);
  assert.equal(parseFileCapabilityTtlSeconds('3600'), 3600);
  for (const value of ['0', '1.5', '300junk', '3601']) {
    assert.throws(
      () => parseFileCapabilityTtlSeconds(value),
      /must be an integer between 1 and 3600/,
    );
  }
});
