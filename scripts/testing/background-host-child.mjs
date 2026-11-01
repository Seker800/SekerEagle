import { Readable } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { PrismaClient } from '@prisma/client';
import { assertSafeRuntimeTarget } from '../../packages/config/dist/index.js';
import { createAssetOperationBackground } from '../../apps/api/dist/asset-operation-executor.js';
import { EagleUploadService } from '../../apps/api/dist/eagle/eagle-upload.service.js';
import { loadLegacyApiBackground } from './legacy-api-background-fixture.mjs';

assertSafeRuntimeTarget({
  databaseUrl: process.env.DATABASE_URL,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Bucket: process.env.S3_BUCKET,
});
if (new URL(process.env.DATABASE_URL).pathname !== '/sekereagle_test' || !process.send)
  throw Error('Only isolated forked tests may start this host');
const [version, ownerId, mode] = process.argv.slice(2);
if (
  !['legacy', 'current'].includes(version) ||
  !['MATERIAL', 'PHOTO'].includes(mode) ||
  !/^[a-f0-9-]{36}$/.test(ownerId)
)
  throw Error('Invalid synthetic host scope');
const db = new PrismaClient();
const bytes = await sharp({ create: { width: 1, height: 1, channels: 3, background: '#88aa33' } })
  .jpeg()
  .toBuffer();
let resume;
const barrier = new Promise((resolve) => {
  resume = resolve;
});
const send = (event) => process.send?.({ event, version });
const scoped = db.$extends({
  query: {
    uploadSession: {
      findMany: async ({ args, query }) => {
        const rows = await query({ ...args, where: { ...args.where, uploaderId: ownerId } });
        if (args.where?.finalizationAttempts && args.where.libraryMode === mode) {
          send('upload-selected');
          await barrier;
        }
        return rows;
      },
      updateMany: ({ args, query }) =>
        query({ ...args, where: { ...args.where, uploaderId: ownerId } }),
    },
    eagleUploadSessionState: {
      findMany: ({ args, query }) => query({ ...args, where: { ...args.where, ownerId } }),
    },
  },
});
const storage = {
  headObject: async () => ({ ContentLength: bytes.length }),
  getObject: async () => ({ Body: Readable.from([bytes]) }),
};
const host = createAssetOperationBackground(scoped, storage);
const recovery = Reflect.get(host, 'recoveries').find(
  (row) => Reflect.get(row, 'libraryMode') === mode,
);
const uploads = Reflect.get(recovery, 'uploads'),
  imports = Reflect.get(recovery, 'imports');
const reconcile = imports.reconcileStaleUploadSessions.bind(imports);
imports.reconcileStaleUploadSessions = async () => {
  send('sweep-selected');
  await barrier;
  return reconcile();
};
let legacy, oldRecovery, oldMaintenance, closing;
async function close() {
  if (closing) return closing;
  closing = (async () => {
    resume();
    oldRecovery?.onModuleDestroy();
    oldMaintenance?.onModuleDestroy();
    await host.close();
    for (
      let i = 0;
      oldRecovery &&
      (Reflect.get(oldRecovery, 'running') || Reflect.get(oldMaintenance, 'running'));
      i++
    ) {
      if (i >= 600) throw Error('Legacy host did not drain');
      await delay(25);
    }
    await db.$disconnect();
    await legacy?.close();
    process.disconnect?.();
  })();
  return closing;
}
process.on('message', (message) => {
  if (message === 'continue') resume();
  if (message === 'stop')
    void close().catch(() => {
      process.exitCode = 1;
      process.disconnect?.();
    });
  if (message === 'repeat')
    void (version === 'legacy' ? oldMaintenance : Reflect.get(host, 'maintenance'))
      .runMaintenance()
      .then(() => send('repeated'))
      .catch(() => send('failed'));
});
process.on('SIGTERM', () => void close());
try {
  if (version === 'legacy') {
    legacy = await loadLegacyApiBackground();
    oldRecovery = new legacy.EagleUploadRecoveryService(
      scoped,
      new EagleUploadService(
        scoped,
        storage,
        Reflect.get(uploads, 'mediaCapabilities'),
        Reflect.get(uploads, 'inspection'),
        mode,
        Reflect.get(uploads, 'revisionObserver'),
      ),
      imports,
      storage,
      mode,
    );
    oldMaintenance = new legacy.EagleMaintenanceService(scoped, imports);
    oldRecovery.onModuleInit();
    oldMaintenance.onModuleInit();
    process.send({
      event: 'ready',
      version,
      recoveryInterval: Reflect.get(oldRecovery, 'timer')._idleTimeout,
      maintenanceInterval: Reflect.get(oldMaintenance, 'timer')._idleTimeout,
    });
  } else {
    host.start();
    send('ready');
  }
  await barrier;
  for (let i = 0; i < 600; i++) {
    if (
      version === 'legacy'
        ? !Reflect.get(oldRecovery, 'running') && !Reflect.get(oldMaintenance, 'running')
        : Reflect.get(host, 'running').size === 0
    ) {
      send('done');
      break;
    }
    if (i === 599) throw Error('Host did not finish initial discovery');
    await delay(25);
  }
} catch (error) {
  send('failed');
  await close();
  throw error;
}
