import { publishWorkspaceCommandCompletion } from '../../lib/workspace-refresh';
import { getDesktopCacheBridge } from '../../lib/media-resolver';
import { createEagleApi } from '../../lib/eagle-api';
import { invalidateDesktopAssets } from '../../lib/desktop-cache';
import { assetOperationProtocol } from '@sekereagle/library-core';
import {
  createEagleQueryKeys,
  isEagleQuery,
  isEagleTaskCenterKey,
  isEagleAssetDetailKey,
  isPhotoPrivacyProjection,
  isEagleOperationKey,
  isEagleAssetListKey,
} from './eagle-query-keys';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type {
  AssetOperationReceipt,
  AssetOperationSummary,
  AssetMembershipFact,
} from '@sekereagle/library-core';
import type { LibraryMode } from '../../lib/library-api-scope';
import { createAssetOperationsApi } from '../../lib/asset-operations-api';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';
import type { NormalizedEagleAssetPage } from './eagle-asset-entity-store';

const PRIVACY_COMMAND_TYPES = new Set([
  'ASSET_TAGS',
  'ASSET_TAGS_REPLACE',
  'TAG_UPDATE',
  'TAG_DELETE',
  'TAG_GROUP_DELETE',
  'PRIVACY_SETTINGS',
  'VECTOR_REVIEW',
  'PHOTO_PERSON_PRIVACY',
  'PHOTO_PEOPLE_MERGE',
  'PHOTO_PEOPLE_MERGE_SELECTED',
  'PHOTO_PEOPLE_REVIEW',
  'PHOTO_FACE_REASSIGN',
]);

type AssetListView = 'ACTIVE' | 'PRIVATE' | 'TRASH';

const coordinators = new WeakMap<QueryClient, Map<string, AssetOperationRefresher>>();
export function getAssetOperationRefresher(client: QueryClient, ownerId: string) {
  let owners = coordinators.get(client);
  if (!owners) {
    owners = new Map();
    coordinators.set(client, owners);
  }
  let coordinator = owners.get(ownerId);
  if (!coordinator) {
    coordinator = new AssetOperationRefresher(client, ownerId);
    owners.set(ownerId, coordinator);
  }
  return coordinator;
}
/**
 * Apply receipts once; merge destination windows without replaying loaded pages.
 * Cancellation, retained retry intent and concurrent snapshots are specified in
 * docs/architecture-efficiency-review-followup-2026-11-01.md.
 */
export class AssetOperationRefresher {
  private disposed = false;
  private readonly reading = new Set<string>();
  private readonly dirtyMetadata = new Set<LibraryMode>();
  private readonly destinationViews = new Map<LibraryMode, Set<AssetListView>>();
  private flushing: Promise<void> | undefined;
  private readonly handled = new WeakMap<object, Map<string, string>>();
  constructor(
    private readonly client: QueryClient,
    private readonly ownerId: string,
  ) {}
  schedule(mode: LibraryMode, _final: boolean) {
    if (this.disposed) return;
    this.dirtyMetadata.add(mode);
    queueMicrotask(() => {
      void this.flush().catch(() => undefined);
    });
  }
  private async flush() {
    if (this.disposed || this.reading.size) return;
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      await Promise.resolve();
      while (this.dirtyMetadata.size && !this.reading.size && !this.disposed) {
        const modes = [...this.dirtyMetadata];
        this.dirtyMetadata.clear();
        for (const mode of modes) {
          await this.refreshMetadata(mode);
          const cache = getEagleWorkspaceCache(this.client, this.ownerId, mode);
          if (
            this.client
              .getQueryCache()
              .findAll({ queryKey: createEagleQueryKeys(this.ownerId, mode).libraryCounts })
              .some((query) => query.isActive())
          )
            cache.operations.confirmCounts();
          const views = this.destinationViews.get(mode);
          if (views) {
            // Detach this attempt so a newer terminal can enqueue the same view.
            this.destinationViews.delete(mode);
            const destinations = [...views];
            const predicate = (query: { queryKey: readonly unknown[] }) =>
              destinations.some((view) =>
                isEagleAssetListKey(query.queryKey, this.ownerId, mode, view),
              );
            // An older infinite refetch must not overwrite the controlled merge.
            // Cancel before invalidating because cancellation restores the prior state.
            await this.client.cancelQueries({ predicate });
            await this.client.invalidateQueries({ predicate, refetchType: 'none' });
            const failed = await this.refreshFirstPages(mode, destinations);
            if (failed.size) this.addDestination(mode, [...failed]);
          }
        }
      }
    })();
    try {
      await this.flushing;
    } finally {
      this.flushing = undefined;
    }
  }
  private async refreshMetadata(mode: LibraryMode) {
    await this.client.invalidateQueries(
      {
        predicate: (query) =>
          (isEagleQuery(query.queryKey, this.ownerId, mode) ||
            isEagleTaskCenterKey(query.queryKey, this.ownerId, mode)) &&
          !isEagleOperationKey(query.queryKey, this.ownerId, mode) &&
          !(
            isEagleAssetListKey(query.queryKey, this.ownerId, mode) &&
            query.state.data &&
            typeof query.state.data === 'object' &&
            'pages' in query.state.data
          ),
        refetchType: 'active',
      },
      { cancelRefetch: false },
    );
  }
  async reconcile(mode: LibraryMode, summary: AssetOperationSummary) {
    if (this.disposed || summary.running || summary.queued) return;
    const cache = getEagleWorkspaceCache(this.client, this.ownerId, mode);
    const readRevision = cache.operations.getSnapshot();
    const changes = cache.operations,
      epoch = changes.epoch;
    const intentVersion =
      changes.entries.find((entry) => entry.id === summary.id)?.intentVersion ?? 0;
    let done = this.handled.get(changes);
    if (!done) {
      done = new Map();
      this.handled.set(changes, done);
    }
    const signature = JSON.stringify(summary);
    const key = `${mode}:${summary.id}`;
    if (this.reading.has(key)) return;
    if (done.get(summary.id) === `${epoch}:${intentVersion}:${signature}`) {
      // A terminal receipt remains applied even if its destination read failed.
      // Retry only on a later status/schedule event, never in the same flush loop.
      for (const pendingMode of this.destinationViews.keys()) this.dirtyMetadata.add(pendingMode);
      await this.flush().catch(() => undefined);
      return;
    }
    this.reading.add(key);
    try {
      if (summary.kind === 'DUPLICATE_SCAN' && summary.total > 0) {
        // Scanning changes only its result projection, never asset membership.
        // The authenticated terminal summary is sufficient; no per-asset receipt replay.
        changes.finish(summary.id, summary.kind, [], summary, [], readRevision);
        done.set(summary.id, `${epoch}:${intentVersion}:${signature}`);
        await this.client.invalidateQueries(
          { queryKey: createEagleQueryKeys(this.ownerId, mode).duplicates },
          { cancelRefetch: false },
        );
        return;
      }
      const api = createAssetOperationsApi(mode);
      const receipts: AssetOperationReceipt[] = [];
      const membership = new Map<string, AssetMembershipFact>();
      let cursor: number | undefined,
        revision: string | undefined,
        actual = summary;
      do {
        const result = await api.results(summary.id, { cursor, revision });
        if (
          this.disposed ||
          changes.epoch !== epoch ||
          (changes.entries.find((entry) => entry.id === summary.id)?.intentVersion ?? 0) !==
            intentVersion ||
          result.operation.running ||
          result.operation.queued
        )
          return;
        actual = result.operation;
        receipts.push(...result.receipts);
        result.membership.forEach((fact) => membership.set(fact.id, fact));
        revision = result.revision;
        cursor = result.nextCursor ?? undefined;
      } while (cursor !== undefined);
      if (actual.kind === 'METADATA_COMMAND' || actual.kind === 'BACKGROUND_COMMAND') {
        const privacyChanged =
          !!actual.commandType && PRIVACY_COMMAND_TYPES.has(actual.commandType);
        if (privacyChanged && mode === 'PHOTO') await this.clearPhotoPrivacyProjections(epoch);

        if (actual.commandType !== 'DUPLICATE_IGNORE') await this.refreshLoadedFacts(mode, epoch);
        if (
          mode === 'PHOTO' &&
          (actual.commandType?.startsWith('PHOTO_GROUP') ||
            actual.commandType === 'BATCH_EDIT_RENDER')
        )
          await this.refreshPhotoStacks(mode, epoch, actual.commandType === 'BATCH_EDIT_RENDER');
        if (privacyChanged) await getDesktopCacheBridge()?.clearCache();
        if (changes.epoch !== epoch || this.disposed) return;
      }
      changes.finish(
        actual.id,
        actual.kind,
        receipts,
        actual,
        [...membership.values()],
        readRevision,
      );
      done.set(actual.id, `${epoch}:${intentVersion}:${JSON.stringify(actual)}`);
      if (actual.kind === 'EMPTY_TRASH') {
        // A cutoff command has no member receipts. Reconcile the scoped trash facts,
        // including items that arrived after the cutoff, while retaining loaded pages.
        await this.client.invalidateQueries(
          {
            predicate: (query) => isEagleAssetListKey(query.queryKey, this.ownerId, mode, 'TRASH'),
            refetchType: 'active',
          },
          { cancelRefetch: false },
        );
      }
      if (actual.commandType)
        publishWorkspaceCommandCompletion(this.client, this.ownerId, mode, actual.commandType);
      this.dirtyMetadata.add(mode);
      const membershipChange = assetOperationProtocol(actual.kind)?.membership;
      if (actual.completed > 0 && membershipChange === 'TRASH')
        this.addDestination(mode, ['TRASH']);
      if (actual.completed > 0 && membershipChange === 'ACTIVE')
        this.addDestination(mode, ['ACTIVE', 'PRIVATE']);
      if (actual.commandType === 'BATCH_EDIT_RENDER' && actual.completed > 0)
        this.addDestination(mode, ['ACTIVE', 'PRIVATE']);
      if (actual.kind === 'SEND') {
        const target = mode === 'PHOTO' ? 'MATERIAL' : 'PHOTO';
        this.dirtyMetadata.add(target);
        if (actual.completed > 0) this.addDestination(target, ['ACTIVE', 'PRIVATE']);
      }
    } catch (error) {
      // Retain the intent and retry on the next status response. A lost response
      // never means that an accepted deletion should be rolled back wholesale.
      if (changes.epoch === epoch)
        changes.uncertain(summary.id, error instanceof Error ? error.message : String(error));
    } finally {
      this.reading.delete(key);
      await this.flush().catch(() => undefined);
    }
  }
  private async clearPhotoPrivacyProjections(epoch: number) {
    const cache = getEagleWorkspaceCache(this.client, this.ownerId, 'PHOTO');
    const queries = this.client
      .getQueryCache()
      .findAll({ predicate: (query) => isPhotoPrivacyProjection(query.queryKey, this.ownerId) });
    await this.client.cancelQueries({
      predicate: (query) => isPhotoPrivacyProjection(query.queryKey, this.ownerId),
    });
    if (this.disposed || cache.operations.epoch !== epoch) return;
    for (const query of queries) {
      if (this.client.getQueryCache().get(query.queryHash) !== query) continue;
      // A denied or offline refetch must not retain a previously visible face,
      // task photo, location or statistic. Keep the scoped observer to refetch.
      this.client.setQueryData(query.queryKey, null);
    }
  }
  private async refreshPhotoStacks(
    mode: LibraryMode,
    epoch: number,
    existingCollectionsOnly = false,
  ) {
    const cache = getEagleWorkspaceCache(this.client, this.ownerId, mode);
    const queries = this.client.getQueryCache().findAll({
      predicate: (query) =>
        query.isActive() &&
        isEagleAssetListKey(query.queryKey, this.ownerId, mode) &&
        !isEagleAssetListKey(query.queryKey, this.ownerId, mode, 'TRASH'),
    });
    for (const query of queries) {
      const data = query.state.data as InfiniteData<NormalizedEagleAssetPage, string> | undefined;
      const fn = query.options.queryFn;
      if (!data?.pages.length || typeof fn !== 'function') continue;
      for (let index = 0; index < data.pages.length; index++) {
        if (existingCollectionsOnly && !data.pages[index].photoStacks?.length) continue;
        const fresh = await this.client.fetchQuery<NormalizedEagleAssetPage>({
          queryKey: [...query.queryKey, 'operation-stack-page', data.pageParams[index]],
          gcTime: 0,
          staleTime: 0,
          retry: 2,
          queryFn: async ({ signal }) =>
            (await fn({
              client: this.client,
              queryKey: query.queryKey,
              signal,
              pageParam: data.pageParams[index],
              direction: 'forward',
              meta: query.meta,
            })) as NormalizedEagleAssetPage,
        });
        if (
          this.disposed ||
          cache.operations.epoch !== epoch ||
          this.client.getQueryCache().get(query.queryHash) !== query
        )
          return;
        // Only the collection projection changes. Loaded identity windows, page
        // count and cursor history remain owned by the browse session.
        this.client.setQueryData<InfiniteData<NormalizedEagleAssetPage, string>>(
          query.queryKey,
          (current) => {
            if (!current || current.pageParams[index] !== data.pageParams[index]) return current;
            return {
              ...current,
              pages: current.pages.map((page, pageIndex) =>
                pageIndex === index ? { ...page, photoStacks: fresh.photoStacks ?? [] } : page,
              ),
            };
          },
        );
      }
    }
  }
  private async refreshLoadedFacts(mode: LibraryMode, epoch: number) {
    const cache = getEagleWorkspaceCache(this.client, this.ownerId, mode);
    const queries = this.client.getQueryCache().findAll({
      predicate: (query) =>
        isEagleAssetListKey(query.queryKey, this.ownerId, mode) &&
        !isEagleAssetListKey(query.queryKey, this.ownerId, mode, 'TRASH'),
    });
    const details = this.client
      .getQueryCache()
      .findAll({ predicate: (query) => isEagleAssetDetailKey(query.queryKey, this.ownerId, mode) });
    const ids = [
      ...new Set([
        ...queries.flatMap((query) => {
          const data = query.state.data as InfiniteData<NormalizedEagleAssetPage> | undefined;
          return (
            data?.pages.flatMap((page) => [
              ...page.assetIds,
              ...(page.photoStacks?.flatMap((stack) => stack.assetIds) ?? []),
            ]) ?? []
          );
        }),
        ...details.flatMap((query) => {
          const data = query.state.data as { id?: string } | undefined;
          return data?.id ? [data.id] : [];
        }),
      ]),
    ];
    const api = createEagleApi(mode);
    // Bound response memory by page-sized transport batches; the user selection
    // remains one durable command, with no manual splitting or pagination reset.
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      const facts = await api.listEagleAssetFacts('', batch);
      if (this.disposed || cache.operations.epoch !== epoch) return;
      cache.store.upsertMany(facts);
      const visible = new Set(facts.map((asset) => asset.id));
      const missing = new Set(batch.filter((id) => !visible.has(id)));
      if (missing.size) {
        cache.store.removeMany(missing);
        cache.thumbnails.dispose();
        const unavailableDetails = details.filter((query) => {
          const data = query.state.data as { id?: string } | undefined;
          return data?.id && missing.has(data.id);
        });
        for (const query of unavailableDetails) {
          await this.client.cancelQueries({ queryKey: query.queryKey, exact: true });
          // Clear active observers before cache removal, so React cannot retain
          // private detail data in an orphaned QueryObserver result.
          this.client.setQueryData(query.queryKey, null);
          this.client.removeQueries({ queryKey: query.queryKey, exact: true });
        }
        for (const query of queries)
          this.client.setQueryData<InfiniteData<NormalizedEagleAssetPage>>(
            query.queryKey,
            (data) =>
              data
                ? {
                    ...data,
                    pages: data.pages.map((page) => ({
                      ...page,
                      assetIds: page.assetIds.filter((id) => !missing.has(id)),
                      photoStacks: page.photoStacks?.filter(
                        (stack) => !stack.assetIds.some((id) => missing.has(id)),
                      ),
                    })),
                  }
                : data,
          );
      }
      await invalidateDesktopAssets(batch);
    }
  }
  private addDestination(mode: LibraryMode, views: readonly AssetListView[]) {
    const destinations = this.destinationViews.get(mode) ?? new Set<AssetListView>();
    for (const view of views) destinations.add(view);
    this.destinationViews.set(mode, destinations);
  }
  private async refreshFirstPages(mode: LibraryMode, views: readonly AssetListView[]) {
    const queries = this.client.getQueryCache().findAll({
      predicate: (query) =>
        query.isActive() &&
        views.some((view) => isEagleAssetListKey(query.queryKey, this.ownerId, mode, view)),
    });
    const failed = new Set<AssetListView>();
    for (const query of queries) {
      const data = query.state.data as InfiniteData<NormalizedEagleAssetPage, string> | undefined;
      const fn = query.options.queryFn;
      if (!data?.pages.length || typeof fn !== 'function') continue;
      const cache = getEagleWorkspaceCache(this.client, this.ownerId, mode);
      const epoch = cache.operations.epoch;
      let page: NormalizedEagleAssetPage;
      try {
        page = await this.client.fetchQuery<NormalizedEagleAssetPage>({
          queryKey: [...query.queryKey, 'operation-first-page'],
          gcTime: 0,
          staleTime: 0,
          retry: 2,
          queryFn: async ({ signal }) =>
            (await fn({
              client: this.client,
              queryKey: query.queryKey,
              signal,
              pageParam: data.pageParams[0],
              direction: 'forward',
              meta: query.meta,
            })) as NormalizedEagleAssetPage,
        });
      } catch {
        for (const view of views)
          if (isEagleAssetListKey(query.queryKey, this.ownerId, mode, view)) failed.add(view);
        continue;
      }
      if (
        cache.operations.epoch !== epoch ||
        this.client.getQueryCache().get(query.queryHash) !== query
      )
        continue;
      this.client.setQueryData<InfiniteData<NormalizedEagleAssetPage, string>>(
        query.queryKey,
        (current) => {
          if (!current?.pages.length) return current;
          const first = current.pages[0];
          const ids = new Set(page.assetIds);
          return {
            ...current,
            pages: [
              {
                ...first,
                assetIds: [...page.assetIds, ...first.assetIds.filter((id) => !ids.has(id))],
                photoStacks: [
                  ...new Map(
                    [...(first.photoStacks ?? []), ...(page.photoStacks ?? [])].map((stack) => [
                      stack.id,
                      stack,
                    ]),
                  ).values(),
                ],
              },
              ...current.pages.slice(1),
            ],
          };
        },
      );
    }
    return failed;
  }
  dispose() {
    this.disposed = true;
  }
}
