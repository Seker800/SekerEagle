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
    this.upsertMany([...page.items, ...(page.photoStacks?.map(({ cover }) => cover) ?? [])]);
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
        mediaRevision: update.mediaRevision,
        lifecycleStatus: update.lifecycleStatus,
        mediaErrorCode: update.mediaErrorCode,
        updatedAt: update.updatedAt,
        ...(update.chronologicalAt ? { chronologicalAt: update.chronologicalAt } : {}),
        ...(update.photoLocation !== undefined ? { photoLocation: update.photoLocation } : {}),
        ...(update.photoMetadata !== undefined ? { photoMetadata: update.photoMetadata } : {}),
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
