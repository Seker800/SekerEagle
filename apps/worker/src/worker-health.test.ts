import assert from 'node:assert/strict';
import test from 'node:test';
import { heartbeatIsFresh } from './worker-health';
test('worker health fails closed for stale or malformed heartbeats', () => {
  assert.equal(heartbeatIsFresh({ pid: 123, at: 99_000 }, 100_000), true);
  assert.equal(heartbeatIsFresh({ pid: 123, at: 54_000 }, 100_000), false);
  assert.equal(heartbeatIsFresh({ pid: 123, at: 101_000 }, 100_000), false);
  assert.equal(heartbeatIsFresh({}, 100_000), false);
});
