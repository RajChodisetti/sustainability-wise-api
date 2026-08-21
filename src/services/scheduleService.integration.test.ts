import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

test('scheduler dispatch creates Draft product work and keeps assignment aligned', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { db, closeDb },
    { eaAudits },
    { ihGridSupplies, ihInstallations },
    { ssRooftopAssessments, ssSites },
    {
      globalUsers,
      photoCopyReferences,
      photoRegistry,
      portalScheduleEvents,
      schedulerNotificationJobs,
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
    { and, eq, inArray, ne },
    { buildApp },
    { signAccessToken },
    { hasAccessibleCopyReference },
  ] = await Promise.all([
    import('../db/client.js'),
    import('../db/schema/ecoaudit.js'),
    import('../db/schema/installhub.js'),
    import('../db/schema/solarsense.js'),
    import('../db/schema/shared.js'),
    import('./scheduleService.js'),
    import('drizzle-orm'),
    import('../app.js'),
    import('../auth/jwt.js'),
    import('../storage/photoCopyReferences.js'),
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
  const createdSiteIds: string[] = [];
  const copiedPhotoIds: string[] = [];

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
    const eco = await createSchedulerDispatch(admin, {
      ...baseDispatch,
      sourceApp: 'ecoaudit',
      job: {
        siteName: `Eco ${runId}`,
        siteAddress: '1 Eco Street',
        auditDate: '2026-08-20',
      },
    });
    const solar = await createSchedulerDispatch(admin, {
      ...baseDispatch,
      sourceApp: 'solarsense',
      job: {
        siteName: `Solar ${runId}`,
        location: 'North roof campus',
        buildingIdName: 'Building A roof',
        auditDate: '2026-08-20',
      },
    });
    const field = await createSchedulerDispatch(admin, {
      ...baseDispatch,
      sourceApp: 'installhub',
      job: {
        clientName: `Client ${runId}`,
        siteName: `Field ${runId}`,
        siteAddress: '3 Field Street',
        auditDate: '2026-08-20',
      },
    });
    createdProductIds.push(eco.sourceId!, solar.sourceId!, field.sourceId!);

    assert.equal(eco.sourceType, 'audit');
    assert.equal(solar.sourceType, 'assessment');
    assert.equal(field.sourceType, 'installation');
    assert.equal(eco.status, 'planned');
    assert.equal(solar.status, 'planned');
    assert.equal(field.status, 'planned');
    assert.equal(eco.estimatedDurationMinutes, 90);
    assert.equal(eco.scheduledEndAt, '2026-08-20T10:30:00.000Z');
    const [storedEcoEvent] = await db.select().from(portalScheduleEvents)
      .where(eq(portalScheduleEvents.id, eco.id));
    assert.equal(storedEcoEvent.estimatedDurationMinutes, 90);
    assert.equal(
      storedEcoEvent.scheduledEndAt?.toISOString(),
      '2026-08-20T10:30:00.000Z',
    );

    const [[ecoRow], [solarRow], [fieldRow], gridRows] = await Promise.all([
      db.select().from(eaAudits).where(eq(eaAudits.id, eco.sourceId!)),
      db.select().from(ssRooftopAssessments)
        .where(eq(ssRooftopAssessments.id, solar.sourceId!)),
      db.select().from(ihInstallations)
        .where(eq(ihInstallations.id, field.sourceId!)),
      db.select().from(ihGridSupplies)
        .where(eq(ihGridSupplies.installationId, field.sourceId!)),
    ]);
    assert.equal(ecoRow.status, 'Draft');
    assert.equal(ecoRow.createdByUserId, actor.appUserIds.ecoaudit);
    assert.equal(ecoRow.assignedInspectorUserId, firstAssignee.appUserIds.ecoaudit);
    assert.equal(ecoRow.inspectorName, firstAssignee.name);
    assert.equal(ecoRow.auditDate, '2026-08-20');
    assert.equal(solarRow.status, 'Draft');
    assert.equal(solarRow.createdByUserId, actor.appUserIds.solarsense);
    assert.equal(solarRow.assignedInspectorUserId, firstAssignee.appUserIds.solarsense);
    assert.equal(fieldRow.status, 'Draft');
    assert.equal(fieldRow.createdByUserId, actor.fieldUserId);
    assert.equal(fieldRow.assignedInspectorUserId, firstAssignee.fieldUserId);
    assert.equal(fieldRow.inspectorName, firstAssignee.name);
    assert.equal(fieldRow.timezone, 'Australia/Sydney');
    assert.equal(gridRows.length, 1);
    assert.equal(gridRows[0].isDefault, true);

    const [solarSite] = await db.select().from(ssSites)
      .where(eq(ssSites.id, solarRow.siteId!));
    createdSiteIds.push(solarSite.id);
    assert.equal(solarSite.status, 'Draft');
    assert.equal(solarSite.createdByUserId, actor.appUserIds.solarsense);

    const reassignedEvent = await updateScheduleEvent(admin, solar.id, {
      assigneeFieldUserId: secondAssignee.fieldUserId,
    });
    assert.equal(reassignedEvent.estimatedDurationMinutes, 90);
    assert.equal(reassignedEvent.scheduledEndAt, '2026-08-20T10:30:00.000Z');
    const [reassignedSolar] = await db.select().from(ssRooftopAssessments)
      .where(eq(ssRooftopAssessments.id, solar.sourceId!));
    assert.equal(
      reassignedSolar.assignedInspectorUserId,
      secondAssignee.appUserIds.solarsense,
    );

    const reestimatedEvent = await updateScheduleEvent(admin, solar.id, {
      estimatedDurationMinutes: 120,
    });
    assert.equal(reestimatedEvent.estimatedDurationMinutes, 120);
    assert.equal(reestimatedEvent.scheduledEndAt, '2026-08-20T11:00:00.000Z');
    const movedEvent = await updateScheduleEvent(admin, solar.id, {
      scheduledStartAt: '2026-08-20T10:00:00.000Z',
    });
    assert.equal(movedEvent.estimatedDurationMinutes, 120);
    assert.equal(movedEvent.scheduledEndAt, '2026-08-20T12:00:00.000Z');
    const clearedEstimate = await updateScheduleEvent(admin, solar.id, {
      estimatedDurationMinutes: null,
    });
    assert.equal(clearedEstimate.estimatedDurationMinutes, null);
    assert.equal(clearedEstimate.scheduledEndAt, null);

    const copiedPhotoId = `scheduler-photo-${runId}`;
    copiedPhotoIds.push(copiedPhotoId);
    await db.insert(photoRegistry).values({
      id: copiedPhotoId,
      checksum: `checksum-${runId}`,
      app: 'solarsense',
      parentId: `original-site-${runId}`,
      entityType: 'rooftop_assessment',
      entityId: `original-assessment-${runId}`,
      fieldName: 'aerial_photo_uri',
      status: 'confirmed',
    });
    await db.insert(photoCopyReferences).values({
      id: `scheduler-reference-${runId}`,
      app: 'solarsense',
      photoId: copiedPhotoId,
      targetParentId: solarSite.id,
      targetEntityType: 'rooftop_assessment',
      targetEntityId: solar.sourceId!,
      targetFieldName: 'aerial_photo_uri',
    });
    assert.equal(await hasAccessibleCopyReference(copiedPhotoId, {
      userId: secondAssignee.appUserIds.solarsense,
      app: 'solarsense',
      role: 'inspector',
      authType: 'jwt',
    }), true);
    const solarApp = await buildApp();
    try {
      const solarToken = signAccessToken({
        userId: secondAssignee.appUserIds.solarsense,
        app: 'solarsense',
        role: 'inspector',
      });
      const solarHeaders = { authorization: `Bearer ${solarToken}` };
      const assignedAssessment = await solarApp.inject({
        method: 'GET',
        url: `/v1/solarsense/sites/${solarSite.id}/assessments/${solar.sourceId}`,
        headers: solarHeaders,
      });
      assert.equal(assignedAssessment.statusCode, 200, assignedAssessment.body);
      const copiedPhoto = await solarApp.inject({
        method: 'GET',
        url: `/v1/solarsense/photos/${copiedPhotoId}`,
        headers: solarHeaders,
      });
      assert.equal(copiedPhoto.statusCode, 200, copiedPhoto.body);
      const forbiddenSiteMutation = await solarApp.inject({
        method: 'PATCH',
        url: `/v1/solarsense/sites/${solarSite.id}`,
        headers: solarHeaders,
        payload: { location: 'Inspector must not mutate parent ownership context' },
      });
      assert.equal(forbiddenSiteMutation.statusCode, 403, forbiddenSiteMutation.body);

      const cancelled = await cancelScheduleEvent(admin, solar.id);
      assert.equal(cancelled.status, 'cancelled');
      const [cancelledSolar] = await db.select().from(ssRooftopAssessments)
        .where(eq(ssRooftopAssessments.id, solar.sourceId!));
      assert.ok(cancelledSolar);
      assert.equal(cancelledSolar.status, 'Draft');
      assert.equal(cancelledSolar.assignedInspectorUserId, null);
      assert.equal(await hasAccessibleCopyReference(copiedPhotoId, {
        userId: secondAssignee.appUserIds.solarsense,
        app: 'solarsense',
        role: 'inspector',
        authType: 'jwt',
      }), false);
      const revokedAssessment = await solarApp.inject({
        method: 'GET',
        url: `/v1/solarsense/sites/${solarSite.id}/assessments/${solar.sourceId}`,
        headers: solarHeaders,
      });
      assert.equal(revokedAssessment.statusCode, 403, revokedAssessment.body);
    } finally {
      await solarApp.close();
    }

    const linkableEcoAuditId = `linkable-eco-${runId}`;
    createdProductIds.push(linkableEcoAuditId);
    await db.insert(eaAudits).values({
      id: linkableEcoAuditId,
      siteName: `Linkable Eco ${runId}`,
      siteAddress: '4 Linkable Street',
      inspectorName: firstAssignee.name,
      auditDate: '2026-08-20',
      status: 'Draft',
      createdByUserId: actor.appUserIds.ecoaudit,
      updatedAt: now,
    });
    const ecoOptions = await searchJobOptions(admin, `Linkable Eco ${runId}`, 'ecoaudit');
    assert.equal(
      ecoOptions.some((option) => option.id === linkableEcoAuditId),
      true,
    );
    const unscheduledEco = await listUnscheduledJobs(admin, {
      q: `Linkable Eco ${runId}`,
      sourceApp: 'ecoaudit',
    });
    assert.equal(
      unscheduledEco.some((option) => option.id === linkableEcoAuditId),
      true,
    );
    const linkedEco = await createScheduleEvent(admin, {
      sourceApp: 'ecoaudit',
      sourceType: 'audit',
      sourceId: linkableEcoAuditId,
      assigneeFieldUserId: firstAssignee.fieldUserId,
      scheduledStartAt: baseDispatch.scheduledStartAt,
      deadlineAt: baseDispatch.deadlineAt,
    });
    assert.equal(linkedEco.sourceId, linkableEcoAuditId);
    assert.equal(linkedEco.sourceApp, 'ecoaudit');
    assert.equal(linkedEco.estimatedDurationMinutes, null);
    assert.equal(linkedEco.scheduledEndAt, null);
    const [linkedEcoRow] = await db.select().from(eaAudits)
      .where(eq(eaAudits.id, linkableEcoAuditId));
    assert.equal(linkedEcoRow.assignedInspectorUserId, firstAssignee.appUserIds.ecoaudit);

    // Legacy rows remain readable with their historic end until the schedule
    // itself is rewritten. A start edit without an estimate must not invent a
    // replacement duration.
    const historicalEnd = new Date('2026-08-20T16:00:00.000Z');
    await db.update(portalScheduleEvents).set({
      estimatedDurationMinutes: null,
      scheduledEndAt: historicalEnd,
    }).where(eq(portalScheduleEvents.id, linkedEco.id));
    const legacyRead = await getScheduleEvent(admin, linkedEco.id);
    assert.equal(legacyRead.estimatedDurationMinutes, null);
    assert.equal(legacyRead.scheduledEndAt, historicalEnd.toISOString());
    const legacyTitleEdit = await updateScheduleEvent(admin, linkedEco.id, {
      title: 'Legacy end preserved',
      assigneeFieldUserId: firstAssignee.fieldUserId,
      scheduledStartAt: baseDispatch.scheduledStartAt,
    });
    assert.equal(legacyTitleEdit.scheduledEndAt, historicalEnd.toISOString());
    const legacyScheduleRewrite = await updateScheduleEvent(admin, linkedEco.id, {
      scheduledStartAt: '2026-08-21T09:00:00.000Z',
    });
    assert.equal(legacyScheduleRewrite.estimatedDurationMinutes, null);
    assert.equal(legacyScheduleRewrite.scheduledEndAt, null);

    const doneLinkedEco = await updateScheduleEvent(admin, linkedEco.id, {
      status: 'done',
    });
    assert.equal(doneLinkedEco.status, 'done');
    const reactivatedLinkedEco = await updateScheduleEvent(admin, linkedEco.id, {
      status: 'planned',
    });
    assert.equal(reactivatedLinkedEco.status, 'planned');

    const legacySiteEventId = randomUUID();
    await db.insert(portalScheduleEvents).values({
      id: legacySiteEventId,
      title: 'Legacy Solar site event',
      sourceApp: 'solarsense',
      sourceType: 'site',
      sourceId: solarSite.id,
      assigneeFieldUserId: firstAssignee.fieldUserId,
      assigneeDisplayName: firstAssignee.name,
      assigneeEmail: firstAssignee.email,
      scheduledStartAt: new Date(baseDispatch.scheduledStartAt),
      deadlineAt: new Date(baseDispatch.deadlineAt),
      status: 'done',
      createdByUserId: actor.appUserIds.ecoaudit,
      createdByApp: 'ecoaudit',
    });
    await db.update(ssSites).set({
      status: 'Completed',
      completedAt: now,
    }).where(eq(ssSites.id, solarSite.id));
    await assert.rejects(
      updateScheduleEvent(admin, legacySiteEventId, { status: 'planned' }),
      (error: unknown) => (
        (error as { statusCode?: number; message?: string }).statusCode === 404
        && (error as { message?: string }).message === 'Active Draft site not found'
      ),
    );

    await db.update(ssSites).set({
      status: 'Draft',
      completedAt: null,
      deletedAt: null,
    }).where(eq(ssSites.id, solarSite.id));
    const reactivatedLegacySite = await updateScheduleEvent(admin, legacySiteEventId, {
      status: 'planned',
    });
    assert.equal(reactivatedLegacySite.status, 'planned');
    const legacySiteNotifications = await db.select({ id: schedulerNotificationJobs.id })
      .from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.eventId, legacySiteEventId));
    assert.deepEqual(legacySiteNotifications, []);

    await updateScheduleEvent(admin, legacySiteEventId, { status: 'done' });
    await db.update(ssSites).set({ deletedAt: now })
      .where(eq(ssSites.id, solarSite.id));
    await assert.rejects(
      updateScheduleEvent(admin, legacySiteEventId, { status: 'in_progress' }),
      (error: unknown) => (
        (error as { statusCode?: number; message?: string }).statusCode === 404
        && (error as { message?: string }).message === 'Active Draft site not found'
      ),
    );
    const [stillDoneLegacySiteEvent] = await db.select({ status: portalScheduleEvents.status })
      .from(portalScheduleEvents)
      .where(eq(portalScheduleEvents.id, legacySiteEventId));
    assert.equal(stillDoneLegacySiteEvent.status, 'done');
    await db.update(ssSites).set({ deletedAt: null })
      .where(eq(ssSites.id, solarSite.id));

    // A cancelled Solar event can be rescheduled, but two concurrent attempts
    // still serialize on the product row and produce only one active event.
    const concurrent = await Promise.allSettled([
      createScheduleEvent(admin, {
        sourceApp: 'solarsense',
        sourceType: 'assessment',
        sourceId: solar.sourceId,
        assigneeFieldUserId: firstAssignee.fieldUserId,
        scheduledStartAt: baseDispatch.scheduledStartAt,
        deadlineAt: baseDispatch.deadlineAt,
      }),
      createScheduleEvent(admin, {
        sourceApp: 'solarsense',
        sourceType: 'assessment',
        sourceId: solar.sourceId,
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
    const [raceAssessment] = await db.select().from(ssRooftopAssessments)
      .where(eq(ssRooftopAssessments.id, solar.sourceId!));
    const expectedProductAssignee = winner.assigneeFieldUserId === firstAssignee.fieldUserId
      ? firstAssignee.appUserIds.solarsense
      : secondAssignee.appUserIds.solarsense;
    assert.equal(raceAssessment.assignedInspectorUserId, expectedProductAssignee);
    const activeRaceEvents = await db.select().from(portalScheduleEvents).where(and(
      eq(portalScheduleEvents.sourceApp, 'solarsense'),
      eq(portalScheduleEvents.sourceType, 'assessment'),
      eq(portalScheduleEvents.sourceId, solar.sourceId!),
      ne(portalScheduleEvents.status, 'cancelled'),
    ));
    assert.equal(activeRaceEvents.length, 1);
  } finally {
    await db.delete(portalScheduleEvents)
      .where(eq(portalScheduleEvents.createdByUserId, actor.appUserIds.ecoaudit));
    if (copiedPhotoIds.length > 0) {
      await db.delete(photoCopyReferences)
        .where(inArray(photoCopyReferences.photoId, copiedPhotoIds));
      await db.delete(photoRegistry).where(inArray(photoRegistry.id, copiedPhotoIds));
    }
    await db.delete(ihGridSupplies)
      .where(inArray(ihGridSupplies.installationId, createdProductIds));
    await db.delete(ihInstallations)
      .where(inArray(ihInstallations.id, createdProductIds));
    await db.delete(ssRooftopAssessments)
      .where(inArray(ssRooftopAssessments.id, createdProductIds));
    if (createdSiteIds.length > 0) {
      await db.delete(ssSites).where(inArray(ssSites.id, createdSiteIds));
    }
    await db.delete(eaAudits).where(inArray(eaAudits.id, createdProductIds));
    await db.delete(globalUsers).where(inArray(
      globalUsers.id,
      subjects.map((subject) => subject.globalUserId),
    ));
    await closeDb();
  }
});
