import assert from 'node:assert/strict';
import test from 'node:test';
import type { PhotoRow } from './photoCopyReferences.js';

process.env.DATABASE_URL ??= 'postgres://test:test@127.0.0.1:5432/test';
process.env.JWT_SECRET ??= 'photo-copy-reference-test-secret';
process.env.JWT_REFRESH_SECRET ??= 'photo-copy-reference-refresh-test-secret';

const {
  buildPhotoCopyReferenceRows,
  collectImmutablePhotoIds,
  ecoPhotoFieldReferences,
  ecoPhotoValues,
  actorCanAccessPhotoParent,
  genericPhotoCandidateIsAuthorized,
  planPhotoCopyReferenceReconciliation,
  projectPhotosToCurrentReferences,
  solarAssessmentPhotoValues,
  solarAssessmentPhotoFieldReferences,
  solarSitePhotoFieldReferences,
  installHubElectricalPhotoFieldReferences,
  installHubFormPhotoFieldReferences,
  installHubSiteAssetPhotoFieldReferences,
  installHubZonePhotoFieldReferences,
} = await import('./photoCopyReferences.js');

const PHOTO_A = '11111111-1111-4111-8111-111111111111';
const PHOTO_B = '22222222-2222-4222-8222-222222222222';
const PHOTO_C = '33333333-3333-4333-8333-333333333333';
const PHOTO_D = '44444444-4444-4444-8444-444444444444';

function photo(overrides: Partial<PhotoRow> & Pick<PhotoRow, 'id'>): PhotoRow {
  const { id, ...rest } = overrides;
  return {
    id,
    checksum: 'abc',
    remoteUrl: `https://api.test/v1/files/ecoaudit/source/photo-${overrides.id}.jpg`,
    onedriveItemId: null,
    storageKey: `ecoaudit/source/photo-${overrides.id}.jpg`,
    contentType: 'image/jpeg',
    originalFilename: 'photo.jpg',
    app: 'ecoaudit',
    parentId: 'source-parent',
    entityType: 'zone',
    entityId: 'source-entity',
    fieldName: 'photos_0',
    fileSizeBytes: 100,
    status: 'confirmed',
    baseTreeRevision: null,
    confirmedTreeRevision: null,
    uploadedAt: new Date('2026-01-01T00:00:00Z'),
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...rest,
  };
}

test('collectImmutablePhotoIds finds nested immutable ids case-insensitively', () => {
  const ids = collectImmutablePhotoIds({
    direct: `/v1/files/ecoaudit/source/photo-${PHOTO_A.toUpperCase()}.jpg`,
    nested: [{ photoUri: `solarsense/source/photo-${PHOTO_B}.webp` }],
  });
  assert.deepEqual([...ids].sort(), [PHOTO_A, PHOTO_B]);
});

test('photo field extractors include the canonical lighting controls photo but not notes', () => {
  const ecoRecord = {
    photo: `/v1/files/photo-${PHOTO_A}.jpg`,
    extraPhotos: [`/v1/files/photo-${PHOTO_B}.jpg`],
    switchboardControlsPhoto: `/v1/files/photo-${PHOTO_C}.jpg`,
    comments: `unrelated ${PHOTO_D}`,
  };
  const ecoIds = collectImmutablePhotoIds(ecoPhotoValues(ecoRecord));
  assert.deepEqual([...ecoIds].sort(), [PHOTO_A, PHOTO_B, PHOTO_C]);
  assert.deepEqual(
    ecoPhotoFieldReferences(ecoRecord).filter((reference) => reference.photoId === PHOTO_C),
    [{ photoId: PHOTO_C, targetFieldName: 'switchboardControlsPhoto' }],
  );

  const solarIds = collectImmutablePhotoIds(solarAssessmentPhotoValues({
    switchboards: [{ photoUri: `/v1/files/photo-${PHOTO_A}.jpg` }],
    otherConsiderations: [{ photoUris: [`/v1/files/photo-${PHOTO_B}.jpg`] }],
    additionalPhotos: [`/v1/files/photo-${PHOTO_C}.jpg`],
    keyAssumptionsGaps: `unrelated ${PHOTO_C}`,
  }));
  assert.deepEqual([...solarIds].sort(), [PHOTO_A, PHOTO_B, PHOTO_C]);
});

test('InstallHub copy references cover zones, boards, nested meters, site assets and forms', () => {
  assert.deepEqual(installHubZonePhotoFieldReferences({
    photos: [`/v1/files/photo-${PHOTO_A}.jpg`],
  }), [{ photoId: PHOTO_A, targetFieldName: 'photos[0]' }]);
  assert.deepEqual(installHubElectricalPhotoFieldReferences({
    photo: `/v1/files/photo-${PHOTO_A}.jpg`,
    extraPhotos: [`/v1/files/photo-${PHOTO_B}.jpg`],
    meters: [{
      wwPhotos: {
        deviceInstalled: `/v1/files/photo-${PHOTO_C}.jpg`,
        extra: [`/v1/files/photo-${PHOTO_D}.jpg`],
      },
    }],
  }), [
    { photoId: PHOTO_A, targetFieldName: 'photo' },
    { photoId: PHOTO_B, targetFieldName: 'extraPhotos[0]' },
    { photoId: PHOTO_C, targetFieldName: 'meters[0].wwPhotos.deviceInstalled' },
    { photoId: PHOTO_D, targetFieldName: 'meters[0].wwPhotos.extra[0]' },
  ]);
  assert.deepEqual(installHubSiteAssetPhotoFieldReferences({
    locationPhoto: `/v1/files/photo-${PHOTO_A}.jpg`,
    extraPhotos: [`/v1/files/photo-${PHOTO_B}.jpg`],
  }), [
    { photoId: PHOTO_A, targetFieldName: 'locationPhoto' },
    { photoId: PHOTO_B, targetFieldName: 'extraPhotos[0]' },
  ]);
  assert.deepEqual(installHubFormPhotoFieldReferences({
    attachments: [{ uri: `/v1/files/photo-${PHOTO_C}.jpg` }],
  }), [{ photoId: PHOTO_C, targetFieldName: 'attachments[0].uri' }]);
});

test('InstallHub reindexing creates a same-parent alias without duplicating an exact direct identity', () => {
  const installationId = 'installation-1';
  const formId = 'form-1';
  const direct = photo({
    id: PHOTO_A,
    app: 'installhub',
    parentId: installationId,
    entityType: 'form_submission',
    entityId: formId,
    fieldName: 'attachments[0].uri',
  });
  const shifted = photo({
    id: PHOTO_B,
    app: 'installhub',
    parentId: installationId,
    entityType: 'form_submission',
    entityId: formId,
    fieldName: 'attachments[1].uri',
  });
  const rows = buildPhotoCopyReferenceRows({
    app: 'installhub',
    targetParentId: installationId,
    entities: [{
      sourceEntityId: formId,
      targetEntityId: formId,
      targetEntityType: 'form_submission',
      photoValues: [],
      photoReferences: [
        { photoId: PHOTO_A, targetFieldName: 'attachments[0].uri' },
        { photoId: PHOTO_B, targetFieldName: 'attachments[0].uri' },
      ],
    }],
    photos: [direct, shifted],
    allowUnconfirmed: true,
  });

  assert.deepEqual(rows.map((row) => ({
    photoId: row.photoId,
    targetFieldName: row.targetFieldName,
  })), [{
    photoId: PHOTO_B,
    targetFieldName: 'attachments[0].uri',
  }]);
});

test('InstallHub middle-photo removal preserves the shifted photo identity', () => {
  const references = installHubFormPhotoFieldReferences({
    attachments: [
      {
        id: 'attachment-b',
        slot: 'water.completed_photo',
        uri: `/v1/files/installhub/installation-1/photo-${PHOTO_B}.jpg`,
        caption: 'Completed installation',
      },
    ],
  });
  assert.deepEqual(references, [{
    photoId: PHOTO_B,
    targetFieldName: 'attachments[0].uri',
  }]);

  const desired = buildPhotoCopyReferenceRows({
    app: 'installhub',
    targetParentId: 'installation-1',
    entities: [{
      sourceEntityId: 'form-1',
      targetEntityId: 'form-1',
      targetEntityType: 'form_submission',
      photoValues: [],
      photoReferences: references,
    }],
    photos: [photo({
      id: PHOTO_B,
      app: 'installhub',
      parentId: 'installation-1',
      entityType: 'form_submission',
      entityId: 'form-1',
      fieldName: 'attachments[1].uri',
    })],
    allowUnconfirmed: true,
  });
  const settled = [{
    ...desired[0],
    id: 'existing-alias',
    createdAt: new Date('2026-07-26T00:00:00Z'),
  }];

  assert.equal(desired[0]?.targetFieldName, 'attachments[0].uri');
  assert.deepEqual(planPhotoCopyReferenceReconciliation(settled, desired), {
    add: [],
    remove: [],
  });
});

test('current photo projection removes a deleted row and emits a shifted photo once with its current field', () => {
  const parentId = 'audit-1';
  const entityId = 'switchboard-1';
  const deleted = photo({
    id: PHOTO_A,
    parentId,
    entityType: 'main_switchboard',
    entityId,
    fieldName: 'extraPhotos[0]',
  });
  const shifted = photo({
    id: PHOTO_B,
    parentId,
    entityType: 'main_switchboard',
    entityId,
    fieldName: 'extraPhotos[1]',
  });
  const shiftedAlias = {
    ...shifted,
    fieldName: 'extraPhotos[0]',
  };

  const projected = projectPhotosToCurrentReferences({
    app: 'ecoaudit',
    parentId,
    entities: [{
      sourceEntityId: entityId,
      targetEntityId: entityId,
      targetEntityType: 'main_switchboard',
      photoValues: [],
      photoReferences: [{ photoId: PHOTO_B, targetFieldName: 'extraPhotos[0]' }],
    }],
    photos: [deleted, shifted, shiftedAlias],
  });

  assert.deepEqual(projected.map((row) => ({
    id: row.id,
    fieldName: row.fieldName,
  })), [{
    id: PHOTO_B,
    fieldName: 'extraPhotos[0]',
  }]);
});

test('current photo projection excludes duplicate upload rows not referenced by the record', () => {
  const parentId = 'audit-1';
  const entityId = 'zone-1';
  const canonical = photo({
    id: PHOTO_A,
    parentId,
    entityId,
    fieldName: 'photos[0]',
  });
  const racedDuplicate = photo({
    id: PHOTO_B,
    parentId,
    entityId,
    fieldName: 'photos[0]',
    checksum: canonical.checksum,
  });

  const projected = projectPhotosToCurrentReferences({
    app: 'ecoaudit',
    parentId,
    entities: [{
      sourceEntityId: entityId,
      targetEntityId: entityId,
      targetEntityType: 'zone',
      photoValues: [],
      photoReferences: [{ photoId: PHOTO_A, targetFieldName: 'photos[0]' }],
    }],
    photos: [canonical, racedDuplicate],
  });

  assert.deepEqual(projected.map((row) => row.id), [PHOTO_A]);
});

test('InstallHub amendments receive same-parent aliases for retained evidence', () => {
  const rows = buildPhotoCopyReferenceRows({
    app: 'installhub',
    targetParentId: 'installation-1',
    entities: [{
      sourceEntityId: 'form-2',
      targetEntityId: 'form-2',
      targetEntityType: 'form_submission',
      photoValues: [],
      photoReferences: [{
        photoId: PHOTO_A,
        targetFieldName: 'attachments[0].uri',
      }],
    }],
    photos: [photo({
      id: PHOTO_A,
      app: 'installhub',
      parentId: 'installation-1',
      entityType: 'form_submission',
      entityId: 'form-1',
      fieldName: 'attachments[0].uri',
    })],
    allowUnconfirmed: true,
  });

  assert.deepEqual(rows.map((row) => ({
    photoId: row.photoId,
    targetEntityId: row.targetEntityId,
    targetFieldName: row.targetFieldName,
  })), [{
    photoId: PHOTO_A,
    targetEntityId: 'form-2',
    targetFieldName: 'attachments[0].uri',
  }]);
});

test('copy links only confirmed stored photos actually present in copied photo fields', () => {
  const rows = buildPhotoCopyReferenceRows({
    app: 'ecoaudit',
    targetParentId: 'target-parent',
    entities: [{
      sourceEntityId: 'source-entity',
      targetEntityId: 'target-entity',
      targetEntityType: 'zone',
      photoValues: [
        `/v1/files/ecoaudit/source/photo-${PHOTO_A}.jpg`,
        `/v1/files/ecoaudit/source/photo-${PHOTO_B}.jpg`,
        `/v1/files/ecoaudit/source/photo-${PHOTO_C}.jpg`,
      ],
      photoReferences: [
        { photoId: PHOTO_A, targetFieldName: 'photos[0]' },
        { photoId: PHOTO_B, targetFieldName: 'photos[1]' },
        { photoId: PHOTO_C, targetFieldName: 'photos[2]' },
      ],
    }],
    photos: [
      photo({ id: PHOTO_A }),
      photo({ id: PHOTO_B, status: 'uploaded' }),
      photo({ id: PHOTO_C, storageKey: null }),
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].photoId, PHOTO_A);
  assert.equal(rows[0].targetParentId, 'target-parent');
  assert.equal(rows[0].targetEntityId, 'target-entity');
  assert.equal(rows[0].targetFieldName, 'photos[0]');
});

test('an inherited virtual photo can be linked again for a copy-of-copy', () => {
  const inherited = photo({
    id: PHOTO_A,
    parentId: 'first-copy',
    entityId: 'first-copy-entity',
  });
  const rows = buildPhotoCopyReferenceRows({
    app: 'ecoaudit',
    targetParentId: 'second-copy',
    entities: [{
      sourceEntityId: 'first-copy-entity',
      targetEntityId: 'second-copy-entity',
      targetEntityType: 'zone',
      photoValues: `/v1/files/ecoaudit/original/photo-${PHOTO_A}.jpg`,
    }],
    photos: [inherited],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].photoId, PHOTO_A);
  assert.equal(rows[0].targetParentId, 'second-copy');
  assert.equal(rows[0].targetEntityId, 'second-copy-entity');
});

test('secure pre-confirm reconciliation can link pending/uploaded rows but never failed rows', () => {
  const entity = {
    sourceEntityId: 'source-entity',
    targetEntityId: 'target-entity',
    targetEntityType: 'zone',
    photoValues: [],
    photoReferences: [
      { photoId: PHOTO_A, targetFieldName: 'photos[0]' },
      { photoId: PHOTO_B, targetFieldName: 'photos[1]' },
      { photoId: PHOTO_C, targetFieldName: 'photos[2]' },
    ],
  };
  const rows = buildPhotoCopyReferenceRows({
    app: 'ecoaudit',
    targetParentId: 'target-parent',
    entities: [entity],
    photos: [
      photo({ id: PHOTO_A, status: 'pending' }),
      photo({ id: PHOTO_B, status: 'uploaded' }),
      photo({ id: PHOTO_C, status: 'failed' }),
    ],
    allowUnconfirmed: true,
  });
  assert.deepEqual(rows.map((row) => row.photoId), [PHOTO_A, PHOTO_B]);
});

test('Solar reconciliation derives current PDF field paths after array reorder', () => {
  const references = solarAssessmentPhotoFieldReferences({
    switchboards: [
      { photoUri: `/v1/files/photo-${PHOTO_B}.jpg` },
      { photoUri: `/v1/files/photo-${PHOTO_A}.jpg` },
    ],
    otherConsiderations: [{ photoUris: [`/v1/files/photo-${PHOTO_C}.jpg`] }],
    additionalPhotos: [
      `/v1/files/photo-${PHOTO_A}.jpg`,
      `/v1/files/photo-${PHOTO_B}.jpg`,
    ],
  });

  assert.deepEqual(references, [
    { photoId: PHOTO_A, targetFieldName: 'additional_photos[0]' },
    { photoId: PHOTO_B, targetFieldName: 'additional_photos[1]' },
    { photoId: PHOTO_B, targetFieldName: 'switchboards[0].photoUri' },
    { photoId: PHOTO_A, targetFieldName: 'switchboards[1].photoUri' },
    { photoId: PHOTO_C, targetFieldName: 'other_considerations[0].photoUris[0]' },
  ]);
});

test('reconciliation is idempotent and replaces a stale target path', () => {
  const existing = [{
    id: 'old-link',
    app: 'solarsense',
    photoId: PHOTO_A,
    targetParentId: 'copy',
    targetEntityType: 'rooftop_assessment',
    targetEntityId: 'assessment-copy',
    targetFieldName: 'additional_photos[1]',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  }];
  const desired = [{
    id: 'new-link',
    app: 'solarsense',
    photoId: PHOTO_A,
    targetParentId: 'copy',
    targetEntityType: 'rooftop_assessment',
    targetEntityId: 'assessment-copy',
    targetFieldName: 'additional_photos[0]',
  }];

  const changed = planPhotoCopyReferenceReconciliation(existing, desired);
  assert.deepEqual(changed.remove.map((row) => row.id), ['old-link']);
  assert.deepEqual(changed.add.map((row) => row.id), ['new-link']);

  const settled = planPhotoCopyReferenceReconciliation([
    { ...existing[0], id: 'new-link', targetFieldName: 'additional_photos[0]' },
  ], desired);
  assert.equal(settled.add.length, 0);
  assert.equal(settled.remove.length, 0);
});

test('generic grants require one authenticated actor to access both parents', () => {
  const ecoActor = {
    userId: 'shared-inspector',
    app: 'ecoaudit' as const,
    role: 'inspector' as const,
    authType: 'jwt' as const,
  };
  const target = {
    id: 'target',
    createdByUserId: 'target-owner',
    assignedInspectorUserId: 'shared-inspector',
  };
  const accessibleSource = {
    id: 'source',
    createdByUserId: 'source-owner',
    assignedInspectorUserId: 'shared-inspector',
  };
  assert.equal(actorCanAccessPhotoParent('ecoaudit', ecoActor, target), true);
  assert.equal(actorCanAccessPhotoParent('ecoaudit', ecoActor, accessibleSource), true);

  assert.equal(genericPhotoCandidateIsAuthorized({
    app: 'ecoaudit',
    photoId: PHOTO_A,
    sourceParent: accessibleSource,
    targetParent: target,
    alreadyLinked: false,
  }), false, 'no actor may never create a generic grant');
  assert.equal(genericPhotoCandidateIsAuthorized({
    app: 'ecoaudit',
    photoId: PHOTO_A,
    actor: ecoActor,
    sourceParent: { ...accessibleSource, assignedInspectorUserId: 'someone-else' },
    targetParent: target,
    alreadyLinked: false,
  }), false, 'the actor must access the source as well as the target');
  assert.equal(genericPhotoCandidateIsAuthorized({
    app: 'ecoaudit',
    photoId: PHOTO_A,
    actor: ecoActor,
    sourceParent: accessibleSource,
    targetParent: { ...target, assignedInspectorUserId: 'someone-else' },
    alreadyLinked: false,
  }), false, 'the actor must access the target as well as the source');
  assert.equal(genericPhotoCandidateIsAuthorized({
    app: 'ecoaudit',
    photoId: PHOTO_A,
    actor: ecoActor,
    sourceParent: accessibleSource,
    targetParent: target,
    alreadyLinked: false,
  }), true);
  assert.equal(genericPhotoCandidateIsAuthorized({
    app: 'ecoaudit',
    photoId: PHOTO_A,
    targetParent: target,
    alreadyLinked: true,
  }), true, 'an explicit existing copy grant may be remapped without an actor');
});

test('elevated actors can create grants in their own app but cross-app actors cannot', () => {
  const source = { id: 'source', createdByUserId: 'source-owner' };
  const target = { id: 'target', createdByUserId: 'target-owner' };
  assert.equal(genericPhotoCandidateIsAuthorized({
    app: 'solarsense',
    photoId: PHOTO_A,
    sourceParent: source,
    targetParent: target,
    alreadyLinked: false,
    actor: {
      userId: 'admin', app: 'solarsense', role: 'admin', authType: 'jwt',
    },
  }), true);
  assert.equal(genericPhotoCandidateIsAuthorized({
    app: 'solarsense',
    photoId: PHOTO_A,
    sourceParent: source,
    targetParent: target,
    alreadyLinked: false,
    actor: {
      userId: 'admin', app: 'ecoaudit', role: 'admin', authType: 'jwt',
    },
  }), false);
});

test('Solar appendix grants require explicit image type', () => {
  assert.deepEqual(solarSitePhotoFieldReferences({
    appendixItems: [
      { type: 'image', uri: `/v1/files/photo-${PHOTO_A}.jpg`, name: 'Roof' },
      { type: 'document', uri: `/v1/files/photo-${PHOTO_B}.pdf`, name: 'Plan' },
      { uri: `/v1/files/photo-${PHOTO_C}.jpg`, name: 'Legacy unknown' },
    ],
  }), [
    { photoId: PHOTO_A, targetFieldName: 'appendix_items[0].uri' },
  ]);
});
