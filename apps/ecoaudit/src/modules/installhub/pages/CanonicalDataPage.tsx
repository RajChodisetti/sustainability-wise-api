'use client';

import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Input } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { Breadcrumbs, InlineNotice } from '@/modules/installhub/components/InstallHubUi';
import {
  useInstallationElectricalTree,
  useInstallationMapping,
  useInstallationReadiness,
  useInstallationTree,
} from '@/modules/installhub/hooks/useInstallationTree';
import {
  assetElectricalSource,
  boardElectricalSource,
  coverageState,
  displayCodeValue,
  measurementAssignments,
  meterDeviceName,
  meterDevices,
  siteAssetMeteringState,
  siteAssetTypeLabel,
} from '@/modules/installhub/lib/workflow';
import type { InstallationTree, ReadinessIssue } from '@/modules/installhub/types/domain';

const TABLE_PAGE_SIZE = 50;
const METER_PAGE_SIZE = 20;
const ISSUE_PAGE_SIZE = 50;

function pageItems<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice(page * pageSize, (page + 1) * pageSize);
}

function ResultPager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  if (!total) return <p className="mt-3 text-sm text-[var(--text-sub)]">No matching records.</p>;
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  const safePage = Math.min(page, lastPage);
  return (
    <nav className="mt-3 flex flex-wrap items-center justify-between gap-2" aria-label="Table pages">
      <p className="text-xs font-semibold text-[var(--text-sub)]">
        {safePage * pageSize + 1}–{Math.min((safePage + 1) * pageSize, total)} of {total}
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={safePage === 0} onClick={() => onPage(safePage - 1)}>Previous</Button>
        <Button variant="secondary" disabled={safePage >= lastPage} onClick={() => onPage(safePage + 1)}>Next</Button>
      </div>
    </nav>
  );
}

function entityHref(tree: InstallationTree, issue: ReadinessIssue): string {
  if (issue.entityType === 'board') {
    const board = tree.electricalAssets.find((item) => item.id === issue.entityId);
    if (board) return `/installhub/installations/${tree.installation.id}/zones/${board.zoneId}/boards/${board.id}`;
  }
  if (issue.entityType === 'site_asset') {
    const asset = tree.siteAssets.find((item) => item.id === issue.entityId);
    if (asset) return `/installhub/installations/${tree.installation.id}/zones/${asset.zoneId}/assets/${asset.id}`;
  }
  if (issue.entityType === 'meter' || issue.entityType === 'channel' || issue.entityType === 'measurement_assignment') {
    const assignment = measurementAssignments(tree).find((item) => item.id === issue.entityId);
    const meterId = issue.entityType === 'meter'
      ? issue.entityId
      : issue.entityType === 'channel'
        ? meterDevices(tree).find((meter) => meter.channels.some((channel) => channel.id === issue.entityId))?.id
        : assignment?.meterId;
    const meter = meterDevices(tree).find((item) => item.id === meterId);
    const board = tree.electricalAssets.find((item) => item.id === meter?.installedOnBoardId);
    if (meter && board) return `/installhub/installations/${tree.installation.id}/zones/${board.zoneId}/boards/${board.id}/meters/${meter.id}`;
  }
  if (issue.entityType === 'form') return `/installhub/installations/${tree.installation.id}/forms/${issue.entityId}`;
  return `/installhub/installations/${tree.installation.id}`;
}

function sourceLabel(tree: InstallationTree, source: ReturnType<typeof boardElectricalSource>): string {
  if (source.kind === 'TBC') return 'To be confirmed';
  if (source.kind === 'GRID') return tree.gridSupplies?.find((item) => item.id === source.gridSupplyId)?.name || `Grid ${source.gridSupplyId}`;
  const board = tree.electricalAssets.find((item) => item.id === source.boardId);
  return board ? `${displayCodeValue(board)} — ${board.assetName}` : `Missing board ${source.boardId}`;
}

function downloadJson(filename: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function coverageLabel(state?: string): string {
  if (state === 'VIRTUAL') return 'VIRTUAL — shared, unallocated residual';
  if (state === 'DIRECT') return 'DIRECT — exact assignment';
  if (state === 'UNMETERED') return 'UNMETERED — no residual identified';
  if (state === 'TBC') return 'TBC — unresolved';
  return state || '—';
}

export function InstallHubCanonicalDataPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const treeQuery = useInstallationTree(installationId);
  const [issueSearch, setIssueSearch] = useState('');
  const [issuePage, setIssuePage] = useState(0);
  const deferredIssueSearch = useDeferredValue(issueSearch);
  const readinessQuery = useInstallationReadiness(installationId, {
    offset: issuePage * ISSUE_PAGE_SIZE,
    limit: ISSUE_PAGE_SIZE,
    q: deferredIssueSearch,
  });
  const electricalQuery = useInstallationElectricalTree(installationId);
  const mappingQuery = useInstallationMapping(installationId);
  const [electricalSearch, setElectricalSearch] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [electricalPage, setElectricalPage] = useState(0);
  const [assetPage, setAssetPage] = useState(0);
  const [electricalOpen, setElectricalOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);

  if (treeQuery.isLoading) return <Spinner />;
  if (treeQuery.error || !treeQuery.data) return <ErrorBanner message={installHubConnectionErrorMessage(treeQuery.error || new Error('Installation not found.'))} />;
  const tree = treeQuery.data;
  const readiness = readinessQuery.data;
  const electrical = electricalQuery.data;
  const localAdvisory = readiness?.authority === 'LOCAL_ADVISORY' || mappingQuery.data?.authority === 'LOCAL_ADVISORY';
  const visibleIssues = readiness?.issues || [];
  const issueTotal = readiness?.issuePage?.total ?? visibleIssues.length;
  const normalizedElectricalSearch = electricalSearch.trim().toLowerCase();
  const filteredElectricalNodes = [...(electrical?.nodes || [])]
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter((node) => !normalizedElectricalSearch || `${node.displayCode || ''} ${node.name} ${node.kind} ${node.typeLabel || ''}`.toLowerCase().includes(normalizedElectricalSearch));
  const normalizedAssetSearch = assetSearch.trim().toLowerCase();
  const filteredAssets = [...tree.siteAssets]
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter((asset) => {
      const zoneName = tree.zones.find((zone) => zone.id === asset.zoneId)?.zoneName || '';
      return !normalizedAssetSearch || `${displayCodeValue(asset)} ${asset.assetName} ${siteAssetTypeLabel(asset)} ${zoneName}`.toLowerCase().includes(normalizedAssetSearch);
    });
  const serverCoverageByAsset = new Map(
    (electrical?.nodes || [])
      .filter((node) => node.kind === 'SITE_ASSET')
      .map((node) => [node.id, node.coverageState]),
  );
  const mappingCoverageByAsset = new Map(
    (mappingQuery.data?.assetCoverage || []).map((item) => [item.assetId, item]),
  );

  return (
    <div>
      <Breadcrumbs items={[
        { label: 'Installations', href: '/installhub/installations' },
        { label: tree.installation.siteName, href: `/installhub/installations/${installationId}` },
        { label: 'Data & reconciliation' },
      ]} />
      <PageHeader
        title="Data & reconciliation"
        subtitle="Physical locations, electrical relationships, unresolved items, full asset coverage, and canonical export readiness."
        actions={<LinkButton href={`/installhub/installations/${installationId}/metering`}><Icon name="gauge" size={17} />Metering table</LinkButton>}
      />

      {localAdvisory ? (
        <div className="mb-5"><InlineNotice>This is a local advisory projection. It cannot authorize completion or canonical export; reconnect to load server-authoritative readiness and pinned output.</InlineNotice></div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Physical zones', tree.zones.length],
          ['Electrical nodes', electrical?.nodes.length || 0],
          ['Unresolved', issueTotal],
          ['All site assets', tree.siteAssets.length],
        ].map(([label, value]) => <Card key={label}><p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">{label}</p><p className="mt-2 text-3xl font-extrabold text-[var(--text)]">{value}</p></Card>)}
      </div>

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-extrabold text-[var(--text)]">Reconciliation queue</h2>
            <p className="mt-1 text-xs text-[var(--text-sub)]">Server issue codes link back to the record that needs attention. Search and paging run across the full reconciliation queue.</p>
          </div>
          <Button
            disabled={!readiness?.eligibility.mappingExport || !mappingQuery.data || localAdvisory}
            onClick={() => mappingQuery.data && downloadJson(`${tree.installation.siteCode || 'installation'}-mapping-v${tree.recordVersionNumber || 0}.json`, mappingQuery.data)}
          >
            <Icon name="download" size={16} />Download pinned mapping
          </Button>
        </div>
        <Input className="mt-4" type="search" value={issueSearch} placeholder="Search code, message, entity, or field" aria-label="Search reconciliation issues" onChange={(event) => { setIssueSearch(event.target.value); setIssuePage(0); }} />
        {readinessQuery.isLoading ? <div className="mt-4"><Spinner /></div> : readinessQuery.error ? (
          <div className="mt-4"><ErrorBanner message={installHubConnectionErrorMessage(readinessQuery.error)} /></div>
        ) : visibleIssues.length ? (
          <div className="mt-4 space-y-2">
            {visibleIssues.map((issue) => (
              <Link key={`${issue.code}-${issue.entityType}-${issue.entityId}-${issue.field || ''}`} href={entityHref(tree, issue)} className="flex min-h-14 items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3 hover:border-[var(--primary)]">
                <span>
                  <span className="block text-sm font-bold text-[var(--text)]">{issue.message}</span>
                  <span className="mt-1 block text-xs text-[var(--text-sub)]">{issue.severity} · {issue.code} · {issue.entityType.replaceAll('_', ' ')}</span>
                </span>
                <Icon name="chevron-right" size={17} className="shrink-0 text-[var(--muted)]" />
              </Link>
            ))}
            <ResultPager page={issuePage} pageSize={ISSUE_PAGE_SIZE} total={issueTotal} onPage={setIssuePage} />
          </div>
        ) : <p className="mt-4 text-sm text-[var(--text-sub)]">No matching reconciliation issues.</p>}
      </Card>

      <Card className="mb-6">
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
          aria-expanded={electricalOpen}
          aria-controls="canonical-electrical-map"
          onClick={() => setElectricalOpen((open) => !open)}
        >
          <span><span className="block font-extrabold text-[var(--text)]">Electrical map</span><span className="mt-1 block text-xs text-[var(--text-sub)]">Distinct from physical placement · {electrical?.nodes.length || 0} nodes · {electrical?.unresolved.length || 0} unresolved</span></span>
          <Icon name="chevron-down" size={18} className={electricalOpen ? 'rotate-180' : ''} />
        </button>
        {electricalOpen ? <div id="canonical-electrical-map">
          <Input className="mt-4" type="search" value={electricalSearch} placeholder="Search code, node, kind, or type" aria-label="Search electrical nodes" onChange={(event) => { setElectricalSearch(event.target.value); setElectricalPage(0); }} />
          <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead><tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]"><th className="px-3 py-3">Node</th><th className="px-3 py-3">Kind</th><th className="px-3 py-3">Physical zone</th><th className="px-3 py-3">Coverage</th></tr></thead>
            <tbody>{pageItems(filteredElectricalNodes, electricalPage, TABLE_PAGE_SIZE).map((node) => <tr key={node.id} className="border-b border-[var(--border)]"><td className="px-3 py-3 font-bold text-[var(--text)]">{node.displayCode ? `${node.displayCode} — ` : ''}{node.name}</td><td className="px-3 py-3">{node.kind}</td><td className="px-3 py-3">{tree.zones.find((zone) => zone.id === node.physicalLocationId)?.zoneName || '—'}</td><td className="px-3 py-3">{coverageLabel(node.coverageState)}</td></tr>)}</tbody>
          </table>
        </div>
          <ResultPager page={electricalPage} pageSize={TABLE_PAGE_SIZE} total={filteredElectricalNodes.length} onPage={setElectricalPage} />
        </div> : null}
      </Card>

      <Card>
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
          aria-expanded={assetsOpen}
          aria-controls="canonical-all-assets"
          onClick={() => setAssetsOpen((open) => !open)}
        >
          <span><span className="block font-extrabold text-[var(--text)]">All site assets</span><span className="mt-1 block text-xs text-[var(--text-sub)]">Direct, virtual/residual, confirmed unmetered, and TBC · {tree.siteAssets.length} total</span></span>
          <Icon name="chevron-down" size={18} className={assetsOpen ? 'rotate-180' : ''} />
        </button>
        {assetsOpen ? <div id="canonical-all-assets">
          <Input className="mt-4" type="search" value={assetSearch} placeholder="Search asset, code, type, or zone" aria-label="Search all site assets" onChange={(event) => { setAssetSearch(event.target.value); setAssetPage(0); }} />
          <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-sm">
            <thead><tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]"><th className="px-3 py-3">Asset</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Physical zone</th><th className="px-3 py-3">Electrical source</th><th className="px-3 py-3">Metering</th></tr></thead>
            <tbody>{pageItems(filteredAssets, assetPage, TABLE_PAGE_SIZE).map((asset) => {
              const mappedCoverage = mappingCoverageByAsset.get(asset.id);
              const coverage = mappedCoverage?.state || serverCoverageByAsset.get(asset.id) || coverageState(tree, asset);
              const sourceId = mappedCoverage && 'source' in mappedCoverage && mappedCoverage.source && typeof mappedCoverage.source === 'object' && 'id' in mappedCoverage.source
                ? String(mappedCoverage.source.id)
                : '';
              return <tr key={asset.id} className="border-b border-[var(--border)]"><td className="px-3 py-3"><Link className="font-bold text-[var(--primary)] hover:underline" href={`/installhub/installations/${installationId}/zones/${asset.zoneId}/assets/${asset.id}`}>{displayCodeValue(asset)} — {asset.assetName}</Link></td><td className="px-3 py-3">{siteAssetTypeLabel(asset)}</td><td className="px-3 py-3">{tree.zones.find((zone) => zone.id === asset.zoneId)?.zoneName || 'Unknown'}</td><td className="px-3 py-3">{sourceLabel(tree, assetElectricalSource(asset))}</td><td className="px-3 py-3 font-semibold">{coverageLabel(coverage)} · {siteAssetMeteringState(asset).kind}{sourceId ? <span className="block font-mono text-xs font-normal text-[var(--muted)]">Shared source {sourceId}</span> : null}</td></tr>;
            })}</tbody>
          </table>
        </div>
          <ResultPager page={assetPage} pageSize={TABLE_PAGE_SIZE} total={filteredAssets.length} onPage={setAssetPage} />
        </div> : null}
      </Card>
    </div>
  );
}

export function InstallHubCanonicalMeteringPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const query = useInstallationTree(installationId);
  const electricalQuery = useInstallationElectricalTree(installationId);
  const mappingQuery = useInstallationMapping(installationId);
  const [search, setSearch] = useState('');
  const [coverageSearch, setCoverageSearch] = useState('');
  const [meterPage, setMeterPage] = useState(0);
  const [coveragePage, setCoveragePage] = useState(0);
  const [metersOpen, setMetersOpen] = useState(true);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const filtered = useMemo(() => {
    if (!query.data) return [];
    const normalized = search.trim().toLowerCase();
    return meterDevices(query.data).filter((meter) => !normalized || `${meterDeviceName(meter)} ${meter.serialNumber} ${meter.deviceModel}`.toLowerCase().includes(normalized));
  }, [query.data, search]);
  if (query.isLoading) return <Spinner />;
  if (query.error || !query.data) return <ErrorBanner message={installHubConnectionErrorMessage(query.error || new Error('Installation not found.'))} />;
  const tree = query.data;
  const assignments = measurementAssignments(tree);
  const visibleMeters = pageItems(filtered, meterPage, METER_PAGE_SIZE);
  const normalizedCoverageSearch = coverageSearch.trim().toLowerCase();
  const coverageAssets = [...tree.siteAssets]
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter((asset) => !normalizedCoverageSearch || `${displayCodeValue(asset)} ${asset.assetName} ${siteAssetTypeLabel(asset)}`.toLowerCase().includes(normalizedCoverageSearch));
  const serverCoverageByAsset = new Map(
    (electricalQuery.data?.nodes || []).filter((node) => node.kind === 'SITE_ASSET').map((node) => [node.id, node.coverageState]),
  );
  const mappingCoverageByAsset = new Map((mappingQuery.data?.assetCoverage || []).map((item) => [item.assetId, item]));
  return (
    <div>
      <Breadcrumbs items={[{ label: 'Installations', href: '/installhub/installations' }, { label: tree.installation.siteName, href: `/installhub/installations/${installationId}` }, { label: 'Metering table' }]} />
      <PageHeader title="Metering table" subtitle="Exact devices, stable channel IDs, grouped measurement targets, and complete asset coverage." actions={<LinkButton href={`/installhub/installations/${installationId}/data`} variant="secondary">Data & reconciliation</LinkButton>} />
      <Card className="mb-6">
        <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left" aria-expanded={metersOpen} aria-controls="canonical-meter-devices" onClick={() => setMetersOpen((open) => !open)}>
          <span><span className="block font-extrabold text-[var(--text)]">Meter devices and channels</span><span className="mt-1 block text-xs text-[var(--text-sub)]">{filtered.length} matching devices · {meterDevices(tree).length} total</span></span>
          <Icon name="chevron-down" size={18} className={metersOpen ? 'rotate-180' : ''} />
        </button>
        {metersOpen ? <div id="canonical-meter-devices">
          <Input className="mt-4" type="search" value={search} placeholder="Search device, serial, or model" aria-label="Search metering devices" onChange={(event) => { setSearch(event.target.value); setMeterPage(0); }} />
          <div className="mt-4 space-y-4">
          {visibleMeters.map((meter) => {
            const board = tree.electricalAssets.find((item) => item.id === meter.installedOnBoardId);
            const meterAssignments = assignments.filter((item) => item.meterId === meter.id);
            return <div key={meter.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-extrabold text-[var(--text)]">{meterDeviceName(meter)}</h2><p className="mt-1 text-xs text-[var(--text-sub)]">{meter.deviceModel} · {meter.serialNumber} · {board ? `${displayCodeValue(board)} — ${board.assetName}` : 'Missing board'}</p></div>{board ? <LinkButton href={`/installhub/installations/${installationId}/zones/${board.zoneId}/boards/${board.id}/meters/${meter.id}`} variant="secondary">Open device</LinkButton> : null}</div><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]"><th className="px-2 py-2">Channel</th><th className="px-2 py-2">Purpose</th><th className="px-2 py-2">Load / sensor</th><th className="px-2 py-2">Assignment</th></tr></thead><tbody>{meter.channels.map((channel) => { const assignment = meterAssignments.find((item) => item.channelIds.includes(channel.id)); return <tr key={channel.id} className="border-b border-[var(--border)]"><td className="px-2 py-2 font-bold">{channel.ordinal} <span className="font-normal text-[var(--muted)]">{channel.phaseLabel || ''}</span></td><td className="px-2 py-2">{channel.purpose.replaceAll('_', ' ').toLowerCase()}</td><td className="px-2 py-2">{channel.customLoadTypeName || channel.loadTypeCode || '—'} · {channel.sensorRating || '—'}</td><td className="px-2 py-2">{assignment ? `${assignment.phaseMode.replaceAll('_', ' ')} · ${assignment.target.kind} · ${assignment.direction}` : channel.purpose === 'SPARE' ? 'Not applicable' : 'Unassigned'}</td></tr>; })}</tbody></table></div></div>;
          })}
        </div>
          <ResultPager page={meterPage} pageSize={METER_PAGE_SIZE} total={filtered.length} onPage={setMeterPage} />
        </div> : null}
      </Card>
      <Card>
        <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 text-left" aria-expanded={coverageOpen} aria-controls="canonical-meter-coverage" onClick={() => setCoverageOpen((open) => !open)}>
          <span><span className="block font-extrabold text-[var(--text)]">Asset coverage</span><span className="mt-1 block text-xs text-[var(--text-sub)]">Every site asset, including virtual/residual and unmetered · {tree.siteAssets.length} total</span></span>
          <Icon name="chevron-down" size={18} className={coverageOpen ? 'rotate-180' : ''} />
        </button>
        {coverageOpen ? <div id="canonical-meter-coverage">
          <Input className="mt-4" type="search" value={coverageSearch} placeholder="Search asset, code, or type" aria-label="Search asset coverage" onChange={(event) => { setCoverageSearch(event.target.value); setCoveragePage(0); }} />
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{pageItems(coverageAssets, coveragePage, TABLE_PAGE_SIZE).map((asset) => {
            const mappedCoverage = mappingCoverageByAsset.get(asset.id);
            const coverage = mappedCoverage?.state || serverCoverageByAsset.get(asset.id) || coverageState(tree, asset);
            const sourceId = mappedCoverage && 'source' in mappedCoverage && mappedCoverage.source && typeof mappedCoverage.source === 'object' && 'id' in mappedCoverage.source ? String(mappedCoverage.source.id) : '';
            return <Link key={asset.id} href={`/installhub/installations/${installationId}/zones/${asset.zoneId}/assets/${asset.id}`} className="min-h-14 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3 hover:border-[var(--primary)]"><span className="block text-sm font-bold text-[var(--text)]">{displayCodeValue(asset)} — {asset.assetName}</span><span className="mt-1 block text-xs text-[var(--text-sub)]">{coverageLabel(coverage)} · {sourceLabel(tree, assetElectricalSource(asset))}</span>{sourceId ? <span className="mt-1 block font-mono text-xs text-[var(--muted)]">Shared source {sourceId}</span> : null}</Link>;
          })}</div>
          <ResultPager page={coveragePage} pageSize={TABLE_PAGE_SIZE} total={coverageAssets.length} onPage={setCoveragePage} />
        </div> : null}
      </Card>
    </div>
  );
}
