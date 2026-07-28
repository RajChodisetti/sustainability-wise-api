import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PortalLoginHttpError,
  PortalLoginNetworkError,
  PortalLoginResponseError,
  applyPortalLoginSessions,
  isPortalLoginUnavailable,
  rankedFieldSessionSources,
  requestFieldSession,
  requestFieldSessionFromSources,
  requestPortalLogin,
  shouldApplyPortalLoginSession,
  type PortalLoginHandlers,
  type PortalLoginResponse,
} from './portalLogin';

const ecoSession = {
  accessToken: 'eco-access',
  refreshToken: 'eco-refresh',
  expiresIn: 900,
  user: {
    id: 'eco-user',
    email: 'shared@ecoaudit.users.local',
    fullName: 'Shared User',
    role: 'admin' as const,
    isActive: true,
  },
};

const installHubSession = {
  accessToken: 'field-access',
  refreshToken: 'field-refresh',
  expiresIn: 900,
  user: {
    id: 'field-user',
    email: 'shared@installhub.users.local',
    fullName: 'Shared User',
    role: 'admin' as const,
    isActive: true,
  },
};

test('portal login sends the raw identity and optional target', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return Response.json({ sessions: { installhub: installHubSession } });
  };

  const response = await requestPortalLogin(
    {
      email: '  Field.User@Example.COM  ',
      password: 'correct horse battery staple',
      target: 'installhub',
      skipApps: ['ecoaudit', 'solarsense'],
    },
    fetcher,
  );

  assert.equal(requestUrl, '/v1/auth/portal-login');
  assert.equal(requestInit?.method, 'POST');
  assert.deepEqual(
    JSON.parse(String(requestInit?.body)),
    {
      email: '  Field.User@Example.COM  ',
      password: 'correct horse battery staple',
      target: 'installhub',
      skipApps: ['ecoaudit', 'solarsense'],
    },
  );
  assert.equal(response.sessions.installhub?.user.id, 'field-user');
});

test('shared portal login omits target and succeeds with any app session', async () => {
  let requestBody: Record<string, unknown> = {};
  const response = await requestPortalLogin(
    { email: 'shared-user', password: 'password' },
    async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ sessions: { ecoaudit: ecoSession } });
    },
  );

  assert.equal(Object.hasOwn(requestBody, 'target'), false);
  assert.equal(Object.hasOwn(requestBody, 'skipApps'), false);
  assert.equal(response.sessions.ecoaudit?.user.id, 'eco-user');
});

test('Field session exchange uses the existing source bearer token', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const session = await requestFieldSession(
    'existing-eco-access',
    'existing-eco-refresh',
    async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json(installHubSession);
    },
  );

  assert.equal(requestUrl, '/v1/auth/field-session');
  assert.equal(requestInit?.method, 'POST');
  assert.equal(
    new Headers(requestInit?.headers).get('Authorization'),
    'Bearer existing-eco-access',
  );
  assert.deepEqual(
    JSON.parse(String(requestInit?.body)),
    { refreshToken: 'existing-eco-refresh' },
  );
  assert.equal(session.user.id, 'field-user');
});

test('Field source ranking prefers an administrator and uses Eco Audit as the stable tie-breaker', () => {
  const solarAdmin = rankedFieldSessionSources({
    ecoAccessToken: 'eco-token',
    ecoRefreshToken: 'eco-refresh',
    ecoAuthenticated: true,
    ecoRole: 'inspector',
    solarAccessToken: 'solar-token',
    solarRefreshToken: 'solar-refresh',
    solarAuthenticated: true,
    solarRole: 'admin',
  });
  assert.deepEqual(solarAdmin.map((source) => source.app), [
    'solarsense',
    'ecoaudit',
  ]);

  const equalRoles = rankedFieldSessionSources({
    ecoAccessToken: 'eco-token',
    ecoRefreshToken: 'eco-refresh',
    ecoAuthenticated: true,
    ecoRole: 'admin',
    solarAccessToken: 'solar-token',
    solarRefreshToken: 'solar-refresh',
    solarAuthenticated: true,
    solarRole: 'admin',
  });
  assert.deepEqual(equalRoles.map((source) => source.app), [
    'ecoaudit',
    'solarsense',
  ]);
});

test('Field source ranking waits for every populated source session to resolve', () => {
  assert.deepEqual(rankedFieldSessionSources({
    ecoAccessToken: 'pending-eco-token',
    ecoRefreshToken: 'eco-refresh',
    ecoAuthenticated: false,
    ecoRole: null,
    solarAccessToken: 'solar-token',
    solarRefreshToken: 'solar-refresh',
    solarAuthenticated: true,
    solarRole: 'admin',
  }), []);

  const solarOnly = rankedFieldSessionSources({
    ecoAccessToken: null,
    ecoRefreshToken: null,
    ecoAuthenticated: false,
    ecoRole: null,
    solarAccessToken: 'solar-token',
    solarRefreshToken: 'solar-refresh',
    solarAuthenticated: true,
    solarRole: 'admin',
  });
  assert.deepEqual(solarOnly.map((source) => source.app), ['solarsense']);
});

test('Field session exchange skips a source without refresh binding and opens the next one', async () => {
  const attempts: string[] = [];
  const result = await requestFieldSessionFromSources([
    {
      app: 'ecoaudit',
      accessToken: 'eco-access',
      refreshToken: null,
    },
    {
      app: 'solarsense',
      accessToken: 'solar-access',
      refreshToken: 'solar-refresh',
    },
  ], async (accessToken) => {
    attempts.push(accessToken);
    return installHubSession;
  });

  assert.deepEqual(attempts, ['solar-access']);
  assert.equal(result?.sourceApp, 'solarsense');
});

test('Field session exchange automatically falls back when the preferred source fails', async () => {
  const attempts: string[] = [];
  const result = await requestFieldSessionFromSources([
    {
      app: 'ecoaudit',
      accessToken: 'eco-access',
      refreshToken: 'eco-refresh',
    },
    {
      app: 'solarsense',
      accessToken: 'solar-access',
      refreshToken: 'solar-refresh',
    },
  ], async (accessToken) => {
    attempts.push(accessToken);
    if (accessToken === 'eco-access') throw new Error('Eco session revoked');
    return installHubSession;
  });

  assert.deepEqual(attempts, ['eco-access', 'solar-access']);
  assert.equal(result?.sourceApp, 'solarsense');
});

test('Field session fallback stops when logout invalidates the active attempt', async () => {
  const attempts: string[] = [];
  let current = true;
  const result = await requestFieldSessionFromSources([
    {
      app: 'ecoaudit',
      accessToken: 'eco-access',
      refreshToken: 'eco-refresh',
    },
    {
      app: 'solarsense',
      accessToken: 'solar-access',
      refreshToken: 'solar-refresh',
    },
  ], async (accessToken) => {
    attempts.push(accessToken);
    current = false;
    throw new Error('Request completed after logout');
  }, () => current);

  assert.equal(result, null);
  assert.deepEqual(attempts, ['eco-access']);
});

test('Field session exchange rejects a malformed auth envelope', async () => {
  await assert.rejects(
    () => requestFieldSession(
      'existing-solar-access',
      'existing-solar-refresh',
      async () => Response.json({ ok: true }),
    ),
    PortalLoginResponseError,
  );
});

test('session application only touches apps returned by the server', () => {
  const touched: string[] = [];
  const handlers: PortalLoginHandlers = {
    ecoaudit: (session) => touched.push(`eco:${session.accessToken}`),
    solarsense: (session) => touched.push(`solar:${session.accessToken}`),
    installhub: (session) => touched.push(`field:${session.accessToken}`),
    wattwatchers: (session) => touched.push(`fleet:${session.accessToken}`),
  };
  const response: PortalLoginResponse = {
    sessions: {
      ecoaudit: ecoSession,
      installhub: installHubSession,
    },
  };

  assert.deepEqual(
    applyPortalLoginSessions(response, handlers),
    ['ecoaudit', 'installhub'],
  );
  assert.deepEqual(touched, ['eco:eco-access', 'field:field-access']);
});

test('targeted login preserves an existing secondary app session', () => {
  assert.equal(
    shouldApplyPortalLoginSession('ecoaudit', 'ecoaudit', true),
    true,
  );
  assert.equal(
    shouldApplyPortalLoginSession('ecoaudit', 'solarsense', true),
    false,
  );
  assert.equal(
    shouldApplyPortalLoginSession('ecoaudit', 'installhub', false),
    true,
  );
  assert.equal(
    shouldApplyPortalLoginSession(null, 'solarsense', true),
    true,
  );
});

test('targeted login rejects a successful response without the target session', async () => {
  await assert.rejects(
    () =>
      requestPortalLogin(
        {
          email: 'shared-user',
          password: 'password',
          target: 'installhub',
        },
        async () => Response.json({ sessions: { ecoaudit: ecoSession } }),
      ),
    PortalLoginResponseError,
  );
});

test('shared login rejects a successful response with no sessions', async () => {
  await assert.rejects(
    () =>
      requestPortalLogin(
        { email: 'shared-user', password: 'password' },
        async () => Response.json({ sessions: {} }),
      ),
    PortalLoginResponseError,
  );
});

test('legacy fan-out is allowed only for endpoint-not-supported statuses', () => {
  for (const status of [404, 405, 501]) {
    assert.equal(
      isPortalLoginUnavailable(new PortalLoginHttpError('Unavailable', status)),
      true,
    );
  }
  for (const status of [400, 401, 403, 409, 500, 502, 503]) {
    assert.equal(
      isPortalLoginUnavailable(new PortalLoginHttpError('Failure', status)),
      false,
    );
  }
  assert.equal(
    isPortalLoginUnavailable(new PortalLoginNetworkError('Network failure')),
    false,
  );
  assert.equal(
    isPortalLoginUnavailable(new PortalLoginResponseError('Bad response')),
    false,
  );
});

test('portal login exposes the server status and error detail', async () => {
  await assert.rejects(
    () =>
      requestPortalLogin(
        { email: 'shared-user', password: 'wrong' },
        async () =>
          Response.json(
            { error: 'Invalid email or password.' },
            { status: 401 },
          ),
      ),
    (error: unknown) => {
      assert.ok(error instanceof PortalLoginHttpError);
      assert.equal(error.status, 401);
      assert.equal(error.detail, 'Invalid email or password.');
      assert.equal(isPortalLoginUnavailable(error), false);
      return true;
    },
  );
});
