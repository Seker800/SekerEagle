import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { PhotoStatisticsService, statisticsPeriods } from './photo-statistics.service';
import { PhotoStatisticsQueryDto } from './photo-statistics.dto';

test('statistics fills calendar gaps and bounds time resolution', () => {
  assert.deepEqual(statisticsPeriods('2024-01-01', '2024-03-01', 'month'), [
    '2024-01',
    '2024-02',
    '2024-03',
  ]);
  assert.deepEqual(statisticsPeriods('2024-02-28', '2024-03-01', 'day'), [
    '2024-02-28',
    '2024-02-29',
    '2024-03-01',
  ]);
  assert.throws(() => statisticsPeriods('2000-01-01', '2026-01-01', 'day'), /732/);
  assert.deepEqual(statisticsPeriods(null, null, 'month'), []);
});

test('statistics validates dates, filters and rejects identity or privacy overrides', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  for (const input of [
    { ownerId: 'other' },
    { includePrivate: true },
    { grain: 'hour' },
    { start: '2024-02-30' },
    { cameras: Array(51).fill('a') },
  ]) {
    await assert.rejects(
      pipe.transform(input, { type: 'query', metatype: PhotoStatisticsQueryDto }),
    );
  }
  const value = await pipe.transform(
    { cameras: 'A', start: '2024-01-01' },
    { type: 'query', metatype: PhotoStatisticsQueryDto },
  );
  assert.deepEqual(value.cameras, ['A']);
});

test('statistics uses full library with current metadata and authenticated visibility', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const service = new PhotoStatisticsService({
    $queryRaw: async (query: { text: string; values: unknown[] }) => {
      queries.push(query);
      return [
        {
          total: 4,
          unknownDate: 1,
          first: '2024-01-01',
          last: '2024-03-01',
          cameras: [{ key: 'A', count: 4 }],
          lenses: [],
          cameraOptions: ['A'],
          lensOptions: [],
          points: [
            { period: '2024-01', key: 'A', count: 2 },
            { period: '2024-03', key: 'A', count: 1 },
          ],
        },
      ];
    },
  } as never);
  const result = await service.get('owner', false, { grain: 'month', cameras: ["A' OR true --"] });
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

test('statistics endpoint takes owner and private permission only from the browser principal', async () => {
  const { PhotoStatisticsController } = await import('./photo-statistics.controller');
  const { GUARDS_METADATA } = await import('@nestjs/common/constants');
  const { AccessAuthGuard } = await import('../auth/access-auth.guard');
  const { BrowserPrincipalGuard } = await import('../auth/browser-principal.guard');
  const guards = Reflect.getMetadata(GUARDS_METADATA, PhotoStatisticsController) as unknown[];
  assert.ok(guards.includes(AccessAuthGuard) && guards.includes(BrowserPrincipalGuard));
  let args: unknown[] = [];
  const controller = new PhotoStatisticsController({
    get: (...input: unknown[]) => {
      args = input;
    },
  } as never);
  controller.get({ sub: 'owner', canViewPrivate: false } as never, { cameras: ['A'] });
  assert.deepEqual(args, ['owner', false, { cameras: ['A'] }]);
});

test('calendar intervals cover year boundaries, singleton buckets and reversed empty windows', () => {
  assert.deepEqual(statisticsPeriods('2023-12-31', '2024-01-01', 'year'), ['2023', '2024']);
  assert.deepEqual(statisticsPeriods('2024-01-31', '2024-02-01', 'month'), ['2024-01', '2024-02']);
  assert.deepEqual(statisticsPeriods('2024-01-01', '2024-01-01', 'day'), ['2024-01-01']);
  assert.deepEqual(statisticsPeriods('2025-01-01', '2024-01-01', 'year'), []);
});

test('all query variants keep empty results explicit and build only parameterized dimensions', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const service = new PhotoStatisticsService({
    $queryRaw: async (q: { text: string; values: unknown[] }) => {
      queries.push(q);
      return [
        {
          total: 0,
          unknownDate: 0,
          first: null,
          last: null,
          cameras: [],
          lenses: [],
          cameraOptions: [],
          lensOptions: [],
          points: [],
        },
      ];
    },
  } as never);
  for (const query of [
    {
      grain: 'year' as const,
      groupBy: 'lens' as const,
      lenses: ['L'],
      cameras: [],
      start: '2024-01-01',
      end: '2024-12-31',
    },
    { grain: 'day' as const, end: '2024-12-31', lenses: [] },
    {},
  ])
    assert.equal((await service.get('owner', true, query)).total, 0);
  assert.ok(queries[0]!.text.includes('lens IN'));
  assert.ok(queries[0]!.values.includes('L'));
});

test('statistics defaults to monthly camera series and preserves explicit total queries', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  await pipe.transform({ groupBy: 'total' }, { type: 'query', metatype: PhotoStatisticsQueryDto });
  let text = '';
  const service = new PhotoStatisticsService({
    $queryRaw: async (query: { text: string }) => {
      text = query.text;
      return [
        {
          total: 0,
          unknownDate: 0,
          first: null,
          last: null,
          cameras: [],
          lenses: [],
          cameraOptions: [],
          lensOptions: [],
          points: [],
        },
      ];
    },
  } as never);
  const result = await service.get('owner', false, {});
  assert.equal(result.groupBy, 'camera');
  assert.equal(result.grain, 'month');
  assert.match(text, /camera AS device/);
  await service.get('owner', false, { grain: 'week' });
  assert.match(text, /date_trunc/);
  await service.get('owner', false, { groupBy: 'total', grain: 'month' });
  assert.match(text, /''::text AS device/);
});

test('weekly buckets use Mondays across ISO year boundaries and fill missing weeks', () => {
  assert.deepEqual(statisticsPeriods('2024-12-29', '2025-01-06', 'week'), [
    '2024-12-23',
    '2024-12-30',
    '2025-01-06',
  ]);
  assert.deepEqual(statisticsPeriods('2024-02-29', '2024-03-03', 'week'), ['2024-02-26']);
  assert.deepEqual(statisticsPeriods('2025-01-01', '2024-01-01', 'week'), []);
  assert.ok(statisticsPeriods('1990-01-01', '2026-10-24', 'week').length > 732);
  assert.throws(() => statisticsPeriods('1700-01-01', '2026-01-01', 'week'), /10440/);
});
