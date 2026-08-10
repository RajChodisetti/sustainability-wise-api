import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ELECTRICAL_MAP_MAX_VISIBLE_BOARD_CHANNELS,
  electricalMapBoardChannelConnectorSlots,
  electricalMapBoardChannelLayout,
  electricalMapChannelConnectorNodeId,
} from './electricalMapBoardChannels';

test('board channel layout keeps meter-qualified phases and stable port identities', () => {
  const layout = electricalMapBoardChannelLayout([
    { id: 'm2-c1', meterLabel: 'M2', ordinal: 1, phaseLabel: 'L2', purpose: 'SUB_CIRCUIT' },
    { id: 'm1-c2', meterLabel: 'M1', ordinal: 2, phaseLabel: 'L3', purpose: 'SPARE', assigned: true },
    { id: 'm1-c1', meterLabel: 'M1', ordinal: 1, phaseLabel: 'L1', purpose: 'MAIN_SUPPLY', assigned: true },
  ]);

  assert.deepEqual(layout.map((item) => item.channel.id), ['m1-c1', 'm1-c2', 'm2-c1']);
  assert.deepEqual(layout.map((item) => item.label), [
    'M1 · CH 1 · L1',
    'M1 · CH 2 · L3',
    'M2 · CH 1 · L2',
  ]);
  assert.deepEqual(layout.map((item) => item.state), ['assigned', 'spare', 'available']);
  assert.ok(layout.every((item) => item.portSide === 'right' && item.portX === 55));
});

test('dense board channels split into bounded left and right connector columns', () => {
  const channels = Array.from({ length: 15 }, (_, index) => ({
    id: `channel-${index + 1}`,
    meterLabel: 'M1',
    ordinal: index + 1,
  }));
  const layout = electricalMapBoardChannelLayout(channels);

  assert.equal(layout.length, ELECTRICAL_MAP_MAX_VISIBLE_BOARD_CHANNELS);
  assert.equal(layout.filter((item) => item.portSide === 'left').length, 6);
  assert.equal(layout.filter((item) => item.portSide === 'right').length, 6);
  assert.ok(layout.every((item) => item.portY >= 21 && item.portY <= 52));
});

test('mapped phases receive one stable visible connector each', () => {
  const channels = [
    { id: 'l1', meterLabel: 'M1', ordinal: 1, phaseLabel: 'L1' },
    { id: 'l2', meterLabel: 'M1', ordinal: 2, phaseLabel: 'L2' },
    { id: 'l3', meterLabel: 'M1', ordinal: 3, phaseLabel: 'L3' },
  ];
  const slots = electricalMapBoardChannelConnectorSlots(
    channels,
    ['l3', 'l1', 'l2', 'l1', 'not-visible'],
  );

  assert.deepEqual(slots.map((slot) => slot.channelId), ['l3', 'l1', 'l2']);
  assert.ok(slots.every((slot) => Number.isFinite(slot.portX) && Number.isFinite(slot.portY)));
});

test('channel connector node ids remain distinct from their board for self-target stubs', () => {
  assert.equal(
    electricalMapChannelConnectorNodeId('board-a', 'channel-l1'),
    'board-a:channel-port:channel-l1',
  );
  assert.notEqual(electricalMapChannelConnectorNodeId('board-a', 'channel-l1'), 'board-a');
});
