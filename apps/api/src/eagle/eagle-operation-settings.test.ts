import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPERATION_ADMISSION_TIMEOUT_MS,
  OPERATION_METADATA_BATCH_SIZE,
  operationSetting,
} from './eagle-operation-settings';

test('large admission and metadata work use configurable resource budgets rather than item quotas', () => {
  assert.equal(
    OPERATION_ADMISSION_TIMEOUT_MS,
    Number(process.env.EAGLE_OPERATION_ADMISSION_TIMEOUT_MS ?? 120000),
  );
  assert.equal(
    OPERATION_METADATA_BATCH_SIZE,
    Number(process.env.EAGLE_OPERATION_METADATA_BATCH_SIZE ?? 32),
  );
  const key = 'EAGLE_OPERATION_TEST_BUDGET';
  const before = process.env[key];
  try {
    process.env[key] = '1024';
    assert.equal(operationSetting(key, 512), 1024);
    process.env[key] = '0';
    assert.throws(() => operationSetting(key, 512), /positive integer/);
  } finally {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  }
});
