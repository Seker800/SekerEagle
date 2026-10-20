/** Conservative helpers: suggestions carry evidence; similarity is never a verdict. */
export interface AgentCity {
  id: string;
  name: string;
  country: string;
  region: string;
  latitude: number;
  longitude: number;
}
export interface CityAnchor {
  id: string;
  capturedAt: Date;
  latitude: number;
  longitude: number;
  cityId: string;
}
export function haversineKm(a: number, b: number, c: number, d: number) {
  const rad = Math.PI / 180;
  const h =
    Math.sin(((c - a) * rad) / 2) ** 2 +
    Math.cos(a * rad) * Math.cos(c * rad) * Math.sin(((d - b) * rad) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function inferCity(
  capturedAt: Date | null,
  timeZoneKnown: boolean,
  anchors: CityAnchor[],
  cities: AgentCity[],
  offsetSeconds: number,
) {
  if (
    !capturedAt ||
    !timeZoneKnown ||
    !Number.isFinite(offsetSeconds) ||
    Math.abs(offsetSeconds) > 86400
  )
    return null;
  const time = capturedAt.getTime() + offsetSeconds * 1000;
  if (!Number.isFinite(time)) return null;
  const valid = anchors.filter(
    (a) =>
      Number.isFinite(a.capturedAt.getTime()) &&
      Math.abs(a.capturedAt.getTime() - time) <= 20 * 60000,
  );
  const before = valid
    .filter((a) => a.capturedAt.getTime() <= time)
    .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())[0];
  const after = valid
    .filter((a) => a.capturedAt.getTime() >= time && a.id !== before?.id)
    .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())[0];
  if (
    !before ||
    !after ||
    before.cityId !== after.cityId ||
    haversineKm(before.latitude, before.longitude, after.latitude, after.longitude) > 5
  )
    return null;
  const city = cities.find((c) => c.id === before.cityId);
  if (
    !city ||
    [before, after].some(
      (a) => haversineKm(city.latitude, city.longitude, a.latitude, a.longitude) > 30,
    )
  )
    return null;
  return { city, evidenceIds: [before.id, after.id] };
}
export function filenameSignals(name: string, mimeType: string): string[] {
  if (!mimeType.startsWith('image/')) return [];
  return /^(screenshot|screen[ _-]?shot|截屏|截图|屏幕截图)([ _.-]|[0-9]|$)/iu.test(
    name.normalize('NFKC'),
  )
    ? ['SCREENSHOT_NAME']
    : [];
}
