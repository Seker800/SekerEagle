import type { MapCity } from './local-basemap';

interface ClusterLocation {
  photoLatitude?: number;
  photoLongitude?: number;
  south?: number;
  north?: number;
  west?: number;
  east?: number;
}
const radians = (degrees: number) => (degrees * Math.PI) / 180;
const longitudeDistance = (left: number, right: number) => ((left - right + 540) % 360) - 180;

/** A nearby catalog city is a geographic hint, never an administrative attribution. */
export function describeClusterPlace(location: ClusterLocation, cities: readonly MapCity[]) {
  const { photoLatitude: latitude, photoLongitude: longitude } = location;
  if (
    latitude == null ||
    longitude == null ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude)
  )
    return { city: null, regional: false };
  const cos = Math.cos(radians(latitude));
  const northSouth = Math.abs((location.north ?? latitude) - (location.south ?? latitude)) * 111.2;
  const eastWest =
    Math.abs((location.east ?? longitude) - (location.west ?? longitude)) * 111.2 * cos;
  const regional = Math.hypot(northSouth, eastWest) > 60;
  let city: MapCity | null = null,
    closest = 60;
  for (const candidate of cities) {
    const dy = candidate.latitude - latitude;
    const dx = longitudeDistance(candidate.longitude, longitude);
    // Cheap rejection keeps a whole-library label pass bounded without an external geocoder.
    if (Math.abs(dy) > 0.6 || Math.abs(dx * cos) > 0.6) continue;
    const a =
      Math.sin(radians(dy) / 2) ** 2 +
      cos * Math.cos(radians(candidate.latitude)) * Math.sin(radians(dx) / 2) ** 2;
    const distance = 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
    if (distance < closest) {
      city = candidate;
      closest = distance;
    }
  }
  return { city, regional };
}
