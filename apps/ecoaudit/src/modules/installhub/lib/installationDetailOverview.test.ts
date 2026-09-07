import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const detailSource = readFileSync(
  new URL('../pages/InstallationDetailPage.tsx', import.meta.url),
  'utf8',
);
const gridSupplySource = readFileSync(
  new URL('../components/GridSupplyEditor.tsx', import.meta.url),
  'utf8',
);
const installationFormSource = readFileSync(
  new URL('../pages/InstallationFormPage.tsx', import.meta.url),
  'utf8',
);

test('installation detail shows the requested client, site, job, contact, and NMI fields', () => {
  [
    'Client Name',
    'Job Number #',
    'Site Name',
    'Site Address',
    'Suburb',
    'State',
    'Postcode',
    'Site Contact Name',
    'Site Contact Number',
    'Site Contact Email',
    'MaaS (Yes/No)',
    'MAAS Type',
    'Meter Type',
    'Job Type',
    'Scope Notes',
    'Electricity NMI',
  ].forEach((label) => {
    assert.ok(detailSource.includes(`label="${label}"`), `${label} should be visible`);
  });

  assert.doesNotMatch(detailSource, /label="Customer Name"/);

  assert.match(detailSource, /const primarySupply = primaryGridSupply\(tree\)/);
  assert.match(detailSource, /href=\{`#grid-supply-\$\{primarySupply\.id\}`\}/);
  assert.match(detailSource, /!primarySupply\.nmi\?\.trim\(\)/);
  assert.match(detailSource, />Add NMI<\/LinkButton>/);
  assert.doesNotMatch(detailSource, />Edit NMI<\/LinkButton>/);
  assert.match(gridSupplySource, /id="grid-supplies"/);
  assert.match(gridSupplySource, /id=\{`grid-supply-\$\{supply\.id\}`\}/);
  assert.match(gridSupplySource, /supply\.nmi\?\.trim\(\) \? 'Edit details' : 'Add NMI'/);
  assert.match(detailSource, /label="Meters to replace"/);
  assert.match(detailSource, /replacementMeterNumbersFromStored\(installation\.existingDeviceId\)/);
  assert.match(detailSource, /Replace \{meterNumber\}/);
});

test('installation details are separated into scannable groups', () => {
  [
    'Client &amp; site',
    'Job &amp; scope',
    'Site contact',
    'Metering &amp; hardware',
  ].forEach((heading) => {
    assert.ok(detailSource.includes(`>${heading}</h3>`), `${heading} should identify a detail group`);
  });
});

test('installation authoring uses client naming without a separate customer concept', () => {
  assert.match(installationFormSource, />Client name<\/FieldLabel>/);
  assert.doesNotMatch(installationFormSource, /customer name|end customer/i);
});

test('installation details remain above the installation workspace', () => {
  const detailsIndex = detailSource.indexOf('>Installation details</h2>');
  const incomingConnectionsIndex = detailSource.indexOf('<GridSupplyEditor');
  const workspaceIndex = detailSource.indexOf('>Installation workspace</h2>');
  assert.ok(detailsIndex >= 0);
  assert.ok(incomingConnectionsIndex >= 0);
  assert.ok(workspaceIndex >= 0);
  assert.ok(detailsIndex < workspaceIndex);
  assert.ok(incomingConnectionsIndex < workspaceIndex);
});

test('more tools does not duplicate the electrical workspace', () => {
  assert.doesNotMatch(
    detailSource,
    /<LinkButton href=\{`\/installhub\/installations\/\$\{installationId\}\/data`\} variant="secondary">Reconciliation<\/LinkButton>/,
  );
  assert.doesNotMatch(
    detailSource,
    /<LinkButton href=\{`\/installhub\/installations\/\$\{installationId\}\/metering`\}/,
  );
  assert.match(detailSource, /Why:<\/span> \{reconciliationIssueWhy\(issue\)\}/);
});
