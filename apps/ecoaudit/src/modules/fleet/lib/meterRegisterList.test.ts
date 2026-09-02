import assert from 'node:assert/strict';
import test from 'node:test';
import type { FleetRegisterEvidence } from '@/modules/fleet/types/domain';
import {
  meterRegisterClassificationPresentation,
  meterRegisterListValues,
  meterRegisterRawSourceValue,
} from './meterRegisterList';

function evidence(overrides: Partial<FleetRegisterEvidence> = {}): FleetRegisterEvidence {
  return {
    id: 'entry-1',
    currentDeviceIdentifier: 'WW-001',
    currentDeviceClassification: 'confirmed_wattwatchers',
    clientName: 'Source client',
    customerName: 'Source customer',
    siteAddress: '1 Source Street',
    siteState: 'VIC',
    record: null,
    ...overrides,
  };
}

test('list values use mapped record names and preserve an intentionally cleared state', () => {
  const values = meterRegisterListValues(evidence({
    record: {
      entryId: 'entry-1',
      businessClientId: 'client-1',
      businessSiteId: 'site-1',
      clientName: 'Mapped client',
      customerName: 'Mapped customer',
      siteName: 'Mapped site',
      siteAddress: 'NA',
      siteState: null,
      revision: 4,
      details: {} as never,
    },
  }));
  assert.deepEqual(values, {
    identifier: 'WW-001',
    clientName: 'Mapped client',
    customerName: 'Mapped customer',
    siteName: 'Mapped site',
    siteAddress: 'NA',
    siteState: null,
    revision: 4,
    sourceClient: 'Source client',
  });
});

test('list values fall back from source client and site name to customer', () => {
  const values = meterRegisterListValues(evidence({
    clientName: null,
    fleetAccountName: null,
    customerName: 'Customer fallback',
    siteAddress: null,
    siteState: null,
  }));
  assert.equal(values.clientName, 'Customer fallback');
  assert.equal(values.customerName, 'Customer fallback');
  assert.equal(values.siteName, 'Customer fallback');
  assert.equal(values.siteAddress, 'NA');
  assert.equal(values.sourceClient, 'NA');
});

test('identifier classification labels distinguish confirmed, candidate and other hardware rows', () => {
  assert.deepEqual(meterRegisterClassificationPresentation('confirmed_wattwatchers'), {
    label: 'Confirmed Wattwatchers', tone: 'positive',
  });
  assert.deepEqual(meterRegisterClassificationPresentation('candidate_wattwatchers'), {
    label: 'Candidate Wattwatchers', tone: 'warning',
  });
  assert.equal(meterRegisterClassificationPresentation('other_hardware').label, 'Other hardware');
  assert.equal(meterRegisterClassificationPresentation(undefined).label, 'Not classified');
});

test('raw source values preserve malformed spreadsheet text and scalar values exactly', () => {
  assert.equal(meterRegisterRawSourceValue('#REF!'), '#REF!');
  assert.equal(meterRegisterRawSourceValue('As above'), 'As above');
  assert.equal(meterRegisterRawSourceValue(0), '0');
  assert.equal(meterRegisterRawSourceValue(false), 'false');
  assert.equal(meterRegisterRawSourceValue(null), '');
});
