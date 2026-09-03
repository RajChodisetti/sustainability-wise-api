'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card, EmptyState, ErrorBanner, PageHeader, StatCard } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { usePortalAuth } from '@/contexts/PortalAuthContext';
import {
  getBusinessSite,
  getTopologyBetaByDevices,
  getTopologyReconstruction,
  listTopologyBetaSites,
  searchBusinessSites,
  startTopologyReconstruction,
  stopTopologyReconstruction,
} from '@/modules/fleet/api/fleet';
import { fleetConnectionErrorMessage } from '@/modules/fleet/api/client';
import { TopologyTreeDiagram } from '@/modules/fleet/components/TopologyTreeDiagram';
import {
  businessSiteMatchesQuery,
  businessSiteSearchLabel,
  buildTopologyPresentation,
  isReviewedTopologyEdge,
  parseTopologyDeviceIds,
  topologyDecisionLabel,
  topologyNodeRoleDisplay,
  type TopologyPresentation,
} from '@/modules/fleet/lib/topologyBeta';
import { formatDateTime, formatDuration, formatNumber } from '@/modules/fleet/lib/format';
import type {
  FleetBusinessSiteSearchItem,
  TopologyBetaDocument,
  TopologyBetaNode,
} from '@/modules/fleet/types/domain';

function PendingMeterCard({ node }: { node: TopologyBetaNode }) {
  const role = topologyNodeRoleDisplay(node);
  return (
    <div className="max-w-xl rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface2)] px-4 py-3.5 shadow-[var(--shadow-xs)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-extrabold text-[var(--text)]">{node.label || node.meterId}</p>
          <p className="mt-0.5 break-all font-mono text-xs text-[var(--text-sub)]">{node.deviceId}</p>
        </div>
        <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-bold text-[var(--text-sub)]">
          Relationship pending
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-sub)]">
        <span>Meter {node.meterId}</span>
        {role ? <span>{role.label} {role.value}</span> : null}
        {typeof node.validSampleCount === 'number' && node.validSampleCount > 0 ? (
          <span>{formatNumber(node.validSampleCount)} valid samples</span>
        ) : <span>No verified parent yet</span>}
      </div>
    </div>
  );
}

function RootEvidenceNotice({ document }: { document: TopologyBetaDocument }) {
  const { rootIsHeuristic, suggestedRootMeterId, rootSource } = document.location;
  const heuristicRoot = rootIsHeuristic === true || rootSource === 'LABEL_HEURISTIC_REVIEW_REQUIRED';
  if (!heuristicRoot) return null;
  const suggestedNode = document.nodes.find((node) => node.meterId === suggestedRootMeterId);
  const suggestedLabel = suggestedNode?.label || suggestedRootMeterId || 'the selected root';
  return (
    <div className="border-b border-[var(--amber)]/30 bg-[var(--amber-soft)] px-5 py-3 text-xs font-semibold leading-5 text-[var(--text)] sm:px-6" role="status">
      <strong>Suggested root only.</strong>{' '}
      {suggestedLabel} was suggested from meter labels{rootSource ? ` (${rootSource.replaceAll('_', ' ').toLowerCase()})` : ''}; this is not reconstructed or confirmed wiring evidence.
    </div>
  );
}

function EvidenceWindowNotice({ document }: { document: TopologyBetaDocument }) {
  const sourceWindow = document.evidence?.sourceWindow;
  const validWindow = sourceWindow
    && Number.isInteger(sourceWindow.fromTs)
    && sourceWindow.fromTs >= 0
    && Number.isInteger(sourceWindow.toTs)
    && sourceWindow.toTs > sourceWindow.fromTs
    && Number.isInteger(sourceWindow.intervalSeconds)
    && sourceWindow.intervalSeconds > 0;
  const fromDate = validWindow ? new Date(sourceWindow.fromTs * 1_000) : null;
  const toDate = validWindow ? new Date(sourceWindow.toTs * 1_000) : null;
  if (!validWindow
    || !fromDate
    || !toDate
    || Number.isNaN(fromDate.getTime())
    || Number.isNaN(toDate.getTime())
  ) {
    return (
      <div className="border-b border-[var(--border)] bg-[var(--surface2)] px-5 py-3 text-xs font-semibold leading-5 text-[var(--text-sub)] sm:px-6" role="status">
        <strong className="text-[var(--text)]">Telemetry evidence window unavailable.</strong>{' '}
        Telemetry-derived relationships stay withheld until the service supplies a verifiable window.
      </div>
    );
  }

  const evidenceDays = (sourceWindow.toTs - sourceWindow.fromTs) / 86_400;
  const intervalMinutes = sourceWindow.intervalSeconds / 60;
  const stabilityDays = document.thresholds.minimumNewEvidenceDaysBetweenStableRuns;
  const cadenceSeconds = document.reconstruction?.cadenceSeconds;
  const consecutiveStableRuns = document.evidence?.consecutiveStableRuns;
  const stableRunsRequired = document.evidence?.stableRunsRequired;
  return (
    <div className="border-b border-[var(--border)] bg-[var(--primary-soft)] px-5 py-3 text-xs font-semibold leading-5 text-[var(--text)] sm:px-6" role="status">
      <strong>Evidence window requested:</strong>{' '}
      {formatNumber(evidenceDays)} days, from {formatDateTime(fromDate.toISOString())} to {formatDateTime(toDate.toISOString())}, at {formatNumber(intervalMinutes)}-minute intervals.
      {typeof cadenceSeconds === 'number' && Number.isFinite(cadenceSeconds) && cadenceSeconds > 0
        ? ` While running, the reconstruction checks for updates every ${formatDuration(cadenceSeconds)}.`
        : ''}
      {typeof stabilityDays === 'number' && Number.isFinite(stabilityDays) && stabilityDays > 0
        ? ` A stability run is credited only after every selected relation gains at least ${formatNumber(stabilityDays)} new days of valid overlap.`
        : ''}
      {typeof consecutiveStableRuns === 'number'
        && Number.isInteger(consecutiveStableRuns)
        && consecutiveStableRuns >= 0
        && typeof stableRunsRequired === 'number'
        && Number.isInteger(stableRunsRequired)
        && stableRunsRequired > 0
        ? ` Current stability: ${formatNumber(consecutiveStableRuns)} of ${formatNumber(stableRunsRequired)} required checkpoints.`
        : ''}
      {' '}Window length alone never places a meter; every selected meter must supply valid telemetry.
    </div>
  );
}

function TopologyMap({
  document,
  presentation,
}: {
  document: TopologyBetaDocument;
  presentation: TopologyPresentation;
}) {
  const { forest, unplacedNodes, suppressedEdgeCount } = presentation;
  return (
    <Card className="min-w-0 !p-0">
      <div className="flex flex-col gap-3 border-b border-[var(--border)] px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-[var(--primary)]">Latest reconstruction</p>
          <h2 className="mt-1 text-xl font-extrabold tracking-[-0.025em] text-[var(--text)]">
            {document.location.name || document.location.locationId}
          </h2>
          <p className="mt-1 text-sm text-[var(--text-sub)]">
            {document.location.clientCode} · generated {formatDateTime(document.generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-[var(--primary-soft)] px-3 py-1.5 text-xs font-extrabold text-[var(--primary)]">
            {topologyDecisionLabel(document.decision)}
          </span>
          <span className="rounded-full border border-[var(--border)] bg-[var(--surface2)] px-3 py-1.5 text-xs font-bold text-[var(--text-sub)]">
            {document.reconstruction?.state || 'IDLE'}
          </span>
        </div>
      </div>

      <RootEvidenceNotice document={document} />
      <EvidenceWindowNotice document={document} />

      <div className="border-b border-[var(--border)] bg-[var(--surface2)] px-5 py-3 sm:px-6">
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-2 text-[var(--green)]"><i className="h-2.5 w-2.5 rounded-full bg-[var(--green)]" />Strong telemetry support</span>
          <span className="inline-flex items-center gap-2 text-[var(--primary)]"><i className="h-2.5 w-2.5 rounded-full bg-[var(--primary)]" />Reviewed site relation</span>
          <span className="inline-flex items-center gap-2 text-[var(--amber)]"><i className="h-2.5 w-2.5 rounded-full bg-[var(--amber)]" />Review or more data</span>
          <span className="inline-flex items-center gap-2 text-[var(--text-sub)]"><i className="h-2.5 w-2.5 rounded-full bg-[var(--muted)]" />Waiting for evidence</span>
        </div>
      </div>

      {suppressedEdgeCount > 0 ? (
        <div className="border-b border-[var(--amber)]/30 bg-[var(--amber-soft)] px-5 py-3 text-xs font-semibold leading-5 text-[var(--text)] sm:px-6" role="status">
          {formatNumber(suppressedEdgeCount)} {suppressedEdgeCount === 1 ? 'relation was' : 'relations were'} withheld because the current response does not contain enough usable evidence to display them safely.
        </div>
      ) : null}

      <div className="p-5 sm:p-6">
        <section aria-labelledby="topology-relationship-tree-title">
          <h3 id="topology-relationship-tree-title" className="text-sm font-extrabold text-[var(--text)]">Relationship tree</h3>
          <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">
            Parent meters sit above their children. Siblings share a row and each arrow points from parent to child.
          </p>
          <div className="mt-4">
            {forest.length ? (
              <TopologyTreeDiagram forest={forest} />
            ) : (
              <EmptyState
                icon="zap"
                title="Waiting for a usable relationship"
                description="No parent-child relationship is displayed until its evidence reaches the review floor."
              />
            )}
          </div>
        </section>

        {unplacedNodes.length > 0 ? (
          <section className="mt-6 border-t border-[var(--border)] pt-6" aria-labelledby="topology-unplaced-title">
            <h3 id="topology-unplaced-title" className="text-sm font-extrabold text-[var(--text)]">Unplaced / waiting for evidence</h3>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-[var(--text-sub)]">
              These meters remain selected but stay outside the tree until a safe parent relationship is available.
            </p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Meters waiting for relationship evidence">
              {unplacedNodes.map((node) => (
                <li key={node.meterId}><PendingMeterCard node={node} /></li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <div className="border-t border-[var(--border)] px-5 py-4 text-xs leading-5 text-[var(--text-sub)] sm:px-6">
        {document.disclaimer}
      </div>
    </Card>
  );
}

export default function TopologyBetaPage() {
  const { wwUser } = usePortalAuth();
  const queryClient = useQueryClient();
  const isAdmin = wwUser?.role === 'admin';
  const [siteSearch, setSiteSearch] = useState('');
  const [debouncedSiteSearch, setDebouncedSiteSearch] = useState('');
  const [selectedBusinessSite, setSelectedBusinessSite] = useState<FleetBusinessSiteSearchItem | null>(null);
  const [siteResultsOpen, setSiteResultsOpen] = useState(false);
  const [deviceText, setDeviceText] = useState('');
  const [activeLocationId, setActiveLocationId] = useState('');
  const [action, setAction] = useState<'start' | 'stop' | 'view' | null>(null);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSiteSearch(siteSearch.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [siteSearch]);

  const topologySitesQuery = useQuery({
    queryKey: ['wattwatchers', 'topology-beta', 'sites'],
    queryFn: listTopologyBetaSites,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const businessSitesQuery = useQuery({
    queryKey: ['wattwatchers', 'business-sites', 'search', debouncedSiteSearch],
    queryFn: () => searchBusinessSites(debouncedSiteSearch, 25),
    staleTime: 30_000,
  });
  const businessSiteResults = useMemo(() => (
    (businessSitesQuery.data?.data ?? []).filter((site) => (
      businessSiteMatchesQuery(site, debouncedSiteSearch)
    ))
  ), [businessSitesQuery.data?.data, debouncedSiteSearch]);
  const selectedBusinessSiteQuery = useQuery({
    queryKey: ['wattwatchers', 'business-sites', selectedBusinessSite?.id],
    queryFn: () => getBusinessSite(selectedBusinessSite!.id),
    enabled: Boolean(selectedBusinessSite),
    staleTime: 30_000,
  });
  const selectedSiteDeviceIds = useMemo(() => (
    selectedBusinessSiteQuery.data?.devices.map((device) => device.deviceId) ?? []
  ), [selectedBusinessSiteQuery.data?.devices]);
  const topologyQuery = useQuery({
    queryKey: ['wattwatchers', 'topology-beta', 'reconstruction', activeLocationId],
    queryFn: () => getTopologyReconstruction(activeLocationId),
    enabled: Boolean(activeLocationId),
    refetchInterval: (query) => (
      query.state.data?.reconstruction?.state === 'RUNNING' ? 15_000 : false
    ),
  });
  const document = topologyQuery.data;
  const topologyPresentation = useMemo(
    () => (document ? buildTopologyPresentation(document) : null),
    [document],
  );
  const deviceIds = useMemo(() => parseTopologyDeviceIds(deviceText), [deviceText]);
  const reconstructionDeviceIds = useMemo(() => (
    [...new Set([...selectedSiteDeviceIds, ...deviceIds])]
  ), [deviceIds, selectedSiteDeviceIds]);
  const requestError = topologyQuery.error
    ?? topologySitesQuery.error
    ?? businessSitesQuery.error
    ?? selectedBusinessSiteQuery.error;

  async function viewLatest() {
    setLocalError('');
    if (!selectedBusinessSite) {
      setLocalError('Choose a site from the global search results.');
      return;
    }
    if (reconstructionDeviceIds.length < 2) {
      setLocalError('This site needs at least two linked Fleet devices before a topology can be reconstructed.');
      return;
    }
    setAction('view');
    try {
      const result = await getTopologyBetaByDevices(reconstructionDeviceIds);
      const locationId = result.location.locationId;
      setActiveLocationId(locationId);
      queryClient.setQueryData(
        ['wattwatchers', 'topology-beta', 'reconstruction', locationId],
        result,
      );
    } catch (error) {
      setLocalError(fleetConnectionErrorMessage(error));
    } finally {
      setAction(null);
    }
  }

  async function start() {
    setLocalError('');
    if (siteSearch.trim() && !selectedBusinessSite) {
      setLocalError('Choose a site from the partial search results, or clear the site field and paste device IDs.');
      return;
    }
    if (reconstructionDeviceIds.length < 2) {
      setLocalError(selectedBusinessSite
        ? 'This site needs at least two linked Fleet devices. You can add exact device IDs below.'
        : 'Paste at least two device IDs when starting a new site reconstruction.');
      return;
    }
    setAction('start');
    try {
      const result = await startTopologyReconstruction({
        locationId: null,
        deviceIds: reconstructionDeviceIds,
      });
      const locationId = result.location.locationId;
      setActiveLocationId(locationId);
      queryClient.setQueryData(
        ['wattwatchers', 'topology-beta', 'reconstruction', locationId],
        result,
      );
      await topologySitesQuery.refetch();
    } catch (error) {
      setLocalError(fleetConnectionErrorMessage(error));
    } finally {
      setAction(null);
    }
  }

  async function stop() {
    if (!activeLocationId) return;
    setLocalError('');
    setAction('stop');
    try {
      await stopTopologyReconstruction(activeLocationId);
      await topologyQuery.refetch();
    } catch (error) {
      setLocalError(fleetConnectionErrorMessage(error));
    } finally {
      setAction(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Electrical Map"
        subtitle="Continuously reconstruct an observed-meter hierarchy. Telemetry-supported relations appear green, reviewed site evidence blue, and possible relations yellow."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-cyan-100 px-3 py-1.5 text-xs font-extrabold uppercase tracking-[0.1em] text-cyan-900">Beta</span>
            <Button
              variant="secondary"
              disabled={businessSitesQuery.isFetching || topologyQuery.isFetching}
              onClick={() => {
                void businessSitesQuery.refetch();
                void topologySitesQuery.refetch();
                if (activeLocationId) void topologyQuery.refetch();
              }}
            >
              <Icon name="refresh" size={17} />
              {businessSitesQuery.isFetching || topologyQuery.isFetching ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>
        )}
      />

      {localError || requestError ? (
        <div className="mb-5">
          <ErrorBanner message={localError || fleetConnectionErrorMessage(requestError)} />
        </div>
      ) : null}

      <div className="mb-5 rounded-[var(--radius-sm)] border border-cyan-300/60 bg-cyan-50 px-4 py-3.5 text-sm leading-6 text-cyan-950">
        <strong>Beta review surface.</strong> Yellow links are possible relationships, not published wiring claims. The reconstruction keeps collecting while running and updates this map automatically.
      </div>

      <section className="mb-5 grid gap-5 xl:grid-cols-[minmax(320px,0.72fr)_minmax(0,1.28fr)]">
        <Card className="h-fit">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--primary-soft)] text-[var(--primary)]"><Icon name="zap" size={21} /></span>
            <div>
              <h2 className="font-extrabold text-[var(--text)]">Choose meters to analyse</h2>
              <p className="text-xs text-[var(--text-sub)]">Search every existing Fleet site or paste exact device numbers.</p>
            </div>
          </div>

          <label htmlFor="topology-site" className="mt-6 block text-sm font-bold text-[var(--text)]">Search all existing sites</label>
          <div className="relative mt-2">
            <input
              id="topology-site"
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="topology-site-results"
              aria-expanded={siteResultsOpen && !selectedBusinessSite}
              value={siteSearch}
              onFocus={() => setSiteResultsOpen(true)}
              onBlur={() => setSiteResultsOpen(false)}
              onChange={(event) => {
                setSiteSearch(event.target.value);
                setSelectedBusinessSite(null);
                setSiteResultsOpen(true);
              }}
              placeholder={businessSitesQuery.isLoading ? 'Loading sites…' : 'Type any part of site, client, address or postcode…'}
              className="min-h-11 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
            />
            {siteResultsOpen && !selectedBusinessSite ? (
              <div
                id="topology-site-results"
                role="listbox"
                aria-label="Matching Fleet sites"
                className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] p-1.5 shadow-[var(--shadow-md)]"
              >
                {businessSitesQuery.isFetching ? (
                  <p className="px-3 py-3 text-sm text-[var(--text-sub)]">Searching all sites…</p>
                ) : businessSiteResults.length ? businessSiteResults.map((site) => (
                  <button
                    key={site.id}
                    type="button"
                    role="option"
                    aria-selected="false"
                    className="block w-full rounded-lg px-3 py-2.5 text-left hover:bg-[var(--surface2)] focus:bg-[var(--surface2)] focus:outline-none"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSelectedBusinessSite(site);
                      setSiteSearch(businessSiteSearchLabel(site));
                      setSiteResultsOpen(false);
                      setLocalError('');
                    }}
                  >
                    <span className="block font-bold text-[var(--text)]">{site.name}</span>
                    <span className="mt-0.5 block text-xs text-[var(--text-sub)]">{site.clientName}</span>
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">{site.address}</span>
                  </button>
                )) : (
                  <p className="px-3 py-3 text-sm text-[var(--text-sub)]">No existing Fleet sites match this partial search.</p>
                )}
              </div>
            ) : null}
          </div>
          {selectedBusinessSite ? (
            <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--primary)]/30 bg-[var(--primary-soft)] px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold text-[var(--text)]">{selectedBusinessSite.name}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-sub)]">{selectedBusinessSite.clientName} · {selectedBusinessSite.address}</p>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-xs font-bold text-[var(--primary)] hover:underline"
                  onClick={() => {
                    setSelectedBusinessSite(null);
                    setSiteSearch('');
                    setSiteResultsOpen(true);
                  }}
                >
                  Clear
                </button>
              </div>
              <p className="mt-2 text-xs font-semibold text-[var(--text-sub)]">
                {selectedBusinessSiteQuery.isFetching
                  ? 'Loading linked devices…'
                  : `${formatNumber(selectedSiteDeviceIds.length)} linked Fleet ${selectedSiteDeviceIds.length === 1 ? 'device' : 'devices'} selected.`}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-xs leading-5 text-[var(--text-sub)]">
              Results search globally across site name, customer, street address, suburb, state and postcode.
            </p>
          )}

          <div className="my-5 flex items-center gap-3 text-xs font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
            <span className="h-px flex-1 bg-[var(--border)]" />Or<span className="h-px flex-1 bg-[var(--border)]" />
          </div>

          <label htmlFor="topology-devices" className="block text-sm font-bold text-[var(--text)]">Device numbers</label>
          <textarea
            id="topology-devices"
            rows={7}
            value={deviceText}
            onChange={(event) => setDeviceText(event.target.value)}
            placeholder={'DDF3710…\nDD43710…\nDDF3710…'}
            className="mt-2 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2.5 font-mono text-sm text-[var(--text)] outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/20"
          />
          <p className="mt-2 text-xs leading-5 text-[var(--text-sub)]">
            {selectedBusinessSite
              ? `${formatNumber(reconstructionDeviceIds.length)} total unique device IDs will be analysed, including site-linked devices.`
              : deviceIds.length
                ? `${formatNumber(deviceIds.length)} unique device IDs selected.`
                : 'One device number per line. New lists are securely discovered under configured Fleet accounts.'}
          </p>

          <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            <Button
              variant="secondary"
              disabled={!selectedBusinessSite || selectedBusinessSiteQuery.isFetching || reconstructionDeviceIds.length < 2 || action !== null}
              onClick={() => void viewLatest()}
            >
              <Icon name="eye" size={17} />{action === 'view' ? 'Loading…' : 'View latest'}
            </Button>
            <Button
              disabled={!isAdmin || selectedBusinessSiteQuery.isFetching || action !== null}
              onClick={() => void start()}
            >
              <Icon name="activity" size={17} />{action === 'start' ? 'Starting…' : 'Start reconstruction'}
            </Button>
            <Button
              variant="danger"
              className="sm:col-span-2 xl:col-span-1 2xl:col-span-2"
              disabled={!isAdmin || !activeLocationId || action !== null || document?.reconstruction?.state !== 'RUNNING'}
              onClick={() => void stop()}
            >
              <Icon name="close" size={17} />{action === 'stop' ? 'Stopping…' : 'Stop reconstruction'}
            </Button>
          </div>
          {!isAdmin ? (
            <p className="mt-4 rounded-lg bg-[var(--surface2)] px-3 py-2.5 text-xs leading-5 text-[var(--text-sub)]">
              Viewer access can inspect maps. A Fleet administrator must start or stop data collection.
            </p>
          ) : null}
        </Card>

        <div className="min-w-0">
          {document && topologyPresentation ? (
            <>
              <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Topology evidence summary">
                <StatCard label="Selected meters" value={formatNumber(document.summary.selectedMeterCount)} icon="gauge" />
                <StatCard
                  label="Strong telemetry support"
                  value={formatNumber(topologyPresentation.displayedEdges.filter((edge) => (
                    edge.state === 'CONFIDENT' && !isReviewedTopologyEdge(edge)
                  )).length)}
                  icon="check"
                  tone="success"
                />
                <StatCard
                  label="Reviewed site relations"
                  value={formatNumber(topologyPresentation.displayedEdges.filter(isReviewedTopologyEdge).length)}
                  icon="eye"
                />
                <StatCard
                  label="Needs review"
                  value={formatNumber(topologyPresentation.displayedEdges.filter((edge) => (
                    edge.state === 'REVIEW' && !isReviewedTopologyEdge(edge)
                  )).length)}
                  icon="activity"
                  tone="warning"
                />
                <StatCard label="Waiting" value={formatNumber(topologyPresentation.unplacedNodes.length)} icon="cloud" />
              </section>
              <TopologyMap document={document} presentation={topologyPresentation} />
            </>
          ) : (
            <EmptyState
              icon="zap"
              title="Select a site or device list"
              description="View an existing site, or start a continuous reconstruction. Strong telemetry support appears first and review candidates join only after reaching the minimum evidence floor."
            />
          )}
        </div>
      </section>
    </div>
  );
}
