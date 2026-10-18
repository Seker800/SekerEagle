/** Explicit maintenance command; normal builds use committed local data and never download maps. */
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
const revision = 'ca96624a56bd078437bca8184e78163e5039ad19';
const base = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${revision}/geojson/`;
const output = 'apps/web/src/components/photos/basemap';
const sources = [];
async function read(file) {
  const url = base + file,
    response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Map source unavailable: ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  sources.push({ file, url, sha256: createHash('sha256').update(bytes).digest('hex') });
  return JSON.parse(bytes.toString('utf8'));
}
function round(value) {
  return Array.isArray(value)
    ? value.map(round)
    : typeof value === 'number'
      ? Math.round(value * 10000) / 10000
      : value;
}
const land = await read('ne_50m_land.geojson');
const cities = await read('ne_10m_populated_places.geojson');
await mkdir(output, { recursive: true });
await writeFile(
  `${output}/land.geojson`,
  JSON.stringify({
    type: 'FeatureCollection',
    features: land.features.map(({ geometry }) => ({
      type: 'Feature',
      properties: {},
      geometry: { ...geometry, coordinates: round(geometry.coordinates) },
    })),
  }) + '\n',
);
await writeFile(
  `${output}/cities.json`,
  JSON.stringify({
    cities: cities.features
      .map(({ properties: p, geometry }) => ({
        name: p.NAME_EN || p.NAME,
        nameZh: p.NAME_ZH || p.NAME_EN || p.NAME,
        longitude: round(geometry.coordinates[0]),
        latitude: round(geometry.coordinates[1]),
        population: p.POP_MAX ?? 0,
        minZoom: p.MIN_ZOOM ?? 6,
      }))
      .sort((a, b) => b.population - a.population),
  }) + '\n',
);
await writeFile(
  `${output}/sources.json`,
  JSON.stringify(
    {
      provider: 'Natural Earth',
      revision,
      license: 'Public domain',
      terms: 'https://www.naturalearthdata.com/about/terms-of-use/',
      sources,
      transforms: [
        'Land: retain geometry only; round coordinates to four decimals.',
        'Cities: retain names, coordinates, population and minimum zoom; sort by population.',
      ],
    },
    null,
    2,
  ) + '\n',
);
