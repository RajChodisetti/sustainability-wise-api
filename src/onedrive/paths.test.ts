import assert from 'node:assert/strict';
import test from 'node:test';
import { invoicePdfOneDrivePath, oneDrivePathForStorageKey } from './paths.js';

test('Field App evidence stays in its own OneDrive application hierarchy', () => {
  assert.equal(
    oneDrivePathForStorageKey(
      'SustainabilityWise/photos',
      'installhub/acme-site/zone/main-switchboard/photo/evidence-1.jpg',
    ),
    'SustainabilityWise/photos/installhub/acme-site/zone/main-switchboard/photo/evidence-1.jpg',
  );
});

test('invoice PDFs use the lazy invoices/client folder hierarchy', () => {
  assert.equal(
    invoicePdfOneDrivePath(
      'SustainabilityWise/invoices',
      'Example / Client',
      'INV-2026-0002-v3.pdf',
    ),
    'SustainabilityWise/invoices/Example _ Client/INV-2026-0002-v3.pdf',
  );
});
