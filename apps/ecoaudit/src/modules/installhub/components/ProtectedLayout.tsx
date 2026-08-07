'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/Card';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import { WorkflowHashFocus } from '@/modules/installhub/components/WorkflowUi';

export function InstallHubProtectedLayout({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useInstallHubAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace(`/login?next=${encodeURIComponent(pathname || '/installhub')}`);
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  if (isLoading || !isAuthenticated) return <Spinner />;
  return <><WorkflowHashFocus />{children}</>;
}
