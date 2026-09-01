import assert from 'node:assert/strict';
import test from 'node:test';

import { bandFor, resolveDisasters } from '../src/catalog.js';

test('four threshold bands and stable band are resolved correctly', () => {
  assert.equal(bandFor(1), 'criticalLow');
  assert.equal(bandFor(2), 'criticalLow');
  assert.equal(bandFor(6), 'low');
  assert.equal(bandFor(7), 'stable');
  assert.equal(bandFor(13), 'stable');
  assert.equal(bandFor(14), 'high');
  assert.equal(bandFor(18), 'criticalHigh');
  assert.equal(bandFor(19), 'criticalHigh');
});

test('disaster remains stable within one band and clears outside it', () => {
  const first = resolveDisasters({ economy: 14, environment: 10, society: 10 }, [], () => 0);
  const sameBand = resolveDisasters({ economy: 17, environment: 10, society: 10 }, first, () => 0.99);
  const cleared = resolveDisasters({ economy: 13, environment: 10, society: 10 }, sameBand, () => 0);
  assert.equal(first.length, 1);
  assert.equal(sameBand[0].id, first[0].id);
  assert.equal(sameBand[0].triggerValue, 17);
  assert.deepEqual(cleared, []);
});

test('a new tier can randomly choose one matching disaster', () => {
  const result = resolveDisasters({ economy: 10, environment: 18, society: 10 }, [], () => 0.99);
  assert.equal(result[0].id, 'reserve-expansion');
  assert.equal(result[0].band, 'criticalHigh');
});
