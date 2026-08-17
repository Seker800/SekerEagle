'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const CACHE_VERSION = 2;
const DEFAULT_MAX_LOADED_SHARDS = 8;

function isRecord(value) {
  return Boolean(value) && !Array.isArray(value) && typeof value === 'object';
}

function orderedEntries(entries) {
  return Object.fromEntries(
    Object.entries(entries).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function checksum(entries) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(orderedEntries(entries)))
    .digest('hex');
}

class HashCacheStore {
  constructor(
    directory,
    { maxLoadedShards = DEFAULT_MAX_LOADED_SHARDS, directoryName = 'hash-cache-v2' } = {},
  ) {
    this.directory = path.join(directory, directoryName);
    this.markerPath = path.join(this.directory, 'migration.json');
    this.maxLoadedShards = Math.max(1, Math.trunc(maxLoadedShards));
    this.loaded = new Map();
    this.loading = new Map();
    this.mutationTail = Promise.resolve();
    this.warning = '';
  }

  shardNameFor(sourceItemId) {
    return crypto.createHash('sha256').update(String(sourceItemId)).digest('hex').slice(0, 2);
  }

  shardPathFor(sourceItemId) {
    return path.join(this.directory, `${this.shardNameFor(sourceItemId)}.json`);
  }

  async get(sourceItemId) {
    const shard = await this.loadShard(this.shardNameFor(sourceItemId));
    return shard.entries[sourceItemId];
  }

  async set(sourceItemId, value) {
    await this.mutate(async () => {
      const shard = await this.loadShard(this.shardNameFor(sourceItemId));
      shard.entries[sourceItemId] = value;
      shard.dirty = true;
    });
  }

  async delete(sourceItemId) {
    await this.mutate(async () => {
      const shard = await this.loadShard(this.shardNameFor(sourceItemId));
      if (!Object.hasOwn(shard.entries, sourceItemId)) return;
      delete shard.entries[sourceItemId];
      shard.dirty = true;
    });
  }

  async flush() {
    await this.mutationTail;
    for (const [name, shard] of this.loaded) await this.persistShard(name, shard);
  }

  async mutate(operation) {
    const pending = this.mutationTail.then(operation);
    this.mutationTail = pending.catch(() => undefined);
    return pending;
  }

  async migrateLegacy(entries) {
    try {
      await fs.access(this.markerPath);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    for (const [sourceItemId, value] of Object.entries(isRecord(entries) ? entries : {})) {
      if (isRecord(value)) await this.set(sourceItemId, value);
    }
    await this.flush();
    await this.atomicWrite(this.markerPath, {
      version: CACHE_VERSION,
      migratedAt: new Date().toISOString(),
    });
  }

  async loadShard(name) {
    const cached = this.loaded.get(name);
    if (cached) {
      this.loaded.delete(name);
      this.loaded.set(name, cached);
      return cached;
    }
    const pending = this.loading.get(name);
    if (pending) return pending;
    const operation = this.readShard(name).finally(() => this.loading.delete(name));
    this.loading.set(name, operation);
    return operation;
  }

  async readShard(name) {
    const filePath = path.join(this.directory, `${name}.json`);
    let entries = {};
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      if (
        parsed?.version !== CACHE_VERSION ||
        !isRecord(parsed.entries) ||
        parsed.checksum !== checksum(parsed.entries)
      ) {
        throw new SyntaxError('缓存分片校验失败。');
      }
      entries = parsed.entries;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        const backupPath = `${filePath}.corrupt-${Date.now()}`;
        await fs.rename(filePath, backupPath).catch(() => undefined);
        this.warning = `缓存分片已损坏，已隔离 ${path.basename(filePath)}；对应文件将重新计算指纹。`;
      }
    }
    const shard = { entries, dirty: false };
    this.loaded.set(name, shard);
    await this.evictIfNeeded();
    return shard;
  }

  async evictIfNeeded() {
    while (this.loaded.size > this.maxLoadedShards) {
      const [name, shard] = this.loaded.entries().next().value;
      await this.persistShard(name, shard);
      this.loaded.delete(name);
    }
  }

  async persistShard(name, shard) {
    if (!shard.dirty) return;
    const entries = orderedEntries(shard.entries);
    await this.atomicWrite(path.join(this.directory, `${name}.json`), {
      version: CACHE_VERSION,
      checksum: checksum(entries),
      entries,
    });
    shard.entries = entries;
    shard.dirty = false;
  }

  async atomicWrite(filePath, value) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, filePath);
  }
}

module.exports = { CACHE_VERSION, HashCacheStore };
