'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, Spinner } from '@/components/ui/Card';

const PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/ecoaudit/login',
  '/ecoaudit/signup',
  '/solar/login',
  '/solar/signup',
  '/installhub/login',
]);

function FieldSessionFailure({
  error,
  onRetry,
}: {
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4 sm:p-8">
      <div className="w-full max-w-lg">
        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--primary)]">
          Field App Complete
        </p>
        <h1 className="text-3xl font-extrabold tracking-[-0.04em] text-[var(--text)]">
          Field App Complete could not open automatically
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
          Your portal account is still signed in. Retry the automatic Field App
          Complete access setup; no password or account selection is required.
        </p>

        <Card className="mt-6 space-y-3 !p-5 sm:!p-6">
          {error ? <ErrorBanner message={error} /> : null}
          <Button className="w-full" onClick={onRetry}>
            Retry Field App Complete
          </Button>
        </Card>
      </div>
    </main>
  );
}

export function PortalAuthGate({ children }: { children: ReactNode }) {
  const {
    isAuthenticated,
    isLoading,
    isInstallHubAuthenticated,
    isInstallHubLoading,
    hasInstallHubSourceSession,
    installHubSessionError,
    retryInstallHubSession,
  } = usePortalAuth();
  const pathname = usePathname();
  const router = useRouter();
  const isPublic = PUBLIC_PATHS.has(pathname);
  const requiresInstallHub = pathname === '/installhub'
    || pathname.startsWith('/installhub/');
  const isRouteAuthenticated = requiresInstallHub
    ? isInstallHubAuthenticated
    : isAuthenticated;
  const isRouteLoading = requiresInstallHub
    ? isInstallHubLoading
    : isLoading;
  const canRetryInstallHubSession = (
    requiresInstallHub
    && !isInstallHubAuthenticated
    && !isInstallHubLoading
    && hasInstallHubSourceSession
  );

  useEffect(() => {
    if (
      !isRouteLoading
      && !isRouteAuthenticated
      && !isPublic
      && !canRetryInstallHubSession
    ) {
      router.replace(`/login?next=${encodeURIComponent(pathname || '/')}`);
    }
  }, [
    isRouteLoading,
    isRouteAuthenticated,
    isPublic,
    canRetryInstallHubSession,
    pathname,
    router,
  ]);

  if (isPublic) return <>{children}</>;
  if (isRouteLoading) return <Spinner fullPage label="Preparing your workspace…" />;
  if (canRetryInstallHubSession) {
    return (
      <FieldSessionFailure
        error={installHubSessionError}
        onRetry={() => {
          void retryInstallHubSession().catch(() => undefined);
        }}
      />
    );
  }
  if (!isRouteAuthenticated) {
    return <Spinner fullPage label="Redirecting to sign in…" />;
  }
  return <>{children}</>;
}
