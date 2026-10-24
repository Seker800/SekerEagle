import { describe, it, expect } from 'vitest';
import { groupPhotoMapMarkers, photoMapPosition } from './photo-map-markers';
import type { PhotoMapCluster } from '../../lib/photo-management-api';
const cluster = (id: string, longitude: number, count = 1): PhotoMapCluster => ({
  id,
  latitude: 30,
  longitude: 120,
  photoLatitude: 37.5,
  photoLongitude: longitude,
  count,
});
const project = ([latitude, longitude]: [number, number]) => ({
  x: longitude * 100,
  y: latitude * 100,
});
describe('photo markers anchored to actual photo distribution', () => {
  it('uses the photo concentration instead of snapping to a grid center', () => {
    expect(photoMapPosition(cluster('a', 122.1))).toEqual([37.5, 122.1]);
    expect(photoMapPosition({ id: 'legacy', latitude: 31, longitude: 121, count: 1 })).toEqual([
      31, 121,
    ]);
    expect(photoMapPosition({ ...cluster('pole', 180), photoLatitude: 90 })).toEqual([85, 180]);
  });
  it('merges overlapping thumbnails without losing or duplicating server cells and counts', () => {
    const clusters = [
      cluster('small', 122.2, 2),
      cluster('large', 122.1, 10),
      cluster('far', 125, 3),
    ];
    const groups = groupPhotoMapMarkers(clusters, project, 5);
    expect(groups).toHaveLength(2);
    expect(groups[0].representative.id).toBe('large');
    expect(groups[0].count).toBe(12);
    expect(groups.flatMap((g) => g.members.map((c) => c.id)).sort()).toEqual([
      'far',
      'large',
      'small',
    ]);
    expect(groups.reduce((sum, g) => sum + g.count, 0)).toBe(15);
    expect(groupPhotoMapMarkers([...clusters].reverse(), project, 5)).toEqual(groups);
    expect(groupPhotoMapMarkers(clusters, project, 16)).toHaveLength(3);
  });
  it('keeps dozens of nearby but distinct groups visible instead of merging at card-width distances', () => {
    const clusters = Array.from({ length: 48 }, (_, i) => ({
      ...cluster(String(i), 120 + (i % 8) * 0.55),
      photoLatitude: 30 + Math.floor(i / 8) * 0.6,
    }));
    const groups = groupPhotoMapMarkers(clusters, project, 9);
    expect(groups).toHaveLength(48);
    expect(groups.reduce((sum, group) => sum + group.count, 0)).toBe(48);
  });
});
