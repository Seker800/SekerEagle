import { usePhotoPeople } from './use-photo-people';
import { useQuery } from '@tanstack/react-query';
import { useLibraryWorkspace } from '../../lib/library-workspace';
import { getPhotoFacets } from '../../lib/photo-management-api';
import { t } from '../../i18n';
export function usePhotoFilterOptions(includePrivate: boolean, enabled = true) {
  const { ownerId, libraryMode } = useLibraryWorkspace();
  const facets = useQuery({
    queryKey: ['eagle', ownerId, 'PHOTO', 'photography-facets', includePrivate],
    queryFn: getPhotoFacets,
    enabled: enabled && libraryMode === 'PHOTO',
    staleTime: 30000,
  });
  const people = usePhotoPeople(ownerId, includePrivate, enabled && libraryMode === 'PHOTO');
  const options = (values: string[] = []) => values.map((value) => ({ value, label: value }));
  return {
    CAMERA_MODEL: options(facets.data?.cameras),
    LENS_MODEL: options(facets.data?.lenses),
    PERSON:
      people.data?.people.map((person, index) => ({
        value: person.id,
        label: person.name ?? t('未命名人物 {{value1}}', { value1: index + 1 }),
      })) ?? [],
  };
}
