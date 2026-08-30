import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { ListTagDistanceAssetsDto } from './eagle-vector.dto';
import { EagleVectorService } from './eagle-vector.service';

test('tag semantics defaults to enabled tags and search is bounded to disabled candidates', async () => {
  const queries: Array<Record<string, unknown>> = [];
  const service = new EagleVectorService({
    eagleManualTag: {
      findMany: async (input: Record<string, unknown>) => {
        queries.push(input);
        return [];
      },
    },
  } as never);

  await service.listTagSemantics('owner-1');
  await service.listTagSemantics('owner-1', ' 汽车 ');

  assert.deepEqual(queries[0]?.where, {
    ownerId: 'owner-1',
    semanticConfig: { is: { recommendationEnabled: true } },
  });
  assert.equal('take' in (queries[0] ?? {}), false);
  assert.deepEqual(queries[1]?.where, {
    ownerId: 'owner-1',
    normalizedName: { contains: '汽车' },
    OR: [
      { semanticConfig: { is: null } },
      { semanticConfig: { is: { recommendationEnabled: false } } },
    ],
  });
  assert.equal(queries[1]?.take, 20);
});

test('disabling recommendation invalidates only the owner tag pending suggestions', async () => {
  const writes: unknown[] = [];
  const transaction = {
    eagleManualTag: {
      findFirst: async ({ where }: { where: unknown }) => {
        writes.push(where);
        return { id: 'tag-1' };
      },
    },
    eagleManualTagSemanticConfig: {
      upsert: async (input: unknown) => {
        writes.push(input);
        return { recommendationEnabled: false };
      },
    },
    eagleVectorTagSuggestion: {
      updateMany: async (input: unknown) => {
        writes.push(input);
        return { count: 2 };
      },
    },
  };
  const service = new EagleVectorService({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as never);

  const result = await service.setRecommendationEnabled('owner-1', 'tag-1', false);

  assert.deepEqual(result, { tagId: 'tag-1', recommendationEnabled: false, invalidated: 2 });
  assert.deepEqual(writes[0], { ownerId: 'owner-1', id: 'tag-1' });
  const invalidation = writes[2] as {
    where: unknown;
    data: { invalidatedAt: unknown; invalidReason: string };
  };
  assert.deepEqual(invalidation.where, {
    ownerId: 'owner-1',
    suggestedTagId: 'tag-1',
    status: 'PENDING',
    isActive: true,
    invalidatedAt: null,
  });
  assert.equal(invalidation.data.invalidatedAt instanceof Date, true);
  assert.equal(invalidation.data.invalidReason, 'TAG_RECOMMENDATION_DISABLED');
  assert.equal((invalidation.data as { isActive?: boolean }).isActive, false);
  /* owner-scoped filter above is the security boundary; no unqualified update is allowed. */
  assert.notDeepEqual(writes[2], {
    where: {
      suggestedTagId: 'tag-1',
      status: 'PENDING',
      invalidatedAt: null,
    },
  });
});

test('requesting a tag rebuild remains opt-in and enqueues one owner-scoped build', async () => {
  const service = new EagleVectorService({
    eagleManualTagSemanticConfig: {
      findUnique: async () => ({ recommendationEnabled: true }),
    },
    eagleManualTag: {
      findFirst: async () => ({ id: 'tag-1', _count: { assetLinks: 4 } }),
    },
    eagleTagSemanticBuild: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'build-1',
        ...data,
      }),
    },
  } as never);

  const result = await service.requestTagRebuild('owner-1', 'tag-1');
  assert.equal(result.status, 'PENDING');
  assert.equal(result.tagId, 'tag-1');
});

test('suggestion review listing does not load representative assets that the review UI no longer uses', async () => {
  let representativeQueryCount = 0;
  const service = new EagleVectorService({
    eagleVectorTagSuggestion: {
      findMany: async () => [
        {
          id: 'suggestion-1',
          snapshotId: 'snapshot-1',
          prototypeRank: 0,
          score: 0.95,
          suggestedTag: { id: 'tag-1', name: '汽车', color: null },
          asset: {
            id: 'asset-1',
            displayName: 'car.jpg',
            width: 800,
            height: 600,
            renditions: [],
          },
        },
      ],
    },
    eagleTagPrototype: {
      findMany: async () => {
        representativeQueryCount += 1;
        return [];
      },
    },
    eagleAsset: {
      findMany: async () => {
        representativeQueryCount += 1;
        return [];
      },
    },
  } as never);

  const result = await service.listSuggestions('owner-1', {
    limit: 40,
    sort: 'SCORE_DESC',
  });

  assert.equal(representativeQueryCount, 0);
  const firstItem = result.items[0];
  assert.ok(firstItem);
  assert.equal('representativeAssets' in firstItem, false);
});

test('distance inspection loads an owner-visible thumbnail for visual classification', async () => {
  let distanceQuery: Record<string, unknown> | undefined;
  const service = new EagleVectorService({
    eagleManualTag: {
      findFirst: async () => ({ semanticConfig: { currentSnapshotId: 'snapshot-1' } }),
    },
    eagleTagMemberDistance: {
      findMany: async (input: Record<string, unknown>) => {
        distanceQuery = input;
        return [];
      },
    },
  } as never);

  await service.listTagDistanceAssets('owner-1', 'tag-1', { limit: 40, direction: 'DESC' }, false);

  assert.deepEqual(distanceQuery?.where, {
    ownerId: 'owner-1',
    tagId: 'tag-1',
    snapshotId: 'snapshot-1',
    asset: { deletedAt: null, isPrivate: false },
  });
  assert.deepEqual(distanceQuery?.include, {
    asset: {
      select: {
        id: true,
        displayName: true,
        width: true,
        height: true,
        renditions: {
          where: { status: 'READY', kind: 'THUMBNAIL', variant: '512' },
          orderBy: { revision: 'desc' },
          take: 1,
          select: { id: true, width: true, height: true },
        },
      },
    },
  });
  assert.deepEqual(distanceQuery?.orderBy, [{ distance: 'desc' }, { assetId: 'desc' }]);
});

test('distance inspection defaults to lowest similarity first across cursor pages', async () => {
  const queries: Array<Record<string, unknown>> = [];
  const service = new EagleVectorService({
    eagleManualTag: {
      findFirst: async () => ({ semanticConfig: { currentSnapshotId: 'snapshot-1' } }),
    },
    eagleTagMemberDistance: {
      findMany: async (input: Record<string, unknown>) => {
        queries.push(input);
        return [];
      },
    },
  } as never);

  const cursor = Buffer.from(JSON.stringify({ distance: 0.42, assetId: 'asset-2' })).toString(
    'base64url',
  );
  const query = Object.assign(new ListTagDistanceAssetsDto(), { cursor });
  await service.listTagDistanceAssets('owner-1', 'tag-1', query, false);

  assert.deepEqual(queries[0]?.orderBy, [{ distance: 'desc' }, { assetId: 'desc' }]);
  assert.deepEqual(queries[0]?.where, {
    ownerId: 'owner-1',
    tagId: 'tag-1',
    snapshotId: 'snapshot-1',
    asset: { deletedAt: null, isPrivate: false },
    OR: [{ distance: { lt: 0.42 } }, { distance: 0.42, assetId: { lt: 'asset-2' } }],
  });
});

test('accepting a suggestion atomically creates an audited manual tag relation', async () => {
  const creates: unknown[] = [];
  const recentTagWrites: unknown[] = [];
  const transaction = {
    $executeRaw: async () => 1,
    eagleVectorTagSuggestion: {
      findFirst: async () => ({
        id: 'suggestion-1',
        assetId: 'asset-1',
        suggestedTagId: 'tag-1',
        status: 'PENDING',
        invalidatedAt: null,
        embedding: { isCurrent: true, status: 'READY' },
        snapshot: { isCurrent: true, status: 'ACTIVE' },
        suggestedTag: { semanticConfig: { recommendationEnabled: true } },
      }),
      updateMany: async () => ({ count: 1 }),
    },
    eagleAssetManualTag: {
      count: async () => 0,
      upsert: async (input: unknown) => {
        creates.push(input);
        return {};
      },
    },
    eagleManualTag: {
      updateMany: async (input: unknown) => {
        recentTagWrites.push(input);
        return { count: 1 };
      },
    },
  };
  const service = new EagleVectorService({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as never);

  const result = await service.reviewSuggestion('owner-1', 'suggestion-1', 'ACCEPT');

  assert.deepEqual(result, { id: 'suggestion-1', status: 'ACCEPTED', assetId: 'asset-1' });
  assert.deepEqual(creates[0], {
    where: {
      ownerId_assetId_tagId: { ownerId: 'owner-1', assetId: 'asset-1', tagId: 'tag-1' },
    },
    create: {
      ownerId: 'owner-1',
      assetId: 'asset-1',
      tagId: 'tag-1',
      assignedByUser: true,
      assignmentProvenance: 'VECTOR_SUGGESTED_HUMAN_ACCEPTED',
      acceptedSuggestionId: 'suggestion-1',
    },
    update: {
      assignedByUser: true,
      assignmentProvenance: 'VECTOR_SUGGESTED_HUMAN_ACCEPTED',
      acceptedSuggestionId: 'suggestion-1',
    },
  });
  assert.equal(recentTagWrites.length, 1);
  assert.deepEqual((recentTagWrites[0] as { where: unknown }).where, {
    ownerId: 'owner-1',
    id: 'tag-1',
  });
  assert.ok(
    (recentTagWrites[0] as { data: { lastUsedAt: unknown } }).data.lastUsedAt instanceof Date,
  );
});

test('cross-owner suggestion review returns 404 without writes', async () => {
  let wrote = false;
  const transaction = {
    eagleVectorTagSuggestion: { findFirst: async () => null },
    eagleAssetManualTag: { upsert: async () => (wrote = true) },
  };
  const service = new EagleVectorService({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as never);

  await assert.rejects(
    () => service.reviewSuggestion('owner-a', 'other-owner-suggestion', 'ACCEPT'),
    NotFoundException,
  );
  assert.equal(wrote, false);
});

test('missing embedding scan repairs drift and bulk-enqueues every owner-scoped ready preview', async () => {
  const statements: unknown[] = [];
  let call = 0;
  const transaction = {
    $executeRaw: async (statement: unknown) => {
      statements.push(statement);
      return call++ === 0 ? 2 : 67_000;
    },
  };
  const service = new EagleVectorService({
    $transaction: async (work: (value: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  } as never);

  const result = await service.scanMissingEmbeddings('owner-1');

  assert.deepEqual(result, { scanned: 67_002, created: 67_000, repaired: 2 });
  assert.equal(statements.length, 2);
  assert.match(JSON.stringify(statements), /owner-1/);
  assert.match(JSON.stringify(statements), /GENERATE_EMBEDDING/);
  assert.match(JSON.stringify(statements), /GENERATE_RENDITIONS/);
  assert.match(JSON.stringify(statements), /rendition-v2/);
});

test('unclassified suggestion scan reuses ready embeddings without enqueueing embedding work', async () => {
  const statements: unknown[] = [];
  const service = new EagleVectorService({
    $queryRaw: async (statement: unknown) => {
      statements.push(statement);
      return [{ scanned: 42, matched: 9 }];
    },
  } as never);

  const result = await service.scanUnclassifiedSuggestions('owner-1', false);

  assert.deepEqual(result, { scanned: 42, matched: 9 });
  assert.equal(statements.length, 1);
  const sql = JSON.stringify(statements[0]);
  assert.match(sql, /owner-1/);
  assert.match(sql, /EagleAssetEmbedding/);
  assert.match(sql, /EagleTagPrototype/);
  assert.match(sql, /manualTag/);
  assert.doesNotMatch(sql, /EagleMediaJob/);
});
