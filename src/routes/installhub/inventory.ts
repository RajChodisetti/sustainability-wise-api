import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { and, asc, count, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { authenticate, requireApp, requireRole, type AuthUser } from '../../auth/middleware.js';
import { db } from '../../db/client.js';
import {
  ihInventoryMeterMovements,
  ihInventoryMeters,
  ihUsers,
} from '../../db/schema/installhub.js';
import { globalUsers } from '../../db/schema/shared.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import {
  claimInventoryMeterByDeviceId,
  NON_INSTALLED_INVENTORY_STATUSES,
  parseInventoryMeterRegistration,
  registerInventoryMeter,
} from '../../services/inventoryMeterService.js';

type InventoryModel = 'A3RM' | 'A6M' | 'OTHER';

function deviceId(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('deviceId is required');
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized.length > 200) throw badRequest('deviceId must contain 1 to 200 characters');
  return normalized;
}

function model(value: unknown): InventoryModel {
  if (value === 'A3RM' || value === 'A6M' || value === 'OTHER') return value;
  throw badRequest('deviceModel must be A3RM, A6M, or OTHER');
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw badRequest(`${field} must be a string`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw badRequest(`${field} must contain 1 to ${maxLength} characters`);
  }
  return normalized;
}

async function maintainerStatus(user: AuthUser): Promise<boolean> {
  const [row] = await db.select({ isMaintainer: globalUsers.isMaintainer })
    .from(globalUsers).where(and(
      eq(globalUsers.fieldUserId, user.userId),
      eq(globalUsers.isActive, true),
    )).limit(1);
  return row?.isMaintainer === true;
}

async function requireMaintainer(user: AuthUser): Promise<void> {
  if (!await maintainerStatus(user)) throw forbidden('Company inventory requires maintainer access');
}

function uniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (
    (error as { code?: string }).code === '23505'
    || /duplicate|unique/i.test((error as { message?: string }).message ?? '')
  ));
}

async function listInventory(input: {
  actor: AuthUser;
  scope: 'mine' | 'company';
  q?: string;
}) {
  if (input.scope === 'company') await requireMaintainer(input.actor);
  const needle = input.q?.trim();
  const where = and(
    isNull(ihInventoryMeters.deletedAt),
    inArray(ihInventoryMeters.status, [...NON_INSTALLED_INVENTORY_STATUSES]),
    input.scope === 'mine'
      ? and(
          eq(ihInventoryMeters.status, 'user'),
          eq(ihInventoryMeters.custodianUserId, input.actor.userId),
        )
      : undefined,
    needle
      ? or(
          ilike(ihInventoryMeters.deviceId, `%${needle.replace(/[%_]/g, '')}%`),
          ilike(ihInventoryMeters.deviceModel, `%${needle.replace(/[%_]/g, '')}%`),
          ilike(ihUsers.fullName, `%${needle.replace(/[%_]/g, '')}%`),
        )
      : undefined,
  );
  const [rows, totals] = await Promise.all([
    db.select({
      meter: ihInventoryMeters,
      custodianName: ihUsers.fullName,
      custodianEmail: ihUsers.email,
    }).from(ihInventoryMeters).leftJoin(
      ihUsers,
      eq(ihUsers.id, ihInventoryMeters.custodianUserId),
    ).where(where).orderBy(desc(ihInventoryMeters.updatedAt), asc(ihInventoryMeters.deviceId)).limit(500),
    db.select({ total: count() }).from(ihInventoryMeters).leftJoin(
      ihUsers,
      eq(ihUsers.id, ihInventoryMeters.custodianUserId),
    ).where(where),
  ]);
  const data = rows.map(({ meter, custodianName, custodianEmail }) => ({
    ...meter,
    custodianName: custodianName?.trim() || custodianEmail || null,
  }));
  const total = Number(totals[0]?.total ?? 0);
  return { data, total, truncated: total > data.length };
}

export async function installhubInventoryRoutes(app: FastifyInstance): Promise<void> {
  const fieldUser = [authenticate, requireApp('installhub'), requireRole('inspector')];

  app.get('/me', {
    schema: { tags: ['Field App Complete Inventory'], security: [{ bearerAuth: [] }] },
    preHandler: fieldUser,
  }, async (request, reply) => reply.send({
    userId: request.user.userId,
    isMaintainer: await maintainerStatus(request.user),
  }));

  app.get('/meters', {
    schema: { tags: ['Field App Complete Inventory'], security: [{ bearerAuth: [] }] },
    preHandler: fieldUser,
  }, async (request, reply) => {
    const query = request.query as { scope?: string; q?: string };
    const scope = query.scope === 'company' ? 'company' : 'mine';
    return reply.send(await listInventory({ actor: request.user, scope, q: query.q }));
  });

  app.post('/meters', {
    schema: {
      tags: ['Field App Complete Inventory'],
      summary: 'Register a scanned meter into user or company stock',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['deviceId', 'deviceModel'], additionalProperties: false,
        properties: {
          deviceId: { type: 'string', minLength: 1, maxLength: 200 },
          deviceModel: { type: 'string', enum: ['A3RM', 'A6M', 'OTHER'] },
          customManufacturerName: { type: ['string', 'null'], maxLength: 200 },
          customModelName: { type: ['string', 'null'], maxLength: 200 },
          notes: { type: ['string', 'null'], maxLength: 2000 },
          custodianUserId: { type: ['string', 'null'], maxLength: 200 },
        },
      },
    },
    preHandler: fieldUser,
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const isMaintainer = await maintainerStatus(request.user);
    const requestedCustodian = optionalText(body.custodianUserId, 'custodianUserId', 200);
    if (requestedCustodian !== null && !isMaintainer && requestedCustodian !== request.user.userId) {
      throw forbidden('Only maintainers can assign inventory to another user');
    }
    const custodianUserId = requestedCustodian ?? (isMaintainer ? null : request.user.userId);
    if (custodianUserId) {
      const [user] = await db.select({ id: ihUsers.id }).from(ihUsers).where(and(
        eq(ihUsers.id, custodianUserId), eq(ihUsers.isActive, true),
      )).limit(1);
      if (!user) throw notFound('Inventory custodian');
    }
    const created = await registerInventoryMeter({
      meter: parseInventoryMeterRegistration({
        deviceId: body.deviceId,
        deviceModel: body.deviceModel,
        customManufacturerName: body.customManufacturerName,
        customModelName: body.customModelName,
        notes: body.notes,
      }),
      custodianUserId,
      actorUserId: request.user.userId,
    });
    return reply.status(201).send(created);
  });

  app.post('/meters/scan', {
    schema: {
      tags: ['Field App Complete Inventory'],
      summary: 'Register or claim a scanned meter into the current user inventory',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['deviceId', 'deviceModel'], additionalProperties: false,
        properties: {
          deviceId: { type: 'string', minLength: 1, maxLength: 200 },
          deviceModel: { type: 'string', enum: ['A3RM', 'A6M', 'OTHER'] },
          customManufacturerName: { type: ['string', 'null'], maxLength: 200 },
          customModelName: { type: ['string', 'null'], maxLength: 200 },
          notes: { type: ['string', 'null'], maxLength: 2000 },
        },
      },
    },
    preHandler: fieldUser,
  }, async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const scannedDeviceId = deviceId(body.deviceId);
    const deviceModel = model(body.deviceModel);
    const customManufacturerName = optionalText(body.customManufacturerName, 'customManufacturerName', 200);
    const customModelName = optionalText(body.customModelName, 'customModelName', 200);
    if (deviceModel === 'OTHER' && (!customManufacturerName || !customModelName)) {
      throw badRequest('OTHER meters require customManufacturerName and customModelName');
    }
    try {
      const result = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(ihInventoryMeters)
          .where(eq(ihInventoryMeters.deviceId, scannedDeviceId)).for('update').limit(1);
        if (current?.deletedAt) throw conflict('This Device ID was removed from inventory');
        if (current?.status === 'installed') throw conflict('This meter is already installed');
        if (current?.status === 'user' && current.custodianUserId !== request.user.userId) {
          throw conflict('This meter is assigned to another user');
        }
        if (current?.status === 'user') return { meter: current, claimed: false };
        const now = new Date();
        if (current) {
          const [meter] = await tx.update(ihInventoryMeters).set({
            status: 'user',
            custodianUserId: request.user.userId,
            revision: current.revision + 1,
            updatedByUserId: request.user.userId,
            updatedAt: now,
          }).where(eq(ihInventoryMeters.id, current.id)).returning();
          await tx.insert(ihInventoryMeterMovements).values({
            id: randomUUID(), inventoryMeterId: meter.id, action: 'claimed',
            fromStatus: 'company', toStatus: 'user',
            fromCustodianUserId: null, toCustodianUserId: request.user.userId,
            actorUserId: request.user.userId, occurredAt: now,
          });
          return { meter, claimed: true };
        }
        const [meter] = await tx.insert(ihInventoryMeters).values({
          id: randomUUID(),
          deviceId: scannedDeviceId,
          deviceModel,
          customManufacturerName,
          customModelName,
          status: 'user',
          custodianUserId: request.user.userId,
          notes: optionalText(body.notes, 'notes', 2000),
          createdByUserId: request.user.userId,
          updatedByUserId: request.user.userId,
          createdAt: now,
          updatedAt: now,
        }).returning();
        await tx.insert(ihInventoryMeterMovements).values({
          id: randomUUID(), inventoryMeterId: meter.id, action: 'registered',
          fromStatus: null, toStatus: 'user',
          toCustodianUserId: request.user.userId,
          actorUserId: request.user.userId, occurredAt: now,
        });
        return { meter, claimed: false };
      });
      return reply.status(result.claimed ? 200 : 201).send(result.meter);
    } catch (error) {
      if (uniqueViolation(error)) throw conflict('This Device ID is already registered');
      throw error;
    }
  });

  app.post('/meters/claim-by-device', {
    schema: {
      tags: ['Field App Complete Inventory'],
      summary: 'Transfer an existing company-stock meter to the current user',
      security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['deviceId'], additionalProperties: false,
        properties: {
          deviceId: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
    preHandler: fieldUser,
  }, async (request, reply) => {
    const body = request.body as { deviceId: string };
    const meter = await claimInventoryMeterByDeviceId({
      deviceId: body.deviceId,
      actorUserId: request.user.userId,
    });
    return reply.send(meter);
  });

  app.post('/meters/:meterId/claim', {
    schema: { tags: ['Field App Complete Inventory'], security: [{ bearerAuth: [] }] },
    preHandler: fieldUser,
  }, async (request, reply) => {
    const { meterId } = request.params as { meterId: string };
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(ihInventoryMeters).where(and(
        eq(ihInventoryMeters.id, meterId), isNull(ihInventoryMeters.deletedAt),
      )).for('update').limit(1);
      if (!current) throw notFound('Inventory meter');
      if (current.status === 'user' && current.custodianUserId === request.user.userId) return current;
      if (current.status !== 'company') throw conflict('Meter is not available in company stock');
      const now = new Date();
      const [meter] = await tx.update(ihInventoryMeters).set({
        status: 'user', custodianUserId: request.user.userId,
        revision: current.revision + 1, updatedByUserId: request.user.userId, updatedAt: now,
      }).where(eq(ihInventoryMeters.id, current.id)).returning();
      await tx.insert(ihInventoryMeterMovements).values({
        id: randomUUID(), inventoryMeterId: meter.id, action: 'claimed',
        fromStatus: current.status, toStatus: 'user',
        fromCustodianUserId: current.custodianUserId,
        toCustodianUserId: request.user.userId,
        actorUserId: request.user.userId, occurredAt: now,
      });
      return meter;
    });
    return reply.send(updated);
  });

  app.patch('/meters/:meterId', {
    schema: {
      tags: ['Field App Complete Inventory'], security: [{ bearerAuth: [] }],
      body: {
        type: 'object', required: ['expectedRevision'], additionalProperties: false,
        properties: {
          expectedRevision: { type: 'integer', minimum: 1 },
          deviceId: { type: 'string', minLength: 1, maxLength: 200 },
          deviceModel: { type: 'string', enum: ['A3RM', 'A6M', 'OTHER'] },
          customManufacturerName: { type: ['string', 'null'], maxLength: 200 },
          customModelName: { type: ['string', 'null'], maxLength: 200 },
          notes: { type: ['string', 'null'], maxLength: 2000 },
          custodianUserId: { type: ['string', 'null'], maxLength: 200 },
        },
      },
    },
    preHandler: fieldUser,
  }, async (request, reply) => {
    await requireMaintainer(request.user);
    const { meterId } = request.params as { meterId: string };
    const body = request.body as Record<string, unknown> & { expectedRevision: number };
    let updated;
    try {
      updated = await db.transaction(async (tx) => {
        const [current] = await tx.select().from(ihInventoryMeters).where(and(
          eq(ihInventoryMeters.id, meterId), isNull(ihInventoryMeters.deletedAt),
        )).for('update').limit(1);
        if (!current) throw notFound('Inventory meter');
        if (current.revision !== body.expectedRevision) throw conflict('inventory_meter_changed');
        const custodianUserId = body.custodianUserId === undefined
          ? current.custodianUserId
          : optionalText(body.custodianUserId, 'custodianUserId', 200);
        if (current.status === 'installed' && body.custodianUserId !== undefined) {
          throw conflict('Installed meter custody cannot be reassigned');
        }
        if (custodianUserId) {
          const [user] = await tx.select({ id: ihUsers.id }).from(ihUsers).where(and(
            eq(ihUsers.id, custodianUserId), eq(ihUsers.isActive, true),
          )).limit(1);
          if (!user) throw notFound('Inventory custodian');
        }
        const nextModel = body.deviceModel === undefined ? current.deviceModel : model(body.deviceModel);
        const nextManufacturer = body.customManufacturerName === undefined
          ? current.customManufacturerName
          : optionalText(body.customManufacturerName, 'customManufacturerName', 200);
        const nextCustomModel = body.customModelName === undefined
          ? current.customModelName
          : optionalText(body.customModelName, 'customModelName', 200);
        if (nextModel === 'OTHER' && (!nextManufacturer || !nextCustomModel)) {
          throw badRequest('OTHER meters require customManufacturerName and customModelName');
        }
        const nextStatus = current.status === 'installed' ? 'installed' : custodianUserId ? 'user' : 'company';
        const now = new Date();
        const [meter] = await tx.update(ihInventoryMeters).set({
          deviceId: body.deviceId === undefined ? current.deviceId : deviceId(body.deviceId),
          deviceModel: nextModel,
          customManufacturerName: nextManufacturer,
          customModelName: nextCustomModel,
          notes: body.notes === undefined ? current.notes : optionalText(body.notes, 'notes', 2000),
          status: nextStatus,
          custodianUserId,
          revision: current.revision + 1,
          updatedByUserId: request.user.userId,
          updatedAt: now,
        }).where(eq(ihInventoryMeters.id, current.id)).returning();
        await tx.insert(ihInventoryMeterMovements).values({
          id: randomUUID(), inventoryMeterId: meter.id, action: 'edited',
          fromStatus: current.status, toStatus: meter.status,
          fromCustodianUserId: current.custodianUserId,
          toCustodianUserId: meter.custodianUserId,
          actorUserId: request.user.userId, occurredAt: now,
        });
        return meter;
      });
    } catch (error) {
      if (uniqueViolation(error)) throw conflict('This Device ID is already registered');
      throw error;
    }
    return reply.send(updated);
  });

  app.delete('/meters/:meterId', {
    schema: { tags: ['Field App Complete Inventory'], security: [{ bearerAuth: [] }] },
    preHandler: fieldUser,
  }, async (request, reply) => {
    await requireMaintainer(request.user);
    const { meterId } = request.params as { meterId: string };
    await db.transaction(async (tx) => {
      const [current] = await tx.select().from(ihInventoryMeters).where(and(
        eq(ihInventoryMeters.id, meterId), isNull(ihInventoryMeters.deletedAt),
      )).for('update').limit(1);
      if (!current) throw notFound('Inventory meter');
      if (current.status === 'installed') throw conflict('Installed meter history cannot be deleted');
      const now = new Date();
      await tx.update(ihInventoryMeters).set({
        deletedAt: now, revision: current.revision + 1,
        updatedByUserId: request.user.userId, updatedAt: now,
      }).where(eq(ihInventoryMeters.id, current.id));
      await tx.insert(ihInventoryMeterMovements).values({
        id: randomUUID(), inventoryMeterId: current.id, action: 'deleted',
        fromStatus: current.status, toStatus: current.status,
        fromCustodianUserId: current.custodianUserId,
        toCustodianUserId: current.custodianUserId,
        actorUserId: request.user.userId, occurredAt: now,
      });
    });
    return reply.status(204).send();
  });
}
