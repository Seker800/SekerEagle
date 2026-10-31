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
/** Read terminal receipts once and project membership; list pages are never re-fetched for deletion. */
export class AssetOperationRefresher {
  private disposed = false;
  private readonly reading = new Set<string>();
  private readonly dirtyMetadata = new Set<LibraryMode>();
  private readonly restoreModes = new Set<LibraryMode>();
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
              .findAll({ queryKey: ['eagle', this.ownerId, mode, 'assets', 'library-count'] })
              .some((query) => query.isActive())
          )
            cache.operations.confirmCounts();
          if (this.restoreModes.delete(mode)) await this.refreshFirstPages(mode);
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
          query.queryKey[0] === 'eagle' &&
          query.queryKey[1] === this.ownerId &&
          query.queryKey[2] === mode &&
          query.queryKey[3] !== 'operations' &&
          !(
            query.queryKey[3] === 'assets' &&
            query.queryKey.length === 6 &&
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
    if (this.reading.has(key) || done.get(summary.id) === `${epoch}:${intentVersion}:${signature}`)
      return;
    this.reading.add(key);
    try {
      if (summary.kind === 'DUPLICATE_SCAN' && summary.total > 0) {
        // Scanning changes only its result projection, never asset membership.
        // The authenticated terminal summary is sufficient; no per-asset receipt replay.
        changes.finish(summary.id, summary.kind, [], summary, [], readRevision);
        done.set(summary.id, `${epoch}:${intentVersion}:${signature}`);
        await this.client.invalidateQueries(
          { queryKey: ['eagle', this.ownerId, mode, 'duplicates'] },
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
      changes.finish(
        actual.id,
        actual.kind,
        receipts,
        actual,
        [...membership.values()],
        readRevision,
      );
      done.set(actual.id, `${epoch}:${intentVersion}:${JSON.stringify(actual)}`);
      this.dirtyMetadata.add(mode);
      if (actual.kind === 'RESTORE') this.restoreModes.add(mode);
      if (actual.kind === 'SEND') {
        const target = mode === 'PHOTO' ? 'MATERIAL' : 'PHOTO';
        this.dirtyMetadata.add(target);
        this.restoreModes.add(target);
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
  private async refreshFirstPages(mode: LibraryMode) {
    const queries = this.client.getQueryCache().findAll({
      predicate: (query) =>
        query.isActive() &&
        query.queryKey[0] === 'eagle' &&
        query.queryKey[1] === this.ownerId &&
        query.queryKey[2] === mode &&
        query.queryKey[3] === 'assets' &&
        query.queryKey.length === 6 &&
        query.queryKey[4] !== 'TRASH',
    });
    for (const query of queries) {
      const data = query.state.data as InfiniteData<NormalizedEagleAssetPage, string> | undefined;
      const fn = query.options.queryFn;
      if (!data?.pages.length || typeof fn !== 'function') continue;
      const cache = getEagleWorkspaceCache(this.client, this.ownerId, mode);
      const epoch = cache.operations.epoch;
      const page = await this.client.fetchQuery<NormalizedEagleAssetPage>({
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
  }
  dispose() {
    this.disposed = true;
  }
}
