'use strict';

const fs = require('node:fs/promises');
const { randomId } = require('./utils');

const MANIFEST_VERSION = 2;
const MAX_JSON_BYTES = 72 * 1024;
const MAX_CHUNK_ENTRIES = 500;

function* iterateSizedChunks(
  kind,
  values,
  maxBytes = MAX_JSON_BYTES,
  maxEntries = MAX_CHUNK_ENTRIES,
) {
  let current = [];
  let currentBytes = 2;
  let index = 0;
  for (const value of values) {
    const encodedBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    const appendedBytes = encodedBytes + (current.length ? 1 : 0);
    if (
      current.length &&
      (currentBytes + appendedBytes > maxBytes || current.length >= maxEntries)
    ) {
      index += 1;
      yield { kind, key: `${kind}-${String(index).padStart(5, '0')}`, entries: current };
      current = [value];
      currentBytes = encodedBytes + 2;
    } else {
      current.push(value);
      currentBytes += appendedBytes;
    }
  }
  if (current.length) {
    index += 1;
    yield { kind, key: `${kind}-${String(index).padStart(5, '0')}`, entries: current };
  }
}

function sizedChunks(kind, values, maxBytes = MAX_JSON_BYTES) {
  return [...iterateSizedChunks(kind, values, maxBytes)];
}

function* iterateManifestChunks(scan) {
  let emitted = false;
  for (const [kind, values] of [
    ['folders', scan.folders],
    ['tags', scan.tags],
    ['tag-groups', scan.tagGroups],
    ['items', scan.items],
  ]) {
    for (const group of iterateSizedChunks(kind, values)) {
      emitted = true;
      yield {
        manifestVersion: MANIFEST_VERSION,
        chunkKey: group.key,
        folders: kind === 'folders' ? group.entries : [],
        tags: kind === 'tags' ? group.entries : [],
        tagGroups: kind === 'tag-groups' ? group.entries : [],
        items: kind === 'items' ? group.entries : [],
      };
    }
  }
  if (!emitted) {
    yield {
      manifestVersion: MANIFEST_VERSION,
      chunkKey: 'items-00001',
      folders: [],
      tags: [],
      tagGroups: [],
      items: [],
    };
  }
}

function buildManifestChunks(scan) {
  return [...iterateManifestChunks(scan)];
}

async function* iterateSizedChunksAsync(kind, values) {
  let current = [];
  let currentBytes = 2;
  let index = 0;
  for await (const value of values) {
    const encodedBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
    const appendedBytes = encodedBytes + (current.length ? 1 : 0);
    if (
      current.length &&
      (currentBytes + appendedBytes > MAX_JSON_BYTES || current.length >= MAX_CHUNK_ENTRIES)
    ) {
      index += 1;
      yield { kind, key: `${kind}-${String(index).padStart(5, '0')}`, entries: current };
      current = [value];
      currentBytes = encodedBytes + 2;
    } else {
      current.push(value);
      currentBytes += appendedBytes;
    }
  }
  if (current.length) {
    index += 1;
    yield { kind, key: `${kind}-${String(index).padStart(5, '0')}`, entries: current };
  }
}

async function* iterateManifestChunksAsync(scan) {
  let emitted = false;
  for (const [kind, values] of [
    ['folders', scan.folders],
    ['tags', scan.tags],
    ['tag-groups', scan.tagGroups],
  ]) {
    for (const group of iterateSizedChunks(kind, values)) {
      emitted = true;
      yield {
        manifestVersion: MANIFEST_VERSION,
        chunkKey: group.key,
        folders: kind === 'folders' ? group.entries : [],
        tags: kind === 'tags' ? group.entries : [],
        tagGroups: kind === 'tag-groups' ? group.entries : [],
        items: [],
      };
    }
  }
  const items = scan.iterateItems ? scan.iterateItems() : scan.items;
  for await (const group of iterateSizedChunksAsync('items', items)) {
    emitted = true;
    yield {
      manifestVersion: MANIFEST_VERSION,
      chunkKey: group.key,
      folders: [],
      tags: [],
      tagGroups: [],
      items: group.entries,
    };
  }
  if (!emitted) {
    yield {
      manifestVersion: MANIFEST_VERSION,
      chunkKey: 'items-00001',
      folders: [],
      tags: [],
      tagGroups: [],
      items: [],
    };
  }
}

async function readPart(fileHandle, offset, length) {
  const buffer = Buffer.allocUnsafe(length);
  const { bytesRead } = await fileHandle.read(buffer, 0, length, offset);
  return bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
}

class ImportPausedError extends Error {
  constructor() {
    super('同步已暂停。');
    this.name = 'ImportPausedError';
    this.code = 'IMPORT_PAUSED';
  }
}

class ImportCancelledError extends Error {
  constructor() {
    super('操作已取消。');
    this.name = 'ImportCancelledError';
    this.code = 'IMPORT_CANCELLED';
  }
}

function isImportPausedError(error) {
  return error?.code === 'IMPORT_PAUSED';
}

function isImportControlError(error) {
  return isImportPausedError(error) || error?.code === 'IMPORT_CANCELLED';
}

class ImportEngine {
  constructor({
    api,
    store,
    log = () => {},
    progress = () => {},
    itemState = async () => {},
    uploadConcurrency = 3,
  }) {
    this.api = api;
    this.store = store;
    this.log = log;
    this.progress = progress;
    this.itemState = itemState;
    this.uploadConcurrency = Math.min(4, Math.max(1, Math.trunc(uploadConcurrency)));
    this.cancelRequested = false;
    this.pauseRequested = false;
  }

  cancelLocally() {
    this.cancelRequested = true;
  }
  pauseLocally() {
    this.pauseRequested = true;
  }
  assertActive() {
    if (this.cancelRequested) throw new ImportCancelledError();
    if (this.pauseRequested) throw new ImportPausedError();
  }

  async prepare(scan, externalLibraryId) {
    this.cancelRequested = false;
    this.pauseRequested = false;
    const idempotencyKey = `eagle-${Date.now()}-${randomId()}`.slice(0, 128);
    const run = await this.api.createRun({
      idempotencyKey,
      manifestVersion: MANIFEST_VERSION,
      externalLibraryId,
      libraryName: scan.library.name,
      sourceModifiedAt: scan.library.sourceModifiedAt,
      declaredItemCount: scan.itemCount ?? scan.items.length,
      declaredByteSize: scan.byteSize,
    });
    await this.store.save({
      activeRun: {
        runId: run.id,
        externalLibraryId,
        libraryPath: scan.library.path,
        phase: 'STAGING',
      },
    });
    return this.stageAndPreflight(run, scan, externalLibraryId);
  }

  async resumePreparation(runId, scan, externalLibraryId) {
    this.cancelRequested = false;
    this.pauseRequested = false;
    const run = await this.api.getRun(runId);
    return this.stageAndPreflight(run, scan, externalLibraryId);
  }

  async stageAndPreflight(run, scan, externalLibraryId) {
    let total = scan.manifestChunkCount;
    if (total === undefined) {
      total = 0;
      for await (const chunk of iterateManifestChunksAsync(scan)) {
        void chunk;
        total += 1;
      }
    }
    let completed = 0;
    for await (const chunk of iterateManifestChunksAsync(scan)) {
      this.assertActive();
      await this.api.stageChunk(run.id, chunk);
      completed += 1;
      this.progress({ phase: 'stage', current: completed, total });
    }
    const preflight = await this.api.preflight(run.id);
    await this.store.save({
      activeRun:
        preflight.uploadItemCount === 0
          ? null
          : {
              runId: run.id,
              externalLibraryId,
              libraryPath: scan.library.path,
              phase: 'PREFLIGHTED',
            },
    });
    return { run, preflight };
  }

  async upload(runId, sourceFiles) {
    this.cancelRequested = false;
    this.pauseRequested = false;
    for await (const item of this.api.iterateItems(runId, 'FAILED')) {
      this.assertActive();
      await this.api.retryItem(runId, item.id);
    }
    const startingRun = await this.api.getRun(runId);
    const total = Math.max(startingRun.stagedItemCount || 0, 1);
    await this.store.save({
      activeRun: { ...this.store.state.activeRun, runId, phase: 'UPLOADING' },
    });
    let completed = 0;
    const active = new Set();
    const scheduledItemIds = new Set();
    const schedule = (item) => {
      const operation = this.uploadOne(runId, item, sourceFiles, () => {
        completed += 1;
        this.progress({ phase: 'upload', current: completed, total });
      }).finally(() => active.delete(operation));
      active.add(operation);
    };
    let loopError = null;
    try {
      for (const status of ['UPLOADING', 'STAGED']) {
        for await (const item of this.api.iterateItems(runId, status)) {
          this.assertActive();
          if (item.action !== 'NEW' && item.action !== 'CONTENT_REPLACE') continue;
          if (scheduledItemIds.has(item.id)) continue;
          scheduledItemIds.add(item.id);
          schedule(item);
          if (active.size >= this.uploadConcurrency) {
            await Promise.race(active);
            this.assertActive();
          }
        }
      }
    } catch (error) {
      loopError = error;
    }
    const settled = await Promise.allSettled(active);
    const workerError = settled.find((result) => result.status === 'rejected')?.reason;
    const interruption = loopError || workerError;
    if (this.pauseRequested || isImportPausedError(interruption)) {
      await this.store.save({
        activeRun: { ...this.store.state.activeRun, runId, phase: 'PAUSED' },
      });
      throw isImportPausedError(interruption) ? interruption : new ImportPausedError();
    }
    if (interruption) throw interruption;
    this.assertActive();
    const run = await this.api.getRun(runId);
    this.assertActive();
    await this.store.save({
      activeRun: ['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(run.status)
        ? null
        : { ...this.store.state.activeRun, phase: run.status },
    });
    return run;
  }

  async uploadOne(runId, item, sourceFiles, onCompleted) {
    try {
      await this.itemState(item, { status: 'UPLOADING' });
      const source = await sourceFiles.get(item.sourceItemId);
      if (!source) throw new Error(`Eagle 中找不到待上传原文件：${item.displayName}`);
      this.log(`上传 ${item.displayName}`);
      const completed = await this.uploadItem(runId, item, source, () => {});
      if (completed?.assetId) {
        await this.itemState(item, {
          status: 'IMPORTED',
          assetId: completed.assetId,
          duplicate: Boolean(completed.duplicate),
        });
      }
    } catch (error) {
      if (isImportControlError(error)) throw error;
      await this.itemState(item, { status: 'FAILED', error });
      const detail = error instanceof Error ? error.message : String(error);
      this.log(`跳过上传失败项 ${item.displayName}：${detail}`);
    } finally {
      onCompleted();
    }
  }

  async uploadItem(runId, item, source, onProgress) {
    const session = await this.api.initiateUpload(runId, item.id, {
      fileName: source.originalFileName,
      mimeType: source.mimeType,
      size: source.size,
    });
    if (session.alreadyImported) {
      onProgress(1);
      return session;
    }
    const sessionId = session.id;
    const uploaded = await this.api.getUploadedParts(sessionId);
    const existing = new Map(uploaded.parts.map((part) => [part.partNumber, part]));
    const partSize = uploaded.partSizeBytes || session.partSizeBytes;
    const partCount = Math.ceil(source.size / partSize);
    const completedParts = new Map(existing);
    const fileHandle = await fs.open(source.filePath, 'r');
    try {
      for (let partNumber = 1; partNumber <= partCount; partNumber += 1) {
        this.assertActive();
        if (!completedParts.has(partNumber)) {
          const offset = (partNumber - 1) * partSize;
          const bytes = await readPart(
            fileHandle,
            offset,
            Math.min(partSize, source.size - offset),
          );
          const response = await this.api.uploadPart(sessionId, partNumber, bytes);
          completedParts.set(partNumber, { partNumber, etag: response.etag, size: bytes.length });
        }
        onProgress(partNumber / partCount);
      }
    } finally {
      await fileHandle.close();
    }
    const parts = [...completedParts.values()]
      .map(({ partNumber, etag }) => ({ partNumber, etag }))
      .sort((left, right) => left.partNumber - right.partNumber);
    this.assertActive();
    await this.itemState(item, { status: 'COMMITTING', uploadSessionId: sessionId });
    return this.api.completeUpload(sessionId, parts);
  }

  async cancelRun(runId) {
    this.cancelLocally();
    const result = await this.api.cancelRun(runId);
    await this.store.save({ activeRun: null });
    return result;
  }
}

module.exports = {
  ImportEngine,
  ImportPausedError,
  isImportPausedError,
  MANIFEST_VERSION,
  MAX_JSON_BYTES,
  MAX_CHUNK_ENTRIES,
  buildManifestChunks,
  iterateManifestChunks,
  iterateSizedChunks,
  sizedChunks,
  iterateManifestChunksAsync,
};
