import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertStorageIsolationPolicy,
  type StorageBoundaryDestination,
} from './storageIsolationPolicy.js';

const legacy: StorageBoundaryDestination = {
  provider: 'spaces',
  identity: 'spaces:https://syd1.example.invalid:legacy',
  accessKeyId: 'legacy-key',
};

function app(
  name: string,
  accessKeyId = `${name}-key`,
): StorageBoundaryDestination {
  return {
    provider: 'spaces',
    identity: `spaces:https://syd1.example.invalid:${name}`,
    accessKeyId,
  };
}

test('legacy mode does not require isolated app destinations', () => {
  assert.doesNotThrow(() => assertStorageIsolationPolicy({
    writeMode: 'legacy',
    isProduction: true,
    legacy,
    apps: {
      ecoaudit: null,
      solarsense: null,
      installhub: null,
    },
  }));
});

test('dual and isolated modes require every app destination', () => {
  assert.throws(() => assertStorageIsolationPolicy({
    writeMode: 'dual',
    isProduction: false,
    legacy,
    apps: {
      ecoaudit: app('ecoaudit'),
      solarsense: app('solarsense'),
      installhub: null,
    },
  }), /installhub app storage must be configured/);
});

test('storage roots and buckets must be physically distinct', () => {
  assert.throws(() => assertStorageIsolationPolicy({
    writeMode: 'isolated',
    isProduction: false,
    legacy,
    apps: {
      ecoaudit: app('shared'),
      solarsense: app('shared', 'solar-key'),
      installhub: app('installhub'),
    },
  }), /distinct storage roots or buckets/);
});

test('production app isolation requires object storage', () => {
  assert.throws(() => assertStorageIsolationPolicy({
    writeMode: 'isolated',
    isProduction: true,
    legacy,
    apps: {
      ecoaudit: app('ecoaudit'),
      solarsense: {
        provider: 'local',
        identity: 'local:/var/lib/solarsense',
      },
      installhub: app('installhub'),
    },
  }), /solarsense app storage must use a dedicated object-storage bucket/);
});

test('every Spaces destination requires a distinct IAM access key', () => {
  assert.throws(() => assertStorageIsolationPolicy({
    writeMode: 'dual',
    isProduction: true,
    legacy,
    apps: {
      ecoaudit: app('ecoaudit'),
      solarsense: app('solarsense', 'legacy-key'),
      installhub: app('installhub'),
    },
  }), /distinct IAM access keys/);
});

test('distinct app buckets and IAM identities pass in production', () => {
  assert.doesNotThrow(() => assertStorageIsolationPolicy({
    writeMode: 'dual',
    isProduction: true,
    legacy,
    apps: {
      ecoaudit: app('ecoaudit'),
      solarsense: app('solarsense'),
      installhub: app('installhub'),
    },
  }));
});
