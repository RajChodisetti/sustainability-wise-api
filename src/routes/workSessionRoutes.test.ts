import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify, { type FastifyInstance } from 'fastify';
import { signAccessToken } from '../auth/jwt.js';
import { eaAuditRoutes } from './ecoaudit/audits.js';
import { installhubInstallationRoutes } from './installhub/installations.js';
import { solarsenseAssessmentRoutes } from './solarsense/assessments.js';

const validPayload = {
  revision: 1,
  activeMilliseconds: 1_000,
  startedAt: '2026-08-15T10:00:00.000Z',
  lastActiveAt: '2026-08-15T10:00:01.000Z',
  endedAt: null,
};

const routeCases: Array<{
  name: string;
  appName: 'ecoaudit' | 'solarsense' | 'installhub';
  url: string;
  routePattern: string;
  register: (app: FastifyInstance) => Promise<void>;
}> = [
  {
    name: 'EcoAudit',
    appName: 'ecoaudit',
    url: '/audits/audit-1/active-time/sessions/session-1',
    routePattern: '/audits/:id/active-time/sessions/:sessionId',
    register: async (app) => {
      await app.register(eaAuditRoutes, { prefix: '/audits' });
    },
  },
  {
    name: 'SolarSense',
    appName: 'solarsense',
    url: '/sites/site-1/assessments/assessment-1/active-time/sessions/session-1',
    routePattern: '/sites/:siteId/assessments/:id/active-time/sessions/:sessionId',
    register: async (app) => {
      await app.register(solarsenseAssessmentRoutes);
    },
  },
  {
    name: 'Field App Complete',
    appName: 'installhub',
    url: '/installations/installation-1/active-time/sessions/session-1',
    routePattern: '/installations/:installationId/active-time/sessions/:sessionId',
    register: async (app) => {
      await app.register(installhubInstallationRoutes, {
        prefix: '/installations',
      });
    },
  },
];

for (const routeCase of routeCases) {
  test(`${routeCase.name} active-time checkpoint is authenticated and validated`, async () => {
    const app = Fastify();
    await routeCase.register(app);
    await app.ready();

    try {
      assert.equal(app.hasRoute({
        method: 'PUT',
        url: routeCase.routePattern,
      }), true);

      const unauthenticated = await app.inject({
        method: 'PUT',
        url: routeCase.url,
        payload: validPayload,
      });
      assert.equal(unauthenticated.statusCode, 401);

      const wrongApp = await app.inject({
        method: 'PUT',
        url: routeCase.url,
        headers: {
          authorization: `Bearer ${signAccessToken({
            userId: 'wrong-app-user',
            app: routeCase.appName === 'ecoaudit' ? 'solarsense' : 'ecoaudit',
            role: 'admin',
          })}`,
        },
        payload: validPayload,
      });
      assert.equal(wrongApp.statusCode, 403);

      const viewer = await app.inject({
        method: 'PUT',
        url: routeCase.url,
        headers: {
          authorization: `Bearer ${signAccessToken({
            userId: 'viewer',
            app: routeCase.appName,
            role: 'viewer',
          })}`,
        },
        payload: validPayload,
      });
      assert.equal(viewer.statusCode, 403);

      const invalidBody = await app.inject({
        method: 'PUT',
        url: routeCase.url,
        headers: {
          authorization: `Bearer ${signAccessToken({
            userId: 'inspector',
            app: routeCase.appName,
            role: 'inspector',
          })}`,
        },
        payload: { ...validPayload, activeMilliseconds: -1 },
      });
      assert.equal(invalidBody.statusCode, 400);
    } finally {
      await app.close();
    }
  });
}
