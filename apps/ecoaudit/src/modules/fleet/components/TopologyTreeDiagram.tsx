import { Icon } from '@/components/ui/Icon';
import {
  isReviewedTopologyEdge,
  topologyNodeRoleDisplay,
  type TopologyTreeItem,
} from '@/modules/fleet/lib/topologyBeta';
import {
  buildTopologyTreeLayout,
  TOPOLOGY_TREE_NODE_HEIGHT,
  TOPOLOGY_TREE_NODE_WIDTH,
  type TopologyTreeLayoutNode,
} from '@/modules/fleet/lib/topologyTreeLayout';
import { formatNumber, formatPercent } from '@/modules/fleet/lib/format';
import type { TopologyBetaEdge } from '@/modules/fleet/types/domain';

function confidencePercent(value?: number | null) {
  return typeof value === 'number' ? formatPercent(value * 100, 0) : '—';
}

function relationshipTone(edge: TopologyBetaEdge) {
  if (isReviewedTopologyEdge(edge)) {
    return {
      border: 'border-[var(--primary)]',
      badge: 'bg-[var(--primary-soft)] text-[var(--primary)]',
      label: 'Reviewed relation',
      marker: 'topology-arrow-reviewed',
      stroke: 'var(--primary)',
    };
  }
  return edge.state === 'CONFIDENT'
    ? {
        border: 'border-[var(--green)]',
        badge: 'bg-[var(--green-soft)] text-[var(--green)]',
        label: 'Strong support',
        marker: 'topology-arrow-confident',
        stroke: 'var(--green)',
      }
    : {
        border: 'border-[var(--amber)]',
        badge: 'bg-[var(--amber-soft)] text-[var(--amber)]',
        label: 'Needs review',
        marker: 'topology-arrow-review',
        stroke: 'var(--amber)',
      };
}

function DiagramMeterCard({ layoutNode }: { layoutNode: TopologyTreeLayoutNode }) {
  const { item, parent, siblingCount, siblingIndex } = layoutNode;
  const role = topologyNodeRoleDisplay(item.node);
  const tone = item.incomingEdge ? relationshipTone(item.incomingEdge) : null;
  const parentLabel = parent?.label || parent?.meterId;
  const relationshipEvidence = item.incomingEdge
    ? isReviewedTopologyEdge(item.incomingEdge)
      ? 'Operator-reviewed site evidence'
      : `Top-K ${confidencePercent(item.incomingEdge.topKInclusionWeight)} · Bootstrap ${confidencePercent(item.incomingEdge.bootstrapStability)}${typeof item.incomingEdge.overlapSampleCount === 'number' ? ` · ${formatNumber(item.incomingEdge.overlapSampleCount)} samples` : ''}`
    : null;
  return (
    <article
      data-topology-node={item.node.meterId}
      className={`absolute overflow-hidden rounded-[var(--radius-sm)] border border-t-4 bg-[var(--surface)] px-3.5 py-3 shadow-[var(--shadow-sm)] ${tone?.border ?? 'border-[var(--primary)]'}`}
      style={{
        left: layoutNode.x,
        top: layoutNode.y,
        width: TOPOLOGY_TREE_NODE_WIDTH,
        height: TOPOLOGY_TREE_NODE_HEIGHT,
      }}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 text-[10px] font-extrabold uppercase tracking-[0.08em]">
        <span
          className={`min-w-0 truncate rounded-full px-2 py-1 ${tone?.badge ?? 'bg-[var(--primary-soft)] text-[var(--primary)]'}`}
          title={parentLabel ? `Child of ${parentLabel}` : 'Root meter'}
        >
          {parentLabel ? `Child of ${parentLabel}` : 'Root meter'}
        </span>
        {parent && siblingCount > 1 ? (
          <span className="shrink-0 text-[var(--muted)]">Sibling {siblingIndex + 1}/{siblingCount}</span>
        ) : null}
      </div>

      <div className="mt-3 flex min-w-0 items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface2)] text-[var(--primary)]">
          <Icon name="zap" size={18} />
        </span>
        <div className="min-w-0">
          <h4 className="truncate text-sm font-extrabold text-[var(--text)]" title={item.node.label || item.node.meterId}>
            {item.node.label || item.node.meterId}
          </h4>
          <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--text-sub)]" title={item.node.deviceId}>
            Device {item.node.deviceId}
          </p>
        </div>
      </div>

      <div className="mt-3 border-t border-[var(--border)] pt-2 text-[11px] leading-4 text-[var(--text-sub)]">
        <div className="flex items-center justify-between gap-2">
          <span>{item.children.length ? `Feeds ${item.children.length} ${item.children.length === 1 ? 'child' : 'children'}` : 'End branch'}</span>
          {tone ? <span className={`truncate rounded-full px-2 py-0.5 font-bold ${tone.badge}`}>{tone.label}</span> : null}
        </div>
        {role ? (
          <p className="mt-1 truncate" title={`${role.label}: ${role.value}`}>
            {role.label}: <span className="font-semibold text-[var(--text)]">{role.value}</span>
          </p>
        ) : null}
        {relationshipEvidence ? (
          <p className="mt-1 truncate text-[10px] text-[var(--muted)]" title={relationshipEvidence}>
            {relationshipEvidence}
          </p>
        ) : null}
      </div>
    </article>
  );
}

function AccessibleTreeBranch({
  item,
  parentLabel,
}: {
  item: TopologyTreeItem;
  parentLabel?: string;
}) {
  const label = item.node.label || item.node.meterId;
  return (
    <li>
      {label}. {parentLabel ? `Child of ${parentLabel}.` : 'Root meter.'}{' '}
      {item.children.length
        ? `Feeds ${item.children.length} ${item.children.length === 1 ? 'child' : 'children'}.`
        : 'End branch.'}
      {item.children.length ? (
        <ul>
          {item.children.map((child) => (
            <AccessibleTreeBranch key={child.node.meterId} item={child} parentLabel={label} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function TopologyTreeDiagram({ forest }: { forest: TopologyTreeItem[] }) {
  const layout = buildTopologyTreeLayout(forest);
  return (
    <>
      <div
        className="max-w-full overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface2)]"
        role="region"
        aria-label="Scrollable electrical relationship tree diagram"
      >
        <div
          aria-hidden="true"
          className="relative"
          style={{
            width: layout.width,
            height: layout.height,
            backgroundImage: 'radial-gradient(circle, var(--border) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        >
          <svg
            className="pointer-events-none absolute inset-0"
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
          >
            <defs>
              {[
                ['topology-arrow-reviewed', 'var(--primary)'],
                ['topology-arrow-confident', 'var(--green)'],
                ['topology-arrow-review', 'var(--amber)'],
              ].map(([id, color]) => (
                <marker key={id} id={id} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
                  <path d="M 0 0 L 0 8 L 8 4 z" fill={color} />
                </marker>
              ))}
            </defs>
            {layout.edges.map((layoutEdge) => {
              const tone = relationshipTone(layoutEdge.edge);
              return (
                <g key={`${layoutEdge.sourceMeterId}-${layoutEdge.targetMeterId}`}>
                  <path
                    d={layoutEdge.path}
                    fill="none"
                    stroke="var(--surface)"
                    strokeWidth="8"
                    strokeLinejoin="round"
                  />
                  <path
                    data-topology-connector={`${layoutEdge.sourceMeterId}->${layoutEdge.targetMeterId}`}
                    data-topology-relation={isReviewedTopologyEdge(layoutEdge.edge) ? 'reviewed' : layoutEdge.edge.state.toLocaleLowerCase()}
                    d={layoutEdge.path}
                    fill="none"
                    stroke={tone.stroke}
                    strokeWidth="3"
                    strokeDasharray={
                      !isReviewedTopologyEdge(layoutEdge.edge) && layoutEdge.edge.state === 'REVIEW'
                        ? '8 6'
                        : undefined
                    }
                    strokeLinejoin="round"
                    markerEnd={`url(#${tone.marker})`}
                  />
                </g>
              );
            })}
          </svg>
          {layout.nodes.map((layoutNode) => (
            <DiagramMeterCard key={layoutNode.item.node.meterId} layoutNode={layoutNode} />
          ))}
        </div>
      </div>

      <div className="sr-only">
        <h4>Electrical relationship tree</h4>
        <ul>
          {forest.map((item) => <AccessibleTreeBranch key={item.node.meterId} item={item} />)}
        </ul>
      </div>
    </>
  );
}
