import { Prisma, type LibraryMode } from '@prisma/client';
import { DUPLICATE_GROUPING_VERSION } from '@sekereagle/library-core';
import type { DuplicateGroup } from '@sekereagle/library-core';
import { digest, signature, dismissalSignature, type Snapshot } from './eagle-duplicate-model';
import { DUPLICATE_FINGERPRINT_VERSION } from './eagle-duplicate-fingerprint';
/** Request reads aggregate hashes and a validated background projection; never run visual matching here. */
export async function readDuplicateReview(
  tx: Prisma.TransactionClient,
  ownerId: string,
  libraryMode: LibraryMode,
  includePrivate: boolean,
) {
  type HashGroup = {
    assetIds: string[];
    rowVersions: number[];
    mediaRevisions: number[];
    isPrivate: boolean;
    byteSize: number;
  };
  const privacy = includePrivate ? Prisma.empty : Prisma.sql`AND a."isPrivate"=false`;
  const [exact, similar, dismissed, counts] = await Promise.all([
    tx.$queryRaw<HashGroup[]>`SELECT
        array_agg(a.id ORDER BY a.rating DESC NULLS LAST, (a.width::bigint*a.height) DESC NULLS LAST, a."libraryAddedAt", a.id) AS "assetIds",
        array_agg(a."rowVersion" ORDER BY a.rating DESC NULLS LAST, (a.width::bigint*a.height) DESC NULLS LAST, a."libraryAddedAt", a.id) AS "rowVersions",
        array_agg(a."mediaRevision" ORDER BY a.rating DESC NULLS LAST, (a.width::bigint*a.height) DESC NULLS LAST, a."libraryAddedAt", a.id) AS "mediaRevisions",
        a."isPrivate", max(a."byteSize")::float8 AS "byteSize"
        FROM "EagleAsset" a WHERE a."ownerId"=${ownerId} AND a."libraryMode"=${libraryMode}::"LibraryMode"
          AND a."deletedAt" IS NULL AND a."purgeAfter" IS NULL AND NOT a."storageTransferredOut" AND a.sha256 IS NOT NULL ${privacy}
        GROUP BY a.sha256,a."byteSize",a."isPrivate",CASE lower(a.format) WHEN 'jpg' THEN 'jpeg' WHEN 'jpe' THEN 'jpeg' WHEN 'tif' THEN 'tiff' WHEN 'heif' THEN 'heic' ELSE lower(a.format) END HAVING count(*)>1`,
    tx.$queryRaw<
      Array<{
        signature: string;
        assetIds: string[];
        rowVersions: number[];
        mediaRevisions: number[];
        isPrivate: boolean;
        removableBytes: bigint;
      }>
    >`
        SELECT g.signature,g."assetIds",g."mediaRevisions",g."isPrivate",g."removableBytes",
          ARRAY(SELECT a."rowVersion" FROM unnest(g."assetIds") WITH ORDINALITY AS r(id,ordinal)
            JOIN "EagleAsset" a ON a.id=r.id AND a."ownerId"=g."ownerId" AND a."libraryMode"=g."libraryMode" ORDER BY r.ordinal) AS "rowVersions"
        FROM "EagleDuplicateGroup" g WHERE g."ownerId"=${ownerId} AND g."libraryMode"=${libraryMode}::"LibraryMode"
        AND g."algorithmVersion"=${DUPLICATE_GROUPING_VERSION}
        AND (${includePrivate} OR NOT g."isPrivate") AND NOT EXISTS (
          SELECT 1 FROM unnest(g."assetIds",g."rowVersions",g."mediaRevisions") AS r(id,version,revision)
          LEFT JOIN "EagleAsset" a ON a.id=r.id AND a."ownerId"=g."ownerId" AND a."libraryMode"=g."libraryMode"
          WHERE a.id IS NULL OR a."deletedAt" IS NOT NULL OR a."purgeAfter" IS NOT NULL OR a."storageTransferredOut"
            OR a."isPrivate"<>g."isPrivate" OR a."mediaRevision"<>r.revision
        )`,
    tx.eagleDuplicateDismissal.findMany({
      where: { ownerId, libraryMode: libraryMode },
      select: { signature: true },
    }),
    tx.$queryRaw<
      Array<{ total: number; indexed: number; waiting: number; outdatedGroups: number }>
    >`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE f."mediaRevision"=a."mediaRevision" AND f."processorVersion"=${DUPLICATE_FINGERPRINT_VERSION})::int AS indexed,
        count(*) FILTER (WHERE a."lifecycleStatus"<>'READY')::int AS waiting,
        (SELECT count(*)::int FROM "EagleDuplicateGroup" g WHERE g."ownerId"=${ownerId} AND g."libraryMode"=${libraryMode}::"LibraryMode" AND g."algorithmVersion"<>${DUPLICATE_GROUPING_VERSION} AND (${includePrivate} OR NOT g."isPrivate")) AS "outdatedGroups"
        FROM "EagleAsset" a LEFT JOIN "EagleDuplicateFingerprint" f ON f."assetId"=a.id AND f."ownerId"=a."ownerId" AND f."libraryMode"=a."libraryMode"
        WHERE a."ownerId"=${ownerId} AND a."libraryMode"=${libraryMode}::"LibraryMode" AND a."deletedAt" IS NULL
          AND a."purgeAfter" IS NULL AND NOT a."storageTransferredOut" AND a."mimeType" LIKE 'image/%' ${privacy}`,
  ]);
  const byId = new Map<string, Snapshot & { isPrivate: boolean }>();
  const groups: Array<DuplicateGroup & { signature: string }> = [];
  for (const row of [...exact, ...similar])
    row.assetIds.forEach((id, i) =>
      byId.set(id, {
        id,
        rowVersion: row.rowVersions[i]!,
        mediaRevision: row.mediaRevisions[i]!,
        isPrivate: row.isPrivate,
      }),
    );
  for (const row of exact) {
    const group: DuplicateGroup = {
      kind: 'EXACT',
      assetIds: row.assetIds,
      recommendedId: row.assetIds[0]!,
      removableBytes: row.byteSize * (row.assetIds.length - 1),
    };
    groups.push({ ...group, signature: signature(ownerId, libraryMode, group, byId) });
  }
  for (const row of similar) {
    const group: DuplicateGroup = {
      kind: 'SIMILAR',
      assetIds: row.assetIds,
      recommendedId: row.assetIds[0]!,
      removableBytes: Number(row.removableBytes),
    };
    groups.push({ ...group, signature: signature(ownerId, libraryMode, group, byId) });
  }
  groups.sort(
    (a, b) =>
      (a.kind === b.kind ? 0 : a.kind === 'EXACT' ? -1 : 1) ||
      b.removableBytes - a.removableBytes ||
      a.signature.localeCompare(b.signature),
  );
  const ignoredKeys = new Set(dismissed.map((row) => row.signature));
  const ignored = new Set(
    groups
      .filter((group) => ignoredKeys.has(dismissalSignature(ownerId, libraryMode, group, byId)))
      .map((group) => group.signature),
  );
  const revision = digest([
    ownerId,
    libraryMode,
    includePrivate,
    groups.map((g) => [g.signature, ignored.has(g.signature)]),
  ]);
  return {
    byId,
    groups,
    ignored,
    revision,
    exactRevision: digest([
      ownerId,
      libraryMode,
      includePrivate,
      groups.filter((g) => g.kind === 'EXACT').map((g) => [g.signature, ignored.has(g.signature)]),
    ]),
    outdatedGroups: counts[0]?.outdatedGroups ?? 0,
    algorithmVersion: DUPLICATE_GROUPING_VERSION,
    coverage: counts[0] ?? { total: 0, indexed: 0, waiting: 0 },
  };
}
