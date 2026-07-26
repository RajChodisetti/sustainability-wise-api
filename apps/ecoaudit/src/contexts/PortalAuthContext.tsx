'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getStoredJwt as getEaJwt,
  clearTokens as clearEaTokens,
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
  clearTokens as clearSsTokens,
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
import { authQueryRetryDelayMs, shouldRetryAuthQuery } from '@/lib/authQuery';

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
  login: (username: string, password: string, target?: PortalApp | null) => Promise<void>;
  register: (input: { username: string; password: string; fullName: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const PortalAuthContext = createContext<PortalAuthValue | null>(null);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const eaToken = useSyncExternalStore(subscribeEaSessionSnapshot, getEaJwt, noServerSession);
  const ssToken = useSyncExternalStore(subscribeSsSessionSnapshot, getSsJwt, noServerSession);
  const ihToken = useSyncExternalStore(subscribeIhSessionSnapshot, getIhJwt, noServerSession);
  const wwToken = useSyncExternalStore(subscribeWwSessionSnapshot, getWwJwt, noServerSession);
  const isClient = useSyncExternalStore(
    subscribeClientSnapshot,
    getClientSnapshot,
    getServerClientSnapshot,
  );
  const hasEa = Boolean(eaToken);
  const hasSs = Boolean(ssToken);
  const hasIh = Boolean(ihToken);
  const hasWw = Boolean(wwToken);

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
    retry: (_failureCount, error) =>
      shouldRetryAuthQuery(error, Boolean(getEaJwt())),
    retryDelay: (failureCount) => authQueryRetryDelayMs(failureCount),
  });

  const ssQuery = useQuery({
    queryKey: SS_AUTH_QUERY_KEY,
    queryFn: ssMe,
    enabled: hasSs,
    retry: (_failureCount, error) =>
      shouldRetryAuthQuery(error, Boolean(getSsJwt())),
    retryDelay: (failureCount) => authQueryRetryDelayMs(failureCount),
  });

  const ihQuery = useQuery({
    queryKey: IH_AUTH_QUERY_KEY,
    queryFn: ihMe,
    enabled: hasIh,
    retry: (_failureCount, error) =>
      shouldRetryAuthQuery(error, Boolean(getIhJwt())),
    retryDelay: (failureCount) => authQueryRetryDelayMs(failureCount),
  });

  const wwQuery = useQuery({
    queryKey: WW_AUTH_QUERY_KEY,
    queryFn: wwMe,
    enabled: hasWw,
    retry: (_failureCount, error) =>
      shouldRetryAuthQuery(error, Boolean(getWwJwt())),
    retryDelay: (failureCount) => authQueryRetryDelayMs(failureCount),
  });

  const login = useCallback(async (username: string, password: string, target?: PortalApp | null) => {
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
    await Promise.allSettled([eaLogoutApi(), ssLogoutApi(), ihLogoutApi(), wwLogoutApi()]);
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
  }, [queryClient]);

  const eaUser = (hasEa ? eaQuery.data ?? null : null) as CloudUser | null;
  const ssUser = (hasSs ? ssQuery.data ?? null : null) as SolarCloudUser | null;
  const ihUser = (hasIh ? ihQuery.data ?? null : null) as InstallHubUser | null;
  const wwUser = (hasWw ? wwQuery.data ?? null : null) as FleetUser | null;
  const isEcoAuthenticated = Boolean(eaUser);
  const isSolarAuthenticated = Boolean(ssUser);
  const isInstallHubAuthenticated = Boolean(ihUser);
  const isWattwatchersAuthenticated = Boolean(wwUser);
  // A stored token with no verified user is a pending session, including while
  // React Query is paused offline or retrying a transient failure. Only a
  // definitive 401/403 clears the token and allows a login redirect.
  const isEcoLoading = !isClient || (hasEa && !eaUser);
  const isSolarLoading = !isClient || (hasSs && !ssUser);
  const isInstallHubLoading = !isClient || (hasIh && !ihUser);
  const isWattwatchersLoading = !isClient || (hasWw && !wwUser);
  const isAuthenticated =
    isEcoAuthenticated ||
    isSolarAuthenticated ||
    isInstallHubAuthenticated ||
    isWattwatchersAuthenticated;
  const isLoading = !isClient || (
    !isAuthenticated && (
      isEcoLoading ||
      isSolarLoading ||
      isInstallHubLoading ||
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
