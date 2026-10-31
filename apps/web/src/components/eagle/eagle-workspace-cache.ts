import { LibraryUploadQueue } from '../../lib/library-upload-queue';
import { OriginalDownloadQueue } from '../../lib/original-download-queue';
import type { EagleQuickFilterState } from './eagle-quick-filter-state';
import { QueryObserver, type QueryClient } from '@tanstack/react-query';
import { ThumbnailLoadService } from '../media/loading/thumbnailLoadService';
import { EagleAssetEntityStore } from './eagle-asset-entity-store';
import { createEagleQueryKeys } from './eagle-query-keys';

export type EagleLibraryView =
  | 'ACTIVE'
  | 'PRIVATE'
  | 'TRASH'
  | 'MANUAL_TAGS'
  | 'AI_TAGS'
  | 'VECTOR_REVIEW'
  | 'VECTOR_TAGS'
  | 'VECTOR_UNCLASSIFIED'
  | 'PROCESSING'
  | 'ACCOUNT';
export type EaglePhotoView = 'timeline' | 'map' | 'people' | 'agent' | 'statistics';

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
  #backgroundPending = false;
  #backgroundRevision = 0;
  readonly #backgroundListeners = new Set<() => void>();
  readonly subscribeBackgroundChanges = (listener: () => void) => {
    this.#backgroundListeners.add(listener);
    return () => {
      this.#backgroundListeners.delete(listener);
    };
  };
  readonly hasBackgroundChanges = () => this.#backgroundPending;
  get backgroundRevision() {
    return this.#backgroundRevision;
  }
  markBackgroundChanges() {
    if (this.#disposed) return;
    this.#backgroundRevision++;
    if (this.#backgroundPending) return;
    this.#backgroundPending = true;
    for (const listener of this.#backgroundListeners) listener();
  }
  acknowledgeBackgroundChanges(revision: number) {
    if (revision !== this.#backgroundRevision || !this.#backgroundPending) return;
    this.#backgroundPending = false;
    for (const listener of this.#backgroundListeners) listener();
  }
  browse: {
    search: string;
    quickFilters: EagleQuickFilterState;
    activeSmartFolderId: string | null;
    smartFolderOrder: 'DATE' | 'RELEVANCE';
    libraryView: EagleLibraryView;
    photoView: EaglePhotoView;
    filtersExpanded: boolean;
    selectedAssetIds: string[];
    selectedAssetId: string | null;
    isInspectorVisible: boolean;
    isBatchSelection: boolean;
    selectionMode: boolean;
  } | null = null;
  readonly uploads = new LibraryUploadQueue(
    (key) => this.client.invalidateQueries({ queryKey: key }),
    () => this.retainTransfer(),
  );
  readonly downloads = new OriginalDownloadQueue(() => this.retainTransfer());
  private retainTransfer() {
    const release = this.retain(false);
    const query = this.client.getQueryCache().findAll({ queryKey: this.#keys.root })[0];
    // Observe without fetching: normal GC must not revoke an ongoing save. An
    // explicit session/privacy removal still removes the query and aborts it.
    const observer = query
      ? new QueryObserver(this.client, {
          ...query.options,
          queryKey: query.queryKey,
          enabled: false,
        })
      : undefined;
    const unsubscribe = observer?.subscribe(() => undefined);
    return () => {
      unsubscribe?.();
      release();
    };
  }
  readonly scrollPositions = new Map<string, number>();
  clearNavigation() {
    this.acknowledgeBackgroundChanges(this.#backgroundRevision);
    this.downloads.clear();
    this.uploads.clear();
    this.browse = null;
    this.scrollPositions.clear();
  }
  readonly store;
  readonly thumbnails = new ThumbnailLoadService({ maxEntries: 512, maxBytes: 128 * 1024 * 1024 });
  readonly #keys;
  readonly #unsubscribe;
  #references = 0;
  #disposed = false;
  #entityReferences = new Map<string, Set<string>>();
  #entityCollection: ReturnType<typeof setTimeout> | undefined;
  // Wait until query promises have published their normalized pages. In particular,
  // never collect a just-normalized response inside a query observer notification.
  #scheduleEntityCollection() {
    if (this.#entityCollection !== undefined || this.#disposed) return;
    this.#entityCollection = setTimeout(() => {
      this.#entityCollection = undefined;
      if (this.#disposed) return;
      const ids = new Set<string>();
      for (const references of this.#entityReferences.values())
        for (const id of references) ids.add(id);
      this.store.retainOnly(ids);
    }, 0);
  }

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
      const key: unknown = event.query.queryKey;
      if (!Array.isArray(key)) return;
      if (!this.#keys.root.every((part, index) => key[index] === part)) return;
      if (event.type === 'updated' && event.action.type === 'success') {
        const ids = queryAssetReferences(key, event.query.state.data);
        if (ids) {
          this.#entityReferences.set(event.query.queryHash, ids);
          this.#scheduleEntityCollection();
        } else if (this.#entityReferences.delete(event.query.queryHash))
          this.#scheduleEntityCollection();
      }
      if (event.type === 'removed') {
        this.#entityReferences.delete(event.query.queryHash);
        this.#scheduleEntityCollection();
        if (!client.getQueryCache().findAll({ queryKey: this.#keys.root }).length) {
          this.downloads.clear();
          this.uploads.clear();
        }
        this.#collect();
      }
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
        this.clearNavigation();
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
    if (
      this.client
        .getQueryCache()
        .findAll({ queryKey: this.#keys.assetDetails })
        .some((query) => query.state.data !== undefined)
    )
      return;
    this.clearNavigation();
    this.uploads.dispose();
    this.#disposed = true;
    clearTimeout(this.#entityCollection);
    this.#entityReferences.clear();
    this.#unsubscribe();
    this.store.clear();
    this.thumbnails.dispose();
    this.onDispose();
  }
}

function queryAssetReferences(key: readonly unknown[], data: unknown): Set<string> | null {
  if (!data || typeof data !== 'object') return null;
  if (key[3] === 'asset-detail' && 'id' in data && typeof data.id === 'string')
    return new Set([data.id]);
  if (key[3] !== 'assets' || key.length !== 6 || !('pages' in data) || !Array.isArray(data.pages))
    return null;
  const ids = new Set<string>();
  for (const page of data.pages as unknown[]) {
    if (!page || typeof page !== 'object') continue;
    if ('assetIds' in page && Array.isArray(page.assetIds))
      for (const id of page.assetIds as unknown[]) if (typeof id === 'string') ids.add(id);
    if ('photoStacks' in page && Array.isArray(page.photoStacks))
      for (const stack of page.photoStacks as unknown[]) {
        if (
          stack &&
          typeof stack === 'object' &&
          'cover' in stack &&
          stack.cover &&
          typeof stack.cover === 'object' &&
          'id' in stack.cover &&
          typeof stack.cover.id === 'string'
        )
          ids.add(stack.cover.id);
      }
  }
  return ids;
}
