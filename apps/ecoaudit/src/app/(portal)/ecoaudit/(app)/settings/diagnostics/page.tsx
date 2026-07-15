'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { checkHealth } from '@/api/client';
import { pullSync } from '@/api/sync';
import { SettingsInfoRow, SettingsSection } from '@/components/settings/SettingsParts';
import { PageHeader, Spinner } from '@/components/ui/Card';
import { API_DISPLAY_URL } from '@/lib/config';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/contexts/ToastContext';

export default function DiagnosticsPage() {
  const toast = useToast();
  const health = useQuery({ queryKey: ['health'], queryFn: checkHealth });

  async function testPull() {
    try {
      const since = new Date(0).toISOString();
      const result = await pullSync(since);
      toast.success(`Pull OK — ${result.audits.length} audits at ${result.pulledAt}`);
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Diagnostics" actions={<Link href="/ecoaudit/settings" className="text-sm text-[var(--primary)]">Back</Link>} />
      {health.isLoading ? <Spinner /> : (
        <div className="space-y-4">
          <SettingsSection title="API">
            <SettingsInfoRow label="Server" value={API_DISPLAY_URL} />
            <SettingsInfoRow label="Health" value={health.data ? 'OK' : 'Offline'} />
          </SettingsSection>
          <SettingsSection title="Sync">
            <div className="px-4 py-4">
              <Button variant="secondary" onClick={() => void testPull()}>Test sync pull</Button>
            </div>
          </SettingsSection>
        </div>
      )}
    </div>
  );
}
