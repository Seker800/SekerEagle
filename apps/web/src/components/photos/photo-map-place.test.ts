import { describe, it, expect } from 'vitest';
import { describeClusterPlace } from './photo-map-place';
import type { MapCity } from './local-basemap';
const weihai = { name: 'Weihai', nameZh: '威海', latitude: 37.5, longitude: 122.1, population: 560255, minZoom: 6 } satisfies MapCity;
const yantai = { ...weihai, name: 'Yantai', nameZh: '烟台', longitude: 121.3981, population: 2116000 };
describe('photo cluster place labels', () => {
  it('uses the real photo center for Weihai even when the grid marker is offshore and a larger city is nearby', () => {
    expect(describeClusterPlace({ photoLatitude: 37.5, photoLongitude: 122.1, south: 37.49, north: 37.51, west: 122.09, east: 122.11 }, [yantai, weihai])).toEqual({ city: weihai, regional: false });
  });
  it('marks broad groups as merged instead of asserting a whole group belongs to one city', () => {
    expect(describeClusterPlace({ photoLatitude: 37.5, photoLongitude: 122.1, south: 36, north: 38, west: 120, east: 123 }, [weihai])).toEqual({ city: weihai, regional: true });
  });
  it('does not invent a city when the catalog is empty, distant or no real location evidence is available', () => {
    expect(describeClusterPlace({}, [weihai]).city).toBeNull();
    expect(describeClusterPlace({ photoLatitude: 0, photoLongitude: 0 }, [weihai]).city).toBeNull();
    expect(describeClusterPlace({ photoLatitude: 37.5, photoLongitude: 122.1 }, []).city).toBeNull();
    expect(describeClusterPlace({ photoLatitude: NaN, photoLongitude: 122.1 }, [weihai]).city).toBeNull();
  });
  it('matches nearby cities across the date line', () => {
    const island = { ...weihai, latitude: 5, longitude: -179.9 };
    expect(describeClusterPlace({ photoLatitude: 5, photoLongitude: 179.9 }, [island]).city).toBe(island);
  });
});
