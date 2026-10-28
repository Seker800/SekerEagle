import type { InfiniteData, Query, QueryClient } from '@tanstack/react-query';
import type { LibraryMode } from '../../lib/library-api-scope';

const REFRESH_INTERVAL_MS = 4000;
interface PendingRefresh {
  final: boolean;
}
/** Coalesce publication updates without restarting a slow list fetch or replaying every cached page. */
export class AssetOperationRefresher {
  private readonly pending = new Map<LibraryMode, PendingRefresh>();
  private readonly running = new Set<LibraryMode>();
  private readonly lastStarted = new Map<LibraryMode, number>();
  private readonly timers = new Map<LibraryMode, ReturnType<typeof setTimeout>>();
  private disposed = false;
  constructor(
    private readonly client: QueryClient,
    private readonly ownerId: string,
  ) {}
  schedule(mode: LibraryMode, final: boolean) {
    if (this.disposed) return;
    this.pending.set(mode, { final: final || !!this.pending.get(mode)?.final });
    this.pump(mode);
  }
  dispose() {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }
  private pump(mode: LibraryMode) {
    const pending = this.pending.get(mode);
    if (this.disposed || this.running.has(mode) || !pending) return;
    const existing = this.timers.get(mode);
    if (existing) clearTimeout(existing);
    this.timers.delete(mode);
    const last = this.lastStarted.get(mode);
    const delay =
      pending.final || last === undefined
        ? 0
        : Math.max(0, last + REFRESH_INTERVAL_MS - Date.now());
    if (delay) {
      this.timers.set(
        mode,
        setTimeout(() => {
          this.timers.delete(mode);
          this.pump(mode);
        }, delay),
      );
      return;
    }
    this.pending.delete(mode);
    this.running.add(mode);
    this.lastStarted.set(mode, Date.now());
    void this.refresh(mode, pending.final)
      .catch(() => {
        // Query errors remain in QueryClient and its ordinary retry/UI flow.
      })
      .finally(() => {
        this.running.delete(mode);
        this.pump(mode);
      });
  }
  private async refresh(mode: LibraryMode, final: boolean) {
    const scoped = (query: Query) =>
      query.queryKey[0] === 'eagle' &&
      query.queryKey[1] === this.ownerId &&
      query.queryKey[2] === mode &&
      query.queryKey[3] !== 'operations';
    const list = (query: Query) =>
      scoped(query) &&
      query.queryKey[3] === 'assets' &&
      typeof query.queryKey[4] === 'string' &&
      query.queryKey.length === 6;
    const lists = this.client.getQueryCache().findAll({ predicate: list });
    // A previous refetch/fetchNextPage must settle before its cached cursor chain
    // is shortened; repeatedly cancelling here would starve slow connections.
    await Promise.all(
      lists.flatMap((query) => (query.promise ? [query.promise.catch(() => undefined)] : [])),
    );
    if (this.disposed) return;
    for (const query of lists) {
      if (this.client.getQueryCache().get(query.queryHash) !== query) continue;
      this.client.setQueryData<InfiniteData<unknown>>(query.queryKey, (old) =>
        old && old.pages.length > 1
          ? { ...old, pages: old.pages.slice(0, 1), pageParams: old.pageParams.slice(0, 1) }
          : old,
      );
    }
    const affected = (query: Query) =>
      scoped(query) &&
      (final ||
        list(query) ||
        (query.queryKey[3] === 'assets' && query.queryKey[4] === 'library-count'));
    await this.client.invalidateQueries({ predicate: affected, refetchType: 'none' });
    if (this.disposed) return;
    await this.client.refetchQueries(
      { predicate: affected, type: 'active' },
      { cancelRefetch: false },
    );
  }
}
