import assert from 'node:assert/strict';
import test from 'node:test';
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

  const conditions = queries[0]?.where.AND as Array<Record<string, unknown>>;
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
    processorVersion: 'color-v2',
  });
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
