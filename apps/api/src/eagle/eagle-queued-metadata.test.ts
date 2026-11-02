import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { LibraryCommandRegistry } from './eagle-library-command';
import { registerSharedLibraryCommands } from './eagle-shared-commands';

test('absolute edits rebase only on the exact version published by a predecessor accepted before this command', async () => {
  let published = false;
  const tx = {
    eagleAsset: { findMany: async () => [{ id: 'asset', rowVersion: 2 }] },
    eagleAssetOperationItem: {
      findMany: async () => [
        {
          operationId: 'first',
          snapshots: { publishedVersions: [{ assetId: 'asset', rowVersion: 2 }] },
        },
      ],
    },
    $executeRaw: async () => {
      published = true;
      return 1;
    },
  };
  const eagle = {
    batchUpdate: async (_owner: string, input: { assets: Array<{ rowVersion: number }> }) => {
      assert.equal(
        input.assets[0]!.rowVersion,
        2,
        'own queued predecessor must not cause a false version conflict',
      );
      return { assets: [{ assetId: 'asset', rowVersion: 3 }] };
    },
  };
  const registry = new LibraryCommandRegistry();
  registerSharedLibraryCommands(registry, {
    eagle,
    privacy: {},
    vectors: {},
    processing: {},
  } as never);
  const definition = registry.get('ASSET_UPDATE');
  assert.equal(definition.protocol, 'METADATA');
  if (definition.protocol !== 'METADATA') return;
  await definition.apply(
    tx as never,
    {
      ownerId: 'owner',
      operationId: 'second',
      libraryMode: 'MATERIAL',
      includePrivate: false,
      beforePublish: async () => undefined,
    },
    {
      assets: [{ assetId: 'asset', rowVersion: 1 }],
      description: 'new description',
      queueBase: [{ assetId: 'asset', rowVersion: 1, predecessors: ['first'] }],
    },
    ['asset'],
  );
  assert.ok(published, 'the new version receipt belongs to the same publication transaction');
});
