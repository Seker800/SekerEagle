import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoManagementService } from './photo-management.service';
import { encodeReviewCursor, reviewCursor, personReviewCandidatesSql } from './photo-person-review';

test('review cursor preserves the whole traversal and is bound to identity and privacy', () => {
  const state = { id: 'anchor-1', round: 3, photos: 8, confidence: 0.9, found: true };
  const cursor = encodeReviewCursor(state, 'owner', false);
  assert.deepEqual(reviewCursor(cursor, 'owner', false), state);
  assert.throws(() => reviewCursor(cursor, 'other', false));
  assert.throws(() => reviewCursor(cursor, 'owner', true));
  const sql = personReviewCandidatesSql('owner', false, state).text;
  assert.doesNotMatch(sql, /score\s*>=/);
  assert.match(sql, /OFFSET/);
});

test('person merge refuses a stale review before moving any faces', async () => {
  let writes = 0;
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray | { sql: string }) =>
      ('sql' in strings ? strings.sql : strings.join('')).includes('FROM "EaglePhotoPerson"')
        ? ['source', 'target'].map((id) => ({ id, rowVersion: 2, marksAssetsPrivate: false }))
        : [],
    $executeRaw: async () => 0,
    eaglePhotoPerson: {
      findMany: async () =>
        ['source', 'target'].map((id) => ({ id, rowVersion: 2, marksAssetsPrivate: false })),
      update: async () => {
        writes++;
        return {};
      },
    },
    eaglePhotoFace: {
      updateMany: async () => {
        writes++;
      },
    },
  };
  const service = new PhotoManagementService({
    $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
  } as never);
  await assert.rejects(
    service.mergePeople('owner', 'source', 'target', false, { source: 1, target: 1 }),
    /变化/,
  );
  assert.equal(writes, 0);
});

test('a different-person answer fences both identities against concurrent stale confirmation', async () => {
  const { PhotoPersonReviewService } = await import('./photo-person-review.service');
  const changed: string[] = [];
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    eaglePhotoPerson: {
      findFirst: async ({ where }: { where: { id: string } }) => ({ id: where.id, rowVersion: 1 }),
      updateMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        changed.push(...where.id.in);
        return { count: 2 };
      },
    },
    eaglePhotoPersonSeparation: {
      findUnique: async () => null,
      createMany: async () => ({ count: 1 }),
    },
  };
  const service = new PhotoPersonReviewService(
    { $transaction: async (fn: (value: unknown) => unknown) => fn(tx) } as never,
    {} as never,
  );
  await service.decide('owner', false, {
    firstId: 'a',
    secondId: 'b',
    firstVersion: 1,
    secondVersion: 1,
    decision: 'DIFFERENT',
  });
  assert.deepEqual(changed.sort(), ['a', 'b']);
});

test('review endpoints derive owner/private visibility from browser principal and reject untrusted fields', async () => {
  const { PhotoManagementController, PersonReviewDto } =
    await import('./photo-management.controller');
  const { validate } = await import('class-validator');
  const { GUARDS_METADATA } = await import('@nestjs/common/constants');
  const { BrowserOriginGuard } = await import('../auth/browser-origin.guard');
  const calls: unknown[][] = [];
  const controller = new PhotoManagementController(
    {} as never,
    {} as never,
    {
      suggestions: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({ items: [] });
      },
      decide: (...args: unknown[]) => {
        calls.push(args);
      },
    } as never,
  );
  const input = Object.assign(new PersonReviewDto(), {
    firstId: '00000000-0000-4000-8000-000000000001',
    secondId: '00000000-0000-4000-8000-000000000002',
    firstVersion: 1,
    secondVersion: 1,
    decision: 'DIFFERENT',
  });
  controller.reviewPeople({ sub: 'trusted-owner', canViewPrivate: false } as never, {});
  controller.decidePeople({ sub: 'trusted-owner', canViewPrivate: false } as never, input);
  assert.deepEqual(
    await controller.priorityPeople({ sub: 'trusted-owner', canViewPrivate: false } as never),
    { pairs: [] },
  );
  assert.deepEqual(calls[0], ['trusted-owner', false, undefined]);
  assert.equal(calls[1]?.[0], 'trusted-owner');
  assert.deepEqual(calls[2], ['trusted-owner', false]);
  assert.equal((await validate(input)).length, 0);
  assert(
    (
      await validate(Object.assign(new PersonReviewDto(), input, { ownerId: 'intruder' }), {
        whitelist: true,
        forbidNonWhitelisted: true,
      })
    ).length > 0,
  );
  assert(
    (await validate(Object.assign(new PersonReviewDto(), input, { firstVersion: 0 }))).length > 0,
  );
  const handler = Object.getOwnPropertyDescriptor(
    PhotoManagementController.prototype,
    'decidePeople',
  )!.value as object;
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, handler), [BrowserOriginGuard]);
});

test('manual face reassignment invalidates review versions of both affected identities', async () => {
  const changed: string[] = [];
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    eaglePhotoFace: {
      findFirst: async () => ({ id: 'face', personId: 'source', assetId: 'photo' }),
      update: async () => ({}),
    },
    eaglePhotoPerson: {
      findFirst: async () => ({ id: 'target', rowVersion: 1 }),
      updateMany: async ({ where }: { where: { id: { in: string[] } } }) => {
        changed.push(...where.id.in);
        return { count: 2 };
      },
    },
  };
  const service = new PhotoManagementService({
    $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
  } as never);
  await service.reassignFace('owner', 'face', 'target', false);
  assert.deepEqual(changed.sort(), ['source', 'target']);
});

test('bulk merge derives owner and privacy, guards origin and validates every supplied version', async () => {
  const { ValidationPipe } = await import('@nestjs/common');
  const { MergeSelectedPeopleDto, PhotoManagementController } =
    await import('./photo-management.controller');
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const good = {
    targetId: id(1),
    people: [
      { id: id(1), rowVersion: 1 },
      { id: id(2), rowVersion: 1 },
      { id: id(3), rowVersion: 2 },
    ],
  };
  for (const bad of [
    { ...good, ownerId: 'foreign' },
    {
      ...good,
      people: [
        { id: id(1), rowVersion: 1 },
        { id: id(2), rowVersion: 0 },
      ],
    },
    { ...good, people: [{ id: id(1), rowVersion: 1 }] },
  ])
    await assert.rejects(pipe.transform(bad, { type: 'body', metatype: MergeSelectedPeopleDto }));
  const calls: unknown[][] = [];
  const c = new PhotoManagementController(
    { mergeSelection: (...args: unknown[]) => calls.push(args) } as never,
    {} as never,
    {} as never,
  );
  c.mergeSelected({ sub: 'trusted', canViewPrivate: false } as never, good);
  assert.deepEqual(calls[0], ['trusted', false, good.targetId, good.people]);
  const { GUARDS_METADATA } = await import('@nestjs/common/constants');
  const { BrowserOriginGuard } = await import('../auth/browser-origin.guard');
  const method = Object.getOwnPropertyDescriptor(
    PhotoManagementController.prototype,
    'mergeSelected',
  )?.value as object;
  const guards = Reflect.getMetadata(GUARDS_METADATA, method) as unknown[];
  assert.ok(guards.includes(BrowserOriginGuard));
});
