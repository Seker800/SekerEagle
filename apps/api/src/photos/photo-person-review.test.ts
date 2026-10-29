import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoManagementService } from './photo-management.service';

test('person merge refuses a stale review before moving any faces', async () => {
  let writes = 0;
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    eaglePhotoPerson: {
      findFirst: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        rowVersion: 2,
        marksAssetsPrivate: false,
      }),
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
  assert.deepEqual(calls[0], ['trusted-owner', false, undefined]);
  assert.equal(calls[1]?.[0], 'trusted-owner');
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
