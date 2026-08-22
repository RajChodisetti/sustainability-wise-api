import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.SCHEDULER_NOTIFICATION_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

test('product completion atomically marks linked events done and preserves manual reminders', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { db, closeDb },
    {
      globalUsers,
      portalScheduleEvents,
      schedulerJobCompletionFacts,
      schedulerJobFinance,
      schedulerJobHourOverrides,
      schedulerNotificationJobs,
      unifiedUsers,
    },
    { ihInstallationWorkSessions, ihInstallations },
    { completeLinkedSchedulerEvents },
    { and, eq, inArray, sql },
  ] = await Promise.all([
    import('../db/client.js'),
    import('../db/schema/shared.js'),
    import('../db/schema/installhub.js'),
    import('./schedulerCompletionService.js'),
    import('drizzle-orm'),
  ]);

  const runId = randomUUID();
  const globalUserId = `completion-global-${runId}`;
  const fieldUserId = `completion-field-${runId}`;
  const sourceId = `completion-installation-${runId}`;
  const eventId = `completion-event-${runId}`;
  const cancelledEventId = `completion-cancelled-event-${runId}`;
  const revenueSourceId = `completion-revenue-installation-${runId}`;
  const revenueFinanceId = `completion-revenue-finance-${runId}`;
  const lateGlobalUserId = `completion-late-global-${runId}`;
  const lateFieldUserId = `completion-late-field-${runId}`;
  const lateOriginUserId = `completion-late-origin-${runId}`;
  const firstObservedAt = new Date('2026-08-21T12:00:00.000Z');
  const secondObservedAt = new Date('2026-08-21T13:00:00.000Z');
  const scheduledStartAt = new Date('2026-08-24T12:00:00.000Z');

  const notification = (
    id: string,
    linkedEventId: string,
    notificationKind: 'day_of' | 'one_day_before' | 'manual_reminder',
  ) => ({
    id,
    eventId: linkedEventId,
    globalUserId,
    sourceApp: 'installhub',
    notificationKind,
    title: 'Scheduler test',
    body: 'Scheduler completion integration test',
    payload: {
      type: 'scheduler' as const,
      notificationKind,
      eventId: linkedEventId,
      sourceApp: 'installhub' as const,
      sourceType: 'installation',
      sourceId,
      scheduledStartAt: scheduledStartAt.toISOString(),
    },
    dedupeKey: `completion:${runId}:${id}`,
    status: 'queued',
    availableAt: scheduledStartAt,
  });

  try {
    await db.insert(globalUsers).values({
      id: globalUserId,
      loginKey: `completion-${runId}@example.test`,
      fieldUserId,
      primaryOriginApp: 'installhub',
      primaryOriginUserId: `completion-origin-${runId}`,
      displayEmail: `completion-${runId}@example.test`,
      fullName: 'Completion Test User',
      billingRateCents: 20_000,
      role: 'inspector',
      isActive: true,
    });
    await db.insert(globalUsers).values({
      id: lateGlobalUserId,
      loginKey: `completion-late-${runId}@example.test`,
      fieldUserId: lateFieldUserId,
      primaryOriginApp: 'installhub',
      primaryOriginUserId: lateOriginUserId,
      displayEmail: `completion-late-${runId}@example.test`,
      fullName: 'Late Session User',
      billingRateCents: 10_000,
      role: 'inspector',
      isActive: true,
    });
    await db.insert(unifiedUsers).values([
      {
        id: `completion-membership-${runId}`,
        globalUserId,
        originApp: 'installhub',
        originUserId: `completion-origin-${runId}`,
        fieldUserId,
        email: `completion-${runId}@example.test`,
        passwordHash: 'integration-test',
        fullName: 'Completion Test User',
        role: 'inspector',
        isActive: true,
        sourceCreatedAt: firstObservedAt,
        sourceUpdatedAt: firstObservedAt,
      },
      {
        id: `completion-late-membership-${runId}`,
        globalUserId: lateGlobalUserId,
        originApp: 'installhub',
        originUserId: lateOriginUserId,
        fieldUserId: lateFieldUserId,
        email: `completion-late-${runId}@example.test`,
        passwordHash: 'integration-test',
        fullName: 'Late Session User',
        role: 'inspector',
        isActive: true,
        sourceCreatedAt: firstObservedAt,
        sourceUpdatedAt: firstObservedAt,
      },
    ]);
    await db.insert(ihInstallations).values([
      {
        id: sourceId,
        externalKey: `completion-history-${runId}`,
        clientName: 'Historical Client',
        siteName: 'Historical Site',
        siteAddress: '0 Test Street',
        inspectorName: 'Completion Test User',
        auditDate: '2026-08-21',
        status: 'Completed',
        assignedInspectorUserId: fieldUserId,
        completedAt: firstObservedAt,
      },
      {
        id: revenueSourceId,
        externalKey: `completion-revenue-${runId}`,
        clientName: 'Revenue Client',
        siteName: 'Revenue Site',
        siteAddress: '1 Test Street',
        inspectorName: 'Completion Test User',
        auditDate: '2026-08-21',
        status: 'Draft',
        // InstallHub stores the canonical field-user ID here, deliberately
        // different from this member's origin ID.
        assignedInspectorUserId: fieldUserId,
      },
    ]);
    await db.insert(schedulerJobFinance).values({
      id: revenueFinanceId,
      sourceApp: 'installhub',
      sourceType: 'installation',
      sourceId: revenueSourceId,
      pricingMode: 'charge_up',
      currency: 'AUD',
    });
    await db.insert(schedulerJobHourOverrides).values({
      id: `completion-hours-${runId}`,
      financeId: revenueFinanceId,
      revision: 1,
      action: 'set',
      source: 'admin',
      billableMilliseconds: 3_600_000,
      costMilliseconds: 3_600_000,
      reason: 'Integration completion snapshot',
      actorUserId: globalUserId,
      actorDisplayName: 'Completion Test User',
      createdAt: firstObservedAt,
    });
    await db.insert(portalScheduleEvents).values([
      {
        id: eventId,
        title: 'Active linked job',
        sourceApp: 'installhub',
        sourceType: 'installation',
        sourceId,
        assigneeFieldUserId: fieldUserId,
        scheduledStartAt,
        deadlineAt: scheduledStartAt,
        status: 'planned',
        createdByUserId: globalUserId,
        createdByApp: 'installhub',
      },
      {
        id: cancelledEventId,
        title: 'Cancelled linked job',
        sourceApp: 'installhub',
        sourceType: 'installation',
        sourceId,
        assigneeFieldUserId: fieldUserId,
        scheduledStartAt,
        deadlineAt: scheduledStartAt,
        status: 'cancelled',
        createdByUserId: globalUserId,
        createdByApp: 'installhub',
        cancelledAt: firstObservedAt,
      },
    ]);
    await db.insert(schedulerNotificationJobs).values([
      notification(`automatic-${runId}`, eventId, 'day_of'),
      notification(`manual-${runId}`, eventId, 'manual_reminder'),
      notification(`cancelled-event-${runId}`, cancelledEventId, 'day_of'),
    ]);

    const first = await db.transaction((tx) => completeLinkedSchedulerEvents(tx, {
      sourceApp: 'installhub',
      sourceType: 'installation',
      sourceId,
    }, {
      observedAt: firstObservedAt,
      completionProvenance: 'historical_replay',
    }));
    assert.deepEqual(first.matchedEventIds, [eventId]);
    assert.deepEqual(first.transitionedEventIds, [eventId]);

    const [completedEvent] = await db.select().from(portalScheduleEvents)
      .where(eq(portalScheduleEvents.id, eventId));
    assert.equal(completedEvent.status, 'done');
    assert.equal(completedEvent.updatedAt.getTime(), firstObservedAt.getTime());
    const [completionFact] = await db.select().from(schedulerJobCompletionFacts)
      .where(eq(schedulerJobCompletionFacts.sourceId, sourceId));
    assert.equal(completionFact.primaryGlobalUserId, globalUserId);
    assert.equal(completionFact.attributionSource, 'scheduler_event');
    assert.equal(completionFact.completedAt.getTime(), firstObservedAt.getTime());
    assert.equal(completionFact.revenueSnapshotStatus, 'unavailable');
    assert.equal(completionFact.currency, null);
    assert.equal(completionFact.amountExGstCents, null);
    assert.equal(completionFact.revenueCapturedAt, null);
    const firstJobs = await db.select().from(schedulerNotificationJobs)
      .where(inArray(schedulerNotificationJobs.eventId, [eventId, cancelledEventId]));
    assert.equal(firstJobs.find((job) => job.id === `automatic-${runId}`)?.status, 'cancelled');
    assert.equal(firstJobs.find((job) => job.id === `manual-${runId}`)?.status, 'queued');
    assert.equal(firstJobs.find((job) => job.id === `cancelled-event-${runId}`)?.status, 'queued');

    let markFinanceMutationLocked!: () => void;
    const financeMutationLocked = new Promise<void>((resolve) => {
      markFinanceMutationLocked = resolve;
    });
    let releaseFinanceMutation!: () => void;
    const financeMutationRelease = new Promise<void>((resolve) => {
      releaseFinanceMutation = resolve;
    });
    const financeMutation = db.transaction(async (tx) => {
      await tx.select({ id: schedulerJobFinance.id }).from(schedulerJobFinance)
        .where(eq(schedulerJobFinance.id, revenueFinanceId))
        .for('update');
      await tx.update(schedulerJobFinance).set({ currency: 'NZD' })
        .where(eq(schedulerJobFinance.id, revenueFinanceId));
      markFinanceMutationLocked();
      await financeMutationRelease;
    });
    await financeMutationLocked;
    const firstRevenueCompletion = db.transaction(async (tx) => {
      await tx.update(ihInstallations).set({
        status: 'Completed',
        completedAt: firstObservedAt,
        updatedAt: firstObservedAt,
      }).where(eq(ihInstallations.id, revenueSourceId));
      await completeLinkedSchedulerEvents(tx, {
        sourceApp: 'installhub',
        sourceType: 'installation',
        sourceId: revenueSourceId,
      }, {
        observedAt: firstObservedAt,
        completionProvenance: 'direct_transition',
      });
    });
    try {
      const stateBeforeFinanceCommit = await Promise.race([
        firstRevenueCompletion.then(() => 'completed' as const),
        new Promise<'blocked'>((resolve) => setTimeout(() => resolve('blocked'), 50)),
      ]);
      assert.equal(stateBeforeFinanceCommit, 'blocked');
    } finally {
      releaseFinanceMutation();
    }
    await Promise.all([financeMutation, firstRevenueCompletion]);
    const [captured] = await db.select().from(schedulerJobCompletionFacts)
      .where(eq(schedulerJobCompletionFacts.sourceId, revenueSourceId));
    assert.equal(captured.revenueSnapshotStatus, 'captured');
    assert.equal(captured.currency, 'NZD');
    assert.equal(captured.primaryGlobalUserId, globalUserId);
    assert.equal(captured.attributionSource, 'product_assignment');
    assert.equal(captured.amountExGstCents, 20_000);
    assert.equal(captured.gstAmountCents, 2_000);
    assert.equal(captured.totalIncGstCents, 22_000);
    assert.equal(captured.revenueCapturedAt?.getTime(), firstObservedAt.getTime());

    const lateSessionId = `completion-late-session-${runId}`;
    await db.transaction(async (tx) => {
      await tx.insert(ihInstallationWorkSessions).values({
        id: lateSessionId,
        installationId: revenueSourceId,
        actorUserId: lateOriginUserId,
        startedAt: new Date('2026-08-21T10:00:00.000Z'),
        lastActiveAt: new Date('2026-08-21T11:00:00.000Z'),
        endedAt: new Date('2026-08-21T11:00:00.000Z'),
        activeMilliseconds: 3_600_000,
        revision: 1,
      });
    });
    const [afterLateSession] = await db.select().from(schedulerJobCompletionFacts)
      .where(eq(schedulerJobCompletionFacts.sourceId, revenueSourceId));
    assert.equal(afterLateSession.completedAt.getTime(), firstObservedAt.getTime());
    assert.equal(afterLateSession.primaryGlobalUserId, globalUserId);
    assert.equal(afterLateSession.amountExGstCents, 20_000);
    assert.equal(afterLateSession.gstAmountCents, 2_000);
    assert.equal(afterLateSession.totalIncGstCents, 22_000);
    assert.equal(
      afterLateSession.revenueCapturedAt?.getTime(),
      captured.revenueCapturedAt?.getTime(),
    );

    await db.transaction(async (tx) => {
      await tx.update(ihInstallations).set({
        status: 'Draft',
        completedAt: null,
        updatedAt: secondObservedAt,
      }).where(eq(ihInstallations.id, revenueSourceId));
      await tx.insert(ihInstallationWorkSessions).values({
        id: `completion-reopened-session-${runId}`,
        installationId: revenueSourceId,
        actorUserId: lateOriginUserId,
        startedAt: new Date('2026-08-21T09:00:00.000Z'),
        lastActiveAt: new Date('2026-08-21T09:30:00.000Z'),
        endedAt: new Date('2026-08-21T09:30:00.000Z'),
        activeMilliseconds: 1_800_000,
        revision: 1,
      });
      await tx.update(ihInstallations).set({
        status: 'Completed',
        completedAt: secondObservedAt,
      }).where(eq(ihInstallations.id, revenueSourceId));
      await completeLinkedSchedulerEvents(tx, {
        sourceApp: 'installhub',
        sourceType: 'installation',
        sourceId: revenueSourceId,
      }, {
        observedAt: secondObservedAt,
        completionProvenance: 'direct_transition',
      });
    });
    const [recompleted] = await db.select().from(schedulerJobCompletionFacts)
      .where(eq(schedulerJobCompletionFacts.sourceId, revenueSourceId));
    assert.equal(recompleted.completedAt.getTime(), firstObservedAt.getTime());
    assert.equal(recompleted.primaryGlobalUserId, globalUserId);
    assert.equal(recompleted.amountExGstCents, 20_000);
    assert.equal(recompleted.gstAmountCents, 2_000);
    assert.equal(recompleted.totalIncGstCents, 22_000);
    assert.equal(
      recompleted.revenueCapturedAt?.getTime(),
      captured.revenueCapturedAt?.getTime(),
    );

    const recoveryJobId = `recovery-${runId}`;
    await db.insert(schedulerNotificationJobs).values(
      notification(recoveryJobId, eventId, 'one_day_before'),
    );
    const second = await db.transaction((tx) => completeLinkedSchedulerEvents(tx, {
      sourceApp: 'installhub',
      sourceType: 'installation',
      sourceId,
    }, {
      observedAt: secondObservedAt,
      completionProvenance: 'historical_replay',
    }));
    assert.deepEqual(second.transitionedEventIds, []);
    const [reobservedEvent] = await db.select().from(portalScheduleEvents)
      .where(eq(portalScheduleEvents.id, eventId));
    assert.equal(reobservedEvent.updatedAt.getTime(), firstObservedAt.getTime());
    const [recoveryJob] = await db.select().from(schedulerNotificationJobs)
      .where(and(
        eq(schedulerNotificationJobs.id, recoveryJobId),
        eq(schedulerNotificationJobs.eventId, eventId),
      ));
    assert.equal(recoveryJob.status, 'cancelled');
  } finally {
    await db.transaction(async (tx) => {
      // Completion facts deliberately reject DELETE. This owner-only DDL is
      // confined to the disposable integration cleanup transaction.
      await tx.execute(sql.raw(`
        ALTER TABLE scheduler_job_completion_facts
        DISABLE TRIGGER scheduler_completion_fact_immutability_fence_trigger
      `));
      await tx.execute(sql.raw(`
        ALTER TABLE ih_installation_work_sessions DISABLE TRIGGER USER
      `));
      await tx.execute(sql.raw(`
        ALTER TABLE scheduler_job_finance DISABLE TRIGGER USER
      `));
      await tx.delete(ihInstallationWorkSessions)
        .where(eq(ihInstallationWorkSessions.installationId, revenueSourceId));
      await tx.delete(schedulerJobHourOverrides)
        .where(eq(schedulerJobHourOverrides.financeId, revenueFinanceId));
      await tx.delete(schedulerJobFinance).where(eq(schedulerJobFinance.id, revenueFinanceId));
      await tx.delete(portalScheduleEvents).where(inArray(
        portalScheduleEvents.id,
        [eventId, cancelledEventId],
      ));
      // Move the products out of their retained lifecycle while their facts
      // still authorize the transition, then remove those owner-only fixtures.
      await tx.update(ihInstallations).set({ status: 'Draft', completedAt: null })
        .where(inArray(ihInstallations.id, [sourceId, revenueSourceId]));
      await tx.delete(schedulerJobCompletionFacts)
        .where(inArray(schedulerJobCompletionFacts.sourceId, [sourceId, revenueSourceId]));
      await tx.delete(ihInstallations).where(inArray(
        ihInstallations.id,
        [sourceId, revenueSourceId],
      ));
      await tx.delete(unifiedUsers).where(inArray(
        unifiedUsers.globalUserId,
        [globalUserId, lateGlobalUserId],
      ));
      await tx.delete(globalUsers).where(inArray(
        globalUsers.id,
        [globalUserId, lateGlobalUserId],
      ));
      await tx.execute(sql.raw(`
        ALTER TABLE scheduler_job_completion_facts
        ENABLE TRIGGER scheduler_completion_fact_immutability_fence_trigger
      `));
      await tx.execute(sql.raw(`
        ALTER TABLE ih_installation_work_sessions ENABLE TRIGGER USER
      `));
      await tx.execute(sql.raw(`
        ALTER TABLE scheduler_job_finance ENABLE TRIGGER USER
      `));
    });
    await closeDb();
  }
});
