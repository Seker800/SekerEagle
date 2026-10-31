import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { EagleLibraryTransferService } from './eagle-library-transfer.service';
import { planTransferPyramid } from './eagle-transfer-pyramid';

test('unauthorized or mixed source IDs fail before any object copy or operation plan', async () => {
  let copied = 0;
  const db = {
    eagleLibraryTransfer: { findUnique: async () => null },
    eagleAsset: {
      findMany: async ({ where }: { where: unknown }) => {
        assert.deepEqual(where, {
          ownerId: 'owner',
          libraryMode: 'PHOTO',
          id: { in: ['foreign'] },
          deletedAt: null,
          isPrivate: false,
        });
        return [];
      },
    },
  } as never;
  const storage = {
    copyObject: async () => {
      copied++;
    },
  } as never;
  await assert.rejects(
    () =>
      new EagleLibraryTransferService(db, storage, 'PHOTO').send(
        'owner',
        { operationId: 'op', assetIds: ['foreign'] },
        false,
      ),
    NotFoundException,
  );
  assert.equal(copied, 0);
});

test('approval snapshot mismatch fails before a transfer plan or any object copy', async () => {
  let writes = 0;
  const db = {
    eagleLibraryTransfer: {
      findUnique: async () => null,
      create: async () => {
        writes++;
      },
    },
    eagleAsset: { findMany: async () => [{ id: 'photo', mediaRevision: 2, rowVersion: 1 }] },
  } as never;
  const storage = {
    copyObject: async () => {
      writes++;
    },
  } as never;
  await assert.rejects(
    new EagleLibraryTransferService(db, storage, 'PHOTO').send(
      'owner',
      { operationId: 'op', assetIds: ['photo'] },
      false,
      new Map([['photo', { mediaRevision: 1, rowVersion: 1 }]]),
    ),
    /照片已变化/,
  );
  assert.equal(writes, 0);
});

test('an edit between approval validation and plan creation cannot silently replace the approved version', async () => {
  let reads = 0,
    writes = 0;
  const db = {
    eagleLibraryTransfer: {
      findUnique: async () => null,
      create: async () => {
        writes++;
      },
    },
    eagleAssetRendition: { findMany: async () => [] },
    eagleImagePyramid: { findMany: async () => [] },
    eagleAsset: {
      findMany: async () => [
        {
          id: 'photo',
          mediaRevision: 1,
          rowVersion: ++reads === 1 ? 1 : 2,
          mimeType: 'image/jpeg',
          lifecycleStatus: 'READY',
        },
      ],
    },
  } as never;
  await assert.rejects(
    new EagleLibraryTransferService(
      db,
      {
        copyObject: async () => {
          writes++;
        },
      } as never,
      'PHOTO',
    ).send(
      'owner',
      { operationId: 'op', assetIds: ['photo'] },
      false,
      new Map([['photo', { mediaRevision: 1, rowVersion: 1 }]]),
    ),
    /照片已变化/,
  );
  assert.equal(reads, 2);
  assert.equal(writes, 0);
});

for (const sourceMode of ['PHOTO', 'MATERIAL'] as const)
  for (const handoff of [false, true])
    test(`sending ${sourceMode} current browse outputs ${handoff ? 'hands off exclusive object ownership without copies' : 'resumes a legacy copy plan'} and publishes a ready target`, async () => {
      const targetMode = sourceMode === 'PHOTO' ? 'MATERIAL' : 'PHOTO';
      const ownerId = '00000000-0000-4000-8000-000000000001';
      const sourceId = '00000000-0000-4000-8000-000000000002';
      const targetId = '00000000-0000-4000-8000-000000000003';
      const renditions = [
        ['PREVIEW', 'default'],
        ['THUMBNAIL', '256'],
        ['THUMBNAIL', '512'],
      ].map(([kind, variant], i) => ({
        id: `r${i}`,
        kind,
        variant,
        revision: 2,
        status: 'READY',
        storageKey: `users/${ownerId}/assets/${sourceId}/r${i}.webp`,
        mimeType: 'image/webp',
        byteSize: 1n,
        width: 512,
        height: 512,
      }));
      const plan = renditions.map((r) => ({
        ...r,
        byteSize: undefined,
        size: '1',
        sourceKey: r.storageKey,
        targetKey: `users/${ownerId}/assets/${targetId}/${r.id}.webp`,
      }));
      const source = {
        id: sourceId,
        ownerId,
        libraryMode: sourceMode,
        mediaRevision: 2,
        rowVersion: 1,
        originalObjectKey: `users/${ownerId}/assets/${sourceId}/original.jpg`,
        originalName: 'a.jpg',
        displayName: 'a',
        normalizedDisplayName: 'a',
        format: 'jpeg',
        mimeType: 'image/jpeg',
        lifecycleStatus: 'READY',
        annotation: null,
        renditions,
        imagePyramids: [
          {
            id: 'ready-pyramid',
            ownerId,
            libraryMode: sourceMode,
            assetId: sourceId,
            storagePrefix: `users/${ownerId}/assets/${sourceId}/ready-pyramid`,
            status: 'READY',
            revision: 2,
            processorVersion: 'pyramid-v1',
            width: 1,
            height: 1,
            tileSize: 512,
            overlap: 1,
            format: 'webp',
            maxLevel: 0,
            tileCount: 1,
            byteSize: 1n,
            completedAt: null,
          },
          {
            storagePrefix: `users/${ownerId}/assets/${sourceId}/old-pyramid`,
            status: 'FAILED',
            revision: 1,
          },
        ],
        width: 1000,
        height: 1000,
      };
      const pyramid = planTransferPyramid(ownerId, targetId, 2, source.imagePyramids as never)!;
      assert(pyramid);
      const operation = {
        id: 'op',
        ownerId,
        sourceMode,
        targetMode,
        sourceIds: [sourceId],
        status: 'COPYING',
        plan: [
          {
            sourceId,
            targetId,
            revision: 2,
            rowVersion: 1,
            sourceKey: source.originalObjectKey,
            targetKey: `users/${ownerId}/assets/${targetId}/original.jpg`,
            size: '1',
            renditions: plan,
            pyramid,
          },
        ],
      };
      if (handoff) {
        const item = operation.plan[0]!;
        Object.assign(item, { storageAction: 'HANDOFF', targetKey: source.originalObjectKey });
        for (const r of item.renditions) r.targetKey = r.sourceKey;
        item.pyramid.targetPrefix = item.pyramid.storagePrefix.replace(/\/+$/, '') + '/';
      }
      let heads = 0;
      const copies: string[][] = [];
      const created: Record<string, unknown>[] = [];
      const jobs: Array<{
        kind: string;
        processorVersion?: string;
        assetId: string;
        libraryMode: string;
      }> = [];
      let retired: Record<string, unknown> | undefined;
      let published: unknown[] = [];
      let publishedPyramid: Record<string, unknown> = {};
      let deletion: { objectKeys: string[]; prefixes: string[] } | undefined;
      const tx = {
        $queryRaw: async (query: unknown) =>
          sourceMode === 'MATERIAL' &&
          query &&
          typeof query === 'object' &&
          'sql' in query &&
          String(query.sql).includes('AS "assetId"')
            ? [{ assetId: sourceId, detailsReady: true }]
            : [],
        eagleLibraryTransfer: {
          findUnique: async () => operation,
          findUniqueOrThrow: async () => operation,
          update: async () => operation,
        },
        eagleAsset: {
          findMany: async () => [source],
          create: async ({ data }: { data: Record<string, unknown> }) => {
            created.push(data);
            return data;
          },
          updateMany: async ({ data }: { data: Record<string, unknown> }) => {
            retired = data;
            return { count: 1 };
          },
        },
        eagleObjectDeletion: {
          create: async ({ data }: { data: { objectKeys: string[]; prefixes: string[] } }) => {
            deletion = data;
          },
        },
        eagleImagePyramid: {
          deleteMany: async () => ({ count: 1 }),
          create: async ({ data }: { data: Record<string, unknown> }) => {
            publishedPyramid = data;
          },
        },
        eagleAssetTransferFacts: { create: async () => ({}) },
        eagleAssetRendition: {
          deleteMany: async () => ({ count: 3 }),
          createMany: async ({ data }: { data: unknown[] }) => {
            published = data;
          },
        },
        eagleAssetProcessingJob: {
          createMany: async ({ data }: { data: typeof jobs }) => {
            jobs.push(...data);
          },
        },
      };
      const db = { ...tx, $transaction: async (fn: (tx: unknown) => unknown) => fn(tx) };
      const service = new EagleLibraryTransferService(
        db as never,
        {
          copyObject: async (a: string, b: string) => {
            copies.push([a, b]);
          },
          headObject: async () => {
            heads++;
            return { ContentLength: 1 };
          },
        } as never,
        sourceMode,
      );
      await service.send(ownerId, { operationId: 'op', assetIds: [sourceId] }, false);
      assert.equal(copies.length, handoff ? 0 : 5);
      if (handoff)
        assert.equal(heads, 0, 'ownership handoff must perform no redundant storage reads');
      if (handoff) assert.equal(retired?.storageTransferredOut, true);
      assert.equal(
        publishedPyramid.storagePrefix,
        pyramid.targetPrefix.replace(/\/+$/, ''),
        'published directory must use the same canonical form as worker-created pyramids',
      );
      assert.ok(retired?.deletedAt instanceof Date);
      assert.ok(retired?.purgeAfter instanceof Date, 'sent source bypasses recoverable trash');
      assert.ok(retired?.transferredAt instanceof Date);
      assert.deepEqual(
        deletion?.objectKeys.sort(),
        handoff ? [] : [source.originalObjectKey, ...renditions.map((r) => r.storageKey)].sort(),
      );
      assert.deepEqual(
        deletion?.prefixes?.sort(),
        [
          `users/${ownerId}/assets/${sourceId}/old-pyramid/`,
          ...(handoff ? [] : [`users/${ownerId}/assets/${sourceId}/ready-pyramid/`]),
        ].sort(),
      );
      assert.ok(!deletion?.objectKeys.some((key) => key.includes(targetId)));
      assert.equal(created[0]!.libraryMode, targetMode);
      assert.equal(created[0]!.lifecycleStatus, 'READY');
      if (targetMode === 'PHOTO')
        assert(
          jobs.some((job) => job.processorVersion === 'photo-source-details-v1'),
          'editing details do not imply missing photography metadata is complete',
        );
      assert.equal(published.length, 3);
      assert.ok(
        !jobs.some(
          (j) => j.kind === 'GENERATE_RENDITIONS' && j.processorVersion === 'rendition-v2',
        ),
      );
    });

test('completed sends normalize IDs and replay selections larger than 100 without new writes', async () => {
  const ids = Array.from({ length: 101 }, (_, n) => `asset-${n}`).sort();
  const result = {
    targetMode: 'MATERIAL',
    movedCount: ids.length,
    componentCount: ids.length,
    assets: [],
  };
  const service = new EagleLibraryTransferService(
    {
      eagleLibraryTransfer: {
        findUnique: async () => ({
          id: 'journal',
          ownerId: 'owner',
          sourceMode: 'PHOTO',
          sourceIds: ids,
          status: 'COMPLETED',
          result,
        }),
      },
    } as never,
    {} as never,
    'PHOTO',
  );
  assert.deepEqual(
    await service.send('owner', { operationId: 'journal', assetIds: [...ids, ids[0]!] }, false),
    result,
  );
});
