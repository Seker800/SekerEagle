import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASSET_OPERATION_KINDS,
  ASSET_OPERATION_PROTOCOLS,
  DIRECT_ASSET_OPERATION_KINDS,
  assetOperationProtocol,
  assetOperationState,
} from './asset-operations';
test('active work wins over partial failures, with explicit completed and stopped terminal states', () => {
  const base = { running: 0, queued: 0, failed: 0, cancelled: 0 };
  assert.equal(assetOperationState(base), 'COMPLETED');
  assert.equal(assetOperationState({ ...base, failed: 1 }), 'STOPPED');
  assert.equal(assetOperationState({ ...base, cancelled: 1 }), 'STOPPED');
  assert.equal(assetOperationState({ ...base, queued: 2, failed: 1 }), 'QUEUED');
  assert.equal(assetOperationState({ ...base, queued: 2, running: 1, failed: 1 }), 'RUNNING');
});

test('operation registration is exhaustive and direct admission is an explicit closed list', () => {
  assert.deepEqual(
    Object.keys(ASSET_OPERATION_PROTOCOLS).sort(),
    [...ASSET_OPERATION_KINDS].sort(),
  );
  assert.deepEqual(DIRECT_ASSET_OPERATION_KINDS, ['SEND', 'TRASH', 'RESTORE', 'EMPTY_TRASH']);
  assert.equal(assetOperationProtocol('FUTURE_KIND'), undefined);
  assert.equal(assetOperationProtocol('__proto__'), undefined);
  assert.equal(assetOperationProtocol('constructor'), undefined);
  assert.equal(assetOperationProtocol('TRASH')?.execution, 'METADATA');
  assert.equal(assetOperationProtocol('SEND')?.execution, 'TRANSFER');
  assert.equal(assetOperationProtocol('DUPLICATE_SCAN')?.execution, 'SCAN');
  assert.equal(assetOperationProtocol('EMPTY_TRASH')?.execution, 'CUTOFF');
  assert.equal(assetOperationProtocol('DUPLICATE_CLEANUP')?.compensation, 'RESTORE');
});
