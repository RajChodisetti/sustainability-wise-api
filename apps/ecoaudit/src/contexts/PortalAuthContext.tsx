'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getStoredJwt as getEaJwt,
  clearTokens as clearEaTokens,
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
} from '@solar/api/client';
import {
  loginWithUsername as ssLogin,
  logout as ssLogoutApi,
  me as ssMe,
  registerAccount as ssRegister,
} from '@solar/api/auth';
import type { CloudUser } from '@/types/domain';
import type { CloudUser as SolarCloudUser } from '@solar/types/domain';

type PortalAuthValue = {
  eaUser: CloudUser | null;
  ssUser: SolarCloudUser | null;
  user: CloudUser | SolarCloudUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isEcoAuthenticated: boolean;
  isSolarAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (input: { username: string; password: string; fullName: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const PortalAuthContext = createContext<PortalAuthValue | null>(null);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const hasEa = typeof window !== 'undefined' && Boolean(getEaJwt());
  const hasSs = typeof window !== 'undefined' && Boolean(getSsJwt());

  const eaQuery = useQuery({
    queryKey: ['ecoaudit', 'auth', 'me'],
    queryFn: eaMe,
    enabled: hasEa,
    retry: false,
  });

  const ssQuery = useQuery({
    queryKey: ['solar', 'auth', 'me'],
    queryFn: ssMe,
    enabled: hasSs,
    retry: false,
  });

  const login = useCallback(async (username: string, password: string) => {
    // EcoAudit is the primary portal identity — must succeed
    const eaUser = await eaLogin(username, password);
    queryClient.setQueryData(['ecoaudit', 'auth', 'me'], eaUser);

    // Solar is same credentials, best-effort (account may already exist / sync)
    try {
      const ssUser = await ssLogin(username, password);
      queryClient.setQueryData(['solar', 'auth', 'me'], ssUser);
    } catch {
      clearSsTokens();
      queryClient.removeQueries({ queryKey: ['solar', 'auth'] });
    }

    await queryClient.invalidateQueries({ queryKey: ['ecoaudit', 'auth'] });
    await queryClient.invalidateQueries({ queryKey: ['solar', 'auth'] });
  }, [queryClient]);

  const register = useCallback(async (input: { username: string; password: string; fullName: string }) => {
    const eaUser = await eaRegister(input);
    queryClient.setQueryData(['ecoaudit', 'auth', 'me'], eaUser);

    try {
      const ssUser = await ssRegister(input);
      queryClient.setQueryData(['solar', 'auth', 'me'], ssUser);
    } catch {
      // Solar account may already exist — try login with same password
      try {
        const ssUser = await ssLogin(input.username, input.password);
        queryClient.setQueryData(['solar', 'auth', 'me'], ssUser);
      } catch {
        clearSsTokens();
      }
    }

    await queryClient.invalidateQueries({ queryKey: ['ecoaudit', 'auth'] });
    await queryClient.invalidateQueries({ queryKey: ['solar', 'auth'] });
  }, [queryClient]);

  const logout = useCallback(async () => {
    await Promise.allSettled([eaLogoutApi(), ssLogoutApi()]);
    clearEaTokens();
    clearSsTokens();
    queryClient.setQueryData(['ecoaudit', 'auth', 'me'], null);
    queryClient.setQueryData(['solar', 'auth', 'me'], null);
    queryClient.removeQueries({ queryKey: ['ecoaudit'] });
    queryClient.removeQueries({ queryKey: ['solar'] });
  }, [queryClient]);

  const eaUser = (eaQuery.data ?? null) as CloudUser | null;
  const ssUser = (ssQuery.data ?? null) as SolarCloudUser | null;
  const isEcoAuthenticated = Boolean(eaUser);
  const isSolarAuthenticated = Boolean(ssUser);
  // Portal access requires EcoAudit session so /ecoaudit routes never bounce to home
  const isAuthenticated = isEcoAuthenticated;
  const isLoading = hasEa && eaQuery.isLoading;

  const value = useMemo<PortalAuthValue>(
    () => ({
      eaUser,
      ssUser,
      user: eaUser ?? ssUser,
      isLoading,
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
