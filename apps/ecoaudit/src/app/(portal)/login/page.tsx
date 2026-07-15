'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { cloudConnectionErrorMessage } from '@/api/client';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import { AuthForm } from '@/components/auth/AuthForm';
import { Spinner } from '@/components/ui/Card';

function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

function LoginForm() {
  const { login, isAuthenticated, isLoading } = usePortalAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace(next);
    }
  }, [isLoading, isAuthenticated, router, next]);

  if (isLoading || isAuthenticated) return <Spinner />;

  async function handleSubmit(username: string, password: string) {
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(cloudConnectionErrorMessage(err));
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
