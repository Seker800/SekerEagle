import { assetFactTime, canMergeEagleMedia, mergeEagleAssetFacts } from './eagle-asset-facts';
import type { EagleAssetListItem, EagleAssetPage, EagleAssetUpdate } from '../../lib/eagle-api';

export interface NormalizedEagleAssetPage extends Omit<EagleAssetPage, 'items'> {
  assetIds: string[];
}

export class EagleAssetEntityStore {
  readonly #entities = new Map<string, EagleAssetListItem>();
  readonly #metadataUpdatedAt = new Map<string, string>();
  readonly #mediaUpdatedAt = new Map<string, string>();
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
    let changed = false;
    for (const asset of assets) {
      const current = this.#entities.get(asset.id);
      if (!current) {
        this.#entities.set(asset.id, asset);
        this.#mediaUpdatedAt.set(asset.id, asset.updatedAt);
        this.#metadataUpdatedAt.set(asset.id, asset.updatedAt);
        changed = true;
        continue;
      }
      const merged = mergeEagleAssetFacts(
        current,
        asset,
        this.#metadataUpdatedAt.get(asset.id),
        this.#mediaUpdatedAt.get(asset.id),
      );
      if (!merged.metadataAccepted && !merged.mediaAccepted) continue;
      if (merged.metadataAccepted) this.#metadataUpdatedAt.set(asset.id, asset.updatedAt);
      if (merged.mediaAccepted) this.#mediaUpdatedAt.set(asset.id, asset.updatedAt);
      changed = true;
      this.#entities.set(asset.id, merged.asset);
    }
    if (changed) this.#emit();
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
      if (!current || !canMergeEagleMedia(current, update, this.#mediaUpdatedAt.get(update.id)))
        continue;
      this.#mediaUpdatedAt.set(update.id, update.updatedAt);
      this.#entities.set(update.id, {
        ...current,
        mediaRevision: update.mediaRevision,
        lifecycleStatus: update.lifecycleStatus,
        mediaErrorCode: update.mediaErrorCode,
        updatedAt:
          assetFactTime(update.updatedAt) > assetFactTime(current.updatedAt)
            ? update.updatedAt
            : current.updatedAt,
        ...(update.chronologicalAt ? { chronologicalAt: update.chronologicalAt } : {}),
        ...(update.photoLocation !== undefined ? { photoLocation: update.photoLocation } : {}),
        ...(update.photoMetadata !== undefined ? { photoMetadata: update.photoMetadata } : {}),
        renditions: update.renditions,
      });
      changed = true;
    }
    if (changed) this.#emit();
  }

  retainOnly(ids: ReadonlySet<string>) {
    let changed = false;
    for (const id of this.#entities.keys())
      if (!ids.has(id)) {
        this.#entities.delete(id);
        this.#mediaUpdatedAt.delete(id);
        this.#metadataUpdatedAt.delete(id);
        changed = true;
      }
    if (changed) this.#emit();
  }

  clear() {
    if (!this.#entities.size) return;
    this.#entities.clear();
    this.#mediaUpdatedAt.clear();
    this.#metadataUpdatedAt.clear();
    this.#emit();
  }

  #emit() {
    this.#version += 1;
    for (const listener of this.#listeners) listener();
  }
}
