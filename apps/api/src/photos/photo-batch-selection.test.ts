import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { ManualPhotoActionDto, ReviewPhotoRequestDto } from './photo-agent.dto';
import { PhotoManagementService } from './photo-management.service';

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
test('manual and approval selections accept the entire batch beyond former product caps', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  await pipe.transform(
    {
      operationId: id(999),
      action: 'DELETE',
      items: Array.from({ length: 501 }, (_, i) => ({
        suggestionId: id(i + 1),
        mediaRevision: 1,
        rowVersion: 1,
      })),
    },
    { type: 'body', metatype: ManualPhotoActionDto },
  );
  await pipe.transform(
    { action: 'ACCEPT', suggestionIds: Array.from({ length: 501 }, (_, i) => id(i + 1)) },
    { type: 'body', metatype: ReviewPhotoRequestDto },
  );
});
test('manual photo grouping batches database statements while committing one complete group', async () => {
  let transactions = 0;
  const writes: number[] = [];
  const reads: number[] = [];
  const tx = {
    $executeRaw: async () => 0,
    eagleAsset: {
      count: async (input: { where: { id: { in: string[] } } }) => {
        reads.push(input.where.id.in.length);
        return input.where.id.in.length;
      },
    },
    eaglePhotoGroup: { create: async () => ({ id: 'group' }) },
    eaglePhotoGroupMember: {
      createMany: async (input: { data: unknown[] }) => {
        writes.push(input.data.length);
        return { count: input.data.length };
      },
    },
  };
  const photos = new PhotoManagementService({
    $transaction: async (run: (tx: unknown) => unknown) => {
      transactions++;
      return run(tx);
    },
  } as never);
  assert.deepEqual(
    await photos.createGroup(
      'owner',
      Array.from({ length: 1201 }, (_, i) => id(i + 1)),
      false,
    ),
    { id: 'group' },
  );
  assert.equal(transactions, 1);
  assert.equal(
    writes.reduce((sum, n) => sum + n, 0),
    1201,
  );
  assert.ok(writes.length > 1);
  assert.ok(Math.max(...reads) <= 512);
});
