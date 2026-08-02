import assert from 'node:assert/strict';
import test from 'node:test';
import { exportJobParamsMatchExpectedProvenance } from './pdfJobs.js';

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
