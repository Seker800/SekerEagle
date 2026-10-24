import { describe, it, expect } from 'vitest';
import { layoutPhotoMapMarkers, photoMapPosition } from './photo-map-markers';
import type { EagleAssetListItem } from '../../lib/eagle-api';
import type { PhotoMapCluster } from '../../lib/photo-management-api';
const cluster = (id: string, longitude: number, count = 1): PhotoMapCluster => ({
  id,
  latitude: 30,
  longitude: 120,
  photoLatitude: 37.5,
  photoLongitude: longitude,
  count,
  cover: { id: `cover-${id}` } as EagleAssetListItem,
});
describe('photo markers anchored to actual photo distribution', () => {
  it('uses the photo concentration instead of snapping to a grid center', () => {
    expect(photoMapPosition(cluster('a', 122.1))).toEqual([37.5, 122.1]);
    expect(photoMapPosition({ id: 'legacy', latitude: 31, longitude: 121, count: 1 })).toEqual([
      31, 121,
    ]);
    expect(photoMapPosition({ ...cluster('pole', 180), photoLatitude: 90 })).toEqual([85, 180]);
  });
  it('keeps the top locations as photo previews even when their real positions overlap', () => {
    const clusters = [
      cluster('small', 122.2, 2),
      cluster('large', 122.1, 10),
      cluster('far', 125, 3),
    ];
    const groups = layoutPhotoMapMarkers(clusters);
    expect(groups).toHaveLength(3);
    expect(groups[0].cluster.id).toBe('large');
    expect(groups[0].cluster.count).toBe(10);
    expect(groups.find((g) => g.key === 'small')?.presentation).toBe('photo');
    expect(groups.flatMap((g) => [g.cluster.id]).sort()).toEqual(['far', 'large', 'small']);
    expect(groups.reduce((sum, g) => sum + g.cluster.count, 0)).toBe(15);
    expect(layoutPhotoMapMarkers([...clusters].reverse())).toEqual(groups);
    expect(layoutPhotoMapMarkers(clusters)).toHaveLength(3);
  });
  it('keeps dozens of nearby but distinct groups visible instead of merging at card-width distances', () => {
    const clusters = Array.from({ length: 48 }, (_, i) => ({
      ...cluster(String(i), 120 + (i % 8) * 0.55),
      photoLatitude: 30 + Math.floor(i / 8) * 0.6,
    }));
    const groups = layoutPhotoMapMarkers(clusters);
    expect(groups).toHaveLength(48);
    expect(groups.reduce((sum, group) => sum + group.cluster.count, 0)).toBe(48);
  });
});

it('does not reserve preview space for a location without a cover, and keeps all dense locations', () => {
  const points = Array.from({ length: 4096 }, (_, i) => ({
    ...cluster(String(i), 120 + i * 0.0001),
    count: 1,
  }));
  const result = layoutPhotoMapMarkers(points);
  expect(result).toHaveLength(points.length);
  expect(result.filter((p) => p.presentation === 'photo').length).toBe(9);
  expect(result.reduce((sum, p) => sum + p.cluster.count, 0)).toBe(4096);
  expect(new Set(result.map((p) => p.cluster.id)).size).toBe(4096);
  expect(
    layoutPhotoMapMarkers([
      { ...cluster('missing', 120), cover: null },
      cluster('present', 120),
    ]).find((p) => p.key === 'present')?.presentation,
  ).toBe('photo');
});

it('keeps previews at their real positions without reserving image space for every footprint dot', () => {
  const points = [cluster('south', 120, 100), { ...cluster('north', 120, 1), photoLatitude: 37.3 }];
  const result = layoutPhotoMapMarkers(points);
  expect(result.find((p) => p.key === 'south')?.presentation).toBe('photo');
  expect(result.map((p) => p.key).sort()).toEqual(['north', 'south']);
});
