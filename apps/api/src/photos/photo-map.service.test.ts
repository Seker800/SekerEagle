import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { PhotoMapService } from './photo-map.service';
import { MapViewportDto, MapPhotosDto } from './photo-map.dto';
import { mapGrid, decodeMapCell, mapCursor, readMapCursor } from './photo-map-grid';

const world = { west: -180, east: 180, south: -90, north: 90, zoom: 3 };
test('map grid remains bounded for a world query even at maximum zoom and refines nearby views', () => {
  const coarse = mapGrid(world);
  const detail = mapGrid({ west: 120, east: 120.03, south: 30, north: 30.03, zoom: 12 });
  assert.ok(detail.level > coarse.level);
  const huge = mapGrid({ ...world, zoom: 12 });
  assert.ok(huge.cellCount <= 1024);
  const crossing = mapGrid({ west: 179, east: -179, south: -5, north: 5, zoom: 6 });
  assert.equal(crossing.xRanges.length, 2);
  assert.throws(() => decodeMapCell('14/16384/0'));
  assert.throws(() => decodeMapCell('0/0/-1'));
});

test('viewport and cell DTOs reject malformed coordinates, owner overrides and unbounded pages', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  for (const value of [
    { ...world, zoom: 20 },
    { ...world, south: 100 },
    { ...world, ownerId: 'other' },
    { ...world, west: 'NaN' },
  ]) {
    await assert.rejects(pipe.transform(value, { type: 'query', metatype: MapViewportDto }));
  }
  await assert.rejects(
    pipe.transform({ after: 'a'.repeat(2049) }, { type: 'query', metatype: MapPhotosDto }),
  );
});

test('member cursors bind owner, privacy, cell and photography mode', () => {
  const scope = { ownerId: 'owner', includePrivate: false, cell: '5/20/12' };
  const encoded = mapCursor(scope, {
    id: '00000000-0000-4000-8000-000000000001',
    at: new Date('2024-01-02Z'),
  });
  assert.equal(readMapCursor(encoded, scope).at.toISOString(), '2024-01-02T00:00:00.000Z');
  for (const other of [
    { ...scope, ownerId: 'other' },
    { ...scope, includePrivate: true },
    { ...scope, cell: '5/20/13' },
  ]) {
    assert.throws(() => readMapCursor(encoded, other));
  }
  assert.throws(() => readMapCursor('bad', scope));
});

test('all-library map aggregation is owner scoped, current revision only, private safe and not list limited', async () => {
  const queries: Array<{ text: string; values: unknown[] }> = [];
  const service = new PhotoMapService({
    $queryRaw: async (query: { text: string; values: unknown[] }) => {
      queries.push(query);
      return [
        {
          total: 10000n,
          west: 120,
          east: 121,
          south: 30,
          north: 31,
          clusters: [{ x: 20, y: 12, latitude: 30.5, longitude: 120.5, count: 10000 }],
        },
      ];
    },
  } as never);
  const result = await service.clusters('owner', false, world);
  assert.equal(result.total, 10000);
  assert.equal(result.clusters[0]!.count, 10000);
  const text = queries[0]!.text;
  assert.match(text, /a\."libraryMode" = 'PHOTO'/);
  assert.match(text, /a\."ownerId" = \$/);
  assert.match(text, /a\."isPrivate" = false/);
  assert.match(text, /a\."deletedAt" IS NULL/);
  assert.match(text, /m\."assetRevision" = a\."mediaRevision"/);
  assert.match(text, /l\."assetRevision" = a\."mediaRevision"/);
  assert.match(text, /GROUP BY/);
  assert.doesNotMatch(text, /LIMIT/);
  assert.ok(queries[0]!.values.includes('owner'));
  await service.clusters('owner', true, world);
  assert.doesNotMatch(queries[1]!.text, /a\."isPrivate" = false/);
});

test('location photos use the exact cluster membership and stable bounded keyset pagination', async () => {
  let query: { text: string; values: unknown[] } | undefined;
  let where: unknown;
  const records = Array.from({ length: 61 }, (_, i) => ({
    id: 'photo-' + i,
    at: new Date('2024-01-02Z'),
  }));
  const service = new PhotoMapService({
    $queryRaw: async (input: typeof query) => {
      query = input;
      return records;
    },
    eagleAsset: {
      findMany: async (input: { where: unknown }) => {
        where = input.where;
        return [];
      },
    },
  } as never);
  const result = await service.photos('owner', false, '5/20/12');
  assert.ok(result.nextCursor);
  assert.match(query!.text, /ORDER BY "chronologicalAt" DESC, id DESC/);
  assert.match(query!.text, /LIMIT 61/);
  assert.match(query!.text, /"isPrivate" = false/);
  assert.ok(query!.values.includes(20) && query!.values.includes(12));
  assert.match(JSON.stringify(where), /"ownerId":"owner"/);
  assert.match(JSON.stringify(where), /"libraryMode":"PHOTO"/);
  assert.match(JSON.stringify(where), /"isPrivate":false/);
  await assert.rejects(service.photos('other', false, '5/20/12', result.nextCursor!));
});

test('map endpoints retain browser authentication and cannot take owner or private flags from the request', async () => {
  const { PhotoManagementController } = await import('./photo-management.controller');
  const { GUARDS_METADATA } = await import('@nestjs/common/constants');
  const { AccessAuthGuard } = await import('../auth/access-auth.guard');
  const { BrowserPrincipalGuard } = await import('../auth/browser-principal.guard');
  const guards = Reflect.getMetadata(GUARDS_METADATA, PhotoManagementController) as unknown[];
  assert.ok(guards.includes(AccessAuthGuard) && guards.includes(BrowserPrincipalGuard));
  const calls: unknown[][] = [];
  const controller = new PhotoManagementController(
    {} as never,
    {
      clusters: (...args: unknown[]) => {
        calls.push(args);
      },
      photos: (...args: unknown[]) => {
        calls.push(args);
      },
    } as never,
  );
  const principal = { sub: 'authenticated-owner', canViewPrivate: false } as never;
  controller.mapClusters(principal, world);
  controller.mapPhotos(principal, '5/20/12', {});
  assert.deepEqual(calls[0], ['authenticated-owner', false, world]);
  assert.deepEqual(calls[1], ['authenticated-owner', false, '5/20/12', undefined]);
});
