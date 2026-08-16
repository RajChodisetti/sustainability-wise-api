import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  globalUserCredentials,
  globalUsers,
  unifiedUsers,
} from '../db/schema/shared.js';
import { verifyPassword } from './apiKey.js';
import { verifyGlobalLoginIdentity } from './loginIdentity.js';

export type GlobalProductApp = 'ecoaudit' | 'solarsense' | 'installhub';

/** Accept every preserved credential belonging to this exact membership. */
export async function verifyGlobalUserPassword(
  app: GlobalProductApp,
  productUserId: string,
  password: string,
): Promise<boolean> {
  const candidates = await db
    .select({
      globalUserId: globalUsers.id,
      passwordHash: globalUserCredentials.passwordHash,
      isActive: globalUsers.isActive,
    })
    .from(unifiedUsers)
    .innerJoin(globalUsers, eq(globalUsers.id, unifiedUsers.globalUserId))
    .innerJoin(
      globalUserCredentials,
      eq(globalUserCredentials.globalUserId, globalUsers.id),
    )
    .where(and(
      eq(unifiedUsers.originApp, app),
      eq(unifiedUsers.originUserId, productUserId),
      eq(unifiedUsers.isActive, true),
      isNull(unifiedUsers.deletedAt),
    ));
  const verified = await verifyGlobalLoginIdentity(
    candidates,
    password,
    verifyPassword,
  );
  return verified !== null;
}
