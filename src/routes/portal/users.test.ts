import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { signAccessToken } from '../../auth/jwt.js';
import {
  portalUserRoutes,
  type PortalUserBillingRateStore,
} from './users.js';
import { forbidden } from '../../utils/errors.js';

function authorization(app: 'ecoaudit' | 'solarsense' | 'installhub' | 'wattwatchers', role: 'admin' | 'inspector') {
  return {
    authorization: `Bearer ${signAccessToken({
      userId: `${app}-${role}`,
      app,
      role,
    })}`,
  };
}

test('canonical billing-rate route preserves portal application and admin gates', async () => {
  const calls: Array<{ globalUserId: string; billingRateCents: number | null }> = [];
  const billingRateStore: PortalUserBillingRateStore = {
    async updateUserBillingRate(globalUserId, billingRateCents) {
      calls.push({ globalUserId, billingRateCents });
      return { globalUserId, billingRateCents };
    },
  };
  const app = Fastify();
  await app.register(portalUserRoutes, {
    prefix: '/v1/portal',
    billingRateStore,
    authorizeBillingRateAdmin: async () => {},
  });
  await app.ready();

  const url = '/v1/portal/users/global-user-1/billing-rate';
  try {
    assert.equal(app.hasRoute({
      method: 'PATCH',
      url: '/v1/portal/users/:globalUserId/billing-rate',
    }), true);

    const unauthenticated = await app.inject({
      method: 'PATCH',
      url,
      payload: { billingRate: 123.45 },
    });
    assert.equal(unauthenticated.statusCode, 401);

    const inspector = await app.inject({
      method: 'PATCH',
      url,
      headers: authorization('ecoaudit', 'inspector'),
      payload: { billingRate: 123.45 },
    });
    assert.equal(inspector.statusCode, 403);

    const wrongApp = await app.inject({
      method: 'PATCH',
      url,
      headers: authorization('wattwatchers', 'admin'),
      payload: { billingRate: 123.45 },
    });
    assert.equal(wrongApp.statusCode, 403);
    assert.deepEqual(calls, []);

    const admin = await app.inject({
      method: 'PATCH',
      url,
      headers: authorization('ecoaudit', 'admin'),
      payload: { billingRate: 123.456 },
    });
    assert.equal(admin.statusCode, 200, admin.body);
    assert.deepEqual(admin.json(), {
      globalUserId: 'global-user-1',
      billingRate: 123.46,
    });
    assert.deepEqual(calls, [{
      globalUserId: 'global-user-1',
      billingRateCents: 12_346,
    }]);
  } finally {
    await app.close();
  }
});

test('canonical billing-rate route clears rates and supports inactive historical users', async () => {
  const calls: Array<{ globalUserId: string; billingRateCents: number | null }> = [];
  const billingRateStore: PortalUserBillingRateStore = {
    async updateUserBillingRate(globalUserId, billingRateCents) {
      calls.push({ globalUserId, billingRateCents });
      return { globalUserId, billingRateCents };
    },
  };
  const app = Fastify();
  await app.register(portalUserRoutes, {
    prefix: '/v1/portal',
    billingRateStore,
    authorizeBillingRateAdmin: async () => {},
  });
  await app.ready();

  try {
    const cleared = await app.inject({
      method: 'PATCH',
      url: '/v1/portal/users/global-user-1/billing-rate',
      headers: authorization('solarsense', 'admin'),
      payload: { billingRate: null },
    });
    assert.equal(cleared.statusCode, 200, cleared.body);
    assert.deepEqual(cleared.json(), {
      globalUserId: 'global-user-1',
      billingRate: null,
    });

    const inactive = await app.inject({
      method: 'PATCH',
      url: '/v1/portal/users/inactive-user/billing-rate',
      headers: authorization('installhub', 'admin'),
      payload: { billingRate: 100 },
    });
    assert.equal(inactive.statusCode, 200, inactive.body);
    assert.deepEqual(inactive.json(), {
      globalUserId: 'inactive-user',
      billingRate: 100,
    });
    assert.deepEqual(calls, [
      { globalUserId: 'global-user-1', billingRateCents: null },
      { globalUserId: 'inactive-user', billingRateCents: 10_000 },
    ]);
  } finally {
    await app.close();
  }
});

test('canonical billing-rate route rejects invalid and unsafe money values', async () => {
  let calls = 0;
  const billingRateStore: PortalUserBillingRateStore = {
    async updateUserBillingRate(globalUserId, billingRateCents) {
      calls += 1;
      return { globalUserId, billingRateCents };
    },
  };
  const app = Fastify();
  await app.register(portalUserRoutes, {
    prefix: '/v1/portal',
    billingRateStore,
    authorizeBillingRateAdmin: async () => {},
  });
  await app.ready();
  const url = '/v1/portal/users/global-user-1/billing-rate';
  const headers = authorization('ecoaudit', 'admin');

  try {
    for (const payload of [
      {},
      { billingRate: -1 },
      { billingRate: '100' },
      { billingRate: 100, ignored: true },
      { billingRate: Number.MAX_SAFE_INTEGER },
    ]) {
      const response = await app.inject({ method: 'PATCH', url, headers, payload });
      assert.equal(response.statusCode, 400, response.body);
    }
    assert.equal(calls, 0);
  } finally {
    await app.close();
  }
});

test('canonical billing-rate mutation revalidates the active canonical administrator', async () => {
  let writes = 0;
  const app = Fastify();
  await app.register(portalUserRoutes, {
    prefix: '/v1/portal',
    billingRateStore: {
      async updateUserBillingRate(
        globalUserId: string,
        billingRateCents: number | null,
      ) {
        writes += 1;
        return { globalUserId, billingRateCents };
      },
    },
    authorizeBillingRateAdmin: async () => {
      throw forbidden('Only active global administrators can change billing rates');
    },
  });
  await app.ready();

  try {
    const response = await app.inject({
      method: 'PATCH',
      url: '/v1/portal/users/global-user-1/billing-rate',
      headers: authorization('ecoaudit', 'admin'),
      payload: { billingRate: 100 },
    });
    assert.equal(response.statusCode, 403, response.body);
    assert.equal(writes, 0);
  } finally {
    await app.close();
  }
});
