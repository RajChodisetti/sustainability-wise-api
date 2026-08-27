import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('finance summary keeps employee rates behind one expandable action', async () => {
  const panelSource = await readFile(
    new URL('../components/FinanceSettingsPanel.tsx', import.meta.url),
    'utf8',
  );
  const domainSource = await readFile(
    new URL('../types/domain.ts', import.meta.url),
    'utf8',
  );

  assert.match(panelSource, /Fix employee rates/);
  assert.match(panelSource, /aria-expanded=\{ratesOpen\}/);
  assert.match(panelSource, /displayName=\{actor\.displayName \|\| actor\.userId\}/);
  assert.doesNotMatch(panelSource, /Internal calculation/);
  assert.doesNotMatch(panelSource, /Billing details/);
  assert.doesNotMatch(panelSource, /resting|inactive time/i);
  assert.doesNotMatch(domainSource, /restingHours|restingMilliseconds/);
});
