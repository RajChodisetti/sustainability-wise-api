import assert from 'node:assert/strict';
import test from 'node:test';
import { unassignedChannelMessage } from '@/modules/installhub/lib/meterPresentation';

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
