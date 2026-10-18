import landUrl from './basemap/land.geojson?url';
import citiesUrl from './basemap/cities.json?url';
import type { GeoJsonObject } from 'geojson';

export interface MapCity {
  name: string;
  nameZh: string;
  latitude: number;
  longitude: number;
  population: number;
  minZoom: number;
}
export async function loadLocalBasemap(signal: AbortSignal) {
  const read = async (url: string) => {
    const response = await fetch(url, { signal, credentials: 'same-origin' });
    if (!response.ok) throw new Error('LOCAL_BASEMAP_UNAVAILABLE');
    return response.json() as Promise<unknown>;
  };
  const [land, cities] = await Promise.all([read(landUrl), read(citiesUrl)]);
  return { land: land as GeoJsonObject, cities: (cities as { cities: MapCity[] }).cities };
}
/** Highest-population labels win; the viewport has a fixed label budget and avoids overlapping text. */
export function selectCityLabels(
  cities: readonly MapCity[],
  zoom: number,
  contains: (city: MapCity) => boolean,
  project: (city: MapCity) => { x: number; y: number },
) {
  const visible: MapCity[] = [];
  const occupied: Array<{ x: number; y: number; width: number }> = [];
  for (const city of cities) {
    if (city.minZoom > zoom || !contains(city)) continue;
    const point = project(city),
      width = Math.max(50, Math.max(city.name.length, city.nameZh.length) * 7);
    if (
      occupied.some(
        (other) =>
          Math.abs(point.x - other.x) < (width + other.width) / 2 + 12 &&
          Math.abs(point.y - other.y) < 28,
      )
    )
      continue;
    visible.push(city);
    occupied.push({ ...point, width });
    if (visible.length >= 60) break;
  }
  return visible;
}
