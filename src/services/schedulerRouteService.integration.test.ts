import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_ROUTING_PG_INTEGRATION_URL;
if (integrationDatabase) {
  process.env.DATABASE_URL = integrationDatabase;
  process.env.SCHEDULER_PHOTON_URL = '';
  process.env.SCHEDULER_OSRM_URL = '';
}

test('Scheduler routing excludes hidden product rows and reads Field destinations', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { db, closeDb },
    { eaAudits },
    { ihInstallations },
    { ssRooftopAssessments, ssSites },
    { globalUsers, portalScheduleEvents, unifiedUsers },
    { and, eq, inArray },
    { AppError },
    { schedulerAddressFingerprint },
    { getSchedulerRouteSuggestion },
  ] = await Promise.all([
    import('../db/client.js'),
    import('../db/schema/ecoaudit.js'),
    import('../db/schema/installhub.js'),
    import('../db/schema/solarsense.js'),
    import('../db/schema/shared.js'),
    import('drizzle-orm'),
    import('../utils/errors.js'),
    import('./schedulerAddressService.js'),
    import('./schedulerRouteService.js'),
  ]);

  const suffix = randomUUID();
  const globalUserId = `route-global-${suffix}`;
  const fieldUserId = `route-field-${suffix}`;
  const ecoUserId = `route-eco-user-${suffix}`;
  const ecoId = `route-eco-${suffix}`;
  const solarSiteId = `route-solar-site-${suffix}`;
  const solarAssessmentId = `route-solar-assessment-${suffix}`;
  const installationId = `route-installation-${suffix}`;
  const eventIds = [
    `route-event-eco-${suffix}`,
    `route-event-solar-${suffix}`,
    `route-event-field-${suffix}`,
  ];
  const now = new Date('2026-08-20T00:00:00.000Z');
  const destinations = [
    {
      address: '1 George Street, Sydney NSW 2000, Australia',
      latitude: -33.8688,
      longitude: 151.2093,
    },
    {
      address: '2 Pitt Street, Sydney NSW 2000, Australia',
      latitude: -33.8705,
      longitude: 151.2088,
    },
    {
      address: '3 Castlereagh Street, Sydney NSW 2000, Australia',
      latitude: -33.8665,
      longitude: 151.2108,
    },
  ];
  const structured = (destination: typeof destinations[number]) => ({
    siteLocality: 'Sydney',
    siteState: 'NSW',
    sitePostcode: '2000',
    siteCountryCode: 'AU',
    siteLatitude: destination.latitude,
    siteLongitude: destination.longitude,
    siteGeocodeStatus: 'resolved',
    siteGeocodeProvider: 'integration-test',
    siteGeocodePlaceId: `place-${destination.latitude}`,
    siteAddressFingerprint: schedulerAddressFingerprint(destination.address),
    siteGeocodedAt: now,
  });

  try {
    await db.insert(globalUsers).values({
      id: globalUserId,
      loginKey: `route-${suffix}@example.test`,
      fieldUserId,
      primaryOriginApp: 'ecoaudit',
      primaryOriginUserId: ecoUserId,
      displayEmail: `route-${suffix}@example.test`,
      fullName: 'Route Inspector',
      timezone: 'Australia/Sydney',
      role: 'inspector',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(unifiedUsers).values({
      id: `route-membership-${suffix}`,
      globalUserId,
      originApp: 'ecoaudit',
      originUserId: ecoUserId,
      fieldUserId,
      email: `route-${suffix}@example.test`,
      passwordHash: 'integration-test-only',
      fullName: 'Route Inspector',
      role: 'inspector',
      isActive: true,
      sourceCreatedAt: now,
      sourceUpdatedAt: now,
      syncedAt: now,
      deletedAt: null,
      syncVersion: 1,
    });

    await db.insert(eaAudits).values({
      id: ecoId,
      siteName: 'George Street audit',
      siteAddress: destinations[0].address,
      ...structured(destinations[0]),
      inspectorName: 'Route Inspector',
      auditDate: '2026-08-20',
      status: 'Draft',
      assignedInspectorUserId: ecoUserId,
      updatedAt: now,
    });
    await db.insert(ssSites).values({
      id: solarSiteId,
      siteName: 'Pitt Street site',
      location: destinations[1].address,
      ...structured(destinations[1]),
      dateOfAssessment: '2026-08-20',
      status: 'Draft',
      updatedAt: now,
    });
    await db.insert(ssRooftopAssessments).values({
      id: solarAssessmentId,
      siteId: solarSiteId,
      siteName: 'Pitt Street site',
      buildingIdName: 'Main roof',
      assignedInspectorUserId: `route-solar-user-${suffix}`,
      status: 'Draft',
      updatedAt: now,
    });
    await db.insert(ihInstallations).values({
      id: installationId,
      clientName: 'Route Client',
      siteName: 'Castlereagh Street install',
      siteAddress: destinations[2].address,
      ...structured(destinations[2]),
      inspectorName: 'Route Inspector',
      auditDate: '2026-08-20',
      assignedInspectorUserId: fieldUserId,
      status: 'Draft',
      updatedAt: now,
    });

    await db.insert(portalScheduleEvents).values([
      {
        id: eventIds[0],
        title: 'George Street audit',
        sourceApp: 'ecoaudit',
        sourceType: 'audit',
        sourceId: ecoId,
        assigneeFieldUserId: fieldUserId,
        scheduledStartAt: new Date('2026-08-20T00:00:00.000Z'),
        scheduledEndAt: new Date('2026-08-20T00:45:00.000Z'),
        deadlineAt: new Date('2026-08-21T00:00:00.000Z'),
        status: 'planned',
        createdByUserId: 'route-admin',
        createdByApp: 'ecoaudit',
      },
      {
        id: eventIds[1],
        title: 'Pitt Street assessment',
        sourceApp: 'solarsense',
        sourceType: 'assessment',
        sourceId: solarAssessmentId,
        assigneeFieldUserId: fieldUserId,
        scheduledStartAt: new Date('2026-08-20T01:00:00.000Z'),
        scheduledEndAt: new Date('2026-08-20T01:45:00.000Z'),
        deadlineAt: new Date('2026-08-21T00:00:00.000Z'),
        status: 'in_progress',
        createdByUserId: 'route-admin',
        createdByApp: 'ecoaudit',
      },
      {
        id: eventIds[2],
        title: 'Castlereagh Street install',
        sourceApp: 'installhub',
        sourceType: 'installation',
        sourceId: installationId,
        assigneeFieldUserId: fieldUserId,
        scheduledStartAt: new Date('2026-08-20T02:00:00.000Z'),
        scheduledEndAt: new Date('2026-08-20T02:45:00.000Z'),
        deadlineAt: new Date('2026-08-21T00:00:00.000Z'),
        status: 'planned',
        createdByUserId: 'route-admin',
        createdByApp: 'ecoaudit',
      },
    ]);

    const currentLocation = { latitude: -33.86, longitude: 151.205 };
    const adminRoute = await getSchedulerRouteSuggestion({
      userId: 'route-admin',
      app: 'ecoaudit',
      role: 'admin',
      authType: 'jwt',
    }, {
      date: '2026-08-20',
      currentLocation,
      assigneeFieldUserId: fieldUserId,
    });
    assert.equal(adminRoute.timezone, 'Australia/Sydney');
    assert.equal(adminRoute.optimization, 'straight_line_distance');
    assert.deepEqual(
      new Set(adminRoute.jobs.map((job) => job.sourceApp)),
      new Set(['installhub']),
    );
    assert.equal(adminRoute.unroutableJobs.length, 0);
    assert.equal(adminRoute.googleMapsUrl, null);

    const inspector = {
      userId: ecoUserId,
      app: 'ecoaudit' as const,
      role: 'inspector' as const,
      authType: 'jwt' as const,
    };
    const selfRoute = await getSchedulerRouteSuggestion(inspector, {
      date: '2026-08-20',
      currentLocation,
    });
    assert.equal(selfRoute.assigneeFieldUserId, fieldUserId);
    await assert.rejects(
      getSchedulerRouteSuggestion(inspector, {
        date: '2026-08-20',
        currentLocation,
        assigneeFieldUserId: `another-field-user-${suffix}`,
      }),
      (error: unknown) => error instanceof AppError && error.statusCode === 403,
    );

    await db.update(ihInstallations).set({
      siteAddress: '99 Changed Street, Sydney NSW 2000, Australia',
    }).where(eq(ihInstallations.id, installationId));
    const staleRoute = await getSchedulerRouteSuggestion(inspector, {
      date: '2026-08-20',
      currentLocation,
    });
    assert.equal(staleRoute.jobs.length, 0);
    assert.equal(staleRoute.unroutableJobs[0]?.title, 'Castlereagh Street install');
    assert.equal(
      staleRoute.unroutableJobs[0]?.reason,
      'Address geocoding is not configured',
    );
    assert.ok(staleRoute.warnings.some((warning) => (
      warning.includes('Castlereagh Street install') && warning.includes('address changed')
    )));
    assert.equal(staleRoute.warnings.some((warning) => warning.includes(eventIds[2])), false);

    await assert.rejects(db.update(ihInstallations).set({
      siteLatitude: 51.5072,
      siteLongitude: -0.1276,
    }).where(eq(ihInstallations.id, installationId)));
    const [boundedInstallation] = await db.select({
      latitude: ihInstallations.siteLatitude,
      longitude: ihInstallations.siteLongitude,
    }).from(ihInstallations).where(eq(ihInstallations.id, installationId));
    assert.deepEqual(boundedInstallation, {
      latitude: destinations[2].latitude,
      longitude: destinations[2].longitude,
    });
  } finally {
    await db.delete(portalScheduleEvents).where(inArray(portalScheduleEvents.id, eventIds));
    await db.delete(eaAudits).where(eq(eaAudits.id, ecoId));
    await db.delete(ssRooftopAssessments).where(eq(ssRooftopAssessments.id, solarAssessmentId));
    await db.delete(ssSites).where(eq(ssSites.id, solarSiteId));
    await db.delete(ihInstallations).where(eq(ihInstallations.id, installationId));
    await db.delete(unifiedUsers).where(and(
      eq(unifiedUsers.globalUserId, globalUserId),
      eq(unifiedUsers.originApp, 'ecoaudit'),
    ));
    await db.delete(globalUsers).where(eq(globalUsers.id, globalUserId));
    await closeDb();
  }
});
