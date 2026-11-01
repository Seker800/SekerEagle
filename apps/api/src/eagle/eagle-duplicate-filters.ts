import type { Prisma, LibraryMode } from '@prisma/client';
import { canonicalDuplicateFormat } from '@sekereagle/library-core';
import { digest, signature, dismissalSignature } from './eagle-duplicate-model';
import { readMetadataDuplicateGroups } from './eagle-duplicate-condition-groups';
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
  return partitionDuplicateMembers(rows, filters).some((part) => part.length === rows.length);
}
/** Selected equality fields form subgroups; unchecked fields never shrink the result. */
export function partitionDuplicateMembers(
  rows: DuplicateFilterMember[],
  filters: DuplicateListDto,
) {
  const buckets = new Map<string, DuplicateFilterMember[]>();
  for (const row of rows) {
    if (
      (filters.protectEdits === 'true' && row.edited) ||
      (filters.maxBytes && row.byteSize >= BigInt(filters.maxBytes))
    )
      continue;
    const values: Array<string | number | bigint | null | undefined> = [];
    if (filters.sameName === 'true') values.push(row.originalName);
    if (filters.sameCapturedAt === 'true')
      values.push(
        (row.capturedLocal ?? row.capturedAt?.toISOString().replace(/Z$/, ''))?.replace(
          /(\.\d*?[1-9])0+$|\.0+$/,
          '$1',
        ),
      );
    if (filters.sameDimensions === 'true') {
      if (!row.width || !row.height) continue;
      values.push(row.width, row.height);
    }
    if (filters.sameFormat === 'true') values.push(canonicalDuplicateFormat(row.format));
    if (filters.sameBytes === 'true') values.push(row.byteSize);
    if (values.some((v) => v === null || v === undefined || v === '')) continue;
    const key = JSON.stringify(values, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    const bucket = buckets.get(key) ?? [];
    bucket.push(row);
    buckets.set(key, bucket);
  }
  return [...buckets.values()].filter((rows) => rows.length > 1);
}
/** Apply conditions to the full library or to precomputed visual candidates, never decode in HTTP. */
export async function filterDuplicateReview(
  tx: Prisma.TransactionClient,
  state: Awaited<ReturnType<typeof readDuplicateReview>>,
  ownerId: string,
  libraryMode: LibraryMode,
  includePrivate: boolean,
  input: DuplicateListDto,
) {
  if (input.kind === 'EXACT') return state;
  return readConditionalReview(tx, state, ownerId, libraryMode, includePrivate, {
    ...input,
    sameVisual: input.sameVisual ?? 'true',
  });
}

async function readConditionalReview(
  tx: Prisma.TransactionClient,
  state: Awaited<ReturnType<typeof readDuplicateReview>>,
  ownerId: string,
  libraryMode: LibraryMode,
  includePrivate: boolean,
  input: DuplicateListDto,
) {
  const byId = new Map(state.byId);
  const groups = state.groups.filter((g) => g.kind === 'EXACT');
  const add = (ids: string[], removableBytes: number) => {
    const group = {
      kind: 'SIMILAR' as const,
      assetIds: ids,
      recommendedId: ids[0]!,
      removableBytes,
    };
    groups.push({ ...group, signature: signature(ownerId, libraryMode, group, byId) });
  };
  if (input.sameVisual === 'true') {
    const visual = state.groups.filter((g) => g.kind === 'SIMILAR');
    const ids = [...new Set(visual.flatMap((g) => g.assetIds))];
    if (ids.length) {
      const rows = await tx.$queryRaw<DuplicateFilterMember[]>`WITH protected AS MATERIALIZED (
        SELECT DISTINCT ref.id FROM "EagleAssetEditRecipe" e
        CROSS JOIN LATERAL unnest(ARRAY[e."assetId",e."baseAssetId"]) ref(id)
        WHERE ${input.protectEdits === 'true'} AND e."ownerId"=${ownerId}
          AND e."libraryMode"=${libraryMode}::"LibraryMode" AND e."baseAssetId" IS NOT NULL
      ) SELECT a.id,a."originalName",a."byteSize",a.width,a.height,a.format,
        p."capturedAt",p."capturedLocal",(e.id IS NOT NULL) AS edited
        FROM "EagleAsset" a LEFT JOIN protected e ON e.id=a.id
        LEFT JOIN "EaglePhotoMetadata" p ON p."ownerId"=a."ownerId" AND p."libraryMode"=a."libraryMode"
          AND p."assetId"=a.id AND p."assetRevision"=a."mediaRevision"
        WHERE a."ownerId"=${ownerId} AND a."libraryMode"=${libraryMode}::"LibraryMode"
          AND a.id=ANY(${ids}::text[]) AND a."deletedAt" IS NULL AND a."purgeAfter" IS NULL
          AND NOT a."storageTransferredOut" AND (${includePrivate} OR NOT a."isPrivate")`;
      const members = new Map(rows.map((r) => [r.id, r]));
      for (const group of visual) {
        const current = group.assetIds.flatMap((id) => (members.has(id) ? [members.get(id)!] : []));
        for (const part of partitionDuplicateMembers(current, input))
          add(
            part.map((r) => r.id),
            part.slice(1).reduce((n, r) => n + Number(r.byteSize), 0),
          );
      }
    }
  } else {
    for (const row of await readMetadataDuplicateGroups(
      tx,
      ownerId,
      libraryMode,
      includePrivate,
      input,
    )) {
      row.assetIds.forEach((id, i) =>
        byId.set(id, {
          id,
          rowVersion: row.rowVersions[i]!,
          mediaRevision: row.mediaRevisions[i]!,
          isPrivate: row.isPrivate,
        }),
      );
      add(row.assetIds, Number(row.removableBytes));
    }
  }
  if (!input.kind || input.kind === 'ALL') {
    const visualIds = new Set(
      groups.filter((g) => g.kind === 'SIMILAR').flatMap((g) => g.assetIds),
    );
    for (let i = groups.length - 1; i >= 0; i--) {
      const group = groups[i]!;
      if (group.kind !== 'EXACT') continue;
      const remaining = group.assetIds.filter((id) => !visualIds.has(id));
      if (remaining.length === group.assetIds.length) continue;
      if (remaining.length < 2) groups.splice(i, 1);
      else {
        const next = { ...group, assetIds: remaining, recommendedId: remaining[0]! };
        groups[i] = { ...next, signature: signature(ownerId, libraryMode, next, byId) };
      }
    }
  }
  const ignored = new Set(
    groups
      .filter((g) =>
        state.dismissedSignatures.has(dismissalSignature(ownerId, libraryMode, g, byId)),
      )
      .map((g) => g.signature),
  );
  return {
    ...state,
    byId,
    groups,
    ignored,
    revision: digest([
      state.revision,
      input.sameVisual,
      input.sameName,
      input.sameCapturedAt,
      input.sameDimensions,
      input.sameFormat,
      input.sameBytes,
      input.maxBytes,
      input.protectEdits,
      input.kind,
      groups.map((g) => [g.signature, ignored.has(g.signature)]),
    ]),
  };
}
