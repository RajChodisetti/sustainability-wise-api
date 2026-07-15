'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { Spinner } from '@/components/ui/Card';

const PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/ecoaudit/login',
  '/ecoaudit/signup',
  '/solar/login',
  '/solar/signup',
]);

export function PortalAuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = usePortalAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isPublic) {
      router.replace(`/login?next=${encodeURIComponent(pathname || '/')}`);
    }
  }, [isLoading, isAuthenticated, isPublic, pathname, router]);

  if (isPublic) return <>{children}</>;
  if (isLoading) return <Spinner />;
  if (!isAuthenticated) return <Spinner />;
  return <>{children}</>;
}
