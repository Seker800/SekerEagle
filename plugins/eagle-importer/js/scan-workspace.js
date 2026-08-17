'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { HashCacheStore } = require('./hash-cache-store');

const MAX_JSON_BYTES = 72 * 1024;
const MAX_CHUNK_ENTRIES = 500;

class ScanWorkspace {
  constructor(directory) {
    this.directory = directory;
    this.itemsPath = path.join(directory, 'manifest-items.ndjson');
    this.sourceFiles = new HashCacheStore(directory, { directoryName: 'source-files-v1' });
    this.itemCount = 0;
    this.itemChunkCount = 0;
    this.currentChunkEntries = 0;
    this.currentChunkBytes = 2;
    this.fileHandle = null;
  }

  async open() {
    await fsp.mkdir(this.directory, { recursive: true });
    this.fileHandle = await fsp.open(this.itemsPath, 'w', 0o600);
    return this;
  }

  async append(item, sourceFile) {
    if (!this.fileHandle) throw new Error('扫描工作区尚未打开。');
    const encoded = JSON.stringify(item);
    const encodedBytes = Buffer.byteLength(encoded, 'utf8');
    const appendedBytes = encodedBytes + (this.currentChunkEntries ? 1 : 0);
    if (
      this.currentChunkEntries > 0
      && (this.currentChunkBytes + appendedBytes > MAX_JSON_BYTES
        || this.currentChunkEntries >= MAX_CHUNK_ENTRIES)
    ) {
      this.itemChunkCount += 1;
      this.currentChunkEntries = 0;
      this.currentChunkBytes = 2;
    }
    this.currentChunkEntries += 1;
    this.currentChunkBytes += encodedBytes + (this.currentChunkEntries > 1 ? 1 : 0);
    this.itemCount += 1;
    await this.fileHandle.write(`${encoded}\n`);
    if (sourceFile) await this.sourceFiles.set(item.sourceItemId, sourceFile);
  }

  async finalize() {
    if (this.currentChunkEntries > 0) this.itemChunkCount += 1;
    await this.sourceFiles.flush();
    if (this.fileHandle) await this.fileHandle.close();
    this.fileHandle = null;
  }

  manifestChunkCountFor(definitionGroups) {
    let count = this.itemChunkCount;
    for (const values of definitionGroups) {
      let entries = 0;
      let bytes = 2;
      for (const value of values) {
        const encodedBytes = Buffer.byteLength(JSON.stringify(value), 'utf8');
        const appendedBytes = encodedBytes + (entries ? 1 : 0);
        if (entries && (bytes + appendedBytes > MAX_JSON_BYTES || entries >= MAX_CHUNK_ENTRIES)) {
          count += 1;
          entries = 0;
          bytes = 2;
        }
        entries += 1;
        bytes += encodedBytes + (entries > 1 ? 1 : 0);
      }
      if (entries) count += 1;
    }
    return count || 1;
  }

  async *iterateItems() {
    const input = fs.createReadStream(this.itemsPath, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (line) yield JSON.parse(line);
      }
    } finally {
      lines.close();
      input.destroy();
    }
  }

  async dispose() {
    if (this.fileHandle) await this.fileHandle.close().catch(() => undefined);
    this.fileHandle = null;
    await fsp.rm(this.directory, { recursive: true, force: true });
  }
}

module.exports = { ScanWorkspace };

