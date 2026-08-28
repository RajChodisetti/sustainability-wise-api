import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseSchedulerDispatchAddress,
  schedulerAddressFingerprint,
  storedSchedulerCoordinatesAreCurrent,
} from './schedulerAddressService.js';
import { AppError } from '../utils/errors.js';

test('legacy dispatch addresses remain authoritative and become unresolved AU locations', () => {
  const location = parseSchedulerDispatchAddress(undefined, ' 1 Main Street, Sydney NSW 2000 ');
  assert.equal(location.siteCountryCode, 'AU');
  assert.equal(location.siteGeocodeStatus, 'unresolved');
  assert.equal(location.siteLatitude, null);
  assert.equal(location.siteLongitude, null);
  assert.equal(
    location.siteAddressFingerprint,
    schedulerAddressFingerprint('1 Main Street, Sydney NSW 2000'),
  );
});

test('selected Photon address stores normalized Australian structure and coordinates', () => {
  const now = new Date('2026-08-22T02:00:00.000Z');
  const location = parseSchedulerDispatchAddress({
    freeform: '1 Main Street, Sydney NSW 2000',
    locality: 'Sydney',
    state: 'nsw',
    postcode: '2000',
    countryCode: 'AU',
    latitude: -33.8688,
    longitude: 151.2093,
    provider: 'photon',
    placeId: 'photon:123',
  }, '1  Main Street, Sydney NSW 2000', now);

  assert.deepEqual(location, {
    siteLocality: 'Sydney',
    siteState: 'NSW',
    sitePostcode: '2000',
    siteCountryCode: 'AU',
    siteLatitude: -33.8688,
    siteLongitude: 151.2093,
    siteGeocodeStatus: 'resolved',
    siteGeocodeProvider: 'photon',
    siteGeocodePlaceId: 'photon:123',
    siteAddressSource: 'suggested',
    siteAddressFingerprint: schedulerAddressFingerprint({
      displayAddress: '1 Main Street, Sydney NSW 2000',
      locality: 'Sydney',
      state: 'NSW',
      postcode: '2000',
      countryCode: 'AU',
    }),
    siteGeocodedAt: now,
  });
});

test('manual and composed free text remain valid while partial provider evidence is rejected', () => {
  const manual = parseSchedulerDispatchAddress({
    freeform: 'Remote access track, NSW',
    countryCode: 'AU',
  }, 'Remote access track, NSW');
  assert.equal(manual.siteGeocodeStatus, 'unresolved');
  assert.equal(manual.siteAddressSource, 'manual');

  const composed = parseSchedulerDispatchAddress({
    freeform: '10 George Street',
    locality: 'Sydney',
    state: 'NSW',
    postcode: '2000',
    countryCode: 'AU',
    latitude: -33.8688,
    longitude: 151.2093,
    provider: 'photon',
    placeId: 'W:123',
  }, '10 George Street, Sydney NSW 2000, Australia');
  assert.equal(composed.siteGeocodeStatus, 'resolved');

  for (const input of [
    {
      freeform: 'Remote access track, NSW',
      countryCode: 'NZ',
    },
    {
      freeform: 'Remote access track, NSW',
      countryCode: 'AU',
      latitude: -33,
    },
    {
      freeform: 'Remote access track, NSW',
      countryCode: 'AU',
      provider: 'photon',
    },
    {
      freeform: 'Remote access track, NSW',
      countryCode: 'AU',
      postcode: '800',
    },
    {
      freeform: 'Remote access track, NSW',
      countryCode: 'AU',
      latitude: 51.5072,
      longitude: -0.1276,
    },
  ]) {
    assert.throws(
      () => parseSchedulerDispatchAddress(input, 'Remote access track, NSW'),
      (error: unknown) => error instanceof AppError && error.statusCode === 400,
    );
  }
});

test('address providers are limited to the cross-client wire allowlist', () => {
  assert.throws(
    () => parseSchedulerDispatchAddress({
      freeform: '10 George Street, Sydney NSW 2000',
      locality: 'Sydney',
      state: 'NSW',
      postcode: '2000',
      countryCode: 'AU',
      latitude: -33.8688,
      longitude: 151.2093,
      provider: 'google',
      placeId: 'provider-place-1',
    }, '10 George Street, Sydney NSW 2000'),
    (error: unknown) => error instanceof AppError
      && error.statusCode === 400
      && /geoapify or photon/u.test(error.detail ?? ''),
  );
});

test('stored coordinates are ignored after authoritative free text changes', () => {
  const original = '1 Main Street, Sydney NSW 2000';
  const fingerprint = schedulerAddressFingerprint(original);
  assert.equal(storedSchedulerCoordinatesAreCurrent({
    freeform: original,
    latitude: -33.8688,
    longitude: 151.2093,
    addressFingerprint: fingerprint,
  }), true);
  assert.equal(storedSchedulerCoordinatesAreCurrent({
    freeform: '2 Main Street, Sydney NSW 2000',
    latitude: -33.8688,
    longitude: 151.2093,
    addressFingerprint: fingerprint,
  }), false);
});
