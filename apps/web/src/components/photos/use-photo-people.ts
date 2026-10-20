import { useInfiniteQuery } from '@tanstack/react-query';
import { listPhotoPeople } from '../../lib/photo-management-api';

export function usePhotoPeople(ownerId: string | null, includePrivate: boolean, enabled = true) {
  const query = useInfiniteQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'people', includePrivate],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => listPhotoPeople(pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    refetchInterval: 10000,
  });
  return { ...query, data: query.data ? {
    runtimeConfigured: query.data.pages[0]?.runtimeConfigured,
    people: [...new Map(query.data.pages.flatMap(page => page.people).map(person => [person.id, person])).values()],
  } : undefined };
}
