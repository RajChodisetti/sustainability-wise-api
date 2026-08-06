'use client';
/* eslint-disable react-hooks/set-state-in-effect -- restores the operator's reconciliation workspace after hydration */

import Link from 'next/link';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button, LinkButton } from '@/components/ui/Button';
import { Card, ErrorBanner, PageHeader, Spinner } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/FormFields';
import { Icon } from '@/components/ui/Icon';
import { installHubConnectionErrorMessage } from '@/modules/installhub/api/client';
import { Breadcrumbs, InlineNotice } from '@/modules/installhub/components/InstallHubUi';
import {
  useInstallationElectricalTree,
  useInstallationMapping,
  useInstallationReadiness,
  useInstallationTree,
  useTreeWriter,
} from '@/modules/installhub/hooks/useInstallationTree';
import {
  assetElectricalSource,
  boardElectricalSource,
  coverageState,
  displayCodeValue,
  localReadiness,
  measurementAssignments,
  meterDeviceName,
  meterDevices,
  siteAssetMeteringState,
  siteAssetTypeLabel,
} from '@/modules/installhub/lib/workflow';
import {
  electricalHierarchyRows,
  filterReadinessResolutionCandidates,
  filterElectricalHierarchyRows,
  measurementTargetDetails,
  meteringInventorySummary,
  readinessCandidateDetails,
  readinessCorrectionAction,
  readinessEntityDetails,
  readinessIssueKey,
  readinessResolutionCandidates,
  applyReadinessCandidateResolution,
} from '@/modules/installhub/lib/electricalPresentation';
import type { InstallationTree, ReadinessIssue } from '@/modules/installhub/types/domain';
import type { ElectricalTreeReadModel } from '@/modules/installhub/types/domain';
import { useToast } from '@/contexts/ToastContext';

const TABLE_PAGE_SIZE = 50;
const METER_PAGE_SIZE = 20;
const ISSUE_PAGE_SIZE = 50;
const HIERARCHY_PAGE_SIZE = 100;
const UNRESOLVED_PAGE_SIZE = 50;
const READINESS_ENTITY_TYPES = [
  'installation',
  'grid_supply',
  'zone',
  'board',
  'site_asset',
  'meter',
  'channel',
  'measurement_assignment',
  'virtual_meter',
  'form',
] as const;

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
  if (state === 'INVALID') return 'MAPPING ISSUE — declared state and assignments disagree';
  return state || '—';
}

function electricalNodeHref(
  tree: InstallationTree,
  node: ElectricalTreeReadModel['nodes'][number],
): string {
  const base = `/installhub/installations/${encodeURIComponent(tree.installation.id)}`;
  if (node.kind === 'BOARD') {
    const board = tree.electricalAssets.find((item) => item.id === node.id);
    if (board) return `${base}/zones/${encodeURIComponent(board.zoneId)}/boards/${encodeURIComponent(board.id)}`;
  }
  if (node.kind === 'SITE_ASSET') {
    const asset = tree.siteAssets.find((item) => item.id === node.id);
    if (asset) return `${base}/zones/${encodeURIComponent(asset.zoneId)}/assets/${encodeURIComponent(asset.id)}`;
  }
  return node.kind === 'VIRTUAL_RESIDUAL' ? `${base}/data` : base;
}

function unresolvedRelationshipHref(
  tree: InstallationTree,
  item: ElectricalTreeReadModel['unresolved'][number],
): string {
  const entityType = item.subjectType === 'BOARD'
    ? 'board'
    : item.subjectType === 'SITE_ASSET'
      ? 'site_asset'
      : 'measurement_assignment';
  return readinessEntityDetails(tree, {
    code: `UNRESOLVED_${item.relation}`,
    severity: 'ERROR',
    entityType,
    entityId: item.subjectId,
    message: 'Unresolved electrical relationship.',
  }).href;
}

export function InstallHubCanonicalDataPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const treeQuery = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const toast = useToast();
  const [issueSearch, setIssueSearch] = useState('');
  const [issuePage, setIssuePage] = useState(0);
  const [issueCategory, setIssueCategory] = useState<'RECONCILIATION' | 'COMPLETION'>('RECONCILIATION');
  const [issueSeverity, setIssueSeverity] = useState<'ALL' | 'ERROR' | 'WARNING'>('ALL');
  const [issueEntityType, setIssueEntityType] = useState('ALL');
  const [issueZoneId, setIssueZoneId] = useState('ALL');
  const [reviewedIssueKeys, setReviewedIssueKeys] = useState<Set<string>>(new Set());
  const [resolutionSelections, setResolutionSelections] = useState<Record<string, string>>({});
  const [resolutionSearches, setResolutionSearches] = useState<Record<string, string>>({});
  const [resolvingIssueKey, setResolvingIssueKey] = useState<string | null>(null);
  const [reconciliationResumedFor, setReconciliationResumedFor] = useState('');
  const [reviewedTreeRevision, setReviewedTreeRevision] = useState<number | null>(null);
  const deferredIssueSearch = useDeferredValue(issueSearch);
  const readinessQuery = useInstallationReadiness(installationId, {
    offset: issuePage * ISSUE_PAGE_SIZE,
    limit: ISSUE_PAGE_SIZE,
    q: deferredIssueSearch,
    ...(issueSeverity === 'ALL' ? {} : { severity: issueSeverity }),
    ...(issueEntityType === 'ALL' ? {} : { entityType: issueEntityType }),
    category: issueCategory,
    ...(issueZoneId === 'ALL' ? {} : { zoneId: issueZoneId }),
  });
  const readinessSummaryQuery = useInstallationReadiness(installationId, { offset: 0, limit: 1 });
  const reconciliationSummaryQuery = useInstallationReadiness(installationId, {
    offset: 0,
    limit: 1,
    category: 'RECONCILIATION',
  });
  const completionSummaryQuery = useInstallationReadiness(installationId, {
    offset: 0,
    limit: 1,
    category: 'COMPLETION',
  });
  const electricalQuery = useInstallationElectricalTree(installationId);
  const mappingQuery = useInstallationMapping(installationId);
  const [electricalSearch, setElectricalSearch] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [electricalPage, setElectricalPage] = useState(0);
  const [assetPage, setAssetPage] = useState(0);
  const [electricalOpen, setElectricalOpen] = useState(false);
  const [electricalView, setElectricalView] = useState<'HIERARCHY' | 'TABLE'>('HIERARCHY');
  const [collapsedElectricalNodeIds, setCollapsedElectricalNodeIds] = useState<Set<string>>(new Set());
  const [electricalAnnouncement, setElectricalAnnouncement] = useState('');
  const [hierarchyPage, setHierarchyPage] = useState(0);
  const [unresolvedSearch, setUnresolvedSearch] = useState('');
  const [unresolvedPage, setUnresolvedPage] = useState(0);
  const hierarchyInitializedRef = useRef('');
  const [assetsOpen, setAssetsOpen] = useState(false);
  const currentTreeRevision = treeQuery.data?.treeRevision ?? treeQuery.data?.baseTreeRevision ?? 0;

  useEffect(() => {
    if (!treeQuery.data) return;
    try {
      const raw = window.sessionStorage.getItem(`installhub:reconciliation:${installationId}`);
      if (raw) {
        const saved = JSON.parse(raw) as {
          treeRevision?: number;
          search?: string;
          page?: number;
          severity?: 'ALL' | 'ERROR' | 'WARNING';
          entityType?: string;
          zoneId?: string;
          reviewed?: string[];
        };
        if (reconciliationResumedFor !== installationId) {
          setIssueSearch(saved.search || '');
          setIssuePage(Number.isInteger(saved.page) && (saved.page || 0) >= 0 ? saved.page || 0 : 0);
          setIssueSeverity(saved.severity === 'ERROR' || saved.severity === 'WARNING' ? saved.severity : 'ALL');
          setIssueEntityType(saved.entityType || 'ALL');
          setIssueZoneId(saved.zoneId || 'ALL');
        }
        setReviewedIssueKeys(new Set(saved.treeRevision === currentTreeRevision && Array.isArray(saved.reviewed)
          ? saved.reviewed.filter((item): item is string => typeof item === 'string')
          : []));
      } else {
        setReviewedIssueKeys(new Set());
      }
    } catch {
      // Corrupt browser-only resume state must never block canonical data.
      setReviewedIssueKeys(new Set());
    }
    setReviewedTreeRevision(currentTreeRevision);
    setReconciliationResumedFor(installationId);
  }, [currentTreeRevision, installationId, reconciliationResumedFor, treeQuery.data]);

  useEffect(() => {
    if (reconciliationResumedFor !== installationId || reviewedTreeRevision !== currentTreeRevision) return;
    window.sessionStorage.setItem(`installhub:reconciliation:${installationId}`, JSON.stringify({
      treeRevision: currentTreeRevision,
      search: issueSearch,
      page: issuePage,
      severity: issueSeverity,
      entityType: issueEntityType,
      zoneId: issueZoneId,
      reviewed: [...reviewedIssueKeys],
    }));
  }, [currentTreeRevision, installationId, issueEntityType, issuePage, issueSearch, issueSeverity, issueZoneId, reconciliationResumedFor, reviewedIssueKeys, reviewedTreeRevision]);

  useEffect(() => {
    const model = electricalQuery.data;
    if (!model) return;
    const signature = `${model.treeRevision}:${model.nodes.length}:${model.edges.length}`;
    if (hierarchyInitializedRef.current === signature) return;
    hierarchyInitializedRef.current = signature;
    const parentIds = new Set(model.edges.filter((edge) => edge.relationship === 'FED_FROM').map((edge) => edge.sourceNodeId));
    model.nodes.forEach((node) => {
      if (node.kind === 'VIRTUAL_RESIDUAL' && node.parentNodeId) parentIds.add(node.parentNodeId);
    });
    setCollapsedElectricalNodeIds(parentIds);
    setHierarchyPage(0);
    setElectricalAnnouncement(`Electrical hierarchy loaded with ${parentIds.size} branch${parentIds.size === 1 ? '' : 'es'} collapsed.`);
  }, [electricalQuery.data]);

  if (treeQuery.isLoading) return <Spinner />;
  if (treeQuery.error || !treeQuery.data) return <ErrorBanner message={installHubConnectionErrorMessage(treeQuery.error || new Error('Installation not found.'))} />;
  const tree = treeQuery.data;
  const meteringInventory = meteringInventorySummary(tree);
  const readiness = readinessQuery.data;
  const electrical = electricalQuery.data;
  const localAdvisory = readiness?.authority === 'LOCAL_ADVISORY' || mappingQuery.data?.authority === 'LOCAL_ADVISORY';
  const visibleIssues = readiness?.issues || [];
  const issueTotal = readiness?.issuePage?.total ?? visibleIssues.length;
  const fullIssueTotal = readinessSummaryQuery.data?.issuePage?.total ?? issueTotal;
  const reconciliationTotal = reconciliationSummaryQuery.data?.issuePage?.total ?? 0;
  const completionTotal = completionSummaryQuery.data?.issuePage?.total ?? 0;
  const issueRows = visibleIssues.map((issue) => ({
    issue,
    key: readinessIssueKey(issue),
    entity: readinessEntityDetails(tree, issue),
    candidates: readinessCandidateDetails(tree, issue),
    resolutions: readinessResolutionCandidates(tree, issue),
    correction: readinessCorrectionAction(tree, issue),
  }));
  const visibleIssueRows = issueRows;
  const reviewedPrefix = `${issueCategory}:`;
  const reviewTotal = issueCategory === 'RECONCILIATION'
    ? reconciliationTotal
    : completionTotal;
  const reviewedCount = Math.min(
    [...reviewedIssueKeys].filter((key) => key.startsWith(reviewedPrefix)).length,
    reviewTotal,
  );
  const allElectricalRows = electricalHierarchyRows(electrical);
  const filteredElectricalRows = filterElectricalHierarchyRows(allElectricalRows, electricalSearch);
  const electricalParentIds = new Set(allElectricalRows.flatMap((row) => row.parent ? [row.parent.id] : []));
  const visibleHierarchyRows = electricalSearch.trim()
    ? filteredElectricalRows
    : filteredElectricalRows.filter((row) => !row.ancestorIds.some((id) => collapsedElectricalNodeIds.has(id)));
  const pagedHierarchyRows = pageItems(visibleHierarchyRows, hierarchyPage, HIERARCHY_PAGE_SIZE);
  const normalizedUnresolvedSearch = unresolvedSearch.trim().toLocaleLowerCase('en-AU');
  const filteredUnresolved = (electrical?.unresolved || []).filter((item) => (
    !normalizedUnresolvedSearch
    || `${item.id} ${item.subjectType} ${item.subjectId} ${item.relation} ${item.missingEnd} ${item.reason}`
      .toLocaleLowerCase('en-AU')
      .includes(normalizedUnresolvedSearch)
  ));
  const normalizedAssetSearch = assetSearch.trim().toLowerCase();
  const filteredAssets = [...tree.siteAssets]
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter((asset) => {
      const zoneName = tree.zones.find((zone) => zone.id === asset.zoneId)?.zoneName || '';
      return !normalizedAssetSearch || `${displayCodeValue(asset)} ${asset.assetName} ${siteAssetTypeLabel(asset)} ${zoneName}`.toLowerCase().includes(normalizedAssetSearch);
    });
  const currentElectrical = electrical?.treeRevision === tree.treeRevision ? electrical : undefined;
  const serverCoverageByAsset = new Map(
    (currentElectrical?.nodes || [])
      .filter((node) => node.kind === 'SITE_ASSET')
      .map((node) => [node.id, node.coverageState]),
  );
  const mappingCoverageByAsset = new Map(
    (mappingQuery.data
      && tree.installation.status === 'Completed'
      && mappingQuery.data?.installation.recordVersionNumber === tree.recordVersionNumber
      ? mappingQuery.data.assetCoverage
      : []).map((item) => [item.assetId, item]),
  );

  async function saveIssueResolution(issue: ReadinessIssue, key: string) {
    const candidateId = resolutionSelections[key];
    if (!candidateId) {
      toast.error('Choose a valid resolution candidate first.');
      return;
    }
    setResolvingIssueKey(key);
    try {
      await writer.mutate((next) => {
        if (!applyReadinessCandidateResolution(next, issue, candidateId)) {
          throw new Error('This candidate is no longer valid. Recheck the reconciliation queue.');
        }
      });
      setReviewedIssueKeys((current) => new Set(current).add(`${issueCategory}:${key}`));
      setResolutionSelections((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setResolutionSearches((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setIssuePage(0);
      toast.success('Reconciliation resolution saved and readiness is being rechecked.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setResolvingIssueKey(null);
    }
  }

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
          ['Readiness issues', fullIssueTotal],
          ['All site assets', tree.siteAssets.length],
          ['Confirmed unmetered', meteringInventory.assets.confirmedUnmetered],
          ['Metering TBC', meteringInventory.assets.toBeConfirmed],
          ['Broken mappings', meteringInventory.assets.brokenMappings],
          ['Unassigned active channels', meteringInventory.channels.unassignedActive],
        ].map(([label, value]) => <Card key={label}><p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">{label}</p><p className="mt-2 text-3xl font-extrabold text-[var(--text)]">{value}</p></Card>)}
      </div>

      {meteringInventory.assets.confirmedUnmetered ? (
        <div className="mb-6">
          <InlineNotice tone="success">
            Confirmed unmetered assets are accepted inventory records. They stay visible here, and that metering state alone does not block installation completion; TBC, broken mappings, or other readiness errors still require reconciliation.
          </InlineNotice>
        </div>
      ) : null}

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-extrabold text-[var(--text)]">
              {issueCategory === 'RECONCILIATION' ? 'Reconciliation queue' : 'Completion issues'}
            </h2>
            <p className="mt-1 text-xs text-[var(--text-sub)]">
              {issueCategory === 'RECONCILIATION'
                ? 'Only relationships deliberately left To be confirmed appear here.'
                : 'Validation, forms, evidence, naming, and mapping defects appear here without being labelled as reconciliation.'}
            </p>
          </div>
          <Button
            disabled={!readiness?.eligibility.mappingExport || !mappingQuery.data || localAdvisory}
            onClick={() => mappingQuery.data && downloadJson(`${tree.installation.siteCode || 'installation'}-mapping-v${tree.recordVersionNumber || 0}.json`, mappingQuery.data)}
          >
            <Icon name="download" size={16} />Download pinned mapping
          </Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Readiness issue category">
          <Button
            variant={issueCategory === 'RECONCILIATION' ? 'primary' : 'secondary'}
            aria-pressed={issueCategory === 'RECONCILIATION'}
            onClick={() => {
              setIssueCategory('RECONCILIATION');
              setIssuePage(0);
            }}
          >
            To be confirmed ({reconciliationTotal})
          </Button>
          <Button
            variant={issueCategory === 'COMPLETION' ? 'primary' : 'secondary'}
            aria-pressed={issueCategory === 'COMPLETION'}
            onClick={() => {
              setIssueCategory('COMPLETION');
              setIssuePage(0);
            }}
          >
            Other completion issues ({completionTotal})
          </Button>
        </div>
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold text-[var(--text)]">Review progress</p>
              <p className="mt-1 text-xs text-[var(--text-sub)]">{reviewedCount} of {reviewTotal} {issueCategory === 'RECONCILIATION' ? 'reconciliation' : 'completion'} items reviewed in this browser. Your search, page, filters, and reviewed markers resume automatically.</p>
            </div>
            {reviewedCount ? <Button variant="ghost" onClick={() => setReviewedIssueKeys(new Set())}>Reset reviewed</Button> : null}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface)]" role="progressbar" aria-label={`${issueCategory === 'RECONCILIATION' ? 'Reconciliation' : 'Completion issue'} review progress`} aria-valuemin={0} aria-valuemax={reviewTotal} aria-valuenow={reviewedCount}>
            <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${reviewTotal ? (reviewedCount / reviewTotal) * 100 : 0}%` }} />
          </div>
        </div>
        <Input className="mt-4" type="search" value={issueSearch} placeholder="Search by code, message, record, ID, or field" aria-label={`Search ${issueCategory === 'RECONCILIATION' ? 'reconciliation' : 'completion'} issues`} onChange={(event) => { setIssueSearch(event.target.value); setIssuePage(0); }} />
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-[var(--text-sub)]" htmlFor="reconciliation-severity">Severity</label>
            <Select id="reconciliation-severity" value={issueSeverity} onChange={(event) => { setIssueSeverity(event.target.value as typeof issueSeverity); setIssuePage(0); }}>
              <option value="ALL">All severities</option>
              <option value="ERROR">Errors</option>
              <option value="WARNING">Warnings</option>
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold text-[var(--text-sub)]" htmlFor="reconciliation-entity">Record type</label>
            <Select id="reconciliation-entity" value={issueEntityType} onChange={(event) => { setIssueEntityType(event.target.value); setIssuePage(0); }}>
              <option value="ALL">All record types</option>
              {READINESS_ENTITY_TYPES.map((entityType) => <option key={entityType} value={entityType}>{entityType.replaceAll('_', ' ')}</option>)}
            </Select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold text-[var(--text-sub)]" htmlFor="reconciliation-zone">Physical zone</label>
            <Select id="reconciliation-zone" value={issueZoneId} onChange={(event) => { setIssueZoneId(event.target.value); setIssuePage(0); }}>
              <option value="ALL">All zones</option>
              {tree.zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.zoneName}</option>)}
            </Select>
          </div>
        </div>
        <p className="mt-2 text-xs text-[var(--text-sub)]">
          Search, category, and every filter are applied by the server before paging. {issueTotal} item{issueTotal === 1 ? '' : 's'} match this category.
        </p>
        {readinessQuery.isLoading ? <div className="mt-4"><Spinner /></div> : readinessQuery.error ? (
          <div className="mt-4"><ErrorBanner message={installHubConnectionErrorMessage(readinessQuery.error)} /></div>
        ) : visibleIssueRows.length ? (
          <div className="mt-4 space-y-3">
            {visibleIssueRows.map(({ issue, key, entity, candidates, resolutions, correction }) => {
              const reviewedKey = `${issueCategory}:${key}`;
              const reviewed = reviewedIssueKeys.has(reviewedKey);
              const resolutionSearch = resolutionSearches[key] || '';
              const visibleResolutions = filterReadinessResolutionCandidates(
                resolutions,
                resolutionSearch,
                resolutionSelections[key],
              );
              const resolutionKind = issue.code === 'MEASUREMENT_TARGET_TBC'
                ? 'measurement target'
                : issue.code === 'METERING_STATE_INVALID'
                  ? 'metering state'
                  : issue.code === 'GRID_SUPPLY_INVALID' && issue.entityType === 'installation'
                    ? 'default Grid supply'
                    : 'electrical supply';
              return (
                <article key={key} className={`rounded-xl border p-4 ${reviewed ? 'border-[var(--green)]/30 bg-[var(--green-soft)]' : 'border-[var(--border)] bg-[var(--surface2)]'}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${issue.severity === 'ERROR' ? 'bg-[var(--red-soft)] text-[var(--red)]' : 'bg-[var(--amber-soft)] text-[var(--text)]'}`}>{issue.severity}</span>
                        <span className="font-mono text-xs font-bold text-[var(--text-sub)]">{issue.code}</span>
                        {reviewed ? <span className="rounded-full bg-[var(--green)] px-2.5 py-1 text-xs font-extrabold text-white">Reviewed</span> : null}
                      </div>
                      <h3 className="mt-2 text-sm font-extrabold text-[var(--text)]">{issue.message}</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => setReviewedIssueKeys((current) => {
                        const next = new Set(current);
                        if (next.has(reviewedKey)) next.delete(reviewedKey);
                        else next.add(reviewedKey);
                        return next;
                      })}>{reviewed ? 'Mark unreviewed' : 'Mark reviewed'}</Button>
                      <LinkButton href={entity.href}>Open record <Icon name="chevron-right" size={16} /></LinkButton>
                    </div>
                  </div>
                  <dl className="mt-4 grid gap-3 border-t border-[var(--border)] pt-3 sm:grid-cols-2 lg:grid-cols-5">
                    <div><dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Record</dt><dd className="mt-1 text-sm font-bold text-[var(--text)]">{entity.name}</dd></div>
                    <div><dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Code</dt><dd className="mt-1 break-all font-mono text-xs text-[var(--text)]">{entity.code || '—'}</dd></div>
                    <div><dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Type</dt><dd className="mt-1 text-sm text-[var(--text)]">{entity.type}</dd></div>
                    <div><dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Zone</dt><dd className="mt-1 text-sm text-[var(--text)]">{entity.zoneName || 'Site-wide'}</dd></div>
                    <div><dt className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Stable ID</dt><dd className="mt-1 break-all font-mono text-xs text-[var(--text)]">{entity.id}</dd></div>
                  </dl>
                  {issue.field ? <p className="mt-3 text-xs text-[var(--text-sub)]">Field to resolve: <code className="font-mono font-bold text-[var(--text)]">{issue.field}</code></p> : null}
                  {resolutions.length ? (
                    <div className="mt-3 rounded-xl border border-[var(--primary)]/25 bg-[var(--surface)] p-3">
                      <label className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]" htmlFor={`resolution-search-${key}`}>Find a valid {resolutionKind}</label>
                      <Input
                        id={`resolution-search-${key}`}
                        className="mt-2"
                        type="search"
                        value={resolutionSearch}
                        placeholder="Search name, code, zone, type, or stable ID"
                        disabled={tree.installation.status === 'Completed' || resolvingIssueKey === key}
                        onChange={(event) => setResolutionSearches((current) => ({ ...current, [key]: event.target.value }))}
                      />
                      <label className="mt-3 block text-xs font-bold uppercase tracking-wide text-[var(--muted)]" htmlFor={`resolution-${key}`}>Confirmed {resolutionKind}</label>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                        <Select id={`resolution-${key}`} value={resolutionSelections[key] || ''} disabled={tree.installation.status === 'Completed' || resolvingIssueKey === key} onChange={(event) => setResolutionSelections((current) => ({ ...current, [key]: event.target.value }))}>
                          <option value="">Choose a confirmed {resolutionKind}</option>
                          {visibleResolutions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.code ? `${candidate.code} — ` : ''}{candidate.name} · {candidate.type}{candidate.zoneName ? ` · ${candidate.zoneName}` : ''}</option>)}
                        </Select>
                        <Button disabled={!resolutionSelections[key] || tree.installation.status === 'Completed' || resolvingIssueKey === key} onClick={() => void saveIssueResolution(issue, key)}>{resolvingIssueKey === key ? 'Saving…' : 'Apply and save'}</Button>
                      </div>
                      <p className="mt-2 text-xs text-[var(--text-sub)]">Showing {visibleResolutions.length} of {resolutions.length} valid choices. Refine the search to reach any result while keeping the picker fast. Nothing is selected automatically.</p>
                      {tree.installation.status === 'Completed' ? <p className="mt-2 text-xs font-semibold text-[var(--amber)]">Reopen this installation before applying a resolution.</p> : null}
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--primary)]/25 bg-[var(--surface)] p-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Issue-specific resolution</p>
                        <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--text-sub)]">{correction.instruction}</p>
                      </div>
                      <LinkButton href={correction.href}>{correction.label}<Icon name="chevron-right" size={16} /></LinkButton>
                    </div>
                  )}
                  {candidates.length ? (
                    <div className="mt-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Related records from the server contract</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {candidates.map((candidate) => <Link key={candidate.id} href={candidate.href} className="min-h-10 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-xs font-bold text-[var(--primary)] hover:border-[var(--primary)]">{candidate.code ? `${candidate.code} — ` : ''}{candidate.name}</Link>)}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
            <ResultPager page={issuePage} pageSize={ISSUE_PAGE_SIZE} total={issueTotal} onPage={setIssuePage} />
          </div>
        ) : (
          <div>
            <p className="mt-4 text-sm text-[var(--text-sub)]">No {issueCategory === 'RECONCILIATION' ? 'To be confirmed relationships' : 'other completion issues'} match the current search and filters.</p>
            {issueTotal ? <ResultPager page={issuePage} pageSize={ISSUE_PAGE_SIZE} total={issueTotal} onPage={setIssuePage} /> : null}
          </div>
        )}
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
          <Input className="mt-4" type="search" value={electricalSearch} placeholder="Search code, node, kind, or type" aria-label="Search electrical nodes" onChange={(event) => { setElectricalSearch(event.target.value); setElectricalPage(0); setHierarchyPage(0); }} />
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Electrical map view">
            <Button variant={electricalView === 'HIERARCHY' ? 'primary' : 'secondary'} aria-pressed={electricalView === 'HIERARCHY'} onClick={() => setElectricalView('HIERARCHY')}>Relationship hierarchy</Button>
            <Button variant={electricalView === 'TABLE' ? 'primary' : 'secondary'} aria-pressed={electricalView === 'TABLE'} onClick={() => setElectricalView('TABLE')}>Relationship table</Button>
          </div>
          <div className="mt-3"><InlineNotice>
            <strong>Supply and measurement stay separate:</strong> FED_FROM builds the electrical parent/child hierarchy. MEASURES shows which installed meter board measures a target and never changes that target’s supply parent.
          </InlineNotice></div>
          {electricalView === 'HIERARCHY' ? (
            visibleHierarchyRows.length ? (
              <>
              <ol className="mt-4 space-y-2" aria-label="Electrical supply hierarchy">
                {pagedHierarchyRows.map((row) => {
                  const hasChildren = electricalParentIds.has(row.node.id);
                  const collapsed = collapsedElectricalNodeIds.has(row.node.id);
                  const unresolvedForNode = (electrical?.unresolved || []).filter((item) => item.subjectId === row.node.id);
                  return (
                  <li key={row.node.id} style={{ paddingInlineStart: `${Math.min(row.depth, 8) * 20}px` }}>
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="sr-only">Electrical hierarchy level {row.depth + 1}. </span>
                          <p className="text-sm font-extrabold text-[var(--text)]">{row.node.displayCode ? `${row.node.displayCode} — ` : ''}{row.node.name}</p>
                          <p className="mt-1 break-all font-mono text-xs text-[var(--muted)]">{row.node.kind} · {row.node.id}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {row.node.typeLabel ? <span className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-xs font-bold text-[var(--text-sub)]">{row.node.typeLabel}</span> : null}
                          {row.node.coverageState ? <span className="rounded-full bg-[var(--primary-soft)] px-2.5 py-1 text-xs font-bold text-[var(--primary)]">{coverageLabel(row.node.coverageState)}</span> : null}
                          {hasChildren ? (
                            <Button
                              variant="ghost"
                              aria-expanded={!collapsed}
                              onClick={() => {
                                setCollapsedElectricalNodeIds((current) => {
                                  const next = new Set(current);
                                  if (collapsed) next.delete(row.node.id);
                                  else next.add(row.node.id);
                                  return next;
                                });
                                setHierarchyPage(0);
                                setElectricalAnnouncement(`${row.node.name} ${collapsed ? 'expanded' : 'collapsed'}.`);
                              }}
                            >
                              <Icon name="chevron-down" size={16} className={collapsed ? '-rotate-90' : ''} />{collapsed ? 'Expand' : 'Collapse'}
                            </Button>
                          ) : null}
                          <LinkButton href={electricalNodeHref(tree, row.node)} variant="secondary">Open record</LinkButton>
                          {unresolvedForNode.length ? <LinkButton href={unresolvedRelationshipHref(tree, unresolvedForNode[0])}>Resolve topology</LinkButton> : null}
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 border-t border-[var(--border)] pt-3 sm:grid-cols-2">
                        <p className="text-xs text-[var(--text-sub)]"><strong className="text-[var(--text)]">FED_FROM:</strong> {row.parent ? `${row.parent.displayCode ? `${row.parent.displayCode} — ` : ''}${row.parent.name}` : row.node.kind === 'GRID' ? 'Grid root' : row.node.kind === 'VIRTUAL_RESIDUAL' ? 'Derived from its canonical residual parent' : 'No confirmed supply edge'}</p>
                        <p className="text-xs text-[var(--text-sub)]"><strong className="text-[var(--text)]">MEASURES:</strong> {row.measuredBy.length ? row.measuredBy.map((source) => `${source.displayCode ? `${source.displayCode} — ` : ''}${source.name}`).join(', ') : 'No confirmed measurement edge to this target'}</p>
                        <p className="text-xs text-[var(--text-sub)]"><strong className="text-[var(--text)]">Physical zone:</strong> {tree.zones.find((zone) => zone.id === row.node.physicalLocationId)?.zoneName || 'Site-wide / derived'}</p>
                      </div>
                    </div>
                  </li>
                  );
                })}
              </ol>
              <ResultPager page={hierarchyPage} pageSize={HIERARCHY_PAGE_SIZE} total={visibleHierarchyRows.length} onPage={setHierarchyPage} />
              </>
            ) : <p className="mt-4 text-sm text-[var(--text-sub)]">No electrical relationships match this search.</p>
          ) : (
            <>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[960px] text-left text-sm">
                  <thead><tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]"><th className="px-3 py-3">Node</th><th className="px-3 py-3">FED_FROM source</th><th className="px-3 py-3">MEASURES source</th><th className="px-3 py-3">Physical zone</th><th className="px-3 py-3">Coverage</th></tr></thead>
                  <tbody>{pageItems(filteredElectricalRows, electricalPage, TABLE_PAGE_SIZE).map((row) => <tr key={row.node.id} className="border-b border-[var(--border)]"><td className="px-3 py-3"><Link className="font-bold text-[var(--primary)] hover:underline" href={electricalNodeHref(tree, row.node)}>{row.node.displayCode ? `${row.node.displayCode} — ` : ''}{row.node.name}</Link><span className="mt-1 block break-all font-mono text-xs text-[var(--muted)]">{row.node.kind} · {row.node.id}</span></td><td className="px-3 py-3">{row.parent ? `${row.parent.displayCode ? `${row.parent.displayCode} — ` : ''}${row.parent.name}` : '—'}</td><td className="px-3 py-3">{row.measuredBy.length ? row.measuredBy.map((source) => `${source.displayCode ? `${source.displayCode} — ` : ''}${source.name}`).join(', ') : '—'}</td><td className="px-3 py-3">{tree.zones.find((zone) => zone.id === row.node.physicalLocationId)?.zoneName || '—'}</td><td className="px-3 py-3">{coverageLabel(row.node.coverageState)}</td></tr>)}</tbody>
                </table>
              </div>
              <ResultPager page={electricalPage} pageSize={TABLE_PAGE_SIZE} total={filteredElectricalRows.length} onPage={setElectricalPage} />
            </>
          )}
          {electrical?.unresolved.length ? (
            <div className="mt-4 rounded-xl border border-[var(--amber)]/30 bg-[var(--amber-soft)] p-4">
              <h3 className="text-sm font-extrabold text-[var(--text)]">Unresolved electrical relationships · {filteredUnresolved.length} matching</h3>
              <Input
                className="mt-3"
                type="search"
                value={unresolvedSearch}
                placeholder="Search unresolved subject, relation, or reason"
                aria-label="Search unresolved electrical relationships"
                onChange={(event) => { setUnresolvedSearch(event.target.value); setUnresolvedPage(0); }}
              />
              <ul className="mt-2 space-y-1 text-xs text-[var(--text-sub)]">
                {pageItems(filteredUnresolved, unresolvedPage, UNRESOLVED_PAGE_SIZE).map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2"><span><strong className="text-[var(--text)]">{item.subjectType} {item.subjectId}</strong> · {item.relation} · missing {item.missingEnd.toLocaleLowerCase()} · {item.reason}</span><LinkButton href={unresolvedRelationshipHref(tree, item)} variant="secondary">Resolve</LinkButton></li>)}
              </ul>
              {filteredUnresolved.length ? <ResultPager page={unresolvedPage} pageSize={UNRESOLVED_PAGE_SIZE} total={filteredUnresolved.length} onPage={setUnresolvedPage} /> : <p className="mt-3 text-xs text-[var(--text-sub)]">No unresolved relationships match this search.</p>}
            </div>
          ) : null}
          <p className="sr-only" aria-live="polite" aria-atomic="true">{electricalAnnouncement}</p>
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
              const coverage = serverCoverageByAsset.get(asset.id) || coverageState(tree, asset);
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
  const [coverageFilter, setCoverageFilter] = useState<'ALL' | 'DIRECT' | 'CONFIRMED_UNMETERED' | 'VIRTUAL' | 'UNMETERED' | 'TBC' | 'INVALID'>('ALL');
  const [meterPage, setMeterPage] = useState(0);
  const [coveragePage, setCoveragePage] = useState(0);
  const [metersOpen, setMetersOpen] = useState(true);
  const [coverageOpen, setCoverageOpen] = useState(true);
  const filtered = useMemo(() => {
    if (!query.data) return [];
    const normalized = search.trim().toLowerCase();
    return meterDevices(query.data).filter((meter) => !normalized || `${meterDeviceName(meter)} ${meter.serialNumber} ${meter.deviceModel}`.toLowerCase().includes(normalized));
  }, [query.data, search]);
  if (query.isLoading) return <Spinner />;
  if (query.error || !query.data) return <ErrorBanner message={installHubConnectionErrorMessage(query.error || new Error('Installation not found.'))} />;
  const tree = query.data;
  const assignments = measurementAssignments(tree);
  const inventory = meteringInventorySummary(tree);
  const readinessIssues = localReadiness(tree).issues;
  const visibleMeters = pageItems(filtered, meterPage, METER_PAGE_SIZE);
  const normalizedCoverageSearch = coverageSearch.trim().toLowerCase();
  const currentElectrical = electricalQuery.data?.treeRevision === tree.treeRevision
    ? electricalQuery.data
    : undefined;
  const serverCoverageByAsset = new Map(
    (currentElectrical?.nodes || [])
      .filter((node) => node.kind === 'SITE_ASSET')
      .map((node) => [node.id, node.coverageState]),
  );
  const mappingCoverageByAsset = new Map(
    (mappingQuery.data
      && tree.installation.status === 'Completed'
      && mappingQuery.data?.installation.recordVersionNumber === tree.recordVersionNumber
      ? mappingQuery.data.assetCoverage
      : []).map((item) => [item.assetId, item]),
  );
  const coverageForAsset = (asset: InstallationTree['siteAssets'][number]): string => (
    serverCoverageByAsset.get(asset.id)
    || coverageState(tree, asset, readinessIssues)
  );
  const coverageCounts = tree.siteAssets.reduce((counts, asset) => {
    const coverage = coverageForAsset(asset);
    counts[coverage] = (counts[coverage] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const coverageAssets = [...tree.siteAssets]
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter((asset) => {
      if (coverageFilter === 'ALL') return true;
      const coverage = coverageForAsset(asset);
      if (coverageFilter === 'CONFIRMED_UNMETERED') {
        return siteAssetMeteringState(asset).kind === 'UNMETERED'
          && (coverage === 'UNMETERED' || coverage === 'VIRTUAL');
      }
      return coverage === coverageFilter;
    })
    .filter((asset) => !normalizedCoverageSearch || `${displayCodeValue(asset)} ${asset.assetName} ${siteAssetTypeLabel(asset)}`.toLowerCase().includes(normalizedCoverageSearch));
  return (
    <div>
      <Breadcrumbs items={[{ label: 'Installations', href: '/installhub/installations' }, { label: tree.installation.siteName, href: `/installhub/installations/${installationId}` }, { label: 'Metering table' }]} />
      <PageHeader title="Metering table" subtitle="Exact devices, stable channel IDs, grouped measurement targets, and complete asset coverage." actions={<LinkButton href={`/installhub/installations/${installationId}/data`} variant="secondary">Data & reconciliation</LinkButton>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Directly metered assets', inventory.assets.directlyMetered],
          ['Confirmed unmetered assets', inventory.assets.confirmedUnmetered],
          ['Metering TBC / broken', inventory.assets.toBeConfirmed + inventory.assets.brokenMappings],
          ['Unassigned active channels', inventory.channels.unassignedActive],
        ].map(([label, value]) => (
          <Card key={label}>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">{label}</p>
            <p className="mt-2 text-3xl font-extrabold text-[var(--text)]">{value}</p>
          </Card>
        ))}
      </div>
      <div className="mb-6">
        <InlineNotice tone="success">
          Confirmed unmetered means no direct device/channel is installed. These assets remain in the complete register, and that metering state alone does not block completion. TBC, invalid mappings, and non-spare channels left unassigned remain separate readiness issues.
        </InlineNotice>
      </div>
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
            const assignedChannelIds = new Set(meterAssignments.flatMap((assignment) => assignment.channelIds));
            const activeChannels = meter.channels.filter((channel) => channel.purpose !== 'SPARE');
            const unassignedActiveChannels = activeChannels.filter((channel) => !assignedChannelIds.has(channel.id));
            const spareChannelCount = meter.channels.filter((channel) => channel.purpose === 'SPARE').length;
            const allChannelsSpare = meter.channels.length > 0 && spareChannelCount === meter.channels.length;
            const meterAssignmentIds = new Set(meterAssignments.map((assignment) => assignment.id));
            const meterChannelIds = new Set(meter.channels.map((channel) => channel.id));
            const meterBlockingIssues = readinessIssues.filter((issue) => issue.severity === 'ERROR' && (
              (issue.entityType === 'meter' && issue.entityId === meter.id)
              || (issue.entityType === 'channel' && meterChannelIds.has(issue.entityId))
              || (issue.entityType === 'measurement_assignment' && meterAssignmentIds.has(issue.entityId))
            ));
            const nonUnassignedIssues = meterBlockingIssues.filter((issue) => issue.code !== 'CHANNEL_UNASSIGNED');
            const meterStatus = nonUnassignedIssues.length
              ? `${nonUnassignedIssues.length} metering configuration issue${nonUnassignedIssues.length === 1 ? '' : 's'}`
              : unassignedActiveChannels.length
              ? `${unassignedActiveChannels.length} active channel${unassignedActiveChannels.length === 1 ? '' : 's'} unassigned`
              : allChannelsSpare
                ? 'No active measurements · all channels spare'
                : activeChannels.length
                  ? 'All active channels assigned'
                  : 'No channels declared · needs attention';
            const meterStatusTone = nonUnassignedIssues.length || !meter.channels.length
              ? 'text-[var(--red)]'
              : unassignedActiveChannels.length
                ? 'text-[var(--amber)]'
                : 'text-[var(--green)]';
            const meterHref = board
              ? `/installhub/installations/${encodeURIComponent(installationId)}/zones/${encodeURIComponent(board.zoneId)}/boards/${encodeURIComponent(board.id)}/meters/${encodeURIComponent(meter.id)}`
              : null;
            return (
              <div key={meter.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-extrabold text-[var(--text)]">{meterDeviceName(meter)}</h2>
                    <p className="mt-1 text-xs text-[var(--text-sub)]">{meter.deviceModel} · {meter.serialNumber} · {board ? `${displayCodeValue(board)} — ${board.assetName}` : 'Missing board'}</p>
                    <p className={`mt-2 text-xs font-extrabold ${meterStatusTone}`}>{meterStatus}</p>
                    <p className="mt-1 text-xs text-[var(--text-sub)]">{meterAssignments.length} assignment{meterAssignments.length === 1 ? '' : 's'} · {activeChannels.length} active · {spareChannelCount} spare</p>
                  </div>
                  {meterHref ? (
                    <div className="flex flex-wrap gap-2">
                      <LinkButton href={meterHref} variant="secondary">Open device</LinkButton>
                      <LinkButton href={`${meterHref}#meter-channels`} variant="secondary">Channels</LinkButton>
                      <LinkButton href={`${meterHref}#meter-assignments`} variant="secondary">Assignments</LinkButton>
                    </div>
                  ) : null}
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[860px] text-left text-sm">
                    <thead><tr className="border-b border-[var(--border)] text-xs uppercase tracking-wide text-[var(--muted)]"><th className="px-2 py-2">Channel</th><th className="px-2 py-2">Purpose</th><th className="px-2 py-2">Load / sensor</th><th className="px-2 py-2">Exact assignment target</th></tr></thead>
                    <tbody>{meter.channels.map((channel) => {
                      const assignment = meterAssignments.find((item) => item.channelIds.includes(channel.id));
                      const target = assignment ? measurementTargetDetails(tree, assignment.target) : null;
                      return (
                        <tr key={channel.id} className="border-b border-[var(--border)]">
                          <td className="px-2 py-2 font-bold">{meterHref ? <Link className="text-[var(--primary)] hover:underline" href={`${meterHref}#meter-channel-${channel.ordinal}`}>Channel {channel.ordinal}</Link> : `Channel ${channel.ordinal}`} <span className="font-normal text-[var(--muted)]">{channel.phaseLabel || ''}</span><span className="mt-1 block break-all font-mono text-xs font-normal text-[var(--muted)]">{channel.id}</span></td>
                          <td className="px-2 py-2">{channel.purpose.replaceAll('_', ' ').toLowerCase()}</td>
                          <td className="px-2 py-2">{channel.customLoadTypeName || channel.loadTypeCode || '—'} · {channel.sensorRating || '—'}</td>
                          <td className="px-2 py-2">{assignment && target ? (
                            <>
                              {target.href ? <Link className="font-bold text-[var(--primary)] hover:underline" href={target.href}>{target.label}</Link> : <span className="font-bold text-[var(--text)]">{target.label}</span>}
                              <span className="mt-1 block text-xs text-[var(--text-sub)]">{assignment.phaseMode.replaceAll('_', ' ')} · {assignment.direction} · {assignment.status}</span>
                              <span className="mt-1 block break-all font-mono text-xs text-[var(--muted)]">{target.kind}{target.id ? ` · ${target.id}` : ''}</span>
                            </>
                          ) : channel.purpose === 'SPARE' ? (
                            <span className="text-[var(--text-sub)]">Spare / unused — no target required</span>
                          ) : (
                            <span className="font-bold text-[var(--amber)]">Unassigned active channel — blocks completion</span>
                          )}</td>
                        </tr>
                      );
                    })}</tbody>
                  </table>
                </div>
              </div>
            );
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
          <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,320px)]">
            <Input type="search" value={coverageSearch} placeholder="Search asset, code, or type" aria-label="Search asset coverage" onChange={(event) => { setCoverageSearch(event.target.value); setCoveragePage(0); }} />
            <Select aria-label="Filter assets by metering coverage" value={coverageFilter} onChange={(event) => { setCoverageFilter(event.target.value as typeof coverageFilter); setCoveragePage(0); }}>
              <option value="ALL">All coverage states ({tree.siteAssets.length})</option>
              <option value="DIRECT">Direct ({coverageCounts.DIRECT || 0})</option>
              <option value="CONFIRMED_UNMETERED">Confirmed unmetered ({inventory.assets.confirmedUnmetered})</option>
              <option value="VIRTUAL">Virtual / residual ({coverageCounts.VIRTUAL || 0})</option>
              <option value="UNMETERED">Unmetered · no residual ({coverageCounts.UNMETERED || 0})</option>
              <option value="TBC">To be confirmed ({coverageCounts.TBC || 0})</option>
              <option value="INVALID">Mapping issue ({coverageCounts.INVALID || 0})</option>
            </Select>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{pageItems(coverageAssets, coveragePage, TABLE_PAGE_SIZE).map((asset) => {
            const mappedCoverage = mappingCoverageByAsset.get(asset.id);
            const coverage = coverageForAsset(asset);
            const sourceId = mappedCoverage && 'source' in mappedCoverage && mappedCoverage.source && typeof mappedCoverage.source === 'object' && 'id' in mappedCoverage.source ? String(mappedCoverage.source.id) : '';
            const declaredState = siteAssetMeteringState(asset).kind;
            return <Link key={asset.id} href={`/installhub/installations/${installationId}/zones/${asset.zoneId}/assets/${asset.id}`} className="min-h-14 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3 hover:border-[var(--primary)]"><span className="block text-sm font-bold text-[var(--text)]">{displayCodeValue(asset)} — {asset.assetName}</span><span className="mt-1 block text-xs font-semibold text-[var(--text-sub)]">{coverageLabel(coverage)}</span><span className="mt-1 block text-xs text-[var(--text-sub)]">Declared: {declaredState === 'UNMETERED' ? 'Confirmed unmetered' : declaredState.replaceAll('_', ' ')} · Fed from {sourceLabel(tree, assetElectricalSource(asset))}</span>{sourceId ? <span className="mt-1 block font-mono text-xs text-[var(--muted)]">Shared source {sourceId}</span> : null}</Link>;
          })}</div>
          <ResultPager page={coveragePage} pageSize={TABLE_PAGE_SIZE} total={coverageAssets.length} onPage={setCoveragePage} />
        </div> : null}
      </Card>
    </div>
  );
}
