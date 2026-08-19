import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.WORK_SESSION_PG_INTEGRATION_URL;
if (integrationDatabase) process.env.DATABASE_URL = integrationDatabase;

interface SessionPayload {
  revision: number;
  activeMilliseconds: number;
  startedAt: string;
  lastActiveAt: string;
  endedAt: string | null;
}

test('active-time endpoints persist monotonic sessions without mutating parent sync state', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { buildApp },
    { db, closeDb },
    { eaAudits, eaAuditWorkSessions },
    { ssSites, ssRooftopAssessments, ssAssessmentWorkSessions },
    { ihInstallations, ihInstallationWorkSessions },
    { and, eq },
    { signAccessToken },
  ] = await Promise.all([
    import('../app.js'),
    import('../db/client.js'),
    import('../db/schema/ecoaudit.js'),
    import('../db/schema/solarsense.js'),
    import('../db/schema/installhub.js'),
    import('drizzle-orm'),
    import('../auth/jwt.js'),
  ]);
  const app = await buildApp();
  const actorUserId = randomUUID();
  const otherUserId = randomUUID();
  const auditId = randomUUID();
  const siteId = randomUUID();
  const assessmentId = randomUUID();
  const installationId = randomUUID();
  const parentUpdatedAt = new Date('2026-08-15T09:00:00.000Z');
  const startedAt = '2026-08-15T10:00:00.000Z';
  const lastActiveAt = '2026-08-15T10:01:00.000Z';
  const openPayload: SessionPayload = {
    revision: 1,
    activeMilliseconds: 45_000,
    startedAt,
    lastActiveAt,
    endedAt: null,
  };
  const ecoToken = signAccessToken({
    userId: actorUserId,
    app: 'ecoaudit',
    role: 'inspector',
  });
  const solarToken = signAccessToken({
    userId: actorUserId,
    app: 'solarsense',
    role: 'inspector',
  });
  const installToken = signAccessToken({
    userId: actorUserId,
    app: 'installhub',
    role: 'inspector',
  });
  const otherTokens = {
    ecoaudit: signAccessToken({
      userId: otherUserId,
      app: 'ecoaudit',
      role: 'inspector',
    }),
    solarsense: signAccessToken({
      userId: otherUserId,
      app: 'solarsense',
      role: 'inspector',
    }),
    installhub: signAccessToken({
      userId: otherUserId,
      app: 'installhub',
      role: 'inspector',
    }),
  };

  const put = (
    url: string,
    token: string,
    payload: SessionPayload,
  ) => app.inject({
    method: 'PUT',
    url,
    headers: { authorization: `Bearer ${token}` },
    payload,
  });

  try {
    await db.insert(eaAudits).values({
      id: auditId,
      siteName: 'Work session audit',
      siteAddress: '1 Test Street',
      inspectorName: 'Test Inspector',
      status: 'Draft',
      createdByUserId: actorUserId,
      updatedAt: parentUpdatedAt,
    });
    await db.insert(ssSites).values({
      id: siteId,
      siteName: 'Work session site',
      status: 'Draft',
      createdByUserId: actorUserId,
      updatedAt: parentUpdatedAt,
    });
    await db.insert(ssRooftopAssessments).values({
      id: assessmentId,
      siteId,
      siteName: 'Work session site',
      buildingIdName: 'Building 1',
      status: 'Draft',
      createdByUserId: actorUserId,
      updatedAt: parentUpdatedAt,
    });
    await db.insert(ihInstallations).values({
      id: installationId,
      externalKey: `ih_work_session_${installationId}`,
      clientName: 'Work session client',
      siteName: 'Work session installation',
      siteAddress: '1 Test Street',
      inspectorName: 'Test Inspector',
      auditDate: '2026-08-15',
      status: 'Draft',
      createdByUserId: actorUserId,
      updatedAt: parentUpdatedAt,
    });

    const endpoints = [
      {
        url: `/v1/ecoaudit/audits/${auditId}/active-time/sessions/session-1`,
        token: ecoToken,
        otherToken: otherTokens.ecoaudit,
      },
      {
        url: `/v1/solarsense/sites/${siteId}/assessments/${assessmentId}/active-time/sessions/session-1`,
        token: solarToken,
        otherToken: otherTokens.solarsense,
      },
      {
        url: `/v1/installhub/installations/${installationId}/active-time/sessions/session-1`,
        token: installToken,
        otherToken: otherTokens.installhub,
      },
    ];
    for (const endpoint of endpoints) {
      const inserted = await put(endpoint.url, endpoint.token, openPayload);
      assert.equal(inserted.statusCode, 200, inserted.body);
      assert.deepEqual(inserted.json(), {
        sessionId: 'session-1',
        revision: 1,
        activeMilliseconds: 45_000,
        startedAt,
        lastActiveAt,
        endedAt: null,
        applied: true,
      });

      const retry = await put(endpoint.url, endpoint.token, openPayload);
      assert.equal(retry.statusCode, 200, retry.body);
      assert.equal(retry.json().applied, false);
      assert.equal(retry.json().revision, 1);
    }

    const [auditAfterCheckpoint] = await db.select().from(eaAudits)
      .where(eq(eaAudits.id, auditId));
    const [siteAfterCheckpoint] = await db.select().from(ssSites)
      .where(eq(ssSites.id, siteId));
    const [assessmentAfterCheckpoint] = await db.select().from(ssRooftopAssessments)
      .where(eq(ssRooftopAssessments.id, assessmentId));
    const [installationAfterCheckpoint] = await db.select().from(ihInstallations)
      .where(eq(ihInstallations.id, installationId));
    assert.equal(auditAfterCheckpoint.updatedAt.getTime(), parentUpdatedAt.getTime());
    assert.equal(siteAfterCheckpoint.updatedAt.getTime(), parentUpdatedAt.getTime());
    assert.equal(assessmentAfterCheckpoint.updatedAt.getTime(), parentUpdatedAt.getTime());
    assert.equal(installationAfterCheckpoint.updatedAt.getTime(), parentUpdatedAt.getTime());
    assert.equal(installationAfterCheckpoint.treeRevision, 0);
    assert.equal(installationAfterCheckpoint.recordVersionNumber, 0);

    const forbiddenResponse = await put(
      endpoints[0].url,
      signAccessToken({ userId: otherUserId, app: 'ecoaudit', role: 'inspector' }),
      openPayload,
    );
    assert.equal(forbiddenResponse.statusCode, 403, forbiddenResponse.body);
    const missingResponse = await put(
      `/v1/ecoaudit/audits/${randomUUID()}/active-time/sessions/session-1`,
      ecoToken,
      openPayload,
    );
    assert.equal(missingResponse.statusCode, 404, missingResponse.body);

    const transferEndpoints = endpoints.map((endpoint) => ({
      ...endpoint,
      url: endpoint.url.replace('/session-1', '/session-transfer'),
    }));
    for (const endpoint of transferEndpoints) {
      const inserted = await put(endpoint.url, endpoint.token, openPayload);
      assert.equal(inserted.statusCode, 200, inserted.body);
      assert.equal(inserted.json().applied, true);
    }

    await db.update(eaAudits).set({
      createdByUserId: otherUserId,
      assignedInspectorUserId: otherUserId,
    }).where(eq(eaAudits.id, auditId));
    await db.update(ssSites).set({
      createdByUserId: otherUserId,
    }).where(eq(ssSites.id, siteId));
    await db.update(ssRooftopAssessments).set({
      assignedInspectorUserId: otherUserId,
    }).where(eq(ssRooftopAssessments.id, assessmentId));
    await db.update(ihInstallations).set({
      createdByUserId: otherUserId,
      assignedInspectorUserId: otherUserId,
    }).where(eq(ihInstallations.id, installationId));

    const closedAfterTransfer: SessionPayload = {
      ...openPayload,
      revision: 2,
      endedAt: '2026-08-15T10:02:00.000Z',
    };
    for (const endpoint of transferEndpoints) {
      const retry = await put(endpoint.url, endpoint.token, openPayload);
      assert.equal(retry.statusCode, 200, retry.body);
      assert.equal(retry.json().applied, false);

      const continuedOpen = await put(endpoint.url, endpoint.token, {
        ...openPayload,
        revision: 2,
      });
      assert.equal(continuedOpen.statusCode, 403, continuedOpen.body);

      const closed = await put(endpoint.url, endpoint.token, closedAfterTransfer);
      assert.equal(closed.statusCode, 200, closed.body);
      assert.equal(closed.json().applied, true);
      assert.equal(closed.json().endedAt, closedAfterTransfer.endedAt);

      const postCloseAdvance = await put(endpoint.url, endpoint.token, {
        ...closedAfterTransfer,
        revision: 3,
      });
      assert.equal(postCloseAdvance.statusCode, 403, postCloseAdvance.body);

      const newClosedSession = await put(
        endpoint.url.replace('/session-transfer', '/session-after-transfer'),
        endpoint.token,
        closedAfterTransfer,
      );
      assert.equal(newClosedSession.statusCode, 403, newClosedSession.body);

      const newAssigneeCannotClaimPriorSession = await put(
        endpoint.url,
        endpoint.otherToken,
        closedAfterTransfer,
      );
      assert.equal(
        newAssigneeCannotClaimPriorSession.statusCode,
        409,
        newAssigneeCannotClaimPriorSession.body,
      );
      assert.equal(
        newAssigneeCannotClaimPriorSession.json().detail,
        'work_session_actor_changed',
      );
    }

    await db.update(eaAudits).set({
      createdByUserId: actorUserId,
      assignedInspectorUserId: null,
    }).where(eq(eaAudits.id, auditId));
    await db.update(ssSites).set({
      createdByUserId: actorUserId,
    }).where(eq(ssSites.id, siteId));
    await db.update(ssRooftopAssessments).set({
      assignedInspectorUserId: null,
    }).where(eq(ssRooftopAssessments.id, assessmentId));
    await db.update(ihInstallations).set({
      createdByUserId: actorUserId,
      assignedInspectorUserId: null,
    }).where(eq(ihInstallations.id, installationId));

    const ecoBoundary = new Date('2026-08-15T10:05:00.000Z');
    await db.update(eaAudits).set({
      status: 'Completed',
      completedAt: ecoBoundary,
    }).where(eq(eaAudits.id, auditId));
    const ecoOpenAdvance = await put(endpoints[0].url, ecoToken, {
      ...openPayload,
      revision: 2,
      activeMilliseconds: 46_000,
    });
    assert.equal(ecoOpenAdvance.statusCode, 409, ecoOpenAdvance.body);
    assert.equal(
      ecoOpenAdvance.json().detail,
      'audit_completed_time_tracking_disabled',
    );
    const ecoDelayed = await put(
      `/v1/ecoaudit/audits/${auditId}/active-time/sessions/session-delayed`,
      ecoToken,
      { ...openPayload, endedAt: '2026-08-15T10:02:00.000Z' },
    );
    assert.equal(ecoDelayed.statusCode, 200, ecoDelayed.body);

    const installBoundary = new Date('2026-08-15T10:05:00.000Z');
    await db.update(ihInstallations).set({
      status: 'Completed',
      completedAt: installBoundary,
    }).where(eq(ihInstallations.id, installationId));
    const installOpenAdvance = await put(endpoints[2].url, installToken, {
      ...openPayload,
      revision: 2,
      activeMilliseconds: 46_000,
    });
    assert.equal(installOpenAdvance.statusCode, 409, installOpenAdvance.body);
    assert.equal(
      installOpenAdvance.json().detail,
      'installation_completed_time_tracking_disabled',
    );

    await db.update(ssSites).set({
      status: 'Completed',
      completedAt: new Date('2026-08-15T10:04:00.000Z'),
      updatedAt: new Date('2026-08-15T12:04:00.000Z'),
    }).where(eq(ssSites.id, siteId));
    await db.update(ssRooftopAssessments).set({
      status: 'Completed',
      completedAt: new Date('2026-08-15T10:05:00.000Z'),
      updatedAt: new Date('2026-08-15T12:05:00.000Z'),
    }).where(eq(ssRooftopAssessments.id, assessmentId));
    const solarPastEarliestBoundary = await put(
      `/v1/solarsense/sites/${siteId}/assessments/${assessmentId}/active-time/sessions/session-too-late`,
      solarToken,
      { ...openPayload, endedAt: '2026-08-15T10:04:30.000Z' },
    );
    assert.equal(solarPastEarliestBoundary.statusCode, 409, solarPastEarliestBoundary.body);
    const solarDelayed = await put(
      `/v1/solarsense/sites/${siteId}/assessments/${assessmentId}/active-time/sessions/session-delayed`,
      solarToken,
      { ...openPayload, endedAt: '2026-08-15T10:03:00.000Z' },
    );
    assert.equal(solarDelayed.statusCode, 200, solarDelayed.body);

    const [[ecoStored], [solarStored], [installStored]] = await Promise.all([
      db.select().from(eaAuditWorkSessions).where(and(
        eq(eaAuditWorkSessions.auditId, auditId),
        eq(eaAuditWorkSessions.id, 'session-1'),
      )),
      db.select().from(ssAssessmentWorkSessions).where(and(
        eq(ssAssessmentWorkSessions.assessmentId, assessmentId),
        eq(ssAssessmentWorkSessions.id, 'session-1'),
      )),
      db.select().from(ihInstallationWorkSessions).where(and(
        eq(ihInstallationWorkSessions.installationId, installationId),
        eq(ihInstallationWorkSessions.id, 'session-1'),
      )),
    ]);
    assert.equal(ecoStored.actorUserId, actorUserId);
    assert.equal(solarStored.actorUserId, actorUserId);
    assert.equal(installStored.actorUserId, actorUserId);
  } finally {
    await db.delete(eaAudits).where(eq(eaAudits.id, auditId));
    await db.delete(ssRooftopAssessments)
      .where(eq(ssRooftopAssessments.id, assessmentId));
    await db.delete(ssSites).where(eq(ssSites.id, siteId));
    await db.delete(ihInstallations).where(eq(ihInstallations.id, installationId));
    await app.close();
    await closeDb();
  }
});
