'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Spinner } from '@/components/ui/Card';

/** /ecoaudit → /ecoaudit/dashboard */
export default function EcoAuditIndexRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/ecoaudit/dashboard');
  }, [router]);
  return <Spinner />;
}
