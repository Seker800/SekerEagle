import type { QueryClient } from '@tanstack/react-query';
import type { LibraryMode } from '../../lib/library-api-scope';
import { getEagleWorkspaceCache } from './eagle-workspace-cache';

/** Publication marks data stale; it never rewrites pages or starts a foreground list fetch. */
export class AssetOperationRefresher {
  private disposed = false;
  constructor(
    private readonly client: QueryClient,
    private readonly ownerId: string,
  ) {}
  schedule(mode: LibraryMode, _final: boolean) {
    if (this.disposed) return;
    const cache = getEagleWorkspaceCache(this.client, this.ownerId, mode);
    const alreadyPending = cache.hasBackgroundChanges();
    cache.markBackgroundChanges();
    if (alreadyPending) return;
    void this.client.invalidateQueries({
      predicate: (query) =>
        query.queryKey[0] === 'eagle' &&
        query.queryKey[1] === this.ownerId &&
        query.queryKey[2] === mode &&
        query.queryKey[3] !== 'operations',
      refetchType: 'none',
    });
  }
  dispose() {
    this.disposed = true;
  }
}
