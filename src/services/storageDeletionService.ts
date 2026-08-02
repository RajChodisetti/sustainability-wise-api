import {
  and,
  asc,
  desc,
  eq,
  inArray,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db } from '../db/client.js';
import { storageDeletionTasks } from '../db/schema/shared.js';
import { deleteLocalFile } from '../storage/localFiles.js';

export type StorageDeletionDrainInput = {
  ids?: string[];
  app?: string;
  /** Maximum rows fetched per database page, not a total task limit. */
  limit?: number;
};

export type StorageDeletionTaskCursor = {
  /** Database-precision timestamp text; avoids truncating PostgreSQL microseconds through Date. */
  createdAt: string;
  id: string;
};

export type StorageDeletionTask = StorageDeletionTaskCursor & {
  storageKey: string;
};

export type StorageDeletionDrainDependencies = {
  findBoundary: (
    input: StorageDeletionDrainInput,
  ) => Promise<StorageDeletionTaskCursor | undefined>;
  findBatch: (input: StorageDeletionDrainInput & {
    after?: StorageDeletionTaskCursor;
    through: StorageDeletionTaskCursor;
    limit: number;
  }) => Promise<StorageDeletionTask[]>;
  deleteStoredFile: (storageKey: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  markTaskFailed: (id: string) => Promise<void>;
};

export type StorageDeletionDrainResult = {
  deleted: number;
  pending: number;
};

function compareTaskCursors(
  left: StorageDeletionTaskCursor,
  right: StorageDeletionTaskCursor,
): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

/**
 * Drains the matching tasks that exist through the invocation's initial upper
 * boundary. Keyset pagination advances past every selected row, including a
 * failed row, so one permanently failing delete cannot be retried forever in
 * the same invocation or prevent later tasks from being visited.
 */
export async function drainStorageDeletionTaskBatches(
  input: StorageDeletionDrainInput,
  dependencies: StorageDeletionDrainDependencies,
): Promise<StorageDeletionDrainResult> {
  if (input.ids && input.ids.length === 0) return { deleted: 0, pending: 0 };

  const boundary = await dependencies.findBoundary(input);
  if (!boundary) return { deleted: 0, pending: 0 };

  const batchSize = Math.max(1, Math.min(input.limit ?? 1_000, 1_000));
  let deleted = 0;
  let pending = 0;
  let after: StorageDeletionTaskCursor | undefined;

  while (true) {
    const tasks = await dependencies.findBatch({
      ...input,
      after,
      through: boundary,
      limit: batchSize,
    });
    if (!tasks.length) break;

    for (const task of tasks) {
      try {
        await dependencies.deleteStoredFile(task.storageKey);
        await dependencies.deleteTask(task.id);
        deleted += 1;
      } catch {
        await dependencies.markTaskFailed(task.id);
        pending += 1;
      }
    }

    const lastTask = tasks[tasks.length - 1];
    if (after && compareTaskCursors(lastTask, after) <= 0) {
      throw new Error('Storage deletion task keyset did not advance');
    }
    after = { createdAt: lastTask.createdAt, id: lastTask.id };
  }

  return { deleted, pending };
}

function taskFilterConditions(input: StorageDeletionDrainInput): SQL[] {
  const conditions: SQL[] = [];
  if (input.ids) conditions.push(inArray(storageDeletionTasks.id, input.ids));
  if (input.app) conditions.push(eq(storageDeletionTasks.app, input.app));
  return conditions;
}

const databaseDependencies: StorageDeletionDrainDependencies = {
  async findBoundary(input) {
    const conditions = taskFilterConditions(input);
    const [boundary] = await db
      .select({
        createdAt: sql<string>`${storageDeletionTasks.createdAt}::text`,
        id: storageDeletionTasks.id,
      })
      .from(storageDeletionTasks)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(storageDeletionTasks.createdAt), desc(storageDeletionTasks.id))
      .limit(1);
    return boundary;
  },

  async findBatch(input) {
    const conditions = [
      ...taskFilterConditions(input),
      sql`(${storageDeletionTasks.createdAt}, ${storageDeletionTasks.id}) <= (${input.through.createdAt}::timestamp, ${input.through.id})`,
    ];
    if (input.after) {
      conditions.push(
        sql`(${storageDeletionTasks.createdAt}, ${storageDeletionTasks.id}) > (${input.after.createdAt}::timestamp, ${input.after.id})`,
      );
    }
    return db
      .select({
        createdAt: sql<string>`${storageDeletionTasks.createdAt}::text`,
        id: storageDeletionTasks.id,
        storageKey: storageDeletionTasks.storageKey,
      })
      .from(storageDeletionTasks)
      .where(and(...conditions))
      .orderBy(asc(storageDeletionTasks.createdAt), asc(storageDeletionTasks.id))
      .limit(input.limit);
  },

  deleteStoredFile: deleteLocalFile,

  async deleteTask(id) {
    await db.delete(storageDeletionTasks).where(eq(storageDeletionTasks.id, id));
  },

  async markTaskFailed(id) {
    await db.update(storageDeletionTasks).set({
      attempts: sql`${storageDeletionTasks.attempts} + 1`,
      lastError: 'storage_delete_failed',
    }).where(eq(storageDeletionTasks.id, id));
  },
};

export async function drainStorageDeletionTasks(
  input: StorageDeletionDrainInput = {},
): Promise<StorageDeletionDrainResult> {
  return drainStorageDeletionTaskBatches(input, databaseDependencies);
}
