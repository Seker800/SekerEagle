/* global console */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Explicit maintenance operation. Viewing the map never calls the download host.
const dataDate = '20261023';
const source = `https://build.protomaps.com/${dataDate}.pmtiles`;
const directory = resolve('.local/maps/data');
const executable = resolve('.local/maps/tools/pmtiles');
await mkdir(directory, { recursive: true });
const staging = await mkdtemp(join(directory, '.prepare-'));
function run(args) {
  const result = spawnSync(executable, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('Map preparation failed; existing archive preserved');
}
try {
  const world = join(staging, 'world.pmtiles'),
    region = join(staging, 'china.pmtiles');
  run(['extract', source, world, '--maxzoom=7', '--download-threads=4']);
  run([
    'extract',
    source,
    region,
    '--bbox=73,18,136,54',
    '--minzoom=8',
    '--maxzoom=14',
    '--download-threads=4',
  ]);
  const archive = join(staging, 'basemap.pmtiles');
  run(['merge', world, region, archive]);
  run(['verify', archive]);
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(archive)) hash.update(bytes);
  const manifest = {
    source,
    dataDate,
    sha256: hash.digest('hex'),
    overviewMaxZoom: 7,
    detailMaxZoom: 14,
    detailBounds: [73, 18, 136, 54],
    attribution: 'Protomaps © OpenStreetMap contributors',
    license: 'ODbL-1.0',
  };
  await writeFile(join(staging, 'sources.json'), JSON.stringify(manifest, null, 2) + '\n');
  await rename(archive, join(directory, 'basemap.pmtiles'));
  await rename(join(staging, 'sources.json'), join(directory, 'sources.json'));
  console.log('Self-hosted map archive prepared. Restart or refresh the local map to use it.');
} finally {
  await rm(staging, { recursive: true, force: true });
}
