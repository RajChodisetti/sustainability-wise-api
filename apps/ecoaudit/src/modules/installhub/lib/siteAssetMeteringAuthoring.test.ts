import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  new URL('../pages/SiteAssetPage.tsx', import.meta.url),
  'utf8',
);

test('site asset metering UI uses the canonical dependent availability rules', () => {
  assert.match(source, /label="What supplies this asset\?"/);
  assert.match(source, /label: 'Incoming grid connection'/);
  assert.match(source, /label: 'Switchboard'/);
  assert.match(source, /Supplying switchboard/);
  assert.match(source, /label="How is this asset metered\?"/);
  assert.match(source, /assetMeterAvailability\(tree, meter, draft\.id\)/);
  assert.match(source, /disabled: availability\.usableCount === 0/);
  assert.match(source, /assigned to this asset/);
  assert.match(source, /assigned to another asset/);
  assert.match(source, /protected/);
  assert.match(source, /not asset-compatible|incompatible/);
  assert.match(source, /preserveUnavailableMeterMapping/);
  assert.match(source, /draftSelectionStatus\.unavailable/);
  assert.match(source, /draftSelectionStatus\.missingChannelId/);
  assert.match(source, />Replace saved channel selection<\/Button>/);
});

test('meter, source, and phase changes clear stale channel projections', () => {
  assert.match(source, /function chooseMeter\([\s\S]*?meterChannelIds: \[\],[\s\S]*?meterChannels: \[\]/);
  assert.match(source, /function chooseSource\([\s\S]*?next\.meterChannelIds = \[\];[\s\S]*?next\.meterChannels = \[\]/);
  assert.match(source, /set\('phaseMode', value\);[\s\S]*?set\('meterChannelIds', \[\]\);[\s\S]*?set\('meterChannels', \[\]\)/);
});
