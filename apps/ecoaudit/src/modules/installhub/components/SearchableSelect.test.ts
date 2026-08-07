import assert from 'node:assert/strict';
import test from 'node:test';
import { searchableSelectResult, type SearchableSelectOption } from './SearchableSelect';

const options: SearchableSelectOption[] = Array.from({ length: 130 }, (_, index) => ({
  value: `board-${index + 1}`,
  label: `Switchboard ${index + 1}`,
  keywords: index === 129 ? 'Remote plant distribution board' : 'Basement main board',
}));

test('searchable select filters labels and hidden keywords case-insensitively', () => {
  assert.deepEqual(
    searchableSelectResult(options, 'REMOTE PLANT').options.map((option) => option.value),
    ['board-130'],
  );
  assert.deepEqual(
    searchableSelectResult(options, 'switchboard 12').options.map((option) => option.value),
    ['board-12', 'board-120', 'board-121', 'board-122', 'board-123', 'board-124', 'board-125', 'board-126', 'board-127', 'board-128', 'board-129'],
  );
});

test('searchable select bounds results and keeps an existing selected value reachable', () => {
  const result = searchableSelectResult(options, '', 'board-130', 100);
  assert.equal(result.totalMatches, 130);
  assert.equal(result.options.length, 100);
  assert.equal(result.options[0].value, 'board-130');
  assert.equal(result.options.some((option) => option.value === 'board-100'), false);
});

test('searchable select never invents or implicitly chooses a value', () => {
  const result = searchableSelectResult(options, 'no match', '', 100);
  assert.equal(result.totalMatches, 0);
  assert.deepEqual(result.options, []);
});
