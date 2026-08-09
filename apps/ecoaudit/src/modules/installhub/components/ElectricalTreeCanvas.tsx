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
  buildElectricalTreeLayout,
  electricalTreeNodeCardSummary,
  electricalTreeNodeContext,
  electricalTreeNodeContexts,
  electricalTreeOrthogonalPath,
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
  TBC: { label: 'TBC', className: 'bg-[var(--amber-soft)] text-[var(--amber)]' },
  INVALID: { label: 'Issue', className: 'bg-[var(--red-soft)] text-[var(--red)]' },
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

function meterModuleDetail(device: {
  name: string;
  serialNumber?: string;
  channelOrdinals: number[];
}): string {
  return [
    channelOrdinalLabel(device.channelOrdinals),
    device.serialNumber && device.serialNumber !== device.name ? device.serialNumber : '',
  ].filter(Boolean).join(' · ') || 'Installed';
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
      x: bounds.width / 2 - item.x - item.width / 2,
      y: bounds.height / 2 - item.y - item.height / 2,
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
        x: bounds.width / 2 - (item.x + item.width / 2) * scale,
        y: bounds.height / 2 - (item.y + item.height / 2) * scale,
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
    <div className="mt-4 min-w-0 space-y-3">
      <section className="min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]" aria-labelledby="electrical-tree-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-3">
          <div>
            <h3 id="electrical-tree-heading" className="text-sm font-extrabold text-[var(--text)]">{tree.installation.siteName} electrical single-line diagram</h3>
            <p id="electrical-tree-instructions" className="mt-0.5 text-xs text-[var(--text-sub)]">Select a symbol for exact records · drag to pan · Ctrl/⌘ + scroll or use controls to zoom</p>
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
          className={`relative h-[32rem] select-none overflow-hidden bg-[var(--surface)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)] sm:h-[36rem] xl:h-[40rem] ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{
            touchAction: touchPanEnabled ? 'none' : 'pan-y pinch-zoom',
            backgroundImage: 'linear-gradient(180deg, color-mix(in srgb, var(--surface2) 42%, transparent), transparent 28%)',
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
                return <path key={edge.id} d={electricalTreeOrthogonalPath(source, target)} fill="none" stroke="#B66A2C" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />;
              })}
              {layout.edges.filter((edge) => edge.relationship === 'DERIVED_FROM').map((edge) => {
                const source = layoutById.get(edge.sourceNodeId);
                const target = layoutById.get(edge.targetNodeId);
                if (!source || !target) return null;
                return <path key={edge.id} d={electricalTreeOrthogonalPath(source, target)} fill="none" stroke="var(--text-sub)" strokeWidth="2.25" strokeDasharray="2 7" strokeLinecap="round" strokeLinejoin="round" opacity="0.72" />;
              })}
              {layout.edges.filter((edge) => edge.relationship === 'MEASURES').map((edge) => {
                const source = layoutById.get(edge.sourceNodeId);
                const target = layoutById.get(edge.targetNodeId);
                if (!source || !target) return null;
                return <path key={edge.id} d={electricalTreeOrthogonalPath(source, target, { sourceYOffset: 13, targetYOffset: 13, trunkRatio: 0.58 })} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeDasharray="8 7" strokeLinecap="round" strokeLinejoin="round" opacity="0.88" />;
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
              const assignedAssetLabels = summary.assignedAssets.map((asset) => (
                `${asset.displayCode ? `${asset.displayCode} — ` : ''}${asset.name}`
              ));
              const ariaDetails = [
                `${primaryLabel}: ${primaryText}`,
                coverage ? `Coverage: ${coverage.label}` : '',
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
                  className={`absolute cursor-pointer overflow-hidden border p-3 text-left shadow-[var(--shadow-sm)] transition-[border-color,box-shadow,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--primary)] hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] ${item.node.kind === 'VIRTUAL_RESIDUAL' ? 'rounded-xl border-dashed' : 'rounded-2xl'} ${presentation.cardClassName} ${selected ? 'ring-2 ring-[var(--primary)] ring-offset-2 ring-offset-[var(--surface)]' : ''}`}
                  style={{
                    left: `${item.x}px`,
                    top: `${item.y}px`,
                    width: `${item.width}px`,
                    height: `${item.height}px`,
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
                  {item.node.kind === 'BOARD' ? (
                    <span className="flex h-full flex-col">
                      <span className="flex min-w-0 items-start gap-2.5">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${presentation.iconClassName}`}><Icon name="grid" size={21} /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-1">
                            <span className="truncate text-[9px] font-extrabold uppercase tracking-[0.11em] text-[var(--primary)]">{item.node.typeLabel || 'Switchboard'}</span>
                            {summary.assignedAssets.length ? <span className="shrink-0 rounded-full bg-[var(--surface)] px-1.5 py-0.5 text-[8px] font-extrabold text-[var(--text-sub)]">{summary.assignedAssets.length} measured asset{summary.assignedAssets.length === 1 ? '' : 's'}</span> : null}
                          </span>
                          <span className="mt-1 line-clamp-2 text-[13px] font-extrabold leading-4 text-[var(--text)]">{nodeTitle(item.node)}</span>
                        </span>
                      </span>
                      <span className="mt-3 grid min-h-0 flex-1 grid-cols-2 gap-1.5 border-t border-[var(--primary)]/20 pt-2" aria-hidden="true">
                        {summary.devices.length ? summary.devices.slice(0, 3).map((device) => (
                          <span key={device.id} className="flex min-w-0 items-center gap-1 rounded-lg border border-[var(--green)]/30 bg-[var(--green-soft)] px-1.5 py-1 text-[var(--green)]" title={`${device.name}${device.serialNumber ? ` · ${device.serialNumber}` : ''}${channelOrdinalLabel(device.channelOrdinals) ? ` · ${channelOrdinalLabel(device.channelOrdinals)}` : ''}`}>
                            <Icon name="gauge" size={13} className="shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[8px] font-extrabold text-[var(--text)]">{device.name}</span>
                              <span className="block truncate text-[7px] font-semibold text-[var(--green)]">{meterModuleDetail(device)}</span>
                            </span>
                          </span>
                        )) : (
                          <span className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--primary)]/25 bg-[var(--surface)]/75 px-2 text-[9px] font-bold text-[var(--text-sub)]"><Icon name="gauge" size={13} />No installed meter</span>
                        )}
                        {summary.devices.length > 3 ? <span className="flex items-center justify-center rounded-lg border border-[var(--primary)]/25 bg-[var(--surface)] px-1.5 text-[9px] font-extrabold text-[var(--primary)]">+{summary.devices.length - 3} meter{summary.devices.length - 3 === 1 ? '' : 's'}</span> : null}
                      </span>
                    </span>
                  ) : item.node.kind === 'SITE_ASSET' ? (
                    <span className="flex h-full flex-col items-center justify-center text-center">
                      {coverage ? <span className={`absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[7px] font-extrabold uppercase tracking-wide ${coverage.className}`} title={`Coverage: ${coverage.label}`}>{coverage.label}</span> : null}
                      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${presentation.iconClassName}`}><Icon name={nodeIcon(item.node)} size={24} /></span>
                      <span className="mt-2 max-w-full truncate text-[8px] font-extrabold uppercase tracking-[0.1em] text-[var(--green)]">{compactList(summary.loadLabels, 1) || item.node.typeLabel || 'Site asset'}</span>
                      <span className="mt-1 line-clamp-2 text-[11px] font-extrabold leading-[0.85rem] text-[var(--text)]">{item.node.name}</span>
                      {item.node.displayCode ? <span className="mt-1 max-w-full truncate text-[8px] font-semibold text-[var(--text-sub)]">{item.node.displayCode}</span> : null}
                    </span>
                  ) : item.node.kind === 'GRID' ? (
                    <span className="flex h-full flex-col items-center justify-center text-center">
                      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${presentation.iconClassName}`}><Icon name="zap" size={25} /></span>
                      <span className="mt-2 text-[8px] font-extrabold uppercase tracking-[0.12em] text-[var(--text-sub)]">Incoming grid</span>
                      <span className="mt-1 line-clamp-2 text-[11px] font-extrabold leading-[0.9rem] text-[var(--text)]">{item.node.name}</span>
                    </span>
                  ) : (
                    <span className="flex h-full items-center gap-2.5">
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${presentation.iconClassName}`}><Icon name="activity" size={20} /></span>
                      <span className="min-w-0">
                        <span className="block text-[8px] font-extrabold uppercase tracking-[0.1em] text-[var(--text-sub)]">Calculated residual</span>
                        <span className="mt-1 block line-clamp-2 text-[10px] font-extrabold leading-3 text-[var(--text)]">{item.node.displayCode || item.node.name}</span>
                        <span className="mt-1 block text-[8px] text-[var(--text-sub)]">Formula v{item.node.formulaVersion || '—'}</span>
                      </span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {viewport.scale < 0.28 ? <p className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]/95 px-3 py-2 text-xs font-bold text-[var(--text-sub)] shadow-[var(--shadow-sm)]">Overview mode · zoom in to read and select nodes</p> : null}
        </div>
        <div id="electrical-tree-key" className="border-t border-[var(--border)] bg-[var(--surface2)] px-4 py-4" aria-labelledby="electrical-tree-key-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 id="electrical-tree-key-heading" className="text-sm font-extrabold text-[var(--text)]">Diagram key</h4>
            <p className="text-[11px] text-[var(--text-sub)]">Confirmed topology only · select a symbol for the complete record</p>
          </div>
          <div className="mt-3 grid gap-4 lg:grid-cols-[0.8fr_1.5fr_1.2fr]">
            <section aria-labelledby="electrical-node-symbols-heading">
              <h5 id="electrical-node-symbols-heading" className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">Node symbols</h5>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-[11px] text-[var(--text-sub)]">
                {Object.entries(NODE_PRESENTATION).map(([kind, presentation]) => (
                  <li key={kind} className="flex items-center gap-2">
                    <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${presentation.iconClassName}`}><Icon name={presentation.icon} size={13} /></span>
                    <span className="font-bold text-[var(--text)]">{presentation.label}</span>
                  </li>
                ))}
                <li className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-[var(--green-soft)] text-[var(--green)]"><Icon name="gauge" size={13} /></span><span className="font-bold text-[var(--text)]">Installed meter</span></li>
              </ul>
            </section>

            <section aria-labelledby="electrical-load-symbols-heading">
              <h5 id="electrical-load-symbols-heading" className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">Load symbols</h5>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-[10px] leading-4 text-[var(--text-sub)]">
                {LOAD_ICON_LEGEND.map((item) => (
                  <li key={item.label} className="flex items-center gap-1.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--green-soft)] text-[var(--green)]"><Icon name={item.icon} size={11} /></span>
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="electrical-lines-heading" className="space-y-3">
              <div>
                <h5 id="electrical-lines-heading" className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">Connections</h5>
                <ul className="mt-2 space-y-1.5 text-[10px] leading-4 text-[var(--text-sub)]">
                  <li className="flex items-center gap-2"><span className="h-0 w-9 shrink-0 border-t-[3px] border-[#B66A2C]" /><span><strong className="text-[var(--text)]">Supply</strong> · confirmed FED_FROM cable path</span></li>
                  <li className="flex items-center gap-2"><span className="h-0 w-9 shrink-0 border-t-[3px] border-dashed border-[var(--primary)]" /><span><strong className="text-[var(--text)]">Measures</strong> · confirmed channels; never changes supply</span></li>
                  <li className="flex items-center gap-2"><span className="h-0 w-9 shrink-0 border-t-2 border-dotted border-[var(--text-sub)]" /><span><strong className="text-[var(--text)]">Residual</strong> · calculation, not a physical cable</span></li>
                </ul>
              </div>
              <div aria-labelledby="electrical-status-heading">
                <h5 id="electrical-status-heading" className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">Coverage</h5>
                <ul className="mt-2 flex flex-wrap gap-1.5 text-[9px]">
                {Object.entries(COVERAGE_PRESENTATION).map(([state, status]) => (
                  <li key={state}><span className={`inline-flex rounded-full px-2 py-0.5 font-extrabold uppercase tracking-wide ${status.className}`} title={state === 'DIRECT' ? 'Confirmed direct meter assignment' : state === 'VIRTUAL' ? 'Covered through a calculated residual' : state === 'UNMETERED' ? 'Confirmed without direct metering' : 'Residual load not assigned to an asset'}>{status.label}</span></li>
                ))}
                </ul>
              </div>
            </section>
          </div>
          <p className="mt-3 border-t border-[var(--border)] pt-3 text-[10px] leading-4 text-[var(--text-sub)]"><strong className="text-[var(--text)]">Navigate:</strong> select a symbol for details below; use arrow, Home, and End keys between symbols; drag or Touch pan to move; double-click to fit. To be confirmed relationships stay outside this confirmed diagram.</p>
        </div>
      </section>

      {selectedNode && selectedContext ? (
        <aside id="electrical-node-details-panel" aria-labelledby="electrical-node-details-heading" className="mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-xs)]">
          <p className="sr-only" aria-live="polite" aria-atomic="true">Selected {NODE_PRESENTATION[selectedNode.kind].label}: {nodeTitle(selectedNode)}.</p>
          <div className="border-b border-[var(--border)] bg-[var(--surface2)] p-4">
            <span className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--text-sub)]">
              <Icon name={NODE_PRESENTATION[selectedNode.kind].icon} size={15} />
              {NODE_PRESENTATION[selectedNode.kind].label}
            </span>
            <h3 id="electrical-node-details-heading" className="mt-2 break-words text-lg font-extrabold leading-6 text-[var(--text)]">{nodeTitle(selectedNode)}</h3>
            {selectedNode.typeLabel ? <p className="mt-1 text-xs font-semibold text-[var(--text-sub)]">{selectedNode.typeLabel}</p> : null}
          </div>
          <div className="max-h-[34rem] space-y-4 overflow-y-auto p-4">
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
                                <p className="mt-0.5 text-[11px] text-[var(--text-sub)]">{channel.purpose.replaceAll('_', ' ').toLowerCase()} · {channel.customLoadTypeName || channel.loadTypeCode || 'No load type'} · {channel.sensorRating || 'No sensor rating'}{channel.description?.trim() ? ` · ${channel.description.trim()}` : ''}</p>
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
