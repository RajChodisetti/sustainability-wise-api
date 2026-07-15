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
import type { CloudUser } from '@/types/domain';
import type { CloudUser as SolarCloudUser } from '@solar/types/domain';
import type { PortalApp } from '@/lib/portalNavigation';
import { authQueryRetryDelayMs, shouldRetryAuthQuery } from '@/lib/authQuery';

const EA_AUTH_QUERY_KEY = ['ecoaudit', 'auth', 'me'] as const;
const SS_AUTH_QUERY_KEY = ['solar', 'auth', 'me'] as const;
const noServerSession = () => null;
const subscribeEaSessionSnapshot = (onStoreChange: () => void) =>
  subscribeEaAuthSession(() => onStoreChange());
const subscribeSsSessionSnapshot = (onStoreChange: () => void) =>
  subscribeSsAuthSession(() => onStoreChange());
const subscribeClientSnapshot = () => () => undefined;
const getClientSnapshot = () => true;
const getServerClientSnapshot = () => false;

type PortalAuthValue = {
  eaUser: CloudUser | null;
  ssUser: SolarCloudUser | null;
  user: CloudUser | SolarCloudUser | null;
  isLoading: boolean;
  isEcoLoading: boolean;
  isSolarLoading: boolean;
  isAuthenticated: boolean;
  isEcoAuthenticated: boolean;
  isSolarAuthenticated: boolean;
  login: (username: string, password: string, target?: PortalApp | null) => Promise<void>;
  register: (input: { username: string; password: string; fullName: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const PortalAuthContext = createContext<PortalAuthValue | null>(null);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const eaToken = useSyncExternalStore(subscribeEaSessionSnapshot, getEaJwt, noServerSession);
  const ssToken = useSyncExternalStore(subscribeSsSessionSnapshot, getSsJwt, noServerSession);
  const isClient = useSyncExternalStore(
    subscribeClientSnapshot,
    getClientSnapshot,
    getServerClientSnapshot,
  );
  const hasEa = Boolean(eaToken);
  const hasSs = Boolean(ssToken);

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
    return () => {
      unsubscribeEa();
      unsubscribeSs();
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

  const login = useCallback(async (username: string, password: string, target?: PortalApp | null) => {
    const loginEco = async () => {
      const user = await eaLogin(username, password);
      queryClient.setQueryData(EA_AUTH_QUERY_KEY, user);
    };
    const loginSolar = async () => {
      const user = await ssLogin(username, password);
      queryClient.setQueryData(SS_AUTH_QUERY_KEY, user);
    };

    if (target === 'ecoaudit') {
      const preserveSolarSession = Boolean(
        getSsJwt() || queryClient.getQueryData(SS_AUTH_QUERY_KEY),
      );
      await loginEco();
      if (!preserveSolarSession) {
        try {
          await loginSolar();
        } catch {
          // The account may be Eco-only. Preserve any existing Solar session.
        }
      }
      return;
    }

    if (target === 'solarsense') {
      const preserveEcoSession = Boolean(
        getEaJwt() || queryClient.getQueryData(EA_AUTH_QUERY_KEY),
      );
      await loginSolar();
      if (!preserveEcoSession) {
        try {
          await loginEco();
        } catch {
          // The account may be Solar-only. Preserve any existing Eco session.
        }
      }
      return;
    }

    // The portal home and shared tools accept either app identity. Try both so
    // Eco-only and Solar-only accounts can use the combined portal.
    const [ecoResult, solarResult] = await Promise.allSettled([loginEco(), loginSolar()]);
    if (ecoResult.status === 'rejected' && solarResult.status === 'rejected') {
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
    await Promise.allSettled([eaLogoutApi(), ssLogoutApi()]);
    clearEaTokens();
    clearSsTokens();
    queryClient.setQueryData(EA_AUTH_QUERY_KEY, null);
    queryClient.setQueryData(SS_AUTH_QUERY_KEY, null);
    queryClient.removeQueries({ queryKey: ['ecoaudit'] });
    queryClient.removeQueries({ queryKey: ['solar'] });
  }, [queryClient]);

  const eaUser = (hasEa ? eaQuery.data ?? null : null) as CloudUser | null;
  const ssUser = (hasSs ? ssQuery.data ?? null : null) as SolarCloudUser | null;
  const isEcoAuthenticated = Boolean(eaUser);
  const isSolarAuthenticated = Boolean(ssUser);
  // A stored token with no verified user is a pending session, including while
  // React Query is paused offline or retrying a transient failure. Only a
  // definitive 401/403 clears the token and allows a login redirect.
  const isEcoLoading = !isClient || (hasEa && !eaUser);
  const isSolarLoading = !isClient || (hasSs && !ssUser);
  const isAuthenticated = isEcoAuthenticated || isSolarAuthenticated;
  const isLoading = !isClient || (!isAuthenticated && (isEcoLoading || isSolarLoading));

  const value = useMemo<PortalAuthValue>(
    () => ({
      eaUser,
      ssUser,
      user: eaUser ?? ssUser,
      isLoading,
      isEcoLoading,
      isSolarLoading,
      isAuthenticated,
      isEcoAuthenticated,
      isSolarAuthenticated,
      login,
      register,
      logout,
    }),
    [
      eaUser,
      ssUser,
      isLoading,
      isEcoLoading,
      isSolarLoading,
      isAuthenticated,
      isEcoAuthenticated,
      isSolarAuthenticated,
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
