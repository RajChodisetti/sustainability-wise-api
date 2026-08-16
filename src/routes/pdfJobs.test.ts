import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exportArtifactContentDisposition,
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

test('export downloads retain safe Unicode filenames with an RFC ASCII fallback', () => {
  assert.equal(
    exportArtifactContentDisposition('invoice-Café-Retrofit-2026-08-16-INV-0042.pdf'),
    'attachment; filename="invoice-Cafe-Retrofit-2026-08-16-INV-0042.pdf"; '
      + "filename*=UTF-8''invoice-Caf%C3%A9-Retrofit-2026-08-16-INV-0042.pdf",
  );

  const hostile = exportArtifactContentDisposition('../private\r\nX-Header: yes.pdf');
  assert.equal(/[\r\n\\/]/.test(hostile), false);
  assert.equal(hostile.includes('filename*=UTF-8\'\''), true);
  assert.equal(hostile.includes('privateX-Header- yes.pdf'), true);
});
