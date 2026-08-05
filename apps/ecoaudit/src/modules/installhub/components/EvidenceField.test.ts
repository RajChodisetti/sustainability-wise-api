import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceActionLabel } from '@/modules/installhub/components/EvidenceField';

test('multi-photo evidence action makes adding another photo explicit', () => {
  assert.equal(evidenceActionLabel(0), 'Take or choose photos');
  assert.equal(evidenceActionLabel(1), 'Add more photos');
  assert.equal(evidenceActionLabel(4), 'Add more photos');
  assert.equal(evidenceActionLabel(1, true), 'Uploading…');
});
