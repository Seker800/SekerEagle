import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StorageModule } from '../storage/storage.module';
import { EagleController } from './eagle.controller';
import { EagleBrowserCaptureController } from './eagle-browser-capture.controller';
import { EagleBrowserCaptureService } from './eagle-browser-capture.service';
import { EagleImportController } from './eagle-import.controller';
import { EagleImportService } from './eagle-import.service';
import { EagleMediaService } from './eagle-media.service';
import { EagleMaintenanceService } from './eagle-maintenance.service';
import { EagleMediaCapabilityService } from './eagle-media-capability.service';
import { EagleProcessingController } from './eagle-processing.controller';
import { EagleProcessingService } from './eagle-processing.service';
import { EagleVectorController } from './eagle-vector.controller';
import { EagleVectorService } from './eagle-vector.service';
import { EagleService } from './eagle.service';
import { EagleUploadController } from './eagle-upload.controller';
import { EagleUploadService } from './eagle-upload.service';
import { EagleUploadRecoveryService } from './eagle-upload-recovery.service';
import { EagleUploadInspectionService } from './eagle-upload-inspection.service';
import { PrismaSekerEagleIngestionAdapter } from './adapters/prisma/seker-eagle-ingestion.adapter';
import { PrismaEagleImportsRepository } from './import/adapters/prisma/eagle-app-import.repository';
import { EAGLE_IMPORTS_REPOSITORY } from './import/eagle-app-import.repository';
import { EagleImportsService } from './import/eagle-app-import.service';
import { SEKER_EAGLE_INGESTION_PORT } from './seker-eagle-ingestion.port';

@Module({
  imports: [AuthModule, StorageModule],
  controllers: [
    EagleController,
    EagleBrowserCaptureController,
    EagleUploadController,
    EagleImportController,
    EagleProcessingController,
    EagleVectorController,
  ],
  providers: [
    EagleService,
    EagleBrowserCaptureService,
    EagleMediaService,
    EagleMaintenanceService,
    EagleMediaCapabilityService,
    EagleUploadService,
    EagleUploadRecoveryService,
    EagleUploadInspectionService,
    EagleImportService,
    EagleImportsService,
    PrismaEagleImportsRepository,
    PrismaSekerEagleIngestionAdapter,
    { provide: EAGLE_IMPORTS_REPOSITORY, useExisting: PrismaEagleImportsRepository },
    { provide: SEKER_EAGLE_INGESTION_PORT, useExisting: PrismaSekerEagleIngestionAdapter },
    EagleProcessingService,
    EagleVectorService,
  ],
  exports: [EagleService],
})
export class EagleModule {}
