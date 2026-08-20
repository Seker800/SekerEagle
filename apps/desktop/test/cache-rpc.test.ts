import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CacheRpcClient,
  CacheRpcDispatcher,
  type CacheRpcEndpoint,
  type CacheRpcMessage,
} from '../src/shared/cache-rpc';

const namespaceId = 'a'.repeat(64);
const keyHash = Buffer.alloc(32, 9);
const assetId = '00000000-0000-4000-8000-000000000009';

describe('cache utility RPC', () => {
  let root: string | undefined;
  let client: CacheRpcClient | undefined;

  afterEach(async () => {
    await client?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('preserves binary chunks, errors, leases and metadata across the message boundary', async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'sekereagle-cache-rpc-'));
    const [clientEndpoint, utilityEndpoint] = pairedEndpoints();
    const dispatcher = new CacheRpcDispatcher();
    utilityEndpoint.subscribe((message) => {
      void dispatcher.dispatch(message).then((response) => utilityEndpoint.postMessage(response));
    });
    client = new CacheRpcClient(clientEndpoint);

    expect(
      await client.initialize({
        cacheRoot: root,
        limitBytes: 1024 ** 2,
        enforceDiskSafety: false,
      }),
    ).toMatchObject({ fullTreeScans: 0 });
    const writeId = await client.beginWrite({
      keyHash,
      namespaceId,
      assetId,
      kind: 'RENDITION',
      expectedLength: 9,
      now: 1,
    });
    await expect(
      client.beginWrite({
        keyHash,
        namespaceId,
        assetId,
        kind: 'RENDITION',
        expectedLength: 9,
        now: 1,
      }),
    ).rejects.toThrow(/写入中/);
    await client.append(writeId, Buffer.from('rpc-media'));
    await client.commit(writeId, {
      expectedLength: 9,
      contentType: 'image/webp',
      etag: '"rpc-etag"',
      lastModified: null,
      verifiedAt: 2,
      authorizationLeaseUntil: 302,
    });

    const hit = await client.acquire(keyHash, namespaceId, 3);
    expect(hit).toMatchObject({ logicalBytes: 9, etag: '"rpc-etag"' });
    await client.release(hit!.leaseId);
    expect(await client.acquire(Buffer.alloc(32, 8), namespaceId, 4)).toBeNull();
    expect(await client.getNamespaceStats(namespaceId)).toMatchObject({
      entryCount: 1,
      hitCount: 1,
      missCount: 1,
      savedBytes: 9,
    });
    await client.setLimitBytes(2 * 1024 ** 2);
    expect(await client.invalidateAsset(namespaceId, assetId)).toEqual({
      deleted: 1,
      deferred: 0,
    });
    expect(await client.clearNamespace(namespaceId)).toEqual({ deleted: 0, deferred: 0 });
  });
});

function pairedEndpoints(): [CacheRpcEndpoint, CacheRpcEndpoint] {
  const listeners: [
    Set<(message: CacheRpcMessage) => void>,
    Set<(message: CacheRpcMessage) => void>,
  ] = [new Set(), new Set()];
  const endpoint = (own: 0 | 1, peer: 0 | 1): CacheRpcEndpoint => ({
    postMessage(message) {
      queueMicrotask(() => {
        for (const listener of listeners[peer]) listener(structuredClone(message));
      });
    },
    subscribe(listener) {
      listeners[own].add(listener);
      return () => listeners[own].delete(listener);
    },
  });
  return [endpoint(0, 1), endpoint(1, 0)];
}
