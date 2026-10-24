import type { PhotoMapCluster } from '../../lib/photo-management-api';

export function photoMapPosition(cluster: PhotoMapCluster): [number, number] {
  const hasPhotoPosition =
    Number.isFinite(cluster.photoLatitude) && Number.isFinite(cluster.photoLongitude);
  return [
    Math.max(-85, Math.min(85, hasPhotoPosition ? cluster.photoLatitude! : cluster.latitude)),
    hasPhotoPosition ? cluster.photoLongitude! : cluster.longitude,
  ];
}
export interface PhotoMapMarkerPlan {
  key: string;
  cluster: PhotoMapCluster;
  presentation: 'photo' | 'dot';
}
/** Preserve real anchors and all dots; feature up to nine highest-volume covered locations. */
export function layoutPhotoMapMarkers(clusters: readonly PhotoMapCluster[]): PhotoMapMarkerPlan[] {
  let featured = 0;
  return [...clusters]
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .map((cluster) => ({
      key: cluster.id,
      cluster,
      presentation: cluster.cover && featured++ < 9 ? 'photo' : 'dot',
    }));
}
