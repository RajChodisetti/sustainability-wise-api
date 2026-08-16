import {
  and,
  asc,
  desc,
  eq,
  inArray,
  lte,
  ne,
  or,
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
  /** Optional total visit bound for periodic/background sweeps. */
  maxTasks?: number;
  /** Injectable wall clock for cleanup-lease tests. */
  now?: Date;
};

export const SCHEDULER_INVOICE_PDF_UNATTACHED_REASON = 'scheduler_invoice_pdf_unattached';
export const SCHEDULER_INVOICE_PDF_CLEANUP_LEASE_MS = 60 * 60 * 1_000;

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
  const maximumTasks = Math.max(1, Math.min(input.maxTasks ?? Number.MAX_SAFE_INTEGER, 10_000));
  let deleted = 0;
  let pending = 0;
  let visited = 0;
  let after: StorageDeletionTaskCursor | undefined;

  while (visited < maximumTasks) {
    const tasks = await dependencies.findBatch({
      ...input,
      after,
      through: boundary,
      limit: Math.min(batchSize, maximumTasks - visited),
    });
    if (!tasks.length) break;

    for (const task of tasks) {
      visited += 1;
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
  if (!input.ids) {
    // `created_at` is a PostgreSQL timestamp without time zone. Comparing it
    // with a JS Date directly serializes the Date's UTC wall clock and can make
    // a fresh task appear hours old when the database session is not UTC. Keep
    // the cutoff in the database's local timestamp domain instead.
    const leaseCutoff = input.now
      ? sql`(${input.now.toISOString()}::timestamptz AT TIME ZONE current_setting('TimeZone')) - (${SCHEDULER_INVOICE_PDF_CLEANUP_LEASE_MS} * INTERVAL '1 millisecond')`
      : sql`LOCALTIMESTAMP - (${SCHEDULER_INVOICE_PDF_CLEANUP_LEASE_MS} * INTERVAL '1 millisecond')`;
    conditions.push(or(
      ne(storageDeletionTasks.reason, SCHEDULER_INVOICE_PDF_UNATTACHED_REASON),
      lte(storageDeletionTasks.createdAt, leaseCutoff),
    )!);
  }
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
