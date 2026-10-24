import assert from 'node:assert/strict';
import test from 'node:test';
import { EagleAiTagService } from './eagle-ai-tag.service';

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
