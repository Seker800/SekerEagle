import type { QueryClient } from '@tanstack/react-query';
import type { LibraryMode } from '../../lib/library-api-scope';

/** Refresh published facts without clearing cached pages or cancelling an in-flight read. */
export class AssetOperationRefresher {
  private disposed = false;
  private readonly pending = new Set<LibraryMode>();
  private readonly refreshing = new Set<LibraryMode>();
  constructor(
    private readonly client: QueryClient,
    private readonly ownerId: string,
  ) {}
  schedule(mode: LibraryMode, _final: boolean) {
    if (this.disposed) return;
    this.pending.add(mode);
    // One poll can publish many results. Coalesce them, then serialize subsequent
    // publications behind the current read so a final completion cannot get lost.
    queueMicrotask(() => void this.refresh(mode));
  }
  private async refresh(mode: LibraryMode) {
    if (this.disposed || this.refreshing.has(mode) || !this.pending.delete(mode)) return;
    this.refreshing.add(mode);
    try {
      await this.client.invalidateQueries(
        {
          predicate: (query) =>
            query.queryKey[0] === 'eagle' &&
            query.queryKey[1] === this.ownerId &&
            query.queryKey[2] === mode &&
            query.queryKey[3] !== 'operations',
          refetchType: 'active',
        },
        { cancelRefetch: false },
      );
    } finally {
      this.refreshing.delete(mode);
      if (!this.disposed && this.pending.has(mode)) void this.refresh(mode);
    }
  }
  dispose() {
    this.disposed = true;
    this.pending.clear();
  }
}
