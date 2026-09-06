import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.INSTALLHUB_PG_INTEGRATION_URL;

test('optional client/site capture round-trips without directory learning and detaches explicit clears transactionally', {
  skip: !integrationDatabase,
}, async () => {
  const [{ buildApp }, { db, closeDb }, { ihInstallations }, { businessClients, businessSites, businessJobs, fieldAppJobDetails }, { signAccessToken }, { eq, inArray }, { purgeInstallHubInstallationTree }, { upsertClientSiteFromProductRecord }] = await Promise.all([
    import('../../app.js'), import('../../db/client.js'), import('../../db/schema/installhub.js'), import('../../db/schema/shared.js'), import('../../auth/jwt.js'), import('drizzle-orm'), import('./purge.js'), import('../../services/clientSiteMemoryService.js'),
  ]);
  const app = await buildApp();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const userId = randomUUID();
  const token = signAccessToken({ userId, app: 'installhub', role: 'inspector' });
  const strangerToken = signAccessToken({ userId: randomUUID(), app: 'installhub', role: 'inspector' });
  const clientName = `Optional capture ${randomUUID()}`;
  let directoryClientId: string | undefined;
  let directorySiteId: string | undefined;
  const payload = (id: string, installation: Record<string, unknown> = {}, baseTreeRevision = 0) => ({
    syncStage: 'metadata', treeSchemaVersion: 2, baseTreeRevision,
    installation: { id, treeSchemaVersion: 2, externalKey: `local:${id}`, siteCode: 'OPTIONAL', timezone: 'Australia/Sydney', treeRevision: 0, recordVersionNumber: 0, siteName: 'Optional Site', clientName: '', siteAddress: '', inspectorName: 'Test Inspector', auditDate: '2026-09-05', status: 'Draft', ...installation },
    gridSupplies: [{ id: `grid_${id}_primary`, installationId: id, name: 'Grid supply', isDefault: true }], zones: [], electricalAssets: [], siteAssets: [], meterDevices: [], measurementAssignments: [], formSubmissions: [], serverDerived: { virtualMeterDefinitions: [] },
  });
  const push = (body: Record<string, unknown>, bearer = token) => app.inject({ method: 'POST', url: '/v1/installhub/sync/push', headers: { authorization: `Bearer ${bearer}` }, payload: body });
  const pull = (id: string) => app.inject({ method: 'GET', url: `/v1/installhub/sync/pull?since=1970-01-01T00%3A00%3A00.000Z&installationId=${id}`, headers: { authorization: `Bearer ${token}` } });
  const assertEmptyMemory = (value: Record<string, unknown>) => {
    assert.equal(value.clientId, null);
    assert.equal(value.clientSiteId, null);
    assert.deepEqual(value.clientMemory, { client: null, site: null });
  };
  try {
    const created = await push(payload(ids[0]!));
    assert.equal(created.statusCode, 200, created.body);
    assertEmptyMemory(created.json());
    assert.equal(created.json().treeRevision, 1);
    const firstPull = await pull(ids[0]!);
    assert.equal(firstPull.statusCode, 200, firstPull.body);
    const first = firstPull.json().installations[0].installation;
    assert.equal(first.clientName, ''); assert.equal(first.siteAddress, '');
    assert.equal(first.clientId, null); assert.equal(first.clientSiteId, null);

    const replay = await push(payload(ids[0]!));
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().treeRevision, 1);
    assertEmptyMemory(replay.json());
    const completeSnapshot = await push({ ...payload(ids[0]!, {}, 1), syncStage: 'complete' });
    assert.equal(completeSnapshot.statusCode, 200, completeSnapshot.body);
    assert.ok(completeSnapshot.json().recordVersionNumber >= 1);
    assertEmptyMemory(completeSnapshot.json());

    const filled = await push(payload(ids[0]!, { clientName, siteAddress: '1 Test Street, Sydney NSW 2000' }, 1));
    assert.equal(filled.statusCode, 200, filled.body);
    directoryClientId = filled.json().clientId;
    directorySiteId = filled.json().clientSiteId;
    assert.ok(directoryClientId); assert.ok(directorySiteId);
    let revision = filled.json().treeRevision;
    const fullTree = (await pull(ids[0]!)).json().installations[0];
    const clearRequest = { ...fullTree, baseTreeRevision: revision, syncStage: 'metadata', installation: { ...fullTree.installation, clientName: '', siteAddress: '', clientId: directoryClientId, clientSiteId: directorySiteId, siteAddressSource: 'client_saved' } };
    const stale = await push({ ...clearRequest, baseTreeRevision: revision - 1 });
    assert.equal(stale.statusCode, 409, stale.body);
    const denied = await push(clearRequest, strangerToken);
    assert.equal(denied.statusCode, 403, denied.body);
    const [stillLinked] = await db.select().from(ihInstallations).where(eq(ihInstallations.id, ids[0]!));
    assert.equal(stillLinked!.businessSiteId, directorySiteId);
    assert.equal(stillLinked!.clientName, clientName);
    assert.equal(stillLinked!.treeRevision, revision);

    const reused = await push(payload(ids[1]!, { clientName, clientId: directoryClientId, clientSiteId: directorySiteId, siteAddressSource: 'client_saved', siteAddress: '1 Test Street, Sydney NSW 2000' }));
    assert.equal(reused.statusCode, 200, reused.body);
    assert.equal(reused.json().clientId, directoryClientId);
    assert.equal(reused.json().clientSiteId, directorySiteId);

    const cleared = await push(clearRequest);
    assert.equal(cleared.statusCode, 200, cleared.body);
    assertEmptyMemory(cleared.json());
    assert.equal(cleared.json().treeRevision, revision + 1);
    revision = cleared.json().treeRevision;
    const afterClear = (await pull(ids[0]!)).json().installations[0];
    assert.equal(afterClear.installation.clientName, '');
    assert.equal(afterClear.installation.siteAddress, '');
    assert.equal(afterClear.installation.clientId, null);
    assert.equal(afterClear.installation.clientSiteId, null);
    const [detached] = await db.select().from(ihInstallations).where(eq(ihInstallations.id, ids[0]!));
    assert.equal(detached!.businessSiteId, null);
    const [retainedSite] = await db.select().from(businessSites).where(eq(businessSites.id, directorySiteId!));
    assert.equal(retainedSite!.address, '1 Test Street, Sydney NSW 2000');
    const replayClear = await push({ ...afterClear, baseTreeRevision: revision, syncStage: 'metadata' });
    assert.equal(replayClear.statusCode, 200, replayClear.body);
    assert.equal(replayClear.json().treeRevision, revision);
    assertEmptyMemory(replayClear.json());

    const legacy = { installation: { id: ids[2], siteName: '', clientName: '', siteAddress: '', inspectorName: 'Test Inspector', auditDate: '2026-09-05', status: 'Draft' }, zones: [], electricalAssets: [], siteAssets: [], formSubmissions: [] };
    const legacyCreate = await push(legacy);
    assert.equal(legacyCreate.statusCode, 200, legacyCreate.body);
    assert.equal(legacyCreate.json().treeSchemaVersion, 1);
    assertEmptyMemory(legacyCreate.json());
    const legacyPull = await pull(ids[2]!);
    assert.equal(legacyPull.statusCode, 200, legacyPull.body);
    assert.equal(legacyPull.json().installations[0].installation.clientName, '');
    assert.equal(legacyPull.json().installations[0].installation.siteAddress, '');

    await assert.rejects(() => upsertClientSiteFromProductRecord(db, {
      clientName: 'Other product still requires address', siteName: 'Site', address: { displayAddress: '' },
    }), (error: unknown) => Boolean(error && typeof error === 'object' && 'detail' in error && error.detail === 'address.displayAddress is required'));
  } finally {
    for (const id of ids) await purgeInstallHubInstallationTree(id).catch(() => {});
    const jobs = await db.select({ id: businessJobs.id }).from(businessJobs).where(inArray(businessJobs.sourceId, ids));
    if (jobs.length) {
      const jobIds = jobs.map((job) => job.id);
      await db.delete(fieldAppJobDetails).where(inArray(fieldAppJobDetails.jobId, jobIds));
      await db.delete(businessJobs).where(inArray(businessJobs.id, jobIds));
    }
    if (directorySiteId) await db.delete(businessSites).where(eq(businessSites.id, directorySiteId));
    if (directoryClientId) await db.delete(businessClients).where(eq(businessClients.id, directoryClientId));
    await app.close(); await closeDb();
  }
});
