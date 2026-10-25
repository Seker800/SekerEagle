import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, link, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export const LAB_KIND = 'sekereagle-android-lab-v1';
export const LAB_ORIGIN = 'http://localhost:49813';
const ports = { databasePort: 55438, storagePort: 59090, apiPort: 54991 };
export function assertLabConfig(config) {
  assert.equal(config.kind, LAB_KIND);
  assert.equal(config.origin, LAB_ORIGIN);
  for (const [key, value] of Object.entries(ports)) assert.equal(config[key], value);
  assert.match(config.id, /^[a-f0-9-]{36}$/);
  for (const key of ['password', 'databasePassword', 'storageKey', 'storageSecret', 'jwtSecret'])
    assert.match(config[key], /^[a-f0-9]{32,128}$/);
  assert.equal(config.email, 'tester@sekereagle.local');
  return config;
}
export async function ensureLabConfig(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, 'config.json');
  try {
    return assertLabConfig(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const config = {
    kind: LAB_KIND,
    id: randomUUID(),
    origin: LAB_ORIGIN,
    ...ports,
    email: 'tester@sekereagle.local',
    password: randomBytes(24).toString('hex'),
    databasePassword: randomBytes(24).toString('hex'),
    storageKey: randomBytes(16).toString('hex'),
    storageSecret: randomBytes(32).toString('hex'),
    jwtSecret: randomBytes(32).toString('hex'),
  };
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(config, null, 2), { mode: 0o600, flag: 'wx' });
  try {
    await link(temporary, path);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  } finally {
    await unlink(temporary);
  }
  return assertLabConfig(JSON.parse(await readFile(path, 'utf8')));
}
export function containerSpec(config, role) {
  assertLabConfig(config);
  assert.ok(['db', 'storage'].includes(role));
  const database = role === 'db';
  const name = `sekereagle-android-lab-${role}`;
  const volume = `sekereagle-android-lab-${database ? 'postgres' : 'objects'}`;
  const destination = database ? '/var/lib/postgresql/data' : '/data';
  const port = database ? config.databasePort : config.storagePort;
  const containerPort = database ? '5432/tcp' : '9000/tcp';
  const image = database
    ? 'pgvector/pgvector:0.8.6-pg16'
    : 'minio/minio:RELEASE.2025-04-22T22-12-26Z';
  return {
    name,
    volume,
    destination,
    port,
    containerPort,
    image,
    args: [
      'run',
      '--detach',
      '--name',
      name,
      '--restart',
      'unless-stopped',
      '--label',
      `com.sekereagle.lab=${config.id}`,
      '--label',
      `com.sekereagle.lab.role=${role}`,
      '--publish',
      `127.0.0.1:${port}:${containerPort.split('/')[0]}`,
      '--volume',
      `${volume}:${destination}`,
      '--env-file',
      `container-${role}.env`,
      image,
      ...(database ? [] : ['server', '/data']),
    ],
  };
}
export function assertOwnedContainer(config, role, info) {
  const spec = containerSpec(config, role);
  assert.equal(info.Config.Labels?.['com.sekereagle.lab'], config.id);
  assert.equal(info.Config.Labels?.['com.sekereagle.lab.role'], role);
  assert.equal(info.Config.Image, spec.image);
  assert.ok(
    info.Mounts.some(
      (mount) => mount.Name === spec.volume && mount.Destination === spec.destination,
    ),
  );
  assert.deepEqual(info.HostConfig.PortBindings[spec.containerPort], [
    { HostIp: '127.0.0.1', HostPort: String(spec.port) },
  ]);
}
export function fixturePlan(sourceCount) {
  assert.ok(Number.isInteger(sourceCount) && sourceCount > 0 && sourceCount <= 32);
  const themes = ['旅行', '人像', '风景', '城市', '随手拍', '收藏'];
  const cameras = ['Canon EOS R5', 'Sony A7 IV', 'Nikon Z6 II'];
  const lenses = ['RF 24-70mm F2.8 L IS USM', 'FE 35mm F1.8', 'NIKKOR Z 85mm f/1.8 S'];
  const cities = [
    { name: '上海', latitude: 31.2304, longitude: 121.4737 },
    { name: '杭州', latitude: 30.2741, longitude: 120.1551 },
    { name: '北京', latitude: 39.9042, longitude: 116.4074 },
  ];
  return ['PHOTO', 'MATERIAL'].flatMap((mode) =>
    themes.flatMap((theme, index) =>
      Array.from({ length: 12 }, (_, variant) => ({
        key: `${mode}:${index}:${variant}`,
        mode,
        theme,
        index,
        variant,
        sourceIndex: ((index * 12 + variant) * 7) % sourceCount,
        camera: cameras[Math.floor(variant / 3) % 3],
        lens: lenses[Math.floor(variant / 3) % 3],
        rating: variant === 0 ? 5 : variant % 6,
        gps: variant % 2 === 0,
        format: ['jpeg', 'png', 'webp'][variant % 3],
        city: cities[index % 3],
        daysAgo: [0, 0, 1, 3, 7, 15, 30, 90, 180, 365, 730, 1095][variant],
      })),
    ),
  );
}
