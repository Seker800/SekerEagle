import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DEFAULT_PHOTO_EDITS } from '@sekereagle/library-core';
import { NotFoundException, ConflictException } from '@nestjs/common';
import {
  readEagleEditRecipe,
  saveEagleEditRecipe,
  SaveEagleEditRecipeDto,
} from './eagle-edit-recipe';
for (const mode of ['MATERIAL', 'PHOTO'] as const) {
  test(`recipe reads and writes require owner, mode, visibility and current media version (${mode})`, async () => {
    let where: unknown;
    let write: unknown;
    let asset: unknown = null;
    const db = {
      eagleAsset: {
        findFirst: async (args: { where: unknown }) => {
          where = args.where;
          return asset;
        },
      },
      eagleAssetEditRecipe: {
        findFirst: async () => null,
        upsert: async (args: unknown) => {
          write = args;
        },
      },
      $queryRaw: async () => [],
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    };
    await assert.rejects(
      () => readEagleEditRecipe(db as never, 'owner', mode, 'asset', false),
      NotFoundException,
    );
    assert.deepEqual(where, {
      id: 'asset',
      ownerId: 'owner',
      libraryMode: mode,
      deletedAt: null,
      purgeAfter: null,
      isPrivate: false,
    });
    const input = { mediaRevision: 2, recipe: { version: 1, edits: DEFAULT_PHOTO_EDITS } };
    await assert.rejects(
      () => saveEagleEditRecipe(db as never, 'owner', mode, 'asset', input, false),
      NotFoundException,
    );
    assert.equal(write, undefined);
    asset = { mediaRevision: 3 };
    await assert.rejects(
      () => saveEagleEditRecipe(db as never, 'owner', mode, 'asset', input, false),
      ConflictException,
    );
    asset = { mediaRevision: 2 };
    await saveEagleEditRecipe(db as never, 'owner', mode, 'asset', input, false);
    assert.ok(write);
  });
}
test('draft DTO rejects owner injection and malformed version', () => {
  const errors = validateSync(
    plainToInstance(SaveEagleEditRecipeDto, { ownerId: 'victim', mediaRevision: 0, recipe: [] }),
    { whitelist: true, forbidNonWhitelisted: true },
  );
  assert.deepEqual(errors.map((error) => error.property).sort(), [
    'mediaRevision',
    'ownerId',
    'recipe',
  ]);
});
