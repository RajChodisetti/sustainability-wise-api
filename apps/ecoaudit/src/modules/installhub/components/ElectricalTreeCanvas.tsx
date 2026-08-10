'use client';

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
} from '@/modules/installhub/types/domain';
import {
  meterDevices,
} from '@/modules/installhub/lib/workflow';
import {
  ELECTRICAL_MAP_LEGEND_SYMBOL_SIZES,
  ELECTRICAL_MAP_LOAD_SYMBOLS,
  ELECTRICAL_MAP_NODE_SYMBOLS,
  electricalMapSymbolForNode,
  electricalMapSymbolLabel,
} from '@/modules/installhub/lib/electricalMapSymbols';
import { electricalMapNodeInteractionSummary } from '@/modules/installhub/lib/electricalMapInteraction';
import {
  electricalMapBoardChannelLayout,
  type ElectricalMapBoardChannel,
} from '@/modules/installhub/lib/electricalMapBoardChannels';
import {
  CLOSED_ELECTRICAL_MAP_INFO_CARD,
  electricalMapInfoCardNodeId,
  reduceElectricalMapInfoCard,
  type ElectricalMapInfoCardState,
} from '@/modules/installhub/lib/electricalMapInfoCard';
import {
  applyElectricalTreeMapLayout,
  buildElectricalTreeLayout,
  electricalTreeMapLayoutDocument,
  electricalTreeMapLayoutDraft,
  electricalTreeMapLayoutsEqual,
  electricalTreeDirectPointerDragEnabled,
  electricalTreeNodeCardSummary,
  electricalTreeNodeContexts,
  electricalTreeNodeVisualSize,
  electricalTreePointerDelta,
  electricalTreeStraightPath,
  filterElectricalTreeLayout,
  fitElectricalTreeViewport,
  moveElectricalTreeMapLayoutNode,
  resolvedElectricalMeasurementDetails,
  zoomElectricalTreeViewport,
  type ElectricalMapLayoutDocument,
  type SavedElectricalMapLayout,
  type ElectricalTreeLayoutNode,
  type ElectricalTreeViewport,
} from '@/modules/installhub/lib/electricalTreeLayout';
import {
  ELECTRICAL_TREE_HOLD_DELAY_MS,
  electricalTreePointerGestureTransition,
  type ElectricalTreePointerGesturePhase,
} from '@/modules/installhub/lib/electricalTreePointerGesture';

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
  phase: ElectricalTreePointerGesturePhase;
  holdTimer: number | null;
  lastClientX: number;
  lastClientY: number;
  dragStartClientX: number;
  dragStartClientY: number;
  element: HTMLButtonElement;
};

type KeyboardNodeDrag = {
  nodeId: string;
  originCenterX: number;
  originCenterY: number;
};

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

function compactList(values: string[], limit = 2): string {
  if (values.length <= limit) return values.join(', ');
  return `${values.slice(0, limit).join(', ')} +${values.length - limit}`;
}

function boardChannelConnectorPoint(
  node: ElectricalTreeLayoutNode,
  channels: readonly ElectricalMapBoardChannel[],
  channelId: string,
): { x: number; y: number } | null {
  const slot = electricalMapBoardChannelLayout(channels)
    .find((item) => item.channel.id === channelId);
  if (!slot) return null;
  const visual = electricalTreeNodeVisualSize('BOARD');
  const iconLeft = node.x + (node.width - visual.iconSize) / 2;
  const iconTop = node.y + 4 + (visual.haloSize - visual.iconSize) / 2;
  const scale = visual.iconSize / 64;
  return {
    x: iconLeft + slot.portX * scale,
    y: iconTop + slot.portY * scale,
  };
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
  const boardChannelsById = useMemo(() => new Map(layout.nodes.flatMap((item) => {
    if (item.node.kind !== 'BOARD') return [];
    const interaction = interactionSummaryById.get(item.node.id);
    const assignedChannelIds = new Set(interaction?.meters.flatMap((meter) => (
      meter.assignedChannels.map((channel) => channel.id)
    )) || []);
    const channels = allMeters
      .filter((meter) => (
        meter.installedOnBoardId === item.node.id
        && (meter.lifecycleState ?? 'ACTIVE') === 'ACTIVE'
      ))
      .sort((left, right) => left.id.localeCompare(right.id))
      .flatMap((meter, meterIndex) => meter.channels.map((channel) => ({
        id: channel.id,
        meterLabel: `M${meterIndex + 1}`,
        ordinal: channel.ordinal,
        phaseLabel: channel.phaseLabel,
        purpose: channel.purpose,
        assigned: assignedChannelIds.has(channel.id),
      })));
    return [[item.node.id, channels] as const];
  })), [allMeters, interactionSummaryById, layout.nodes]);
  const measurementChannelsByEdgeId = useMemo(() => new Map(layout.edges.flatMap((edge) => {
    if (edge.relationship !== 'MEASURES') return [];
    const assignmentId = edge.id.startsWith('measures:')
      ? edge.id.slice('measures:'.length)
      : edge.id.startsWith('measure_')
        ? edge.id.slice('measure_'.length)
        : null;
    const boardDetails = resolvedElectricalMeasurementDetails(tree, model, edge.targetNodeId)
      .filter((detail) => (
        detail.meter.installedOnBoardId === edge.sourceNodeId
        && (!assignmentId || detail.assignment.id === assignmentId)
      ));
    const channelIds = [...new Set(boardDetails.flatMap((detail) => (
      detail.channels.map((channel) => channel.id)
    )))];
    return channelIds.length
      ? [[edge.id, channelIds] as const]
      : [];
  })), [layout.edges, model, tree]);
  const [selectedNodeId, setSelectedNodeId] = useState(layout.nodes[0]?.node.id || '');
  const [infoCardState, setInfoCardState] = useState<ElectricalMapInfoCardState>(
    CLOSED_ELECTRICAL_MAP_INFO_CARD,
  );
  const selectedLayoutNode = layoutById.get(selectedNodeId) || layout.nodes[0];
  const selectedNode = selectedLayoutNode?.node;
  const infoCardNodeId = electricalMapInfoCardNodeId(infoCardState);
  const infoCardNode = infoCardNodeId ? layoutById.get(infoCardNodeId)?.node : undefined;
  const infoCardContext = infoCardNodeId ? contextById.get(infoCardNodeId) : undefined;
  const infoCardParent = infoCardContext
    ? completeLayoutById.get(infoCardContext.derivedParentId || infoCardContext.parentId || '')?.node
    : undefined;
  const infoCardInteraction = infoCardNodeId
    ? interactionSummaryById.get(infoCardNodeId)
      || electricalMapNodeInteractionSummary(tree, model, infoCardNodeId)
    : null;
  const infoCardChannels = infoCardInteraction?.meters.flatMap((meter) => (
    meter.assignedChannels.map((channel) => ({
      ...channel,
      meterId: meter.id,
      meterName: meter.name,
    }))
  )) || [];

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const infoCardRef = useRef<HTMLElement>(null);
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
  const updateWorkspace = useCallback((
    updater: (current: LayoutWorkspace) => LayoutWorkspace,
  ) => {
    setWorkspaceState((current) => updater(reconcileLayoutWorkspace(current, initialWorkspace)));
  }, [initialWorkspace]);
  const arrangementAvailable = Boolean(onSaveLayout) && !visibleNodeIds;
  const arranging = arrangeMode && arrangementAvailable && workspace.phase !== 'saving';
  const pointerDraggingAvailable = electricalTreeDirectPointerDragEnabled({
    canSaveLayout: Boolean(onSaveLayout),
    hasVisibleNodeFilter: Boolean(visibleNodeIds),
    saving: workspace.phase === 'saving',
  });
  const layoutDirty = !electricalTreeMapLayoutsEqual(workspace.draft, workspace.saved);
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
    if (nodeDragFrameRef.current !== null) window.cancelAnimationFrame(nodeDragFrameRef.current);
    const drag = nodeDragRef.current;
    if (drag) {
      clearNodeHoldTimer(drag);
      if (drag.element.isConnected && drag.element.hasPointerCapture(drag.pointerId)) {
        drag.element.releasePointerCapture(drag.pointerId);
      }
    }
    nodeDragRef.current = null;
    pendingNodeCenterRef.current = null;
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
    setInfoCardState({ status: 'pinned', nodeId });
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

  function toggleNodeInfo(nodeId: string) {
    const opening = infoCardState.status !== 'pinned' || infoCardState.nodeId !== nodeId;
    setSelectedNodeId(nodeId);
    setInfoCardState((current) => reduceElectricalMapInfoCard(current, {
      type: 'node-clicked',
      nodeId,
    }));
    const item = completeLayoutById.get(nodeId);
    if (item) {
      setLayoutAnnouncement(opening
        ? `Showing a compact summary for ${nodeTitle(item.node)}.`
        : `Closed the summary for ${nodeTitle(item.node)}.`);
    }
    if (opening) window.requestAnimationFrame(() => infoCardRef.current?.focus({ preventScroll: true }));
  }

  function dismissInfoCard(
    reason: 'close-button' | 'escape' | 'outside',
    returnFocus = false,
  ) {
    const nodeId = electricalMapInfoCardNodeId(infoCardState);
    setInfoCardState((current) => reduceElectricalMapInfoCard(current, {
      type: 'dismissed',
      reason,
    }));
    if (returnFocus && nodeId) {
      window.requestAnimationFrame(() => nodeButtonRefs.current.get(nodeId)?.focus({ preventScroll: true }));
    }
  }

  useEffect(() => {
    if (!infoCardNodeId) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setInfoCardState((current) => reduceElectricalMapInfoCard(current, {
        type: 'dismissed',
        reason: 'escape',
      }));
      window.requestAnimationFrame(() => nodeButtonRefs.current.get(infoCardNodeId)?.focus({ preventScroll: true }));
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [infoCardNodeId]);

  useEffect(() => {
    if (!infoCardNodeId) return;
    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (infoCardRef.current?.contains(target)) return;
      if ([...nodeButtonRefs.current.values()].some((button) => button.contains(target))) return;
      setInfoCardState((current) => reduceElectricalMapInfoCard(current, {
        type: 'dismissed',
        reason: 'outside',
      }));
    };
    window.addEventListener('pointerdown', handleOutsidePointer, true);
    return () => window.removeEventListener('pointerdown', handleOutsidePointer, true);
  }, [infoCardNodeId]);

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

  function clearNodeHoldTimer(drag: NodePointerDrag) {
    if (drag.holdTimer === null) return;
    window.clearTimeout(drag.holdTimer);
    drag.holdTimer = null;
  }

  function beginNodePointerDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    nodeId: string,
  ) {
    if (!pointerDraggingAvailable || !event.isPrimary || event.button !== 0) return false;
    if (nodeDragRef.current && nodeDragRef.current.pointerId !== event.pointerId) {
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    const centre = workspace.draft.nodes.find((item) => item.nodeId === nodeId);
    if (!centre) return false;
    event.stopPropagation();
    pointerFocusRef.current = true;
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const drag: NodePointerDrag = {
      pointerId: event.pointerId,
      nodeId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originCenterX: centre.centerX,
      originCenterY: centre.centerY,
      scale: viewport.scale,
      phase: 'pressing',
      holdTimer: null,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      dragStartClientX: event.clientX,
      dragStartClientY: event.clientY,
      element: event.currentTarget,
    };
    nodeDragRef.current = drag;
    drag.holdTimer = window.setTimeout(() => {
      const current = nodeDragRef.current;
      if (
        !current
        || current.pointerId !== drag.pointerId
        || current.nodeId !== drag.nodeId
        || current.phase !== 'pressing'
      ) return;
      const item = completeLayoutById.get(current.nodeId);
      if (!item) {
        cancelNodePointerDrag(current.nodeId);
        return;
      }
      current.holdTimer = null;
      current.phase = electricalTreePointerGestureTransition(current.phase, { type: 'hold' });
      current.dragStartClientX = current.lastClientX;
      current.dragStartClientY = current.lastClientY;
      setInfoCardState(CLOSED_ELECTRICAL_MAP_INFO_CARD);
      setDraggedNodeId(current.nodeId);
      setLayoutAnnouncement(`Selected ${nodeTitle(item.node)}. Drag to move it, or release to keep it selected. Escape cancels.`);
    }, ELECTRICAL_TREE_HOLD_DELAY_MS);
    setSelectedNodeId(nodeId);
    return true;
  }

  function moveNodePointerDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = nodeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.lastClientX = event.clientX;
    drag.lastClientY = event.clientY;

    if (drag.phase === 'pressing') {
      const phase = electricalTreePointerGestureTransition(drag.phase, {
        type: 'move',
        deltaX: event.clientX - drag.startClientX,
        deltaY: event.clientY - drag.startClientY,
      });
      if (phase === 'pressing') return;
      drag.phase = phase;
      clearNodeHoldTimer(drag);
      suppressNextNodeClick(drag.nodeId);
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (drag.phase === 'cancelled') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const clientDeltaX = event.clientX - drag.dragStartClientX;
    const clientDeltaY = event.clientY - drag.dragStartClientY;
    if (drag.phase === 'held') {
      const nextPhase = electricalTreePointerGestureTransition(drag.phase, {
        type: 'move',
        deltaX: clientDeltaX,
        deltaY: clientDeltaY,
      });
      if (nextPhase === 'held') return;
      drag.phase = nextPhase;
      const item = completeLayoutById.get(drag.nodeId);
      if (item) setLayoutAnnouncement(`Moving ${nodeTitle(item.node)}. Use Escape to cancel.`);
    }

    event.preventDefault();
    event.stopPropagation();
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
    clearNodeHoldTimer(drag);
    nodeDragRef.current = null;
    const item = completeLayoutById.get(drag.nodeId);
    if (drag.phase === 'dragging') {
      event.preventDefault();
      event.stopPropagation();
      flushPendingNodeCenter();
      suppressNextNodeClick(drag.nodeId);
      if (item) setLayoutAnnouncement(`${nodeTitle(item.node)} moved. Save the layout to use it in reports.`);
    } else if (drag.phase === 'held') {
      event.preventDefault();
      event.stopPropagation();
      suppressNextNodeClick(drag.nodeId);
      if (item) setLayoutAnnouncement(`${nodeTitle(item.node)} selected. Press and hold again to move it.`);
    } else if (drag.phase === 'cancelled') {
      event.preventDefault();
      event.stopPropagation();
      suppressNextNodeClick(drag.nodeId);
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
    clearNodeHoldTimer(drag);
    suppressNextNodeClick(drag.nodeId);
    nodeDragRef.current = null;
    pendingNodeCenterRef.current = null;
    if (nodeDragFrameRef.current !== null) {
      window.cancelAnimationFrame(nodeDragFrameRef.current);
      nodeDragFrameRef.current = null;
    }
    const item = completeLayoutById.get(drag.nodeId);
    if (drag.phase === 'dragging') {
      applyNodeCenter(drag.nodeId, drag.originCenterX, drag.originCenterY);
      if (item) setLayoutAnnouncement(`Move cancelled for ${nodeTitle(item.node)}.`);
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
      setInfoCardState(CLOSED_ELECTRICAL_MAP_INFO_CARD);
      setArrangeMode(true);
      setLayoutAnnouncement('Arrange mode on. Press and hold a symbol before dragging, or focus it and press Enter or Space to move it with the keyboard.');
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
            <p id="electrical-tree-instructions" className="mt-1 text-xs text-[var(--text-sub)]">Grid at the top · switchboards and equipment aligned by supply level · click or tap one symbol for a compact summary{onSaveLayout ? ' · press and hold before dragging it' : ''}</p>
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
            {!visibleNodeIds && onSaveLayout ? <p className="w-full text-xs font-semibold text-[var(--text-sub)]">Press and hold a symbol, then drag to move it. A quick click only opens its compact summary. On touch, Arrange items enables full two-axis movement; it also enables keyboard controls.</p> : null}
          </div>
        ) : null}
        <p id="electrical-arrange-instructions" className="sr-only">In Arrange mode, press and hold a symbol before dragging it. With a keyboard, focus a symbol and press Enter or Space to pick it up, use arrow keys to move it, then press Enter or Space to finish. Press Escape to cancel.</p>
        <p id="electrical-pointer-drag-instructions" className="sr-only">Press and hold this symbol before dragging it. A quick click or tap opens one compact summary.</p>
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
                const channelIds = measurementChannelsByEdgeId.get(edge.id) || [];
                const boardChannels = boardChannelsById.get(edge.sourceNodeId) || [];
                const channelPoint = channelIds.flatMap((channelId) => {
                  const point = boardChannelConnectorPoint(source, boardChannels, channelId);
                  return point ? [{ channelId, point }] : [];
                })[0];
                const connectorSource: ElectricalTreeLayoutNode = channelPoint
                  ? {
                    ...source,
                    x: channelPoint.point.x - 0.5,
                    y: channelPoint.point.y - 0.5,
                    width: 1,
                    height: 1,
                  }
                  : source;
                return <path key={edge.id} data-channel-map={channelIds.join(',') || undefined} data-channel-port-id={channelPoint?.channelId} data-connector-origin={channelPoint ? 'channel-port' : 'board'} data-connector-geometry="straight" d={electricalTreeStraightPath(connectorSource, target, { targetYOffset: 13 })} fill="none" stroke="var(--primary)" strokeWidth="2.25" strokeDasharray="6 7" strokeLinecap="round" opacity="0.7" />;
              })}
            </svg>
            {layout.nodes.map((item, index) => {
              const presentation = NODE_PRESENTATION[item.node.kind];
              const visualSize = electricalTreeNodeVisualSize(item.node.kind);
              const symbol = electricalMapSymbolForNode(item.node);
              const symbolLabel = electricalMapSymbolLabel(symbol);
              const summary = cardSummaryById.get(item.node.id) || { devices: [], loadLabels: [], assignedAssets: [] };
              const interaction = interactionSummaryById.get(item.node.id)
                || electricalMapNodeInteractionSummary(tree, model, item.node.id);
              const boardChannels = boardChannelsById.get(item.node.id);
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
              const nodeActionLabel = arranging
                ? `Arrange ${symbolLabel}`
                : pointerDraggingAvailable
                  ? `Open a summary for ${symbolLabel}, or press and hold before dragging it`
                  : `Open a summary for ${symbolLabel}`;
              return (
                <button
                  key={item.node.id}
                  ref={(element) => {
                    if (element) nodeButtonRefs.current.set(item.node.id, element);
                    else nodeButtonRefs.current.delete(item.node.id);
                  }}
                  type="button"
                  data-electrical-node-id={item.node.id}
                  data-pointer-gesture={moving ? 'held-or-dragging' : 'idle'}
                  className={`group absolute overflow-visible rounded-[2rem] border border-transparent bg-transparent p-1 text-center transition-[filter] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-4 focus-visible:ring-offset-[#F8FBFF] ${moving ? 'cursor-grabbing' : 'cursor-pointer'} hover:brightness-[0.97] ${moving ? 'z-20 drop-shadow-[0_14px_24px_rgba(30,64,175,0.24)]' : selected ? 'z-10' : ''}`}
                  style={{
                    left: `${item.x}px`,
                    top: `${item.y}px`,
                    width: `${item.width}px`,
                    height: `${item.height}px`,
                    touchAction: arranging ? 'none' : 'pan-y pinch-zoom',
                  }}
                  aria-label={`${nodeActionLabel}: ${nodeTitle(item.node)}. ${ariaDetails}${arranging ? '. Press Enter or Space to move with the keyboard.' : pointerDraggingAvailable ? '. Press and hold before dragging, or click or press Enter for a compact summary.' : '. Click or press Enter for a compact summary.'}`}
                  aria-controls={infoCardNodeId === item.node.id ? 'electrical-map-info-card' : undefined}
                  aria-haspopup="dialog"
                  aria-describedby={arranging ? 'electrical-arrange-instructions' : pointerDraggingAvailable ? 'electrical-pointer-drag-instructions' : undefined}
                  aria-keyshortcuts={arranging ? 'Enter Space ArrowUp ArrowDown ArrowLeft ArrowRight Escape' : undefined}
                  aria-level={item.depth + 1}
                  aria-roledescription={arranging || pointerDraggingAvailable ? 'hold-draggable electrical map item' : undefined}
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
                    toggleNodeInfo(item.node.id);
                  }}
                  onContextMenu={(event) => {
                    if (pointerDraggingAvailable) event.preventDefault();
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                  onFocus={() => {
                    setSelectedNodeId(item.node.id);
                    if (!pointerFocusRef.current) centerNode(item.node.id);
                  }}
                  onBlur={() => {
                    if (keyboardDrag?.nodeId === item.node.id) cancelKeyboardNodeDrag();
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
                  <span className="flex h-full w-full flex-col items-center justify-start pt-1 text-center">
                    {coverage && item.node.kind === 'SITE_ASSET' ? (
                      <span className={`absolute right-0 top-0 z-10 rounded-full border border-white px-2 py-0.5 text-[7px] font-extrabold uppercase tracking-wide shadow-sm ${coverage.className}`}>{coverage.label}</span>
                    ) : null}
                    <span
                      className={`relative flex shrink-0 items-center justify-center rounded-full border-2 shadow-[0_10px_30px_rgba(15,23,42,0.10)] transition-[box-shadow,border-color,background-color] duration-200 group-hover:shadow-[0_14px_34px_rgba(30,64,175,0.16)] ${presentation.haloClassName} ${item.node.kind === 'VIRTUAL_RESIDUAL' ? 'border-dashed' : ''} ${selected ? 'ring-4 ring-[var(--primary)]/20 ring-offset-4 ring-offset-[#F8FBFF]' : ''}`}
                      style={{ width: visualSize.haloSize, height: visualSize.haloSize }}
                      aria-hidden="true"
                    >
                      <ElectricalMapSymbol
                        name={symbol}
                        size={visualSize.iconSize}
                        channels={boardChannels}
                      />
                      {item.node.kind === 'BOARD' && interaction.meterCount ? (
                        <span className="absolute -bottom-2 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--green)]/25 bg-white px-2 py-1 text-[8px] font-extrabold text-[var(--green)] shadow-sm">
                          <ElectricalMapSymbol name="node-meter" size={ELECTRICAL_MAP_LEGEND_SYMBOL_SIZES.meterBadge} />
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
                        <span className="max-w-full truncate rounded-full border border-[var(--green)]/25 bg-[var(--green-soft)] px-1.5 py-0.5 text-[var(--green)]">Load · {interaction.loadLabels.length ? compactList(interaction.loadLabels, 1) : item.node.typeLabel || symbolLabel}</span>
                        {interaction.assignedChannelCount ? <span className="rounded-full border border-[var(--primary)]/20 bg-[var(--primary-soft)] px-1.5 py-0.5 text-[var(--primary)]">{interaction.meterCount}m · {interaction.assignedChannelCount}ch</span> : null}
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
          {infoCardNode && infoCardInteraction && !arranging && !draggedNodeId ? (
            <aside
              ref={infoCardRef}
              id="electrical-map-info-card"
              data-electrical-info-card={infoCardNode.id}
              aria-labelledby="electrical-map-info-card-heading"
              role="dialog"
              tabIndex={-1}
              className="fixed bottom-3 left-3 right-3 z-[70] flex w-auto max-w-[20rem] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] sm:left-auto sm:right-3 sm:w-[20rem]"
              style={{
                bottom: 'max(0.75rem, env(safe-area-inset-bottom))',
                maxHeight: 'min(18rem, calc(100dvh - 1.5rem))',
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <p className="sr-only" aria-live="polite" aria-atomic="true">Selected {NODE_PRESENTATION[infoCardNode.kind].label}: {nodeTitle(infoCardNode)}.</p>
              <div className="flex shrink-0 items-start justify-between gap-2 border-b border-[var(--border)] bg-[var(--surface2)] px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <ElectricalMapSymbol name={electricalMapSymbolForNode(infoCardNode)} size={36} className="shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[9px] font-extrabold uppercase tracking-[0.1em] text-[var(--primary)]">{NODE_PRESENTATION[infoCardNode.kind].label}</p>
                    <h3 id="electrical-map-info-card-heading" className="truncate text-sm font-extrabold leading-5 text-[var(--text)]">{nodeTitle(infoCardNode)}</h3>
                  </div>
                </div>
                <Button variant="ghost" className="min-h-10 w-10 shrink-0 px-0 text-lg" aria-label="Close item summary" onClick={() => dismissInfoCard('close-button', true)}>×</Button>
              </div>
              <div className="min-h-0 overflow-y-auto px-3 py-2.5 text-xs leading-4 text-[var(--text-sub)]">
                <dl className="space-y-1.5">
                  <div><dt className="inline font-extrabold text-[var(--text)]">Location: </dt><dd className="inline">{nodeZone(tree, infoCardNode)}</dd></div>
                  <div><dt className="inline font-extrabold text-[var(--text)]">{infoCardNode.kind === 'VIRTUAL_RESIDUAL' ? 'Calculated from' : 'Supplied from'}: </dt><dd className="inline">{infoCardParent ? <button type="button" className="font-bold text-[var(--primary)] underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]" onClick={() => revealNode(infoCardParent.id)}>{nodeTitle(infoCardParent)}</button> : 'Grid root'}</dd></div>
                  <div><dt className="inline font-extrabold text-[var(--text)]">Load: </dt><dd className="inline">{infoCardInteraction.loadLabels.length ? compactList(infoCardInteraction.loadLabels, 2) : infoCardNode.typeLabel || 'No confirmed load label'}</dd></div>
                </dl>
                <p className="mt-2 border-y border-[var(--border)] py-2 font-bold text-[var(--text)]">{infoCardInteraction.downstreamLoadCount} load{infoCardInteraction.downstreamLoadCount === 1 ? '' : 's'} · {infoCardInteraction.meterCount} meter{infoCardInteraction.meterCount === 1 ? '' : 's'} · {infoCardInteraction.assignedChannelCount} mapped channel{infoCardInteraction.assignedChannelCount === 1 ? '' : 's'}</p>
                {infoCardChannels.length ? (
                  <div className="mt-2">
                    <p className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-[var(--muted)]">Channel mapping</p>
                    <ul className="mt-1 space-y-1">
                      {infoCardChannels.slice(0, 2).map((channel) => (
                        <li key={`${channel.meterId}:${channel.id}`} className="truncate"><strong className="text-[var(--primary)]">{channel.meterName}</strong> · {channel.label}</li>
                      ))}
                    </ul>
                    {infoCardChannels.length > 2 ? <p className="mt-1 font-bold text-[var(--primary)]">+{infoCardChannels.length - 2} more mapped channels</p> : null}
                  </div>
                ) : null}
                <LinkButton href={getNodeHref(infoCardNode)} className="mt-2.5 w-full">Open full record<Icon name="arrow-right" size={15} /></LinkButton>
              </div>
            </aside>
          ) : null}
        </div>
        <div id="electrical-tree-key" className="border-t border-[var(--border)] bg-white px-4 py-4" aria-labelledby="electrical-tree-key-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 id="electrical-tree-key-heading" className="text-sm font-extrabold text-[var(--text)]">How to read this map</h4>
            <p className="text-[11px] text-[var(--text-sub)]">Every schematic symbol represents one confirmed item · select one for a compact summary</p>
          </div>
          <div className="mt-3 grid gap-4 lg:grid-cols-[0.8fr_1.5fr_1.2fr]">
            <section aria-labelledby="electrical-node-symbols-heading">
              <h5 id="electrical-node-symbols-heading" className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[var(--muted)]">System symbols</h5>
              <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-[11px] text-[var(--text-sub)]">
                {ELECTRICAL_MAP_NODE_SYMBOLS.map((item) => (
                  <li key={item.label} className="flex items-center gap-2">
                    <ElectricalMapSymbol name={item.symbol} size={ELECTRICAL_MAP_LEGEND_SYMBOL_SIZES.system} className="shrink-0" />
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
                    <ElectricalMapSymbol name={item.symbol} size={ELECTRICAL_MAP_LEGEND_SYMBOL_SIZES.load} className="shrink-0" />
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
                  <li key={state}><span className={`inline-flex rounded-full px-2 py-0.5 font-extrabold uppercase tracking-wide ${status.className}`}>{status.label}</span></li>
                ))}
                </ul>
              </div>
            </section>
          </div>
          <p className="mt-3 border-t border-[var(--border)] pt-3 text-[10px] leading-4 text-[var(--text-sub)]"><strong className="text-[var(--text)]">Explore:</strong> click or tap a symbol to show the one compact summary card; use arrow, Home, and End keys between items; drag the background or use Touch pan to move the view; double-click to fit.{onSaveLayout ? ' Press and hold a symbol before dragging it, then save the layout for reports; Arrange items also enables keyboard movement.' : ''} Items still to be confirmed stay outside this client view.</p>
        </div>
      </section>
    </div>
  );
}
