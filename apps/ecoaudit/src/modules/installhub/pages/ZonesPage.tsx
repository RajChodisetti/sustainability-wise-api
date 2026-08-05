'use client';
/* eslint-disable react-hooks/set-state-in-effect -- hydrates the zone editor once its installation query resolves */

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { FieldLabel, Input, Textarea } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { EvidenceField } from '@/modules/installhub/components/EvidenceField';
import { Breadcrumbs, DefinitionList, RecordNavigation } from '@/modules/installhub/components/InstallHubUi';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { uploadInstallationPhoto } from '@/modules/installhub/api/installhub';
import { useInstallationTree, useTreeWriter } from '@/modules/installhub/hooks/useInstallationTree';
import { createZone, nowIso, removeZone } from '@/modules/installhub/lib/model';
import { zoneElectricalSummary } from '@/modules/installhub/lib/electricalPresentation';
import { coverageState, localReadiness, siteAssetMeteringState } from '@/modules/installhub/lib/workflow';
import { useToast } from '@/contexts/ToastContext';

const ZONE_RECORD_PAGE_SIZE = 50;

function zonePageItems<T>(items: T[], page: number): T[] {
  return items.slice(page * ZONE_RECORD_PAGE_SIZE, (page + 1) * ZONE_RECORD_PAGE_SIZE);
}

function ZoneListPager({ page, total, onPage }: { page: number; total: number; onPage: (page: number) => void }) {
  if (total <= ZONE_RECORD_PAGE_SIZE) return null;
  const lastPage = Math.max(0, Math.ceil(total / ZONE_RECORD_PAGE_SIZE) - 1);
  const safePage = Math.min(page, lastPage);
  return (
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-2" aria-label="Zone record pages">
      <p className="text-xs font-semibold text-[var(--text-sub)]">
        {safePage * ZONE_RECORD_PAGE_SIZE + 1}–{Math.min((safePage + 1) * ZONE_RECORD_PAGE_SIZE, total)} of {total}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={safePage === 0} onClick={() => onPage(safePage - 1)}>Previous</Button>
        <Button variant="secondary" disabled={safePage >= lastPage} onClick={() => onPage(safePage + 1)}>Next</Button>
      </div>
    </nav>
  );
}

export function InstallHubZonesPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);
  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  const tree = query.data;
  if (!tree) return <ErrorBanner message="Installation not found." />;

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: tree.installation.siteName, href: `/installhub/installations/${installationId}` },
        { label: 'Zones' },
      ]} />
      <PageHeader
        title="Zones & assets"
        subtitle="Organize switchboards, Wattwatcher meters, and site assets by physical area."
        actions={<LinkButton href={`/installhub/installations/${installationId}/zones/new`}><Icon name="plus" size={17} />Add zone</LinkButton>}
      />
      {tree.zones.length === 0 ? (
        <EmptyState title="No zones yet" description="Add the first physical work area." icon="building" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {tree.zones.map((zone) => {
            const boards = tree.electricalAssets.filter((item) => item.zoneId === zone.id);
            const assets = tree.siteAssets.filter((item) => item.zoneId === zone.id);
            const electricalSummary = zoneElectricalSummary(tree, zone.id);
            return (
              <Link key={zone.id} href={`/installhub/installations/${installationId}/zones/${zone.id}`} className="block">
                <Card className="interactive-card h-full">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-extrabold text-[var(--text)]">{zone.zoneName}</p>
                      <p className="mt-1 text-sm leading-6 text-[var(--text-sub)]">{zone.zoneDescription || 'No description'}</p>
                    </div>
                    <Icon name="chevron-right" size={18} className="shrink-0 text-[var(--muted)]" />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3 border-t border-[var(--border)] pt-3 text-xs font-semibold text-[var(--text-sub)]">
                    <span>{boards.length} switchboards</span>
                    <span>{assets.length} site assets</span>
                    <span>{zone.photos.length} photos</span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2" aria-label={`${zone.zoneName} electrical status`}>
                    <span className="rounded-full bg-[var(--green-soft)] px-2.5 py-1 text-xs font-bold text-[var(--green)]">{electricalSummary.metered} Metered</span>
                    <span className="rounded-full bg-[var(--surface2)] px-2.5 py-1 text-xs font-bold text-[var(--text-sub)]">{electricalSummary.unmetered} Unmetered</span>
                    <span className="rounded-full bg-[var(--amber-soft)] px-2.5 py-1 text-xs font-bold text-[var(--text)]">{electricalSummary.tbc} TBC</span>
                    <span className="rounded-full bg-[var(--red-soft)] px-2.5 py-1 text-xs font-bold text-[var(--red)]">{electricalSummary.unresolved} unresolved</span>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function InstallHubZoneFormPage({ mode }: { mode: 'new' | 'edit' }) {
  const { installationId, zoneId } = useParams<{ installationId: string; zoneId?: string }>();
  const query = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const zone = query.data?.zones.find((item) => item.id === zoneId);
  useEffect(() => {
    if (!zone) return;
    setName(zone.zoneName);
    setDescription(zone.zoneDescription);
  }, [zone]);

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  if (mode === 'edit' && !zone) return <ErrorBanner message="Zone not found." />;
  const installation = query.data!.installation;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) {
      toast.error('Zone name is required.');
      return;
    }
    setBusy(true);
    try {
      let nextZoneId = zoneId;
      await writer.mutate((tree) => {
        if (mode === 'new') {
          const created = createZone(installationId, { zoneName: name, zoneDescription: description });
          tree.zones.push(created);
          nextZoneId = created.id;
        } else {
          const target = tree.zones.find((item) => item.id === zoneId);
          if (!target) throw new Error('Zone not found.');
          target.zoneName = name.trim();
          target.zoneDescription = description.trim();
          target.updatedAt = nowIso();
        }
      });
      toast.success(mode === 'new' ? 'Zone created.' : 'Zone saved.');
      router.replace(`/installhub/installations/${installationId}/zones/${nextZoneId}`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: installation.siteName, href: `/installhub/installations/${installationId}` },
        { label: 'Zones', href: `/installhub/installations/${installationId}/zones` },
        { label: mode === 'new' ? 'New' : zone!.zoneName },
      ]} />
      <PageHeader title={mode === 'new' ? 'New zone' : 'Edit zone'} subtitle="A physical area that groups its boards and site assets." />
      <form onSubmit={(event) => void submit(event)}>
        <Card className="max-w-2xl">
          <FieldLabel>Zone name *</FieldLabel>
          <Input required value={name} onChange={(event) => setName(event.target.value)} />
          <FieldLabel>Description</FieldLabel>
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          <div className="mt-6 flex gap-2 border-t border-[var(--border)] pt-5">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save zone'}</Button>
            <Button variant="secondary" onClick={() => router.back()} disabled={busy}>Cancel</Button>
          </div>
        </Card>
      </form>
    </div>
  );
}

export function InstallHubZoneDetailPage() {
  const { installationId, zoneId } = useParams<{ installationId: string; zoneId: string }>();
  const query = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const router = useRouter();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [boardSearch, setBoardSearch] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [boardPage, setBoardPage] = useState(0);
  const [assetPage, setAssetPage] = useState(0);

  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorBanner message={installHubConnectionErrorMessage(query.error)} />;
  const tree = query.data;
  const zone = tree?.zones.find((item) => item.id === zoneId);
  if (!tree || !zone) return <ErrorBanner message="Zone not found." />;
  const readinessIssues = localReadiness(tree).issues;
  const boards = tree.electricalAssets.filter((item) => item.zoneId === zoneId);
  const assets = tree.siteAssets.filter((item) => item.zoneId === zoneId);
  const normalizedBoardSearch = boardSearch.trim().toLocaleLowerCase('en-AU');
  const normalizedAssetSearch = assetSearch.trim().toLocaleLowerCase('en-AU');
  const filteredBoards = [...boards]
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter((board) => !normalizedBoardSearch || `${board.displayCode} ${board.assetName} ${board.assetType}`.toLocaleLowerCase('en-AU').includes(normalizedBoardSearch));
  const filteredAssets = [...assets]
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter((asset) => !normalizedAssetSearch || `${asset.displayCode || ''} ${asset.assetName} ${asset.assetType}`.toLocaleLowerCase('en-AU').includes(normalizedAssetSearch));
  const electricalSummary = zoneElectricalSummary(tree, zoneId);
  const currentZone = zone;

  async function upload(files: File[]) {
    setUploading(true);
    try {
      await writer.mutate(async (next) => {
        const target = next.zones.find((item) => item.id === zoneId);
        if (!target) throw new Error('Zone not found.');
        for (const file of files) {
          const index = target.photos.length;
          const uri = await uploadInstallationPhoto(next, {
            installationId,
            entityType: 'zone',
            entityId: zoneId,
            fieldName: `photos[${index}]`,
          }, file);
          target.photos.push(uri);
        }
        target.updatedAt = nowIso();
      });
      toast.success(files.length === 1 ? 'Zone photo uploaded.' : `${files.length} zone photos uploaded.`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function removePhoto(id: string) {
    const photoIndex = Number(id);
    if (!Number.isInteger(photoIndex)) return;
    try {
      await writer.mutate((next) => {
        const target = next.zones.find((item) => item.id === zoneId);
        if (target) {
          target.photos = target.photos.filter((_, index) => index !== photoIndex);
        }
        if (target) target.updatedAt = nowIso();
      });
      toast.success('Zone photo removed.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  async function remove() {
    if (!confirm(`Delete ${currentZone.zoneName} and all of its boards, assets, and linked forms?`)) return;
    try {
      await writer.mutate((next) => removeZone(next, zoneId));
      toast.success('Zone and linked records deleted.');
      router.replace(`/installhub/installations/${installationId}/zones`);
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    }
  }

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: tree.installation.siteName, href: `/installhub/installations/${installationId}` },
        { label: 'Zones', href: `/installhub/installations/${installationId}/zones` },
        { label: zone.zoneName },
      ]} />
      <PageHeader
        title={zone.zoneName}
        subtitle={zone.zoneDescription || 'No zone description'}
        actions={
          <>
            <LinkButton href={`/installhub/installations/${installationId}/zones/${zoneId}/edit`} variant="secondary">Edit</LinkButton>
            <Button variant="danger" onClick={() => void remove()}>Delete</Button>
          </>
        }
      />
      <Card className="mb-6">
        <DefinitionList items={[
          { label: 'Switchboards', value: boards.length },
          { label: 'Site assets', value: assets.length },
          { label: 'Zone photos', value: zone.photos.length },
          { label: 'Metered assets', value: electricalSummary.metered },
          { label: 'Unmetered assets', value: electricalSummary.unmetered },
          { label: 'Metering TBC', value: electricalSummary.tbc },
          { label: 'Unresolved relationships', value: electricalSummary.unresolved },
        ]} />
      </Card>

      <RecordNavigation
        title="Zone navigation"
        description="Use the physical zone as the field-work hub, then open the exact electrical or site record you observed."
        items={[
          {
            href: `/installhub/installations/${installationId}`,
            icon: 'building',
            label: 'Installation overview',
            description: tree.installation.siteName,
          },
          {
            href: '#zone-switchboards',
            icon: 'zap',
            label: 'Switchboards',
            description: 'Boards and their installed meters',
            meta: boards.length,
          },
          {
            href: '#zone-site-assets',
            icon: 'plug',
            label: 'Site assets',
            description: 'Equipment found in this zone',
            meta: assets.length,
          },
          {
            href: '#zone-evidence',
            icon: 'camera',
            label: 'Zone evidence',
            description: 'Location photos and field evidence',
            meta: zone.photos.length,
          },
        ]}
      />

      <div className="mb-6 grid gap-5 xl:grid-cols-2">
        <Card id="zone-switchboards" tabIndex={-1} className="scroll-mt-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-extrabold text-[var(--text)]">Switchboards</h2>
              <p className="mt-1 text-xs text-[var(--text-sub)]">Electrical boards and installed meters.</p>
            </div>
            <LinkButton href={`/installhub/installations/${installationId}/zones/${zoneId}/boards/new`}><Icon name="plus" size={16} />Add</LinkButton>
          </div>
          {boards.length ? <Input type="search" value={boardSearch} placeholder="Search switchboard name or type" aria-label="Search switchboards in this zone" onChange={(event) => { setBoardSearch(event.target.value); setBoardPage(0); }} /> : null}
          {boards.length === 0 ? <p className="text-sm text-[var(--text-sub)]">No switchboards in this zone.</p> : filteredBoards.length ? (
            <>
            <div className="space-y-2">
              {zonePageItems(filteredBoards, boardPage).map((board) => (
                <Link key={board.id} href={`/installhub/installations/${installationId}/zones/${zoneId}/boards/${board.id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 hover:border-[var(--primary)]">
                  <span>
                    <span className="block text-sm font-bold text-[var(--text)]">{board.assetName}</span>
                    <span className="block text-xs text-[var(--text-sub)]">{board.assetType} · {board.meters.length} meters</span>
                  </span>
                  <Icon name="chevron-right" size={17} className="text-[var(--muted)]" />
                </Link>
              ))}
            </div>
            <ZoneListPager page={boardPage} total={filteredBoards.length} onPage={setBoardPage} />
            </>
          ) : (
            <p className="mt-3 text-sm text-[var(--text-sub)]">No switchboards match this search.</p>
          )}
        </Card>

        <Card id="zone-site-assets" tabIndex={-1} className="scroll-mt-4">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-extrabold text-[var(--text)]">Site assets</h2>
              <p className="mt-1 text-xs text-[var(--text-sub)]">Loads and equipment connected to boards.</p>
            </div>
            <LinkButton href={`/installhub/installations/${installationId}/zones/${zoneId}/assets/new`}><Icon name="plus" size={16} />Add</LinkButton>
          </div>
          {assets.length ? <Input type="search" value={assetSearch} placeholder="Search site-asset name or type" aria-label="Search site assets in this zone" onChange={(event) => { setAssetSearch(event.target.value); setAssetPage(0); }} /> : null}
          {assets.length === 0 ? <p className="text-sm text-[var(--text-sub)]">No site assets in this zone.</p> : filteredAssets.length ? (
            <>
            <div className="space-y-2">
              {zonePageItems(filteredAssets, assetPage).map((asset) => {
                const state = siteAssetMeteringState(asset).kind;
                const coverage = coverageState(tree, asset, readinessIssues);
                const channelCount = asset.meterChannelIds?.length || asset.meterChannels?.length || 0;
                const meteringLabel = coverage === 'INVALID'
                  ? 'Metering mapping issue · blocks completion'
                  : state === 'UNMETERED'
                  ? 'Confirmed unmetered · metering state is non-blocking'
                  : state === 'TBC'
                    ? 'Metering to be confirmed · blocks completion'
                    : `Metered · ${channelCount} channel${channelCount === 1 ? '' : 's'}`;
                return (
                  <Link key={asset.id} href={`/installhub/installations/${installationId}/zones/${zoneId}/assets/${asset.id}`} className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 hover:border-[var(--primary)]">
                    <span>
                      <span className="block text-sm font-bold text-[var(--text)]">{asset.assetName}</span>
                      <span className="block text-xs text-[var(--text-sub)]">{asset.assetType} · {meteringLabel}</span>
                    </span>
                    <Icon name="chevron-right" size={17} className="text-[var(--muted)]" />
                  </Link>
                );
              })}
            </div>
            <ZoneListPager page={assetPage} total={filteredAssets.length} onPage={setAssetPage} />
            </>
          ) : (
            <p className="mt-3 text-sm text-[var(--text-sub)]">No site assets match this search.</p>
          )}
        </Card>
      </div>

      <Card id="zone-evidence" tabIndex={-1} className="scroll-mt-4">
        <h2 className="font-extrabold text-[var(--text)]">Zone evidence</h2>
        <EvidenceField
          label="Zone photos"
          items={zone.photos.map((uri, index) => ({ id: `${index}`, uri }))}
          busy={uploading}
          onFiles={upload}
          onRemove={zone.photos.length ? removePhoto : undefined}
        />
      </Card>
    </div>
  );
}
