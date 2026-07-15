'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@solar/contexts/AuthContext';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { Spinner } from '@solar/components/ui/Card';

export function SolarProtectedLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const { isEcoAuthenticated, isLoading: portalLoading } = usePortalAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (portalLoading || isLoading) return;
    // Portal session must exist; Solar session needed for Solar API
    if (!isEcoAuthenticated) {
      router.replace(`/login?next=${encodeURIComponent(pathname || '/solar')}`);
      return;
    }
    if (!isAuthenticated) {
      // Eco ok but Solar token missing — re-login once with next back to solar
      router.replace(`/login?next=${encodeURIComponent(pathname || '/solar')}`);
    }
  }, [portalLoading, isLoading, isEcoAuthenticated, isAuthenticated, router, pathname]);

  if (portalLoading || isLoading) return <Spinner />;
  if (!isEcoAuthenticated || !isAuthenticated) return <Spinner />;

  return <>{children}</>;
}

export function SolarAdminLayout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user?.role !== 'admin') {
      router.replace('/solar/settings');
    }
  }, [isLoading, user, router]);

  if (isLoading || user?.role !== 'admin') return <Spinner />;
  return <>{children}</>;
}
