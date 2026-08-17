'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { clampText, chunksOf } = require('./utils');

const MIME_BY_EXTENSION = Object.freeze({
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', heif: 'image/heif', mp4: 'video/mp4',
});

const MAX_UNREADABLE_ITEM_DETAILS = 20;
const MAX_NORMALIZATION_WARNING_DETAILS = 20;

function timestamp(value, fallback = 0) {
  const number = value instanceof Date ? value.getTime() : Number(value);
  if (Number.isFinite(number) && number >= 0) return Math.trunc(number);
  const fallbackNumber = fallback instanceof Date ? fallback.getTime() : Number(fallback);
  return Number.isFinite(fallbackNumber) && fallbackNumber >= 0 ? Math.trunc(fallbackNumber) : 0;
}

function flattenFolders(folders, parentSourceId = null, output = [], ancestors = new Set()) {
  for (const folder of folders || []) {
    const sourceId = clampText(folder.id, 255);
    if (!sourceId || ancestors.has(sourceId)) continue;
    output.push({
      sourceId,
      name: clampText(folder.name, 255) || '未命名文件夹',
      parentSourceId,
    });
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(sourceId);
    flattenFolders(folder.children || [], sourceId, output, nextAncestors);
  }
  return output;
}

function dedupeDefinitions(values, identityOf) {
  const byIdentity = new Map();
  let duplicateCount = 0;
  for (const value of values) {
    const identity = identityOf(value);
    if (!identity) continue;
    const prior = byIdentity.get(identity);
    if (!prior) {
      byIdentity.set(identity, value);
      continue;
    }
    duplicateCount += 1;
    if (JSON.stringify(value) < JSON.stringify(prior)) byIdentity.set(identity, value);
  }
  return {
    values: [...byIdentity.values()].sort((left, right) => identityOf(left).localeCompare(identityOf(right))),
    duplicateCount,
  };
}

function canonicalTagIdentity(value) {
  return clampText(value, 64).normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

function compareTagCandidates(left, right) {
  const identity = canonicalTagIdentity(left.name);
  const leftExact = left.name === identity ? 0 : 1;
  const rightExact = right.name === identity ? 0 : 1;
  if (leftExact !== rightExact) return leftExact - rightExact;
  if (left.name.length !== right.name.length) return left.name.length - right.name.length;
  const nameOrder = left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  if (nameOrder !== 0) return nameOrder;
  return JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function normalizeTagsWithDiagnostics(rawTags, groups) {
  const values = Array.isArray(rawTags) ? rawTags : Object.values(rawTags || {});
  const groupIdsByTagIdentity = new Map();
  for (const group of groups) {
    for (const tag of group.tags || []) {
      const name = clampText(typeof tag === 'string' ? tag : tag.name, 64);
      const identity = canonicalTagIdentity(name);
      if (!identity) continue;
      const ids = groupIdsByTagIdentity.get(identity) || [];
      const groupId = clampText(group.id, 255);
      if (groupId) ids.push(groupId);
      groupIdsByTagIdentity.set(identity, ids);
    }
  }

  const candidatesByIdentity = new Map();
  for (const tag of values) {
    const name = clampText(typeof tag === 'string' ? tag : tag.name, 64).normalize('NFKC').trim();
    const identity = canonicalTagIdentity(name);
    if (!identity) continue;
    const ownGroups = Array.isArray(tag?.groups)
      ? tag.groups.map((groupId) => clampText(groupId, 255)).filter(Boolean)
      : [];
    const candidate = {
      name,
      color: clampText(tag?.color, 32) || null,
      isStarred: Boolean(tag?.isStarred || tag?.starred),
      groupSourceIds: [...new Set([...ownGroups, ...(groupIdsByTagIdentity.get(identity) || [])])]
        .sort()
        .slice(0, 100),
    };
    const candidates = candidatesByIdentity.get(identity) || [];
    candidates.push(candidate);
    candidatesByIdentity.set(identity, candidates);
  }

  const tags = [];
  const displayNameByIdentity = new Map();
  const mergedTagDetails = [];
  let mergedTagCount = 0;
  for (const identity of [...candidatesByIdentity.keys()].sort()) {
    const candidates = candidatesByIdentity.get(identity).sort(compareTagCandidates);
    const preferred = candidates[0];
    const merged = {
      name: preferred.name,
      color: preferred.color,
      isStarred: candidates.some((candidate) => candidate.isStarred),
      groupSourceIds: [...new Set(candidates.flatMap((candidate) => candidate.groupSourceIds))]
        .sort()
        .slice(0, 100),
    };
    tags.push(merged);
    displayNameByIdentity.set(identity, merged.name);
    if (candidates.length > 1) {
      mergedTagCount += candidates.length - 1;
      if (mergedTagDetails.length < MAX_NORMALIZATION_WARNING_DETAILS) {
        mergedTagDetails.push({
          identity,
          names: [...new Set(candidates.map((candidate) => candidate.name))].sort(),
          selectedName: merged.name,
        });
      }
    }
  }
  return { tags, displayNameByIdentity, mergedTagCount, mergedTagDetails };
}

function normalizeTags(rawTags, groups) {
  return normalizeTagsWithDiagnostics(rawTags, groups).tags;
}

function normalizeItemTagNames(rawNames, displayNameByIdentity) {
  const namesByIdentity = new Map();
  for (const rawName of rawNames || []) {
    const cleaned = clampText(rawName, 64).normalize('NFKC').trim();
    const identity = canonicalTagIdentity(cleaned);
    if (!identity) continue;
    const displayName = displayNameByIdentity.get(identity) || cleaned;
    const prior = namesByIdentity.get(identity);
    if (!prior || displayName < prior) namesByIdentity.set(identity, displayName);
  }
  return [...namesByIdentity.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, name]) => name)
    .slice(0, 500);
}

function normalizeTagGroups(groups) {
  return dedupeDefinitions((groups || []).map((group) => ({
    sourceId: clampText(group.id, 255),
    name: clampText(group.name, 64) || '未命名标签组',
    color: clampText(group.color, 32) || null,
    description: clampText(group.description, 500) || null,
  })).filter((group) => group.sourceId), (group) => group.sourceId).values;
}

function buildManifestMetadata(
  item,
  { sourceItemId, originalFileName, extension, mimeType, displayNameByTagIdentity },
) {
  return {
    sourceItemId,
    name: clampText(item.name, 255),
    originalFileName,
    extension,
    mimeType,
    size: Math.max(0, Number(item.size) || 0),
    importedAt: timestamp(item.importedAt),
    modifiedAt: timestamp(item.modifiedAt),
    star: Math.max(0, Math.min(5, Math.trunc(Number(item.star || 0)))),
    annotation: clampText(item.annotation, 10000),
    sourceUrl: clampText(item.url, 2048),
    tagNames: normalizeItemTagNames(item.tags, displayNameByTagIdentity),
    folderIds: [...new Set((item.folders || []).map((value) => clampText(value, 255)).filter(Boolean))]
      .sort()
      .slice(0, 100),
  };
}

function fileReadFailure(error) {
  const code = clampText(error?.code, 32, 'READ_FAILED');
  return { code, message: clampText(error?.message, 500, '无法读取原文件') };
}

async function sha256File(filePath, onBytes) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => { hash.update(chunk); if (onBytes) onBytes(chunk.length); });
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function mapConcurrentOrdered(values, concurrency, transform) {
  const results = new Array(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await transform(values[index], index);
    }
  }
  const workerCount = Math.min(values.length, Math.max(1, Math.trunc(concurrency)));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function scanEagleLibrary({
  eagleApi,
  hashCache = {},
  hashCacheStore,
  workspace,
  hashConcurrency = Number(process.env.SEKER_EAGLE_HASH_CONCURRENCY || 2),
  onProgress = () => {},
  cancelled = () => false,
}) {
  const library = eagleApi.library;
  if (!library?.path) throw new Error('Eagle 当前没有打开图库。');
  if (typeof eagleApi.item.getIdsWithModifiedAt !== 'function') {
    throw new Error('当前 Eagle 版本不支持增量扫描 API，请升级 Eagle 后重试。');
  }
  const idsWithModifiedAt = await eagleApi.item.getIdsWithModifiedAt();
  const rawIdentifiers = (idsWithModifiedAt || [])
    .map((entry) => clampText(typeof entry === 'string' ? entry : entry?.id, 255))
    .filter(Boolean);
  const identifiers = [...new Set(rawIdentifiers)];
  if (hashCacheStore?.shardNameFor) {
    identifiers.sort((left, right) => {
      const shardOrder = hashCacheStore.shardNameFor(left).localeCompare(hashCacheStore.shardNameFor(right));
      return shardOrder || left.localeCompare(right);
    });
  }
  const [folderTree, rawTags, rawTagGroups] = await Promise.all([
    eagleApi.folder.getAll(), eagleApi.tag.get(), eagleApi.tagGroup.get(),
  ]);
  const folderNormalization = dedupeDefinitions(flattenFolders(folderTree), (folder) => folder.sourceId);
  const folders = folderNormalization.values;
  const knownFolderIds = new Set(folders.map((folder) => folder.sourceId));
  const tagGroups = normalizeTagGroups(rawTagGroups);
  const tagNormalization = normalizeTagsWithDiagnostics(rawTags, rawTagGroups || []);
  const tags = tagNormalization.tags;
  const items = workspace ? null : [];
  const sourceFiles = workspace ? workspace.sourceFiles : new Map();
  const nextHashCache = { ...hashCache };
  const unreadableItems = [];
  const itemBatches = chunksOf(identifiers, 100);
  let byteSize = 0;
  let processed = 0;
  let unreadableItemCount = 0;
  const dataWarnings = [];
  let dataWarningCount = rawIdentifiers.length - identifiers.length + folderNormalization.duplicateCount;
  const seenSourceItemIds = new Set();
  const boundedHashConcurrency = Number.isSafeInteger(hashConcurrency)
    ? Math.min(4, Math.max(1, hashConcurrency))
    : 2;

  function warnData(message) {
    dataWarningCount += 1;
    if (dataWarnings.length < MAX_NORMALIZATION_WARNING_DETAILS) dataWarnings.push(message);
  }

  for (let batchIndex = 0; batchIndex < itemBatches.length; batchIndex += 1) {
    if (cancelled()) throw new Error('操作已取消。');
    const requestedIds = itemBatches[batchIndex];
    const sourceItems = await eagleApi.item.getByIds(requestedIds) || [];
    const returnedIds = new Set((sourceItems || []).map((item) => clampText(item?.id, 255)).filter(Boolean));
    for (const requestedId of requestedIds) {
      if (!returnedIds.has(requestedId)) warnData(`Eagle 未返回素材记录：${requestedId}`);
    }
    onProgress({ phase: 'read', current: Math.min((batchIndex + 1) * 100, identifiers.length), total: identifiers.length });
    const inspections = await mapConcurrentOrdered(
      sourceItems,
      boundedHashConcurrency,
      async (item) => {
        if (cancelled()) throw new Error('操作已取消。');
        const sourceItemId = clampText(item?.id, 255);
        if (!sourceItemId || item.isDeleted) return null;
        const filePath = item.filePath || '';
        let stat;
        try {
          stat = await fsp.stat(filePath);
          if (!stat.isFile() || stat.size < 1) {
            if (hashCacheStore) await hashCacheStore.delete(sourceItemId);
            else delete nextHashCache[sourceItemId];
            return { stat };
          }
          const cacheKey = `${filePath}\u0000${stat.size}\u0000${Math.trunc(stat.mtimeMs)}`;
          const cachedHash = hashCacheStore
            ? await hashCacheStore.get(sourceItemId)
            : nextHashCache[sourceItemId];
          let contentSha256 = cachedHash?.key === cacheKey ? cachedHash.sha256 : '';
          if (!contentSha256) {
            contentSha256 = await sha256File(filePath);
            if (hashCacheStore) {
              await hashCacheStore.set(sourceItemId, { key: cacheKey, sha256: contentSha256 });
            } else {
              nextHashCache[sourceItemId] = { key: cacheKey, sha256: contentSha256 };
            }
          }
          return { stat, contentSha256 };
        } catch (error) {
          if (hashCacheStore) await hashCacheStore.delete(sourceItemId);
          else delete nextHashCache[sourceItemId];
          return { failure: fileReadFailure(error) };
        }
      },
    );
    for (let itemIndex = 0; itemIndex < sourceItems.length; itemIndex += 1) {
      const item = sourceItems[itemIndex];
      if (cancelled()) throw new Error('操作已取消。');
      const sourceItemId = clampText(item?.id, 255);
      if (!sourceItemId) {
        warnData('已跳过缺少素材 ID 的 Eagle 记录。');
        processed += 1;
        continue;
      }
      if (seenSourceItemIds.has(sourceItemId)) {
        warnData(`已跳过重复素材 ID：${sourceItemId}`);
        processed += 1;
        continue;
      }
      seenSourceItemIds.add(sourceItemId);
      const filePath = item.filePath || '';
      const isDeleted = Boolean(item.isDeleted);
      const extension = clampText((item.ext || path.extname(filePath)).replace(/^\./, '').toLowerCase(), 16) || 'unknown';
      const mimeType = MIME_BY_EXTENSION[extension] || 'application/octet-stream';
      const originalFileName = clampText(path.basename(filePath), 255)
        || clampText(`${sourceItemId}.${extension}`, 255, 'unknown');
      const metadata = buildManifestMetadata(item, {
        sourceItemId,
        originalFileName,
        extension,
        mimeType,
        displayNameByTagIdentity: tagNormalization.displayNameByIdentity,
      });
      const missingFolderIds = metadata.folderIds.filter((folderId) => !knownFolderIds.has(folderId));
      if (missingFolderIds.length) {
        metadata.folderIds = metadata.folderIds.filter((folderId) => knownFolderIds.has(folderId));
        warnData(`素材 ${metadata.name || sourceItemId} 已忽略 ${missingFolderIds.length} 个失效文件夹引用。`);
      }
      if (isDeleted) {
        const rawDeletedSize = Math.trunc(Number(item.size));
        const deletedSize = Number.isSafeInteger(rawDeletedSize) && rawDeletedSize > 0 ? rawDeletedSize : 1;
        const manifestItem = { ...metadata, size: deletedSize, isDeleted: true };
        if (workspace) await workspace.append(manifestItem);
        else items.push(manifestItem);
        byteSize += deletedSize;
        processed += 1;
        onProgress({ phase: 'hash', current: processed, total: identifiers.length });
        continue;
      }
      const inspection = inspections[itemIndex];
      if (inspection.failure) {
        unreadableItemCount += 1;
        if (unreadableItems.length < MAX_UNREADABLE_ITEM_DETAILS) {
          unreadableItems.push({ sourceItemId, name: metadata.name, filePath, ...inspection.failure });
        }
        processed += 1;
        onProgress({ phase: 'hash', current: processed, total: identifiers.length });
        continue;
      }
      const { stat, contentSha256 } = inspection;
      if (!stat.isFile() || stat.size < 1) {
        unreadableItemCount += 1;
        if (unreadableItems.length < MAX_UNREADABLE_ITEM_DETAILS) {
          unreadableItems.push({
            sourceItemId, name: metadata.name, filePath,
            code: stat.isFile() ? 'EMPTY_FILE' : 'NOT_A_FILE',
            message: stat.isFile() ? '原文件为空' : '原文件路径不是普通文件',
          });
        }
        processed += 1;
        onProgress({ phase: 'hash', current: processed, total: identifiers.length });
        continue;
      }
      const manifestItem = {
        ...metadata,
        size: stat.size,
        importedAt: timestamp(item.importedAt, timestamp(stat.birthtimeMs, stat.mtimeMs)),
        modifiedAt: timestamp(item.modifiedAt, stat.mtimeMs),
        isDeleted,
        contentSha256,
        sourceFileModifiedAt: Math.max(1, Math.trunc(stat.mtimeMs)),
      };
      const sourceFile = { filePath, size: stat.size, mimeType, originalFileName };
      if (workspace) await workspace.append(manifestItem, sourceFile);
      else items.push(manifestItem);
      byteSize += stat.size;
      if (!workspace) sourceFiles.set(manifestItem.sourceItemId, sourceFile);
      processed += 1;
      onProgress({ phase: 'hash', current: processed, total: identifiers.length });
    }
  }

  if (hashCacheStore) await hashCacheStore.flush();
  if (workspace) await workspace.finalize();
  const result = {
    library: {
      name: clampText(library.name || path.basename(library.path), 255, 'Eagle 图库'),
      path: path.resolve(library.path),
      sourceModifiedAt: new Date(timestamp(library.modificationTime, Date.now())).toISOString(),
    },
    folders, tags, tagGroups, sourceFiles,
    unreadableItemCount, unreadableItems,
    mergedTagCount: tagNormalization.mergedTagCount,
    mergedTagDetails: tagNormalization.mergedTagDetails,
    dataWarningCount, dataWarnings,
    byteSize,
  };
  if (workspace) {
    return {
      ...result,
      itemCount: workspace.itemCount,
      manifestChunkCount: workspace.manifestChunkCountFor([folders, tags, tagGroups]),
      iterateItems: () => workspace.iterateItems(),
      dispose: () => workspace.dispose(),
    };
  }
  return { ...result, items, hashCache: nextHashCache, itemCount: items.length };
}

module.exports = {
  MIME_BY_EXTENSION, flattenFolders, mapConcurrentOrdered, normalizeTagGroups, normalizeTags,
  scanEagleLibrary, sha256File,
};

