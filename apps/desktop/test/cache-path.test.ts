import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cacheFilePath, cacheRelativePath } from '../src/utility/cache/cache-path';

describe('cache paths', () => {
  it('uses one of 4096 single-level shards and never embeds source names', () => {
    const hash = Buffer.from('abc123'.padEnd(64, '0'), 'hex');
    const relative = cacheRelativePath(hash);

    expect(relative).toBe(path.join('abc', `${hash.toString('hex')}.media`));
    expect(relative.split(path.sep)).toHaveLength(2);
  });

  it('resolves only valid 32-byte hashes beneath the cache root', () => {
    const root = path.resolve('/tmp/seker-eagle-cache');
    const hash = Buffer.alloc(32, 255);

    expect(cacheFilePath(root, hash)).toBe(path.join(root, 'fff', `${hash.toString('hex')}.media`));
    expect(() => cacheRelativePath(Buffer.alloc(31))).toThrow();
  });
});
