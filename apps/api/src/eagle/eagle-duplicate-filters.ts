import type { Prisma, LibraryMode } from '@prisma/client';
import { canonicalDuplicateFormat } from '@sekereagle/library-core';
import { digest } from './eagle-duplicate-model';
import type { DuplicateListDto } from './eagle-duplicates.dto';
import type { readDuplicateReview } from './eagle-duplicate-read';
export interface DuplicateFilterMember {
  id: string;
  originalName: string;
  byteSize: bigint;
  width: number | null;
  height: number | null;
  format: string;
  capturedAt: Date | null;
  capturedLocal: string | null;
  edited: boolean;
}
export function matchesDuplicateFilters(rows: DuplicateFilterMember[], filters: DuplicateListDto) {
  const equalKnown = (values: Array<string | number | bigint | null | undefined>) =>
    values.every((v) => v !== null && v !== undefined && v !== '' && v === values[0]);
  return (
    rows.length > 1 &&
    (filters.sameName !== 'true' || equalKnown(rows.map((r) => r.originalName))) &&
    (filters.sameCapturedAt !== 'true' ||
      equalKnown(rows.map((r) => r.capturedLocal ?? r.capturedAt?.toISOString()))) &&
    (filters.sameDimensions !== 'true' ||
      (equalKnown(rows.map((r) => r.width)) && equalKnown(rows.map((r) => r.height)))) &&
    (filters.sameFormat !== 'true' ||
      equalKnown(rows.map((r) => canonicalDuplicateFormat(r.format)))) &&
    (filters.sameBytes !== 'true' || equalKnown(rows.map((r) => r.byteSize))) &&
    (!filters.maxBytes || rows.every((r) => r.byteSize < BigInt(filters.maxBytes!))) &&
    (filters.protectEdits !== 'true' || rows.every((r) => !r.edited))
  );
}
/** Filter the already-proven groups, never promote metadata matches to duplicate evidence. */
export async function filterDuplicateReview(
  tx: Prisma.TransactionClient,
  state: Awaited<ReturnType<typeof readDuplicateReview>>,
  ownerId: string,
  libraryMode: LibraryMode,
  includePrivate: boolean,
  input: DuplicateListDto,
) {
  const filters = Object.fromEntries(
    ['sameName', 'sameCapturedAt', 'sameDimensions', 'sameFormat', 'sameBytes', 'protectEdits']
      .filter((key) => input[key as keyof DuplicateListDto] === 'true')
      .map((key) => [key, 'true']),
  );
  if (input.maxBytes) Object.assign(filters, { maxBytes: input.maxBytes });
  const scoped = input.kind && input.kind !== 'ALL';
  if (!Object.keys(filters).length && !scoped) return state;
  let groups = state.groups;
  if (Object.keys(filters).length && groups.length) {
    const ids = [...new Set(groups.flatMap((g) => g.assetIds))];
    // A single parameterized array of existing duplicate IDs, not one SQL/EXIF read per member.
    const rows = await tx.$queryRaw<DuplicateFilterMember[]>`WITH protected AS MATERIALIZED (
      SELECT DISTINCT ref.id FROM "EagleAssetEditRecipe" e
      CROSS JOIN LATERAL unnest(ARRAY[e."assetId",e."baseAssetId"]) AS ref(id)
      WHERE ${input.protectEdits === 'true'} AND e."ownerId"=${ownerId} AND e."libraryMode"=${libraryMode}::"LibraryMode" AND e."baseAssetId" IS NOT NULL
    ) SELECT a.id,a."originalName",a."byteSize",a.width,a.height,a.format,
      p."capturedAt",p."capturedLocal",(e.id IS NOT NULL) AS edited
      FROM "EagleAsset" a LEFT JOIN protected e ON e.id=a.id LEFT JOIN "EaglePhotoMetadata" p
        ON p."ownerId"=a."ownerId" AND p."libraryMode"=a."libraryMode" AND p."assetId"=a.id AND p."assetRevision"=a."mediaRevision"
      WHERE a."ownerId"=${ownerId} AND a."libraryMode"=${libraryMode}::"LibraryMode" AND a.id=ANY(${ids}::text[])
        AND a."deletedAt" IS NULL AND a."purgeAfter" IS NULL AND NOT a."storageTransferredOut" AND (${includePrivate} OR NOT a."isPrivate")`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    groups = groups.filter((g) => {
      const members = g.assetIds.map((id) => byId.get(id));
      return members.every((r) => !!r) && matchesDuplicateFilters(members, input);
    });
  }
  return {
    ...state,
    groups,
    exactRevision: Object.keys(filters).length
      ? digest([
          state.exactRevision,
          filters,
          input.kind ?? 'ALL',
          groups.filter((g) => g.kind === 'EXACT').map((g) => g.signature),
        ])
      : state.exactRevision,
    revision: digest([
      state.revision,
      filters,
      input.kind ?? 'ALL',
      groups.map((g) => g.signature),
    ]),
  };
}
