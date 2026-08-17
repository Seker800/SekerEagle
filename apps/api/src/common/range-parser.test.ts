import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseRangeHeader } from './range-parser';

test('parseRangeHeader accepts all legal single byte-range forms', () => {
  assert.equal(parseRangeHeader('bytes=10-20'), 'bytes=10-20');
  assert.equal(parseRangeHeader('bytes=10-'), 'bytes=10-');
  assert.equal(parseRangeHeader('bytes=-500'), 'bytes=-500');
});

test('parseRangeHeader still rejects malformed and multiple ranges', () => {
  assert.throws(() => parseRangeHeader('bytes=20-10'));
  assert.throws(() => parseRangeHeader('bytes=0-10,20-30'));
  assert.throws(() => parseRangeHeader('items=0-10'));
});
