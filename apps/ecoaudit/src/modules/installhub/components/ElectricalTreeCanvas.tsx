'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Button, LinkButton } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import type {
  ElectricalTreeReadModel,
  InstallationTree,
  MeterDevice,
} from '@/modules/installhub/types/domain';
import {
  meterDeviceName,
  meterDevices,
} from '@/modules/installhub/lib/workflow';
import {
  ELECTRICAL_TREE_NODE_HEIGHT,
  ELECTRICAL_TREE_NODE_WIDTH,
  buildElectricalTreeLayout,
  electricalTreeNodeCardSummary,
  electricalTreeNodeContext,
  electricalTreeNodeContexts,
  fitElectricalTreeViewport,
  resolvedElectricalMeasurementDetails,
  zoomElectricalTreeViewport,
  type ElectricalTreeViewport,
} from '@/modules/installhub/lib/electricalTreeLayout';

type ElectricalNode = ElectricalTreeReadModel['nodes'][number];

type ElectricalTreeCanvasProps = {
  tree: InstallationTree;
  model: ElectricalTreeReadModel;
  visibleNodeIds?: Set<string>;
  getNodeHref: (node: ElectricalNode) => string;
  onRevealNode?: (nodeId: string) => void;
};

const NODE_PRESENTATION: Record<ElectricalNode['kind'], {
  label: string;
  icon: IconName;
  cardClassName: string;
  iconClassName: string;
}> = {
  GRID: {
    label: 'Incoming grid',
    icon: 'zap',
    cardClassName: 'border-[var(--border-strong)] bg-[var(--surface)]',
    iconClassName: 'bg-[var(--surface2)] text-[var(--text)]',
  },
  BOARD: {
    label: 'Switchboard',
    icon: 'grid',
    cardClassName: 'border-[var(--primary)]/35 bg-[var(--primary-soft)]',
    iconClassName: 'bg-[var(--primary)] text-[var(--primary-fg)]',
  },
  SITE_ASSET: {
    label: 'Site asset',
    icon: 'building',
    cardClassName: 'border-[var(--green)]/35 bg-[var(--green-soft)]',
    iconClassName: 'bg-[var(--green)] text-[var(--surface)]',
  },
  VIRTUAL_RESIDUAL: {
    label: 'Virtual residual',
    icon: 'activity',
    cardClassName: 'border-[var(--border-strong)] bg-[var(--surface2)]',
    iconClassName: 'bg-[var(--surface)] text-[var(--primary)]',
  },
};

const SITE_ASSET_ICON_RULES: Array<{ pattern: RegExp; icon: IconName }> = [
  { pattern: /HVAC|AIR\s*CON|REFRIG|CHILL|FREEZ|COOL/, icon: 'snowflake' },
  { pattern: /LIGHT/, icon: 'lightbulb' },
  { pattern: /SOLAR|\bPV\b/, icon: 'sun' },
  { pattern: /FORKLIFT|BATTER/, icon: 'battery' },
  { pattern: /EV|CHARG|OUTLET|PLUG/, icon: 'plug' },
  { pattern: /EXHAUST|FAN/, icon: 'activity' },
  { pattern: /HOIST/, icon: 'tool' },
  { pattern: /HOT\s*WATER|HEAT|GEYSER/, icon: 'droplet' },
  { pattern: /COMPRESS/, icon: 'gauge' },
];

const COVERAGE_PRESENTATION: Record<string, { label: string; className: string }> = {
  DIRECT: { label: 'Direct', className: 'bg-[var(--green-soft)] text-[var(--green)]' },
  VIRTUAL: { label: 'Virtual', className: 'bg-[var(--primary-soft)] text-[var(--primary)]' },
  UNMETERED: { label: 'Unmetered', className: 'bg-[var(--amber-soft)] text-[var(--amber)]' },
  UNALLOCATED: { label: 'Residual', className: 'bg-[var(--surface)] text-[var(--text-sub)]' },
};

const LOAD_ICON_LEGEND: Array<{ icon: IconName; label: string }> = [
  { icon: 'snowflake', label: 'HVAC and refrigeration' },
  { icon: 'lightbulb', label: 'Lighting' },
  { icon: 'sun', label: 'Solar / PV' },
  { icon: 'plug', label: 'EV charging and outlets' },
  { icon: 'battery', label: 'Forklifts and batteries' },
  { icon: 'activity', label: 'Exhaust and fans' },
  { icon: 'tool', label: 'Vehicle hoists' },
  { icon: 'droplet', label: 'Hot water and heaters' },
  { icon: 'gauge', label: 'Compressed air' },
  { icon: 'building', label: 'Other site assets' },
];

function nodeTitle(node: ElectricalNode): string {
  return `${node.displayCode ? `${node.displayCode} — ` : ''}${node.name}`;
}

function nodeZone(tree: InstallationTree, node: ElectricalNode): string {
  return tree.zones.find((zone) => zone.id === node.physicalLocationId)?.zoneName || 'Site-wide / derived';
}

function meterRecordHref(tree: InstallationTree, meter: MeterDevice): string | null {
  const board = tree.electricalAssets.find((candidate) => candidate.id === meter.installedOnBoardId);
  if (!board) return null;
  const base = `/installhub/installations/${encodeURIComponent(tree.installation.id)}`;
  return `${base}/zones/${encodeURIComponent(board.zoneId)}/boards/${encodeURIComponent(board.id)}/meters/${encodeURIComponent(meter.id)}`;
}

function meterIdentity(meter: MeterDevice): string {
  const identifiers = [
    meter.deviceNumber ? `Device ${meter.deviceNumber}` : '',
    meter.serialNumber ? `Serial ${meter.serialNumber}` : '',
  ].filter(Boolean);
  return [meter.deviceModel, ...identifiers].join(' · ');
}

function nodeIcon(node: ElectricalNode): IconName {
  if (node.kind !== 'SITE_ASSET') return NODE_PRESENTATION[node.kind].icon;
  const searchable = `${node.typeLabel || ''} ${node.name}`.toUpperCase();
  return SITE_ASSET_ICON_RULES.find((rule) => rule.pattern.test(searchable))?.icon || 'building';
}

function compactList(items: string[], limit = 1): string {
  if (!items.length) return '';
  const visible = items.slice(0, limit).join(', ');
  return items.length > limit ? `${visible} +${items.length - limit}` : visible;
}

function channelOrdinalLabel(ordinals: number[]): string {
  if (!ordinals.length) return '';
  const ranges: string[] = [];
  let start = ordinals[0];
  let end = ordinals[0];
  for (const ordinal of ordinals.slice(1)) {
    if (ordinal === end + 1) {
      end = ordinal;
      continue;
    }
    ranges.push(start === end ? `${start}` : `${start}–${end}`);
    start = ordinal;
    end = ordinal;
  }
  ranges.push(start === end ? `${start}` : `${start}–${end}`);
  return `Ch ${ranges.join(', ')}`;
}

export function ElectricalTreeCanvas({ tree, model, visibleNodeIds, getNodeHref, onRevealNode }: ElectricalTreeCanvasProps) {
  const visibleModel = useMemo(() => visibleNodeIds ? {
    ...model,
    nodes: model.nodes.filter((node) => visibleNodeIds.has(node.id)),
    edges: model.edges.filter((edge) => (
      visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId)
    )),
  } : model, [model, visibleNodeIds]);
  const layout = useMemo(() => buildElectricalTreeLayout(visibleModel), [visibleModel]);
  const completeLayout = useMemo(() => visibleNodeIds ? buildElectricalTreeLayout(model) : layout, [layout, model, visibleNodeIds]);
  const layoutById = useMemo(() => new Map(layout.nodes.map((item) => [item.node.id, item])), [layout.nodes]);
  const completeLayoutById = useMemo(() => new Map(completeLayout.nodes.map((item) => [item.node.id, item])), [completeLayout.nodes]);
  const contextById = useMemo(() => electricalTreeNodeContexts(completeLayout), [completeLayout]);
  const allMeters = useMemo(() => meterDevices(tree), [tree]);
  const cardSummaryById = useMemo(() => new Map(layout.nodes.map((item) => [
    item.node.id,
    electricalTreeNodeCardSummary(tree, model, item.node.id),
  ])), [layout.nodes, model, tree]);
  const [selectedNodeId, setSelectedNodeId] = useState(layout.nodes[0]?.node.id || '');
  const selectedLayoutNode = layoutById.get(selectedNodeId) || layout.nodes[0];
  const selectedNode = selectedLayoutNode?.node;
  const selectedContext = selectedNode
    ? contextById.get(selectedNode.id) || electricalTreeNodeContext(completeLayout, selectedNode.id)
    : null;
  const {
    containedMeters,
    downstreamAssets,
    downstreamBoards,
    measuredByNodes,
    selectedChildren,
    selectedDerivedChildren,
    selectedDerivedParent,
    selectedMeasurementDetails,
    selectedParent,
  } = useMemo(() => {
    const measurementDetails = selectedNode
      ? resolvedElectricalMeasurementDetails(tree, model, selectedNode.id)
      : [];
    const downstreamNodes = selectedContext?.descendantIds
      .map((nodeId) => completeLayoutById.get(nodeId)?.node)
      .filter((node): node is ElectricalNode => Boolean(node)) || [];
    const assets = selectedNode?.kind === 'SITE_ASSET'
      ? [selectedNode]
      : downstreamNodes.filter((node) => node.kind === 'SITE_ASSET');
    const boards = downstreamNodes.filter((node) => node.kind === 'BOARD');
    const boardIdsForMeters = new Set<string>([
      ...(selectedNode?.kind === 'BOARD' ? [selectedNode.id] : []),
      ...(selectedNode?.kind === 'GRID' ? boards.map((node) => node.id) : []),
    ]);
    return {
      containedMeters: selectedNode?.kind === 'SITE_ASSET'
        ? [...new Map(measurementDetails.map((detail) => [detail.meter.id, detail.meter])).values()]
        : allMeters.filter((meter) => boardIdsForMeters.has(meter.installedOnBoardId)),
      downstreamAssets: assets,
      downstreamBoards: boards,
      measuredByNodes: selectedContext?.measuredByIds
        .map((nodeId) => completeLayoutById.get(nodeId)?.node)
        .filter((node): node is ElectricalNode => Boolean(node)) || [],
      selectedChildren: selectedContext?.childIds
        .map((nodeId) => completeLayoutById.get(nodeId)?.node)
        .filter((node): node is ElectricalNode => Boolean(node)) || [],
      selectedDerivedChildren: selectedContext?.derivedChildIds
        .map((nodeId) => completeLayoutById.get(nodeId)?.node)
        .filter((node): node is ElectricalNode => Boolean(node)) || [],
      selectedDerivedParent: selectedContext?.derivedParentId ? completeLayoutById.get(selectedContext.derivedParentId)?.node : undefined,
      selectedMeasurementDetails: measurementDetails,
      selectedParent: selectedContext?.parentId ? completeLayoutById.get(selectedContext.parentId)?.node : undefined,
    };
  }, [allMeters, completeLayoutById, model, selectedContext, selectedNode, tree]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const nodeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pointerFocusRef = useRef(false);
  const didPanRef = useRef(false);
  const pendingRevealNodeIdRef = useRef<string | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const latestPanRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    scale: number;
  } | null>(null);
  const userAdjustedRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [touchPanEnabled, setTouchPanEnabled] = useState(false);
  const [viewport, setViewport] = useState<ElectricalTreeViewport>({ x: 32, y: 32, scale: 0.8 });
  const focusableNodeId = selectedNode && layoutById.has(selectedNode.id)
    ? selectedNode.id
    : layout.nodes[0]?.node.id;

  const fitView = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    setViewport(fitElectricalTreeViewport(bounds.width, bounds.height, layout.width, layout.height));
    userAdjustedRef.current = false;
  }, [layout.height, layout.width]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    userAdjustedRef.current = false;
    const frame = window.requestAnimationFrame(() => {
      if (!userAdjustedRef.current) fitView();
    });
    if (typeof ResizeObserver === 'undefined') return () => window.cancelAnimationFrame(frame);
    const observer = new ResizeObserver(() => {
      if (!userAdjustedRef.current) fitView();
    });
    observer.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [fitView, model.treeRevision]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    function handleNativeWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const bounds = element!.getBoundingClientRect();
      const anchorX = event.clientX - bounds.left;
      const anchorY = event.clientY - bounds.top;
      userAdjustedRef.current = true;
      setViewport((current) => zoomElectricalTreeViewport(
        current,
        current.scale * Math.exp(-event.deltaY * 0.0015),
        anchorX,
        anchorY,
      ));
    }
    element.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleNativeWheel);
  }, []);

  useEffect(() => () => {
    if (panFrameRef.current !== null) window.cancelAnimationFrame(panFrameRef.current);
  }, []);

  function zoomAtCenter(multiplier: number) {
    const element = viewportRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    userAdjustedRef.current = true;
    setViewport((current) => zoomElectricalTreeViewport(
      current,
      current.scale * multiplier,
      bounds.width / 2,
      bounds.height / 2,
    ));
  }

  function showAtActualSize() {
    const element = viewportRef.current;
    const item = (selectedNode && layoutById.get(selectedNode.id)) || layout.nodes[0];
    if (!element || !item) return;
    const bounds = element.getBoundingClientRect();
    userAdjustedRef.current = true;
    setViewport({
      scale: 1,
      x: bounds.width / 2 - item.x - ELECTRICAL_TREE_NODE_WIDTH / 2,
      y: bounds.height / 2 - item.y - ELECTRICAL_TREE_NODE_HEIGHT / 2,
    });
  }

  function revealNode(nodeId: string) {
    if (layoutById.has(nodeId)) {
      centerNode(nodeId);
      return;
    }
    pendingRevealNodeIdRef.current = nodeId;
    onRevealNode?.(nodeId);
    setSelectedNodeId(nodeId);
  }

  const centerNode = useCallback((nodeId: string, moveFocus = false) => {
    const element = viewportRef.current;
    const item = layoutById.get(nodeId);
    setSelectedNodeId(nodeId);
    if (!element || !item) return;
    const bounds = element.getBoundingClientRect();
    userAdjustedRef.current = true;
    setViewport((current) => {
      const scale = Math.max(current.scale, 0.55);
      return {
        scale,
        x: bounds.width / 2 - (item.x + ELECTRICAL_TREE_NODE_WIDTH / 2) * scale,
        y: bounds.height / 2 - (item.y + ELECTRICAL_TREE_NODE_HEIGHT / 2) * scale,
      };
    });
    if (moveFocus) window.requestAnimationFrame(() => nodeButtonRefs.current.get(nodeId)?.focus());
  }, [layoutById]);

  useEffect(() => {
    const nodeId = pendingRevealNodeIdRef.current;
    if (!nodeId || !layoutById.has(nodeId)) return;
    pendingRevealNodeIdRef.current = null;
    centerNode(nodeId);
  }, [centerNode, layoutById]);

  function handleNodeKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, nodeId: string, index: number) {
    const context = contextById.get(nodeId);
    const visibleChildren = [...(context?.childIds || []), ...(context?.derivedChildIds || [])]
      .filter((childId) => layoutById.has(childId));
    let nextNodeId: string | undefined;
    if (event.key === 'ArrowDown') nextNodeId = layout.nodes[Math.min(layout.nodes.length - 1, index + 1)]?.node.id;
    else if (event.key === 'ArrowUp') nextNodeId = layout.nodes[Math.max(0, index - 1)]?.node.id;
    else if (event.key === 'ArrowRight') nextNodeId = visibleChildren[0];
    else if (event.key === 'ArrowLeft') {
      const parentId = context?.parentId || context?.derivedParentId;
      if (parentId && layoutById.has(parentId)) nextNodeId = parentId;
    } else if (event.key === 'Home') nextNodeId = layout.nodes[0]?.node.id;
    else if (event.key === 'End') nextNodeId = layout.nodes[layout.nodes.length - 1]?.node.id;
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!nextNodeId || nextNodeId === nodeId) return;
    centerNode(nextNodeId, true);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (event.pointerType === 'touch' && !touchPanEnabled) return;
    didPanRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
      scale: viewport.scale,
    };
    userAdjustedRef.current = true;
    setDragging(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.startX) > 4 || Math.abs(event.clientY - drag.startY) > 4) {
      didPanRef.current = true;
    }
    pendingPanRef.current = {
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    };
    latestPanRef.current = pendingPanRef.current;
    if (panFrameRef.current !== null) return;
    panFrameRef.current = window.requestAnimationFrame(() => {
      const next = pendingPanRef.current;
      pendingPanRef.current = null;
      panFrameRef.current = null;
      if (next && contentRef.current) {
        contentRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${drag.scale})`;
      }
    });
  }

  function stopDragging(event: ReactPointerEvent<HTMLDivElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (panFrameRef.current !== null) {
      window.cancelAnimationFrame(panFrameRef.current);
      panFrameRef.current = null;
    }
    pendingPanRef.current = null;
    const next = latestPanRef.current;
    latestPanRef.current = null;
    if (next) setViewport((current) => ({ ...current, ...next }));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    window.setTimeout(() => { didPanRef.current = false; }, 0);
  }

  if (!layout.nodes.length) {
    return <p className="mt-4 text-sm text-[var(--text-sub)]">No resolved electrical nodes are available for the interactive tree.</p>;
  }

  return (
    <div className="mt-4 grid min-w-0 items-start gap-3 2xl:grid-cols-[minmax(0,1fr)_19rem]">
      <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface2)]" aria-labelledby="electrical-tree-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-3">
          <div>
            <h3 id="electrical-tree-heading" className="text-sm font-extrabold text-[var(--text)]">Interactive electrical tree</h3>
            <p id="electrical-tree-instructions" className="mt-0.5 text-xs text-[var(--text-sub)]">Drag the canvas to move (enable Touch pan on mobile) · Ctrl/⌘ + scroll or use controls to zoom · select a node for details</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Electrical tree zoom controls">
            <Button variant="secondary" className="min-h-11 w-11 px-0 text-lg" aria-label="Zoom out" onClick={() => zoomAtCenter(0.82)}>−</Button>
            <span className="min-w-14 text-center text-xs font-bold tabular-nums text-[var(--text-sub)]">{Math.round(viewport.scale * 100)}%</span>
            <Button variant="secondary" className="min-h-11 w-11 px-0 text-lg" aria-label="Zoom in" onClick={() => zoomAtCenter(1.22)}>+</Button>
            <Button variant="secondary" className="px-3" onClick={showAtActualSize}>100%</Button>
            <Button variant="secondary" className="px-3" onClick={fitView}><Icon name="refresh" size={15} />Fit overview</Button>
            <Button variant={touchPanEnabled ? 'primary' : 'secondary'} className="px-3" aria-pressed={touchPanEnabled} onClick={() => setTouchPanEnabled((current) => !current)}>Touch pan</Button>
          </div>
        </div>
        <div
          ref={viewportRef}
          role="tree"
          aria-label="Draggable resolved electrical tree"
          aria-describedby="electrical-tree-instructions"
          className={`relative h-[34rem] select-none overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)] sm:h-[38rem] xl:h-[42rem] ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{
            touchAction: touchPanEnabled ? 'none' : 'pan-y pinch-zoom',
            backgroundImage: 'radial-gradient(circle, var(--border-strong) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
          onDoubleClick={fitView}
          onPointerCancel={stopDragging}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
        >
          <div
            ref={contentRef}
            className="absolute left-0 top-0 motion-reduce:transition-none"
            style={{
              width: `${layout.width}px`,
              height: `${layout.height}px`,
              transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.scale})`,
              transformOrigin: '0 0',
            }}
          >
            <svg aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-visible" width={layout.width} height={layout.height}>
              {layout.edges.filter((edge) => edge.relationship === 'FED_FROM').map((edge) => {
                const source = layoutById.get(edge.sourceNodeId);
                const target = layoutById.get(edge.targetNodeId);
                if (!source || !target) return null;
                const sourceX = source.x + ELECTRICAL_TREE_NODE_WIDTH;
                const sourceY = source.y + ELECTRICAL_TREE_NODE_HEIGHT / 2;
                const targetX = target.x;
                const targetY = target.y + ELECTRICAL_TREE_NODE_HEIGHT / 2;
                const direction = targetX >= sourceX ? 1 : -1;
                const bend = Math.max(44, Math.abs(targetX - sourceX) * 0.45);
                return <path key={edge.id} d={`M ${sourceX} ${sourceY} C ${sourceX + bend * direction} ${sourceY}, ${targetX - bend * direction} ${targetY}, ${targetX} ${targetY}`} fill="none" stroke="var(--border-strong)" strokeWidth="2.5" strokeLinecap="round" />;
              })}
              {layout.edges.filter((edge) => edge.relationship === 'DERIVED_FROM').map((edge) => {
                const source = layoutById.get(edge.sourceNodeId);
                const target = layoutById.get(edge.targetNodeId);
                if (!source || !target) return null;
                const sourceX = source.x + ELECTRICAL_TREE_NODE_WIDTH;
                const sourceY = source.y + ELECTRICAL_TREE_NODE_HEIGHT / 2;
                const targetX = target.x;
                const targetY = target.y + ELECTRICAL_TREE_NODE_HEIGHT / 2;
                const direction = targetX >= sourceX ? 1 : -1;
                const bend = Math.max(44, Math.abs(targetX - sourceX) * 0.45);
                return <path key={edge.id} d={`M ${sourceX} ${sourceY} C ${sourceX + bend * direction} ${sourceY}, ${targetX - bend * direction} ${targetY}, ${targetX} ${targetY}`} fill="none" stroke="var(--text-sub)" strokeWidth="2" strokeDasharray="3 7" strokeLinecap="round" opacity="0.8" />;
              })}
              {layout.edges.filter((edge) => edge.relationship === 'MEASURES').map((edge) => {
                const source = layoutById.get(edge.sourceNodeId);
                const target = layoutById.get(edge.targetNodeId);
                if (!source || !target) return null;
                const sourceX = source.x + ELECTRICAL_TREE_NODE_WIDTH;
                const sourceY = source.y + ELECTRICAL_TREE_NODE_HEIGHT / 2 + 10;
                const targetX = target.x;
                const targetY = target.y + ELECTRICAL_TREE_NODE_HEIGHT / 2 + 10;
                const direction = targetX >= sourceX ? 1 : -1;
                const bend = Math.max(52, Math.abs(targetX - sourceX) * 0.52);
                return <path key={edge.id} d={`M ${sourceX} ${sourceY} C ${sourceX + bend * direction} ${sourceY}, ${targetX - bend * direction} ${targetY}, ${targetX} ${targetY}`} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeDasharray="7 7" strokeLinecap="round" opacity="0.85" />;
              })}
            </svg>
            {layout.nodes.map((item, index) => {
              const presentation = NODE_PRESENTATION[item.node.kind];
              const context = contextById.get(item.node.id);
              const summary = cardSummaryById.get(item.node.id) || { devices: [], loadLabels: [], assignedAssets: [] };
              const coverage = item.node.coverageState ? COVERAGE_PRESENTATION[item.node.coverageState] : undefined;
              const primaryLabel = item.node.kind === 'SITE_ASSET'
                ? 'Load'
                : item.node.typeLabel
                  ? 'Type'
                  : 'Location';
              const primaryText = item.node.kind === 'SITE_ASSET'
                ? compactList(summary.loadLabels, 2) || item.node.typeLabel || 'Site asset'
                : item.node.typeLabel || nodeZone(tree, item.node);
              const firstDevice = summary.devices[0];
              const firstDeviceChannels = firstDevice ? channelOrdinalLabel(firstDevice.channelOrdinals) : '';
              const deviceText = firstDevice
                ? `${firstDevice.name}${firstDevice.serialNumber && firstDevice.serialNumber !== firstDevice.name ? ` · ${firstDevice.serialNumber}` : ''}${firstDeviceChannels ? ` · ${firstDeviceChannels}` : ''}${summary.devices.length > 1 ? ` +${summary.devices.length - 1}` : ''}`
                : '';
              const assignedAssetLabels = summary.assignedAssets.map((asset) => (
                `${asset.displayCode ? `${asset.displayCode} — ` : ''}${asset.name}`
              ));
              const assignedAssetText = compactList(assignedAssetLabels);
              const ariaDetails = [
                `${primaryLabel}: ${primaryText}`,
                summary.devices.length ? `Devices: ${summary.devices.map((device) => `${device.name}${device.serialNumber && device.serialNumber !== device.name ? `, serial ${device.serialNumber}` : ''}${channelOrdinalLabel(device.channelOrdinals) ? `, ${channelOrdinalLabel(device.channelOrdinals)}` : ''}`).join('; ')}` : '',
                assignedAssetLabels.length ? `Measures assigned assets: ${assignedAssetLabels.join('; ')}` : '',
              ].filter(Boolean).join('. ');
              const selected = item.node.id === selectedNode?.id;
              return (
                <button
                  key={item.node.id}
                  ref={(element) => {
                    if (element) nodeButtonRefs.current.set(item.node.id, element);
                    else nodeButtonRefs.current.delete(item.node.id);
                  }}
                  type="button"
                  data-electrical-node-id={item.node.id}
                  className={`absolute cursor-pointer rounded-2xl border p-3 text-left shadow-[var(--shadow-sm)] transition-[border-color,box-shadow,background-color] duration-200 hover:border-[var(--primary)] hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface2)] ${presentation.cardClassName} ${selected ? 'ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--surface2)]' : ''}`}
                  style={{
                    left: `${item.x}px`,
                    top: `${item.y}px`,
                    width: `${ELECTRICAL_TREE_NODE_WIDTH}px`,
                    height: `${ELECTRICAL_TREE_NODE_HEIGHT}px`,
                  }}
                  aria-label={`Select ${presentation.label}: ${nodeTitle(item.node)}. ${ariaDetails}`}
                  aria-controls="electrical-node-details-panel"
                  aria-expanded={(context?.childIds.length || context?.derivedChildIds.length) ? true : undefined}
                  aria-level={item.depth + 1}
                  aria-selected={selected}
                  role="treeitem"
                  tabIndex={item.node.id === focusableNodeId ? 0 : -1}
                  onClick={(event) => {
                    if (didPanRef.current) {
                      event.preventDefault();
                      event.stopPropagation();
                      return;
                    }
                    event.stopPropagation();
                    pointerFocusRef.current = false;
                    setSelectedNodeId(item.node.id);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onFocus={() => {
                    setSelectedNodeId(item.node.id);
                    if (!pointerFocusRef.current) centerNode(item.node.id);
                  }}
                  onKeyDown={(event) => handleNodeKeyDown(event, item.node.id, index)}
                  onPointerCancel={() => { pointerFocusRef.current = false; }}
                  onPointerDown={(event) => {
                    pointerFocusRef.current = true;
                    if (!(touchPanEnabled && event.pointerType === 'touch')) event.stopPropagation();
                  }}
                  onPointerUp={() => { pointerFocusRef.current = false; }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--text-sub)]">{presentation.label}</span>
                    {coverage ? <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${coverage.className}`}>{coverage.label}</span> : null}
                  </span>
                  <span className="mt-1.5 flex min-w-0 items-start gap-2.5">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${presentation.iconClassName}`}><Icon name={nodeIcon(item.node)} size={17} /></span>
                    <span className="line-clamp-2 min-w-0 flex-1 text-sm font-extrabold leading-[1.15rem] text-[var(--text)]">{nodeTitle(item.node)}</span>
                  </span>
                  <span className="mt-2 block space-y-1 border-t border-[var(--border)]/70 pt-2 text-[10px] leading-3.5 text-[var(--text-sub)]">
                    <span className="flex min-w-0 items-center gap-1.5" title={`${primaryLabel}: ${primaryText}`}>
                      <Icon name={item.node.kind === 'SITE_ASSET' ? nodeIcon(item.node) : 'map-pin'} size={12} className="shrink-0" />
                      <span className="truncate"><strong className="text-[var(--text)]">{primaryLabel}</strong> · {primaryText}</span>
                    </span>
                    {deviceText ? (
                      <span className="flex min-w-0 items-center gap-1.5" title={`Device: ${summary.devices.map((device) => `${device.name}${device.serialNumber && device.serialNumber !== device.name ? ` · ${device.serialNumber}` : ''}`).join(', ')}`}>
                        <Icon name="gauge" size={12} className="shrink-0" />
                        <span className="truncate"><strong className="text-[var(--text)]">Device</strong> · {deviceText}</span>
                      </span>
                    ) : null}
                    {assignedAssetText ? (
                      <span className="flex min-w-0 items-center gap-1.5" title={`Measures: ${assignedAssetLabels.join(', ')}`}>
                        <Icon name="building" size={12} className="shrink-0" />
                        <span className="truncate"><strong className="text-[var(--text)]">Measures</strong> · {assignedAssetText}</span>
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
          {viewport.scale < 0.28 ? <p className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]/95 px-3 py-2 text-xs font-bold text-[var(--text-sub)] shadow-[var(--shadow-sm)]">Overview mode · zoom in to read and select nodes</p> : null}
        </div>
        <div id="electrical-tree-key" className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-4" aria-labelledby="electrical-tree-key-heading">
          <h4 id="electrical-tree-key-heading" className="text-sm font-extrabold text-[var(--text)]">Electrical map key</h4>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-[var(--text-sub)]">
            Card labels come from confirmed records: <strong className="text-[var(--text)]">Load</strong> identifies the asset or channel load, <strong className="text-[var(--text)]">Device</strong> names the installed meter and channels, and <strong className="text-[var(--text)]">Measures</strong> lists its confirmed assigned assets.
          </p>
          <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
            <section aria-labelledby="electrical-node-symbols-heading">
              <h5 id="electrical-node-symbols-heading" className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">Node symbols</h5>
              <ul className="mt-2 space-y-2 text-xs text-[var(--text-sub)]">
                {Object.entries(NODE_PRESENTATION).map(([kind, presentation]) => (
                  <li key={kind} className="flex items-center gap-2">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${presentation.iconClassName}`}><Icon name={presentation.icon} size={14} /></span>
                    <span><strong className="text-[var(--text)]">{presentation.label}</strong>{kind === 'VIRTUAL_RESIDUAL' ? ' · calculated, not a physical device' : ''}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="electrical-load-symbols-heading">
              <h5 id="electrical-load-symbols-heading" className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">Site asset / load symbols</h5>
              <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] leading-4 text-[var(--text-sub)]">
                {LOAD_ICON_LEGEND.map((item) => (
                  <li key={item.label} className="flex items-center gap-1.5">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--green-soft)] text-[var(--green)]"><Icon name={item.icon} size={13} /></span>
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="electrical-lines-heading">
              <h5 id="electrical-lines-heading" className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">Connections</h5>
              <ul className="mt-2 space-y-3 text-xs leading-4 text-[var(--text-sub)]">
                <li className="flex items-start gap-2"><span className="mt-2 h-0 w-9 shrink-0 border-t-[3px] border-[var(--border-strong)]" /><span><strong className="text-[var(--text)]">Supply</strong> · confirmed FED_FROM parent to child.</span></li>
                <li className="flex items-start gap-2"><span className="mt-2 h-0 w-9 shrink-0 border-t-2 border-dotted border-[var(--text-sub)]" /><span><strong className="text-[var(--text)]">Calculated residual</strong> · formula containment, not a cable.</span></li>
                <li className="flex items-start gap-2"><span className="mt-2 h-0 w-9 shrink-0 border-t-[3px] border-dashed border-[var(--primary)]" /><span><strong className="text-[var(--text)]">Measures</strong> · confirmed meter channels measure the target; this does not set its supply parent.</span></li>
              </ul>
            </section>

            <section aria-labelledby="electrical-status-heading">
              <h5 id="electrical-status-heading" className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">Coverage and selection</h5>
              <ul className="mt-2 space-y-2 text-xs leading-4 text-[var(--text-sub)]">
                {Object.entries(COVERAGE_PRESENTATION).map(([state, status]) => (
                  <li key={state} className="flex items-center gap-2"><span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${status.className}`}>{status.label}</span><span>{state === 'DIRECT' ? 'Confirmed direct meter assignment' : state === 'VIRTUAL' ? 'Covered through a calculated residual' : state === 'UNMETERED' ? 'Confirmed without direct metering' : 'Residual load not assigned to an asset'}</span></li>
                ))}
                <li className="flex items-center gap-2"><span className="h-6 w-6 shrink-0 rounded-lg border border-[var(--primary)] bg-[var(--surface)] ring-2 ring-[var(--primary)] ring-offset-1 ring-offset-[var(--surface)]" /><span><strong className="text-[var(--text)]">Selected</strong> · details appear beside the map.</span></li>
                <li className="flex items-start gap-2"><span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--amber-soft)] text-[var(--amber)]"><Icon name="eye" size={13} /></span><span><strong className="text-[var(--text)]">To be confirmed</strong> · excluded from this confirmed map and retained in the tray.</span></li>
              </ul>
            </section>
          </div>
          <section aria-labelledby="electrical-interactions-heading" className="mt-5 border-t border-[var(--border)] pt-4">
            <h5 id="electrical-interactions-heading" className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">Map interactions</h5>
            <ul className="mt-2 grid gap-2 text-xs leading-4 text-[var(--text-sub)] sm:grid-cols-2 xl:grid-cols-5">
              <li className="flex items-start gap-2"><Icon name="eye" size={14} className="mt-0.5 shrink-0 text-[var(--primary)]" /><span><strong className="text-[var(--text)]">Select</strong> a card for full branch, device, channel, and asset details.</span></li>
              <li className="flex items-start gap-2"><Icon name="arrow-right" size={14} className="mt-0.5 shrink-0 text-[var(--primary)]" /><span>Use <strong className="text-[var(--text)]">arrow, Home, and End keys</strong> to move between cards.</span></li>
              <li className="flex items-start gap-2"><Icon name="map-pin" size={14} className="mt-0.5 shrink-0 text-[var(--primary)]" /><span><strong className="text-[var(--text)]">Drag</strong> to pan; enable Touch pan before dragging on mobile.</span></li>
              <li className="flex items-start gap-2"><Icon name="plus" size={14} className="mt-0.5 shrink-0 text-[var(--primary)]" /><span><strong className="text-[var(--text)]">Zoom</strong> with the controls or Ctrl/⌘ + scroll.</span></li>
              <li className="flex items-start gap-2"><Icon name="refresh" size={14} className="mt-0.5 shrink-0 text-[var(--primary)]" /><span><strong className="text-[var(--text)]">Fit overview</strong> with the button or double-click the canvas.</span></li>
            </ul>
          </section>
        </div>
      </section>

      {selectedNode && selectedContext ? (
        <aside id="electrical-node-details-panel" aria-labelledby="electrical-node-details-heading" className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xs)] 2xl:sticky 2xl:top-4">
          <p className="sr-only" aria-live="polite" aria-atomic="true">Selected {NODE_PRESENTATION[selectedNode.kind].label}: {nodeTitle(selectedNode)}.</p>
          <div className="border-b border-[var(--border)] bg-[var(--surface2)] p-4">
            <span className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--text-sub)]">
              <Icon name={NODE_PRESENTATION[selectedNode.kind].icon} size={15} />
              {NODE_PRESENTATION[selectedNode.kind].label}
            </span>
            <h3 id="electrical-node-details-heading" className="mt-2 break-words text-lg font-extrabold leading-6 text-[var(--text)]">{nodeTitle(selectedNode)}</h3>
            {selectedNode.typeLabel ? <p className="mt-1 text-xs font-semibold text-[var(--text-sub)]">{selectedNode.typeLabel}</p> : null}
          </div>
          <div className="max-h-[39rem] space-y-4 overflow-y-auto p-4">
            <dl className="grid grid-cols-2 gap-2">
              {[
                ['Child branches', selectedChildren.length + selectedDerivedChildren.length],
                ['Assets in branch', downstreamAssets.length],
                ['Boards below', downstreamBoards.length],
                ['Meters', containedMeters.length],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-2.5">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">{label}</dt>
                  <dd className="mt-1 text-xl font-extrabold text-[var(--text)]">{value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Location and coverage</p>
              <p className="mt-1 text-sm font-bold text-[var(--text)]">{nodeZone(tree, selectedNode)}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--text-sub)]">{selectedNode.coverageState ? selectedNode.coverageState.replaceAll('_', ' ').toLowerCase() : 'No coverage state on this node'}</p>
            </div>

            {selectedDerivedParent ? (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Calculated residual of</p>
                <button type="button" className="mt-1 min-h-11 w-full cursor-pointer rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface2)] px-3 py-2 text-left text-xs font-bold text-[var(--primary)] transition-colors hover:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => revealNode(selectedDerivedParent.id)}>{nodeTitle(selectedDerivedParent)}</button>
                <p className="mt-1.5 text-xs leading-5 text-[var(--text-sub)]">Formula containment only · version {selectedNode.formulaVersion || 'not supplied'}</p>
              </div>
            ) : (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Supplied from</p>
                {selectedParent ? (
                  <button type="button" className="mt-1 min-h-11 w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-left text-xs font-bold text-[var(--primary)] transition-colors hover:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => revealNode(selectedParent.id)}>{nodeTitle(selectedParent)}</button>
                ) : <p className="mt-1 text-xs text-[var(--text-sub)]">Root of this confirmed tree</p>}
              </div>
            )}

            {selectedChildren.length ? (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Direct children</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {selectedChildren.map((child) => <button key={child.id} type="button" className="min-h-11 cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-2.5 py-2 text-left text-xs font-bold text-[var(--primary)] transition-colors hover:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => revealNode(child.id)}>{nodeTitle(child)}</button>)}
                </div>
              </div>
            ) : null}

            {selectedDerivedChildren.length ? (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Calculated residuals</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {selectedDerivedChildren.map((child) => <button key={child.id} type="button" className="min-h-11 cursor-pointer rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--surface2)] px-2.5 py-2 text-left text-xs font-bold text-[var(--primary)] transition-colors hover:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => revealNode(child.id)}>{nodeTitle(child)}</button>)}
                </div>
              </div>
            ) : null}

            {downstreamAssets.length ? (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">{selectedNode.kind === 'SITE_ASSET' ? 'Asset' : 'Downstream assets'}</p>
                <ul className="mt-1.5 space-y-1.5">
                  {downstreamAssets.slice(0, 8).map((asset) => (
                    <li key={asset.id}><button type="button" className="min-h-11 w-full cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--green-soft)] px-3 py-2 text-left text-xs font-bold text-[var(--text)] transition-colors hover:border-[var(--green)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => revealNode(asset.id)}>{nodeTitle(asset)}</button></li>
                  ))}
                </ul>
                {downstreamAssets.length > 8 ? <p className="mt-2 text-xs font-semibold text-[var(--text-sub)]">+ {downstreamAssets.length - 8} more assets in this branch</p> : null}
              </div>
            ) : null}

            {containedMeters.length ? (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">{selectedNode.kind === 'SITE_ASSET' ? 'Assigned meters' : 'Installed meters'}</p>
                <ul className="mt-1.5 space-y-2">
                  {containedMeters.map((meter) => {
                    const href = meterRecordHref(tree, meter);
                    const content = <><span className="block font-bold text-[var(--text)]">{meterDeviceName(meter)}</span><span className="mt-0.5 block text-[11px] text-[var(--text-sub)]">{meterIdentity(meter)} · {meter.channels.length} channel{meter.channels.length === 1 ? '' : 's'}</span><span className="mt-1 block break-all font-mono text-[10px] text-[var(--muted)]">{meter.id}</span></>;
                    return <li key={meter.id}>{href ? <Link href={href} className="block min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-xs transition-colors hover:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">{content}</Link> : <div className="rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-xs">{content}</div>}</li>;
                  })}
                </ul>
              </div>
            ) : null}

            {selectedMeasurementDetails.length ? (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Exact measurements</p>
                <ul className="mt-1.5 space-y-2">
                  {selectedMeasurementDetails.map(({ assignment, meter, channels }) => {
                    const meterHref = meterRecordHref(tree, meter);
                    return (
                      <li key={assignment.id} className="rounded-lg border border-[var(--primary)]/25 bg-[var(--primary-soft)] p-2.5 text-xs">
                        <p className="font-bold text-[var(--text)]">{meterDeviceName(meter)}</p>
                        <p className="mt-0.5 text-[11px] text-[var(--text-sub)]">{meterIdentity(meter)}</p>
                        <p className="mt-1 break-all font-mono text-[10px] text-[var(--muted)]">{meter.id}</p>
                        <ul className="mt-2 space-y-1.5">
                          {channels.map((channel) => {
                            const channelIndex = meter.channels.findIndex((candidate) => candidate.id === channel.id);
                            const channelLabel = `Channel ${channel.ordinal}${channel.phaseLabel ? ` · ${channel.phaseLabel}` : ''}`;
                            return (
                              <li key={channel.id} className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5">
                                <p className="font-bold text-[var(--text)]">{meterHref && channelIndex >= 0 ? <Link className="text-[var(--primary)] hover:underline" href={`${meterHref}#meter-channel-${channelIndex + 1}`}>{channelLabel}</Link> : channelLabel}</p>
                                <p className="mt-0.5 text-[11px] text-[var(--text-sub)]">{channel.purpose.replaceAll('_', ' ').toLowerCase()} · {channel.customLoadTypeName || channel.loadTypeCode || 'No load type'} · {channel.sensorRating || 'No sensor rating'}</p>
                                <p className="mt-0.5 break-all font-mono text-[10px] text-[var(--muted)]">{channel.id}</p>
                              </li>
                            );
                          })}
                        </ul>
                        <p className="mt-2 text-[var(--text-sub)]">{assignment.phaseMode.replaceAll('_', ' ').toLowerCase()} · {assignment.direction.toLowerCase()}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : measuredByNodes.length ? (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Measured from</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">{measuredByNodes.map((source) => <button key={source.id} type="button" className="min-h-11 cursor-pointer rounded-lg border border-[var(--primary)]/25 bg-[var(--primary-soft)] px-2.5 py-2 text-left text-xs font-bold text-[var(--primary)]" onClick={() => revealNode(source.id)}>{nodeTitle(source)}</button>)}</div>
              </div>
            ) : null}

            <div className="border-t border-[var(--border)] pt-4">
              <LinkButton href={getNodeHref(selectedNode)} className="w-full">Open full record<Icon name="arrow-right" size={16} /></LinkButton>
              <p className="mt-3 break-all font-mono text-[10px] leading-4 text-[var(--muted)]">{selectedNode.kind} · {selectedNode.id}</p>
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
