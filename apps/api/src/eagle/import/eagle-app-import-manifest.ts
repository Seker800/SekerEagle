import path from 'node:path';
import { isSupportedEagleMedia } from '../../eagle/eagle-media-capability';

export const EAGLE_IMPORT_MANIFEST_VERSION = 2 as const;
export const EAGLE_IMPORT_MANIFEST_VERSIONS = [1, 2] as const;
export const EAGLE_IMPORT_MAX_CHUNK_ITEMS = 500;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export interface EagleImportFolderInput {
  sourceId: string;
  name: string;
  parentSourceId: string | null;
}

export interface EagleImportTagInput {
  name: string;
  color?: string | null;
  isStarred?: boolean;
  groupSourceIds?: string[];
}

export interface EagleImportTagGroupInput {
  sourceId: string;
  name: string;
  color?: string | null;
  description?: string | null;
}

export interface EagleImportItemInput {
  sourceItemId: string;
  name: string;
  originalFileName: string;
  extension: string;
  mimeType: string;
  size: number;
  importedAt: number;
  modifiedAt: number | null;
  star: number;
  annotation: string;
  sourceUrl: string;
  tagNames: string[];
  folderIds: string[];
  isDeleted: boolean;
  contentSha256?: string;
  sourceFileModifiedAt?: number;
}

export interface EagleImportManifestChunkInput {
  manifestVersion: number;
  chunkKey: string;
  folders: EagleImportFolderInput[];
  tags: EagleImportTagInput[];
  tagGroups: EagleImportTagGroupInput[];
  items: EagleImportItemInput[];
}

export type EagleImportMetadataWarning =
  'INVALID_SOURCE_URL' | 'INVALID_IMPORTED_AT' | 'INVALID_MODIFIED_AT' | 'INVALID_RATING';

export class EagleImportManifestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = EagleImportManifestValidationError.name;
  }
}

export function canonicalizeEagleSourceId(value: string, label: string): string {
  const sourceId = value.normalize('NFKC').trim();
  if (!sourceId) throw new EagleImportManifestValidationError(`${label}不能为空。`);
  return sourceId;
}

export function canonicalizeEagleImportManifestChunk(
  input: EagleImportManifestChunkInput,
): EagleImportManifestChunkInput {
  const canonical = {
    ...input,
    chunkKey: canonicalizeEagleSourceId(input.chunkKey, 'Eagle 导入分块键'),
    folders: input.folders.map((folder) => ({
      ...folder,
      sourceId: canonicalizeEagleSourceId(folder.sourceId, 'Eagle 文件夹来源 ID'),
      parentSourceId: folder.parentSourceId
        ? canonicalizeEagleSourceId(folder.parentSourceId, 'Eagle 父文件夹来源 ID')
        : null,
    })),
    tags: input.tags.map((tag) => ({
      ...tag,
      groupSourceIds: (tag.groupSourceIds ?? []).map((sourceId) =>
        canonicalizeEagleSourceId(sourceId, 'Eagle 标签组来源 ID'),
      ),
    })),
    tagGroups: input.tagGroups.map((group) => ({
      ...group,
      sourceId: canonicalizeEagleSourceId(group.sourceId, 'Eagle 标签组来源 ID'),
    })),
    items: input.items.map((item) => ({
      ...item,
      sourceItemId: canonicalizeEagleSourceId(item.sourceItemId, 'Eagle 素材来源 ID'),
      folderIds: item.folderIds.map((sourceId) =>
        canonicalizeEagleSourceId(sourceId, 'Eagle 文件夹来源 ID'),
      ),
    })),
  };
  validateEagleImportManifestChunk(canonical);
  return canonical;
}

function normalizedTagIdentity(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

function cleanOptionalText(value: string | null | undefined): string | null {
  const cleaned = value?.normalize('NFKC').trim() ?? '';
  return cleaned.length > 0 ? cleaned : null;
}

export function buildEagleImportCandidateTags(input: {
  tagNames: string[];
  folderIds: string[];
  folders: EagleImportFolderInput[];
}): {
  names: string[];
  folderAssignmentCount: number;
  collapsedFolderNameCount: number;
  mergedWithOriginalTagCount: number;
} {
  const names: string[] = [];
  const identities = new Set<string>();

  for (const rawName of input.tagNames) {
    const name = cleanOptionalText(rawName);
    if (!name) continue;
    const identity = normalizedTagIdentity(name);
    if (identities.has(identity)) continue;
    identities.add(identity);
    names.push(name);
  }

  const originalTagIdentities = new Set(identities);
  const seenFolderIdentities = new Set<string>();
  const mergedOriginalTagIdentities = new Set<string>();
  const folderById = new Map(input.folders.map((folder) => [folder.sourceId, folder]));
  let folderAssignmentCount = 0;
  let collapsedFolderNameCount = 0;
  let mergedWithOriginalTagCount = 0;

  for (const folderId of input.folderIds) {
    const folderName = cleanOptionalText(folderById.get(folderId)?.name);
    if (!folderName) continue;
    folderAssignmentCount += 1;
    const identity = normalizedTagIdentity(folderName);
    if (seenFolderIdentities.has(identity)) collapsedFolderNameCount += 1;
    else seenFolderIdentities.add(identity);
    if (originalTagIdentities.has(identity) && !mergedOriginalTagIdentities.has(identity)) {
      mergedWithOriginalTagCount += 1;
      mergedOriginalTagIdentities.add(identity);
    }
    if (identities.has(identity)) {
      continue;
    }
    identities.add(identity);
    names.push(folderName);
  }

  return {
    names,
    folderAssignmentCount,
    collapsedFolderNameCount,
    mergedWithOriginalTagCount,
  };
}

function parseSourceTimestamp(
  value: number | null,
  warning: EagleImportMetadataWarning,
  warnings: EagleImportMetadataWarning[],
): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  if (!Number.isFinite(value) || value <= 0 || Number.isNaN(date.getTime())) {
    warnings.push(warning);
    return null;
  }
  return date;
}

function parseSourceUrl(value: string, warnings: EagleImportMetadataWarning[]): string | null {
  const sourceUrl = cleanOptionalText(value);
  if (!sourceUrl) return null;
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString();
  } catch {
    // The warning below is intentionally shared by malformed and unsafe URLs.
  }
  warnings.push('INVALID_SOURCE_URL');
  return null;
}

export function mapEagleImportItemMetadata(
  input: Pick<
    EagleImportItemInput,
    'name' | 'originalFileName' | 'star' | 'annotation' | 'sourceUrl' | 'importedAt' | 'modifiedAt'
  >,
  fallbackLibraryAddedAt: Date,
): {
  displayName: string;
  rating: number | null;
  description: string | null;
  sourceUrl: string | null;
  libraryAddedAt: Date;
  sourceModifiedAt: Date | null;
  warnings: EagleImportMetadataWarning[];
} {
  const warnings: EagleImportMetadataWarning[] = [];
  const originalBaseName = path.basename(
    input.originalFileName,
    path.extname(input.originalFileName),
  );
  const displayName =
    cleanOptionalText(input.name) ?? cleanOptionalText(originalBaseName) ?? '未命名素材';
  const rating =
    input.star === 0
      ? null
      : Number.isInteger(input.star) && input.star >= 1 && input.star <= 5
        ? input.star
        : null;
  if (input.star !== 0 && rating === null) warnings.push('INVALID_RATING');

  const sourceUrl = parseSourceUrl(input.sourceUrl, warnings);
  const importedAt = parseSourceTimestamp(input.importedAt, 'INVALID_IMPORTED_AT', warnings);
  const sourceModifiedAt = parseSourceTimestamp(input.modifiedAt, 'INVALID_MODIFIED_AT', warnings);

  return {
    displayName,
    rating,
    description: cleanOptionalText(input.annotation),
    sourceUrl,
    libraryAddedAt: importedAt ?? fallbackLibraryAddedAt,
    sourceModifiedAt,
    warnings,
  };
}

export function isSupportedEagleImportMedia(
  item: Pick<EagleImportItemInput, 'extension' | 'mimeType'>,
): boolean {
  return isSupportedEagleMedia({
    fileName: `asset.${item.extension.replace(/^\./, '')}`,
    mimeType: item.mimeType,
  });
}

export function validateEagleImportManifestChunk(input: EagleImportManifestChunkInput): {
  acceptedItemIds: string[];
  skippedDeletedItemIds: string[];
  skippedUnsupportedItemIds: string[];
} {
  if (!EAGLE_IMPORT_MANIFEST_VERSIONS.includes(input.manifestVersion as 1 | 2)) {
    throw new EagleImportManifestValidationError(
      `不支持的 Eagle 导入清单版本：${input.manifestVersion}`,
    );
  }
  if (!input.chunkKey.normalize('NFKC').trim())
    throw new EagleImportManifestValidationError('Eagle 导入分块键不能为空。');
  if (input.items.length > EAGLE_IMPORT_MAX_CHUNK_ITEMS) {
    throw new EagleImportManifestValidationError(
      `Eagle 导入分块不能超过 ${EAGLE_IMPORT_MAX_CHUNK_ITEMS} 项。`,
    );
  }

  const acceptedItemIds: string[] = [];
  const skippedDeletedItemIds: string[] = [];
  const skippedUnsupportedItemIds: string[] = [];
  const seenSourceItemIds = new Set<string>();

  for (const item of input.items) {
    const sourceItemId = item.sourceItemId.normalize('NFKC').trim();
    if (!sourceItemId) throw new EagleImportManifestValidationError('Eagle 素材来源 ID 不能为空。');
    if (seenSourceItemIds.has(sourceItemId))
      throw new EagleImportManifestValidationError(
        `Eagle 导入分块存在重复素材来源 ID：${sourceItemId}`,
      );
    seenSourceItemIds.add(sourceItemId);

    if (input.manifestVersion === 2 && !item.isDeleted) {
      if (!item.contentSha256 || !SHA256_PATTERN.test(item.contentSha256)) {
        throw new EagleImportManifestValidationError(
          `Eagle 素材 ${sourceItemId} 的 contentSha256 必须是 64 位小写十六进制 SHA-256。`,
        );
      }
      if (
        !Number.isInteger(item.sourceFileModifiedAt) ||
        (item.sourceFileModifiedAt ?? 0) <= 0 ||
        Number.isNaN(new Date(item.sourceFileModifiedAt!).getTime())
      ) {
        throw new EagleImportManifestValidationError(
          `Eagle 素材 ${sourceItemId} 的 sourceFileModifiedAt 无效。`,
        );
      }
    } else if (
      input.manifestVersion === 1 &&
      (item.contentSha256 !== undefined || item.sourceFileModifiedAt !== undefined)
    ) {
      throw new EagleImportManifestValidationError('Manifest v1 不接受 v2 内容版本字段。');
    }

    if (item.isDeleted) skippedDeletedItemIds.push(sourceItemId);
    else if (!isSupportedEagleImportMedia(item)) skippedUnsupportedItemIds.push(sourceItemId);
    else acceptedItemIds.push(sourceItemId);
  }

  return { acceptedItemIds, skippedDeletedItemIds, skippedUnsupportedItemIds };
}
