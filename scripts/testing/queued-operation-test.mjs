import assert from 'node:assert/strict';
import { createAssetOperationExecutors } from '../../apps/api/dist/asset-operation-executor.js';

/** HTTP must only accept intent; this independent executor advances the original durable protocol. */
export async function executeAcceptedOperation(prisma, ownerId, receipt, expectedFailed = 0) {
  assert.ok(receipt.id);
  assert.equal(receipt.state, 'QUEUED');
  const storage = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('metadata HTTP acceptance test touched object storage');
      },
    },
  );
  const executor = createAssetOperationExecutors(prisma, storage)[
    receipt.libraryMode === 'MATERIAL' ? 0 : 1
  ];
  let summary;
  for (let turn = 0; turn < 1000; turn++) {
    await executor.tick(false);
    summary = (await executor.list(ownerId, true)).find((op) => op.id === receipt.id);
    assert.ok(summary);
    if (!summary.queued && !summary.running) break;
  }
  assert.equal(summary.failed, expectedFailed);
  assert.equal(summary.state, expectedFailed ? 'STOPPED' : 'COMPLETED');
  return summary;
}
