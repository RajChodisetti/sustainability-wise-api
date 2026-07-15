'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cloudConnectionErrorMessage } from '@/api/client';
import { cloudConnectionErrorMessage as solarConnectionErrorMessage } from '@solar/api/client';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { AuthForm } from '@/components/auth/AuthForm';
import { Spinner } from '@/components/ui/Card';
import { portalAppForPath, safePortalNext } from '@/lib/portalNavigation';

function LoginForm() {
  const {
    login,
    isAuthenticated,
    isEcoAuthenticated,
    isSolarAuthenticated,
    isLoading,
    isEcoLoading,
    isSolarLoading,
  } = usePortalAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safePortalNext(searchParams.get('next'));
  const target = portalAppForPath(next);
  const isTargetAuthenticated =
    target === 'ecoaudit'
      ? isEcoAuthenticated
      : target === 'solarsense'
        ? isSolarAuthenticated
        : isAuthenticated;
  const isTargetLoading =
    target === 'ecoaudit'
      ? isEcoLoading
      : target === 'solarsense'
        ? isSolarLoading
        : isLoading;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isTargetLoading && isTargetAuthenticated) {
      router.replace(next);
    }
  }, [isTargetLoading, isTargetAuthenticated, router, next]);

  if (isTargetLoading || isTargetAuthenticated) return <Spinner />;

  async function handleSubmit(username: string, password: string) {
    setBusy(true);
    setError(null);
    try {
      await login(username, password, target);
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(
        target === 'solarsense'
          ? solarConnectionErrorMessage(err)
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
    <Suspense fallback={<Spinner />}>
      <LoginForm />
    </Suspense>
  );
}
