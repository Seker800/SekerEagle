import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoManagementController } from './photo-management.controller';
import { PhotoManagementService } from './photo-management.service';

const embedding = Array.from({ length: 128 }, (_, index) => (index === 0 ? 1 : 0));
const face = {
  id: 'face',
  personId: 'source',
  assetId: 'asset',
  embedding,
  modelVersion: 'face-v1',
};

function database(remaining: number) {
  const created: string[] = [];
  const deleted: string[] = [];
  const updated: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: async () => [],
    $executeRaw: async () => 0,
    eaglePhotoFace: {
      findMany: async () => [face],
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        updated.push(data);
        return { count: 1 };
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updated.push(data);
        return {};
      },
      count: async () => remaining,
    },
    eaglePhotoPerson: {
      create: async () => {
        created.push('new-person');
        return { id: 'new-person' };
      },
      updateMany: async () => ({ count: 1 }),
      deleteMany: async ({ where }: { where: { id: string } }) => {
        deleted.push(where.id);
        return { count: 1 };
      },
      update: async () => ({}),
    },
  };
  return {
    updated,
    created,
    deleted,
    db: {
      $transaction: async (fn: (tx: unknown) => unknown) => fn(tx),
    },
  };
}

test('removing false faces hides them and removes an empty group in one command', async () => {
  const state = database(0);
  const service = new PhotoManagementService(state.db as never);
  const result = await service.batchFaces('owner', ['face'], 'REMOVE', false);
  assert.deepEqual(result, { changed: 1, privacyChanged: true });
  assert.equal(state.updated[0]?.isCurrent, false);
  assert.equal(state.updated[0]?.personId, null);
  assert.deepEqual(state.deleted, ['source']);
});

test('splitting selected faces creates one new person per face and keeps the old group when it has faces', async () => {
  const state = database(1);
  const service = new PhotoManagementService(state.db as never);
  const result = await service.batchFaces('owner', ['face'], 'SPLIT', false);
  assert.deepEqual(result, { changed: 1, privacyChanged: true });
  assert.deepEqual(state.created, ['new-person']);
  assert.equal(state.updated[0]?.personId, 'new-person');
  assert.equal(state.updated[0]?.userAssigned, true);
});

test('batch face admission rejects a face outside the visible owner scope', async () => {
  const service = new PhotoManagementService({
    eaglePhotoFace: { count: async () => 0 },
  } as never);
  await assert.rejects(
    service.admitCommand('owner', false, 'PHOTO_FACE_BATCH', {
      ids: ['00000000-0000-4000-8000-000000000001'],
      action: 'REMOVE',
    }),
    /人脸不存在/,
  );
});

test('batch face route derives the operation type and validates every id', async () => {
  const calls: unknown[] = [];
  const operations = {
    enqueueCommand: async (principal: unknown, input: unknown) => {
      calls.push([principal, input]);
      return { id: 'operation' };
    },
  };
  const controller = new PhotoManagementController(
    {} as never,
    {} as never,
    {} as never,
    operations as never,
  );
  const principal = { sub: 'owner-a', canViewPrivate: false };
  await controller.batchFaces(principal as never, {
    ids: ['00000000-0000-4000-8000-000000000001'],
    action: 'SPLIT',
  });
  assert.deepEqual(calls, [
    [
      principal,
      {
        type: 'PHOTO_FACE_BATCH',
        payload: { ids: ['00000000-0000-4000-8000-000000000001'], action: 'SPLIT' },
      },
    ],
  ]);
});
