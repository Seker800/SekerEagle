import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleImportService } from './eagle-import.service';

test('serializes an already-finished import item without leaking relation BigInts', async () => {
  const prisma: any = {
    eagleImportRunItem: {
      findFirst: async () => ({
        id: 'item-a',
        ownerId: 'owner-a',
        runId: 'run-a',
        status: 'IMPORTED',
        assetId: 'asset-a',
        byteSize: 96n,
        externalAsset: { id: 'external-a', sourceByteSize: 96n },
      }),
    },
  };
  const service = new EagleImportService(prisma as never);

  const result = await service.finishItem('owner-a', 'run-a', 'item-a', 'asset-a');

  assert.equal(result.byteSize, 96);
  assert.equal('externalAsset' in result, false);
  assert.doesNotThrow(() => JSON.stringify(result));
});
