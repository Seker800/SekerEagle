import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { PhotoPerson, PhotoPersonMergeResult } from '../../lib/photo-management-api';

/** Project a known atomic merge without replaying directory or review pages. */
export function applyPhotoPersonMerge(
  client: QueryClient,
  ownerId: string | null,
  result: PhotoPersonMergeResult,
) {
  const removed = new Set(result.mergedIds);
  for (const query of client.getQueryCache().findAll({
    predicate: (query) =>
      query.queryKey[0] === 'eagle' &&
      query.queryKey[1] === ownerId &&
      query.queryKey[2] === 'PHOTO' &&
      (query.queryKey[3] === 'people' || query.queryKey[3] === 'people-merge-targets'),
  })) {
    const hiddenTarget = result.marksAssetsPrivate && query.queryKey[4] === false;
    client.setQueryData<InfiniteData<{ people: PhotoPerson[] }>>(query.queryKey, (current) =>
      current
        ? {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              people: page.people
                .filter((p) => !removed.has(p.id) && !(hiddenTarget && p.id === result.id))
                .map((p) => (p.id === result.id ? { ...p, ...result } : p)),
            })),
          }
        : current,
    );
  }
  for (const query of client
    .getQueryCache()
    .findAll({ queryKey: ['eagle', ownerId, 'PHOTO', 'person-review'] })) {
    if (!query.state.data || typeof query.state.data !== 'object' || !('pages' in query.state.data))
      continue;
    const hiddenTarget = result.marksAssetsPrivate && query.queryKey[4] === false;
    client.setQueryData<{ removed: string[]; updates: Record<string, Partial<PhotoPerson>> }>(
      [...query.queryKey, 'edits'],
      (old) => ({
        removed: [
          ...new Set([...(old?.removed ?? []), ...removed, ...(hiddenTarget ? [result.id] : [])]),
        ],
        updates: { ...old?.updates, ...(!hiddenTarget ? { [result.id]: result } : {}) },
      }),
    );
  }
  void client.invalidateQueries({
    queryKey: ['eagle', ownerId, 'PHOTO', 'people-merge-targets'],
    refetchType: 'none',
  });
}
