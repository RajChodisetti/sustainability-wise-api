import assert from 'node:assert/strict';
import test from 'node:test';
import {
  moveReportZone,
  orderReportZoneRecords,
  reconcileReportZoneOrder,
} from './reportZoneOrder';

test('report zone state preserves user order, removes missing zones, and appends new zones', () => {
  assert.deepEqual(
    reconcileReportZoneOrder(
      ['zone-c', 'deleted-zone', 'zone-a'],
      ['zone-a', 'zone-b', 'zone-c', 'zone-d'],
    ),
    ['zone-c', 'zone-a', 'zone-b', 'zone-d'],
  );
});

test('report zones move one position without mutating the existing order', () => {
  const original = ['zone-a', 'zone-b', 'zone-c'];
  assert.deepEqual(moveReportZone(original, 'zone-c', -1), ['zone-a', 'zone-c', 'zone-b']);
  assert.deepEqual(original, ['zone-a', 'zone-b', 'zone-c']);
  assert.equal(moveReportZone(original, 'zone-a', -1), original);
});

test('report zone records render in the selected order', () => {
  const zones = [{ id: 'zone-a' }, { id: 'zone-b' }, { id: 'zone-c' }];
  assert.deepEqual(
    orderReportZoneRecords(zones, ['zone-c', 'zone-a']).map((zone) => zone.id),
    ['zone-c', 'zone-a', 'zone-b'],
  );
});
