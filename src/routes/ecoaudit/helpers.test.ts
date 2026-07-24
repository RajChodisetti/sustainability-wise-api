import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAuditOwnerPatchMutable } from './helpers.js';

test('completed EcoAudit owners allow a canonical photoDescs-only patch', () => {
  assert.doesNotThrow(() => assertAuditOwnerPatchMutable(
    { status: 'Completed' },
    { photoDescs: { photo: { name: 'Updated caption', largeInPdf: true } } },
    'Audit',
  ));
});

test('completed EcoAudit owners reject empty, mixed, legacy, and business-field patches', () => {
  const rejectedBodies = [
    {},
    { photoDescs: { photo: { name: 'Updated caption' } }, comments: 'Changed comment' },
    { photo_descs: { photo: { name: 'Legacy field' } } },
    { comments: 'Changed comment' },
  ];

  for (const body of rejectedBodies) {
    assert.throws(
      () => assertAuditOwnerPatchMutable({ status: 'Completed' }, body, 'Audit'),
      (error: unknown) => (
        error instanceof Error
        && 'statusCode' in error
        && error.statusCode === 400
        && 'detail' in error
        && error.detail === 'Audit is completed. Copy the top-level audit to make changes.'
      ),
    );
  }
});

test('draft EcoAudit owners retain existing PATCH behavior', () => {
  assert.doesNotThrow(() => assertAuditOwnerPatchMutable(
    { status: 'Draft' },
    { comments: 'Normal draft edit' },
    'Audit',
  ));
});
