import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CacheStore } from '../src/utility/cache/cache-store';

const keyHash = Buffer.from('123'.padEnd(64, '0'), 'hex');

describe('CacheStore', () => {
  let root: string;
  let store: CacheStore;

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-cache-store-'));
    store = new CacheStore(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('keeps partial data outside the ready path and atomically commits a complete file', async () => {
    const pending = await store.createPartial(keyHash);
    await pending.handle.writeFile(Buffer.from('cached-media'));

    expect(await store.exists(keyHash)).toBe(false);
    const committed = await store.commitPartial(pending);

    expect(await store.exists(keyHash)).toBe(true);
    expect(await readFile(committed.filePath, 'utf8')).toBe('cached-media');
    expect(committed.logicalBytes).toBe(12);
    expect(committed.allocatedBytes).toBeGreaterThanOrEqual(committed.logicalBytes);
  });

  it('abandons failed partial writes without creating a hit', async () => {
    const pending = await store.createPartial(keyHash);
    await pending.handle.writeFile('incomplete');
    await store.abandonPartial(pending);

    expect(await store.exists(keyHash)).toBe(false);
  });

  it('rejects a partial path that did not originate in its temp directory', async () => {
    const foreign = path.join(root, '..', 'foreign.partial');
    await writeFile(foreign, 'untrusted');
    await expect(
      store.commitPartial({
        keyHash,
        partialPath: foreign,
        handle: await import('node:fs/promises').then(({ open }) => open(foreign, 'r+')),
      }),
    ).rejects.toThrow(/partial/i);
    await rm(foreign, { force: true });
  });

  it('removes committed cache files idempotently', async () => {
    const pending = await store.createPartial(keyHash);
    await pending.handle.writeFile('ready');
    await store.commitPartial(pending);

    await expect(store.remove(keyHash)).resolves.toBe(true);
    await expect(store.remove(keyHash)).resolves.toBe(false);
  });
});
