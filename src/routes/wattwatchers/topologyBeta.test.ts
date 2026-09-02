import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { signAccessToken } from '../../auth/jwt.js';
import { normalizeLoopbackServiceUrl, parseLoopbackServiceTimeoutMs } from '../../config.js';
import { wattwatchersTopologyBetaRoutes } from './topologyBeta.js';

function bearer(input: {
  app: 'ecoaudit' | 'wattwatchers';
  role: 'viewer' | 'admin';
}) {
  return {
    authorization: `Bearer ${signAccessToken({
      userId: `${input.app}-${input.role}`,
      app: input.app,
      role: input.role,
    })}`,
  };
}

async function withApp(
  options: Parameters<typeof wattwatchersTopologyBetaRoutes>[1],
  run: (app: ReturnType<typeof Fastify>) => Promise<void>,
) {
  const app = Fastify();
  await app.register(wattwatchersTopologyBetaRoutes, {
    prefix: '/v1/wattwatchers/topology-beta',
    ...options,
  });
  await app.ready();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

test('topology beta URL configuration accepts loopback only', () => {
  assert.equal(
    normalizeLoopbackServiceUrl('BETA_URL', ' http://127.0.0.1:8765/ '),
    'http://127.0.0.1:8765',
  );
  assert.throws(
    () => normalizeLoopbackServiceUrl('BETA_URL', 'https://beta.example.test'),
    /loopback/u,
  );
  assert.throws(
    () => normalizeLoopbackServiceUrl('BETA_URL', 'http://user:secret@localhost:8765'),
    /credential-free/u,
  );
  assert.equal(parseLoopbackServiceTimeoutMs('10'), 1_000);
  assert.equal(parseLoopbackServiceTimeoutMs('999999'), 120_000);
});

test('topology beta reads require a Wattwatchers viewer and proxy JSON only', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ sites: [{ locationId: 'site-1' }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  await withApp({ baseUrl: 'http://127.0.0.1:8765', fetchImpl }, async (app) => {
    const url = '/v1/wattwatchers/topology-beta/sites';
    assert.equal((await app.inject({ method: 'GET', url })).statusCode, 401);
    assert.equal((await app.inject({
      method: 'GET',
      url,
      headers: bearer({ app: 'ecoaudit', role: 'admin' }),
    })).statusCode, 403);

    const response = await app.inject({
      method: 'GET',
      url,
      headers: bearer({ app: 'wattwatchers', role: 'viewer' }),
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.deepEqual(response.json(), { sites: [{ locationId: 'site-1' }] });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'http://127.0.0.1:8765/api/sites');
    assert.equal(calls[0]?.init?.headers instanceof Headers, false);
  });
});

test('topology reconstruction controls are admin-only and preserve the validated payload', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ location: { locationId: 'beta-devices-1' } }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  };
  await withApp({ baseUrl: 'http://127.0.0.1:8765', fetchImpl }, async (app) => {
    const url = '/v1/wattwatchers/topology-beta/reconstructions/start';
    const payload = { locationId: null, deviceIds: ['DDF1', 'DDF2'] };
    assert.equal((await app.inject({
      method: 'POST',
      url,
      headers: bearer({ app: 'wattwatchers', role: 'viewer' }),
      payload,
    })).statusCode, 403);
    assert.equal(calls.length, 0);

    const response = await app.inject({
      method: 'POST',
      url,
      headers: bearer({ app: 'wattwatchers', role: 'admin' }),
      payload,
    });
    assert.equal(response.statusCode, 202, response.body);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, 'http://127.0.0.1:8765/api/reconstructions/start');
    assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), payload);
  });
});

test('topology beta fails closed when no loopback service is configured', async () => {
  await withApp({ baseUrl: '' }, async (app) => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/wattwatchers/topology-beta/sites',
      headers: bearer({ app: 'wattwatchers', role: 'viewer' }),
    });
    assert.equal(response.statusCode, 503, response.body);
  });
});
