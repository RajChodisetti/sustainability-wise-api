import { randomUUID } from 'node:crypto';
import { and, eq, isNull, ne, or } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  ihInstallations,
  ihInventoryMeterMovements,
  ihInventoryMeters,
  ihMeterDevices,
} from '../db/schema/installhub.js';
import { businessClients, businessJobs, businessSites } from '../db/schema/shared.js';
import { wwClients, wwDeviceClients, wwDevices } from '../db/schema/wattwatchers.js';
import { conflict, notFound } from '../utils/errors.js';

type ProjectionExecutor = Pick<typeof db, 'insert' | 'select' | 'update'>;

function normalizedName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-AU');
}

function fleetClientCode(businessClientId: string | null, clientName: string): string {
  const suffix = businessClientId?.replace(/[^a-zA-Z0-9]/g, '').slice(-12)
    || Buffer.from(normalizedName(clientName)).toString('hex').slice(0, 12);
  return `field-${suffix || randomUUID().replaceAll('-', '').slice(0, 12)}`;
}

function inventoryModel(value: string): 'A3RM' | 'A6M' | 'OTHER' {
  return value === 'A3RM' || value === 'A6M' ? value : 'OTHER';
}

export type FieldCompletionProjectionResult = {
  projected: boolean;
  clientId: string | null;
  deviceCount: number;
};

/**
 * Transfers installed serials out of stock and projects their business client
 * into Fleet. Call from the same transaction that completes the installation.
 */
export async function projectCompletedFieldInstallation(
  executor: ProjectionExecutor,
  input: { installationId: string; actorUserId: string; observedAt: Date },
): Promise<FieldCompletionProjectionResult> {
  const [installation] = await executor.select().from(ihInstallations).where(and(
    eq(ihInstallations.id, input.installationId),
    isNull(ihInstallations.deletedAt),
  )).limit(1);
  if (!installation) throw notFound('Installation');

  const meters = await executor.select().from(ihMeterDevices).where(and(
    eq(ihMeterDevices.installationId, input.installationId),
    isNull(ihMeterDevices.deletedAt),
  ));
  if (meters.length === 0) return { projected: false, clientId: null, deviceCount: 0 };

  const [hierarchy] = await executor.select({
    jobId: businessJobs.id,
    siteId: businessSites.id,
    businessClientId: businessClients.id,
    clientName: businessClients.name,
  }).from(businessJobs)
    .innerJoin(businessSites, eq(businessSites.id, businessJobs.siteId))
    .innerJoin(businessClients, eq(businessClients.id, businessSites.clientId))
    .where(and(
      eq(businessJobs.sourceApp, 'installhub'),
      eq(businessJobs.sourceType, 'installation'),
      eq(businessJobs.sourceId, input.installationId),
    )).limit(1);

  const businessClientId = hierarchy?.businessClientId ?? null;
  const clientName = hierarchy?.clientName.trim() || installation.clientName.trim();
  const normalizedClientName = normalizedName(clientName);
  let [fleetClient] = businessClientId
    ? await executor.select().from(wwClients)
      .where(eq(wwClients.sourceBusinessClientId, businessClientId)).limit(1)
    : [];
  if (!fleetClient) {
    [fleetClient] = await executor.select().from(wwClients)
      .where(and(
        eq(wwClients.normalizedName, normalizedClientName),
        businessClientId
          ? or(
              isNull(wwClients.sourceBusinessClientId),
              eq(wwClients.sourceBusinessClientId, businessClientId),
            )
          : isNull(wwClients.sourceBusinessClientId),
      )).limit(1);
  }
  if (!fleetClient) {
    const createValues = {
      id: randomUUID(),
      code: fleetClientCode(businessClientId, clientName),
      name: clientName,
      normalizedName: normalizedClientName,
      sourceBusinessClientId: businessClientId,
      firstSeenAt: input.observedAt,
      lastSeenAt: input.observedAt,
      createdAt: input.observedAt,
      updatedAt: input.observedAt,
    };
    [fleetClient] = businessClientId
      ? await executor.insert(wwClients).values(createValues).onConflictDoUpdate({
          target: wwClients.sourceBusinessClientId,
          set: {
            name: clientName,
            normalizedName: normalizedClientName,
            isActive: true,
            lastSeenAt: input.observedAt,
            updatedAt: input.observedAt,
          },
        }).returning()
      : await executor.insert(wwClients).values(createValues).returning();
  } else {
    const canAttachBusinessClient = businessClientId
      && (!fleetClient.sourceBusinessClientId || fleetClient.sourceBusinessClientId === businessClientId);
    [fleetClient] = await executor.update(wwClients).set({
      name: clientName,
      normalizedName: normalizedClientName,
      sourceBusinessClientId: canAttachBusinessClient
        ? businessClientId
        : fleetClient.sourceBusinessClientId,
      isActive: true,
      lastSeenAt: input.observedAt,
      updatedAt: input.observedAt,
    }).where(eq(wwClients.id, fleetClient.id)).returning();
  }

  for (const meter of meters) {
    const serialNumber = meter.serialNumber.trim().toUpperCase();
    const [stock] = await executor.select().from(ihInventoryMeters)
      .where(eq(ihInventoryMeters.deviceId, serialNumber)).for('update').limit(1);
    if (stock?.deletedAt) throw conflict(`Inventory meter ${serialNumber} was deleted`);
    const allowedCustodians = new Set([
      input.actorUserId,
      installation.assignedInspectorUserId,
    ].filter((value): value is string => Boolean(value)));
    if (stock?.status === 'user' && !allowedCustodians.has(stock.custodianUserId ?? '')) {
      throw conflict(`Inventory meter ${serialNumber} is assigned to another user`);
    }
    if (stock?.status === 'installed' && stock.installedMeterId !== meter.id) {
      throw conflict(`Inventory meter ${serialNumber} is already installed elsewhere`);
    }
    if (!stock) {
      const [created] = await executor.insert(ihInventoryMeters).values({
        id: randomUUID(),
        deviceId: serialNumber,
        deviceModel: inventoryModel(meter.deviceModel),
        customManufacturerName: meter.customManufacturerName,
        customModelName: meter.customModelName,
        status: 'installed',
        installedInstallationId: input.installationId,
        installedMeterId: meter.id,
        businessClientId,
        businessSiteId: hierarchy?.siteId ?? null,
        businessJobId: hierarchy?.jobId ?? null,
        createdByUserId: input.actorUserId,
        updatedByUserId: input.actorUserId,
        createdAt: input.observedAt,
        updatedAt: input.observedAt,
      }).returning();
      await executor.insert(ihInventoryMeterMovements).values({
        id: randomUUID(),
        inventoryMeterId: created.id,
        action: 'installed',
        fromStatus: null,
        toStatus: 'installed',
        installationId: input.installationId,
        meterId: meter.id,
        actorUserId: input.actorUserId,
        occurredAt: input.observedAt,
      });
    } else if (stock.status !== 'installed') {
      await executor.update(ihInventoryMeters).set({
        status: 'installed',
        custodianUserId: null,
        installedInstallationId: input.installationId,
        installedMeterId: meter.id,
        businessClientId,
        businessSiteId: hierarchy?.siteId ?? null,
        businessJobId: hierarchy?.jobId ?? null,
        revision: stock.revision + 1,
        updatedByUserId: input.actorUserId,
        updatedAt: input.observedAt,
      }).where(eq(ihInventoryMeters.id, stock.id));
      await executor.insert(ihInventoryMeterMovements).values({
        id: randomUUID(),
        inventoryMeterId: stock.id,
        action: 'installed',
        fromStatus: stock.status,
        toStatus: 'installed',
        fromCustodianUserId: stock.custodianUserId,
        toCustodianUserId: null,
        installationId: input.installationId,
        meterId: meter.id,
        actorUserId: input.actorUserId,
        occurredAt: input.observedAt,
      });
    }

    const [fleetDevice] = await executor.insert(wwDevices).values({
      id: randomUUID(),
      deviceId: serialNumber,
      label: meter.customName,
      model: meter.deviceModel,
      primaryClientId: fleetClient.id,
      firstSeenAt: input.observedAt,
      lastDiscoveredAt: input.observedAt,
      createdAt: input.observedAt,
      updatedAt: input.observedAt,
    }).onConflictDoUpdate({
      target: wwDevices.deviceId,
      set: {
        label: meter.customName,
        model: meter.deviceModel,
        primaryClientId: fleetClient.id,
        lastDiscoveredAt: input.observedAt,
        updatedAt: input.observedAt,
      },
    }).returning();
    await executor.update(wwDeviceClients).set({ isCurrent: false })
      .where(and(eq(wwDeviceClients.deviceId, fleetDevice.id), ne(wwDeviceClients.clientId, fleetClient.id)));
    await executor.insert(wwDeviceClients).values({
      id: randomUUID(),
      deviceId: fleetDevice.id,
      clientId: fleetClient.id,
      isCurrent: true,
      firstSeenAt: input.observedAt,
      lastSeenAt: input.observedAt,
    }).onConflictDoUpdate({
      target: [wwDeviceClients.deviceId, wwDeviceClients.clientId],
      set: { isCurrent: true, lastSeenAt: input.observedAt },
    });
  }

  return { projected: true, clientId: fleetClient.id, deviceCount: meters.length };
}
