'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getStoredJwt as getEaJwt,
  getStoredRefreshToken as getEaRefreshToken,
  clearTokens as clearEaTokens,
  saveTokens as saveEaTokens,
  subscribeAuthSession as subscribeEaAuthSession,
} from '@/api/client';
import {
  loginWithUsername as eaLogin,
  logout as eaLogoutApi,
  me as eaMe,
  registerAccount as eaRegister,
} from '@/api/auth';
import {
  getStoredJwt as getSsJwt,
  getStoredRefreshToken as getSsRefreshToken,
  clearTokens as clearSsTokens,
  saveTokens as saveSsTokens,
  subscribeAuthSession as subscribeSsAuthSession,
} from '@solar/api/client';
import {
  loginWithUsername as ssLogin,
  logout as ssLogoutApi,
  me as ssMe,
  registerAccount as ssRegister,
} from '@solar/api/auth';
import {
  getStoredJwt as getWwJwt,
  clearTokens as clearWwTokens,
  saveTokens as saveWwTokens,
  subscribeAuthSession as subscribeWwAuthSession,
} from '@/modules/fleet/api/client';
import {
  loginWithUsername as wwLogin,
  logout as wwLogoutApi,
  me as wwMe,
} from '@/modules/fleet/api/auth';
import {
  getStoredJwt as getIhJwt,
  clearTokens as clearIhTokens,
  saveTokens as saveIhTokens,
  subscribeAuthSession as subscribeIhAuthSession,
} from '@/modules/installhub/api/client';
import {
  loginWithUsername as ihLogin,
  logout as ihLogoutApi,
  me as ihMe,
} from '@/modules/installhub/api/auth';
import type { CloudUser } from '@/types/domain';
import type { CloudUser as SolarCloudUser } from '@solar/types/domain';
import type { FleetUser } from '@/modules/fleet/types/domain';
import type { InstallHubUser } from '@/modules/installhub/types/domain';
import type { PortalApp } from '@/lib/portalNavigation';
import {
  authQueryRetryDelayMs,
  isDefinitiveAuthError,
  isSessionCheckLoading,
  shouldRetryAuthQuery,
} from '@/lib/authQuery';
import {
  applyPortalLoginSessions,
  isPortalLoginUnavailable,
  rankedFieldSessionSources,
  requestFieldSession,
  requestFieldSessionFromSources,
  requestPortalLogin,
  shouldApplyPortalLoginSession,
  type FieldSessionSourceCandidate,
} from '@/api/portalLogin';

const EA_AUTH_QUERY_KEY = ['ecoaudit', 'auth', 'me'] as const;
const SS_AUTH_QUERY_KEY = ['solar', 'auth', 'me'] as const;
const IH_AUTH_QUERY_KEY = ['installhub', 'auth', 'me'] as const;
const WW_AUTH_QUERY_KEY = ['wattwatchers', 'auth', 'me'] as const;
const noServerSession = () => null;
const subscribeEaSessionSnapshot = (onStoreChange: () => void) =>
  subscribeEaAuthSession(() => onStoreChange());
const subscribeSsSessionSnapshot = (onStoreChange: () => void) =>
  subscribeSsAuthSession(() => onStoreChange());
const subscribeIhSessionSnapshot = (onStoreChange: () => void) =>
  subscribeIhAuthSession(() => onStoreChange());
const subscribeWwSessionSnapshot = (onStoreChange: () => void) =>
  subscribeWwAuthSession(() => onStoreChange());
const subscribeClientSnapshot = () => () => undefined;
const getClientSnapshot = () => true;
const getServerClientSnapshot = () => false;

type PortalAuthValue = {
  eaUser: CloudUser | null;
  ssUser: SolarCloudUser | null;
  ihUser: InstallHubUser | null;
  wwUser: FleetUser | null;
  user: CloudUser | SolarCloudUser | InstallHubUser | FleetUser | null;
  isLoading: boolean;
  isEcoLoading: boolean;
  isSolarLoading: boolean;
  isInstallHubLoading: boolean;
  isWattwatchersLoading: boolean;
  isAuthenticated: boolean;
  isEcoAuthenticated: boolean;
  isSolarAuthenticated: boolean;
  isInstallHubAuthenticated: boolean;
  isWattwatchersAuthenticated: boolean;
  hasInstallHubSourceSession: boolean;
  installHubSessionError: string | null;
  retryInstallHubSession: () => Promise<void>;
  login: (username: string, password: string, target?: PortalApp | null) => Promise<void>;
  register: (input: { username: string; password: string; fullName: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const PortalAuthContext = createContext<PortalAuthValue | null>(null);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const eaToken = useSyncExternalStore(subscribeEaSessionSnapshot, getEaJwt, noServerSession);
  const eaRefreshToken = useSyncExternalStore(
    subscribeEaSessionSnapshot,
    getEaRefreshToken,
    noServerSession,
  );
  const ssToken = useSyncExternalStore(subscribeSsSessionSnapshot, getSsJwt, noServerSession);
  const ssRefreshToken = useSyncExternalStore(
    subscribeSsSessionSnapshot,
    getSsRefreshToken,
    noServerSession,
  );
  const ihToken = useSyncExternalStore(subscribeIhSessionSnapshot, getIhJwt, noServerSession);
  const wwToken = useSyncExternalStore(subscribeWwSessionSnapshot, getWwJwt, noServerSession);
  const isClient = useSyncExternalStore(
    subscribeClientSnapshot,
    getClientSnapshot,
    getServerClientSnapshot,
  );
  const clientReady = isClient;
  const hasEa = Boolean(eaToken);
  const hasSs = Boolean(ssToken);
  const hasIh = Boolean(ihToken);
  const hasWw = Boolean(wwToken);
  const [fieldSessionExchange, setFieldSessionExchange] = useState<{
    signature: string;
    status: 'pending' | 'failed';
    error: string | null;
  } | null>(null);
  const fieldSessionAttemptRef = useRef<string | null>(null);
  const fieldSessionGenerationRef = useRef(0);

  useEffect(() => {
    const unsubscribeEa = subscribeEaAuthSession((event) => {
      if (event === 'cleared') {
        queryClient.removeQueries({ queryKey: EA_AUTH_QUERY_KEY, exact: true });
      } else {
        void queryClient.invalidateQueries({ queryKey: EA_AUTH_QUERY_KEY, exact: true });
      }
    });
    const unsubscribeSs = subscribeSsAuthSession((event) => {
      if (event === 'cleared') {
        queryClient.removeQueries({ queryKey: SS_AUTH_QUERY_KEY, exact: true });
      } else {
        void queryClient.invalidateQueries({ queryKey: SS_AUTH_QUERY_KEY, exact: true });
      }
    });
    const unsubscribeIh = subscribeIhAuthSession((event) => {
      if (event === 'cleared') {
        queryClient.removeQueries({ queryKey: IH_AUTH_QUERY_KEY, exact: true });
      } else {
        void queryClient.invalidateQueries({ queryKey: IH_AUTH_QUERY_KEY, exact: true });
      }
    });
    const unsubscribeWw = subscribeWwAuthSession((event) => {
      if (event === 'cleared') {
        queryClient.removeQueries({ queryKey: WW_AUTH_QUERY_KEY, exact: true });
      } else {
        void queryClient.invalidateQueries({ queryKey: WW_AUTH_QUERY_KEY, exact: true });
      }
    });
    return () => {
      unsubscribeEa();
      unsubscribeSs();
      unsubscribeIh();
      unsubscribeWw();
    };
  }, [queryClient]);

  const eaQuery = useQuery({
    queryKey: EA_AUTH_QUERY_KEY,
    queryFn: eaMe,
    enabled: hasEa,
    retry: (failureCount, error) =>
      shouldRetryAuthQuery(error, Boolean(getEaJwt()), failureCount),
    retryDelay: (failureCount) => authQueryRetryDelayMs(failureCount),
  });

  const ssQuery = useQuery({
    queryKey: SS_AUTH_QUERY_KEY,
    queryFn: ssMe,
    enabled: hasSs,
    retry: (failureCount, error) =>
      shouldRetryAuthQuery(error, Boolean(getSsJwt()), failureCount),
    retryDelay: (failureCount) => authQueryRetryDelayMs(failureCount),
  });

  const ihQuery = useQuery({
    queryKey: IH_AUTH_QUERY_KEY,
    queryFn: ihMe,
    enabled: hasIh,
    retry: (failureCount, error) =>
      shouldRetryAuthQuery(error, Boolean(getIhJwt()), failureCount),
    retryDelay: (failureCount) => authQueryRetryDelayMs(failureCount),
  });

  const wwQuery = useQuery({
    queryKey: WW_AUTH_QUERY_KEY,
    queryFn: wwMe,
    enabled: hasWw,
    retry: (failureCount, error) =>
      shouldRetryAuthQuery(error, Boolean(getWwJwt()), failureCount),
    retryDelay: (failureCount) => authQueryRetryDelayMs(failureCount),
  });

  // Dead / foreign sessions (prod JWT vs local API) must not pin the login UI.
  useEffect(() => {
    if (hasEa && eaQuery.isError && isDefinitiveAuthError(eaQuery.error)) {
      clearEaTokens();
      queryClient.removeQueries({ queryKey: EA_AUTH_QUERY_KEY, exact: true });
    }
  }, [hasEa, eaQuery.isError, eaQuery.error, queryClient]);
  useEffect(() => {
    if (hasSs && ssQuery.isError && isDefinitiveAuthError(ssQuery.error)) {
      clearSsTokens();
      queryClient.removeQueries({ queryKey: SS_AUTH_QUERY_KEY, exact: true });
    }
  }, [hasSs, ssQuery.isError, ssQuery.error, queryClient]);
  useEffect(() => {
    if (hasIh && ihQuery.isError && isDefinitiveAuthError(ihQuery.error)) {
      clearIhTokens();
      queryClient.removeQueries({ queryKey: IH_AUTH_QUERY_KEY, exact: true });
    }
  }, [hasIh, ihQuery.isError, ihQuery.error, queryClient]);
  useEffect(() => {
    if (hasWw && wwQuery.isError && isDefinitiveAuthError(wwQuery.error)) {
      clearWwTokens();
      queryClient.removeQueries({ queryKey: WW_AUTH_QUERY_KEY, exact: true });
    }
  }, [hasWw, wwQuery.isError, wwQuery.error, queryClient]);

  const login = useCallback(async (username: string, password: string, target?: PortalApp | null) => {
    const existingSessions: Record<PortalApp, boolean> = {
      ecoaudit: Boolean(
        getEaJwt() || queryClient.getQueryData(EA_AUTH_QUERY_KEY),
      ),
      solarsense: Boolean(
        getSsJwt() || queryClient.getQueryData(SS_AUTH_QUERY_KEY),
      ),
      installhub: Boolean(
        getIhJwt() || queryClient.getQueryData(IH_AUTH_QUERY_KEY),
      ),
      wattwatchers: Boolean(
        getWwJwt() || queryClient.getQueryData(WW_AUTH_QUERY_KEY),
      ),
    };
    const shouldApplyBundledSession = (app: PortalApp) =>
      shouldApplyPortalLoginSession(target, app, existingSessions[app]);
    const loginEco = async () => {
      const user = await eaLogin(username, password);
      queryClient.setQueryData(EA_AUTH_QUERY_KEY, user);
    };
    const loginSolar = async () => {
      const user = await ssLogin(username, password);
      queryClient.setQueryData(SS_AUTH_QUERY_KEY, user);
    };
    const loginWattwatchers = async () => {
      const user = await wwLogin(username, password);
      queryClient.setQueryData(WW_AUTH_QUERY_KEY, user);
    };
    const loginInstallHub = async () => {
      const user = await ihLogin(username, password);
      queryClient.setQueryData(IH_AUTH_QUERY_KEY, user);
    };

    try {
      const response = await requestPortalLogin({
        email: username,
        password,
        target: target ?? undefined,
        skipApps: target
          ? (Object.keys(existingSessions) as PortalApp[]).filter(
              (app) => app !== target && existingSessions[app],
            )
          : undefined,
      });
      applyPortalLoginSessions(response, {
        ecoaudit: (session) => {
          if (!shouldApplyBundledSession('ecoaudit')) return;
          saveEaTokens(session.accessToken, session.refreshToken);
          queryClient.setQueryData(EA_AUTH_QUERY_KEY, session.user);
        },
        solarsense: (session) => {
          if (!shouldApplyBundledSession('solarsense')) return;
          saveSsTokens(session.accessToken, session.refreshToken);
          queryClient.setQueryData(SS_AUTH_QUERY_KEY, session.user);
        },
        installhub: (session) => {
          if (!shouldApplyBundledSession('installhub')) return;
          saveIhTokens(session.accessToken, session.refreshToken);
          queryClient.setQueryData(IH_AUTH_QUERY_KEY, session.user);
        },
        wattwatchers: (session) => {
          if (!shouldApplyBundledSession('wattwatchers')) return;
          saveWwTokens(session.accessToken, session.refreshToken);
          queryClient.setQueryData(WW_AUTH_QUERY_KEY, session.user);
        },
      });
      return;
    } catch (error) {
      if (!isPortalLoginUnavailable(error)) throw error;
    }

    // Rollback compatibility for API versions that predate the bundled login
    // endpoint. Authentication failures and server errors must not fan out.
    if (target === 'ecoaudit') {
      const preserveSolarSession = Boolean(
        getSsJwt() || queryClient.getQueryData(SS_AUTH_QUERY_KEY),
      );
      await loginEco();
      const preserveWattwatchersSession = Boolean(
        getWwJwt() || queryClient.getQueryData(WW_AUTH_QUERY_KEY),
      );
      await Promise.allSettled([
        ...(preserveSolarSession ? [] : [loginSolar()]),
        ...(getIhJwt() || queryClient.getQueryData(IH_AUTH_QUERY_KEY) ? [] : [loginInstallHub()]),
        ...(preserveWattwatchersSession ? [] : [loginWattwatchers()]),
      ]);
      return;
    }

    if (target === 'solarsense') {
      const preserveEcoSession = Boolean(
        getEaJwt() || queryClient.getQueryData(EA_AUTH_QUERY_KEY),
      );
      await loginSolar();
      const preserveWattwatchersSession = Boolean(
        getWwJwt() || queryClient.getQueryData(WW_AUTH_QUERY_KEY),
      );
      await Promise.allSettled([
        ...(preserveEcoSession ? [] : [loginEco()]),
        ...(getIhJwt() || queryClient.getQueryData(IH_AUTH_QUERY_KEY) ? [] : [loginInstallHub()]),
        ...(preserveWattwatchersSession ? [] : [loginWattwatchers()]),
      ]);
      return;
    }

    if (target === 'installhub') {
      const preserveEcoSession = Boolean(
        getEaJwt() || queryClient.getQueryData(EA_AUTH_QUERY_KEY),
      );
      const preserveSolarSession = Boolean(
        getSsJwt() || queryClient.getQueryData(SS_AUTH_QUERY_KEY),
      );
      const preserveWattwatchersSession = Boolean(
        getWwJwt() || queryClient.getQueryData(WW_AUTH_QUERY_KEY),
      );
      await loginInstallHub();
      await Promise.allSettled([
        ...(preserveEcoSession ? [] : [loginEco()]),
        ...(preserveSolarSession ? [] : [loginSolar()]),
        ...(preserveWattwatchersSession ? [] : [loginWattwatchers()]),
      ]);
      return;
    }

    if (target === 'wattwatchers') {
      const preserveEcoSession = Boolean(
        getEaJwt() || queryClient.getQueryData(EA_AUTH_QUERY_KEY),
      );
      const preserveSolarSession = Boolean(
        getSsJwt() || queryClient.getQueryData(SS_AUTH_QUERY_KEY),
      );
      await loginWattwatchers();
      await Promise.allSettled([
        ...(preserveEcoSession ? [] : [loginEco()]),
        ...(preserveSolarSession ? [] : [loginSolar()]),
        ...(getIhJwt() || queryClient.getQueryData(IH_AUTH_QUERY_KEY) ? [] : [loginInstallHub()]),
      ]);
      return;
    }

    // The portal home and shared tools accept any app identity. Try every
    // so accounts only provisioned for one workspace can still sign in.
    const [ecoResult, solarResult, installHubResult, wattwatchersResult] = await Promise.allSettled([
      loginEco(),
      loginSolar(),
      loginInstallHub(),
      loginWattwatchers(),
    ]);
    if (
      ecoResult.status === 'rejected' &&
      solarResult.status === 'rejected' &&
      installHubResult.status === 'rejected' &&
      wattwatchersResult.status === 'rejected'
    ) {
      throw ecoResult.reason;
    }
  }, [queryClient]);

  const register = useCallback(async (input: { username: string; password: string; fullName: string }) => {
    const eaUser = await eaRegister(input);
    queryClient.setQueryData(EA_AUTH_QUERY_KEY, eaUser);

    try {
      const ssUser = await ssRegister(input);
      queryClient.setQueryData(SS_AUTH_QUERY_KEY, ssUser);
    } catch {
      // Solar account may already exist — try login with same password
      try {
        const ssUser = await ssLogin(input.username, input.password);
        queryClient.setQueryData(SS_AUTH_QUERY_KEY, ssUser);
      } catch {
        // Keep any pre-existing Solar session when best-effort setup fails.
      }
    }

    await queryClient.invalidateQueries({ queryKey: ['ecoaudit', 'auth'] });
    await queryClient.invalidateQueries({ queryKey: ['solar', 'auth'] });
  }, [queryClient]);

  const logout = useCallback(async () => {
    fieldSessionGenerationRef.current += 1;
    fieldSessionAttemptRef.current = null;
    setFieldSessionExchange(null);

    // Start revocation while each client can still read its refresh token, then
    // clear local state immediately. A slow network request must not leave the
    // portal authenticated or allow an in-flight Field exchange to restore it.
    const logoutRequests = [
      eaLogoutApi(),
      ssLogoutApi(),
      ihLogoutApi(),
      wwLogoutApi(),
    ];
    clearEaTokens();
    clearSsTokens();
    clearIhTokens();
    clearWwTokens();
    queryClient.setQueryData(EA_AUTH_QUERY_KEY, null);
    queryClient.setQueryData(SS_AUTH_QUERY_KEY, null);
    queryClient.setQueryData(IH_AUTH_QUERY_KEY, null);
    queryClient.setQueryData(WW_AUTH_QUERY_KEY, null);
    queryClient.removeQueries({ queryKey: ['ecoaudit'] });
    queryClient.removeQueries({ queryKey: ['solar'] });
    queryClient.removeQueries({ queryKey: ['installhub'] });
    queryClient.removeQueries({ queryKey: ['wattwatchers'] });
    await Promise.allSettled(logoutRequests);
  }, [queryClient]);

  const eaUser = (hasEa ? eaQuery.data ?? null : null) as CloudUser | null;
  const ssUser = (hasSs ? ssQuery.data ?? null : null) as SolarCloudUser | null;
  const ihUser = (hasIh ? ihQuery.data ?? null : null) as InstallHubUser | null;
  const wwUser = (hasWw ? wwQuery.data ?? null : null) as FleetUser | null;
  const isEcoAuthenticated = Boolean(eaUser);
  const isSolarAuthenticated = Boolean(ssUser);
  const isInstallHubAuthenticated = Boolean(ihUser);
  const isWattwatchersAuthenticated = Boolean(wwUser);
  const fieldSessionSources = useMemo(
    () => rankedFieldSessionSources({
      ecoAccessToken: eaToken,
      ecoRefreshToken: eaRefreshToken,
      ecoAuthenticated: isEcoAuthenticated,
      ecoRole: eaUser?.role ?? null,
      solarAccessToken: ssToken,
      solarRefreshToken: ssRefreshToken,
      solarAuthenticated: isSolarAuthenticated,
      solarRole: ssUser?.role ?? null,
    }),
    [
      eaToken,
      eaRefreshToken,
      ssToken,
      ssRefreshToken,
      isEcoAuthenticated,
      isSolarAuthenticated,
      eaUser?.role,
      ssUser?.role,
    ],
  );
  const fieldSessionSourceSignature = fieldSessionSources.length > 0
    ? fieldSessionSources.map((source) => (
        `${source.app}\u001f${source.accessToken}\u001f${source.refreshToken ?? ''}`
      )).join('\u001e')
    : null;
  const exchangeInstallHubSession = useCallback(async (
    sources: readonly FieldSessionSourceCandidate[],
    signature: string,
  ) => {
    const generation = fieldSessionGenerationRef.current + 1;
    fieldSessionGenerationRef.current = generation;
    fieldSessionAttemptRef.current = signature;
    setFieldSessionExchange({
      signature,
      status: 'pending',
      error: null,
    });
    const isCurrentAttempt = () => (
      fieldSessionGenerationRef.current === generation
      && fieldSessionAttemptRef.current === signature
    );
    try {
      const result = await requestFieldSessionFromSources(
        sources,
        requestFieldSession,
        isCurrentAttempt,
      );
      if (!result || !isCurrentAttempt()) return;
      saveIhTokens(result.session.accessToken, result.session.refreshToken);
      queryClient.setQueryData(IH_AUTH_QUERY_KEY, result.session.user);
    } catch (error) {
      if (isCurrentAttempt()) {
        setFieldSessionExchange({
          signature,
          status: 'failed',
          error: error instanceof Error && error.message.trim()
            ? error.message
            : 'Field App Complete access could not be opened from your signed-in account.',
        });
      }
      throw error;
    }
  }, [queryClient]);

  const retryInstallHubSession = useCallback(async () => {
    if (!fieldSessionSourceSignature || fieldSessionSources.length === 0) {
      throw new Error('No signed-in source session is available for Field App Complete.');
    }
    await exchangeInstallHubSession(
      fieldSessionSources,
      fieldSessionSourceSignature,
    );
  }, [
    fieldSessionSources,
    fieldSessionSourceSignature,
    exchangeInstallHubSession,
  ]);

  useEffect(() => {
    if (
      !fieldSessionSourceSignature
      || fieldSessionSources.length === 0
      || hasIh
    ) return;
    if (fieldSessionAttemptRef.current === fieldSessionSourceSignature) return;
    void exchangeInstallHubSession(
      fieldSessionSources,
      fieldSessionSourceSignature,
    )
      .catch(() => undefined);
  }, [
    fieldSessionSources,
    fieldSessionSourceSignature,
    hasIh,
    exchangeInstallHubSession,
  ]);

  useEffect(() => {
    if (hasIh) fieldSessionAttemptRef.current = null;
  }, [hasIh]);

  const isFieldSessionProvisioning = Boolean(
    !hasIh
    && fieldSessionSourceSignature
    && (
      !fieldSessionExchange
      || fieldSessionExchange.signature !== fieldSessionSourceSignature
      || fieldSessionExchange.status === 'pending'
    ),
  );
  const isEcoSessionLoading = isSessionCheckLoading({
    isClient: clientReady,
    hasToken: hasEa,
    hasUser: Boolean(eaUser),
    isPending: eaQuery.isPending,
    isFetching: eaQuery.isFetching,
    isError: eaQuery.isError,
  });
  const isSolarSessionLoading = isSessionCheckLoading({
    isClient: clientReady,
    hasToken: hasSs,
    hasUser: Boolean(ssUser),
    isPending: ssQuery.isPending,
    isFetching: ssQuery.isFetching,
    isError: ssQuery.isError,
  });
  const isInstallHubSessionLoading = isSessionCheckLoading({
    isClient: clientReady,
    hasToken: hasIh,
    hasUser: Boolean(ihUser),
    isPending: ihQuery.isPending,
    isFetching: ihQuery.isFetching,
    isError: ihQuery.isError,
  });
  const isWattwatchersSessionLoading = isSessionCheckLoading({
    isClient: clientReady,
    hasToken: hasWw,
    hasUser: Boolean(wwUser),
    isPending: wwQuery.isPending,
    isFetching: wwQuery.isFetching,
    isError: wwQuery.isError,
  });
  const hasPendingSourceAuthentication = Boolean(
    !hasIh
    && (isEcoSessionLoading || isSolarSessionLoading),
  );
  const hasInstallHubSourceSession = fieldSessionSources.length > 0;
  const installHubSessionError = (
    fieldSessionExchange?.status === 'failed'
    && fieldSessionExchange.signature === fieldSessionSourceSignature
  )
    ? fieldSessionExchange.error
    : null;
  // Only block UI while a session check is in-flight — never forever on
  // "has token but no user" after the query has failed or finished retries.
  const isEcoLoading = isEcoSessionLoading;
  const isSolarLoading = isSolarSessionLoading;
  const isInstallHubLoading =
    isInstallHubSessionLoading
    || isFieldSessionProvisioning
    || hasPendingSourceAuthentication;
  const isWattwatchersLoading = isWattwatchersSessionLoading;
  const isAuthenticated =
    isEcoAuthenticated ||
    isSolarAuthenticated ||
    isInstallHubAuthenticated ||
    isWattwatchersAuthenticated;
  // Portal/login blockers must not wait on InstallHub Field-session exchange —
  // that only affects /installhub/* routes (see PortalAuthGate).
  const isLoading = !clientReady || (
    !isAuthenticated && (
      isEcoLoading ||
      isSolarLoading ||
      isInstallHubSessionLoading ||
      isWattwatchersLoading
    )
  );

  const value = useMemo<PortalAuthValue>(
    () => ({
      eaUser,
      ssUser,
      ihUser,
      wwUser,
      user: eaUser ?? ssUser ?? ihUser ?? wwUser,
      isLoading,
      isEcoLoading,
      isSolarLoading,
      isInstallHubLoading,
      isWattwatchersLoading,
      isAuthenticated,
      isEcoAuthenticated,
      isSolarAuthenticated,
      isInstallHubAuthenticated,
      isWattwatchersAuthenticated,
      hasInstallHubSourceSession,
      installHubSessionError,
      retryInstallHubSession,
      login,
      register,
      logout,
    }),
    [
      eaUser,
      ssUser,
      ihUser,
      wwUser,
      isLoading,
      isEcoLoading,
      isSolarLoading,
      isInstallHubLoading,
      isWattwatchersLoading,
      isAuthenticated,
      isEcoAuthenticated,
      isSolarAuthenticated,
      isInstallHubAuthenticated,
      isWattwatchersAuthenticated,
      hasInstallHubSourceSession,
      installHubSessionError,
      retryInstallHubSession,
      login,
      register,
      logout,
    ],
  );

  return <PortalAuthContext.Provider value={value}>{children}</PortalAuthContext.Provider>;
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error('usePortalAuth must be used within PortalAuthProvider');
  return ctx;
}
