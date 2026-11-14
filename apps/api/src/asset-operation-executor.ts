import { registerTaskCommands } from './eagle/eagle-task-commands';
import { EagleTaskCenterService } from './eagle/eagle-task-center.service';
import { registerDuplicateCommands } from './eagle/eagle-duplicate-commands';
import { registerBatchEditCommands } from './eagle/eagle-batch-edit';
import { LibraryCommandRegistry } from './eagle/eagle-library-command';
import { registerSharedLibraryCommands } from './eagle/eagle-shared-commands';
import { EaglePrivacyService } from './eagle/eagle-privacy.service';
import { EagleVectorService } from './eagle/eagle-vector.service';
import { EagleProcessingService } from './eagle/eagle-processing.service';
import { registerPhotoLibraryCommands } from './photos/photo-library-commands';
import { PhotoManagementService } from './photos/photo-management.service';
import { PhotoPersonReviewService } from './photos/photo-person-review.service';
import { PhotoAgentService } from './photos/photo-agent.service';
import { PhotoRevisionObserver } from './photos/photo-revision.observer';
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
import { AssetOperationBackground } from './asset-operation-background';
import { EagleUploadService } from './eagle/eagle-upload.service';
import { EagleUploadInspectionService } from './eagle/eagle-upload-inspection.service';
import { EagleUploadRecoveryService } from './eagle/eagle-upload-recovery.service';
import { EagleMediaCapabilityService } from './eagle/eagle-media-capability.service';
import { EagleMaintenanceService } from './eagle/eagle-maintenance.service';
import { EagleImportsService } from './eagle/import/eagle-app-import.service';
import { PrismaEagleImportsRepository } from './eagle/import/adapters/prisma/eagle-app-import.repository';
import { PrismaSekerEagleIngestionAdapter } from './eagle/adapters/prisma/seker-eagle-ingestion.adapter';
import { UploadFinalizationExecutor } from './upload-finalization-executor';

const UPLOAD_MODES = ['MATERIAL', 'PHOTO'] as const;

/** Same domain services, a separate process/pool, no HTTP module or authentication secrets. */
export function createAssetOperationExecutors(
  prisma: PrismaService,
  storage: ObjectStorageService,
) {
  return (['MATERIAL', 'PHOTO'] as const).map((mode) => {
    const commands = new LibraryCommandRegistry();
    const eagle = new EagleService(prisma, undefined, mode);
    const transfers = new EagleLibraryTransferService(prisma, storage, mode);
    registerSharedLibraryCommands(commands, {
      eagle,
      privacy: new EaglePrivacyService(prisma, mode),
      vectors: new EagleVectorService(prisma, mode),
      processing: new EagleProcessingService(prisma, mode),
    });
    registerBatchEditCommands(commands, prisma);
    const duplicates = new EagleDuplicateService(prisma, storage, mode);
    registerDuplicateCommands(commands, duplicates);
    registerTaskCommands(commands, new EagleTaskCenterService(prisma, mode));
    if (mode === 'PHOTO') {
      const photos = new PhotoManagementService(prisma);
      registerPhotoLibraryCommands(commands, {
        photos,
        review: new PhotoPersonReviewService(prisma, photos),
        agent: new PhotoAgentService(prisma, undefined as never, transfers),
      });
    }
    return new EagleAssetOperationService(prisma, transfers, eagle, mode, duplicates, commands);
  });
}

export function createAssetOperationBackground(
  prisma: PrismaService,
  storage: ObjectStorageService,
) {
  const imports = new EagleImportsService(
    new PrismaEagleImportsRepository(prisma, new PrismaSekerEagleIngestionAdapter()),
  );
  const inspection = new EagleUploadInspectionService(storage);
  const capabilities = new EagleMediaCapabilityService();
  const uploads = Object.fromEntries(
    UPLOAD_MODES.map((mode) => [
      mode,
      new EagleUploadService(
        prisma,
        storage,
        capabilities,
        inspection,
        mode,
        mode === 'PHOTO' ? new PhotoRevisionObserver() : undefined,
      ),
    ]),
  ) as Record<(typeof UPLOAD_MODES)[number], EagleUploadService>;
  const recoveries = (['MATERIAL', 'PHOTO'] as const).map(
    (mode) => new EagleUploadRecoveryService(prisma, uploads[mode], imports, storage, mode),
  );
  const finalizations = new UploadFinalizationExecutor(prisma, uploads, imports);
  return new AssetOperationBackground(
    recoveries,
    new EagleMaintenanceService(prisma, imports),
    finalizations,
    process.env.EAGLE_UPLOAD_RECOVERY_ENABLED !== 'false',
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
  let background: AssetOperationBackground | undefined;
  const shutdown = () =>
    (closing ??= (async () => {
      await rm(readyFile, { force: true });
      try {
        await wakeup?.close();
        await Promise.all([background?.close(), ...executors.map((executor) => executor.drain())]);
      } finally {
        storage.onModuleDestroy();
        await prisma.onModuleDestroy();
      }
    })());
  try {
    await rm(readyFile, { force: true });
    await prisma.onModuleInit();
    executors = createAssetOperationExecutors(prisma, storage);
    background = createAssetOperationBackground(prisma, storage);
    background.start();
    for (const executor of executors) executor.startExecutor();
    wakeup = new AssetOperationWakeup(env.DATABASE_URL!, executors, background.finalizations);
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
