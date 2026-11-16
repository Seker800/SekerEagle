import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { BrowserOriginGuard } from '../auth/browser-origin.guard';
import { PhotosController } from '../photos/photo-library.module';
import { EagleController } from './eagle.controller';
import { EagleProcessingService } from './eagle-processing.service';

const assetId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';

test('asset retry is scoped to the authenticated owner, library mode and visibility', async () => {
  for (const mode of ['MATERIAL', 'PHOTO'] as const) {
    for (const includePrivate of [false, true]) {
      let query: unknown;
      const service = new EagleProcessingService(
        {
          eagleAssetProcessingJob: {
            findFirst: async (input: unknown) => {
              query = input;
              return { id: jobId };
            },
          },
        } as never,
        mode,
      );
      const calls: unknown[] = [];
      service.retry = (async (...args: unknown[]) => {
        calls.push(args);
        return { retried: 3 };
      }) as never;
      assert.deepEqual(await service.retryAsset('owner', assetId, includePrivate), { retried: 3 });
      assert.deepEqual(query, {
        where: {
          ownerId: 'owner',
          assetId,
          libraryMode: mode,
          status: 'FAILED',
          kind: { not: 'GENERATE_AI_TAGS' },
          ...(includePrivate ? {} : { asset: { isPrivate: false } }),
        },
        select: { id: true },
        orderBy: { updatedAt: 'desc' },
      });
      assert.deepEqual(calls, [['owner', jobId, includePrivate]]);
    }
  }
});

test('assets without a failed processing job return not found', async () => {
  const service = new EagleProcessingService(
    { eagleAssetProcessingJob: { findFirst: async () => null } } as never,
    'MATERIAL',
  );
  await assert.rejects(() => service.retryAsset('owner', assetId), NotFoundException);
});

test('the asset retry route takes identity from authentication and keeps origin protection', async () => {
  const calls: unknown[] = [];
  const processing = {
    retryAsset: async (...args: unknown[]) => {
      calls.push(args);
      return { retried: 1 };
    },
  };
  const controller = new EagleController(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    undefined,
    undefined,
    processing as never,
  );
  assert.deepEqual(
    await controller.retryAssetProcessing({ sub: 'owner', canViewPrivate: true } as never, assetId),
    { retried: 1 },
  );
  assert.deepEqual(calls, [['owner', assetId, true]]);
  for (const type of [EagleController, PhotosController]) {
    const handler = Reflect.get(type.prototype, 'retryAssetProcessing') as object;
    assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, handler), [BrowserOriginGuard]);
  }
});
