import { describe, it, expect } from 'vitest';
import { selectCityLabels, type MapCity } from './local-basemap';
const city = (name: string, x: number, y: number, minZoom = 1) =>
  ({ name, nameZh: name, latitude: y, longitude: x, population: 100, minZoom }) as MapCity;
describe('offline city labels', () => {
  it('keeps the highest-priority label when cities overlap, and excludes out-of-view cities', () => {
    const cities = [
      city('large', 0, 0),
      city('small', 1, 1),
      city('outside', 100, 100),
      city('too detailed', 200, 200, 10),
    ];
    expect(
      selectCityLabels(
        cities,
        5,
        (c) => c.name !== 'outside',
        (c) => ({ x: c.longitude, y: c.latitude }),
      ).map((c) => c.name),
    ).toEqual(['large']);
  });
  it('bounds city label DOM even when the entire dataset is visible', () => {
    const cities = Array.from({ length: 100 }, (_, i) => city(String(i), i * 300, 0));
    expect(
      selectCityLabels(
        cities,
        5,
        () => true,
        (c) => ({ x: c.longitude, y: 0 }),
      ),
    ).toHaveLength(60);
  });
});
