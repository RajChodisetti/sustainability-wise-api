'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_TREE_SYNC_STAGE,
  deleteInstallationMeter,
  getInstallationElectricalTree,
  getInstallationMapping,
  getInstallationReadiness,
  getInstallationTree,
  listInstallationTrees,
  saveInstallationTree,
  type MeterRemovalResult,
} from '@/modules/installhub/api/installhub';
import { cloneTree, touchTree } from '@/modules/installhub/lib/model';
import {
  applyAuthoritativeTreeRevision,
  ensureCanonicalTree,
  localElectricalTree,
  localMappingExport,
  localReadiness,
  measurementAssignments,
  meterDevices,
} from '@/modules/installhub/lib/workflow';
import { InstallHubApiError } from '@/modules/installhub/api/client';
import type { InstallationTree, ReadinessIssue } from '@/modules/installhub/types/domain';

export const installationTreesKey = ['installhub', 'installations'] as const;
export const INSTALLHUB_TREES_QUERY_KEY = installationTreesKey;
export const installationTreeKey = (installationId: string) =>
  ['installhub', 'installation', installationId] as const;
export const installationReadinessKey = (installationId: string) =>
  ['installhub', 'installation', installationId, 'readiness'] as const;
export const installationMappingKey = (installationId: string, version?: number) =>
  ['installhub', 'installation', installationId, 'mapping', version ?? 'latest'] as const;
export const installationElectricalTreeKey = (installationId: string, version?: number) =>
  ['installhub', 'installation', installationId, 'electrical-tree', version ?? 'latest'] as const;

export function useInstallationTrees() {
  return useQuery({ queryKey: installationTreesKey, queryFn: listInstallationTrees });
}

export function useInstallationTree(installationId: string | undefined) {
  return useQuery({
    queryKey: installationTreeKey(installationId ?? ''),
    queryFn: () => getInstallationTree(installationId!),
    enabled: Boolean(installationId),
  });
}

function canUseLocalProjection(error: unknown): boolean {
  return error instanceof InstallHubApiError && [404, 405, 501].includes(error.status);
}

export type InstallationReadinessQuery = {
  recordVersionNumber?: number;
  offset?: number;
  limit?: number;
  q?: string;
  severity?: 'ERROR' | 'WARNING';
  entityType?: string;
  zoneId?: string;
};

function readinessIssueZoneIds(tree: InstallationTree, issue: ReadinessIssue): Set<string> {
  const zoneIds = new Set<string>();
  const addZone = (zoneId: string | null | undefined) => {
    if (zoneId) zoneIds.add(zoneId);
  };
  if (issue.entityType === 'board') {
    addZone(tree.electricalAssets.find((item) => item.id === issue.entityId)?.zoneId);
    return zoneIds;
  }
  if (issue.entityType === 'site_asset') {
    addZone(tree.siteAssets.find((item) => item.id === issue.entityId)?.zoneId);
    return zoneIds;
  }
  if (issue.entityType === 'form') {
    addZone(tree.formSubmissions.find((item) => item.id === issue.entityId)?.zoneId);
    return zoneIds;
  }
  const devices = meterDevices(tree);
  const assignment = issue.entityType === 'measurement_assignment'
    ? measurementAssignments(tree).find((item) => item.id === issue.entityId)
    : null;
  const device = issue.entityType === 'meter'
    ? devices.find((item) => item.id === issue.entityId)
    : issue.entityType === 'channel'
      ? devices.find((item) => item.channels.some((channel) => channel.id === issue.entityId))
      : issue.entityType === 'measurement_assignment'
        ? devices.find((item) => item.id === assignment?.meterId)
        : null;
  addZone(tree.electricalAssets.find((item) => item.id === device?.installedOnBoardId)?.zoneId);
  if (assignment?.target.kind === 'BOARD') {
    const targetBoardId = assignment.target.boardId;
    addZone(tree.electricalAssets.find((item) => item.id === targetBoardId)?.zoneId);
  } else if (assignment?.target.kind === 'SITE_ASSET') {
    const targetSiteAssetId = assignment.target.siteAssetId;
    addZone(tree.siteAssets.find((item) => item.id === targetSiteAssetId)?.zoneId);
  }
  return zoneIds;
}

export function localReadinessPage(
  tree: InstallationTree,
  options: InstallationReadinessQuery = {},
) {
  const readiness = localReadiness(tree);
  const query = options.q?.trim().toLocaleLowerCase('en-AU') ?? '';
  const filtered = readiness.issues.filter((issue) => (
    (!query || `${issue.code} ${issue.message} ${issue.entityType} ${issue.entityId} ${issue.field ?? ''}`
      .toLocaleLowerCase('en-AU')
      .includes(query))
    && (!options.severity || issue.severity === options.severity)
    && (!options.entityType || issue.entityType === options.entityType)
    && (!options.zoneId || readinessIssueZoneIds(tree, issue).has(options.zoneId))
  ));
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 100), 250));
  const issues = filtered.slice(offset, offset + limit);
  return {
    ...readiness,
    issues,
    issuePage: {
      offset,
      limit,
      total: filtered.length,
      nextOffset: offset + issues.length < filtered.length
        ? offset + issues.length
        : null,
    },
  };
}

export function useInstallationReadiness(
  installationId: string | undefined,
  options: InstallationReadinessQuery = {},
) {
  const treeQuery = useInstallationTree(installationId);
  return useQuery({
    queryKey: [
      ...installationReadinessKey(installationId ?? ''),
      options.recordVersionNumber ?? 'latest',
      options.offset ?? 0,
      options.limit ?? 100,
      options.q?.trim() ?? '',
      options.severity ?? 'all-severities',
      options.entityType?.trim() ?? 'all-entities',
      options.zoneId?.trim() ?? 'all-zones',
    ],
    enabled: Boolean(installationId && treeQuery.data),
    queryFn: async () => {
      try {
        return await getInstallationReadiness(installationId!, options);
      } catch (error) {
        if (!canUseLocalProjection(error) || !treeQuery.data) throw error;
        return localReadinessPage(treeQuery.data, options);
      }
    },
  });
}

export function useInstallationMapping(
  installationId: string | undefined,
  recordVersionNumber?: number,
) {
  const treeQuery = useInstallationTree(installationId);
  return useQuery({
    queryKey: installationMappingKey(installationId ?? '', recordVersionNumber),
    enabled: Boolean(installationId && treeQuery.data),
    queryFn: async () => {
      try {
        return await getInstallationMapping(installationId!, recordVersionNumber);
      } catch (error) {
        if (!canUseLocalProjection(error) || !treeQuery.data) throw error;
        return localMappingExport(treeQuery.data);
      }
    },
  });
}

export function useInstallationElectricalTree(
  installationId: string | undefined,
  recordVersionNumber?: number,
) {
  const treeQuery = useInstallationTree(installationId);
  return useQuery({
    queryKey: installationElectricalTreeKey(installationId ?? '', recordVersionNumber),
    enabled: Boolean(installationId && treeQuery.data),
    queryFn: async () => {
      try {
        return await getInstallationElectricalTree(installationId!, recordVersionNumber);
      } catch (error) {
        if (!canUseLocalProjection(error) || !treeQuery.data) throw error;
        return localElectricalTree(treeQuery.data);
      }
    },
  });
}

export type TreeWritePhase = 'saved' | 'saving' | 'failed' | 'conflict';
export type TreeWriteState = {
  phase: TreeWritePhase;
  message: string;
  attemptedRevision?: number;
};

export type PendingInstallationDraft = {
  installationId: string;
  capturedAt: string;
  baseRevision: number;
  tree: InstallationTree;
};

export type InstallationDraftRecovery =
  | { kind: 'RESTORE'; tree: InstallationTree; draft: PendingInstallationDraft }
  | { kind: 'CONFLICT'; server: InstallationTree; draft: PendingInstallationDraft };

const TREE_DRAFT_KEY_PREFIX = 'installhub:pending-tree:v1:';

export function installationTreeDraftKey(installationId: string): string {
  return `${TREE_DRAFT_KEY_PREFIX}${installationId}`;
}

export function pendingInstallationDraft(
  installationId: string,
  tree: InstallationTree,
  capturedAt = new Date().toISOString(),
): PendingInstallationDraft {
  return {
    installationId,
    capturedAt,
    baseRevision: tree.baseTreeRevision ?? tree.treeRevision ?? 0,
    tree: pendingTreeWithoutMedia(tree),
  };
}

function volatilePendingInstallationDraft(
  installationId: string,
  tree: InstallationTree,
  capturedAt = new Date().toISOString(),
): PendingInstallationDraft {
  return {
    installationId,
    capturedAt,
    baseRevision: tree.baseTreeRevision ?? tree.treeRevision ?? 0,
    tree: cloneTree(tree),
  };
}

function storePendingTree(installationId: string, tree: InstallationTree): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(
      installationTreeDraftKey(installationId),
      JSON.stringify(pendingInstallationDraft(installationId, tree)),
    );
  } catch {
    // Saving to the API still works if browser storage is unavailable or full.
  }
}

export function pendingTreeWithoutMedia(tree: InstallationTree): InstallationTree {
  const nonMediaTree = cloneTree(tree);
  for (const zone of nonMediaTree.zones) zone.photos = [];
  for (const board of nonMediaTree.electricalAssets) {
    board.photo = null;
    board.extraPhotos = [];
    for (const meter of board.meters) meter.wwPhotos = undefined;
  }
  for (const asset of nonMediaTree.siteAssets) {
    asset.locationPhoto = null;
    asset.extraPhotos = [];
  }
  for (const form of nonMediaTree.formSubmissions) form.attachments = [];
  nonMediaTree.meterDevices = nonMediaTree.meterDevices?.map((meter) => ({ ...meter, wwPhotos: undefined }));
  return nonMediaTree;
}

export function shouldRestoreInstallationDraft(navigationType?: string): boolean {
  return navigationType === 'reload';
}

function isSameTabReload(): boolean {
  if (typeof window === 'undefined') return false;
  const navigation = window.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  if (navigation) return shouldRestoreInstallationDraft(navigation.type);
  return shouldRestoreInstallationDraft(
    (window.performance as Performance & { navigation?: { type?: number } }).navigation?.type === 1 ? 'reload' : undefined,
  );
}

export function mergeRecoveredNonMediaTree(server: InstallationTree, recovered: InstallationTree): InstallationTree {
  const recoveredBaseRevision = recovered.baseTreeRevision ?? recovered.treeRevision ?? 0;
  const serverRevision = server.treeRevision ?? 0;
  if (recoveredBaseRevision !== serverRevision) {
    throw new Error('A recovered draft cannot be merged over a newer server revision.');
  }
  const merged = ensureCanonicalTree(cloneTree(recovered));
  merged.treeRevision = server.treeRevision;
  merged.baseTreeRevision = recoveredBaseRevision;
  merged.recordVersionNumber = server.recordVersionNumber;
  const serverZones = new Map(server.zones.map((zone) => [zone.id, zone]));
  const serverBoards = new Map(server.electricalAssets.map((board) => [board.id, board]));
  const serverAssets = new Map(server.siteAssets.map((asset) => [asset.id, asset]));
  const serverForms = new Map(server.formSubmissions.map((form) => [form.id, form]));
  const serverDevices = new Map((server.meterDevices || []).map((meter) => [meter.id, meter]));
  for (const zone of merged.zones) zone.photos = serverZones.get(zone.id)?.photos || [];
  for (const board of merged.electricalAssets) {
    const serverBoard = serverBoards.get(board.id);
    board.photo = serverBoard?.photo || null;
    board.extraPhotos = serverBoard?.extraPhotos || [];
    const serverMeters = new Map(serverBoard?.meters.map((meter) => [meter.id, meter]) || []);
    board.meters = board.meters.map((meter) => ({ ...meter, wwPhotos: serverMeters.get(meter.id)?.wwPhotos }));
  }
  for (const asset of merged.siteAssets) {
    const serverAsset = serverAssets.get(asset.id);
    asset.locationPhoto = serverAsset?.locationPhoto || null;
    asset.extraPhotos = serverAsset?.extraPhotos || [];
  }
  for (const form of merged.formSubmissions) form.attachments = serverForms.get(form.id)?.attachments || [];
  merged.meterDevices = merged.meterDevices?.map((meter) => ({
    ...meter,
    wwPhotos: serverDevices.get(meter.id)?.wwPhotos || {},
  }));
  return merged;
}

export function planInstallationDraftRecovery(
  server: InstallationTree,
  draft: PendingInstallationDraft,
): InstallationDraftRecovery {
  const serverRevision = server.treeRevision ?? 0;
  if (serverRevision !== draft.baseRevision) {
    return { kind: 'CONFLICT', server: cloneTree(server), draft };
  }
  return {
    kind: 'RESTORE',
    tree: mergeRecoveredNonMediaTree(server, {
      ...draft.tree,
      baseTreeRevision: draft.baseRevision,
    }),
    draft,
  };
}

export function treeWriteFailurePhase(status?: number): Extract<TreeWritePhase, 'conflict' | 'failed'> {
  return status === 409 ? 'conflict' : 'failed';
}

type InstallationTreeWriteTransport = {
  save: typeof saveInstallationTree;
  get: typeof getInstallationTree;
};

export type InstallationTreeWriteOutcome =
  | { kind: 'CONFIRMED'; tree: InstallationTree }
  | { kind: 'SAVED_UNCONFIRMED'; tree: InstallationTree };

/**
 * Submits exactly once, then treats the follow-up pull as the authoritative result.
 * A failed confirmation pull is deliberately not surfaced as a failed submission so
 * Retry can refresh without duplicating a write that the server already accepted.
 */
export async function submitAndConfirmInstallationTree(
  installationId: string,
  next: InstallationTree,
  syncStage: 'metadata' | 'complete',
  transport: InstallationTreeWriteTransport = {
    save: saveInstallationTree,
    get: getInstallationTree,
  },
): Promise<InstallationTreeWriteOutcome> {
  const result = await transport.save(next, syncStage);
  if (result.treeRevision !== undefined) applyAuthoritativeTreeRevision(next, result.treeRevision);
  if (typeof result.recordVersionNumber === 'number') {
    next.recordVersionNumber = result.recordVersionNumber;
  } else if (typeof result.versionNumber === 'number') {
    next.recordVersionNumber = result.versionNumber;
  }
  try {
    return {
      kind: 'CONFIRMED',
      tree: await transport.get(installationId),
    };
  } catch {
    return { kind: 'SAVED_UNCONFIRMED', tree: next };
  }
}

type InstallationTreeRetryCallbacks = {
  refresh: () => Promise<void>;
  reviewConflict: (pendingDraft: PendingInstallationDraft) => Promise<void>;
  resubmitOriginal: (tree: InstallationTree) => Promise<InstallationTree>;
};

export async function executeInstallationTreeRetry(
  pendingDraft: PendingInstallationDraft | null,
  phase: TreeWritePhase,
  callbacks: InstallationTreeRetryCallbacks,
): Promise<InstallationTree | null> {
  if (!pendingDraft) {
    await callbacks.refresh();
    return null;
  }
  if (phase === 'conflict') {
    await callbacks.reviewConflict(pendingDraft);
    return null;
  }
  // A transient retry deliberately retains the original optimistic-lock precondition.
  return callbacks.resubmitOriginal({
    ...pendingDraft.tree,
    baseTreeRevision: pendingDraft.baseRevision,
  });
}

function adjustedGeneratedCodes(
  attempted: InstallationTree,
  confirmed: InstallationTree,
): string[] {
  const changes: string[] = [];
  const attemptedEntities = [...attempted.electricalAssets, ...attempted.siteAssets];
  const confirmedEntities = new Map(
    [...confirmed.electricalAssets, ...confirmed.siteAssets].map((entity) => [entity.id, entity]),
  );
  for (const entity of attemptedEntities) {
    const finalEntity = confirmedEntities.get(entity.id);
    if (
      finalEntity &&
      !entity.displayCodeMeta?.isOverridden &&
      entity.displayCodeMeta?.value !== finalEntity.displayCodeMeta?.value
    ) changes.push(finalEntity.displayCodeMeta?.value || finalEntity.displayCode || entity.id);
  }
  const confirmedMeters = new Map((confirmed.meterDevices || []).map((meter) => [meter.id, meter]));
  for (const meter of attempted.meterDevices || []) {
    const finalMeter = confirmedMeters.get(meter.id);
    if (finalMeter && !meter.displayName.isOverridden && meter.displayName.value !== finalMeter.displayName.value) {
      changes.push(finalMeter.displayName.value);
    }
  }
  return changes;
}

function clearPendingTree(installationId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(installationTreeDraftKey(installationId));
  } catch {
    // Ignore browser storage restrictions.
  }
}

function hasStoredPendingTree(installationId: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.sessionStorage.getItem(installationTreeDraftKey(installationId)));
  } catch {
    return false;
  }
}

function restorePendingTree(installationId: string): PendingInstallationDraft | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.sessionStorage.getItem(installationTreeDraftKey(installationId));
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<PendingInstallationDraft>;
    if (parsed.installationId !== installationId || parsed.tree?.installation.id !== installationId) {
      clearPendingTree(installationId);
      return null;
    }
    const tree = ensureCanonicalTree(parsed.tree);
    return {
      installationId,
      capturedAt: parsed.capturedAt || new Date(0).toISOString(),
      baseRevision: parsed.baseRevision ?? tree.baseTreeRevision ?? tree.treeRevision ?? 0,
      tree,
    };
  } catch {
    clearPendingTree(installationId);
    return null;
  }
}

export function useTreeWriter(installationId: string) {
  const queryClient = useQueryClient();
  const [writeState, setWriteState] = useState<TreeWriteState>({
    phase: 'saved',
    message: 'Saved to cloud',
  });
  const [hasPendingTree, setHasPendingTree] = useState(false);
  const pendingDraftRef = useRef<PendingInstallationDraft | null>(null);

  useEffect(() => {
    if (!installationId) return;
    if (!isSameTabReload()) {
      clearPendingTree(installationId);
      window.setTimeout(() => setHasPendingTree(false), 0);
      return;
    }
    const restoredDraft = restorePendingTree(installationId);
    if (!restoredDraft) return;
    pendingDraftRef.current = restoredDraft;
    window.setTimeout(() => setHasPendingTree(true), 0);
    void (async () => {
      try {
        await queryClient.cancelQueries({ queryKey: installationTreeKey(installationId) });
        const server = await getInstallationTree(installationId);
        const recovery = planInstallationDraftRecovery(server, restoredDraft);
        if (recovery.kind === 'RESTORE') {
          pendingDraftRef.current = volatilePendingInstallationDraft(
            installationId,
            recovery.tree,
            restoredDraft.capturedAt,
          );
          queryClient.setQueryData(installationTreeKey(installationId), recovery.tree);
          setWriteState({
            phase: 'failed',
            message: 'Recovered unsent non-file fields from this reload. Retry or discard them.',
            attemptedRevision: restoredDraft.baseRevision,
          });
        } else {
          queryClient.setQueryData(installationTreeKey(installationId), recovery.server);
          setWriteState({
            phase: 'conflict',
            message: 'A newer cloud revision exists. Your older tab draft is held separately and will not overwrite it. Review the latest values, then discard or re-enter only the fields you still need.',
            attemptedRevision: restoredDraft.baseRevision,
          });
        }
      } catch {
        setWriteState({
          phase: 'failed',
          message: 'Unsent non-file fields are held in this tab. Reconnect and retry recovery.',
          attemptedRevision: restoredDraft.baseRevision,
        });
      }
    })();
  }, [installationId, queryClient]);

  useEffect(() => {
    const hasPending = writeState.phase !== 'saved' && (
      Boolean(pendingDraftRef.current) || hasStoredPendingTree(installationId)
    );
    if (!hasPending) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [installationId, writeState]);

  const refresh = useCallback(async (): Promise<void> => {
    if (pendingDraftRef.current || hasStoredPendingTree(installationId)) {
      const latest = await getInstallationTree(installationId);
      queryClient.setQueryData(installationTreeKey(installationId), latest);
      setWriteState((current) => ({
        phase: 'conflict',
        message: 'Latest cloud values are loaded. The older unsent tab draft remains separate; discard it or re-enter only reviewed fields.',
        attemptedRevision: current.attemptedRevision ?? pendingDraftRef.current?.baseRevision,
      }));
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: installationTreeKey(installationId) }),
      queryClient.invalidateQueries({ queryKey: installationTreesKey }),
      queryClient.invalidateQueries({ queryKey: installationReadinessKey(installationId) }),
      queryClient.invalidateQueries({ queryKey: installationElectricalTreeKey(installationId) }),
      queryClient.invalidateQueries({ queryKey: installationMappingKey(installationId) }),
    ]);
    pendingDraftRef.current = null;
    setHasPendingTree(false);
    clearPendingTree(installationId);
    setWriteState({ phase: 'saved', message: 'Latest cloud revision loaded' });
  }, [installationId, queryClient]);

  const replace = useCallback(async (
    tree: InstallationTree,
    syncStage: 'metadata' | 'complete' = DEFAULT_TREE_SYNC_STAGE,
  ): Promise<InstallationTree> => {
    const next = ensureCanonicalTree(cloneTree(tree));
    touchTree(next);
    next.baseTreeRevision = next.treeRevision ?? next.baseTreeRevision ?? 0;
    pendingDraftRef.current = volatilePendingInstallationDraft(installationId, next);
    setHasPendingTree(true);
    storePendingTree(installationId, next);
    setWriteState({
      phase: 'saving',
      message: 'Saving to cloud…',
      attemptedRevision: next.baseTreeRevision,
    });
    try {
      const outcome = await submitAndConfirmInstallationTree(
        installationId,
        next,
        syncStage,
      );
      if (outcome.kind === 'SAVED_UNCONFIRMED') {
        pendingDraftRef.current = null;
        setHasPendingTree(false);
        clearPendingTree(installationId);
        queryClient.setQueryData(installationTreeKey(installationId), outcome.tree);
        setWriteState({
          phase: 'failed',
          message: 'Saved to cloud, but final generated codes could not be verified. Retry to refresh.',
        });
        return outcome.tree;
      }
      const confirmed = outcome.tree;
      const adjustedCodes = adjustedGeneratedCodes(next, confirmed);
      queryClient.setQueryData(installationTreeKey(installationId), confirmed);
      pendingDraftRef.current = null;
      setHasPendingTree(false);
      clearPendingTree(installationId);
      setWriteState({
        phase: 'saved',
        message: adjustedCodes.length
          ? `Saved to cloud · generated code adjusted to ${adjustedCodes.join(', ')}`
          : 'Saved to cloud',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: installationTreesKey }),
        queryClient.invalidateQueries({ queryKey: installationReadinessKey(installationId) }),
        queryClient.invalidateQueries({ queryKey: installationElectricalTreeKey(installationId) }),
        queryClient.invalidateQueries({ queryKey: installationMappingKey(installationId) }),
      ]);
      return confirmed;
    } catch (error) {
      const phase = treeWriteFailurePhase(error instanceof InstallHubApiError ? error.status : undefined);
      if (phase === 'conflict') {
        try {
          const latest = await getInstallationTree(installationId);
          queryClient.setQueryData(installationTreeKey(installationId), latest);
        } catch {
          // Keep the last confirmed query snapshot if the conflict refetch also fails.
        }
      }
      setWriteState({
        phase,
        message: phase === 'conflict'
          ? 'Conflict: a newer cloud revision exists. Your unsent draft is held separately and cannot be retried over the latest data. Review, discard, or re-enter only the fields you still need.'
          : 'Save failed. Your unsent fields are still on this screen.',
        attemptedRevision: next.baseTreeRevision,
      });
      throw error;
    }
  }, [installationId, queryClient]);

  const mutate = useCallback(async (
    mutator: (tree: InstallationTree) => void | Promise<void>,
    syncStage: 'metadata' | 'complete' = DEFAULT_TREE_SYNC_STAGE,
  ): Promise<InstallationTree> => {
    setWriteState({ phase: 'saving', message: 'Checking the latest cloud revision…' });
    try {
      const fresh = await getInstallationTree(installationId);
      const next = cloneTree(fresh);
      await mutator(next);
      return await replace(next, syncStage);
    } catch (error) {
      if (!(error instanceof InstallHubApiError && error.status === 409)) {
        setWriteState((current) => current.phase === 'conflict' ? current : {
          phase: 'failed',
          message: 'Save failed. Your unsent fields are still on this screen.',
        });
      }
      throw error;
    }
  }, [installationId, replace]);

  const removeMeter = useCallback(async (
    meterId: string,
    baseTreeRevision: number,
  ): Promise<MeterRemovalResult> => {
    setWriteState({
      phase: 'saving',
      message: 'Removing the active meter from the cloud record…',
      attemptedRevision: baseTreeRevision,
    });
    try {
      const result = await deleteInstallationMeter(
        installationId,
        meterId,
        { baseTreeRevision },
      );
      queryClient.setQueryData(installationTreeKey(installationId), result.tree);
      pendingDraftRef.current = null;
      setHasPendingTree(false);
      clearPendingTree(installationId);

      let confirmed: InstallationTree;
      try {
        confirmed = await getInstallationTree(installationId);
        queryClient.setQueryData(installationTreeKey(installationId), confirmed);
      } catch {
        setWriteState({
          phase: 'failed',
          message: 'Meter removed, but the final cloud state could not be reloaded. Retry to refresh; the removal will not be submitted again.',
        });
        return result;
      }

      setWriteState({
        phase: 'saved',
        message: 'Active meter removed and exact cloud state reloaded',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: installationTreesKey }),
        queryClient.invalidateQueries({ queryKey: installationReadinessKey(installationId) }),
        queryClient.invalidateQueries({ queryKey: installationElectricalTreeKey(installationId) }),
        queryClient.invalidateQueries({ queryKey: installationMappingKey(installationId) }),
      ]);
      return { ...result, tree: confirmed };
    } catch (error) {
      const phase = treeWriteFailurePhase(
        error instanceof InstallHubApiError ? error.status : undefined,
      );
      if (phase === 'conflict') {
        try {
          const latest = await getInstallationTree(installationId);
          queryClient.setQueryData(installationTreeKey(installationId), latest);
        } catch {
          // Keep the last confirmed query snapshot if the conflict refetch also fails.
        }
      }
      setWriteState({
        phase,
        message: phase === 'conflict'
          ? 'Meter removal was not applied because the cloud record changed or its lifecycle does not allow removal. Latest cloud values were requested.'
          : 'Meter removal could not be confirmed. Retry refreshes the cloud record without resubmitting the deletion.',
        attemptedRevision: baseTreeRevision,
      });
      throw error;
    }
  }, [installationId, queryClient]);

  const retry = useCallback(async (): Promise<InstallationTree | null> => {
    const pendingDraft = pendingDraftRef.current || restorePendingTree(installationId);
    return executeInstallationTreeRetry(
      pendingDraft,
      writeState.phase,
      {
        refresh,
        reviewConflict: async (draft) => {
          const latest = await getInstallationTree(installationId);
          queryClient.setQueryData(installationTreeKey(installationId), latest);
          setWriteState({
            phase: 'conflict',
            message: 'Latest cloud values are loaded. The older unsent draft remains separate and has not been submitted.',
            attemptedRevision: draft.baseRevision,
          });
        },
        resubmitOriginal: replace,
      },
    );
  }, [installationId, queryClient, refresh, replace, writeState.phase]);

  const discard = useCallback(async (): Promise<void> => {
    pendingDraftRef.current = null;
    setHasPendingTree(false);
    clearPendingTree(installationId);
    setWriteState({ phase: 'saved', message: 'Unsent fields discarded' });
    await queryClient.invalidateQueries({ queryKey: installationTreeKey(installationId) });
  }, [installationId, queryClient]);

  return useMemo(() => ({
    mutate,
    replace,
    removeMeter,
    refresh,
    retry,
    discard,
    writeState,
    hasPendingTree,
  }), [discard, hasPendingTree, mutate, refresh, removeMeter, replace, retry, writeState]);
}

export const useInstallHubTreeActions = useTreeWriter;
