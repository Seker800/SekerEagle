import type { EagleAssetListItem, EagleAssetPage, EagleAssetUpdate } from '../../lib/eagle-api';

export interface NormalizedEagleAssetPage extends Omit<EagleAssetPage, 'items'> {
  assetIds: string[];
}

// Metadata rowVersion and mediaRevision are independent clocks. Processing writes
// within one media version use updatedAt; equal-time facts cannot regress READY.
const time = (value: string) => Date.parse(value) || 0;
const statusRank = (value: string) => (value === 'READY' ? 2 : value === 'FAILED' ? 1 : 0);
function newerMedia(
  current: EagleAssetListItem,
  incoming: EagleAssetListItem | EagleAssetUpdate,
  mediaUpdatedAt = current.updatedAt,
) {
  if (incoming.mediaRevision !== current.mediaRevision)
    return incoming.mediaRevision > current.mediaRevision;
  if (time(incoming.updatedAt) !== time(mediaUpdatedAt))
    return time(incoming.updatedAt) > time(mediaUpdatedAt);
  if (statusRank(incoming.lifecycleStatus) !== statusRank(current.lifecycleStatus))
    return statusRank(incoming.lifecycleStatus) > statusRank(current.lifecycleStatus);
  return (
    current.renditions.every((r) => incoming.renditions.some((next) => next.id === r.id)) &&
    incoming.renditions.length > current.renditions.length
  );
}
const mediaFacts = (asset: EagleAssetListItem) => ({
  originalName: asset.originalName,
  mimeType: asset.mimeType,
  format: asset.format,
  byteSize: asset.byteSize,
  width: asset.width,
  height: asset.height,
  durationMs: asset.durationMs,
  lifecycleStatus: asset.lifecycleStatus,
  mediaErrorCode: asset.mediaErrorCode,
  mediaRevision: asset.mediaRevision,
  renditions: asset.renditions,
  photoMetadata: asset.photoMetadata,
  photoLocation: asset.photoLocation,
  chronologicalAt: asset.chronologicalAt,
  livePhotoMotion: asset.livePhotoMotion,
});
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
      const metadata =
        asset.rowVersion > current.rowVersion ||
        (asset.rowVersion === current.rowVersion &&
          time(asset.updatedAt) >= time(this.#metadataUpdatedAt.get(asset.id) ?? current.updatedAt))
          ? asset
          : current;
      if (metadata === asset) this.#metadataUpdatedAt.set(asset.id, asset.updatedAt);
      const media = newerMedia(current, asset, this.#mediaUpdatedAt.get(asset.id))
        ? asset
        : current;
      if (media === asset) this.#mediaUpdatedAt.set(asset.id, asset.updatedAt);
      if (metadata === current && media === current) continue;
      changed = true;
      this.#entities.set(asset.id, {
        ...metadata,
        ...mediaFacts(media),
        updatedAt:
          time(asset.updatedAt) > time(current.updatedAt) && (metadata === asset || media === asset)
            ? asset.updatedAt
            : current.updatedAt,
      });
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
      if (!current || !newerMedia(current, update, this.#mediaUpdatedAt.get(update.id))) continue;
      this.#mediaUpdatedAt.set(update.id, update.updatedAt);
      this.#entities.set(update.id, {
        ...current,
        mediaRevision: update.mediaRevision,
        lifecycleStatus: update.lifecycleStatus,
        mediaErrorCode: update.mediaErrorCode,
        updatedAt:
          time(update.updatedAt) > time(current.updatedAt) ? update.updatedAt : current.updatedAt,
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
