'use client';

import { FleetProtectedLayout } from '@/components/layout/FleetProtectedLayout';

export default function FleetAppLayout({ children }: { children: React.ReactNode }) {
  return <FleetProtectedLayout>{children}</FleetProtectedLayout>;
}
