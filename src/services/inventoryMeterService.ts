import { randomUUID } from 'node:crypto';
import { and, count, desc, eq, ilike, inArray, isNull, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  ihInventoryMeterMovements,
  ihInventoryMeters,
  ihUsers,
} from '../db/schema/installhub.js';
import { badRequest, conflict } from '../utils/errors.js';

export type InventoryMeterModel = 'A3RM' | 'A6M' | 'OTHER';
export type NonInstalledInventoryMeterStatus = 'company' | 'user';

export type InventoryMeterRegistration = {
  deviceId: string;
  deviceModel: InventoryMeterModel;
  customManufacturerName: string | null;
  customModelName: string | null;
  notes: string | null;
};

export type NonInstalledInventoryMeterItem = InventoryMeterRegistration & {
  inventoryMeterId: string;
  status: NonInstalledInventoryMeterStatus;
  custodianUserId: string | null;
  custodianName: string | null;
  custodianEmail: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type InventoryMeterRecord = typeof ihInventoryMeters.$inferSelect;

const INVENTORY_REGISTRATION_FIELDS = new Set([
  'deviceId',
  'deviceModel',
  'customManufacturerName',
  'customModelName',
  'notes',
]);

function requiredDeviceId(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('deviceId is required');
  const normalized = value.trim().toUpperCase();
  if (!normalized || normalized.length > 200) {
    throw badRequest('deviceId must contain 1 to 200 characters');
  }
  return normalized;
}

function requiredModel(value: unknown): InventoryMeterModel {
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

export function parseInventoryMeterRegistration(value: unknown): InventoryMeterRegistration {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('Meter details are required');
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !INVENTORY_REGISTRATION_FIELDS.has(key))) {
    throw badRequest('Only meter details can be saved in inventory');
  }
  const deviceModel = requiredModel(body.deviceModel);
  const customManufacturerName = optionalText(
    body.customManufacturerName,
    'customManufacturerName',
    200,
  );
  const customModelName = optionalText(body.customModelName, 'customModelName', 200);
  if (deviceModel === 'OTHER' && (!customManufacturerName || !customModelName)) {
    throw badRequest('OTHER meters require customManufacturerName and customModelName');
  }
  return {
    deviceId: requiredDeviceId(body.deviceId),
    deviceModel,
    customManufacturerName,
    customModelName,
    notes: optionalText(body.notes, 'notes', 2000),
  };
}

function uniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (
    (error as { code?: string }).code === '23505'
    || /duplicate|unique/i.test((error as { message?: string }).message ?? '')
  ));
}

export async function registerInventoryMeter(input: {
  meter: InventoryMeterRegistration;
  custodianUserId: string | null;
  actorUserId: string;
}): Promise<InventoryMeterRecord> {
  const now = new Date();
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx.insert(ihInventoryMeters).values({
        id: randomUUID(),
        ...input.meter,
        status: input.custodianUserId ? 'user' : 'company',
        custodianUserId: input.custodianUserId,
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
        createdAt: now,
        updatedAt: now,
      }).returning();
      await tx.insert(ihInventoryMeterMovements).values({
        id: randomUUID(),
        inventoryMeterId: created.id,
        action: 'registered',
        fromStatus: null,
        toStatus: created.status,
        fromCustodianUserId: null,
        toCustodianUserId: created.custodianUserId,
        actorUserId: input.actorUserId,
        occurredAt: now,
      });
      return created;
    });
  } catch (error) {
    if (uniqueViolation(error)) throw conflict('This Device ID is already registered');
    throw error;
  }
}

export function toNonInstalledInventoryMeterItem(input: {
  meter: InventoryMeterRecord;
  custodianName?: string | null;
  custodianEmail?: string | null;
}): NonInstalledInventoryMeterItem {
  return {
    inventoryMeterId: input.meter.id,
    deviceId: input.meter.deviceId,
    deviceModel: input.meter.deviceModel as InventoryMeterModel,
    customManufacturerName: input.meter.customManufacturerName,
    customModelName: input.meter.customModelName,
    notes: input.meter.notes,
    status: input.meter.status as NonInstalledInventoryMeterStatus,
    custodianUserId: input.meter.custodianUserId,
    custodianName: input.custodianName?.trim() || input.custodianEmail || null,
    custodianEmail: input.custodianEmail ?? null,
    revision: input.meter.revision,
    createdAt: input.meter.createdAt.toISOString(),
    updatedAt: input.meter.updatedAt.toISOString(),
  };
}

export async function listNonInstalledInventoryMeters(input: {
  search?: string;
  limit?: number;
} = {}): Promise<{
  items: NonInstalledInventoryMeterItem[];
  total: number;
  truncated: boolean;
}> {
  const limit = Math.max(1, Math.min(input.limit ?? 500, 500));
  const search = input.search?.trim().replace(/[%_\\]/g, '') ?? '';
  const searchFilter = search
    ? or(
        ilike(ihInventoryMeters.deviceId, `%${search}%`),
        ilike(ihInventoryMeters.deviceModel, `%${search}%`),
        ilike(ihInventoryMeters.customManufacturerName, `%${search}%`),
        ilike(ihInventoryMeters.customModelName, `%${search}%`),
        ilike(ihInventoryMeters.notes, `%${search}%`),
        ilike(ihUsers.fullName, `%${search}%`),
        ilike(ihUsers.email, `%${search}%`),
      )
    : undefined;
  const where = and(
    isNull(ihInventoryMeters.deletedAt),
    inArray(ihInventoryMeters.status, ['company', 'user']),
    searchFilter,
  );
  const [rows, totalRows] = await Promise.all([
    db.select({
      inventoryMeterId: ihInventoryMeters.id,
      deviceId: ihInventoryMeters.deviceId,
      deviceModel: ihInventoryMeters.deviceModel,
      customManufacturerName: ihInventoryMeters.customManufacturerName,
      customModelName: ihInventoryMeters.customModelName,
      notes: ihInventoryMeters.notes,
      status: ihInventoryMeters.status,
      custodianUserId: ihInventoryMeters.custodianUserId,
      custodianName: ihUsers.fullName,
      custodianEmail: ihUsers.email,
      revision: ihInventoryMeters.revision,
      createdAt: ihInventoryMeters.createdAt,
      updatedAt: ihInventoryMeters.updatedAt,
    }).from(ihInventoryMeters)
      .leftJoin(ihUsers, eq(ihUsers.id, ihInventoryMeters.custodianUserId))
      .where(where)
      .orderBy(desc(ihInventoryMeters.updatedAt), ihInventoryMeters.deviceId)
      .limit(limit),
    db.select({ total: count() }).from(ihInventoryMeters)
      .leftJoin(ihUsers, eq(ihUsers.id, ihInventoryMeters.custodianUserId))
      .where(where),
  ]);
  const items = rows.map((row) => ({
    inventoryMeterId: row.inventoryMeterId,
    deviceId: row.deviceId,
    deviceModel: row.deviceModel as InventoryMeterModel,
    customManufacturerName: row.customManufacturerName,
    customModelName: row.customModelName,
    notes: row.notes,
    status: row.status as NonInstalledInventoryMeterStatus,
    custodianUserId: row.custodianUserId,
    custodianName: row.custodianName?.trim() || row.custodianEmail || null,
    custodianEmail: row.custodianEmail,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
  const total = Number(totalRows[0]?.total ?? 0);
  return { items, total, truncated: total > items.length };
}
