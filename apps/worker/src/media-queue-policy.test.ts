import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaQueueAgeOrder } from './media-queue-policy';

test('new uploads lead fifteen turns and history gets one opportunity without interrupting current work', () => {
  for (let i = 0; i < 15; i++) assert.deepEqual(mediaQueueAgeOrder(i), ['RECENT', undefined]);
  assert.deepEqual(mediaQueueAgeOrder(15), ['HISTORY', 'RECENT', undefined]);
  assert.deepEqual(mediaQueueAgeOrder(16), ['RECENT', undefined]);
});
