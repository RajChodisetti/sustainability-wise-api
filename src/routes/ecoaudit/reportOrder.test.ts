import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeReportIdList,
  orderReportItemsByZone,
  orderReportZones,
} from './reportOrder.js';

test('report zone order is explicit first, then deterministic by creation time and id', () => {
  const zones = [
    { id: 'zone-b', createdAt: new Date('2026-01-02T00:00:00.000Z') },
    { id: 'zone-c', createdAt: new Date('2026-01-01T00:00:00.000Z') },
    { id: 'zone-a', createdAt: new Date('2026-01-01T00:00:00.000Z') },
  ];

  assert.deepEqual(
    orderReportZones(zones, []).map((zone) => zone.id),
    ['zone-a', 'zone-c', 'zone-b'],
  );
  assert.deepEqual(
    orderReportZones(zones, ['zone-b', 'missing-zone']).map((zone) => zone.id),
    ['zone-b', 'zone-a', 'zone-c'],
  );
});

test('report equipment follows zone order and is deterministic within each zone', () => {
  const items = [
    { id: 'b-2', zoneId: 'zone-b', createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'a-2', zoneId: 'zone-a', createdAt: '2026-01-02T00:00:00.000Z' },
    { id: 'a-1', zoneId: 'zone-a', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'orphan', zoneId: 'missing-zone', createdAt: '2025-01-01T00:00:00.000Z' },
  ];

  assert.deepEqual(
    orderReportItemsByZone(items, ['zone-b', 'zone-a']).map((item) => item.id),
    ['b-2', 'a-1', 'a-2', 'orphan'],
  );
});

test('report id lists discard invalid and duplicate request values', () => {
  assert.deepEqual(
    normalizeReportIdList([' zone-b ', 'zone-a', 'zone-b', '', null, 3]),
    ['zone-b', 'zone-a'],
  );
});
