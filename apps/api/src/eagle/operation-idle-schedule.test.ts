import assert from 'node:assert/strict';
import test from 'node:test';
import { operationIdlePollDelay } from './operation-idle-schedule';
test('independent operation recovery backs off only to thirty seconds and honors a slower configured base', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 20].map((n) => operationIdlePollDelay(1000, n)),
    [1000, 2000, 4000, 8000, 16000, 30000, 30000],
  );
  assert.equal(operationIdlePollDelay(60_000, 20), 60_000);
});
