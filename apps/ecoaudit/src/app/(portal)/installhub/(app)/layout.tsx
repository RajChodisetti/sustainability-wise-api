'use client';

import { InstallHubProtectedLayout } from '@/modules/installhub/components/ProtectedLayout';

export default function InstallHubAppLayout({ children }: { children: React.ReactNode }) {
  return <InstallHubProtectedLayout>{children}</InstallHubProtectedLayout>;
}
