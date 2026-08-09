import assert from 'node:assert/strict';
import test from 'node:test';
import { InstallHubMeterPage } from './MeterPage';
import { InstallHubNewMeterPage } from './NewMeterPage';

test('add meter opens the adaptive meter editor directly', () => {
  const element = InstallHubNewMeterPage();

  assert.equal(element.type, InstallHubMeterPage);
  assert.deepEqual(element.props, { mode: 'new' });
});
