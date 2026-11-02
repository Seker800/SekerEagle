import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PHOTO_EDITS } from '@sekereagle/library-core';
import { resolveEditRenderLut } from './edit-render-lut';
const row = {
  ownerId: 'owner',
  libraryMode: 'PHOTO' as const,
  lut: null,
  commandOperationId: 'operation',
};

test('worker resolves the immutable shared LUT through owner and mode scoped operation facts', async () => {
  const reads: unknown[] = [];
  const db = {
    eagleAssetOperation: {
      findFirst: async (input: unknown) => {
        reads.push(input);
        return {
          commandPayload: {
            lut: 'portable',
            recipe: { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, filter: 'lut:shared' } },
          },
        };
      },
    },
  };
  assert.equal(await resolveEditRenderLut(db as never, row, 'lut:shared'), 'portable');
  assert.deepEqual(reads, [
    {
      where: { id: 'operation', ownerId: 'owner', libraryMode: 'PHOTO', kind: 'METADATA_COMMAND' },
      select: { commandPayload: true },
    },
  ]);
});

test('worker fails closed for inaccessible shared LUT, mismatched recipe and ambiguous inline data', async () => {
  for (const commandPayload of [
    null,
    {
      lut: 'portable',
      recipe: { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, filter: 'lut:other' } },
    },
  ]) {
    const db = { eagleAssetOperation: { findFirst: async () => ({ commandPayload }) } };
    await assert.rejects(resolveEditRenderLut(db as never, row, 'lut:shared'));
  }
  await assert.rejects(
    resolveEditRenderLut({} as never, { ...row, lut: 'inline' }, 'lut:shared'),
    /EDIT_LUT_REFERENCE_INVALID/,
  );
});

test('worker retains pre-migration inline LUT compatibility and rejects missing custom LUT', async () => {
  assert.equal(
    await resolveEditRenderLut(
      {} as never,
      { ...row, commandOperationId: null, lut: 'inline' },
      'lut:legacy',
    ),
    'inline',
  );
  await assert.rejects(
    resolveEditRenderLut({} as never, { ...row, commandOperationId: null }, 'lut:legacy'),
    /EDIT_LUT_MISSING/,
  );
});

test('worker resolves a preserved target filter independently of the clipboard filter', async () => {
  const db = {
    eagleAssetOperation: {
      findFirst: async () => ({
        commandPayload: {
          recipe: { version: 1, edits: DEFAULT_PHOTO_EDITS },
          preservedLuts: { 'lut:browser-upload': 'portable-preserved' },
        },
      }),
    },
  };
  assert.equal(
    await resolveEditRenderLut(db as never, row, 'lut:browser-upload'),
    'portable-preserved',
  );
});

test('worker fails closed when the preserved bank omits the exact target filter or has nonnumeric-table content type', async () => {
  for (const preservedLuts of [{ 'lut:other': 'portable' }, { 'lut:browser-upload': 8 }]) {
    const db = {
      eagleAssetOperation: {
        findFirst: async () => ({
          commandPayload: { recipe: { version: 1, edits: DEFAULT_PHOTO_EDITS }, preservedLuts },
        }),
      },
    };
    await assert.rejects(resolveEditRenderLut(db as never, row, 'lut:browser-upload'));
  }
});

test('unselected filter always uses preserved target table even when clipboard has the same filter ID', async () => {
  const db = {
    eagleAssetOperation: {
      findFirst: async () => ({
        commandPayload: {
          recipe: { version: 1, edits: { ...DEFAULT_PHOTO_EDITS, filter: 'lut:target' } },
          parts: { filter: false },
          lut: 'must-ignore-clipboard',
          preservedLuts: { 'lut:target': 'preserved-target' },
        },
      }),
    },
  };
  assert.equal(await resolveEditRenderLut(db as never, row, 'lut:target'), 'preserved-target');
});
