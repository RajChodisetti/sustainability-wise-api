'use client';

import { useEffect, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { Button } from '@/components/ui/Button';
import { Card, ErrorBanner, Spinner } from '@/components/ui/Card';
import type { FieldSessionSourceApp } from '@/api/portalLogin';

const PUBLIC_PATHS = new Set([
  '/login',
  '/signup',
  '/ecoaudit/login',
  '/ecoaudit/signup',
  '/solar/login',
  '/solar/signup',
  '/installhub/login',
]);

const SOURCE_LABELS: Record<FieldSessionSourceApp, string> = {
  ecoaudit: 'Eco Audit',
  solarsense: 'Solar Sense',
};

function FieldSessionChooser({
  sources,
  sourceUsers,
  error,
  onChoose,
}: {
  sources: FieldSessionSourceApp[];
  sourceUsers: Record<
    FieldSessionSourceApp,
    { fullName?: string | null; email?: string | null; role?: string | null } | null
  >;
  error: string | null;
  onChoose: (source: FieldSessionSourceApp) => void;
}) {
  const hasMultipleSources = sources.length > 1;

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4 sm:p-8">
      <div className="w-full max-w-lg">
        <p className="mb-2 text-xs font-extrabold uppercase tracking-[0.12em] text-[var(--primary)]">
          Field App
        </p>
        <h1 className="text-3xl font-extrabold tracking-[-0.04em] text-[var(--text)]">
          {hasMultipleSources
            ? 'Choose which account opens Field App'
            : 'Continue to Field App'}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
          {hasMultipleSources
            ? 'You are signed in to two independent source accounts. Choose the one whose role and work identity should be used in Field App.'
            : 'Use your existing signed-in account to open Field App.'}{' '}
          No password is required.
        </p>

        <Card className="mt-6 space-y-3 !p-5 sm:!p-6">
          <div
            className="space-y-3"
            role="group"
            aria-label="Choose a signed-in source account for Field App"
          >
            {sources.map((source) => {
              const user = sourceUsers[source];
              const identity = user?.fullName?.trim()
                || user?.email?.trim()
                || 'Signed-in account';
              const role = user?.role === 'admin'
                ? 'Administrator'
                : 'Inspector';
              return (
                <Button
                  key={source}
                  variant="secondary"
                  className="w-full !justify-between gap-4 text-left"
                  onClick={() => onChoose(source)}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-extrabold">
                      Continue with {SOURCE_LABELS[source]}
                    </span>
                    <span className="mt-0.5 block truncate text-xs font-semibold text-[var(--text-sub)]">
                      {identity} · {role}
                    </span>
                  </span>
                  <span aria-hidden="true">→</span>
                </Button>
              );
            })}
          </div>
          {error ? <ErrorBanner message={error} /> : null}
        </Card>
      </div>
    </main>
  );
}

export function PortalAuthGate({ children }: { children: ReactNode }) {
  const {
    eaUser,
    ssUser,
    isAuthenticated,
    isLoading,
    isInstallHubAuthenticated,
    isInstallHubLoading,
    installHubSourceOptions,
    installHubSessionError,
    openInstallHubFromSource,
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
  const canChooseInstallHubSource = (
    requiresInstallHub
    && !isInstallHubAuthenticated
    && !isInstallHubLoading
    && installHubSourceOptions.length > 0
  );

  useEffect(() => {
    if (
      !isRouteLoading
      && !isRouteAuthenticated
      && !isPublic
      && !canChooseInstallHubSource
    ) {
      router.replace(`/login?next=${encodeURIComponent(pathname || '/')}`);
    }
  }, [
    isRouteLoading,
    isRouteAuthenticated,
    isPublic,
    canChooseInstallHubSource,
    pathname,
    router,
  ]);

  if (isPublic) return <>{children}</>;
  if (isRouteLoading) return <Spinner fullPage label="Preparing your workspace…" />;
  if (canChooseInstallHubSource) {
    return (
      <FieldSessionChooser
        sources={installHubSourceOptions}
        sourceUsers={{
          ecoaudit: eaUser,
          solarsense: ssUser,
        }}
        error={installHubSessionError}
        onChoose={(source) => {
          void openInstallHubFromSource(source).catch(() => undefined);
        }}
      />
    );
  }
  if (!isRouteAuthenticated) {
    return <Spinner fullPage label="Redirecting to sign in…" />;
  }
  return <>{children}</>;
}
