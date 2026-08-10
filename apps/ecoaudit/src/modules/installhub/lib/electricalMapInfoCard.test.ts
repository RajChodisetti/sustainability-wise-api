import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLOSED_ELECTRICAL_MAP_INFO_CARD,
  electricalMapInfoCardNodeId,
  reduceElectricalMapInfoCard,
  type ElectricalMapInfoCardState,
} from './electricalMapInfoCard';

function clickNode(
  state: ElectricalMapInfoCardState,
  nodeId: string,
): ElectricalMapInfoCardState {
  return reduceElectricalMapInfoCard(state, { type: 'node-clicked', nodeId });
}

test('clicking a second node replaces the only pinned information card', () => {
  const first = clickNode(CLOSED_ELECTRICAL_MAP_INFO_CARD, 'node-a');
  const second = clickNode(first, 'node-b');

  assert.deepEqual(first, { status: 'pinned', nodeId: 'node-a' });
  assert.deepEqual(second, { status: 'pinned', nodeId: 'node-b' });
  assert.equal(electricalMapInfoCardNodeId(second), 'node-b');
});

test('clicking the pinned node again toggles the information card closed', () => {
  const pinned = clickNode(CLOSED_ELECTRICAL_MAP_INFO_CARD, 'node-a');
  const closed = clickNode(pinned, 'node-a');

  assert.deepEqual(closed, { status: 'closed' });
  assert.equal(electricalMapInfoCardNodeId(closed), null);
});

test('Escape dismisses the pinned information card', () => {
  const pinned = clickNode(CLOSED_ELECTRICAL_MAP_INFO_CARD, 'node-a');
  const closed = reduceElectricalMapInfoCard(pinned, {
    type: 'dismissed',
    reason: 'escape',
  });

  assert.deepEqual(closed, { status: 'closed' });
});

test('an outside click dismisses the pinned information card', () => {
  const pinned = clickNode(CLOSED_ELECTRICAL_MAP_INFO_CARD, 'node-a');
  const closed = reduceElectricalMapInfoCard(pinned, {
    type: 'dismissed',
    reason: 'outside',
  });

  assert.deepEqual(closed, { status: 'closed' });
});

test('dismissing an already closed card is stable', () => {
  const closed = reduceElectricalMapInfoCard(CLOSED_ELECTRICAL_MAP_INFO_CARD, {
    type: 'dismissed',
    reason: 'close-button',
  });

  assert.equal(closed, CLOSED_ELECTRICAL_MAP_INFO_CARD);
});
