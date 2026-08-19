import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from 'fastify';
import type { AuthUser } from '../../auth/middleware.js';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { authenticate, requireRole } from '../../auth/middleware.js';
import { db } from '../../db/client.js';
import { globalUsers, unifiedUsers } from '../../db/schema/shared.js';
import {
  buildUnifiedUserDirectory,
  type UnifiedUserApp,
  type UnifiedUserRole,
} from '../../services/unifiedUserDirectory.js';
import { assertGlobalFinanceAdmin } from '../../services/schedulerFinanceService.js';
import {
  badRequest,
  conflict,
  forbidden,
  notFound,
} from '../../utils/errors.js';

const DIRECTORY_LIMIT_PER_APP = 10_000;
const DIRECTORY_LIMIT_TOTAL = DIRECTORY_LIMIT_PER_APP * 3;
const PORTAL_DIRECTORY_APPS = new Set([
  'ecoaudit',
  'solarsense',
  'installhub',
]);

export interface PortalUserBillingRateStore {
  updateUserBillingRate(
    globalUserId: string,
    billingRateCents: number | null,
  ): Promise<{
    globalUserId: string;
    billingRateCents: number | null;
  } | null>;
}

export interface PortalUserRouteOptions {
  billingRateStore?: PortalUserBillingRateStore;
  authorizeBillingRateAdmin?: (user: AuthUser) => Promise<void>;
}

const databaseBillingRateStore: PortalUserBillingRateStore = {
  async updateUserBillingRate(globalUserId, billingRateCents) {
    const [updated] = await db
      .update(globalUsers)
      .set({ billingRateCents, updatedAt: new Date() })
      .where(eq(globalUsers.id, globalUserId))
      .returning({
        globalUserId: globalUsers.id,
        billingRateCents: globalUsers.billingRateCents,
      });
    return updated ?? null;
  },
};

export function billingRateToCents(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw badRequest('billingRate must be a nonnegative number or null');
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents)) {
    throw badRequest('billingRate is too large');
  }
  return cents;
}

function parseBillingRateBody(body: unknown): number | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('billingRate body is required');
  }
  const record = body as Record<string, unknown>;
  if (
    !Object.hasOwn(record, 'billingRate')
    || Object.keys(record).some((key) => key !== 'billingRate')
  ) {
    throw badRequest('billingRate must be the only request field');
  }
  return billingRateToCents(record.billingRate);
}

function billingRateFromCents(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Stored billing rate is outside the supported accounting range');
  }
  return value / 100;
}

async function requirePortalDirectoryApp(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  if (!PORTAL_DIRECTORY_APPS.has(request.user.app)) {
    throw forbidden('Unified user directory is unavailable for this application');
  }
}

export async function portalUserRoutes(
  app: FastifyInstance,
  options: PortalUserRouteOptions = {},
): Promise<void> {
  const billingRateStore = options.billingRateStore ?? databaseBillingRateStore;
  const authorizeBillingRateAdmin = options.authorizeBillingRateAdmin
    ?? assertGlobalFinanceAdmin;
  const billingRateCentsByRequest = new WeakMap<FastifyRequest, number | null>();

  app.get('/users', {
    schema: {
      tags: ['Portal Users'],
      summary: 'List the unified EcoAudit, SolarSense, and Field App Complete user directory',
      description: 'Returns one canonical identity with its EcoAudit, SolarSense, and Field App Complete product memberships.',
      security: [{ bearerAuth: [] }],
    },
    preHandler: [
      authenticate,
      requirePortalDirectoryApp,
      requireRole('admin'),
    ],
  }, async (_request, reply) => {
    // Keep credentials out of this projection. The registry is already the
    // synchronized source for this additive directory, so one query is enough.
    const users = await db
      .select({
        id: unifiedUsers.id,
        globalUserId: unifiedUsers.globalUserId,
        globalLoginKey: globalUsers.loginKey,
        globalDisplayEmail: globalUsers.displayEmail,
        billingRateCents: globalUsers.billingRateCents,
        originApp: sql<UnifiedUserApp>`${unifiedUsers.originApp}`,
        originUserId: unifiedUsers.originUserId,
        fieldUserId: unifiedUsers.fieldUserId,
        email: unifiedUsers.email,
        fullName: unifiedUsers.fullName,
        role: sql<UnifiedUserRole>`${unifiedUsers.role}`,
        isActive: unifiedUsers.isActive,
        sourceCreatedAt: unifiedUsers.sourceCreatedAt,
        sourceUpdatedAt: unifiedUsers.sourceUpdatedAt,
        deletedAt: unifiedUsers.deletedAt,
      })
      .from(unifiedUsers)
      .innerJoin(globalUsers, eq(globalUsers.id, unifiedUsers.globalUserId))
      .where(isNull(unifiedUsers.deletedAt))
      .orderBy(asc(unifiedUsers.sourceCreatedAt), asc(unifiedUsers.id))
      .limit(DIRECTORY_LIMIT_TOTAL + 1);

    const countByOrigin: Record<UnifiedUserApp, number> = {
      ecoaudit: 0,
      solarsense: 0,
      installhub: 0,
    };
    for (const user of users) countByOrigin[user.originApp] += 1;

    if (
      users.length > DIRECTORY_LIMIT_TOTAL
      || Object.values(countByOrigin).some(
        (count) => count > DIRECTORY_LIMIT_PER_APP,
      )
    ) {
      throw conflict(
        `Unified user directory exceeds ${DIRECTORY_LIMIT_PER_APP} users per application`,
      );
    }

    return reply.send(buildUnifiedUserDirectory(users));
  });

  app.patch<{
    Params: { globalUserId: string };
    Body: { billingRate: unknown };
  }>(
    '/users/:globalUserId/billing-rate',
    {
      schema: {
        tags: ['Portal Users'],
        summary: 'Set the canonical billing rate for a user',
        description: 'Stores one administrative billing rate on the canonical identity shared by all product memberships, including inactive identities retained for historical billing.',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['globalUserId'],
          additionalProperties: false,
          properties: {
            globalUserId: { type: 'string', minLength: 1 },
          },
        },
        body: {
          type: 'object',
          required: ['billingRate'],
          additionalProperties: false,
          properties: {
            billingRate: {
              anyOf: [
                { type: 'null' },
                { type: 'number', minimum: 0 },
              ],
            },
          },
        },
      },
      preHandler: [
        authenticate,
        requirePortalDirectoryApp,
        requireRole('admin'),
      ],
      preValidation: async (request) => {
        // Fastify's default Ajv configuration coerces scalar types during
        // validation. Capture and validate the original JSON value first so
        // strings never become rates and null never becomes zero.
        billingRateCentsByRequest.set(
          request,
          parseBillingRateBody(request.body),
        );
      },
    },
    async (request, reply) => {
      const globalUserId = request.params.globalUserId.trim();
      if (!globalUserId) throw badRequest('globalUserId is required');

      if (!billingRateCentsByRequest.has(request)) {
        throw new Error('Billing rate request was not validated');
      }
      await authorizeBillingRateAdmin(request.user);
      const updated = await billingRateStore.updateUserBillingRate(
        globalUserId,
        billingRateCentsByRequest.get(request) ?? null,
      );
      if (!updated) throw notFound('Canonical user');

      return reply.send({
        globalUserId: updated.globalUserId,
        billingRate: billingRateFromCents(updated.billingRateCents),
      });
    },
  );
}
