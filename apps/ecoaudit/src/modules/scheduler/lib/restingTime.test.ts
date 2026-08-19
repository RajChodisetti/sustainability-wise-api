import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('internal finance UI shows active and resting evidence by named actor', async () => {
  const panelSource = await readFile(
    new URL('../components/FinanceSettingsPanel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(panelSource, /label="App-active hours"/);
  assert.match(panelSource, /label="Resting \/ inactive hours"/);
  assert.match(panelSource, /activeHours=\{actor\.hours\}/);
  assert.match(panelSource, /restingHours=\{actor\.restingHours\}/);
  assert.match(panelSource, /displayName=\{actor\.displayName \|\| actor\.userId\}/);
  assert.match(panelSource, /Gaps between sessions and time after the last activity checkpoint are excluded/);
});

test('resting telemetry is absent from invoice authoring UI', async () => {
  const invoiceSource = await readFile(
    new URL('../components/InvoiceWorkspace.tsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(invoiceSource, /restingHours|restingMilliseconds|inactiveHours/);
});
