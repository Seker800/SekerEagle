import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';

import { PhotoManagementService } from './photo-management.service';

test('people pages enforce owner/privacy and return a stable continuation instead of truncating', async () => {
  const ids = Array.from(
    { length: 205 },
    (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  );
  const queries: Array<{ where: Record<string, unknown>; take: number }> = [];
  const db = {
    eaglePhotoPerson: {
      findMany: async (query: { where: Record<string, unknown>; take: number }) => {
        queries.push(query);
        const after = (
          query.where.AND as Array<{ OR: Array<{ id?: { gt: string } }> }> | undefined
        )?.[0]?.OR[1]?.id?.gt;
        return ids
          .filter((id) => !after || id > after)
          .slice(0, query.take)
          .map((id) => ({ id, faces: [], createdAt: new Date('2026-10-20T00:00:00Z') }));
      },
    },
  };
  const service = new PhotoManagementService(db as never);
  const first = await service.people('owner', false);
  assert.equal(first.people.length, 200);
  assert.deepEqual((queries[0] as unknown as { orderBy: unknown }).orderBy, [
    { createdAt: 'asc' },
    { id: 'asc' },
  ]);
  assert.ok(first.nextCursor);
  assert.equal(JSON.parse(Buffer.from(first.nextCursor, 'base64url').toString()).id, ids[199]);
  assert.equal((await service.people('owner', false, first.nextCursor)).people.length, 5);
  await assert.rejects(service.people('other-owner', false, first.nextCursor), /游标无效/);
  await assert.rejects(service.people('owner', true, first.nextCursor), /游标无效/);
  await assert.rejects(service.people('owner', false, 'invalid'), /游标无效/);
  assert.equal(queries[0]?.where.ownerId, 'owner');
  assert.equal(queries[0]?.where.libraryMode, 'PHOTO');
  assert.equal(queries[0]?.where.marksAssetsPrivate, false);
});

test('people cards bound media candidates and options do not fetch faces, EXIF or biometric vectors', async () => {
  type Query = {
    where: Record<string, unknown>;
    select: {
      faces?: { take: number; select: { asset: { select: { photoMetadata?: boolean } } } };
      prototype?: unknown;
    };
  };
  const queries: Query[] = [];
  const service = new PhotoManagementService({
    eaglePhotoPerson: {
      findMany: async (query: Query) => {
        queries.push(query);
        return [];
      },
    },
  } as never);
  await service.people('owner', false, undefined, 'cards');
  assert.equal(queries[0]!.select.faces!.take, 20);
  assert.equal(queries[0]!.select.faces!.select.asset.select.photoMetadata, false);
  assert.equal(queries[0]!.select.prototype, undefined);
  await service.people('owner', false, undefined, 'options');
  assert.deepEqual(Object.keys(queries[1]!.select).sort(), [
    'createdAt',
    'id',
    'marksAssetsPrivate',
    'name',
    'rowVersion',
  ]);
  assert.equal(queries[1]!.where.ownerId, 'owner');
  assert.equal(queries[1]!.where.libraryMode, 'PHOTO');
  assert.equal(queries[1]!.where.marksAssetsPrivate, false);
});

test('person face pages reject invisible people and bind cursors to owner, privacy and person', async () => {
  let visible = false;
  let calls = 0;
  const personId = '11111111-1111-4111-8111-111111111111';
  const service = new PhotoManagementService({
    eaglePhotoPerson: { findFirst: async () => (visible ? { id: personId } : null) },
    eaglePhotoFace: {
      findMany: async () => {
        calls++;
        return Array.from({ length: 21 }, (_, i) => ({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          createdAt: new Date('2026-01-01'),
          asset: { byteSize: 1n, renditions: [] },
        }));
      },
    },
  } as never);
  await assert.rejects(service.personFaces('owner', personId, false), /人物不存在/);
  assert.equal(calls, 0);
  visible = true;
  const page = await service.personFaces('owner', personId, false);
  assert.equal(page.faces.length, 20);
  assert.ok(page.nextCursor);
  for (const [owner, person, privateVisible] of [
    ['other', personId, false],
    ['owner', 'other-person', false],
    ['owner', personId, true],
  ] as const) {
    await assert.rejects(
      service.personFaces(owner, person, privateVisible, page.nextCursor),
      /游标无效/,
    );
  }
});

test('cards return one clear browsable representative from the original bounded candidate set', async () => {
  const faces = [0.1, 0.3].map((side, index) => ({
    id: `face-${index}`,
    box: [0.1, 0.1, side, side],
    confidence: 1 - index * 0.01,
    assetId: `asset-${index}`,
    asset: {
      mimeType: 'image/jpeg',
      mediaRevision: 1,
      byteSize: 1n,
      renditions: [
        {
          id: 'thumb',
          kind: 'THUMBNAIL',
          revision: 1,
          width: 100,
          height: 100,
          mimeType: 'image/jpeg',
          byteSize: 1n,
        },
      ],
    },
  }));
  const service = new PhotoManagementService({
    eaglePhotoPerson: { findMany: async () => [{ id: 'p', createdAt: new Date(), faces }] },
  } as never);
  const result = await service.people('owner', false, undefined, 'cards');
  const card = result.people[0] as unknown as { faces: Array<{ id: string }> };
  assert.equal(card.faces.length, 1);
  assert.equal(card.faces[0]?.id, 'face-1');
});

test('people reads reject caller-supplied identity, permission and invalid projections', async () => {
  const { ValidationPipe } = await import('@nestjs/common');
  const { PeopleQueryDto, PeopleCursorDto, PhotoManagementController } =
    await import('./photo-management.controller');
  const { GUARDS_METADATA } = await import('@nestjs/common/constants');
  const { AccessAuthGuard } = await import('../auth/access-auth.guard');
  const { BrowserPrincipalGuard } = await import('../auth/browser-principal.guard');
  const guards = Reflect.getMetadata(GUARDS_METADATA, PhotoManagementController) as unknown[];
  assert.ok(guards.includes(AccessAuthGuard) && guards.includes(BrowserPrincipalGuard));
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  for (const input of [
    { ownerId: 'other' },
    { includePrivate: true },
    { view: 'embedding' },
    { after: 'x'.repeat(1025) },
  ]) {
    await assert.rejects(pipe.transform(input, { type: 'query', metatype: PeopleQueryDto }));
  }
  await assert.rejects(
    pipe.transform({ view: 'cards' }, { type: 'query', metatype: PeopleCursorDto }),
  );
  for (const view of ['full', 'cards', 'options'])
    assert.equal(
      (await pipe.transform({ view }, { type: 'query', metatype: PeopleQueryDto })).view,
      view,
    );
});

test('named directory pagination composes with lightweight projections and isolates cursors', async () => {
  const queries: Array<{ where: { name: unknown }; take: number; select: { faces?: unknown } }> =
    [];
  const service = new PhotoManagementService({
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    eaglePhotoPerson: {
      findMany: async (query: (typeof queries)[number]) => {
        queries.push(query);
        return Array.from({ length: query.take }, (_, i) => ({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          name: 'name',
          createdAt: new Date('2026-01-01'),
          faces: [],
        }));
      },
    },
  } as never);
  const cards = await service.people('owner', false, undefined, 'NAMED', 'cards');
  assert.equal(cards.people.length, 24);
  assert.equal(cards.limits.facesPerPerson, 1);
  assert.deepEqual(queries[0]!.where.name, { not: null });
  assert.equal(queries[0]!.take, 25);
  assert.ok(cards.nextCursor);
  await assert.rejects(
    service.people('owner', false, cards.nextCursor, 'UNNAMED', 'cards'),
    /游标无效/,
  );
  await assert.rejects(
    service.people('owner', false, cards.nextCursor, 'ALL', 'cards'),
    /游标无效/,
  );
  await service.people('owner', false, undefined, 'NAMED', 'options');
  assert.equal(queries[1]!.select.faces, undefined);
});

test('camera and lens choices do not silently disappear after the first 500 models', async () => {
  const models = Array.from({ length: 501 }, (_, i) => `Camera ${i}`);
  const service = new PhotoManagementService({
    eaglePhotoMetadata: {
      groupBy: async (query: { by: string[]; take?: number }) =>
        models.slice(0, query.take).map((name) => ({ [query.by[0]!]: name })),
    },
  } as never);
  const result = await service.facets('owner', false);
  assert.equal(result.cameras.length, 501);
  assert.equal(result.lenses.length, 501);
});
