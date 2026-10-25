import assert from 'node:assert/strict';
import test from 'node:test';
import { assetOperationState } from './asset-operations';
test('active work wins over partial failures, with explicit completed and stopped terminal states', () => {
  const base = { running: 0, queued: 0, failed: 0, cancelled: 0 };
  assert.equal(assetOperationState(base), 'COMPLETED');
  assert.equal(assetOperationState({ ...base, failed: 1 }), 'STOPPED');
  assert.equal(assetOperationState({ ...base, cancelled: 1 }), 'STOPPED');
  assert.equal(assetOperationState({ ...base, queued: 2, failed: 1 }), 'QUEUED');
  assert.equal(assetOperationState({ ...base, queued: 2, running: 1, failed: 1 }), 'RUNNING');
});
