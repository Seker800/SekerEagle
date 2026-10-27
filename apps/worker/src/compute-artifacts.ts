import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const ARTIFACT_CONTENT_TYPE = 'application/vnd.sekereagle.artifacts';
export const ARTIFACT_MAX_BYTES = 2 * 1024 ** 3;
const MAX_HEADER = 4096;
const MAX_FILES = 4096;
export interface ComputeArtifact {
  name: string;
  size: number;
  source: AsyncIterable<Uint8Array>;
}

function header(value: unknown) {
  const json = Buffer.from(JSON.stringify(value));
  if (json.length > MAX_HEADER) throw new Error('ARTIFACT_HEADER_TOO_LARGE');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(json.length);
  return Buffer.concat([length, json]);
}

/** SEA1: manifest, bounded file headers + exact binary lengths, then a zero header. */
export async function* encodeArtifacts(manifest: unknown, entries: Iterable<ComputeArtifact>) {
  yield Buffer.from('SEA1');
  yield header(manifest);
  let total = 0;
  let count = 0;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 1024 ** 3 || ++count > MAX_FILES)
      throw new Error('ARTIFACT_LIMIT');
    total += entry.size;
    if (total > ARTIFACT_MAX_BYTES) throw new Error('ARTIFACT_LIMIT');
    yield header({ name: entry.name, size: entry.size });
    let written = 0;
    for await (const chunk of entry.source) {
      written += chunk.length;
      if (written > entry.size) throw new Error('ARTIFACT_SIZE_MISMATCH');
      yield chunk;
    }
    if (written !== entry.size) throw new Error('ARTIFACT_SIZE_MISMATCH');
  }
  yield Buffer.alloc(4);
}

class Reader {
  private iterator: AsyncIterator<Uint8Array>;
  private chunk = Buffer.alloc(0);
  private offset = 0;
  private total = 0;
  constructor(source: AsyncIterable<Uint8Array>) { this.iterator = source[Symbol.asyncIterator](); }
  async read(size: number) {
    const output = Buffer.allocUnsafe(size);
    let position = 0;
    while (position < size) {
      if (this.offset === this.chunk.length) {
        const next = await this.iterator.next();
        if (next.done) throw new Error('ARTIFACT_TRUNCATED');
        this.chunk = Buffer.from(next.value);
        this.offset = 0;
        this.total += this.chunk.length;
        if (this.chunk.length > 16 * 1024 ** 2 || this.total > ARTIFACT_MAX_BYTES + MAX_FILES * MAX_HEADER + MAX_HEADER + 8)
          throw new Error('ARTIFACT_LIMIT');
        if (!this.chunk.length) continue;
      }
      const length = Math.min(size-position, this.chunk.length-this.offset);
      this.chunk.copy(output, position, this.offset, this.offset+length);
      position += length;
      this.offset += length;
    }
    return output;
  }
  async json(allowEnd = false): Promise<unknown> {
    const size = (await this.read(4)).readUInt32BE();
    if (!size && allowEnd) return null;
    if (!size || size > MAX_HEADER) throw new Error('ARTIFACT_HEADER_INVALID');
    return JSON.parse((await this.read(size)).toString('utf8'));
  }
  async end() {
    if (this.offset !== this.chunk.length) throw new Error('ARTIFACT_TRAILING_BYTES');
    for (;;) {
      const next = await this.iterator.next();
      if (next.done) return;
      if (next.value.length) throw new Error('ARTIFACT_TRAILING_BYTES');
    }
  }
  async close() { await this.iterator.return?.(); }
}

/** Spool to a caller-owned fresh directory. No whole video/pyramid allocation on the NAS. */
export async function receiveArtifacts(
  source: AsyncIterable<Uint8Array>, directory: string,
  validateManifest: (value: unknown) => void,
  validateFile: (name: string, size: number) => void,
) {
  const reader = new Reader(source);
  const files: string[] = [];
  let bytes = 0;
  try {
    if ((await reader.read(4)).toString('ascii') !== 'SEA1') throw new Error('ARTIFACT_MAGIC');
    const manifest = await reader.json();
    validateManifest(manifest);
    for (;;) {
      const value = await reader.json(true);
      if (value === null) break;
      const entry = value as { name?: unknown; size?: unknown };
      if (!entry || typeof entry.name !== 'string' || entry.name.length > 128 ||
          !/^[a-zA-Z0-9_./-]+$/.test(entry.name) || entry.name.split('/').some((p) => !p || p === '.' || p === '..') ||
          files.includes(entry.name) || files.length >= MAX_FILES ||
          !Number.isSafeInteger(entry.size) || Number(entry.size) < 0 || Number(entry.size) > 1024 ** 3)
        throw new Error('ARTIFACT_ENTRY_INVALID');
      const size = Number(entry.size);
      bytes += size;
      if (bytes > ARTIFACT_MAX_BYTES) throw new Error('ARTIFACT_LIMIT');
      validateFile(entry.name, size);
      const path = join(directory, entry.name);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      const file = await open(path, 'wx', 0o600);
      try {
        for (let remaining = size; remaining > 0;) {
          const count = Math.min(remaining, 1024 * 1024);
          await file.writeFile(await reader.read(count));
          remaining -= count;
        }
      } finally { await file.close(); }
      files.push(entry.name);
    }
    await reader.end();
    return { manifest, files, bytes };
  } finally { await reader.close(); }
}
