import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditRender } from './eagle-edit-render';
import { DEFAULT_PHOTO_EDITS } from '@sekereagle/library-core';
import type { PrismaService } from '../prisma/prisma.service';
const input = { requestId: 'c904e831-b169-4cc5-a6ab-c008bc673e92', mediaRevision: 1, rowVersion: 3, recipe: { version: 1, edits: DEFAULT_PHOTO_EDITS } };
test('render requests derive owner and mode and conceal missing/private/cross-owner sources', async () => {
  let where: unknown;
  const db = { $transaction: async (run: (tx: unknown) => unknown) => run({
    $queryRaw: async () => [], eagleAsset: { findFirst: async (args: { where: unknown }) => { where = args.where; return null; } },
  }) } as unknown as PrismaService;
  await assert.rejects(createEditRender(db, 'owner', 'PHOTO', 'source', input, false), (reason: unknown) => (reason as { getStatus(): number }).getStatus() === 404);
  assert.deepEqual(where, { id: 'source', ownerId: 'owner', libraryMode: 'PHOTO', deletedAt: null, purgeAfter: null, isPrivate: false });
});
test('a stale revision or row version cannot enqueue an edit of newer contents', async () => {
  for (const source of [{ mediaRevision: 2, rowVersion: 3 }, { mediaRevision: 1, rowVersion: 4 }]) {
    const db = { $transaction: async (run: (tx: unknown) => unknown) => run({
      $queryRaw: async () => [], eagleAsset: { findFirst: async () => ({ id: 'source', mimeType: 'image/jpeg', lifecycleStatus: 'READY', ...source }) },
    }) } as unknown as PrismaService;
    await assert.rejects(createEditRender(db, 'owner', 'MATERIAL', 'source', input, false), (reason: unknown) => (reason as { getStatus(): number }).getStatus() === 409);
  }
});
