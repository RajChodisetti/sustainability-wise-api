import assert from 'node:assert/strict';
import test from 'node:test';
import type { App } from './jwt.js';
import {
  collectPortalLoginSessions,
  type PortalAppLogin,
} from './portalLoginSessions.js';

interface TestEnvelope {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    fullName: string | null;
    role: string;
    app: App;
    sourceManaged?: boolean;
    sourceApp?: 'ecoaudit' | 'solarsense' | null;
  };
}

function legacyEnvelope(app: App): TestEnvelope {
  return {
    accessToken: `${app}-access`,
    refreshToken: `${app}-refresh`,
    expiresIn: 900,
    user: {
      id: `${app}-user`,
      email: `user@${app}.users.local`,
      fullName: `${app} User`,
      role: app === 'wattwatchers' ? 'viewer' : 'inspector',
      app,
    },
  };
}

test('bundled login preserves each successful legacy response envelope verbatim', async () => {
  const envelopes = Object.fromEntries(
    (['ecoaudit', 'solarsense', 'installhub', 'wattwatchers'] as const)
      .map((app) => [app, legacyEnvelope(app)]),
  ) as Record<App, TestEnvelope>;
  const login: PortalAppLogin<TestEnvelope> = async (app) => envelopes[app];

  const sessions = await collectPortalLoginSessions(login);

  assert.deepEqual(sessions, envelopes);
  for (const app of Object.keys(envelopes) as App[]) {
    assert.strictEqual(sessions[app], envelopes[app]);
  }
});

test('a failed target creates no secondary sessions or login attempts', async () => {
  const calls: App[] = [];
  const targetError = new Error('target rejected');
  const login: PortalAppLogin<TestEnvelope> = async (app) => {
    calls.push(app);
    throw targetError;
  };

  await assert.rejects(
    collectPortalLoginSessions(login, 'ecoaudit'),
    (error) => error === targetError,
  );
  assert.deepEqual(calls, ['ecoaudit']);
});

test('a targeted login skips existing secondary sessions without skipping its target', async () => {
  const calls: App[] = [];
  const login: PortalAppLogin<TestEnvelope> = async (app) => {
    calls.push(app);
    return legacyEnvelope(app);
  };

  const sessions = await collectPortalLoginSessions(
    login,
    'ecoaudit',
    ['ecoaudit', 'solarsense', 'wattwatchers'],
  );

  assert.deepEqual(calls.sort(), ['ecoaudit', 'installhub']);
  assert.deepEqual(Object.keys(sessions).sort(), ['ecoaudit', 'installhub']);
});

for (const target of ['ecoaudit', 'solarsense'] as const) {
  test(`targeted ${target} login forces that source membership into Field`, async () => {
    const calls: Array<{
      app: App;
      fieldSourceHint: 'ecoaudit' | 'solarsense' | null | undefined;
    }> = [];
    const sourceEnvelope = legacyEnvelope(target);
    const fieldEnvelope: TestEnvelope = {
      ...legacyEnvelope('installhub'),
      user: {
        ...legacyEnvelope('installhub').user,
        email: sourceEnvelope.user.email,
        role: sourceEnvelope.user.role,
        sourceManaged: true,
        sourceApp: target,
      },
    };
    const login: PortalAppLogin<TestEnvelope> = async (
      app,
      fieldSourceHint,
    ) => {
      calls.push({ app, fieldSourceHint });
      if (app === target) return sourceEnvelope;
      if (app === 'installhub' && fieldSourceHint === target) {
        return fieldEnvelope;
      }
      throw new Error('not authorised');
    };

    const sessions = await collectPortalLoginSessions(login, target);

    assert.strictEqual(sessions[target], sourceEnvelope);
    assert.strictEqual(sessions.installhub, fieldEnvelope);
    assert.deepEqual(sessions.installhub?.user, {
      ...legacyEnvelope('installhub').user,
      email: sourceEnvelope.user.email,
      role: sourceEnvelope.user.role,
      sourceManaged: true,
      sourceApp: target,
    });
    assert.ok(calls.some((call) => (
      call.app === 'installhub' && call.fieldSourceHint === target
    )));
  });
}

test('untargeted duplicate source matches do not retry Field with an arbitrary source', async () => {
  const calls: Array<{
    app: App;
    fieldSourceHint: 'ecoaudit' | 'solarsense' | null | undefined;
  }> = [];
  const login: PortalAppLogin<TestEnvelope> = async (
    app,
    fieldSourceHint,
  ) => {
    calls.push({ app, fieldSourceHint });
    if (app === 'ecoaudit' || app === 'solarsense') {
      return legacyEnvelope(app);
    }
    throw new Error('not authorised');
  };

  const sessions = await collectPortalLoginSessions(login);

  assert.deepEqual(Object.keys(sessions).sort(), ['ecoaudit', 'solarsense']);
  assert.equal(
    calls.filter((call) => call.app === 'installhub').length,
    1,
  );
  assert.equal(
    calls.some((call) => call.app === 'installhub' && call.fieldSourceHint),
    false,
  );
});

test('one untargeted source session retries Field with exact provenance', async () => {
  const calls: Array<{
    app: App;
    fieldSourceHint: 'ecoaudit' | 'solarsense' | null | undefined;
  }> = [];
  const fieldEnvelope: TestEnvelope = {
    ...legacyEnvelope('installhub'),
    user: {
      ...legacyEnvelope('installhub').user,
      email: 'solar@example.com',
      role: 'admin',
      sourceManaged: true,
      sourceApp: 'solarsense',
    },
  };
  const login: PortalAppLogin<TestEnvelope> = async (
    app,
    fieldSourceHint,
  ) => {
    calls.push({ app, fieldSourceHint });
    if (app === 'solarsense') return legacyEnvelope('solarsense');
    if (app === 'installhub' && fieldSourceHint === 'solarsense') {
      return fieldEnvelope;
    }
    throw new Error('not authorised');
  };

  const sessions = await collectPortalLoginSessions(login);

  assert.strictEqual(sessions.installhub, fieldEnvelope);
  assert.equal(
    calls.filter((call) => call.app === 'installhub').length,
    2,
  );
  assert.ok(calls.some((call) => (
    call.app === 'installhub' && call.fieldSourceHint === 'solarsense'
  )));
});
