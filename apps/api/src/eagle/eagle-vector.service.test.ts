import assert from 'node:assert/strict';
import test from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { EagleVectorService } from './eagle-vector.service';

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

test('accepting a suggestion atomically creates an audited manual tag relation', async () => {
  const creates: unknown[] = [];
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

test('missing embedding scan is bounded, owner-scoped and preserves the preview dependency', async () => {
  let assetWhere: unknown;
  let created: Array<{ kind?: string; ownerId?: string; dependsOnJobId?: string | null }> = [];
  const service = new EagleVectorService({
    eagleAsset: {
      findMany: async ({ where }: { where: unknown }) => {
        assetWhere = where;
        return [{ id: 'asset-1', mediaRevision: 3, width: 800, height: 600 }];
      },
    },
    eagleAssetProcessingJob: {
      findMany: async () => [
        {
          id: 'preview-job',
          assetId: 'asset-1',
          assetRevision: 3,
          kind: 'GENERATE_RENDITIONS',
          processorVersion: 'rendition-v2',
        },
      ],
      createMany: async ({ data }: { data: typeof created }) => {
        created = data;
        return { count: data.length };
      },
    },
  } as never);

  const result = await service.scanMissingEmbeddings('owner-1');

  assert.deepEqual(result, { scanned: 1, created: 1 });
  assert.equal((assetWhere as { ownerId: string }).ownerId, 'owner-1');
  assert.equal(created[0]?.ownerId, 'owner-1');
  assert.equal(created[0]?.kind, 'GENERATE_EMBEDDING');
  assert.equal(created[0]?.dependsOnJobId, 'preview-job');
});
