'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { me } from '@solar/api/auth';
import { cloudConnectionErrorMessage } from '@solar/api/client';
import { pullSync, testCloudConnection } from '@solar/api/sync';
import { localUsernameFromCloudEmail } from '@solar/api/auth';
import { useToast } from '@/contexts/ToastContext';
import { RemoteSitesPanel } from '@solar/components/cloud/RemoteSitesPanel';
import { Button, LinkButton } from '@solar/components/ui/Button';
import { Card, PageHeader, Spinner } from '@solar/components/ui/Card';
import { API_DISPLAY_URL } from '@solar/lib/config';
import { Input } from '@solar/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';

export default function CloudBackupPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [testing, setTesting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pulling, setPulling] = useState(false);

  const accountQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: me,
  });

  async function handleTestConnection() {
    setTesting(true);
    try {
      await testCloudConnection();
      toast.success('Successfully reached the Cloud Backup server.');
    } catch (e) {
      const msg = e instanceof Error && e.name === 'AbortError'
        ? 'Connection timed out after 10 seconds.'
        : cloudConnectionErrorMessage(e);
      toast.error(`Cannot reach the Cloud Backup server: ${msg}`);
    } finally {
      setTesting(false);
    }
  }

  async function handleRefreshConnection() {
    setRefreshing(true);
    try {
      const result = await accountQuery.refetch();
      if (!result.data?.id) throw new Error('Cloud account not available.');
      toast.success('Cloud Backup is connected to your SolarSense account.');
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  async function handlePullAll() {
    setPulling(true);
    try {
      const result = await pullSync();
      await queryClient.invalidateQueries();
      const count = (result.sites?.length ?? 0) + (result.assessments?.length ?? 0);
      toast.success(`Cloud import complete. ${count} record(s) refreshed.`);
    } catch (e) {
      toast.error(cloudConnectionErrorMessage(e));
    } finally {
      setPulling(false);
    }
  }

  const account = accountQuery.data;
  const host = API_DISPLAY_URL.replace(/^https?:\/\//, '');
  const username = account?.email ? localUsernameFromCloudEmail(account.email) : '—';

  return (
    <div>
      <PageHeader
        title="Cloud Backup"
        subtitle="Check connectivity and import the latest Solar Sense site records."
        actions={<LinkButton href="/solar/settings" variant="secondary">Settings</LinkButton>}
      />

      <div className="grid max-w-3xl gap-4">
        <Card className="border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30">
          <h2 className="text-base font-black text-emerald-900 dark:text-emerald-100">Cloud Account</h2>
          <p className="mt-1 text-sm leading-relaxed text-emerald-800 dark:text-emerald-200">
            Cloud Backup connects your SolarSense account to the API server. Sites sync automatically when you work online in the web app.
          </p>
          <p className="mt-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">{host}</p>
        </Card>

        <Card>
          <label htmlFor="cloud-api-url" className="text-sm font-bold text-[var(--text)]">API Server URL</label>
          <Input
            id="cloud-api-url"
            readOnly
            value={API_DISPLAY_URL}
            className="mt-2 bg-[var(--surface2)]"
          />
        </Card>

        {accountQuery.isLoading ? (
          <Spinner />
        ) : account ? (
          <Card>
            <p className="font-bold text-[var(--text)]">{username}</p>
            <p className="text-sm text-[var(--text-sub)]">{account.fullName || username}</p>
            <p className="mt-1 text-xs capitalize text-[var(--muted)]">{account.role} · cloud account</p>
            <p className="mt-3 text-sm text-[var(--text-sub)]">
              Cloud Backup is active. Use Import below to pull the latest site data from the server.
            </p>
          </Card>
        ) : (
          <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20">
            <p className="font-bold text-red-800 dark:text-red-200">Connection Pending</p>
            <p className="mt-1 text-sm text-red-700 dark:text-red-300">
              Cloud Backup will connect when the API server is reachable and you are signed in.
            </p>
          </Card>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void handleTestConnection()} disabled={testing}>
            {testing ? 'Testing…' : 'Test Connection'}
          </Button>
          <Button variant="secondary" onClick={() => void handleRefreshConnection()} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh Connection'}
          </Button>
          <Button onClick={() => void handlePullAll()} disabled={pulling}>
            <Icon name="cloud" size={18} />
            {pulling ? 'Importing…' : 'Import All from Cloud'}
          </Button>
        </div>

        <RemoteSitesPanel />
      </div>
    </div>
  );
}
