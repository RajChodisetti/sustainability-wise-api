import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_NOTIFICATION_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

test('Field completion transfers custody, projects Fleet devices, and skips meterless clients', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { db, closeDb },
    {
      ihElectricalAssets,
      ihInstallations,
      ihInventoryMeterMovements,
      ihInventoryMeters,
      ihMeterDevices,
      ihUsers,
      ihZones,
    },
    { businessClients, businessJobs, businessSites },
    { wwClients, wwDeviceClients, wwDevices },
    { projectCompletedFieldInstallation },
    { eq, inArray },
  ] = await Promise.all([
    import('../db/client.js'),
    import('../db/schema/installhub.js'),
    import('../db/schema/shared.js'),
    import('../db/schema/wattwatchers.js'),
    import('./fieldCompletionProjectionService.js'),
    import('drizzle-orm'),
  ]);

  const runId = randomUUID();
  const userId = `projection-user-${runId}`;
  const installationId = `projection-installation-${runId}`;
  const emptyInstallationId = `projection-empty-${runId}`;
  const zoneId = `projection-zone-${runId}`;
  const boardId = `projection-board-${runId}`;
  const meterId = `projection-meter-${runId}`;
  const inventoryId = `projection-inventory-${runId}`;
  const clientId = `projection-client-${runId}`;
  const emptyClientId = `projection-empty-client-${runId}`;
  const siteId = `projection-site-${runId}`;
  const emptySiteId = `projection-empty-site-${runId}`;
  const jobId = `projection-job-${runId}`;
  const emptyJobId = `projection-empty-job-${runId}`;
  const serial = `SERIAL-${runId}`.toUpperCase();
  const observedAt = new Date('2026-08-22T10:00:00.000Z');
  const clientName = `Projection Client ${runId}`;
  const emptyClientName = `Meterless Projection Client ${runId}`;
  const createdFleetIds: string[] = [];

  try {
    await db.insert(ihUsers).values({
      id: userId,
      email: `${userId}@example.test`,
      passwordHash: 'integration-test',
      fullName: 'Projection User',
      role: 'inspector',
    });
    await db.insert(ihInstallations).values([
      {
        id: installationId,
        externalKey: installationId,
        clientName,
        siteName: 'Projection Site',
        siteAddress: '1 Projection Street',
        inspectorName: 'Projection User',
        auditDate: '2026-08-22',
      },
      {
        id: emptyInstallationId,
        externalKey: emptyInstallationId,
        clientName: emptyClientName,
        siteName: 'Meterless Site',
        siteAddress: '2 Projection Street',
        inspectorName: 'Projection User',
        auditDate: '2026-08-22',
      },
    ]);
    await db.insert(ihZones).values({
      id: zoneId,
      installationId,
      zoneCode: `ZONE-${runId}`,
      zoneName: 'Main',
    });
    await db.insert(ihElectricalAssets).values({
      id: boardId,
      installationId,
      zoneId,
      assetName: 'Main switchboard',
      displayCode: `BOARD-${runId}`,
      assetType: 'Main switchboard',
      sourceKind: 'LEGACY',
    });
    await db.insert(ihMeterDevices).values({
      id: meterId,
      installationId,
      installedOnBoardId: boardId,
      customName: 'Main meter',
      deviceFamily: 'WATTWATCHERS',
      deviceModel: 'A6M',
      serialNumber: serial,
    });
    await db.insert(ihInventoryMeters).values({
      id: inventoryId,
      deviceId: serial,
      deviceModel: 'A6M',
      status: 'user',
      custodianUserId: userId,
      createdByUserId: userId,
      updatedByUserId: userId,
    });
    await db.insert(businessClients).values([
      { id: clientId, name: clientName },
      { id: emptyClientId, name: emptyClientName },
    ]);
    await db.insert(businessSites).values([
      { id: siteId, clientId, name: 'Projection Site', address: '1 Projection Street' },
      { id: emptySiteId, clientId: emptyClientId, name: 'Meterless Site', address: '2 Projection Street' },
    ]);
    await db.insert(businessJobs).values([
      {
        id: jobId, siteId, jobType: 'field', title: 'Projection Job',
        sourceApp: 'installhub', sourceType: 'installation', sourceId: installationId,
      },
      {
        id: emptyJobId, siteId: emptySiteId, jobType: 'field', title: 'Meterless Job',
        sourceApp: 'installhub', sourceType: 'installation', sourceId: emptyInstallationId,
      },
    ]);

    const projected = await db.transaction((tx) => projectCompletedFieldInstallation(tx, {
      installationId,
      actorUserId: userId,
      observedAt,
    }));
    assert.equal(projected.projected, true);
    assert.equal(projected.deviceCount, 1);
    if (projected.clientId) createdFleetIds.push(projected.clientId);

    const [stock] = await db.select().from(ihInventoryMeters).where(eq(ihInventoryMeters.id, inventoryId));
    assert.equal(stock.status, 'installed');
    assert.equal(stock.custodianUserId, null);
    assert.equal(stock.businessClientId, clientId);
    assert.equal(stock.businessSiteId, siteId);
    assert.equal(stock.businessJobId, jobId);

    const [device] = await db.select().from(wwDevices).where(eq(wwDevices.deviceId, serial));
    assert.ok(device);
    assert.equal(device.primaryClientId, projected.clientId);
    const [membership] = await db.select().from(wwDeviceClients).where(eq(wwDeviceClients.deviceId, device.id));
    assert.equal(membership.clientId, projected.clientId);
    assert.equal(membership.isCurrent, true);

    const empty = await db.transaction((tx) => projectCompletedFieldInstallation(tx, {
      installationId: emptyInstallationId,
      actorUserId: userId,
      observedAt,
    }));
    assert.deepEqual(empty, { projected: false, clientId: null, deviceCount: 0 });
    const meterlessFleet = await db.select().from(wwClients)
      .where(eq(wwClients.sourceBusinessClientId, emptyClientId));
    assert.equal(meterlessFleet.length, 0);
  } finally {
    await db.delete(ihInventoryMeterMovements).where(eq(ihInventoryMeterMovements.inventoryMeterId, inventoryId));
    await db.delete(ihInventoryMeters).where(eq(ihInventoryMeters.id, inventoryId));
    if (createdFleetIds.length) {
      const fleetDevices = await db.select({ id: wwDevices.id }).from(wwDevices)
        .where(inArray(wwDevices.primaryClientId, createdFleetIds));
      if (fleetDevices.length) {
        await db.delete(wwDeviceClients).where(inArray(wwDeviceClients.deviceId, fleetDevices.map((row) => row.id)));
        await db.delete(wwDevices).where(inArray(wwDevices.id, fleetDevices.map((row) => row.id)));
      }
      await db.delete(wwClients).where(inArray(wwClients.id, createdFleetIds));
    }
    await db.delete(businessJobs).where(inArray(businessJobs.id, [jobId, emptyJobId]));
    await db.delete(businessSites).where(inArray(businessSites.id, [siteId, emptySiteId]));
    await db.delete(businessClients).where(inArray(businessClients.id, [clientId, emptyClientId]));
    await db.delete(ihMeterDevices).where(eq(ihMeterDevices.id, meterId));
    await db.delete(ihElectricalAssets).where(eq(ihElectricalAssets.id, boardId));
    await db.delete(ihZones).where(eq(ihZones.id, zoneId));
    await db.delete(ihInstallations).where(inArray(ihInstallations.id, [installationId, emptyInstallationId]));
    await db.delete(ihUsers).where(eq(ihUsers.id, userId));
    await closeDb();
  }
});
