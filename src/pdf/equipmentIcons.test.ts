import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PDF_EQUIPMENT_ICON_NAMES,
  renderPdfEquipmentIcon,
} from './equipmentIcons.js';

test('every PDF equipment category has deterministic inline SVG markup', () => {
  assert.deepEqual(PDF_EQUIPMENT_ICON_NAMES, [
    'switchboard',
    'hvac',
    'lighting',
    'solar',
    'charger',
    'hot-water',
    'water',
    'electricity',
    'camera',
  ]);

  for (const name of PDF_EQUIPMENT_ICON_NAMES) {
    const markup = renderPdfEquipmentIcon(name);
    assert.match(markup, new RegExp(`data-pdf-icon="${name}"`));
    assert.match(markup, /<svg[^>]*viewBox="0 0 24 24"/);
    assert.match(markup, /<(?:path|rect|circle)\b/);
    assert.doesNotMatch(markup, /[^\x00-\x7F]/);
  }
});
