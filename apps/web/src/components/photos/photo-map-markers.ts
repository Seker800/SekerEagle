import type { PhotoMapCluster } from '../../lib/photo-management-api';

export function photoMapPosition(cluster: PhotoMapCluster): [number, number] {
  const hasPhotoPosition =
    Number.isFinite(cluster.photoLatitude) && Number.isFinite(cluster.photoLongitude);
  return [
    Math.max(-85, Math.min(85, hasPhotoPosition ? cluster.photoLatitude! : cluster.latitude)),
    hasPhotoPosition ? cluster.photoLongitude! : cluster.longitude,
  ];
}
export interface PhotoMapMarkerGroup {
  key: string;
  representative: PhotoMapCluster;
  members: PhotoMapCluster[];
  count: number;
}
/** Presentation clustering keeps every server cell and count; selecting a merged marker zooms in. */
export function groupPhotoMapMarkers(
  clusters: readonly PhotoMapCluster[],
  project: (position: [number, number]) => { x: number; y: number },
  zoom: number,
): PhotoMapMarkerGroup[] {
  const groups: Array<PhotoMapMarkerGroup & { x: number; y: number }> = [];
  for (const cluster of [...clusters].sort(
    (a, b) => b.count - a.count || a.id.localeCompare(b.id),
  )) {
    const point = project(photoMapPosition(cluster));
    const nearby =
      zoom < 16
        ? groups.find(
            (group) => Math.abs(group.x - point.x) < 42 && Math.abs(group.y - point.y) < 48,
          )
        : undefined;
    if (nearby) {
      nearby.members.push(cluster);
      nearby.count += cluster.count;
      nearby.key += '|' + cluster.id;
    } else
      groups.push({
        key: cluster.id,
        representative: cluster,
        members: [cluster],
        count: cluster.count,
        ...point,
      });
  }
  return groups;
}
