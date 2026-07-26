import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AuthError as EcoAuthError,
  clearTokens as clearEcoTokens,
  getStoredJwt as getEcoJwt,
  request as ecoRequest,
  saveTokens as saveEcoTokens,
  subscribeAuthSession as subscribeEcoSession,
  type AuthSessionEvent,
} from '../api/client';
import {
  AuthError as SolarAuthError,
  clearTokens as clearSolarTokens,
  getStoredJwt as getSolarJwt,
  request as solarRequest,
  saveTokens as saveSolarTokens,
  subscribeAuthSession as subscribeSolarSession,
} from '../modules/solar/api/client';
import {
  InstallHubAuthError,
  clearTokens as clearInstallHubTokens,
  getStoredJwt as getInstallHubJwt,
  installHubRequest,
  saveTokens as saveInstallHubTokens,
  subscribeAuthSession as subscribeInstallHubSession,
  type InstallHubAuthSessionEvent,
} from '../modules/installhub/api/client';

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
}

function installBrowserGlobals(): () => void {
  const originalStorage = globalThis.localStorage;
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryStorage(),
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
  return () => {
    if (originalStorage === undefined) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalStorage,
      });
    }
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  };
}

test('app clients notify same-window token save and clear events', () => {
  const restoreBrowserGlobals = installBrowserGlobals();

  const ecoEvents: AuthSessionEvent[] = [];
  const solarEvents: AuthSessionEvent[] = [];
  const installHubEvents: InstallHubAuthSessionEvent[] = [];
  const unsubscribeEco = subscribeEcoSession((event) => ecoEvents.push(event));
  const unsubscribeSolar = subscribeSolarSession((event) => solarEvents.push(event));
  const unsubscribeInstallHub = subscribeInstallHubSession((event) =>
    installHubEvents.push(event),
  );

  try {
    saveEcoTokens('eco-access', 'eco-refresh');
    saveSolarTokens('solar-access', 'solar-refresh');
    saveInstallHubTokens('installhub-access', 'installhub-refresh');
    assert.equal(getEcoJwt(), 'eco-access');
    assert.equal(getSolarJwt(), 'solar-access');
    assert.equal(getInstallHubJwt(), 'installhub-access');
    clearEcoTokens();
    clearSolarTokens();
    clearInstallHubTokens();
    assert.deepEqual(ecoEvents, ['saved', 'cleared']);
    assert.deepEqual(solarEvents, ['saved', 'cleared']);
    assert.deepEqual(installHubEvents, ['saved', 'cleared']);
  } finally {
    unsubscribeEco();
    unsubscribeSolar();
    unsubscribeInstallHub();
    restoreBrowserGlobals();
  }
});

test('first 401 clears a matching stale access token when no refresh token exists', async () => {
  const restoreBrowserGlobals = installBrowserGlobals();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 401 });
  const ecoEvents: AuthSessionEvent[] = [];
  const solarEvents: AuthSessionEvent[] = [];
  const installHubEvents: InstallHubAuthSessionEvent[] = [];
  const unsubscribeEco = subscribeEcoSession((event) => ecoEvents.push(event));
  const unsubscribeSolar = subscribeSolarSession((event) => solarEvents.push(event));
  const unsubscribeInstallHub = subscribeInstallHubSession((event) =>
    installHubEvents.push(event),
  );

  try {
    saveEcoTokens('eco-stale', 'eco-refresh');
    localStorage.removeItem('ea_web_refresh');
    await assert.rejects(() => ecoRequest('GET', '/v1/auth/me'), EcoAuthError);
    assert.equal(getEcoJwt(), null);

    saveSolarTokens('solar-stale', 'solar-refresh');
    localStorage.removeItem('ss_web_refresh');
    await assert.rejects(() => solarRequest('GET', '/v1/auth/me'), SolarAuthError);
    assert.equal(getSolarJwt(), null);

    saveInstallHubTokens('installhub-stale', 'installhub-refresh');
    localStorage.removeItem('ih_web_refresh');
    await assert.rejects(
      () => installHubRequest('GET', '/v1/auth/me'),
      InstallHubAuthError,
    );
    assert.equal(getInstallHubJwt(), null);

    assert.deepEqual(ecoEvents, ['saved', 'cleared']);
    assert.deepEqual(solarEvents, ['saved', 'cleared']);
    assert.deepEqual(installHubEvents, ['saved', 'cleared']);
  } finally {
    unsubscribeEco();
    unsubscribeSolar();
    unsubscribeInstallHub();
    globalThis.fetch = originalFetch;
    restoreBrowserGlobals();
  }
});

test('a token rotated during a failed refresh is not cleared by the stale 401', async () => {
  const restoreBrowserGlobals = installBrowserGlobals();
  const originalFetch = globalThis.fetch;

  try {
    saveEcoTokens('eco-old', 'eco-old-refresh');
    globalThis.fetch = async (input) => {
      if (String(input).endsWith('/v1/auth/refresh')) {
        localStorage.setItem('ea_web_jwt', 'eco-rotated');
        localStorage.setItem('ea_web_refresh', 'eco-rotated-refresh');
      }
      return new Response(null, { status: 401 });
    };
    await assert.rejects(() => ecoRequest('GET', '/v1/auth/me'), EcoAuthError);
    assert.equal(getEcoJwt(), 'eco-rotated');

    saveSolarTokens('solar-old', 'solar-old-refresh');
    globalThis.fetch = async (input) => {
      if (String(input).endsWith('/v1/auth/refresh')) {
        localStorage.setItem('ss_web_jwt', 'solar-rotated');
        localStorage.setItem('ss_web_refresh', 'solar-rotated-refresh');
      }
      return new Response(null, { status: 401 });
    };
    await assert.rejects(() => solarRequest('GET', '/v1/auth/me'), SolarAuthError);
    assert.equal(getSolarJwt(), 'solar-rotated');

    saveInstallHubTokens('installhub-old', 'installhub-old-refresh');
    globalThis.fetch = async (input) => {
      if (String(input).endsWith('/v1/auth/refresh')) {
        localStorage.setItem('ih_web_jwt', 'installhub-rotated');
        localStorage.setItem('ih_web_refresh', 'installhub-rotated-refresh');
      }
      return new Response(null, { status: 401 });
    };
    await assert.rejects(
      () => installHubRequest('GET', '/v1/auth/me'),
      InstallHubAuthError,
    );
    assert.equal(getInstallHubJwt(), 'installhub-rotated');
  } finally {
    globalThis.fetch = originalFetch;
    restoreBrowserGlobals();
  }
});
