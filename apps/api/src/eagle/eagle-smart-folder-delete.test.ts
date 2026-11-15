import assert from 'node:assert/strict';
import test from 'node:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { EagleService } from './eagle.service';

test('smart folder delete refuses while child folders remain', async () => {
  let deleted = false;
  const service = new EagleService(
    {
      eagleSmartFolder: {
        count: async () => 1,
        deleteMany: async () => {
          deleted = true;
          return { count: 1 };
        },
      },
    } as never,
    undefined,
    'MATERIAL',
  );

  await assert.rejects(
    service.deleteSmartFolder('owner-1', 'folder-1'),
    (error: unknown) => error instanceof ConflictException,
  );
  assert.equal(deleted, false);
});

test('smart folder delete is scoped by owner so foreign folders read as 404', async () => {
  let where: unknown;
  const service = new EagleService(
    {
      eagleSmartFolder: {
        count: async () => 0,
        deleteMany: async (input: { where: unknown }) => {
          where = input.where;
          return { count: 0 };
        },
      },
    } as never,
    undefined,
    'MATERIAL',
  );

  await assert.rejects(
    service.deleteSmartFolder('owner-1', 'other-owner-folder'),
    (error: unknown) => error instanceof NotFoundException,
  );
  assert.deepEqual(where, {
    ownerId: 'owner-1',
    id: 'other-owner-folder',
    libraryMode: 'MATERIAL',
  });
});

test('smart folder delete removes only the folder row and returns its id', async () => {
  let countWhere: unknown;
  const service = new EagleService(
    {
      eagleSmartFolder: {
        count: async (input: { where: unknown }) => {
          countWhere = input.where;
          return 0;
        },
        deleteMany: async () => ({ count: 1 }),
      },
    } as never,
    undefined,
    'MATERIAL',
  );

  assert.deepEqual(await service.deleteSmartFolder('owner-1', 'folder-1'), { id: 'folder-1' });
  assert.deepEqual(countWhere, {
    ownerId: 'owner-1',
    parentId: 'folder-1',
    libraryMode: 'MATERIAL',
  });
});
