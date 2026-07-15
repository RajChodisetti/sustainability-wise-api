'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import type { CloudUser } from '@/types/domain';

type AuthContextValue = {
  user: CloudUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (input: { username: string; password: string; fullName: string }) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Thin adapter so EcoAudit screens keep using useAuth() against the shared portal session. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const portal = usePortalAuth();

  const value = useMemo<AuthContextValue>(
    () => ({
      user: portal.eaUser,
      isLoading: portal.isLoading,
      isAuthenticated: portal.isEcoAuthenticated,
      login: portal.login,
      register: portal.register,
      logout: portal.logout,
      refreshUser: async () => undefined,
    }),
    [portal],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useRequireAdmin() {
  const { user } = useAuth();
  return user?.role === 'admin';
}
