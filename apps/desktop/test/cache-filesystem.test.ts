import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { availableBytesForPath, ensureCacheDirectory } from '../src/main/cache-filesystem';

describe('desktop cache filesystem', () => {
  const temporaryRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })));
  });

  it('reads disk capacity from an existing ancestor when the cache has not been created', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-cache-filesystem-'));
    temporaryRoots.push(root);
    const missingCacheRoot = path.join(root, 'SekerEagle', 'MediaCache', 'v2');

    await expect(availableBytesForPath(missingCacheRoot)).resolves.toBeGreaterThan(0);
    await expect(stat(missingCacheRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('creates the cache directory on demand with private owner permissions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-cache-filesystem-'));
    temporaryRoots.push(root);
    const missingCacheRoot = path.join(root, 'SekerEagle', 'MediaCache', 'v2');

    await ensureCacheDirectory(missingCacheRoot);

    const details = await stat(missingCacheRoot);
    expect(details.isDirectory()).toBe(true);
    expect(details.mode & 0o777).toBe(0o700);
  });
});
