import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { buildApp, completeOpenApiDocument, operationSummary } from '../app.js';
import { db } from '../db/client.js';
import {
  authenticate,
  requireApp,
  requireRole,
} from './middleware.js';
import {
  signAccessToken,
  verifyAccessToken,
  type App,
} from './jwt.js';
import {
  fieldBridgeIdentity,
  verifyFieldSourceUser,
  type FieldSourceUser,
} from './loginIdentity.js';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const legacyRoutes: Array<{
  method: HttpMethod;
  url: string;
}> = [
  { method: 'POST', url: '/v1/auth/login' },
  { method: 'POST', url: '/v1/auth/refresh' },
  { method: 'POST', url: '/v1/auth/logout' },
  { method: 'POST', url: '/v1/auth/register' },
  { method: 'POST', url: '/v1/auth/bootstrap-local' },
  { method: 'GET', url: '/v1/auth/me' },

  { method: 'GET', url: '/v1/ecoaudit/users' },
  { method: 'POST', url: '/v1/ecoaudit/users' },
  { method: 'GET', url: '/v1/ecoaudit/users/:id' },
  { method: 'PATCH', url: '/v1/ecoaudit/users/:id' },
  { method: 'PATCH', url: '/v1/ecoaudit/users/:id/password' },
  { method: 'DELETE', url: '/v1/ecoaudit/users/:id' },

  { method: 'GET', url: '/v1/solarsense/users' },
  { method: 'POST', url: '/v1/solarsense/users' },
  { method: 'GET', url: '/v1/solarsense/users/:id' },
  { method: 'PATCH', url: '/v1/solarsense/users/:id' },
  { method: 'PATCH', url: '/v1/solarsense/users/:id/password' },
  { method: 'DELETE', url: '/v1/solarsense/users/:id' },

  { method: 'GET', url: '/v1/installhub/users' },
  { method: 'POST', url: '/v1/installhub/users' },
  { method: 'GET', url: '/v1/installhub/users/:id' },
  { method: 'PATCH', url: '/v1/installhub/users/:id' },
  { method: 'PATCH', url: '/v1/installhub/users/:id/password' },
  { method: 'DELETE', url: '/v1/installhub/users/:id' },
];

async function withRegisteredApp(
  check: (app: Awaited<ReturnType<typeof buildApp>>) => Promise<void>,
): Promise<void> {
  /*
   * authRoutes performs one idempotent server_settings bootstrap query while
   * registering. Route-shape tests must not require a live database, so stub
   * only that registration-time call and restore the Drizzle object before
   * returning. No request handler database operation is stubbed.
   */
  const hadOwnExecute = Object.prototype.hasOwnProperty.call(db, 'execute');
  const originalExecute = db.execute;
  (db as unknown as { execute: () => Promise<unknown> }).execute =
    async () => [];

  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    app = await buildApp();
    await app.ready();
    await check(app);
  } finally {
    if (app) await app.close();
    if (hadOwnExecute) {
      (db as unknown as { execute: typeof originalExecute }).execute =
        originalExecute;
    } else {
      delete (db as unknown as { execute?: typeof originalExecute }).execute;
    }
  }
}

test('additive unified auth keeps every installed-mobile auth and user route', async () => {
  await withRegisteredApp(async (app) => {
    for (const route of legacyRoutes) {
      assert.equal(
        app.hasRoute(route),
        true,
        `${route.method} ${route.url} must remain registered`,
      );
    }

    assert.equal(
      app.hasRoute({ method: 'POST', url: '/v1/auth/portal-login' }),
      true,
    );
    assert.equal(
      app.hasRoute({ method: 'POST', url: '/v1/auth/field-session' }),
      true,
    );
    assert.equal(
      app.hasRoute({ method: 'GET', url: '/v1/portal/users' }),
      true,
    );
  });
});

test('generated OpenAPI summaries display the brand without changing the route namespace', () => {
  assert.equal(
    operationSummary('post', '/v1/installhub/sync/push'),
    'POST Field App Complete sync push',
  );
});

test('generated OpenAPI describes Scheduler bill uploads as authenticated binary media', () => {
  const path = '/v1/portal/scheduler/expenses/{expenseId}/attachments';
  const document = completeOpenApiDocument({
    paths: { [path]: { post: {} } },
    components: {},
  });
  const requestBody = document.paths[path].post.requestBody;
  assert.deepEqual(Object.keys(requestBody.content).sort(), [
    'application/octet-stream',
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
  ]);
  for (const media of Object.values(requestBody.content) as Array<{
    schema: { type: string; format: string };
  }>) {
    assert.deepEqual(media.schema, { type: 'string', format: 'binary' });
  }
  assert.deepEqual(document.paths[path].post.security, [{ bearerAuth: [] }]);
});

test('legacy login keeps the email, password and app request contract', async () => {
  await withRegisteredApp(async (app) => {
    const missingApp = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'admin@ecoaudit.users.local',
        password: 'password',
      },
    });
    assert.equal(missingApp.statusCode, 400);
    assert.deepEqual(
      Object.keys(missingApp.json()).sort(),
      ['detail', 'error', 'statusCode'],
    );

    const renamedApp = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'admin@ecoaudit.users.local',
        password: 'password',
        app: 'field',
      },
    });
    assert.equal(renamedApp.statusCode, 400);
  });
});

test('additive Field session exchange requires source JWT and refresh-session binding', async () => {
  await withRegisteredApp(async (app) => {
    const ecoToken = signAccessToken({
      userId: 'eco-admin',
      app: 'ecoaudit',
      role: 'admin',
    });
    const missingRefresh = await app.inject({
      method: 'POST',
      url: '/v1/auth/field-session',
      headers: { authorization: `Bearer ${ecoToken}` },
    });
    assert.equal(missingRefresh.statusCode, 400);

    const fieldToken = signAccessToken({
      userId: 'field-admin',
      app: 'installhub',
      role: 'admin',
    });
    const wrongNamespace = await app.inject({
      method: 'POST',
      url: '/v1/auth/field-session',
      headers: { authorization: `Bearer ${fieldToken}` },
      payload: { refreshToken: 'field-refresh-token' },
    });
    assert.equal(wrongNamespace.statusCode, 403);
    assert.equal(
      wrongNamespace.json().detail,
      'A signed-in Eco Audit or Solar Sense user is required',
    );
  });
});

test('legacy user-management routes retain their app and admin boundaries', async () => {
  await withRegisteredApp(async (app) => {
    const cases: Array<{
      app: Extract<App, 'ecoaudit' | 'solarsense' | 'installhub'>;
      otherApp: Extract<App, 'ecoaudit' | 'solarsense' | 'installhub'>;
      url: string;
    }> = [
      {
        app: 'ecoaudit',
        otherApp: 'solarsense',
        url: '/v1/ecoaudit/users',
      },
      {
        app: 'solarsense',
        otherApp: 'ecoaudit',
        url: '/v1/solarsense/users',
      },
      {
        app: 'installhub',
        otherApp: 'ecoaudit',
        url: '/v1/installhub/users',
      },
    ];

    for (const item of cases) {
      const inspectorToken = signAccessToken({
        userId: `${item.app}-inspector`,
        app: item.app,
        role: 'inspector',
      });
      const inspector = await app.inject({
        method: 'GET',
        url: item.url,
        headers: { authorization: `Bearer ${inspectorToken}` },
      });
      assert.equal(inspector.statusCode, 403);
      assert.equal(inspector.json().error, 'Forbidden');
      assert.equal(inspector.json().detail, 'Requires admin role');

      const otherAppAdminToken = signAccessToken({
        userId: `${item.otherApp}-admin`,
        app: item.otherApp,
        role: 'admin',
      });
      const otherAppAdmin = await app.inject({
        method: 'GET',
        url: item.url,
        headers: { authorization: `Bearer ${otherAppAdminToken}` },
      });
      assert.equal(otherAppAdmin.statusCode, 403);
      assert.equal(otherAppAdmin.json().error, 'Forbidden');
      assert.equal(
        otherAppAdmin.json().detail,
        'Wrong application namespace',
      );
    }
  });
});

test('EcoAudit admin credentials produce a separate Field admin namespace', async (t) => {
  const sourceAdmin: FieldSourceUser = {
    app: 'ecoaudit',
    id: 'eco-admin',
    identityId: 'legacy:ecoaudit:eco-admin',
    email: 'admin@ecoaudit.users.local',
    passwordHash: 'eco-admin-hash',
    fullName: 'Eco Administrator',
    role: 'admin',
    isActive: true,
  };
  const matched = await verifyFieldSourceUser(
    [sourceAdmin, null],
    'correct-password',
    async (password, hash) => (
      password === 'correct-password' && hash === sourceAdmin.passwordHash
    ),
    'ecoaudit',
  );
  assert.equal(matched?.role, 'admin');

  const fieldUser = fieldBridgeIdentity(sourceAdmin);
  const fieldToken = signAccessToken({
    userId: fieldUser.id,
    app: 'installhub',
    role: matched?.role ?? 'inspector',
  });
  const fieldClaims = verifyAccessToken(fieldToken);
  assert.equal(fieldClaims?.userId, fieldUser.id);
  assert.equal(fieldClaims?.app, 'installhub');
  assert.equal(fieldClaims?.role, 'admin');

  const app = Fastify({ logger: false });
  t.after(() => app.close());
  app.get('/field-admin-contract', {
    preHandler: [
      authenticate,
      requireApp('installhub'),
      requireRole('admin'),
    ],
  }, async (request) => ({
    app: request.user.app,
    role: request.user.role,
  }));
  await app.ready();

  const accepted = await app.inject({
    method: 'GET',
    url: '/field-admin-contract',
    headers: { authorization: `Bearer ${fieldToken}` },
  });
  assert.equal(accepted.statusCode, 200);
  assert.deepEqual(accepted.json(), {
    app: 'installhub',
    role: 'admin',
  });

  const ecoToken = signAccessToken({
    userId: sourceAdmin.id,
    app: 'ecoaudit',
    role: 'admin',
  });
  const rejectedCrossNamespace = await app.inject({
    method: 'GET',
    url: '/field-admin-contract',
    headers: { authorization: `Bearer ${ecoToken}` },
  });
  assert.equal(rejectedCrossNamespace.statusCode, 403);
});
