const EXPORT_JOB_CONCURRENCY = 1;

type QueuedTask<T> = {
  run: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

const queue: QueuedTask<unknown>[] = [];
let activeTasks = 0;

function drainQueue(): void {
  while (activeTasks < EXPORT_JOB_CONCURRENCY && queue.length > 0) {
    const task = queue.shift();
    if (!task) return;
    activeTasks += 1;
    void task.run()
      .then(task.resolve, task.reject)
      .finally(() => {
        activeTasks -= 1;
        drainQueue();
      });
  }
}

export function enqueueExportTask<T>(run: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ run, resolve, reject } as QueuedTask<unknown>);
    drainQueue();
  });
}

export function exportJobQueueStats(): { active: number; queued: number } {
  return { active: activeTasks, queued: queue.length };
}
