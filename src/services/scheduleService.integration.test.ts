import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

test('Scheduler exposes Field App work only and keeps assignment aligned', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { db, closeDb },
    {
      ihElectricalAssets,
      ihGridSupplies,
      ihInstallations,
      ihMeterDevices,
      ihZones,
    },
    {
      businessClients,
      businessJobs,
      businessSites,
      fieldAppJobDetails,
      globalUsers,
      portalScheduleEvents,
      unifiedUsers,
    },
    {
      cancelScheduleEvent,
      createScheduleEvent,
      createSchedulerDispatch,
      getScheduleEvent,
      listUnscheduledJobs,
      searchJobOptions,
      updateScheduleEvent,
    },
    { getSchedulerRouteSuggestion },
    { and, eq, inArray, ne },
  ] = await Promise.all([
    import('../db/client.js'),
    import('../db/schema/installhub.js'),
    import('../db/schema/shared.js'),
    import('./scheduleService.js'),
    import('./schedulerRouteService.js'),
    import('drizzle-orm'),
  ]);

  const runId = randomUUID();
  const actor = {
    globalUserId: `global-actor-${runId}`,
    fieldUserId: `field-actor-${runId}`,
    email: `actor-${runId}@example.test`,
    name: 'Scheduler Admin',
    appUserIds: {
      ecoaudit: `eco-actor-${runId}`,
      solarsense: `solar-actor-${runId}`,
      installhub: `field-actor-${runId}`,
    },
  };
  const firstAssignee = {
    globalUserId: `global-first-${runId}`,
    fieldUserId: `field-first-${runId}`,
    email: `first-${runId}@example.test`,
    name: 'First Inspector',
    appUserIds: {
      ecoaudit: `eco-first-${runId}`,
      solarsense: `solar-first-${runId}`,
      installhub: `field-first-${runId}`,
    },
  };
  const secondAssignee = {
    globalUserId: `global-second-${runId}`,
    fieldUserId: `field-second-${runId}`,
    email: `second-${runId}@example.test`,
    name: 'Second Inspector',
    appUserIds: {
      ecoaudit: `eco-second-${runId}`,
      solarsense: `solar-second-${runId}`,
      installhub: `field-second-${runId}`,
    },
  };
  const subjects = [actor, firstAssignee, secondAssignee];
  const now = new Date('2026-08-15T12:00:00.000Z');
  const admin = {
    userId: actor.appUserIds.ecoaudit,
    app: 'ecoaudit' as const,
    role: 'admin' as const,
    authType: 'jwt' as const,
  };
  const createdProductIds: string[] = [];
  const hiddenSchedulerJob = (error: unknown) => error instanceof Error
    && 'statusCode' in error
    && error.statusCode === 404
    && error.message === 'Scheduler job not found';

  try {
    await db.insert(globalUsers).values(subjects.map((subject) => ({
      id: subject.globalUserId,
      loginKey: subject.email,
      fieldUserId: subject.fieldUserId,
      primaryOriginApp: 'ecoaudit',
      primaryOriginUserId: subject.appUserIds.ecoaudit,
      displayEmail: subject.email,
      fullName: subject.name,
      role: subject === actor ? 'admin' : 'inspector',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })));
    await db.insert(unifiedUsers).values(subjects.flatMap((subject) => (
      (['ecoaudit', 'solarsense', 'installhub'] as const).map((originApp) => ({
        id: `${originApp}-${subject.globalUserId}`,
        globalUserId: subject.globalUserId,
        originApp,
        originUserId: subject.appUserIds[originApp],
        fieldUserId: subject.fieldUserId,
        email: subject.email,
        passwordHash: 'integration-test-only',
        fullName: subject.name,
        role: subject === actor ? 'admin' : 'inspector',
        isActive: true,
        sourceCreatedAt: now,
        sourceUpdatedAt: now,
        syncedAt: now,
        deletedAt: null,
        syncVersion: 1,
      }))
    )));

    const baseDispatch = {
      assigneeFieldUserId: firstAssignee.fieldUserId,
      scheduledStartAt: '2026-08-20T09:00:00.000Z',
      estimatedDurationMinutes: 90,
      deadlineAt: '2026-08-22T17:00:00.000Z',
    };
    await assert.rejects(createSchedulerDispatch(admin, {
      ...baseDispatch,
      sourceApp: 'ecoaudit',
      job: {
        siteName: `Hidden Eco ${runId}`,
        siteAddress: '1 Hidden Street',
        auditDate: '2026-08-20',
      },
    }), hiddenSchedulerJob);
    await assert.rejects(createSchedulerDispatch(admin, {
      ...baseDispatch,
      sourceApp: 'solarsense',
      job: {
        siteName: `Hidden Solar ${runId}`,
        location: '2 Hidden Street',
        auditDate: '2026-08-20',
      },
    }), hiddenSchedulerJob);
    await assert.rejects(
      searchJobOptions(admin, `Hidden Eco ${runId}`, 'ecoaudit'),
      hiddenSchedulerJob,
    );
    await assert.rejects(
      searchJobOptions(admin, `Hidden Solar ${runId}`, 'solarsense'),
      hiddenSchedulerJob,
    );
    await assert.rejects(
      listUnscheduledJobs(admin, { sourceApp: 'ecoaudit' }),
      hiddenSchedulerJob,
    );
    await assert.rejects(
      listUnscheduledJobs(admin, { sourceApp: 'solarsense' }),
      hiddenSchedulerJob,
    );
    await assert.rejects(createScheduleEvent(admin, {
      sourceApp: 'ecoaudit',
      sourceType: 'audit',
      sourceId: `hidden-eco-${runId}`,
      assigneeFieldUserId: firstAssignee.fieldUserId,
      scheduledStartAt: baseDispatch.scheduledStartAt,
      deadlineAt: baseDispatch.deadlineAt,
    }), hiddenSchedulerJob);
    await assert.rejects(createScheduleEvent(admin, {
      sourceApp: 'solarsense',
      sourceType: 'assessment',
      sourceId: `hidden-solar-${runId}`,
      assigneeFieldUserId: firstAssignee.fieldUserId,
      scheduledStartAt: baseDispatch.scheduledStartAt,
      deadlineAt: baseDispatch.deadlineAt,
    }), hiddenSchedulerJob);
    const field = await createSchedulerDispatch(admin, {
      ...baseDispatch,
      sourceApp: 'installhub',
      job: {
        clientName: `Client ${runId}`,
        siteName: `Field ${runId}`,
        siteAddress: '3 Field Street',
        workType: 'M3 - Inspection',
        titleSuffix: 'A7Z',
        auditDate: '2026-08-20',
        address: {
          freeform: '3 Field Street',
          locality: 'Sydney',
          state: 'NSW',
          postcode: '2002',
          countryCode: 'AU',
          latitude: -33.88,
          longitude: 151.21,
          provider: 'photon',
          placeId: 'W:field',
        },
      },
    });
    const unassignedField = await createSchedulerDispatch(admin, {
      sourceApp: 'installhub',
      scheduledStartAt: '2026-08-20T12:00:00.000Z',
      deadlineAt: '2026-08-22T17:00:00.000Z',
      job: {
        clientName: `Unassigned client ${runId}`,
        siteName: `Unassigned field ${runId}`,
        siteAddress: '4 Field Street',
        workType: 'M1 - New install',
        jobComments: 'Unassigned scope',
        address: {
          freeform: '4 Field Street',
          locality: 'Sydney',
          state: 'NSW',
          postcode: '2003',
          countryCode: 'AU',
        },
      },
    });
    createdProductIds.push(field.sourceId!);
    assert.ok('scheduledEventId' in unassignedField);
    createdProductIds.push(unassignedField.id);

    assert.equal(field.sourceType, 'installation');
    assert.equal(field.status, 'planned');
    assert.equal(unassignedField.assigneeFieldUserId, null);
    assert.equal(unassignedField.scheduledEventId, null);
    const [[unassignedInstallation], unassignedEvents] = await Promise.all([
      db.select().from(ihInstallations).where(eq(ihInstallations.id, unassignedField.id)),
      db.select().from(portalScheduleEvents).where(eq(
        portalScheduleEvents.sourceId,
        unassignedField.id,
      )),
    ]);
    assert.equal(unassignedInstallation.assignedInspectorUserId, null);
    assert.equal(unassignedInstallation.jobComments, 'Unassigned scope');
    assert.equal(unassignedEvents.length, 0);
    assert.equal(field.estimatedDurationMinutes, 90);
    assert.equal(field.scheduledEndAt, '2026-08-20T10:30:00.000Z');
    const [storedFieldEvent] = await db.select().from(portalScheduleEvents)
      .where(eq(portalScheduleEvents.id, field.id));
    assert.equal(storedFieldEvent.estimatedDurationMinutes, 90);
    assert.equal(
      storedFieldEvent.scheduledEndAt?.toISOString(),
      '2026-08-20T10:30:00.000Z',
    );

    const [
      [fieldRow],
      gridRows,
      [fieldIdentityJob],
      [fieldDetail],
      [fieldIdentityEvent],
    ] = await Promise.all([
      db.select().from(ihInstallations)
        .where(eq(ihInstallations.id, field.sourceId!)),
      db.select().from(ihGridSupplies)
        .where(eq(ihGridSupplies.installationId, field.sourceId!)),
      db.select().from(businessJobs).where(eq(businessJobs.id, field.jobId!)),
      db.select().from(fieldAppJobDetails).where(eq(fieldAppJobDetails.jobId, field.jobId!)),
      db.select().from(portalScheduleEvents).where(eq(portalScheduleEvents.id, field.id)),
    ]);
    assert.equal(fieldRow.status, 'Draft');
    assert.equal(fieldRow.createdByUserId, actor.fieldUserId);
    assert.equal(fieldRow.assignedInspectorUserId, firstAssignee.fieldUserId);
    assert.equal(fieldRow.inspectorName, firstAssignee.name);
    assert.equal(fieldRow.auditDate, '2026-08-20');
    assert.equal(fieldRow.timezone, 'Australia/Sydney');
    assert.match(field.jobId ?? '', /^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    assert.equal(fieldIdentityJob.id, field.jobId);
    assert.equal(fieldDetail.jobId, field.jobId);
    assert.equal(fieldIdentityEvent.jobId, field.jobId);
    assert.equal(fieldRow.customJobNumber, null);
    assert.equal(fieldDetail.customJobNumber, null);
    assert.match(field.title, / - A7Z$/);
    assert.equal(gridRows.length, 1);
    assert.equal(gridRows[0].isDefault, true);

    const sourceZoneId = randomUUID();
    const sourceBoardId = randomUUID();
    const sourceMeterId = randomUUID();
    await db.insert(ihZones).values({
      id: sourceZoneId,
      serverId: randomUUID(),
      syncStatus: 'synced',
      installationId: field.sourceId!,
      zoneCode: 'MAIN',
      zoneName: 'Main building',
      zoneDescription: '',
      photos: [],
      updatedAt: now,
      createdAt: now,
    });
    await db.insert(ihElectricalAssets).values({
      id: sourceBoardId,
      serverId: randomUUID(),
      syncStatus: 'synced',
      installationId: field.sourceId!,
      zoneId: sourceZoneId,
      assetName: 'Main switchboard',
      displayCode: 'MAIN-01-MSB',
      assetType: 'MAIN_SWITCHBOARD',
      typeCode: 'MSB',
      sourceKind: 'GRID',
      gridSupplyId: gridRows[0].id,
      updatedAt: now,
      createdAt: now,
    });
    await db.insert(ihMeterDevices).values({
      id: sourceMeterId,
      serverId: randomUUID(),
      syncStatus: 'synced',
      installationId: field.sourceId!,
      installedOnBoardId: sourceBoardId,
      customName: 'Existing main meter',
      deviceFamily: 'WATTWATCHERS',
      deviceModel: 'A3RM',
      serialNumber: 'KNOWN-METER-001',
      updatedAt: now,
      createdAt: now,
    });
    const [fieldBusinessJob] = await db.select().from(businessJobs)
      .where(eq(businessJobs.id, field.jobId!));
    const followUpField = await createSchedulerDispatch(admin, {
      ...baseDispatch,
      scheduledStartAt: '2026-08-24T09:00:00.000Z',
      deadlineAt: '2026-08-26T17:00:00.000Z',
      sourceApp: 'installhub',
      job: {
        siteMode: 'existing',
        existingSiteId: fieldBusinessJob.siteId,
        clientName: `Client ${runId}`,
        siteName: `Field ${runId}`,
        siteAddress: '3 Field Street, Sydney NSW 2002, Australia',
        workType: 'meter_replacement_m3',
        auditDate: '2026-08-24',
        address: {
          freeform: '3 Field Street',
          locality: 'Sydney',
          state: 'NSW',
          postcode: '2002',
          countryCode: 'AU',
        },
      },
    });
    createdProductIds.push(followUpField.sourceId!);
    const [followUpJob] = await db.select().from(businessJobs)
      .where(eq(businessJobs.id, followUpField.jobId!));
    assert.equal(followUpJob.siteId, fieldBusinessJob.siteId);
    const [[followUpInstallation], followUpZones, followUpMeters, originalMeters] = await Promise.all([
      db.select().from(ihInstallations)
        .where(eq(ihInstallations.id, followUpField.sourceId!)),
      db.select().from(ihZones)
        .where(eq(ihZones.installationId, followUpField.sourceId!)),
      db.select().from(ihMeterDevices)
        .where(eq(ihMeterDevices.installationId, followUpField.sourceId!)),
      db.select().from(ihMeterDevices)
        .where(eq(ihMeterDevices.installationId, field.sourceId!)),
    ]);
    assert.equal(followUpInstallation.businessSiteId, fieldBusinessJob.siteId);
    assert.equal(followUpInstallation.siteName, `Field ${runId}`);
    assert.equal(followUpInstallation.siteAddress, '3 Field Street, Sydney NSW 2002, Australia');
    assert.equal(followUpInstallation.serviceType, 'meter_replacement_m3');
    assert.equal(followUpInstallation.electricalMapLayout, null);
    assert.equal(followUpInstallation.electricalMapLayoutRevision, 0);
    assert.equal(followUpZones.length, 1);
    assert.notEqual(followUpZones[0].id, sourceZoneId);
    assert.equal(followUpZones[0].zoneName, 'Main building');
    assert.equal(followUpMeters.length, 1);
    assert.notEqual(followUpMeters[0].id, sourceMeterId);
    assert.equal(followUpMeters[0].serialNumber, 'KNOWN-METER-001');
    assert.equal(originalMeters.length, 1);
    assert.equal(originalMeters[0].id, sourceMeterId);
    assert.equal(originalMeters[0].serialNumber, 'KNOWN-METER-001');

    assert.equal(fieldRow.sitePostcode, '2002');
    assert.equal(fieldRow.siteGeocodeStatus, 'resolved');

    const route = await getSchedulerRouteSuggestion(admin, {
      date: '2026-08-20',
      currentLocation: { latitude: -33.865, longitude: 151.205 },
      assigneeFieldUserId: firstAssignee.fieldUserId,
    });
    assert.equal(route.optimization, 'straight_line_distance');
    assert.equal(route.jobs.length, 1);
    assert.equal(route.unroutableJobs.length, 0);
    assert.deepEqual(new Set(route.jobs.map((job) => job.sourceApp)), new Set(['installhub']));
    assert.equal(route.googleMapsUrl, null);

    const reassignedEvent = await updateScheduleEvent(admin, field.id, {
      assigneeFieldUserId: secondAssignee.fieldUserId,
    });
    assert.equal(reassignedEvent.estimatedDurationMinutes, 90);
    assert.equal(reassignedEvent.scheduledEndAt, '2026-08-20T10:30:00.000Z');
    const [reassignedField] = await db.select().from(ihInstallations)
      .where(eq(ihInstallations.id, field.sourceId!));
    assert.equal(reassignedField.assignedInspectorUserId, secondAssignee.fieldUserId);

    const reestimatedEvent = await updateScheduleEvent(admin, field.id, {
      estimatedDurationMinutes: 120,
    });
    assert.equal(reestimatedEvent.estimatedDurationMinutes, 120);
    assert.equal(reestimatedEvent.scheduledEndAt, '2026-08-20T11:00:00.000Z');
    const movedEvent = await updateScheduleEvent(admin, field.id, {
      scheduledStartAt: '2026-08-20T10:00:00.000Z',
    });
    assert.equal(movedEvent.estimatedDurationMinutes, 120);
    assert.equal(movedEvent.scheduledEndAt, '2026-08-20T12:00:00.000Z');
    const clearedEstimate = await updateScheduleEvent(admin, field.id, {
      estimatedDurationMinutes: null,
    });
    assert.equal(clearedEstimate.estimatedDurationMinutes, null);
    assert.equal(clearedEstimate.scheduledEndAt, null);

    const linkableFieldInstallationId = `linkable-field-${runId}`;
    createdProductIds.push(linkableFieldInstallationId);
    await db.insert(ihInstallations).values({
      id: linkableFieldInstallationId,
      clientName: `Linkable client ${runId}`,
      siteName: `Linkable field ${runId}`,
      siteAddress: '5 Linkable Street',
      timezone: 'Australia/Perth',
      inspectorName: 'Legacy inspector label',
      auditDate: '2026-08-01',
      status: 'Draft',
      createdByUserId: actor.fieldUserId,
      assignedInspectorUserId: null,
      updatedAt: now,
    });
    const linkedField = await createScheduleEvent(admin, {
      sourceApp: 'installhub',
      sourceType: 'installation',
      sourceId: linkableFieldInstallationId,
      assigneeFieldUserId: firstAssignee.fieldUserId,
      scheduledStartAt: '2026-08-20T23:30:00.000Z',
      deadlineAt: '2026-08-23T17:00:00.000Z',
    });
    let [linkedFieldRow] = await db.select().from(ihInstallations)
      .where(eq(ihInstallations.id, linkableFieldInstallationId));
    assert.equal(linkedFieldRow.assignedInspectorUserId, firstAssignee.fieldUserId);
    assert.equal(linkedFieldRow.inspectorName, firstAssignee.name);
    assert.equal(linkedFieldRow.auditDate, '2026-08-21');
    const defaultFieldPool = await listUnscheduledJobs(admin, {
      q: `Linkable field ${runId}`,
      sourceApp: 'installhub',
    });
    assert.equal(defaultFieldPool.some((option) => option.id === linkableFieldInstallationId), false);
    const completeFieldPool = await listUnscheduledJobs(admin, {
      q: `Linkable field ${runId}`,
      sourceApp: 'installhub',
      unscheduledOnly: false,
    });
    const scheduledFieldOption = completeFieldPool.find(
      (option) => option.id === linkableFieldInstallationId,
    );
    assert.equal(scheduledFieldOption?.assigneeFieldUserId, firstAssignee.fieldUserId);
    assert.equal(scheduledFieldOption?.assigneeDisplayName, firstAssignee.name);
    assert.equal(scheduledFieldOption?.scheduledEventId, linkedField.id);
    assert.equal(scheduledFieldOption?.scheduledStartAt, '2026-08-20T23:30:00.000Z');

    await updateScheduleEvent(admin, linkedField.id, {
      assigneeFieldUserId: secondAssignee.fieldUserId,
      scheduledStartAt: '2026-08-21T23:30:00.000Z',
    });
    [linkedFieldRow] = await db.select().from(ihInstallations)
      .where(eq(ihInstallations.id, linkableFieldInstallationId));
    assert.equal(linkedFieldRow.assignedInspectorUserId, secondAssignee.fieldUserId);
    assert.equal(linkedFieldRow.inspectorName, secondAssignee.name);
    assert.equal(linkedFieldRow.auditDate, '2026-08-22');
    assert.equal(linkedFieldRow.status, 'Draft');
    assert.equal(linkedFieldRow.completedAt, null);

    // Legacy rows remain readable with their historic end until the schedule
    // itself is rewritten. A start edit without an estimate must not invent a
    // replacement duration.
    const historicalEnd = new Date('2026-08-22T16:00:00.000Z');
    await db.update(portalScheduleEvents).set({
      estimatedDurationMinutes: null,
      scheduledEndAt: historicalEnd,
    }).where(eq(portalScheduleEvents.id, linkedField.id));
    const legacyRead = await getScheduleEvent(admin, linkedField.id);
    assert.equal(legacyRead.estimatedDurationMinutes, null);
    assert.equal(legacyRead.scheduledEndAt, historicalEnd.toISOString());
    const legacyTitleEdit = await updateScheduleEvent(admin, linkedField.id, {
      title: 'Legacy end preserved',
      assigneeFieldUserId: firstAssignee.fieldUserId,
      scheduledStartAt: '2026-08-21T23:30:00.000Z',
    });
    assert.equal(legacyTitleEdit.scheduledEndAt, historicalEnd.toISOString());
    const legacyScheduleRewrite = await updateScheduleEvent(admin, linkedField.id, {
      scheduledStartAt: '2026-08-22T09:00:00.000Z',
    });
    assert.equal(legacyScheduleRewrite.estimatedDurationMinutes, null);
    assert.equal(legacyScheduleRewrite.scheduledEndAt, null);

    const cancelled = await cancelScheduleEvent(admin, linkedField.id);
    assert.equal(cancelled.status, 'cancelled');
    [linkedFieldRow] = await db.select().from(ihInstallations)
      .where(eq(ihInstallations.id, linkableFieldInstallationId));
    assert.equal(linkedFieldRow.assignedInspectorUserId, null);

    // A cancelled Field event can be rescheduled, but two concurrent attempts
    // still serialize on the product row and produce only one active event.
    const concurrent = await Promise.allSettled([
      createScheduleEvent(admin, {
        sourceApp: 'installhub',
        sourceType: 'installation',
        sourceId: linkableFieldInstallationId,
        assigneeFieldUserId: firstAssignee.fieldUserId,
        scheduledStartAt: baseDispatch.scheduledStartAt,
        deadlineAt: baseDispatch.deadlineAt,
      }),
      createScheduleEvent(admin, {
        sourceApp: 'installhub',
        sourceType: 'installation',
        sourceId: linkableFieldInstallationId,
        assigneeFieldUserId: secondAssignee.fieldUserId,
        scheduledStartAt: baseDispatch.scheduledStartAt,
        deadlineAt: baseDispatch.deadlineAt,
      }),
    ]);
    const fulfilled = concurrent.filter((result) => result.status === 'fulfilled');
    const rejected = concurrent.filter((result) => result.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(
      (rejected[0] as PromiseRejectedResult).reason.statusCode,
      409,
    );
    const winner = (fulfilled[0] as PromiseFulfilledResult<{
      assigneeFieldUserId: string;
    }>).value;
    const [raceInstallation] = await db.select().from(ihInstallations)
      .where(eq(ihInstallations.id, linkableFieldInstallationId));
    const expectedProductAssignee = winner.assigneeFieldUserId === firstAssignee.fieldUserId
      ? firstAssignee.fieldUserId
      : secondAssignee.fieldUserId;
    assert.equal(raceInstallation.assignedInspectorUserId, expectedProductAssignee);
    const activeRaceEvents = await db.select().from(portalScheduleEvents).where(and(
      eq(portalScheduleEvents.sourceApp, 'installhub'),
      eq(portalScheduleEvents.sourceType, 'installation'),
      eq(portalScheduleEvents.sourceId, linkableFieldInstallationId),
      ne(portalScheduleEvents.status, 'cancelled'),
    ));
    assert.equal(activeRaceEvents.length, 1);
  } finally {
    await db.delete(portalScheduleEvents)
      .where(eq(portalScheduleEvents.createdByUserId, actor.appUserIds.ecoaudit));
    await db.delete(ihMeterDevices)
      .where(inArray(ihMeterDevices.installationId, createdProductIds));
    await db.delete(ihElectricalAssets)
      .where(inArray(ihElectricalAssets.installationId, createdProductIds));
    await db.delete(ihZones)
      .where(inArray(ihZones.installationId, createdProductIds));
    await db.delete(ihGridSupplies)
      .where(inArray(ihGridSupplies.installationId, createdProductIds));
    await db.delete(ihInstallations)
      .where(inArray(ihInstallations.id, createdProductIds));
    const createdBusinessJobs = await db.select({
      id: businessJobs.id,
      siteId: businessJobs.siteId,
      revisionNumber: businessJobs.revisionNumber,
    }).from(businessJobs).where(eq(businessJobs.createdByUserId, actor.appUserIds.ecoaudit));
    for (const job of createdBusinessJobs.sort((a, b) => b.revisionNumber - a.revisionNumber)) {
      await db.delete(businessJobs).where(eq(businessJobs.id, job.id));
    }
    const businessSiteIds = [...new Set(createdBusinessJobs.map((job) => job.siteId))];
    if (businessSiteIds.length > 0) {
      const clientRows = await db.select({ clientId: businessSites.clientId })
        .from(businessSites)
        .where(inArray(businessSites.id, businessSiteIds));
      await db.delete(businessSites).where(inArray(businessSites.id, businessSiteIds));
      const clientIds = [...new Set(clientRows.map((row) => row.clientId))];
      if (clientIds.length > 0) {
        await db.delete(businessClients).where(inArray(businessClients.id, clientIds));
      }
    }
    await db.delete(globalUsers).where(inArray(
      globalUsers.id,
      subjects.map((subject) => subject.globalUserId),
    ));
    await closeDb();
  }
});
