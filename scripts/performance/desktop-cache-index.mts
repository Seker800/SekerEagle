import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { CacheIndex } from '../../apps/desktop/src/utility/cache/cache-index.ts';

const count = Number(process.argv[2] ?? 100_000);
if (!Number.isSafeInteger(count) || count < 1 || count > 500_000) {
  throw new Error('entry count must be an integer from 1 to 500000');
}

const directory = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-cache-scale-'));
const databasePath = path.join(directory, 'index.sqlite');
const namespaceId = 'a'.repeat(64);
const startedRss = process.memoryUsage().rss;
const hashFor = (value: number) => createHash('sha256').update(String(value)).digest();

try {
  let index = new CacheIndex(databasePath);
  const insertStarted = performance.now();
  for (let value = 0; value < count; value += 1) {
    const keyHash = hashFor(value);
    const assetId = `00000000-0000-4000-8000-${String(value % 100_000).padStart(12, '0')}`;
    index.beginWrite({ keyHash, namespaceId, assetId, kind: 'RENDITION', now: value });
    index.commitReady(keyHash, {
      logicalBytes: 12_000,
      allocatedBytes: 12_288,
      contentType: 'image/webp',
      etag: null,
      lastModified: null,
      verifiedAt: value,
      authorizationLeaseUntil: value + 300_000,
    });
  }
  const insertMs = performance.now() - insertStarted;
  index.close();

  const reopenStarted = performance.now();
  index = new CacheIndex(databasePath);
  const reopenMs = performance.now() - reopenStarted;

  const querySamples: number[] = [];
  for (let value = 0; value < 10_000; value += 1) {
    const queryStarted = performance.now();
    index.findReady(hashFor((value * 7919) % count));
    querySamples.push(performance.now() - queryStarted);
  }
  const accessStarted = performance.now();
  index.recordAccesses(
    Array.from({ length: 1_000 }, (_, at) => ({ keyHash: hashFor(at), at: count + at })),
  );
  const accessFlushMs = performance.now() - accessStarted;
  index.close();
  (globalThis as { gc?: () => void }).gc?.();

  querySamples.sort((left, right) => left - right);
  const percentile = (fraction: number) =>
    querySamples[Math.min(querySamples.length - 1, Math.floor(querySamples.length * fraction))];
  process.stdout.write(
    `${JSON.stringify({
      count,
      insertMs: Math.round(insertMs),
      reopenMs: Number(reopenMs.toFixed(2)),
      queryP95Ms: Number(percentile(0.95).toFixed(3)),
      queryP99Ms: Number(percentile(0.99).toFixed(3)),
      accessFlushMs: Number(accessFlushMs.toFixed(2)),
      incrementalRssMiB: Number(((process.memoryUsage().rss - startedRss) / 1024 ** 2).toFixed(1)),
      runtime: process.version,
      platform: `${process.platform}-${process.arch}`,
    })}\n`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
