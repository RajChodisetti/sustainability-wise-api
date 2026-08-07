import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignmentApprovalSignature,
  assignmentCollectionConcurrencySignature,
  meterStructuralConcurrencySignature,
  nextMeterChannelId,
  renamedMeterCapabilities,
  showsWattwatchersCommissioningSections,
  unassignedChannelMessage,
} from '@/modules/installhub/lib/meterPresentation';
import type { MeasurementAssignment, Meter } from '@/modules/installhub/types/domain';
import { createMeter } from '@/modules/installhub/lib/model';

function assignment(
  id: string,
  channelIds: string[],
  target: MeasurementAssignment['target'] = { kind: 'TBC' },
): MeasurementAssignment {
  return {
    id,
    installationId: 'installation-1',
    meterId: 'meter-1',
    channelIds,
    phaseMode: 'OTHER',
    target,
    direction: 'CONSUMPTION',
    status: target.kind === 'TBC' ? 'TBC' : 'CONFIRMED',
  };
}

test('only Wattwatchers device models show Wattwatchers commissioning sections', () => {
  assert.equal(showsWattwatchersCommissioningSections('A3RM'), true);
  assert.equal(showsWattwatchersCommissioningSections('A6M'), true);
  assert.equal(showsWattwatchersCommissioningSections('Other'), false);
});

test('unassigned-channel guidance uses human channel ordinals, never raw IDs', () => {
  const firstId = '3de5f0c2-4766-4e9d-98bb-a41df1b820c8';
  const secondId = '74dd4a3c-6d4d-4e53-9d2a-1ee459fe583f';
  const message = unassignedChannelMessage([
    { id: firstId, ordinal: 1, purpose: 'SUB_CIRCUIT' },
    { id: secondId, ordinal: 2, purpose: 'MAIN_SUPPLY' },
  ], [firstId, secondId]);

  assert.match(message, /Channel 1 and Channel 2 are unresolved/);
  assert.doesNotMatch(message, /3de5f0c2|74dd4a3c/);
});

test('custom channel IDs remain unique after a middle channel is removed', () => {
  assert.equal(nextMeterChannelId('meter-1', [
    { id: 'meter-1:1' },
    { id: 'meter-1:3' },
  ]), 'meter-1:2');
  assert.equal(nextMeterChannelId('meter-1', [
    { id: 'meter-1:1' },
    { id: 'meter-1:2' },
    { id: 'meter-1:3' },
  ]), 'meter-1:4');
});

test('capability renames preserve data and reject blank or duplicate names', () => {
  const source = { current: '120A', protocol: 'Modbus' };
  assert.deepEqual(
    renamedMeterCapabilities(source, 'current', 'rated_current'),
    { capabilities: { protocol: 'Modbus', rated_current: '120A' } },
  );
  assert.match(
    renamedMeterCapabilities(source, 'current', ' ').error || '',
    /cannot be blank/,
  );
  assert.match(
    renamedMeterCapabilities(source, 'current', 'protocol').error || '',
    /already exists/,
  );
  assert.deepEqual(source, { current: '120A', protocol: 'Modbus' });
});

test('meter concurrency ignores evidence-only changes but rejects structural channel changes', () => {
  const source: Meter = {
    ...createMeter(),
    id: 'meter-1',
    deviceId: 'serial-1',
    deviceType: 'A3RM',
    wwChannels: [
      { id: 'channel-1', ordinal: 1, purpose: 'MAIN_SUPPLY' },
      { id: 'channel-2', ordinal: 2, purpose: 'SUB_CIRCUIT' },
    ],
    wwPhotos: { deviceInstalled: 'https://example.test/old.jpg', extra: [] },
  };
  assert.equal(
    meterStructuralConcurrencySignature(source),
    meterStructuralConcurrencySignature({
      ...source,
      wwPhotos: { deviceInstalled: 'https://example.test/new.jpg', extra: [] },
    }),
  );
  assert.notEqual(
    meterStructuralConcurrencySignature(source),
    meterStructuralConcurrencySignature({
      ...source,
      wwChannels: [...(source.wwChannels || [])].reverse(),
    }),
  );
});

test('assignment concurrency is order-insensitive but detects mapping changes', () => {
  const first = assignment('assignment-1', ['channel-2', 'channel-1']);
  const second = assignment('assignment-2', ['channel-3'], {
    kind: 'SITE_ASSET',
    siteAssetId: 'asset-1',
  });
  assert.equal(
    assignmentCollectionConcurrencySignature([first, second]),
    assignmentCollectionConcurrencySignature([
      { ...second },
      { ...first, channelIds: ['channel-1', 'channel-2'] },
    ]),
  );
  assert.notEqual(
    assignmentCollectionConcurrencySignature([first, second]),
    assignmentCollectionConcurrencySignature([
      first,
      { ...second, target: { kind: 'SITE_ASSET', siteAssetId: 'asset-2' } },
    ]),
  );
  assert.notEqual(
    assignmentApprovalSignature(second),
    assignmentApprovalSignature({ ...second, channelIds: ['channel-4'] }),
  );
});
