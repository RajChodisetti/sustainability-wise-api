import assert from 'node:assert/strict';
import test from 'node:test';
import {
  schedulerAddressDisplay,
  schedulerAddressFromClientSuggestion,
  schedulerAddressFromSuggestion,
  schedulerAddressIsComplete,
  schedulerAddressPostcodeChange,
  schedulerAddressPayload,
  schedulerDispatchSiteSelectionPayload,
  schedulerSiteOptionLabel,
  schedulerManualAddress,
  schedulerRouteDistance,
  schedulerRouteDuration,
  uniquePostcodeLocalities,
} from './routing';

const suggestion = {
  id: 'address-1',
  label: '10 George Street, Sydney NSW 2000, Australia',
  freeform: '10 George Street, Sydney NSW 2000, Australia',
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
  assert.equal(value.source, 'suggested');
  assert.equal(schedulerAddressDisplay(value), '10 George Street, Sydney NSW 2000, Australia');
});

test('saved client address remains exact and carries saved-site evidence', () => {
  const value = schedulerAddressFromClientSuggestion({
    kind: 'client_saved',
    id: 'client_saved:site-1',
    label: 'Rear dock, 10 George Street, Sydney NSW 2000, Australia',
    clientId: 'client-1',
    clientSiteId: 'site-1',
    siteName: 'Sydney warehouse',
    address: {
      displayAddress: 'Rear dock, 10 George Street, Sydney NSW 2000, Australia',
      locality: 'Sydney',
      state: 'NSW',
      postcode: '2000',
      countryCode: 'AU',
      latitude: -33.86,
      longitude: 151.21,
      provider: 'geoapify',
      placeId: 'geoapify-place-1',
      source: 'client_saved',
      geocodingStatus: 'resolved',
      fingerprint: 'f'.repeat(64),
    },
  });
  assert.equal(value.source, 'client_saved');
  assert.equal(schedulerAddressDisplay(value), 'Rear dock, 10 George Street, Sydney NSW 2000, Australia');
  assert.equal(schedulerAddressPayload(value).source, 'client_saved');
});

test('manual editing preserves free-form input while invalidating stale geocoding', () => {
  const value = schedulerManualAddress(schedulerAddressFromSuggestion(suggestion), {
    freeform: 'Rear loading dock, 10 George Street',
  });
  assert.equal(value.freeform, 'Rear loading dock, 10 George Street');
  assert.equal(value.latitude, undefined);
  assert.equal(value.longitude, undefined);
  assert.equal(value.provider, undefined);
  assert.equal(value.placeId, undefined);
  assert.equal(value.source, 'manual');
  assert.equal(schedulerAddressIsComplete(value), true);
});

test('dispatch selection links saved sites but keeps provider and manual addresses new', () => {
  const savedAddress = schedulerAddressFromClientSuggestion({
    kind: 'client_saved',
    id: 'client_saved:site-1',
    label: '10 George Street, Sydney NSW 2000, Australia',
    clientId: 'client-1',
    clientSiteId: 'site-1',
    siteName: 'Sydney warehouse',
    address: {
      displayAddress: '10 George Street, Sydney NSW 2000, Australia',
      locality: 'Sydney',
      state: 'NSW',
      postcode: '2000',
      countryCode: 'AU',
      latitude: -33.86,
      longitude: 151.21,
      provider: 'geoapify',
      placeId: 'geoapify-place-1',
      source: 'client_saved',
      geocodingStatus: 'resolved',
      fingerprint: 'f'.repeat(64),
    },
  });
  assert.deepEqual(schedulerDispatchSiteSelectionPayload({
    address: savedAddress,
    clientId: 'client-1',
    existingSiteId: 'site-1',
  }), {
    siteMode: 'existing',
    existingSiteId: 'site-1',
    clientId: 'client-1',
  });
  assert.deepEqual(schedulerDispatchSiteSelectionPayload({
    address: schedulerManualAddress(savedAddress, { freeform: '12 George Street' }),
    clientId: 'client-1',
    existingSiteId: 'site-1',
  }), {
    siteMode: 'new',
    existingSiteId: null,
    clientId: 'client-1',
  });
});

test('saved-site labels identify the address without exposing job revisions', () => {
  const label = schedulerSiteOptionLabel({
    clientName: 'ABC Energy',
    siteName: 'Sydney warehouse',
    address: '10 George Street, Sydney NSW 2000, Australia',
  });
  assert.equal(
    label,
    'ABC Energy · Sydney warehouse · 10 George Street, Sydney NSW 2000, Australia',
  );
  assert.doesNotMatch(label, /\bv\d+\b/i);
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
    source: 'manual',
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
