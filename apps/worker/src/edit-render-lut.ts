import type { LibraryMode, PrismaClient } from '@prisma/client';
import { readPhotoEditRecipe } from '@sekereagle/library-core';

/** Only immutable, scoped operation facts may supply a shared portable numeric table. */
export async function resolveEditRenderLut(
  db: Pick<PrismaClient, 'eagleAssetOperation'>,
  row: {
    ownerId: string;
    libraryMode: LibraryMode;
    lut: string | null;
    commandOperationId?: string | null;
  },
  filter: string,
): Promise<string | null> {
  if (!row.commandOperationId) {
    if (filter.startsWith('lut:') && !row.lut) throw new Error('EDIT_LUT_MISSING');
    return row.lut;
  }
  if (row.lut || !filter.startsWith('lut:')) throw new Error('EDIT_LUT_REFERENCE_INVALID');
  const operation = await db.eagleAssetOperation.findFirst({
    where: {
      id: row.commandOperationId,
      ownerId: row.ownerId,
      libraryMode: row.libraryMode,
      kind: 'METADATA_COMMAND',
    },
    select: { commandPayload: true },
  });
  const payload = operation?.commandPayload;
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload) ||
    typeof payload.lut !== 'string'
  )
    throw new Error('EDIT_LUT_REFERENCE_MISSING');
  const recipe = readPhotoEditRecipe(payload.recipe);
  if (recipe.edits.filter !== filter) throw new Error('EDIT_LUT_REFERENCE_MISMATCH');
  return payload.lut;
}
