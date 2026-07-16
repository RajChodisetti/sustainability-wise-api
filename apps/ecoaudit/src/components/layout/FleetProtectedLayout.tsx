'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { Spinner } from '@/components/ui/Card';

export function FleetProtectedLayout({ children }: { children: ReactNode }) {
  const { isWattwatchersAuthenticated, isWattwatchersLoading } = usePortalAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isWattwatchersLoading && !isWattwatchersAuthenticated) {
      router.replace(`/login?next=${encodeURIComponent(pathname || '/fleet')}`);
    }
  }, [isWattwatchersAuthenticated, isWattwatchersLoading, pathname, router]);

  if (isWattwatchersLoading || !isWattwatchersAuthenticated) {
    return <Spinner label="Preparing Wattwatchers Fleet…" />;
  }

  return <>{children}</>;
}
