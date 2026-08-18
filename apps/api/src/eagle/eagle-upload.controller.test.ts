import assert from 'node:assert/strict';
import test from 'node:test';
import { THROTTLER_SKIP } from '@nestjs/throttler/dist/throttler.constants';
import { EagleImportController } from './eagle-import.controller';
import { EagleUploadController } from './eagle-upload.controller';

test('bulk import controllers bypass generic request throttles without weakening auth guards', () => {
  for (const controller of [EagleImportController, EagleUploadController]) {
    assert.equal(Reflect.getMetadata(`${THROTTLER_SKIP}short`, controller), true);
    assert.equal(Reflect.getMetadata(`${THROTTLER_SKIP}default`, controller), true);
  }
});

test('completed uploads converge their bound original import item', async () => {
  const finalized: unknown[] = [];
  const controller = new EagleUploadController(
    {
      complete: async () => ({
        uploadSessionId: 'session-1',
        assetId: 'asset-1',
        status: 'PROCESSING',
      }),
    } as never,
    {
      finalizeUpload: async (...args: unknown[]) => {
        finalized.push(args);
      },
    } as never,
  );

  const result = await controller.complete({ sub: ownerId } as never, 'session-1', {
    parts: [{ partNumber: 1, etag: 'etag-1' }],
  });

  assert.equal(result.assetId, 'asset-1');
  assert.deepEqual(finalized, [[ownerId, 'session-1', 'asset-1']]);
});

const ownerId = '5a1fd7d1-fd57-4e42-83f7-55425ca8704a';
