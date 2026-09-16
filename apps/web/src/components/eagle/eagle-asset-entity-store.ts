import type { EagleAssetListItem, EagleAssetPage, EagleAssetUpdate } from '../../lib/eagle-api';

export interface NormalizedEagleAssetPage extends Omit<EagleAssetPage, 'items'> {
  assetIds: string[];
}

export class EagleAssetEntityStore {
  readonly #entities = new Map<string, EagleAssetListItem>();
  readonly #listeners = new Set<() => void>();
  #version = 0;

  get size() {
    return this.#entities.size;
  }

  getSnapshot = () => this.#version;

  subscribe = (listener: () => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  get(id: string) {
    return this.#entities.get(id);
  }

  getMany(ids: readonly string[]) {
    return ids.flatMap((id) => {
      const entity = this.#entities.get(id);
      return entity ? [entity] : [];
    });
  }

  upsertMany(assets: readonly EagleAssetListItem[]) {
    if (!assets.length) return;
    for (const asset of assets) this.#entities.set(asset.id, asset);
    this.#emit();
  }

  normalizePage(page: EagleAssetPage): NormalizedEagleAssetPage {
    this.upsertMany(page.items);
    const { items, ...metadata } = page;
    return { ...metadata, assetIds: items.map(({ id }) => id) };
  }

  mergeProcessingUpdates(updates: readonly EagleAssetUpdate[]) {
    let changed = false;
    for (const update of updates) {
      const current = this.#entities.get(update.id);
      if (!current) continue;
      this.#entities.set(update.id, {
        ...current,
        lifecycleStatus: update.lifecycleStatus,
        mediaErrorCode: update.mediaErrorCode,
        updatedAt: update.updatedAt,
        renditions: update.renditions,
      });
      changed = true;
    }
    if (changed) this.#emit();
  }

  clear() {
    if (!this.#entities.size) return;
    this.#entities.clear();
    this.#emit();
  }

  #emit() {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }
}

interface OwnerStoreEntry {
  store: EagleAssetEntityStore;
  references: number;
}

const ownerStores = new Map<string, OwnerStoreEntry>();

export function getEagleAssetEntityStore(ownerId: string) {
  let entry = ownerStores.get(ownerId);
  if (!entry) {
    entry = { store: new EagleAssetEntityStore(), references: 0 };
    ownerStores.set(ownerId, entry);
  }
  return entry.store;
}

export function retainEagleAssetEntityStore(ownerId: string, store: EagleAssetEntityStore) {
  let entry = ownerStores.get(ownerId);
  if (!entry) {
    entry = { store, references: 0 };
    ownerStores.set(ownerId, entry);
  }
  if (entry.store !== store) throw new Error('Asset entity store instance mismatch.');
  entry.references += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    entry.references -= 1;
    if (entry.references > 0 || ownerStores.get(ownerId) !== entry) return;
    ownerStores.delete(ownerId);
    entry.store.clear();
  };
}
