'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import type { InstallHubUser } from '@/modules/installhub/types/domain';

type InstallHubAuthValue = {
  user: InstallHubUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const InstallHubAuthContext = createContext<InstallHubAuthValue | null>(null);

export function InstallHubAuthProvider({ children }: { children: ReactNode }) {
  const portal = usePortalAuth();
  const value = useMemo<InstallHubAuthValue>(
    () => ({
      user: portal.ihUser,
      isLoading: portal.isInstallHubLoading,
      isAuthenticated: portal.isInstallHubAuthenticated,
      login: (username, password) => portal.login(username, password, 'installhub'),
      logout: portal.logout,
    }),
    [portal],
  );
  return (
    <InstallHubAuthContext.Provider value={value}>
      {children}
    </InstallHubAuthContext.Provider>
  );
}

export function useInstallHubAuth() {
  const context = useContext(InstallHubAuthContext);
  if (!context) {
    throw new Error('useInstallHubAuth must be used within InstallHubAuthProvider');
  }
  return context;
}
