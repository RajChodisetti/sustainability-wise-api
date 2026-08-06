import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nextMeterChannelId,
  renamedMeterCapabilities,
  showsWattwatchersCommissioningSections,
  unassignedChannelMessage,
} from '@/modules/installhub/lib/meterPresentation';

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
