'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clearTokens as clearEaTokens, cloudConnectionErrorMessage } from '@/api/client';
import {
  clearTokens as clearSsTokens,
  cloudConnectionErrorMessage as solarConnectionErrorMessage,
} from '@solar/api/client';
import {
  clearTokens as clearWwTokens,
  fleetConnectionErrorMessage,
} from '@/modules/fleet/api/client';
import {
  clearTokens as clearIhTokens,
  installHubConnectionErrorMessage,
} from '@/modules/installhub/api/client';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { AuthForm } from '@/components/auth/AuthForm';
import { Spinner } from '@/components/ui/Card';
import { portalAppForPath, safePortalLoginNext } from '@/lib/portalNavigation';

function LoginForm() {
  const {
    login,
    isEcoAuthenticated,
    isSolarAuthenticated,
    isInstallHubAuthenticated,
    isWattwatchersAuthenticated,
    isEcoLoading,
    isSolarLoading,
    isInstallHubLoading,
    isWattwatchersLoading,
  } = usePortalAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safePortalLoginNext(searchParams.get('next'));
  const target = portalAppForPath(next);

  const isTargetAuthenticated =
    target === 'ecoaudit'
      ? isEcoAuthenticated
      : target === 'solarsense'
        ? isSolarAuthenticated
        : target === 'installhub'
          ? isInstallHubAuthenticated
          : target === 'wattwatchers'
            ? isWattwatchersAuthenticated
            : (
              isEcoAuthenticated
              || isSolarAuthenticated
              || isInstallHubAuthenticated
              || isWattwatchersAuthenticated
            );

  const isTargetLoading =
    target === 'ecoaudit'
      ? isEcoLoading
      : target === 'solarsense'
        ? isSolarLoading
        : target === 'installhub'
          ? isInstallHubLoading
          : target === 'wattwatchers'
            ? isWattwatchersLoading
            : (
              (isEcoLoading && !isEcoAuthenticated)
              || (isSolarLoading && !isSolarAuthenticated)
              || (isInstallHubLoading && !isInstallHubAuthenticated)
              || (isWattwatchersLoading && !isWattwatchersAuthenticated)
            );

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Wipe broken tokens so /me cannot keep soft-blocking navigation.
  useEffect(() => {
    if (!mounted || isTargetAuthenticated) return;
    const id = window.setTimeout(() => {
      clearEaTokens();
      clearSsTokens();
      clearIhTokens();
      clearWwTokens();
    }, 1_200);
    return () => window.clearTimeout(id);
  }, [mounted, isTargetAuthenticated]);

  useEffect(() => {
    if (mounted && isTargetAuthenticated && !isTargetLoading) {
      router.replace(next);
    }
  }, [mounted, isTargetAuthenticated, isTargetLoading, router, next]);

  // Always render the sign-in form by default (including SSR). Only hide it
  // when we positively know the user is signed in and are redirecting.
  if (mounted && isTargetAuthenticated && !isTargetLoading) {
    return <Spinner fullPage label="Opening your workspace…" />;
  }

  async function handleSubmit(username: string, password: string) {
    setBusy(true);
    setError(null);
    try {
      await login(username, password, target);
      router.replace(next);
    } catch (err) {
      setError(
        target === 'solarsense'
          ? solarConnectionErrorMessage(err)
          : target === 'installhub'
            ? installHubConnectionErrorMessage(err)
            : target === 'wattwatchers'
              ? fleetConnectionErrorMessage(err)
              : cloudConnectionErrorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthForm
      busy={busy}
      error={error}
      onSubmit={({ username, password }) => void handleSubmit(username, password)}
    />
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthForm busy={false} error={null} onSubmit={() => undefined} />}>
      <LoginForm />
    </Suspense>
  );
}
