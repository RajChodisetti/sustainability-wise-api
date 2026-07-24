import assert from 'node:assert/strict';
import test from 'node:test';
import type { RooftopAssessment } from '@solar/types/domain';
import { buildSitePackInventory } from './reportConfig';

test('uses saved captions for every assessment photo category', () => {
  const assessment = {
    id: 'assessment-1',
    status: 'Draft',
    updatedAt: '2026-07-23T12:00:00.000Z',
    siteName: 'Site A',
    buildingIdName: 'Building A',
    heritageDealBreaker: false,
    asbestosFlag: false,
    structuralRiskFlag: false,
    aerialPhotoUri: 'https://example.test/aerial.jpg',
    msbPhotoUri: 'https://example.test/msb.jpg',
    switchboards: [{ photoUri: 'https://example.test/switchboard.jpg' }],
    otherConsiderations: [{ photoUris: ['https://example.test/consideration.jpg'] }],
    additionalPhotos: ['https://example.test/additional.jpg'],
    photoMetadata: {
      aerialPhoto: { name: 'Roof overview' },
      msbPhoto: { name: 'Main switchboard' },
      'switchboard.0.photo': { name: 'Distribution board' },
      'consideration.0.0': { name: 'Shading constraint' },
      'additionalPhoto.0': { name: 'Site access' },
    },
    createdAt: '2026-07-23T12:00:00.000Z',
  } satisfies RooftopAssessment;

  assert.deepEqual(
    buildSitePackInventory([assessment])[0].photos.map((photo) => photo.label),
    [
      'Roof overview',
      'Main switchboard',
      'Distribution board',
      'Shading constraint',
      'Site access',
    ],
  );
});
