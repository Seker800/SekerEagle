import { useInfiniteQuery } from '@tanstack/react-query';
import { listPhotoPeople } from '../../lib/photo-management-api';

export function usePhotoPeople(
  ownerId: string | null,
  includePrivate: boolean,
  enabled = true,
  poll = false,
  view: 'ALL' | 'NAMED' | 'UNNAMED' = 'ALL',
) {
  const query = useInfiniteQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'people', includePrivate, view, 'cards'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => listPhotoPeople(pageParam, signal, view),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    staleTime: 30000,
    refetchInterval: (query) => (poll && query.state.data?.pages.length === 1 ? 30000 : false),
  });
  return {
    ...query,
    data: query.data
      ? {
          runtimeConfigured: query.data.pages[0]?.runtimeConfigured,
          people: [
            ...new Map(
              query.data.pages.flatMap((page) => page.people).map((person) => [person.id, person]),
            ).values(),
          ].sort((a, b) =>
            view === 'UNNAMED'
              ? (b.photoCount ?? 0) - (a.photoCount ?? 0) || a.id.localeCompare(b.id)
              : 0,
          ),
        }
      : undefined,
  };
}
