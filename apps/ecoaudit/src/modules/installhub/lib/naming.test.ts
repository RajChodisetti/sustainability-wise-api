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
  generatedDisplayCodeV3,
  isZoneCodeAvailable,
  nameAfterTypeChange,
  normalizedCustomName,
  provisionalDisplayCodeV3,
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

test('v3 display codes share a two-digit zone sequence across entity kinds', () => {
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
  assert.equal(generatedDisplayCodeV3(tree, {
    zoneId: 'zone-1',
    customName: 'Distribution Board',
    fallbackType: 'Distribution board',
    entityKind: 'board',
    entityTypeCode: 'DB',
  }), 'GOLD-L1-03-DB-DISTRIBUTION-BOARD');
});

test('v3 identities end boards with their name and include type plus name for assets and devices', () => {
  const tree = emptyTree();
  tree.installation.siteCode = 'GOLD';
  const zone = createZone(tree.installation.id, {
    zoneName: 'Level 1',
    zoneDescription: '',
    zoneCode: 'L1',
  });
  tree.zones.push(zone);

  assert.equal(generatedDisplayCodeV3(tree, {
    zoneId: zone.id,
    customName: 'Workshop incomer',
    fallbackType: 'Main switchboard',
    entityKind: 'board',
    entityTypeCode: 'MSB',
  }), 'GOLD-L1-01-MSB-WORKSHOP-INCOMER');
  assert.equal(generatedDisplayCodeV3(tree, {
    zoneId: zone.id,
    customName: 'Air handler 1',
    fallbackType: 'AC / HVAC',
    entityKind: 'site_asset',
    entityTypeCode: 'HVAC',
  }), 'GOLD-L1-01-HVAC-AIR-HANDLER-1');
  assert.equal(generatedDisplayCodeV3(tree, {
    zoneId: zone.id,
    customName: 'Main incomer',
    fallbackType: 'A3RM Meter',
    entityKind: 'meter',
    entityTypeCode: 'A3RM',
  }), 'GOLD-L1-01-A3RM-MAIN-INCOMER');
  assert.equal(generatedDisplayCodeV3(tree, {
    zoneId: zone.id,
    customName: 'A3RM Meter',
    fallbackType: 'A3RM Meter',
    entityKind: 'meter',
    entityTypeCode: 'A3RM',
  }), 'GOLD-L1-01-A3RM-METER');
});

test('custom names are normalized and full generated codes are capped at 64 characters', () => {
  const tree = emptyTree();
  tree.installation.siteCode = 'INSTALLATION-CODE';
  const zone = createZone(tree.installation.id, { zoneName: 'Zone', zoneDescription: '' });
  zone.id = 'zone';
  zone.zoneCode = 'VERY-LONG-ZONE';
  tree.zones = [zone];
  const generated = generatedDisplayCodeV3(tree, {
    zoneId: 'zone',
    customName: 'Café air handling unit with a very long installer supplied description',
    fallbackType: 'AC / HVAC',
    entityKind: 'site_asset',
    entityTypeCode: 'HVAC',
  });
  assert.equal(normalizedCustomName('Café AHU', 'HVAC'), 'CAFE-AHU');
  assert.ok(generated.length <= 64);
  assert.match(generated, /^INSTALLATION-COD-VERY-LONG-ZONE-01-HVAC-CAFE-AIR-HANDLING/);
});

test('full and quick add use the same provisional v3 naming rule', () => {
  const tree = emptyTree();
  tree.installation.siteCode = 'GOLD';
  const zone = createZone(tree.installation.id, {
    zoneName: 'Level 1',
    zoneDescription: '',
    zoneCode: 'L1',
  });
  tree.zones.push(zone);
  const full = provisionalDisplayCodeV3(tree, {
    zoneId: zone.id,
    customName: 'Distribution board',
    fallbackType: 'DB',
    entityKind: 'board',
    entityTypeCode: 'DB',
  });
  const quick = provisionalDisplayCodeV3(structuredClone(tree), {
    zoneId: zone.id,
    customName: 'Distribution board',
    fallbackType: 'DB',
    entityKind: 'board',
    entityTypeCode: 'DB',
  });
  assert.deepEqual(quick, full);
  assert.equal(full.ruleVersion, 4);
  assert.equal(full.provisional, true);
});

test('provisional name edits retain sequence and explicit board edits refresh generated v3/v4 identities', () => {
  const tree = emptyTree();
  tree.installation.siteCode = 'GOLD';
  const zone = createZone(tree.installation.id, {
    zoneName: 'Level 1',
    zoneDescription: '',
    zoneCode: 'L1',
  });
  tree.zones.push(zone);
  const provisional = provisionalDisplayCodeV3(tree, {
    zoneId: zone.id,
    customName: 'Distribution board',
    fallbackType: 'DB',
    entityKind: 'board',
    entityTypeCode: 'DB',
  });
  const renamed = provisionalDisplayCodeV3(tree, {
    zoneId: zone.id,
    customName: 'Workshop incomer',
    fallbackType: 'DB',
    entityKind: 'board',
    entityTypeCode: 'DB',
    current: provisional,
  });
  assert.equal(renamed.value, 'GOLD-L1-01-DB-WORKSHOP-INCOMER');

  for (const frozen of [
    { ...renamed, provisional: false },
    { ...renamed, provisional: undefined },
    { ...renamed, provisional: false, ruleVersion: 1 },
    { ...renamed, provisional: false, ruleVersion: 2 },
  ]) {
    assert.equal(provisionalDisplayCodeV3(tree, {
      zoneId: zone.id,
      customName: 'Changed again',
      fallbackType: 'DB',
      entityKind: 'board',
      entityTypeCode: 'DB',
      current: frozen,
    }), frozen);
  }

  const historicalRuleThree = {
    value: 'GOLD-L1-01-WORKSHOP-INCOMER',
    generatedValue: 'GOLD-L1-01-WORKSHOP-INCOMER',
    isOverridden: false,
    ruleVersion: 3,
    provisional: false,
  };
  const refreshed = provisionalDisplayCodeV3(tree, {
    zoneId: zone.id,
    customName: 'Changed again',
    fallbackType: 'DB',
    entityKind: 'board',
    entityTypeCode: 'DB',
    current: historicalRuleThree,
    refreshConfirmedGenerated: true,
  });
  assert.equal(refreshed.value, 'GOLD-L1-01-DB-CHANGED-AGAIN');
  assert.equal(refreshed.ruleVersion, 4);
  assert.equal(refreshed.provisional, true);

  const refreshedAgain = provisionalDisplayCodeV3(tree, {
    zoneId: zone.id,
    customName: 'Main board',
    fallbackType: 'MSB',
    entityKind: 'board',
    entityTypeCode: 'MSB',
    current: { ...refreshed, provisional: false },
    refreshConfirmedGenerated: true,
  });
  assert.equal(refreshedAgain.value, 'GOLD-L1-01-MSB-MAIN-BOARD');
  assert.equal(refreshedAgain.ruleVersion, 4);

  const legacy = { ...renamed, provisional: false, ruleVersion: 2 };
  assert.equal(provisionalDisplayCodeV3(tree, {
    zoneId: zone.id,
    customName: 'Legacy stays fixed',
    fallbackType: 'DB',
    entityKind: 'board',
    entityTypeCode: 'DB',
    current: legacy,
    refreshConfirmedGenerated: true,
  }), legacy);

  const upgraded = provisionalDisplayCodeV3(tree, {
    zoneId: zone.id,
    customName: 'Air handler 1',
    fallbackType: 'AC / HVAC',
    entityKind: 'site_asset',
    entityTypeCode: 'HVAC',
    current: { ...renamed, ruleVersion: 2, provisional: true },
  });
  assert.equal(upgraded.value, 'GOLD-L1-01-HVAC-AIR-HANDLER-1');
  assert.equal(upgraded.ruleVersion, 4);
});
