'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { Breadcrumbs } from '@/modules/installhub/components/InstallHubUi';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import {
  useInstallationTrees,
  useTreeWriter,
} from '@/modules/installhub/hooks/useInstallationTree';
import {
  createReplacementForm,
  deviceSearchRecords,
  filterDeviceSearchRecords,
  type DeviceSearchRecord,
} from '@/modules/installhub/lib/deviceSearch';
import type { InstallationTree } from '@/modules/installhub/types/domain';

function DeviceResultGroup({
  tree,
  records,
}: {
  tree: InstallationTree;
  records: DeviceSearchRecord[];
}) {
  const writer = useTreeWriter(tree.installation.id);
  const { user } = useInstallHubAuth();
  const router = useRouter();
  const toast = useToast();
  const [replacingId, setReplacingId] = useState<string | null>(null);

  async function replace(record: DeviceSearchRecord) {
    if (!user) {
      toast.error('Sign in before starting a replacement.');
      return;
    }
    setReplacingId(record.meterId);
    try {
      let formId = '';
      await writer.mutate((next) => {
        formId = createReplacementForm(next, user, record).id;
      }, 'metadata');
      toast.success('Replacement form created with this device selected.');
      router.push(`/installhub/installations/${record.installationId}/forms/${formId}`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
      setReplacingId(null);
    }
  }

  return (
    <section aria-labelledby={`device-site-${tree.installation.id}`}>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id={`device-site-${tree.installation.id}`} className="text-lg font-extrabold text-[var(--text)]">
            {tree.installation.siteName}
          </h2>
          <p className="text-xs text-[var(--text-sub)]">{tree.installation.siteAddress}</p>
        </div>
        <Link href={`/installhub/installations/${tree.installation.id}`} className="text-sm font-bold text-[var(--primary)] hover:underline">
          Open installation
        </Link>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {records.map((record) => (
          <Card key={record.meterId} className="h-full">
            <div className="flex h-full flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-extrabold text-[var(--text)]">{record.deviceName}</p>
                <p className="mt-1 text-sm font-semibold text-[var(--text-sub)]">
                  Device ID / serial: <span className="text-[var(--text)]">{record.serialNumber || 'Not recorded'}</span>
                </p>
                <p className="mt-2 text-sm text-[var(--text-sub)]">
                  {record.deviceModel} · {record.boardName} · {record.zoneName}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button
                  variant="secondary"
                  onClick={() => router.push(`/installhub/installations/${record.installationId}/zones/${record.zoneId}/boards/${record.boardId}/meters/${record.meterId}`)}
                >
                  Open
                </Button>
                <Button
                  onClick={() => void replace(record)}
                  disabled={Boolean(replacingId)}
                >
                  <Icon name="refresh" size={16} />
                  {replacingId === record.meterId ? 'Opening form…' : 'Replace'}
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function InstallHubDeviceSearchPage() {
  const treesQuery = useInstallationTrees();
  const [query, setQuery] = useState('');
  const [installationId, setInstallationId] = useState('');
  const records = useMemo(
    () => deviceSearchRecords(treesQuery.data || []),
    [treesQuery.data],
  );
  const filtered = useMemo(
    () => filterDeviceSearchRecords(records, query, installationId),
    [installationId, query, records],
  );

  if (treesQuery.isLoading) return <Spinner />;
  if (treesQuery.error) return <ErrorBanner message={installHubConnectionErrorMessage(treesQuery.error)} />;
  const trees = treesQuery.data || [];
  const recordsByInstallation = new Map<string, DeviceSearchRecord[]>();
  for (const record of filtered) {
    recordsByInstallation.set(record.installationId, [
      ...(recordsByInstallation.get(record.installationId) || []),
      record,
    ]);
  }

  return (
    <div>
      <Breadcrumbs items={[{ label: 'Find devices' }]} />
      <PageHeader
        title="Find devices"
        subtitle="Search every installation you can access, then open a device or start its replacement workflow."
      />

      <Card className="mb-6">
        <div className="grid gap-x-4 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
          <div>
            <FieldLabel htmlFor="device-global-search" className="mt-0">Search devices</FieldLabel>
            <div className="relative">
              <Icon name="search" size={18} className="pointer-events-none absolute left-3.5 top-3.5 text-[var(--muted)]" />
              <Input
                id="device-global-search"
                type="search"
                className="pl-10"
                value={query}
                autoFocus
                placeholder="Device ID, name, zone, switchboard, or type"
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="device-site-filter" className="mt-0">Installation</FieldLabel>
            <Select id="device-site-filter" value={installationId} onChange={(event) => setInstallationId(event.target.value)}>
              <option value="">All accessible installations</option>
              {trees.map((tree) => (
                <option key={tree.installation.id} value={tree.installation.id}>{tree.installation.siteName}</option>
              ))}
            </Select>
          </div>
        </div>
        <p className="mt-3 text-sm font-semibold text-[var(--text-sub)]" role="status" aria-live="polite">
          {filtered.length} device{filtered.length === 1 ? '' : 's'} found
        </p>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState
          icon="search"
          title="No devices match"
          description="Try a device ID, device name, zone, switchboard, or model such as A3RM."
        />
      ) : (
        <div className="space-y-8">
          {trees.flatMap((tree) => {
            const matches = recordsByInstallation.get(tree.installation.id);
            return matches?.length ? [<DeviceResultGroup key={tree.installation.id} tree={tree} records={matches} />] : [];
          })}
        </div>
      )}
    </div>
  );
}
