import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearSchedulerFieldJobPlanning,
  randomSchedulerFieldJobTitleSuffix,
  schedulerAddressDisplay,
  schedulerAddressFromClientSuggestion,
  schedulerAddressFromSuggestion,
  schedulerAddressIsComplete,
  schedulerAddressPostcodeChange,
  schedulerAddressPayload,
  schedulerDispatchSiteSelectionPayload,
  schedulerFieldJobTitlePreview,
  schedulerPostcodeLocalityLookupIsCurrent,
  schedulerSiteOptionLabel,
  schedulerManualAddress,
  schedulerRouteDistance,
  schedulerRouteDuration,
  schedulerRouteLocationFromSuggestion,
  schedulerRouteLocationIsAustralian,
  schedulerRouteOriginFromAddress,
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

test('Field title preview uses one three-character alphanumeric suffix', () => {
  const suffix = randomSchedulerFieldJobTitleSuffix(new Uint32Array([0, 25, 35]));
  assert.equal(suffix, 'AZ9');
  assert.equal(
    schedulerFieldJobTitlePreview('M3 - Inspection', 'Client Co', 'North Site', suffix),
    'M3 - Client Co - North Site - AZ9',
  );
  assert.equal(
    schedulerFieldJobTitlePreview('', 'Client Co', 'North Site', suffix),
    'M5 - Client Co - North Site - AZ9',
  );
  assert.match(suffix, /^[A-Z0-9]{3}$/);
});

test('selecting a saved site clears Field planning while preserving contact details', () => {
  assert.deepEqual(clearSchedulerFieldJobPlanning({
    electricityNmi: '41020000000',
    maas: true,
    workType: 'M3 - Inspection',
    meteringSolutionType: 'NEM meter',
    jobComments: 'Previous job scope',
    siteContactName: 'Site manager',
  }), {
    electricityNmi: '',
    maas: null,
    workType: '',
    meteringSolutionType: '',
    jobComments: '',
    siteContactName: 'Site manager',
  });
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

test('postcode locality auto-fill ignores stale debounced lookup results', () => {
  assert.equal(schedulerPostcodeLocalityLookupIsCurrent('', '3053'), false);
  assert.equal(schedulerPostcodeLocalityLookupIsCurrent('2000', '3053'), false);
  assert.equal(schedulerPostcodeLocalityLookupIsCurrent(' 3053 ', '3053'), true);
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

test('route origins are validated against the Australian operating area before submission', () => {
  assert.equal(schedulerRouteLocationIsAustralian({
    latitude: -33.8688,
    longitude: 151.2093,
  }), true);
  assert.equal(schedulerRouteLocationIsAustralian({
    latitude: 33.4484,
    longitude: -112.074,
  }), false);
  assert.equal(schedulerRouteLocationIsAustralian({
    latitude: Number.NaN,
    longitude: 151.2093,
  }), false);
  assert.deepEqual(schedulerRouteLocationFromSuggestion(suggestion), {
    latitude: -33.86,
    longitude: 151.21,
  });
  assert.equal(schedulerRouteLocationFromSuggestion({
    latitude: 33.4484,
    longitude: -112.074,
  }), null);
});

test('route address origin accepts free-form text, reuses a selected point, and bounds length', () => {
  assert.deepEqual(schedulerRouteOriginFromAddress(suggestion.label, suggestion), {
    currentLocation: { latitude: -33.86, longitude: 151.21 },
  });
  assert.deepEqual(schedulerRouteOriginFromAddress(
    '  Flinders Street Station, Melbourne VIC 3000  ',
    null,
  ), {
    startingAddress: 'Flinders Street Station, Melbourne VIC 3000',
  });
  assert.equal(schedulerRouteOriginFromAddress('AU', null), null);
  assert.equal(schedulerRouteOriginFromAddress('A'.repeat(301), null), null);
});
