import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.INSTALLHUB_PG_INTEGRATION_URL;

test('serial Field site retargeting allocates destination revisions and retains source identity and completed protection', {
  skip: !integrationDatabase,
}, async () => {
  const [{ buildApp }, { db, closeDb }, { ihInstallations }, { businessJobs }, { signAccessToken }, { eq, inArray }] = await Promise.all([
    import('../app.js'), import('../db/client.js'), import('../db/schema/installhub.js'), import('../db/schema/shared.js'), import('../auth/jwt.js'), import('drizzle-orm'),
  ]);
  const app = await buildApp();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const clientName = `Serial site switch ${randomUUID()}`;
  const token = signAccessToken({ userId: randomUUID(), app: 'installhub', role: 'inspector' });
  const payload = (id: string, siteAddress: string, baseTreeRevision = 0, notes = '') => ({
    treeSchemaVersion: 2, syncStage: 'metadata', baseTreeRevision,
    installation: { id, externalKey: `local:${id}`, siteCode: 'RETARGET', treeSchemaVersion: 2, treeRevision: 0, recordVersionNumber: 0, siteName: 'Site switch test', clientName, siteAddress, timezone: 'Australia/Sydney', inspectorName: 'Test Inspector', auditDate: '2026-09-05', status: 'Draft', jobComments: notes },
    gridSupplies: [{ id: `grid_${id}`, installationId: id, name: 'Grid', isDefault: true }], zones: [], electricalAssets: [], siteAssets: [], meterDevices: [], measurementAssignments: [], formSubmissions: [], serverDerived: { virtualMeterDefinitions: [] },
  });
  const push = (body: object) => app.inject({ method: 'POST', url: '/v1/installhub/sync/push', headers: { authorization: `Bearer ${token}` }, payload: body });
  const jobFor = async (sourceId: string) => {
    const [job] = await db.select().from(businessJobs).where(eq(businessJobs.sourceId, sourceId));
    assert.ok(job); return job;
  };
  try {
    const first = await push(payload(ids[0]!, '11 Serial Alpha Road'));
    const second = await push(payload(ids[1]!, '12 Serial Beta Road'));
    assert.equal(first.statusCode, 200, first.body); assert.equal(second.statusCode, 200, second.body);
    const originalJob = await jobFor(ids[0]!);
    const destinationJob = await jobFor(ids[1]!);
    assert.equal(originalJob.revisionNumber, 1); assert.equal(destinationJob.revisionNumber, 1);
    const third = await push(payload(ids[2]!, '11 Serial Alpha Road'));
    assert.equal(third.statusCode, 200, third.body);
    const originalSiteLatest = await jobFor(ids[2]!);
    assert.equal(originalSiteLatest.previousJobId, originalJob.id);

    const moved = await push(payload(ids[0]!, '12 Serial Beta Road', 1));
    assert.equal(moved.statusCode, 200, moved.body);
    const afterMove = await jobFor(ids[0]!);
    assert.equal(afterMove.id, originalJob.id);
    assert.equal(afterMove.sourceId, originalJob.sourceId);
    assert.equal(afterMove.siteId, destinationJob.siteId);
    assert.equal(afterMove.revisionNumber, 2);
    assert.equal(afterMove.previousJobId, originalJob.previousJobId);

    const sameSite = await push(payload(ids[0]!, '12 Serial Beta Road', moved.json().treeRevision, 'Updated notes'));
    assert.equal(sameSite.statusCode, 200, sameSite.body);
    const afterSameSite = await jobFor(ids[0]!);
    assert.equal(afterSameSite.revisionNumber, 2);
    assert.equal(afterSameSite.previousJobId, originalJob.previousJobId);
    const returned = await push(payload(ids[0]!, '11 Serial Alpha Road', sameSite.json().treeRevision));
    assert.equal(returned.statusCode, 200, returned.body);
    const afterReturn = await jobFor(ids[0]!);
    assert.equal(afterReturn.id, originalJob.id);
    assert.equal(afterReturn.siteId, originalJob.siteId);
    assert.equal(afterReturn.revisionNumber, originalSiteLatest.revisionNumber + 1);
    assert.equal(afterReturn.previousJobId, originalJob.previousJobId);
    assert.deepEqual(await jobFor(ids[1]!), destinationJob);
    assert.deepEqual(await jobFor(ids[2]!), originalSiteLatest);
    assert.notEqual(afterReturn.previousJobId, originalSiteLatest.id, 'Returning a job must not create a predecessor cycle');

    // The surrounding product transaction must continue to reject mutation of
    // completed history, including rolling back any provisional job relinking.
    await db.update(ihInstallations).set({ status: 'Completed' }).where(eq(ihInstallations.id, ids[0]!));
    const beforeRejected = await jobFor(ids[0]!);
    const rejected = await push(payload(ids[0]!, '12 Serial Beta Road', returned.json().treeRevision));
    assert.equal(rejected.statusCode, 409, rejected.body);
    assert.equal(rejected.json().detail, 'installation_completed_reopen_required');
    assert.deepEqual(await jobFor(ids[0]!), beforeRejected);
    const [retained] = await db.select({ status: ihInstallations.status, businessSiteId: ihInstallations.businessSiteId }).from(ihInstallations).where(eq(ihInstallations.id, ids[0]!));
    assert.equal(retained!.status, 'Completed'); assert.equal(retained!.businessSiteId, originalJob.siteId);
    const sourceJobs = await db.select().from(businessJobs).where(inArray(businessJobs.sourceId, ids));
    assert.equal(sourceJobs.length, 3);
  } finally {
    // Completed synthetic history remains in this explicitly disposable database.
    await app.close(); await closeDb();
  }
});
