import 'reflect-metadata';
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
  await prisma.onModuleInit();
  const executors = createAssetOperationExecutors(prisma, storage);
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    await Promise.all(executors.map((executor) => executor.drain()));
    storage.onModuleDestroy();
    await prisma.onModuleDestroy();
  };
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      void shutdown().catch(() => {
        process.exitCode = 1;
      });
    });
  for (const executor of executors) executor.startExecutor();
  console.info('Asset operation executor ready; HTTP API only admits and reads operations.');
}

if (require.main === module)
  void main().catch(() => {
    console.error('Asset operation executor failed to start.');
    process.exitCode = 1;
  });
