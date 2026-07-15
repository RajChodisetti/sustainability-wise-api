'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function RedirectToPortalLogin() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/login?next=%2Fecoaudit');
  }, [router]);
  return null;
}
