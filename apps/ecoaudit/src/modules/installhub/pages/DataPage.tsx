'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { PhotoThumb } from '@/components/photos/PhotoThumb';
import { StatusBadge } from '@/components/ui/Badges';
import { Button, LinkButton } from '@/components/ui/Button';
import {
  Card,
  EmptyState,
  ErrorBanner,
  PageHeader,
  Spinner,
  StatCard,
} from '@/components/ui/Card';
import { Checkbox, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/contexts/ToastContext';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import {
  Breadcrumbs,
  DefinitionList,
  InlineNotice,
} from '@/modules/installhub/components/InstallHubUi';
import { FORM_DEFINITION_BY_TYPE } from '@/modules/installhub/forms/catalog';
import {
  useInstallationTree,
  useTreeWriter,
} from '@/modules/installhub/hooks/useInstallationTree';
import {
  collectPhotoReferences,
  nowIso,
} from '@/modules/installhub/lib/model';
import type {
  ElectricalAsset,
  InstallationTree,
  SiteAsset,
} from '@/modules/installhub/types/domain';

function installationBreadcrumbs(
  tree: InstallationTree,
  installationId: string,
  label: string,
) {
  return [
    { label: 'Installations', href: '/installhub/installations' },
    {
      label: tree.installation.siteName,
      href: `/installhub/installations/${installationId}`,
    },
    { label },
  ];
}

function boardLabel(board: ElectricalAsset): string {
  return `${board.displayCode || 'No code'} — ${board.assetName || 'Unnamed switchboard'}`;
}

function assetLabel(asset: SiteAsset): string {
  return `${asset.displayCode || asset.assetType} — ${asset.assetName || 'Unnamed asset'}`;
}

export function InstallHubDataPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const toast = useToast();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  if (query.isLoading) return <Spinner />;
  if (query.error) {
    return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  }
  if (!query.data) return <ErrorBanner message="Installation not found." />;

  const tree = query.data;
  const tbcBoards = tree.electricalAssets.filter(
    (board) => board.electricalParentTbc,
  );
  const tbcAssetBoards = tree.siteAssets.filter(
    (asset) => asset.electricalBoardTbc,
  );
  const tbcMeterBoards = tree.siteAssets.filter(
    (asset) => asset.meterPresent && asset.meterSwitchboardTbc,
  );
  const meterCount = tree.electricalAssets.reduce(
    (total, board) => total + board.meters.length,
    0,
  );
  const tbcCount =
    tbcBoards.length + tbcAssetBoards.length + tbcMeterBoards.length;

  function candidateFor(key: string, candidates: ElectricalAsset[]): string {
    return choices[key] ?? candidates[0]?.id ?? '';
  }

  async function resolveBoard(
    boardId: string,
    parentId: string,
    key: string,
  ) {
    if (!parentId) {
      toast.error('Choose a parent switchboard first.');
      return;
    }
    setSavingKey(key);
    try {
      await writer.mutate((next) => {
        const board = next.electricalAssets.find((item) => item.id === boardId);
        if (!board) throw new Error('Switchboard not found.');
        board.electricalParentId = parentId;
        board.electricalParentTbc = false;
        board.updatedAt = nowIso();
      });
      toast.success('Switchboard relationship resolved.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setSavingKey(null);
    }
  }

  async function resolveSiteAsset(
    assetId: string,
    boardId: string,
    field: 'electrical' | 'meter',
    key: string,
  ) {
    if (!boardId) {
      toast.error('Choose a switchboard first.');
      return;
    }
    setSavingKey(key);
    try {
      await writer.mutate((next) => {
        const asset = next.siteAssets.find((item) => item.id === assetId);
        if (!asset) throw new Error('Site asset not found.');
        if (field === 'electrical') {
          asset.electricalBoardId = boardId;
          asset.electricalBoardTbc = false;
        } else {
          asset.meterSwitchboardId = boardId;
          asset.meterSwitchboardTbc = false;
        }
        asset.updatedAt = nowIso();
      });
      toast.success(
        field === 'electrical'
          ? 'Electrical supply relationship resolved.'
          : 'Metering switchboard relationship resolved.',
      );
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div>
      <Breadcrumbs
        items={installationBreadcrumbs(tree, installationId, 'Data view')}
      />
      <PageHeader
        title="Data view"
        subtitle={`${tree.installation.siteName} · Review the installation hierarchy and close every relationship marked TBC.`}
        actions={
          <Button variant="secondary" onClick={() => void writer.refresh()}>
            <Icon name="refresh" size={17} />
            Refresh
          </Button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Zones" value={tree.zones.length} icon="building" />
        <StatCard
          label="Switchboards"
          value={tree.electricalAssets.length}
          icon="zap"
        />
        <StatCard label="Meters" value={meterCount} icon="gauge" />
        <StatCard
          label="Open TBC"
          value={tbcCount}
          icon="activity"
          tone={tbcCount ? 'warning' : 'success'}
        />
      </div>

      <section className="mb-8" aria-labelledby="location-tree-heading">
        <div className="mb-3">
          <h2
            id="location-tree-heading"
            className="text-lg font-extrabold text-[var(--text)]"
          >
            Location tree
          </h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">
            {tree.zones.length} zones mapped to switchboards and site assets.
          </p>
        </div>
        {tree.zones.length === 0 ? (
          <EmptyState
            title="No zones mapped"
            description="Add a zone before building the electrical hierarchy."
            icon="building"
            actions={
              <LinkButton
                href={`/installhub/installations/${installationId}/zones/new`}
              >
                Add zone
              </LinkButton>
            }
          />
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {tree.zones.map((zone) => {
              const boards = tree.electricalAssets.filter(
                (board) => board.zoneId === zone.id,
              );
              const assets = tree.siteAssets.filter(
                (asset) => asset.zoneId === zone.id,
              );
              return (
                <Card key={zone.id} className="!p-4">
                  <Link
                    href={`/installhub/installations/${installationId}/zones/${zone.id}`}
                    className="group flex items-start justify-between gap-3"
                  >
                    <span>
                      <span className="font-extrabold text-[var(--text)] group-hover:text-[var(--primary)]">
                        {zone.zoneName}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-[var(--text-sub)]">
                        {zone.zoneDescription || 'No zone description'}
                      </span>
                    </span>
                    <Icon
                      name="chevron-right"
                      size={18}
                      className="shrink-0 text-[var(--muted)]"
                    />
                  </Link>
                  <div className="mt-4 border-t border-[var(--border)] pt-3">
                    <p className="text-xs font-bold uppercase tracking-[0.07em] text-[var(--muted)]">
                      {boards.length} switchboards · {assets.length} assets
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {boards.slice(0, 4).map((board) => (
                        <p
                          key={board.id}
                          className="text-sm text-[var(--text-sub)]"
                        >
                          <span className="font-bold text-[var(--text)]">
                            {board.displayCode || '—'}
                          </span>{' '}
                          {board.assetName}
                        </p>
                      ))}
                      {boards.length > 4 ? (
                        <p className="text-xs font-semibold text-[var(--muted)]">
                          +{boards.length - 4} more switchboards
                        </p>
                      ) : null}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="mb-8" aria-labelledby="registry-heading">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="registry-heading"
              className="text-lg font-extrabold text-[var(--text)]"
            >
              Wattwatcher registry
            </h2>
            <p className="mt-1 text-sm text-[var(--text-sub)]">
              Installed device identity and switchboard location.
            </p>
          </div>
          <LinkButton
            href={`/installhub/installations/${installationId}/metering`}
            variant="secondary"
          >
            Open full table
          </LinkButton>
        </div>
        {meterCount === 0 ? (
          <InlineNotice>
            No Wattwatcher meters are registered yet. Add one from a
            switchboard or complete a Wattwatcher installation form.
          </InlineNotice>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {tree.electricalAssets.flatMap((board) =>
              board.meters.map((meter) => (
                <Card key={meter.id} className="!p-4">
                  <DefinitionList
                    items={[
                      {
                        label: 'Device',
                        value:
                          meter.deviceName ||
                          meter.deviceId ||
                          'Unnamed meter',
                      },
                      { label: 'Switchboard', value: boardLabel(board) },
                      { label: 'Type', value: meter.deviceType },
                    ]}
                  />
                </Card>
              )),
            )}
          </div>
        )}
      </section>

      <section aria-labelledby="tbc-heading">
        <div className="mb-3">
          <h2
            id="tbc-heading"
            className="text-lg font-extrabold text-[var(--text)]"
          >
            TBC resolver ({tbcCount})
          </h2>
          <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
            Choose the confirmed switchboard for each unresolved electrical or
            metering relationship.
          </p>
        </div>
        {tbcCount === 0 ? (
          <InlineNotice tone="success">
            All recorded hierarchy relationships are resolved.
          </InlineNotice>
        ) : (
          <div className="space-y-3">
            {tbcBoards.map((board) => {
              const candidates = tree.electricalAssets.filter(
                (item) => item.id !== board.id,
              );
              const key = `board:${board.id}`;
              const value = candidateFor(key, candidates);
              return (
                <Card key={key} className="!p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold text-[var(--text)]">
                        Switchboard · {boardLabel(board)}
                      </p>
                      <p className="mt-1 text-sm text-[var(--text-sub)]">
                        Electrical parent unknown
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                      <Select
                        aria-label={`Parent for ${board.assetName}`}
                        value={value}
                        onChange={(event) =>
                          setChoices((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                      >
                        {candidates.length === 0 ? (
                          <option value="">No parent available</option>
                        ) : null}
                        {candidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {boardLabel(candidate)}
                          </option>
                        ))}
                      </Select>
                      <Button
                        disabled={!value || savingKey === key}
                        onClick={() =>
                          void resolveBoard(board.id, value, key)
                        }
                      >
                        {savingKey === key ? 'Saving…' : 'Resolve'}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}

            {tbcAssetBoards.map((asset) => {
              const zoneBoards = tree.electricalAssets.filter(
                (board) => board.zoneId === asset.zoneId,
              );
              const candidates = zoneBoards.length
                ? zoneBoards
                : tree.electricalAssets;
              const key = `asset-electrical:${asset.id}`;
              const value = candidateFor(key, candidates);
              return (
                <Card key={key} className="!p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold text-[var(--text)]">
                        Site asset · {assetLabel(asset)}
                      </p>
                      <p className="mt-1 text-sm text-[var(--text-sub)]">
                        Electrical supply switchboard unknown
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                      <Select
                        aria-label={`Electrical board for ${asset.assetName}`}
                        value={value}
                        onChange={(event) =>
                          setChoices((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                      >
                        {candidates.length === 0 ? (
                          <option value="">No switchboard available</option>
                        ) : null}
                        {candidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {boardLabel(candidate)}
                          </option>
                        ))}
                      </Select>
                      <Button
                        disabled={!value || savingKey === key}
                        onClick={() =>
                          void resolveSiteAsset(
                            asset.id,
                            value,
                            'electrical',
                            key,
                          )
                        }
                      >
                        {savingKey === key ? 'Saving…' : 'Resolve'}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}

            {tbcMeterBoards.map((asset) => {
              const zoneBoards = tree.electricalAssets.filter(
                (board) => board.zoneId === asset.zoneId,
              );
              const candidates = zoneBoards.length
                ? zoneBoards
                : tree.electricalAssets;
              const key = `asset-meter:${asset.id}`;
              const value = candidateFor(key, candidates);
              return (
                <Card key={key} className="!p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="font-extrabold text-[var(--text)]">
                        Metered asset · {assetLabel(asset)}
                      </p>
                      <p className="mt-1 text-sm text-[var(--text-sub)]">
                        Metering switchboard unknown
                      </p>
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row">
                      <Select
                        aria-label={`Metering board for ${asset.assetName}`}
                        value={value}
                        onChange={(event) =>
                          setChoices((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                      >
                        {candidates.length === 0 ? (
                          <option value="">No switchboard available</option>
                        ) : null}
                        {candidates.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {boardLabel(candidate)}
                          </option>
                        ))}
                      </Select>
                      <Button
                        disabled={!value || savingKey === key}
                        onClick={() =>
                          void resolveSiteAsset(
                            asset.id,
                            value,
                            'meter',
                            key,
                          )
                        }
                      >
                        {savingKey === key ? 'Saving…' : 'Resolve'}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

type MeteringRow = {
  key: string;
  href: string;
  name: string;
  kind: 'Board meter' | 'Site asset';
  board: string;
  type: string;
  identity: string;
  coverage: string;
  channels: string;
};

export function InstallHubMeteringPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);

  if (query.isLoading) return <Spinner />;
  if (query.error) {
    return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  }
  if (!query.data) return <ErrorBanner message="Installation not found." />;
  const tree = query.data;
  const rows: MeteringRow[] = [
    ...tree.electricalAssets.flatMap((board) =>
      board.meters.map((meter) => ({
        key: `meter:${meter.id}`,
        href: `/installhub/installations/${installationId}/zones/${board.zoneId}/boards/${board.id}/meters/${meter.id}`,
        name: meter.deviceName || meter.deviceId || 'Unnamed meter',
        kind: 'Board meter' as const,
        board: boardLabel(board),
        type: meter.deviceType,
        identity: [meter.deviceId, meter.deviceNumber]
          .filter(Boolean)
          .join(' · ') || '—',
        coverage: meter.coverage || meter.classification || '—',
        channels:
          meter.wwChannels
            ?.map((channel, index) =>
              channel.description || channel.loadType
                ? `Ch ${index + 1}: ${channel.description || channel.loadType}`
                : '',
            )
            .filter(Boolean)
            .join(', ') || '—',
      })),
    ),
    ...tree.siteAssets
      .filter((asset) => asset.meterPresent)
      .map((asset) => {
        const board = tree.electricalAssets.find(
          (item) => item.id === asset.meterSwitchboardId,
        );
        return {
          key: `asset:${asset.id}`,
          href: `/installhub/installations/${installationId}/zones/${asset.zoneId}/assets/${asset.id}`,
          name: asset.assetName || 'Unnamed site asset',
          kind: 'Site asset' as const,
          board: board ? boardLabel(board) : asset.meterSwitchboardTbc ? 'TBC' : '—',
          type: asset.assetType,
          identity: asset.displayCode || '—',
          coverage: asset.assetName || '—',
          channels:
            asset.meterChannels
              .map((channel) =>
                `Ch ${channel.channel}${channel.description ? `: ${channel.description}` : ''}`,
              )
              .join(', ') || '—',
        };
      }),
  ];

  return (
    <div>
      <Breadcrumbs
        items={installationBreadcrumbs(
          tree,
          installationId,
          'Metering table',
        )}
      />
      <PageHeader
        title="Metering assets"
        subtitle={`${tree.installation.siteName} · ${rows.length} registered metering rows`}
        actions={
          <LinkButton
            href={`/installhub/installations/${installationId}/data`}
            variant="secondary"
          >
            Data view
          </LinkButton>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="No metering assets"
          description="Add a meter to a switchboard, complete an installation form, or mark a site asset as metered."
          icon="gauge"
          actions={
            <LinkButton
              href={`/installhub/installations/${installationId}/zones`}
            >
              Open zones
            </LinkButton>
          }
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xs)] md:block">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead className="bg-[var(--surface2)] text-xs uppercase tracking-[0.06em] text-[var(--text-sub)]">
                <tr>
                  {[
                    'Device / asset',
                    'Kind',
                    'Switchboard',
                    'Type',
                    'Identity',
                    'Coverage',
                    'Channels',
                  ].map((heading) => (
                    <th
                      key={heading}
                      scope="col"
                      className="border-b border-[var(--border)] px-4 py-3 font-extrabold"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.key}
                    className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface2)]"
                  >
                    <td className="px-4 py-3 font-bold">
                      <Link
                        href={row.href}
                        className="text-[var(--primary)] hover:underline"
                      >
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--text-sub)]">
                      {row.kind}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-sub)]">
                      {row.board}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-sub)]">
                      {row.type}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-sub)]">
                      {row.identity}
                    </td>
                    <td className="px-4 py-3 text-[var(--text-sub)]">
                      {row.coverage}
                    </td>
                    <td className="max-w-xs px-4 py-3 text-[var(--text-sub)]">
                      {row.channels}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid gap-3 md:hidden">
            {rows.map((row) => (
              <Card key={row.key} className="!p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={row.href}
                      className="font-extrabold text-[var(--primary)]"
                    >
                      {row.name}
                    </Link>
                    <p className="mt-1 text-xs font-bold uppercase tracking-[0.06em] text-[var(--muted)]">
                      {row.kind}
                    </p>
                  </div>
                  <Icon
                    name="chevron-right"
                    size={18}
                    className="shrink-0 text-[var(--muted)]"
                  />
                </div>
                <div className="mt-4">
                  <DefinitionList
                    items={[
                      { label: 'Switchboard', value: row.board },
                      { label: 'Type', value: row.type },
                      { label: 'Identity', value: row.identity },
                      { label: 'Coverage', value: row.coverage },
                      { label: 'Channels', value: row.channels },
                    ]}
                  />
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export const installHubPhotoSelectionStorageKey = (installationId: string) =>
  `ih_client_report_photo_selection:${installationId}`;

type GalleryItem = ReturnType<typeof collectPhotoReferences>[number] & {
  uri: string;
};

export function InstallHubPhotosPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem(
        installHubPhotoSelectionStorageKey(installationId),
      );
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, boolean>;
        window.setTimeout(() => setExcluded(parsed), 0);
      }
    } catch {
      // A blocked or corrupt browser cache must not prevent evidence review.
    }
  }, [installationId]);

  if (query.isLoading) return <Spinner />;
  if (query.error) {
    return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  }
  if (!query.data) return <ErrorBanner message="Installation not found." />;
  const tree = query.data;
  const photos = collectPhotoReferences(tree) as GalleryItem[];
  const missing = [
    ...tree.zones
      .filter((zone) => zone.photos.length === 0)
      .map((zone) => `Zone · ${zone.zoneName}`),
    ...tree.electricalAssets
      .filter(
        (board) =>
          !board.photo &&
          board.extraPhotos.length === 0 &&
          board.meters.every(
            (meter) =>
              !meter.wwPhotos?.deviceInstalled &&
              !meter.wwPhotos?.switchboardOverview &&
              !meter.wwPhotos?.labeling &&
              !(meter.wwPhotos?.extra?.length),
          ),
      )
      .map((board) => `Switchboard · ${boardLabel(board)}`),
    ...tree.siteAssets
      .filter(
        (asset) => !asset.locationPhoto && asset.extraPhotos.length === 0,
      )
      .map((asset) => `Site asset · ${assetLabel(asset)}`),
  ];
  const includedCount = photos.filter((photo) => !excluded[photo.key]).length;

  function toggle(key: string, included: boolean) {
    setExcluded((current) => {
      const next = { ...current };
      if (included) delete next[key];
      else next[key] = true;
      try {
        localStorage.setItem(
          installHubPhotoSelectionStorageKey(installationId),
          JSON.stringify(next),
        );
      } catch {
        // Selection remains usable for the current view without browser storage.
      }
      return next;
    });
  }

  return (
    <div>
      <Breadcrumbs
        items={installationBreadcrumbs(tree, installationId, 'Photo gallery')}
      />
      <PageHeader
        title="Photo preview"
        subtitle={`${tree.installation.siteName} · Choose which evidence appears in the browser client-report preview.`}
        actions={
          <LinkButton
            href={`/installhub/installations/${installationId}/client-report`}
            variant="secondary"
          >
            <Icon name="eye" size={17} />
            Client report
          </LinkButton>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <StatCard label="Evidence files" value={photos.length} icon="camera" />
        <StatCard
          label="Included"
          value={includedCount}
          icon="check"
          tone="success"
        />
        <StatCard
          label="Items without evidence"
          value={missing.length}
          icon="activity"
          tone={missing.length ? 'warning' : 'success'}
        />
      </div>

      {photos.length === 0 ? (
        <EmptyState
          title="No photos captured"
          description="Photo evidence uploaded from zone, asset, meter, and form workflows appears here."
          icon="camera"
          actions={
            <LinkButton
              href={`/installhub/installations/${installationId}/zones`}
            >
              Open zones
            </LinkButton>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {photos.map((photo) => (
            <Card key={photo.key} className="overflow-hidden !p-3">
              <PhotoThumb
                app="installhub"
                uri={photo.uri}
                label={photo.label}
                className="h-52 w-full rounded-xl object-cover"
              />
              <div className="px-1 pb-1 pt-3">
                <p className="min-h-10 text-sm font-bold leading-5 text-[var(--text)]">
                  {photo.label}
                </p>
                <Checkbox
                  label="Include in client report preview"
                  checked={!excluded[photo.key]}
                  onChange={(checked) => toggle(photo.key, checked)}
                />
              </div>
            </Card>
          ))}
        </div>
      )}

      {missing.length ? (
        <section className="mt-8" aria-labelledby="missing-evidence-heading">
          <h2
            id="missing-evidence-heading"
            className="mb-3 text-lg font-extrabold text-[var(--text)]"
          >
            Items without evidence
          </h2>
          <Card>
            <ul className="grid gap-2 text-sm text-[var(--text-sub)] sm:grid-cols-2">
              {missing.map((label) => (
                <li key={label} className="flex items-center gap-2">
                  <Icon
                    name="camera"
                    size={16}
                    className="shrink-0 text-[var(--muted)]"
                  />
                  {label}
                </li>
              ))}
            </ul>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

export function InstallHubClientReportPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem(
        installHubPhotoSelectionStorageKey(installationId),
      );
      if (saved) {
        const parsed = JSON.parse(saved) as Record<string, boolean>;
        window.setTimeout(() => setExcluded(parsed), 0);
      }
    } catch {
      // Use the default all-included report if browser storage is unavailable.
    }
  }, [installationId]);

  if (query.isLoading) return <Spinner />;
  if (query.error) {
    return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  }
  if (!query.data) return <ErrorBanner message="Installation not found." />;
  const tree = query.data;
  const meters = tree.electricalAssets.reduce(
    (total, board) => total + board.meters.length,
    0,
  );
  const completedForms = tree.formSubmissions.filter(
    (form) => form.status === 'Completed',
  );
  const openTbc =
    tree.electricalAssets.filter((board) => board.electricalParentTbc).length +
    tree.siteAssets.filter(
      (asset) =>
        asset.electricalBoardTbc ||
        (asset.meterPresent && asset.meterSwitchboardTbc),
    ).length;
  const photos = collectPhotoReferences(tree);
  const includedPhotos = photos.filter((photo) => !excluded[photo.key]);
  const completedFormNames = Array.from(
    new Set(
      completedForms.map(
        (form) =>
          FORM_DEFINITION_BY_TYPE[form.formType]?.shortTitle ?? form.formType,
      ),
    ),
  );

  return (
    <div>
      <div className="print:hidden">
        <Breadcrumbs
          items={installationBreadcrumbs(
            tree,
            installationId,
            'Client report',
          )}
        />
        <PageHeader
          title="Client report"
          subtitle="A client-facing browser summary derived from the live installation record."
          actions={
            <>
              <LinkButton
                href={`/installhub/installations/${installationId}/photos`}
                variant="secondary"
              >
                <Icon name="camera" size={17} />
                Choose photos
              </LinkButton>
              <Button onClick={() => window.print()}>
                <Icon name="download" size={17} />
                Print / save PDF
              </Button>
            </>
          }
        />
      </div>

      <article className="mx-auto max-w-5xl rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-xs)] print:max-w-none print:border-0 print:p-0 print:shadow-none sm:p-8">
        <header className="border-b-2 border-[var(--primary)] pb-6">
          <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[var(--primary)]">
            InstallHub
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-[-0.04em] text-[var(--text)]">
            Installation summary
          </h1>
          <p className="mt-3 text-xl font-bold text-[var(--text)]">
            {tree.installation.siteName}
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">
            {tree.installation.clientName} · {tree.installation.siteAddress}
          </p>
        </header>

        <section className="border-b border-[var(--border)] py-6">
          <DefinitionList
            items={[
              {
                label: 'Installer',
                value: tree.installation.inspectorName,
              },
              { label: 'Date', value: tree.installation.auditDate },
              {
                label: 'Status',
                value: <StatusBadge status={tree.installation.status} />,
              },
              { label: 'Zones', value: tree.zones.length },
              { label: 'Switchboards', value: tree.electricalAssets.length },
              { label: 'Meters', value: meters },
            ]}
          />
        </section>

        <section className="border-b border-[var(--border)] py-6">
          <h2 className="text-xl font-extrabold text-[var(--text)]">
            Electrical overview
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
            {tree.electricalAssets.length} switchboards and {meters} installed
            meter devices were documented across {tree.zones.length} site
            zones.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {tree.zones.map((zone) => {
              const boards = tree.electricalAssets.filter(
                (board) => board.zoneId === zone.id,
              );
              const assets = tree.siteAssets.filter(
                (asset) => asset.zoneId === zone.id,
              );
              return (
                <div
                  key={zone.id}
                  className="rounded-xl bg-[var(--surface2)] p-4"
                >
                  <p className="font-extrabold text-[var(--text)]">
                    {zone.zoneName}
                  </p>
                  <p className="mt-1 text-sm text-[var(--text-sub)]">
                    {boards.length} switchboards · {assets.length} site assets
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="border-b border-[var(--border)] py-6">
          <h2 className="text-xl font-extrabold text-[var(--text)]">
            Loads and site assets
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
            {tree.siteAssets.length} site assets were recorded;{' '}
            {tree.siteAssets.filter((asset) => asset.meterPresent).length} are
            mapped for metering.
          </p>
          {tree.siteAssets.length ? (
            <div className="mt-4 overflow-hidden rounded-xl border border-[var(--border)]">
              {tree.siteAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center justify-between gap-4 border-b border-[var(--border)] px-4 py-3 last:border-0"
                >
                  <span>
                    <span className="block text-sm font-bold text-[var(--text)]">
                      {asset.assetName}
                    </span>
                    <span className="block text-xs text-[var(--text-sub)]">
                      {asset.assetType}
                    </span>
                  </span>
                  <span className="text-xs font-bold text-[var(--text-sub)]">
                    {asset.meterPresent ? 'Metered' : 'Not metered'}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="border-b border-[var(--border)] py-6">
          <h2 className="text-xl font-extrabold text-[var(--text)]">
            Commissioning records
          </h2>
          <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
            {completedForms.length} completed field forms
            {completedFormNames.length
              ? `: ${completedFormNames.join(', ')}.`
              : '.'}
          </p>
          <p
            className={`mt-3 text-sm font-bold ${
              openTbc ? 'text-[var(--amber)]' : 'text-[var(--green)]'
            }`}
          >
            {openTbc
              ? `${openTbc} hierarchy relationship${openTbc === 1 ? '' : 's'} remain to be confirmed.`
              : 'All recorded hierarchy relationships are confirmed.'}
          </p>
        </section>

        <section className="py-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-extrabold text-[var(--text)]">
                Selected evidence
              </h2>
              <p className="mt-2 text-sm text-[var(--text-sub)]">
                {includedPhotos.length} of {photos.length} available photos
                included in this preview.
              </p>
            </div>
          </div>
          {includedPhotos.length ? (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {includedPhotos.map((photo) => (
                <figure key={photo.key}>
                  <PhotoThumb
                    app="installhub"
                    uri={photo.uri}
                    label={photo.label}
                    className="h-40 w-full rounded-xl object-cover print:h-32"
                  />
                  <figcaption className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
                    {photo.label}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--text-sub)]">
              No evidence selected for this preview.
            </p>
          )}
        </section>
      </article>

      <div className="mt-5 flex justify-end print:hidden">
        <LinkButton
          href={`/installhub/installations/${installationId}/report`}
        >
          Generate formal report pack
          <Icon name="arrow-right" size={17} />
        </LinkButton>
      </div>
    </div>
  );
}
