'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@solar/contexts/AuthContext';
import { Spinner } from '@solar/components/ui/Card';

export function SolarProtectedLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace(`/login?next=${encodeURIComponent(pathname || '/solar')}`);
    }
  }, [isLoading, isAuthenticated, router, pathname]);

  if (isLoading || !isAuthenticated) return <Spinner />;

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
