import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('internal finance UI shows only app-active evidence by named actor', async () => {
  const panelSource = await readFile(
    new URL('../components/FinanceSettingsPanel.tsx', import.meta.url),
    'utf8',
  );
  const domainSource = await readFile(
    new URL('../types/domain.ts', import.meta.url),
    'utf8',
  );

  assert.match(panelSource, /label="App-active hours"/);
  assert.match(panelSource, /activeHours=\{actor\.hours\}/);
  assert.match(panelSource, /displayName=\{actor\.displayName \|\| actor\.userId\}/);
  assert.match(panelSource, /label="Billing hours"/);
  assert.match(panelSource, /label="Cost hours"/);
  assert.match(panelSource, /label="Scheduled hours"/);
  assert.doesNotMatch(panelSource, /resting|inactive time/i);
  assert.doesNotMatch(domainSource, /restingHours|restingMilliseconds/);
});
