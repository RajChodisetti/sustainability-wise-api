export type ElectricalMapInfoCardState =
  | { status: 'closed' }
  | { status: 'pinned'; nodeId: string };

export type ElectricalMapInfoCardDismissReason =
  | 'close-button'
  | 'escape'
  | 'outside';

export type ElectricalMapInfoCardEvent =
  | { type: 'node-clicked'; nodeId: string }
  | { type: 'dismissed'; reason: ElectricalMapInfoCardDismissReason };

export const CLOSED_ELECTRICAL_MAP_INFO_CARD: ElectricalMapInfoCardState = {
  status: 'closed',
};

/**
 * Owns the single pinned information card shown over the electrical map.
 * Clicking another node replaces the active node; clicking the active node
 * toggles the card closed. Every dismiss interaction has the same outcome.
 */
export function reduceElectricalMapInfoCard(
  state: ElectricalMapInfoCardState,
  event: ElectricalMapInfoCardEvent,
): ElectricalMapInfoCardState {
  if (event.type === 'dismissed') {
    return state.status === 'closed' ? state : CLOSED_ELECTRICAL_MAP_INFO_CARD;
  }

  if (state.status === 'pinned' && state.nodeId === event.nodeId) {
    return CLOSED_ELECTRICAL_MAP_INFO_CARD;
  }

  return { status: 'pinned', nodeId: event.nodeId };
}

export function electricalMapInfoCardNodeId(
  state: ElectricalMapInfoCardState,
): string | null {
  return state.status === 'pinned' ? state.nodeId : null;
}
