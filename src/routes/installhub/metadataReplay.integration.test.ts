import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { CanonicalInstallationTree, DisplayCode } from './canonical.js';

const integrationDatabase = process.env.INSTALLHUB_PG_INTEGRATION_URL;

test('metadata replays generated identities without advancing revision, claims or history and rejects stale edits', {
  skip: !integrationDatabase,
}, async () => {
  const [
    { buildApp }, { db, closeDb }, { signAccessToken }, { eq, and },
    { ihDisplayCodeClaims, ihMeterHistoryEvents, ihElectricalAssets }, { recordVersions },
    { loadCanonicalInstallationTree }, { purgeInstallHubInstallationTree },
  ] = await Promise.all([
    import('../../app.js'), import('../../db/client.js'), import('../../auth/jwt.js'), import('drizzle-orm'),
    import('../../db/schema/installhub.js'), import('../../db/schema/shared.js'),
    import('./treeService.js'), import('./purge.js'),
  ]);
  const app = await buildApp();
  const installationId = randomUUID();
  const actorId = randomUUID();
  const token = signAccessToken({ userId: actorId, app: 'installhub', role: 'inspector' });
  const ids = Object.fromEntries(['grid', 'zone', 'zone2', 'board', 'board2', 'asset', 'meter', 'assignment', 'form', 'commsMeter', 'commsForm', 'overrideBoard', 'legacyBoard']
    .map((kind) => [kind, `${kind}-${installationId}`]));
  const provisional = (value: string): DisplayCode => ({
    value, generatedValue: value, isOverridden: false, ruleVersion: 2, provisional: true,
  });
  const initial: CanonicalInstallationTree = {
    treeSchemaVersion: 2,
    installation: {
      id: installationId, externalKey: `ih_${installationId}`, siteCode: 'REPLAY', timezone: 'Australia/Sydney',
      clientName: `Replay client ${installationId}`, siteName: `Replay site ${installationId}`,
      siteAddress: '1 Test Street', inspectorName: 'Replay Inspector', auditDate: '2026-09-05',
      status: 'Draft', treeSchemaVersion: 2, treeRevision: 0, recordVersionNumber: 0,
    },
    gridSupplies: [{ id: ids.grid, installationId, name: 'Grid', isDefault: true }],
    zones: [ids.zone, ids.zone2].map((id, index) => ({ id, installationId, zoneCode: `Z${index + 1}`, zoneName: `Room ${index + 1}`, zoneDescription: '', photos: [] })),
    electricalAssets: [ids.board, ids.board2].map((id, index) => ({
      id, installationId, zoneId: index === 0 ? ids.zone : ids.zone2, assetName: `Board ${index + 1}`,
      typeCode: 'MSB', displayCode: provisional(`PROVISIONAL-BOARD-${index + 1}`),
      electricalSource: { kind: 'GRID', gridSupplyId: ids.grid }, extraPhotos: [], meterPresent: false,
    })),
    siteAssets: [], meterDevices: [], measurementAssignments: [],
    formSubmissions: [{
      id: ids.form, installationId, formType: 'captis-logger', schemaVersion: 2,
      status: 'Draft', zoneId: ids.zone, boardId: ids.board, historicalMeterRemoved: false,
      answers: { 'captis.supply_description': 'Retained original capture' }, attachments: [],
    }],
    serverDerived: { virtualMeterDefinitions: [] },
  };
  const push = (payload: object, auth = token) => app.inject({
    method: 'POST', url: '/v1/installhub/sync/push', headers: { authorization: `Bearer ${auth}` }, payload,
  });
  const pull = async () => {
    const value = await loadCanonicalInstallationTree(installationId);
    assert.ok(value);
    return value;
  };
  const state = async () => ({
    tree: await pull(),
    claims: await db.select().from(ihDisplayCodeClaims).where(eq(ihDisplayCodeClaims.installationId, installationId)),
    versions: await db.select().from(recordVersions).where(eq(recordVersions.entityId, installationId)),
    history: await db.select().from(ihMeterHistoryEvents).where(eq(ihMeterHistoryEvents.installationId, installationId)),
  });
  try {
    const created = await push({ ...initial, baseTreeRevision: 0, syncStage: 'metadata' });
    assert.equal(created.statusCode, 200, created.body);
    const first = await pull();
    first.formSubmissions[0].status = 'Completed';
    first.formSubmissions[0].completedAt = '2026-09-05T00:00:00.000Z';
    const completedForm = await push({ ...first, baseTreeRevision: first.installation.treeRevision, syncStage: 'complete' });
    assert.equal(completedForm.statusCode, 200, completedForm.body);
    const base = await pull();
    const incoming = structuredClone(base);
    incoming.formSubmissions[0].status = 'Draft';
    incoming.formSubmissions[0].completedAt = null;
    incoming.siteAssets = [{
      id: ids.asset, installationId, zoneId: ids.zone, assetName: 'Ventilation load', typeCode: 'HVAC',
      displayCode: provisional('REPLAY-Z1-58-VENTILATION-LOAD'),
      electricalSource: { kind: 'BOARD', boardId: ids.board },
      meteringState: { kind: 'METERED', measurementAssignmentIds: [ids.assignment] }, meterPresent: true, extraPhotos: [],
    }];
    incoming.meterDevices = [{
      id: ids.meter, installationId, installedOnBoardId: ids.board, customName: 'Electrical meter',
      deviceFamily: 'OTHER', deviceModel: 'OTHER', customManufacturerName: 'Synthetic', customModelName: 'Test',
      serialNumber: 'SYNTHETIC-REPLAY-ORIGINAL', displayName: provisional('REPLAY-Z1-59-ELECTRICAL-METER'),
      channels: [{ id: `${ids.meter}:1`, ordinal: 1, phaseLabel: 'L1', purpose: 'SUB_CIRCUIT', capabilities: { enabled: true, ratingA: 100 } }],
      wwPhotos: {},
    }];
    incoming.measurementAssignments = [{
      id: ids.assignment, installationId, meterId: ids.meter, channelIds: [`${ids.meter}:1`],
      phaseMode: 'SINGLE_PHASE', target: { kind: 'SITE_ASSET', siteAssetId: ids.asset }, direction: 'CONSUMPTION', status: 'CONFIRMED',
    }];
    const frozen = { ...incoming, baseTreeRevision: base.installation.treeRevision, syncStage: 'metadata' };
    const originalBody = JSON.stringify(frozen);
    const accepted = await push(frozen);
    assert.equal(accepted.statusCode, 200, accepted.body);
    const beforeReplay = await state();
    assert.equal(beforeReplay.tree.installation.treeRevision, base.installation.treeRevision + 1);
    assert.equal(beforeReplay.tree.formSubmissions[0].status, 'Completed', 'metadata restores unchanged completed forms before comparison');
    assert.equal(beforeReplay.versions.length, 1, 'metadata adds no immutable version');
    assert.equal(beforeReplay.history.length, 0);
    const replay = await push(JSON.parse(originalBody));
    assert.equal(replay.statusCode, 200, replay.body);
    assert.equal(replay.json().treeRevision, accepted.json().treeRevision);
    assert.equal(replay.json().recordVersionNumber, accepted.json().recordVersionNumber);
    assert.deepEqual(await state(), beforeReplay, 'no-op must not write revisions, claims, timestamps or history');
    const replayMeter = replay.json().displayCodeReconciliations.find((item: { entityId: string }) => item.entityId === ids.meter);
    assert.deepEqual(replayMeter.displayCode, beforeReplay.tree.meterDevices[0].displayName, 'replay acknowledgement returns authoritative display identity');

    const mutations: Array<[string, (tree: typeof frozen) => void]> = [
      ['board name', (tree) => { tree.electricalAssets[0].assetName = 'Different board'; }],
      ['asset name', (tree) => { tree.siteAssets[0].assetName = 'Different asset'; }],
      ['asset type', (tree) => { tree.siteAssets[0].typeCode = 'LIGHTING'; }],
      ['asset zone', (tree) => { tree.siteAssets[0].zoneId = ids.zone2; }],
      ['meter name', (tree) => { tree.meterDevices[0].customName = 'Different meter'; }],
      ['meter model', (tree) => { tree.meterDevices[0].customModelName = 'Different model'; }],
      ['meter placement', (tree) => { tree.meterDevices[0].installedOnBoardId = ids.board2; }],
      ['channel', (tree) => { tree.meterDevices[0].channels[0].description = 'Changed channel'; }],
      ['capability', (tree) => { tree.meterDevices[0].channels[0].capabilities = { enabled: false, ratingA: 100 }; }],
      ['answer', (tree) => { tree.formSubmissions[0].answers['captis.supply_description'] = 'Changed capture'; }],
      ['assignment', (tree) => { tree.measurementAssignments[0].direction = 'GENERATION'; }],
      ['removed children', (tree) => { tree.siteAssets = []; tree.measurementAssignments = []; }],
      ['override', (tree) => { tree.siteAssets[0].displayCode.isOverridden = true; tree.siteAssets[0].displayCode.value = 'EXPLICIT-OVERRIDE'; }],
    ];
    for (const [label, mutate] of mutations) {
      const changed = JSON.parse(originalBody) as typeof frozen;
      mutate(changed);
      const rejected = await push(changed);
      assert.equal(rejected.statusCode, 409, `${label}: ${rejected.body}`);
      assert.match(rejected.body, /snapshot_conflict/, label);
      assert.deepEqual(await state(), beforeReplay, label);
    }

    // Native preserved overrides and the portal's legacy serializer are also
    // accepted inputs: allocation changes their rule/marker metadata even when
    // their original body did not use the latest generated provisional shape.
    let compatibilityBaseline = beforeReplay;
    for (const kind of ['override', 'legacy'] as const) {
      const candidate = structuredClone(compatibilityBaseline.tree);
      const id = kind === 'override' ? ids.overrideBoard : ids.legacyBoard;
      candidate.electricalAssets.push({
        ...structuredClone(candidate.electricalAssets[0]), id, assetName: `${kind} captured board`,
        displayCode: kind === 'override'
          ? { value: 'INSTALLER-CUSTOM-BOARD', generatedValue: 'PREVIOUS-GENERATED-BOARD', isOverridden: true,
              ruleVersion: 1, provisional: true, overrideReason: 'Installer custom code' }
          : { value: 'LEGACY-MSB-001', generatedValue: 'LEGACY-MSB-001', isOverridden: false, ruleVersion: 1 },
      });
      const body = { ...candidate, baseTreeRevision: candidate.installation.treeRevision, syncStage: 'metadata' };
      const serialized = JSON.stringify(body);
      const acceptedCompatibility = await push(JSON.parse(serialized));
      assert.equal(acceptedCompatibility.statusCode, 200, `${kind}: ${acceptedCompatibility.body}`);
      const retained = await state();
      assert.equal(retained.tree.installation.treeRevision, candidate.installation.treeRevision + 1);
      const replayCompatibility = await push(JSON.parse(serialized));
      assert.equal(replayCompatibility.statusCode, 200, `${kind}: ${replayCompatibility.body}`);
      assert.equal(replayCompatibility.json().treeRevision, acceptedCompatibility.json().treeRevision);
      assert.equal(replayCompatibility.json().recordVersionNumber, acceptedCompatibility.json().recordVersionNumber);
      assert.deepEqual(await state(), retained, `${kind}: exact replay must leave every stored row unchanged`);
      const authoritativeDisplay = retained.tree.electricalAssets.find((board) => board.id === id)!.displayCode;
      assert.deepEqual(replayCompatibility.json().displayCodeReconciliations.find((item: { entityId: string }) => item.entityId === id).displayCode,
        authoritativeDisplay, `${kind}: canonical acknowledgement`);
      const changes: Array<[string, (tree: typeof body) => void]> = [
        ['business name', (tree) => { tree.electricalAssets.find((board) => board.id === id)!.assetName = 'Changed board'; }],
        ['custom value', (tree) => {
          const display = tree.electricalAssets.find((board) => board.id === id)!.displayCode;
          display.isOverridden = true; display.value = 'NEW-CUSTOM-BOARD';
        }],
        ['reason', (tree) => { tree.electricalAssets.find((board) => board.id === id)!.displayCode.overrideReason = 'Changed reason'; }],
      ];
      if (kind === 'override') changes.push(['generated value', (tree) => {
        tree.electricalAssets.find((board) => board.id === id)!.displayCode.generatedValue = 'CHANGED-GENERATED';
      }]);
      else changes.push(['current-rule generated value', (tree) => {
        const board = tree.electricalAssets.find((item) => item.id === id)!;
        board.displayCode = { ...authoritativeDisplay, value: 'CHANGED-GENERATED', generatedValue: 'CHANGED-GENERATED' };
      }]);
      for (const [label, mutate] of changes) {
        const changed = JSON.parse(serialized) as typeof body;
        mutate(changed);
        const rejected = await push(changed);
        assert.equal(rejected.statusCode, 409, `${kind} ${label}: ${rejected.body}`);
        assert.match(rejected.body, /snapshot_conflict/, `${kind} ${label}`);
        assert.deepEqual(await state(), retained, `${kind} ${label}`);
      }
      compatibilityBaseline = retained;
    }

    // Seed only this test's existing board/claim as each supported historical
    // claim version. Old claims remain valid immutable identities; legacy
    // serializers need not have a rule older than the retained claim itself.
    for (const [claimedRule, submittedRule] of [[1, 3], [2, 1], [3, 2]]) {
      await db.transaction(async (tx) => {
        await tx.update(ihElectricalAssets).set({ displayCodeRuleVersion: claimedRule }).where(and(
          eq(ihElectricalAssets.installationId, installationId), eq(ihElectricalAssets.id, ids.legacyBoard),
        ));
        await tx.update(ihDisplayCodeClaims).set({ ruleVersion: claimedRule }).where(and(
          eq(ihDisplayCodeClaims.installationId, installationId),
          eq(ihDisplayCodeClaims.entityType, 'board'), eq(ihDisplayCodeClaims.entityId, ids.legacyBoard),
        ));
      });
      const candidate = await pull();
      candidate.installation.jobComments = `Captured against retained rule ${claimedRule}`;
      candidate.electricalAssets.find((board) => board.id === ids.legacyBoard)!.displayCode = {
        value: `LEGACY-REGENERATED-${submittedRule}`, generatedValue: `LEGACY-REGENERATED-${submittedRule}`,
        isOverridden: false, ruleVersion: submittedRule,
      };
      const serialized = JSON.stringify({ ...candidate, baseTreeRevision: candidate.installation.treeRevision, syncStage: 'metadata' });
      const acceptedLegacy = await push(JSON.parse(serialized));
      assert.equal(acceptedLegacy.statusCode, 200, acceptedLegacy.body);
      const retained = await state();
      assert.equal(retained.tree.electricalAssets.find((board) => board.id === ids.legacyBoard)!.displayCode.ruleVersion, claimedRule);
      assert.equal(retained.tree.installation.treeRevision, candidate.installation.treeRevision + 1);
      const replayLegacy = await push(JSON.parse(serialized));
      assert.equal(replayLegacy.statusCode, 200, `retained rule ${claimedRule}: ${replayLegacy.body}`);
      assert.equal(replayLegacy.json().treeRevision, acceptedLegacy.json().treeRevision);
      assert.equal(replayLegacy.json().recordVersionNumber, acceptedLegacy.json().recordVersionNumber);
      assert.deepEqual(await state(), retained, `retained rule ${claimedRule}: no stored change`);
      for (const change of ['business', 'current-rule-display']) {
        const changed = JSON.parse(serialized) as typeof candidate & { baseTreeRevision: number; syncStage: string };
        if (change === 'business') changed.installation.jobComments = 'Different capture';
        else changed.electricalAssets.find((board) => board.id === ids.legacyBoard)!.displayCode.ruleVersion = 4;
        const rejected = await push(changed);
        assert.equal(rejected.statusCode, 409, `retained rule ${claimedRule} ${change}: ${rejected.body}`);
        assert.match(rejected.body, /snapshot_conflict/);
        assert.deepEqual(await state(), retained);
      }
      compatibilityBaseline = retained;
    }

    // Also exercise the original offline-new-meter bug through the real route:
    // no WW form is required and no replacement may be applied by this Draft.
    const next = structuredClone(compatibilityBaseline.tree);
    next.meterDevices.push({
      id: ids.commsMeter, installationId, installedOnBoardId: ids.board, customName: 'Comms original',
      deviceFamily: 'WATTWATCHERS', deviceModel: 'A3RM', deviceNumber: 'ORIGINAL-TAG', serialNumber: 'ORIGINAL-SERIAL',
      displayName: provisional('OFFLINE-COMMS-METER'), wwPhotos: {},
      channels: [1, 2, 3].map((ordinal) => ({ id: `${ids.commsMeter}:${ordinal}`, ordinal, purpose: 'SPARE' })),
    });
    next.formSubmissions.push({
      id: ids.commsForm, installationId, formType: 'comms-fault', schemaVersion: 2, status: 'Draft',
      zoneId: ids.zone, boardId: ids.board, meterId: ids.commsMeter, historicalMeterRemoved: false,
      answers: { 'existing.device_type': 'A3RM', 'existing.device_id': 'ORIGINAL-SERIAL', 'existing.device_number': 'ORIGINAL-TAG',
        'works.replace_device': 'yes', 'works.new_device_type': 'A6M', 'works.new_device_id': 'REPLACEMENT-SERIAL',
        'works.new_device_number': 'REPLACEMENT-TAG', 'works.new_sensor_rating': 'CT-400A' }, attachments: [],
    });
    const staged = await push({ ...next, baseTreeRevision: next.installation.treeRevision, syncStage: 'metadata' });
    assert.equal(staged.statusCode, 200, staged.body);
    const afterNewMeter = await state();
    const original = afterNewMeter.tree.meterDevices.find((item) => item.id === ids.commsMeter)!;
    assert.equal(original.deviceModel, 'A3RM');
    assert.equal(original.serialNumber, 'ORIGINAL-SERIAL');
    assert.equal(original.deviceNumber, 'ORIGINAL-TAG');
    assert.equal(original.channels.length, 3);
    assert.equal(afterNewMeter.versions.length, 1);
    assert.equal(afterNewMeter.history.length, 0);
    const invalidComplete = structuredClone(afterNewMeter.tree);
    invalidComplete.formSubmissions.find((item) => item.id === ids.commsForm)!.status = 'Completed';
    const rejectedComplete = await push({ ...invalidComplete, baseTreeRevision: invalidComplete.installation.treeRevision, syncStage: 'complete' });
    assert.equal(rejectedComplete.statusCode, 400, rejectedComplete.body);
    assert.match(rejectedComplete.body, /comms_replacement_state_mismatch/);
    assert.deepEqual(await state(), afterNewMeter);
  } finally {
    await purgeInstallHubInstallationTree(installationId).catch(() => undefined);
    await app.close();
    await closeDb();
  }
});
