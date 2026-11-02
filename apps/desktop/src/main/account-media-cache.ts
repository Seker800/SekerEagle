import { buildNamespaceId } from '../shared/media-identity';
import type { AuthenticatedIdentity } from './authenticated-owner';
import { emptyCacheRequestStats, type CacheRequestStats } from './media-cache-controller';

interface NamespaceStats {
  entryCount: number;
  logicalBytes: number;
  allocatedBytes: number;
  hitCount: number;
  missCount: number;
  savedBytes: number;
}
interface AccountCacheBackend {
  getNamespaceStats(namespace: string): NamespaceStats | Promise<NamespaceStats>;
  clearNamespace(namespace: string): Promise<{ deleted: number; deferred: number }>;
  invalidateAsset(
    namespace: string,
    assetId: string,
  ): Promise<{ deleted: number; deferred: number }>;
}

export function accountCacheNamespaces(server: string, identity: AuthenticatedIdentity): string[] {
  return (['MATERIAL', 'PHOTO'] as const).map((mode) =>
    buildNamespaceId(server, identity.ownerId, identity.deploymentId, mode),
  );
}

export async function readAccountCacheStats(
  cache: Pick<AccountCacheBackend, 'getNamespaceStats'>,
  namespaces: readonly string[],
  requests: (namespace: string) => CacheRequestStats = emptyCacheRequestStats,
) {
  const stats = await Promise.all(
    namespaces.map((namespace) => cache.getNamespaceStats(namespace)),
  );
  return {
    ...sumCounters(stats, {
      entryCount: 0,
      logicalBytes: 0,
      allocatedBytes: 0,
      hitCount: 0,
      missCount: 0,
      savedBytes: 0,
    }),
    requests: sumCounters(namespaces.map(requests), emptyCacheRequestStats()),
  };
}

export async function removeAccountCache(
  cache: Pick<AccountCacheBackend, 'clearNamespace' | 'invalidateAsset'>,
  namespaces: readonly string[],
  assetId?: string,
) {
  const results = await Promise.all(
    namespaces.map((namespace) =>
      assetId === undefined
        ? cache.clearNamespace(namespace)
        : cache.invalidateAsset(namespace, assetId),
    ),
  );
  return sumCounters(results, { deleted: 0, deferred: 0 });
}

function sumCounters<T extends object>(items: readonly T[], zero: T): T {
  const total = { ...zero };
  for (const key of Object.keys(zero) as Array<keyof T>) {
    total[key] = items.reduce((sum, item) => sum + Number(item[key]), 0) as T[keyof T];
  }
  return total;
}
