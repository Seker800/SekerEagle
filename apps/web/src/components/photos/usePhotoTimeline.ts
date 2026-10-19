import { useQuery } from '@tanstack/react-query';
import { getPhotoTimeline } from '../../lib/photo-management-api';
export function usePhotoTimeline(
  enabled: boolean,
  scope: readonly unknown[],
  privateVisible: boolean,
  privacyRevision: number,
) {
  return useQuery({
    queryKey: [...scope, 'timeline', privateVisible, privacyRevision],
    queryFn: ({ signal }) => getPhotoTimeline(signal),
    enabled,
    staleTime: 30_000,
  });
}
