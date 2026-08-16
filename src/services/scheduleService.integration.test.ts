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
      recordVersions,
      unifiedUsers,
    },
    {
      cancelScheduleEvent,
      createScheduleEvent,
      createSchedulerDispatch,
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

    await updateScheduleEvent(admin, eco.id, {
      assigneeFieldUserId: secondAssignee.fieldUserId,
    });
    const apiApp = await buildApp();
    try {
      const secondAssigneeToken = signAccessToken({
        userId: secondAssignee.appUserIds.ecoaudit,
        app: 'ecoaudit',
        role: 'inspector',
      });
      const completionObservedFrom = Date.now();
      const directCompletedResponse = await apiApp.inject({
        method: 'POST',
        url: '/v1/ecoaudit/audits',
        headers: { authorization: `Bearer ${secondAssigneeToken}` },
        payload: {
          siteName: `Direct completed ${runId}`,
          siteAddress: '6 Direct Street',
          inspectorName: secondAssignee.name,
          auditDate: '2026-08-20',
          status: 'Completed',
          assignedInspectorUserId: firstAssignee.appUserIds.ecoaudit,
          completedAt: '2099-01-01T00:00:00.000Z',
        },
      });
      assert.equal(directCompletedResponse.statusCode, 201, directCompletedResponse.body);
      const directCompleted = directCompletedResponse.json() as {
        id: string;
        assignedInspectorUserId: string | null;
        completedAt: string;
      };
      createdProductIds.push(directCompleted.id);
      assert.equal(directCompleted.assignedInspectorUserId, null);
      const firstCompletionBoundary = new Date(directCompleted.completedAt);
      assert.ok(firstCompletionBoundary.getTime() >= completionObservedFrom);
      assert.ok(firstCompletionBoundary.getTime() <= Date.now());

      const completedResend = await apiApp.inject({
        method: 'POST',
        url: '/v1/ecoaudit/sync/push',
        headers: { authorization: `Bearer ${secondAssigneeToken}` },
        payload: {
          audit: {
            id: directCompleted.id,
            siteName: `Direct completed ${runId}`,
            siteAddress: '6 Direct Street',
            inspectorName: secondAssignee.name,
            auditDate: '2026-08-20',
            status: 'Completed',
            completedAt: '2099-01-01T00:00:00.000Z',
            updatedAt: '2099-01-01T00:00:00.000Z',
          },
        },
      });
      assert.equal(completedResend.statusCode, 200, completedResend.body);
      const [afterCompletedResend] = await db.select().from(eaAudits)
        .where(eq(eaAudits.id, directCompleted.id));
      assert.equal(
        afterCompletedResend.completedAt?.getTime(),
        firstCompletionBoundary.getTime(),
      );

      const genericReopen = await apiApp.inject({
        method: 'POST',
        url: '/v1/ecoaudit/sync/push',
        headers: { authorization: `Bearer ${secondAssigneeToken}` },
        payload: {
          audit: {
            id: directCompleted.id,
            siteName: `Direct completed ${runId}`,
            siteAddress: '6 Direct Street',
            inspectorName: secondAssignee.name,
            auditDate: '2026-08-20',
            status: 'Draft',
            updatedAt: '2099-01-02T00:00:00.000Z',
          },
        },
      });
      assert.equal(genericReopen.statusCode, 409, genericReopen.body);

      const staleAssignmentPayload = {
        audit: {
          id: eco.sourceId,
          siteName: ecoRow.siteName,
          siteAddress: ecoRow.siteAddress,
          inspectorName: ecoRow.inspectorName,
          auditDate: ecoRow.auditDate,
          status: 'Draft',
          assignedInspectorUserId: firstAssignee.appUserIds.ecoaudit,
          updatedAt: '2026-08-20T10:00:00.000Z',
        },
      };
      const stalePushAfterReassign = await apiApp.inject({
        method: 'POST',
        url: '/v1/ecoaudit/sync/push',
        headers: { authorization: `Bearer ${secondAssigneeToken}` },
        payload: staleAssignmentPayload,
      });
      assert.equal(stalePushAfterReassign.statusCode, 200, stalePushAfterReassign.body);
      const [afterStaleReassignPush] = await db.select().from(eaAudits)
        .where(eq(eaAudits.id, eco.sourceId!));
      assert.equal(
        afterStaleReassignPush.assignedInspectorUserId,
        secondAssignee.appUserIds.ecoaudit,
      );

      await cancelScheduleEvent(admin, eco.id);
      const stalePushAfterCancel = await apiApp.inject({
        method: 'POST',
        url: '/v1/ecoaudit/sync/push',
        headers: { authorization: `Bearer ${secondAssigneeToken}` },
        payload: staleAssignmentPayload,
      });
      assert.equal(stalePushAfterCancel.statusCode, 403, stalePushAfterCancel.body);
      const [afterCancel] = await db.select().from(eaAudits)
        .where(eq(eaAudits.id, eco.sourceId!));
      assert.ok(afterCancel);
      assert.equal(afterCancel.assignedInspectorUserId, null);
    } finally {
      await apiApp.close();
    }

    const [solarSite] = await db.select().from(ssSites)
      .where(eq(ssSites.id, solarRow.siteId!));
    createdSiteIds.push(solarSite.id);
    assert.equal(solarSite.status, 'Draft');
    assert.equal(solarSite.createdByUserId, actor.appUserIds.solarsense);

    await updateScheduleEvent(admin, solar.id, {
      assigneeFieldUserId: secondAssignee.fieldUserId,
    });
    const [reassignedSolar] = await db.select().from(ssRooftopAssessments)
      .where(eq(ssRooftopAssessments.id, solar.sourceId!));
    assert.equal(
      reassignedSolar.assignedInspectorUserId,
      secondAssignee.appUserIds.solarsense,
    );

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

    const completedAuditId = `completed-${runId}`;
    createdProductIds.push(completedAuditId);
    await db.insert(eaAudits).values({
      id: completedAuditId,
      siteName: `Completed ${runId}`,
      siteAddress: '4 Completed Street',
      inspectorName: firstAssignee.name,
      auditDate: '2026-08-20',
      status: 'Completed',
      completedAt: now,
      createdByUserId: actor.appUserIds.ecoaudit,
      updatedAt: now,
    });
    const completedOptions = await searchJobOptions(admin, `Completed ${runId}`, 'ecoaudit');
    assert.equal(completedOptions.some((option) => option.id === completedAuditId), false);
    await assert.rejects(
      createScheduleEvent(admin, {
        sourceApp: 'ecoaudit',
        sourceType: 'audit',
        sourceId: completedAuditId,
        assigneeFieldUserId: firstAssignee.fieldUserId,
        scheduledStartAt: baseDispatch.scheduledStartAt,
        deadlineAt: baseDispatch.deadlineAt,
      }),
      (error: unknown) => Boolean(
        error
        && typeof error === 'object'
        && 'statusCode' in error
        && error.statusCode === 404,
      ),
    );

    const raceAuditId = `race-${runId}`;
    createdProductIds.push(raceAuditId);
    await db.insert(eaAudits).values({
      id: raceAuditId,
      siteName: `Race ${runId}`,
      siteAddress: '5 Race Street',
      inspectorName: firstAssignee.name,
      auditDate: '2026-08-20',
      status: 'Draft',
      createdByUserId: actor.appUserIds.ecoaudit,
      updatedAt: now,
    });
    const concurrent = await Promise.allSettled([
      createScheduleEvent(admin, {
        sourceApp: 'ecoaudit',
        sourceType: 'audit',
        sourceId: raceAuditId,
        assigneeFieldUserId: firstAssignee.fieldUserId,
        scheduledStartAt: baseDispatch.scheduledStartAt,
        deadlineAt: baseDispatch.deadlineAt,
      }),
      createScheduleEvent(admin, {
        sourceApp: 'ecoaudit',
        sourceType: 'audit',
        sourceId: raceAuditId,
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
    const [raceAudit] = await db.select().from(eaAudits)
      .where(eq(eaAudits.id, raceAuditId));
    const expectedProductAssignee = winner.assigneeFieldUserId === firstAssignee.fieldUserId
      ? firstAssignee.appUserIds.ecoaudit
      : secondAssignee.appUserIds.ecoaudit;
    assert.equal(raceAudit.assignedInspectorUserId, expectedProductAssignee);
    const activeRaceEvents = await db.select().from(portalScheduleEvents).where(and(
      eq(portalScheduleEvents.sourceApp, 'ecoaudit'),
      eq(portalScheduleEvents.sourceType, 'audit'),
      eq(portalScheduleEvents.sourceId, raceAuditId),
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
    await db.delete(recordVersions).where(and(
      eq(recordVersions.app, 'ecoaudit'),
      inArray(recordVersions.entityId, createdProductIds),
    ));
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
