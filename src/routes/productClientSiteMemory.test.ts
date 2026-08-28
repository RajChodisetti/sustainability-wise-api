import assert from 'node:assert/strict';
import test from 'node:test';
import { schedulerAddressFingerprint } from '../services/schedulerAddressService.js';
import { prepareProductClientSite } from './productClientSiteMemory.js';

test('legacy product payloads create a manual AU client/site contract', () => {
  const prepared = prepareProductClientSite({}, {
    clientName: null,
    businessSiteId: null,
    siteName: 'West Depot',
    displayAddress: '10 Main Street, Sydney NSW 2000',
  });

  assert.equal(prepared.clientName, 'West Depot');
  assert.equal(prepared.selectedClientId, null);
  assert.equal(prepared.selectedSiteId, null);
  assert.deepEqual(prepared.address, {
    displayAddress: '10 Main Street, Sydney NSW 2000',
    locality: null,
    state: null,
    postcode: null,
    countryCode: 'AU',
    latitude: null,
    longitude: null,
    provider: null,
    placeId: null,
    source: 'manual',
    geocodingStatus: 'unresolved',
  });
});

test('unchanged legacy writes preserve existing geocoding evidence', () => {
  const displayAddress = '1 George Street, Sydney NSW 2000';
  const prepared = prepareProductClientSite({ clientName: 'Acme Energy' }, {
    clientName: 'Acme Energy',
    businessSiteId: 'site-1',
    siteName: 'Sydney Office',
    displayAddress,
    locality: 'Sydney',
    state: 'NSW',
    postcode: '2000',
    countryCode: 'AU',
    latitude: -33.8688,
    longitude: 151.2093,
    provider: 'geoapify',
    placeId: 'geoapify:place-1',
    source: 'suggested',
    geocodingStatus: 'resolved',
    fingerprint: schedulerAddressFingerprint({
      displayAddress,
      locality: 'Sydney',
      state: 'NSW',
      postcode: '2000',
      countryCode: 'AU',
    }),
  });

  assert.equal(prepared.address.latitude, -33.8688);
  assert.equal(prepared.address.longitude, 151.2093);
  assert.equal(prepared.address.provider, 'geoapify');
  assert.equal(prepared.address.placeId, 'geoapify:place-1');
  assert.equal(prepared.address.source, 'suggested');
  assert.equal(prepared.address.geocodingStatus, 'resolved');
});

test('editing an address without new provider evidence clears stale coordinates', () => {
  const prepared = prepareProductClientSite({
    siteAddress: '2 George Street, Sydney NSW 2000',
  }, {
    clientName: 'Acme Energy',
    businessSiteId: 'site-1',
    siteName: 'Sydney Office',
    displayAddress: '1 George Street, Sydney NSW 2000',
    locality: 'Sydney',
    state: 'NSW',
    postcode: '2000',
    countryCode: 'AU',
    latitude: -33.8688,
    longitude: 151.2093,
    provider: 'geoapify',
    placeId: 'geoapify:place-1',
    source: 'suggested',
    geocodingStatus: 'resolved',
  });

  assert.equal(prepared.address.displayAddress, '2 George Street, Sydney NSW 2000');
  assert.equal(prepared.address.latitude, null);
  assert.equal(prepared.address.longitude, null);
  assert.equal(prepared.address.provider, null);
  assert.equal(prepared.address.placeId, null);
  assert.equal(prepared.address.source, 'manual');
  assert.equal(prepared.address.geocodingStatus, 'unresolved');
});

test('provider and saved-client selections map the additive wire fields', () => {
  const suggested = prepareProductClientSite({
    clientId: 'client-1',
    clientName: 'Acme Energy',
    address: {
      displayAddress: '5 King Street, Melbourne VIC 3000',
      locality: 'Melbourne',
      state: 'VIC',
      postcode: '3000',
      countryCode: 'AU',
      latitude: -37.8136,
      longitude: 144.9631,
      provider: 'geoapify',
      placeId: 'geoapify:place-5',
      source: 'suggested',
      geocodingStatus: 'resolved',
    },
  }, {
    siteName: 'Melbourne Office',
    displayAddress: null,
  });
  assert.equal(suggested.selectedClientId, 'client-1');
  assert.equal(suggested.address.provider, 'geoapify');
  assert.equal(suggested.address.source, 'suggested');
  assert.equal(suggested.address.geocodingStatus, 'resolved');

  const saved = prepareProductClientSite({
    clientId: 'client-1',
    clientSiteId: 'site-5',
    clientName: 'Acme Energy',
  }, {
    siteName: 'Melbourne Office',
    displayAddress: '5 King Street, Melbourne VIC 3000',
  });
  assert.equal(saved.selectedClientId, 'client-1');
  assert.equal(saved.selectedSiteId, 'site-5');
  assert.equal(saved.address.source, 'client_saved');
});

test('changing client or clearing a saved-site choice becomes a new address write', () => {
  const current = {
    clientName: 'Acme Energy',
    businessSiteId: 'site-5',
    siteName: 'Melbourne Office',
    displayAddress: '5 King Street, Melbourne VIC 3000',
    latitude: -37.8136,
    longitude: 144.9631,
    provider: 'geoapify',
    placeId: 'geoapify:place-5',
    source: 'client_saved',
    geocodingStatus: 'resolved',
  };

  const changedClient = prepareProductClientSite({ clientName: 'Beta Energy' }, current);
  assert.equal(changedClient.selectedSiteId, null);
  assert.equal(changedClient.address.source, 'suggested');

  const addNewAddress = prepareProductClientSite({ clientSiteId: null }, current);
  assert.equal(addNewAddress.selectedSiteId, null);
  assert.equal(addNewAddress.address.source, 'suggested');
});
