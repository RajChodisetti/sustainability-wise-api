'use client';

import { useEffect, useState, type ReactNode } from 'react';
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

  if (isPublic) return <>{children}</>;
  if (isRouteAuthenticated) return <>{children}</>;
  return (
    <PendingPortalAuthGate
      key={`${pathname}:${requiresInstallHub ? 'installhub' : 'portal'}`}
      pathname={pathname}
      router={router}
      requiresInstallHub={requiresInstallHub}
      isLoading={requiresInstallHub ? isInstallHubLoading : isLoading}
      hasInstallHubSourceSession={hasInstallHubSourceSession}
      installHubSessionError={installHubSessionError}
      retryInstallHubSession={retryInstallHubSession}
    />
  );
}

function PendingPortalAuthGate({
  pathname,
  router,
  requiresInstallHub,
  isLoading,
  hasInstallHubSourceSession,
  installHubSessionError,
  retryInstallHubSession,
}: {
  pathname: string;
  router: ReturnType<typeof useRouter>;
  requiresInstallHub: boolean;
  isLoading: boolean;
  hasInstallHubSourceSession: boolean;
  installHubSessionError: string | null;
  retryInstallHubSession: () => Promise<void>;
}) {
  // Cap gate wait so a hung /me never freezes the whole shell forever. This
  // component is keyed and remounted for each protected route/auth attempt.
  const [gateTimedOut, setGateTimedOut] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setGateTimedOut(true), 1_500);
    return () => window.clearTimeout(id);
  }, []);

  const isRouteLoading = isLoading && !gateTimedOut;
  const canRetryInstallHubSession = (
    requiresInstallHub
    && !isRouteLoading
    && hasInstallHubSourceSession
  );

  useEffect(() => {
    if (!isRouteLoading && !canRetryInstallHubSession) {
      router.replace(`/login?next=${encodeURIComponent(pathname || '/')}`);
    }
  }, [isRouteLoading, canRetryInstallHubSession, pathname, router]);

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
  return <Spinner fullPage label="Redirecting to sign in…" />;
}
