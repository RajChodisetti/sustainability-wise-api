'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getInstallationTree,
  listInstallationTrees,
  saveInstallationTree,
} from '@/modules/installhub/api/installhub';
import { cloneTree, touchTree } from '@/modules/installhub/lib/model';
import type { InstallationTree } from '@/modules/installhub/types/domain';

export const installationTreesKey = ['installhub', 'installations'] as const;
export const INSTALLHUB_TREES_QUERY_KEY = installationTreesKey;
export const installationTreeKey = (installationId: string) =>
  ['installhub', 'installation', installationId] as const;

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

export function useTreeWriter(installationId: string) {
  const queryClient = useQueryClient();

  async function refresh(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: installationTreeKey(installationId) }),
      queryClient.invalidateQueries({ queryKey: installationTreesKey }),
    ]);
  }

  async function replace(
    tree: InstallationTree,
    syncStage: 'metadata' | 'complete' = 'complete',
  ): Promise<InstallationTree> {
    touchTree(tree);
    await saveInstallationTree(tree, syncStage);
    queryClient.setQueryData(installationTreeKey(installationId), tree);
    await queryClient.invalidateQueries({ queryKey: installationTreesKey });
    return tree;
  }

  async function mutate(
    mutator: (tree: InstallationTree) => void | Promise<void>,
    syncStage: 'metadata' | 'complete' = 'complete',
  ): Promise<InstallationTree> {
    const fresh = await getInstallationTree(installationId);
    const next = cloneTree(fresh);
    await mutator(next);
    return replace(next, syncStage);
  }

  return { mutate, replace, refresh };
}

export const useInstallHubTreeActions = useTreeWriter;
