import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const integrationDatabase = process.env.INSTALLHUB_PG_INTEGRATION_URL;

test('meter replacement history is scoped, linear, idempotent and rollback-safe', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { buildApp },
    { db, closeDb },
    {
      ihElectricalAssets,
      ihGridSupplies,
      ihInstallations,
      ihMeterChannels,
      ihMeterDevices,
      ihMeterHistoryEvents,
      ihZones,
    },
    { recordVersions },
    { signAccessToken },
    { and, eq },
    { purgeInstallHubInstallationTree },
    { loadCanonicalInstallationTree },
  ] = await Promise.all([
    import('../../app.js'),
    import('../../db/client.js'),
    import('../../db/schema/installhub.js'),
    import('../../db/schema/shared.js'),
    import('../../auth/jwt.js'),
    import('drizzle-orm'),
    import('./purge.js'),
    import('./treeService.js'),
  ]);
  const app = await buildApp();
  const installationId = randomUUID();
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const gridId = randomUUID();
  const zoneId = randomUUID();
  const boardId = randomUUID();
  const meterId = randomUUID();
  const token = signAccessToken({ userId, app: 'installhub', role: 'inspector' });
  const otherToken = signAccessToken({
    userId: otherUserId,
    app: 'installhub',
    role: 'inspector',
  });
  const wrongAppToken = signAccessToken({
    userId,
    app: 'ecoaudit',
    role: 'admin',
  });

  const auth = (value = token) => ({ authorization: `Bearer ${value}` });
  const pull = async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/installhub/sync/pull?since=1970-01-01T00%3A00%3A00.000Z&installationId=${installationId}`,
      headers: auth(),
    });
    assert.equal(response.statusCode, 200, response.body);
    const body = response.json() as { installations: Array<Record<string, unknown>> };
    assert.equal(body.installations.length, 1);
    const canonical = await loadCanonicalInstallationTree(installationId);
    assert.ok(canonical);
    return {
      ...structuredClone(canonical),
      treeRevision: canonical.installation.treeRevision,
      recordVersionNumber: canonical.installation.recordVersionNumber,
    } as unknown as Record<string, unknown>;
  };
  const push = async (
    tree: Record<string, unknown>,
    syncStage: 'metadata' | 'complete',
  ) => app.inject({
    method: 'POST',
    url: '/v1/installhub/sync/push',
    headers: auth(),
    payload: { ...tree, syncStage },
  });

  try {
    await db.insert(ihInstallations).values({
      id: installationId,
      externalKey: `ih_test_${installationId}`,
      siteCode: 'HISTORY',
      timezone: 'Australia/Sydney',
      treeSchemaVersion: 2,
      treeRevision: 1,
      recordVersionNumber: 0,
      clientName: 'History client',
      siteName: 'History site',
      siteAddress: '1 Test Street',
      inspectorName: 'History Inspector',
      auditDate: '2026-08-08',
      status: 'Draft',
      createdByUserId: userId,
    });
    await db.insert(ihGridSupplies).values({
      id: gridId,
      installationId,
      name: 'Grid supply',
      isDefault: true,
    });
    await db.insert(ihZones).values({
      id: zoneId,
      installationId,
      zoneCode: 'MAIN',
      zoneName: 'Main room',
      zoneDescription: '',
      photos: [],
    });
    await db.insert(ihElectricalAssets).values({
      id: boardId,
      installationId,
      zoneId,
      assetName: 'Main switchboard',
      displayCode: 'HISTORY-MAIN-01-MSB-MAIN-SWITCHBOARD',
      generatedDisplayCode: 'HISTORY-MAIN-01-MSB-MAIN-SWITCHBOARD',
      displayCodeRuleVersion: 4,
      assetType: 'MSB',
      typeCode: 'MSB',
      sourceKind: 'GRID',
      gridSupplyId: gridId,
      electricalParentTbc: false,
      extraPhotos: [],
      meterPresent: true,
    });
    await db.insert(ihMeterDevices).values({
      id: meterId,
      installationId,
      installedOnBoardId: boardId,
      customName: 'Original meter',
      deviceFamily: 'WATTWATCHERS',
      deviceModel: 'A3RM',
      deviceNumber: 'ORIGINAL-TAG',
      serialNumber: 'ORIGINAL-SERIAL',
      displayCode: 'HISTORY-MAIN-02-A3RM-ORIGINAL-METER',
      generatedDisplayCode: 'HISTORY-MAIN-02-A3RM-ORIGINAL-METER',
      displayCodeRuleVersion: 4,
      wwPhotos: {},
    });
    await db.insert(ihMeterChannels).values(Array.from({ length: 3 }, (_, index) => ({
      id: `${meterId}:${index + 1}`,
      installationId,
      meterId,
      ordinal: index + 1,
      purpose: 'SPARE',
      capabilities: {},
    })));
    const commissioningFormId = randomUUID();
    const initialTree = await pull() as {
      treeRevision: number;
      formSubmissions: Array<Record<string, unknown>>;
    } & Record<string, unknown>;
    initialTree.baseTreeRevision = initialTree.treeRevision;
    initialTree.formSubmissions.push({
      id: commissioningFormId,
      installationId,
      formType: 'ww-installation',
      schemaVersion: 2,
      status: 'Completed',
      zoneId,
      boardId,
      meterId,
      siteAssetId: null,
      answers: {
        'device.type': 'A3RM',
        'device.number': 'ORIGINAL-TAG',
        'device.id': 'ORIGINAL-SERIAL',
        'channel.1.purpose': 'Spare / unused',
        'channel.2.purpose': 'Spare / unused',
        'channel.3.purpose': 'Spare / unused',
      },
      attachments: [],
      completedAt: new Date().toISOString(),
      historicalMeterRemoved: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
    });
    const initial = await push(initialTree, 'complete');
    assert.equal(initial.statusCode, 200, initial.body);
    const initialResult = initial.json() as {
      treeRevision: number;
      recordVersionNumber: number;
    };
    assert.equal(initialResult.recordVersionNumber, 1);

    type MutableHistoryTree = {
      treeRevision: number;
      recordVersionNumber: number;
      baseTreeRevision?: number;
      installation: Record<string, unknown>;
      meterDevices: Array<Record<string, unknown>>;
      measurementAssignments: Array<Record<string, unknown>>;
      formSubmissions: Array<Record<string, unknown>>;
    } & Record<string, unknown>;
    const applyReplacementMeter = (
      tree: MutableHistoryTree,
      index: number,
      model: 'A3RM' | 'A6M',
    ) => {
      const channelCount = model === 'A6M' ? 6 : 3;
      const sensorRating = model === 'A6M' ? 'CT-60A' : '3000A - 20cm';
      const currentChannels = new Map(
        (tree.meterDevices[0].channels as Array<Record<string, unknown>>).map(
          (channel) => [Number(channel.ordinal), channel],
        ),
      );
      tree.meterDevices[0] = {
        ...tree.meterDevices[0],
        customName: `Replacement ${index}`,
        deviceModel: model,
        deviceNumber: `TAG-${index}`,
        serialNumber: `SERIAL-${index}`,
        channels: Array.from({ length: channelCount }, (_, channelIndex) => {
          const ordinal = channelIndex + 1;
          const currentChannel = currentChannels.get(ordinal);
          return currentChannel
            ? { ...currentChannel, sensorRating }
            : {
                id: `${meterId}:${ordinal}`,
                ordinal,
                purpose: 'SUB_CIRCUIT',
                sensorRating,
                capabilities: {},
              };
        }),
      };
    };
    const replacementForm = (input: {
      index: number;
      model: 'A3RM' | 'A6M';
      formId: string;
      timestamp: string;
      status: 'Draft' | 'Completed';
    }): Record<string, unknown> => ({
      id: input.formId,
      installationId,
      formType: 'comms-fault',
      schemaVersion: 2,
      status: input.status,
      zoneId,
      boardId,
      meterId,
      siteAssetId: null,
      answers: {
        'works.replace_device': 'yes',
        'works.new_device_type': input.model,
        'works.new_device_number': `TAG-${input.index}`,
        'works.new_device_id': `SERIAL-${input.index}`,
        'works.new_sensor_rating': input.model === 'A6M' ? 'CT-60A' : '3000A - 20cm',
      },
      attachments: [],
      completedAt: input.status === 'Completed' ? input.timestamp : null,
      historicalMeterRemoved: false,
      createdAt: input.timestamp,
      updatedAt: input.timestamp,
      deletedAt: null,
    });

    const ambiguousTree = await pull() as MutableHistoryTree;
    ambiguousTree.baseTreeRevision = ambiguousTree.treeRevision;
    applyReplacementMeter(ambiguousTree, 99, 'A6M');
    const ambiguousTimestamp = new Date().toISOString();
    ambiguousTree.formSubmissions.push(...[1, 2].map((suffix) => ({
      id: randomUUID(),
      installationId,
      formType: 'comms-fault',
      schemaVersion: 2,
      status: 'Completed',
      zoneId,
      boardId,
      meterId,
      siteAssetId: null,
      answers: {
        'works.replace_device': 'yes',
        'works.new_device_type': 'A6M',
        'works.new_device_number': `AMBIGUOUS-${suffix}`,
        'works.new_device_id': `AMBIGUOUS-${suffix}`,
      },
      attachments: [],
      completedAt: ambiguousTimestamp,
      historicalMeterRemoved: false,
      createdAt: ambiguousTimestamp,
      updatedAt: ambiguousTimestamp,
      deletedAt: null,
    })));
    const ambiguous = await push(ambiguousTree, 'complete');
    assert.equal(ambiguous.statusCode, 400, ambiguous.body);
    assert.match(ambiguous.body, /multiple_comms_replacements_per_meter/);
    assert.equal(
      ((await pull() as MutableHistoryTree).meterDevices[0].serialNumber),
      'ORIGINAL-SERIAL',
    );

    for (let index = 1; index <= 3; index += 1) {
      let tree = await pull() as MutableHistoryTree;
      const model = index % 2 === 1 ? 'A6M' : 'A3RM';
      const formId = randomUUID();
      const timestamp = new Date().toISOString();

      if (index === 2) {
        tree.baseTreeRevision = tree.treeRevision;
        tree.measurementAssignments.push({
          id: 'assigned-channel-four',
          installationId,
          meterId,
          channelIds: [`${meterId}:4`],
          phaseMode: 'SINGLE_PHASE',
          target: { kind: 'TBC' },
          direction: 'CONSUMPTION',
          status: 'TBC',
        });
        const assignedBaseline = await push(tree, 'metadata');
        assert.equal(assignedBaseline.statusCode, 200, assignedBaseline.body);

        const rejectedShrink = await pull() as MutableHistoryTree;
        rejectedShrink.baseTreeRevision = rejectedShrink.treeRevision;
        applyReplacementMeter(rejectedShrink, index, model);
        rejectedShrink.measurementAssignments = rejectedShrink.measurementAssignments.filter(
          (assignment) => assignment.id !== 'assigned-channel-four',
        );
        rejectedShrink.formSubmissions.push(replacementForm({
          index,
          model,
          formId: randomUUID(),
          timestamp,
          status: 'Completed',
        }));
        const rejected = await push(rejectedShrink, 'complete');
        assert.equal(rejected.statusCode, 400, rejected.body);
        assert.match(rejected.body, /comms_replacement_mapping_changed/);

        const afterRejected = await pull() as MutableHistoryTree;
        assert.equal(
          afterRejected.measurementAssignments.some(
            (assignment) => assignment.id === 'assigned-channel-four',
          ),
          true,
        );
        afterRejected.baseTreeRevision = afterRejected.treeRevision;
        afterRejected.measurementAssignments = afterRejected.measurementAssignments.filter(
          (assignment) => assignment.id !== 'assigned-channel-four',
        );
        const clearedBaseline = await push(afterRejected, 'metadata');
        assert.equal(clearedBaseline.statusCode, 200, clearedBaseline.body);
        tree = await pull() as MutableHistoryTree;
      }

      applyReplacementMeter(tree, index, model);
      tree.baseTreeRevision = tree.treeRevision;
      tree.formSubmissions.push(replacementForm({
        index,
        model,
        formId,
        timestamp,
        status: index === 1 ? 'Draft' : 'Completed',
      }));

      if (index === 1) {
        tree.installation.siteAddress = '2 Staged Metadata Street';
        const staged = await push(tree, 'metadata');
        assert.equal(staged.statusCode, 200, staged.body);
        const heldTree = await pull() as MutableHistoryTree;
        assert.equal(heldTree.meterDevices[0].serialNumber, 'ORIGINAL-SERIAL');
        assert.equal(heldTree.installation.siteAddress, '2 Staged Metadata Street');
        assert.equal(
          heldTree.formSubmissions.find((form) => form.id === formId)?.status,
          'Draft',
        );

        // A pull reconciles the operational meter back to the installed
        // device. Completion reapplies the form-authored replacement.
        tree = heldTree;
        tree.baseTreeRevision = tree.treeRevision;
        applyReplacementMeter(tree, index, model);
        const stagedForm = tree.formSubmissions.find((form) => form.id === formId);
        assert.ok(stagedForm);
        stagedForm.status = 'Completed';
        stagedForm.completedAt = timestamp;
        stagedForm.updatedAt = timestamp;
      }

      const replacement = await push(tree, 'complete');
      assert.equal(replacement.statusCode, 200, replacement.body);
    }

    /*
     * Keep this cast close to the API boundary: pull returns the canonical
     * tree plus the legacy compatibility projection.
     */
    const commissionedTree = await pull() as {
        treeRevision: number;
        formSubmissions: Array<Record<string, unknown>>;
      } & Record<string, unknown>;
    assert.equal(
      commissionedTree.formSubmissions.find((form) => form.id === commissioningFormId)?.status,
      'Completed',
    );

    const stagedHistorical = await pull() as MutableHistoryTree;
    stagedHistorical.baseTreeRevision = stagedHistorical.treeRevision;
    const historicalComms = stagedHistorical.formSubmissions.find((form) => (
      form.formType === 'comms-fault'
      && form.status === 'Completed'
      && (form.answers as Record<string, string>)['works.new_device_id'] === 'SERIAL-3'
    ));
    assert.ok(historicalComms);
    historicalComms.status = 'Draft';
    historicalComms.completedAt = null;
    for (const channel of stagedHistorical.meterDevices[0].channels as Array<
      Record<string, unknown>
    >) {
      if (channel.purpose === 'SPARE') channel.sensorRating = 'CT-60A';
    }
    stagedHistorical.meterDevices[0].notes = 'Metadata after completed replacement';
    const stagedHistoricalResult = await push(stagedHistorical, 'metadata');
    assert.equal(stagedHistoricalResult.statusCode, 200, stagedHistoricalResult.body);
    const afterHistoricalStage = await pull() as MutableHistoryTree;
    assert.equal(afterHistoricalStage.meterDevices[0].notes, 'Metadata after completed replacement');
    assert.equal(
      (afterHistoricalStage.meterDevices[0].channels as Array<Record<string, unknown>>)
        .filter((channel) => channel.purpose === 'SPARE')
        .every((channel) => channel.sensorRating === 'CT-60A'),
      true,
    );
    assert.equal(
      afterHistoricalStage.formSubmissions.find((form) => form.id === historicalComms.id)?.status,
      'Completed',
    );

    const edited = await pull() as {
      treeRevision: number;
      installation: Record<string, unknown>;
    } & Record<string, unknown>;
    edited.baseTreeRevision = edited.treeRevision;
    edited.installation.siteName = 'Unrelated current site-name edit';
    const metadata = await push(edited, 'metadata');
    assert.equal(metadata.statusCode, 200, metadata.body);
    const metadataResult = metadata.json() as { treeRevision: number };

    for (const unauthorizedToken of [otherToken, wrongAppToken]) {
      const denied = await app.inject({
        method: 'GET',
        url: `/v1/installhub/installations/${installationId}/meters/${meterId}/history`,
        headers: auth(unauthorizedToken),
      });
      assert.equal(denied.statusCode, 403, denied.body);
      const deniedRollback: { statusCode: number; body: string } = await app.inject({
        method: 'POST',
        url: `/v1/installhub/installations/${installationId}/meters/${meterId}/history/rollback`,
        headers: auth(unauthorizedToken),
        payload: {
          targetRecordVersionNumber: initialResult.recordVersionNumber,
          baseTreeRevision: metadataResult.treeRevision,
          reason: 'This actor must not restore the device',
          idempotencyKey: randomUUID(),
        },
      });
      assert.equal(deniedRollback.statusCode, 403, deniedRollback.body);
    }

    const history = await app.inject({
      method: 'GET',
      url: `/v1/installhub/installations/${installationId}/meters/${meterId}/history?limit=100`,
      headers: auth(),
    });
    assert.equal(history.statusCode, 200, history.body);
    const historyBody = history.json() as {
      versions: Array<{ operation: string; recordVersionNumber: number }>;
      page: { total: number };
    };
    assert.equal(
      historyBody.versions.filter((version) => version.operation === 'REPLACEMENT').length,
      3,
    );
    assert.equal(historyBody.page.total, historyBody.versions.length);

    const idempotencyKey = randomUUID();
    const rollbackPayload = {
      targetRecordVersionNumber: initialResult.recordVersionNumber,
      baseTreeRevision: metadataResult.treeRevision,
      reason: 'Restore the original communications device',
      idempotencyKey,
    };
    const rollback = await app.inject({
      method: 'POST',
      url: `/v1/installhub/installations/${installationId}/meters/${meterId}/history/rollback`,
      headers: auth(),
      payload: rollbackPayload,
    });
    assert.equal(rollback.statusCode, 200, rollback.body);
    const rollbackResult = rollback.json() as {
      meterHistory: { recordVersionNumber: number; treeRevision: number };
    };
    assert.ok(rollbackResult.meterHistory.recordVersionNumber > initialResult.recordVersionNumber);

    const replay = await app.inject({
      method: 'POST',
      url: `/v1/installhub/installations/${installationId}/meters/${meterId}/history/rollback`,
      headers: auth(),
      payload: rollbackPayload,
    });
    assert.equal(replay.statusCode, 200, replay.body);
    assert.deepEqual(replay.json(), rollback.json());

    const keyMismatch = await app.inject({
      method: 'POST',
      url: `/v1/installhub/installations/${installationId}/meters/${meterId}/history/rollback`,
      headers: auth(),
      payload: { ...rollbackPayload, reason: 'A different request' },
    });
    assert.equal(keyMismatch.statusCode, 409, keyMismatch.body);

    const stale = await app.inject({
      method: 'POST',
      url: `/v1/installhub/installations/${installationId}/meters/${meterId}/history/rollback`,
      headers: auth(),
      payload: {
        ...rollbackPayload,
        idempotencyKey: randomUUID(),
        targetRecordVersionNumber: historyBody.versions[0].recordVersionNumber,
      },
    });
    assert.equal(stale.statusCode, 409, stale.body);

    const current = await pull() as {
      installation: { siteName: string };
      meterDevices: Array<{ serialNumber: string }>;
    };
    assert.equal(current.installation.siteName, 'Unrelated current site-name edit');
    assert.equal(current.meterDevices[0].serialNumber, 'ORIGINAL-SERIAL');

    const events = await db.select().from(ihMeterHistoryEvents).where(and(
      eq(ihMeterHistoryEvents.installationId, installationId),
      eq(ihMeterHistoryEvents.meterId, meterId),
    ));
    const replacementEvents = events
      .filter((event) => event.operation === 'REPLACEMENT')
      .sort((left, right) => left.fromRecordVersionNumber - right.fromRecordVersionNumber);
    assert.equal(replacementEvents.length, 3);
    assert.equal(events.filter((event) => event.operation === 'ROLLBACK').length, 1);
    const [firstPreimage] = await db.select({ snapshot: recordVersions.snapshot })
      .from(recordVersions)
      .where(and(
        eq(recordVersions.app, 'installhub'),
        eq(recordVersions.entityType, 'installation'),
        eq(recordVersions.entityId, installationId),
        eq(recordVersions.versionNumber, replacementEvents[0].fromRecordVersionNumber),
      ));
    const preimageTree = (firstPreimage?.snapshot as {
      installationTree?: { meterDevices?: Array<{ id: string; serialNumber: string }> };
    } | undefined)?.installationTree;
    assert.equal(
      preimageTree?.meterDevices?.find((meter) => meter.id === meterId)?.serialNumber,
      'ORIGINAL-SERIAL',
    );
    const [pinnedRollback] = await db.select().from(recordVersions).where(and(
      eq(recordVersions.app, 'installhub'),
      eq(recordVersions.entityType, 'installation'),
      eq(recordVersions.entityId, installationId),
      eq(recordVersions.versionNumber, rollbackResult.meterHistory.recordVersionNumber),
    ));
    assert.ok(pinnedRollback, 'rollback event must point at a committed immutable version');

    await db.update(ihInstallations).set({ status: 'Completed' }).where(
      eq(ihInstallations.id, installationId),
    );
    const completedGuard = await app.inject({
      method: 'POST',
      url: `/v1/installhub/installations/${installationId}/meters/${meterId}/history/rollback`,
      headers: auth(),
      payload: {
        targetRecordVersionNumber: historyBody.versions[0].recordVersionNumber,
        baseTreeRevision: rollbackResult.meterHistory.treeRevision,
        reason: 'Completed records must be reopened first',
        idempotencyKey: randomUUID(),
      },
    });
    assert.equal(completedGuard.statusCode, 409, completedGuard.body);
  } finally {
    await db.update(ihInstallations).set({ status: 'Draft' }).where(
      eq(ihInstallations.id, installationId),
    ).catch(() => undefined);
    await purgeInstallHubInstallationTree(installationId).catch(() => undefined);
    await app.close();
    await closeDb();
  }
});
