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
  assert.equal(detail.level, 17);
  assert.deepEqual(decodeMapCell('16/65535/65535'), { level: 16, n: 65536, x: 65535, y: 65535 });
  assert.throws(() => decodeMapCell('22/0/0'));
  const street = mapGrid({ west: 120, east: 120.001, south: 30, north: 30.001, zoom: 16 });
  assert.equal(street.level, 21);
  assert.deepEqual(decodeMapCell('20/1048575/1048575'), {
    level: 20,
    n: 1048576,
    x: 1048575,
    y: 1048575,
  });
  const huge = mapGrid({ ...world, zoom: 12 });
  assert.ok(huge.cellCount <= 16384);
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

const snapshotId = '00000000-0000-4000-8000-000000000001';
function indexedFixture(cells: Array<Record<string, unknown>> = []) {
  const queries: unknown[] = [];
  const state = {
    activeSnapshotId: snapshotId as string | null,
    buildingSnapshotId: null as string | null,
    nextLevel: 0,
    visibilityVersion: 1,
    dirtyAt: null as Date | null,
  };
  const snapshot = {
    id: snapshotId,
    completedAt: new Date('2026-10-24T00:00:00Z'),
    summary: [
      { includePrivate: false, total: 10000, south: 30, north: 31, west: 120, east: 121 },
      { includePrivate: true, total: 11000, south: 30, north: 31, west: 120, east: 121 },
    ],
  };
  const tx = {
    eaglePhotoMapState: { findUnique: async () => state },
    eaglePhotoMapSnapshot: {
      findFirst: async (input: unknown) => {
        queries.push(input);
        return snapshot;
      },
    },
    eaglePhotoMapCell: {
      findMany: async (input: unknown) => {
        queries.push(input);
        return cells;
      },
    },
    eagleAsset: {
      findMany: async (input: unknown) => {
        queries.push(input);
        return [{ id: 'photo', mediaRevision: 3, byteSize: 1n, renditions: [] }];
      },
    },
    $queryRaw: async (input: unknown) => {
      queries.push(input);
      return [];
    },
  };
  const service = new PhotoMapService({
    $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx),
  } as never);
  return { service, tx, queries, state, snapshot };
}
test('map reads persisted cells and bounded current covers without a gallery scan or build on GET', async () => {
  const f = indexedFixture([
    {
      x: 20,
      y: 12,
      level: 7,
      count: 10000,
      latitude: 30,
      longitude: 120,
      coverId: 'photo',
      coverRevision: 3,
    },
  ]);
  const result = await f.service.clusters('owner', false, world);
  assert.equal(result.total, 10000);
  assert.equal(result.clusters[0]!.cover?.id, 'photo');
  assert.equal(result.clusters[0]!.id, `${snapshotId}:7/20/12`);
  assert.equal(result.clusters[0]!.photoLatitude, 30);
  const where = (f.queries[1] as { where: Record<string, unknown> }).where;
  assert.equal(where.ownerId, 'owner');
  assert.equal(where.snapshotId, snapshotId);
  assert.equal(where.includePrivate, false);
  assert.match(JSON.stringify(f.queries[2]), /"mediaRevision":3/);
  assert.equal(result.status, 'READY');
});
test('unbuilt and invalidated snapshots return pending without scanning the source library', async () => {
  const f = indexedFixture();
  f.state.activeSnapshotId = null as never;
  assert.equal((await f.service.clusters('owner', false, world)).status, 'PENDING');
  assert.equal(f.queries.length, 0);
  f.state.activeSnapshotId = snapshotId;
  f.tx.eaglePhotoMapSnapshot.findFirst = async () => null as never;
  assert.equal((await f.service.clusters('owner', false, world)).status, 'PENDING');
  assert.equal(f.queries.length, 0);
});
test('every zoom features the nine busiest visible locations while retaining all footprints', async () => {
  const f = indexedFixture(
    Array.from({ length: 1500 }, (_, i) => ({
      x: i,
      y: 0,
      count: i + 1,
      latitude: 0,
      longitude: 0,
      coverId: `photo-${i}`,
      coverRevision: 3,
    })),
  );
  const distant = await f.service.clusters('owner', false, world);
  assert.equal(distant.clusters.length, 1500);
  const distantCovers = (f.queries.at(-1) as { where: { OR: Array<{ id: string }> } }).where.OR;
  assert.deepEqual(
    distantCovers.map((c) => c.id),
    Array.from({ length: 9 }, (_, i) => `photo-${1499 - i}`),
  );
  const close = await f.service.clusters('owner', true, { ...world, zoom: 12 });
  assert.equal(close.clusters.length, 1500);
  assert.equal((f.queries.at(-1) as { where: { OR: unknown[] } }).where.OR.length, 9);
});
test('member reads use frozen spatial points and a snapshot-bound cursor, never GPS aggregation', async () => {
  const f = indexedFixture();
  const result = await f.service.photos('owner', false, `${snapshotId}:7/20/12`);
  assert.deepEqual(result.items, []);
  const query = f.queries.find(
    (value) => typeof value === 'object' && value && 'text' in value,
  ) as { text: string; values: unknown[] };
  assert.match(query.text, /FROM "EaglePhotoMapPoint"/);
  assert.doesNotMatch(query.text, /EaglePhotoMetadata/);
  assert.match(query.text, /"mediaRevision"=p\."assetRevision"/);
  await assert.rejects(f.service.photos('owner', false, '7/20/12'), /重新选择/);
});

test('featured locations are inside the real viewport, including views crossing the date line', async () => {
  const f = indexedFixture([
    { count: 2, latitude: 0, longitude: 175, coverId: 'east', coverRevision: 3 },
    { count: 1, latitude: 0, longitude: -175, coverId: 'west', coverRevision: 3 },
    { count: 1000, latitude: 0, longitude: 0, coverId: 'outside-longitude', coverRevision: 3 },
    { count: 1000, latitude: 11, longitude: 175, coverId: 'outside-latitude', coverRevision: 3 },
  ]);
  await f.service.clusters('owner', false, {
    west: 170,
    east: -170,
    south: -10,
    north: 10,
    zoom: 3,
  });
  const query = f.queries.at(-1) as {
    where: { ownerId: string; libraryMode: string; isPrivate: boolean; OR: Array<{ id: string }> };
  };
  assert.deepEqual(
    query.where.OR.map((c) => c.id),
    ['east', 'west'],
  );
  assert.equal(query.where.ownerId, 'owner');
  assert.equal(query.where.libraryMode, 'PHOTO');
  assert.equal(query.where.isPrivate, false);
  await f.service.clusters('owner', false, { west: -10, east: 10, south: -10, north: 10, zoom: 8 });
  assert.deepEqual(
    (f.queries.at(-1) as typeof query).where.OR.map((c) => c.id),
    ['outside-longitude'],
  );
});

test('a committed partial generation is readable at its available resolution before full completion', async () => {
  const f = indexedFixture([
    {
      x: 6,
      y: 3,
      level: 3,
      count: 132,
      latitude: 30,
      longitude: 120,
      coverId: 'photo',
      coverRevision: 3,
    },
  ]);
  f.state.activeSnapshotId = null;
  f.state.buildingSnapshotId = snapshotId;
  f.state.nextLevel = 4;
  f.state.dirtyAt = new Date();
  f.tx.eaglePhotoMapSnapshot.findFirst = async (input: unknown) => {
    f.queries.push(input);
    return {
      id: snapshotId,
      completedAt: null,
      createdAt: new Date('2026-10-29T00:00:00Z'),
      summary: [{ includePrivate: false, total: 132, south: 30, north: 31, west: 120, east: 121 }],
    } as never;
  };
  const result = await f.service.clusters('owner', false, world);
  assert.equal(result.status, 'UPDATING');
  assert.equal(result.total, 132);
  assert.equal(result.level, 3);
  assert.equal(result.clusters[0]?.id, `${snapshotId}:3/6/3`);
  assert.match(JSON.stringify(f.queries), /"visibilityVersion":1/);
  assert.equal((await f.service.photos('owner', false, `${snapshotId}:3/6/3`)).items.length, 0);
});

test('retains a valid detailed generation until its replacement has the requested level', async () => {
  const f = indexedFixture();
  const replacement = '00000000-0000-4000-8000-000000000002';
  f.state.buildingSnapshotId = replacement;
  f.state.nextLevel = 4;
  f.state.dirtyAt = new Date();
  const old = await f.service.clusters('owner', false, world);
  assert.equal(old.snapshotId, snapshotId);
  assert.equal(old.level, mapGrid(world).level);
  const initialQueryCount = f.queries.length;
  f.state.nextLevel = 8;
  f.tx.eaglePhotoMapSnapshot.findFirst = async (input: unknown) => {
    f.queries.push(input);
    return (input as { where: { id: string } }).where.id === replacement
      ? ({ ...f.snapshot, id: replacement, completedAt: null, createdAt: new Date() } as never)
      : f.snapshot;
  };
  const current = await f.service.clusters('owner', false, world);
  assert.equal(current.snapshotId, replacement);
  assert.equal(current.level, mapGrid(world).level);
  assert.equal(current.status, 'UPDATING');
  assert.equal(
    f.queries.length - initialQueryCount,
    3,
    'at most two snapshot lookups and one persisted-cell lookup',
  );
});

test('an unfinished generation with no committed level remains unavailable', async () => {
  const f = indexedFixture();
  f.state.activeSnapshotId = null;
  f.state.buildingSnapshotId = snapshotId;
  f.state.nextLevel = 0;
  assert.equal((await f.service.clusters('owner', false, world)).status, 'PENDING');
  assert.equal(f.queries.length, 0);
});

test('an owner without indexed photo data gets an empty ready map without source queries', async () => {
  const f = indexedFixture();
  f.tx.eaglePhotoMapState.findUnique = async () => null as never;
  const result = await f.service.clusters('owner', false, world);
  assert.equal(result.status, 'READY');
  assert.equal(result.total, 0);
  assert.equal(f.queries.length, 0);
});
