import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { LibraryCommandRegistry } from './eagle-library-command';
import { registerSharedLibraryCommands } from './eagle-shared-commands';
import { EagleService } from './eagle.service';
import { EagleVectorService } from './eagle-vector.service';

const context = {
  operationId: 'operation',
  ownerId: 'owner',
  libraryMode: 'PHOTO' as const,
  includePrivate: false,
  beforePublish: async () => undefined,
};
function registry(eagle = {}, vectors = {}) {
  const commands = new LibraryCommandRegistry();
  registerSharedLibraryCommands(commands, { eagle, privacy: {}, vectors, processing: {} } as never);
  return commands;
}

test('metadata batches keep explicit versions and execute in the engine publication transaction', async () => {
  const calls: unknown[] = [];
  const commands = registry({
    batchUpdate: async (...args: unknown[]) => {
      calls.push(args);
    },
  });
  const definition = commands.get('ASSET_UPDATE');
  const assets = Array.from({ length: 251 }, (_, index) => ({
    assetId: `a-${index}`,
    rowVersion: index + 1,
  }));
  const parts = definition.partition!(
    { rating: 5, assets },
    assets.map(({ assetId }) => assetId),
  );
  assert.deepEqual(
    parts.map((part) => part.assetIds.length),
    [100, 100, 51],
  );
  assert.deepEqual(
    parts.flatMap((part) => part.payload.assets),
    assets,
  );
  assert.equal(definition.protocol, 'METADATA');
  if (definition.protocol !== 'METADATA') return;
  const transaction = {} as never;
  await definition.apply(transaction, context, parts[1]!.payload, parts[1]!.assetIds);
  assert.deepEqual(calls, [['owner', parts[1]!.payload, false, transaction]]);
});

test('relative tag commands use current membership inside the supplied transaction', async () => {
  const calls: unknown[] = [];
  const commands = registry({
    batchChangeManualTags: async (...args: unknown[]) => {
      calls.push(args);
    },
  });
  const definition = commands.get('ASSET_TAGS');
  assert.equal(definition.protocol, 'METADATA');
  if (definition.protocol !== 'METADATA') return;
  const transaction = {} as never;
  await definition.apply(
    transaction,
    context,
    { addTagIds: ['tag'], removeTagIds: [], clearAll: false },
    ['a'],
  );
  assert.deepEqual(calls, [
    [
      'owner',
      { assetIds: ['a'], addTagIds: ['tag'], removeTagIds: [], clearAll: false },
      false,
      transaction,
    ],
  ]);
});

test('tag command admission rejects foreign owner or mode without locks or transactions', async () => {
  const reads: unknown[] = [];
  const service = new EagleService(
    {
      eagleManualTag: {
        count: async (query: unknown) => {
          reads.push(query);
          return 0;
        },
      },
    } as never,
    undefined,
    'PHOTO',
  );
  const definition = registry(service).get('ASSET_TAGS');
  await assert.rejects(
    async () => definition.admit!(context, { addTagIds: ['foreign'], removeTagIds: [] }, ['asset']),
    NotFoundException,
  );
  assert.deepEqual(reads, [
    { where: { ownerId: 'owner', libraryMode: 'PHOTO', id: { in: ['foreign'] } } },
  ]);
});

test('suggestion admission scopes owner, mode and private access before persisting intent', async () => {
  const reads: unknown[] = [];
  const vectors = new EagleVectorService(
    {
      eagleVectorTagSuggestion: {
        count: async (query: unknown) => {
          reads.push(query);
          return 0;
        },
      },
    } as never,
    'PHOTO',
  );
  const definition = registry({}, vectors).get('VECTOR_REVIEW');
  await assert.rejects(
    async () => definition.admit!(context, { suggestionIds: ['hidden'], action: 'ACCEPT' }, []),
    NotFoundException,
  );
  assert.deepEqual(reads, [
    {
      where: {
        ownerId: 'owner',
        libraryMode: 'PHOTO',
        id: { in: ['hidden'] },
        asset: {
          ownerId: 'owner',
          libraryMode: 'PHOTO',
          deletedAt: null,
          storageTransferredOut: false,
          isPrivate: false,
        },
      },
    },
  ]);
});

test('tag metadata publication reuses transaction rather than nesting or reading outside it', async () => {
  const transaction = {
    eagleManualTag: {
      findFirst: async (query: unknown) => {
        assert.deepEqual(query, {
          where: { ownerId: 'owner', id: 'missing', libraryMode: 'PHOTO' },
        });
        return null;
      },
    },
  };
  const service = new EagleService({} as never, undefined, 'PHOTO');
  await assert.rejects(
    service.updateManualTag('owner', 'missing', { rowVersion: 1 }, false, transaction as never),
    NotFoundException,
  );
});

test('terminal card facts omit inaccessible assets through the original scoped projection', async () => {
  const reads: Array<{ where: unknown }> = [];
  const service = new EagleService(
    {
      eagleAsset: {
        findMany: async (query: { where: unknown }) => {
          reads.push(query);
          return [];
        },
      },
    } as never,
    undefined,
    'PHOTO',
  );
  assert.deepEqual(await service.listAssetFacts('owner', ['foreign', 'private', 'deleted']), []);
  assert.deepEqual(reads[0]!.where, {
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    id: { in: ['foreign', 'private', 'deleted'] },
    deletedAt: null,
    isPrivate: false,
  });
  assert.deepEqual(await service.listAssetFacts('owner', ['private'], true), []);
  assert.deepEqual(reads[1]!.where, {
    ownerId: 'owner',
    libraryMode: 'PHOTO',
    id: { in: ['private'] },
    deletedAt: null,
  });
});

test('background vector publication stops before writes when the queued actor has been revoked', async () => {
  let writes = 0;
  const transaction = {
    $executeRaw: async () => {
      writes += 1;
      return 0;
    },
  };
  const service = new EagleVectorService(
    {
      $transaction: async (work: (tx: typeof transaction) => Promise<unknown>) => work(transaction),
    } as never,
    'PHOTO',
  );
  await assert.rejects(
    service.scanMissingEmbeddings('owner', false, async (tx) => {
      assert.equal(tx, transaction);
      throw new NotFoundException('actor revoked');
    }),
    NotFoundException,
  );
  assert.equal(writes, 0);
});
