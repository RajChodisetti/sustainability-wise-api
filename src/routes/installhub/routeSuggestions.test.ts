import assert from 'node:assert/strict';
import test from 'node:test';
import type { FastifyRequest } from 'fastify';
import Fastify from 'fastify';
import { signAccessToken } from '../../auth/jwt.js';
import { AppError } from '../../utils/errors.js';
import {
  installhubRouteSuggestionRoutes,
  requireInstallHubRouteJwt,
} from './routeSuggestions.js';

const url = '/v1/installhub/route-suggestions';
const validPayload = {
  date: '2026-08-24',
  currentLocation: {
    latitude: -33.8688,
    longitude: 151.2093,
    accuracyMeters: 15,
    capturedAt: '2026-08-24T00:00:00.000Z',
  },
};

function bearer(input: {
  userId: string;
  app: 'ecoaudit' | 'solarsense' | 'installhub' | 'wattwatchers';
  role: 'admin' | 'inspector' | 'viewer' | 'service_account';
}): { authorization: string } {
  return { authorization: `Bearer ${signAccessToken(input)}` };
}

async function withRouteApp(
  run: (app: ReturnType<typeof Fastify>) => Promise<void>,
): Promise<void> {
  const app = Fastify();
  await app.register(installhubRouteSuggestionRoutes, { prefix: '/v1/installhub' });
  await app.ready();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

test('Field route suggestions are registered', async () => {
  await withRouteApp(async (app) => {
    assert.equal(app.hasRoute({ method: 'POST', url }), true);
  });
});

test('Field route suggestions require authentication', async () => {
  await withRouteApp(async (app) => {
    const unauthenticated = await app.inject({ method: 'POST', url, payload: validPayload });
    assert.equal(unauthenticated.statusCode, 401, unauthenticated.body);

    const unauthenticatedOverride = await app.inject({
      method: 'POST',
      url,
      payload: { ...validPayload, assigneeFieldUserId: 'another-field-user' },
    });
    assert.equal(unauthenticatedOverride.statusCode, 401, unauthenticatedOverride.body);
  });
});

test('Field route suggestions reject another application namespace', async () => {
  await withRouteApp(async (app) => {
    const wrongApp = await app.inject({
      method: 'POST',
      url,
      headers: bearer({ userId: 'eco-admin', app: 'ecoaudit', role: 'admin' }),
      payload: validPayload,
    });
    assert.equal(wrongApp.statusCode, 403, wrongApp.body);
  });
});

test('Field route auth boundaries run before rejecting an assignee override', async () => {
  await withRouteApp(async (app) => {
    const identities = [
      { userId: 'eco-admin', app: 'ecoaudit' as const, role: 'admin' as const },
      { userId: 'field-viewer', app: 'installhub' as const, role: 'viewer' as const },
      {
        userId: 'field-service-account',
        app: 'installhub' as const,
        role: 'service_account' as const,
      },
    ];
    for (const identity of identities) {
      const response = await app.inject({
        method: 'POST',
        url,
        headers: bearer(identity),
        payload: { ...validPayload, assigneeFieldUserId: 'another-field-user' },
      });
      assert.equal(response.statusCode, 403, response.body);
    }
  });
});

test('Field route suggestions require an inspector-or-admin role', async () => {
  await withRouteApp(async (app) => {
    const viewer = await app.inject({
      method: 'POST',
      url,
      headers: bearer({ userId: 'field-viewer', app: 'installhub', role: 'viewer' }),
      payload: validPayload,
    });
    assert.equal(viewer.statusCode, 403, viewer.body);

    const serviceAccountJwt = await app.inject({
      method: 'POST',
      url,
      headers: bearer({
        userId: 'field-service-account',
        app: 'installhub',
        role: 'service_account',
      }),
      payload: validPayload,
    });
    assert.equal(serviceAccountJwt.statusCode, 403, serviceAccountJwt.body);
  });
});

test('Field route suggestions reject an assignee override', async () => {
  await withRouteApp(async (app) => {
    const unsupportedAssignee = await app.inject({
      method: 'POST',
      url,
      headers: bearer({ userId: 'field-admin', app: 'installhub', role: 'admin' }),
      payload: { ...validPayload, assigneeFieldUserId: 'another-field-user' },
    });
    assert.equal(unsupportedAssignee.statusCode, 400, unsupportedAssignee.body);
  });
});

test('Field route suggestions reject a starting point outside Australia', async () => {
  await withRouteApp(async (app) => {
    const outsideAustralia = await app.inject({
      method: 'POST',
      url,
      headers: bearer({ userId: 'field-inspector', app: 'installhub', role: 'inspector' }),
      payload: {
        ...validPayload,
        currentLocation: { latitude: 51.5072, longitude: -0.1276 },
      },
    });
    assert.equal(outsideAustralia.statusCode, 400, outsideAustralia.body);
  });
});

test('Field route suggestions require exactly one route origin', async () => {
  await withRouteApp(async (app) => {
    const headers = bearer({ userId: 'field-inspector', app: 'installhub', role: 'inspector' });
    const missingOrigin = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: { date: validPayload.date },
    });
    assert.equal(missingOrigin.statusCode, 400, missingOrigin.body);

    const conflictingOrigins = await app.inject({
      method: 'POST',
      url,
      headers,
      payload: {
        ...validPayload,
        startingAddress: 'Flinders Street Station, Melbourne VIC 3000',
      },
    });
    assert.equal(conflictingOrigins.statusCode, 400, conflictingOrigins.body);
  });
});

test('Field route suggestions reject API-key identities independently of role', async () => {
  const request = {
    user: {
      userId: 'field-service-key',
      app: 'installhub',
      role: 'service_account',
      authType: 'apikey',
    },
  } as unknown as FastifyRequest;

  await assert.rejects(
    () => requireInstallHubRouteJwt(request),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 403
      && error.detail === 'field_route_human_jwt_required',
  );
});
