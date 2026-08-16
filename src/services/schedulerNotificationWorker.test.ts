import assert from 'node:assert/strict';
import test from 'node:test';
import {
  automaticNotificationStillRelevant,
  chunkExpoItems,
  schedulerAndroidChannel,
} from './schedulerNotificationWorker.js';

test('Expo message and receipt batches stay within service limits', () => {
  const messages = chunkExpoItems(Array.from({ length: 205 }, (_, index) => index), 100);
  assert.deepEqual(messages.map((batch) => batch.length), [100, 100, 5]);
  assert.deepEqual(chunkExpoItems([], 100), []);
  assert.throws(() => chunkExpoItems([1], 0));
});

test('recovered automatic jobs expire before their copy becomes misleading', () => {
  const start = new Date('2026-08-20T09:00:00.000Z');
  assert.equal(automaticNotificationStillRelevant(
    'one_day_before',
    start,
    null,
    new Date('2026-08-20T08:59:59.999Z'),
  ), true);
  assert.equal(automaticNotificationStillRelevant('one_day_before', start, null, start), false);
  assert.equal(automaticNotificationStillRelevant(
    'day_of',
    start,
    null,
    new Date('2026-08-21T08:59:59.999Z'),
  ), true);
  assert.equal(automaticNotificationStillRelevant(
    'day_of',
    start,
    null,
    new Date('2026-08-21T09:00:00.000Z'),
  ), false);
  assert.equal(automaticNotificationStillRelevant(
    'assigned',
    start,
    null,
    new Date('2026-08-30T09:00:00.000Z'),
  ), true);
  assert.equal(automaticNotificationStillRelevant(
    'day_of',
    start,
    new Date('2026-08-20T11:00:00.000Z'),
    new Date('2026-08-20T11:00:00.000Z'),
  ), false);
  assert.equal(automaticNotificationStillRelevant(
    'day_of',
    start,
    start,
    start,
  ), true);
});

test('Android channel IDs match each shipped mobile app contract', () => {
  assert.equal(schedulerAndroidChannel('ecoaudit'), 'scheduler-updates');
  assert.equal(schedulerAndroidChannel('solarsense'), 'scheduler-updates');
  assert.equal(schedulerAndroidChannel('installhub'), 'scheduler');
});
