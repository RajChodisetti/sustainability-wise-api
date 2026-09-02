import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Fleet exposes the searchable full Meter Register only to Fleet administrators', () => {
  const shell = readFileSync(
    new URL('../../../components/portal/PortalShell.tsx', import.meta.url),
    'utf8',
  );
  const route = readFileSync(
    new URL('../../../app/(portal)/fleet/(app)/meter-register/page.tsx', import.meta.url),
    'utf8',
  );
  const page = readFileSync(new URL('../pages/MeterRegisterPage.tsx', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../api/fleet.ts', import.meta.url), 'utf8');

  assert.match(shell, /wwAdmin = wwUser\?\.role === 'admin'/);
  assert.match(shell, /wwAdmin[\s\S]*href: '\/fleet\/meter-register', label: 'Meter Register'/);
  assert.match(route, /MeterRegisterPage/);
  assert.match(api, /\/v1\/wattwatchers\/meter-register\/entries/);
  assert.match(page, /useFleetMeterRegisterEntries/);
  assert.match(page, /currentDeviceClassification === 'confirmed_wattwatchers'/);
  assert.match(page, /wwUser\?\.role === 'admin'/);
  assert.match(page, /useFleetMeterRegisterEntries\([\s\S]*isAdmin\)/);
  assert.match(page, /Fleet administrator access required/);
  assert.match(page, /<MeterRegisterEditDialog/);
  assert.match(page, /Installation: \{evidence\.record\.details\.installationDetail\}/);
  assert.match(
    page,
    /deviceId=\{editingEvidence\.currentDeviceClassification === 'confirmed_wattwatchers'[\s\S]*editingEvidence\.currentDeviceIdentifier/,
  );
});

test('register corrections invalidate all paginated Meter Register queries', () => {
  const hook = readFileSync(new URL('../hooks/useFleet.ts', import.meta.url), 'utf8');

  assert.match(hook, /queryKey: \['wattwatchers', 'meter-register', 'entries'\]/);
  assert.match(hook, /export function useUpdateFleetMeterRegisterEntry\(deviceId\?: string\)/);
});
