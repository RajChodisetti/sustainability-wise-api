'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { Spinner } from '@/components/ui/Card';

const PUBLIC_PATHS = new Set(['/login', '/signup']);

export function PortalAuthGate({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = usePortalAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic =
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith('/ecoaudit/login') ||
    pathname.startsWith('/ecoaudit/signup') ||
    pathname.startsWith('/solar/login') ||
    pathname.startsWith('/solar/signup');

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !isPublic) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, isPublic, router]);

  if (isPublic) return <>{children}</>;
  if (isLoading) return <Spinner />;
  if (!isAuthenticated) return <Spinner />;
  return <>{children}</>;
}
