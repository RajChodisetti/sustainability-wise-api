import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exportJobParamsMatchExpectedProvenance,
  exportJobParamsMatchReportVariant,
} from './pdfJobs.js';

const expected = {
  recordVersionNumber: 7,
  recordVersionPayloadHash: 'payload-hash-7',
  reportSource: 'canonical-version' as const,
};

test('export provenance matching rejects stale, live, and incomplete jobs', () => {
  assert.equal(exportJobParamsMatchExpectedProvenance({
    ...expected,
    artifactType: 'pdf',
  }, expected), true);
  assert.equal(exportJobParamsMatchExpectedProvenance({
    ...expected,
    recordVersionNumber: 6,
  }, expected), false);
  assert.equal(exportJobParamsMatchExpectedProvenance({
    ...expected,
    recordVersionPayloadHash: 'stale-hash',
  }, expected), false);
  assert.equal(exportJobParamsMatchExpectedProvenance({
    ...expected,
    reportSource: 'diagnostic-live',
  }, expected), false);
  assert.equal(exportJobParamsMatchExpectedProvenance({
    recordVersionNumber: 7,
  }, expected), false);
});

test('report variant matching keeps detail mode, selected forms and Draft revision isolated', () => {
  const variant = 'installation-pack:v3:by-zone:map:tree-revision-8:forms-0123456789abcdef01234567';
  assert.equal(exportJobParamsMatchReportVariant({
    artifactType: 'pdf',
    reportVariantKey: variant,
  }, variant), true);
  assert.equal(exportJobParamsMatchReportVariant({
    artifactType: 'pdf',
    reportVariantKey: 'installation-pack:v3:by-zone:map:tree-revision-7:forms-0123456789abcdef01234567',
  }, variant), false);
  assert.equal(exportJobParamsMatchReportVariant({}, variant), false);
});
