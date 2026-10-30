import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { getPhotoFacets, listPhotoPeopleOptions } from '../../lib/photo-management-api';
import { t } from '../../i18n';
export function usePhotoFilterOptions(includePrivate: boolean, enabled = true) {
  const { ownerId, libraryMode } = useLibraryWorkspace();
  const facets = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'photography-facets', includePrivate],
    queryFn: getPhotoFacets,
    enabled: enabled && libraryMode === 'PHOTO',
    staleTime: 30000,
  });
  const people = useInfiniteQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'people', 'options', includePrivate],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => listPhotoPeopleOptions(pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && libraryMode === 'PHOTO',
    staleTime: 30000,
  });
  const options = (values: string[] = []) => values.map((value) => ({ value, label: value }));
  return {
    people,
    fieldOptions: {
      CAMERA_MODEL: options(facets.data?.cameras),
      LENS_MODEL: options(facets.data?.lenses),
      PERSON:
        people.data?.pages
          .flatMap((page) => page.people)
          .map((person, index) => ({
            value: person.id,
            label: person.name ?? t('未命名分组 {{value1}}', { value1: index + 1 }),
          })) ?? [],
    },
  };
}
