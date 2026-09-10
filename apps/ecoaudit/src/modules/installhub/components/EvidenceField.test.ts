import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  evidenceActionLabel,
  evidenceRenderKey,
  type EvidenceItem,
} from '@/modules/installhub/components/EvidenceField';

const evidenceFieldSource = readFileSync(
  new URL('./EvidenceField.tsx', import.meta.url),
  'utf8',
);

test('multi-photo evidence action makes adding another photo explicit', () => {
  assert.equal(evidenceActionLabel(0), 'Take or choose photos');
  assert.equal(evidenceActionLabel(1), 'Add more photos');
  assert.equal(evidenceActionLabel(4), 'Add more photos');
  assert.equal(evidenceActionLabel(1, true), 'Uploading…');
});

test('single-photo evidence action distinguishes replacement from adding another photo', () => {
  assert.equal(evidenceActionLabel(0, false, false), 'Take or choose photo');
  assert.equal(evidenceActionLabel(1, false, false), 'Replace photo');
  assert.equal(evidenceActionLabel(1, true, false), 'Uploading…');
});

test('every opted-in evidence card exposes the requested PDF sizing choice', () => {
  assert.match(evidenceFieldSource, /label="Show large in PDF"/);
  assert.match(evidenceFieldSource, /checked=\{item\.largeInPdf === true\}/);
  assert.match(evidenceFieldSource, /multiple=\{multiple\}/);
});

test('photo cards keep stable image identity when callback indexes rekey after deletion', () => {
  const first: EvidenceItem = { id: '0', uri: '/photos/photo-a.jpg', caption: 'Photo A' };
  const survivorBeforeDelete: EvidenceItem = {
    id: '1',
    uri: '/photos/photo-b.jpg',
    caption: 'Photo B',
  };
  const survivorAfterDelete: EvidenceItem = {
    ...survivorBeforeDelete,
    id: '0',
  };

  assert.notEqual(evidenceRenderKey(first), evidenceRenderKey(survivorAfterDelete));
  assert.equal(
    evidenceRenderKey(survivorBeforeDelete),
    evidenceRenderKey(survivorAfterDelete),
  );
  assert.equal(survivorAfterDelete.id, '0');
  assert.equal(survivorAfterDelete.caption, 'Photo B');
  assert.match(evidenceFieldSource, /key=\{evidenceRenderKey\(item\)\}/);
});
