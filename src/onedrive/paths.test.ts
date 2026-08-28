import assert from 'node:assert/strict';
import test from 'node:test';
import { invoicePdfOneDrivePath } from './paths.js';

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
