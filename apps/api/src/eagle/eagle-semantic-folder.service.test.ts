import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleService } from './eagle.service';

const query = { version: 2, conditions: [], semantic: { text: '海边日落', breadth: 'BALANCED' } };

test('semantic preview reports unavailability rather than counting the entire library', async () => {
  const service = new EagleService(
    {} as never,
    { prepare: async () => ({ status: 'UNAVAILABLE' }) } as never,
    'PHOTO',
  );
  assert.deepEqual(await service.countAssets('owner', query), {
    count: null,
    semanticStatus: 'UNAVAILABLE',
    previewItems: [],
  });
});

test('semantic preview rechecks media revision, privacy, owner and mode when hydrating matches', async () => {
  const calls: Array<{ where: unknown }> = [];
  const raw: Array<{ strings: readonly string[]; values: unknown[] }> = [];
  const service = new EagleService(
    {
      $queryRaw: async (sql: (typeof raw)[number]) => {
        raw.push(sql);
        return [{ id: 'candidate', mediaRevision: 3 }];
      },
      eagleAsset: {
        findMany: async (args: { where: unknown }) => {
          calls.push(args);
          return [];
        },
      },
    } as never,
    {
      prepare: async () => ({ status: 'READY', spaceId: 'fixed-space', vector: '[1,0]' }),
    } as never,
    'PHOTO',
  );
  const result = await service.countAssets('owner', query, false);
  assert.deepEqual(result, { count: null, semanticStatus: 'READY', previewItems: [] });
  const where = calls[0]!.where as Record<string, unknown>;
  assert.equal(where.ownerId, 'owner');
  assert.equal(where.libraryMode, 'PHOTO');
  assert.equal(where.isPrivate, false);
  assert.equal(where.deletedAt, null);
  assert.match(JSON.stringify(where), /"mediaRevision":3/);
  const sql = raw[0]!.strings.join('?');
  assert.match(sql, /a\."mediaRevision"=e\."assetRevision"/);
  assert.match(sql, /NOT a\."isPrivate"/);
  assert.match(sql, /LIMIT 100/);
  assert.ok(raw[0]!.values.includes('owner'));
  assert.ok(raw[0]!.values.includes('PHOTO'));
});

test('saved semantic folders read scoped cached memberships and never request query inference', async () => {
  const calls: Array<{ where: unknown }> = [];
  const service = new EagleService(
    {
      eagleSmartFolder: {
        findFirst: async () => ({
          id: 'folder',
          queryJson: query,
          children: [{ id: 'child', queryJson: query }],
        }),
      },
      eagleAsset: {
        findMany: async (args: { where: unknown }) => {
          calls.push(args);
          return [];
        },
      },
    } as never,
    {
      prepare: async () => {
        throw new Error('Unexpected inference');
      },
    } as never,
    'PHOTO',
  );
  await service.listAssets('owner', { smartFolderId: 'folder', limit: 30 });
  const where = JSON.stringify(calls[0]!.where);
  assert.match(where, /"folderId":"folder"/);
  assert.match(where, /"folderId":"child"/);
  assert.match(where, /"isActive":true/);
  assert.match(where, /"libraryMode":"PHOTO"/);
  assert.match(where, /"ownerId":"owner"/);
  assert.match(where, /"isPrivate":false/);
});
