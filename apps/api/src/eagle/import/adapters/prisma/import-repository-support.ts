import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { EagleImportItemAction } from '@prisma/client';
import { EagleImportItemStatus, EagleImportRunStatus, Prisma } from '@prisma/client';
import type { PrismaService } from '../../../../prisma/prisma.service';
import type { SekerEagleIngestionPort } from '../../../seker-eagle-ingestion.port';
import type { mapEagleImportItemMetadata } from '../../eagle-app-import-manifest';
import { type EagleImportManifestChunkInput } from '../../eagle-app-import-manifest';
import type { CreateEagleImportRunInput } from '../../eagle-app-import.repository';
import {
  ACTIVE_EAGLE_IMPORT_ITEM_STATUSES,
  resolveEagleImportRunCompletion,
} from '../../eagle-app-import-policy';
import { eagleImportProgressMode } from '../../eagle-app-import-progress-mode';

export const RUN_SELECT = {
  id: true,
  externalLibraryId: true,
  idempotencyKey: true,
  declarationHash: true,
  manifestVersion: true,
  status: true,
  declaredItemCount: true,
  declaredByteSize: true,
  stagedItemCount: true,
  importedItemCount: true,
  skippedItemCount: true,
  failedItemCount: true,
  startedAt: true,
  completedAt: true,
  cancelledAt: true,
  lastErrorCode: true,
  createdAt: true,
  updatedAt: true,
  externalLibrary: { select: { externalLibraryId: true } },
} satisfies Prisma.EagleImportRunSelect;

export type ImportRunProjection = Prisma.EagleImportRunGetPayload<{ select: typeof RUN_SELECT }>;

export const IMPORT_ITEM_SELECT = {
  id: true,
  sourceItemId: true,
  displayName: true,
  originalFileName: true,
  mimeType: true,
  byteSize: true,
  status: true,
  action: true,
  attemptCount: true,
  warningCodes: true,
  errorCode: true,
  errorMessage: true,
  assetId: true,
  completedAt: true,
  updatedAt: true,
  activeUploadSessionId: true,
} satisfies Prisma.EagleImportRunItemSelect;

export type ImportItemProjection = Prisma.EagleImportRunItemGetPayload<{
  select: typeof IMPORT_ITEM_SELECT;
}>;

export interface ImportPreflightSummary {
  itemCount: bigint;
  byteSize: bigint;
  readyItemCount: bigint;
  alreadyImportedItemCount: bigint;
  skippedDeletedItemCount: bigint;
  skippedUnsupportedItemCount: bigint;
  warningCount: bigint;
  newItemCount: bigint;
  unchangedItemCount: bigint;
  metadataUpdateItemCount: bigint;
  contentReplaceItemCount: bigint;
  uploadItemCount: bigint;
  uploadByteSize: bigint;
  missingFolderIds: string[];
}

export interface ImportMetadataSource {
  id: string;
  runId: string;
  externalAssetId: string;
  displayName: string;
  sourceImportedAt: Date | null;
  sourceModifiedAt: Date | null;
  metadataHash: string;
  contentSha256: string | null;
  sourceFileModifiedAt: Date | null;
  byteSize: bigint;
  rating: number | null;
  description: string | null;
  sourceUrl: string | null;
  tagNames: string[];
  assetId: string | null;
}
export const MAPPED_ITEM_SELECT = {
  id: true,
  runId: true,
  externalAssetId: true,
  displayName: true,
  sourceImportedAt: true,
  sourceModifiedAt: true,
  metadataHash: true,
  contentSha256: true,
  sourceFileModifiedAt: true,
  byteSize: true,
  rating: true,
  description: true,
  sourceUrl: true,
  tagNames: true,
  assetId: true,
} as const;

export async function assertImportRun(prisma: PrismaService, ownerId: string, runId: string) {
  const run = await prisma.eagleImportRun.findFirst({
    where: { id: runId, ownerId, libraryMode: 'MATERIAL' },
    select: RUN_SELECT,
  });
  if (!run) throw new NotFoundException('Eagle 导入任务不存在。');
  return run;
}

export async function applyImportMetadata(
  ingestion: SekerEagleIngestionPort<Prisma.TransactionClient>,
  transaction: Prisma.TransactionClient,
  ownerId: string,
  item: ImportMetadataSource,
  assetId: string,
) {
  const normalizedNames = [...new Set(item.tagNames.map(normalizeIdentity))];
  const tagDefinitions = normalizedNames.length
    ? await transaction.eagleImportTagDefinition.findMany({
        where: {
          ownerId,
          runId: item.runId,
          normalizedName: { in: normalizedNames },
          libraryMode: 'MATERIAL',
        },
      })
    : [];
  const groupSourceIds = [
    ...new Set(tagDefinitions.flatMap((definition) => definition.groupSourceIds)),
  ];
  const groupDefinitions = groupSourceIds.length
    ? await transaction.eagleImportTagGroupDefinition.findMany({
        where: {
          ownerId,
          runId: item.runId,
          sourceGroupId: { in: groupSourceIds },
          libraryMode: 'MATERIAL',
        },
      })
    : [];
  const definitionByName = new Map(
    tagDefinitions.map((definition) => [definition.normalizedName, definition]),
  );
  const groupBySourceId = new Map(groupDefinitions.map((group) => [group.sourceGroupId, group]));
  const tags = item.tagNames.map((name) => {
    const normalizedName = normalizeIdentity(name);
    const definition = definitionByName.get(normalizedName);
    return {
      name,
      normalizedName,
      color: definition?.color ?? null,
      isStarred: definition?.isStarred ?? false,
      groups: (definition?.groupSourceIds ?? [])
        .map((sourceGroupId) => groupBySourceId.get(sourceGroupId))
        .filter((group) => group !== undefined)
        .map((group) => ({
          name: group.name,
          normalizedName: group.normalizedName,
          color: group.color,
          description: group.description,
        })),
    };
  });

  await ingestion.applyMetadata(
    {
      sourceKey: `eagle-app:${item.externalAssetId}`,
      ownerId,
      assetId,
      displayName: item.displayName,
      rating: item.rating,
      libraryAddedAt: item.sourceImportedAt,
      description: item.description,
      sourceUrl: item.sourceUrl,
      tags,
    },
    transaction,
  );
}

export async function applyImportMetadataBatch(
  ingestion: SekerEagleIngestionPort<Prisma.TransactionClient>,
  transaction: Prisma.TransactionClient,
  ownerId: string,
  items: ImportMetadataSource[],
) {
  const mapped = items.filter((item): item is ImportMetadataSource & { assetId: string } =>
    Boolean(item.assetId),
  );
  if (!mapped.length) return;
  const normalizedNames = [
    ...new Set(mapped.flatMap((item) => item.tagNames.map(normalizeIdentity))),
  ];
  const definitions = normalizedNames.length
    ? await transaction.eagleImportTagDefinition.findMany({
        where: {
          ownerId,
          runId: mapped[0]!.runId,
          normalizedName: { in: normalizedNames },
          libraryMode: 'MATERIAL',
        },
      })
    : [];
  const groupSourceIds = [
    ...new Set(definitions.flatMap((definition) => definition.groupSourceIds)),
  ];
  const groupDefinitions = groupSourceIds.length
    ? await transaction.eagleImportTagGroupDefinition.findMany({
        where: {
          ownerId,
          runId: mapped[0]!.runId,
          sourceGroupId: { in: groupSourceIds },
          libraryMode: 'MATERIAL',
        },
      })
    : [];
  const definitionByName = new Map(
    definitions.map((definition) => [definition.normalizedName, definition]),
  );
  const groupBySourceId = new Map(groupDefinitions.map((group) => [group.sourceGroupId, group]));
  await ingestion.applyMetadataBatch(
    mapped.map((item) => ({
      sourceKey: `eagle-app:${item.externalAssetId}`,
      ownerId,
      assetId: item.assetId,
      displayName: item.displayName,
      rating: item.rating,
      libraryAddedAt: item.sourceImportedAt,
      description: item.description,
      sourceUrl: item.sourceUrl,
      tags: item.tagNames.map((name) => {
        const normalizedName = normalizeIdentity(name);
        const definition = definitionByName.get(normalizedName);
        return {
          name,
          normalizedName,
          color: definition?.color ?? null,
          isStarred: definition?.isStarred ?? false,
          groups: (definition?.groupSourceIds ?? [])
            .map((sourceGroupId) => groupBySourceId.get(sourceGroupId))
            .filter((group) => group !== undefined)
            .map((group) => ({
              name: group.name,
              normalizedName: group.normalizedName,
              color: group.color,
              description: group.description,
            })),
        };
      }),
    })),
    transaction,
  );
}

export async function markImportMetadataItemsImported(
  transaction: Prisma.TransactionClient,
  items: Array<ImportMetadataSource & { assetId: string; externalAssetId: string }>,
) {
  const completedAt = new Date();
  const externalRows = items.map(
    (item) =>
      Prisma.sql`(${item.externalAssetId}::text, ${item.sourceImportedAt}::timestamp(3), ${item.sourceModifiedAt}::timestamp(3), ${item.metadataHash}::text, ${item.contentSha256}::text, ${item.sourceFileModifiedAt}::timestamp(3), ${item.byteSize}::bigint, ${completedAt}::timestamp(3))`,
  );
  const externalUpdated = await transaction.$executeRaw(Prisma.sql`
    UPDATE "EagleExternalAsset" e
    SET "sourceImportedAt" = v."sourceImportedAt",
        "sourceModifiedAt" = v."sourceModifiedAt",
        "metadataHash" = v."metadataHash",
        "sourceContentSha256" = COALESCE(v."sourceContentSha256", e."sourceContentSha256"),
        "sourceFileModifiedAt" = COALESCE(v."sourceFileModifiedAt", e."sourceFileModifiedAt"),
        "sourceByteSize" = v."sourceByteSize",
        "lastSeenAt" = v."completedAt",
        "lastImportedAt" = v."completedAt",
        "updatedAt" = CURRENT_TIMESTAMP
    FROM (VALUES ${Prisma.join(externalRows)}) AS v("id", "sourceImportedAt", "sourceModifiedAt", "metadataHash", "sourceContentSha256", "sourceFileModifiedAt", "sourceByteSize", "completedAt")
    WHERE e."id" = v."id" AND e."libraryMode" = 'MATERIAL'::"LibraryMode"
  `);
  if (externalUpdated !== items.length) throw new Error('Eagle 导入来源批量更新不完整。');
  const itemRows = items.map(
    (item) => Prisma.sql`(${item.id}::text, ${completedAt}::timestamp(3))`,
  );
  const itemUpdated = await transaction.$executeRaw(Prisma.sql`
    UPDATE "EagleImportRunItem" i
    SET "status" = 'IMPORTED'::"EagleImportItemStatus",
        "errorCode" = NULL,
        "errorMessage" = NULL,
        "terminalProgressAppliedAt" = v."completedAt",
        "completedAt" = v."completedAt",
        "updatedAt" = CURRENT_TIMESTAMP
    FROM (VALUES ${Prisma.join(itemRows)}) AS v("id", "completedAt")
    WHERE i."id" = v."id" AND i."libraryMode" = 'MATERIAL'::"LibraryMode"
      AND i."status" = 'STAGED'::"EagleImportItemStatus"
  `);
  if (itemUpdated !== items.length) throw new Error('Eagle 导入条目批量更新不完整。');
}

export async function applyTerminalItemDelta(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  runId: string,
  itemIds: string[],
  delta: Partial<Record<'importedItemCount' | 'skippedItemCount' | 'failedItemCount', number>>,
  completedAt: Date,
  lastErrorCode?: string,
) {
  if (eagleImportProgressMode() === 'PROJECTED') return;
  const run = await transaction.eagleImportRun.update({
    where: { id: runId, libraryMode: 'MATERIAL' },
    data: {
      ...counterDeltaIncrements(delta),
      ...(lastErrorCode ? { lastErrorCode } : {}),
    },
    select: {
      status: true,
      importedItemCount: true,
      skippedItemCount: true,
      failedItemCount: true,
    },
  });
  const marked = await transaction.eagleImportRunItem.updateMany({
    where: { id: { in: itemIds }, terminalProgressAppliedAt: null, libraryMode: 'MATERIAL' },
    data: { terminalProgressAppliedAt: completedAt },
  });
  if (marked.count !== itemIds.length) {
    throw new Error('Eagle 导入进度同步标记不完整。');
  }
  if (run.status === EagleImportRunStatus.CANCELLED) return;
  const activeItem = await transaction.eagleImportRunItem.findFirst({
    where: {
      ownerId,
      runId,
      status: { in: [...ACTIVE_EAGLE_IMPORT_ITEM_STATUSES] },
      libraryMode: 'MATERIAL',
    },
    select: { id: true },
  });
  await transaction.eagleImportRun.update({
    where: { id: runId, libraryMode: 'MATERIAL' },
    data: {
      status: resolveEagleImportRunCompletion({
        activeItemCount: activeItem ? 1 : 0,
        importedItemCount: run.importedItemCount,
        skippedItemCount: run.skippedItemCount,
        failedItemCount: run.failedItemCount,
      }),
      completedAt: activeItem ? null : completedAt,
    },
  });
}

export async function applyProjectedTerminalItems(
  transaction: Prisma.TransactionClient,
  group: {
    ownerId: string;
    runId: string;
    itemIds: string[];
    importedItemCount: number;
    skippedItemCount: number;
    failedItemCount: number;
  },
  projectedAt: Date,
): Promise<void> {
  const run = await transaction.eagleImportRun.update({
    where: { id: group.runId, libraryMode: 'MATERIAL' },
    data: {
      ...counterDeltaIncrements({
        importedItemCount: group.importedItemCount,
        skippedItemCount: group.skippedItemCount,
        failedItemCount: group.failedItemCount,
      }),
      ...(group.failedItemCount > 0 ? { lastErrorCode: 'ITEM_FAILED' } : {}),
    },
    select: {
      status: true,
      importedItemCount: true,
      skippedItemCount: true,
      failedItemCount: true,
    },
  });
  const marked = await transaction.eagleImportRunItem.updateMany({
    where: {
      id: { in: group.itemIds },
      terminalProgressAppliedAt: null,
      libraryMode: 'MATERIAL',
    },
    data: { terminalProgressAppliedAt: projectedAt },
  });
  if (marked.count !== group.itemIds.length) {
    throw new Error('Eagle 导入进度投影标记不完整。');
  }
  if (run.status === EagleImportRunStatus.CANCELLED) return;
  const activeItem = await transaction.eagleImportRunItem.findFirst({
    where: {
      ownerId: group.ownerId,
      runId: group.runId,
      status: { in: [...ACTIVE_EAGLE_IMPORT_ITEM_STATUSES] },
      libraryMode: 'MATERIAL',
    },
    select: { id: true },
  });
  await transaction.eagleImportRun.update({
    where: { id: group.runId, libraryMode: 'MATERIAL' },
    data: {
      status: resolveEagleImportRunCompletion({
        activeItemCount: activeItem ? 1 : 0,
        importedItemCount: run.importedItemCount,
        skippedItemCount: run.skippedItemCount,
        failedItemCount: run.failedItemCount,
      }),
      completedAt: activeItem ? null : projectedAt,
    },
  });
}

export async function lockImportRun(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  runId: string,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "EagleImportRun" WHERE "ownerId" = ${ownerId} AND "libraryMode" = 'MATERIAL'::"LibraryMode" AND "id" = ${runId} FOR UPDATE`,
  );
}

export async function lockImportItem(
  transaction: Prisma.TransactionClient,
  ownerId: string,
  runId: string,
  itemId: string,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "EagleImportRunItem" WHERE "ownerId" = ${ownerId} AND "libraryMode" = 'MATERIAL'::"LibraryMode" AND "runId" = ${runId} AND "id" = ${itemId} FOR UPDATE`,
  );
}

export async function recordSourceObservations(
  transaction: Prisma.TransactionClient,
  observations: Array<{
    externalAssetId: string;
    action: EagleImportItemAction;
    contentSha256: string | null;
    sourceFileModifiedAt: Date | null;
    sourceByteSize: bigint;
    metadataHash: string;
    observedAt: Date;
  }>,
) {
  if (!observations.length) return;
  const payload = observations.map((item) => ({
    ...item,
    sourceFileModifiedAt: item.sourceFileModifiedAt?.toISOString() ?? null,
    sourceByteSize: item.sourceByteSize.toString(),
    observedAt: item.observedAt.toISOString(),
  }));
  await transaction.$executeRaw(Prisma.sql`
    UPDATE "EagleExternalAsset" external
    SET
      "lastSeenAt" = observation."observedAt"::timestamp,
      "sourceContentSha256" = CASE
        WHEN observation."action" = 'UNCHANGED' AND observation."contentSha256" IS NOT NULL
        THEN observation."contentSha256"
        ELSE external."sourceContentSha256"
      END,
      "sourceFileModifiedAt" = CASE
        WHEN observation."action" = 'UNCHANGED' AND observation."sourceFileModifiedAt" IS NOT NULL
        THEN observation."sourceFileModifiedAt"::timestamp
        ELSE external."sourceFileModifiedAt"
      END,
      "sourceByteSize" = CASE
        WHEN observation."action" = 'UNCHANGED'
        THEN observation."sourceByteSize"::bigint
        ELSE external."sourceByteSize"
      END,
      "metadataHash" = CASE
        WHEN observation."action" = 'UNCHANGED'
        THEN observation."metadataHash"
        ELSE external."metadataHash"
      END,
      "lastImportedAt" = CASE
        WHEN observation."action" = 'UNCHANGED'
        THEN observation."observedAt"::timestamp
        ELSE external."lastImportedAt"
      END,
      "updatedAt" = NOW()
    FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS observation(
      "externalAssetId" text,
      "action" text,
      "contentSha256" text,
      "sourceFileModifiedAt" text,
      "sourceByteSize" text,
      "metadataHash" text,
      "observedAt" text
    )
    WHERE external."id" = observation."externalAssetId"
  `);
}

export function countGroupedItemStatuses(
  groups: Array<{ status: EagleImportItemStatus; _count: { _all: number } }>,
) {
  const counts = new Map(groups.map((group) => [group.status, group._count._all]));
  return {
    stagedItemCount: counts.get(EagleImportItemStatus.STAGED) ?? 0,
    importedItemCount: counts.get(EagleImportItemStatus.IMPORTED) ?? 0,
    skippedItemCount: counts.get(EagleImportItemStatus.SKIPPED) ?? 0,
    failedItemCount: counts.get(EagleImportItemStatus.FAILED) ?? 0,
  };
}

export function countItemStatuses(items: ReadonlyArray<{ status: EagleImportItemStatus }>) {
  const groups = new Map<EagleImportItemStatus, number>();
  for (const item of items) groups.set(item.status, (groups.get(item.status) ?? 0) + 1);
  return {
    stagedItemCount: groups.get(EagleImportItemStatus.STAGED) ?? 0,
    importedItemCount: groups.get(EagleImportItemStatus.IMPORTED) ?? 0,
    skippedItemCount: groups.get(EagleImportItemStatus.SKIPPED) ?? 0,
    failedItemCount: groups.get(EagleImportItemStatus.FAILED) ?? 0,
  };
}

export function counterIncrements(counts: ReturnType<typeof countItemStatuses>) {
  return Object.fromEntries(
    Object.entries(counts)
      .filter(([, count]) => count > 0)
      .map(([field, count]) => [field, { increment: count }]),
  );
}

export function counterDeltaIncrements(
  delta: Partial<Record<'importedItemCount' | 'skippedItemCount' | 'failedItemCount', number>>,
) {
  return Object.fromEntries(
    Object.entries(delta)
      .filter(([, count]) => count !== undefined && count !== 0)
      .map(([field, count]) => [field, { increment: count }]),
  );
}

export function assertMatchingRunDeclaration(
  run: Pick<
    ImportRunProjection,
    | 'externalLibraryId'
    | 'manifestVersion'
    | 'declaredItemCount'
    | 'declaredByteSize'
    | 'declarationHash'
  >,
  externalLibraryId: string,
  input: CreateEagleImportRunInput,
  declarationHash: string,
) {
  if (
    run.externalLibraryId !== externalLibraryId ||
    (run.declarationHash !== null && run.declarationHash !== declarationHash) ||
    run.manifestVersion !== input.manifestVersion ||
    run.declaredItemCount !== input.declaredItemCount ||
    run.declaredByteSize !== BigInt(input.declaredByteSize)
  ) {
    throw new ConflictException('该幂等键已用于另一份 Eagle 导入声明。');
  }
}

export function isPrismaUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

export function isContentHashMismatch(error: unknown): boolean {
  if (!(error instanceof BadRequestException)) return false;
  const response = error.getResponse();
  return (
    typeof response === 'object' &&
    response !== null &&
    'code' in response &&
    response.code === 'CONTENT_HASH_MISMATCH'
  );
}

export function requireStableDefinitions<T extends Record<string, unknown>>(
  definitions: T[],
  keyOf: (definition: T) => string,
  label: string,
): T[] {
  const unique = new Map<string, T>();
  for (const definition of definitions) {
    const key = keyOf(definition);
    const prior = unique.get(key);
    if (prior && stableJson(definitionValue(prior)) !== stableJson(definitionValue(definition))) {
      throw new ConflictException(`同一 Eagle ${label}标识不能声明不同内容：${key}`);
    }
    unique.set(key, prior ?? definition);
  }
  return [...unique.values()];
}

export function assertDefinitionsUnchanged<TIncoming extends Record<string, unknown>, TExisting>(
  incoming: TIncoming[],
  existing: TExisting[],
  keyOf: (definition: TIncoming & TExisting) => string,
  label: string,
) {
  const incomingByKey = new Map(
    incoming.map((item) => [keyOf(item as TIncoming & TExisting), item]),
  );
  for (const definition of existing) {
    const key = keyOf(definition as TIncoming & TExisting);
    const candidate = incomingByKey.get(key);
    if (
      candidate &&
      stableJson(definitionValue(candidate)) !==
        stableJson(definitionValue(definition as Record<string, unknown>))
    ) {
      throw new ConflictException(`Eagle ${label}定义在不同分块中不一致：${key}`);
    }
  }
}

export function definitionValue(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['id', 'ownerId', 'runId', 'createdAt', 'updatedAt'].includes(key))
      .map(([key, nested]) => [
        key,
        Array.isArray(nested) ? [...(nested as unknown[])].sort() : nested,
      ]),
  );
}

export function hashValue(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function hashRunDeclaration(input: CreateEagleImportRunInput): string {
  return hashValue({
    manifestVersion: input.manifestVersion,
    externalLibraryId: input.externalLibraryId.normalize('NFKC').trim(),
    libraryName: input.libraryName.normalize('NFKC').trim(),
    sourceModifiedAt: input.sourceModifiedAt?.toISOString() ?? null,
    declaredItemCount: input.declaredItemCount,
    declaredByteSize: input.declaredByteSize,
  });
}

export function buildMetadataHash(
  item: EagleImportManifestChunkInput['items'][number],
  metadata: ReturnType<typeof mapEagleImportItemMetadata>,
  tagNames: string[],
): string {
  return hashValue({
    displayName: metadata.displayName,
    rating: metadata.rating,
    description: metadata.description,
    sourceUrl: metadata.sourceUrl,
    libraryAddedAt: metadata.libraryAddedAt,
    sourceModifiedAt: metadata.sourceModifiedAt,
    tagNames,
    folderIds: [...new Set(item.folderIds)].sort(),
  });
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (!nestedValue || typeof nestedValue !== 'object' || Array.isArray(nestedValue)) {
      return nestedValue;
    }
    return Object.fromEntries(
      Object.entries(nestedValue as Record<string, unknown>).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    );
  });
}

export function normalizeIdentity(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

export function cleanName(value: string): string {
  const name = value.normalize('NFKC').trim();
  if (!name) throw new BadRequestException('Eagle 清单名称不能为空。');
  return name;
}

export function cleanOptional(value: string | null | undefined): string | null {
  const normalized = value?.normalize('NFKC').trim() ?? '';
  return normalized || null;
}

export function encodeItemCursor(id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, id })).toString('base64url');
}

export function encodeRunCursor(updatedAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ v: 1, updatedAt: updatedAt.toISOString(), id })).toString(
    'base64url',
  );
}

export function decodeRunCursor(value: string): { updatedAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const updatedAt = new Date(String(parsed.updatedAt));
    if (
      parsed.v !== 1 ||
      typeof parsed.id !== 'string' ||
      !parsed.id.trim() ||
      Number.isNaN(updatedAt.getTime())
    ) {
      throw new Error();
    }
    return { updatedAt, id: parsed.id };
  } catch {
    throw new BadRequestException('Eagle 导入任务游标无效。');
  }
}

export function decodeItemCursor(value: string): string {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    if (parsed.v !== 1 || typeof parsed.id !== 'string' || !parsed.id.trim()) throw new Error();
    return parsed.id;
  } catch {
    throw new BadRequestException('Eagle 导入项游标无效。');
  }
}
