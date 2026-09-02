import type {
  TopologyBetaDocument,
  TopologyBetaEdge,
  TopologyBetaNode,
  TopologyBetaSite,
} from '@/modules/fleet/types/domain';

export type TopologyTreeItem = {
  node: TopologyBetaNode;
  incomingEdge: TopologyBetaEdge | null;
  children: TopologyTreeItem[];
};

export function parseTopologyDeviceIds(value: string): string[] {
  return [...new Set(
    value
      .split(/[\s,;]+/u)
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  )];
}

export function topologySiteLabel(site: TopologyBetaSite): string {
  return `${site.name} — ${site.clientCode} · ${site.meterCount} meter${site.meterCount === 1 ? '' : 's'}`;
}

export function buildTopologyForest(document: TopologyBetaDocument): TopologyTreeItem[] {
  const nodeById = new Map(document.nodes.map((node) => [node.meterId, node]));
  const childrenByParent = new Map<string, TopologyBetaEdge[]>();
  const incoming = new Set<string>();
  for (const edge of document.edges) {
    if (!nodeById.has(edge.parent) || !nodeById.has(edge.child)) continue;
    const children = childrenByParent.get(edge.parent) ?? [];
    children.push(edge);
    childrenByParent.set(edge.parent, children);
    incoming.add(edge.child);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.child.localeCompare(right.child));
  }

  const rootIds = [
    ...(document.location.rootMeterId && nodeById.has(document.location.rootMeterId)
      ? [document.location.rootMeterId]
      : []),
    ...document.nodes
      .map((node) => node.meterId)
      .filter((meterId) => meterId !== document.location.rootMeterId && !incoming.has(meterId))
      .sort((left, right) => left.localeCompare(right)),
  ];
  const visited = new Set<string>();

  function visit(
    meterId: string,
    incomingEdge: TopologyBetaEdge | null,
    ancestors: Set<string>,
  ): TopologyTreeItem | null {
    const node = nodeById.get(meterId);
    if (!node || visited.has(meterId) || ancestors.has(meterId)) return null;
    visited.add(meterId);
    const nextAncestors = new Set(ancestors).add(meterId);
    const children = (childrenByParent.get(meterId) ?? [])
      .map((edge) => visit(edge.child, edge, nextAncestors))
      .filter((item): item is TopologyTreeItem => item !== null);
    return { node, incomingEdge, children };
  }

  const forest = rootIds
    .map((meterId) => visit(meterId, null, new Set()))
    .filter((item): item is TopologyTreeItem => item !== null);
  for (const node of [...document.nodes].sort((left, right) => left.meterId.localeCompare(right.meterId))) {
    const item = visit(node.meterId, null, new Set());
    if (item) forest.push(item);
  }
  return forest;
}
