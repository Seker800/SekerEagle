import type { QueryClient } from '@tanstack/react-query';
import { ThumbnailLoadService } from '../media/loading/thumbnailLoadService';
import { EagleAssetEntityStore } from './eagle-asset-entity-store';
import { createEagleQueryKeys } from './eagle-query-keys';

// Normalized page IDs and their entities must have the same lifetime. Keep only
// workspaces that still have a list in React Query; its existing GC bounds idle use.
const caches = new WeakMap<QueryClient, Map<string, EagleWorkspaceCache>>();

export function getEagleWorkspaceCache(
  client: QueryClient,
  ownerId: string,
  mode: 'MATERIAL' | 'PHOTO',
) {
  let scopes = caches.get(client);
  if (!scopes) {
    scopes = new Map();
    caches.set(client, scopes);
  }
  const scope = JSON.stringify([ownerId, mode]);
  let cache = scopes.get(scope);
  if (!cache) {
    cache = new EagleWorkspaceCache(client, ownerId, mode, () => scopes.delete(scope));
    scopes.set(scope, cache);
  }
  return cache;
}

class EagleWorkspaceCache {
  readonly store;
  readonly thumbnails = new ThumbnailLoadService({ maxEntries: 512, maxBytes: 128 * 1024 * 1024 });
  readonly #keys;
  readonly #unsubscribe;
  #references = 0;
  #disposed = false;

  constructor(
    private readonly client: QueryClient,
    ownerId: string,
    mode: 'MATERIAL' | 'PHOTO',
    private readonly onDispose: () => void,
  ) {
    this.#keys = createEagleQueryKeys(ownerId, mode);
    // Query clients (including connection/session resets) must not share entities.
    this.store = new EagleAssetEntityStore();
    this.#unsubscribe = client.getQueryCache().subscribe((event) => {
      if (event.type === 'removed') this.#collect();
    });
  }

  retain(privateVisible: boolean) {
    this.#references += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      // An unlocked workspace is never retained across navigation. This also
      // removes private catalogs/details, rather than merely hiding their cards.
      if (privateVisible) {
        this.client.removeQueries({ queryKey: this.#keys.root });
        this.store.clear();
        this.thumbnails.dispose();
      }
      this.#references -= 1;
      // React can replay effect cleanup/setup in one turn. Purge private data
      // immediately, but defer destroying the resource owner until setup finishes.
      queueMicrotask(() => this.#collect());
    };
  }

  #collect() {
    if (this.#disposed || this.#references) return;
    const lists = this.client.getQueryCache().findAll({ queryKey: this.#keys.assets });
    if (lists.some(({ queryKey }) => queryKey.length === this.#keys.assets.length + 2)) return;
    this.#disposed = true;
    this.#unsubscribe();
    this.store.clear();
    this.thumbnails.dispose();
    this.onDispose();
  }
}
