import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.INSTALLHUB_PG_INTEGRATION_URL;

test('purge rolls back behind active jobs and serializes with completion', {
  skip: !integrationDatabase,
}, async () => {
  const [{ db, closeDb }, { ihInstallations }, { pdfJobs }, { eq }, { purgeInstallHubInstallationTree }] = await Promise.all([
    import('../../db/client.js'),
    import('../../db/schema/installhub.js'),
    import('../../db/schema/shared.js'),
    import('drizzle-orm'),
    import('./purge.js'),
  ]);
  const installationId = randomUUID();
  const jobId = randomUUID();
  const draftInstallationId = randomUUID();
  const insertDraft = (id: string) => db.insert(ihInstallations).values({
    id,
    externalKey: `ih_test_${id}`,
    siteCode: 'TEST',
    timezone: 'Australia/Sydney',
    treeSchemaVersion: 2,
    treeRevision: 1,
    recordVersionNumber: 0,
    clientName: 'Purge test',
    siteName: 'Purge test',
    siteAddress: '1 Test Street',
    inspectorName: 'Test Inspector',
    auditDate: '2026-08-01',
    status: 'Draft',
  });
  try {
    await insertDraft(installationId);
    await db.insert(pdfJobs).values({
      id: jobId,
      app: 'installhub',
      entityId: installationId,
      entityType: 'installation',
      userId: 'purge-test-user',
      params: {
        artifactType: 'pdf',
        filename: 'purge-test.pdf',
        contentType: 'application/pdf',
      },
      status: 'queued',
    });

    await assert.rejects(
      purgeInstallHubInstallationTree(installationId),
      (error: unknown) => (
        error instanceof Error
        && 'detail' in error
        && error.detail === 'Wait for active Field App Complete PDF jobs to finish before deleting this Cloud Backup'
      ),
    );
    const [afterRollback] = await db
      .select({ deletedAt: ihInstallations.deletedAt })
      .from(ihInstallations)
      .where(eq(ihInstallations.id, installationId));
    assert.equal(afterRollback?.deletedAt, null);

    await db.delete(pdfJobs).where(eq(pdfJobs.id, jobId));
    let signalLocked!: () => void;
    let releaseCompletion!: () => void;
    const locked = new Promise<void>((resolve) => { signalLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseCompletion = resolve; });
    const completion = db.transaction(async (tx) => {
      await tx.select({ id: ihInstallations.id })
        .from(ihInstallations)
        .where(eq(ihInstallations.id, installationId))
        .for('update');
      signalLocked();
      await release;
      await tx.update(ihInstallations).set({ status: 'Completed' })
        .where(eq(ihInstallations.id, installationId));
    });
    await locked;
    const racingPurge = purgeInstallHubInstallationTree(installationId);
    releaseCompletion();
    await completion;
    await assert.rejects(racingPurge, (error: unknown) => (
      error instanceof Error
      && 'detail' in error
      && error.detail === 'installation_completed_reopen_required'
    ));
    const [completed] = await db
      .select({ status: ihInstallations.status, deletedAt: ihInstallations.deletedAt })
      .from(ihInstallations)
      .where(eq(ihInstallations.id, installationId));
    assert.deepEqual(completed, { status: 'Completed', deletedAt: null });

    // Completed history is retained by the database; test successful deletion
    // with a separate draft instead of illegally rewinding the completed row.
    await insertDraft(draftInstallationId);
    await purgeInstallHubInstallationTree(draftInstallationId);
    const [removed] = await db.select({ id: ihInstallations.id })
      .from(ihInstallations)
      .where(eq(ihInstallations.id, draftInstallationId));
    assert.equal(removed, undefined);
  } finally {
    await closeDb();
  }
});
