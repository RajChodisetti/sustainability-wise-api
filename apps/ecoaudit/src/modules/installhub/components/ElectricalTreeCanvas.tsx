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
import { Icon } from '@/components/ui/Icon';
import { ElectricalMapSymbol } from '@/modules/installhub/components/ElectricalMapSymbol';
import { TreeDraftNavigationGuard } from '@/modules/installhub/components/WorkflowUi';
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
  ELECTRICAL_MAP_LOAD_SYMBOLS,
  ELECTRICAL_MAP_NODE_SYMBOLS,
  electricalMapSymbolForNode,
  electricalMapSymbolLabel,
} from '@/modules/installhub/lib/electricalMapSymbols';
import { electricalMapNodeInteractionSummary } from '@/modules/installhub/lib/electricalMapInteraction';
import {
  applyElectricalTreeMapLayout,
  buildElectricalTreeLayout,
  electricalTreeMapLayoutDocument,
  electricalTreeMapLayoutDraft,
  electricalTreeMapLayoutsEqual,
  electricalTreeNodeCardSummary,
  electricalTreeNodeContext,
  electricalTreeNodeContexts,
  electricalTreePointerDelta,
  electricalTreePointerDragStarted,
  electricalTreeStraightPath,
  filterElectricalTreeLayout,
  fitElectricalTreeViewport,
  moveElectricalTreeMapLayoutNode,
  resolvedElectricalMeasurementDetails,
  zoomElectricalTreeViewport,
  type ElectricalMapLayoutDocument,
  type SavedElectricalMapLayout,
  type ElectricalTreeViewport,
} from '@/modules/installhub/lib/electricalTreeLayout';

type ElectricalNode = ElectricalTreeReadModel['nodes'][number];

type ElectricalTreeCanvasProps = {
  tree: InstallationTree;
  model: ElectricalTreeReadModel;
  visibleNodeIds?: Set<string>;
  getNodeHref: (node: ElectricalNode) => string;
  onRevealNode?: (nodeId: string) => void;
  onSaveLayout?: (layout: ElectricalMapLayoutDocument) => Promise<SavedElectricalMapLayout>;
  onLayoutDirtyChange?: (dirty: boolean) => void;
};

type LayoutWorkspace = {
  sourceKey: string;
  saved: ElectricalMapLayoutDocument;
  draft: ElectricalMapLayoutDocument;
  phase: 'saved' | 'dirty' | 'saving' | 'error';
  error: string;
};

type NodePointerDrag = {
  pointerId: number;
  nodeId: string;
  startClientX: number;
  startClientY: number;
  originCenterX: number;
  originCenterY: number;
  scale: number;
  started: boolean;
  element: HTMLButtonElement;
};

type KeyboardNodeDrag = {
  nodeId: string;
  originCenterX: number;
  originCenterY: number;
};

const NODE_DRAG_THRESHOLD_PX = 6;
const KEYBOARD_MOVE_STEP = 16;
const KEYBOARD_FINE_MOVE_STEP = 4;

const NODE_PRESENTATION: Record<ElectricalNode['kind'], {
  label: string;
  haloClassName: string;
  labelClassName: string;
}> = {
  GRID: {
    label: 'Incoming grid',
    haloClassName: 'border-[#D7A06A] bg-[#FFF9F2]',
    labelClassName: 'text-[#9A551D]',
  },
  BOARD: {
    label: 'Switchboard',
    haloClassName: 'border-[var(--primary)]/45 bg-[#F7FAFF]',
    labelClassName: 'text-[var(--primary)]',
  },
  SITE_ASSET: {
    label: 'Site asset',
    haloClassName: 'border-[var(--green)]/35 bg-[#FAFFFC]',
    labelClassName: 'text-[var(--green)]',
  },
  VIRTUAL_RESIDUAL: {
    label: 'Virtual residual',
    haloClassName: 'border-[var(--border-strong)] bg-[#F8FAFC]',
    labelClassName: 'text-[var(--text-sub)]',
  },
};

const COVERAGE_PRESENTATION: Record<string, { label: string; className: string }> = {
  DIRECT: { label: 'Direct', className: 'bg-[var(--green-soft)] text-[var(--green)]' },
  VIRTUAL: { label: 'Virtual', className: 'bg-[var(--primary-soft)] text-[var(--primary)]' },
  UNMETERED: { label: 'Unmetered', className: 'bg-[var(--amber-soft)] text-[var(--amber)]' },
  UNALLOCATED: { label: 'Residual', className: 'bg-[var(--surface)] text-[var(--text-sub)]' },
  TBC: { label: 'TBC', className: 'bg-[var(--amber-soft)] text-[var(--amber)]' },
  INVALID: { label: 'Issue', className: 'bg-[var(--red-soft)] text-[var(--red)]' },
};

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

function compactList(values: string[], limit = 2): string {
  if (values.length <= limit) return values.join(', ');
  return `${values.slice(0, limit).join(', ')} +${values.length - limit}`;
}

function electricalLayoutSourceKey(model: ElectricalTreeReadModel): string {
  const nodeSignature = model.nodes.map((node) => node.id).sort().join('|');
  const supplySignature = model.edges
    .filter((edge) => edge.relationship === 'FED_FROM')
    .map((edge) => `${edge.sourceNodeId}>${edge.targetNodeId}`)
    .sort()
    .join('|');
  return `${model.installationId}:${model.mapLayout?.layoutRevision || 0}:${nodeSignature}:${supplySignature}`;
}

function layoutWorkspace(
  sourceKey: string,
  automaticLayout: ReturnType<typeof buildElectricalTreeLayout>,
  savedLayout?: SavedElectricalMapLayout,
): LayoutWorkspace {
  const saved = savedLayout
    ? electricalTreeMapLayoutDraft(savedLayout)
    : electricalTreeMapLayoutDocument(automaticLayout);
  return { sourceKey, saved, draft: saved, phase: 'saved', error: '' };
}

function layoutNodeSetsEqual(
  left: ElectricalMapLayoutDocument,
  right: ElectricalMapLayoutDocument,
): boolean {
  if (left.nodes.length !== right.nodes.length) return false;
  const rightIds = new Set(right.nodes.map((node) => node.nodeId));
  return left.nodes.every((node) => rightIds.has(node.nodeId));
}

function reconcileLayoutWorkspace(
  current: LayoutWorkspace,
  incoming: LayoutWorkspace,
): LayoutWorkspace {
  if (current.sourceKey === incoming.sourceKey) return current;
  if (current.phase === 'saved' || !layoutNodeSetsEqual(current.draft, incoming.draft)) {
    return incoming;
  }
  return {
    sourceKey: incoming.sourceKey,
    saved: incoming.saved,
    draft: current.draft,
    phase: electricalTreeMapLayoutsEqual(current.draft, incoming.saved)
      ? 'saved'
      : current.phase,
    error: current.error,
  };
}

export function ElectricalTreeCanvas({
  tree,
  model,
  visibleNodeIds,
  getNodeHref,
  onRevealNode,
  onSaveLayout,
  onLayoutDirtyChange,
}: ElectricalTreeCanvasProps) {
  const automaticLayout = useMemo(() => buildElectricalTreeLayout(model), [model]);
  const sourceKey = useMemo(() => electricalLayoutSourceKey(model), [model]);
  const initialWorkspace = useMemo(() => (
    layoutWorkspace(sourceKey, automaticLayout, model.mapLayout)
  ), [automaticLayout, model.mapLayout, sourceKey]);
  const [workspaceState, setWorkspaceState] = useState<LayoutWorkspace>(initialWorkspace);
  const workspace = reconcileLayoutWorkspace(workspaceState, initialWorkspace);
  const completeLayout = useMemo(() => (
    applyElectricalTreeMapLayout(automaticLayout, workspace.draft)
  ), [automaticLayout, workspace.draft]);
  const layout = useMemo(() => (
    filterElectricalTreeLayout(completeLayout, visibleNodeIds)
  ), [completeLayout, visibleNodeIds]);
  const layoutById = useMemo(() => new Map(layout.nodes.map((item) => [item.node.id, item])), [layout.nodes]);
  const completeLayoutById = useMemo(() => new Map(completeLayout.nodes.map((item) => [item.node.id, item])), [completeLayout.nodes]);
  const contextById = useMemo(() => electricalTreeNodeContexts(completeLayout), [completeLayout]);
  const allMeters = useMemo(() => meterDevices(tree), [tree]);
  const mapSummary = useMemo(() => ({
    boards: layout.nodes.filter((item) => item.node.kind === 'BOARD').length,
    loads: layout.nodes.filter((item) => item.node.kind === 'SITE_ASSET').length,
    meters: allMeters.filter((meter) => (meter.lifecycleState ?? 'ACTIVE') === 'ACTIVE').length,
    activeChannels: allMeters
      .filter((meter) => (meter.lifecycleState ?? 'ACTIVE') === 'ACTIVE')
      .reduce((total, meter) => total + meter.channels.filter((channel) => channel.purpose !== 'SPARE').length, 0),
  }), [allMeters, layout.nodes]);
  const cardSummaryById = useMemo(() => new Map(layout.nodes.map((item) => [
    item.node.id,
    electricalTreeNodeCardSummary(tree, model, item.node.id),
  ])), [layout.nodes, model, tree]);
  const interactionSummaryById = useMemo(() => new Map(layout.nodes.map((item) => [
    item.node.id,
    electricalMapNodeInteractionSummary(tree, model, item.node.id),
  ])), [layout.nodes, model, tree]);
  const [selectedNodeId, setSelectedNodeId] = useState(layout.nodes[0]?.node.id || '');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const selectedLayoutNode = layoutById.get(selectedNodeId) || layout.nodes[0];
  const selectedNode = selectedLayoutNode?.node;
  const selectedContext = selectedNode
    ? contextById.get(selectedNode.id) || electricalTreeNodeContext(completeLayout, selectedNode.id)
    : null;
  const selectedInteraction = useMemo(() => (
    selectedNode
      ? interactionSummaryById.get(selectedNode.id)
        || electricalMapNodeInteractionSummary(tree, model, selectedNode.id)
      : electricalMapNodeInteractionSummary(tree, model, '')
  ), [interactionSummaryById, model, selectedNode, tree]);
  const tooltipNodeId = hoveredNodeId || focusedNodeId;
  const tooltipLayoutNode = tooltipNodeId ? layoutById.get(tooltipNodeId) : undefined;
  const tooltipInteraction = useMemo(() => (
    tooltipNodeId
      ? interactionSummaryById.get(tooltipNodeId)
        || electricalMapNodeInteractionSummary(tree, model, tooltipNodeId)
      : null
  ), [interactionSummaryById, model, tooltipNodeId, tree]);
  const {
    downstreamAssets,
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
    return {
      downstreamAssets: assets,
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
  }, [completeLayoutById, model, selectedContext, selectedNode, tree]);

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const detailsPanelRef = useRef<HTMLElement>(null);
  const nodeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const pointerFocusRef = useRef(false);
  const didPanRef = useRef(false);
  const pendingRevealNodeIdRef = useRef<string | null>(null);
  const panFrameRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const latestPanRef = useRef<{ x: number; y: number } | null>(null);
  const panDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    scale: number;
  } | null>(null);
  const nodeDragRef = useRef<NodePointerDrag | null>(null);
  const nodeDragFrameRef = useRef<number | null>(null);
  const pendingNodeCenterRef = useRef<{ nodeId: string; centerX: number; centerY: number } | null>(null);
  const suppressNodeClickRef = useRef<string | null>(null);
  const userAdjustedRef = useRef(false);
  const [panning, setPanning] = useState(false);
  const [arrangeMode, setArrangeMode] = useState(false);
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [keyboardDrag, setKeyboardDrag] = useState<KeyboardNodeDrag | null>(null);
  const [layoutAnnouncement, setLayoutAnnouncement] = useState('');
  const [touchPanEnabled, setTouchPanEnabled] = useState(false);
  const [viewport, setViewport] = useState<ElectricalTreeViewport>({ x: 32, y: 32, scale: 0.8 });
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const updateWorkspace = useCallback((
    updater: (current: LayoutWorkspace) => LayoutWorkspace,
  ) => {
    setWorkspaceState((current) => updater(reconcileLayoutWorkspace(current, initialWorkspace)));
  }, [initialWorkspace]);
  const arrangementAvailable = Boolean(onSaveLayout) && !visibleNodeIds;
  const arranging = arrangeMode && arrangementAvailable && workspace.phase !== 'saving';
  const layoutDirty = !electricalTreeMapLayoutsEqual(workspace.draft, workspace.saved);
  const focusableNodeId = selectedNode && layoutById.has(selectedNode.id)
    ? selectedNode.id
    : layout.nodes[0]?.node.id;

  const fitView = useCallback(() => {
    const element = viewportRef.current;
    if (!element) return;
    const bounds = element.getBoundingClientRect();
    setViewportSize({ width: bounds.width, height: bounds.height });
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
    if (nodeDragFrameRef.current !== null) window.cancelAnimationFrame(nodeDragFrameRef.current);
  }, []);

  useEffect(() => {
    onLayoutDirtyChange?.(layoutDirty);
    return () => onLayoutDirtyChange?.(false);
  }, [layoutDirty, onLayoutDirtyChange]);

  useEffect(() => {
    if (!layoutDirty && workspace.phase !== 'saving') return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [layoutDirty, workspace.phase]);

  useEffect(() => {
    const cancelActiveMove = () => {
      cancelNodePointerDrag();
      cancelKeyboardNodeDrag();
    };
    window.addEventListener('blur', cancelActiveMove);
    return () => window.removeEventListener('blur', cancelActiveMove);
  });

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

  function openNodeDetails(nodeId: string) {
    setSelectedNodeId(nodeId);
    setDetailsOpen(true);
    setHoveredNodeId(null);
    setFocusedNodeId(null);
    const item = completeLayoutById.get(nodeId);
    if (item) setLayoutAnnouncement(`Opened item details for ${nodeTitle(item.node)}.`);
    window.requestAnimationFrame(() => detailsPanelRef.current?.focus({ preventScroll: true }));
  }

  function closeNodeDetails() {
    setDetailsOpen(false);
    const nodeId = selectedNode?.id;
    if (nodeId) {
      window.requestAnimationFrame(() => nodeButtonRefs.current.get(nodeId)?.focus({ preventScroll: true }));
    }
  }

  useEffect(() => {
    if (!detailsOpen) return;
    const returnNodeId = selectedNode?.id;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setDetailsOpen(false);
      if (returnNodeId) {
        window.requestAnimationFrame(() => nodeButtonRefs.current.get(returnNodeId)?.focus({ preventScroll: true }));
      }
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [detailsOpen, selectedNode?.id]);

  useEffect(() => {
    const nodeId = pendingRevealNodeIdRef.current;
    if (!nodeId || !layoutById.has(nodeId)) return;
    pendingRevealNodeIdRef.current = null;
    centerNode(nodeId);
  }, [centerNode, layoutById]);

  function updateDraft(
    current: LayoutWorkspace,
    draft: ElectricalMapLayoutDocument,
  ): LayoutWorkspace {
    const dirty = !electricalTreeMapLayoutsEqual(draft, current.saved);
    return {
      ...current,
      draft,
      phase: dirty ? 'dirty' : 'saved',
      error: '',
    };
  }

  function suppressNextNodeClick(nodeId: string) {
    suppressNodeClickRef.current = nodeId;
    window.setTimeout(() => {
      if (suppressNodeClickRef.current === nodeId) suppressNodeClickRef.current = null;
    }, 500);
  }

  function applyNodeCenter(nodeId: string, centerX: number, centerY: number) {
    const item = completeLayoutById.get(nodeId);
    if (!item) return;
    updateWorkspace((current) => updateDraft(
      current,
      moveElectricalTreeMapLayoutNode(current.draft, nodeId, centerX, centerY, item),
    ));
  }

  function flushPendingNodeCenter() {
    if (nodeDragFrameRef.current !== null) {
      window.cancelAnimationFrame(nodeDragFrameRef.current);
      nodeDragFrameRef.current = null;
    }
    const pending = pendingNodeCenterRef.current;
    pendingNodeCenterRef.current = null;
    if (pending) applyNodeCenter(pending.nodeId, pending.centerX, pending.centerY);
  }

  function queueNodeCenter(nodeId: string, centerX: number, centerY: number) {
    pendingNodeCenterRef.current = { nodeId, centerX, centerY };
    if (nodeDragFrameRef.current !== null) return;
    nodeDragFrameRef.current = window.requestAnimationFrame(() => {
      nodeDragFrameRef.current = null;
      const pending = pendingNodeCenterRef.current;
      pendingNodeCenterRef.current = null;
      if (pending) applyNodeCenter(pending.nodeId, pending.centerX, pending.centerY);
    });
  }

  function beginNodePointerDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    nodeId: string,
  ) {
    if (!arranging || event.button !== 0) return false;
    if (nodeDragRef.current && nodeDragRef.current.pointerId !== event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    const centre = workspace.draft.nodes.find((item) => item.nodeId === nodeId);
    if (!centre) return false;
    event.preventDefault();
    event.stopPropagation();
    pointerFocusRef.current = true;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    nodeDragRef.current = {
      pointerId: event.pointerId,
      nodeId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originCenterX: centre.centerX,
      originCenterY: centre.centerY,
      scale: viewport.scale,
      started: false,
      element: event.currentTarget,
    };
    setSelectedNodeId(nodeId);
    return true;
  }

  function moveNodePointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const clientDeltaX = event.clientX - drag.startClientX;
    const clientDeltaY = event.clientY - drag.startClientY;
    if (!drag.started && !electricalTreePointerDragStarted(
      clientDeltaX,
      clientDeltaY,
      NODE_DRAG_THRESHOLD_PX,
    )) return;
    event.preventDefault();
    event.stopPropagation();
    if (!drag.started) {
      drag.started = true;
      setDraggedNodeId(drag.nodeId);
      setLayoutAnnouncement(`Moving ${nodeTitle(completeLayoutById.get(drag.nodeId)!.node)}. Use Escape to cancel.`);
    }
    const delta = electricalTreePointerDelta(clientDeltaX, clientDeltaY, drag.scale);
    queueNodeCenter(
      drag.nodeId,
      drag.originCenterX + delta.x,
      drag.originCenterY + delta.y,
    );
  }

  function finishNodePointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    nodeDragRef.current = null;
    if (drag.started) {
      event.preventDefault();
      event.stopPropagation();
      flushPendingNodeCenter();
      suppressNextNodeClick(drag.nodeId);
      setLayoutAnnouncement(`${nodeTitle(completeLayoutById.get(drag.nodeId)!.node)} moved. Save the layout to use it in reports.`);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerFocusRef.current = false;
    setDraggedNodeId(null);
  }

  function cancelNodePointerDrag(nodeId?: string) {
    const drag = nodeDragRef.current;
    if (!drag || (nodeId && drag.nodeId !== nodeId)) return;
    nodeDragRef.current = null;
    pendingNodeCenterRef.current = null;
    if (nodeDragFrameRef.current !== null) {
      window.cancelAnimationFrame(nodeDragFrameRef.current);
      nodeDragFrameRef.current = null;
    }
    if (drag.started) {
      applyNodeCenter(drag.nodeId, drag.originCenterX, drag.originCenterY);
      setLayoutAnnouncement(`Move cancelled for ${nodeTitle(completeLayoutById.get(drag.nodeId)!.node)}.`);
    }
    if (drag.element.hasPointerCapture(drag.pointerId)) drag.element.releasePointerCapture(drag.pointerId);
    pointerFocusRef.current = false;
    setDraggedNodeId(null);
  }

  function cancelKeyboardNodeDrag() {
    if (!keyboardDrag) return;
    applyNodeCenter(
      keyboardDrag.nodeId,
      keyboardDrag.originCenterX,
      keyboardDrag.originCenterY,
    );
    const item = completeLayoutById.get(keyboardDrag.nodeId);
    setKeyboardDrag(null);
    if (item) setLayoutAnnouncement(`Move cancelled for ${nodeTitle(item.node)}.`);
  }

  function moveKeyboardNode(
    nodeId: string,
    deltaX: number,
    deltaY: number,
  ) {
    const centre = workspace.draft.nodes.find((item) => item.nodeId === nodeId);
    if (!centre) return;
    applyNodeCenter(nodeId, centre.centerX + deltaX, centre.centerY + deltaY);
    const item = completeLayoutById.get(nodeId);
    if (item) setLayoutAnnouncement(`${nodeTitle(item.node)} moved. Press Enter or Space to finish, or Escape to cancel.`);
  }

  function useAutomaticLayout() {
    if (workspace.phase === 'saving') return;
    cancelNodePointerDrag();
    const automatic = electricalTreeMapLayoutDocument(automaticLayout);
    updateWorkspace((current) => updateDraft(current, automatic));
    setKeyboardDrag(null);
    setLayoutAnnouncement('Automatic arrangement applied. Save the layout to use it in reports.');
    window.requestAnimationFrame(fitView);
  }

  function resetLayoutChanges() {
    if (workspace.phase === 'saving') return;
    cancelNodePointerDrag();
    updateWorkspace((current) => ({
      ...current,
      draft: current.saved,
      phase: 'saved',
      error: '',
    }));
    setKeyboardDrag(null);
    setLayoutAnnouncement('Unsaved layout changes reset.');
    window.requestAnimationFrame(fitView);
  }

  function discardLayoutChanges() {
    cancelNodePointerDrag();
    setKeyboardDrag(null);
    updateWorkspace((current) => ({
      ...current,
      draft: current.saved,
      phase: 'saved',
      error: '',
    }));
  }

  function toggleArrangeMode() {
    if (!arrangementAvailable || workspace.phase === 'saving') return;
    if (arrangeMode) {
      cancelNodePointerDrag();
      cancelKeyboardNodeDrag();
      setArrangeMode(false);
      setLayoutAnnouncement('Arrange mode off. Symbols select their records normally.');
    } else {
      setDetailsOpen(false);
      setArrangeMode(true);
      setLayoutAnnouncement('Arrange mode on. Drag any symbol, or focus it and press Enter or Space to move it with the keyboard.');
    }
  }

  async function saveLayout() {
    if (!onSaveLayout || !layoutDirty || workspace.phase === 'saving') return;
    const submitted = electricalTreeMapLayoutDraft(workspace.draft);
    updateWorkspace((current) => ({ ...current, phase: 'saving', error: '' }));
    setLayoutAnnouncement('Saving electrical map layout.');
    try {
      const savedResult = await onSaveLayout(submitted);
      const saved = electricalTreeMapLayoutDraft(savedResult);
      updateWorkspace((current) => ({
        ...current,
        saved,
        draft: saved,
        phase: 'saved',
        error: '',
      }));
      setLayoutAnnouncement('Electrical map layout saved. The report will use this arrangement.');
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : 'The electrical map layout could not be saved.';
      updateWorkspace((current) => electricalTreeMapLayoutsEqual(current.draft, current.saved)
        ? { ...current, phase: 'saved', error: '' }
        : { ...current, phase: 'error', error: message });
      setLayoutAnnouncement('The electrical map was refreshed after the save attempt. Review the layout status and retry if changes remain.');
    }
  }

  function handleNodeKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, nodeId: string, index: number) {
    if (nodeDragRef.current?.nodeId === nodeId && event.key === 'Escape') {
      event.preventDefault();
      cancelNodePointerDrag(nodeId);
      return;
    }
    const activeKeyboardDrag = keyboardDrag?.nodeId === nodeId;
    if (activeKeyboardDrag) {
      if (event.key === 'Escape') {
        event.preventDefault();
        cancelKeyboardNodeDrag();
        return;
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        suppressNextNodeClick(nodeId);
        setKeyboardDrag(null);
        const item = completeLayoutById.get(nodeId);
        if (item) setLayoutAnnouncement(`${nodeTitle(item.node)} moved. Save the layout to use it in reports.`);
        return;
      }
      const step = event.shiftKey ? KEYBOARD_FINE_MOVE_STEP : KEYBOARD_MOVE_STEP;
      const delta = event.key === 'ArrowUp'
        ? { x: 0, y: -step }
        : event.key === 'ArrowDown'
          ? { x: 0, y: step }
          : event.key === 'ArrowLeft'
            ? { x: -step, y: 0 }
            : event.key === 'ArrowRight'
              ? { x: step, y: 0 }
              : null;
      if (delta) {
        event.preventDefault();
        moveKeyboardNode(nodeId, delta.x, delta.y);
      }
      return;
    }
    if (arranging && (event.key === 'Enter' || event.key === ' ')) {
      const centre = workspace.draft.nodes.find((item) => item.nodeId === nodeId);
      if (!centre) return;
      event.preventDefault();
      suppressNextNodeClick(nodeId);
      setKeyboardDrag({
        nodeId,
        originCenterX: centre.centerX,
        originCenterY: centre.centerY,
      });
      const item = completeLayoutById.get(nodeId);
      if (item) setLayoutAnnouncement(`${nodeTitle(item.node)} picked up. Use arrow keys to move it, Enter or Space to finish, and Escape to cancel.`);
      return;
    }
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
    panDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
      scale: viewport.scale,
    };
    userAdjustedRef.current = true;
    setPanning(true);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = panDragRef.current;
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
    if (panDragRef.current?.pointerId !== event.pointerId) return;
    panDragRef.current = null;
    if (panFrameRef.current !== null) {
      window.cancelAnimationFrame(panFrameRef.current);
      panFrameRef.current = null;
    }
    pendingPanRef.current = null;
    const next = latestPanRef.current;
    latestPanRef.current = null;
    if (next) setViewport((current) => ({ ...current, ...next }));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    setPanning(false);
    window.setTimeout(() => { didPanRef.current = false; }, 0);
  }

  const tooltipNode = tooltipLayoutNode?.node;
  const tooltipScreenTop = tooltipLayoutNode
    ? viewport.y + tooltipLayoutNode.y * viewport.scale
    : 0;
  const tooltipScreenBottom = tooltipLayoutNode
    ? viewport.y + (tooltipLayoutNode.y + tooltipLayoutNode.height) * viewport.scale
    : 0;
  const tooltipSpaceAbove = tooltipScreenTop;
  const tooltipSpaceBelow = viewportSize.height - tooltipScreenBottom;
  const tooltipBelow = tooltipSpaceBelow >= 220 || tooltipSpaceBelow >= tooltipSpaceAbove;
  const tooltipHalfWidth = Math.min(144, Math.max(100, viewportSize.width / 2 - 12));
  const tooltipScreenLeft = tooltipLayoutNode && viewportSize.width
    ? Math.min(
      viewportSize.width - tooltipHalfWidth,
      Math.max(
        tooltipHalfWidth,
        viewport.x + (tooltipLayoutNode.x + tooltipLayoutNode.width / 2) * viewport.scale,
      ),
    )
    : 0;
  const tooltipStyle = tooltipNode && viewportSize.width && tooltipInteraction && !detailsOpen && !arranging && !panning && !draggedNodeId
    ? {
      left: tooltipScreenLeft,
      top: tooltipBelow ? tooltipScreenBottom + 12 : tooltipScreenTop - 12,
      transform: tooltipBelow ? 'translateX(-50%)' : 'translate(-50%, -100%)',
    }
    : null;

  if (!layout.nodes.length) {
    return <p className="mt-4 text-sm text-[var(--text-sub)]">No confirmed electrical items are available for the visual map.</p>;
  }

  return (
    <div className="mt-4 min-w-0 space-y-3">
      <TreeDraftNavigationGuard active={layoutDirty} onDiscard={discardLayoutChanges} />
      <section className="min-w-0 overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-sm)]" aria-labelledby="electrical-tree-heading">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] bg-[linear-gradient(120deg,#F8FBFF_0%,#FFFFFF_52%,#F5FFFA_100%)] px-4 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[var(--primary)]">Electrical system overview</p>
            <h3 id="electrical-tree-heading" className="mt-1 text-base font-extrabold text-[var(--text)]">{tree.installation.siteName}</h3>
            <p id="electrical-tree-instructions" className="mt-1 text-xs text-[var(--text-sub)]">Grid at the centre · switchboards and equipment arranged around their supply · hover or focus for a summary, click or tap for full details</p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold text-[var(--text-sub)]" aria-label="Electrical map summary">
              <span className="rounded-full border border-[var(--border)] bg-white px-2 py-1">{mapSummary.boards} switchboard{mapSummary.boards === 1 ? '' : 's'}</span>
              <span className="rounded-full border border-[var(--border)] bg-white px-2 py-1">{mapSummary.meters} meter{mapSummary.meters === 1 ? '' : 's'}</span>
              <span className="rounded-full border border-[var(--border)] bg-white px-2 py-1">{mapSummary.activeChannels} active channel{mapSummary.activeChannels === 1 ? '' : 's'}</span>
              <span className="rounded-full border border-[var(--border)] bg-white px-2 py-1">{mapSummary.loads} connected load{mapSummary.loads === 1 ? '' : 's'}</span>
            </div>
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
        {onSaveLayout || layoutDirty ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2" aria-label="Electrical map arrangement controls">
              <Button
                variant={arranging ? 'primary' : 'secondary'}
                aria-pressed={arranging}
                disabled={!arrangementAvailable || workspace.phase === 'saving'}
                title={visibleNodeIds ? 'Clear the map search before arranging all items.' : undefined}
                onClick={toggleArrangeMode}
              >
                <Icon name="grid" size={16} />{arranging ? 'Finish arranging' : 'Arrange items'}
              </Button>
              <Button
                variant="secondary"
                disabled={!arrangementAvailable || workspace.phase === 'saving'}
                title={visibleNodeIds ? 'Clear the map search before arranging all items.' : undefined}
                onClick={useAutomaticLayout}
              >
                <Icon name="refresh" size={15} />Auto-arrange
              </Button>
              <Button variant="ghost" disabled={!layoutDirty || workspace.phase === 'saving'} onClick={resetLayoutChanges}>Reset changes</Button>
              <Button disabled={!onSaveLayout || !layoutDirty || workspace.phase === 'saving' || Boolean(draggedNodeId || keyboardDrag)} onClick={() => void saveLayout()}>
                {workspace.phase === 'saving' ? <><Icon name="refresh" size={15} className="animate-spin" />Saving…</> : <><Icon name="check" size={15} />{workspace.phase === 'error' ? 'Retry save' : 'Save layout'}</>}
              </Button>
            </div>
            <div
              className={`inline-flex min-h-9 items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold ${
                workspace.phase === 'error'
                  ? 'border-[var(--red)]/30 bg-[var(--red-soft)] text-[var(--red)]'
                  : workspace.phase === 'saving'
                    ? 'border-[var(--primary)]/30 bg-[var(--primary-soft)] text-[var(--primary)]'
                    : layoutDirty
                      ? 'border-[var(--amber)]/35 bg-[var(--amber-soft)] text-[var(--text)]'
                      : 'border-[var(--green)]/30 bg-[var(--green-soft)] text-[var(--green)]'
              }`}
              role={workspace.phase === 'error' ? 'alert' : 'status'}
              aria-live="polite"
              aria-atomic="true"
            >
              <Icon name={workspace.phase === 'error' ? 'activity' : workspace.phase === 'saving' ? 'refresh' : layoutDirty ? 'activity' : 'check'} size={15} className={workspace.phase === 'saving' ? 'animate-spin' : ''} />
              <span>{workspace.phase === 'error' ? workspace.error : workspace.phase === 'saving' ? 'Saving layout…' : layoutDirty ? 'Layout changes not saved' : model.mapLayout ? 'Layout saved for reports' : 'Automatic layout'}</span>
            </div>
            {visibleNodeIds ? <p className="w-full text-xs font-semibold text-[var(--amber)]">Clear the map search to arrange the complete electrical system.</p> : null}
          </div>
        ) : null}
        <p id="electrical-arrange-instructions" className="sr-only">In Arrange mode, drag a symbol with a pointer. With a keyboard, focus a symbol and press Enter or Space to pick it up, use arrow keys to move it, then press Enter or Space to finish. Press Escape to cancel.</p>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{layoutAnnouncement}</p>
        <div className="relative">
          <div
            ref={viewportRef}
            role="tree"
            aria-label="Interactive electrical system map"
            aria-describedby="electrical-tree-instructions"
            className={`relative h-[34rem] select-none overflow-hidden bg-[#F8FBFF] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)] sm:h-[40rem] xl:h-[46rem] ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
            style={{
              touchAction: touchPanEnabled ? 'none' : 'pan-y pinch-zoom',
              backgroundImage: 'radial-gradient(circle at 50% 48%, rgba(37, 99, 235, 0.10) 0, rgba(37, 99, 235, 0.045) 18%, transparent 45%), radial-gradient(circle at 18% 16%, rgba(20, 184, 166, 0.07), transparent 27%), radial-gradient(circle at 84% 82%, rgba(245, 158, 11, 0.06), transparent 25%)',
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
                const path = electricalTreeStraightPath(source, target);
                return <g key={edge.id} data-connector-geometry="straight"><path d={path} fill="none" stroke="#F3DEC9" strokeWidth="8" strokeLinecap="round" opacity="0.75" /><path d={path} fill="none" stroke="#B66A2C" strokeWidth="3.25" strokeLinecap="round" opacity="0.9" /></g>;
              })}
              {layout.edges.filter((edge) => edge.relationship === 'DERIVED_FROM').map((edge) => {
                const source = layoutById.get(edge.sourceNodeId);
                const target = layoutById.get(edge.targetNodeId);
                if (!source || !target) return null;
                return <path key={edge.id} data-connector-geometry="straight" d={electricalTreeStraightPath(source, target)} fill="none" stroke="var(--text-sub)" strokeWidth="2.25" strokeDasharray="2 7" strokeLinecap="round" opacity="0.62" />;
              })}
              {layout.edges.filter((edge) => edge.relationship === 'MEASURES' && (
                edge.sourceNodeId === selectedNode?.id || edge.targetNodeId === selectedNode?.id
              )).map((edge) => {
                const source = layoutById.get(edge.sourceNodeId);
                const target = layoutById.get(edge.targetNodeId);
                if (!source || !target) return null;
                return <path key={edge.id} data-connector-geometry="straight" d={electricalTreeStraightPath(source, target, { sourceYOffset: 13, targetYOffset: 13 })} fill="none" stroke="var(--primary)" strokeWidth="2.25" strokeDasharray="6 7" strokeLinecap="round" opacity="0.62" />;
              })}
            </svg>
            {layout.nodes.map((item, index) => {
              const presentation = NODE_PRESENTATION[item.node.kind];
              const symbol = electricalMapSymbolForNode(item.node);
              const symbolLabel = electricalMapSymbolLabel(symbol);
              const summary = cardSummaryById.get(item.node.id) || { devices: [], loadLabels: [], assignedAssets: [] };
              const interaction = interactionSummaryById.get(item.node.id)
                || electricalMapNodeInteractionSummary(tree, model, item.node.id);
              const coverage = item.node.coverageState ? COVERAGE_PRESENTATION[item.node.coverageState] : undefined;
              const primaryLabel = item.node.kind === 'SITE_ASSET' || item.node.kind === 'BOARD'
                ? 'Symbol'
                : item.node.typeLabel
                  ? 'Type'
                  : 'Location';
              const primaryText = item.node.kind === 'SITE_ASSET' || item.node.kind === 'BOARD'
                ? symbolLabel
                : item.node.typeLabel || nodeZone(tree, item.node);
              const assignedAssetLabels = summary.assignedAssets.map((asset) => (
                `${asset.displayCode ? `${asset.displayCode} — ` : ''}${asset.name}`
              ));
              const ariaDetails = [
                `${primaryLabel}: ${primaryText}`,
                summary.loadLabels.length ? `Load: ${summary.loadLabels.join(', ')}` : '',
                item.node.kind === 'GRID' || item.node.kind === 'BOARD'
                  ? `${interaction.downstreamLoadCount} downstream loads and ${interaction.activeChannelCount} active meter channels`
                  : '',
                coverage ? `Coverage: ${coverage.label}` : '',
                interaction.meters.length ? `Meters: ${interaction.meters.map((meter) => `${meter.name}${meter.serialNumber ? `, serial ${meter.serialNumber}` : ''}${meter.assignedChannels.length ? `, ${meter.assignedChannels.map((channel) => channel.label).join(', ')}` : ''}`).join('; ')}` : '',
                assignedAssetLabels.length ? `Measures assigned assets: ${assignedAssetLabels.join('; ')}` : '',
              ].filter(Boolean).join('. ');
              const selected = item.node.id === selectedNode?.id;
              const moving = item.node.id === draggedNodeId || item.node.id === keyboardDrag?.nodeId;
              return (
                <button
                  key={item.node.id}
                  ref={(element) => {
                    if (element) nodeButtonRefs.current.set(item.node.id, element);
                    else nodeButtonRefs.current.delete(item.node.id);
                  }}
                  type="button"
                  data-electrical-node-id={item.node.id}
                  className={`group absolute overflow-visible rounded-[2rem] border border-transparent bg-transparent p-1 text-center transition-[filter] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-4 focus-visible:ring-offset-[#F8FBFF] ${arranging ? 'cursor-move hover:brightness-[0.97]' : 'cursor-pointer hover:brightness-[0.97]'} ${moving ? 'z-20 drop-shadow-[0_14px_24px_rgba(30,64,175,0.24)]' : selected ? 'z-10' : ''}`}
                  style={{
                    left: `${item.x}px`,
                    top: `${item.y}px`,
                    width: `${item.width}px`,
                    height: `${item.height}px`,
                    touchAction: arranging ? 'none' : undefined,
                  }}
                  aria-label={`${arranging ? 'Arrange' : 'Open details for'} ${symbolLabel}: ${nodeTitle(item.node)}. ${ariaDetails}${arranging ? '. Press Enter or Space to move with the keyboard.' : '. Click or press Enter to open item details.'}`}
                  aria-controls="electrical-node-details-panel"
                  aria-describedby={[
                    arranging ? 'electrical-arrange-instructions' : '',
                    tooltipNodeId === item.node.id ? 'electrical-map-node-tooltip' : '',
                  ].filter(Boolean).join(' ') || undefined}
                  aria-keyshortcuts={arranging ? 'Enter Space ArrowUp ArrowDown ArrowLeft ArrowRight Escape' : undefined}
                  aria-level={item.depth + 1}
                  aria-roledescription={arranging ? 'draggable electrical map item' : undefined}
                  aria-selected={selected}
                  role="treeitem"
                  tabIndex={item.node.id === focusableNodeId ? 0 : -1}
                  onClick={(event) => {
                    if (didPanRef.current || suppressNodeClickRef.current === item.node.id) {
                      if (suppressNodeClickRef.current === item.node.id) suppressNodeClickRef.current = null;
                      event.preventDefault();
                      event.stopPropagation();
                      return;
                    }
                    event.stopPropagation();
                    pointerFocusRef.current = false;
                    if (arranging) {
                      setSelectedNodeId(item.node.id);
                      return;
                    }
                    openNodeDetails(item.node.id);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onFocus={() => {
                    setSelectedNodeId(item.node.id);
                    setFocusedNodeId(item.node.id);
                    if (!pointerFocusRef.current) centerNode(item.node.id);
                  }}
                  onBlur={() => {
                    setFocusedNodeId((current) => current === item.node.id ? null : current);
                    if (keyboardDrag?.nodeId === item.node.id) cancelKeyboardNodeDrag();
                  }}
                  onPointerEnter={(event) => {
                    if (event.pointerType !== 'touch') setHoveredNodeId(item.node.id);
                  }}
                  onPointerLeave={() => {
                    setHoveredNodeId((current) => current === item.node.id ? null : current);
                  }}
                  onKeyDown={(event) => handleNodeKeyDown(event, item.node.id, index)}
                  onLostPointerCapture={() => cancelNodePointerDrag(item.node.id)}
                  onPointerCancel={() => cancelNodePointerDrag(item.node.id)}
                  onPointerDown={(event) => {
                    if (beginNodePointerDrag(event, item.node.id)) return;
                    pointerFocusRef.current = true;
                    event.stopPropagation();
                  }}
                  onPointerMove={moveNodePointerDrag}
                  onPointerUp={(event) => {
                    if (nodeDragRef.current?.nodeId === item.node.id) finishNodePointerDrag(event);
                    else pointerFocusRef.current = false;
                  }}
                >
                  <span className="flex h-full w-full flex-col items-center justify-center text-center">
                    {coverage && item.node.kind === 'SITE_ASSET' ? (
                      <span className={`absolute right-0 top-0 z-10 rounded-full border border-white px-2 py-0.5 text-[7px] font-extrabold uppercase tracking-wide shadow-sm ${coverage.className}`} title={`Coverage: ${coverage.label}`}>{coverage.label}</span>
                    ) : null}
                    <span
                      className={`relative flex shrink-0 items-center justify-center rounded-full border-2 shadow-[0_10px_30px_rgba(15,23,42,0.10)] transition-[box-shadow,border-color,background-color] duration-200 group-hover:shadow-[0_14px_34px_rgba(30,64,175,0.16)] ${presentation.haloClassName} ${item.node.kind === 'GRID' ? 'h-28 w-28' : item.node.kind === 'BOARD' ? 'h-24 w-24' : 'h-20 w-20'} ${item.node.kind === 'VIRTUAL_RESIDUAL' ? 'border-dashed' : ''} ${selected ? 'ring-4 ring-[var(--primary)]/20 ring-offset-4 ring-offset-[#F8FBFF]' : ''}`}
                      aria-hidden="true"
                    >
                      <ElectricalMapSymbol
                        name={symbol}
                        size={item.node.kind === 'GRID' ? 72 : item.node.kind === 'BOARD' ? 62 : item.node.kind === 'VIRTUAL_RESIDUAL' ? 48 : 54}
                      />
                      {item.node.kind === 'BOARD' && interaction.meterCount ? (
                        <span className="absolute -bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--green)]/25 bg-white px-2 py-1 text-[8px] font-extrabold text-[var(--green)] shadow-sm">
                          <ElectricalMapSymbol name="node-meter" size={14} />
                          {interaction.meterCount} meter{interaction.meterCount === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </span>
                    <span className={`mt-3 line-clamp-2 max-w-full px-1 text-[9px] font-extrabold uppercase leading-3 tracking-[0.08em] ${presentation.labelClassName}`}>{symbolLabel}</span>
                    <span className="mt-1 line-clamp-2 max-w-full text-[11px] font-extrabold leading-[0.9rem] text-[var(--text)]">
                      {item.node.kind === 'GRID' ? item.node.name : item.node.name || item.node.displayCode}
                    </span>
                    {item.node.kind === 'SITE_ASSET' ? (
                      <span className="mt-1.5 flex max-w-full flex-wrap justify-center gap-1 text-[7px] font-extrabold leading-3">
                        <span className="max-w-full truncate rounded-full border border-[var(--green)]/25 bg-[var(--green-soft)] px-1.5 py-0.5 text-[var(--green)]" title={`Load type: ${interaction.loadLabels.join(', ') || item.node.typeLabel || symbolLabel}`}>Load · {interaction.loadLabels.length ? compactList(interaction.loadLabels, 1) : item.node.typeLabel || symbolLabel}</span>
                        {interaction.assignedChannelCount ? <span className="rounded-full border border-[var(--primary)]/20 bg-[var(--primary-soft)] px-1.5 py-0.5 text-[var(--primary)]" title={`${interaction.meterCount} assigned meter${interaction.meterCount === 1 ? '' : 's'}, ${interaction.assignedChannelCount} assigned channel${interaction.assignedChannelCount === 1 ? '' : 's'}`}>{interaction.meterCount}m · {interaction.assignedChannelCount}ch</span> : null}
                      </span>
                    ) : item.node.kind === 'GRID' || item.node.kind === 'BOARD' ? (
                      <>
                        {item.node.kind === 'BOARD' ? <span className="mt-1 max-w-full truncate text-[8px] font-semibold text-[var(--text-sub)]">{nodeZone(tree, item.node)}</span> : null}
                        <span className="mt-1 rounded-full border border-[var(--primary)]/15 bg-white/90 px-1.5 py-0.5 text-[7px] font-extrabold text-[var(--primary)]">{interaction.downstreamLoadCount} load{interaction.downstreamLoadCount === 1 ? '' : 's'} · {interaction.activeChannelCount} active ch</span>
                      </>
                    ) : item.node.kind === 'VIRTUAL_RESIDUAL' ? (
                      <span className="mt-1 text-[8px] font-semibold text-[var(--text-sub)]">Formula v{item.node.formulaVersion || '—'}</span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
            {viewport.scale < 0.28 ? <p className="pointer-events-none absolute bottom-3 left-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]/95 px-3 py-2 text-xs font-bold text-[var(--text-sub)] shadow-[var(--shadow-sm)]">Overview mode · zoom in to read and select nodes</p> : null}
          </div>
          {tooltipStyle && tooltipNode && tooltipInteraction ? (
            <div
              id="electrical-map-node-tooltip"
              role="tooltip"
              className="pointer-events-none absolute z-[70] w-[min(18rem,calc(100vw-1.5rem))] rounded-xl border border-slate-200 bg-slate-950 px-3 py-2.5 text-left text-white shadow-2xl"
              style={tooltipStyle}
            >
              <p className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-cyan-200">{electricalMapSymbolLabel(electricalMapSymbolForNode(tooltipNode))}</p>
              <p className="mt-1 text-sm font-extrabold leading-5">{nodeTitle(tooltipNode)}</p>
              <dl className="mt-2 space-y-1 text-[11px] leading-4 text-slate-200">
                <div><dt className="inline font-extrabold text-white">Load: </dt><dd className="inline">{tooltipInteraction.loadLabels.length ? compactList(tooltipInteraction.loadLabels, 2) : 'No confirmed load label'}</dd></div>
                {(tooltipNode.kind === 'GRID' || tooltipNode.kind === 'BOARD') ? (
                  <div><dt className="inline font-extrabold text-white">Scope: </dt><dd className="inline">{tooltipInteraction.downstreamLoadCount} downstream load{tooltipInteraction.downstreamLoadCount === 1 ? '' : 's'} · {tooltipInteraction.activeChannelCount} active channel{tooltipInteraction.activeChannelCount === 1 ? '' : 's'}</dd></div>
                ) : null}
                <div><dt className="inline font-extrabold text-white">Metering: </dt><dd className="inline">{tooltipInteraction.meterCount} meter{tooltipInteraction.meterCount === 1 ? '' : 's'} · {tooltipInteraction.assignedChannelCount} assigned channel{tooltipInteraction.assignedChannelCount === 1 ? '' : 's'}</dd></div>
                {tooltipInteraction.meters.slice(0, 2).map((meter) => (
                  <div key={meter.id} className="border-t border-white/10 pt-1">
                    <dt className="font-extrabold text-white">{meter.name}{meter.serialNumber ? ` · ${meter.serialNumber}` : ''}</dt>
                    <dd>{meter.assignedChannels.length ? compactList(meter.assignedChannels.map((channel) => channel.label), 2) : `${meter.installedChannelCount} installed channels · no confirmed assignment`}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 border-t border-white/15 pt-2 text-[10px] font-bold text-cyan-100">Click or press Enter for item details</p>
            </div>
          ) : null}
        </div>
        <div id="electrical-tree-key" className="border-t border-[var(--border)] bg-white px-4 py-4" aria-labelledby="electrical-tree-key-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 id="electrical-tree-key-heading" className="text-sm font-extrabold text-[var(--text)]">How to read this map</h4>
            <p className="text-[11px] text-[var(--text-sub)]">Every transparent symbol represents a real confirmed item · select one for the complete record</p>
          </div>
          <div className="mt-3 grid gap-4 lg:grid-cols-[0.8fr_1.5fr_1.2fr]">
            <section aria-labelledby="electrical-node-symbols-heading">
              <h5 id="electrical-node-symbols-heading" className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">System symbols</h5>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-[11px] text-[var(--text-sub)]">
                {ELECTRICAL_MAP_NODE_SYMBOLS.map((item) => (
                  <li key={item.label} className="flex items-center gap-2">
                    <ElectricalMapSymbol name={item.symbol} size={25} className="shrink-0" />
                    <span className="font-bold text-[var(--text)]">{item.label}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="electrical-load-symbols-heading">
              <h5 id="electrical-load-symbols-heading" className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">Load symbols</h5>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-[10px] leading-4 text-[var(--text-sub)]">
                {ELECTRICAL_MAP_LOAD_SYMBOLS.map((item) => (
                  <li key={item.label} className="flex items-center gap-1.5">
                    <ElectricalMapSymbol name={item.symbol} size={22} className="shrink-0" />
                    <span>{item.label}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="electrical-lines-heading" className="space-y-3">
              <div>
                <h5 id="electrical-lines-heading" className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">Connections</h5>
                <ul className="mt-2 space-y-1.5 text-[10px] leading-4 text-[var(--text-sub)]">
                  <li className="flex items-center gap-2"><span className="h-0 w-9 shrink-0 border-t-[3px] border-[#B66A2C]" /><span><strong className="text-[var(--text)]">Supplied from</strong> · straight confirmed connection</span></li>
                  <li className="flex items-center gap-2"><span className="h-0 w-9 shrink-0 border-t-[3px] border-dashed border-[var(--primary)] opacity-60" /><span><strong className="text-[var(--text)]">Meter link</strong> · appears when a connected item is selected</span></li>
                  <li className="flex items-center gap-2"><span className="h-0 w-9 shrink-0 border-t-2 border-dotted border-[var(--text-sub)]" /><span><strong className="text-[var(--text)]">Calculated remainder</strong> · virtual, not a physical cable</span></li>
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
          <p className="mt-3 border-t border-[var(--border)] pt-3 text-[10px] leading-4 text-[var(--text-sub)]"><strong className="text-[var(--text)]">Explore:</strong> hover or focus a symbol for a summary, then click or tap it for the item detail panel; use arrow, Home, and End keys between items; drag the background or use Touch pan to move the view; double-click to fit.{onSaveLayout ? ' Choose Arrange items to reposition symbols, then save the layout for reports.' : ''} Items still to be confirmed stay outside this client view.</p>
        </div>
      </section>

      {detailsOpen && selectedNode && selectedContext ? (
        <aside
          ref={detailsPanelRef}
          id="electrical-node-details-panel"
          aria-labelledby="electrical-node-details-heading"
          tabIndex={-1}
          className="fixed inset-x-0 bottom-0 z-[65] flex max-h-[min(80vh,42rem)] flex-col overflow-hidden rounded-t-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl focus:outline-none sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-4 sm:max-h-none sm:w-[min(28rem,calc(100vw-2rem))] sm:rounded-2xl"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            closeNodeDetails();
          }}
        >
          <p className="sr-only" aria-live="polite" aria-atomic="true">Selected {NODE_PRESENTATION[selectedNode.kind].label}: {nodeTitle(selectedNode)}.</p>
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface2)] p-4">
            <div className="min-w-0">
              <span className="inline-flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.08em] text-[var(--text-sub)]">
                <ElectricalMapSymbol name={electricalMapSymbolForNode(selectedNode)} size={24} />
                {NODE_PRESENTATION[selectedNode.kind].label}
              </span>
              <h3 id="electrical-node-details-heading" className="mt-2 break-words text-lg font-extrabold leading-6 text-[var(--text)]">{nodeTitle(selectedNode)}</h3>
              {selectedNode.typeLabel ? <p className="mt-1 text-xs font-semibold text-[var(--text-sub)]">{selectedNode.typeLabel}</p> : null}
            </div>
            <Button variant="ghost" className="min-h-11 w-11 shrink-0 px-0 text-xl" aria-label="Close item details" onClick={closeNodeDetails}>×</Button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <dl className="grid grid-cols-2 gap-2">
              {[
                ['Child branches', selectedChildren.length + selectedDerivedChildren.length],
                [selectedNode.kind === 'SITE_ASSET' ? 'Load' : 'Downstream loads', selectedInteraction.downstreamLoadCount],
                ['Meters', selectedInteraction.meterCount],
                ['Assigned channels', selectedInteraction.assignedChannelCount],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-[var(--border)] bg-[var(--surface2)] p-2.5">
                  <dt className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">{label}</dt>
                  <dd className="mt-1 text-xl font-extrabold text-[var(--text)]">{value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Load</p>
              {selectedInteraction.loadLabels.length ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {selectedInteraction.loadLabels.map((label) => <span key={label} className="rounded-full border border-[var(--green)]/25 bg-[var(--green-soft)] px-2.5 py-1 text-xs font-bold text-[var(--green)]">{label}</span>)}
                </div>
              ) : <p className="mt-1 text-xs text-[var(--text-sub)]">No confirmed load label</p>}
            </div>

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

            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">{selectedNode.kind === 'SITE_ASSET' ? 'Assigned meter and channels' : 'Meters and active channels'}</p>
              {selectedInteraction.meters.length ? (
                <ul className="mt-1.5 space-y-2">
                  {selectedInteraction.meters.map((summaryMeter) => {
                    const meter = allMeters.find((candidate) => candidate.id === summaryMeter.id);
                    const href = meter ? meterRecordHref(tree, meter) : null;
                    const content = <>
                      <span className="block font-bold text-[var(--text)]">{summaryMeter.name}</span>
                      <span className="mt-0.5 block text-[11px] text-[var(--text-sub)]">{summaryMeter.serialNumber ? `Serial ${summaryMeter.serialNumber} · ` : ''}{summaryMeter.installedChannelCount} installed channel{summaryMeter.installedChannelCount === 1 ? '' : 's'} · {summaryMeter.assignedChannels.length} assigned here</span>
                      {summaryMeter.assignedChannels.length ? (
                        <span className="mt-2 flex flex-col gap-1">
                          {summaryMeter.assignedChannels.map((channel) => <span key={channel.id} className="rounded-md border border-[var(--primary)]/20 bg-[var(--primary-soft)] px-2 py-1 font-semibold text-[var(--primary)]">{channel.label}</span>)}
                        </span>
                      ) : <span className="mt-1.5 block text-[11px] text-[var(--text-sub)]">No confirmed channel assignment for this item</span>}
                      <span className="mt-1.5 block break-all font-mono text-[10px] text-[var(--muted)]">{summaryMeter.id}</span>
                    </>;
                    return <li key={summaryMeter.id}>{href ? <Link href={href} className="block min-h-11 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-xs transition-colors hover:border-[var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]">{content}</Link> : <div className="rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-3 py-2 text-xs">{content}</div>}</li>;
                  })}
                </ul>
              ) : <p className="mt-1 text-xs text-[var(--text-sub)]">No active meter or confirmed channel assignment for this item</p>}
            </div>

            {selectedMeasurementDetails.length ? (
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Exact assigned channel rows</p>
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
