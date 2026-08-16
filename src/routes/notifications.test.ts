import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { signAccessToken } from '../auth/jwt.js';
import { redactSensitiveLogText } from '../app.js';
import { notificationRoutes } from './notifications.js';
import { portalSchedulerRoutes } from './portal/scheduler.js';

const devicePayload = {
  expoPushToken: 'ExpoPushToken[test-token]',
  platform: 'ios',
  projectId: 'project-id',
  registrationGeneration: 1,
};

test('unhandled persistence error logging redacts Expo push tokens', () => {
  const token = 'ExpoPushToken[secret-token-value]';
  const drizzleMessage = `Failed query: insert into app_push_devices; params: ${token}`;
  const safe = redactSensitiveLogText(drizzleMessage);
  assert.equal(safe.includes(token), false);
  assert.equal(safe.includes('[REDACTED_EXPO_PUSH_TOKEN]'), true);
  assert.equal(
    redactSensitiveLogText('params: ExponentPushToken[legacy-secret]').includes('legacy-secret'),
    false,
  );
});

test('push registration is authenticated and rejects non-mobile namespaces before storage', async () => {
  const app = Fastify();
  await app.register(notificationRoutes, { prefix: '/v1' });
  await app.ready();
  try {
    const url = '/v1/notifications/devices/device-1';
    const anonymous = await app.inject({ method: 'PUT', url, payload: devicePayload });
    assert.equal(anonymous.statusCode, 401);

    const fleet = await app.inject({
      method: 'PUT',
      url,
      headers: {
        authorization: `Bearer ${signAccessToken({
          userId: 'fleet-user',
          app: 'wattwatchers',
          role: 'admin',
        })}`,
      },
      payload: devicePayload,
    });
    assert.equal(fleet.statusCode, 403);
  } finally {
    await app.close();
  }
});

test('manual scheduler reminder endpoint is admin-only', async () => {
  const app = Fastify();
  await app.register(portalSchedulerRoutes, { prefix: '/v1/portal' });
  await app.ready();
  try {
    const url = '/v1/portal/scheduler/events/event-1/remind';
    const anonymous = await app.inject({
      method: 'POST',
      url,
      payload: { idempotencyKey: 'tap-1' },
    });
    assert.equal(anonymous.statusCode, 401);

    const inspector = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${signAccessToken({
          userId: 'eco-inspector',
          app: 'ecoaudit',
          role: 'inspector',
        })}`,
      },
      payload: { idempotencyKey: 'tap-1' },
    });
    assert.equal(inspector.statusCode, 403);

    const fleetAdmin = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${signAccessToken({
          userId: 'fleet-admin',
          app: 'wattwatchers',
          role: 'admin',
        })}`,
      },
      payload: { idempotencyKey: 'tap-1' },
    });
    assert.equal(fleetAdmin.statusCode, 403);
  } finally {
    await app.close();
  }
});
