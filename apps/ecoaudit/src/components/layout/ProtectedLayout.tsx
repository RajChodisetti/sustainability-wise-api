'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Spinner } from '@/components/ui/Card';

export function ProtectedLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace(`/login?next=${encodeURIComponent(pathname || '/ecoaudit')}`);
    }
  }, [isLoading, isAuthenticated, router, pathname]);

  if (isLoading) return <Spinner />;
  if (!isAuthenticated) return <Spinner />;

  return <>{children}</>;
}

export function AdminLayout({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && user?.role !== 'admin') {
      router.replace('/ecoaudit');
    }
  }, [isLoading, user, router]);

  if (isLoading || user?.role !== 'admin') return <Spinner />;
  return <>{children}</>;
}
