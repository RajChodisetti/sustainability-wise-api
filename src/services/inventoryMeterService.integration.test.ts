import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_INVENTORY_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

test('Scheduler inventory lists only non-installed stock and resolves the current user holder', {
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
    { eq, inArray },
    {
      claimInventoryMeterByDeviceId,
      listNonInstalledInventoryMeters,
      parseInventoryMeterRegistration,
      registerInventoryMeter,
    },
  ] = await Promise.all([
    import('../db/client.js'),
    import('../db/schema/installhub.js'),
    import('drizzle-orm'),
    import('./inventoryMeterService.js'),
  ]);

  const suffix = randomUUID();
  const userId = `inventory-holder-${suffix}`;
  const installationId = `inventory-installation-${suffix}`;
  const zoneId = `inventory-zone-${suffix}`;
  const boardId = `inventory-board-${suffix}`;
  const installedMeterId = `inventory-installed-meter-${suffix}`;
  const userStockId = `inventory-user-stock-${suffix}`;
  const installedStockId = `inventory-installed-stock-${suffix}`;
  let companyStockId: string | null = null;

  try {
    await db.insert(ihUsers).values({
      id: userId,
      email: `${userId}@example.test`,
      passwordHash: 'integration-test',
      fullName: `Inventory Holder ${suffix}`,
      role: 'inspector',
    });
    await db.insert(ihInstallations).values({
      id: installationId,
      externalKey: installationId,
      clientName: `Inventory Client ${suffix}`,
      siteName: 'Installed site excluded from stock',
      siteAddress: '1 Inventory Street',
      inspectorName: 'Integration Test',
      auditDate: '2026-08-28',
    });
    await db.insert(ihZones).values({
      id: zoneId,
      installationId,
      zoneCode: 'INV',
      zoneName: 'Inventory Zone',
    });
    await db.insert(ihElectricalAssets).values({
      id: boardId,
      installationId,
      zoneId,
      assetName: 'Inventory Board',
      displayCode: 'INV-BOARD',
      assetType: 'Switchboard',
    });
    await db.insert(ihMeterDevices).values({
      id: installedMeterId,
      installationId,
      installedOnBoardId: boardId,
      customName: 'Installed meter',
      deviceFamily: 'WATTWATCHERS',
      deviceModel: 'A3RM',
      serialNumber: `INSTALLED-${suffix}`,
    });
    await db.insert(ihInventoryMeters).values([
      {
        id: userStockId,
        deviceId: `USER-${suffix}`,
        deviceModel: 'A6M',
        status: 'user',
        custodianUserId: userId,
        notes: 'Held in service van',
      },
      {
        id: installedStockId,
        deviceId: `INSTALLED-${suffix}`,
        deviceModel: 'A3RM',
        status: 'installed',
        installedInstallationId: installationId,
        installedMeterId,
      },
    ]);

    const companyStock = await registerInventoryMeter({
      meter: parseInventoryMeterRegistration({
        deviceId: `company-${suffix}`,
        deviceModel: 'A3RM',
        notes: 'Company shelf',
      }),
      custodianUserId: null,
      actorUserId: `portal-admin-${suffix}`,
    });
    companyStockId = companyStock.id;

    const result = await listNonInstalledInventoryMeters({ search: suffix });
    assert.equal(result.total, 2);
    assert.equal(result.truncated, false);
    assert.deepEqual(
      new Set(result.items.map((item) => item.inventoryMeterId)),
      new Set([companyStock.id, userStockId]),
    );
    assert.equal(result.items.some((item) => item.inventoryMeterId === installedStockId), false);

    const companyItem = result.items.find((item) => item.inventoryMeterId === companyStock.id);
    assert.equal(companyItem?.status, 'company');
    assert.equal(companyItem?.custodianUserId, null);
    assert.equal(companyItem?.custodianName, null);

    const userItem = result.items.find((item) => item.inventoryMeterId === userStockId);
    assert.equal(userItem?.status, 'user');
    assert.equal(userItem?.custodianUserId, userId);
    assert.equal(userItem?.custodianName, `Inventory Holder ${suffix}`);
    assert.equal(userItem?.custodianEmail, `${userId}@example.test`);

    const holderSearch = await listNonInstalledInventoryMeters({
      search: `Inventory Holder ${suffix}`,
    });
    assert.equal(holderSearch.total, 1);
    assert.equal(holderSearch.items[0]?.inventoryMeterId, userStockId);

    const movement = await db.select().from(ihInventoryMeterMovements)
      .where(eq(ihInventoryMeterMovements.inventoryMeterId, companyStock.id));
    assert.equal(movement.length, 1);
    assert.equal(movement[0]?.action, 'registered');
    assert.equal(movement[0]?.toStatus, 'company');
    assert.equal(movement[0]?.toCustodianUserId, null);

    const claimed = await claimInventoryMeterByDeviceId({
      deviceId: ` company-${suffix} `,
      actorUserId: userId,
    });
    assert.equal(claimed.status, 'user');
    assert.equal(claimed.custodianUserId, userId);
    assert.equal(claimed.revision, companyStock.revision + 1);

    const repeatedClaim = await claimInventoryMeterByDeviceId({
      deviceId: `COMPANY-${suffix}`,
      actorUserId: userId,
    });
    assert.equal(repeatedClaim.id, claimed.id);
    assert.equal(repeatedClaim.revision, claimed.revision);

    const movementsAfterClaim = await db.select().from(ihInventoryMeterMovements)
      .where(eq(ihInventoryMeterMovements.inventoryMeterId, companyStock.id));
    assert.deepEqual(movementsAfterClaim.map((item) => item.action), ['registered', 'claimed']);
    assert.equal(movementsAfterClaim[1]?.fromStatus, 'company');
    assert.equal(movementsAfterClaim[1]?.toStatus, 'user');
    assert.equal(movementsAfterClaim[1]?.toCustodianUserId, userId);
  } finally {
    const stockIds = [userStockId, installedStockId];
    if (companyStockId) stockIds.push(companyStockId);
    await db.delete(ihInventoryMeterMovements)
      .where(inArray(ihInventoryMeterMovements.inventoryMeterId, stockIds));
    await db.delete(ihInventoryMeters).where(inArray(ihInventoryMeters.id, stockIds));
    await db.delete(ihMeterDevices).where(eq(ihMeterDevices.id, installedMeterId));
    await db.delete(ihElectricalAssets).where(eq(ihElectricalAssets.id, boardId));
    await db.delete(ihZones).where(eq(ihZones.id, zoneId));
    await db.delete(ihInstallations).where(eq(ihInstallations.id, installationId));
    await db.delete(ihUsers).where(eq(ihUsers.id, userId));
    await closeDb();
  }
});
