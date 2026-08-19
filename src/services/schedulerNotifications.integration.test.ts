import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_NOTIFICATION_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

test('scheduler notifications are transactional, transferable, cancellable, and receipted', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { db, closeDb },
    { ssRooftopAssessments, ssSites },
    {
      appPushDeviceFences,
      appPushDevices,
      globalUsers,
      portalScheduleEvents,
      schedulerNotificationDeliveries,
      schedulerNotificationJobs,
      unifiedUsers,
    },
    {
      cancelScheduleEvent,
      createScheduleEvent,
      updateScheduleEvent,
    },
    {
      deregisterPushDevice,
      queueManualSchedulerReminder,
      registerPushDevice,
    },
    {
      claimDueSchedulerNotificationJobs,
      processClaimedSchedulerNotificationJob,
    },
    { and, eq, inArray, sql },
  ] = await Promise.all([
    import('../db/client.js'),
    import('../db/schema/solarsense.js'),
    import('../db/schema/shared.js'),
    import('./scheduleService.js'),
    import('./schedulerNotificationService.js'),
    import('./schedulerNotificationWorker.js'),
    import('drizzle-orm'),
  ]);

  const runId = randomUUID();
  const now = new Date();
  const actor = {
    globalId: `notification-actor-${runId}`,
    fieldId: `notification-actor-field-${runId}`,
    userId: `notification-actor-eco-${runId}`,
    email: `notification-actor-${runId}@example.test`,
    role: 'admin',
  } as const;
  const first = {
    globalId: `notification-first-${runId}`,
    fieldId: `notification-first-field-${runId}`,
    userId: `notification-first-eco-${runId}`,
    email: `notification-first-${runId}@example.test`,
    role: 'inspector',
  } as const;
  const second = {
    globalId: `notification-second-${runId}`,
    fieldId: `notification-second-field-${runId}`,
    userId: `notification-second-eco-${runId}`,
    email: `notification-second-${runId}@example.test`,
    role: 'inspector',
  } as const;
  const subjects = [actor, first, second];
  const siteId = `notification-site-${runId}`;
  const assessmentId = `notification-assessment-${runId}`;
  const legacySiteEventId = `notification-legacy-site-${runId}`;
  let eventId: string | null = null;

  const admin = {
    userId: actor.userId,
    app: 'ecoaudit' as const,
    role: 'admin' as const,
    authType: 'jwt' as const,
  };
  const firstUser = {
    userId: `solarsense-${first.userId}`,
    app: 'solarsense' as const,
    role: 'inspector' as const,
    authType: 'jwt' as const,
  };
  const secondUser = {
    userId: `solarsense-${second.userId}`,
    app: 'solarsense' as const,
    role: 'inspector' as const,
    authType: 'jwt' as const,
  };
  const firstEcoUser = {
    userId: first.userId,
    app: 'ecoaudit' as const,
    role: 'inspector' as const,
    authType: 'jwt' as const,
  };

  async function claimJob(id: string) {
    const claimToken = randomUUID();
    const [job] = await db.update(schedulerNotificationJobs).set({
      status: 'processing',
      claimToken,
      claimedAt: new Date(),
      attempts: sql`${schedulerNotificationJobs.attempts} + 1`,
      updatedAt: new Date(),
    }).where(eq(schedulerNotificationJobs.id, id)).returning();
    return { ...job, claimToken };
  }

  try {
    await db.insert(globalUsers).values(subjects.map((subject) => ({
      id: subject.globalId,
      loginKey: subject.email,
      fieldUserId: subject.fieldId,
      primaryOriginApp: 'ecoaudit',
      primaryOriginUserId: subject.userId,
      displayEmail: subject.email,
      fullName: subject.email,
      role: subject.role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })));
    await db.insert(unifiedUsers).values(subjects.flatMap((subject) => (
      (['ecoaudit', 'solarsense', 'installhub'] as const).map((originApp) => ({
        id: `${originApp}-${subject.globalId}`,
        globalUserId: subject.globalId,
        originApp,
        originUserId: originApp === 'ecoaudit'
          ? subject.userId
          : `${originApp}-${subject.userId}`,
        fieldUserId: subject.fieldId,
        email: subject.email,
        passwordHash: 'integration-test-only',
        fullName: subject.email,
        role: subject.role,
        isActive: true,
        sourceCreatedAt: now,
        sourceUpdatedAt: now,
        syncedAt: now,
        deletedAt: null,
        syncVersion: 1,
      }))
    )));
    await db.insert(ssSites).values({
      id: siteId,
      siteName: `Notification site ${runId}`,
      location: 'Private integration location',
      dateOfAssessment: now.toISOString().slice(0, 10),
      status: 'Draft',
      createdByUserId: `solarsense-${actor.userId}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(ssRooftopAssessments).values({
      id: assessmentId,
      siteId,
      siteName: `Notification site ${runId}`,
      buildingIdName: 'Notification roof',
      status: 'Draft',
      createdByUserId: `solarsense-${actor.userId}`,
      createdAt: now,
      updatedAt: now,
    });

    // Eco Audit uses the same durable device registry as the other Scheduler
    // notification targets.
    const ecoDeviceId = `eco-device-${runId}`;
    await registerPushDevice(firstEcoUser, ecoDeviceId, {
      expoPushToken: `ExpoPushToken[eco${runId.replaceAll('-', '')}]`,
      platform: 'ios',
      projectId: 'integration-project',
      registrationGeneration: 1,
    });
    const [ecoDevice] = await db.select().from(appPushDevices).where(and(
      eq(appPushDevices.app, 'ecoaudit'),
      eq(appPushDevices.deviceId, ecoDeviceId),
    ));
    assert.equal(ecoDevice.enabled, true);
    await deregisterPushDevice(firstEcoUser, ecoDeviceId, 1);

    const start = new Date(now.getTime() + 3 * 24 * 60 * 60_000);
    const event = await createScheduleEvent(admin, {
      sourceApp: 'solarsense',
      sourceType: 'assessment',
      sourceId: assessmentId,
      assigneeFieldUserId: first.fieldId,
      scheduledStartAt: start.toISOString(),
      deadlineAt: new Date(start.getTime() + 60 * 60_000).toISOString(),
    });
    eventId = event.id;
    let jobs = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.eventId, event.id));
    assert.deepEqual(
      jobs.map((job) => job.notificationKind).sort(),
      ['assigned', 'day_of', 'one_day_before', 'one_hour_before'],
    );

    // A same-snapshot assignee save repairs an old scheduler/product mismatch,
    // replaces stale jobs, and emits assigned + future reminders (not changed).
    await db.update(ssRooftopAssessments).set({
      assignedInspectorUserId: `solarsense-${second.userId}`,
      updatedAt: new Date(),
    }).where(eq(ssRooftopAssessments.id, assessmentId));
    await updateScheduleEvent(admin, event.id, {
      assigneeFieldUserId: first.fieldId,
    });
    const [afterRepairAssessment] = await db.select().from(ssRooftopAssessments)
      .where(eq(ssRooftopAssessments.id, assessmentId));
    assert.equal(
      afterRepairAssessment.assignedInspectorUserId,
      `solarsense-${first.userId}`,
    );
    jobs = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.eventId, event.id));
    assert.equal(jobs.filter((job) => job.notificationKind === 'changed').length, 0);
    assert.deepEqual(
      jobs.filter((job) => job.status === 'queued')
        .map((job) => job.notificationKind).sort(),
      ['assigned', 'day_of', 'one_day_before', 'one_hour_before'],
    );
    const afterRepairJobCount = jobs.length;
    await updateScheduleEvent(admin, event.id, {
      assigneeFieldUserId: first.fieldId,
    });
    jobs = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.eventId, event.id));
    assert.equal(jobs.length, afterRepairJobCount);

    // Rescheduling cancels even a claimed one-hour job, creates one fresh
    // reminder at the new start minus one hour, and fences the stale worker.
    const oneHourBeforeReschedule = jobs.find((job) => (
      job.status === 'queued' && job.notificationKind === 'one_hour_before'
    ));
    assert.ok(oneHourBeforeReschedule);
    const claimedOneHourBeforeReschedule = await claimJob(oneHourBeforeReschedule.id);
    const rescheduledStart = new Date(start.getTime() + 2 * 60 * 60_000);
    await updateScheduleEvent(admin, event.id, {
      scheduledStartAt: rescheduledStart.toISOString(),
      deadlineAt: new Date(rescheduledStart.getTime() + 60 * 60_000).toISOString(),
    });
    const [cancelledOldOneHour] = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.id, oneHourBeforeReschedule.id));
    assert.equal(cancelledOldOneHour.status, 'cancelled');
    jobs = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.eventId, event.id));
    const replacementOneHours = jobs.filter((job) => (
      job.status === 'queued' && job.notificationKind === 'one_hour_before'
    ));
    assert.equal(replacementOneHours.length, 1);
    assert.equal(
      replacementOneHours[0].availableAt.toISOString(),
      new Date(rescheduledStart.getTime() - 60 * 60_000).toISOString(),
    );
    assert.equal(
      (replacementOneHours[0].payload as { scheduledStartAt: string }).scheduledStartAt,
      rescheduledStart.toISOString(),
    );
    assert.notEqual(replacementOneHours[0].dedupeKey, oneHourBeforeReschedule.dedupeKey);
    let staleOneHourSendCalls = 0;
    await processClaimedSchedulerNotificationJob(claimedOneHourBeforeReschedule, {
      async send() {
        staleOneHourSendCalls += 1;
        return [{ status: 'ok', id: 'must-not-send-rescheduled-one-hour' }];
      },
      async getReceipts() {
        return {};
      },
    });
    assert.equal(staleOneHourSendCalls, 0);

    // The worker also compares the one-hour payload timestamp itself. This
    // direct mutation bypasses service-side cancellation to exercise that
    // last-boundary stale-schedule fence independently.
    const claimedTimestampStaleOneHour = await claimJob(replacementOneHours[0].id);
    await db.update(portalScheduleEvents).set({
      scheduledStartAt: new Date(rescheduledStart.getTime() + 30 * 60_000),
      updatedAt: new Date(),
    }).where(eq(portalScheduleEvents.id, event.id));
    let timestampStaleOneHourSendCalls = 0;
    await processClaimedSchedulerNotificationJob(claimedTimestampStaleOneHour, {
      async send() {
        timestampStaleOneHourSendCalls += 1;
        return [{ status: 'ok', id: 'must-not-send-timestamp-stale-one-hour' }];
      },
      async getReceipts() {
        return {};
      },
    });
    assert.equal(timestampStaleOneHourSendCalls, 0);
    const [timestampStaleOneHour] = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.id, replacementOneHours[0].id));
    assert.equal(timestampStaleOneHour.status, 'cancelled');
    assert.equal(timestampStaleOneHour.lastError, 'scheduler_target_no_longer_eligible');
    await db.update(portalScheduleEvents).set({
      scheduledStartAt: rescheduledStart,
      updatedAt: new Date(),
    }).where(eq(portalScheduleEvents.id, event.id));
    jobs = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.eventId, event.id));

    // A delayed automatic job is terminally fenced if the linked work
    // completes after enqueue but before the Expo send boundary.
    const [automaticToFence] = jobs.filter((job) => (
      job.status === 'queued' && job.notificationKind === 'one_day_before'
    ));
    const claimedAutomatic = await claimJob(automaticToFence.id);
    await db.update(ssRooftopAssessments).set({ status: 'Completed', completedAt: new Date() })
      .where(eq(ssRooftopAssessments.id, assessmentId));
    let staleSourceSendCalls = 0;
    await processClaimedSchedulerNotificationJob(claimedAutomatic, {
      async send() {
        staleSourceSendCalls += 1;
        return [{ status: 'ok', id: 'must-not-send-completed-work' }];
      },
      async getReceipts() {
        return {};
      },
    });
    assert.equal(staleSourceSendCalls, 0);
    const [fencedAutomatic] = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.id, automaticToFence.id));
    assert.equal(fencedAutomatic.status, 'cancelled');
    assert.equal(fencedAutomatic.lastError, 'scheduler_target_no_longer_eligible');
    await db.update(ssRooftopAssessments).set({ status: 'Draft', completedAt: null })
      .where(eq(ssRooftopAssessments.id, assessmentId));

    const firstManual = await queueManualSchedulerReminder(admin, event.id, 'manual-1');
    const repeatedManual = await queueManualSchedulerReminder(admin, event.id, 'manual-1');
    assert.equal(firstManual.queued, true);
    assert.deepEqual(repeatedManual, {
      queued: false,
      notificationId: firstManual.notificationId,
    });

    await db.insert(portalScheduleEvents).values({
      id: legacySiteEventId,
      title: 'Legacy Solar site',
      sourceApp: 'solarsense',
      sourceType: 'site',
      sourceId: `legacy-site-${runId}`,
      assigneeFieldUserId: first.fieldId,
      scheduledStartAt: start,
      deadlineAt: new Date(start.getTime() + 60 * 60_000),
      status: 'planned',
      createdByUserId: actor.userId,
      createdByApp: 'ecoaudit',
      createdAt: now,
      updatedAt: now,
    });
    await assert.rejects(
      queueManualSchedulerReminder(admin, legacySiteEventId, 'legacy-reminder'),
      (error: unknown) => (
        (error as { detail?: string }).detail?.includes(
          'supported mobile notification target',
        ) === true
      ),
    );

    const beforeNoop = await db.select({ id: schedulerNotificationJobs.id })
      .from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.eventId, event.id));
    await updateScheduleEvent(admin, event.id, { title: event.title });
    const afterNoop = await db.select({ id: schedulerNotificationJobs.id })
      .from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.eventId, event.id));
    assert.equal(afterNoop.length, beforeNoop.length);

    // A misaligned legacy scheduler target never receives an inverse removal
    // notice for work it did not own.
    await db.update(ssRooftopAssessments).set({
      assignedInspectorUserId: `solarsense-${second.userId}`,
    }).where(eq(ssRooftopAssessments.id, assessmentId));
    const removalCountBeforeMisalignedReassign = (await db.select()
      .from(schedulerNotificationJobs)
      .where(and(
        eq(schedulerNotificationJobs.eventId, event.id),
        eq(schedulerNotificationJobs.notificationKind, 'assignment_removed'),
      ))).length;
    await updateScheduleEvent(admin, event.id, {
      assigneeFieldUserId: second.fieldId,
    });
    const removalCountAfterMisalignedReassign = (await db.select()
      .from(schedulerNotificationJobs)
      .where(and(
        eq(schedulerNotificationJobs.eventId, event.id),
        eq(schedulerNotificationJobs.notificationKind, 'assignment_removed'),
      ))).length;
    assert.equal(removalCountAfterMisalignedReassign, removalCountBeforeMisalignedReassign);
    await updateScheduleEvent(admin, event.id, {
      assigneeFieldUserId: first.fieldId,
    });

    // A rapid A -> B -> A makes the first removal stale; the worker's
    // kind-aware fence cancels it before any external send.
    await updateScheduleEvent(admin, event.id, {
      assigneeFieldUserId: second.fieldId,
    });
    const [removalForFirst] = await db.select().from(schedulerNotificationJobs)
      .where(and(
        eq(schedulerNotificationJobs.eventId, event.id),
        eq(schedulerNotificationJobs.notificationKind, 'assignment_removed'),
        eq(schedulerNotificationJobs.globalUserId, first.globalId),
        eq(schedulerNotificationJobs.status, 'queued'),
      )).orderBy(sql`${schedulerNotificationJobs.createdAt} DESC`).limit(1);
    await updateScheduleEvent(admin, event.id, {
      assigneeFieldUserId: first.fieldId,
    });
    const claimedStaleRemoval = await claimJob(removalForFirst.id);
    let staleRemovalSendCalls = 0;
    await processClaimedSchedulerNotificationJob(claimedStaleRemoval, {
      async send() {
        staleRemovalSendCalls += 1;
        return [{ status: 'ok', id: 'must-not-send-stale-removal' }];
      },
      async getReceipts() {
        return {};
      },
    });
    assert.equal(staleRemovalSendCalls, 0);
    const [staleRemoval] = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.id, removalForFirst.id));
    assert.equal(staleRemoval.status, 'cancelled');

    await assert.rejects(
      updateScheduleEvent(admin, event.id, {
        status: 'cancelled',
        assigneeFieldUserId: second.fieldId,
      }),
      (error: unknown) => (
        (error as { detail?: string }).detail?.includes(
          'Reassign and cancel must be separate',
        ) === true
      ),
    );

    // A legacy mismatch also cannot fabricate a cancellation notice for a
    // scheduler target that did not own the product before cancellation.
    await db.update(ssRooftopAssessments).set({
      assignedInspectorUserId: `solarsense-${second.userId}`,
    }).where(eq(ssRooftopAssessments.id, assessmentId));
    const cancellationCountBeforeMisalignedCancel = (await db.select()
      .from(schedulerNotificationJobs)
      .where(and(
        eq(schedulerNotificationJobs.eventId, event.id),
        eq(schedulerNotificationJobs.notificationKind, 'cancelled'),
      ))).length;
    await cancelScheduleEvent(admin, event.id);
    const cancellationCountAfterMisalignedCancel = (await db.select()
      .from(schedulerNotificationJobs)
      .where(and(
        eq(schedulerNotificationJobs.eventId, event.id),
        eq(schedulerNotificationJobs.notificationKind, 'cancelled'),
      ))).length;
    assert.equal(
      cancellationCountAfterMisalignedCancel,
      cancellationCountBeforeMisalignedCancel,
    );
    await updateScheduleEvent(admin, event.id, {
      status: 'planned',
      assigneeFieldUserId: first.fieldId,
    });

    const sharedToken = `ExpoPushToken[${runId.replaceAll('-', '')}]`;
    await Promise.all([
      registerPushDevice(firstUser, 'first-device', {
        expoPushToken: sharedToken,
        platform: 'ios',
        projectId: 'integration-project',
        registrationGeneration: 1,
      }),
      registerPushDevice(secondUser, 'second-device', {
        expoPushToken: sharedToken,
        platform: 'ios',
        projectId: 'integration-project',
        registrationGeneration: 1,
      }),
    ]);
    const enabledSharedToken = await db.select().from(appPushDevices).where(and(
      eq(appPushDevices.app, 'solarsense'),
      eq(appPushDevices.expoPushToken, sharedToken),
      eq(appPushDevices.enabled, true),
    ));
    assert.equal(enabledSharedToken.length, 1);
    await registerPushDevice(firstUser, 'first-device', {
      expoPushToken: sharedToken,
      platform: 'ios',
      projectId: 'integration-project',
      registrationGeneration: 2,
    });

    const disabledTransferredFences = await db.select().from(appPushDeviceFences)
      .where(and(
        eq(appPushDeviceFences.app, 'solarsense'),
        eq(appPushDeviceFences.enabled, false),
      ));
    assert.ok(disabledTransferredFences.length >= 1);

    const claimedLoggedOutReminder = await claimJob(firstManual.notificationId);
    await deregisterPushDevice(firstUser, 'first-device', 2);
    await assert.rejects(
      registerPushDevice(firstUser, 'first-device', {
        expoPushToken: sharedToken,
        platform: 'ios',
        projectId: 'integration-project',
        registrationGeneration: 2,
      }),
      (error: unknown) => (
        (error as { detail?: string }).detail?.includes('revoked during logout') === true
      ),
    );
    let staleDeviceSendCalls = 0;
    await processClaimedSchedulerNotificationJob(claimedLoggedOutReminder, {
      async send() {
        staleDeviceSendCalls += 1;
        return [{ status: 'ok', id: 'must-not-send-to-logged-out-device' }];
      },
      async getReceipts() {
        return {};
      },
    });
    assert.equal(staleDeviceSendCalls, 0);
    await registerPushDevice(firstUser, 'first-device', {
      expoPushToken: sharedToken,
      platform: 'ios',
      projectId: 'integration-project',
      registrationGeneration: 3,
    });
    await deregisterPushDevice(firstUser, 'first-device', 2);
    const [afterStaleLogout] = await db.select().from(appPushDevices).where(and(
      eq(appPushDevices.app, 'solarsense'),
      eq(appPushDevices.deviceId, 'first-device'),
    ));
    assert.equal(afterStaleLogout.enabled, true);
    assert.equal(afterStaleLogout.registrationGeneration, 3);
    await deregisterPushDevice(firstUser, 'logout-before-put-device', 10);
    await assert.rejects(
      registerPushDevice(firstUser, 'logout-before-put-device', {
        expoPushToken: `ExpoPushToken[prefence${runId.replaceAll('-', '')}]`,
        platform: 'ios',
        projectId: 'integration-project',
        registrationGeneration: 10,
      }),
      (error: unknown) => (
        (error as { detail?: string }).detail?.includes('revoked during logout') === true
      ),
    );
    await registerPushDevice(firstUser, 'logout-before-put-device', {
      expoPushToken: `ExpoPushToken[prefence${runId.replaceAll('-', '')}]`,
      platform: 'ios',
      projectId: 'integration-project',
      registrationGeneration: 11,
    });
    await deregisterPushDevice(firstUser, 'logout-before-put-device', 11);

    jobs = await db.select().from(schedulerNotificationJobs).where(and(
      eq(schedulerNotificationJobs.eventId, event.id),
      eq(schedulerNotificationJobs.notificationKind, 'assigned'),
      eq(schedulerNotificationJobs.status, 'queued'),
    )).orderBy(sql`${schedulerNotificationJobs.createdAt} DESC`);
    const claimed = await claimJob(jobs[0].id);
    const [deviceBeforeCancellation] = await db.select().from(appPushDevices).where(and(
      eq(appPushDevices.app, 'solarsense'),
      eq(appPushDevices.deviceId, 'first-device'),
    ));
    const pendingCancellationDeliveryId = randomUUID();
    await db.insert(schedulerNotificationDeliveries).values({
      id: pendingCancellationDeliveryId,
      jobId: claimed.id,
      deviceRegistrationId: deviceBeforeCancellation.id,
      registrationGeneration: deviceBeforeCancellation.registrationGeneration,
      expoPushToken: deviceBeforeCancellation.expoPushToken,
      status: 'pending',
      receiptChecks: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [
        schedulerNotificationDeliveries.jobId,
        schedulerNotificationDeliveries.deviceRegistrationId,
      ],
      set: {
        status: 'pending',
        lastError: null,
        completedAt: null,
        updatedAt: new Date(),
      },
    });
    const [oneHourBeforeCancellation] = await db.select()
      .from(schedulerNotificationJobs)
      .where(and(
        eq(schedulerNotificationJobs.eventId, event.id),
        eq(schedulerNotificationJobs.notificationKind, 'one_hour_before'),
        eq(schedulerNotificationJobs.status, 'queued'),
      )).orderBy(sql`${schedulerNotificationJobs.createdAt} DESC`).limit(1);
    assert.ok(oneHourBeforeCancellation);
    await cancelScheduleEvent(admin, event.id);
    const [cancelledOneHour] = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.id, oneHourBeforeCancellation.id));
    assert.equal(cancelledOneHour.status, 'cancelled');
    const [deliveryCancelledWithJob] = await db.select()
      .from(schedulerNotificationDeliveries)
      .where(eq(
        schedulerNotificationDeliveries.jobId,
        claimed.id,
      ));
    assert.equal(deliveryCancelledWithJob.status, 'failed');
    assert.equal(
      deliveryCancelledWithJob.lastError,
      'scheduler_notification_cancelled',
    );
    const [queuedCancellation] = await db.select().from(schedulerNotificationJobs).where(and(
      eq(schedulerNotificationJobs.eventId, event.id),
      eq(schedulerNotificationJobs.notificationKind, 'cancelled'),
    ));
    await cancelScheduleEvent(admin, event.id);
    const [afterRepeatedCancellation] = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.id, queuedCancellation.id));
    assert.equal(afterRepeatedCancellation.status, 'queued');
    assert.deepEqual(
      await queueManualSchedulerReminder(admin, event.id, 'manual-1'),
      { queued: false, notificationId: firstManual.notificationId },
    );
    let sendCalls = 0;
    await processClaimedSchedulerNotificationJob(claimed, {
      async send() {
        sendCalls += 1;
        return [{ status: 'ok', id: 'must-not-send' }];
      },
      async getReceipts() {
        return {};
      },
    });
    assert.equal(sendCalls, 0);

    await updateScheduleEvent(admin, event.id, { status: 'planned' });
    const [staleCancellationAfterReopen] = await db.select()
      .from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.id, queuedCancellation.id));
    assert.equal(staleCancellationAfterReopen.status, 'cancelled');
    await cancelScheduleEvent(admin, event.id);
    const [cancelledJob] = await db.select().from(schedulerNotificationJobs).where(and(
      eq(schedulerNotificationJobs.eventId, event.id),
      eq(schedulerNotificationJobs.notificationKind, 'cancelled'),
      eq(schedulerNotificationJobs.status, 'queued'),
    )).orderBy(sql`${schedulerNotificationJobs.createdAt} DESC`).limit(1);
    const claimedCancellation = await claimJob(cancelledJob.id);
    await processClaimedSchedulerNotificationJob(claimedCancellation, {
      async send(messages) {
        assert.equal(messages.length, 1);
        return [{
          status: 'error',
          details: { error: 'DeviceNotRegistered' },
        }];
      },
      async getReceipts() {
        return {};
      },
    });
    const [disabled] = await db.select().from(appPushDevices).where(and(
      eq(appPushDevices.app, 'solarsense'),
      eq(appPushDevices.deviceId, 'first-device'),
    ));
    assert.equal(disabled.enabled, false);
    assert.equal(disabled.disabledReason, 'DeviceNotRegistered');
    const [fenceAfterDeviceNotRegistered] = await db.select()
      .from(appPushDeviceFences)
      .where(and(
        eq(appPushDeviceFences.app, 'solarsense'),
        eq(appPushDeviceFences.deviceId, 'first-device'),
        eq(appPushDeviceFences.globalUserId, first.globalId),
      ));
    assert.equal(fenceAfterDeviceNotRegistered.enabled, true);
    assert.equal(fenceAfterDeviceNotRegistered.registrationGeneration, 3);

    await updateScheduleEvent(admin, event.id, { status: 'planned' });
    const receiptToken = `ExpoPushToken[receipt${runId.replaceAll('-', '')}]`;
    await registerPushDevice(firstUser, 'first-device', {
      expoPushToken: receiptToken,
      platform: 'ios',
      projectId: 'integration-project',
      registrationGeneration: 3,
    });
    const rateLimitedReminder = await queueManualSchedulerReminder(
      admin,
      event.id,
      'rate-limited-reminder',
    );
    const claimedRateLimited = await claimJob(rateLimitedReminder.notificationId);
    await processClaimedSchedulerNotificationJob(claimedRateLimited, {
      async send() {
        return [{
          status: 'error',
          details: { error: 'MessageRateExceeded' },
        }];
      },
      async getReceipts() {
        return {};
      },
    });
    const [rateLimitedJob] = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.id, rateLimitedReminder.notificationId));
    const [rateLimitedDelivery] = await db.select().from(schedulerNotificationDeliveries)
      .where(eq(
        schedulerNotificationDeliveries.jobId,
        rateLimitedReminder.notificationId,
      ));
    assert.equal(rateLimitedJob.status, 'queued');
    assert.ok(rateLimitedJob.availableAt.getTime() > Date.now());
    assert.equal(rateLimitedDelivery.status, 'pending');
    assert.equal(rateLimitedDelivery.lastError, 'MessageRateExceeded');

    // A receipt-level rate limit retries only this destination, preserving the
    // same lifecycle generation and bounded job backoff.
    const claimedRateLimitedResend = await claimJob(rateLimitedReminder.notificationId);
    await processClaimedSchedulerNotificationJob(claimedRateLimitedResend, {
      async send() {
        return [{ status: 'ok', id: `rate-receipt-${runId}` }];
      },
      async getReceipts() {
        return {};
      },
    });
    await db.update(schedulerNotificationDeliveries).set({
      receiptAvailableAt: new Date(Date.now() - 1_000),
    }).where(eq(
      schedulerNotificationDeliveries.jobId,
      rateLimitedReminder.notificationId,
    ));
    const claimedRateLimitedReceipt = await claimJob(rateLimitedReminder.notificationId);
    await processClaimedSchedulerNotificationJob(claimedRateLimitedReceipt, {
      async send() {
        throw new Error('receipt rate limit must not resend before receipt lookup');
      },
      async getReceipts(ids) {
        return Object.fromEntries(ids.map((id) => [id, {
          status: 'error' as const,
          details: { error: 'MessageRateExceeded' },
        }]));
      },
    });
    const [receiptRateLimitedJob] = await db.select()
      .from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.id, rateLimitedReminder.notificationId));
    const [receiptRateLimitedDelivery] = await db.select()
      .from(schedulerNotificationDeliveries)
      .where(eq(
        schedulerNotificationDeliveries.jobId,
        rateLimitedReminder.notificationId,
      ));
    assert.equal(receiptRateLimitedJob.status, 'queued');
    assert.equal(receiptRateLimitedDelivery.status, 'pending');
    assert.equal(receiptRateLimitedDelivery.ticketId, null);
    assert.equal(receiptRateLimitedDelivery.receiptChecks, 1);
    assert.equal(receiptRateLimitedDelivery.lastError, 'MessageRateExceeded');
    const [reopenedAssigned] = await db.select().from(schedulerNotificationJobs).where(and(
      eq(schedulerNotificationJobs.eventId, event.id),
      eq(schedulerNotificationJobs.notificationKind, 'assigned'),
      eq(schedulerNotificationJobs.status, 'queued'),
    )).orderBy(sql`${schedulerNotificationJobs.createdAt} DESC`).limit(1);
    const claimedReopened = await claimJob(reopenedAssigned.id);
    await processClaimedSchedulerNotificationJob(claimedReopened, {
      async send() {
        return [{ status: 'ok', id: `ticket-${runId}` }];
      },
      async getReceipts() {
        return {};
      },
    });
    const [awaiting] = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.id, reopenedAssigned.id));
    assert.equal(awaiting.status, 'awaiting_receipts');

    await db.update(schedulerNotificationDeliveries).set({
      receiptAvailableAt: new Date(Date.now() - 1_000),
    }).where(eq(schedulerNotificationDeliveries.jobId, reopenedAssigned.id));
    const claimedReceipt = await claimJob(reopenedAssigned.id);
    await processClaimedSchedulerNotificationJob(claimedReceipt, {
      async send() {
        throw new Error('receipt path must not resend');
      },
      async getReceipts(ids) {
        return Object.fromEntries(ids.map((id) => [id, { status: 'ok' as const }]));
      },
    });
    const [delivered] = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.id, reopenedAssigned.id));
    assert.equal(delivered.status, 'delivered');

    // The initial send plus all eight allowed receipt polls fit within the
    // job-level attempt budget. The eighth unavailable receipt terminalizes
    // both the delivery and its parent job instead of stranding ticketed work.
    const receiptBoundary = await queueManualSchedulerReminder(
      admin,
      event.id,
      'receipt-boundary-reminder',
    );
    const claimedReceiptBoundarySend = await claimJob(receiptBoundary.notificationId);
    assert.equal(claimedReceiptBoundarySend.maxAttempts, 16);
    await processClaimedSchedulerNotificationJob(claimedReceiptBoundarySend, {
      async send() {
        return [{ status: 'ok', id: `boundary-ticket-${runId}` }];
      },
      async getReceipts() {
        return {};
      },
    });
    for (let check = 1; check <= 8; check += 1) {
      await db.update(schedulerNotificationDeliveries).set({
        receiptAvailableAt: new Date(Date.now() - 1_000),
      }).where(eq(
        schedulerNotificationDeliveries.jobId,
        receiptBoundary.notificationId,
      ));
      const claimedBoundaryReceipt = await claimJob(receiptBoundary.notificationId);
      await processClaimedSchedulerNotificationJob(claimedBoundaryReceipt, {
        async send() {
          throw new Error('receipt boundary must never resend');
        },
        async getReceipts() {
          return {};
        },
      });
      const [boundaryDelivery] = await db.select()
        .from(schedulerNotificationDeliveries)
        .where(eq(
          schedulerNotificationDeliveries.jobId,
          receiptBoundary.notificationId,
        ));
      assert.equal(boundaryDelivery.receiptChecks, check);
      assert.equal(boundaryDelivery.status, check === 8 ? 'failed' : 'ticketed');
    }
    const [receiptBoundaryJob] = await db.select().from(schedulerNotificationJobs)
      .where(eq(schedulerNotificationJobs.id, receiptBoundary.notificationId));
    const [receiptBoundaryDelivery] = await db.select()
      .from(schedulerNotificationDeliveries)
      .where(eq(
        schedulerNotificationDeliveries.jobId,
        receiptBoundary.notificationId,
      ));
    assert.equal(receiptBoundaryJob.status, 'failed');
    assert.equal(receiptBoundaryDelivery.status, 'failed');
    assert.equal(receiptBoundaryDelivery.lastError, 'expo_receipt_unavailable');

    // Bulk attempt exhaustion terminalizes both pending and ticketed rows.
    const ticketedExhaustion = await queueManualSchedulerReminder(
      admin,
      event.id,
      'ticketed-exhaustion-reminder',
    );
    const claimedTicketedExhaustion = await claimJob(ticketedExhaustion.notificationId);
    await processClaimedSchedulerNotificationJob(claimedTicketedExhaustion, {
      async send() {
        return [{ status: 'ok', id: `exhaustion-ticket-${runId}` }];
      },
      async getReceipts() {
        return {};
      },
    });
    await db.update(schedulerNotificationJobs).set({
      status: 'awaiting_receipts',
      attempts: 16,
      maxAttempts: 16,
      availableAt: new Date(Date.now() + 60_000),
    }).where(eq(schedulerNotificationJobs.id, ticketedExhaustion.notificationId));
    await db.update(schedulerNotificationJobs).set({
      status: 'queued',
      attempts: 16,
      maxAttempts: 16,
      availableAt: new Date(Date.now() + 60_000),
    }).where(eq(schedulerNotificationJobs.id, rateLimitedReminder.notificationId));
    const [disabledLifecycleDevice] = await db.select().from(appPushDevices).where(and(
      eq(appPushDevices.app, 'solarsense'),
      eq(appPushDevices.deviceId, 'logout-before-put-device'),
    ));
    await db.insert(schedulerNotificationDeliveries).values({
      id: randomUUID(),
      jobId: rateLimitedReminder.notificationId,
      deviceRegistrationId: disabledLifecycleDevice.id,
      registrationGeneration: disabledLifecycleDevice.registrationGeneration,
      expoPushToken: disabledLifecycleDevice.expoPushToken,
      status: 'delivered',
      receiptChecks: 1,
      completedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    assert.deepEqual(
      await claimDueSchedulerNotificationJobs(new Date(0), 1),
      [],
    );
    for (const [exhaustedJobId, expectedStatus] of [
      [ticketedExhaustion.notificationId, 'failed'],
      [rateLimitedReminder.notificationId, 'delivered'],
    ] as const) {
      const [exhaustedJob] = await db.select().from(schedulerNotificationJobs)
        .where(eq(schedulerNotificationJobs.id, exhaustedJobId));
      const exhaustedDeliveries = await db.select()
        .from(schedulerNotificationDeliveries)
        .where(eq(schedulerNotificationDeliveries.jobId, exhaustedJobId));
      assert.equal(exhaustedJob.status, expectedStatus);
      assert.equal(
        exhaustedJob.lastError,
        expectedStatus === 'delivered' ? null : 'notification_attempts_exhausted',
      );
      const exhaustedNonterminal = exhaustedDeliveries.find((delivery) => (
        delivery.status !== 'delivered'
      ));
      assert.equal(exhaustedNonterminal?.status, 'failed');
      assert.equal(exhaustedNonterminal?.lastError, 'notification_attempts_exhausted');
    }

    await assert.rejects(
      updateScheduleEvent(admin, event.id, {
        status: 'done',
        assigneeFieldUserId: second.fieldId,
      }),
      (error: unknown) => (
        (error as { detail?: string }).detail?.includes(
          'Reassign and mark done must be separate',
        ) === true
      ),
    );
    const [eventAfterRejectedDoneReassignment] = await db.select()
      .from(portalScheduleEvents)
      .where(eq(portalScheduleEvents.id, event.id));
    const [assessmentAfterRejectedDoneReassignment] = await db.select()
      .from(ssRooftopAssessments)
      .where(eq(ssRooftopAssessments.id, assessmentId));
    assert.equal(eventAfterRejectedDoneReassignment.status, 'planned');
    assert.equal(eventAfterRejectedDoneReassignment.assigneeFieldUserId, first.fieldId);
    assert.equal(
      assessmentAfterRejectedDoneReassignment.assignedInspectorUserId,
      `solarsense-${first.userId}`,
    );

    await deregisterPushDevice(secondUser, 'first-device', 999);
    const [stillOwnedByFirst] = await db.select().from(appPushDevices).where(and(
      eq(appPushDevices.app, 'solarsense'),
      eq(appPushDevices.deviceId, 'first-device'),
    ));
    assert.equal(stillOwnedByFirst.enabled, true);
    await db.update(globalUsers).set({ isActive: false })
      .where(eq(globalUsers.id, first.globalId));
    await db.update(unifiedUsers).set({
      isActive: false,
      deletedAt: new Date(),
    })
      .where(eq(unifiedUsers.globalUserId, first.globalId));
    await deregisterPushDevice(firstUser, 'first-device', 3);
    const [disabledAfterDeactivation] = await db.select().from(appPushDevices).where(and(
      eq(appPushDevices.app, 'solarsense'),
      eq(appPushDevices.deviceId, 'first-device'),
    ));
    assert.equal(disabledAfterDeactivation.enabled, false);
    assert.equal(disabledAfterDeactivation.disabledReason, 'logout');
    await db.update(ssRooftopAssessments).set({ status: 'Completed', completedAt: new Date() })
      .where(eq(ssRooftopAssessments.id, assessmentId));
    const completedSchedule = await updateScheduleEvent(admin, event.id, {
      status: 'done',
      assigneeFieldUserId: first.fieldId,
    });
    assert.equal(completedSchedule.status, 'done');
  } finally {
    if (eventId) {
      await db.delete(portalScheduleEvents).where(eq(portalScheduleEvents.id, eventId));
    }
    await db.delete(portalScheduleEvents)
      .where(eq(portalScheduleEvents.id, legacySiteEventId));
    await db.delete(ssRooftopAssessments).where(eq(ssRooftopAssessments.id, assessmentId));
    await db.delete(ssSites).where(eq(ssSites.id, siteId));
    await db.delete(globalUsers).where(inArray(
      globalUsers.id,
      subjects.map((subject) => subject.globalId),
    ));
    await closeDb();
  }
});
