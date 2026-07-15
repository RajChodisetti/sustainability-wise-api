'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@solar/components/ui/Card';

/** /solar → /solar/dashboard */
export default function SolarIndexRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/solar/dashboard');
  }, [router]);
  return <Spinner />;
}
