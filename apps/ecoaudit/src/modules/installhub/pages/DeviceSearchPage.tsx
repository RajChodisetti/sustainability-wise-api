'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldHint, FieldLabel, Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { Breadcrumbs } from '@/modules/installhub/components/InstallHubUi';
import { useInstallHubAuth } from '@/modules/installhub/contexts/AuthContext';
import {
  useInstallationTree,
  useTreeWriter,
} from '@/modules/installhub/hooks/useInstallationTree';
import {
  createReplacementForm,
  createPlannedReplacementForm,
  deviceSearchRecords,
  filterDeviceSearchRecords,
  type DeviceSearchRecord,
} from '@/modules/installhub/lib/deviceSearch';
import { plannedReplacementMeterNumber } from '@/modules/installhub/components/ReplacementMeterPicker';
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
      toast.success('Comms fault / replacement form created with this device selected.');
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
        {records.map((record) => {
          const supportsCommsReplacement = record.supportsCommsReplacement;
          return (
          <Card key={record.meterId} className="h-full">
            <div className="flex h-full flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="font-extrabold text-[var(--text)]">{record.deviceName}</p>
                <p className="mt-1 break-words text-sm font-semibold leading-5 text-[var(--text-sub)]">
                  Device name: <span className="text-[var(--text)]">{record.deviceCustomName || 'Not recorded'}</span>
                </p>
                {record.deviceDisplayName ? (
                  <p className="mt-1 break-words text-sm font-semibold leading-5 text-[var(--text-sub)]">
                    Asset ID: <span className="text-[var(--text)]">{record.deviceDisplayName}</span>
                  </p>
                ) : null}
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
                {supportsCommsReplacement ? (
                  <Button
                    onClick={() => void replace(record)}
                    disabled={Boolean(replacingId)}
                  >
                    <Icon name="refresh" size={16} />
                    {replacingId === record.meterId ? 'Opening form…' : 'Replace / comms fault'}
                  </Button>
                ) : null}
              </div>
            </div>
            {!supportsCommsReplacement ? (
              <p className="text-xs font-semibold text-[var(--text-sub)]">
                The comms-fault replacement form is available for A3RM and A6M devices.
              </p>
            ) : null}
          </Card>
          );
        })}
      </div>
    </section>
  );
}

function PlannedReplacementCard({
  tree,
  meterNumber,
}: {
  tree: InstallationTree;
  meterNumber: string;
}) {
  const writer = useTreeWriter(tree.installation.id);
  const { user } = useInstallHubAuth();
  const router = useRouter();
  const toast = useToast();
  const boards = useMemo(() => [...tree.electricalAssets].sort((left, right) => (
    left.assetName.localeCompare(right.assetName) || left.id.localeCompare(right.id)
  )), [tree.electricalAssets]);
  const [boardId, setBoardId] = useState(boards[0]?.id ?? '');
  const [deviceModel, setDeviceModel] = useState<'A3RM' | 'A6M'>('A3RM');
  const [busy, setBusy] = useState(false);
  const selectedBoardId = boards.some((board) => board.id === boardId)
    ? boardId
    : boards[0]?.id ?? '';

  async function startReplacement() {
    if (!user || !selectedBoardId || busy) return;
    setBusy(true);
    try {
      let formId = '';
      await writer.mutate((next) => {
        formId = createPlannedReplacementForm(next, user, {
          boardId: selectedBoardId,
          deviceModel,
          meterNumber,
        }).id;
      }, 'metadata');
      toast.success('Existing meter captured. Complete the replacement details in the Comms Fault form.');
      router.push(`/installhub/installations/${tree.installation.id}/forms/${formId}`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
      setBusy(false);
    }
  }

  return (
    <Card className="mb-6 border-[var(--primary)]/40">
      <h2 className="text-lg font-extrabold text-[var(--text)]">Planned meter {meterNumber}</h2>
      <FieldHint>
        This meter is in the M2 job plan but is not recorded in the copied site data. Confirm its existing type and actual switchboard before starting the replacement form.
      </FieldHint>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <FieldLabel htmlFor="planned-existing-device-type" className="mt-0">Existing meter type</FieldLabel>
          <Select
            id="planned-existing-device-type"
            value={deviceModel}
            disabled={busy || tree.installation.status === 'Completed'}
            onChange={(event) => setDeviceModel(event.target.value as 'A3RM' | 'A6M')}
          >
            <option value="A3RM">A3RM</option>
            <option value="A6M">A6M</option>
          </Select>
        </div>
        <div>
          <FieldLabel htmlFor="planned-existing-board" className="mt-0">Installed switchboard</FieldLabel>
          <Select
            id="planned-existing-board"
            value={selectedBoardId}
            disabled={busy || tree.installation.status === 'Completed' || boards.length === 0}
            onChange={(event) => setBoardId(event.target.value)}
          >
            {boards.length === 0 ? <option value="">No switchboards available</option> : null}
            {boards.map((board) => {
              const zoneName = tree.zones.find((zone) => zone.id === board.zoneId)?.zoneName;
              return <option key={board.id} value={board.id}>{board.assetName}{zoneName ? ` · ${zoneName}` : ''}</option>;
            })}
          </Select>
        </div>
      </div>
      {boards.length === 0 ? (
        <p className="mt-3 text-sm font-semibold text-[var(--red)]" role="alert">
          Add the switchboard where this meter is installed before starting its replacement.
        </p>
      ) : null}
      <Button
        className="mt-4"
        disabled={busy || !selectedBoardId || tree.installation.status === 'Completed' || writer.hasPendingTree}
        onClick={() => void startReplacement()}
      >
        <Icon name="refresh" size={16} />
        {busy ? 'Opening form…' : 'Capture old meter and start replacement'}
      </Button>
    </Card>
  );
}

export function InstallHubDeviceSearchPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const search = useSearchParams();
  const treeQuery = useInstallationTree(installationId);
  const [query, setQuery] = useState(search.get('q')?.trim() ?? '');
  const records = useMemo(
    () => deviceSearchRecords(treeQuery.data ? [treeQuery.data] : []),
    [treeQuery.data],
  );
  const filtered = useMemo(
    () => filterDeviceSearchRecords(records, query, installationId),
    [installationId, query, records],
  );
  const plannedMeter = treeQuery.data?.installation.serviceType === 'M2 - Faults / COMMS fault'
    ? plannedReplacementMeterNumber(treeQuery.data.installation.existingDeviceId, query)
    : null;
  const plannedMeterKey = plannedMeter?.toLocaleLowerCase('en-AU') ?? '';
  const plannedMeterIsRecorded = Boolean(plannedMeter && records.some((record) => (
    [record.serialNumber, record.deviceNumber]
      .filter(Boolean)
      .some((value) => value.trim().toLocaleLowerCase('en-AU') === plannedMeterKey)
  )));

  if (treeQuery.isLoading) return <Spinner />;
  if (treeQuery.error) return <ErrorBanner message={installHubConnectionErrorMessage(treeQuery.error)} />;
  const tree = treeQuery.data;
  if (!tree) return <ErrorBanner message="Installation not found." />;

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: tree.installation.siteName, href: `/installhub/installations/${installationId}` },
        { label: 'Find devices' },
      ]} />
      <PageHeader
        title="Find devices"
        subtitle="Search every zone in this installation, then open a device or start a comms fault / replacement workflow."
      />

      <Card className="mb-6">
        <FieldLabel htmlFor="device-installation-search" className="mt-0">Search devices</FieldLabel>
        <div className="relative">
          <Icon name="search" size={18} className="pointer-events-none absolute left-3.5 top-3.5 text-[var(--muted)]" />
          <Input
            id="device-installation-search"
            type="search"
            className="pl-10"
            value={query}
            autoFocus
            placeholder="Device ID, name, zone, switchboard, or type"
            onChange={(event) => setQuery(event.target.value)}
          />
          </div>
        <p className="mt-3 text-sm font-semibold text-[var(--text-sub)]" role="status" aria-live="polite">
          {filtered.length} device{filtered.length === 1 ? '' : 's'} found
        </p>
      </Card>

      {plannedMeter && !plannedMeterIsRecorded ? (
        <PlannedReplacementCard tree={tree} meterNumber={plannedMeter} />
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          icon="search"
          title="No devices match"
          description={plannedMeter && !plannedMeterIsRecorded
            ? 'The planned meter can be captured above before its replacement form is started.'
            : 'Try a device ID, device name, zone, switchboard, or model such as A3RM.'}
        />
      ) : (
        <DeviceResultGroup tree={tree} records={filtered} />
      )}
    </div>
  );
}
