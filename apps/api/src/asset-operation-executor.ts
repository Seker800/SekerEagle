import { AssetOperationWakeup } from './asset-operation-wakeup';
import { EagleDuplicateService } from './eagle/eagle-duplicates.service';
import 'reflect-metadata';
import { rm, writeFile } from 'node:fs/promises';
import { ConfigService } from '@nestjs/config';
import { assertSafeRuntimeTarget } from '@sekereagle/config';
import { PrismaService } from './prisma/prisma.service';
import { ObjectStorageService } from './storage/object-storage.service';
import { objectStorageRuntimeOptions } from './config/runtime-config';
import { EagleAssetOperationService } from './eagle/eagle-asset-operations.service';
import { EagleLibraryTransferService } from './eagle/eagle-library-transfer.service';
import { EagleService } from './eagle/eagle.service';

/** Same domain services, a separate process/pool, no HTTP module or authentication secrets. */
export function createAssetOperationExecutors(
  prisma: PrismaService,
  storage: ObjectStorageService,
) {
  return (['MATERIAL', 'PHOTO'] as const).map(
    (mode) =>
      new EagleAssetOperationService(
        prisma,
        new EagleLibraryTransferService(prisma, storage, mode),
        new EagleService(prisma, undefined, mode),
        mode,
        new EagleDuplicateService(prisma, storage, mode),
      ),
  );
}

async function main() {
  const env = process.env;
  assertSafeRuntimeTarget({
    databaseUrl: env.DATABASE_URL ?? '',
    s3Endpoint: env.S3_ENDPOINT ?? '',
    s3Bucket: env.S3_BUCKET ?? '',
  });
  const storageConfig: Record<string, unknown> = { ...objectStorageRuntimeOptions(env) };
  for (const key of [
    'S3_BUCKET',
    'S3_REGION',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'S3_ENDPOINT',
    'S3_PUBLIC_ENDPOINT',
  ]) {
    if (!env[key]) throw new Error(`Missing executor setting ${key}`);
    storageConfig[key] = env[key];
  }
  const prisma = new PrismaService();
  const storage = new ObjectStorageService(new ConfigService(storageConfig));
  const readyFile = env.EAGLE_OPERATION_READY_FILE ?? '/tmp/sekereagle-asset-operations-ready';
  let executors: ReturnType<typeof createAssetOperationExecutors> = [];
  let closing: Promise<void> | undefined;
  let wakeup: AssetOperationWakeup | undefined;
  const shutdown = () =>
    (closing ??= (async () => {
      await rm(readyFile, { force: true });
      try {
        await wakeup?.close();
        await Promise.all(executors.map((executor) => executor.drain()));
      } finally {
        storage.onModuleDestroy();
        await prisma.onModuleDestroy();
      }
    })());
  try {
    await rm(readyFile, { force: true });
    await prisma.onModuleInit();
    executors = createAssetOperationExecutors(prisma, storage);
    for (const executor of executors) executor.startExecutor();
    wakeup = new AssetOperationWakeup(env.DATABASE_URL!, executors);
    await wakeup.start();
    await writeFile(readyFile, String(process.pid), { mode: 0o600 });
  } catch (error) {
    await shutdown();
    throw error;
  }
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void shutdown().catch(() => {
        process.exitCode = 1;
      });
    });
  console.info('Asset operation executor ready; HTTP API only admits and reads operations.');
}

if (require.main === module)
  void main().catch(() => {
    console.error('Asset operation executor failed to start.');
    process.exitCode = 1;
  });
