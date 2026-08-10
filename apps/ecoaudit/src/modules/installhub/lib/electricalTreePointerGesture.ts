/** Deliberate pause required before a pointer can reposition a map item. */
export const ELECTRICAL_TREE_HOLD_DELAY_MS = 425;

/** Screen-space movement tolerated while waiting for the hold to complete. */
export const ELECTRICAL_TREE_HOLD_SLOP_PX = 10;

/** Screen-space movement required after a hold before the item starts moving. */
export const ELECTRICAL_TREE_DRAG_SLOP_PX = 3;

export type ElectricalTreePointerGesturePhase =
  | 'pressing'
  | 'held'
  | 'dragging'
  | 'cancelled';

export type ElectricalTreePointerGestureAction =
  | { type: 'hold' }
  | { type: 'move'; deltaX: number; deltaY: number };

function pointerDistance(deltaX: number, deltaY: number): number | null {
  if (![deltaX, deltaY].every(Number.isFinite)) return null;
  return Math.hypot(deltaX, deltaY);
}

/**
 * Pure phase transitions for the map's press-and-hold pointer gesture.
 * Timing, pointer capture, coordinates and cleanup remain component concerns.
 */
export function electricalTreePointerGestureTransition(
  phase: ElectricalTreePointerGesturePhase,
  action: ElectricalTreePointerGestureAction,
): ElectricalTreePointerGesturePhase {
  if (phase === 'cancelled' || phase === 'dragging') return phase;

  if (action.type === 'hold') {
    return phase === 'pressing' ? 'held' : phase;
  }

  const distance = pointerDistance(action.deltaX, action.deltaY);
  if (distance === null) return 'cancelled';

  if (phase === 'pressing') {
    return distance <= ELECTRICAL_TREE_HOLD_SLOP_PX ? 'pressing' : 'cancelled';
  }

  return distance >= ELECTRICAL_TREE_DRAG_SLOP_PX ? 'dragging' : 'held';
}
