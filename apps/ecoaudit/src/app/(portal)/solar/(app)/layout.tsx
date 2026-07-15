'use client';

import { SolarProtectedLayout } from '@/components/layout/SolarProtectedLayout';

export default function SolarAppLayout({ children }: { children: React.ReactNode }) {
  return <SolarProtectedLayout>{children}</SolarProtectedLayout>;
}
