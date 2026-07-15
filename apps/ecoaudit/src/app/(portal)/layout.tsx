'use client';

import { PortalShell } from '@/components/portal/PortalShell';
import { PortalAuthGate } from '@/components/portal/PortalAuthGate';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalAuthGate>
      <PortalShell>{children}</PortalShell>
    </PortalAuthGate>
  );
}
