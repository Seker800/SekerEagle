import { Prisma, type LibraryMode, type PrismaClient } from '@prisma/client';

/** Only immutable, scoped operation facts may supply a shared portable numeric table. */
export async function resolveEditRenderLut(
  db: Pick<PrismaClient, '$queryRaw'>,
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
  // A bank may contain many multi-MB tables. PostgreSQL returns only this job's
  // selected table; unrelated LUTs and the command recipe never enter worker memory.
  const [projection] = await db.$queryRaw<
    Array<{
      lut: string | null;
      payloadExists: boolean | null;
      recipeMatches: boolean | null;
    }>
  >(Prisma.sql`
    SELECT CASE
      WHEN ("commandPayload"#>'{parts,filter}') IS DISTINCT FROM 'false'::jsonb
        AND "commandPayload"#>>'{recipe,edits,filter}'=${filter}
        AND jsonb_typeof("commandPayload"->'lut')='string'
        THEN "commandPayload"->>'lut'
      WHEN jsonb_typeof("commandPayload"->'preservedLuts'->(${filter}::text))='string'
        THEN "commandPayload"->'preservedLuts'->>(${filter}::text)
      ELSE NULL END AS lut,
      jsonb_typeof("commandPayload")='object' AS "payloadExists",
      "commandPayload"#>>'{recipe,edits,filter}'=${filter} AS "recipeMatches"
    FROM "EagleAssetOperation"
    WHERE id=${row.commandOperationId} AND "ownerId"=${row.ownerId}
      AND "libraryMode"=${row.libraryMode}::"LibraryMode" AND kind='METADATA_COMMAND'
  `);
  if (!projection?.payloadExists) throw new Error('EDIT_LUT_REFERENCE_MISSING');
  if (typeof projection.lut === 'string') return projection.lut;
  if (!projection.recipeMatches) throw new Error('EDIT_LUT_REFERENCE_MISMATCH');
  throw new Error('EDIT_LUT_REFERENCE_MISSING');
}
