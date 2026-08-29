import assert from 'node:assert/strict';
import test from 'node:test';
import {
  installHubRouteDistance,
  installHubRouteDuration,
  installHubRouteLocationFromSuggestion,
  installHubRouteLocationIsAustralian,
  installHubRouteOriginFromAddress,
} from './routing';
import type { InstallHubRouteAddressSuggestion } from '@/modules/installhub/types/routing';

function suggestion(
  latitude: number | null,
  longitude: number | null,
): InstallHubRouteAddressSuggestion {
  return {
    kind: 'provider',
    id: 'address-1',
    label: '10 George Street, Sydney NSW 2000, Australia',
    clientId: null,
    clientSiteId: null,
    siteName: null,
    address: {
      displayAddress: '10 George Street, Sydney NSW 2000, Australia',
      locality: 'Sydney',
      state: 'NSW',
      postcode: '2000',
      countryCode: 'AU',
      latitude,
      longitude,
      provider: 'test',
      placeId: 'address-1',
      source: 'suggested',
      geocodingStatus: 'resolved',
      fingerprint: 'address-fingerprint',
    },
  };
}

test('Field route locations must resolve to finite Australian coordinates', () => {
  assert.equal(installHubRouteLocationIsAustralian({ latitude: -33.8688, longitude: 151.2093 }), true);
  assert.equal(installHubRouteLocationIsAustralian({ latitude: 33.4484, longitude: -112.074 }), false);
  assert.equal(installHubRouteLocationIsAustralian({ latitude: Number.NaN, longitude: 151.2093 }), false);
  assert.deepEqual(
    installHubRouteLocationFromSuggestion(suggestion(-33.8688, 151.2093)),
    { latitude: -33.8688, longitude: 151.2093 },
  );
  assert.equal(installHubRouteLocationFromSuggestion(suggestion(null, null)), null);
});

test('Field route address origin accepts free-form text, reuses a selected point, and bounds length', () => {
  const selected = suggestion(-37.8183, 144.9671);
  assert.deepEqual(installHubRouteOriginFromAddress(selected.label, selected), {
    currentLocation: { latitude: -37.8183, longitude: 144.9671 },
  });
  assert.deepEqual(installHubRouteOriginFromAddress(
    '  Flinders Street Station, Melbourne VIC 3000  ',
    null,
  ), {
    startingAddress: 'Flinders Street Station, Melbourne VIC 3000',
  });
  assert.equal(installHubRouteOriginFromAddress('AU', null), null);
  assert.equal(installHubRouteOriginFromAddress('A'.repeat(301), null), null);
});

test('Field route distances and durations use compact operational labels', () => {
  assert.equal(installHubRouteDistance(450), '450 m');
  assert.equal(installHubRouteDistance(1_450), '1.4 km');
  assert.equal(installHubRouteDistance(14_500), '15 km');
  assert.equal(installHubRouteDuration(59), '1 min');
  assert.equal(installHubRouteDuration(3_900), '1 hr 5 min');
  assert.equal(installHubRouteDuration(7_200), '2 hr');
});
