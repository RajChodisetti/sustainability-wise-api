import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueExportTask, exportJobQueueStats } from './exportJobQueue.js';

test('export queue serializes heavy export tasks', async () => {
  let active = 0;
  let maxActive = 0;
  const completed: number[] = [];

  await Promise.all(Array.from({ length: 6 }, (_, index) => enqueueExportTask(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    completed.push(index);
    active -= 1;
  })));

  assert.equal(maxActive, 1);
  assert.deepEqual(completed, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(exportJobQueueStats(), { active: 0, queued: 0 });
});
