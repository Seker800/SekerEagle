import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleAiTagService } from './eagle-ai-tag.service';

test('AI tag summary counts only the current pipeline and reports its default model', async () => {
  const analysisFilters: unknown[] = [];
  const jobFilters: unknown[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ models: [{ name: 'qwen3-vl:8b-instruct' }] }), { status: 200 });
  try {
    const service = new EagleAiTagService(
      {
        eagleAsset: { count: async () => 200 },
        eagleAiAnalysisRun: {
          count: async ({ where }: { where: unknown }) => {
            analysisFilters.push(where);
            return 146;
          },
        },
        eagleAssetProcessingJob: {
          count: async ({ where }: { where: unknown }) => {
            jobFilters.push(where);
            return 1;
          },
        },
        eagleAiTag: { count: async () => 384 },
        eagleProcessingSetting: { findUnique: async () => null },
      } as never,
      { embedText: async () => ({ embedding: [] }) } as never,
    );

    const summary = await service.summary('owner-1');

    assert.deepEqual(analysisFilters, [
      {
        ownerId: 'owner-1',
        status: 'SUCCEEDED',
        provider: 'OLLAMA',
        promptVersion: 'concrete-nouns-zh-v2',
        asset: { deletedAt: null, isPrivate: false },
      },
    ]);
    assert.equal(jobFilters.length, 3);
    for (const where of jobFilters) {
      assert.equal(
        (where as { processorVersion?: string }).processorVersion,
        'ollama-concrete-nouns-8b-instruct-v2',
      );
    }
    assert.deepEqual(summary.ollama, { status: 'ONLINE', model: 'qwen3-vl:8b-instruct' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('AI tag scan is explicit and only queues current visible images with ready previews', async () => {
  const writes: unknown[] = [];
  const service = new EagleAiTagService(
    {
      $executeRaw: async (query: unknown) => {
        writes.push(query);
        return 12;
      },
    } as never,
    { embedText: async () => ({ embedding: [] }) } as never,
  );

  const result = await service.scanMissing('owner-1', false);

  assert.deepEqual(result, { created: 12 });
  assert.equal(writes.length, 1);
  const serialized = JSON.stringify(writes[0]);
  assert.match(serialized, /owner-1/);
  assert.match(serialized, /GENERATE_AI_TAGS/);
  assert.match(serialized, /PREVIEW/);
  assert.match(serialized, /isPrivate/);
});

test('AI tag search candidates keep exact tags first and semantic tags by descending similarity', async () => {
  const service = new EagleAiTagService(
    {
      eagleAiTag: {
        findFirst: async () => ({ id: 'exact', name: '汽车' }),
      },
      $queryRaw: async () => [
        { id: 'car', name: '轿车', similarity: 0.94 },
        { id: 'sports-car', name: '跑车', similarity: 0.87 },
      ],
    } as never,
    { embedText: async () => ({ embedding: [0.6, 0.8] }) } as never,
  );

  assert.deepEqual(await service.resolveSearchTags('owner-1', ' 汽车 '), [
    { id: 'exact', name: '汽车', match: 'EXACT', similarity: 1 },
    { id: 'car', name: '轿车', match: 'SEMANTIC', similarity: 0.94 },
    { id: 'sports-car', name: '跑车', match: 'SEMANTIC', similarity: 0.87 },
  ]);
});

test('enabling manual AI tagging returns immediately and lets the worker fill the queue', async () => {
  const writes: unknown[] = [];
  const service = new EagleAiTagService(
    {
      eagleProcessingSetting: {
        upsert: async () => ({
          aiTagManualEnabled: true,
          aiTagScheduleEnabled: false,
          aiTagScheduleStart: '23:00',
          aiTagScheduleEnd: '06:00',
        }),
      },
      $executeRaw: async (query: unknown) => {
        writes.push(query);
        return 67276;
      },
    } as never,
    { embedText: async () => ({ embedding: [] }) } as never,
  );

  const result = await service.updateSettings('owner-1', {
    manualEnabled: true,
    scheduleEnabled: false,
    scheduleStart: '23:00',
    scheduleEnd: '06:00',
  });

  assert.deepEqual(result, {
    manualEnabled: true,
    scheduleEnabled: false,
    scheduleStart: '23:00',
    scheduleEnd: '06:00',
    timeZone: 'Asia/Shanghai',
  });
  assert.equal(writes.length, 0);
});
