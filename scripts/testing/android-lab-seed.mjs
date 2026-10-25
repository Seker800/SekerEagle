/* global console, setTimeout */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buffer } from 'node:buffer';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { directory, root, labEnvironment, verifyContainers, run } from './android-lab.mjs';
import { ensureLabConfig, fixturePlan } from './android-lab-policy.mjs';
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function atomic(path, data) {
  await writeFile(`${path}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}
export async function labClient(config) {
  let cookie = '';
  async function login() {
    const response = await fetch(`${config.origin}/api/auth/login`, {
      method: 'POST',
      headers: { origin: config.origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: config.email, password: config.password }),
    });
    assert.equal(response.status, 201, 'Local test login failed');
    cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    await response.arrayBuffer();
  }
  await login();
  return async function api(path, body, method = body === undefined ? 'GET' : 'POST', attempt = 0) {
    assert.match(path, /^\/api\/(auth|photos|eagle)\//);
    const response = await fetch(`${config.origin}${path}`, {
      method,
      headers: { cookie, origin: config.origin, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 401 && attempt < 1) {
      await response.arrayBuffer();
      await login();
      return api(path, body, method, attempt + 1);
    }
    if (response.status === 429 && attempt < 5) {
      await response.arrayBuffer();
      await pause(
        Math.min(60, Math.max(1, Number(response.headers.get('retry-after')) || 2)) * 1000,
      );
      return api(path, body, method, attempt + 1);
    }
    if (!response.ok) {
      await response.arrayBuffer();
      throw new Error(`Local test API rejected ${method} with status ${response.status}`);
    }
    return response.status === 204 ? undefined : response.json();
  };
}
function dateFor(anchor, days) {
  return new Date(new Date(`${anchor}T12:00:00+08:00`).getTime() - days * 86400000);
}
function exifDate(date) {
  return new Date(date.getTime() + 8 * 3600000)
    .toISOString()
    .slice(0, 19)
    .replaceAll('-', ':')
    .replace('T', ' ');
}
function rational(value) {
  const degrees = Math.floor(value),
    minutes = Math.floor((value - degrees) * 60),
    seconds = Math.round(((value - degrees) * 60 - minutes) * 600000);
  return `${degrees}/1 ${minutes}/1 ${seconds}/10000`;
}
async function sourcePhotos() {
  const dir = join(directory, 'sources');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, 'manifest.json');
  const existing = await readFile(path, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  if (existing) return JSON.parse(existing);
  const sourcePath = join(root, '.omx/private/photo-statistics-samples.json');
  assert.ok((await stat(sourcePath)).size <= 70 * 1024 * 1024);
  const cached = JSON.parse(await readFile(sourcePath, 'utf8'));
  assert.equal(cached.source, 'read-only-nas-originals');
  assert.ok(cached.samples.length > 0 && cached.samples.length <= 32);
  const sources = [];
  let total = 0;
  for (const [index, sample] of cached.samples.entries()) {
    const bytes = Buffer.from(sample.bytes, 'base64');
    total += bytes.length;
    assert.ok(bytes.length <= 3 * 1024 * 1024 && total <= 48 * 1024 * 1024);
    const meta = await sharp(bytes).metadata();
    assert.equal(meta.format, 'jpeg');
    const name = `${String(index + 1).padStart(2, '0')}.jpg`;
    await writeFile(join(dir, name), bytes, { mode: 0o600 });
    sources.push({ name, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const manifest = {
    source: 'read-only-nas-originals',
    copiedAt: new Date().toISOString(),
    sources,
  };
  await atomic(path, manifest);
  return manifest;
}
async function seed(config) {
  verifyContainers(config);
  const env = labEnvironment(config);
  run(process.execPath, ['scripts/assert-safe-target.mjs'], { env });
  const path = join(directory, 'seed.json');
  const state = await readFile(path, 'utf8')
    .then(JSON.parse)
    .catch((error) => {
      if (error.code !== 'ENOENT') throw error;
      return {
        version: 1,
        anchor: new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Shanghai',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date()),
        entries: {},
        ready: false,
      };
    });
  assert.equal(state.version, 1);
  if (state.ready) {
    console.log(
      'Existing test library retained; seeding skipped, including user edits and deletions.',
    );
    return;
  }
  const sources = await sourcePhotos();
  const plan = fixturePlan(sources.sources.length);
  await atomic(path, state);
  const api = await labClient(config);
  const me = await api('/api/auth/me');
  const ownerId = me.user.id;
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  const tagIds = {},
    folderIds = {};
  try {
    for (const mode of ['PHOTO', 'MATERIAL']) {
      const base = mode === 'PHOTO' ? '/api/photos' : '/api/eagle';
      const tags = await api(`${base}/manual-tags`);
      tagIds[mode] = {};
      for (const name of ['测试图库', '旅行', '人像', '风景', '城市', '随手拍', '收藏', '精选']) {
        const tag =
          tags.find((t) => t.name === name) || (await api(`${base}/manual-tags`, { name }));
        tagIds[mode][name] = tag.id;
      }
      const folders = await api(`${base}/smart-folders`);
      folderIds[mode] = {};
      const parent =
        folders.find((f) => f.name === '日常分类' && !f.parentId) ||
        (await api(`${base}/smart-folders`, {
          name: '日常分类',
          query: { manualTagIds: [tagIds[mode]['测试图库']] },
        }));
      for (const theme of ['旅行', '人像', '风景', '城市', '随手拍', '收藏']) {
        const folder =
          folders.find((f) => f.name === theme && f.parentId === parent.id) ||
          (await api(`${base}/smart-folders`, {
            name: theme,
            parentId: parent.id,
            query: { manualTagIds: [tagIds[mode][theme]] },
          }));
        folderIds[mode][theme] = folder.id;
      }
      if (!folders.some((f) => f.name === '高分收藏'))
        await api(`${base}/smart-folders`, { name: '高分收藏', query: { rating: 4 } });
    }
    for (const [index, row] of plan.entries()) {
      if (state.entries[row.key]) continue;
      const source = sources.sources[row.sourceIndex];
      const sourceBytes = await readFile(join(directory, 'sources', source.name));
      assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), source.sha256);
      const captured = dateFor(state.anchor, row.daysAgo),
        cameraMake = row.camera.split(' ')[0];
      const exif = {
        IFD0: {
          Make: cameraMake,
          Model: row.camera,
          ImageDescription: 'SekerEagle local testing: synthetic metadata',
        },
        IFD2: {
          DateTimeOriginal: exifDate(captured),
          OffsetTimeOriginal: '+08:00',
          LensModel: row.lens,
          FNumber: '28/10',
          ISOSpeedRatings: String(100 + row.variant * 100),
          FocalLength: '35/1',
          ExposureTime: '1/125',
        },
        ...(row.gps
          ? {
              IFD3: {
                GPSLatitudeRef: 'N',
                GPSLatitude: rational(row.city.latitude),
                GPSLongitudeRef: 'E',
                GPSLongitude: rational(row.city.longitude),
              },
            }
          : {}),
      };
      const bytes = await sharp(sourceBytes)
        .rotate()
        .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
        .withExif(exif)
        .toFormat(row.format, { quality: 87 })
        .toBuffer();
      const base = row.mode === 'PHOTO' ? '/api/photos' : '/api/eagle';
      const suffix = row.format === 'jpeg' ? 'jpg' : row.format;
      const name = `${row.theme}-${row.gps ? row.city.name : '无位置'}-${state.anchor}-${String(row.variant + 1).padStart(2, '0')}.${suffix}`;
      const session = await api(`${base}/uploads`, {
        originalName: name,
        mimeType: `image/${row.format}`,
        size: bytes.length,
        contentSha256: createHash('sha256').update(bytes).digest('hex'),
      });
      const part = await api(`${base}/uploads/${session.id}/parts/1`, {});
      assert.equal(new URL(part.uploadUrl).origin, config.origin);
      const uploaded = await fetch(part.uploadUrl, { method: 'PUT', body: bytes });
      assert.equal(uploaded.status, 200);
      const complete = await api(`${base}/uploads/${session.id}/complete`, {
        parts: [{ partNumber: 1, etag: uploaded.headers.get('etag') }],
      });
      const id = complete.assetId;
      let ready = false;
      for (let attempt = 0; attempt < 240; attempt++) {
        const item = await db.eagleAsset.findFirst({
          where: { id, ownerId, libraryMode: row.mode },
        });
        if (item?.lifecycleStatus === 'READY') {
          ready = true;
          break;
        }
        if (item?.lifecycleStatus === 'FAILED') throw new Error('Test preview processing failed');
        await pause(500);
      }
      assert.ok(ready, 'Test image preview did not become ready');
      await api(
        `${base}/assets/${id}/manual-tags`,
        {
          tagIds: [
            tagIds[row.mode]['测试图库'],
            tagIds[row.mode][row.theme],
            ...(row.rating >= 4 ? [tagIds[row.mode]['精选']] : []),
          ],
        },
        'PUT',
      );
      await db.eagleAsset.updateMany({
        where: { id, ownerId, libraryMode: row.mode },
        data: { rating: row.rating || null, libraryAddedAt: captured, chronologicalAt: captured },
      });
      if (row.mode === 'PHOTO') {
        const facts = {
          capturedAt: captured,
          capturedLocal: exifDate(captured).replaceAll(':', '-').slice(0, 10) + 'T12:00:00',
          captureTimeZoneKnown: true,
          cameraMake,
          cameraModel: row.camera,
          lensModel: row.lens,
          focalLength: 35,
          aperture: 2.8,
          exposureSeconds: 1 / 125,
          iso: 100 + row.variant * 100,
          latitude: row.gps ? row.city.latitude : null,
          longitude: row.gps ? row.city.longitude : null,
          altitude: row.gps ? 20 : null,
        };
        const asset = await db.eagleAsset.findFirstOrThrow({
          where: { id, ownerId, libraryMode: 'PHOTO' },
        });
        await db.eaglePhotoMetadata.upsert({
          where: { assetId: id },
          create: {
            assetId: id,
            ownerId,
            libraryMode: 'PHOTO',
            assetRevision: asset.mediaRevision,
            processorVersion: 'android-lab-v1',
            ...facts,
          },
          update: facts,
        });
      }
      state.entries[row.key] = { id, mode: row.mode, theme: row.theme };
      await atomic(path, state);
      if ((index + 1) % 12 === 0)
        console.log(`Prepared ${index + 1} of ${plan.length} persistent test images.`);
    }
    state.folders = folderIds;
    state.tags = tagIds;
    state.ready = true;
    state.completedAt = new Date().toISOString();
    await atomic(path, state);
    console.log('Persistent test library initialized once.');
  } finally {
    await db.$disconnect();
  }
}
async function verify(config) {
  verifyContainers(config);
  const state = JSON.parse(await readFile(join(directory, 'seed.json'), 'utf8'));
  assert.equal(state.ready, true);
  const api = await labClient(config);
  const results = [];
  for (const mode of ['PHOTO', 'MATERIAL']) {
    const base = mode === 'PHOTO' ? '/api/photos' : '/api/eagle';
    const cases = [
      ['all', ''],
      ...['旅行', '人像', '风景', '城市', '随手拍', '收藏'].flatMap((theme) => [
        [`tag-${theme}`, `manualTagIds=${state.tags[mode][theme]}`],
        [`folder-${theme}`, `smartFolderId=${state.folders[mode][theme]}`],
      ]),
      ...['jpeg', 'png', 'webp'].map((format) => [format, `formats=${format}`]),
      ...[1, 2, 3, 4, 5].map((rating) => [`rating-${rating}`, `rating=${rating}`]),
      ['keyword', `search=${encodeURIComponent('旅行')}`],
      [
        'combined',
        `smartFolderId=${state.folders[mode]['旅行']}&manualTagIds=${state.tags[mode]['精选']}&formats=jpeg&rating=4`,
      ],
      [
        'date',
        `createdFrom=${encodeURIComponent(new Date(`${state.anchor}T00:00:00+08:00`).toISOString())}`,
      ],
    ];
    if (mode === 'PHOTO') {
      const cameras = ['Canon EOS R5', 'Sony A7 IV', 'Nikon Z6 II'];
      const lenses = ['RF 24-70mm F2.8 L IS USM', 'FE 35mm F1.8', 'NIKKOR Z 85mm f/1.8 S'];
      cases.push(
        ['gps', 'gps=WITH'],
        ['no-gps', 'gps=WITHOUT'],
        ...cameras.map((camera) => [
          `camera-${camera}`,
          `cameraModel=${encodeURIComponent(camera)}`,
        ]),
        ...lenses.map((lens) => [`lens-${lens}`, `lensModel=${encodeURIComponent(lens)}`]),
        [
          'full-combination',
          `smartFolderId=${state.folders[mode]['旅行']}&manualTagIds=${state.tags[mode]['精选']}&formats=jpeg&rating=4&gps=WITH&cameraModel=Canon+EOS+R5&lensModel=RF+24-70mm+F2.8+L+IS+USM&createdFrom=${encodeURIComponent(new Date(`${state.anchor}T00:00:00+08:00`).toISOString())}`,
        ],
      );
    }
    for (const [name, query] of cases) {
      const page = await api(`${base}/assets?limit=100&${query}`);
      assert.ok(page.items.length > 0, `Empty demonstration case: ${mode} ${name}`);
      results.push({ mode, name, count: page.items.length });
    }
  }
  await atomic(join(directory, 'verification.json'), {
    checkedAt: new Date().toISOString(),
    cases: results,
  });
  console.log(`Verified ${results.length} nonempty real API filtering scenarios.`);
}
async function main() {
  const config = await ensureLabConfig(directory);
  if (process.argv[2] === 'verify') return verify(config);
  if (process.argv[2] && process.argv[2] !== 'seed') throw new Error('Use seed or verify');
  return seed(config);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(`Persistent lab data operation failed (${error.name}); progress was preserved.`);
    process.exitCode = 1;
  });
