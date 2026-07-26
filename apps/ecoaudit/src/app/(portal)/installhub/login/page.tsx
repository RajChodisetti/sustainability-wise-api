'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/Card';

export default function InstallHubLoginRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/login?next=%2Finstallhub');
  }, [router]);
  return <Spinner fullPage label="Redirecting to sign in…" />;
}
