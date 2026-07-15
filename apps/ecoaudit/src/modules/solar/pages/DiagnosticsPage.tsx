'use client';

import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { checkHealth, getStoredJwt } from '@solar/api/client';
import { useAuth } from '@solar/contexts/AuthContext';
import { pullSync } from '@solar/api/sync';
import { useSites, useAllAssessments } from '@solar/hooks/useSites';
import { useToast } from '@/contexts/ToastContext';
import { SettingsDivider, SettingsInfoRow, SettingsSection } from '@solar/components/settings/SettingsParts';
import { Button } from '@solar/components/ui/Button';
import { PageHeader, Spinner } from '@solar/components/ui/Card';
import { API_DISPLAY_URL } from '@solar/lib/config';
import { cloudConnectionErrorMessage } from '@solar/api/client';
import { useState } from 'react';

export default function DiagnosticsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const sitesQuery = useSites();
  const assessmentsQuery = useAllAssessments();
  const health = useQuery({ queryKey: ['health'], queryFn: checkHealth });

  async function handlePullSync() {
    setSyncing(true);
    try {
      await pullSync();
      await queryClient.invalidateQueries();
      toast.success('Cloud sync completed successfully.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    } finally {
      setSyncing(false);
    }
  }

  const loading = sitesQuery.isLoading || assessmentsQuery.isLoading;

  return (
    <div className="max-w-2xl">
      <PageHeader title="Diagnostics" actions={<Link href="/solar/settings" className="text-sm text-[var(--primary)]">‹ Settings</Link>} />

      <div className="space-y-4">
        <SettingsSection title="Database">
          <SettingsInfoRow label="Store" value="SolarSense · Cloud API" />
          <SettingsDivider />
          <SettingsInfoRow label="Migration" value="N/A (web)" />
          <SettingsDivider />
          <SettingsInfoRow
            label="Status"
            value={health.isLoading ? 'Checking…' : health.data ? 'OK' : 'Error'}
          />
        </SettingsSection>

        <SettingsSection title="Table Row Counts">
          {loading ? (
            <div className="p-4"><Spinner /></div>
          ) : (
            <>
              <SettingsInfoRow label="sites" value={String(sitesQuery.data?.length ?? 0)} />
              <SettingsDivider />
              <SettingsInfoRow label="rooftop_assessments" value={String(assessmentsQuery.data?.length ?? 0)} />
              <SettingsDivider />
              <SettingsInfoRow label="local_users" value="N/A" />
              <SettingsDivider />
              <SettingsInfoRow label="sync_queue" value="N/A (online)" />
              <SettingsDivider />
              <SettingsInfoRow label="photo_upload_queue" value="N/A (online)" />
            </>
          )}
        </SettingsSection>

        <SettingsSection title="Cloud Backup">
          <SettingsInfoRow label="Server" value={API_DISPLAY_URL.replace(/^https?:\/\//, '')} />
          <SettingsDivider />
          <SettingsInfoRow label="JWT stored" value={getStoredJwt() ? 'Yes' : 'No'} />
          <SettingsDivider />
          <SettingsInfoRow label="User ID" value={user?.id ?? '—'} />
          <SettingsDivider />
          <SettingsInfoRow label="Health" value={health.data ? 'Connected' : 'Offline'} />
          <div className="p-4">
            <Button className="w-full" onClick={() => void handlePullSync()} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Run Sync Now'}
            </Button>
          </div>
        </SettingsSection>

        <Button variant="secondary" className="w-full" onClick={() => void queryClient.invalidateQueries()}>
          Refresh
        </Button>
      </div>
    </div>
  );
}
