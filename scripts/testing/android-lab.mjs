/* global console, setTimeout */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, appendFileSync, existsSync, renameSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { S3Client, CreateBucketCommand } from '@aws-sdk/client-s3';
import bcrypt from 'bcrypt';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import {
  assertLabConfig,
  assertOwnedContainer,
  containerSpec,
  ensureLabConfig,
  LAB_KIND,
} from './android-lab-policy.mjs';

export const root = fileURLToPath(new URL('../..', import.meta.url));
export const directory = join(root, '.local/android-lab');
const label = 'com.sekereagle.android-lab';
const plist = join(homedir(), 'Library/LaunchAgents', `${label}.plist`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', cwd: root, ...options });
  if (result.status !== 0)
    throw new Error(`Local lab command failed: ${command.split('/').at(-1)}`);
  return result.stdout.trim();
}
function log(name, bytes) {
  const path = join(directory, 'logs', `${name}.log`);
  if (existsSync(path) && statSync(path).size > 5 * 1024 * 1024)
    renameSync(path, `${path}.previous`);
  appendFileSync(path, bytes, { mode: 0o600 });
}
export function labEnvironment(config) {
  assertLabConfig(config);
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(config.apiPort),
    CANONICAL_ORIGIN: config.origin,
    BROWSER_TRUSTED_ORIGINS: config.origin,
    DATABASE_URL: `postgresql://sekereagle_lab:${config.databasePassword}@127.0.0.1:${config.databasePort}/sekereagle_test`,
    JWT_ACCESS_SECRET: config.jwtSecret,
    ACCESS_TOKEN_TTL_SECONDS: '900',
    REFRESH_TOKEN_TTL_SECONDS: '2592000',
    S3_ENDPOINT: `http://127.0.0.1:${config.storagePort}`,
    S3_PUBLIC_ENDPOINT: config.origin,
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'sekereagle-assets',
    S3_ACCESS_KEY_ID: config.storageKey,
    S3_SECRET_ACCESS_KEY: config.storageSecret,
    MLX_EMBEDDING_URL: 'http://127.0.0.1:9',
    MLX_EMBEDDING_TOKEN: '',
    EAGLE_BACKGROUND_PROCESSING_ENABLED: 'true',
    EAGLE_INTERACTIVE_CONCURRENCY: '2',
    EAGLE_PROCESSING_JOB_KINDS:
      'GENERATE_RENDITIONS,GENERATE_THUMBNAIL,GENERATE_PREVIEW,PROBE_MEDIA,PURGE_ASSET',
    EAGLE_VIDEO_TRANSCODING_ENABLED: 'false',
    EXIFTOOL_PATH: join(root, '.local/android-test-exiftool/exiftool'),
    FFPROBE_PATH: join(
      root,
      '.local/android-media-tools/node_modules/ffprobe-static/bin/darwin/arm64/ffprobe',
    ),
  };
  assertSafeRuntimeTarget({
    databaseUrl: env.DATABASE_URL,
    s3Endpoint: env.S3_ENDPOINT,
    s3Bucket: env.S3_BUCKET,
  });
  return env;
}
export function verifyContainers(config) {
  for (const role of ['db', 'storage']) {
    const info = JSON.parse(run('docker', ['inspect', containerSpec(config, role).name]))[0];
    assertOwnedContainer(config, role, info);
    assert.equal(info.State.Running, true);
  }
}
async function containers(config) {
  for (const role of ['db', 'storage']) {
    const spec = containerSpec(config, role);
    const inspected = spawnSync('docker', ['inspect', spec.name], { encoding: 'utf8' });
    if (inspected.status === 0) {
      const info = JSON.parse(inspected.stdout)[0];
      assertOwnedContainer(config, role, info);
      if (!info.State.Running) run('docker', ['start', spec.name]);
      continue;
    }
    const volume = spawnSync('docker', ['volume', 'inspect', spec.volume], { encoding: 'utf8' });
    if (volume.status === 0)
      assert.equal(JSON.parse(volume.stdout)[0].Labels?.['com.sekereagle.lab'], config.id);
    else
      run('docker', [
        'volume',
        'create',
        '--label',
        `com.sekereagle.lab=${config.id}`,
        spec.volume,
      ]);
    const contents =
      role === 'db'
        ? `POSTGRES_USER=sekereagle_lab\nPOSTGRES_DB=sekereagle_test\nPOSTGRES_PASSWORD=${config.databasePassword}\n`
        : `MINIO_ROOT_USER=${config.storageKey}\nMINIO_ROOT_PASSWORD=${config.storageSecret}\n`;
    const envPath = join(directory, `container-${role}.env`);
    await writeFile(envPath, contents, { mode: 0o600 });
    const args = spec.args.map((arg) => (arg === `container-${role}.env` ? envPath : arg));
    run('docker', args);
  }
  verifyContainers(config);
  for (let attempt = 0; attempt < 120; attempt++) {
    const database = spawnSync('docker', [
      'exec',
      containerSpec(config, 'db').name,
      'pg_isready',
      '-U',
      'sekereagle_lab',
      '-d',
      'sekereagle_test',
    ]);
    const storage = await fetch(`http://127.0.0.1:${config.storagePort}/minio/health/live`)
      .then((r) => r.ok)
      .catch(() => false);
    if (database.status === 0 && storage) return;
    await sleep(500);
  }
  throw new Error('Local lab storage did not become ready');
}
async function migrate(env) {
  run(process.execPath, ['scripts/assert-safe-target.mjs'], { env });
  const child = spawn(
    process.execPath,
    [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--schema',
      'apps/api/prisma/schema.prisma',
    ],
    { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.on('data', (bytes) => log('migration', bytes));
  child.stderr.on('data', (bytes) => log('migration', bytes));
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Local lab migration failed')),
    );
  });
}
async function bootstrap(config, env) {
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const existing = await db.user.findUnique({ where: { email: config.email } });
    const owner =
      existing ||
      (await db.user.create({
        data: {
          email: config.email,
          passwordHash: await bcrypt.hash(config.password, 12),
          role: 'ADMIN',
        },
      }));
    for (const libraryMode of ['PHOTO', 'MATERIAL'])
      await db.eagleProcessingSetting.upsert({
        where: { ownerId_libraryMode: { ownerId: owner.id, libraryMode } },
        create: { ownerId: owner.id, libraryMode, mode: 'MANUAL' },
        update: {},
      });
  } finally {
    await db.$disconnect();
  }
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: config.storageKey, secretAccessKey: config.storageSecret },
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch (error) {
    if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.name)) throw error;
  } finally {
    s3.destroy();
  }
  await writeFile(
    join(directory, 'login.json'),
    JSON.stringify(
      { origin: config.origin, email: config.email, password: config.password },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}
async function serve(config) {
  await mkdir(join(directory, 'logs'), { recursive: true, mode: 0o700 });
  await containers(config);
  const env = labEnvironment(config);
  await migrate(env);
  await bootstrap(config, env);
  const children = ['apps/api/dist/main.js', 'apps/worker/dist/main.js'].map((path, i) => {
    const child = spawn(process.execPath, [path], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (bytes) => log(i === 0 ? 'api' : 'worker', bytes));
    child.stderr.on('data', (bytes) => log(i === 0 ? 'api' : 'worker', bytes));
    return child;
  });
  const webRoot = join(root, 'apps/web/dist');
  const server = createServer(async (req, res) => {
    if (!['localhost:49813', '127.0.0.1:49813'].includes(req.headers.host)) {
      res.writeHead(421);
      res.end();
      return;
    }
    if (req.url === '/__lab/status') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ kind: LAB_KIND, origin: config.origin }));
      return;
    }
    if (req.url.startsWith('/api/') || req.url.startsWith('/sekereagle-assets/')) {
      const media = req.url.startsWith('/sekereagle-assets/');
      const upstream = request(
        {
          hostname: '127.0.0.1',
          port: media ? config.storagePort : config.apiPort,
          path: req.url,
          method: req.method,
          headers: media ? { ...req.headers, host: new URL(config.origin).host } : req.headers,
        },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.on('aborted', () => upstream.destroy());
      req.pipe(upstream);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405);
      res.end();
      return;
    }
    try {
      const path = resolve(webRoot, `.${decodeURIComponent(req.url.split('?')[0])}`);
      assert.ok(path.startsWith(`${webRoot}/`) || path === webRoot);
      const file = (await stat(path).catch(() => null))?.isFile()
        ? path
        : join(webRoot, 'index.html');
      res.setHeader(
        'content-type',
        {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
          '.png': 'image/png',
          '.wasm': 'application/wasm',
        }[extname(file)] || 'application/octet-stream',
      );
      if (req.method === 'HEAD') res.end();
      else createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(49813, '127.0.0.1', resolve);
    });
  } catch (error) {
    children.forEach((child) => child.kill('SIGTERM'));
    throw error;
  }
  await writeFile(
    join(directory, 'runtime.json'),
    JSON.stringify(
      {
        kind: LAB_KIND,
        pid: process.pid,
        origin: config.origin,
        children: children.map((c) => c.pid),
        containers: ['db', 'storage'].map((role) => containerSpec(config, role).name),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  let stopping = false;
  function stop() {
    if (stopping) return;
    stopping = true;
    server.close();
    children.forEach((c) => c.kill('SIGTERM'));
    setTimeout(() => process.exit(0), 1500).unref();
  }
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  for (const child of children)
    child.once('exit', () => {
      if (!stopping) {
        log('supervisor', 'Application exited; launchd will restart the same lab.\n');
        stop();
      }
    });
  console.log('Persistent Android lab is running.');
}
function xml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
async function start(config) {
  await mkdir(dirname(plist), { recursive: true });
  await mkdir(join(directory, 'logs'), { recursive: true, mode: 0o700 });
  const path = [
    dirname(process.execPath),
    join(homedir(), '.npm-global/bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].join(':');
  const content = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(join(root, 'scripts/testing/android-lab.mjs'))}</string><string>serve</string></array><key>WorkingDirectory</key><string>${xml(root)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(path)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>15</integer><key>StandardOutPath</key><string>${xml(join(directory, 'logs/launchd.log'))}</string><key>StandardErrorPath</key><string>${xml(join(directory, 'logs/launchd.log'))}</string></dict></plist>`;
  await writeFile(plist, content, { mode: 0o600 });
  const service = `gui/${process.getuid()}/${label}`;
  if (spawnSync('launchctl', ['print', service], { stdio: 'ignore' }).status !== 0)
    run('launchctl', ['bootstrap', `gui/${process.getuid()}`, plist]);
  else run('launchctl', ['kickstart', service]);
  for (let attempt = 0; attempt < 180; attempt++) {
    const status = await fetch(`${config.origin}/__lab/status`)
      .then((r) => r.json())
      .catch(() => null);
    if (
      status?.kind === LAB_KIND &&
      (await fetch(`${config.origin}/api/health/ready`)
        .then((r) => r.ok)
        .catch(() => false))
    ) {
      console.log('Persistent Android lab ready at the fixed loopback address.');
      return;
    }
    await sleep(500);
  }
  throw new Error('Lab startup did not become ready; inspect the private lab logs');
}
async function main() {
  const config = await ensureLabConfig(directory);
  const command = process.argv[2] || 'status';
  if (command === 'serve') return serve(config);
  if (command === 'start') return start(config);
  if (command === 'restart') {
    run('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${label}`]);
    return start(config);
  }
  if (command === 'status') {
    const status = await fetch(`${config.origin}/__lab/status`).then((r) => r.json());
    assert.equal(status.kind, LAB_KIND);
    verifyContainers(config);
    assert.ok(await fetch(`${config.origin}/api/health/ready`).then((response) => response.ok));
    const initialized = await readFile(join(directory, 'seed.json'), 'utf8').then(
      (value) => JSON.parse(value).ready === true,
      () => false,
    );
    console.log(
      JSON.stringify({ kind: LAB_KIND, origin: config.origin, running: true, initialized }),
    );
    return;
  }
  if (command === 'stop') {
    run('launchctl', ['bootout', `gui/${process.getuid()}/${label}`]);
    return;
  }
  throw new Error('Use start, status or stop; none of these commands reset data.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error(
      'Android lab operation failed. Inspect .local/android-lab/logs; persistent data was retained.',
    );
    process.exitCode = 1;
  });
