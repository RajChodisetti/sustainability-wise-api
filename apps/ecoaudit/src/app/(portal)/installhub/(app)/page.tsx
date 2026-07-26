'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/Card';

export default function InstallHubIndexRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/installhub/dashboard');
  }, [router]);
  return <Spinner />;
}
