import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { EagleImportsService } from './eagle-app-import.service';
import { PrismaEagleImportsRepository } from './adapters/prisma/eagle-app-import.repository';

const createRepository = (prisma: unknown) =>
  new PrismaEagleImportsRepository(prisma as never, { applyMetadata: async () => undefined });
const createService = (prisma: unknown) => new EagleImportsService(createRepository(prisma));

test('creates an owner-scoped import run and replays the same idempotency key safely', async () => {
  const writes: unknown[] = [];
  const existingRun = {
    id: 'run-1',
    ownerId: 'owner-a',
    externalLibraryId: 'library-1',
    idempotencyKey: 'request-1',
    manifestVersion: 1,
    status: 'DRAFT',
    declaredItemCount: 2,
    declaredByteSize: 300n,
    declarationHash: null,
    externalLibrary: { externalLibraryId: 'eagle-library-a' },
  };
  let replay = false;
  const prisma: any = {
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work(prisma),
    eagleExternalLibrary: {
      upsert: async () => ({ id: 'library-1' }),
    },
    eagleImportRun: {
      findUnique: async () => (replay ? existingRun : null),
      create: async (args: unknown) => {
        writes.push(args);
        replay = true;
        return existingRun;
      },
    },
  };
  const service = createService(prisma);
  const input = {
    idempotencyKey: 'request-1',
    manifestVersion: 1,
    externalLibraryId: 'eagle-library-a',
    libraryName: '素材库',
    sourceModifiedAt: null,
    declaredItemCount: 2,
    declaredByteSize: 300,
  };

  assert.equal((await service.createRun('owner-a', input)).id, 'run-1');
  assert.equal((await service.createRun('owner-a', input)).id, 'run-1');
  assert.equal(writes.length, 1);
});

test('rejects an idempotency-key replay whose immutable declaration changed', async () => {
  const prisma: any = {
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work(prisma),
    eagleExternalLibrary: { upsert: async () => ({ id: 'library-1' }) },
    eagleImportRun: {
      findUnique: async () => ({
        id: 'run-1',
        externalLibraryId: 'library-1',
        manifestVersion: 1,
        declaredItemCount: 99,
        declaredByteSize: 300n,
        declarationHash: null,
        externalLibrary: { externalLibraryId: 'eagle-library-a' },
      }),
    },
  };
  const service = createService(prisma);

  await assert.rejects(
    service.createRun('owner-a', {
      idempotencyKey: 'request-1',
      manifestVersion: 1,
      externalLibraryId: 'eagle-library-a',
      libraryName: '素材库',
      sourceModifiedAt: null,
      declaredItemCount: 2,
      declaredByteSize: 300,
    }),
    ConflictException,
  );
});

test('recovers a concurrent create-run replay from the database uniqueness boundary', async () => {
  const existingRun = {
    id: 'run-1',
    externalLibraryId: 'library-1',
    idempotencyKey: 'request-1',
    manifestVersion: 1,
    status: 'DRAFT',
    declaredItemCount: 2,
    declaredByteSize: 300n,
    declarationHash: null,
    externalLibrary: { externalLibraryId: 'eagle-library-a' },
  };
  let transactionFinished = false;
  const prisma: any = {
    $transaction: async (work: (transaction: unknown) => Promise<unknown>) => {
      try {
        return await work(prisma);
      } finally {
        transactionFinished = true;
      }
    },
    eagleExternalLibrary: { upsert: async () => ({ id: 'library-1' }) },
    eagleImportRun: {
      findUnique: async () => (transactionFinished ? existingRun : null),
      create: async () => {
        throw Object.assign(new Error('unique'), { code: 'P2002' });
      },
    },
  };
  const service = createService(prisma);

  const result = await service.createRun('owner-a', {
    idempotencyKey: 'request-1',
    manifestVersion: 1,
    externalLibraryId: 'eagle-library-a',
    libraryName: '素材库',
    sourceModifiedAt: null,
    declaredItemCount: 2,
    declaredByteSize: 300,
  });

  assert.equal(result.id, 'run-1');
});

test('preflight refuses incomplete manifests before allowing any upload', async () => {
  let rawCall = 0;
  const transaction = {
    $queryRaw: async () => {
      rawCall += 1;
      return rawCall === 1
        ? [{ id: 'run-1' }]
        : [
            {
              itemCount: 1n,
              byteSize: 100n,
              readyItemCount: 1n,
              alreadyImportedItemCount: 0n,
              skippedDeletedItemCount: 0n,
              skippedUnsupportedItemCount: 0n,
              warningCount: 0n,
              newItemCount: 1n,
              unchangedItemCount: 0n,
              metadataUpdateItemCount: 0n,
              contentReplaceItemCount: 0n,
              uploadItemCount: 1n,
              uploadByteSize: 100n,
              missingFolderIds: [],
            },
          ];
    },
    eagleImportRun: {
      findFirst: async () => ({
        id: 'run-1',
        ownerId: 'owner-a',
        status: 'DRAFT',
        declaredItemCount: 2,
        declaredByteSize: 300n,
      }),
    },
    eagleImportRunItem: {
      findMany: async () => [],
    },
  };
  const service = createService({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as never);

  await assert.rejects(service.preflight('owner-a', 'run-1'), BadRequestException);
});

test('preflight locks the run and summarizes a large manifest inside one transaction', async () => {
  const rawQueries: unknown[] = [];
  const transaction = {
    $queryRaw: async (query: unknown) => {
      rawQueries.push(query);
      return rawQueries.length === 1
        ? [{ id: 'run-1' }]
        : [
            {
              itemCount: 100_000n,
              byteSize: 500_000n,
              readyItemCount: 100_000n,
              alreadyImportedItemCount: 0n,
              skippedDeletedItemCount: 0n,
              skippedUnsupportedItemCount: 0n,
              warningCount: 0n,
              newItemCount: 100_000n,
              unchangedItemCount: 0n,
              metadataUpdateItemCount: 0n,
              contentReplaceItemCount: 0n,
              uploadItemCount: 100_000n,
              uploadByteSize: 500_000n,
              missingFolderIds: [],
            },
          ];
    },
    eagleImportRun: {
      findFirst: async () => ({
        id: 'run-1',
        status: 'DRAFT',
        declaredItemCount: 100_000,
        declaredByteSize: 500_000n,
      }),
      update: async () => undefined,
    },
    eagleImportRunItem: {
      findMany: async (args: { take?: number }) => {
        assert.equal(args.take, 200);
        return [];
      },
    },
  };
  const service = createService({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as never);

  const result = await service.preflight('owner-a', 'run-1');

  assert.equal(result.itemCount, 100_000);
  assert.equal(rawQueries.length, 2);
});

test('manifest staging locks the run and queues changed metadata for an existing source asset', async () => {
  const callOrder: string[] = [];
  const itemWrites: Array<Record<string, unknown>> = [];
  const externalAssetWrites: unknown[] = [];
  const runWrites: Array<Record<string, unknown>> = [];
  const transaction: any = {
    $queryRaw: async () => {
      callOrder.push('lock');
      return [{ id: 'run-1' }];
    },
    $executeRaw: async () => 1,
    eagleImportRun: {
      findFirst: async () => {
        callOrder.push('run');
        return {
          id: 'run-1',
          externalLibraryId: 'library-1',
          status: 'DRAFT',
          createdAt: new Date('2026-08-14T00:00:00.000Z'),
        };
      },
      update: async (args: { data: Record<string, unknown> }) => runWrites.push(args.data),
    },
    eagleImportManifestChunk: {
      findUnique: async () => null,
      create: async () => undefined,
    },
    eagleImportFolderDefinition: {
      findMany: async () => [],
      createMany: async () => undefined,
      upsert: async () => undefined,
    },
    eagleImportTagDefinition: {
      findMany: async () => [],
      createMany: async () => undefined,
      upsert: async () => undefined,
    },
    eagleImportTagGroupDefinition: {
      findMany: async () => [],
      createMany: async () => undefined,
      upsert: async () => undefined,
    },
    eagleExternalAsset: {
      findMany: async () => [
        { id: 'external-1', externalItemId: 'item-1', assetId: 'asset-1', metadataHash: 'old' },
      ],
      update: async (input: unknown) => externalAssetWrites.push(input),
      createMany: async () => undefined,
      upsert: async () => ({
        id: 'external-1',
        externalItemId: 'item-1',
        assetId: 'asset-1',
        metadataHash: 'old',
      }),
    },
    eagleImportRunItem: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async (args: { data: Record<string, unknown> }) => itemWrites.push(args.data),
      createMany: async (args: { data: Array<Record<string, unknown>> }) => {
        itemWrites.push(...args.data);
      },
      groupBy: async () => {
        throw new Error('manifest staging must not recount the complete run');
      },
    },
  };
  const service = createService({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as never);

  await service.stageManifestChunk('owner-a', 'run-1', {
    manifestVersion: 1,
    chunkKey: 'chunk-1',
    folders: [],
    tags: [],
    tagGroups: [],
    items: [
      {
        sourceItemId: 'item-1',
        name: 'changed',
        originalFileName: 'poster.png',
        extension: 'png',
        mimeType: 'image/png',
        size: 100,
        importedAt: 1_700_000_000_000,
        modifiedAt: null,
        star: 5,
        annotation: 'changed',
        sourceUrl: '',
        tagNames: [],
        folderIds: [],
        isDeleted: false,
      },
    ],
  });

  assert.equal(callOrder[0], 'lock');
  assert.equal(itemWrites[0]!.status, 'STAGED');
  assert.equal(itemWrites[0]!.assetId, 'asset-1');
  assert.deepEqual(externalAssetWrites, []);
  assert.deepEqual(runWrites, [{ stagedItemCount: { increment: 1 } }]);
});

test('manifest staging rejects a definition that changes across chunks', async () => {
  const transaction: any = {
    $queryRaw: async () => [{ id: 'run-1' }],
    eagleImportRun: {
      findFirst: async () => ({
        id: 'run-1',
        externalLibraryId: 'library-1',
        status: 'DRAFT',
        createdAt: new Date(),
      }),
    },
    eagleImportManifestChunk: { findUnique: async () => null },
    eagleImportFolderDefinition: {
      findMany: async () => [
        { sourceFolderId: 'folder-1', name: '旧名称', parentSourceFolderId: null },
      ],
    },
    eagleImportTagDefinition: { findMany: async () => [] },
    eagleImportTagGroupDefinition: { findMany: async () => [] },
  };
  const service = createService({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as never);

  await assert.rejects(
    service.stageManifestChunk('owner-a', 'run-1', {
      manifestVersion: 1,
      chunkKey: 'chunk-2',
      folders: [{ sourceId: 'folder-1', name: '新名称', parentSourceId: null }],
      tags: [],
      tagGroups: [],
      items: [],
    }),
    ConflictException,
  );
});

test('reconcile uses database aggregation instead of loading every import item', async () => {
  const transaction = {
    eagleImportRun: {
      findFirst: async () => ({
        id: 'run-1',
        stagedItemCount: 1,
        importedItemCount: 2,
        skippedItemCount: 3,
        failedItemCount: 4,
      }),
    },
    eagleImportRunItem: {
      groupBy: async () => [
        { status: 'STAGED', _count: { _all: 1 } },
        { status: 'IMPORTED', _count: { _all: 2 } },
        { status: 'SKIPPED', _count: { _all: 3 } },
        { status: 'FAILED', _count: { _all: 4 } },
      ],
      findMany: async () => {
        throw new Error('reconcile must not materialize the full run');
      },
    },
    $queryRaw: async () => [
      {
        staleMappings: 0n,
        orphanedActiveSessions: 0n,
        expiredActiveSessions: 0n,
        completedSessionsPendingConvergence: 0n,
        contentHashMismatches: 0n,
      },
    ],
  };
  const service = createService(transaction);

  const result = await service.reconcile('owner-a', 'run-1');

  assert.equal(result.consistent, true);
});

test('retry moves only failed items back to staged and increments no upload attempt prematurely', async () => {
  const callOrder: string[] = [];
  const writes: unknown[] = [];
  const runWrites: Array<Record<string, unknown>> = [];
  const transaction = {
    $queryRaw: async () => {
      callOrder.push('lock');
      return [{ id: 'item-1' }];
    },
    eagleImportRunItem: {
      findFirst: async () => {
        callOrder.push('read');
        return {
          id: 'item-1',
          runId: 'run-1',
          status: 'FAILED',
          terminalProgressAppliedAt: new Date('2026-08-16T00:00:00.000Z'),
          run: { status: 'RUNNING' },
        };
      },
      update: async (args: unknown) => {
        writes.push(args);
        return { id: 'item-1', status: 'STAGED', attemptCount: 2 };
      },
      groupBy: async () => {
        throw new Error('retry must not recount the complete run');
      },
    },
    eagleImportRun: {
      update: async (args: { data: Record<string, unknown> }) => {
        runWrites.push(args.data);
        return { id: 'run-1', status: 'RUNNING' };
      },
    },
  };
  const service = createService({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as never);

  const result = await service.retryItem('owner-a', 'run-1', 'item-1');
  assert.equal(result.status, 'STAGED');
  assert.deepEqual(callOrder.slice(0, 3), ['lock', 'lock', 'read']);
  assert.deepEqual((writes[0] as { data: unknown }).data, {
    status: 'STAGED',
    activeUploadSessionId: null,
    errorCode: null,
    errorMessage: null,
    terminalProgressAppliedAt: null,
    completedAt: null,
  });
  assert.deepEqual(runWrites, [
    {
      stagedItemCount: { increment: 1 },
      failedItemCount: { decrement: 1 },
      status: 'RUNNING',
      completedAt: null,
    },
  ]);
});

test('replacing a stale upload session restores the staged counter before rebinding', async () => {
  const runWrites: Array<Record<string, unknown>> = [];
  const itemWrites: unknown[] = [];
  const lockQueries: string[] = [];
  const transaction = {
    $queryRaw: async (query: { strings: string[] }) => {
      lockQueries.push(query.strings.join(''));
      return [{ id: 'item-1' }];
    },
    eagleImportRunItem: {
      findFirst: async () => ({
        status: 'UPLOADING',
        action: 'NEW',
        contentSha256: 'a'.repeat(64),
        assetId: null,
        activeUploadSessionId: 'session-stale',
        run: { status: 'RUNNING' },
      }),
      update: async (args: unknown) => {
        itemWrites.push(args);
        return { id: 'item-1' };
      },
    },
    uploadSession: {
      findFirst: async () => ({
        status: 'ABORTED',
        createdAt: new Date(),
        finalizationAttempts: 0,
      }),
    },
    eagleUploadSessionState: { updateMany: async () => ({ count: 1 }) },
    eagleImportRun: {
      update: async (args: { data: Record<string, unknown> }) => {
        runWrites.push(args.data);
        return { id: 'run-1' };
      },
    },
  };
  const repository = createRepository({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  });

  const result = await repository.prepareUploadStart('owner-a', 'run-1', 'item-1');

  assert.equal(result.kind, 'CREATE');
  assert.equal(lockQueries.length, 1);
  assert.match(lockQueries[0]!, /EagleImportRunItem/);
  assert.doesNotMatch(lockQueries[0]!, /FROM "EagleImportRun"/);
  assert.deepEqual((itemWrites[0] as { data: unknown }).data, {
    status: 'STAGED',
    activeUploadSessionId: null,
  });
  assert.deepEqual(runWrites, [{ stagedItemCount: { increment: 1 } }]);
});

test('projects terminal import item progress in one recoverable batch', async () => {
  const runWrites: Array<Record<string, unknown>> = [];
  const itemWrites: unknown[] = [];
  let runUpdate = 0;
  const transaction = {
    $queryRaw: async () => [
      { id: 'item-1', ownerId: 'owner-a', runId: 'run-1', status: 'IMPORTED' },
      { id: 'item-2', ownerId: 'owner-a', runId: 'run-1', status: 'IMPORTED' },
      { id: 'item-3', ownerId: 'owner-a', runId: 'run-1', status: 'FAILED' },
    ],
    eagleImportRun: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        runWrites.push(data);
        runUpdate += 1;
        return runUpdate === 1
          ? {
              status: 'RUNNING',
              importedItemCount: 2,
              skippedItemCount: 0,
              failedItemCount: 1,
            }
          : undefined;
      },
    },
    eagleImportRunItem: {
      updateMany: async (input: unknown) => {
        itemWrites.push(input);
        return { count: 3 };
      },
      findFirst: async () => null,
    },
  };
  const repository = createRepository({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  });

  assert.equal(await repository.projectTerminalItemProgress(500), 3);
  assert.deepEqual(runWrites[0], {
    importedItemCount: { increment: 2 },
    failedItemCount: { increment: 1 },
    lastErrorCode: 'ITEM_FAILED',
  });
  assert.equal(runWrites[1]!.status, 'PARTIAL');
  assert.ok(runWrites[1]!.completedAt instanceof Date);
  assert.deepEqual((itemWrites[0] as { where: unknown }).where, {
    id: { in: ['item-1', 'item-2', 'item-3'] },
    terminalProgressAppliedAt: null,
  });
});

test('upload binding uses an owner-scoped conditional claim to reject concurrent sessions', async () => {
  const transaction = {
    eagleImportRunItem: {
      findFirst: async () => ({
        id: 'item-1',
        runId: 'run-1',
        originalFileName: 'poster.png',
        mimeType: 'image/png',
        byteSize: 100n,
        status: 'STAGED',
        action: 'NEW',
        assetId: null,
        contentSha256: 'a'.repeat(64),
        run: { status: 'PREFLIGHTED', startedAt: null },
      }),
      updateMany: async () => ({ count: 0 }),
    },
  };
  const repository = createRepository({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  });

  await assert.rejects(
    repository.bindUploadSession({
      ownerId: 'owner-a',
      runId: 'run-1',
      runItemId: 'item-1',
      uploadSessionId: 'session-1',
      fileName: 'poster.png',
      mimeType: 'image/png',
      size: 100n,
    }),
    ConflictException,
  );
});

test('upload binding records the session that exclusively owns the import attempt', async () => {
  const claims: unknown[] = [];
  const runWrites: Array<Record<string, unknown>> = [];
  const transaction = {
    eagleImportRunItem: {
      findFirst: async () => ({
        id: 'item-1',
        runId: 'run-1',
        originalFileName: 'poster.png',
        mimeType: 'image/png',
        byteSize: 100n,
        status: 'STAGED',
        run: { status: 'PREFLIGHTED', startedAt: null },
      }),
      updateMany: async (args: unknown) => {
        claims.push(args);
        return { count: 1 };
      },
    },
    eagleUploadSessionState: { update: async () => undefined },
    eagleImportRun: {
      update: async (args: { data: Record<string, unknown> }) => runWrites.push(args.data),
    },
  };
  const repository = createRepository({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  });

  await repository.bindUploadSession({
    ownerId: 'owner-a',
    runId: 'run-1',
    runItemId: 'item-1',
    uploadSessionId: 'session-1',
    fileName: 'poster.png',
    mimeType: 'image/png',
    size: 100n,
  });

  assert.deepEqual((claims[0] as { data: unknown }).data, {
    status: 'UPLOADING',
    activeUploadSessionId: 'session-1',
    attemptCount: { increment: 1 },
  });
  assert.deepEqual(runWrites[0]!.stagedItemCount, { decrement: 1 });
  assert.equal(runWrites[0]!.status, 'RUNNING');
  assert.ok(runWrites[0]!.startedAt instanceof Date);
});

test('a transient upload finalization failure remains recoverable by the same session', async () => {
  const itemWrites: unknown[] = [];
  const transaction = {
    eagleImportRunItem: {
      findFirst: async () => ({
        id: 'item-1',
        runId: 'run-1',
        status: 'UPLOADING',
        activeUploadSessionId: 'session-1',
        run: { status: 'RUNNING' },
      }),
      updateMany: async (args: unknown) => {
        itemWrites.push(args);
        return { count: 1 };
      },
      groupBy: async () => [{ status: 'UPLOADING', _count: { _all: 1 } }],
      count: async () => 1,
    },
    eagleImportRun: { update: async () => undefined },
  };
  const service = createService({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as never);

  await service.markUploadFailed('owner-a', 'session-1', new Error('temporary'), {
    terminal: false,
    permanent: false,
  });

  assert.equal((itemWrites[0] as { data: { status?: string } }).data.status, undefined);
  assert.equal(
    (itemWrites[0] as { where: { activeUploadSessionId: string } }).where.activeUploadSessionId,
    'session-1',
  );
});

test('a terminal failure ignores stale upload sessions before mutating the current attempt', async () => {
  const runWrites: unknown[] = [];
  const transaction = {
    eagleImportRunItem: {
      findFirst: async () => ({
        id: 'item-1',
        runId: 'run-1',
        status: 'UPLOADING',
        activeUploadSessionId: 'session-current',
        run: { status: 'CANCELLED' },
      }),
      updateMany: async () => ({ count: 0 }),
      groupBy: async () => [],
      count: async () => 0,
    },
    eagleImportRun: { update: async (args: unknown) => runWrites.push(args) },
  };
  const service = createService({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as never);

  await service.markUploadFailed('owner-a', 'session-stale', new Error('terminal'), {
    terminal: true,
    permanent: false,
  });

  assert.equal(runWrites.length, 0);
});

test('a terminal failure from the active session never reopens a cancelled run', async () => {
  const runWrites: Array<{ data: Record<string, unknown> }> = [];
  const transaction = {
    eagleImportRunItem: {
      findFirst: async () => ({
        id: 'item-1',
        runId: 'run-1',
        status: 'UPLOADING',
        activeUploadSessionId: 'session-1',
        run: { status: 'CANCELLED' },
      }),
      updateMany: async () => ({ count: 1 }),
      groupBy: async () => [{ status: 'FAILED', _count: { _all: 1 } }],
      count: async () => 0,
    },
    eagleImportRun: {
      update: async (args: { data: Record<string, unknown> }) => {
        runWrites.push(args);
        return {
          status: 'CANCELLED',
          importedItemCount: 0,
          skippedItemCount: 0,
          failedItemCount: 1,
        };
      },
    },
  };
  const service = createService({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as never);

  await service.markUploadFailed('owner-a', 'session-1', new Error('terminal'), {
    terminal: true,
    permanent: false,
  });

  assert.equal(runWrites.length, 1);
  assert.equal('status' in runWrites[0]!.data, false);
});
