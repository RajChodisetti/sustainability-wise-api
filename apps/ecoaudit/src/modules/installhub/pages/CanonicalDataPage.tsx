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
import { ElectricalTreeCanvas } from '@/modules/installhub/components/ElectricalTreeCanvas';
import { SearchableSelect } from '@/modules/installhub/components/SearchableSelect';
import { ConfirmDialog } from '@/modules/installhub/components/WorkflowUi';
import {
  useInstallationElectricalTree,
  useElectricalMapLayoutWriter,
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
  filterElectricalHierarchyRows,
  measurementTargetDetails,
  meteringInventorySummary,
  readinessCandidateDetails,
  readinessCorrectionAction,
  readinessEntityDetails,
  readinessIssueKey,
  readinessResolutionCandidates,
  applyReadinessCandidateResolution,
  removeUnresolvedElectricalRelationship,
  resolvedElectricalTopology,
  unresolvedElectricalRecords,
  unresolvedRelationshipRemovalPlan,
} from '@/modules/installhub/lib/electricalPresentation';
import type { InstallationTree, ReadinessIssue } from '@/modules/installhub/types/domain';
import type { ElectricalTreeReadModel } from '@/modules/installhub/types/domain';
import { useToast } from '@/contexts/ToastContext';

const TABLE_PAGE_SIZE = 50;
const METER_PAGE_SIZE = 20;
const ISSUE_PAGE_SIZE = 50;
const HIERARCHY_PAGE_SIZE = 100;
const READINESS_ENTITY_TYPES = [
  'board',
  'site_asset',
  'measurement_assignment',
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

function unresolvedRelationshipName(
  tree: InstallationTree,
  item: ElectricalTreeReadModel['unresolved'][number],
): string {
  if (item.subjectType === 'BOARD') {
    const board = tree.electricalAssets.find((candidate) => candidate.id === item.subjectId);
    return board ? `${displayCodeValue(board)} — ${board.assetName}` : `Switchboard ${item.subjectId}`;
  }
  if (item.subjectType === 'SITE_ASSET') {
    const asset = tree.siteAssets.find((candidate) => candidate.id === item.subjectId);
    return asset ? `${displayCodeValue(asset)} — ${asset.assetName}` : `Site asset ${item.subjectId}`;
  }
  const assignment = measurementAssignments(tree).find((candidate) => candidate.id === item.subjectId);
  const meter = meterDevices(tree).find((candidate) => candidate.id === assignment?.meterId);
  return meter
    ? `${meterDeviceName(meter)} · channel assignment`
    : `Measurement assignment ${item.subjectId}`;
}

export function InstallHubCanonicalDataPage() {
  const { installationId } = useParams<{ installationId: string }>();
  const treeQuery = useInstallationTree(installationId);
  const writer = useTreeWriter(installationId);
  const toast = useToast();
  const [issueSearch, setIssueSearch] = useState('');
  const [issuePage, setIssuePage] = useState(0);
  const [issueEntityType, setIssueEntityType] = useState('ALL');
  const [issueZoneId, setIssueZoneId] = useState('ALL');
  const [reviewedIssueKeys, setReviewedIssueKeys] = useState<Set<string>>(new Set());
  const [resolutionSelections, setResolutionSelections] = useState<Record<string, string>>({});
  const [resolvingIssueKey, setResolvingIssueKey] = useState<string | null>(null);
  const [reconciliationResumedFor, setReconciliationResumedFor] = useState('');
  const [reviewedTreeRevision, setReviewedTreeRevision] = useState<number | null>(null);
  const deferredIssueSearch = useDeferredValue(issueSearch);
  const readinessQuery = useInstallationReadiness(installationId, {
    offset: issuePage * ISSUE_PAGE_SIZE,
    limit: ISSUE_PAGE_SIZE,
    q: deferredIssueSearch,
    ...(issueEntityType === 'ALL' ? {} : { entityType: issueEntityType }),
    category: 'RECONCILIATION',
    ...(issueZoneId === 'ALL' ? {} : { zoneId: issueZoneId }),
  });
  const reconciliationSummaryQuery = useInstallationReadiness(installationId, {
    offset: 0,
    limit: 1,
    category: 'RECONCILIATION',
  });
  const electricalQuery = useInstallationElectricalTree(installationId);
  const saveElectricalMapLayout = useElectricalMapLayoutWriter(installationId);
  const mappingQuery = useInstallationMapping(installationId);
  const [electricalSearch, setElectricalSearch] = useState('');
  const [assetSearch, setAssetSearch] = useState('');
  const [electricalPage, setElectricalPage] = useState(0);
  const [assetPage, setAssetPage] = useState(0);
  const [electricalOpen, setElectricalOpen] = useState(true);
  const [electricalView, setElectricalView] = useState<'TREE' | 'HIERARCHY' | 'TABLE'>('TREE');
  const [electricalLayoutDirty, setElectricalLayoutDirty] = useState(false);
  const [collapsedElectricalNodeIds, setCollapsedElectricalNodeIds] = useState<Set<string>>(new Set());
  const [electricalAnnouncement, setElectricalAnnouncement] = useState('');
  const [hierarchyPage, setHierarchyPage] = useState(0);
  const [unresolvedSearch, setUnresolvedSearch] = useState('');
  const [pendingUnresolvedRemoval, setPendingUnresolvedRemoval] = useState<ElectricalTreeReadModel['unresolved'][number] | null>(null);
  const [removingUnresolvedId, setRemovingUnresolvedId] = useState<string | null>(null);
  const hierarchyInitializedRef = useRef('');
  const electricalToggleRef = useRef<HTMLButtonElement>(null);
  const [lastCompatibleElectrical, setLastCompatibleElectrical] = useState<ElectricalTreeReadModel>();
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
          entityType?: string;
          zoneId?: string;
          reviewed?: string[];
        };
        if (reconciliationResumedFor !== installationId) {
          setIssueSearch(saved.search || '');
          setIssuePage(Number.isInteger(saved.page) && (saved.page || 0) >= 0 ? saved.page || 0 : 0);
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
      entityType: issueEntityType,
      zoneId: issueZoneId,
      reviewed: [...reviewedIssueKeys],
    }));
  }, [currentTreeRevision, installationId, issueEntityType, issuePage, issueSearch, issueZoneId, reconciliationResumedFor, reviewedIssueKeys, reviewedTreeRevision]);

  useEffect(() => {
    const model = resolvedElectricalTopology(electricalQuery.data);
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

  useEffect(() => {
    if (electricalQuery.data?.treeRevision === currentTreeRevision) {
      setLastCompatibleElectrical(electricalQuery.data);
    }
  }, [currentTreeRevision, electricalQuery.data]);

  if (treeQuery.isLoading) return <Spinner />;
  if (treeQuery.error || !treeQuery.data) return <ErrorBanner message={installHubConnectionErrorMessage(treeQuery.error || new Error('Installation not found.'))} />;
  const tree = treeQuery.data;
  const readiness = readinessQuery.data;
  const electrical = electricalQuery.data;
  const compatibleElectrical = electrical?.treeRevision === currentTreeRevision
    ? electrical
    : undefined;
  const currentElectrical = compatibleElectrical
    ?? (electricalLayoutDirty && lastCompatibleElectrical?.installationId === installationId
      ? lastCompatibleElectrical
      : undefined);
  const resolvedElectrical = resolvedElectricalTopology(currentElectrical);
  const unresolvedElectrical = unresolvedElectricalRecords(currentElectrical);
  const localAdvisory = readiness?.authority === 'LOCAL_ADVISORY' || mappingQuery.data?.authority === 'LOCAL_ADVISORY';
  const visibleIssues = readiness?.issues || [];
  const issueTotal = readiness?.issuePage?.total ?? visibleIssues.length;
  const reconciliationTotal = reconciliationSummaryQuery.data?.issuePage?.total ?? 0;
  const issueRows = visibleIssues.map((issue) => ({
    issue,
    key: readinessIssueKey(issue),
    entity: readinessEntityDetails(tree, issue),
    candidates: readinessCandidateDetails(tree, issue),
    resolutions: readinessResolutionCandidates(tree, issue),
    correction: readinessCorrectionAction(tree, issue),
  }));
  const visibleIssueRows = issueRows;
  const reviewedPrefix = 'RECONCILIATION:';
  const reviewTotal = reconciliationTotal;
  const reviewedCount = Math.min(
    [...reviewedIssueKeys].filter((key) => key.startsWith(reviewedPrefix)).length,
    reviewTotal,
  );
  const allElectricalRows = electricalHierarchyRows(resolvedElectrical);
  const filteredElectricalRows = filterElectricalHierarchyRows(allElectricalRows, electricalSearch);
  const filteredElectricalNodeIds = new Set(filteredElectricalRows.map((row) => row.node.id));
  const electricalParentIds = new Set(allElectricalRows.flatMap((row) => row.parent ? [row.parent.id] : []));
  const visibleHierarchyRows = electricalSearch.trim()
    ? filteredElectricalRows
    : filteredElectricalRows.filter((row) => !row.ancestorIds.some((id) => collapsedElectricalNodeIds.has(id)));
  const pagedHierarchyRows = pageItems(visibleHierarchyRows, hierarchyPage, HIERARCHY_PAGE_SIZE);
  const normalizedUnresolvedSearch = unresolvedSearch.trim().toLocaleLowerCase('en-AU');
  const filteredUnresolved = unresolvedElectrical.filter((item) => (
    !normalizedUnresolvedSearch
    || `${item.id} ${item.subjectType} ${item.subjectId} ${item.relation} ${item.missingEnd} ${item.reason}`
      .toLocaleLowerCase('en-AU')
      .includes(normalizedUnresolvedSearch)
  ));
  const pendingRemovalPlan = pendingUnresolvedRemoval
    ? unresolvedRelationshipRemovalPlan(tree, pendingUnresolvedRemoval)
    : null;
  const normalizedAssetSearch = assetSearch.trim().toLowerCase();
  const filteredAssets = [...tree.siteAssets]
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter((asset) => {
      const zoneName = tree.zones.find((zone) => zone.id === asset.zoneId)?.zoneName || '';
      return !normalizedAssetSearch || `${displayCodeValue(asset)} ${asset.assetName} ${siteAssetTypeLabel(asset)} ${zoneName}`.toLowerCase().includes(normalizedAssetSearch);
    });
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
          throw new Error('This candidate is no longer valid. Recheck the TBC list.');
        }
      });
      setReviewedIssueKeys((current) => new Set(current).add(`RECONCILIATION:${key}`));
      setResolutionSelections((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setIssuePage(0);
      toast.success('TBC resolution saved and the list is being refreshed.');
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setResolvingIssueKey(null);
    }
  }

  async function removePendingUnresolved() {
    if (!pendingUnresolvedRemoval) return;
    setRemovingUnresolvedId(pendingUnresolvedRemoval.id);
    try {
      await writer.mutate((next) => {
        removeUnresolvedElectricalRelationship(next, pendingUnresolvedRemoval);
      });
      toast.success('Unresolved record removed. Confirmed electrical data was preserved.');
      setPendingUnresolvedRemoval(null);
      window.requestAnimationFrame(() => electricalToggleRef.current?.focus());
    } catch (error) {
      toast.error(installHubConnectionErrorMessage(error));
    } finally {
      setRemovingUnresolvedId(null);
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
        subtitle="Physical locations, confirmed electrical relationships, To be confirmed records, and full asset coverage."
        actions={<LinkButton href={`/installhub/installations/${installationId}/metering`}><Icon name="gauge" size={17} />Metering table</LinkButton>}
      />

      {localAdvisory ? (
        <div className="mb-5"><InlineNotice>This is a local projection. Reconnect to load server-confirmed TBC data and pinned output.</InlineNotice></div>
      ) : null}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Physical zones', tree.zones.length],
          ['Resolved electrical nodes', resolvedElectrical?.nodes.length || 0],
          ['All site assets', tree.siteAssets.length],
          ['To be confirmed', reconciliationTotal],
        ].map(([label, value]) => <Card key={label}><p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">{label}</p><p className="mt-2 text-3xl font-extrabold text-[var(--text)]">{value}</p></Card>)}
      </div>

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-extrabold text-[var(--text)]">To be confirmed</h2>
            <p className="mt-1 text-xs text-[var(--text-sub)]">
              Only records deliberately left To be confirmed appear here. Optional or incomplete fields are not flagged.
            </p>
          </div>
          <Button
            disabled={!readiness?.eligibility.mappingExport || !mappingQuery.data || localAdvisory}
            onClick={() => mappingQuery.data && downloadJson(`${tree.installation.siteCode || 'installation'}-mapping-v${tree.recordVersionNumber || 0}.json`, mappingQuery.data)}
          >
            <Icon name="download" size={16} />Download pinned mapping
          </Button>
        </div>
        <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-extrabold text-[var(--text)]">Review progress</p>
              <p className="mt-1 text-xs text-[var(--text-sub)]">{reviewedCount} of {reviewTotal} TBC items reviewed in this browser. Your search, page, filters, and reviewed markers resume automatically.</p>
            </div>
            {reviewedCount ? <Button variant="ghost" onClick={() => setReviewedIssueKeys(new Set())}>Reset reviewed</Button> : null}
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface)]" role="progressbar" aria-label="To be confirmed review progress" aria-valuemin={0} aria-valuemax={reviewTotal} aria-valuenow={reviewedCount}>
            <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${reviewTotal ? (reviewedCount / reviewTotal) * 100 : 0}%` }} />
          </div>
        </div>
        <Input className="mt-4" type="search" value={issueSearch} placeholder="Search TBC record, ID, relationship, or field" aria-label="Search To be confirmed records" onChange={(event) => { setIssueSearch(event.target.value); setIssuePage(0); }} />
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
          Search and filters are applied by the server before paging. {issueTotal} TBC item{issueTotal === 1 ? '' : 's'} match.
        </p>
        {readinessQuery.isLoading ? <div className="mt-4"><Spinner /></div> : readinessQuery.error ? (
          <div className="mt-4"><ErrorBanner message={installHubConnectionErrorMessage(readinessQuery.error)} /></div>
        ) : visibleIssueRows.length ? (
          <div className="mt-4 space-y-3">
            {visibleIssueRows.map(({ issue, key, entity, candidates, resolutions, correction }) => {
              const reviewedKey = `RECONCILIATION:${key}`;
              const reviewed = reviewedIssueKeys.has(reviewedKey);
              const resolutionOptions = resolutions.map((candidate) => ({
                value: candidate.id,
                label: `${candidate.code ? `${candidate.code} — ` : ''}${candidate.name} · ${candidate.type}${candidate.zoneName ? ` · ${candidate.zoneName}` : ''}`,
                keywords: `${candidate.id} ${candidate.code || ''} ${candidate.zoneName || ''}`,
              }));
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
                        <span className="rounded-full bg-[var(--surface)] px-2.5 py-1 text-xs font-extrabold text-[var(--text-sub)]">To be confirmed</span>
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
                      <label className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]" htmlFor={`resolution-${key}`}>Confirmed {resolutionKind}</label>
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
                        <SearchableSelect
                          id={`resolution-${key}`}
                          className="min-w-0 flex-1"
                          value={resolutionSelections[key] || ''}
                          options={resolutionOptions}
                          placeholder="Search name, code, zone, type, or stable ID"
                          emptyMessage={`No valid ${resolutionKind} matches this search.`}
                          disabled={tree.installation.status === 'Completed' || resolvingIssueKey === key}
                          onChange={(value) => setResolutionSelections((current) => ({ ...current, [key]: value }))}
                        />
                        <Button disabled={!resolutionSelections[key] || tree.installation.status === 'Completed' || resolvingIssueKey === key} onClick={() => void saveIssueResolution(issue, key)}>{resolvingIssueKey === key ? 'Saving…' : 'Apply and save'}</Button>
                      </div>
                      <p className="mt-2 text-xs text-[var(--text-sub)]">Search and choose in one field. Up to 100 of {resolutions.length} valid choices are shown at once; nothing is selected automatically.</p>
                      {tree.installation.status === 'Completed' ? <p className="mt-2 text-xs font-semibold text-[var(--amber)]">Reopen this installation before applying a resolution.</p> : null}
                    </div>
                  ) : (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--primary)]/25 bg-[var(--surface)] p-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-[var(--muted)]">Record-specific action</p>
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
            <p className="mt-4 text-sm text-[var(--text-sub)]">No To be confirmed records match the current search and filters.</p>
            {issueTotal ? <ResultPager page={issuePage} pageSize={ISSUE_PAGE_SIZE} total={issueTotal} onPage={setIssuePage} /> : null}
          </div>
        )}
      </Card>

      <Card className="mb-6">
        <button
          ref={electricalToggleRef}
          type="button"
          className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
          aria-expanded={electricalOpen}
          aria-controls="canonical-electrical-map"
          disabled={electricalLayoutDirty}
          title={electricalLayoutDirty ? 'Save or reset the electrical map layout before closing this section.' : undefined}
          onClick={() => setElectricalOpen((open) => !open)}
        >
          <span><span className="block font-extrabold text-[var(--text)]">Electrical system overview</span><span className="mt-1 block text-xs text-[var(--text-sub)]">A client-friendly visual of the confirmed site supply · {resolvedElectrical?.nodes.length || 0} items</span></span>
          <Icon name="chevron-down" size={18} className={electricalOpen ? 'rotate-180' : ''} />
        </button>
        {electricalOpen ? <div id="canonical-electrical-map">
          <div className={`mt-4 grid items-start gap-4 ${unresolvedElectrical.length ? 'xl:grid-cols-[minmax(0,1fr)_19rem]' : ''}`}>
          <div className="min-w-0">
          <Input type="search" value={electricalSearch} placeholder="Search switchboard, equipment, code or type" aria-label="Search electrical map items" disabled={electricalLayoutDirty} title={electricalLayoutDirty ? 'Save or reset the map layout before searching.' : undefined} onChange={(event) => { setElectricalSearch(event.target.value); setElectricalPage(0); setHierarchyPage(0); }} />
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Electrical map view">
            <Button variant={electricalView === 'TREE' ? 'primary' : 'secondary'} aria-pressed={electricalView === 'TREE'} onClick={() => setElectricalView('TREE')}>Visual map</Button>
            <Button variant={electricalView === 'HIERARCHY' ? 'primary' : 'secondary'} aria-pressed={electricalView === 'HIERARCHY'} disabled={electricalLayoutDirty} title={electricalLayoutDirty ? 'Save or reset the map layout before changing views.' : undefined} onClick={() => setElectricalView('HIERARCHY')}>Relationship hierarchy</Button>
            <Button variant={electricalView === 'TABLE' ? 'primary' : 'secondary'} aria-pressed={electricalView === 'TABLE'} disabled={electricalLayoutDirty} title={electricalLayoutDirty ? 'Save or reset the map layout before changing views.' : undefined} onClick={() => setElectricalView('TABLE')}>Relationship table</Button>
          </div>
          <div className="mt-3"><InlineNotice>
            {electricalView === 'TREE' ? (
              tree.installation.status === 'Completed' ? (
                <><strong>Saved site view:</strong> this arrangement is pinned to this completed record. New work at the same site starts from the latest electrical state and can save the next site view.</>
              ) : (
                <><strong>Site hierarchy:</strong> straight lines show confirmed supply paths from the grid through each level. Drag any symbol to move it, then save the site layout. Arrange items also enables keyboard movement.</>
              )
            ) : (
              <><strong>Supply and measurement stay separate:</strong> FED_FROM builds the electrical parent/child hierarchy. MEASURES shows which installed meter board measures a target and never changes that target’s supply parent.</>
            )}
          </InlineNotice></div>
          {electricalView === 'TREE' ? (
            resolvedElectrical?.nodes.length && (!electricalSearch.trim() || filteredElectricalRows.length) ? (
              <ElectricalTreeCanvas
                tree={tree}
                model={resolvedElectrical}
                visibleNodeIds={electricalSearch.trim() ? filteredElectricalNodeIds : undefined}
                getNodeHref={(node) => electricalNodeHref(tree, node)}
                onRevealNode={() => setElectricalSearch('')}
                onLayoutDirtyChange={setElectricalLayoutDirty}
                onSaveLayout={tree.installation.status === 'Completed' ? undefined : async (layout) => {
                  try {
                    const saved = await saveElectricalMapLayout(
                      layout,
                      resolvedElectrical.treeRevision,
                      resolvedElectrical.mapLayout?.layoutRevision ?? 0,
                    );
                    toast.success('Site electrical map layout saved.');
                    return saved;
                  } catch (error) {
                    throw new Error(installHubConnectionErrorMessage(error));
                  }
                }}
              />
            ) : <p className="mt-4 text-sm text-[var(--text-sub)]">No resolved electrical nodes match this search.</p>
          ) : electricalView === 'HIERARCHY' ? (
            visibleHierarchyRows.length ? (
              <>
              <ol className="mt-4 space-y-2" aria-label="Electrical supply hierarchy">
                {pagedHierarchyRows.map((row) => {
                  const hasChildren = electricalParentIds.has(row.node.id);
                  const collapsed = collapsedElectricalNodeIds.has(row.node.id);
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
            ) : <p className="mt-4 text-sm text-[var(--text-sub)]">No resolved electrical relationships match this search.</p>
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
          <p className="sr-only" aria-live="polite" aria-atomic="true">{electricalAnnouncement}</p>
          </div>
          {unresolvedElectrical.length ? (
            <aside aria-labelledby="unresolved-electrical-heading" className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-3 xl:sticky xl:top-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 id="unresolved-electrical-heading" className="text-xs font-extrabold text-[var(--text-sub)]">To be confirmed</h3>
                  <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">Deferred records kept outside the map · {unresolvedElectrical.length}</p>
                </div>
                <span className="rounded-full bg-[var(--surface)] px-2 py-1 text-xs font-bold text-[var(--text-sub)]" aria-label={`${unresolvedElectrical.length} To be confirmed records`}>{unresolvedElectrical.length}</span>
              </div>
              {unresolvedElectrical.length > 5 || unresolvedSearch ? (
                <Input
                  className="mt-3"
                  type="search"
                  value={unresolvedSearch}
                  placeholder="Filter To be confirmed records"
                  aria-label="Filter To be confirmed electrical records"
                  onChange={(event) => setUnresolvedSearch(event.target.value)}
                />
              ) : null}
              {filteredUnresolved.length ? (
                <ul className="mt-3 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
                  {filteredUnresolved.map((item) => {
                    const name = unresolvedRelationshipName(tree, item);
                    return (
                      <li key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5">
                        <p className="line-clamp-2 text-xs font-bold leading-5 text-[var(--text)]">{name}</p>
                        <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">{item.relation === 'SUPPLY' ? 'Supply' : 'Measurement'} · {item.reason === 'TBC' ? 'To be confirmed' : item.reason.toLocaleLowerCase()}</p>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <LinkButton href={unresolvedRelationshipHref(tree, item)} variant="ghost" className="min-h-11 px-2 text-xs">Open</LinkButton>
                          <Button
                            variant="ghost"
                            className="min-h-11 px-2 text-xs text-[var(--red)]"
                            aria-label={`Remove To be confirmed record ${name}`}
                            disabled={removingUnresolvedId === item.id}
                            onClick={() => setPendingUnresolvedRemoval(item)}
                          >
                            Remove
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : <p className="mt-3 text-xs text-[var(--muted)]">No To be confirmed records match this filter.</p>}
            </aside>
          ) : null}
          </div>
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

      <ConfirmDialog
        open={Boolean(pendingUnresolvedRemoval)}
        title={pendingUnresolvedRemoval ? `Remove ${unresolvedRelationshipName(tree, pendingUnresolvedRemoval)}?` : 'Remove To be confirmed record?'}
        description={pendingRemovalPlan?.description}
        consequences={pendingRemovalPlan?.consequences}
        confirmLabel="Remove record"
        busy={Boolean(removingUnresolvedId)}
        blockedMessage={pendingRemovalPlan?.blockedMessage}
        onConfirm={() => void removePendingUnresolved()}
        onCancel={() => setPendingUnresolvedRemoval(null)}
      />
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
          Confirmed unmetered means no direct device/channel is installed. These assets remain in the complete register. Only explicit TBC relationships block completion; invalid mappings and unassigned channels remain optional follow-up and stay outside confirmed topology.
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
                    <tbody>{meter.channels.map((channel, channelIndex) => {
                      const assignment = meterAssignments.find((item) => item.channelIds.includes(channel.id));
                      const target = assignment ? measurementTargetDetails(tree, assignment.target) : null;
                      const description = channel.description?.trim();
                      return (
                        <tr key={channel.id} className="border-b border-[var(--border)]">
                          <td className="px-2 py-2 font-bold">
                            {meterHref ? <Link className="text-[var(--primary)] hover:underline" href={`${meterHref}#meter-channel-${channelIndex + 1}`}>Channel {channel.ordinal}</Link> : `Channel ${channel.ordinal}`} <span className="font-normal text-[var(--muted)]">{channel.phaseLabel || ''}</span>
                            {description ? <span className="mt-1 block break-words text-xs font-normal leading-5 text-[var(--text-sub)]">{description}</span> : null}
                            <span className="mt-1 block break-all font-mono text-xs font-normal text-[var(--muted)]">{channel.id}</span>
                          </td>
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
                            <span className="font-bold text-[var(--text-sub)]">Unassigned active channel — optional follow-up</span>
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
