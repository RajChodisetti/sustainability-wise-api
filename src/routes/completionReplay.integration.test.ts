import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import Fastify from 'fastify';

const integrationDatabase = process.env.SCHEDULER_COMPLETION_REPLAY_PG_INTEGRATION_URL;
if (integrationDatabase) {
  process.env.DATABASE_URL = integrationDatabase;
  process.env.JWT_SECRET ??= 'completion-replay-integration-secret';
  process.env.JWT_REFRESH_SECRET ??= 'completion-replay-integration-refresh-secret';
}

test('direct and mobile completion replays preserve undated historical products', {
  skip: !integrationDatabase,
  timeout: 30_000,
}, async () => {
  const [
    { db, closeDb },
    { eaAudits },
    { ssRooftopAssessments, ssSites },
    {
      portalScheduleEvents,
      recordVersions,
      schedulerJobCompletionFacts,
      schedulerJobFinance,
    },
    { eaAuditRoutes },
    { eaSyncRoutes },
    { solarsenseSyncRoutes },
    { solarsenseAssessmentRoutes },
    { signAccessToken },
    { eq, inArray, sql },
  ] = await Promise.all([
    import('../db/client.js'),
    import('../db/schema/ecoaudit.js'),
    import('../db/schema/solarsense.js'),
    import('../db/schema/shared.js'),
    import('./ecoaudit/audits.js'),
    import('./ecoaudit/sync.js'),
    import('./solarsense/sync.js'),
    import('./solarsense/assessments.js'),
    import('../auth/jwt.js'),
    import('drizzle-orm'),
  ]);

  const runId = randomUUID();
  const ecoUserId = `replay-eco-user-${runId}`;
  const solarUserId = `replay-solar-user-${runId}`;
  const directAuditId = `replay-direct-audit-${runId}`;
  const syncAuditId = `replay-sync-audit-${runId}`;
  const solarSiteId = `replay-solar-site-${runId}`;
  const solarAssessmentId = `replay-solar-assessment-${runId}`;
  const deletedEcoSyncId = `replay-deleted-eco-${runId}`;
  const deletedSolarSyncId = `replay-deleted-solar-${runId}`;
  const deletedSolarSiteSyncId = `replay-deleted-solar-site-${runId}`;
  const deletedSolarSiteEventId = `replay-deleted-solar-site-event-${runId}`;
  const historicalCreatedAt = new Date('2025-01-01T00:00:00.000Z');
  const incomingHistoricalCompletion = '2025-01-02T00:00:00.000Z';
  let createdEcoId: string | null = null;
  let createdSolarAssessmentId: string | null = null;
  const app = Fastify();

  try {
    await app.register(eaAuditRoutes, { prefix: '/eco/audits' });
    await app.register(eaSyncRoutes, { prefix: '/eco/sync' });
    await app.register(solarsenseSyncRoutes, { prefix: '/solar/sync' });
    await app.register(solarsenseAssessmentRoutes, { prefix: '/solar' });
    await app.ready();

    await db.insert(eaAudits).values([
      {
        id: directAuditId,
        siteName: 'Undated direct replay',
        siteAddress: '1 Replay Road',
        inspectorName: 'Replay Inspector',
        status: 'Completed',
        completedAt: null,
        createdByUserId: ecoUserId,
        createdAt: historicalCreatedAt,
        updatedAt: historicalCreatedAt,
      },
      {
        id: syncAuditId,
        siteName: 'Undated mobile replay',
        siteAddress: '2 Replay Road',
        inspectorName: 'Replay Inspector',
        status: 'Completed',
        completedAt: null,
        createdByUserId: ecoUserId,
        createdAt: historicalCreatedAt,
        updatedAt: historicalCreatedAt,
      },
    ]);
    await db.insert(ssSites).values({
      id: solarSiteId,
      siteName: 'Solar replay parent',
      status: 'Draft',
      createdByUserId: solarUserId,
      createdAt: historicalCreatedAt,
      updatedAt: historicalCreatedAt,
    });
    await db.insert(ssRooftopAssessments).values([
      {
        id: solarAssessmentId,
        siteId: solarSiteId,
        siteName: 'Solar replay site',
        buildingIdName: 'Replay building',
        status: 'Completed',
        completedAt: null,
        createdByUserId: solarUserId,
        createdAt: historicalCreatedAt,
        updatedAt: historicalCreatedAt,
      },
      {
        id: deletedSolarSyncId,
        siteId: solarSiteId,
        siteName: 'Deleted Solar transition',
        buildingIdName: 'Deleted replay building',
        status: 'Draft',
        completedAt: null,
        createdByUserId: solarUserId,
        createdAt: historicalCreatedAt,
        updatedAt: historicalCreatedAt,
      },
    ]);
    await db.insert(portalScheduleEvents).values({
      id: deletedSolarSiteEventId,
      title: 'Deleted Solar site transition',
      sourceApp: 'solarsense',
      sourceType: 'site',
      sourceId: deletedSolarSiteSyncId,
      assigneeFieldUserId: `replay-field-${runId}`,
      scheduledStartAt: historicalCreatedAt,
      deadlineAt: historicalCreatedAt,
      status: 'planned',
      createdByUserId: solarUserId,
      createdByApp: 'solarsense',
      createdAt: historicalCreatedAt,
      updatedAt: historicalCreatedAt,
    });

    const ecoToken = signAccessToken({
      userId: ecoUserId,
      app: 'ecoaudit',
      role: 'inspector',
    });
    const directReplay = await app.inject({
      method: 'PATCH',
      url: `/eco/audits/${directAuditId}/complete`,
      headers: { authorization: `Bearer ${ecoToken}` },
    });
    assert.equal(directReplay.statusCode, 200, directReplay.body);
    assert.equal(directReplay.json().completedAt, null);

    const ecoSyncReplay = await app.inject({
      method: 'POST',
      url: '/eco/sync/push',
      headers: { authorization: `Bearer ${ecoToken}` },
      payload: {
        audit: {
          id: syncAuditId,
          siteName: 'Undated mobile replay',
          siteAddress: '2 Replay Road',
          inspectorName: 'Replay Inspector',
          status: 'Completed',
          completedAt: incomingHistoricalCompletion,
          createdAt: historicalCreatedAt.toISOString(),
          updatedAt: '2026-08-22T00:00:00.000Z',
        },
      },
    });
    assert.equal(ecoSyncReplay.statusCode, 200, ecoSyncReplay.body);

    const solarToken = signAccessToken({
      userId: solarUserId,
      app: 'solarsense',
      role: 'inspector',
    });
    const solarSyncReplay = await app.inject({
      method: 'POST',
      url: '/solar/sync/push',
      headers: { authorization: `Bearer ${solarToken}` },
      payload: {
        assessments: [{
          id: solarAssessmentId,
          siteId: solarSiteId,
          siteName: 'Solar replay site',
          buildingIdName: 'Replay building',
          status: 'Completed',
          completedAt: incomingHistoricalCompletion,
          createdAt: historicalCreatedAt.toISOString(),
          updatedAt: '2026-08-22T00:00:00.000Z',
        }],
      },
    });
    assert.equal(solarSyncReplay.statusCode, 200, solarSyncReplay.body);

    const deletedSolarSiteTransition = await app.inject({
      method: 'POST',
      url: '/solar/sync/push',
      headers: { authorization: `Bearer ${solarToken}` },
      payload: {
        sites: [{
          id: deletedSolarSiteSyncId,
          siteName: 'Deleted Solar site transition',
          status: 'Completed',
          deletedAt: '2026-08-22T01:00:00.000Z',
          createdAt: historicalCreatedAt.toISOString(),
          updatedAt: '2026-08-22T01:00:00.000Z',
        }],
      },
    });
    assert.equal(deletedSolarSiteTransition.statusCode, 200, deletedSolarSiteTransition.body);
    const [projectedSiteEvent] = await db.select({ status: portalScheduleEvents.status })
      .from(portalScheduleEvents)
      .where(eq(portalScheduleEvents.id, deletedSolarSiteEventId))
      .limit(1);
    assert.equal(projectedSiteEvent?.status, 'done');

    const deletedEcoTransition = await app.inject({
      method: 'POST',
      url: '/eco/sync/push',
      headers: { authorization: `Bearer ${ecoToken}` },
      payload: {
        audit: {
          id: deletedEcoSyncId,
          siteName: 'Deleted Eco transition',
          siteAddress: '4 Replay Road',
          inspectorName: 'Replay Inspector',
          status: 'Completed',
          deletedAt: '2026-08-22T01:00:00.000Z',
          createdAt: historicalCreatedAt.toISOString(),
          updatedAt: '2026-08-22T01:00:00.000Z',
        },
      },
    });
    assert.equal(deletedEcoTransition.statusCode, 200, deletedEcoTransition.body);

    const deletedSolarTransition = await app.inject({
      method: 'POST',
      url: '/solar/sync/push',
      headers: { authorization: `Bearer ${solarToken}` },
      payload: {
        assessments: [{
          id: deletedSolarSyncId,
          siteId: solarSiteId,
          siteName: 'Deleted Solar transition',
          buildingIdName: 'Deleted replay building',
          status: 'Completed',
          deletedAt: '2026-08-22T01:00:00.000Z',
          createdAt: historicalCreatedAt.toISOString(),
          updatedAt: '2026-08-22T01:00:00.000Z',
        }],
      },
    });
    assert.equal(deletedSolarTransition.statusCode, 200, deletedSolarTransition.body);

    const completedEcoCreate = await app.inject({
      method: 'POST',
      url: '/eco/audits/',
      headers: { authorization: `Bearer ${ecoToken}` },
      payload: {
        siteName: 'New offline Eco completion',
        siteAddress: '3 Replay Road',
        inspectorName: 'Replay Inspector',
        status: 'Completed',
      },
    });
    assert.equal(completedEcoCreate.statusCode, 201, completedEcoCreate.body);
    createdEcoId = completedEcoCreate.json().id;

    const completedSolarCreate = await app.inject({
      method: 'POST',
      url: `/solar/sites/${solarSiteId}/assessments`,
      headers: { authorization: `Bearer ${solarToken}` },
      payload: {
        siteName: 'New offline Solar completion',
        buildingIdName: 'New replay building',
        status: 'Completed',
      },
    });
    assert.equal(completedSolarCreate.statusCode, 201, completedSolarCreate.body);
    createdSolarAssessmentId = completedSolarCreate.json().id;
    const authoritativeCreatedIds = [createdEcoId, createdSolarAssessmentId]
      .filter((sourceId): sourceId is string => sourceId !== null);
    assert.equal(authoritativeCreatedIds.length, 2);

    const products = await Promise.all([
      db.select({ completedAt: eaAudits.completedAt }).from(eaAudits)
        .where(eq(eaAudits.id, directAuditId)).limit(1),
      db.select({ completedAt: eaAudits.completedAt }).from(eaAudits)
        .where(eq(eaAudits.id, syncAuditId)).limit(1),
      db.select({ completedAt: ssRooftopAssessments.completedAt })
        .from(ssRooftopAssessments)
        .where(eq(ssRooftopAssessments.id, solarAssessmentId)).limit(1),
    ]);
    assert.deepEqual(products.map(([row]) => row?.completedAt ?? null), [null, null, null]);

    const facts = await db.select({ sourceId: schedulerJobCompletionFacts.sourceId })
      .from(schedulerJobCompletionFacts)
      .where(inArray(schedulerJobCompletionFacts.sourceId, [
        directAuditId,
        syncAuditId,
        solarAssessmentId,
      ]));
    assert.deepEqual(facts, []);

    const createdFacts = await db.select({
      sourceId: schedulerJobCompletionFacts.sourceId,
      completedAt: schedulerJobCompletionFacts.completedAt,
      status: schedulerJobCompletionFacts.revenueSnapshotStatus,
    }).from(schedulerJobCompletionFacts).where(inArray(
      schedulerJobCompletionFacts.sourceId,
      authoritativeCreatedIds,
    ));
    assert.deepEqual(
      new Set(createdFacts.map((fact) => fact.sourceId)),
      new Set(authoritativeCreatedIds),
    );
    assert.equal(createdFacts.every((fact) => fact.completedAt instanceof Date), true);
    assert.equal(
      createdFacts.every((fact) => fact.status === 'captured' || fact.status === 'incomplete'),
      true,
    );
    const deletedFacts = await db.select({ sourceId: schedulerJobCompletionFacts.sourceId })
      .from(schedulerJobCompletionFacts)
      .where(inArray(schedulerJobCompletionFacts.sourceId, [
        deletedEcoSyncId,
        deletedSolarSyncId,
      ]));
    assert.deepEqual(
      new Set(deletedFacts.map((fact) => fact.sourceId)),
      new Set([deletedEcoSyncId, deletedSolarSyncId]),
    );
  } finally {
    await app.close();
    await db.transaction(async (tx) => {
      // These fixtures intentionally model retained undated history. Owner-only
      // trigger suspension is confined to cleanup on the disposable test DB.
      await tx.execute(sql.raw(
        'ALTER TABLE scheduler_job_completion_facts DISABLE TRIGGER USER',
      ));
      await tx.execute(sql.raw('ALTER TABLE scheduler_job_finance DISABLE TRIGGER USER'));
      await tx.execute(sql.raw('ALTER TABLE ea_audits DISABLE TRIGGER USER'));
      await tx.execute(sql.raw(
        'ALTER TABLE ss_rooftop_assessments DISABLE TRIGGER USER',
      ));
      await tx.execute(sql.raw('ALTER TABLE ss_sites DISABLE TRIGGER USER'));
      await tx.delete(recordVersions).where(
        inArray(recordVersions.entityId, [
          syncAuditId,
          deletedEcoSyncId,
          solarSiteId,
          deletedSolarSiteSyncId,
        ]),
      );
      await tx.delete(portalScheduleEvents)
        .where(eq(portalScheduleEvents.id, deletedSolarSiteEventId));
      await tx.delete(schedulerJobCompletionFacts).where(inArray(
        schedulerJobCompletionFacts.sourceId,
        [
          directAuditId,
          syncAuditId,
          solarAssessmentId,
          deletedEcoSyncId,
          deletedSolarSyncId,
          ...(createdEcoId ? [createdEcoId] : []),
          ...(createdSolarAssessmentId ? [createdSolarAssessmentId] : []),
        ],
      ));
      await tx.delete(schedulerJobFinance).where(inArray(
        schedulerJobFinance.sourceId,
        [
          ...(createdEcoId ? [createdEcoId] : []),
          ...(createdSolarAssessmentId ? [createdSolarAssessmentId] : []),
          deletedEcoSyncId,
          deletedSolarSyncId,
        ],
      ));
      await tx.delete(eaAudits).where(inArray(eaAudits.id, [
        directAuditId,
        syncAuditId,
        deletedEcoSyncId,
        ...(createdEcoId ? [createdEcoId] : []),
      ]));
      await tx.delete(ssRooftopAssessments)
        .where(inArray(ssRooftopAssessments.id, [
          solarAssessmentId,
          deletedSolarSyncId,
          ...(createdSolarAssessmentId ? [createdSolarAssessmentId] : []),
        ]));
      await tx.delete(ssSites).where(inArray(ssSites.id, [
        solarSiteId,
        deletedSolarSiteSyncId,
      ]));
      await tx.execute(sql.raw(
        'ALTER TABLE scheduler_job_completion_facts ENABLE TRIGGER USER',
      ));
      await tx.execute(sql.raw('ALTER TABLE scheduler_job_finance ENABLE TRIGGER USER'));
      await tx.execute(sql.raw('ALTER TABLE ea_audits ENABLE TRIGGER USER'));
      await tx.execute(sql.raw(
        'ALTER TABLE ss_rooftop_assessments ENABLE TRIGGER USER',
      ));
      await tx.execute(sql.raw('ALTER TABLE ss_sites ENABLE TRIGGER USER'));
    });
    await closeDb();
  }
});
