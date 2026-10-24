import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { PhotoStatisticsService, statisticsPeriods } from './photo-statistics.service';
import { PhotoStatisticsQueryDto } from './photo-statistics.dto';

test('statistics fills calendar gaps and bounds time resolution', () => {
  assert.deepEqual(statisticsPeriods('2024-01-01', '2024-03-01', 'month'), ['2024-01', '2024-02', '2024-03']);
  assert.deepEqual(statisticsPeriods('2024-02-28', '2024-03-01', 'day'), ['2024-02-28', '2024-02-29', '2024-03-01']);
  assert.throws(() => statisticsPeriods('2000-01-01', '2026-01-01', 'day'), /732/);
  assert.deepEqual(statisticsPeriods(null, null, 'month'), []);
});

test('statistics validates dates, filters and rejects identity or privacy overrides', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  for (const input of [{ ownerId: 'other' }, { includePrivate: true }, { grain: 'hour' }, { start: '2024-02-30' }, { cameras: Array(51).fill('a') }]) {
    await assert.rejects(pipe.transform(input, { type: 'query', metatype: PhotoStatisticsQueryDto }));
  }
  const value = await pipe.transform({ cameras: 'A', start: '2024-01-01' }, { type: 'query', metatype: PhotoStatisticsQueryDto });
  assert.deepEqual(value.cameras, ['A']);
});

test('statistics uses full library with current metadata and authenticated visibility', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const service = new PhotoStatisticsService({ $queryRaw: async (query: { text: string; values: unknown[] }) => {
    queries.push(query);
    return [{ total: 4, unknownDate: 1, first: '2024-01-01', last: '2024-03-01', cameras: [{ key: 'A', count: 4 }], lenses: [], cameraOptions: ['A'], lensOptions: [], points: [{ period: '2024-01', key: 'A', count: 2 }, { period: '2024-03', key: 'A', count: 1 }] }];
  } } as never);
  const result = await service.get('owner', false, { cameras: ["A' OR true --"] });
  assert.equal(result.total, 4);
  assert.equal(result.unknownDate, 1);
  assert.deepEqual(result.periods, ['2024-01', '2024-02', '2024-03']);
  const query = queries[0]!;
  assert.match(query.text, /a\."libraryMode" = 'PHOTO'/);
  assert.match(query.text, /a\."ownerId" = \$/);
  assert.match(query.text, /a\."deletedAt" IS NULL/);
  assert.match(query.text, /a\."isPrivate" = false/);
  assert.match(query.text, /m\."assetRevision" = a\."mediaRevision"/);
  assert.match(query.text, /a\."mimeType" LIKE 'image\/%'/);
  assert.ok(query.values.includes("A' OR true --"));
  assert.doesNotMatch(query.text, /OR true/);
  await service.get('owner', true, {});
  assert.doesNotMatch(queries[1]!.text, /a\."isPrivate" = false/);
  await assert.rejects(service.get('owner', false, { start: '2025-01-01', end: '2024-01-01' }));
});
