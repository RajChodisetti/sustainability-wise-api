import assert from 'node:assert/strict';
import test from 'node:test';
import {
  drainStorageDeletionTaskBatches,
  SCHEDULER_INVOICE_PDF_CLEANUP_LEASE_MS,
  SCHEDULER_INVOICE_PDF_UNATTACHED_REASON,
  type StorageDeletionDrainDependencies,
  type StorageDeletionDrainInput,
  type StorageDeletionTask,
} from './storageDeletionService.js';

type FakeTask = StorageDeletionTask & {
  app: string;
  reason: string;
  attempts: number;
};

function fakeDeletionStore(initialTasks: FakeTask[], failingIds: Set<string> = new Set()) {
  const tasks = new Map(initialTasks.map((task) => [task.id, structuredClone(task)]));
  const attempted = new Map<string, number>();
  const batchSizes: number[] = [];
  let boundaryCalls = 0;
  let onFirstDelete: (() => void) | undefined;

  const compareCursor = (
    left: { createdAt: string; id: string },
    right: { createdAt: string; id: string },
  ): number => (
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
  );

  const matching = (input: StorageDeletionDrainInput): FakeTask[] => {
    const ids = input.ids ? new Set(input.ids) : null;
    return [...tasks.values()].filter((task) => (
      (!ids || ids.has(task.id))
      && (!input.app || task.app === input.app)
      && (
        ids
        || task.reason !== SCHEDULER_INVOICE_PDF_UNATTACHED_REASON
        || new Date(task.createdAt).getTime() <= (
          (input.now ?? new Date()).getTime() - SCHEDULER_INVOICE_PDF_CLEANUP_LEASE_MS
        )
      )
    ));
  };
  const dependencies: StorageDeletionDrainDependencies = {
    async findBoundary(input) {
      boundaryCalls += 1;
      return matching(input).sort(compareCursor).at(-1);
    },
    async findBatch(input) {
      const batch = matching(input)
        .filter((task) => !input.after || compareCursor(task, input.after) > 0)
        .filter((task) => compareCursor(task, input.through) <= 0)
        .sort(compareCursor)
        .slice(0, input.limit);
      batchSizes.push(batch.length);
      return batch;
    },
    async deleteStoredFile(storageKey) {
      const task = [...tasks.values()].find((candidate) => candidate.storageKey === storageKey);
      assert.ok(task);
      attempted.set(task.id, (attempted.get(task.id) ?? 0) + 1);
      if (onFirstDelete) {
        const callback = onFirstDelete;
        onFirstDelete = undefined;
        callback();
      }
      if (failingIds.has(task.id)) throw new Error('simulated storage failure');
    },
    async deleteTask(id) {
      tasks.delete(id);
    },
    async markTaskFailed(id) {
      const task = tasks.get(id);
      assert.ok(task);
      task.attempts += 1;
    },
  };

  return {
    tasks,
    attempted,
    batchSizes,
    dependencies,
    get boundaryCalls() { return boundaryCalls; },
    insertDuringFirstDelete(task: FakeTask) {
      onFirstDelete = () => tasks.set(task.id, task);
    },
  };
}

function task(
  id: string,
  app = 'installhub',
  createdAt = '2026-08-01 00:00:00.123456',
): FakeTask {
  return {
    id,
    createdAt,
    app,
    storageKey: `${app}/deletion-test/${id}.bin`,
    reason: 'test_cleanup',
    attempts: 0,
  };
}

test('drain visits every initially matching task beyond 1000 in bounded keyset pages', async () => {
  const selected = Array.from({ length: 1_205 }, (_, index) => (
    task(`selected-${String(index).padStart(5, '0')}`)
  ));
  const otherApp = Array.from({ length: 11 }, (_, index) => (
    task(`other-${String(index).padStart(5, '0')}`, 'ecoaudit')
  ));
  const unselected = task('unselected-installhub');
  const future = task(
    '00000-lexically-lower-future',
    'installhub',
    '2026-08-01 00:00:00.123457',
  );
  const store = fakeDeletionStore([...selected, ...otherApp, unselected]);
  store.insertDuringFirstDelete(future);
  const ids = [
    ...selected.map((item) => item.id),
    ...otherApp.map((item) => item.id),
    future.id,
  ];

  const first = await drainStorageDeletionTaskBatches({
    ids,
    app: 'installhub',
    limit: 137,
  }, store.dependencies);
  assert.deepEqual(first, { deleted: 1_205, pending: 0 });
  assert.ok(store.batchSizes.filter(Boolean).length > 1);
  assert.ok(store.batchSizes.every((size) => size <= 137));
  assert.ok(selected.every((item) => store.attempted.get(item.id) === 1));
  assert.ok(
    store.tasks.has(future.id),
    'a later task waits even when its random id sorts below the initial id boundary',
  );
  assert.ok(store.tasks.has(unselected.id));
  assert.ok(otherApp.every((item) => store.tasks.has(item.id)));

  const second = await drainStorageDeletionTaskBatches({ ids, app: 'installhub' }, store.dependencies);
  assert.deepEqual(second, { deleted: 1, pending: 0 });
  assert.equal(store.attempted.get(future.id), 1);
});

test('failed tasks are attempted once per invocation and do not block later pages', async () => {
  const initial = Array.from({ length: 1_003 }, (_, index) => (
    task(`failure-run-${String(index).padStart(5, '0')}`)
  ));
  const failingIds = new Set([
    initial[0].id,
    initial[999].id,
    initial[1_002].id,
  ]);
  const store = fakeDeletionStore(initial, failingIds);

  const first = await drainStorageDeletionTaskBatches({ app: 'installhub' }, store.dependencies);
  assert.deepEqual(first, { deleted: 1_000, pending: 3 });
  assert.equal(store.tasks.size, 3);
  assert.ok(initial.every((item) => store.attempted.get(item.id) === 1));
  for (const id of failingIds) assert.equal(store.tasks.get(id)?.attempts, 1);

  const second = await drainStorageDeletionTaskBatches({ app: 'installhub' }, store.dependencies);
  assert.deepEqual(second, { deleted: 0, pending: 3 });
  for (const id of failingIds) {
    assert.equal(store.attempted.get(id), 2);
    assert.equal(store.tasks.get(id)?.attempts, 2);
  }
});

test('an explicit empty id filter drains nothing', async () => {
  const store = fakeDeletionStore([task('must-remain')]);
  assert.deepEqual(
    await drainStorageDeletionTaskBatches({ ids: [] }, store.dependencies),
    { deleted: 0, pending: 0 },
  );
  assert.equal(store.boundaryCalls, 0);
  assert.ok(store.tasks.has('must-remain'));
});

test('global sweeps lease fresh invoice exports while explicit failure cleanup stays immediate', async () => {
  const now = new Date('2026-08-16T12:00:00.000Z');
  const fresh = {
    ...task('fresh-export', 'ecoaudit', '2026-08-16T11:30:00.000Z'),
    reason: SCHEDULER_INVOICE_PDF_UNATTACHED_REASON,
  };
  const stale = {
    ...task('stale-export', 'ecoaudit', '2026-08-16T10:59:59.999Z'),
    reason: SCHEDULER_INVOICE_PDF_UNATTACHED_REASON,
  };
  const ordinary = task('ordinary-cleanup', 'ecoaudit', '2026-08-16T11:59:00.000Z');
  const store = fakeDeletionStore([fresh, stale, ordinary]);

  assert.deepEqual(
    await drainStorageDeletionTaskBatches({ app: 'ecoaudit', now }, store.dependencies),
    { deleted: 2, pending: 0 },
  );
  assert.ok(store.tasks.has(fresh.id), 'a rolling-startup sweep cannot delete a live export');
  assert.equal(store.tasks.has(stale.id), false, 'an abandoned export is eventually eligible');
  assert.equal(store.tasks.has(ordinary.id), false, 'the lease is specific to invoice exports');

  assert.deepEqual(
    await drainStorageDeletionTaskBatches({ ids: [fresh.id], now }, store.dependencies),
    { deleted: 1, pending: 0 },
  );
  assert.equal(store.tasks.has(fresh.id), false, 'a known failed write bypasses the lease');
});

test('periodic cleanup respects the total task bound', async () => {
  const store = fakeDeletionStore(Array.from({ length: 12 }, (_, index) => (
    task(`bounded-${String(index).padStart(2, '0')}`)
  )));
  assert.deepEqual(
    await drainStorageDeletionTaskBatches({ maxTasks: 5, limit: 2 }, store.dependencies),
    { deleted: 5, pending: 0 },
  );
  assert.equal(store.tasks.size, 7);
});
