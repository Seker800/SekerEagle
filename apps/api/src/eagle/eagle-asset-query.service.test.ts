import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeEagleAssetCursor } from './eagle-cursor';
import { EagleService } from './eagle.service';

test('a parent smart folder evaluates itself and its direct children as a union', async () => {
  const queries: Array<{ where: Record<string, unknown> }> = [];
  const service = new EagleService({
    eagleSmartFolder: {
      findFirst: async () => ({
        queryJson: { version: 1, filters: { rating: 4 } },
        children: [{ queryJson: { version: 1, filters: { formats: ['png'] } } }],
      }),
    },
    eagleAsset: {
      findMany: async (query: { where: Record<string, unknown> }) => {
        queries.push(query);
        return [];
      },
    },
  } as never);

  await service.listAssets('owner-1', { smartFolderId: 'folder-1', limit: 30 });

  const topLevelAnd = queries[0]?.where.AND as Array<Record<string, unknown>>;
  const folderUnion = topLevelAnd[1]?.OR as unknown[];
  assert.equal(folderUnion.length, 2);
});

test('an empty smart folder matches no assets', async () => {
  const queries: Array<{ where: Record<string, unknown> }> = [];
  const service = new EagleService({
    eagleSmartFolder: {
      findFirst: async () => ({
        queryJson: {
          version: 2,
          conditions: [
            {
              id: 'condition-1',
              match: 'ANY',
              result: 'MATCH',
              rules: [
                {
                  id: 'rule-1',
                  field: 'MANUAL_TAGS',
                  operator: 'ALL_OF',
                  value: [],
                },
              ],
            },
          ],
        },
        children: [],
      }),
    },
    eagleAsset: {
      findMany: async (query: { where: Record<string, unknown> }) => {
        queries.push(query);
        return [];
      },
    },
  } as never);

  await service.listAssets('owner-1', { smartFolderId: 'folder-1', limit: 30 });

  const folderWhere = (queries[0]?.where.AND as Array<Record<string, unknown>>)[1];
  assert.equal(queries[0]?.where.libraryMode, 'MATERIAL');
  assert.deepEqual(folderWhere, { ownerId: 'owner-1', id: { in: [] } });
});

test('an empty parent contributes no assets and only aggregates its active children', async () => {
  const queries: Array<{ where: Record<string, unknown> }> = [];
  const service = new EagleService({
    eagleSmartFolder: {
      findFirst: async () => ({
        queryJson: { version: 1, filters: { tagMatch: 'ANY' } },
        children: [{ queryJson: { version: 1, filters: { formats: ['png'] } } }],
      }),
    },
    eagleAsset: {
      findMany: async (query: { where: Record<string, unknown> }) => {
        queries.push(query);
        return [];
      },
    },
  } as never);

  await service.listAssets('owner-1', { smartFolderId: 'folder-1', limit: 30 });

  const folderWhere = (queries[0]?.where.AND as Array<Record<string, unknown>>)[1];
  assert.equal(queries[0]?.where.libraryMode, 'MATERIAL');
  assert.deepEqual(folderWhere, {
    ownerId: 'owner-1',
    deletedAt: null,
    isPrivate: false,
    AND: [{ format: { in: ['png'] } }],
  });
});

test('ANY tag matching combines every selected manual and AI tag into one union', async () => {
  const queries: Array<{ where: Record<string, unknown> }> = [];
  const service = new EagleService({
    eagleAsset: {
      findMany: async (query: { where: Record<string, unknown> }) => {
        queries.push(query);
        return [];
      },
    },
  } as never);

  await service.listAssets('owner-1', {
    limit: 30,
    manualTagIds: ['manual-1', 'manual-2'],
    aiTagIds: ['ai-1'],
    tagMatch: 'ANY',
  });

  const baseWhere = (queries[0]?.where.AND as Array<Record<string, unknown>>)[0]!;
  const conditions = baseWhere.AND as Array<Record<string, unknown>>;
  const tagUnion = conditions.find((condition) => Array.isArray(condition.OR))?.OR as unknown[];
  assert.equal(tagUnion.length, 3);
});

test('color filtering reports original global image-analysis coverage', async () => {
  const service = new EagleService({
    eagleAsset: {
      findMany: async () => [],
      count: async () => 10,
    },
    eagleAssetColorAnalysis: { count: async () => 7 },
  } as never);

  const result = await service.listAssets('owner-1', { limit: 30, color: '#abcdef' });

  assert.deepEqual(result.colorCoverage, {
    eligible: 10,
    completed: 7,
    percentage: 70,
    processorVersion: 'color-v3-thumbnail',
  });
});

test('rule count is owner scoped even when the query itself has no owner field', async () => {
  let where: unknown;
  const service = new EagleService({
    eagleAsset: {
      count: async (input: { where: unknown }) => {
        where = input.where;
        return 7;
      },
    },
  } as never);

  const result = await service.countAssets('owner-1', {
    version: 2,
    conditions: [
      {
        id: 'condition-1',
        match: 'ALL',
        result: 'MATCH',
        rules: [{ id: 'rule-1', field: 'FORMAT', operator: 'EQUALS', value: 'png' }],
      },
    ],
  });

  assert.equal(result.count, 7);
  assert.equal((where as { ownerId: string }).ownerId, 'owner-1');
});

test('asset listing only loads relations required by gallery cards', async () => {
  let include: Record<string, unknown> | undefined;
  const service = new EagleService({
    eagleAsset: {
      findMany: async (query: { include: Record<string, unknown> }) => {
        include = query.include;
        return [];
      },
    },
  } as never);

  await service.listAssets('owner-1', { limit: 40 });

  assert.deepEqual(Object.keys(include ?? {}).sort(), [
    'manualTagLinks',
    'photoLocation',
    'photoMetadata',
    'renditions',
  ]);
  const photo = include?.photoMetadata as { select: Record<string, boolean> };
  assert.equal(photo.select.captureMetadataInherited, true);
  assert.equal(photo.select.processorVersion, undefined);
});

test('image search preserves the ranked order without resolving AI tags', async () => {
  let rankingQuery = '';
  const assets = new Map(
    ['manual-asset', 'ai-asset'].map((id) => [
      id,
      {
        id,
        originalName: `${id}.png`,
        displayName: id,
        mimeType: 'image/png',
        format: 'png',
        byteSize: 1n,
        width: 1,
        height: 1,
        durationMs: null,
        lifecycleStatus: 'READY',
        mediaErrorCode: null,
        mediaRevision: 1,
        rowVersion: 1,
        rating: null,
        isPrivate: false,
        libraryAddedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
        originalObjectKey: `owner-1/${id}`,
        renditions: [],
        manualTagLinks: [],
      },
    ]),
  );
  let coverageCounts = 0;
  const service = new EagleService(
    {
      $queryRaw: async (query: unknown) => {
        rankingQuery = JSON.stringify(query);
        return [{ assetId: 'manual-asset' }, { assetId: 'ai-asset' }];
      },
      eagleAssetColorAnalysis: {
        count: async () => {
          coverageCounts++;
          return 7;
        },
      },
      eagleAsset: {
        count: async () => {
          coverageCounts++;
          return 10;
        },
        findMany: async (query: { where: { AND: Array<{ id?: { in?: string[] } }> } }) =>
          (query.where.AND?.at(-1)?.id?.in ?? [...assets.keys()]).flatMap((id) => {
            const asset = assets.get(id);
            return asset ? [asset] : [];
          }),
      },
    } as never,
    {
      prepare: async () => ({ status: 'READY', spaceId: 'space', vector: '[1]' }),
      rankPage: async () => {
        rankingQuery = 'direct-images';
        return ['manual-asset', 'ai-asset'].map((assetId) => ({
          assetId,
          tier: 1,
          similarity: 0.9,
          libraryAddedAt: '2026-01-01T00:00:00.000Z',
        }));
      },
    } as never,
  );

  const result = await service.listAssets('owner-1', { limit: 40, search: 'ui' });

  assert.deepEqual(
    result.items.map(({ id }) => id),
    ['manual-asset', 'ai-asset'],
  );
  assert.equal(rankingQuery, 'direct-images');
  assert.ok('imageSearch' in result);
  assert.deepEqual(result.imageSearch, { status: 'READY', spaceId: 'space' });
  const first = await service.listAssets('owner-1', { limit: 1, search: 'ui', color: '#abcdef' });
  assert.equal(coverageCounts, 2);
  assert.equal(first.colorCoverage?.completed, 7);
  assert.ok(first.nextCursor);
  coverageCounts = 0;
  const next = await service.listAssets('owner-1', {
    limit: 1,
    search: 'ui',
    color: '#abcdef',
    cursor: first.nextCursor!,
  });
  assert.equal(coverageCounts, 0);
  assert.equal(next.colorCoverage, null);
});

test('private assets stay out of the regular gallery and use a dedicated unlocked view', async () => {
  const queries: Array<{ where: Record<string, unknown> }> = [];
  const service = new EagleService({
    eagleAsset: {
      findMany: async (query: { where: Record<string, unknown> }) => {
        queries.push(query);
        return [];
      },
    },
  } as never);

  await service.listAssets('owner-1', { limit: 30 });
  await service.listAssets('owner-1', { limit: 30 }, { includePrivate: true });
  await service.listAssets('owner-1', { limit: 30, privacy: 'PRIVATE' }, { includePrivate: true });

  const lockedBase = (queries[0]?.where.AND as Array<Record<string, unknown>>)[0];
  const unlockedBase = (queries[1]?.where.AND as Array<Record<string, unknown>>)[0];
  const privateOnlyBase = (queries[2]?.where.AND as Array<Record<string, unknown>>)[0];
  assert.equal(lockedBase?.isPrivate, false);
  assert.equal(unlockedBase?.isPrivate, false);
  assert.equal(privateOnlyBase?.isPrivate, true);
});

test('tag counts exclude private assets while visibility is locked', async () => {
  let query: unknown;
  const service = new EagleService({
    eagleManualTag: {
      findMany: async (input: unknown) => {
        query = input;
        return [];
      },
    },
  } as never);

  await service.listManualTags('owner-1');

  assert.match(JSON.stringify(query), /"isPrivate":false/);
  assert.match(JSON.stringify(query), /"lastUsedAt":true/);
});

test('smart folder creation rejects a missing owner-scoped tag before writing', async () => {
  let wroteFolder = false;
  const service = new EagleService({
    eagleSmartFolder: {
      aggregate: async () => ({ _max: { position: null } }),
      create: async () => {
        wroteFolder = true;
      },
    },
    eagleManualTag: { count: async () => 0 },
    eagleAiTag: { count: async () => 0 },
  } as never);

  await assert.rejects(
    service.createSmartFolder('owner-1', {
      name: '缺失标签',
      query: { version: 1, filters: { manualTagIds: ['foreign-tag'] } },
    }),
    /人工标签不存在/,
  );
  assert.equal(wroteFolder, false);
});

test('new smart folders default to matching any selected tag', async () => {
  let storedQuery: unknown;
  const transaction = {
    eagleSmartFolder: {
      create: async ({ data }: { data: { queryJson: unknown } }) => {
        storedQuery = data.queryJson;
        return { id: 'folder-1' };
      },
    },
  };
  const service = new EagleService({
    eagleSmartFolder: { aggregate: async () => ({ _max: { position: null } }) },
    eagleManualTag: { count: async () => 0 },
    eagleAiTag: { count: async () => 0 },
    $transaction: async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
  } as never);

  await service.createSmartFolder('owner-1', { name: '新文件夹', query: {} });

  assert.deepEqual(storedQuery, { version: 1, filters: { tagMatch: 'ANY' } });
});

test('changing only a smart folder color preserves its stored query definition', async () => {
  let updateData: Record<string, unknown> | undefined;
  const transaction = {
    eagleSmartFolder: {
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        updateData = data;
        return { count: 1 };
      },
      findFirstOrThrow: async () => ({ id: 'folder-1' }),
    },
  };
  const service = new EagleService({
    eagleSmartFolder: {
      findFirst: async () => ({
        id: 'folder-1',
        ownerId: 'owner-1',
        parentId: null,
        name: '图片',
        color: null,
        queryJson: { version: 1, filters: { formats: ['png'] } },
      }),
      count: async () => 0,
    },
    $transaction: async (callback: (client: typeof transaction) => unknown) =>
      callback(transaction),
  } as never);

  await service.updateSmartFolder('owner-1', 'folder-1', { rowVersion: 1, color: '#112233' });

  assert.equal(updateData?.queryJson, undefined);
  assert.equal(updateData?.color, '#112233');
});

test('both libraries support independent explicit date ordering with matching keyset boundaries', async () => {
  const { encodeEagleAssetCursor } = await import('./eagle-cursor');
  for (const mode of ['PHOTO', 'MATERIAL'] as const) {
    for (const sort of ['CAPTURED_AT', 'ADDED_AT'] as const) {
      const queries: any[] = [];
      const service = new EagleService(
        {
          eagleAsset: {
            findMany: async (q: any) => {
              queries.push(q);
              return [];
            },
          },
        } as never,
        undefined,
        mode,
      );
      const date = new Date('2026-10-01');
      const cursor = encodeEagleAssetCursor(
        { id: 'last', libraryAddedAt: date },
        { ownerId: 'owner', libraryMode: mode },
        sort,
      );
      await service.listAssets('owner', { limit: 60, sort, cursor });
      const field = sort === 'CAPTURED_AT' ? 'chronologicalAt' : 'libraryAddedAt';
      assert.deepEqual(queries[0].orderBy, [{ [field]: 'desc' }, { id: 'desc' }]);
      assert.equal(queries[0].where.libraryMode, mode);
      assert.ok(JSON.stringify(queries[0].where).includes('owner'));
      assert.deepEqual(queries[0].where.AND[1].OR, [
        { [field]: { lt: date } },
        { [field]: date, id: { lt: 'last' } },
      ]);
      await assert.rejects(() => service.listAssets('other', { limit: 60, sort, cursor }));
      await assert.rejects(() =>
        service.listAssets('owner', {
          limit: 60,
          sort: sort === 'ADDED_AT' ? 'CAPTURED_AT' : 'ADDED_AT',
          cursor,
        }),
      );
    }
  }
});

test('timeline seek uses the selected field and cannot reuse a cursor or semantic search', async () => {
  for (const mode of ['PHOTO', 'MATERIAL'] as const) {
    for (const sort of ['CAPTURED_AT', 'ADDED_AT'] as const) {
      let where: any;
      const service = new EagleService(
        {
          eagleAsset: {
            findMany: async (q: any) => {
              where = q.where;
              return [];
            },
          },
        } as never,
        undefined,
        mode,
      );
      await service.listAssets('owner', { limit: 60, sort, before: '2020-01-01T00:00:00Z' });
      assert.ok(
        JSON.stringify(where).includes(
          sort === 'CAPTURED_AT' ? 'chronologicalAt' : 'libraryAddedAt',
        ),
      );
      assert.ok(JSON.stringify(where).includes('2020-01-01T00:00:00.000Z'));
      assert.equal(where.libraryMode, mode);
      await assert.rejects(() =>
        service.listAssets('owner', {
          limit: 60,
          sort,
          before: '2020-01-01T00:00:00Z',
          cursor: 'old',
        }),
      );
      await assert.rejects(() =>
        service.listAssets('owner', {
          limit: 60,
          sort,
          before: '2020-01-01T00:00:00Z',
          search: 'cat',
        }),
      );
    }
  }
});

test('date navigation can seek inside a large day and resumes ordinary keyset paging', async () => {
  let input: any;
  const service = new EagleService({
    eagleAsset: {
      findMany: async (q: any) => {
        input = q;
        return [];
      },
    },
  } as never);
  await service.listAssets('owner', {
    limit: 60,
    sort: 'ADDED_AT',
    before: '2026-10-24T00:00:00Z',
    offset: 9999,
  });
  assert.equal(input.skip, 9999);
  assert.equal(input.take, 61);
  assert.equal(input.where.libraryMode, 'MATERIAL');
  assert.ok(JSON.stringify(input.where).includes('owner'));
  await assert.rejects(() => service.listAssets('owner', { limit: 60, offset: 1, cursor: 'old' }));
  await assert.rejects(() => service.listAssets('owner', { limit: 60, offset: 1, search: 'cat' }));
});

test('color pagination does not recount coverage already returned with the first page', async () => {
  let counts = 0;
  const service = new EagleService({
    eagleAsset: {
      findMany: async () => [],
      count: async () => {
        counts++;
        return 10;
      },
    },
    eagleAssetColorAnalysis: {
      count: async () => {
        counts++;
        return 7;
      },
    },
  } as never);
  const cursor = encodeEagleAssetCursor(
    { id: 'asset', libraryAddedAt: new Date('2026-01-01') },
    { ownerId: 'owner-1', libraryMode: 'MATERIAL' },
  );
  const result = await service.listAssets('owner-1', { limit: 30, color: '#abcdef', cursor });
  assert.equal(counts, 0);
  assert.equal(result.colorCoverage, null);
});
