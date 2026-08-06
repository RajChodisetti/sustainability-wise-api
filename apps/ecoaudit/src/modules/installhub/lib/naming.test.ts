import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBoard,
  createInstallationTree,
  createSiteAsset,
  createZone,
} from '@/modules/installhub/lib/model';
import {
  availableZoneCode,
  defaultCustomNameForType,
  defaultMeterCustomName,
  generatedDisplayCodeV2,
  isZoneCodeAvailable,
  nameAfterTypeChange,
  normalizedCustomName,
  provisionalDisplayCodeV2,
  resolvedZoneCodes,
} from '@/modules/installhub/lib/naming';
import type { InstallHubUser } from '@/modules/installhub/types/domain';

test('meter names default from the selected device type and remain human-readable', () => {
  assert.equal(defaultMeterCustomName({ deviceModel: 'A3RM' }), 'A3RM Meter');
  assert.equal(defaultMeterCustomName({ deviceModel: 'A6M' }), 'A6M Meter');
  assert.equal(defaultMeterCustomName({ deviceModel: 'Other' }), 'Other Meter');
  assert.equal(defaultMeterCustomName({
    deviceModel: 'Other',
    customModelName: 'PowerScout 3037',
  }), 'PowerScout 3037');
});

const user: InstallHubUser = {
  id: 'user',
  email: 'inspector@example.com',
  fullName: 'Inspector',
  role: 'inspector',
};

function emptyTree() {
  return createInstallationTree({
    clientName: 'Client',
    siteName: 'Gold Coast',
    siteAddress: '',
    inspectorName: 'Inspector',
    auditDate: '2026-08-05',
  }, user);
}

test('zone codes are derived deterministically and disambiguated', () => {
  const tree = emptyTree();
  const second = createZone(tree.installation.id, { zoneName: 'Plant Room', zoneDescription: '' });
  const first = createZone(tree.installation.id, { zoneName: 'Plant Room', zoneDescription: '' });
  second.id = 'z2';
  first.id = 'z1';
  tree.zones = [second, first];
  const codes = resolvedZoneCodes(tree.zones);
  assert.equal(codes.get('z1'), 'PLANT-ROOM');
  assert.equal(codes.get('z2'), 'PLANT-ROOM-2');
  assert.equal(availableZoneCode(tree, 'Plant Room'), 'PLANT-ROOM-3');
  assert.equal(isZoneCodeAvailable(tree, 'PLANT-ROOM'), false);
  assert.equal(isZoneCodeAvailable(tree, 'ROOF'), true);
});

test('type defaults advance only while the editable custom name is pristine', () => {
  const options = [
    { code: 'DB', label: 'Distribution board' },
    { code: 'MSB', label: 'Main switchboard' },
  ];
  const previousDefault = defaultCustomNameForType(options, 'DB');
  const nextDefault = defaultCustomNameForType(options, 'MSB');
  assert.equal(
    nameAfterTypeChange(previousDefault, previousDefault, nextDefault),
    'Main switchboard',
  );
  assert.equal(
    nameAfterTypeChange('Workshop incomer', previousDefault, nextDefault),
    'Workshop incomer',
  );
});

test('v2 display codes share a two-digit zone sequence across entity kinds', () => {
  const tree = emptyTree();
  tree.installation.siteCode = 'GOLD';
  const zone = createZone(tree.installation.id, { zoneName: 'Level 1', zoneDescription: '' });
  zone.id = 'zone-1';
  zone.zoneCode = 'L1';
  tree.zones = [zone];
  const board = createBoard(tree.installation.id, zone.id);
  board.id = 'board-1';
  board.assetName = 'Main board';
  board.displayCode = 'GOLD-L1-01-MAIN-BOARD';
  tree.electricalAssets.push(board);
  const asset = createSiteAsset(tree.installation.id, zone.id);
  asset.id = 'asset-1';
  asset.assetName = 'Air handler';
  asset.displayCode = 'GOLD-L1-02-AIR-HANDLER';
  tree.siteAssets.push(asset);
  assert.equal(generatedDisplayCodeV2(tree, {
    zoneId: 'zone-1', customName: 'Distribution Board', fallbackType: 'DB',
  }), 'GOLD-L1-03-DISTRIBUTION-BOARD');
});

test('custom names are normalized and full generated codes are capped at 64 characters', () => {
  const tree = emptyTree();
  tree.installation.siteCode = 'INSTALLATION-CODE';
  const zone = createZone(tree.installation.id, { zoneName: 'Zone', zoneDescription: '' });
  zone.id = 'zone';
  zone.zoneCode = 'VERY-LONG-ZONE';
  tree.zones = [zone];
  const generated = generatedDisplayCodeV2(tree, {
    zoneId: 'zone', customName: 'Café air handling unit with a very long installer supplied description', fallbackType: 'HVAC',
  });
  assert.equal(normalizedCustomName('Café AHU', 'HVAC'), 'CAFE-AHU');
  assert.ok(generated.length <= 64);
  assert.match(generated, /^INSTALLATION-COD-VERY-LONG-ZONE-01-CAFE-AIR-HANDLING/);
});

test('full and quick add use the same provisional v2 naming rule', () => {
  const tree = emptyTree();
  tree.installation.siteCode = 'GOLD';
  const zone = createZone(tree.installation.id, {
    zoneName: 'Level 1',
    zoneDescription: '',
    zoneCode: 'L1',
  });
  tree.zones.push(zone);
  const full = provisionalDisplayCodeV2(tree, {
    zoneId: zone.id,
    customName: 'Distribution board',
    fallbackType: 'DB',
  });
  const quick = provisionalDisplayCodeV2(structuredClone(tree), {
    zoneId: zone.id,
    customName: 'Distribution board',
    fallbackType: 'DB',
  });
  assert.deepEqual(quick, full);
  assert.equal(full.ruleVersion, 2);
  assert.equal(full.provisional, true);
});

test('provisional name edits retain sequence while confirmed and rule-one codes stay frozen', () => {
  const tree = emptyTree();
  tree.installation.siteCode = 'GOLD';
  const zone = createZone(tree.installation.id, {
    zoneName: 'Level 1',
    zoneDescription: '',
    zoneCode: 'L1',
  });
  tree.zones.push(zone);
  const provisional = provisionalDisplayCodeV2(tree, {
    zoneId: zone.id,
    customName: 'Distribution board',
    fallbackType: 'DB',
  });
  const renamed = provisionalDisplayCodeV2(tree, {
    zoneId: zone.id,
    customName: 'Workshop incomer',
    fallbackType: 'DB',
    current: provisional,
  });
  assert.equal(renamed.value, 'GOLD-L1-01-WORKSHOP-INCOMER');

  for (const frozen of [
    { ...renamed, provisional: false },
    { ...renamed, provisional: undefined },
    { ...renamed, ruleVersion: 1 },
  ]) {
    assert.equal(provisionalDisplayCodeV2(tree, {
      zoneId: zone.id,
      customName: 'Changed again',
      fallbackType: 'DB',
      current: frozen,
    }), frozen);
  }
});
