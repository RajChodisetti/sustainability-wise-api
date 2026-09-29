'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAuditTree, renewAuditEditLease } from '@/api/audits';
import {
  auditAuthorityState,
  auditLeaseRenewalDelay,
  auditPhotoMetadataGuard,
  auditWriteGuard,
  getAuditClientInstanceId,
  type AuditAuthorityState,
} from '@/lib/auditProtocol';
import type { AuditTree, AuditWriteGuard } from '@/types/domain';
import { useAuth } from '@/contexts/AuthContext';

export const AUDIT_REFRESH_INTERVAL_MS = 15_000;

export function useAuditAuthority(auditId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const clientInstanceId = useMemo(() => getAuditClientInstanceId(), []);
  const previousRevision = useRef<number | null>(null);
  const openedRevisionKey = useMemo(
    () => ['audit-opened-revision', auditId, clientInstanceId] as const,
    [auditId, clientInstanceId],
  );
  const treeQueryKey = useMemo(
    () => ['audit-tree', auditId, clientInstanceId] as const,
    [auditId, clientInstanceId],
  );
  const openedRevisionQuery = useQuery<number | null>({
    queryKey: openedRevisionKey,
    queryFn: async () => null,
    enabled: false,
    initialData: null,
    staleTime: Infinity,
    gcTime: 0,
  });

  const fetchAuditTree = useCallback(async () => {
    const tree = await getAuditTree(auditId!);
    const openedRevision = queryClient.getQueryData<number | null>(openedRevisionKey);
    if (openedRevision === null || openedRevision === undefined) {
      queryClient.setQueryData(openedRevisionKey, tree.audit.treeRevision);
      previousRevision.current = null;
    }
    return tree;
  }, [auditId, openedRevisionKey, queryClient]);

  const query = useQuery({
    queryKey: treeQueryKey,
    queryFn: fetchAuditTree,
    enabled: Boolean(auditId),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    refetchInterval: AUDIT_REFRESH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const audit = query.data?.audit;
  const authoritativeReady = Boolean(audit && query.isFetchedAfterMount);
  const openedRevision = openedRevisionQuery.data ?? null;
  const invalidateAuditChildren = useCallback(async (id: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['zones', id] }),
      queryClient.invalidateQueries({ queryKey: ['zone'] }),
      queryClient.invalidateQueries({ queryKey: ['audit-photos', id] }),
      queryClient.invalidateQueries({ queryKey: ['equipment'] }),
      queryClient.invalidateQueries({ queryKey: ['audits'] }),
    ]);
  }, [queryClient]);

  useEffect(() => {
    if (!audit || !query.isFetchedAfterMount) return;
    queryClient.setQueryData(['audit', audit.id], audit);
    const previous = previousRevision.current;
    previousRevision.current = audit.treeRevision;
    if (previous === null || previous === audit.treeRevision) return;
    void invalidateAuditChildren(audit.id);
  }, [audit, invalidateAuditChildren, query.isFetchedAfterMount, queryClient]);

  const changedSinceOpen = Boolean(
    authoritativeReady
    && openedRevision !== null
    && audit
    && audit.treeRevision !== openedRevision,
  );
  const state: AuditAuthorityState | null = useMemo(
    () => audit ? auditAuthorityState(audit, clientInstanceId) : null,
    [audit, clientInstanceId],
  );
  const guard: AuditWriteGuard | null = useMemo(() => {
    const currentGuard = audit ? auditWriteGuard(audit, clientInstanceId) : null;
    return currentGuard && openedRevision !== null && !changedSinceOpen
      ? { ...currentGuard, baseTreeRevision: openedRevision }
      : null;
  }, [audit, changedSinceOpen, clientInstanceId, openedRevision]);
  const photoMetadataGuard = useMemo(() => {
    const currentGuard = audit ? auditPhotoMetadataGuard(audit, user?.role, clientInstanceId) : null;
    return currentGuard && openedRevision !== null && !changedSinceOpen
      ? { ...currentGuard, baseTreeRevision: openedRevision }
      : null;
  }, [audit, changedSinceOpen, clientInstanceId, openedRevision, user?.role]);

  useEffect(() => {
    if (!auditId || !guard || !audit?.editLease) return;
    const delay = auditLeaseRenewalDelay(audit.editLease);
    if (delay === null) return;
    const timer = setTimeout(() => {
      void renewAuditEditLease(auditId, guard)
        .then((result) => {
          queryClient.setQueryData<AuditTree>(treeQueryKey, (current) => {
            if (
              !current
              || current.audit.treeRevision !== result.treeRevision
              || current.audit.editFence !== result.editFence
            ) return current;
            return {
              ...current,
              audit: { ...current.audit, editLease: result.editLease },
            };
          });
        })
        .catch(() => {
          void queryClient.invalidateQueries({ queryKey: treeQueryKey });
        });
    }, delay);
    return () => clearTimeout(timer);
  }, [audit?.editLease, auditId, guard, queryClient, treeQueryKey]);

  const refreshAndAccept = useCallback(async (): Promise<AuditTree | null> => {
    const result = await query.refetch();
    if (result.error || !result.data) return null;
    await invalidateAuditChildren(result.data.audit.id);
    queryClient.setQueryData(openedRevisionKey, result.data.audit.treeRevision);
    previousRevision.current = result.data.audit.treeRevision;
    return result.data;
  }, [invalidateAuditChildren, openedRevisionKey, query, queryClient]);

  const acceptRevision = useCallback((treeRevision: number) => {
    if (!auditId) return;
    queryClient.setQueryData(openedRevisionKey, treeRevision);
    queryClient.setQueryData<AuditTree>(
      treeQueryKey,
      (current) => current ? {
        ...current,
        treeRevision,
        audit: { ...current.audit, treeRevision },
      } : current,
    );
    previousRevision.current = treeRevision;
  }, [auditId, openedRevisionKey, queryClient, treeQueryKey]);

  return {
    query,
    audit,
    state,
    guard,
    photoMetadataGuard,
    clientInstanceId,
    authoritativeReady,
    openedRevision,
    changedSinceOpen,
    refreshAndAccept,
    acceptRevision,
  };
}
