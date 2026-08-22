import assert from 'node:assert/strict';
import test from 'node:test';
import {
  schedulerAddressDisplay,
  schedulerAddressFromSuggestion,
  schedulerAddressIsComplete,
  schedulerAddressPostcodeChange,
  schedulerAddressPayload,
  schedulerManualAddress,
  schedulerRouteDistance,
  schedulerRouteDuration,
  uniquePostcodeLocalities,
} from './routing';

const suggestion = {
  id: 'address-1',
  label: '10 George Street, Sydney NSW 2000, Australia',
  freeform: '10 George Street',
  locality: 'Sydney',
  state: 'NSW' as const,
  postcode: '2000',
  countryCode: 'AU' as const,
  latitude: -33.86,
  longitude: 151.21,
  provider: 'photon',
  placeId: 'osm:N:1',
};

test('selected Australian suggestion is complete and preserves routable coordinates', () => {
  const value = schedulerAddressFromSuggestion(suggestion);
  assert.equal(schedulerAddressIsComplete(value), true);
  assert.equal(value.latitude, -33.86);
  assert.equal(value.placeId, 'osm:N:1');
  assert.equal(schedulerAddressDisplay(value), '10 George Street, Sydney NSW 2000, Australia');
});

test('manual editing preserves free-form input while invalidating stale geocoding', () => {
  const value = schedulerManualAddress(schedulerAddressFromSuggestion(suggestion), {
    freeform: 'Rear loading dock, 10 George Street',
  });
  assert.equal(value.freeform, 'Rear loading dock, 10 George Street');
  assert.equal(value.latitude, undefined);
  assert.equal(value.longitude, undefined);
  assert.equal(value.provider, undefined);
  assert.equal(schedulerAddressIsComplete(value), true);
});

test('changing postcode clears stale locality and state before auto-fill', () => {
  const existing = schedulerAddressFromSuggestion(suggestion);
  const changed = schedulerAddressPostcodeChange(existing, '3a000');
  assert.equal(changed.postcode, '3000');
  assert.equal(changed.locality, '');
  assert.equal(changed.state, undefined);
  assert.equal(changed.latitude, undefined);
  assert.equal(changed.longitude, undefined);
});

test('wire payload trims optional Australian address fields', () => {
  assert.deepEqual(schedulerAddressPayload({
    freeform: ' 10 George Street ',
    locality: ' Sydney ',
    state: 'NSW',
    postcode: ' 2000 ',
    countryCode: 'AU',
    provider: ' ',
  }), {
    freeform: '10 George Street',
    locality: 'Sydney',
    state: 'NSW',
    postcode: '2000',
    countryCode: 'AU',
    latitude: undefined,
    longitude: undefined,
    provider: undefined,
    placeId: undefined,
  });
});

test('postcode locality choices are unique and deterministic', () => {
  assert.deepEqual(uniquePostcodeLocalities([
    suggestion,
    { ...suggestion, id: 'duplicate' },
    { ...suggestion, id: 'second', locality: 'The Rocks' },
  ]), [
    { locality: 'Sydney', state: 'NSW' },
    { locality: 'The Rocks', state: 'NSW' },
  ]);
});

test('formatters keep route metrics compact', () => {
  assert.equal(schedulerRouteDistance(850), '850 m');
  assert.equal(schedulerRouteDistance(12_500), '13 km');
  assert.equal(schedulerRouteDuration(5_400), '1 hr 30 min');
});
