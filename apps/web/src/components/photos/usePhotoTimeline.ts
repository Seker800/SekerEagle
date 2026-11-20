import { useQuery } from '@tanstack/react-query';
import type { EagleAssetSort } from '../../lib/eagle-api';
import { getPhotoTimeline } from '../../lib/photo-management-api';
export function usePhotoTimeline(
  enabled: boolean,
  scope: readonly unknown[],
  privateVisible: boolean,
  privacyRevision: number,
  sort: EagleAssetSort,
) {
  return useQuery({
    queryKey: [...scope, 'timeline', privateVisible, privacyRevision, sort],
    queryFn: ({ signal }) => getPhotoTimeline(sort, signal),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
  });
}
