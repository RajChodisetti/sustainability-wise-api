'use client';

import { SolarAdminLayout } from '@/components/layout/SolarProtectedLayout';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <SolarAdminLayout>{children}</SolarAdminLayout>;
}
