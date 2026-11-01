import { Prisma, type LibraryMode } from '@prisma/client';
import type { DuplicateListDto } from './eagle-duplicates.dto';

/** Metadata conditions are grouped by SQL, independently of visual evidence or preview readiness. */
export async function readMetadataDuplicateGroups(
  tx: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode,
  includePrivate: boolean,
  input: DuplicateListDto,
) {
  const keys: Prisma.Sql[] = [];
  const known: Prisma.Sql[] = [];
  const add = (enabled: boolean, key: Prisma.Sql, valid: Prisma.Sql) => {
    if (enabled) {
      keys.push(key);
      known.push(valid);
    }
  };
  add(input.sameName === 'true', Prisma.sql`a."originalName"`, Prisma.sql`a."originalName"<>''`);
  const rawCaptured = Prisma.sql`coalesce(p."capturedLocal",to_char(p."capturedAt" AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS'))`;
  const captured = Prisma.sql`CASE WHEN position('.' in ${rawCaptured})>0
    THEN rtrim(rtrim(${rawCaptured},'0'),'.') ELSE ${rawCaptured} END`;
  add(
    input.sameCapturedAt === 'true',
    captured,
    Prisma.sql`${captured} IS NOT NULL AND ${captured}<>''`,
  );
  add(
    input.sameDimensions === 'true',
    Prisma.sql`a.width,a.height`,
    Prisma.sql`a.width>0 AND a.height>0`,
  );
  const format = Prisma.sql`CASE lower(trim(a.format)) WHEN 'jpg' THEN 'jpeg' WHEN 'jpe' THEN 'jpeg' WHEN 'tif' THEN 'tiff' WHEN 'heif' THEN 'heic' ELSE lower(trim(a.format)) END`;
  add(input.sameFormat === 'true', format, Prisma.sql`trim(a.format)<>''`);
  add(input.sameBytes === 'true', Prisma.sql`a."byteSize"`, Prisma.sql`a."byteSize" IS NOT NULL`);
  // A size budget or edit protection is not an equality relationship between two files.
  if (!keys.length) return [];
  const order = Prisma.sql`a.rating DESC NULLS LAST,(a.width::bigint*a.height) DESC NULLS LAST,a."byteSize" DESC,a."libraryAddedAt",a.id`;
  return tx.$queryRaw<
    Array<{
      assetIds: string[];
      rowVersions: number[];
      mediaRevisions: number[];
      isPrivate: boolean;
      removableBytes: bigint;
    }>
  >`WITH protected AS MATERIALIZED (
    SELECT DISTINCT ref.id FROM "EagleAssetEditRecipe" e
    CROSS JOIN LATERAL unnest(ARRAY[e."assetId",e."baseAssetId"]) ref(id)
    WHERE ${input.protectEdits === 'true'} AND e."ownerId"=${ownerId}
      AND e."libraryMode"=${libraryMode}::"LibraryMode" AND e."baseAssetId" IS NOT NULL
  ) SELECT array_agg(a.id ORDER BY ${order}) AS "assetIds",
    array_agg(a."rowVersion" ORDER BY ${order}) AS "rowVersions",
    array_agg(a."mediaRevision" ORDER BY ${order}) AS "mediaRevisions",a."isPrivate",
    sum(a."byteSize")::bigint-(array_agg(a."byteSize" ORDER BY ${order}))[1] AS "removableBytes"
    FROM "EagleAsset" a LEFT JOIN "EaglePhotoMetadata" p ON p."ownerId"=a."ownerId"
      AND p."libraryMode"=a."libraryMode" AND p."assetId"=a.id AND p."assetRevision"=a."mediaRevision"
    WHERE a."ownerId"=${ownerId} AND a."libraryMode"=${libraryMode}::"LibraryMode"
      AND a."deletedAt" IS NULL AND a."purgeAfter" IS NULL AND NOT a."storageTransferredOut"
      AND (${includePrivate} OR NOT a."isPrivate") AND a."livePhotoRole" IS DISTINCT FROM 'MOTION'
      AND NOT EXISTS(SELECT 1 FROM protected e WHERE e.id=a.id)
      ${input.maxBytes ? Prisma.sql`AND a."byteSize"<${input.maxBytes}::numeric` : Prisma.empty}
      AND ${Prisma.join(known, ' AND ')}
    GROUP BY a."isPrivate",${Prisma.join(keys)} HAVING count(*)>1`;
}
